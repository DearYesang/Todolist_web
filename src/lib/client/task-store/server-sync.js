import { getBoardPreferences, listServerTasks } from '../task-api.js';
import { listServerCategories } from '../category-api.js';
import { flushOfflineWriteQueue } from '../offline-write-queue.js';
import { normalizeTaskList } from '../../shared/task-domain.js';
import {
	countLocalTaskCacheClears,
	getTaskStorageOwner,
	mergeIntoTaskList,
	mergeTasks,
	removeFromTaskList,
	removeTasksByIds,
	replaceLocalTaskInList,
	replaceLocalTaskWithServerTask,
	replaceTasks,
	updateCachedBoardOf
} from './task-cache.js';
import { applyServerDefaultView } from './view-preference.js';
import { applyServerCategoryCatalog } from './category-store.js';
import {
	applyServerTaskResults,
	applyServerTaskSnapshot,
	waitForPendingTaskSyncs
} from './sync-engine.js';

/**
 * @param {typeof fetch} [fetcher]
 */
export async function syncServerTasks(fetcher = globalThis.fetch) {
	await waitForPendingTaskSyncs();
	// The flush sends the queue of the user whose board the store holds
	// now, and stays that user's if the board goes to another user (a
	// sign-out, or another user signing in) while a request is out.
	const owner = getTaskStorageOwner();
	const cacheClears = countLocalTaskCacheClears();
	const flushed = await flushOfflineWriteQueue(fetcher);
	const cacheCleared = countLocalTaskCacheClears() !== cacheClears;
	if (getTaskStorageOwner() !== owner || cacheCleared) {
		// Its answers are about that user's board: they go to the cache the
		// board opens from at that user's next sign-in here, and stay off
		// the board the store holds now, as does the server snapshot. Its
		// conflicts are that user's too: the flush kept them in that user's
		// queue for their next sync, and none are reported to the next
		// user. After a sign-out that cleared local data meanwhile, the
		// answers go nowhere: the board is still that user's until the
		// session refetch, but its data is gone from this device, as the
		// user asked.
		if (!cacheCleared) {
			updateCachedBoardOf(owner, (taskList) => applyFlushToTaskList(taskList, flushed));
		}
		return {
			ok: /** @type {false} */ (false),
			fallback: true,
			status: 0,
			message: 'The signed-in user changed or cleared local data while offline mutations were being sent, so the sync stopped.',
			offlineConflicts: /** @type {import('../offline-write-queue.js').OfflineMutation[]} */ ([])
		};
	}

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

/**
 * A flush's answers applied to a task list that is not the store's: the
 * cached board of the user whose queue the flush sent, after the store
 * moved on to another board. These are the changes syncServerTasks makes
 * to the store, with answers to edits merged as mergeTasks does.
 * @param {import('../../shared/task-domain.js').Task[]} taskList
 * @param {import('../offline-write-queue.js').OfflineFlushResult} flushed
 */
function applyFlushToTaskList(taskList, flushed) {
	let next = taskList;
	flushed.createdTasks.forEach((created) => {
		next = replaceLocalTaskInList(next, created.localTaskId, created.task);
	});
	if (flushed.syncedTasks.length > 0) {
		next = mergeIntoTaskList(next, flushed.syncedTasks, { insertMissing: false });
	}
	flushed.completedImports.forEach((importResult) => {
		next = importResult.mode === 'replace'
			? normalizeTaskList(importResult.tasks)
			: mergeIntoTaskList(removeFromTaskList(next, importResult.localTaskIds), importResult.tasks);
	});
	return next;
}
