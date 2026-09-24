import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';

/**
 * PostgreSQL numeric(20,10) allows 10 integer digits. Millisecond timestamps are
 * already 13 digits, so store second-based sortable positions instead.
 *
 * @param {Date} now
 * @param {number} [offset]
 */
export function createPositionValue(now, offset = 0) {
	const seconds = Math.floor(now.getTime() / 1000);
	return (seconds + offset / 1000).toFixed(3);
}

/**
 * The authorization read behind task updates and deletes and every checklist
 * write: the live task, only when it sits on a board of a workspace the user
 * belongs to.
 * @param {ReturnType<typeof getDb>} db
 * @param {string} userId
 * @param {string} taskId
 */
export async function getWritableTaskForUser(db, userId, taskId) {
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
export async function getChecklistRowsForTask(db, taskId) {
	return db
		.select()
		.from(schema.checklistItems)
		.where(eq(schema.checklistItems.taskId, taskId))
		.orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.createdAt));
}
