import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { ensurePersonalBoardForUser, listTasksForUser } from '$lib/server/tasks/repository.js';
import {
	decryptCalendarToken,
	encryptCalendarToken,
	assertCalendarOauthEncryptionConfigured
} from './oauth-encryption.js';
import {
	buildCalendarAuthorizationUrl,
	deleteProviderCalendarEvent,
	exchangeCalendarCode,
	fetchCalendarProviderAccount,
	listCalendarProviders,
	refreshCalendarToken,
	revokeProviderCalendarToken,
	upsertProviderCalendarEvent
} from './providers.js';

const OAUTH_STATE_PREFIX = 'calendar-oauth-state:';
const DEFAULT_SYNC_TASK_LIMIT = 250;
const DEFAULT_BACKGROUND_SYNC_USER_LIMIT = 10;
/** @type {Set<string>} */
const syncLocks = new Set();

/**
 * @param {string} userId
 */
export async function listCalendarProviderConnections(userId) {
	const rows = await getDb()
		.select()
		.from(schema.calendarConnections)
		.where(eq(schema.calendarConnections.userId, userId));
	const runs = await getDb()
		.select()
		.from(schema.calendarSyncRuns)
		.where(eq(schema.calendarSyncRuns.userId, userId))
		.orderBy(desc(schema.calendarSyncRuns.startedAt))
		.limit(10);

	return {
		providers: listCalendarProviders(),
		connections: rows.map((row) => {
			const latestSync = runs.find((run) => run.connectionId === row.id);
			return {
				...toConnectionResponse(row),
				latestSync: latestSync ? toSyncRunResponse(latestSync) : null
			};
		}),
		syncRuns: runs.map(toSyncRunResponse)
	};
}

/**
 * @param {string} userId
 * @param {string} provider
 * @param {URL} baseUrl
 * @param {{ userId: string; sessionId: string }} sessionBinding
 */
export async function createCalendarProviderAuthorizationUrl(userId, provider, baseUrl, sessionBinding) {
	assertCalendarOauthEncryptionConfigured();
	const state = createOauthState();
	const redirectUri = createRedirectUri(baseUrl, provider);
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
	await getDb().insert(schema.verification).values({
		id: createStateId(),
		identifier: `${OAUTH_STATE_PREFIX}${state}`,
		value: JSON.stringify({ userId, provider, sessionId: sessionBinding.sessionId }),
		expiresAt
	});

	return buildCalendarAuthorizationUrl(provider, state, redirectUri);
}

/**
 * @param {string} provider
 * @param {string} code
 * @param {string} state
 * @param {URL} baseUrl
 * @param {{ userId: string; sessionId: string }} sessionBinding
 */
