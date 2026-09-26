import { describe, expect, it } from 'vitest';
import * as taskStore from './task-store.js';
import * as categoryStore from './task-store/category-store.js';
import * as crossTabSync from './task-store/cross-tab-sync.js';
import * as filters from './task-store/filters.js';
import * as syncEngine from './task-store/sync-engine.js';
import * as taskCache from './task-store/task-cache.js';
import * as taskMutations from './task-store/task-mutations.js';
import * as viewPreference from './task-store/view-preference.js';

/** @type {Record<string, Record<string, unknown>>} */
const OWNING_MODULES = {
	'category-store.js': categoryStore,
	'cross-tab-sync.js': crossTabSync,
	'filters.js': filters,
	'sync-engine.js': syncEngine,
	'task-cache.js': taskCache,
	'task-mutations.js': taskMutations,
	'view-preference.js': viewPreference
};

const WRITABLE_STORES = ['categoryCatalog', 'currentView', 'filters', 'tasks'];
const DERIVED_STORES = ['categories', 'categorySummaries', 'visibleCategorySummaries'];
const FUNCTIONS = [
	'addSubtask',
	'applyServerCategoryCatalog',
	'applyServerDefaultView',
	'applyServerTaskResults',
	'applyServerTaskSnapshot',
	'assignParent',
	'assignTaskCategory',
	'clearCategory',
	'clearDoneTasks',
	'clearLocalTaskCache',
	'clearPendingDefaultView',
	'deleteSubtask',
	'deleteTaskCascade',
	'drainPendingTaskSyncsToOfflineQueue',
	'handleExternalTaskStorageEvent',
	'isAppView',
	'markPendingDefaultView',
	'mergeCategory',
	'mergeTasks',
	'moveTask',
	'readPendingDefaultView',
	'removeTasksByIds',
	'renameCategory',
	'renameSubtask',
	'reorderCategories',
	'replaceLocalTaskWithServerTask',
	'replaceTasks',
	'resetFilters',
	'resetTaskSyncStateForTests',
	'setCategoryFilter',
	'setCategoryHidden',
	'setCurrentView',
	'setPriorityFilter',
	'setSearchFilter',
	'setTaskStorageOwner',
	'setUrgencyFilter',
	'setupCrossTabTaskSync',
	'toggleCollapse',
	'toggleSubtask',
	'updateCategoryColor',
	'updateTask',
	'waitForPendingTaskSyncs'
];

describe('task-store public API', () => {
	it('exports exactly the names components and task-sync import', () => {
		expect(Object.keys(taskStore).sort()).toEqual(
			[...WRITABLE_STORES, ...DERIVED_STORES, ...FUNCTIONS].sort()
		);
	});

	it('keeps each export the same kind of value', () => {
		const api = /** @type {Record<string, any>} */ (taskStore);
		for (const name of FUNCTIONS) {
			expect(typeof api[name], name).toBe('function');
		}
		for (const name of WRITABLE_STORES) {
			expect(typeof api[name].subscribe, name).toBe('function');
			expect(typeof api[name].set, name).toBe('function');
			expect(typeof api[name].update, name).toBe('function');
		}
		for (const name of DERIVED_STORES) {
			expect(typeof api[name].subscribe, name).toBe('function');
			expect(api[name].set, name).toBeUndefined();
		}
	});

	it('re-exports each name from exactly one task-store module, as the same instance', () => {
		const api = /** @type {Record<string, unknown>} */ (taskStore);
		for (const name of Object.keys(api)) {
			const owners = Object.entries(OWNING_MODULES).filter(([, module]) => name in module);
			expect(owners.map(([file]) => file), name).toHaveLength(1);
			expect(owners[0][1][name], name).toBe(api[name]);
		}
	});
});
