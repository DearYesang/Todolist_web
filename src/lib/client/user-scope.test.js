import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { jsonResponse } from '$lib/test-support/http.js';
import { DEFAULT_FILTERS } from '../shared/task-domain.js';
import { linkOpenState, requestOpenLinks } from './link-opener.js';
import {
	categories,
	filters,
	markPendingDefaultView,
	readPendingDefaultView,
	setCategoryFilter,
	setPriorityFilter,
	settlePendingTaskSyncs,
	syncServerTasks,
	tasks,
	updateTask
} from './task-store.js';
import {
	applyUserScope,
	cacheAuthScope,
	clearCachedAuthScope,
	clearUserLocalData,
	countPendingLocalChanges,
	readCachedAuthScope
} from './user-scope.js';

const CATEGORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('auth session scope cache', () => {
	/** @type {Map<string, string>} */
	let storage;

	beforeEach(() => {
		storage = installMemoryStorage();
	});

	it('stores the last authenticated user for offline unlock', () => {
		const scope = cacheAuthScope({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});

		expect(scope).toMatchObject({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});
		expect(readCachedAuthScope()).toMatchObject({
			id: 'user-id',
			email: 'primary@example.com',
			name: 'Yesang'
		});
		expect(JSON.parse(storage.get('todokanbanAuthScope') ?? 'null')).toMatchObject({ id: 'user-id' });

		clearCachedAuthScope();
		expect(readCachedAuthScope()).toBeNull();
	});

	it('ignores invalid cached records', () => {
		storage.set('todokanbanAuthScope', JSON.stringify({ email: 'primary@example.com' }));
		expect(readCachedAuthScope()).toBeNull();
	});
});

describe('user scope', () => {
	/** @type {Map<string, string>} */
	let storage;

	beforeEach(() => {
		storage = installMemoryStorage();
	});

	afterEach(() => {
		applyUserScope(null);
	});

	/**
	 * Seeds `userId`'s cached board and offline queue the way the app
	 * stores them.
	 * @param {string} userId
	 * @param {{ taskText: string; queued?: number }} data
	 */
	function seedUserData(userId, { taskText, queued = 0 }) {
		storage.set(`kanbanTasks:${userId}`, JSON.stringify([{ id: `local-${userId}`, text: taskText }]));
		if (queued > 0) {
			storage.set(`kanbanOfflineWriteQueue:${userId}`, JSON.stringify(Array.from({ length: queued }, (_, index) => ({
				id: `mutation-${userId}-${index}`,
				type: 'task.patch',
				taskId: `local-${userId}`,
				patch: { text: taskText },
				ownerUserId: userId,
				createdAt: 1,
				attempts: 0
			}))));
		}
	}

	/** Loads a category catalog the way a finished server sync does. */
	async function syncCategoryCatalog() {
		await syncServerTasks(vi.fn(async (/** @type {unknown} */ url) => {
			if (url === '/api/categories') {
				return jsonResponse({ categories: [{ id: CATEGORY_ID, name: '서버 카테고리', sortOrder: 0 }] });
			}
			return url === '/api/tasks'
				? jsonResponse({ tasks: [] })
				: jsonResponse({ message: 'Unavailable.' }, { status: 503 });
		}));
	}

	function openLinkConfirmStep() {
		requestOpenLinks(Array.from({ length: 11 }, (_, index) => ({
			href: `https://example.com/${index + 1}`,
			label: `링크 ${index + 1}`,
			taskId: 'task-1',
			taskText: '링크 모음'
		})));
	}

	it('points the task cache, the offline queue and the link-open state at the signed-in user', async () => {
		seedUserData('user-a', { taskText: 'User A task' });
		seedUserData('user-b', { taskText: 'User B task', queued: 2 });

		applyUserScope('user-a');
		expect(get(tasks).map((task) => task.text)).toEqual(['User A task']);
		await syncCategoryCatalog();
		expect(get(categories)).toEqual(['서버 카테고리']);
		openLinkConfirmStep();
		expect(get(linkOpenState)?.phase).toBe('confirm');
		expect(countPendingLocalChanges()).toBe(0);

		applyUserScope('user-b');
		expect(get(tasks).map((task) => task.text)).toEqual(['User B task']);
		expect(countPendingLocalChanges()).toBe(2);
		expect(get(linkOpenState)).toBeNull();
		// The catalog was user A's; the next finished sync loads user B's.
		expect(get(categories)).toEqual([]);

		applyUserScope(null);
		expect(get(tasks)).toEqual([]);
		expect(countPendingLocalChanges()).toBe(0);
		expect(storage.get('kanbanTasks:user-a')).toContain('User A task');
		expect(storage.get('kanbanTasks:user-b')).toContain('User B task');
	});

	it('changes nothing when the same user is applied again, as a session refetch does', async () => {
		seedUserData('user-a', { taskText: 'User A task' });

		applyUserScope('user-a');
		await syncCategoryCatalog();
		openLinkConfirmStep();
		// Queued after the sync, which would have sent it.
		seedUserData('user-a', { taskText: 'User A task', queued: 1 });
		applyUserScope('user-a');

		expect(get(tasks).map((task) => task.text)).toEqual(['User A task']);
		expect(countPendingLocalChanges()).toBe(1);
		expect(get(linkOpenState)?.phase).toBe('confirm');
		expect(get(categories)).toEqual(['서버 카테고리']);
	});

	// Probes P2 and P3. Left behind, a pending view is sent by App.svelte's
	// next sync as the default view of whoever signs in next.
	it.each([
		{ change: 'another user signs in', nextUserId: 'user-b' },
		{ change: 'the user signs out', nextUserId: null }
	])('drops the previous user\'s catalog, filters and pending default view when $change', async ({ nextUserId }) => {
		seedUserData('user-a', { taskText: 'User A task' });
		applyUserScope('user-a');
		await syncCategoryCatalog();
		setCategoryFilter(CATEGORY_ID, '서버 카테고리');
		setPriorityFilter('high');
		markPendingDefaultView('gantt');

		applyUserScope(nextUserId);

		expect({
			categories: get(categories),
			filters: get(filters),
			pendingView: readPendingDefaultView()
		}).toEqual({
			categories: [],
			filters: DEFAULT_FILTERS,
			pendingView: null
		});
	});

	it('keeps a pending default view when the app opens as the cached user', () => {
		// Set offline in an earlier visit; the first sync once the session
		// is confirmed sends it.
		storage.set('todokanbanPendingDefaultView', 'gantt');

		applyUserScope('user-a');
		applyUserScope('user-a');

		expect(readPendingDefaultView()).toBe('gantt');
	});

	it('clears only the signed-in user\'s queue, cached tasks and pending default view on sign-out', () => {
		seedUserData('user-a', { taskText: 'User A task', queued: 1 });
		seedUserData('user-b', { taskText: 'User B task', queued: 1 });
		applyUserScope('user-a');
		markPendingDefaultView('gantt');
		expect(storage.get('todokanbanPendingDefaultView')).toBe('gantt');
		expect(countPendingLocalChanges()).toBe(1);

		clearUserLocalData();

		expect(countPendingLocalChanges()).toBe(0);
		expect(get(tasks)).toEqual([]);
		expect(readPendingDefaultView()).toBeNull();
		// The emptied list is written back under the same key; user B's data
		// stays on the device.
		expect(Object.fromEntries(storage)).toEqual({
			'kanbanTasks:user-a': '[]',
			'kanbanTasks:user-b': expect.stringContaining('User B task'),
			'kanbanOfflineWriteQueue:user-b': expect.stringContaining('mutation-user-b-0')
		});
	});
});

