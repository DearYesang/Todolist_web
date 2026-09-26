import { get } from 'svelte/store';
import {
    createServerChecklistItem,
    deleteServerChecklistItem,
    deleteServerTask,
    updateServerChecklistItem,
    updateServerTask
} from '../task-api.js';
import { isServerId } from '../../shared/task-rules.js';
import {
    advanceQueuedTaskVersion,
    dropQueuedChecklistFields,
    dropQueuedTaskPatch,
    enqueueOfflineMutation,
    getOfflineQueueOwner,
    hasQueuedTaskMutation,
    loadOfflineQueue,
    resolveQueuedChecklistCreate
} from '../offline-write-queue.js';
import { normalizeTask, normalizeTaskList } from '../../shared/task-domain.js';
import { getTaskStorageOwner, mergeTasks, tasks, updateCachedTaskOf } from './task-cache.js';

/**
 * One server write in a task's chain, bound to the board it was made on:
 * the offline queue owner and the task store owner when it was chained. A
 * sign-out stops waiting for a request after its timeout, so the answer
 * can come after the queue and the store have moved on to another user.
 * The write keeps its own owners: a failure worth retrying goes to its
 * queue owner's queue, and a success is applied only while the store
 * still holds its store owner's board.
 *
 * - item: for a checklist write, the item it creates, edits or deletes,
 *   by the id the board gave it when the write was made (a local id until
 *   its create lands), and the fields an edit sets.
 * - drained: it moved to the offline queue before it started, and never
 *   runs.
 * - discarded: a sign-out cleared its user's local data. It never runs,
 *   or, if its request is out, neither queues itself nor applies its
 *   answer.
 * - taskStateQueued: while its request was out, a later snapshot patch or
 *   delete of the task moved to the queue. That write was built from the
 *   store after this one started, so it holds every field a snapshot
 *   patch sends, newer, and the version this request started from.
 * - queuedItemEdits: while its request was out, later writes of the
 *   task's checklist items moved to the queue: by item (its server id, or
 *   its local id while its create is out), the fields they set and
 *   whether one deleted it. The queue holds those items' newer state, so
 *   this write queues nothing they cover when it fails, and a create that
 *   lands hands them the item it made (see syncChecklistCreate).
 *
 * When either of those two holds, the board is newer than the request's
 * answer, and the answer moves only the task's version there.
 *
 * - olderQueuedEdit: for a snapshot sync or a checklist edit, the user's
 *   queued edit of the task or of the item that this write is newer than,
 *   as the queue held it then: queued before the user made the edit this
 *   write sends (for a snapshot sync, the board held it then, so the
 *   patch holds its fields), or by an earlier write of the task in this
 *   chain that failed while this one waited. Once this write lands, what
 *   it covers of that edit goes from the queue, if the queue still holds
 *   it so (see dropQueuedTaskPatch and dropQueuedChecklistFields). The
 *   queue is shared by every tab of the user, so an edit queued after
 *   that, or changed since, can be newer, and stays.
 * - boardBeforeEdit: for a snapshot sync, the task as the board held it
 *   just before the first edit this write sends, as a snapshot patch.
 * @typedef {{
 *   taskId: string;
 *   item: ChecklistWriteItem | null;
 *   queueOwnerId: string;
 *   storeOwnerId: string | null;
 *   drained: boolean;
 *   discarded: boolean;
 *   taskStateQueued: boolean;
 *   queuedItemEdits: Map<string, { deleted: boolean; fields: Set<string> }>;
 *   olderQueuedEdit: import('../offline-write-queue.js').QueuedEdit | null;
 *   boardBeforeEdit: Record<string, unknown> | null;
 * }} TaskSyncWrite
 *
 * @typedef {{ id: string; change: 'create' | 'patch' | 'delete'; fields: string[] }} ChecklistWriteItem
 */

