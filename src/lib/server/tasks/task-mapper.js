/**
 * @typedef {typeof import('$lib/server/db/schema.js').tasks.$inferSelect} TaskRow
 * @typedef {typeof import('$lib/server/db/schema.js').checklistItems.$inferSelect} ChecklistItemRow
 */

/**
 * @param {TaskRow[]} taskRows
 * @param {ChecklistItemRow[]} checklistRows
 * @returns {import('$lib/shared/task-domain.js').Task[]}
 */
export function mapTaskRowsToClientTasks(taskRows, checklistRows) {
	const checklistByTask = groupChecklistRows(checklistRows);

	return normalizeTaskList(taskRows.map((task) => ({
		id: task.id,
		text: task.title,
		status: task.status,
		startDate: task.startDate,
		endDate: task.endDate,
		priority: task.priority,
		urgency: task.urgency,
		category: task.category,
		parentId: task.parentTaskId,
		subtasks: checklistByTask[task.id] ?? [],
		collapsed: false,
		createdAt: toTimestamp(task.createdAt)
	})));
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
import { normalizeTaskList } from '$lib/shared/task-domain.js';
