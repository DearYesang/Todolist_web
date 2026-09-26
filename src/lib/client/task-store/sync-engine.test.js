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
import {
    addSubtask,
    clearDoneTasks,
    deleteTaskCascade,
    renameSubtask,
    toggleSubtask,
    updateTask
} from './task-mutations.js';

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
    const ITEM = { id: '44444444-4444-4444-8444-444444444444', text: 'Item', done: false };
    const NEW_ITEM_ID = '55555555-5555-4555-8555-555555555555';

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
    it('moves the queued later edit to the version the request in flight landed at', async () => {
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

    // The same for checklist writes, still signed in (a cancelled "clear
    // local data" question, or a page kept after pagehide). The queue puts
    // a later patch of an item on top of an earlier one; the toggle in
    // flight fails after the toggle behind it was queued, so the item ends
    // up checked on the server although it was unchecked last.
    it('keeps the later toggle of a checklist item when the toggle in flight fails after the wait', async () => {
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] })]);
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        toggleSubtask(TASK_ID, ITEM.id);
        await vi.advanceTimersByTimeAsync(0);
        toggleSubtask(TASK_ID, ITEM.id);

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        firstAnswer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 }));
        await vi.advanceTimersByTimeAsync(0);

        expect(loadOfflineQueue()).toEqual([
            expect.objectContaining({ type: 'checklist.patch', taskId: TASK_ID, itemId: ITEM.id, patch: { done: false } })
        ]);
    });

    // The rename of an item whose create is out is queued as a create with
    // the item's final text. When the create lands, that create would add
    // the item a second time, and the answer puts the created text back on
    // the board over the rename.
    it('keeps a rename queued behind an item create that lands after the wait, as an edit of the created item', async () => {
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        addSubtask(TASK_ID, 'New');
        await vi.advanceTimersByTimeAsync(0);
        const localItemId = get(tasks)[0].subtasks[0].id;
        renameSubtask(TASK_ID, localItemId, 'Renamed');

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        firstAnswer.resolve(jsonResponse({
            task: { id: TASK_ID, text: 'Saved', version: 2, subtasks: [{ id: NEW_ITEM_ID, text: 'New', done: false }] }
        }, { status: 201 }));
        await vi.advanceTimersByTimeAsync(0);

        expect({
            queue: loadOfflineQueue(),
            board: get(tasks)[0].subtasks
        }).toEqual({
            queue: [
                expect.objectContaining({ type: 'checklist.patch', taskId: TASK_ID, itemId: NEW_ITEM_ID, patch: { text: 'Renamed' } })
            ],
            board: [{ id: NEW_ITEM_ID, text: 'Renamed', done: false }]
        });
    });

    it('queues the fields of a failed checklist edit that the later queued edit of its item does not set', async () => {
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] })]);
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        renameSubtask(TASK_ID, ITEM.id, 'First');
        await vi.advanceTimersByTimeAsync(0);
        toggleSubtask(TASK_ID, ITEM.id);

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        firstAnswer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 }));
        await vi.advanceTimersByTimeAsync(0);

        expect(loadOfflineQueue()).toEqual([
            expect.objectContaining({ type: 'checklist.patch', itemId: ITEM.id, patch: { done: true, text: 'First' } })
        ]);
    });

    // While a task edit is out, the add of a checklist item waits behind it
    // and moves to the queue at the timeout. The edit's answer, which does
    // not have the item, then replaces the task on the board: the item is
    // gone from the board, and from the cache, until a sync sends its create.
    it('keeps an item queued behind a task edit on the board when the edit lands after the wait', async () => {
        const firstAnswer = createDeferred();
        vi.stubGlobal('fetch', vi.fn(() => firstAnswer.promise));
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        addSubtask(TASK_ID, 'New');

        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        // The answer does not have the item, whose create is in the queue.
        firstAnswer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2, subtasks: [] } }));
        await vi.advanceTimersByTimeAsync(0);

        expect({
            queue: loadOfflineQueue().map((mutation) => mutation.type),
            board: get(tasks).map((task) => [task.text, task.version, task.subtasks.map((item) => item.text)])
        }).toEqual({
            queue: ['checklist.create'],
            board: [['Edit 1', 2, ['New']]]
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

// Verifier findings on PR #84. An edit of a task waits in the offline
// queue (it failed, or moved there from the task's chain at sign-out's
// timeout), and the user edits the task again while still signed in. That
// edit goes out through the chain, from the board, which holds the queued
// edit, and lands first. The queued edit then goes out at the next sync,
// behind the newer one.
describe('an edit that lands after an older edit of its task was queued', () => {
    const TASK_ID = '66666666-6666-4666-8666-666666666666';
    const ITEM = { id: '77777777-7777-4777-8777-777777777777', text: 'Item', done: false };
    /** @type {ReturnType<typeof createDeferred>[]} */
    let answers;
    /** @type {Record<string, unknown>[]} */
    let bodies;

    beforeEach(() => {
        vi.useFakeTimers();
        installMemoryStorage();
        vi.stubGlobal('window', {});
        setOfflineQueueOwner('user-a');
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] })]);
        answers = [];
        bodies = [];
        // Every request stays out until the test answers it.
        vi.stubGlobal('fetch', vi.fn((/** @type {unknown} */ _url, /** @type {RequestInit} */ init) => {
            bodies.push(JSON.parse(String(init.body)));
            const answer = createDeferred();
            answers.push(answer);
            return answer.promise;
        }));
    });

    afterEach(async () => {
        let answered = 0;
        while (answered < answers.length) {
            answers.slice(answered).forEach((answer) => answer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 })));
            answered = answers.length;
            await vi.advanceTimersByTimeAsync(0);
        }
        vi.useRealTimers();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        setOfflineQueueOwner(null);
    });

    /**
     * Answers request `index` (0 for the first).
     * @param {number} index
     * @param {Response} response
     */
    async function answer(index, response) {
        answers[index].resolve(response);
        await vi.advanceTimersByTimeAsync(0);
    }

    const unavailable = () => jsonResponse({ message: 'Unavailable' }, { status: 503 });

    // Sent at the next sync, the queued edit expects the version before the
    // newer one landed and meets a 409, which reports the user's own older
    // edit as a conflict; applied from there, it would undo the newer one.
    it('retires a queued task edit once a later edit of the task lands', async () => {
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        await answer(0, unavailable());
        expect(loadOfflineQueue()).toEqual([
            expect.objectContaining({ type: 'task.patch', patch: expect.objectContaining({ text: 'Edit 1', expectedVersion: 1 }) })
        ]);

        updateTask(TASK_ID, { priority: 'high' });
        await vi.advanceTimersByTimeAsync(0);
        expect(bodies[1]).toMatchObject({ text: 'Edit 1', priority: 'high', expectedVersion: 1 });
        await answer(1, jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', priority: 'high', version: 2 } }));

        expect(loadOfflineQueue()).toEqual([]);
    });

    it('retires the edit queued at sign-out\'s timeout once the next edit, made after a cancelled sign-out, lands', async () => {
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        updateTask(TASK_ID, { text: 'Edit 2' });
        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        // The "clear local data" question is cancelled, and the first
        // request lands.
        await answer(0, jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));

        updateTask(TASK_ID, { text: 'Edit 3' });
        await vi.advanceTimersByTimeAsync(0);
        expect(bodies[1]).toMatchObject({ text: 'Edit 3', expectedVersion: 2 });
        await answer(1, jsonResponse({ task: { id: TASK_ID, text: 'Edit 3', version: 3 } }));

        expect({
            queue: loadOfflineQueue(),
            board: get(tasks).map((task) => [task.text, task.version])
        }).toEqual({ queue: [], board: [['Edit 3', 3]] });
    });

    // A checklist patch carries no version, so the queued older rename
    // lands at the next sync over the newer one, with no conflict to show.
    it('retires the fields of a queued checklist edit that a later edit of the item set once it lands', async () => {
        renameSubtask(TASK_ID, ITEM.id, 'First');
        await vi.advanceTimersByTimeAsync(0);
        renameSubtask(TASK_ID, ITEM.id, 'Last');
        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await expect(settling).resolves.toBe(false);
        await answer(0, jsonResponse({ task: { id: TASK_ID, text: 'Saved', version: 2, subtasks: [{ ...ITEM, text: 'First' }] } }));

        renameSubtask(TASK_ID, ITEM.id, 'Newest');
        await vi.advanceTimersByTimeAsync(0);
        expect(bodies[1]).toEqual({ text: 'Newest' });
        await answer(1, jsonResponse({ task: { id: TASK_ID, text: 'Saved', version: 3, subtasks: [{ ...ITEM, text: 'Newest' }] } }));

        expect(loadOfflineQueue()).toEqual([]);
    });

    // The toggle's answer has the server's task, without the queued edit,
    // and replaced the task on the board with it. The next edit of the task
    // is sent from the board, so the queued edit would be undone there too.
    it('keeps a queued task edit on the board when a checklist write of the task lands', async () => {
        updateTask(TASK_ID, { text: 'Edit 1' });
        await vi.advanceTimersByTimeAsync(0);
        await answer(0, unavailable());

        toggleSubtask(TASK_ID, ITEM.id);
        await vi.advanceTimersByTimeAsync(0);
        await answer(1, jsonResponse({ task: { id: TASK_ID, text: 'Saved', version: 2, subtasks: [{ ...ITEM, done: true }] } }));

        expect(get(tasks).map((task) => [task.text, task.version, task.subtasks[0].done])).toEqual([['Edit 1', 2, true]]);
    });
});
