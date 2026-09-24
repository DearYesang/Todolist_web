import {
    addSubtaskToList,
    assignParentInList,
    clearDoneTasksFromList,
    deleteSubtaskFromList,
    deleteTaskCascadeFromList,
    moveTaskInList,
    renameSubtaskInList,
    toggleSubtaskInList,
    updateTaskInList
} from '../shared/task-domain.js';
import { tasks } from './task-store/task-cache.js';
import {
    syncChecklistCreate,
    syncChecklistDelete,
    syncChecklistPatch,
    syncClearDoneTasks,
    syncTaskDelete,
    syncTaskSnapshot
} from './task-store/sync-engine.js';

export {
    clearLocalTaskCache,
    mergeTasks,
    removeTasksByIds,
    replaceLocalTaskWithServerTask,
    replaceTasks,
    setTaskStorageOwner,
    tasks
} from './task-store/task-cache.js';

export {
    applyServerDefaultView,
    clearPendingDefaultView,
    currentView,
    isAppView,
    markPendingDefaultView,
    readPendingDefaultView,
    setCurrentView
} from './task-store/view-preference.js';

export {
    filters,
    resetFilters,
    setCategoryFilter,
    setPriorityFilter,
    setSearchFilter,
    setUrgencyFilter
} from './task-store/filters.js';

export {
    applyServerCategoryCatalog,
    categories,
    categoryCatalog,
    categorySummaries,
    clearCategory,
    mergeCategory,
    renameCategory,
    reorderCategories,
    setCategoryHidden,
    updateCategoryColor,
    visibleCategorySummaries
} from './task-store/category-store.js';

export {
    applyServerTaskResults,
    applyServerTaskSnapshot,
    drainPendingTaskSyncsToOfflineQueue,
    resetTaskSyncStateForTests,
    waitForPendingTaskSyncs
} from './task-store/sync-engine.js';

export {
    handleExternalTaskStorageEvent,
    setupCrossTabTaskSync
} from './task-store/cross-tab-sync.js';

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
    /** @type {import('../shared/task-domain.js').Task | null} */
    let deletedTask = null;
    tasks.update((current) => {
        deletedTask = current.find((task) => task.id === taskId) ?? null;
        return deleteTaskCascadeFromList(current, taskId);
    });
    syncTaskDelete(taskId, deletedTask);
}

export function clearDoneTasks() {
    /** @type {import('../shared/task-domain.js').Task[]} */
    let previousTasks = [];
    tasks.update((current) => {
        previousTasks = current;
        return clearDoneTasksFromList(current);
    });
    void syncClearDoneTasks(previousTasks);
}

/**
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtask(taskId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    /** @type {string | null} */
    let subtaskId = null;
    tasks.update((current) => {
        const previousIds = new Set(current.find((task) => task.id === taskId)?.subtasks.map((subtask) => subtask.id) ?? []);
        const next = addSubtaskToList(current, taskId, text);
        subtaskId = next.find((task) => task.id === taskId)?.subtasks.find((subtask) => !previousIds.has(subtask.id))?.id ?? null;
        return next;
    });

    if (subtaskId) {
        syncChecklistCreate(taskId, subtaskId, trimmed);
    }
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
