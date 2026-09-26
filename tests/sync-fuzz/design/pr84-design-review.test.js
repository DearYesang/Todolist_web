import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import { importFromRoot } from '../root.js';

// The code under test comes from the checkout ../root.js names (FUZZ_ROOT).
const { normalizeTask } = await importFromRoot('src/lib/shared/task-domain.js');
const {
    enqueueOfflineMutation,
    flushOfflineWriteQueue,
    loadOfflineQueue,
    setOfflineQueueOwner
} = await importFromRoot('src/lib/client/offline-write-queue.js');
const engine = await importFromRoot('src/lib/client/task-store/sync-engine.js');
const { resetTaskSyncStateForTests, waitForPendingTaskSyncs } = engine;
const { syncServerTasks } = await importFromRoot('src/lib/client/task-store/server-sync.js');
const { replaceTasks, tasks } = await importFromRoot('src/lib/client/task-store/task-cache.js');
const { toggleSubtask, updateTask } = await importFromRoot('src/lib/client/task-store/task-mutations.js');

const TASK_ID = '66666666-6666-4666-8666-666666666666';
const ITEM = { id: '77777777-7777-4777-8777-777777777777', text: 'Item', done: false };

describe('PR84 design review repros', () => {
    /** @type {{ method: string; url: string; body: any; answer: ReturnType<typeof createDeferred> }[]} */
    let requests;

    beforeEach(() => {
        installMemoryStorage();
        vi.stubGlobal('window', {});
        setOfflineQueueOwner('user-a');
        replaceTasks([normalizeTask({ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] })]);
        requests = [];
        vi.stubGlobal('fetch', vi.fn((/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
            const answer = createDeferred();
            requests.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : null, answer });
            return answer.promise;
        }));
    });

    afterEach(async () => {
        let answered = 0;
        while (answered < requests.length) {
            requests.slice(answered).forEach((request) => request.answer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 })));
            answered = requests.length;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        setOfflineQueueOwner(null);
    });

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const unavailable = () => jsonResponse({ message: 'Unavailable' }, { status: 503 });

    // T1a: the offline queue is shared by every tab of the origin, but the
    // retire rule assumes this tab's board holds every queued edit. A tab
    // whose chain for the task is busy ignores the other tab's cache
    // update (cross-tab-sync: hasPendingTaskSync), so its landed edit does
    // not contain the other tab's queued edit, yet it drops it.
    it('T1a: a landed edit in this tab drops another tab\'s queued edit it never contained', async () => {
        // This tab: a priority edit goes out, built from a board without the other tab's edit.
        updateTask(TASK_ID, { priority: 'high' });
        await tick();
        expect(requests[0].body).toMatchObject({ text: 'Saved', priority: 'high', expectedVersion: 1 });

        // The other tab: its text edit failed with 503 and went to the shared queue.
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId: TASK_ID,
            localParentId: null,
            patch: { text: 'Other tab edit', priority: 'normal', expectedVersion: 1 }
        });

        requests[0].answer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Saved', priority: 'high', version: 2, subtasks: [ITEM] } }));
        await tick();

        // Without the retire rule the queued edit stays and the next sync
        // reports it as a conflict (the user sees it). With it, it is gone.
        expect(loadOfflineQueue().map((mutation) => mutation.type === 'task.patch' ? mutation.patch.text : mutation.type))
            .toEqual(['Other tab edit']);
    });

    // T1b: single tab. A server snapshot whose list request was out when an
    // edit failed replaces the task on the board (the snapshot only checks
    // the queue before listing). The board no longer holds the queued edit;
    // the next edit, built from the board, lands and the retire rule drops
    // the queued edit, which was never sent.
    it('T1b: a snapshot that raced a failed edit, then the next edit landing, drops the failed edit silently', async () => {
        const syncing = syncServerTasks();
        await tick();
        const listRequest = requests.find((request) => request.method === 'GET' && request.url === '/api/tasks');
        expect(listRequest).toBeDefined();

        // While the list request is out, the user edits the text; the PATCH fails (503) and is queued.
        updateTask(TASK_ID, { text: 'Edit 1' });
        await tick();
        const firstPatch = requests.find((request) => request.method === 'PATCH');
        firstPatch?.answer.resolve(unavailable());
        await tick();
        expect(loadOfflineQueue().map((mutation) => mutation.type)).toEqual(['task.patch']);

        // The snapshot answer (server still has 'Saved') lands.
        listRequest?.answer.resolve(jsonResponse({ tasks: [{ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] }] }));
        let done = false;
        void syncing.then(() => { done = true; });
        for (let round = 0; round < 10 && !done; round += 1) {
            await tick();
            requests.filter((request) => request.method === 'GET' && request.url !== '/api/tasks')
                .forEach((request) => request.answer.resolve(jsonResponse({ message: 'x' }, { status: 500 })));
        }
        await syncing;
        expect(get(tasks).map((task) => task.text)).toEqual(['Saved']);

        // The user now changes the priority; this PATCH lands.
        updateTask(TASK_ID, { priority: 'high' });
        await tick();
        const secondPatch = requests.filter((request) => request.method === 'PATCH')[1];
        const sentText = secondPatch?.body.text;
        secondPatch?.answer.resolve(jsonResponse({ task: { id: TASK_ID, text: sentText, priority: 'high', version: 2, subtasks: [ITEM] } }));
        await tick();

        expect({
            sentText,
            queue: loadOfflineQueue().map((mutation) => mutation.type === 'task.patch' ? mutation.patch.text : mutation.type),
            board: get(tasks).map((task) => task.text)
        }).toEqual({
            // 'Edit 1' must be somewhere: sent, queued, or on the board.
            sentText: 'Saved',
            queue: ['Edit 1'],
            board: ['Saved']
        });
    });

    // T2: the advance rule only covers an edit that moved to the queue
    // while the request was out (taskStateQueued). An edit queued earlier
    // (a 503) stays on the version before a checklist write that landed
    // since, although the board moved to the new version; the next sync
    // sends it into a 409 and the banner reports the user's own edit.
    it('T2: a queued task edit meets a 409 after the user\'s own checklist toggle lands', async () => {
        updateTask(TASK_ID, { text: 'Edit 1' });
        await tick();
        requests[0].answer.resolve(unavailable());
        await tick();

        toggleSubtask(TASK_ID, ITEM.id);
        await tick();
        requests[1].answer.resolve(jsonResponse({ task: { id: TASK_ID, text: 'Saved', version: 2, subtasks: [{ ...ITEM, done: true }] } }));
        await tick();
        await waitForPendingTaskSyncs();

        const boardVersion = get(tasks)[0].version;
        const queuedExpected = /** @type {any} */ (loadOfflineQueue()[0]).patch.expectedVersion;

        // The next sync: the server is at version 2 and answers 409 on any other expectedVersion.
        let serverVersion = 2;
        const server = vi.fn(async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
            const body = JSON.parse(String(init.body));
            if (body.expectedVersion !== serverVersion) {
                return jsonResponse({ message: 'Conflict' }, { status: 409 });
            }
            serverVersion += 1;
            return jsonResponse({ task: { id: TASK_ID, ...body, version: serverVersion, subtasks: [{ ...ITEM, done: true }] } });
        });
        const flushed = await flushOfflineWriteQueue(server);

        expect({ boardVersion, queuedExpected, conflicts: flushed.conflicts.length }).toEqual({
            boardVersion: 2,
            queuedExpected: 2,
            conflicts: 0
        });
    });
});

