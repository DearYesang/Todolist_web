import { listServerTasks } from './task-api.js';
import { flushOfflineWriteQueue } from './offline-write-queue.js';
import { mergeTasks, replaceLocalTaskWithServerTask } from './task-store.js';

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

	const result = await listServerTasks(fetcher);
	if (result.ok && result.tasks.length > 0) {
		mergeTasks(result.tasks);
	}

	return result;
}