describe('signing out during a task edit', () => {
	const TASK_ID = '11111111-1111-4111-8111-111111111111';
	/** @type {Map<string, string>} */
	let storage;
	let signedIn = true;
	/** @type {string[]} */
	let sent = [];

	/** @param {number} ms */
	const network = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	beforeEach(() => {
		vi.useFakeTimers();
		storage = installMemoryStorage();
		// The sync engine sends task writes only in a browser.
		vi.stubGlobal('window', {});
		signedIn = true;
		sent = [];
		// Each request takes 10 ms; the server checks the session when it
		// arrives.
		vi.stubGlobal('fetch', vi.fn(async (/** @type {unknown} */ _url, /** @type {RequestInit} */ init) => {
			const body = JSON.parse(String(init.body));
			const accepted = signedIn;
			sent.push(`${body.text} (${accepted ? 'signed in' : 'signed out'})`);
			await network(10);
			return accepted
				? jsonResponse({ task: { id: TASK_ID, text: body.text, version: body.expectedVersion + 1 } })
				: jsonResponse({ message: 'Unauthorized' }, { status: 401 });
		}));
		storage.set('kanbanTasks:user-a', JSON.stringify([{ id: TASK_ID, text: 'Saved', version: 1 }]));
		applyUserScope('user-a');
	});

	afterEach(() => {
		applyUserScope(null);
		vi.useRealTimers();
	});

	/**
	 * Sign-out as AuthAccountControls.svelte runs it with "clear local data"
	 * off, then the session refetch that signs the app out.
	 */
	async function signOut() {
		await settlePendingTaskSyncs({ timeoutMs: 5000 });
		// authClient.signOut(): the server ends the session and answers.
		signedIn = false;
		await network(10);
		// $session.refetch() finds no session, and App.svelte hands the board
		// to no user.
		await network(5);
		applyUserScope(null);
	}

	// Probe P1.
	it('sends an edit made just before sign-out while the user is still signed in', async () => {
		updateTask(TASK_ID, { text: 'Edit 1' });
		await vi.advanceTimersByTimeAsync(0);
		// Waits in the task's chain behind the first PATCH.
		updateTask(TASK_ID, { text: 'Edit 2' });

		const signingOut = signOut();
		await vi.advanceTimersByTimeAsync(100);
		await signingOut;

		expect({
			sent,
			anonymousQueue: JSON.parse(storage.get('kanbanOfflineWriteQueue:anonymous') ?? '[]'),
			userATasks: JSON.parse(storage.get('kanbanTasks:user-a') ?? '[]')
		}).toMatchObject({
			sent: ['Edit 1 (signed in)', 'Edit 2 (signed in)'],
			anonymousQueue: [],
			userATasks: [{ text: 'Edit 2', version: 3 }]
		});
	});
});
