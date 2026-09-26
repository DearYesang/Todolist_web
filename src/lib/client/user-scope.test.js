import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import { DEFAULT_FILTERS } from '../shared/task-domain.js';
import { linkOpenState, requestOpenLinks } from './link-opener.js';
import {
	addSubtask,
	categories,
	deleteSubtask,
	filters,
	markPendingDefaultView,
	readPendingDefaultView,
	renameSubtask,
	setCategoryFilter,
	setPriorityFilter,
	settlePendingTaskSyncs,
	syncServerTasks,
	tasks,
	toggleSubtask,
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

	/** Signs user A in and leaves a catalog, filters and a pending view. */
	async function leaveUserABoardState() {
		seedUserData('user-a', { taskText: 'User A task' });
		applyUserScope('user-a');
		await syncCategoryCatalog();
		setCategoryFilter(CATEGORY_ID, '서버 카테고리');
		setPriorityFilter('high');
		markPendingDefaultView('gantt');
	}

	function readBoardState() {
		return {
			categories: get(categories),
			filters: get(filters),
			pendingView: readPendingDefaultView()
		};
	}

	// Probes P2 and P3. Left behind, a pending view is sent by App.svelte's
	// next sync as the default view of whoever signs in next.
	it('drops the previous user\'s catalog, filters and pending default view when another user signs in', async () => {
		await leaveUserABoardState();

		applyUserScope('user-b');

		expect(readBoardState()).toEqual({ categories: [], filters: DEFAULT_FILTERS, pendingView: null });
	});

	it('drops the catalog and filters but keeps a pending default view when the board goes to no user', async () => {
		// A session check that fails on a network that reports online does
		// this: the view is sent once the user's session is confirmed again.
		// Sign-out drops it itself (AuthAccountControls.svelte).
		await leaveUserABoardState();

		applyUserScope(null);

		expect(readBoardState()).toEqual({ categories: [], filters: DEFAULT_FILTERS, pendingView: 'gantt' });
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

describe('signing out while a task write is still in flight', () => {
	const TASK_ID = '11111111-1111-4111-8111-111111111111';
	// A checklist item the server has, and the id it gives an item the tests
	// add.
	const ITEM = { id: '22222222-2222-4222-8222-222222222222', text: 'Item', done: false };
	const NEW_ITEM_ID = '33333333-3333-4333-8333-333333333333';
	/** @type {Map<string, string>} */
	let storage;
	/** @type {ReturnType<typeof createDeferred>[]} */
	let answers = [];
	/** @type {(string | undefined)[]} */
	let sent = [];

	beforeEach(() => {
		vi.useFakeTimers();
		storage = installMemoryStorage();
		// The sync engine sends task writes only in a browser.
		vi.stubGlobal('window', {});
		answers = [];
		sent = [];
		// Every request stays out until the test answers it, as on a network
		// that has stopped answering.
		vi.stubGlobal('fetch', vi.fn((/** @type {unknown} */ _url, /** @type {RequestInit} */ init) => {
			sent.push(init.body ? JSON.parse(String(init.body)).text : init.method);
			const answer = createDeferred();
			answers.push(answer);
			return answer.promise;
		}));
		storage.set('kanbanTasks:user-a', JSON.stringify([{ id: TASK_ID, text: 'Saved', version: 1, subtasks: [ITEM] }]));
		applyUserScope('user-a');
	});

	afterEach(async () => {
		// Ends the requests a test left out, and those they let go out, so no
		// task's write chain stays busy for the tests after it.
		let answered = 0;
		while (answered < answers.length) {
			answers.slice(answered).forEach((answer) => answer.resolve(jsonResponse({ message: 'Unavailable' }, { status: 503 })));
			answered = answers.length;
			await vi.advanceTimersByTimeAsync(0);
		}
		applyUserScope(null);
		vi.useRealTimers();
	});

	/**
	 * Sign-out as AuthAccountControls.svelte runs it: the 5 second wait, the
	 * "clear local data" question, authClient.signOut() (which succeeds
	 * here), the clear, and then the session refetch that hands the board to
	 * no user.
	 * @param {{ clearLocalData: boolean; confirm?: boolean; duringSignOut?: () => void }} options
	 *   confirm: the answer to the question. duringSignOut: what the user
	 *   does while the sign-out request is out.
	 * @returns {Promise<{ asked: number | null; signedOut: boolean }>} the count
	 *   the question named (null when it was not asked) and whether the
	 *   sign-out went ahead
	 */
	async function signOut({ clearLocalData, confirm = true, duringSignOut = () => {} }) {
		const signingOut = (async () => {
			await settlePendingTaskSyncs({ timeoutMs: 5000 });
			const pendingChanges = countPendingLocalChanges();
			const asked = clearLocalData && pendingChanges > 0 ? pendingChanges : null;
			if (asked !== null && !confirm) {
				return { asked, signedOut: false };
			}
			duringSignOut();
			if (clearLocalData) {
				clearUserLocalData();
			}
			applyUserScope(null);
			return { asked, signedOut: true };
		})();
		await vi.advanceTimersByTimeAsync(5000);
		return signingOut;
	}

	/** Edits the task and lets its PATCH go out. */
	async function editInFlight() {
		updateTask(TASK_ID, { text: 'Edit 1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(sent).toEqual(['Edit 1']);
	}

	/**
	 * Answers the first request.
	 * @param {Response} response
	 */
	async function answerFirstRequest(response) {
		answers[0].resolve(response);
		await vi.advanceTimersByTimeAsync(0);
	}

	/** The signed-out user's and the anonymous offline queue. */
	function readQueues() {
		return {
			userA: JSON.parse(storage.get('kanbanOfflineWriteQueue:user-a') ?? '[]'),
			anonymous: JSON.parse(storage.get('kanbanOfflineWriteQueue:anonymous') ?? '[]')
		};
	}

	/** @param {string} text */
	function queuedPatch(text) {
		return expect.objectContaining({
			type: 'task.patch',
			taskId: TASK_ID,
			ownerUserId: 'user-a',
			patch: expect.objectContaining({ text, expectedVersion: 1 })
		});
	}

	const unauthorized = () => jsonResponse({ message: 'Unauthorized' }, { status: 401 });

	/**
	 * A checklist write in the signed-out user's queue.
	 * @param {Record<string, unknown>} fields
	 */
	function queuedItemWrite(fields) {
		return expect.objectContaining({ taskId: TASK_ID, ownerUserId: 'user-a', ...fields });
	}

	/** The id the board gave the checklist item added last. */
	function lastItemId() {
		const items = get(tasks).find((task) => task.id === TASK_ID)?.subtasks ?? [];
		return items[items.length - 1].id;
	}

	/** The server's answer to the create of an item 'New': NEW_ITEM_ID. */
	const itemCreated = () => jsonResponse({
		task: { id: TASK_ID, text: 'Saved', version: 2, subtasks: [ITEM, { id: NEW_ITEM_ID, text: 'New', done: false }] }
	}, { status: 201 });

	// Codex review P1: the wait ends after 5 seconds and moves only the
	// writes that have not started to the queue. The request already out
	// stays unprotected: when it fails after the sign-out, the queue belongs
	// to no user.
	it('queues a write that fails after the sign-out under the user who made it', async () => {
		await editInFlight();
		await expect(signOut({ clearLocalData: false })).resolves.toEqual({ asked: null, signedOut: true });

		// The session is gone, so the server answers 401, which task-api
		// treats as worth retrying.
		await answerFirstRequest(unauthorized());

		expect(readQueues()).toEqual({ userA: [queuedPatch('Edit 1')], anonymous: [] });
	});

	it('counts a write still in flight when the wait ends, and keeps it when the question is cancelled', async () => {
		await editInFlight();
		await expect(signOut({ clearLocalData: true, confirm: false })).resolves.toEqual({ asked: 1, signedOut: false });

		// Still signed in: a failure worth retrying queues the edit as always.
		await answerFirstRequest(jsonResponse({ message: 'Unavailable' }, { status: 503 }));

		expect(readQueues()).toEqual({ userA: [queuedPatch('Edit 1')], anonymous: [] });
		expect(countPendingLocalChanges()).toBe(1);
	});

	it('drops the late failure of a write that a confirmed clear counted', async () => {
		await editInFlight();
		await expect(signOut({ clearLocalData: true })).resolves.toEqual({ asked: 1, signedOut: true });

		await answerFirstRequest(unauthorized());

		expect(readQueues()).toEqual({ userA: [], anonymous: [] });
		expect(storage.get('kanbanTasks:user-a')).toBe('[]');
	});

	it('leaves no copy of a write that lands after the sign-out in any queue', async () => {
		await editInFlight();
		await signOut({ clearLocalData: false });

		await answerFirstRequest(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));

		// Queued as well, it would be sent again at the user's next sync and
		// meet a 409 on the version this answer moved past.
		expect(readQueues()).toEqual({ userA: [], anonymous: [] });
		expect(get(tasks)).toEqual([]);
	});

	// Verifier finding, older than this PR. The answer stays off the next
	// board, and the user's cached board keeps the version the write started
	// from. The user's next sign-in here opens the board from that cache; an
	// edit made before the first sync expects that version and meets a 409.
	it('moves the task in the user\'s cached board to the version a write that lands after the sign-out reached', async () => {
		await editInFlight();
		await signOut({ clearLocalData: false });

		await answerFirstRequest(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));

		expect(JSON.parse(storage.get('kanbanTasks:user-a') ?? '[]')).toEqual([
			expect.objectContaining({ id: TASK_ID, text: 'Edit 1', version: 2 })
		]);
		applyUserScope('user-a');
		expect(get(tasks).map((task) => [task.text, task.version])).toEqual([['Edit 1', 2]]);
	});

	// The same for an item whose create lands after the sign-out: the cache
	// keeps its local id. With no create of that id left in the queue, an
	// edit or delete of it before the user's first sync is dropped.
	it('gives the item in the user\'s cached board the id its create got after the sign-out', async () => {
		addSubtask(TASK_ID, 'New');
		await vi.advanceTimersByTimeAsync(0);
		await signOut({ clearLocalData: false });

		await answerFirstRequest(itemCreated());

		expect(JSON.parse(storage.get('kanbanTasks:user-a') ?? '[]')).toEqual([
			expect.objectContaining({ id: TASK_ID, version: 2, subtasks: [ITEM, { id: NEW_ITEM_ID, text: 'New', done: false }] })
		]);
	});

	it('keeps a write that lands after the sign-out off the next board, even one holding the same task', async () => {
		// Server ids are per user, so another board holds the task only in a
		// case like this one: a device that ran the app before caches were
		// kept per user still shows that shared cache when signed out.
		storage.set('kanbanTasks', JSON.stringify([{ id: TASK_ID, text: 'Old copy', version: 1 }]));
		await editInFlight();
		await signOut({ clearLocalData: false });
		expect(get(tasks).map((task) => task.text)).toEqual(['Old copy']);

		await answerFirstRequest(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));

		expect(get(tasks).map((task) => [task.text, task.version])).toEqual([['Old copy', 1]]);
		expect(storage.get('kanbanTasks:anonymous') ?? storage.get('kanbanTasks')).not.toContain('Edit 1');
	});

	it('queues an edit made during the sign-out behind the write in flight under the same user', async () => {
		await editInFlight();
		await signOut({
			clearLocalData: false,
			// Waits in the task's chain behind the first PATCH.
			duringSignOut: () => updateTask(TASK_ID, { text: 'Edit 2' })
		});

		await answerFirstRequest(unauthorized());

		// The second edit holds every field of the first, which the queue
		// must not put back over it.
		expect(readQueues()).toEqual({ userA: [queuedPatch('Edit 2')], anonymous: [] });
		expect(sent).toEqual(['Edit 1']);
	});

	it('queues that edit on top of the write in flight when the write lands after the sign-out', async () => {
		await editInFlight();
		await signOut({
			clearLocalData: false,
			duringSignOut: () => updateTask(TASK_ID, { text: 'Edit 2' })
		});

		await answerFirstRequest(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));

		// Sent at the user's next sync, it must expect the version the first
		// edit landed at, or it meets a 409 as a conflict with itself.
		expect(readQueues()).toEqual({
			userA: [expect.objectContaining({
				type: 'task.patch',
				taskId: TASK_ID,
				ownerUserId: 'user-a',
				patch: expect.objectContaining({ text: 'Edit 2', expectedVersion: 2 })
			})],
			anonymous: []
		});
	});

	// Verifier finding on bfcec00. The board goes to no user and back while
	// a request is out: the user signed out in another tab, or the server
	// ended the session, and the user signed in again. The edit waiting
	// behind the request moved to the user's queue. Back on the board, the
	// user edits the task again; that edit waits behind the same request,
	// goes out after it and lands. The queued older edit then goes out at
	// the next sync into a 409 that reports it as a conflict, and applied
	// from there it would undo the newer edit.
	it('retires the queued edit once the edit made after the user came back lands', async () => {
		await editInFlight();
		updateTask(TASK_ID, { text: 'Edit 2' });
		applyUserScope(null);
		applyUserScope('user-a');
		updateTask(TASK_ID, { text: 'Edit 3' });

		await answerFirstRequest(jsonResponse({ task: { id: TASK_ID, text: 'Edit 1', version: 2 } }));
		expect(sent).toEqual(['Edit 1', 'Edit 3']);
		answers[1].resolve(jsonResponse({ task: { id: TASK_ID, text: 'Edit 3', version: 3 } }));
		await vi.advanceTimersByTimeAsync(0);

		expect({
			queues: readQueues(),
			board: get(tasks).map((task) => [task.text, task.version])
		}).toEqual({ queues: { userA: [], anonymous: [] }, board: [['Edit 3', 3]] });
	});

	// Checklist writes, as the task edits above. The sign-out moves an edit
	// of an item waiting behind the item's request in flight to the queue,
	// and the request then fails or lands. Before 79bee3c its failure went to
	// the queue of no user; now it goes to the user's queue, after the edit.

	// The queue merges an item's patches with the later one on top, so the
	// older rename, queued after the newer one, wins.
	it('keeps the later rename of a checklist item when the rename in flight fails after the sign-out', async () => {
		renameSubtask(TASK_ID, ITEM.id, 'First');
		await vi.advanceTimersByTimeAsync(0);
		// Waits in the task's chain behind the first PATCH.
		renameSubtask(TASK_ID, ITEM.id, 'Last');
		await signOut({ clearLocalData: false });

		await answerFirstRequest(unauthorized());

		expect(readQueues()).toEqual({
			userA: [queuedItemWrite({ type: 'checklist.patch', itemId: ITEM.id, patch: { text: 'Last' } })],
			anonymous: []
		});
	});

	// The drain queues the toggle of an item whose create is out as a create
	// with the item's final state; the create's failure adds a second one.
	it('queues one create of an item whose create fails after the sign-out queued a later edit of it', async () => {
		addSubtask(TASK_ID, 'New');
		await vi.advanceTimersByTimeAsync(0);
		const localItemId = lastItemId();
		toggleSubtask(TASK_ID, localItemId);
		await signOut({ clearLocalData: false });

		await answerFirstRequest(unauthorized());

		expect(readQueues()).toEqual({
			userA: [queuedItemWrite({ type: 'checklist.create', localItemId, text: 'New', done: true })],
			anonymous: []
		});
	});

	// The drain has nothing to queue for the delete of an item whose create
	// is out; the create's failure then queues the deleted item again.
	it('queues nothing for an item deleted while its create was out, when the create fails after the sign-out', async () => {
		addSubtask(TASK_ID, 'New');
		await vi.advanceTimersByTimeAsync(0);
		deleteSubtask(TASK_ID, lastItemId());
		await signOut({ clearLocalData: false });

		await answerFirstRequest(unauthorized());

		expect(readQueues()).toEqual({ userA: [], anonymous: [] });
	});

	// Here the create lands, and the queued create would add the item a
	// second time at the user's next sync.
	it('turns the queued create into an edit of the item when its create lands after the sign-out', async () => {
		addSubtask(TASK_ID, 'New');
		await vi.advanceTimersByTimeAsync(0);
		toggleSubtask(TASK_ID, lastItemId());
		await signOut({ clearLocalData: false });

		await answerFirstRequest(itemCreated());

		expect(readQueues()).toEqual({
			userA: [queuedItemWrite({ type: 'checklist.patch', itemId: NEW_ITEM_ID, patch: { done: true } })],
			anonymous: []
		});
	});

	// And the item deleted while its create was out stays on the server.
	it('queues the delete of an item deleted while its create was out, when the create lands after the sign-out', async () => {
		addSubtask(TASK_ID, 'New');
		await vi.advanceTimersByTimeAsync(0);
		deleteSubtask(TASK_ID, lastItemId());
		await signOut({ clearLocalData: false });

		await answerFirstRequest(itemCreated());

		expect(readQueues()).toEqual({
			userA: [queuedItemWrite({ type: 'checklist.delete', itemId: NEW_ITEM_ID })],
			anonymous: []
		});
	});
});

// Verifier finding on PR #84, older than it. A sync sends the user's
// offline queue, and the user signs out, or another user signs in, while
// a request of it is out. The flush saved the queue of whoever owned it
// when the flush ended, so the user's queue kept what it had sent, to be
// sent again at their next sign-in; and syncServerTasks applied its answers
// to the board the store held by then.
describe('a sync of the offline queue that outlives its user', () => {
	const SERVER_TASK_ID = '11111111-1111-4111-8111-111111111111';
	const USER_B_TASK = { id: '22222222-2222-4222-8222-222222222222', text: 'User B task', version: 1 };
	/** @type {Map<string, string>} */
	let storage;
	/** @type {ReturnType<typeof createDeferred>} */
	let firstAnswer;

	beforeEach(() => {
		storage = installMemoryStorage();
		vi.stubGlobal('window', {});
		firstAnswer = createDeferred();
		// The queue's first request stays out until the test answers it; the
		// session has ended for every request after it.
		let requests = 0;
		vi.stubGlobal('fetch', vi.fn(() => {
			requests += 1;
			return requests === 1
				? firstAnswer.promise
				: Promise.resolve(jsonResponse({ message: 'Unauthorized' }, { status: 401 }));
		}));
		storage.set('kanbanTasks:user-b', JSON.stringify([USER_B_TASK]));
	});

	afterEach(() => {
		applyUserScope(null);
	});

	/**
	 * Seeds user A's cached board and offline queue.
	 * @param {Record<string, unknown>} localTask
	 * @param {Record<string, unknown>} mutation
	 */
	function seedUserA(localTask, mutation) {
		storage.set('kanbanTasks:user-a', JSON.stringify([localTask]));
		storage.set('kanbanOfflineWriteQueue:user-a', JSON.stringify([
			{ id: 'mutation-a', ownerUserId: 'user-a', createdAt: 1, attempts: 0, ...mutation }
		]));
		applyUserScope('user-a');
	}

	/**
	 * Starts a sync, hands the board to `nextUserId` while its first
	 * request is out, then answers that request.
	 * @param {string | null} nextUserId
	 * @param {Response} response
	 */
	async function syncWhileUserChanges(nextUserId, response) {
		const syncing = syncServerTasks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetch).toHaveBeenCalledTimes(1);
		applyUserScope(nextUserId);
		firstAnswer.resolve(response);
		await syncing;
	}

	/** @param {string} key */
	function readTexts(key) {
		return JSON.parse(storage.get(key) ?? '[]').map((/** @type {{ id: string; text: string }} */ task) => [task.id, task.text]);
	}

	it('settles the queue of the user who sent a create and leaves the next board alone', async () => {
		seedUserA({ id: 'local-a', text: 'Offline task' }, {
			type: 'task.create',
			localTaskId: 'local-a',
			payload: { text: 'Offline task' }
		});

		await syncWhileUserChanges(null, jsonResponse({ task: { id: SERVER_TASK_ID, text: 'Offline task', version: 1 } }, { status: 201 }));

		// Left in the queue, the create would make the task a second time at
		// user A's next sign-in; left on the local id, the cached task would
		// stay beside the server's copy.
		expect({
			userAQueue: storage.get('kanbanOfflineWriteQueue:user-a') ?? null,
			userACache: readTexts('kanbanTasks:user-a'),
			board: get(tasks)
		}).toEqual({
			userAQueue: null,
			userACache: [[SERVER_TASK_ID, 'Offline task']],
			board: []
		});
	});

	it('keeps the tasks of an import that lands after another user signed in off that user\'s board', async () => {
		seedUserA({ id: 'local-import', text: 'Imported' }, {
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Imported' }],
			localTaskIds: ['local-import']
		});

		await syncWhileUserChanges('user-b', jsonResponse({
			tasks: [{ id: SERVER_TASK_ID, text: 'Imported', version: 1 }],
			summary: { imported: 1 }
		}));

		expect({
			userAQueue: storage.get('kanbanOfflineWriteQueue:user-a') ?? null,
			userACache: readTexts('kanbanTasks:user-a'),
			board: get(tasks).map((task) => task.text),
			userBCache: readTexts('kanbanTasks:user-b')
		}).toEqual({
			userAQueue: null,
			userACache: [[SERVER_TASK_ID, 'Imported']],
			board: ['User B task'],
			userBCache: [[USER_B_TASK.id, 'User B task']]
		});
	});

	// Found while fixing the two above. A sign-out that clears local data
	// counts the queue, which the sync is still sending, and deletes it and
	// the cached board. The import's answer then puts the imported tasks
	// back in the cleared cache: through the board while it is still the
	// user's, before the session refetch hands it to no user, and since the
	// previous commit through the cache once it is not.
	/**
	 * Clears user A's local data while the import is out, and answers it
	 * with the board still user A's or already no user's.
	 * @param {{ answerAfterBoardLeaves: boolean }} options
	 */
	async function clearWhileImportIsOut({ answerAfterBoardLeaves }) {
		seedUserA({ id: 'local-import', text: 'Imported' }, {
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Imported' }],
			localTaskIds: ['local-import']
		});
		const syncing = syncServerTasks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetch).toHaveBeenCalledTimes(1);

		clearUserLocalData();
		if (answerAfterBoardLeaves) {
			applyUserScope(null);
		}
		firstAnswer.resolve(jsonResponse({
			tasks: [{ id: SERVER_TASK_ID, text: 'Imported', version: 1 }],
			summary: { imported: 1 }
		}));
		await syncing;
		applyUserScope(null);

		return {
			userAQueue: storage.get('kanbanOfflineWriteQueue:user-a') ?? null,
			userACache: readTexts('kanbanTasks:user-a')
		};
	}

	it('leaves the cleared cache empty when the answer comes before the board goes to no user', async () => {
		await expect(clearWhileImportIsOut({ answerAfterBoardLeaves: false })).resolves.toEqual({ userAQueue: null, userACache: [] });
	});

	it('leaves the cleared cache empty when the answer comes after the board went to no user', async () => {
		await expect(clearWhileImportIsOut({ answerAfterBoardLeaves: true })).resolves.toEqual({ userAQueue: null, userACache: [] });
	});
});