describe('PR84 design review: advancing past a version the user did not write', () => {
    const TASK = '88888888-8888-4888-8888-888888888888';
    const ITEM2 = { id: '99999999-9999-4999-8999-999999999999', text: 'Item', done: false };
    /** @type {ReturnType<typeof createDeferred>[]} */
    let answers;

    beforeEach(() => {
        vi.useFakeTimers();
        installMemoryStorage();
        vi.stubGlobal('window', {});
        setOfflineQueueOwner('user-a');
        replaceTasks([normalizeTask({ id: TASK, text: 'Saved', version: 1, subtasks: [ITEM2] })]);
        answers = [];
        vi.stubGlobal('fetch', vi.fn(() => {
            const answer = createDeferred();
            answers.push(answer);
            return answer.promise;
        }));
    });

    afterEach(async () => {
        answers.forEach((answer) => answer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 })));
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        setOfflineQueueOwner(null);
    });

    // T5: a checklist write carries no expectedVersion, so its answer's
    // version can include another device's edit (here v2 by another device,
    // then the toggle makes v3). The drained task edit behind it is moved to
    // v3, and every task patch sends all fields: the next sync overwrites
    // the other device's edit without a 409.
    // Only a checkout with the sign-out wait (settlePendingTaskSyncs) has this path.
    it.skipIf(!engine.settlePendingTaskSyncs)('T5: does not move a queued task edit past a version another device wrote', async () => {
        const { settlePendingTaskSyncs } = engine;
        toggleSubtask(TASK, ITEM2.id);
        await vi.advanceTimersByTimeAsync(0);
        updateTask(TASK, { priority: 'high' });
        const settling = settlePendingTaskSyncs({ timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        await settling;
        // The server had another device's text edit at v2; the toggle made v3.
        answers[0].resolve(jsonResponse({ task: { id: TASK, text: 'Other device text', version: 3, subtasks: [{ ...ITEM2, done: true }] } }));
        await vi.advanceTimersByTimeAsync(0);

        const queued = /** @type {any} */ (loadOfflineQueue()[0]);
        expect({ text: queued.patch.text, expectedVersion: queued.patch.expectedVersion }).toEqual({ text: 'Saved', expectedVersion: 1 });
    });
});
