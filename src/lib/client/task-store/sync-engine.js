import { get } from 'svelte/store';
import {
    createServerChecklistItem,
    deleteServerChecklistItem,
    deleteServerTask,
    updateServerChecklistItem,
    updateServerTask
} from '../task-api.js';
import { isServerId } from '../../shared/task-rules.js';
import { enqueueOfflineMutation, getOfflineQueueOwner, loadOfflineQueue } from '../offline-write-queue.js';
import { normalizeTask, normalizeTaskList } from '../../shared/task-domain.js';
import { getTaskStorageOwner, mergeTasks, tasks } from './task-cache.js';

/**
 * One server write in a task's chain, bound to the board it was made on:
 * the offline queue owner and the task store owner when it was chained. A
 * sign-out stops waiting for a request after its timeout, so the answer
 * can come after the queue and the store have moved on to another user.
 * The write keeps its own owners: a failure worth retrying goes to its
 * queue owner's queue, and a success is applied only while the store
 * still holds its store owner's board.
 *
 * - drained: it moved to the offline queue before it started, and never
 *   runs.
 * - discarded: a sign-out cleared its user's local data. It never runs,
 *   or, if its request is out, neither queues itself nor applies its
 *   answer.
 * - taskStateQueued: while its request was out, a later snapshot patch or
 *   delete of the task moved to the queue. That write was built from the
 *   store after this one started, so it holds every field a snapshot
 *   patch sends, newer.
 * @typedef {{
 *   taskId: string;
 *   queueOwnerId: string;
 *   storeOwnerId: string | null;
 *   drained: boolean;
 *   discarded: boolean;
 *   taskStateQueued: boolean;
 * }} TaskSyncWrite
 */

/**
 * Server writes for one task run strictly one at a time. Rapid edits used to
 * fire concurrent PATCHes whose stale expectedVersion produced spurious 409
 * conflicts that dropped the user's own changes.
 * @type {Map<string, Promise<void>>}
 */
const taskSyncChains = new Map();

/**
 * Tasks with a queued-but-unstarted snapshot sync. A queued sync reads the
 * store when it runs, so scheduling a second one would only duplicate work.
 * @type {Set<string>}
 */
const queuedSnapshotSyncs = new Set();

/**
 * Local checklist item ids resolved to server ids by an in-flight create,
 * so chained follow-up edits can target the server item.
 * @type {Map<string, string>}
 */
const resolvedChecklistItemIds = new Map();

/**
 * Local checklist item ids created per task, so their resolved-id mappings can
 * be pruned once the task's chain drains (the store holds server ids by then).
 * @type {Map<string, Set<string>>}
 */
const chainedChecklistItemsByTask = new Map();

/**
 * Latest server version observed per task across chained responses. Needed by
 * delete ops whose task is already gone from the store.
 * @type {Map<string, number>}
 */
const latestServerVersions = new Map();

/**
 * Queued-but-unstarted chain ops exist only in memory. Each entry can rebuild
 * itself as an offline mutation so a page unload does not silently discard it.
 * @type {Map<TaskSyncWrite, () => import('../offline-write-queue.js').OfflineMutationInput | null>}
 */
const pendingChainOpDescriptors = new Map();

/**
 * Chain writes that have started and not yet settled: their request may be
 * out.
 * @type {Set<TaskSyncWrite>}
 */
const writesInFlight = new Set();

/**
 * A task with in-flight or queued chain ops has local state newer than any
 * snapshot or sibling-tab cache; replacing it wholesale would make the queued
 * op (which rebuilds its patch from the store at send time) push the reverted
 * values back to the server.
 * @param {string} taskId
 */
export function hasPendingTaskSync(taskId) {
    return taskSyncChains.has(taskId) || queuedSnapshotSyncs.has(taskId);
}

/**
 * @param {unknown[]} serverTasks
 */
