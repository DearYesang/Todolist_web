import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	enqueueOfflineMutation,
	flushOfflineWriteQueue,
	loadOfflineQueue,
	setOfflineQueueOwner
} from './offline-write-queue.js';
import { normalizeTask } from '../shared/task-domain.js';

describe('offline write queue conflict behavior', () => {
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
	});

	afterEach(() => {
		setOfflineQueueOwner(null);
		Reflect.deleteProperty(globalThis, 'localStorage');
	});

	it('drops 409 conflicts instead of retrying forever', async () => {
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999',
			patch: { text: 'Stale write' }
		});

		const result = await flushOfflineWriteQueue(async () => new Response(JSON.stringify({
			message: 'Conflict.'
		}), {
			status: 409,
			headers: { 'content-type': 'application/json' }
		}));

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false
		});
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]).toMatchObject({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999'
		});
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('preserves order after a partial flush failure', async () => {
		const firstTask = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'First'
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: firstTask.id,
			patch: { text: 'First' }
		});
		enqueueOfflineMutation({
			type: 'task.delete',
			taskId: '22222222-2222-4222-8222-222222222222'
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '33333333-3333-4333-8333-333333333333',
			patch: { text: 'Later' }
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: firstTask }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}))
			.mockRejectedValueOnce(new Error('offline'));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 2,
			blocked: true,
			syncedTasks: [firstTask]
		});
		expect(loadOfflineQueue().map((item) => item.type)).toEqual(['task.delete', 'task.patch']);
		expect(loadOfflineQueue()[0].attempts).toBe(1);
	});

	it('keeps queued mutations scoped to the active user', () => {
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			patch: { text: 'A' }
		});

		setOfflineQueueOwner('user-b');
		expect(loadOfflineQueue()).toEqual([]);
		enqueueOfflineMutation({
			type: 'task.delete',
			taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			ownerUserId: 'user-b',
			type: 'task.delete'
		});

		setOfflineQueueOwner('user-a');
		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			ownerUserId: 'user-a',
			type: 'task.patch'
		});
	});

	it('resolves child creates queued under local parents', async () => {
		const localParentId = 'local-parent';
		const localChildId = 'local-child';
		const serverParent = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Parent'
		});
		const serverChild = normalizeTask({
			id: '22222222-2222-4222-8222-222222222222',
			text: 'Child',
			parentId: serverParent.id
		});

		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: localParentId,
			payload: { text: 'Parent', parentId: null }
		});
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: localChildId,
			localParentId,
			payload: { text: 'Child', parentId: null }
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: serverParent }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: serverChild }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 2,
			remaining: 0,
			blocked: false
		});
		expect(fetcher).toHaveBeenNthCalledWith(2, '/api/tasks', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ text: 'Child', parentId: serverParent.id })
		}));
		expect(result.createdTasks).toEqual([
			{ localTaskId: localParentId, task: serverParent },
			{ localTaskId: localChildId, task: serverChild }
		]);
	});

	it('coalesces local task edits into pending creates before flushing', async () => {
		const localTaskId = 'local-task';
		const serverTask = normalizeTask({
			id: '44444444-4444-4444-8444-444444444444',
			text: 'Edited task',
			status: 'doing'
		});

		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId,
			payload: {
				text: 'Draft task',
				status: 'todo',
				parentId: null
			}
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: localTaskId,
			patch: {
				text: 'Edited task',
				status: 'doing'
			}
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'task.create',
			payload: {
				text: 'Edited task',
				status: 'doing',
				parentId: null
			}
		});

		const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
			status: 201,
			headers: { 'content-type': 'application/json' }
		}));

		await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			createdTasks: [{ localTaskId, task: serverTask }]
		});
		expect(fetcher).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({
				text: 'Edited task',
				status: 'doing',
				parentId: null
			})
		}));
	});

	it('replays queued offline imports when connectivity returns', async () => {
		const importedTask = normalizeTask({
			id: '77777777-7777-4777-8777-777777777777',
			text: 'Imported offline'
		});

		enqueueOfflineMutation({
			type: 'import.tasks',
			mode: 'append',
			payload: [{ text: 'Imported offline' }]
		});

		const fetcher = vi.fn(async () => new Response(JSON.stringify({
			tasks: [importedTask],
			summary: {
				receivedTasks: 1,
				importedTasks: 1,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0
			}
		}), {
			status: 201,
			headers: { 'content-type': 'application/json' }
		}));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			completedImports: [{
				mode: 'append',
				tasks: [importedTask],
				localTaskIds: []
			}]
		});
		expect(fetcher).toHaveBeenCalledWith('/api/import', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify([{ text: 'Imported offline' }])
		}));
	});

	it('treats replace imports as a new offline baseline', () => {
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '88888888-8888-4888-8888-888888888888',
			patch: { text: 'Older edit' }
		});
		enqueueOfflineMutation({
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Replacement import' }]
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Replacement import' }]
		});
	});

	it('coalesces checklist create edits and replays a final done state', async () => {
		const taskId = '55555555-5555-4555-8555-555555555555';
		const localItemId = 'local-checklist';
		const serverItemId = '66666666-6666-4666-8666-666666666666';
		const createdTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Renamed checklist', done: false }]
		});
		const updatedTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Renamed checklist', done: true }]
		});

		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId,
			text: 'First checklist'
		});
		enqueueOfflineMutation({
			type: 'checklist.patch',
			taskId,
			itemId: localItemId,
			patch: { text: 'Renamed checklist' }
		});
		enqueueOfflineMutation({
			type: 'checklist.patch',
			taskId,
			itemId: localItemId,
			patch: { done: true }
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			text: 'Renamed checklist',
			done: true
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: createdTask }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: updatedTask }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}));

		await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			syncedTasks: [updatedTask]
		});
		expect(fetcher).toHaveBeenNthCalledWith(1, `/api/tasks/${taskId}/checklist`, expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ text: 'Renamed checklist' })
		}));
		expect(fetcher).toHaveBeenNthCalledWith(2, `/api/tasks/${taskId}/checklist/${serverItemId}`, expect.objectContaining({
			method: 'PATCH',
			body: JSON.stringify({ done: true })
		}));
	});

	it('drops a pending checklist create when the local item is deleted before sync', () => {
		const taskId = '77777777-7777-4777-8777-777777777777';
		const localItemId = 'local-checklist';

		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId,
			text: 'Temporary checklist'
		});
		enqueueOfflineMutation({
			type: 'checklist.delete',
			taskId,
			itemId: localItemId
		});

		expect(loadOfflineQueue()).toEqual([]);
	});

	it('ignores corrupted queue records from another owner', () => {
		setOfflineQueueOwner('user-a');
		storage.set('kanbanOfflineWriteQueue:user-a', JSON.stringify([{
			id: 'mutation-id',
			ownerUserId: 'user-b',
			type: 'task.delete',
			taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			createdAt: Date.now(),
			attempts: 0
		}]));

		expect(loadOfflineQueue()).toEqual([]);
	});
});
