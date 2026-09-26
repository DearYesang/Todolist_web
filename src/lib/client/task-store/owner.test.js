import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { applyServerCategoryCatalog, categoryCatalog } from './category-store.js';
import { filters, setCategoryFilter } from './filters.js';
import { setTaskStoreOwner } from './owner.js';
import { getTaskStorageOwner } from './task-cache.js';
import { markPendingDefaultView, readPendingDefaultView } from './view-preference.js';

const CATEGORY = {
	id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
	name: '이전 카테고리',
	color: null,
	sortOrder: 0,
	hiddenAt: null,
	archivedAt: null
};

describe('handing the board to a user', () => {
	beforeEach(() => {
		installMemoryStorage();
	});

	afterEach(() => {
		setTaskStoreOwner(null);
	});

	/** Leaves a catalog, a category filter and a pending view on the board. */
	function leaveBoardState() {
		applyServerCategoryCatalog([CATEGORY]);
		setCategoryFilter(CATEGORY.id, CATEGORY.name);
		markPendingDefaultView('gantt');
	}

	function readBoardState() {
		return {
			catalog: get(categoryCatalog).map((category) => category.name),
			categoryFilter: get(filters).category,
			pendingView: readPendingDefaultView()
		};
	}

	it('keeps everything when the same user is applied again', () => {
		setTaskStoreOwner('user-a');
		leaveBoardState();

		setTaskStoreOwner('user-a');
		setTaskStoreOwner(' user-a ');

		expect(getTaskStorageOwner()).toBe('user-a');
		expect(readBoardState()).toEqual({
			catalog: ['이전 카테고리'],
			categoryFilter: '이전 카테고리',
			pendingView: 'gantt'
		});
	});

	it('keeps a pending view but not the catalog or filters when the signed-out board gets a user', () => {
		leaveBoardState();

		setTaskStoreOwner('user-a');

		expect(getTaskStorageOwner()).toBe('user-a');
		expect(readBoardState()).toEqual({ catalog: [], categoryFilter: 'all', pendingView: 'gantt' });
	});

	it('resets the catalog, the filters and a pending view when a user hands over to another user', () => {
		setTaskStoreOwner('user-a');
		leaveBoardState();

		setTaskStoreOwner('user-b');

		expect(getTaskStorageOwner()).toBe('user-b');
		expect(readBoardState()).toEqual({ catalog: [], categoryFilter: 'all', pendingView: null });
	});

	it('keeps a pending view but not the catalog or filters when a user hands over to no user', () => {
		// A failed session check does this too; sign-out drops the view
		// itself.
		setTaskStoreOwner('user-a');
		leaveBoardState();

		setTaskStoreOwner(null);

		expect(getTaskStorageOwner()).toBeNull();
		expect(readBoardState()).toEqual({ catalog: [], categoryFilter: 'all', pendingView: 'gantt' });
	});
});
