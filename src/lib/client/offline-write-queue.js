import {
	createServerChecklistItem,
	createServerTask,
	deleteServerChecklistItem,
	deleteServerTask,
	importServerTasks,
	updateServerChecklistItem,
	updateServerTask
} from './task-api.js';
import { isServerId as isServerTaskId } from '../shared/task-rules.js';

const OFFLINE_QUEUE_KEY = 'kanbanOfflineWriteQueue';
const DEFAULT_QUEUE_OWNER = 'anonymous';
const FLUSH_LOCK_NAME = 'todokanban:offline-write-queue-flush';

let queueOwnerId = DEFAULT_QUEUE_OWNER;
let fallbackFlushInFlight = false;

/**
 * @typedef {{
 *   id?: string;
 *   type: 'task.create';
 *   localTaskId: string;
 *   localParentId?: string | null;
 *   payload: unknown;
 * } | {
 *   id?: string;
 *   type: 'task.patch';
 *   taskId: string;
 *   localParentId?: string | null;
 *   patch: Record<string, unknown>;
 * } | {
 *   id?: string;
 *   type: 'task.delete';
 *   taskId: string;
 *   expectedVersion?: number;
 * } | {
 *   id?: string;
 *   type: 'import.tasks';
 *   mode: 'append' | 'replace';
 *   payload: unknown;
 *   localTaskIds?: string[];
 * } | {
 *   id?: string;
 *   type: 'checklist.create';
 *   taskId: string;
 *   localItemId?: string | null;
 *   text: string;
 *   done?: boolean;
 * } | {
 *   id?: string;
 *   type: 'checklist.patch';
 *   taskId: string;
 *   itemId: string;
 *   patch: { text?: string; done?: boolean };
 * } | {
 *   id?: string;
 *   type: 'checklist.delete';
 *   taskId: string;
 *   itemId: string;
 * }} OfflineMutationInput
 *
 * @typedef {OfflineMutationInput & {
 *   id: string;
 *   ownerUserId?: string;
 *   createdAt: number;
 *   attempts: number;
 * }} OfflineMutation
 *
 * @typedef {{
 *   flushed: number;
 *   remaining: number;
 *   blocked: boolean;
 *   syncedTasks: import('../shared/task-domain.js').Task[];
 *   createdTasks: { localTaskId: string; task: import('../shared/task-domain.js').Task }[];
 *   completedImports: { mode: 'append' | 'replace'; tasks: import('../shared/task-domain.js').Task[]; localTaskIds: string[] }[];
 *   conflicts: OfflineMutation[];
 * }} OfflineFlushResult
 */

/**
 * Adds a mutation to the current owner's queue, or to `ownerId`'s: a write
 * made before that user signed out goes to their queue, not to whoever
 * owns the queue now.
 * @param {OfflineMutationInput} input
 * @param {{ ownerId?: string }} [options] ownerId: an owner from getOfflineQueueOwner
 */
export function enqueueOfflineMutation(input, { ownerId = queueOwnerId } = {}) {
	const owner = normalizeQueueOwner(ownerId);
	const queue = loadOwnerQueue(owner);
	const mutation = {
		...input,
		id: input.id ?? createMutationId(),
		ownerUserId: owner,
		createdAt: Date.now(),
		attempts: 0
	};
	const nextQueue = coalesceQueue(queue, mutation);
	saveOfflineQueue(nextQueue, owner);
	return nextQueue.length;
}

/**
 * Moves the queued edit or delete of `taskId` in `ownerId`'s queue (the
 * current owner's by default) up to `version`, when it expects an older
 * one. For a task write that landed at `version` after a later edit of
 * the task was queued behind it: the edit was made on top of that write,
 * and sent with the version the write started from, it would meet a 409.
 * An entry that expects `version` or newer, or no version, is left alone.
 * @param {string} taskId
 * @param {number} version
 * @param {{ ownerId?: string }} [options]
 */
