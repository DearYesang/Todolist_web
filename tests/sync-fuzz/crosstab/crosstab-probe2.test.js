import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFromRoot } from '../root.js';
import { U, createSharedStorage, createTabDriver, json, openTab, readCache, readQueue, settle } from './crosstab-harness.js';

const { normalizeTask } = await importFromRoot('src/lib/shared/task-domain.js');

const TASK = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';

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

describe('R2 checklist retire rule vs another tab', () => {
	it('tab A landing a check drops the newer uncheck tab B queued meanwhile', async () => {
		const seed = normalizeTask({
			id: TASK,
			text: 'task',
			version: 5,
			subtasks: [{ id: ITEM, text: 'item', done: false }]
		});
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const A = await open('A', U);
		const B = await open('B', U);
		const { requests, inTab, deliver } = driver;

		// A: the user checks the item; the PATCH is out.
		await inTab(A, () => A.mutations.toggleSubtask(TASK, ITEM));
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toEqual({ done: true });
		await deliver(); // B shows the item checked

		// B: the user unchecks it; B's request fails without an answer
		// (connectivity blip), so the chain queues { done: false } under U.
		await inTab(B, () => B.mutations.toggleSubtask(TASK, ITEM));
		expect(requests).toHaveLength(2);
		expect(requests[1].body).toEqual({ done: false });
		await inTab(B, () => requests[1].reject(new TypeError('Failed to fetch')));
		console.log('R2 queue after B failed:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch])));
		await deliver();

		// A's check lands.
		await inTab(A, () => requests[0].resolve(json({
			task: { ...seed, version: 6, subtasks: [{ id: ITEM, text: 'item', done: true }] }
		})));
		await deliver();

		const queue = readQueue(shared.entries, U);
		console.log('R2 queue after A landed:', JSON.stringify(queue.map((m) => [m.type, m.patch])));
		console.log('R2 boards: A done =', get(A.cache.tasks)[0]?.subtasks[0]?.done, '| B done =', get(B.cache.tasks)[0]?.subtasks[0]?.done, '| cache done =', readCache(shared.entries, U)[0]?.subtasks[0]?.done);

		// The user's last action was the uncheck in B; the server has done=true.
		expect(queue.some((m) => m.type === 'checklist.patch' && m.patch.done === false)).toBe(true);
	});
});