export function applyServerTaskSnapshot(serverTasks) {
    const incoming = normalizeTaskList(serverTasks).filter((task) => isServerId(task.id));
    tasks.update((current) => {
        const currentById = new Map(current.map((task) => [task.id, task]));
        const pendingLocalTasks = current.filter((task) => !isServerId(task.id));
        const incomingIds = new Set(incoming.map((task) => task.id));
        const authoritativeTasks = incoming.map((task) => {
            const existing = currentById.get(task.id);
            if (!existing) {
                return task;
            }

            if (hasPendingTaskSync(task.id)) {
                rememberServerVersion(task);
                return typeof task.version === 'number'
                    && (typeof existing.version !== 'number' || task.version > existing.version)
                    ? { ...existing, version: task.version }
                    : existing;
            }

            return { ...task, collapsed: existing.collapsed };
        });
        const busyTasksMissingFromSnapshot = current.filter((task) =>
            isServerId(task.id) && !incomingIds.has(task.id) && hasPendingTaskSync(task.id)
        );

        return normalizeTaskList([...pendingLocalTasks, ...authoritativeTasks, ...busyTasksMissingFromSnapshot]);
    });
}

/**
 * Applies per-task server responses from a queue flush with the same
 * busy-chain protection as chained responses.
 * @param {import('../../shared/task-domain.js').Task[]} serverTasks
 */
export function applyServerTaskResults(serverTasks) {
    serverTasks.forEach((serverTask) => applyServerTaskResult(normalizeTask(serverTask)));
}

/**
 * Advances tasks to the versions a category rename, merge or delete left them
 * at. Those writes rewrite every task in the category on the server and bump
 * its version by one; the caller has made the same change locally, so only
 * the version moves here. A copy left on the old version would send a stale
 * expectedVersion with its next edit and get a false 409.
 *
 * An idle task moves only from exactly one version behind: that proves its
 * copy was current before the category write. A copy further behind missed
 * an edit from another device, and must keep its old version so its next
 * edit gets the real 409 instead of overwriting that edit (every patch sends
 * all fields). A task with a sync in flight or queued may already count its
 * own write in the reported version, so it moves forward by any amount and
 * also records the version for its chain, as a snapshot does; that chain
 * reports its own conflicts. latestServerVersions is dropped when a chain
 * drains, so an idle task needs only the store.
 * @param {{ id: string; version: number }[]} taskVersions
 */
export function applyServerTaskVersions(taskVersions) {
    const versionById = new Map(taskVersions.map((entry) => [entry.id, entry.version]));
    if (versionById.size === 0) {
        return;
    }

    versionById.forEach((version, id) => {
        if (hasPendingTaskSync(id)) {
            rememberServerVersion({ id, version });
        }
    });
    tasks.update((current) => current.map((task) => {
        const version = versionById.get(task.id);
        if (version === undefined) {
            return task;
        }

        const advances = typeof task.version !== 'number'
            || (hasPendingTaskSync(task.id) ? version > task.version : version === task.version + 1);
        return advances ? { ...task, version } : task;
    }));
}

/**
 * @param {string} taskId
 * @param {(write: TaskSyncWrite) => Promise<void>} operation
 * @param {(() => import('../offline-write-queue.js').OfflineMutationInput | null) | null} [buildDrainMutation]
 */
function enqueueTaskSyncOperation(taskId, operation, buildDrainMutation = null) {
    /** @type {TaskSyncWrite} */
    const write = {
        taskId,
        queueOwnerId: getOfflineQueueOwner(),
        storeOwnerId: getTaskStorageOwner(),
        drained: false,
        discarded: false,
        taskStateQueued: false
    };
    if (buildDrainMutation) {
        pendingChainOpDescriptors.set(write, buildDrainMutation);
    }

    const previous = taskSyncChains.get(taskId) ?? Promise.resolve();
    const next = previous
        .then(async () => {
            pendingChainOpDescriptors.delete(write);
            if (write.drained || write.discarded) {
                return;
            }

            writesInFlight.add(write);
            try {
                await operation(write);
            } finally {
                writesInFlight.delete(write);
            }
        })
        .catch((error) => {
            console.error('Failed to run task sync operation', error);
        });
    taskSyncChains.set(taskId, next);
    void next.finally(() => {
        if (taskSyncChains.get(taskId) === next) {
            taskSyncChains.delete(taskId);
            latestServerVersions.delete(taskId);
            const chainedItems = chainedChecklistItemsByTask.get(taskId);
            if (chainedItems) {
                chainedItems.forEach((itemId) => resolvedChecklistItemIds.delete(itemId));
                chainedChecklistItemsByTask.delete(taskId);
            }
        }
    });
    return next;
}