export function advanceQueuedTaskVersion(taskId, version, { ownerId = queueOwnerId } = {}) {
	const owner = normalizeQueueOwner(ownerId);
	const queue = loadOwnerQueue(owner);
	let advanced = false;
	const nextQueue = queue.map((mutation) => {
		if (mutation.type === 'task.patch' && mutation.taskId === taskId) {
			const expectedVersion = mutation.patch.expectedVersion;
			if (typeof expectedVersion === 'number' && expectedVersion < version) {
				advanced = true;
				return { ...mutation, patch: { ...mutation.patch, expectedVersion: version } };
			}
		}
		if (mutation.type === 'task.delete' && mutation.taskId === taskId) {
			if (typeof mutation.expectedVersion === 'number' && mutation.expectedVersion < version) {
				advanced = true;
				return { ...mutation, expectedVersion: version };
			}
		}
		return mutation;
	});
	if (advanced) {
		saveOfflineQueue(nextQueue, owner);
	}
}

/**
 * Turns the queued create of checklist item `localItemId` of `taskId`, in
 * `ownerId`'s queue (the current owner's by default), into an edit of
 * `createdItem`: the item that a create request for it, still out when the
 * queued create was built, made on the server. Sent as it is, the queued
 * create would add the item a second time. The edit sets the queued text
 * and checked state where they differ from `createdItem`, in the create's
 * place in the queue; when nothing differs, the create goes.
 * @param {string} taskId
 * @param {string} localItemId
 * @param {{ id: string; text: string; done: boolean }} createdItem
 * @param {{ ownerId?: string }} [options]
 */
export function resolveQueuedChecklistCreate(taskId, localItemId, createdItem, { ownerId = queueOwnerId } = {}) {
	const owner = normalizeQueueOwner(ownerId);
	const queue = loadOwnerQueue(owner);
	const queuedCreate = queue.find((mutation) =>
		mutation.type === 'checklist.create'
		&& mutation.taskId === taskId
		&& mutation.localItemId === localItemId
	);
	if (!queuedCreate || queuedCreate.type !== 'checklist.create') {
		return;
	}

	/** @type {{ text?: string; done?: boolean }} */
	const patch = {};
	if (queuedCreate.text !== createdItem.text) {
		patch.text = queuedCreate.text;
	}
	if (Boolean(queuedCreate.done) !== createdItem.done) {
		patch.done = Boolean(queuedCreate.done);
	}
	if (Object.keys(patch).length === 0) {
		saveOfflineQueue(queue.filter((mutation) => mutation !== queuedCreate), owner);
		return;
	}

	/** @type {OfflineMutation} */
	const edit = {
		id: queuedCreate.id,
		type: 'checklist.patch',
		taskId,
		itemId: createdItem.id,
		patch,
		ownerUserId: owner,
		createdAt: queuedCreate.createdAt,
		attempts: queuedCreate.attempts
	};
	saveOfflineQueue(queue.map((mutation) => mutation === queuedCreate ? edit : mutation), owner);
}

/**
 * Whether `ownerId`'s queue (the current owner's by default) holds a
 * mutation of task `taskId` or its checklist: a change the server does not
 * have yet.
 * @param {string} taskId
 * @param {{ ownerId?: string }} [options]
 */
export function hasQueuedTaskMutation(taskId, { ownerId = queueOwnerId } = {}) {
	return loadOwnerQueue(normalizeQueueOwner(ownerId)).some((mutation) => 'taskId' in mutation && mutation.taskId === taskId);
}

/**
 * Drops the queued edit of task `taskId` from `ownerId`'s queue (the
 * current owner's by default), for a newer edit of the task that landed
 * and holds all of its fields. An edit that also sets a parent the server
 * does not have yet (localParentId) stays: the landed edit could not send
 * that parent.
 * @param {string} taskId
 * @param {{ ownerId?: string }} [options]
 */
export function dropQueuedTaskPatch(taskId, { ownerId = queueOwnerId } = {}) {
	const owner = normalizeQueueOwner(ownerId);
	const queue = loadOwnerQueue(owner);
	const nextQueue = queue.filter((mutation) =>
		!(mutation.type === 'task.patch' && mutation.taskId === taskId && !mutation.localParentId)
	);
	if (nextQueue.length !== queue.length) {
		saveOfflineQueue(nextQueue, owner);
	}
}

