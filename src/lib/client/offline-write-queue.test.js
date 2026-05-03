import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	enqueueOfflineMutation,
	flushOfflineWriteQueue,
	loadOfflineQueue
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
});