/**
 * Server writes for one task run strictly one at a time. Rapid edits used to
 * fire concurrent PATCHes whose stale expectedVersion produced spurious 409
 * conflicts that dropped the user's own changes.
 * @type {Map<string, Promise<void>>}
 */
const taskSyncChains = new Map();

/**
 * Tasks with a queued-but-unstarted snapshot sync, and its write. A queued
 * sync reads the store when it runs, so scheduling a second one would only
 * duplicate work.
 * @type {Map<string, TaskSyncWrite>}
 */
const queuedSnapshotSyncs = new Map();

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
 * @param {ChecklistWriteItem | null} [item] the checklist item the write is about
 */
function enqueueTaskSyncOperation(taskId, operation, buildDrainMutation = null, item = null) {
    /** @type {TaskSyncWrite} */
    const write = {
        taskId,
        item,
        queueOwnerId: getOfflineQueueOwner(),
        storeOwnerId: getTaskStorageOwner(),
        drained: false,
        discarded: false,
        taskStateQueued: false,
        queuedItemEdits: new Map(),
        olderQueuedEdit: null,
        boardBeforeEdit: null
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
    return write;
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
        if (mutation) {
            enqueueOfflineMutation(mutation, { ownerId: write.queueOwnerId });
        }
        markQueuedBehindRequestsInFlight(write, mutation);
    }
}

/**
 * Tells the requests still out for a drained write's task, made for the
 * same user, what the queue now holds after them (TaskSyncWrite). A
 * checklist write counts even when the drain queued nothing for it: the
 * delete of an item whose create is out has nothing to delete yet.
 * @param {TaskSyncWrite} drained
 * @param {import('../offline-write-queue.js').OfflineMutationInput | null} mutation what the drain queued for it
 */
function markQueuedBehindRequestsInFlight(drained, mutation) {
    const { item } = drained;
    writesInFlight.forEach((inFlight) => {
        if (inFlight.taskId !== drained.taskId || inFlight.queueOwnerId !== drained.queueOwnerId) {
            return;
        }

        if (!item) {
            if (mutation?.type === 'task.patch' || mutation?.type === 'task.delete') {
                inFlight.taskStateQueued = true;
            }
            return;
        }

        const itemKey = resolveChecklistItemId(item.id);
        const edits = inFlight.queuedItemEdits.get(itemKey) ?? { deleted: false, fields: new Set() };
        if (item.change === 'delete') {
            edits.deleted = true;
        }
        item.fields.forEach((field) => edits.fields.add(field));
        inFlight.queuedItemEdits.set(itemKey, edits);
    });
}

/**
 * The later writes of a checklist write's item that moved to the queue
 * while its request was out, if any.
 * @param {TaskSyncWrite} write
 */
function getQueuedEditsOfItem(write) {
    if (!write.item) {
        return undefined;
    }

    // A create's item has no server id until the create lands; the drain
    // named it by its local id.
    return write.queuedItemEdits.get(
        write.item.change === 'create' ? write.item.id : resolveChecklistItemId(write.item.id)
    );
}

/**
 * A checklist item's server id: its own, or the one a create in this
 * task's chain resolved its local id to. An item whose create has not
 * landed keeps its local id.
 * @param {string} itemId
 */