/**
 * Drops `fields` from the queued edit of checklist item `itemId` of
 * `taskId` in `ownerId`'s queue (the current owner's by default), and the
 * edit once none are left: for a newer edit of the item that landed and
 * set those fields.
 * @param {string} taskId
 * @param {string} itemId
 * @param {string[]} fields
 * @param {{ ownerId?: string }} [options]
 */
export function dropQueuedChecklistFields(taskId, itemId, fields, { ownerId = queueOwnerId } = {}) {
	const owner = normalizeQueueOwner(ownerId);
	const queue = loadOwnerQueue(owner);
	const queuedEdit = queue.find((mutation) =>
		mutation.type === 'checklist.patch' && mutation.taskId === taskId && mutation.itemId === itemId
	);
	if (!queuedEdit || queuedEdit.type !== 'checklist.patch' || !fields.some((field) => field in queuedEdit.patch)) {
		return;
	}

	/** @type {{ text?: string; done?: boolean }} */
	const patch = { ...queuedEdit.patch };
	if (fields.includes('text')) {
		delete patch.text;
	}
	if (fields.includes('done')) {
		delete patch.done;
	}
	saveOfflineQueue(
		Object.keys(patch).length === 0
			? queue.filter((mutation) => mutation !== queuedEdit)
			: queue.map((mutation) => mutation === queuedEdit ? { ...queuedEdit, patch } : mutation),
		owner
	);
}

export function getOfflineQueueSize() {
	return loadOfflineQueue().length;
}

export function clearOfflineWriteQueue() {
	saveOfflineQueue([]);
}

/**
 * @param {string | null | undefined} ownerId
 */
export function setOfflineQueueOwner(ownerId) {
	queueOwnerId = normalizeQueueOwner(ownerId);
}

/**
 * The owner new mutations are queued for: a user id, or 'anonymous' when
 * no one is signed in.
 */
export function getOfflineQueueOwner() {
	return queueOwnerId;
}

/**
 * Sends the current owner's queue. The flush stays that owner's to the
 * end: when another owner takes the queue while a request is out (a
 * sign-out, or another user signing in), what it sent still leaves that
 * owner's queue, and what it keeps stays there.
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<OfflineFlushResult>}
 */
export async function flushOfflineWriteQueue(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFlushResult(loadOfflineQueue(), true);
	}

	const owner = queueOwnerId;
	return withFlushLock(() => executeFlush(fetcher, owner));
}

/**
 * Overlapping flushes (a second tab, or online + session handlers firing
 * together) re-execute the same queued creates and produce duplicate server
 * tasks. Only one flush may run per origin; contenders report blocked.
 * @param {() => Promise<OfflineFlushResult>} operation
 * @returns {Promise<OfflineFlushResult>}
 */
function withFlushLock(operation) {
	const locks = /** @type {{ request?: Function } | undefined} */ (globalThis.navigator?.locks);
	if (locks && typeof locks.request === 'function') {
		return locks.request(
			FLUSH_LOCK_NAME,
			{ ifAvailable: true },
			/** @param {unknown} lock */
			(lock) => lock ? operation() : createFlushResult(loadOfflineQueue(), true)
		);
	}

	if (fallbackFlushInFlight) {
		return Promise.resolve(createFlushResult(loadOfflineQueue(), true));
	}

	fallbackFlushInFlight = true;
	return Promise.resolve()
		.then(operation)
		.finally(() => {
			fallbackFlushInFlight = false;
		});
}

/**
 * @param {typeof fetch} fetcher
 * @param {string} owner the owner whose queue this flush sends
 * @returns {Promise<OfflineFlushResult>}
 */
