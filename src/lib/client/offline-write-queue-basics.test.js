import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
    enqueueOfflineMutation,
    flushOfflineWriteQueue,
    loadOfflineQueue,
    setOfflineQueueOwner
} from './offline-write-queue.js';

describe('offline write queue', () => {
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

    it('coalesces task patches and flushes them in order', async () => {
        const taskId = '99999999-9999-4999-8999-999999999999';
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId,
            patch: { text: 'First' }
        });
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId,
            patch: { status: 'doing' }
        });

        expect(loadOfflineQueue()).toHaveLength(1);
        expect(loadOfflineQueue()[0]).toMatchObject({
            type: 'task.patch',
            patch: { text: 'First', status: 'doing' }
        });

        const serverTask = normalizeTask({ id: taskId, text: 'First', status: 'doing' });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
            flushed: 1,
            remaining: 0,
            blocked: false,
            syncedTasks: [serverTask]
        });
        expect(fetcher).toHaveBeenCalledWith(`/api/tasks/${taskId}`, expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ text: 'First', status: 'doing' })
        }));
        expect(loadOfflineQueue()).toEqual([]);
    });

    it('keeps retryable failures for a later sync', async () => {
        const taskId = '99999999-9999-4999-8999-999999999999';
        enqueueOfflineMutation({
            type: 'task.delete',
            taskId
        });

        await expect(flushOfflineWriteQueue(async () => {
            throw new Error('offline');
        })).resolves.toMatchObject({
            flushed: 0,
            remaining: 1,
            blocked: true
        });
        expect(loadOfflineQueue()[0]).toMatchObject({
            type: 'task.delete',
            taskId,
            attempts: 1
        });
    });
});
