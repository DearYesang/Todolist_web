import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { mapTaskRowsToClientTasks } from './task-mapper.js';

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