async function executeFlush(fetcher, owner) {
	const queue = loadOwnerQueue(owner);
	if (queue.length === 0) {
		return createFlushResult([], false);
	}

	/** @type {Map<string, string>} */
	const originalById = new Map(queue.map((mutation) => [mutation.id, JSON.stringify(mutation)]));
	/** @type {Set<string>} */
	const processedIds = new Set();
	/**
	 * Server versions observed from responses in this flush. Later queued
	 * mutations for the same task would otherwise 409 on versions our own
	 * earlier mutations already bumped.
	 * @type {Map<string, number>}
	 */
	const latestVersions = new Map();
	/** @type {OfflineMutation[]} */
	const remaining = [];
	/** @type {import('../shared/task-domain.js').Task[]} */
	const syncedTasks = [];
	/** @type {{ localTaskId: string; task: import('../shared/task-domain.js').Task }[]} */
	const createdTasks = [];
	/** @type {{ mode: 'append' | 'replace'; tasks: import('../shared/task-domain.js').Task[]; localTaskIds: string[] }[]} */
	const completedImports = [];
	/** @type {OfflineMutation[]} */
	const conflicts = [];
	/** @type {Map<string, string>} */
	const localTaskIds = new Map();
	let flushed = 0;
	let blocked = false;

	for (let index = 0; index < queue.length; index += 1) {
		const mutation = queue[index];
		const executableMutation = withRefreshedExpectedVersion(
			resolveOfflineMutationReferences(mutation, localTaskIds),
			latestVersions
		);
		if (!executableMutation) {
			// Creates precede their dependents in queue order, so an unresolved
			// local reference with no pending create left in the queue can never
			// resolve. Blocking on it forever would also disable the post-flush
			// server snapshot for good — surface it as a conflict instead.
			if (isPermanentlyOrphaned(mutation, queue, processedIds)) {
				conflicts.push(mutation);
				flushed += 1;
				processedIds.add(mutation.id);
				continue;
			}

			blocked = true;
			remaining.push({ ...mutation, attempts: mutation.attempts + 1 });
			remaining.push(...queue.slice(index + 1));
			break;
		}

		const result = await executeOfflineMutation(executableMutation, fetcher);
		if (result.ok) {
			flushed += 1;
			processedIds.add(mutation.id);
			if ('pendingDoneItemId' in result && typeof result.pendingDoneItemId === 'string' && 'taskId' in executableMutation) {
				// A checked offline create landed its item but not the checked
				// state; queue a retryable follow-up patch for the next flush.
				// Mid-flush enqueues survive the post-flush reconciliation.
				enqueueOfflineMutation({
					type: 'checklist.patch',
					taskId: executableMutation.taskId,
					itemId: result.pendingDoneItemId,
					patch: { done: true }
				}, { ownerId: owner });
			}
			if ('task' in result) {
				if (typeof result.task.version === 'number') {
					latestVersions.set(result.task.id, result.task.version);
				}
				if (mutation.type === 'task.create') {
					localTaskIds.set(mutation.localTaskId, result.task.id);
					updateQueuedLocalParentReferences(queue, index + 1, mutation.localTaskId, result.task.id);
					updateQueuedLocalTaskReferences(queue, index + 1, mutation.localTaskId, result.task.id);
					createdTasks.push({ localTaskId: mutation.localTaskId, task: result.task });
				} else {
					syncedTasks.push(result.task);
				}
			} else if ('tasks' in result && mutation.type === 'import.tasks') {
				completedImports.push({
					mode: mutation.mode,
					tasks: result.tasks,
					localTaskIds: mutation.localTaskIds ?? []
				});
			}
			continue;
		}

		if (shouldKeepForRetry(result)) {
			blocked = true;
			remaining.push({ ...mutation, attempts: mutation.attempts + 1 });
			remaining.push(...queue.slice(index + 1));
			break;
		}

		if (result.status === 409) {
			conflicts.push(mutation);
		}
		flushed += 1;
		processedIds.add(mutation.id);
	}

	const finalQueue = reconcileQueueAfterFlush(remaining, processedIds, originalById, localTaskIds, owner);
	saveOfflineQueue(finalQueue, owner);
	return {
		flushed,
		remaining: finalQueue.length,
		blocked,
		syncedTasks,
		createdTasks,
		completedImports,
		conflicts
	};
}

