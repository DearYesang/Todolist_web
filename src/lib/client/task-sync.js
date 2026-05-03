import { listServerTasks } from './task-api.js';
import { mergeTasks } from './task-store.js';

/**
 * @param {typeof fetch} [fetcher]
 */
export async function syncServerTasks(fetcher = globalThis.fetch) {
	const result = await listServerTasks(fetcher);
	if (result.ok && result.tasks.length > 0) {
		mergeTasks(result.tasks);
	}

	return result;
}
