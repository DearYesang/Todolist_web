import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
	addSubtask,
	applyServerTaskSnapshot,
	deleteTaskCascade,
	drainPendingTaskSyncsToOfflineQueue,
	handleExternalTaskStorageEvent,
	mergeTasks,
	renameSubtask,
	replaceTasks,
	resetTaskSyncStateForTests,
	setTaskStorageOwner,
	tasks,
	updateTask,
	waitForPendingTaskSyncs
} from './task-store.js';
import {
	enqueueOfflineMutation,
	flushOfflineWriteQueue,
	loadOfflineQueue,
	setOfflineQueueOwner
} from './offline-write-queue.js';
import { syncServerTasks } from './task-sync.js';

const SERVER_TASK_ID = '11111111-1111-4111-8111-111111111111';

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function createDeferred() {
	/** @type {(value: Response) => void} */
	let resolve = () => {};
	/** @type {Promise<Response>} */
	const promise = new Promise((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function settleMicrotasks() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('sync race conditions', () => {
	/** @type {Map<string, string>} */
	let storage;

	beforeEach(() => {
		storage = new Map();
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: {
				getItem: vi.fn((key) => storage.get(key) ?? null),
				setItem: vi.fn((key, value) => {
					storage.set(key, String(value));
				}),
				removeItem: vi.fn((key) => {
					storage.delete(key);
				})
			}
		});
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {}
		});
		setTaskStorageOwner(null);
		setOfflineQueueOwner(null);
		replaceTasks([]);
	});

	afterEach(async () => {
		// A failing test can leave an unsettled request in a chain; cap the
		// wait and force-reset so one failure cannot wedge the whole file.
		await Promise.race([
			waitForPendingTaskSyncs(),
			new Promise((resolve) => setTimeout(resolve, 500))
		]);
		resetTaskSyncStateForTests();
		replaceTasks([]);
		setTaskStorageOwner(null);
		setOfflineQueueOwner(null);
		Reflect.deleteProperty(globalThis, 'fetch');
		Reflect.deleteProperty(globalThis, 'window');
		Reflect.deleteProperty(globalThis, 'localStorage');
	});

	it('coalesces rapid edits into one serialized PATCH with the current version', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3 })]);
		const deferred = createDeferred();
		/** @type {Record<string, unknown>[]} */
		const bodies = [];
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn((_url, init) => {
				bodies.push(JSON.parse(init.body));
				return deferred.promise;
			})
		});

		updateTask(SERVER_TASK_ID, { text: 'Two' });
		updateTask(SERVER_TASK_ID, { text: 'Three' });
		await settleMicrotasks();

		// Both edits ride a single serialized request built from current state.
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(bodies[0]).toMatchObject({ text: 'Three', expectedVersion: 3 });

		deferred.resolve(jsonResponse({
			task: { id: SERVER_TASK_ID, text: 'Three', version: 4 }
		}));
		await waitForPendingTaskSyncs();

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(get(tasks)[0]).toMatchObject({ text: 'Three', version: 4 });
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('sends a follow-up edit with the version returned by the previous PATCH', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3 })]);
		const first = createDeferred();
		const second = createDeferred();
		const responses = [first, second];
		/** @type {Record<string, unknown>[]} */
		const bodies = [];
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn((_url, init) => {
				bodies.push(JSON.parse(init.body));
				return responses[bodies.length - 1].promise;
			})
		});

		updateTask(SERVER_TASK_ID, { text: 'Two' });
		await settleMicrotasks();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		// A second edit lands while the first PATCH is still in flight.
		updateTask(SERVER_TASK_ID, { priority: 'high' });
		first.resolve(jsonResponse({
			task: { id: SERVER_TASK_ID, text: 'Two', priority: 'medium', version: 4 }
		}));
		await settleMicrotasks();

		// The in-flight response may only advance the version; the newer
		// optimistic edit must survive until its own PATCH runs.
		expect(get(tasks)[0]).toMatchObject({ priority: 'high', version: 4 });
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		expect(bodies[1]).toMatchObject({ priority: 'high', expectedVersion: 4 });

		second.resolve(jsonResponse({
			task: { id: SERVER_TASK_ID, text: 'Two', priority: 'high', version: 5 }
		}));
		await waitForPendingTaskSyncs();
		expect(get(tasks)[0]).toMatchObject({ priority: 'high', version: 5 });
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('deletes with the freshest version even when the task already left the store', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3 })]);
		const patchResponse = createDeferred();
		const deleteResponse = createDeferred();
		/** @type {{ method: string; body: string | undefined }[]} */
		const requests = [];
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn((_url, init) => {
				requests.push({ method: init.method, body: init.body });
				return requests.length === 1 ? patchResponse.promise : deleteResponse.promise;
			})
		});

		updateTask(SERVER_TASK_ID, { text: 'Two' });
		await settleMicrotasks();
		deleteTaskCascade(SERVER_TASK_ID);
		expect(get(tasks)).toEqual([]);

		patchResponse.resolve(jsonResponse({
			task: { id: SERVER_TASK_ID, text: 'Two', version: 4 }
		}));
		await settleMicrotasks();

		// The PATCH response must not resurrect the deleted task.
		expect(get(tasks)).toEqual([]);
		expect(requests[1]).toMatchObject({
			method: 'DELETE',
			body: JSON.stringify({ expectedVersion: 4 })
		});

		deleteResponse.resolve(jsonResponse({ deleted: 1 }));
		await waitForPendingTaskSyncs();
	});

	it('ignores out-of-order task responses with older versions', () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'Fresh', version: 5 })]);

		mergeTasks([{ id: SERVER_TASK_ID, text: 'Stale', version: 4 }]);

		expect(get(tasks)[0]).toMatchObject({ text: 'Fresh', version: 5 });
	});

	it('does not resurrect locally deleted tasks when merging sync responses', () => {
		replaceTasks([]);

		mergeTasks([{ id: SERVER_TASK_ID, text: 'Ghost', version: 2 }], { insertMissing: false });

		expect(get(tasks)).toEqual([]);
	});

	it('preserves local collapse state when merging server responses', () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3, collapsed: true })]);

		mergeTasks([{ id: SERVER_TASK_ID, text: 'Two', version: 4, collapsed: false }]);

		expect(get(tasks)[0]).toMatchObject({ text: 'Two', version: 4, collapsed: true });
	});

	it('blocks a second overlapping flush instead of double-executing creates', async () => {
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: 'local-1',
			payload: { text: 'Created offline', parentId: null }
		});

		const deferred = createDeferred();
		const fetcher = vi.fn(() => deferred.promise);

		const firstFlush = flushOfflineWriteQueue(fetcher);
		const secondFlush = await flushOfflineWriteQueue(fetcher);

		expect(secondFlush).toMatchObject({ flushed: 0, blocked: true });
		expect(fetcher).toHaveBeenCalledTimes(1);

		deferred.resolve(jsonResponse({
			task: { id: SERVER_TASK_ID, text: 'Created offline' }
		}, 201));
		await expect(firstFlush).resolves.toMatchObject({ flushed: 1, remaining: 0, blocked: false });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('keeps mutations enqueued during a flush and remaps their local ids', async () => {
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: 'local-1',
			payload: { text: 'Created offline', parentId: null }
		});

		let enqueuedMidFlight = false;
		const fetcher = vi.fn(async () => {
			if (!enqueuedMidFlight) {
				enqueuedMidFlight = true;
				enqueueOfflineMutation({
					type: 'checklist.create',
					taskId: 'local-1',
					localItemId: 'local-item',
					text: 'Added mid-flush'
				});
			}
			return jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Created offline' } }, 201);
		});

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({ flushed: 1, remaining: 1, blocked: false });
		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			taskId: SERVER_TASK_ID,
			text: 'Added mid-flush'
		});
	});

	it('refreshes queued expectedVersion from versions bumped earlier in the same flush', async () => {
		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId: SERVER_TASK_ID,
			localItemId: 'local-item',
			text: 'Checklist first'
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: SERVER_TASK_ID,
			patch: { text: 'Patched later', expectedVersion: 3 }
		});

		/** @type {Record<string, unknown>[]} */
		const bodies = [];
		const fetcher = vi.fn(async (_url, init) => {
			bodies.push(JSON.parse(init.body));
			return bodies.length === 1
				? jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Task', version: 7 } }, 201)
				: jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Patched later', version: 8 } });
		});

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({ flushed: 2, remaining: 0, blocked: false });
		expect(bodies[1]).toMatchObject({ text: 'Patched later', expectedVersion: 7 });
	});

	it('skips the authoritative snapshot while queued mutations are still pending', async () => {
		const optimisticTask = normalizeTask({
			id: SERVER_TASK_ID,
			text: 'Optimistic edit',
			version: 3
		});
		replaceTasks([optimisticTask]);
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: SERVER_TASK_ID,
			patch: { text: 'Optimistic edit', expectedVersion: 3 }
		});

		const fetcher = vi.fn(async () => {
			throw new Error('offline');
		});

		const result = await syncServerTasks(fetcher);

		expect(result).toMatchObject({ ok: false, fallback: true });
		// Only the queued mutation was attempted; no /api/tasks snapshot fetch.
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(get(tasks)[0]).toMatchObject({ text: 'Optimistic edit' });
		expect(loadOfflineQueue()).toHaveLength(1);
	});

	it('keeps a queued edit safe from a stale authoritative snapshot and pushes it to the server', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3 })]);
		const first = createDeferred();
		const second = createDeferred();
		const responses = [first, second];
		/** @type {Record<string, unknown>[]} */
		const bodies = [];
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn((_url, init) => {
				bodies.push(JSON.parse(init.body));
				return responses[bodies.length - 1].promise;
			})
		});

		updateTask(SERVER_TASK_ID, { text: 'Two' });
		await settleMicrotasks();
		updateTask(SERVER_TASK_ID, { text: 'Three' });

		// A slow GET /api/tasks from before the edits resolves now.
		applyServerTaskSnapshot([{ id: SERVER_TASK_ID, text: 'One', version: 3 }]);
		expect(get(tasks)[0]).toMatchObject({ text: 'Three' });

		first.resolve(jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Two', version: 4 } }));
		await settleMicrotasks();

		// The queued PATCH must carry the user's newest text, not the snapshot's.
		expect(bodies[1]).toMatchObject({ text: 'Three', expectedVersion: 4 });
		second.resolve(jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Three', version: 5 } }));
		await waitForPendingTaskSyncs();
		expect(get(tasks)[0]).toMatchObject({ text: 'Three', version: 5 });
	});

	it('resolves a rename of a checklist item whose create is still in flight', async () => {
		const serverItemId = '22222222-2222-4222-8222-222222222222';
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'Task', version: 1 })]);
		const createResponse = createDeferred();
		const patchResponse = createDeferred();
		/** @type {{ url: string; body: string }[]} */
		const requests = [];
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn((url, init) => {
				requests.push({ url, body: init.body });
				return requests.length === 1 ? createResponse.promise : patchResponse.promise;
			})
		});

		addSubtask(SERVER_TASK_ID, 'First');
		const localItemId = get(tasks)[0]?.subtasks[0]?.id;
		expect(localItemId).toBeTruthy();

		// Rename while the create request has not returned a server item id yet.
		renameSubtask(SERVER_TASK_ID, /** @type {string} */ (localItemId), 'Renamed');

		createResponse.resolve(jsonResponse({
			task: {
				id: SERVER_TASK_ID,
				text: 'Task',
				version: 2,
				subtasks: [{ id: serverItemId, text: 'First', done: false }]
			}
		}, 201));
		await settleMicrotasks();

		expect(requests[1]).toMatchObject({
			url: `/api/tasks/${SERVER_TASK_ID}/checklist/${serverItemId}`,
			body: JSON.stringify({ text: 'Renamed' })
		});
		patchResponse.resolve(jsonResponse({
			task: {
				id: SERVER_TASK_ID,
				text: 'Task',
				version: 3,
				subtasks: [{ id: serverItemId, text: 'Renamed', done: false }]
			}
		}));
		await waitForPendingTaskSyncs();
		expect(loadOfflineQueue()).toEqual([]);
		expect(get(tasks)[0]?.subtasks[0]).toMatchObject({ id: serverItemId, text: 'Renamed' });
	});

	it('coalesces a chained rename into the queued create when the create request fails', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'Task', version: 1 })]);
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn(async () => {
				throw new Error('offline');
			})
		});

		addSubtask(SERVER_TASK_ID, 'First');
		const localItemId = get(tasks)[0]?.subtasks[0]?.id;
		renameSubtask(SERVER_TASK_ID, /** @type {string} */ (localItemId), 'Renamed');
		await waitForPendingTaskSyncs();

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			taskId: SERVER_TASK_ID,
			localItemId,
			text: 'Renamed'
		});
	});

	it('keeps busy tasks safe from stale cross-tab writes while adopting the rest', async () => {
		const otherTaskId = '33333333-3333-4333-8333-333333333333';
		const localOnlyTask = normalizeTask({ id: 'local-pending', text: 'Local only' });
		replaceTasks([
			normalizeTask({ id: SERVER_TASK_ID, text: 'Mine', version: 4 }),
			localOnlyTask
		]);
		const deferred = createDeferred();
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn(() => deferred.promise)
		});

		updateTask(SERVER_TASK_ID, { text: 'Mine edited' });
		await settleMicrotasks();

		handleExternalTaskStorageEvent({
			key: 'kanbanTasks:anonymous',
			newValue: JSON.stringify([
				{ id: SERVER_TASK_ID, text: 'Stale copy', version: 4 },
				{ id: otherTaskId, text: 'New from other tab', version: 1 }
			])
		});

		const byId = new Map(get(tasks).map((task) => [task.id, task]));
		expect(byId.get(SERVER_TASK_ID)).toMatchObject({ text: 'Mine edited' });
		expect(byId.get(otherTaskId)).toMatchObject({ text: 'New from other tab' });
		expect(byId.get('local-pending')).toMatchObject({ text: 'Local only' });

		deferred.resolve(jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Mine edited', version: 5 } }));
		await waitForPendingTaskSyncs();
	});

	it('drops permanently orphaned mutations as conflicts instead of blocking sync forever', async () => {
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: 'local-x',
			payload: { text: 'Doomed create', parentId: null }
		});
		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId: 'local-x',
			localItemId: 'local-item',
			text: 'Dependent item'
		});

		const fetcher = vi.fn(async () => jsonResponse({ message: 'Conflict.' }, 409));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({ flushed: 2, remaining: 0, blocked: false });
		expect(result.conflicts).toHaveLength(2);
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('drains queued-but-unsent chain ops into the offline queue on page hide', async () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'One', version: 3 })]);
		const deferred = createDeferred();
		const fetchMock = vi.fn(() => deferred.promise);
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: fetchMock
		});

		updateTask(SERVER_TASK_ID, { text: 'Two' });
		await settleMicrotasks();
		// This edit sits queued in memory behind the in-flight PATCH.
		updateTask(SERVER_TASK_ID, { text: 'Three' });

		drainPendingTaskSyncsToOfflineQueue();

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'task.patch',
			taskId: SERVER_TASK_ID,
			patch: { text: 'Three' }
		});

		deferred.resolve(jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Two', version: 4 } }));
		await waitForPendingTaskSyncs();
		// The drained op must not fire its own request after the page survives.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports blocked without executing when the flush lock is held (fallback path)', async () => {
		vi.stubGlobal('navigator', undefined);
		try {
			enqueueOfflineMutation({
				type: 'task.create',
				localTaskId: 'local-1',
				payload: { text: 'Created offline', parentId: null }
			});
			const deferred = createDeferred();
			const fetcher = vi.fn(() => deferred.promise);

			const firstFlush = flushOfflineWriteQueue(fetcher);
			const secondFlush = await flushOfflineWriteQueue(fetcher);

			expect(secondFlush).toMatchObject({ flushed: 0, blocked: true, remaining: 1 });
			expect(fetcher).toHaveBeenCalledTimes(1);

			deferred.resolve(jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Created offline' } }, 201));
			await expect(firstFlush).resolves.toMatchObject({ flushed: 1, blocked: false });

			// The in-flight flag must reset so later flushes run again.
			const thirdFlush = await flushOfflineWriteQueue(fetcher);
			expect(thirdFlush).toMatchObject({ flushed: 0, remaining: 0, blocked: false });
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('passes the lock name and ifAvailable to Web Locks and blocks on a denied lock', async () => {
		const request = vi.fn(
			/** @param {string} _name @param {object} _opts @param {(lock: unknown) => unknown} callback */
			(_name, _opts, callback) => Promise.resolve(callback(null))
		);
		vi.stubGlobal('navigator', { locks: { request } });
		try {
			enqueueOfflineMutation({
				type: 'task.patch',
				taskId: SERVER_TASK_ID,
				patch: { text: 'Queued' }
			});
			const fetcher = vi.fn();

			const result = await flushOfflineWriteQueue(fetcher);

			expect(request).toHaveBeenCalledWith(
				'todokanban:offline-write-queue-flush',
				{ ifAvailable: true },
				expect.any(Function)
			);
			expect(result).toMatchObject({ flushed: 0, blocked: true, remaining: 1 });
			expect(fetcher).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('converges on another tab\'s task cache write instead of clobbering it', () => {
		replaceTasks([normalizeTask({ id: SERVER_TASK_ID, text: 'This tab' })]);
		const otherTabTasks = [normalizeTask({ id: SERVER_TASK_ID, text: 'Other tab', version: 2 })];
		const setItemCallsBefore = /** @type {import('vitest').Mock} */ (globalThis.localStorage.setItem).mock.calls.length;

		handleExternalTaskStorageEvent({
			key: 'kanbanTasks:anonymous',
			newValue: JSON.stringify(otherTabTasks)
		});

		expect(get(tasks)[0]).toMatchObject({ text: 'Other tab', version: 2 });
		// The external update must not be persisted back (no write echo).
		expect(/** @type {import('vitest').Mock} */ (globalThis.localStorage.setItem).mock.calls.length)
			.toBe(setItemCallsBefore);

		handleExternalTaskStorageEvent({
			key: 'kanbanTasks:someone-else',
			newValue: JSON.stringify([])
		});
		expect(get(tasks)).toHaveLength(1);
	});
});
