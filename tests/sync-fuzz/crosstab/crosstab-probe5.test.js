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

describe('R5b snapshot lands while a failed edit waits in the queue', () => {
	it('one tab: the failed rename is dropped by the next landed edit', async () => {
		const seed = normalizeTask({ id: TASK, text: 'orig', priority: 'low', version: 5 });
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const A = await openTab('A');
		A.cache.setTaskStorageOwner(U);
		A.queue.setOfflineQueueOwner(U);
		driver.tabs.push(A);
		const { requests, inTab } = driver;

		// A sync starts (empty queue); its GET /api/tasks is out.
		const sync = inTab(A, () => A.serverSync.syncServerTasks(globalThis.fetch));
		await settle();
		expect(requests[0].url).toBe('/api/tasks');
		// Meanwhile the user renames the task; the PATCH fails (503).
		await inTab(A, () => A.mutations.updateTask(TASK, { text: 'mine' }));
		await inTab(A, () => requests[1].resolve(json({ message: 'Unavailable' }, 503)));
		console.log('R5b queue after failed rename:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])));
		// The GET answers with the server copy.
		requests[0].resolve(json({ tasks: [seed] }));
		await settle();
		for (let round = 0; round < 6; round += 1) {
			for (const r of requests) {
				if (r.method === 'GET' && r.url !== '/api/tasks' && !r.done) {
					r.done = true;
					r.resolve(r.url.includes('categor') ? json({ categories: [] }) : json({ defaultView: 'board' }));
				}
			}
			await settle();
		}
		await sync;
		console.log('R5b board after snapshot:', get(A.cache.tasks)[0].text);

		// The user changes the priority; the PATCH lands.
		await inTab(A, () => A.mutations.updateTask(TASK, { priority: 'high' }));
		const last = requests[requests.length - 1];
		console.log('R5b chained PATCH:', JSON.stringify([last.body.text, last.body.priority, last.body.expectedVersion]));
		await inTab(A, () => last.resolve(json({ task: { ...seed, priority: 'high', version: 6 } })));
		const queue = readQueue(shared.entries, U);
		console.log('R5b final queue:', JSON.stringify(queue.map((m) => [m.type, m.patch?.text, m.patch?.expectedVersion])));
		expect(queue.some((m) => m.type === 'task.patch' && m.patch.text === 'mine')).toBe(true);
	});
});