/**
 * Test-only: clears all per-task sync bookkeeping so a test that leaves an
 * unsettled request behind cannot wedge every later test in the same file.
 * Already-started ops keep running but detach from fresh state.
 */
export function resetTaskSyncStateForTests() {
    taskSyncChains.clear();
    queuedSnapshotSyncs.clear();
    resolvedChecklistItemIds.clear();
    chainedChecklistItemsByTask.clear();
    latestServerVersions.clear();
    pendingChainOpDescriptors.clear();
    writesInFlight.clear();
}

/**
 * Moves every queued-but-unstarted chain op into the durable offline queue
 * of the user it was made for. Call on pagehide and before programmatic
 * reloads: in-flight requests may still land, but nothing queued behind
 * them is lost with the page.
 */
export function drainPendingTaskSyncsToOfflineQueue() {
    const descriptors = [...pendingChainOpDescriptors.entries()];
    pendingChainOpDescriptors.clear();
    for (const [write, buildDrainMutation] of descriptors) {
        write.drained = true;
        const mutation = buildDrainMutation();
        if (!mutation) {
            continue;
        }

        enqueueOfflineMutation(mutation, { ownerId: write.queueOwnerId });
        if (mutation.type === 'task.patch' || mutation.type === 'task.delete') {
            writesInFlight.forEach((inFlight) => {
                if (inFlight.taskId === mutation.taskId && inFlight.queueOwnerId === write.queueOwnerId) {
                    inFlight.taskStateQueued = true;
                }
            });
        }
    }
}

/**
 * The number of task writes made for the offline queue's current owner
 * that wait in a chain or wait for their answer. Sign-out asks before it
 * clears local data, and counts these with the queued changes: a request
 * still out when its wait ended may yet fail and need the queue.
 */
export function countPendingTaskSyncs() {
    const owner = getOfflineQueueOwner();
    return [...pendingChainOpDescriptors.keys(), ...writesInFlight]
        .filter((write) => write.queueOwnerId === owner)
        .length;
}

/**
 * Drops the task writes made for the offline queue's current owner, for a
 * sign-out that clears that user's data from this device. Writes still
 * waiting in a chain are never sent. A request still out keeps going, but
 * if it fails its edit is not queued again after the clear, and if it
 * lands its answer is not applied.
 */
export function discardPendingTaskSyncs() {
    const owner = getOfflineQueueOwner();
    for (const write of [...pendingChainOpDescriptors.keys(), ...writesInFlight]) {
        if (write.queueOwnerId !== owner) {
            continue;
        }

        write.discarded = true;
        writesInFlight.delete(write);
        if (pendingChainOpDescriptors.delete(write)) {
            // A snapshot sync removes its task from this set when it runs or
            // drains. It does neither now, and left there the task's next
            // edit would count on it and never be sent.
            queuedSnapshotSyncs.delete(write.taskId);
        }
    }
}

/**
 * Resolves once every queued per-task server write has settled. Server
 * snapshots applied before this point could revert in-flight optimistic state.
 */
export async function waitForPendingTaskSyncs() {
    while (taskSyncChains.size > 0) {
        await Promise.allSettled([...taskSyncChains.values()]);
    }
}

