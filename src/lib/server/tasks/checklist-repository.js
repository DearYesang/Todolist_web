import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { createPositionValue, getWritableTaskForUser, loadClientTask } from './task-rows.js';
import {
	parseChecklistItemIdParam,
	parseCreateChecklistItemInput,
	parseTaskIdParam,
	parseUpdateChecklistItemInput,
	TaskWriteError
} from './validation.js';

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
	// Batched statements run in one transaction, so the version bump can no
	// longer be lost after the item write succeeds.
	const [createdRows, bumpedRows] = await db.batch([
		db
			.insert(schema.checklistItems)
			.values({
				taskId: task.id,
				text: input.text,
				done: false,
				position: createPositionValue(now),
				createdAt: now,
				updatedAt: now
			})
			.returning(),
		buildTaskVersionBump(db, task.id, now)
	]);

	if (createdRows.length === 0) {
		throw new TaskWriteError('Checklist item could not be created.', 500);
	}

	return loadClientTask(db, bumpedRows[0] ?? task);
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

	const now = new Date();
	// The bump runs first inside the batch transaction, gated on the item
	// existing, so a missing item changes nothing and both writes commit
	// together when it does exist.
	const [bumpedRows, updatedRows] = await db.batch([
		buildTaskVersionBump(db, task.id, now, { requireChecklistItemId: checklistItemId }),
		db
			.update(schema.checklistItems)
			.set({
				...(typeof input.text === 'string' ? { text: input.text } : {}),
				...(typeof input.done === 'boolean' ? { done: input.done } : {}),
				updatedAt: now
			})
			.where(and(eq(schema.checklistItems.id, checklistItemId), eq(schema.checklistItems.taskId, task.id)))
			.returning()
	]);

	if (updatedRows.length === 0) {
		throw new TaskWriteError('Checklist item was not found.', 404);
	}

	return loadClientTask(db, bumpedRows[0] ?? task);
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

	const now = new Date();
	const [bumpedRows, deletedRows] = await db.batch([
		buildTaskVersionBump(db, task.id, now, { requireChecklistItemId: checklistItemId }),
		db
			.delete(schema.checklistItems)
			.where(and(eq(schema.checklistItems.id, checklistItemId), eq(schema.checklistItems.taskId, task.id)))
			.returning({ id: schema.checklistItems.id })
	]);

	if (deletedRows.length === 0) {
		throw new TaskWriteError('Checklist item was not found.', 404);
	}

	return loadClientTask(db, bumpedRows[0] ?? task);
}

/**
 * Version-bump statement for use inside a db.batch transaction. When
 * requireChecklistItemId is set, the bump is gated on that item existing at
 * statement time — place it BEFORE the item mutation in the batch so a
 * missing item leaves the version untouched instead of spuriously bumping.
 * Exported for SQL-render regression tests.
 * @param {ReturnType<typeof getDb>} db
 * @param {string} taskId
 * @param {Date} now
 * @param {{ requireChecklistItemId?: string }} [options]
 */
export function buildTaskVersionBump(db, taskId, now, options = {}) {
	return db
		.update(schema.tasks)
		.set({
			updatedAt: now,
			version: sql`${schema.tasks.version} + 1`
		})
		.where(and(
			eq(schema.tasks.id, taskId),
			isNull(schema.tasks.deletedAt),
			...(options.requireChecklistItemId
				? [sql`exists (
					select 1 from ${schema.checklistItems}
					where ${schema.checklistItems.id} = ${options.requireChecklistItemId}
						and ${schema.checklistItems.taskId} = ${taskId}
				)`]
				: [])
		))
		.returning();
}
