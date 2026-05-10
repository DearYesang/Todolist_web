import { normalizeTask, normalizeTaskList } from '$lib/shared/task-domain.js';
import { mapCategoryRowToClientCategory } from '$lib/server/categories/category-service.js';

/**
 * @typedef {typeof import('$lib/server/db/schema.js').tasks.$inferSelect} TaskRow
 * @typedef {typeof import('$lib/server/db/schema.js').categories.$inferSelect} CategoryRow
 * @typedef {typeof import('$lib/server/db/schema.js').checklistItems.$inferSelect} ChecklistItemRow
 * @typedef {TaskRow & { categoryMeta?: import('$lib/shared/task-domain.js').TaskCategoryMeta | null }} TaskRowWithCategoryMeta
 */

/**
 * @param {TaskRow} taskRow
 * @param {CategoryRow | null} categoryRow
 * @returns {TaskRowWithCategoryMeta}
 */
export function attachCategoryMetaToTaskRow(taskRow, categoryRow) {
	return {
		...taskRow,
		categoryMeta: categoryRow ? mapCategoryRowToClientCategory(categoryRow) : null
	};
}

/**
 * @param {TaskRowWithCategoryMeta[]} taskRows
 * @param {ChecklistItemRow[]} checklistRows
 * @returns {import('$lib/shared/task-domain.js').Task[]}
 */
export function mapTaskRowsToClientTasks(taskRows, checklistRows) {
	const checklistByTask = groupChecklistRows(checklistRows);

	return normalizeTaskList(taskRows.map((task) => mapTaskRowToRawTask(task, checklistByTask[task.id] ?? [])));
}

/**
 * @param {TaskRowWithCategoryMeta} taskRow
 * @param {ChecklistItemRow[]} checklistRows
 * @returns {import('$lib/shared/task-domain.js').Task}
 */
export function mapTaskRowToClientTask(taskRow, checklistRows = []) {
	return normalizeTask(mapTaskRowToRawTask(taskRow, groupChecklistRows(checklistRows)[taskRow.id] ?? []));
}

/**
 * @param {TaskRowWithCategoryMeta} task
 * @param {import('$lib/shared/task-domain.js').Subtask[]} subtasks
 */
function mapTaskRowToRawTask(task, subtasks) {
	const categoryMeta = task.categoryMeta ?? null;
	return {
		id: task.id,
		text: task.title,
		status: task.status,
		startDate: task.startDate,
		endDate: task.endDate,
		priority: task.priority,
		urgency: task.urgency,
		category: categoryMeta?.name ?? task.category,
		categoryId: task.categoryId ?? categoryMeta?.id ?? null,
		categoryMeta,
		parentId: task.parentTaskId,
		subtasks,
		collapsed: false,
		createdAt: toTimestamp(task.createdAt),
		version: task.version
	};
}

/**
 * @param {ChecklistItemRow[]} rows
 * @returns {Record<string, import('$lib/shared/task-domain.js').Subtask[]>}
 */
function groupChecklistRows(rows) {
	/** @type {Record<string, import('$lib/shared/task-domain.js').Subtask[]>} */
	const grouped = {};

	for (const row of rows) {
		grouped[row.taskId] ??= [];
		grouped[row.taskId].push({
			id: row.id,
			text: row.text,
			done: row.done
		});
	}

	return grouped;
}

/**
 * @param {Date | string | number} value
 */
function toTimestamp(value) {
	if (value instanceof Date) {
		return value.getTime();
	}

	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : Date.now();
}
