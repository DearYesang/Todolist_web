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
