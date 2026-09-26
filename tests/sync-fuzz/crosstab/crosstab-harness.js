// Probe-only harness: two tabs = two module instances sharing one fake
// localStorage whose writes are delivered as storage events to the other tab.
// The modules come from the checkout under test (../root.js: FUZZ_ROOT).
import { vi } from 'vitest';
import { importFromRoot } from '../root.js';

export const U = 'user-u';
export const V = 'user-v';

export function createSharedStorage() {
	/** @type {Map<string, string>} */
	const entries = new Map();
	/** @type {{ key: string; newValue: string | null; writer: string | null }[]} */
	const events = [];
	const state = { active: /** @type {string | null} */ (null) };
	const storage = {
		getItem: (/** @type {string} */ key) => entries.get(key) ?? null,
		setItem: (/** @type {string} */ key, /** @type {string} */ value) => {
			const next = String(value);
			if (entries.get(key) === next) return;
			entries.set(key, next);
			events.push({ key, newValue: next, writer: state.active });
		},
		removeItem: (/** @type {string} */ key) => {
			if (!entries.has(key)) return;
			entries.delete(key);
			events.push({ key, newValue: null, writer: state.active });
		}
	};
	vi.stubGlobal('localStorage', storage);
	return { entries, events, state };
}

/**
 * @param {string} name
 */
export async function openTab(name) {
	vi.resetModules();
	const cache = await importFromRoot('src/lib/client/task-store/task-cache.js');
	const engine = await importFromRoot('src/lib/client/task-store/sync-engine.js');
	const mutations = await importFromRoot('src/lib/client/task-store/task-mutations.js');
	const crossTab = await importFromRoot('src/lib/client/task-store/cross-tab-sync.js');
	const queue = await importFromRoot('src/lib/client/offline-write-queue.js');
	const serverSync = await importFromRoot('src/lib/client/task-store/server-sync.js');
	return { name, cache, engine, mutations, crossTab, queue, serverSync };
}

export async function settle() {
	for (let i = 0; i < 5; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

/**
 * @param {ReturnType<typeof createSharedStorage>} shared
 */
export function createTabDriver(shared) {
	/** @type {{ url: string; method: string; body: any; tab: string | null; resolve: (r: Response) => void; reject: (e: unknown) => void; done: boolean }[]} */
	const requests = [];
	vi.stubGlobal('window', {});
	vi.stubGlobal('fetch', vi.fn((/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
		/** @type {(r: Response) => void} */
		let resolve = () => {};
		/** @type {(e: unknown) => void} */
		let reject = () => {};
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		requests.push({
			url,
			method: init.method ?? 'GET',
			body: init.body ? JSON.parse(String(init.body)) : null,
			tab: shared.state.active,
			resolve,
			reject,
			done: false
		});
		return promise;
	}));

	/** @type {Awaited<ReturnType<typeof openTab>>[]} */
	const tabs = [];

	/**
	 * Runs fn as `tab` (so its storage writes are attributed to it) and lets
	 * its continuations settle.
	 * @param {{ name: string }} tab
	 * @param {() => unknown} fn
	 */
	async function inTab(tab, fn) {
		shared.state.active = tab.name;
		try {
			const result = fn();
			await settle();
			if (result && typeof (/** @type {any} */ (result)).then === 'function') {
				return await result;
			}
			return result;
		} finally {
			await settle();
			shared.state.active = null;
		}
	}

	/** Delivers pending storage events to every tab but the writer. */
	async function deliver() {
		while (shared.events.length > 0) {
			const event = /** @type {NonNullable<(typeof shared.events)[number]>} */ (shared.events.shift());
			for (const tab of tabs) {
				if (tab.name === event.writer) continue;
				shared.state.active = tab.name;
				tab.crossTab.handleExternalTaskStorageEvent({ key: event.key, newValue: event.newValue });
				shared.state.active = null;
			}
		}
	}

	return { requests, tabs, inTab, deliver };
}

/**
 * @param {Map<string, string>} entries
 * @param {string} owner
 */
export function readQueue(entries, owner) {
	return JSON.parse(entries.get(`kanbanOfflineWriteQueue:${owner}`) ?? '[]');
}

/**
 * @param {Map<string, string>} entries
 * @param {string} owner
 */
export function readCache(entries, owner) {
	return JSON.parse(entries.get(`kanbanTasks:${owner}`) ?? '[]');
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
export function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