function resolveChecklistItemId(itemId) {
    return isServerId(itemId) ? itemId : resolvedChecklistItemIds.get(itemId) ?? itemId;
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
 * store still holds that user's board. When a later edit of the task moved
 * to the queue at the timeout, a failed task edit queues nothing, since
 * that edit holds all of its fields, newer; and a request that lands at
 * the next version moves that edit to it, and changes only the version
 * on the board. A failed checklist write queues only what later
 * queued writes of its item do not cover, and a checklist create that
 * lands turns them into writes of the item it made.
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
 * @param {{ newerEditQueued?: boolean }} [options]
 *   newerEditQueued: a newer edit of the task is in the offline queue, not
 *   in its chain
 */
function applyServerTaskResult(serverTask, { newerEditQueued = false } = {}) {
    rememberServerVersion(serverTask);
    if (!newerEditQueued && !queuedSnapshotSyncs.has(serverTask.id)) {
        mergeTasks([serverTask], { insertMissing: false });
        return;
    }

    tasks.update((current) => current.map((task) =>
        task.id === serverTask.id ? advanceToServerTask(task, serverTask) : task
    ));
}

/**
 * A copy of a task newer than a server answer for it, moved on only where
 * the answer is ahead: to the answer's version when newer, and to the
 * server ids that creates in the task's chain gave its local checklist
 * items.
 * @param {import('../../shared/task-domain.js').Task} task
 * @param {import('../../shared/task-domain.js').Task} serverTask
 */
function advanceToServerTask(task, serverTask) {
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
}

/**
 * @param {import('../../shared/task-domain.js').Task | null} task
 * @param {import('../../shared/task-domain.js').Task | null} [previous] the
 *   task as the board held it just before this edit
 */
export function syncTaskSnapshot(task, previous = null) {
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

    scheduleTaskSnapshotSync(task.id, previous);
}

/**
 * @param {string} taskId
 * @param {import('../../shared/task-domain.js').Task | null} previous the
 *   task as the board held it just before the edit to send
 */
function scheduleTaskSnapshotSync(taskId, previous) {
    const write = queuedSnapshotSyncs.get(taskId) ?? queueTaskSnapshotSync(taskId);
    if (!previous) {
        return;
    }

    // The patch is built from the board after this edit, and the task
    // stays as the board has it until then (hasPendingTaskSync), so it
    // holds the queued edit of the task if the board did just before.
    const boardBeforeEdit = toServerTaskPatch(previous);
    write.boardBeforeEdit ??= boardBeforeEdit;
    write.olderQueuedEdit = findQueuedTaskPatchHeldBy(taskId, boardBeforeEdit, write.queueOwnerId) ?? write.olderQueuedEdit;
}

/**
 * Chains a snapshot sync of the task, which waits in queuedSnapshotSyncs
 * until it starts.
 * @param {string} taskId
 */
function queueTaskSnapshotSync(taskId) {
    const snapshotWrite = enqueueTaskSyncOperation(taskId, async (write) => {
        queuedSnapshotSyncs.delete(taskId);
        const current = get(tasks).find((item) => item.id === taskId);
        if (!current) {
            return;
        }

        const patch = toChainedServerTaskPatch(taskId, current);
        const result = await updateServerTask(taskId, patch);
        if (result.ok) {
            // The patch holds the fields of the older queued edit this
            // write noted (olderQueuedEdit). Sent at the next sync, that
            // edit would meet a 409 on the version this one moved past, or
            // put its older values back. An edit queued while this request
            // was out (taskStateQueued) is newer, and moves to this one's
            // version instead.
            if (!write.discarded && !write.taskStateQueued && write.olderQueuedEdit) {
                dropQueuedTaskPatch(taskId, write.olderQueuedEdit, { ownerId: write.queueOwnerId });
            }
            applyWriteResult(write, result.task);
            return;
        }

        // The queue merges a task's patches with the later one on top.
        // Queued after the newer edit already there, this patch would put
        // its older values back over it.
        const queued = reportSyncFailure(write, result, write.taskStateQueued ? null : {
            type: 'task.patch',
            taskId,
            localParentId: getLocalParentId(current),
            patch
        });
        if (queued) {
            handQueuedPatchToWaitingSnapshot(write);
        }
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
    queuedSnapshotSyncs.set(taskId, snapshotWrite);
    return snapshotWrite;
}

/**
 * The user's queued edit of a task, when every field it sets but the
 * version it expects has the value `boardPatch` gives: a copy of the task
 * that `boardPatch` was made from held it.
 * @param {string} taskId
 * @param {Record<string, unknown>} boardPatch
 * @param {string} ownerId
 * @returns {import('../offline-write-queue.js').QueuedEdit | null}
 */
function findQueuedTaskPatchHeldBy(taskId, boardPatch, ownerId) {
    const queued = loadOfflineQueue({ ownerId }).find((mutation) =>
        mutation.type === 'task.patch' && mutation.taskId === taskId
    );
    if (queued?.type !== 'task.patch') {
        return null;
    }

    const held = Object.entries(queued.patch).every(([field, value]) =>
        field === 'expectedVersion' || boardPatch[field] === value
    );
    return held ? { id: queued.id, patch: queued.patch } : null;
}

/**
 * A snapshot sync failed and queued its patch while the task's next
 * snapshot sync waited behind it. The waiting one is built from the board
 * after the user's later edit, so it holds that patch's fields, newer, if
 * the board held them just before that edit; it then retires the patch
 * once it lands (olderQueuedEdit).
 * @param {TaskSyncWrite} failed
 */
function handQueuedPatchToWaitingSnapshot(failed) {
    const waiting = queuedSnapshotSyncs.get(failed.taskId);
    if (!waiting?.boardBeforeEdit || waiting.queueOwnerId !== failed.queueOwnerId) {
        return;
    }

    waiting.olderQueuedEdit = findQueuedTaskPatchHeldBy(failed.taskId, waiting.boardBeforeEdit, failed.queueOwnerId)
        ?? waiting.olderQueuedEdit;
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
        const queuedEdits = getQueuedEditsOfItem(write);
        if (result.ok) {
            const createdItem = findNewChecklistItem(result.task, knownItemIds, text);
            if (createdItem) {
                resolvedChecklistItemIds.set(subtaskId, createdItem.id);
                if (queuedEdits) {
                    handQueuedEditsToCreatedItem(write, subtaskId, createdItem, queuedEdits);
                }
            }
            applyWriteResult(write, result.task);
            return;
        }

        // A later write of the item moved to the queue while this request
        // was out: a create with the item's final text and state, or, for a
        // delete, nothing. Queued as well, this create would add the item a
        // second time, or bring the deleted item back.
        reportSyncFailure(write, result, queuedEdits ? null : {
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
    }), { id: subtaskId, change: 'create', fields: [] });
}

/**
 * A checklist create landed after later writes of its item moved to the
 * offline queue. The drain built them for an item the server did not have
 * yet (buildChecklistDrainMutation): an edit as a create with the item's
 * final state, a delete as nothing. The item exists now, so the queued
 * create becomes an edit of it, and a delete goes to the queue for it.
 * @param {TaskSyncWrite} write
 * @param {string} localItemId
 * @param {import('../../shared/task-domain.js').Subtask} createdItem
 * @param {{ deleted: boolean }} queuedEdits
 */
function handQueuedEditsToCreatedItem(write, localItemId, createdItem, queuedEdits) {
    if (write.discarded) {
        return;
    }

    if (queuedEdits.deleted) {
        queueWrite(write, { type: 'checklist.delete', taskId: write.taskId, itemId: createdItem.id });
        return;
    }

    resolveQueuedChecklistCreate(write.taskId, localItemId, createdItem, { ownerId: write.queueOwnerId });
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

    // An edit of the item already queued is older than this one. An item
    // whose create has not landed has no edit in the queue under its id.
    const serverItemId = isServerId(subtaskId) ? subtaskId : resolvedChecklistItemIds.get(subtaskId);
    const olderQueuedEdit = serverItemId ? findQueuedChecklistPatch(taskId, serverItemId, getOfflineQueueOwner()) : null;
    const write = enqueueTaskSyncOperation(taskId, async (write) => {
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
            dropQueuedFieldsThisEditSet(write, itemId, patch);
            applyWriteResult(write, result.task);
            return;
        }

        // The queue puts a later patch of the item on top of an earlier
        // one. Queued after a later edit that moved there while this
        // request was out, this edit's older values would win.
        const unqueuedPatch = withoutFieldsQueuedLater(write, patch);
        const queued = reportSyncFailure(write, result, unqueuedPatch && {
            type: 'checklist.patch',
            taskId,
            itemId,
            patch: unqueuedPatch
        });
        if (queued && unqueuedPatch) {
            handQueuedFieldsToWaitingEdits(write, itemId, unqueuedPatch);
        }
    }, () => buildChecklistDrainMutation(taskId, subtaskId, patch), {
        id: subtaskId,
        change: 'patch',
        fields: Object.keys(patch)
    });
    write.olderQueuedEdit = olderQueuedEdit;
}

/**
 * The user's queued edit of a checklist item, with the fields it sets.
 * @param {string} taskId
 * @param {string} itemId the item's server id
 * @param {string} ownerId
 * @returns {import('../offline-write-queue.js').QueuedEdit | null}
 */
function findQueuedChecklistPatch(taskId, itemId, ownerId) {
    const queued = loadOfflineQueue({ ownerId }).find((mutation) =>
        mutation.type === 'checklist.patch' && mutation.taskId === taskId && mutation.itemId === itemId
    );
    return queued?.type === 'checklist.patch' ? { id: queued.id, patch: { ...queued.patch } } : null;
}

/**
 * A checklist edit failed and queued `queuedPatch` while later edits of
 * the same item waited behind it. Those edits are newer: once one lands,
 * the fields it set go from the queue, if they still hold these values
 * (olderQueuedEdit).
 * @param {TaskSyncWrite} failed
 * @param {string} itemId the item's server id
 * @param {{ text?: string; done?: boolean }} queuedPatch
 */
function handQueuedFieldsToWaitingEdits(failed, itemId, queuedPatch) {
    const queued = findQueuedChecklistPatch(failed.taskId, itemId, failed.queueOwnerId);
    if (!queued) {
        return;
    }

    pendingChainOpDescriptors.forEach((_, waiting) => {
        if (
            waiting.taskId !== failed.taskId
            || waiting.queueOwnerId !== failed.queueOwnerId
            || waiting.item?.change !== 'patch'
            || resolveChecklistItemId(waiting.item.id) !== itemId
        ) {
            return;
        }

        const known = waiting.olderQueuedEdit?.id === queued.id ? waiting.olderQueuedEdit.patch : {};
        waiting.olderQueuedEdit = { id: queued.id, patch: { ...known, ...queuedPatch } };
    });
}

/**
 * A checklist edit landed. The queued edit of its item this write is
 * newer than (olderQueuedEdit) is older in the fields this one set: a
 * checklist patch carries no version, so sent at the next sync, it would
 * put them back without a conflict. Those fields leave the queued edit
 * while they hold its values, except any that a later edit, queued while
 * this request was out, set.
 * @param {TaskSyncWrite} write
 * @param {string} itemId the item's server id
 * @param {{ text?: string; done?: boolean }} patch
 */
function dropQueuedFieldsThisEditSet(write, itemId, patch) {
    const older = write.olderQueuedEdit;
    if (write.discarded || !older) {
        return;
    }

    const queuedEdits = getQueuedEditsOfItem(write);
    /** @type {{ text?: string; done?: boolean }} */
    const covered = {};
    if (patch.text !== undefined && typeof older.patch.text === 'string' && !queuedEdits?.fields.has('text')) {
        covered.text = older.patch.text;
    }
    if (patch.done !== undefined && typeof older.patch.done === 'boolean' && !queuedEdits?.fields.has('done')) {
        covered.done = older.patch.done;
    }
    if (Object.keys(covered).length > 0) {
        dropQueuedChecklistFields(write.taskId, itemId, { id: older.id, patch: covered }, { ownerId: write.queueOwnerId });
    }
}

/**
 * The part of a checklist edit that no later write of its item, moved to
 * the queue while its request was out, covers: null when one deleted the
 * item, or the later edits set every field it sets.
 * @param {TaskSyncWrite} write
 * @param {{ text?: string; done?: boolean }} patch
 * @returns {{ text?: string; done?: boolean } | null}
 */
function withoutFieldsQueuedLater(write, patch) {
    const queuedEdits = getQueuedEditsOfItem(write);
    if (!queuedEdits) {
        return patch;
    }

    if (queuedEdits.deleted) {
        return null;
    }

    /** @type {{ text?: string; done?: boolean }} */
    const unqueued = {};
    if (patch.text !== undefined && !queuedEdits.fields.has('text')) {
        unqueued.text = patch.text;
    }
    if (patch.done !== undefined && !queuedEdits.fields.has('done')) {
        unqueued.done = patch.done;
    }
    return Object.keys(unqueued).length > 0 ? unqueued : null;
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
    }, () => buildChecklistDrainMutation(taskId, subtaskId, null), { id: subtaskId, change: 'delete', fields: [] });
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
 * on, and a copy of the task there is no business of another user's. The
 * answer then moves the task in the cache of the board it was made on.
 *
 * When a later edit of the task moved to the offline queue while the
 * request was out, that edit expects the version the request started
 * from. An answer at the next version moved the task past it with the
 * user's own write only, so the queued edit moves to the answer's
 * version, in the queue of the user it was made for, whoever's board the
 * store holds; sent as it was, it would meet a 409 as a conflict with
 * itself. An answer further on also counts an edit made elsewhere (a
 * checklist write expects no version), and the queued edit stays to meet
 * it as a 409 (advanceQueuedTaskVersion). On the board,
 * only the version moves: the queued edit is newer than the answer. The
 * same holds for later checklist writes of the task queued meanwhile, and
 * for any change of the task the user's queue held from before: the board
 * holds it and the answer does not, and the task's next snapshot sync,
 * built from the board, must not undo it.
 * @param {TaskSyncWrite} write
 * @param {import('../../shared/task-domain.js').Task} serverTask
 */
