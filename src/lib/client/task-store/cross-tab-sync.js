import { isServerId } from '../../shared/task-rules.js';
import { normalizeTaskList } from '../../shared/task-domain.js';
import { getTaskStorageKey, runWithoutPersisting, tasks } from './task-cache.js';
import { hasPendingTaskSync } from './sync-engine.js';

/**
 * Applies another tab's persisted task list so concurrent tabs converge on the
 * same cache instead of clobbering each other on their next write.
 * @param {{ key: string | null; newValue: string | null }} event
 */
export function handleExternalTaskStorageEvent(event) {
	if (!event || event.key !== getTaskStorageKey()) {
		return;
	}

	try {
		const parsed = event.newValue ? JSON.parse(event.newValue) : [];
		if (!Array.isArray(parsed)) {
			return;
		}

		const external = normalizeTaskList(parsed);
		runWithoutPersisting(() => {
			tasks.update((current) => {
				const currentById = new Map(current.map((task) => [task.id, task]));
				const externalIds = new Set(external.map((task) => task.id));
				// The other tab's cache may predate this tab's latest writes:
				// keep tasks with pending sync work and local-only tasks whose
				// creates still sit in this tab's offline queue.
				const merged = external.map((task) => {
					const existing = currentById.get(task.id);
					if (!existing) {
						return task;
					}
					if (hasPendingTaskSync(task.id)) {
						return existing;
					}
					return typeof existing.version === 'number'
						&& typeof task.version === 'number'
						&& task.version < existing.version
						? existing
						: task;
				});
				const keptFromCurrent = current.filter(
					(task) => !externalIds.has(task.id) && (!isServerId(task.id) || hasPendingTaskSync(task.id))
				);

				return normalizeTaskList([...merged, ...keptFromCurrent]);
			});
		});
	} catch (error) {
		console.error('Failed to apply cross-tab task update', error);
	}
}

/**
 * @param {{ addEventListener?: Function; removeEventListener?: Function }} [target]
 * @returns {() => void}
 */
export function setupCrossTabTaskSync(target = /** @type {any} */ (globalThis)) {
	const addEventListener = target?.addEventListener;
	const removeEventListener = target?.removeEventListener;
	if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
		return () => {};
	}

	/** @param {StorageEvent} event */
	const listener = (event) => handleExternalTaskStorageEvent(event);
	addEventListener.call(target, 'storage', listener);
	return () => removeEventListener.call(target, 'storage', listener);
}
