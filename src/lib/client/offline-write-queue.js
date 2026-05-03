import {
	createServerChecklistItem,
	createServerTask,
	deleteServerChecklistItem,
	deleteServerTask,
	updateServerChecklistItem,
	updateServerTask
} from './task-api.js';

const OFFLINE_QUEUE_KEY = 'kanbanOfflineWriteQueue';
const DEFAULT_QUEUE_OWNER = 'anonymous';

let queueOwnerId = DEFAULT_QUEUE_OWNER;

/**
 * @typedef {{
 *   id?: string;
 *   type: 'task.create';
 *   localTaskId: string;
 *   payload: unknown;
 * } | {
 *   id?: string;
 *   type: 'task.patch';
 *   taskId: string;
 *   patch: Record<string, unknown>;
 * } | {
 *   id?: string;
 *   type: 'task.delete';
 *   taskId: string;
 * } | {
 *   id?: string;
 *   type: 'checklist.create';
 *   taskId: string;
 *   text: string;
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
	/** @type {OfflineMutation[]} */
	const conflicts = [];
	let flushed = 0;
	let blocked = false;

	for (let index = 0; index < queue.length; index += 1) {
		const mutation = queue[index];
		const result = await executeOfflineMutation(mutation, fetcher);
		if (result.ok) {
			flushed += 1;
			if ('task' in result) {
				if (mutation.type === 'task.create') {
					createdTasks.push({ localTaskId: mutation.localTaskId, task: result.task });
				} else {
					syncedTasks.push(result.task);
				}
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
		conflicts
	};
}

/**
 * @param {OfflineMutation[]} queue
 * @param {OfflineMutation} mutation
 */
function coalesceQueue(queue, mutation) {
	if (mutation.type === 'task.patch') {
		const existing = queue.find((item) => item.type === 'task.patch' && item.taskId === mutation.taskId);
		if (existing && existing.type === 'task.patch') {
			existing.patch = { ...existing.patch, ...mutation.patch };
			return queue;
		}
	}

	if (mutation.type === 'task.delete') {
		return [
			...queue.filter((item) => !isTaskScopedMutation(item, mutation.taskId)),
			mutation
		];
	}

	if (mutation.type === 'checklist.patch') {
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
	return 'taskId' in mutation && mutation.taskId === taskId;
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
			return deleteServerTask(mutation.taskId, fetcher);
		case 'checklist.create':
			return createServerChecklistItem(mutation.taskId, mutation.text, fetcher);
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