/**
 * Saving the precomputed remainder would erase mutations enqueued while the
 * flush was running. Rebuild the queue from current storage instead: drop what
 * this flush executed, keep everything else in storage order, and re-apply the
 * local-to-server id mapping so late arrivals referencing completed creates
 * stay resolvable.
 * @param {OfflineMutation[]} remaining
 * @param {Set<string>} processedIds
 * @param {Map<string, string>} originalById
 * @param {Map<string, string>} localTaskIds
 * @param {string} owner the owner whose queue the flush sent
 * @returns {OfflineMutation[]}
 */
function reconcileQueueAfterFlush(remaining, processedIds, originalById, localTaskIds, owner) {
	const storageNow = loadOwnerQueue(owner);
	const remainingById = new Map(remaining.map((mutation) => [mutation.id, mutation]));
	/** @type {OfflineMutation[]} */
	const finalQueue = [];

	for (const mutation of storageNow) {
		if (processedIds.has(mutation.id)) {
			if (originalById.get(mutation.id) !== JSON.stringify(mutation)) {
				console.warn('Dropped an offline edit that raced its own completed sync.', mutation.type, mutation.id);
			}
			continue;
		}

		const retained = remainingById.get(mutation.id);
		const merged = retained
			? { ...mutation, attempts: Math.max(mutation.attempts, retained.attempts) }
			: mutation;
		finalQueue.push(remapMutationLocalIds(merged, localTaskIds));
	}

	return finalQueue;
}

/**
 * @param {OfflineMutation} mutation
 * @param {Map<string, string>} localTaskIds
 * @returns {OfflineMutation}
 */
function remapMutationLocalIds(mutation, localTaskIds) {
	let next = mutation;
	if ('taskId' in next && !isServerTaskId(next.taskId)) {
		const serverTaskId = localTaskIds.get(next.taskId);
		if (serverTaskId) {
			next = { ...next, taskId: serverTaskId };
		}
	}

	if (next.type === 'task.create' && next.localParentId) {
		const payload = getPayloadObject(next.payload);
		const serverParentId = localTaskIds.get(next.localParentId);
		if (payload && serverParentId && !isServerTaskId(payload.parentId)) {
			next = { ...next, payload: { ...payload, parentId: serverParentId } };
		}
	}

	return next;
}

/**
 * @param {OfflineMutation} mutation
 * @param {OfflineMutation[]} queue
 * @param {Set<string>} processedIds
 */
function isPermanentlyOrphaned(mutation, queue, processedIds) {
	/** @type {string | null} */
	let unresolvedLocalId = null;
	if ('taskId' in mutation && !isServerTaskId(mutation.taskId)) {
		unresolvedLocalId = mutation.taskId;
	} else if (mutation.type === 'task.create') {
		// Resolution failed on the parent reference or a corrupt payload.
		if (!getPayloadObject(mutation.payload)) {
			return true;
		}
		unresolvedLocalId = mutation.localParentId ?? null;
	}

	if (!unresolvedLocalId) {
		return true;
	}

	return !queue.some((item) =>
		item.type === 'task.create'
		&& item.localTaskId === unresolvedLocalId
		&& !processedIds.has(item.id)
	);
}

/**
 * @param {OfflineMutation | null} mutation
 * @param {Map<string, number>} latestVersions
 * @returns {OfflineMutation | null}
 */
function withRefreshedExpectedVersion(mutation, latestVersions) {
	if (!mutation) {
		return mutation;
	}

	if (mutation.type === 'task.patch') {
		const knownVersion = latestVersions.get(mutation.taskId);
		return typeof knownVersion === 'number'
			? { ...mutation, patch: { ...mutation.patch, expectedVersion: knownVersion } }
			: mutation;
	}

	if (mutation.type === 'task.delete') {
		const knownVersion = latestVersions.get(mutation.taskId);
		return typeof knownVersion === 'number'
			? { ...mutation, expectedVersion: knownVersion }
			: mutation;
	}

	return mutation;
}

/**
 * @param {OfflineMutation[]} queue
 * @param {OfflineMutation} mutation
 */
