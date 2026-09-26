import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFromRoot } from '../root.js';
import { U, createSharedStorage, createTabDriver, json, openTab, readQueue, settle } from './crosstab-harness.js';

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

describe('R5 flush answer reverts a queued edit, then the retire rule drops it', () => {
	it('one tab: offline rename survives a partly blocked flush and a later edit', async () => {
		const seed = normalizeTask({
			id: TASK,
			text: 'orig',
			priority: 'low',
			version: 5,
			subtasks: [{ id: ITEM, text: 'item', done: false }]
		});
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const A = await open('A', U);
		const { requests, inTab } = driver;

		// Offline: check the item, then rename the task. Both requests fail
		// without an answer and the chain queues them.
		await inTab(A, () => A.mutations.toggleSubtask(TASK, ITEM));
		await inTab(A, () => requests[0].reject(new TypeError('Failed to fetch')));
		await inTab(A, () => A.mutations.updateTask(TASK, { text: 'offline rename' }));
		await inTab(A, () => requests[1].reject(new TypeError('Failed to fetch')));
		console.log('R5 queue offline:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch?.text ?? m.patch])));

		// Back online: the flush sends the checklist edit (lands, v6), then
		// the rename fails again (connectivity flap / 503): blocked.
		const sync = inTab(A, () => A.serverSync.syncServerTasks(globalThis.fetch));
		await settle();
		expect(requests[2].body).toEqual({ done: true });
		requests[2].resolve(json({ task: { ...seed, version: 6, subtasks: [{ id: ITEM, text: 'item', done: true }] } }));
		await settle();
		expect(requests[3].body).toMatchObject({ text: 'offline rename' });
		requests[3].resolve(json({ message: 'Service unavailable' }, 503));
		await settle();
		await sync;
		console.log('R5 after blocked flush: board text =', get(A.cache.tasks)[0].text, 'v', get(A.cache.tasks)[0].version,
			'| queue =', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])));

		// The user changes the priority; the chained PATCH lands.
		await inTab(A, () => A.mutations.updateTask(TASK, { priority: 'high' }));
		console.log('R5 chained PATCH body:', JSON.stringify(requests[4].body));
		await inTab(A, () => requests[4].resolve(json({ task: { ...seed, priority: 'high', version: 7, subtasks: [{ id: ITEM, text: 'item', done: true }] } })));

		const queue = readQueue(shared.entries, U);
		console.log('R5 final queue:', JSON.stringify(queue.map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])), '| board text =', get(A.cache.tasks)[0].text);
		// I1: the rename is not on the server (it has 'orig'); it must still be queued.
		expect(queue.some((m) => m.type === 'task.patch' && m.patch.text === 'offline rename')).toBe(true);
	});
});
