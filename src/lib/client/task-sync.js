import { getBoardPreferences, listServerTasks } from './task-api.js';
import { listServerCategories } from './category-api.js';
import { flushOfflineWriteQueue } from './offline-write-queue.js';
import {
	applyServerCategoryCatalog,
	applyServerDefaultView,
	applyServerTaskResults,
	applyServerTaskSnapshot,
	mergeTasks,
	removeTasksByIds,
	replaceLocalTaskWithServerTask,
	replaceTasks,
	waitForPendingTaskSyncs
} from './task-store.js';

/**
 * @param {typeof fetch} [fetcher]
 */
export async function syncServerTasks(fetcher = globalThis.fetch) {
	await waitForPendingTaskSyncs();
	const flushed = await flushOfflineWriteQueue(fetcher);
	if (flushed.createdTasks.length > 0) {
		flushed.createdTasks.forEach((created) => {
			replaceLocalTaskWithServerTask(created.localTaskId, created.task);
		});
	}
	if (flushed.syncedTasks.length > 0) {
		applyServerTaskResults(flushed.syncedTasks);
	}
	if (flushed.completedImports.length > 0) {
		flushed.completedImports.forEach((importResult) => {
			if (importResult.mode === 'replace') {
				replaceTasks(importResult.tasks);
				return;
			}

			removeTasksByIds(importResult.localTaskIds);
			mergeTasks(importResult.tasks);
		});
	}
	if (flushed.conflicts.length > 0) {
		console.warn(`Dropped ${flushed.conflicts.length} offline mutations that conflicted with server state.`);
	}

	if (flushed.blocked || flushed.remaining > 0) {
		// The snapshot treats server state as authoritative; applying it while
		// mutations are still queued would visually revert those local edits.
		return {
			ok: /** @type {false} */ (false),
			fallback: true,
			status: 0,
			message: 'Offline mutations are still pending, so the server snapshot was skipped.',
			offlineConflicts: flushed.conflicts
		};
	}

	const result = await listServerTasks(fetcher);
	if (result.ok) {
		applyServerTaskSnapshot(result.tasks);
		const categories = await listServerCategories(fetcher);
		if (categories.ok) {
			applyServerCategoryCatalog(categories.categories);
		}
		const preferences = await getBoardPreferences(fetcher);
		if (preferences.ok) {
			applyServerDefaultView(preferences.defaultView);
		}
	}

	return { ...result, offlineConflicts: flushed.conflicts };
}
