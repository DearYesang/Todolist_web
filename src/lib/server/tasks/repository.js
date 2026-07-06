import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import {
	findOrCreateCategoryRow,
	getCategoryRowForBoard,
	normalizeCategoryKey
} from '$lib/server/categories/category-service.js';
import { planTaskImport } from './import-planner.js';
import { attachCategoryMetaToTaskRow, mapTaskRowToClientTask, mapTaskRowsToClientTasks } from './task-mapper.js';
import {
	assertValidTaskDateRange,
	parseBoardPreferencesInput,
	parseChecklistItemIdParam,
	parseCreateTaskInput,
	parseCreateChecklistItemInput,
	parseDeleteTaskInput,
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
 * @param {string} userId
 * @param {unknown} payload
 */
export async function importTasksForUser(userId, payload) {
	const { plans, summary } = planTaskImport(payload);
	if (plans.length === 0) {
		return { tasks: [], summary };
	}

	const db = getDb();
	const board = await getOrCreatePersonalBoardForUser(db, userId);
	const now = new Date();
	const categoriesByKey = await ensureCategoriesForImportPlans(db, board.id, userId, plans);
	const taskValues = createImportTaskValues(plans, board.id, userId, now, categoriesByKey);
	const checklistValues = createImportChecklistValues(plans, now);
	const [createdTaskRows, createdChecklistRows = []] = await db.batch([
		db
			.insert(schema.tasks)
			.values(taskValues)
			.returning(),
		...(checklistValues.length > 0
			? [db.insert(schema.checklistItems).values(checklistValues).returning()]
			: [])
	]);

	return {
		tasks: mapTaskRowsToClientTasks(attachImportCategoryRows(createdTaskRows, categoriesByKey), createdChecklistRows),
		summary
	};
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function replaceTasksForUser(userId, payload) {
	const { plans, summary } = planTaskImport(payload);
	const db = getDb();
	const board = await getOrCreatePersonalBoardForUser(db, userId);
	const now = new Date();
	const retireExistingTasks = db
		.update(schema.tasks)
		.set({
			deletedAt: now,
			updatedAt: now,
			version: sql`${schema.tasks.version} + 1`
		})
		.where(and(eq(schema.tasks.boardId, board.id), isNull(schema.tasks.deletedAt)))
		.returning({ id: schema.tasks.id });

	if (plans.length === 0) {
		const [retiredRows] = await db.batch([retireExistingTasks]);
		return {
			tasks: [],
			summary: {
				...summary,
				replacedTasks: retiredRows.length
			}
		};
	}

	const categoriesByKey = await ensureCategoriesForImportPlans(db, board.id, userId, plans);
	const taskValues = createImportTaskValues(plans, board.id, userId, now, categoriesByKey);
	const checklistValues = createImportChecklistValues(plans, now);
	const [retiredRows, createdTaskRows, createdChecklistRows = []] = await db.batch([
		retireExistingTasks,
		db
			.insert(schema.tasks)
			.values(taskValues)
			.returning(),
		...(checklistValues.length > 0
			? [db.insert(schema.checklistItems).values(checklistValues).returning()]
			: [])
	]);

	return {
		tasks: mapTaskRowsToClientTasks(attachImportCategoryRows(createdTaskRows, categoriesByKey), createdChecklistRows),
		summary: {
			...summary,
			replacedTasks: retiredRows.length
		}
	};
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {string} userId
 * @param {ReturnType<typeof planTaskImport>['plans']} plans
 * @returns {Promise<Map<string, typeof schema.categories.$inferSelect>>}
 */
async function ensureCategoriesForImportPlans(db, boardId, userId, plans) {
	/** @type {Map<string, typeof schema.categories.$inferSelect>} */
	const categoriesByKey = new Map();
	const categoryNames = [...new Set(plans
		.map((plan) => plan.task.category)
		.filter((category) => category.trim())
		.map((category) => normalizeCategoryKey(category)))];

	for (const key of categoryNames) {
		const sourceName = plans.find((plan) => normalizeCategoryKey(plan.task.category) === key)?.task.category ?? key;
		const category = await findOrCreateCategoryRow(db, { boardId, userId, name: sourceName });
		if (category) {
			categoriesByKey.set(key, category);
		}
	}

	return categoriesByKey;
}

/**
 * @param {(typeof schema.tasks.$inferSelect)[]} taskRows
 * @param {Map<string, typeof schema.categories.$inferSelect>} categoriesByKey
 */
function attachImportCategoryRows(taskRows, categoriesByKey) {
	const categoriesById = new Map([...categoriesByKey.values()].map((category) => [category.id, category]));
	return taskRows.map((task) => attachCategoryMetaToTaskRow(task, task.categoryId ? categoriesById.get(task.categoryId) ?? null : null));
}

/**
 * @param {ReturnType<typeof planTaskImport>['plans']} plans
 * @param {string} boardId
 * @param {string} userId
 * @param {Date} now
 * @param {Map<string, typeof schema.categories.$inferSelect>} categoriesByKey
 */
function createImportTaskValues(plans, boardId, userId, now, categoriesByKey) {
	return plans.map((plan, index) => {
		const category = categoriesByKey.get(normalizeCategoryKey(plan.task.category));
		return {
			id: plan.id,
			boardId,
			parentTaskId: plan.parentTaskId,
			title: plan.task.text.trim(),
			status: plan.task.status,
			priority: plan.task.priority,
			urgency: plan.task.urgency,
			category: category?.name ?? '',
			categoryId: category?.id ?? null,
			startDate: plan.task.startDate,
			endDate: plan.task.endDate,
			position: createPositionValue(now, index),
			version: 1,
			createdBy: userId,
			createdAt: new Date(plan.task.createdAt),
			updatedAt: now,
			completedAt: plan.task.status === 'done' ? now : null,
			deletedAt: null
		};
	});
}

/**
 * @param {ReturnType<typeof planTaskImport>['plans']} plans
 * @param {Date} now
 */
function createImportChecklistValues(plans, now) {
	return plans.flatMap((plan) =>
		plan.checklistItems.map((item, index) => ({
			id: item.id,
			taskId: plan.id,
			text: item.text,
			done: item.done,
			position: createPositionValue(now, index),
			createdAt: now,
			updatedAt: now
		}))
	);
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
	if (hasField(input, 'categoryId')) {
		if (typeof input.categoryId !== 'string') {
			return { id: null, name: '' };
		}

		const category = await getCategoryRowForBoard(db, boardId, input.categoryId);
		if (!category) {
			throw new TaskWriteError('Category was not found on this board.');
		}
		return category;
	}

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

	const checklistRows = await getChecklistRowsForTask(db, updated.id);
	const categoryRow = updated.categoryId ? await getCategoryRowForBoard(db, updated.boardId, updated.categoryId, { includeArchived: true }) : null;
	return mapTaskRowToClientTask(attachCategoryMetaToTaskRow(updated, categoryRow), checklistRows);
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

	return mapTaskRowToClientTask(bumpedRows[0] ?? task, await getChecklistRowsForTask(db, task.id));
}

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

	return mapTaskRowToClientTask(bumpedRows[0] ?? task, await getChecklistRowsForTask(db, task.id));
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

	return mapTaskRowToClientTask(bumpedRows[0] ?? task, await getChecklistRowsForTask(db, task.id));
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
 * @param {Record<string, unknown>} source
 * @param {string} field
 */
function hasField(source, field) {
	return Object.prototype.hasOwnProperty.call(source, field);
}
