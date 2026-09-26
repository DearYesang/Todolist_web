import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFromRoot } from '../root.js';
import { U, createSharedStorage, createTabDriver, json, openTab, readQueue, settle } from './crosstab-harness.js';

const { normalizeTask } = await importFromRoot('src/lib/shared/task-domain.js');

const TASK = '11111111-1111-4111-8111-111111111111';
/** @type {ReturnType<typeof createSharedStorage>} */
let shared;
/** @type {ReturnType<typeof createTabDriver>} */
let driver;

beforeEach(() => {
	shared = createSharedStorage();
	driver = createTabDriver(shared);
});

/** @param {string} name */
async function open(name) {
	const tab = await openTab(name);
	shared.state.active = name;
	tab.cache.setTaskStorageOwner(U);
	tab.queue.setOfflineQueueOwner(U);
	shared.state.active = null;
	driver.tabs.push(tab);
	return tab;
}

describe('R6 a late failure coalesced into the entry another tab is flushing', () => {
	it('tab A queues its failed edit into the entry tab B has just sent', async () => {
		const seed = normalizeTask({ id: TASK, text: 'queued', priority: 'low', version: 5 });
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		shared.entries.set(`kanbanOfflineWriteQueue:${U}`, JSON.stringify([{
			id: 'p1', type: 'task.patch', taskId: TASK, ownerUserId: U, createdAt: 1, attempts: 0,
			patch: { text: 'queued', priority: 'low', expectedVersion: 5 }
		}]));
		const A = await open('A');
		const B = await open('B');
		const { requests, inTab, deliver } = driver;

		// B syncs: its flush sends the queued edit.
		const sync = inTab(B, () => B.serverSync.syncServerTasks(globalThis.fetch));
		await settle();
		expect(requests[0]).toMatchObject({ method: 'PATCH', tab: 'B' });
		// A: the user raises the priority; A's PATCH expects 5.
		await inTab(A, () => A.mutations.updateTask(TASK, { priority: 'high' }));
		expect(requests[1]).toMatchObject({ method: 'PATCH', tab: 'A' });
		// The server took B's flush first (v6), so A's PATCH meets 409 and A
		// queues its edit: it merges into the entry B's flush is sending.
		await inTab(A, () => requests[1].resolve(json({ message: 'changed' }, 409)));
		console.log('R6 queue after A queued:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.id, m.patch?.priority, m.patch?.expectedVersion])));
		// B's flush answer arrives; the reconcile drops the entry it sent.
		requests[0].resolve(json({ task: { ...seed, version: 6 } }));
		await settle();
		for (let round = 0; round < 6; round += 1) {
			for (const r of requests) {
				if (r.method === 'GET' && !r.done) {
					r.done = true;
					r.resolve(r.url === '/api/tasks' ? json({ tasks: [{ ...seed, version: 6 }] }) : r.url.includes('categor') ? json({ categories: [] }) : json({ defaultView: 'board' }));
				}
			}
			await settle();
		}
		await sync;
		await deliver();
		const queue = readQueue(shared.entries, U);
		console.log('R6 queue after B flush:', JSON.stringify(queue), '| A board priority:', get(A.cache.tasks)[0].priority, '| B board priority:', get(B.cache.tasks)[0].priority);
		expect(queue.some((m) => m.patch?.priority === 'high')).toBe(true);
	});
});