/**
 * Lets the per-task server writes finish before the session ends. Sign-out
 * calls this first: a write sent after the session ended would get 401 and
 * have to wait in the offline queue for the user's next sign-in.
 *
 * Waits up to `timeoutMs` for every write chain to settle, so edits made
 * just before are sent while the session is still valid. Writes that have
 * not started by then move to the offline queue of the user still signed
 * in, as on a page unload. A request already in flight keeps going, bound
 * to that user (TaskSyncWrite): if it fails in a way worth retrying after
 * the sign-out, it goes to that user's queue, not to whoever owns the
 * queue by then, and if it lands, its answer is applied only while the
 * store still holds that user's board. A failed task edit queues nothing
 * when a later edit of the task moved to the queue at the timeout: that
 * edit holds all of its fields, newer.
 *
 * Until it settles, countPendingTaskSyncs counts the request, so the
 * "clear local data" question that follows includes it, and a confirmed
 * clear drops it with discardPendingTaskSyncs.
 * @param {{ timeoutMs: number }} options
 * @returns {Promise<boolean>} whether every chain settled in time
 */
export async function settlePendingTaskSyncs({ timeoutMs }) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const settled = await Promise.race([
        waitForPendingTaskSyncs().then(() => true),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        })
    ]);
    clearTimeout(timer);
    if (!settled) {
        drainPendingTaskSyncsToOfflineQueue();
    }
    return settled;
}

/**
 * @param {{ id: string; version?: number }} serverTask
 */
function rememberServerVersion(serverTask) {
    if (typeof serverTask.version !== 'number') {
        return;
    }

    const known = latestServerVersions.get(serverTask.id);
    if (known === undefined || serverTask.version > known) {
        latestServerVersions.set(serverTask.id, serverTask.version);
    }
}

/**
 * Merges a per-task server response. While a newer local edit is still queued,
 * only the version advances (plus any resolved checklist item ids, so a reload
 * cannot strand items under local ids) and optimistic fields stay untouched.
 * @param {import('../../shared/task-domain.js').Task} serverTask
 */
function applyServerTaskResult(serverTask) {
    rememberServerVersion(serverTask);
    if (!queuedSnapshotSyncs.has(serverTask.id)) {
        mergeTasks([serverTask], { insertMissing: false });
        return;
    }

    tasks.update((current) => current.map((task) => {
        if (task.id !== serverTask.id) {
            return task;
        }

        const next = typeof serverTask.version === 'number'
            && (typeof task.version !== 'number' || serverTask.version > task.version)
            ? { ...task, version: serverTask.version }
            : task;
        const subtasks = next.subtasks.map((item) => {
            const resolvedId = resolvedChecklistItemIds.get(item.id);
            return resolvedId ? { ...item, id: resolvedId } : item;
        });

        return subtasks.some((item, index) => item !== next.subtasks[index])
            ? { ...next, subtasks }
            : next;
    }));
}

/**
 * @param {import('../../shared/task-domain.js').Task | null} task
 */
export function syncTaskSnapshot(task) {
    if (!task || typeof window === 'undefined') {
        return;
    }

    if (!isServerId(task.id)) {
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId: task.id,
            localParentId: getLocalParentId(task),
            patch: toServerTaskPatch(task)
        });
        return;
    }

    scheduleTaskSnapshotSync(task.id);
}

/**
 * @param {string} taskId
 */
function scheduleTaskSnapshotSync(taskId) {
    if (queuedSnapshotSyncs.has(taskId)) {
        return;
    }

    queuedSnapshotSyncs.add(taskId);
    enqueueTaskSyncOperation(taskId, async (write) => {
        queuedSnapshotSyncs.delete(taskId);
        const current = get(tasks).find((item) => item.id === taskId);
        if (!current) {
            return;
        }

        const patch = toChainedServerTaskPatch(taskId, current);
        const result = await updateServerTask(taskId, patch);
        if (result.ok) {
            applyWriteResult(write, result.task);
            return;
        }

        // The queue merges a task's patches with the later one on top.
        // Queued after the newer edit already there, this patch would put
        // its older values back over it.
        reportSyncFailure(write, result, write.taskStateQueued ? null : {
            type: 'task.patch',
            taskId,
            localParentId: getLocalParentId(current),
            patch
        });
    }, () => {
        queuedSnapshotSyncs.delete(taskId);
        const current = get(tasks).find((item) => item.id === taskId);
        if (!current) {
            return null;
        }

        return {
            type: 'task.patch',
            taskId,
            localParentId: getLocalParentId(current),
            patch: toChainedServerTaskPatch(taskId, current)
        };
    });
}

