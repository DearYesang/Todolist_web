import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import { importFromRoot, rootHas } from '../root.js';

// The code under test comes from the checkout ../root.js names (FUZZ_ROOT).
// A checkout without user-scope.js (origin/main before #84) is skipped.
const hasUserScope = rootHas('src/lib/client/user-scope.js');
const { syncServerTasks } = await importFromRoot('src/lib/client/task-store.js');
const { applyUserScope } = hasUserScope ? await importFromRoot('src/lib/client/user-scope.js') : { applyUserScope: () => {} };

const TASK_A = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!hasUserScope)('PR84 design review: a queue sync that outlives its user', () => {
	/** @type {Map<string, string>} */
	let storage;
	/** @type {ReturnType<typeof createDeferred>} */
	let firstAnswer;
	/** @type {{ url: string; method: string; scope: string | null }[]} */
	let sent;
	/** @type {string | null} */
	let currentScope;

	beforeEach(() => {
		storage = installMemoryStorage();
		vi.stubGlobal('window', {});
		firstAnswer = createDeferred();
		sent = [];
		currentScope = null;
		// The first request stays out until the test answers it; later ones
		// succeed, as they would under whatever session cookie is current.
		vi.stubGlobal('fetch', vi.fn((/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
			sent.push({ url, method: init.method ?? 'GET', scope: currentScope });
			if (sent.length === 1) {
				return firstAnswer.promise;
			}
			return Promise.resolve(jsonResponse({ task: { id: '99999999-9999-4999-8999-999999999999', text: 'Created', version: 1 } }, { status: 201 }));
		}));
	});

	afterEach(() => {
		applyUserScope(null);
	});

	/** @param {unknown[]} mutations */
	function seedUserA(mutations) {
		storage.set('kanbanTasks:user-a', JSON.stringify([{ id: TASK_A, text: 'Mine', version: 1 }, { id: 'local-a', text: 'Offline task' }]));
		storage.set('kanbanOfflineWriteQueue:user-a', JSON.stringify(mutations));
		applyUserScope('user-a');
		currentScope = 'user-a';
	}

	// T3: user A's queued edit meets a 409 (a real conflict with an edit
	// from another device) while A signs out. The flush drops it from A's
	// queue as reported, and syncServerTasks drops the report because the
	// owner changed: the edit is neither on the server, nor in A's queue,
	// nor shown to anyone.
	it('T3: keeps user A\'s conflicting edit somewhere when A signs out during the sync', async () => {
		seedUserA([
			{ id: 'm1', ownerUserId: 'user-a', createdAt: 1, attempts: 0, type: 'task.patch', taskId: TASK_A, patch: { text: 'A offline edit', expectedVersion: 1 } }
		]);
		const syncing = syncServerTasks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent).toHaveLength(1);

		applyUserScope(null);
		currentScope = null;
		firstAnswer.resolve(jsonResponse({ message: 'Conflict' }, { status: 409 }));
		const result = await syncing;

		expect({
			reported: result.offlineConflicts.length,
			userAQueue: JSON.parse(storage.get('kanbanOfflineWriteQueue:user-a') ?? '[]').length
		}).not.toEqual({ reported: 0, userAQueue: 0 });
	});

	// T4: the flush keeps sending user A's queue after the queue moved to
	// user B, so A's later mutations go out with B's session cookie.
	it('T4: stops sending user A\'s queue once user B holds the queue', async () => {
		seedUserA([
			{ id: 'm1', ownerUserId: 'user-a', createdAt: 1, attempts: 0, type: 'task.patch', taskId: TASK_A, patch: { text: 'A edit', expectedVersion: 1 } },
			{ id: 'm2', ownerUserId: 'user-a', createdAt: 2, attempts: 0, type: 'task.create', localTaskId: 'local-a', payload: { text: 'A offline task' } }
		]);
		const syncing = syncServerTasks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent).toHaveLength(1);

		applyUserScope('user-b');
		currentScope = 'user-b';
		firstAnswer.resolve(jsonResponse({ task: { id: TASK_A, text: 'A edit', version: 2 } }));
		await syncing;

		expect(sent.filter((request) => request.scope === 'user-b' && request.method !== 'GET')).toEqual([]);
	});
});