function coalesceQueue(queue, mutation) {
	if (mutation.type === 'task.patch') {
		const pendingCreate = queue.find((item) => item.type === 'task.create' && item.localTaskId === mutation.taskId);
		if (pendingCreate && pendingCreate.type === 'task.create') {
			const payload = getPayloadObject(pendingCreate.payload) ?? {};
			pendingCreate.payload = { ...payload, ...mutation.patch };
			if ('localParentId' in mutation) {
				pendingCreate.localParentId = mutation.localParentId;
			}
			return queue;
		}

		if (!isServerTaskId(mutation.taskId)) {
			return queue;
		}

		const existing = queue.find((item) => item.type === 'task.patch' && item.taskId === mutation.taskId);
		if (existing && existing.type === 'task.patch') {
			existing.patch = { ...existing.patch, ...mutation.patch };
			return queue;
		}
	}

	if (mutation.type === 'task.delete') {
		const filtered = queue.filter((item) => !isTaskScopedMutation(item, mutation.taskId));
		return isServerTaskId(mutation.taskId) ? [...filtered, mutation] : filtered;
	}

	if (mutation.type === 'import.tasks') {
		if (mutation.mode === 'replace') {
			return [mutation];
		}

		return [...queue, mutation];
	}

	if (mutation.type === 'checklist.create' && !isServerTaskId(mutation.taskId)) {
		const pendingTaskCreate = queue.find((item) => item.type === 'task.create' && item.localTaskId === mutation.taskId);
		if (!pendingTaskCreate) {
			console.warn('Discarded a checklist create for a local task with no pending create.', mutation.taskId);
			return queue;
		}
	}

	if (mutation.type === 'checklist.patch') {
		const pendingCreate = queue.find((item) =>
			item.type === 'checklist.create'
			&& item.taskId === mutation.taskId
			&& Boolean(item.localItemId)
			&& item.localItemId === mutation.itemId
		);
		if (pendingCreate && pendingCreate.type === 'checklist.create') {
			if (typeof mutation.patch.text === 'string') {
				pendingCreate.text = mutation.patch.text;
			}
			if (typeof mutation.patch.done === 'boolean') {
				pendingCreate.done = mutation.patch.done;
			}
			return queue;
		}

		if (!isServerTaskId(mutation.itemId)) {
			console.warn('Discarded a checklist edit whose local item has no pending create.', mutation.itemId);
			return queue;
		}

		const existing = queue.find((item) =>
			item.type === 'checklist.patch'
			&& item.taskId === mutation.taskId
			&& item.itemId === mutation.itemId
		);
		if (existing && existing.type === 'checklist.patch') {
			existing.patch = { ...existing.patch, ...mutation.patch };
			return queue;
		}
	}

	if (mutation.type === 'checklist.delete') {
		const withoutPendingCreate = queue.filter((item) =>
			!(
				item.type === 'checklist.create'
				&& item.taskId === mutation.taskId
				&& Boolean(item.localItemId)
				&& item.localItemId === mutation.itemId
			)
		);
		if (withoutPendingCreate.length !== queue.length || !isServerTaskId(mutation.itemId)) {
			return withoutPendingCreate;
		}

		return [
			...queue.filter((item) =>
				!('taskId' in item && item.taskId === mutation.taskId && 'itemId' in item && item.itemId === mutation.itemId)
			),
			mutation
		];
	}

	return [...queue, mutation];
}

/**
 * @param {OfflineMutation} mutation
 * @param {string} taskId
 */
function isTaskScopedMutation(mutation, taskId) {
	return ('taskId' in mutation && mutation.taskId === taskId)
		|| (mutation.type === 'task.create' && mutation.localTaskId === taskId);
}

/**
 * @param {OfflineMutation} mutation
 * @param {Map<string, string>} localTaskIds
 * @returns {OfflineMutation | null}
 */