/**
 * The snapshot patch for a chained sync. A response earlier in the chain may
 * have reported a newer version than the store's copy holds; expectedVersion
 * uses whichever is newer.
 * @param {string} taskId
 * @param {import('../../shared/task-domain.js').Task} current
 */
function toChainedServerTaskPatch(taskId, current) {
    const knownVersion = latestServerVersions.get(taskId);
    return toServerTaskPatch(
        typeof knownVersion === 'number' && (typeof current.version !== 'number' || knownVersion > current.version)
            ? { ...current, version: knownVersion }
            : current
    );
}

/**
 * @param {string} taskId
 * @param {import('../../shared/task-domain.js').Task | null} [task]
 */
export function syncTaskDelete(taskId, task = null) {
    if (typeof window === 'undefined') {
        return;
    }

    const capturedVersion = typeof task?.version === 'number' ? task.version : undefined;
    if (!isServerId(taskId)) {
        enqueueOfflineMutation({
            type: 'task.delete',
            taskId,
            ...(capturedVersion === undefined ? {} : { expectedVersion: capturedVersion })
        });
        return;
    }

    enqueueTaskSyncOperation(taskId, async (write) => {
        const expectedVersion = latestServerVersions.get(taskId) ?? capturedVersion;
        const result = await deleteServerTask(taskId, expectedVersion === undefined ? {} : { expectedVersion });
        if (!result.ok) {
            reportSyncFailure(write, result, {
                type: 'task.delete',
                taskId,
                ...(expectedVersion === undefined ? {} : { expectedVersion })
            });
        }
    }, () => {
        const expectedVersion = latestServerVersions.get(taskId) ?? capturedVersion;
        return {
            type: 'task.delete',
            taskId,
            ...(expectedVersion === undefined ? {} : { expectedVersion })
        };
    });
}

/**
 * @param {import('../../shared/task-domain.js').Task[]} taskList
 */
export async function syncClearDoneTasks(taskList) {
    if (typeof window === 'undefined') {
        return;
    }

    const doneIds = new Set(taskList.filter((task) => task.status === 'done').map((task) => task.id));
    if (doneIds.size === 0) {
        return;
    }

    for (const task of taskList) {
        if (task.status !== 'done' || hasDoneAncestor(taskList, task, doneIds)) {
            continue;
        }

        syncTaskDelete(task.id, task);
    }
}

/**
 * @param {import('../../shared/task-domain.js').Task[]} taskList
 * @param {import('../../shared/task-domain.js').Task} task
 * @param {Set<string>} doneIds
 */