export async function completeCalendarProviderAuthorization(provider, code, state, baseUrl, sessionBinding) {
	assertCalendarOauthEncryptionConfigured();
	const stateRecord = await consumeOauthState(state);
	if (
		!stateRecord
		|| stateRecord.provider !== provider
		|| stateRecord.userId !== sessionBinding.userId
		|| stateRecord.sessionId !== sessionBinding.sessionId
	) {
		throw new CalendarSyncError('Calendar OAuth state is invalid or expired.', 400);
	}

	const redirectUri = createRedirectUri(baseUrl, provider);
	const token = await exchangeCalendarCode(provider, code, redirectUri);
	if (!token.accessToken) {
		throw new CalendarSyncError('Calendar provider did not return an access token.', 502);
	}

	const account = await fetchCalendarProviderAccount(provider, token.accessToken);
	const board = await ensurePersonalBoardForUser(stateRecord.userId);
	const associatedData = createConnectionAssociatedData({
		userId: stateRecord.userId,
		provider,
		providerAccountId: account.id
	});
	const encryptedAccessToken = encryptCalendarToken(token.accessToken, associatedData);
	const encryptedRefreshToken = encryptCalendarToken(token.refreshToken, associatedData);
	const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null;
	const db = getDb();

	const [existing] = await db
		.select()
		.from(schema.calendarConnections)
		.where(and(
			eq(schema.calendarConnections.userId, stateRecord.userId),
			eq(schema.calendarConnections.provider, provider),
			eq(schema.calendarConnections.providerAccountId, account.id)
		))
		.limit(1);

	const now = new Date();
	if (existing) {
		const [updated] = await db
			.update(schema.calendarConnections)
			.set({
				workspaceId: board.workspaceId,
				encryptedAccessToken,
				encryptedRefreshToken: encryptedRefreshToken ?? existing.encryptedRefreshToken,
				expiresAt,
				updatedAt: now
			})
			.where(eq(schema.calendarConnections.id, existing.id))
			.returning();
		return toConnectionResponse(updated);
	}

	const [created] = await db
		.insert(schema.calendarConnections)
		.values({
			workspaceId: board.workspaceId,
			userId: stateRecord.userId,
			provider,
			providerAccountId: account.id,
			encryptedAccessToken,
			encryptedRefreshToken,
			expiresAt,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	return toConnectionResponse(created);
}

/**
 * @param {string} userId
 * @param {string} connectionId
 */
export async function deleteCalendarProviderConnection(userId, connectionId) {
	const [connection] = await getDb()
		.select()
		.from(schema.calendarConnections)
		.where(and(eq(schema.calendarConnections.id, connectionId), eq(schema.calendarConnections.userId, userId)))
		.limit(1);
	if (!connection) {
		throw new CalendarSyncError('Calendar connection was not found.', 404);
	}

	const associatedData = createConnectionAssociatedData(connection);
	const refreshToken = decryptCalendarToken(connection.encryptedRefreshToken, associatedData);
	const accessToken = decryptCalendarToken(connection.encryptedAccessToken, associatedData);
	await revokeProviderCalendarToken(connection.provider, refreshToken ?? accessToken);

	const [deleted] = await getDb()
		.delete(schema.calendarConnections)
		.where(and(eq(schema.calendarConnections.id, connectionId), eq(schema.calendarConnections.userId, userId)))
		.returning({ id: schema.calendarConnections.id });

	if (!deleted) {
		throw new CalendarSyncError('Calendar connection was not found.', 404);
	}

	return deleted.id;
}

/**
 * @param {string} userId
 */
export async function syncCalendarProvidersForUser(userId) {
	if (syncLocks.has(userId)) {
		throw new CalendarSyncError('Calendar sync is already running for this user.', 409);
	}

	syncLocks.add(userId);
	try {
		return await syncCalendarProvidersForUserUnlocked(userId);
	} finally {
		syncLocks.delete(userId);
	}
}

/**
 * @param {{ maxUsers?: number }} [options]
 */
export async function syncCalendarProvidersForConnectedUsers(options = {}) {
	const maxUsers = normalizePositiveInteger(options.maxUsers, getBackgroundSyncUserLimit());
	const connectionRows = await getDb()
		.select({ userId: schema.calendarConnections.userId })
		.from(schema.calendarConnections);
	const userIds = [...new Set(connectionRows.map((row) => row.userId))].slice(0, maxUsers);
	const results = [];

	for (const userId of userIds) {
		try {
			results.push({
				userId,
				ok: true,
				result: await syncCalendarProvidersForUser(userId)
			});
		} catch (error) {
			results.push({
				userId,
				ok: false,
				message: readErrorMessage(error) ?? 'Calendar background sync failed.'
			});
		}
	}

	return {
		ok: results.every((result) => result.ok),
		users: userIds.length,
		limit: maxUsers,
		results
	};
}

/**
 * @param {string} userId
 */
async function syncCalendarProvidersForUserUnlocked(userId) {
	const db = getDb();
	const connections = await db
		.select()
		.from(schema.calendarConnections)
		.where(eq(schema.calendarConnections.userId, userId));
	const tasks = (await listTasksForUser(userId)).filter(shouldSyncTaskToProvider);
	const taskLimit = getSyncTaskLimit();
	if (tasks.length > taskLimit) {
		throw new CalendarSyncError(`Calendar sync is limited to ${taskLimit} tasks per run.`, 413);
	}

	const activeTaskIds = new Set(tasks.map((task) => task.id));
	const summaries = [];

	for (const connection of connections) {
		const run = await createSyncRun(connection, tasks.length);
		const links = await db
			.select()
			.from(schema.calendarEventLinks)
			.where(eq(schema.calendarEventLinks.connectionId, connection.id));
		const linksByTaskId = new Map(links.map((link) => [link.taskId, link]));
		let upserted = 0;
		let deleted = 0;
		let failed = 0;
		let message = '';

		try {
			const accessToken = await getFreshAccessToken(connection);
			for (const task of tasks) {
				try {
					const link = linksByTaskId.get(task.id);
					const event = await upsertProviderCalendarEvent(
						connection.provider,
						accessToken,
						link?.syncStatus === 'active' ? link.externalEventId : null,
						task
					);
					if (!event.id) {
						throw new CalendarSyncError('Calendar provider did not return an event id.', 502);
					}

					await upsertEventLink(connection.id, task.id, event.id, event.etag ?? null);
					upserted += 1;
				} catch (error) {
					await markTaskLinkErrored(connection.id, task.id);
					failed += 1;
					message = readErrorMessage(error) ?? message;
				}
			}

			const staleLinks = links.filter((link) => link.syncStatus === 'active' && !activeTaskIds.has(link.taskId));
			for (const link of staleLinks) {
				try {
					await deleteProviderCalendarEvent(connection.provider, accessToken, link.externalEventId);
					await db
						.update(schema.calendarEventLinks)
						.set({
							syncStatus: 'deleted',
							lastSyncedAt: new Date()
						})
						.where(eq(schema.calendarEventLinks.id, link.id));
					deleted += 1;
				} catch (error) {
					failed += 1;
					message = readErrorMessage(error) ?? message;
				}
			}
		} catch (error) {
			failed += tasks.length;
			message = readErrorMessage(error) ?? 'Calendar sync failed.';
		} finally {
			await finishSyncRun(run.id, {
				status: failed === 0 ? 'success' : upserted > 0 || deleted > 0 ? 'partial' : 'error',
				upserted,
				deleted,
				failed,
				message
			});
		}

		summaries.push({
			connectionId: connection.id,
			provider: connection.provider,
			upserted,
			deleted,
			failed,
			status: failed === 0 ? 'success' : upserted > 0 || deleted > 0 ? 'partial' : 'error',
			message
		});
	}

	return {
		connections: summaries.length,
		tasks: tasks.length,
		summaries
	};
}

/**
 * @param {typeof schema.calendarConnections.$inferSelect} connection
 * @param {number} taskCount
 */
async function createSyncRun(connection, taskCount) {
	const [created] = await getDb()
		.insert(schema.calendarSyncRuns)
		.values({
			connectionId: connection.id,
			userId: connection.userId,
			provider: connection.provider,
			status: 'running',
			taskCount,
			upserted: 0,
			deleted: 0,
			failed: 0,
			startedAt: new Date()
		})
		.returning();

	return created;
}

/**
 * @param {string} runId
 * @param {{ status: 'success' | 'partial' | 'error'; upserted: number; deleted: number; failed: number; message?: string }} result
 */
async function finishSyncRun(runId, result) {
	await getDb()
		.update(schema.calendarSyncRuns)
		.set({
			status: result.status,
			finishedAt: new Date(),
			upserted: result.upserted,
			deleted: result.deleted,
			failed: result.failed,
			message: result.message || null
		})
		.where(eq(schema.calendarSyncRuns.id, runId));
}

/**
 * @param {typeof schema.calendarConnections.$inferSelect} connection
 */
async function getFreshAccessToken(connection) {
	const associatedData = createConnectionAssociatedData(connection);
	const accessToken = decryptCalendarToken(connection.encryptedAccessToken, associatedData);
	const refreshToken = decryptCalendarToken(connection.encryptedRefreshToken, associatedData);
	const expiresSoon = !connection.expiresAt || connection.expiresAt.getTime() < Date.now() + 60_000;
	if (!expiresSoon && accessToken) {
		return accessToken;
	}

	if (!refreshToken) {
		if (accessToken) {
			return accessToken;
		}

		throw new CalendarSyncError('Calendar connection does not have a usable access token.', 503);
	}

	const refreshed = await refreshCalendarToken(connection.provider, refreshToken);
	if (!refreshed.accessToken) {
		throw new CalendarSyncError('Calendar provider did not return a refreshed access token.', 502);
	}

	const encryptedAccessToken = encryptCalendarToken(refreshed.accessToken, associatedData);
	const encryptedRefreshToken = refreshed.refreshToken
		? encryptCalendarToken(refreshed.refreshToken, associatedData)
		: connection.encryptedRefreshToken;
	const expiresAt = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : connection.expiresAt;

	await getDb()
		.update(schema.calendarConnections)
		.set({
			encryptedAccessToken,
			encryptedRefreshToken,
			expiresAt,
			updatedAt: new Date()
		})
		.where(eq(schema.calendarConnections.id, connection.id));

	return refreshed.accessToken;
}

/**
 * @param {string} connectionId
 * @param {string} taskId
 * @param {string} externalEventId
 * @param {string | null} etag
 */
async function upsertEventLink(connectionId, taskId, externalEventId, etag) {
	const db = getDb();
	const now = new Date();
	const [existing] = await db
		.select()
		.from(schema.calendarEventLinks)
		.where(and(
			eq(schema.calendarEventLinks.connectionId, connectionId),
			eq(schema.calendarEventLinks.taskId, taskId)
		))
		.limit(1);

	if (existing) {
		await db
			.update(schema.calendarEventLinks)
			.set({
				externalCalendarId: 'primary',
				externalEventId,
				etag,
				lastSyncedAt: now,
				syncStatus: 'active'
			})
			.where(eq(schema.calendarEventLinks.id, existing.id));
		return;
	}

	await db.insert(schema.calendarEventLinks).values({
		taskId,
		connectionId,
		externalCalendarId: 'primary',
		externalEventId,
		etag,
		lastSyncedAt: now,
		syncStatus: 'active'
	});
}

/**
 * @param {string} connectionId
 * @param {string} taskId
 */
async function markTaskLinkErrored(connectionId, taskId) {
	const db = getDb();
	const [existing] = await db
		.select()
		.from(schema.calendarEventLinks)
		.where(and(
			eq(schema.calendarEventLinks.connectionId, connectionId),
			eq(schema.calendarEventLinks.taskId, taskId)
		))
		.limit(1);

	if (!existing) {
		return;
	}

	await db
		.update(schema.calendarEventLinks)
		.set({
			syncStatus: 'error',
			lastSyncedAt: new Date()
		})
		.where(eq(schema.calendarEventLinks.id, existing.id));
}

/**
 * @param {string} state
 */
async function consumeOauthState(state) {
	const identifier = `${OAUTH_STATE_PREFIX}${state}`;
	const [record] = await getDb()
		.delete(schema.verification)
		.where(and(eq(schema.verification.identifier, identifier), gt(schema.verification.expiresAt, new Date())))
		.returning();
	if (!record) {
		return null;
	}

	try {
		const parsed = JSON.parse(record.value);
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}

		const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
		const provider = typeof parsed.provider === 'string' ? parsed.provider : '';
		const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
		return userId && provider && sessionId ? { userId, provider, sessionId } : null;
	} catch {
		return null;
	}
}

/**
 * @param {URL} baseUrl
 * @param {string} provider
 */
function createRedirectUri(baseUrl, provider) {
	return new URL(`/api/calendar/providers/${provider}/callback`, baseUrl.origin).toString();
}

function createOauthState() {
	return randomBytes(32).toString('base64url');
}

function createStateId() {
	return randomBytes(16).toString('hex');
}

/**
 * @param {{ userId: string; provider: string; providerAccountId: string | null }} connection
 */
function createConnectionAssociatedData(connection) {
	return `calendar-oauth:${connection.userId}:${connection.provider}:${connection.providerAccountId ?? ''}`;
}

/**
 * @param {typeof schema.calendarConnections.$inferSelect} row
 */
function toConnectionResponse(row) {
	return {
		id: row.id,
		provider: row.provider,
		providerAccountId: row.providerAccountId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		expiresAt: row.expiresAt?.toISOString() ?? null
	};
}

/**
 * @param {typeof schema.calendarSyncRuns.$inferSelect} row
 */
function toSyncRunResponse(row) {
	return {
		id: row.id,
		connectionId: row.connectionId,
		provider: row.provider,
		status: row.status,
		startedAt: row.startedAt.toISOString(),
		finishedAt: row.finishedAt?.toISOString() ?? null,
		taskCount: row.taskCount,
		upserted: row.upserted,
		deleted: row.deleted,
		failed: row.failed,
		message: row.message
	};
}

/**
 * @param {import('$lib/shared/task-domain.js').Task} task
 */
export function shouldSyncTaskToProvider(task) {
	return task.status !== 'done';
}

function getSyncTaskLimit() {
	return normalizePositiveInteger(process.env.CALENDAR_SYNC_MAX_TASKS, DEFAULT_SYNC_TASK_LIMIT);
}

function getBackgroundSyncUserLimit() {
	return normalizePositiveInteger(process.env.CALENDAR_BACKGROUND_SYNC_MAX_USERS, DEFAULT_BACKGROUND_SYNC_USER_LIMIT);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
	const configured = Number(value ?? fallback);
	return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

/**
 * @param {unknown} error
 */
function readErrorMessage(error) {
	return error instanceof Error && error.message ? error.message : null;
}

export class CalendarSyncError extends Error {
	/** @param {string} message */
	constructor(message, status = 500) {
		super(message);
		this.name = 'CalendarSyncError';
		this.status = status;
	}
}
