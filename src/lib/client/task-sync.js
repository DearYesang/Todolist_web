import { listServerTasks } from './task-api.js';
import { flushOfflineWriteQueue } from './offline-write-queue.js';
import { applyServerTaskSnapshot, mergeTasks, replaceLocalTaskWithServerTask } from './task-store.js';

/**
 * @param {typeof fetch} [fetcher]
 */
export async function syncServerTasks(fetcher = globalThis.fetch) {
	const flushed = await flushOfflineWriteQueue(fetcher);
	if (flushed.createdTasks.length > 0) {
		flushed.createdTasks.forEach((created) => {
			replaceLocalTaskWithServerTask(created.localTaskId, created.task);
		});
	}
	if (flushed.syncedTasks.length > 0) {
		mergeTasks(flushed.syncedTasks);
	}
	if (flushed.conflicts.length > 0) {
		console.warn(`Dropped ${flushed.conflicts.length} offline mutations that conflicted with server state.`);
	}

	const result = await listServerTasks(fetcher);
	if (result.ok) {
		applyServerTaskSnapshot(result.tasks);
	}

	return { ...result, offlineConflicts: flushed.conflicts };
}