function hasDoneAncestor(taskList, task, doneIds) {
    const byId = new Map(taskList.map((item) => [item.id, item]));
    let parentId = task.parentId;
    while (parentId) {
        if (doneIds.has(parentId)) {
            return true;
        }

        parentId = byId.get(parentId)?.parentId ?? null;
    }

    return false;
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {string} text
 */
export function syncChecklistCreate(taskId, subtaskId, text) {
    if (typeof window === 'undefined') {
        return;
    }

    if (!isServerId(taskId)) {
        enqueueOfflineMutation({
            type: 'checklist.create',
            taskId,
            localItemId: subtaskId,
            text
        });
        return;
    }

    const chainedItems = chainedChecklistItemsByTask.get(taskId) ?? new Set();
    chainedItems.add(subtaskId);
    chainedChecklistItemsByTask.set(taskId, chainedItems);
    enqueueTaskSyncOperation(taskId, async (write) => {
        const knownItemIds = new Set(
            (get(tasks).find((task) => task.id === taskId)?.subtasks ?? [])
                .map((subtask) => subtask.id)
                .filter((id) => isServerId(id))
        );
        const result = await createServerChecklistItem(taskId, text);
        if (result.ok) {
            const createdItem = findNewChecklistItem(result.task, knownItemIds, text);
            if (createdItem) {
                resolvedChecklistItemIds.set(subtaskId, createdItem.id);
            }
            applyWriteResult(write, result.task);
            return;
        }

        reportSyncFailure(write, result, {
            type: 'checklist.create',
            taskId,
            localItemId: subtaskId,
            text
        });
    }, () => ({
        type: 'checklist.create',
        taskId,
        localItemId: subtaskId,
        text
    }));
}

/**
 * @param {import('../../shared/task-domain.js').Task} serverTask
 * @param {Set<string>} knownItemIds
 * @param {string} text
 */
function findNewChecklistItem(serverTask, knownItemIds, text) {
    const freshItems = serverTask.subtasks.filter((item) => isServerId(item.id) && !knownItemIds.has(item.id));
    return [...freshItems].reverse().find((item) => item.text === text) ?? freshItems[freshItems.length - 1] ?? null;
}

/**
 * A follow-up edit to a checklist item whose create is still in flight joins
 * the same per-task chain and resolves the server item id when it runs.
 * @param {string} taskId
 * @param {string} subtaskId
 */
function shouldChainLocalChecklistEdit(taskId, subtaskId) {
    return !isServerId(subtaskId)
        && (resolvedChecklistItemIds.has(subtaskId) || taskSyncChains.has(taskId));
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {{ text?: string; done?: boolean }} patch
 */
export function syncChecklistPatch(taskId, subtaskId, patch) {
    if (typeof window === 'undefined') {
        return;
    }

    if (!isServerId(taskId) || (!isServerId(subtaskId) && !shouldChainLocalChecklistEdit(taskId, subtaskId))) {
        enqueueOfflineMutation({
            type: 'checklist.patch',
            taskId,
            itemId: subtaskId,
            patch
        });
        return;
    }

    enqueueTaskSyncOperation(taskId, async (write) => {
        const itemId = isServerId(subtaskId) ? subtaskId : resolvedChecklistItemIds.get(subtaskId);
        if (!itemId) {
            queueWrite(write, {
                type: 'checklist.patch',
                taskId,
                itemId: subtaskId,
                patch
            });
            return;
        }

        const result = await updateServerChecklistItem(taskId, itemId, patch);
        if (result.ok) {
            applyWriteResult(write, result.task);
            return;
        }

        reportSyncFailure(write, result, {
            type: 'checklist.patch',
            taskId,
            itemId,
            patch
        });
    }, () => buildChecklistDrainMutation(taskId, subtaskId, patch));
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function syncChecklistDelete(taskId, subtaskId) {
    if (typeof window === 'undefined') {
        return;
    }

    if (!isServerId(taskId) || (!isServerId(subtaskId) && !shouldChainLocalChecklistEdit(taskId, subtaskId))) {
        enqueueOfflineMutation({
            type: 'checklist.delete',
            taskId,
            itemId: subtaskId
        });
        return;
    }

    enqueueTaskSyncOperation(taskId, async (write) => {
        const itemId = isServerId(subtaskId) ? subtaskId : resolvedChecklistItemIds.get(subtaskId);
        if (!itemId) {
            queueWrite(write, {
                type: 'checklist.delete',
                taskId,
                itemId: subtaskId
            });
            return;
        }

        const result = await deleteServerChecklistItem(taskId, itemId);
        if (result.ok) {
            applyWriteResult(write, result.task);
            return;
        }

        reportSyncFailure(write, result, {
            type: 'checklist.delete',
            taskId,
            itemId
        });
    }, () => buildChecklistDrainMutation(taskId, subtaskId, null));
}

/**
 * Drain builder for a chained checklist edit. When the item's create is still
 * in flight at page unload, a patch/delete drained under the local id would be
 * silently discarded by the queue's coalescing (no pending create to merge
 * into). Re-create the item with its final local state instead — worst case a
 * visible duplicate if the aborted POST also landed, which beats a silent drop.
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {{ text?: string; done?: boolean } | null} patch null means delete
 * @returns {import('../offline-write-queue.js').OfflineMutationInput | null}
 */
function buildChecklistDrainMutation(taskId, subtaskId, patch) {
    const itemId = isServerId(subtaskId) ? subtaskId : resolvedChecklistItemIds.get(subtaskId);
    if (itemId) {
        return patch
            ? { type: 'checklist.patch', taskId, itemId, patch }
            : { type: 'checklist.delete', taskId, itemId };
    }

    const hasQueuedCreate = loadOfflineQueue().some((mutation) =>
        mutation.type === 'checklist.create'
        && mutation.taskId === taskId
        && mutation.localItemId === subtaskId
    );
    if (hasQueuedCreate) {
        // Coalesces into (patch) or cancels out (delete) the queued create.
        return patch
            ? { type: 'checklist.patch', taskId, itemId: subtaskId, patch }
            : { type: 'checklist.delete', taskId, itemId: subtaskId };
    }

    if (!patch) {
        // The create never reached the queue or (likely) the server; there is
        // nothing durable to delete.
        return null;
    }

    const item = get(tasks)
        .find((task) => task.id === taskId)?.subtasks
        .find((subtask) => subtask.id === subtaskId);
    if (!item) {
        return null;
    }

    return {
        type: 'checklist.create',
        taskId,
        localItemId: subtaskId,
        text: item.text,
        ...(item.done ? { done: true } : {})
    };
}

/**
 * @param {import('../../shared/task-domain.js').Task} task
 */
function getLocalParentId(task) {
    return task.parentId && !isServerId(task.parentId) ? task.parentId : null;
}

/**
 * @param {import('../../shared/task-domain.js').Task} task
 */
function toServerTaskPatch(task) {
    return {
        text: task.text,
        status: task.status,
        startDate: task.startDate,
        endDate: task.endDate,
        priority: task.priority,
        urgency: task.urgency,
        category: task.category,
        categoryId: task.categoryId ?? null,
        // A null categoryId means "find the category by name", not "clear
        // it"; an empty name still clears it. The server clears for clients
        // that do not send this.
        categoryByName: true,
        parentId: isServerId(task.parentId) ? task.parentId : null,
        ...(typeof task.version === 'number' ? { expectedVersion: task.version } : {})
    };
}

/**
 * Applies a chained write's server answer, unless the store holds another
 * user's board by now: the answer is about the board the write was made
 * on, and a copy of the task there is no business of another user's.
 * @param {TaskSyncWrite} write
 * @param {import('../../shared/task-domain.js').Task} serverTask
 */
function applyWriteResult(write, serverTask) {
    if (write.discarded || getTaskStorageOwner() !== write.storeOwnerId) {
        return;
    }

    applyServerTaskResult(serverTask);
}

/**
 * Puts a write that was not sent, or failed in a way worth retrying, in
 * the offline queue of the user it was made for, even when the queue has
 * moved on to another user since, unless that user cleared their local
 * data meanwhile.
 * @param {TaskSyncWrite} write
 * @param {import('../offline-write-queue.js').OfflineMutationInput} mutation
 */
function queueWrite(write, mutation) {
    if (write.discarded) {
        return;
    }

    enqueueOfflineMutation(mutation, { ownerId: write.queueOwnerId });
}

/**
 * @param {TaskSyncWrite} write
 * @param {{ ok: true } | { ok: false; fallback: boolean; message: string; status?: number }} result
 * @param {import('../offline-write-queue.js').OfflineMutationInput | null} [mutation]
 *   what to queue on a failure worth retrying; null queues nothing
 */
function reportSyncFailure(write, result, mutation) {
    if (!result.ok && !result.fallback) {
        console.error('Failed to sync task mutation', result.message);
        return;
    }

    if (!result.ok && result.fallback && mutation) {
        queueWrite(write, mutation);
    }
}
