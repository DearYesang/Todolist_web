import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import {
	findOrCreateCategoryRow,
	getCategoryRowForBoard
} from '$lib/server/categories/category-service.js';
import {
	getFirstBoardForUser,
	getOrCreatePersonalBoardForUser,
	getPersonalBoardForUser
} from './board-provisioning.js';
import { attachCategoryMetaToTaskRow, mapTaskRowToClientTask, mapTaskRowsToClientTasks } from './task-mapper.js';
import { createPositionValue, getWritableTaskForUser, loadClientTask } from './task-rows.js';
import {
	assertValidTaskDateRange,
	parseCreateTaskInput,
	parseDeleteTaskInput,
	parseTaskIdParam,
	parseUpdateTaskInput,
	TaskWriteError
} from './validation.js';

/**
 * @param {string} userId
 */
export async function listTasksForUser(userId) {
	const db = getDb();
	const board = (await getPersonalBoardForUser(db, userId)) ?? (await getFirstBoardForUser(db, userId));

	if (!board) {
		return [];
	}

	return listTasksForBoard(board.id);
}

/**
 * @param {string} boardId
 */
export async function listTasksForBoard(boardId) {
	const db = getDb();
	const taskResults = await db
		.select({
			task: schema.tasks,
			category: schema.categories
		})
		.from(schema.tasks)
		.leftJoin(schema.categories, eq(schema.tasks.categoryId, schema.categories.id))
		.where(and(eq(schema.tasks.boardId, boardId), isNull(schema.tasks.deletedAt)))
		.orderBy(asc(schema.tasks.position), asc(schema.tasks.createdAt));

	const taskRows = taskResults.map((row) => attachCategoryMetaToTaskRow(row.task, row.category));
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
	const category = await resolveCategoryForTaskCreate(db, board.id, userId, input);
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
			category: category?.name ?? '',
			categoryId: category?.id ?? null,
			startDate: input.startDate,
			endDate: input.endDate,
			position: createPositionValue(now),
			version: 1,
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

	return mapTaskRowToClientTask(attachCategoryMetaToTaskRow(created, category), []);
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {string} userId
 * @param {ReturnType<typeof parseCreateTaskInput>} input
 */
async function resolveCategoryForTaskCreate(db, boardId, userId, input) {
	if (input.categoryId) {
		const category = await getCategoryRowForBoard(db, boardId, input.categoryId);
		if (!category) {
			throw new TaskWriteError('Category was not found on this board.');
		}
		return category;
	}

	return findOrCreateCategoryRow(db, {
		boardId,
		userId,
		name: input.category
	});
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {string} userId
 * @param {ReturnType<typeof parseUpdateTaskInput>} input
 */
async function resolveCategoryForTaskPatch(db, boardId, userId, input) {
	if (typeof input.categoryId === 'string') {
		const category = await getCategoryRowForBoard(db, boardId, input.categoryId);
		if (!category) {
			throw new TaskWriteError('Category was not found on this board.');
		}
		return category;
	}

	// Without an id the name decides. The client sends categoryId: null with
	// every task patch, also for a name it has no id for yet (typed in the task
	// panel, or renamed offline), so a null id must not clear a named category.
	// An empty or missing name still clears it.
	const category = await findOrCreateCategoryRow(db, {
		boardId,
		userId,
		name: typeof input.category === 'string' ? input.category : ''
	});
	return category ?? { id: null, name: '' };
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
	const expectedVersion = typeof input.expectedVersion === 'number' ? input.expectedVersion : null;

	const hasParentPatch = hasField(input, 'parentId');
	const hasCategoryIdPatch = hasField(input, 'categoryId');
	const hasCategoryNamePatch = hasField(input, 'category');
	const nextStartDate = typeof input.startDate === 'string' ? input.startDate : existing.startDate;
	const nextEndDate = typeof input.endDate === 'string' ? input.endDate : existing.endDate;
	assertValidTaskDateRange(nextStartDate, nextEndDate);
	const nextCategory = hasCategoryIdPatch || hasCategoryNamePatch
		? await resolveCategoryForTaskPatch(db, existing.boardId, userId, input)
		: { id: existing.categoryId, name: existing.category };

	let nextStatus = typeof input.status === 'string' ? input.status : existing.status;
	let nextParentTaskId = hasParentPatch
		? typeof input.parentId === 'string' ? input.parentId : null
		: existing.parentTaskId;
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
		.set(buildTaskPatchSet(input, existing, {
			nextStatus,
			nextParentTaskId,
			nextCategory,
			nextStartDate,
			nextEndDate,
			now
		}))
		.where(and(
			eq(schema.tasks.id, existing.id),
			eq(schema.tasks.boardId, existing.boardId),
			isNull(schema.tasks.deletedAt),
			...(expectedVersion === null ? [] : [eq(schema.tasks.version, expectedVersion)])
		))
		.returning();

	if (!updated) {
		if (expectedVersion !== null) {
			throw new TaskWriteError('Task changed on another device. Sync and try again.', 409);
		}
		// The task passed the authz read moments ago, so an unversioned update
		// matching nothing means it was deleted concurrently — a benign race.
		throw new TaskWriteError('Task was not found.', 404);
	}

	return loadClientTask(db, updated);
}

/**
 * Writing only the columns the patch actually names keeps two concurrent
 * unversioned PATCHes to different fields from overwriting each other with
 * values read before the other request committed (lost update).
 * @param {ReturnType<typeof parseUpdateTaskInput>} input
 * @param {typeof schema.tasks.$inferSelect} existing
 * @param {{
 *   nextStatus: string;
 *   nextParentTaskId: string | null;
 *   nextCategory: { id: string | null; name: string };
 *   nextStartDate: string;
 *   nextEndDate: string;
 *   now: Date;
 * }} computed
 */
export function buildTaskPatchSet(input, existing, computed) {
	/** @type {Record<string, unknown>} */
	const set = {
		updatedAt: computed.now,
		version: sql`${schema.tasks.version} + 1`
	};

	if (hasField(input, 'title')) {
		set.title = input.title;
	}
	if (hasField(input, 'startDate')) {
		set.startDate = computed.nextStartDate;
	}
	if (hasField(input, 'endDate')) {
		set.endDate = computed.nextEndDate;
	}
	if (hasField(input, 'priority')) {
		set.priority = input.priority;
	}
	if (hasField(input, 'urgency')) {
		set.urgency = input.urgency;
	}
	if (hasField(input, 'category') || hasField(input, 'categoryId')) {
		set.category = computed.nextCategory.name;
		set.categoryId = computed.nextCategory.id;
	}
	if (hasField(input, 'parentId') || computed.nextParentTaskId !== existing.parentTaskId) {
		set.parentTaskId = computed.nextParentTaskId;
	}
	if (hasField(input, 'status') || computed.nextStatus !== existing.status) {
		set.status = computed.nextStatus;
		set.completedAt = computed.nextStatus === 'done' ? existing.completedAt ?? computed.now : null;
	}

	return set;
}

/**
 * @param {string} userId
 * @param {unknown} taskId
 * @param {unknown} [payload]
 */
export async function deleteTaskCascadeForUser(userId, taskId, payload = undefined) {
	const id = parseTaskIdParam(taskId);
	const input = parseDeleteTaskInput(payload);
	const db = getDb();
	const task = await getWritableTaskForUser(db, userId, id);
	if (!task) {
		throw new TaskWriteError('Task was not found.', 404);
	}

	const now = new Date();
	const result = await db.execute(buildCascadeDeleteStatement(task, now, input.expectedVersion));
	const deletedCount = result.rows.length;
	if (input.expectedVersion !== null && deletedCount === 0) {
		throw new TaskWriteError('Task changed on another device. Sync and try again.', 409);
	}

	return deletedCount;
}

/**
 * A single recursive-CTE statement walks and soft-deletes the subtree
 * atomically, so children created or re-parented between a separate read and
 * write can no longer escape the cascade. The path array guards against
 * parent cycles in corrupt data. Exported for SQL-render regression tests.
 * @param {{ id: string; boardId: string }} task
 * @param {Date} now
 * @param {number | null} expectedVersion
 */
export function buildCascadeDeleteStatement(task, now, expectedVersion) {
	const versionGuard = expectedVersion === null
		? sql`true`
		: sql`exists (
			select 1 from ${schema.tasks} as root
			where root.id = ${task.id}
				and root.version = ${expectedVersion}
				and root.deleted_at is null
		)`;

	return sql`
		with recursive descendants (id, path) as (
			select ${schema.tasks.id}, array[${schema.tasks.id}]
			from ${schema.tasks}
			where ${schema.tasks.id} = ${task.id}
				and ${schema.tasks.boardId} = ${task.boardId}
				and ${schema.tasks.deletedAt} is null
			union all
			select child.id, descendants.path || child.id
			from ${schema.tasks} as child
			inner join descendants on child.parent_task_id = descendants.id
			where child.board_id = ${task.boardId}
				and child.deleted_at is null
				and not child.id = any(descendants.path)
		)
		update ${schema.tasks}
		set deleted_at = ${now},
			updated_at = ${now},
			version = ${schema.tasks.version} + 1
		where ${schema.tasks.id} in (select descendants.id from descendants)
			and ${schema.tasks.deletedAt} is null
			and ${versionGuard}
		returning ${schema.tasks.id}
	`;
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
 * @param {Record<string, unknown>} source
 * @param {string} field
 */
function hasField(source, field) {
	return Object.prototype.hasOwnProperty.call(source, field);
}
