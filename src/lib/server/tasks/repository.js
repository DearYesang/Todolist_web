import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { mapTaskRowsToClientTasks } from './task-mapper.js';
import { parseCreateTaskInput, TaskWriteError } from './validation.js';

const DEFAULT_WORKSPACE_NAME = 'Personal';
const DEFAULT_BOARD_NAME = 'Inbox';
const DEFAULT_MEMBER_ROLE = 'owner';

/**
 * @param {string} userId
 */
export async function listTasksForUser(userId) {
	const db = getDb();
	const board = (await getPersonalBoardForUser(db, userId)) ?? (await getFirstBoardForUser(db, userId));

	if (!board) {
		return [];
	}

	const taskRows = await db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.boardId, board.id), isNull(schema.tasks.deletedAt)))
		.orderBy(asc(schema.tasks.position), asc(schema.tasks.createdAt));

	if (taskRows.length === 0) {
		return [];
	}

	const checklistRows = await db
		.select()
		.from(schema.checklistItems)
		.where(inArray(schema.checklistItems.taskId, taskRows.map((task) => task.id)))
		.orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.createdAt));

	return mapTaskRowsToClientTasks(taskRows, checklistRows);
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function createTaskForUser(userId, payload) {
	const db = getDb();
	const input = parseCreateTaskInput(payload);
	const board = await getOrCreatePersonalBoardForUser(db, userId);
	let status = input.status;
	if (input.parentId) {
		const parent = await getWritableParentTask(db, board.id, input.parentId);
		if (!parent) {
			throw new TaskWriteError('Parent task was not found on this board.');
		}
		status = parent.status;
	}

	const now = new Date();
	const [created] = await db
		.insert(schema.tasks)
		.values({
			boardId: board.id,
			parentTaskId: input.parentId,
			title: input.title,
			status,
			priority: input.priority,
			urgency: input.urgency,
			category: input.category,
			startDate: input.startDate,
			endDate: input.endDate,
			position: String(now.getTime()),
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			completedAt: status === 'done' ? now : null,
			deletedAt: null
		})
		.returning();

	if (!created) {
		throw new TaskWriteError('Task could not be created.', 500);
	}

	return mapTaskRowsToClientTasks([created], [])[0];
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 */
async function getFirstBoardForUser(db, userId) {
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
async function getOrCreatePersonalBoardForUser(db, userId) {
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
async function getPersonalBoardForUser(db, userId) {
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

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} boardId
 * @param {string} parentId
 */
async function getWritableParentTask(db, boardId, parentId) {
	const [parent] = await db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.id, parentId), eq(schema.tasks.boardId, boardId), isNull(schema.tasks.deletedAt)))
		.orderBy(desc(schema.tasks.createdAt))
		.limit(1);

	return parent ?? null;
}
