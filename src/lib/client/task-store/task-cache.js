import { get, writable } from 'svelte/store';
import { normalizeTask, normalizeTaskList } from '../../shared/task-domain.js';
import { getStorage } from '../browser-storage.js';

const STORAGE_KEY = 'kanbanTasks';
const DEFAULT_STORAGE_OWNER = 'anonymous';

let taskStorageOwner = DEFAULT_STORAGE_OWNER;

/**
 * @returns {import('../../shared/task-domain.js').Task[]}
 */
function loadInitialTasks() {
    try {
        const storage = getStorage();
        if (!storage) return [];

        const raw = storage.getItem(getTaskStorageKey()) ?? readLegacyTasks(storage);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? normalizeTaskList(parsed) : [];
    } catch (error) {
        console.error('Failed to load kanban tasks', error);
        return [];
    }
}

/** @type {import('svelte/store').Writable<import('../../shared/task-domain.js').Task[]>} */
export const tasks = writable(loadInitialTasks());

let isInitialTaskEmission = true;
let isApplyingExternalTaskUpdate = false;
tasks.subscribe((value) => {
    if (isInitialTaskEmission) {
        isInitialTaskEmission = false;
        return;
    }
    if (isApplyingExternalTaskUpdate) {
        return;
    }

    try {
        const storage = getStorage();
        if (!storage) return;

        storage.setItem(getTaskStorageKey(), JSON.stringify(value));
        if (taskStorageOwner === DEFAULT_STORAGE_OWNER) {
            storage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to persist kanban tasks', error);
    }
});

/**
 * @param {string | null | undefined} ownerId
 */
export function setTaskStorageOwner(ownerId) {
    const nextOwner = normalizeStorageOwner(ownerId);
    if (nextOwner === taskStorageOwner) {
        return;
    }

    taskStorageOwner = nextOwner;
    tasks.set(loadInitialTasks());
}

/**
 * The user whose tasks the store holds, or null for the signed-out
 * (anonymous) cache.
 * @returns {string | null}
 */
export function getTaskStorageOwner() {
    return taskStorageOwner === DEFAULT_STORAGE_OWNER ? null : taskStorageOwner;
}

export function clearLocalTaskCache() {
    try {
        const storage = getStorage();
        if (!storage) return;

        storage.removeItem(getTaskStorageKey());
        if (taskStorageOwner === DEFAULT_STORAGE_OWNER) {
            storage.removeItem(STORAGE_KEY);
        }
        tasks.set([]);
    } catch (error) {
        console.error('Failed to clear local task cache', error);
    }
}

export function getTaskStorageKey() {
    return `${STORAGE_KEY}:${taskStorageOwner}`;
}

/**
 * Rewrites task `taskId` in the cached board of `ownerId` (null for the
 * signed-out board) while the store holds another board: for a write made
 * on that board that lands after the board moved on. The store's own board
 * changes through the store. Nothing happens when that board or the task
 * is not cached.
 * @param {string | null} ownerId
 * @param {string} taskId
 * @param {(task: import('../../shared/task-domain.js').Task) => import('../../shared/task-domain.js').Task} update
 */
export function updateCachedTaskOf(ownerId, taskId, update) {
    const owner = normalizeStorageOwner(ownerId);
    if (owner === taskStorageOwner) {
        return;
    }

    try {
        const storage = getStorage();
        const key = `${STORAGE_KEY}:${owner}`;
        const raw = storage?.getItem(key);
        if (!storage || !raw) return;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const cached = normalizeTaskList(parsed);
        const task = cached.find((current) => current.id === taskId);
        if (!task) return;

        const next = update(task);
        if (next !== task) {
            storage.setItem(key, JSON.stringify(cached.map((current) => current === task ? next : current)));
        }
    } catch (error) {
        console.error('Failed to update a cached task', error);
    }
}

/**
 * Runs task writes that came from another tab's storage event. That tab has
 * already persisted them, so the cache does not write them back.
 * @param {() => void} run
 */
export function runWithoutPersisting(run) {
    isApplyingExternalTaskUpdate = true;
    try {
        run();
    } finally {
        isApplyingExternalTaskUpdate = false;
    }
}

/**
 * @param {Storage} storage
 */
function readLegacyTasks(storage) {
    return taskStorageOwner === DEFAULT_STORAGE_OWNER ? storage.getItem(STORAGE_KEY) : null;
}

/**
 * @param {string | null | undefined} ownerId
 */
function normalizeStorageOwner(ownerId) {
    const trimmed = ownerId?.trim();
    return trimmed || DEFAULT_STORAGE_OWNER;
}

/**
 * @param {unknown[]} nextTasks
 */
export function replaceTasks(nextTasks) {
    tasks.set(normalizeTaskList(nextTasks));
}

/**
 * Adds a newly created task at the end of the list. When the list already
 * holds its id, a server sync that ran while the create was in flight added
 * it. Appended, the task would be a second one with the same id, which
 * normalizeTaskList later gives a new local id. The listed copy stays
 * instead: it was read after the create committed, so it is never older
 * than the create's answer, and it may carry edits made on it since, which
 * do not bump its version. Only a strictly newer answer is merged in.
 * @param {import('../../shared/task-domain.js').Task} task
 */
export function insertTask(task) {
    const existing = get(tasks).find((current) => current.id === task.id);
    if (existing) {
        if (
            typeof existing.version === 'number'
            && typeof task.version === 'number'
            && task.version > existing.version
        ) {
            mergeTasks([task]);
        }
        return;
    }

    tasks.update((current) => normalizeTaskList([...current, task]));
}

/**
 * @param {unknown[]} nextTasks
 * @param {{ insertMissing?: boolean }} [options]
 *   insertMissing: false keeps responses for locally deleted tasks from resurrecting them.
 */
export function mergeTasks(nextTasks, options = {}) {
    const { insertMissing = true } = options;
    const incoming = nextTasks.map((task) => normalizeTask(task));
    tasks.update((current) => {
        const merged = new Map(current.map((task) => [task.id, task]));
        incoming.forEach((task) => {
            const existing = merged.get(task.id);
            if (!existing) {
                if (insertMissing) {
                    merged.set(task.id, task);
                }
                return;
            }

            if (
                typeof existing.version === 'number'
                && typeof task.version === 'number'
                && task.version < existing.version
            ) {
                return;
            }

            merged.set(task.id, { ...task, collapsed: existing.collapsed });
        });

        return normalizeTaskList([...merged.values()]);
    });
}

/**
 * @param {string[]} taskIds
 */
export function removeTasksByIds(taskIds) {
    const ids = new Set(taskIds);
    if (ids.size === 0) return;

    tasks.update((current) => normalizeTaskList(current.filter((task) => !ids.has(task.id))));
}

/**
 * @param {string} localTaskId
 * @param {import('../../shared/task-domain.js').Task} serverTask
 */
export function replaceLocalTaskWithServerTask(localTaskId, serverTask) {
    tasks.update((current) =>
        normalizeTaskList(current.map((task) => {
            if (task.id === localTaskId) {
                return {
                    ...serverTask,
                    collapsed: task.collapsed
                };
            }

            return task.parentId === localTaskId ? { ...task, parentId: serverTask.id } : task;
        }))
    );
}
