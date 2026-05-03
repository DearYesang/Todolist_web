import { randomUUID } from 'node:crypto';
import { extractBackupTasks } from '$lib/shared/task-backup.js';
import { normalizeTaskList } from '$lib/shared/task-domain.js';
import { TaskWriteError } from './validation.js';

const MAX_IMPORT_TASKS = 500;
const MAX_IMPORT_CHECKLIST_ITEMS = 2500;

/**
 * @typedef {{
 *   oldId: string;
 *   id: string;
 *   task: import('$lib/shared/task-domain.js').Task;
 *   parentTaskId: string | null;
 *   checklistItems: {
 *     oldId: string;
 *     id: string;
 *     text: string;
 *     done: boolean;
 *   }[];
 * }} PlannedTaskImport
 *
 * @typedef {{
 *   receivedTasks: number;
 *   importedTasks: number;
 *   skippedTasks: number;
 *   importedChecklistItems: number;
 *   skippedChecklistItems: number;
 *   repairedParentLinks: number;
 * }} TaskImportSummary
 */

/**
 * @param {unknown} payload
 * @param {{ idFactory?: () => string }} [options]
 * @returns {{ plans: PlannedTaskImport[]; summary: TaskImportSummary }}
 */
export function planTaskImport(payload, options = {}) {
	const rawTasks = extractBackupTasks(payload);
	if (!rawTasks) {
		throw new TaskWriteError('Import payload must be an array of tasks or a backup object with a tasks array.');
	}

	if (rawTasks.length > MAX_IMPORT_TASKS) {
		throw new TaskWriteError(`Import payload must contain ${MAX_IMPORT_TASKS} tasks or less.`);
	}

	const idFactory = options.idFactory ?? randomUUID;
	const normalized = normalizeTaskList(rawTasks);
	const importableTasks = normalized.filter((task) => task.text.trim());
	const importedTaskIds = new Set(importableTasks.map((task) => task.id));
	const idMap = new Map(importableTasks.map((task) => [task.id, idFactory()]));
	const orderedTasks = sortByParentDepth(importableTasks);
	let repairedParentLinks = 0;
	let importedChecklistItems = 0;
	let skippedChecklistItems = 0;

	const plans = orderedTasks.map((task) => {
		const parentTaskId = task.parentId && importedTaskIds.has(task.parentId)
			? idMap.get(task.parentId) ?? null
			: null;
		if (task.parentId && !parentTaskId) {
			repairedParentLinks += 1;
		}

		const checklistItems = task.subtasks
			.filter((subtask) => {
				if (subtask.text.trim()) {
					return true;
				}

				skippedChecklistItems += 1;
				return false;
			})
			.map((subtask) => ({
				oldId: subtask.id,
				id: idFactory(),
				text: subtask.text.trim(),
				done: subtask.done
			}));
		importedChecklistItems += checklistItems.length;

		return {
			oldId: task.id,
			id: idMap.get(task.id) ?? idFactory(),
			task,
			parentTaskId,
			checklistItems
		};
	});

	if (importedChecklistItems > MAX_IMPORT_CHECKLIST_ITEMS) {
		throw new TaskWriteError(`Import payload must contain ${MAX_IMPORT_CHECKLIST_ITEMS} checklist items or less.`);
	}

	return {
		plans,
		summary: {
			receivedTasks: rawTasks.length,
			importedTasks: plans.length,
			skippedTasks: normalized.length - plans.length,
			importedChecklistItems,
			skippedChecklistItems,
			repairedParentLinks
		}
	};
}

/**
 * @param {import('$lib/shared/task-domain.js').Task[]} tasks
 */
function sortByParentDepth(tasks) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const depthCache = new Map();

	/**
	 * @param {import('$lib/shared/task-domain.js').Task} task
	 * @param {Set<string>} [seen]
	 * @returns {number}
	 */
	function getDepth(task, seen = new Set()) {
		const cached = depthCache.get(task.id);
		if (typeof cached === 'number') {
			return cached;
		}

		if (!task.parentId || seen.has(task.id)) {
			depthCache.set(task.id, 0);
			return 0;
		}

		const parent = byId.get(task.parentId);
		if (!parent) {
			depthCache.set(task.id, 0);
			return 0;
		}

		seen.add(task.id);
		const depth = getDepth(parent, seen) + 1;
		depthCache.set(task.id, depth);
		return depth;
	}

	return [...tasks].sort((left, right) => getDepth(left) - getDepth(right));
}
