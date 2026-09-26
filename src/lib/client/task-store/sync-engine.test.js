import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import { normalizeTask } from '../../shared/task-domain.js';
import { loadOfflineQueue, setOfflineQueueOwner } from '../offline-write-queue.js';
import {
    applyServerTaskVersions,
    countPendingTaskSyncs,
    discardPendingTaskSyncs,
    resetTaskSyncStateForTests,
    settlePendingTaskSyncs,
    waitForPendingTaskSyncs
} from './sync-engine.js';
import { replaceTasks, tasks } from './task-cache.js';
import { clearDoneTasks, deleteTaskCascade, updateTask } from './task-mutations.js';

describe('task store server sync', () => {
    afterEach(() => {
        replaceTasks([]);
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

        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', fetcher);

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

describe('settling task writes before sign-out', () => {
    const TASK_ID = '33333333-3333-4333-8333-333333333333';

    beforeEach(() => {
        vi.useFakeTimers();
        installMemoryStorage();
        vi.stubGlobal('window', {});
        setOfflineQueueOwner('user-a');
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1 })]);
    });

    afterEach(async () => {
        vi.useRealTimers();
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        setOfflineQueueOwner(null);
    });

    it('resolves at once when no write is pending', async () => {
        await expect(settlePendingTaskSyncs({ timeoutMs: 5000 })).resolves.toBe(true);
    });

    it('stops waiting after timeoutMs and queues the edits that have not gone out', async () => {
        const firstAnswer = createDeferred();
        /** @type {string[]} */
        const sent = [];
        vi.stubGlobal('fetch', vi.fn((/** @type {unknown} */ _url, /** @type {RequestInit} */ init) => {
            sent.push(JSON.parse(String(init.body)).text);
            return firstAnswer.promise;
        }));
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        updateTask(TASK_ID, { text: 'Edit 2' });

        /** @type {boolean | undefined} */
        let settled;
        void settlePendingTaskSyncs({ timeoutMs: 5000 }).then((value) => {
            settled = value;
        });
        await vi.advanceTimersByTimeAsync(4999);
        expect(settled).toBeUndefined();
        expect(loadOfflineQueue()).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(false);
        expect(loadOfflineQueue()).toEqual([
            expect.objectContaining({
                type: 'task.patch',
                taskId: TASK_ID,
                ownerUserId: 'user-a',
                patch: expect.objectContaining({ text: 'Edit 2' })
            })
        ]);

        // The request in flight still ends; the queued edit is not sent twice.
        firstAnswer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));
        await vi.advanceTimersByTimeAsync(0);
        expect(sent).toEqual(['Edit 1']);
    });

    // The queue merges a task's patches with the later one's fields on top.
    // The request in flight fails after the edit behind it was queued, so
    // its older fields would land on top of the newer edit's.
    it('keeps the queued later edit when the request in flight fails after the wait', async () => {
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        updateTask(TASK_ID, { text: 'Edit 2' });

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        firstAnswer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 }));
        await vi.advanceTimersByTimeAsync(0);

        // The later edit carries every field of the first; its patch alone is
        // what the next sync must send.
        expect(loadOfflineQueue()).toEqual([
            expect.objectContaining({
                type: 'task.patch',
                taskId: TASK_ID,
                patch: expect.objectContaining({ text: 'Edit 2', expectedVersion: 1 })
            })
        ]);
    });

    // b31d239 left this for the timeout: the later edit was queued with the
    // version the request in flight started from. When that request lands,
    // the task moves past that version, and the next sync sends the edit into
    // a 409, which reports the user's own edit as a conflict. The late answer
    // also put the first edit's text back on the board over the second's.
    it.fails('moves the queued later edit to the version the request in flight landed at', async () => {
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        updateTask(TASK_ID, { text: 'Edit 2' });

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        firstAnswer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));
        await vi.advanceTimersByTimeAsync(0);

        expect({
            queue: loadOfflineQueue(),
            board: get(tasks).map((task) => [task.text, task.version])
        }).toEqual({
            queue: [
                expect.objectContaining({
                    type: 'task.patch',
                    taskId: TASK_ID,
                    patch: expect.objectContaining({ text: 'Edit 2', expectedVersion: 2 })
                })
            ],
            board: [['Edit 2', 2]]
        });
    });
});

describe('task writes when sign-out clears local data', () => {
    const TASK_ID = '33333333-3333-4333-8333-333333333333';
    /** @type {ReturnType<typeof createDeferred>} */
    let firstAnswer;
    /** @type {string[]} */
    let sent;

    beforeEach(() => {
        installMemoryStorage();
        vi.stubGlobal('window', {});
        setOfflineQueueOwner('user-a');
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1 })]);
        firstAnswer = createDeferred();
        sent = [];
        // The first request waits for the test; later ones succeed at once.
        vi.stubGlobal('fetch', vi.fn((/** @type {unknown} */ _url, /** @type {RequestInit} */ init) => {
            const body = JSON.parse(String(init.body));
            sent.push(body.text);
            return sent.length === 1
                ? firstAnswer.promise
                : Promise.resolve(jsonResponse({ task: { id: TASK_ID, text: body.text, version: body.expectedVersion + 1 } }));
        }));
    });

    afterEach(async () => {
        firstAnswer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 }));
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        setOfflineQueueOwner(null);
    });

    /** A PATCH out and a second edit waiting behind it. */
    async function editTwice() {
        updateTask(TASK_ID, { text: 'Edit 1' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        updateTask(TASK_ID, { text: 'Edit 2' });
    }

    it('counts the writes waiting or out for the current queue owner only', async () => {
        await editTwice();
        expect(countPendingTaskSyncs()).toBe(2);

        setOfflineQueueOwner('user-b');
        expect(countPendingTaskSyncs()).toBe(0);
        setOfflineQueueOwner('user-a');

        firstAnswer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));
        await waitForPendingTaskSyncs();
        expect(countPendingTaskSyncs()).toBe(0);
        expect(sent).toEqual(['Edit 1', 'Edit 2']);
    });

    it('never sends a waiting write, queues nothing when the request out fails, and syncs the task again later', async () => {
        await editTwice();

        discardPendingTaskSyncs();
        expect(countPendingTaskSyncs()).toBe(0);
        firstAnswer.resolve(jsonResponse({ message: 'Unauthorized' }, { status: 401 }));
        await waitForPendingTaskSyncs();

        expect(sent).toEqual(['Edit 1']);
        expect(loadOfflineQueue()).toEqual([]);

        // The dropped snapshot sync no longer stands in for the task's next one.
        updateTask(TASK_ID, { text: 'Edit 3' });
        await waitForPendingTaskSyncs();
        expect(sent).toEqual(['Edit 1', 'Edit 3']);
    });

    it('leaves the board alone when the request out lands after the clear', async () => {
        await editTwice();

        discardPendingTaskSyncs();
        firstAnswer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));
        await waitForPendingTaskSyncs();

        // The sign-out empties the board next; until then the answer does not
        // put the task back or move it on.
        expect(get(tasks).map((task) => [task.text, task.version])).toEqual([['Edit 2', 1]]);
    });
});
