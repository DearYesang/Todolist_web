import { derived, writable } from 'svelte/store';
import {
    createServerChecklistItem,
    deleteServerChecklistItem,
    deleteServerTask,
    updateServerChecklistItem,
    updateServerTask
} from './task-api.js';
import { isServerTaskId } from './task-create.js';
import {
    addSubtaskToList,
    assignParentInList,
    clearDoneTasksFromList,
    DEFAULT_FILTERS,
    deleteSubtaskFromList,
    deleteTaskCascadeFromList,
    moveTaskInList,
    normalizeTaskList,
    renameSubtaskInList,
    toggleSubtaskInList,
    updateTaskInList
} from '../shared/task-domain.js';

export * from '../shared/task-domain.js';

const STORAGE_KEY = 'kanbanTasks';

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
 * @returns {import('../shared/task-domain.js').Task[]}
 */
function loadInitialTasks() {
    try {
        const storage = getStorage();
        if (!storage) return [];

        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? normalizeTaskList(parsed) : [];
    } catch (error) {
        console.error('Failed to load kanban tasks', error);
        return [];
    }
}

/** @type {import('svelte/store').Writable<import('../shared/task-domain.js').Task[]>} */
export const tasks = writable(loadInitialTasks());

let isInitialTaskEmission = true;
tasks.subscribe((value) => {
    if (isInitialTaskEmission) {
        isInitialTaskEmission = false;
        return;
    }

    try {
        const storage = getStorage();
        if (!storage) return;

        storage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
        console.error('Failed to persist kanban tasks', error);
    }
});

/** @type {import('svelte/store').Writable<'kanban' | 'gantt'>} */
export const currentView = writable('kanban');

/** @type {import('svelte/store').Writable<import('../shared/task-domain.js').TaskFilters>} */
export const filters = writable({ ...DEFAULT_FILTERS });

