import { describe, expect, it } from 'vitest';
import * as taskStore from './task-store.js';

const WRITABLE_STORES = ['categoryCatalog', 'currentView', 'filters', 'tasks'];
const DERIVED_STORES = ['categories', 'categorySummaries', 'visibleCategorySummaries'];
const FUNCTIONS = [
	'addSubtask',
	'applyServerCategoryCatalog',
	'applyServerDefaultView',
	'applyServerTaskResults',
	'applyServerTaskSnapshot',
	'assignParent',
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
});
