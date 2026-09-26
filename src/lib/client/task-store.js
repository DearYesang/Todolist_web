/**
 * The client task store. Components, task-sync.js and the tests import from
 * this file; the code lives in ./task-store/:
 *
 * - task-cache.js: the tasks store, its per-user localStorage cache and the
 *   whole-list writes (replace, merge, remove, re-key a local task).
 * - view-preference.js: the current view and a pending server default view.
 * - filters.js: the board filters.
 * - category-store.js: the category catalog, its summaries and category edits.
 * - sync-engine.js: per-task server write chains, draining them to the offline
 *   queue, and server results that must not revert queued local edits.
 * - task-mutations.js: optimistic task and checklist edits.
 * - cross-tab-sync.js: applying another tab's cache writes.
 *
 * The order of the exports below is the modules' load order. task-cache.js
 * loads first so the tasks cache is read before the view preference, as it
 * was when this was one file.
 */

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
    assignTaskCategory,
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
    waitForPendingTaskSyncs
} from './task-store/sync-engine.js';

export {
    addSubtask,
    assignParent,
    clearDoneTasks,
    deleteSubtask,
    deleteTaskCascade,
    moveTask,
    renameSubtask,
    toggleCollapse,
    toggleSubtask,
    updateTask
} from './task-store/task-mutations.js';

export { setupCrossTabTaskSync } from './task-store/cross-tab-sync.js';

/** @typedef {import('./task-store/view-preference.js').AppView} AppView */
