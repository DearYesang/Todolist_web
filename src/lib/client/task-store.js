/**
 * The client task store, as components use it: read-only stores and the
 * commands that change the board. Everything outside ./task-store/ imports
 * it from here; the code lives in ./task-store/:
 *
 * - task-cache.js: the tasks store, its per-user localStorage cache and the
 *   whole-list writes (replace, insert, merge, remove, re-key a local task).
 * - view-preference.js: the current view and a pending server default view.
 * - filters.js: the board filters.
 * - category-store.js: the category catalog, its summaries and category edits.
 * - owner.js: handing the board to the signed-in user.
 * - sync-engine.js: per-task server write chains, draining them to the offline
 *   queue, and server results that must not revert queued local edits.
 * - task-mutations.js: task creation, backup import, and optimistic task and
 *   checklist edits.
 * - task-create.js: the add-task form's server payload and local task.
 * - cross-tab-sync.js: applying another tab's cache writes.
 * - server-sync.js: flushing the offline queue and applying the server's
 *   tasks, categories and default view.
 *
 * The order of the imports and exports below is the modules' load order.
 * task-cache.js loads first so the tasks cache is read before the view
 * preference, as it was when this was one file.
 */

import { readonly } from 'svelte/store';
import { tasks as writableTasks } from './task-store/task-cache.js';
import { currentView as writableCurrentView } from './task-store/view-preference.js';
import { filters as writableFilters } from './task-store/filters.js';

// Only the modules in ./task-store/ write these stores; everyone else reads
// them and changes the board through the commands below.
export const tasks = readonly(writableTasks);
export const currentView = readonly(writableCurrentView);
export const filters = readonly(writableFilters);

export { clearLocalTaskCache } from './task-store/task-cache.js';

export {
    clearPendingDefaultView,
    markPendingDefaultView,
    readPendingDefaultView,
    setCurrentView
} from './task-store/view-preference.js';

export {
    setCategoryFilter,
    setPriorityFilter,
    setSearchFilter,
    setUrgencyFilter
} from './task-store/filters.js';

export {
    assignTaskCategory,
    categories,
    categorySummaries,
    clearCategory,
    mergeCategory,
    renameCategory,
    reorderCategories,
    setCategoryHidden,
    updateCategoryColor,
    visibleCategorySummaries
} from './task-store/category-store.js';

export { setTaskStoreOwner } from './task-store/owner.js';

export { drainPendingTaskSyncsToOfflineQueue } from './task-store/sync-engine.js';

export {
    addSubtask,
    assignParent,
    clearDoneTasks,
    createTask,
    deleteSubtask,
    deleteTaskCascade,
    importTasks,
    moveTask,
    renameSubtask,
    toggleCollapse,
    toggleSubtask,
    updateTask
} from './task-store/task-mutations.js';

export { setupCrossTabTaskSync } from './task-store/cross-tab-sync.js';

export { syncServerTasks } from './task-store/server-sync.js';
