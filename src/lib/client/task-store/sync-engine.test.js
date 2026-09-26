import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../../shared/task-domain.js';
import { applyServerTaskVersions, resetTaskSyncStateForTests, waitForPendingTaskSyncs } from './sync-engine.js';
import { replaceTasks, tasks } from './task-cache.js';
import { clearDoneTasks, deleteTaskCascade, updateTask } from './task-mutations.js';

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

describe('task versions from other endpoints', () => {
    const TASK_ID = '33333333-3333-4333-8333-333333333333';

    afterEach(async () => {
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        vi.unstubAllGlobals();
    });

    it('moves an idle task forward only from one version behind', () => {
        replaceTasks([
            normalizeTask({ id: '11111111-1111-4111-8111-111111111111', text: 'Newer here', version: 5 }),
            normalizeTask({ id: '22222222-2222-4222-8222-222222222222', text: 'Current here', version: 2 }),
            normalizeTask({ id: '55555555-5555-4555-8555-555555555555', text: 'Stale here', version: 2 }),
            normalizeTask({ id: TASK_ID, text: 'No version yet' })
        ]);

        applyServerTaskVersions([
            { id: '11111111-1111-4111-8111-111111111111', version: 4 },
            { id: '22222222-2222-4222-8222-222222222222', version: 3 },
            // Another device edited this task (3) before the category write (4).
            { id: '55555555-5555-4555-8555-555555555555', version: 4 },
            { id: TASK_ID, version: 1 },
            { id: '44444444-4444-4444-8444-444444444444', version: 9 }
        ]);

        expect(get(tasks).map((task) => [task.text, task.version])).toEqual([
            ['Newer here', 5],
            ['Current here', 3],
            ['Stale here', 2],
            ['No version yet', 1]
        ]);
    });

    it('hands the new version to an edit queued behind one in flight', async () => {
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'One', version: 3 })]);
        /** @type {Record<string, unknown>[]} */
        const bodies = [];
        /** @type {(response: Response) => void} */
        let answerFirst = () => {};
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn((/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
            bodies.push(JSON.parse(String(init.body)));
            if (bodies.length === 1) {
                return new Promise((resolve) => {
                    answerFirst = resolve;
                });
            }
            return Promise.resolve(Response.json({ task: { id: TASK_ID, text: 'One', priority: 'high', version: 6 } }));
        }));

        updateTask(TASK_ID, { text: 'Two' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        updateTask(TASK_ID, { priority: 'high' });
        // The first PATCH landed (version 4), then a category rename bumped
        // the task again, before the PATCH response reached the client.
        applyServerTaskVersions([{ id: TASK_ID, version: 5 }]);
        answerFirst(Response.json({ task: { id: TASK_ID, text: 'Two', version: 4 } }));
        await waitForPendingTaskSyncs();

        expect(bodies.map((body) => body.expectedVersion)).toEqual([3, 5]);
        expect(get(tasks)[0]).toMatchObject({ priority: 'high', version: 6 });
    });

    it('keeps the new version for a delete queued behind an edit in flight', async () => {
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'One', version: 3 })]);
        /** @type {{ method: string; body: Record<string, unknown> }[]} */
        const requests = [];
        /** @type {(response: Response) => void} */
        let answerPatch = () => {};
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn((/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
            requests.push({ method: String(init.method), body: JSON.parse(String(init.body)) });
            if (init.method === 'PATCH') {
                return new Promise((resolve) => {
                    answerPatch = resolve;
                });
            }
            return Promise.resolve(Response.json({ deleted: 1 }));
        }));

        updateTask(TASK_ID, { text: 'Two' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        applyServerTaskVersions([{ id: TASK_ID, version: 5 }]);
        deleteTaskCascade(TASK_ID);
        // The late PATCH response (version 4) must not win over the newer 5.
        answerPatch(Response.json({ task: { id: TASK_ID, text: 'Two', version: 4 } }));
        await waitForPendingTaskSyncs();

        expect(requests).toEqual([
            { method: 'PATCH', body: expect.objectContaining({ expectedVersion: 3 }) },
            { method: 'DELETE', body: { expectedVersion: 5 } }
        ]);
    });
});
