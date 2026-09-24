import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../../shared/task-domain.js';
import { replaceTasks, tasks } from './task-cache.js';
import { clearDoneTasks } from './task-mutations.js';

describe('task store server sync', () => {
    afterEach(() => {
        replaceTasks([]);
        Reflect.deleteProperty(globalThis, 'fetch');
        Reflect.deleteProperty(globalThis, 'window');
    });

    it('syncs clear-done deletes for server-backed tasks', async () => {
        const parent = normalizeTask({
            id: '11111111-1111-4111-8111-111111111111',
            text: 'Done parent',
            status: 'done'
        });
        const child = normalizeTask({
            id: '22222222-2222-4222-8222-222222222222',
            text: 'Done child',
            status: 'done',
            parentId: parent.id
        });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ deleted: 2 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {}
        });
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetcher
        });

        replaceTasks([parent, child]);
        clearDoneTasks();

        expect(get(tasks)).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(`/api/tasks/${parent.id}`, expect.objectContaining({
            method: 'DELETE'
        }));
    });
});
