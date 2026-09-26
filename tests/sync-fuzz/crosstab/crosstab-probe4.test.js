import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFromRoot } from '../root.js';
import { U, createSharedStorage, createTabDriver, json, openTab, readCache, readQueue, settle } from './crosstab-harness.js';

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

/**
 * Answers the GETs a sync makes after its flush.
 * @param {any[]} requests
 * @param {unknown[]} serverTasks
 */
async function answerReads(requests, serverTasks) {
	for (let round = 0; round < 6; round += 1) {
		for (const r of requests) {
			if (r.method === 'GET' && !r.done) {
				r.done = true;
				if (r.url === '/api/tasks') r.resolve(json({ tasks: serverTasks }));
				else if (r.url.includes('categor')) r.resolve(json({ categories: [] }));
				else r.resolve(json({ defaultView: 'board' }));
			}
		}
		await settle();
	}
}

describe('RL reload mid-flight', () => {
	it('RL2: an edit drained behind a request that landed before the reload meets 409 after it', async () => {
		const seed = normalizeTask({ id: TASK, text: 'orig', priority: 'low', version: 5 });
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const page1 = await open('page1', U);
		const { requests, inTab } = driver;

		await inTab(page1, () => page1.mutations.updateTask(TASK, { text: 'first' }));
		await inTab(page1, () => page1.mutations.updateTask(TASK, { priority: 'high' }));
		expect(requests).toHaveLength(1); // second edit waits in the chain
		// controllerchange / pagehide: drain, then the page goes away. The
		// first PATCH reached the server (now v6); its answer is never read.
		await inTab(page1, () => page1.engine.drainPendingTaskSyncsToOfflineQueue());
		driver.tabs.length = 0;
		console.log('RL2 queue after drain:', JSON.stringify(readQueue(shared.entries, U).map((m) => [m.type, m.patch?.text, m.patch?.priority, m.patch?.expectedVersion])));

		const page2 = await open('page2', U);
		const sync = inTab(page2, () => page2.serverSync.syncServerTasks(globalThis.fetch));
		await settle();
		const flushPatch = requests.find((r, i) => i > 0 && r.method === 'PATCH');
		console.log('RL2 flush PATCH body expectedVersion:', flushPatch?.body?.expectedVersion);
		// Server model: v6 after page1's first PATCH.
		flushPatch?.resolve(json({ message: 'Task changed on the server.' }, 409));
		await settle();
		await answerReads(requests, [{ ...seed, text: 'first', version: 6 }]);
		const result = await sync;
		console.log('RL2 offlineConflicts:', JSON.stringify(result.offlineConflicts.map((m) => [m.type, m.patch?.priority])));
		expect(result.offlineConflicts).toHaveLength(0);
	});

	it('RL1: an edit whose request was out at reload and never reached the server is lost', async () => {
		const seed = normalizeTask({ id: TASK, text: 'orig', priority: 'low', version: 5 });
		shared.entries.set(`kanbanTasks:${U}`, JSON.stringify([seed]));
		const page1 = await open('page1', U);
		const { requests, inTab } = driver;

		await inTab(page1, () => page1.mutations.updateTask(TASK, { text: 'renamed just before reload' }));
		expect(requests).toHaveLength(1);
		await inTab(page1, () => page1.engine.drainPendingTaskSyncsToOfflineQueue());
		driver.tabs.length = 0; // unload aborts the PATCH before the server commits
		console.log('RL1 queue after drain:', JSON.stringify(readQueue(shared.entries, U)), '| cache text:', readCache(shared.entries, U)[0].text);

		const page2 = await open('page2', U);
		console.log('RL1 page2 board text before sync:', get(page2.cache.tasks)[0].text);
		const sync = inTab(page2, () => page2.serverSync.syncServerTasks(globalThis.fetch));
		await settle();
		await answerReads(requests, [seed]);
		await sync;
		console.log('RL1 page2 board text after sync:', get(page2.cache.tasks)[0].text, '| queue:', JSON.stringify(readQueue(shared.entries, U)));
		expect(get(page2.cache.tasks)[0].text).toBe('renamed just before reload');
	});
});
