import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { findOrCreateCategoryRow } from '$lib/server/categories/category-service.js';
import { normalizeCategoryKey } from '$lib/shared/category-suggestions.js';
import { getOrCreatePersonalBoardForUser } from './board-provisioning.js';
import { planTaskImport } from './import-planner.js';
import { attachCategoryMetaToTaskRow, mapTaskRowsToClientTasks } from './task-mapper.js';
import { createPositionValue } from './task-rows.js';

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