function resolveOfflineMutationReferences(mutation, localTaskIds) {
	/** @type {OfflineMutation} */
	let resolved = mutation;

	if ('taskId' in resolved && !isServerTaskId(resolved.taskId)) {
		const serverTaskId = localTaskIds.get(resolved.taskId);
		if (!serverTaskId) {
			return null;
		}

		resolved = { ...resolved, taskId: serverTaskId };
	}

	if (resolved.type !== 'task.create' || !resolved.localParentId) {
		return resolved;
	}

	const payload = getPayloadObject(resolved.payload);
	if (!payload) {
		return null;
	}

	if (isServerTaskId(payload?.parentId)) {
		return resolved;
	}

	const serverParentId = localTaskIds.get(resolved.localParentId);
	if (!serverParentId) {
		return null;
	}

	return {
		...resolved,
		payload: {
			...payload,
			parentId: serverParentId
		}
	};
}

/**
 * @param {OfflineMutation[]} queue
 * @param {number} startIndex
 * @param {string} localTaskId
 * @param {string} serverTaskId
 */
function updateQueuedLocalParentReferences(queue, startIndex, localTaskId, serverTaskId) {
	for (let index = startIndex; index < queue.length; index += 1) {
		const mutation = queue[index];
		if (mutation.type !== 'task.create' || mutation.localParentId !== localTaskId) {
			continue;
		}

		const payload = getPayloadObject(mutation.payload);
		if (!payload || isServerTaskId(payload.parentId)) {
			continue;
		}

		mutation.payload = {
			...payload,
			parentId: serverTaskId
		};
	}
}

/**
 * @param {OfflineMutation[]} queue
 * @param {number} startIndex
 * @param {string} localTaskId
 * @param {string} serverTaskId
 */
function updateQueuedLocalTaskReferences(queue, startIndex, localTaskId, serverTaskId) {
	for (let index = startIndex; index < queue.length; index += 1) {
		const mutation = queue[index];
		if (!('taskId' in mutation) || mutation.taskId !== localTaskId) {
			continue;
		}

		mutation.taskId = serverTaskId;
	}
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown> | null}
 */
function getPayloadObject(payload) {
	return payload && typeof payload === 'object'
		? /** @type {Record<string, unknown>} */ (payload)
		: null;
}

/**
 * @param {OfflineMutation} mutation
 * @param {typeof fetch} fetcher
 */
async function executeOfflineMutation(mutation, fetcher) {
	switch (mutation.type) {
		case 'task.create':
			return createServerTask(mutation.payload, fetcher);
		case 'task.patch':
			return updateServerTask(mutation.taskId, mutation.patch, fetcher);
		case 'task.delete':
			return deleteServerTask(mutation.taskId, {
				...(typeof mutation.expectedVersion === 'number' ? { expectedVersion: mutation.expectedVersion } : {})
			}, fetcher);
		case 'import.tasks':
			return importServerTasks(mutation.payload, { mode: mutation.mode }, fetcher);
		case 'checklist.create':
			return executeChecklistCreateMutation(mutation, fetcher);
		case 'checklist.patch':
			return updateServerChecklistItem(mutation.taskId, mutation.itemId, mutation.patch, fetcher);
		case 'checklist.delete':
			return deleteServerChecklistItem(mutation.taskId, mutation.itemId, fetcher);
		default:
			return /** @type {{ ok: false; fallback: false; status: 400; message: string }} */ ({
				ok: false,
				fallback: false,
				status: 400,
				message: 'Unknown offline mutation.'
			});
	}
}

/**
 * @param {Extract<OfflineMutation, { type: 'checklist.create' }>} mutation
 * @param {typeof fetch} fetcher
 */
async function executeChecklistCreateMutation(mutation, fetcher) {
	const createResult = await createServerChecklistItem(mutation.taskId, mutation.text, fetcher);
	if (!createResult.ok || mutation.done !== true) {
		return createResult;
	}

	const createdItem = findCreatedChecklistItem(createResult.task, mutation.text);
	if (!createdItem) {
		return createResult;
	}

	const updateResult = await updateServerChecklistItem(mutation.taskId, createdItem.id, { done: true }, fetcher);
	if (updateResult.ok) {
		return updateResult;
	}

	// The item exists but its checked state did not land. When the failure is
	// retryable (e.g. the create consumed the last rate-limit token), hand the
	// flush a follow-up patch to queue so the done state survives.
	if (shouldKeepForRetry(updateResult)) {
		return { ...createResult, pendingDoneItemId: createdItem.id };
	}

	return createResult;
}

