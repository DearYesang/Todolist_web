import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { parseBoardPreferencesInput, TaskWriteError } from './validation.js';

const DEFAULT_WORKSPACE_NAME = 'Personal';
const DEFAULT_BOARD_NAME = 'Inbox';
const DEFAULT_MEMBER_ROLE = 'owner';

/**
 * @param {string} userId
 */
export async function ensurePersonalBoardForUser(userId) {
	return getOrCreatePersonalBoardForUser(getDb(), userId);
}

/**
 * @param {string} userId
 */
export async function getBoardPreferencesForUser(userId) {
	const board = await getOrCreatePersonalBoardForUser(getDb(), userId);
	return mapBoardPreferences(board);
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function updateBoardPreferencesForUser(userId, payload) {
	const input = parseBoardPreferencesInput(payload);
	const db = getDb();
	const board = await getOrCreatePersonalBoardForUser(db, userId);
	const [updated] = await db
		.update(schema.boards)
		.set({
			defaultView: input.defaultView,
			updatedAt: new Date()
		})
		.where(eq(schema.boards.id, board.id))
		.returning();

	if (!updated) {
		throw new TaskWriteError('Board preferences could not be updated.', 500);
	}

	return mapBoardPreferences(updated);
}

/**
 * @param {typeof schema.boards.$inferSelect} board
 */
function mapBoardPreferences(board) {
	return {
		defaultView: board.defaultView
	};
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
export async function getFirstBoardForUser(db, userId) {
	const memberships = await db
		.select({ workspaceId: schema.workspaceMembers.workspaceId })
		.from(schema.workspaceMembers)
		.where(eq(schema.workspaceMembers.userId, userId));

	if (memberships.length === 0) {
		return null;
	}

	const [board] = await db
		.select()
		.from(schema.boards)
		.where(inArray(schema.boards.workspaceId, memberships.map((membership) => membership.workspaceId)))
		.orderBy(asc(schema.boards.createdAt))
		.limit(1);

	return board ?? null;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
export async function getOrCreatePersonalBoardForUser(db, userId) {
	const workspace = await getOrCreateDefaultWorkspace(db, userId);
	await ensureWorkspaceMembership(db, workspace.id, userId);

	const board = await getOrCreateDefaultBoard(db, workspace.id);
	if (!board) {
		throw new TaskWriteError('A default workspace board could not be created.', 500);
	}

	return board;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
export async function getPersonalBoardForUser(db, userId) {
	const workspace = await getDefaultWorkspace(db, userId);
	if (!workspace) {
		return null;
	}

	return getDefaultBoard(db, workspace.id);
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} workspaceId
 * @param {string} userId
 */
async function ensureWorkspaceMembership(db, workspaceId, userId) {
	await db
		.insert(schema.workspaceMembers)
		.values({
			workspaceId,
			userId,
			role: DEFAULT_MEMBER_ROLE
		})
		.onConflictDoNothing({
			target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId]
		});
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
async function getOrCreateDefaultWorkspace(db, userId) {
	const existingWorkspace = await getDefaultWorkspace(db, userId);
	if (existingWorkspace) {
		return existingWorkspace;
	}

	const [createdWorkspace] = await db
		.insert(schema.workspaces)
		.values({
			name: DEFAULT_WORKSPACE_NAME,
			ownerUserId: userId
		})
		.onConflictDoNothing({
			target: [schema.workspaces.ownerUserId, schema.workspaces.name]
		})
		.returning();

	const workspace = createdWorkspace ?? (await getDefaultWorkspace(db, userId));
	if (!workspace) {
		throw new TaskWriteError('A default workspace could not be created.', 500);
	}

	return workspace;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
async function getDefaultWorkspace(db, userId) {
	const [workspace] = await db
		.select()
		.from(schema.workspaces)
		.where(and(eq(schema.workspaces.ownerUserId, userId), eq(schema.workspaces.name, DEFAULT_WORKSPACE_NAME)))
		.limit(1);

	return workspace ?? null;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} workspaceId
 */
async function getOrCreateDefaultBoard(db, workspaceId) {
	const existingBoard = await getDefaultBoard(db, workspaceId);
	if (existingBoard) {
		return existingBoard;
	}

	const [createdBoard] = await db
		.insert(schema.boards)
		.values({
			workspaceId,
			name: DEFAULT_BOARD_NAME,
			defaultView: 'kanban'
		})
		.onConflictDoNothing({
			target: [schema.boards.workspaceId, schema.boards.name]
		})
		.returning();

	return createdBoard ?? (await getDefaultBoard(db, workspaceId));
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} workspaceId
 */
async function getDefaultBoard(db, workspaceId) {
	const [board] = await db
		.select()
		.from(schema.boards)
		.where(and(eq(schema.boards.workspaceId, workspaceId), eq(schema.boards.name, DEFAULT_BOARD_NAME)))
		.limit(1);

	return board ?? null;
}
