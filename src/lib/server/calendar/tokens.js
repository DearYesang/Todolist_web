import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { ensurePersonalBoardForUser, listTasksForBoard } from '$lib/server/tasks/repository.js';

const TOKEN_PREFIX = 'cal_';
const TOKEN_BYTES = 32;
const TOKEN_PREVIEW_LENGTH = 12;
const MAX_TOKEN_NAME_LENGTH = 80;

export class CalendarTokenConfigurationError extends Error {
	constructor() {
		super('CALENDAR_TOKEN_SECRET must be configured before calendar subscription tokens can be used.');
		this.name = 'CalendarTokenConfigurationError';
	}
}

/**
 * @param {string} userId
 */
export async function listCalendarTokensForUser(userId) {
	const db = getDb();
	return db
		.select({
			id: schema.calendarSubscriptionTokens.id,
			name: schema.calendarSubscriptionTokens.name,
			tokenPrefix: schema.calendarSubscriptionTokens.tokenPrefix,
			createdAt: schema.calendarSubscriptionTokens.createdAt,
			lastUsedAt: schema.calendarSubscriptionTokens.lastUsedAt,
			revokedAt: schema.calendarSubscriptionTokens.revokedAt,
			expiresAt: schema.calendarSubscriptionTokens.expiresAt
		})
		.from(schema.calendarSubscriptionTokens)
		.where(eq(schema.calendarSubscriptionTokens.userId, userId))
		.orderBy(desc(schema.calendarSubscriptionTokens.createdAt));
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function createCalendarTokenForUser(userId, payload) {
	const rawToken = createCalendarToken();
	const now = new Date();
	const board = await ensurePersonalBoardForUser(userId);
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	const name = parseTokenName(source?.name);
	const db = getDb();
	const [created] = await db
		.insert(schema.calendarSubscriptionTokens)
		.values({
			userId,
			workspaceId: board.workspaceId,
			boardId: board.id,
			name,
			tokenHash: hashCalendarToken(rawToken),
			tokenPrefix: rawToken.slice(0, TOKEN_PREVIEW_LENGTH),
			createdAt: now,
			lastUsedAt: null,
			revokedAt: null,
			expiresAt: null
		})
		.returning();

	return {
		token: rawToken,
		url: `/api/calendar/subscriptions/${rawToken}.ics`,
		record: sanitizeTokenRecord(created)
	};
}

/**
 * @param {string} userId
 * @param {string} tokenId
 */
export async function revokeCalendarTokenForUser(userId, tokenId) {
	const db = getDb();
	const [revoked] = await db
		.update(schema.calendarSubscriptionTokens)
		.set({ revokedAt: new Date() })
		.where(and(
			eq(schema.calendarSubscriptionTokens.id, tokenId),
			eq(schema.calendarSubscriptionTokens.userId, userId),
			isNull(schema.calendarSubscriptionTokens.revokedAt)
		))
		.returning();

	return revoked ? sanitizeTokenRecord(revoked) : null;
}

/**
 * @param {string} rawToken
 */
export async function getCalendarTasksForToken(rawToken) {
	const db = getDb();
	const [tokenRecord] = await db
		.select()
		.from(schema.calendarSubscriptionTokens)
		.where(and(
			eq(schema.calendarSubscriptionTokens.tokenHash, hashCalendarToken(rawToken)),
			isNull(schema.calendarSubscriptionTokens.revokedAt),
			or(isNull(schema.calendarSubscriptionTokens.expiresAt), gt(schema.calendarSubscriptionTokens.expiresAt, new Date()))
		))
		.limit(1);

	if (!tokenRecord) {
		return null;
	}

	await db
		.update(schema.calendarSubscriptionTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(schema.calendarSubscriptionTokens.id, tokenRecord.id));

	return listTasksForBoard(tokenRecord.boardId);
}

export function createCalendarToken() {
	return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

/**
 * @param {string} rawToken
 */
export function hashCalendarToken(rawToken) {
	const secret = process.env.CALENDAR_TOKEN_SECRET;
	if (!secret) {
		throw new CalendarTokenConfigurationError();
	}

	return createHmac('sha256', secret).update(rawToken).digest('hex');
}

/**
 * @param {unknown} value
 */
function parseTokenName(value) {
	if (typeof value !== 'string') {
		return 'Calendar feed';
	}

	const name = value.trim();
	if (!name) {
		return 'Calendar feed';
	}

	return name.slice(0, MAX_TOKEN_NAME_LENGTH);
}

/**
 * @param {typeof schema.calendarSubscriptionTokens.$inferSelect | undefined} record
 */
function sanitizeTokenRecord(record) {
	if (!record) {
		return null;
	}

	return {
		id: record.id,
		name: record.name,
		tokenPrefix: record.tokenPrefix,
		createdAt: record.createdAt,
		lastUsedAt: record.lastUsedAt,
		revokedAt: record.revokedAt,
		expiresAt: record.expiresAt
	};
}