export const categories = derived(tasks, ($tasks) =>
    [...new Set($tasks.map((task) => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
);

/**
 * @param {import('../shared/task-domain.js').PriorityFilter} value
 */
export function setPriorityFilter(value) {
    filters.update((current) => ({ ...current, priority: value }));
}

/**
 * @param {import('../shared/task-domain.js').UrgencyFilter} value
 */
export function setUrgencyFilter(value) {
    filters.update((current) => ({ ...current, urgency: value }));
}

/**
 * @param {string} value
 */
export function setCategoryFilter(value) {
    filters.update((current) => ({ ...current, category: value }));
}

export function resetFilters() {
    filters.set({ ...DEFAULT_FILTERS });
}

/**
 * @param {unknown[]} nextTasks
 */
export function replaceTasks(nextTasks) {
    tasks.set(normalizeTaskList(nextTasks));
}

/**
 * @param {unknown[]} nextTasks
 */
export function mergeTasks(nextTasks) {
    const incoming = normalizeTaskList(nextTasks);
    tasks.update((current) => {
        const merged = new Map(current.map((task) => [task.id, task]));
        incoming.forEach((task) => {
            merged.set(task.id, task);
        });

        return normalizeTaskList([...merged.values()]);
    });
}

/**
 * @param {string} taskId
 * @param {string} nextStatus
 */
export function moveTask(taskId, nextStatus) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = moveTaskInList(current, taskId, nextStatus);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 * @param {string | null} nextParentId
 */
export function assignParent(taskId, nextParentId) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = assignParentInList(current, taskId, nextParentId);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 * @param {Partial<import('../shared/task-domain.js').Task>} patch
 */
export function updateTask(taskId, patch) {
    /** @type {import('../shared/task-domain.js').Task | null} */
    let syncedTask = null;
    tasks.update((current) => {
        const next = updateTaskInList(current, taskId, patch);
        syncedTask = next.find((task) => task.id === taskId) ?? null;
        return next;
    });
    syncTaskSnapshot(syncedTask);
}

/**
 * @param {string} taskId
 */
export function toggleCollapse(taskId) {
    tasks.update((current) =>
        current.map((task) => task.id === taskId ? { ...task, collapsed: !task.collapsed } : task)
    );
}

/**
 * @param {string} taskId
 */
export function deleteTaskCascade(taskId) {
    tasks.update((current) => deleteTaskCascadeFromList(current, taskId));
    syncTaskDelete(taskId);
}

export function clearDoneTasks() {
    tasks.update((current) => clearDoneTasksFromList(current));
}

/**
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtask(taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    tasks.update((current) => addSubtaskToList(current, taskId, text));
    syncChecklistCreate(taskId, trimmed);
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function toggleSubtask(taskId, subtaskId) {
    /** @type {boolean | null} */
    let done = null;
    tasks.update((current) => {
        const next = toggleSubtaskInList(current, taskId, subtaskId);
        done = next.find((task) => task.id === taskId)?.subtasks.find((subtask) => subtask.id === subtaskId)?.done ?? null;
        return next;
    });

    if (done !== null) {
        syncChecklistPatch(taskId, subtaskId, { done });
    }
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {string} text
 */
export function renameSubtask(taskId, subtaskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    tasks.update((current) => renameSubtaskInList(current, taskId, subtaskId, text));
    syncChecklistPatch(taskId, subtaskId, { text: trimmed });
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function deleteSubtask(taskId, subtaskId) {
    tasks.update((current) => deleteSubtaskFromList(current, taskId, subtaskId));
    syncChecklistDelete(taskId, subtaskId);
}

/**
 * @param {import('../shared/task-domain.js').Task | null} task
 */
function syncTaskSnapshot(task) {
    if (!task || !shouldSyncServerTask(task.id)) {
        return;
    }

    void updateServerTask(task.id, toServerTaskPatch(task)).then(reportSyncFailure);
}

/**
 * @param {string} taskId
 */
function syncTaskDelete(taskId) {
    if (!shouldSyncServerTask(taskId)) {
        return;
    }

    void deleteServerTask(taskId).then(reportSyncFailure);
}

/**
 * @param {string} taskId
 * @param {string} text
 */
function syncChecklistCreate(taskId, text) {
    if (!shouldSyncServerTask(taskId)) {
        return;
    }

    void createServerChecklistItem(taskId, text).then(syncReturnedTask);
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 * @param {{ text?: string; done?: boolean }} patch
 */
function syncChecklistPatch(taskId, subtaskId, patch) {
    if (!shouldSyncServerTask(taskId) || !isServerTaskId(subtaskId)) {
        return;
    }

    void updateServerChecklistItem(taskId, subtaskId, patch).then(syncReturnedTask);
}

/**
 * @param {string} taskId
 * @param {string} subtaskId
 */
function syncChecklistDelete(taskId, subtaskId) {
    if (!shouldSyncServerTask(taskId) || !isServerTaskId(subtaskId)) {
        return;
    }

    void deleteServerChecklistItem(taskId, subtaskId).then(syncReturnedTask);
}

/**
 * @param {string} taskId
 */
function shouldSyncServerTask(taskId) {
    return typeof window !== 'undefined' && isServerTaskId(taskId);
}

/**
 * @param {import('../shared/task-domain.js').Task} task
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
        parentId: isServerTaskId(task.parentId) ? task.parentId : null
    };
}

/**
 * @param {{ ok: true } | { ok: false; fallback: boolean; message: string }} result
 */
function reportSyncFailure(result) {
    if (!result.ok && !result.fallback) {
        console.error('Failed to sync task mutation', result.message);
    }
}

/**
 * @param {{ ok: true; task: import('../shared/task-domain.js').Task } | { ok: false; fallback: boolean; message: string }} result
 */
function syncReturnedTask(result) {
    if (result.ok) {
        mergeTasks([result.task]);
        return;
    }

    reportSyncFailure(result);
}