/**
 * @param {import('../shared/task-domain.js').Task} task
 * @param {string} text
 */
function findCreatedChecklistItem(task, text) {
	return [...task.subtasks].reverse().find((item) => item.text === text && isServerTaskId(item.id)) ?? null;
}

/**
 * @param {{ ok: false; fallback: boolean; status: number }} result
 */
function shouldKeepForRetry(result) {
	return result.fallback && result.status !== 409;
}

/**
 * @returns {OfflineMutation[]}
 */
export function loadOfflineQueue() {
	return loadOwnerQueue(queueOwnerId);
}

/**
 * @param {string} ownerId
 * @returns {OfflineMutation[]}
 */
function loadOwnerQueue(ownerId) {
	try {
		const storage = getStorage();
		if (!storage) {
			return [];
		}

		const raw = storage.getItem(getOfflineQueueKey(ownerId)) ?? readLegacyQueue(storage, ownerId);
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(isOfflineMutation).filter((mutation) => isOwnedBy(mutation, ownerId))
			: [];
	} catch {
		return [];
	}
}

/**
 * @param {OfflineMutation[]} queue
 * @param {string} [ownerId]
 */
function saveOfflineQueue(queue, ownerId = queueOwnerId) {
	try {
		const storage = getStorage();
		if (!storage) {
			return;
		}

		const key = getOfflineQueueKey(ownerId);
		if (queue.length === 0) {
			storage.removeItem(key);
			if (ownerId === DEFAULT_QUEUE_OWNER) {
				storage.removeItem(OFFLINE_QUEUE_KEY);
			}
			return;
		}

		storage.setItem(key, JSON.stringify(queue));
		if (ownerId === DEFAULT_QUEUE_OWNER) {
			storage.removeItem(OFFLINE_QUEUE_KEY);
		}
	} catch {
		// Keeping the in-memory UI responsive matters more than surfacing storage failures here.
	}
}

/**
 * @param {string} ownerId
 */
function getOfflineQueueKey(ownerId) {
	return `${OFFLINE_QUEUE_KEY}:${ownerId}`;
}

/**
 * @param {Storage} storage
 * @param {string} ownerId
 */
function readLegacyQueue(storage, ownerId) {
	return ownerId === DEFAULT_QUEUE_OWNER ? storage.getItem(OFFLINE_QUEUE_KEY) : null;
}

/**
 * @returns {Storage | null}
 */
function getStorage() {
	try {
		const storage = globalThis.localStorage;
		return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
			? storage
			: null;
	} catch {
		return null;
	}
}

/**
 * @param {unknown} value
 * @returns {value is OfflineMutation}
 */
function isOfflineMutation(value) {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const mutation = /** @type {Record<string, unknown>} */ (value);
	return typeof mutation.id === 'string'
		&& typeof mutation.type === 'string'
		&& (mutation.ownerUserId === undefined || typeof mutation.ownerUserId === 'string')
		&& typeof mutation.createdAt === 'number'
		&& typeof mutation.attempts === 'number';
}

/**
 * @param {OfflineMutation} mutation
 * @param {string} ownerId
 */
function isOwnedBy(mutation, ownerId) {
	return (mutation.ownerUserId ?? DEFAULT_QUEUE_OWNER) === ownerId;
}

/**
 * @param {OfflineMutation[]} queue
 * @param {boolean} blocked
 * @returns {OfflineFlushResult}
 */
function createFlushResult(queue, blocked) {
	return {
		flushed: 0,
		remaining: queue.length,
		blocked,
		syncedTasks: [],
		createdTasks: [],
		completedImports: [],
		conflicts: []
	};
}

/**
 * @param {string | null | undefined} ownerId
 */
function normalizeQueueOwner(ownerId) {
	const trimmed = ownerId?.trim();
	return trimmed || DEFAULT_QUEUE_OWNER;
}

function createMutationId() {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
