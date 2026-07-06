import {
	createServerChecklistItem,
	createServerTask,
	deleteServerChecklistItem,
	deleteServerTask,
	importServerTasks,
	updateServerChecklistItem,
	updateServerTask
} from './task-api.js';
import { isServerTaskId } from './task-create.js';

const OFFLINE_QUEUE_KEY = 'kanbanOfflineWriteQueue';
const DEFAULT_QUEUE_OWNER = 'anonymous';

let queueOwnerId = DEFAULT_QUEUE_OWNER;

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
 * @param {OfflineMutationInput} input
 */
export function enqueueOfflineMutation(input) {
	const queue = loadOfflineQueue();
	const mutation = {
		...input,
		id: input.id ?? createMutationId(),
		ownerUserId: queueOwnerId,
		createdAt: Date.now(),
		attempts: 0
	};
	const nextQueue = coalesceQueue(queue, mutation);
	saveOfflineQueue(nextQueue);
	return nextQueue.length;
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
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<OfflineFlushResult>}
 */
export async function flushOfflineWriteQueue(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFlushResult(loadOfflineQueue(), true);
	}

	const queue = loadOfflineQueue();
	if (queue.length === 0) {
		return createFlushResult([], false);
	}

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
		const executableMutation = resolveOfflineMutationReferences(mutation, localTaskIds);
		if (!executableMutation) {
			blocked = true;
			remaining.push({ ...mutation, attempts: mutation.attempts + 1 });
			remaining.push(...queue.slice(index + 1));
			break;
		}

		const result = await executeOfflineMutation(executableMutation, fetcher);
		if (result.ok) {
			flushed += 1;
			if ('pendingDoneItemId' in result && typeof result.pendingDoneItemId === 'string' && 'taskId' in executableMutation) {
				// A checked offline create landed its item but not the checked
				// state; keep a retryable follow-up patch for the next flush.
				remaining.push({
					id: createMutationId(),
					type: 'checklist.patch',
					taskId: executableMutation.taskId,
					itemId: result.pendingDoneItemId,
					patch: { done: true },
					ownerUserId: mutation.ownerUserId,
					createdAt: Date.now(),
					attempts: 0
				});
			}
			if ('task' in result) {
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
	}

	saveOfflineQueue(remaining);
	return {
		flushed,
		remaining: remaining.length,
		blocked,
		syncedTasks,
		createdTasks,
		completedImports,
		conflicts
	};
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
	try {
		const storage = getStorage();
		if (!storage) {
			return [];
		}

		const raw = storage.getItem(getOfflineQueueKey()) ?? readLegacyQueue(storage);
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(isOfflineMutation).filter(isCurrentOwnerMutation)
			: [];
	} catch {
		return [];
	}
}

/**
 * @param {OfflineMutation[]} queue
 */
function saveOfflineQueue(queue) {
	try {
		const storage = getStorage();
		if (!storage) {
			return;
		}

		const key = getOfflineQueueKey();
		if (queue.length === 0) {
			storage.removeItem(key);
			if (queueOwnerId === DEFAULT_QUEUE_OWNER) {
				storage.removeItem(OFFLINE_QUEUE_KEY);
			}
			return;
		}

		storage.setItem(key, JSON.stringify(queue));
		if (queueOwnerId === DEFAULT_QUEUE_OWNER) {
			storage.removeItem(OFFLINE_QUEUE_KEY);
		}
	} catch {
		// Keeping the in-memory UI responsive matters more than surfacing storage failures here.
	}
}

function getOfflineQueueKey() {
	return `${OFFLINE_QUEUE_KEY}:${queueOwnerId}`;
}

/**
 * @param {Storage} storage
 */
function readLegacyQueue(storage) {
	return queueOwnerId === DEFAULT_QUEUE_OWNER ? storage.getItem(OFFLINE_QUEUE_KEY) : null;
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
 */
function isCurrentOwnerMutation(mutation) {
	return (mutation.ownerUserId ?? DEFAULT_QUEUE_OWNER) === queueOwnerId;
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
