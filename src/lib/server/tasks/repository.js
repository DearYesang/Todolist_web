import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { mapTaskRowToClientTask, mapTaskRowsToClientTasks } from './task-mapper.js';
import {
	assertValidTaskDateRange,
	parseChecklistItemIdParam,
	parseCreateTaskInput,
	parseCreateChecklistItemInput,
	parseTaskIdParam,
	parseUpdateChecklistItemInput,
	parseUpdateTaskInput,
	TaskWriteError
} from './validation.js';

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

	return mapTaskRowToClientTask(created, []);
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 * @param {unknown} payload
 */
export async function updateTaskForUser(userId, taskId, payload) {
	const id = parseTaskIdParam(taskId);
	const input = parseUpdateTaskInput(payload);
	const db = getDb();
	const existing = await getWritableTaskForUser(db, userId, id);
	if (!existing) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const hasParentPatch = hasField(input, 'parentId');
	const nextStartDate = typeof input.startDate === 'string' ? input.startDate : existing.startDate;
	const nextEndDate = typeof input.endDate === 'string' ? input.endDate : existing.endDate;
	assertValidTaskDateRange(nextStartDate, nextEndDate);

	let nextStatus = typeof input.status === 'string' ? input.status : existing.status;
	let nextParentTaskId = hasParentPatch ? input.parentId : existing.parentTaskId;
	if (nextParentTaskId) {
		const parent = await getWritableParentTask(db, existing.boardId, nextParentTaskId);
		if (!parent || !(await canAssignParentTask(db, existing.boardId, existing.id, nextParentTaskId))) {
			throw new TaskWriteError('Parent task was not found on this board.');
		}

		nextStatus = parent.status;
	} else if (!hasParentPatch && typeof input.status === 'string' && existing.parentTaskId) {
		const parent = await getWritableParentTask(db, existing.boardId, existing.parentTaskId);
		if (parent && parent.status !== nextStatus) {
			nextParentTaskId = null;
		}
	}

	const now = new Date();
	const [updated] = await db
		.update(schema.tasks)
		.set({
			title: typeof input.title === 'string' ? input.title : existing.title,
			status: nextStatus,
			priority: typeof input.priority === 'string' ? input.priority : existing.priority,
			urgency: typeof input.urgency === 'string' ? input.urgency : existing.urgency,
			category: typeof input.category === 'string' ? input.category : existing.category,
			startDate: nextStartDate,
			endDate: nextEndDate,
			parentTaskId: nextParentTaskId,
			updatedAt: now,
			completedAt: nextStatus === 'done' ? existing.completedAt ?? now : null
		})
		.where(and(eq(schema.tasks.id, existing.id), eq(schema.tasks.boardId, existing.boardId), isNull(schema.tasks.deletedAt)))
		.returning();

	if (!updated) {
		throw new TaskWriteError('Task could not be updated.', 500);
	}

	const checklistRows = await getChecklistRowsForTask(db, updated.id);
	return mapTaskRowToClientTask(updated, checklistRows);
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 */
export async function deleteTaskCascadeForUser(userId, taskId) {
	const id = parseTaskIdParam(taskId);
	const db = getDb();
	const task = await getWritableTaskForUser(db, userId, id);
	if (!task) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const boardTaskRows = await db
		.select({
			id: schema.tasks.id,
			parentTaskId: schema.tasks.parentTaskId
		})
		.from(schema.tasks)
		.where(and(eq(schema.tasks.boardId, task.boardId), isNull(schema.tasks.deletedAt)));
	const taskIds = [...collectDescendantTaskIds(boardTaskRows, id)];
	const now = new Date();

	const deletedRows = await db
		.update(schema.tasks)
		.set({
			deletedAt: now,
			updatedAt: now
		})
		.where(and(eq(schema.tasks.boardId, task.boardId), inArray(schema.tasks.id, taskIds), isNull(schema.tasks.deletedAt)))
		.returning({ id: schema.tasks.id });

	return deletedRows.length;
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 * @param {unknown} payload
 */
export async function createChecklistItemForUser(userId, taskId, payload) {
	const id = parseTaskIdParam(taskId);
	const input = parseCreateChecklistItemInput(payload);
	const db = getDb();
	const task = await getWritableTaskForUser(db, userId, id);
	if (!task) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const now = new Date();
	const [created] = await db
		.insert(schema.checklistItems)
		.values({
			taskId: task.id,
			text: input.text,
			done: false,
			position: String(now.getTime()),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (!created) {
		throw new TaskWriteError('Checklist item could not be created.', 500);
	}

	return mapTaskRowToClientTask(task, await getChecklistRowsForTask(db, task.id));
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 * @param {unknown} itemId
 * @param {unknown} payload
 */
export async function updateChecklistItemForUser(userId, taskId, itemId, payload) {
	const id = parseTaskIdParam(taskId);
	const checklistItemId = parseChecklistItemIdParam(itemId);
	const input = parseUpdateChecklistItemInput(payload);
	const db = getDb();
	const task = await getWritableTaskForUser(db, userId, id);
	if (!task) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const [updated] = await db
		.update(schema.checklistItems)
		.set({
			...(typeof input.text === 'string' ? { text: input.text } : {}),
			...(typeof input.done === 'boolean' ? { done: input.done } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(schema.checklistItems.id, checklistItemId), eq(schema.checklistItems.taskId, task.id)))
		.returning();

	if (!updated) {
		throw new TaskWriteError('Checklist item was not found.', 404);
	}

	return mapTaskRowToClientTask(task, await getChecklistRowsForTask(db, task.id));
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 * @param {unknown} itemId
 */
export async function deleteChecklistItemForUser(userId, taskId, itemId) {
	const id = parseTaskIdParam(taskId);
	const checklistItemId = parseChecklistItemIdParam(itemId);
	const db = getDb();
	const task = await getWritableTaskForUser(db, userId, id);
	if (!task) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const [deleted] = await db
		.delete(schema.checklistItems)
		.where(and(eq(schema.checklistItems.id, checklistItemId), eq(schema.checklistItems.taskId, task.id)))
		.returning({ id: schema.checklistItems.id });

	if (!deleted) {
		throw new TaskWriteError('Checklist item was not found.', 404);
	}

	return mapTaskRowToClientTask(task, await getChecklistRowsForTask(db, task.id));
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
 * @param {string} taskId
 */
async function getWritableTaskForUser(db, userId, taskId) {
	const memberships = await db
		.select({ workspaceId: schema.workspaceMembers.workspaceId })
		.from(schema.workspaceMembers)
		.where(eq(schema.workspaceMembers.userId, userId));

	if (memberships.length === 0) {
		return null;
	}

	const userBoards = await db
		.select({ id: schema.boards.id })
		.from(schema.boards)
		.where(inArray(schema.boards.workspaceId, memberships.map((membership) => membership.workspaceId)));

	if (userBoards.length === 0) {
		return null;
	}

	const [task] = await db
		.select()
		.from(schema.tasks)
		.where(and(
			eq(schema.tasks.id, taskId),
			inArray(schema.tasks.boardId, userBoards.map((board) => board.id)),
			isNull(schema.tasks.deletedAt)
		))
		.limit(1);

	return task ?? null;
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} taskId
 */
async function getChecklistRowsForTask(db, taskId) {
	return db
		.select()
		.from(schema.checklistItems)
		.where(eq(schema.checklistItems.taskId, taskId))
		.orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.createdAt));
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

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string} boardId
 * @param {string} taskId
 * @param {string} parentId
 */
async function canAssignParentTask(db, boardId, taskId, parentId) {
	if (taskId === parentId) {
		return false;
	}

	const rows = await db
		.select({
			id: schema.tasks.id,
			parentTaskId: schema.tasks.parentTaskId
		})
		.from(schema.tasks)
		.where(and(eq(schema.tasks.boardId, boardId), isNull(schema.tasks.deletedAt)));
	const byId = new Map(rows.map((task) => [task.id, task]));
	const visited = new Set([taskId]);
	/** @type {string | null} */
	let currentId = parentId;

	while (currentId) {
		if (visited.has(currentId)) {
			return false;
		}

		visited.add(currentId);
		const current = byId.get(currentId);
		if (!current) {
			return false;
		}

		currentId = current.parentTaskId;
	}

	return true;
}

/**
 * @param {{ id: string; parentTaskId: string | null }[]} taskRows
 * @param {string} taskId
 */
function collectDescendantTaskIds(taskRows, taskId) {
	const ids = new Set([taskId]);
	let foundNewChild = true;

	while (foundNewChild) {
		foundNewChild = false;
		taskRows.forEach((task) => {
			if (task.parentTaskId && ids.has(task.parentTaskId) && !ids.has(task.id)) {
				ids.add(task.id);
				foundNewChild = true;
			}
		});
	}

	return ids;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} field
 */
function hasField(source, field) {
	return Object.prototype.hasOwnProperty.call(source, field);
}
