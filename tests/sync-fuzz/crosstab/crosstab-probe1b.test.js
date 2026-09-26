import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFromRoot } from '../root.js';
import { U, createSharedStorage, createTabDriver, json, openTab, readCache, readQueue } from './crosstab-harness.js';

const { normalizeTask } = await importFromRoot('src/lib/shared/task-domain.js');

const TASK = '11111111-1111-4111-8111-111111111111';

/** @type {ReturnType<typeof createSharedStorage>} */
let shared;
/** @type {ReturnType<typeof createTabDriver>} */
let driver;

/**
 * @param {string} name
 * @param {string} owner
 */
async function open(name, owner) {
	const tab = await openTab(name);
	shared.state.active = name;
	tab.cache.setTaskStorageOwner(owner);
	tab.queue.setOfflineQueueOwner(owner);
	shared.state.active = null;
	driver.tabs.push(tab);
	return tab;
}

beforeEach(() => {
	shared = createSharedStorage();
	driver = createTabDriver(shared);
});

describe('R1b network-error variant', () => {
	it('tab A landing a snapshot write drops the edit tab B queued meanwhile', async () => {
		const seed = normalizeTask({ id: TASK, text: 'orig', priority: 'low', version: 5 });
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const A = await open('A', U);
		const B = await open('B', U);
		const { requests, inTab, deliver } = driver;

		// A: the user raises the priority; the PATCH is out (slow server).
		await inTab(A, () => A.mutations.updateTask(TASK, { priority: 'high' }));
		expect(requests).toHaveLength(1);
		await deliver(); // B sees A's cached board (B has nothing pending)

		// B: the user renames the task; the server already committed A's
		// write, so B's PATCH (expectedVersion 5) meets 409, a retryable
		// failure: the chain queues B's edit under U.
		await inTab(B, () => B.mutations.updateTask(TASK, { text: 'from B' }));
		expect(requests).toHaveLength(2);
		expect(requests[1].body).toMatchObject({ text: 'from B', priority: 'high', expectedVersion: 5 });
		await inTab(B, () => requests[1].reject(new TypeError('Failed to fetch')));
		console.log('R1 queue after B failed:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])));
		await deliver(); // A keeps its own copy: its write is still in flight

		// A's write answers.
		await inTab(A, () => requests[0].resolve(json({ task: { ...seed, priority: 'high', version: 6 } })));
		await deliver();

		const queue = readQueue(shared.entries, U);
		console.log('R1 queue after A landed:', JSON.stringify(queue.map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])));
		console.log('R1 A board text:', get(A.cache.tasks)[0]?.text, '| B board text:', get(B.cache.tasks)[0]?.text, '| cache text:', readCache(shared.entries, U)[0]?.text);

		// Next sync from B: what reaches the user?
		const syncPromise = inTab(B, () => B.serverSync.syncServerTasks(globalThis.fetch));
		await new Promise((r) => setTimeout(r, 0));
		const flushRequests = requests.slice(2);
		console.log('R1 next sync requests:', JSON.stringify(flushRequests.map((r) => [r.method, r.url, r.body?.text, r.body?.expectedVersion])));
		for (let i = 2; i < requests.length; i += 1) {
			if (requests[i].method === 'PATCH') {
				requests[i].resolve(json({ message: 'conflict' }, 409));
			}
		}
		await settle2();
		// answer the snapshot/categories/prefs reads, if any
		for (let round = 0; round < 5; round += 1) {
			for (let i = 2; i < requests.length; i += 1) {
				const r = requests[i];
				if (r.method === 'GET' && !r.done) {
					r.done = true;
					if (r.url === '/api/tasks') r.resolve(json({ tasks: [{ ...seed, priority: 'high', version: 6 }] }));
					else if (r.url.includes('categor')) r.resolve(json({ categories: [] }));
					else r.resolve(json({ defaultView: 'board' }));
				}
			}
			await settle2();
		}
		const syncResult = await syncPromise;
		console.log('R1 sync result offlineConflicts:', JSON.stringify(syncResult?.offlineConflicts?.map((m) => [m.type, m.patch?.text])));

		// I1: B's rename is neither on the server (text 'orig') nor queued.
		expect(queue.some((m) => m.type === 'task.patch' && m.patch.text === 'from B')).toBe(true);
	});
});

async function settle2() {
	for (let i = 0; i < 5; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