function applyWriteResult(write, serverTask) {
    if (write.discarded) {
        return;
    }

    if (write.taskStateQueued && typeof serverTask.version === 'number') {
        advanceQueuedTaskVersion(serverTask.id, serverTask.version, { ownerId: write.queueOwnerId });
    }
    if (getTaskStorageOwner() !== write.storeOwnerId) {
        // That user's board opens from their cache at their next sign-in
        // here, and an edit made on it before the first sync must not
        // expect the version this write moved past, or name an item this
        // write created by its local id. The cached copy already holds the
        // write and any later edit, so only those move.
        updateCachedTaskOf(write.storeOwnerId, serverTask.id, (task) => advanceToServerTask(task, serverTask));
        return;
    }

    applyServerTaskResult(serverTask, {
        newerEditQueued: write.taskStateQueued
            || write.queuedItemEdits.size > 0
            || hasQueuedTaskMutation(serverTask.id, { ownerId: write.queueOwnerId })
    });
}

/**
 * Puts a write that was not sent, or failed in a way worth retrying, in
 * the offline queue of the user it was made for, even when the queue has
 * moved on to another user since, unless that user cleared their local
 * data meanwhile.
 * @param {TaskSyncWrite} write
 * @param {import('../offline-write-queue.js').OfflineMutationInput} mutation
 * @returns {boolean} whether it queued the mutation
 */
function queueWrite(write, mutation) {
    if (write.discarded) {
        return false;
    }

    enqueueOfflineMutation(mutation, { ownerId: write.queueOwnerId });
    return true;
}

/**
 * @param {TaskSyncWrite} write
 * @param {{ ok: true } | { ok: false; fallback: boolean; message: string; status?: number }} result
 * @param {import('../offline-write-queue.js').OfflineMutationInput | null} [mutation]
 *   what to queue on a failure worth retrying; null queues nothing
 * @returns {boolean} whether it queued `mutation`
 */
function reportSyncFailure(write, result, mutation) {
    if (!result.ok && !result.fallback) {
        console.error('Failed to sync task mutation', result.message);
        return false;
    }

    return !result.ok && result.fallback && mutation ? queueWrite(write, mutation) : false;
}
