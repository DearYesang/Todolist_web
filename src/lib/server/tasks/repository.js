import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { mapTaskRowsToClientTasks } from './task-mapper.js';
import { parseCreateTaskInput, TaskWriteError } from './validation.js';

/**
 * @param {string} userId
 */
export async function listTasksForUser(userId) {
	const db = getDb();
	const board = await getFirstBoardForUser(db, userId);

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
	const board = await getFirstBoardForUser(db, userId);
	if (!board) {
		throw new TaskWriteError('A workspace board is required before tasks can be created.', 409);
	}

	const input = parseCreateTaskInput(payload);
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
