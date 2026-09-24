import { describe, expect, it, vi } from 'vitest';
import { setupPageLifecycle } from './page-lifecycle.js';

/**
 * @param {{ serviceWorker?: boolean; ready?: Promise<unknown>; update?: () => Promise<unknown> }} [options]
 */
function createFakeWindow({ serviceWorker = true, ready, update } = {}) {
	/** @type {string[]} */
	const events = [];
	/** @type {Map<string, Set<() => void>>} */
	const windowListeners = new Map();
	/** @type {Map<string, Set<() => void>>} */
	const workerListeners = new Map();

	/**
	 * @param {Map<string, Set<() => void>>} listeners
	 */
	const createTarget = (listeners) => ({
		addEventListener: vi.fn((/** @type {string} */ type, /** @type {() => void} */ listener) => {
			listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
		}),
		removeEventListener: vi.fn((/** @type {string} */ type, /** @type {() => void} */ listener) => {
			listeners.get(type)?.delete(listener);
		})
	});
	const registration = {
		update: vi.fn(update ?? (async () => {
			events.push('update');
		}))
	};
	const worker = {
		...createTarget(workerListeners),
		ready: ready ?? Promise.resolve(registration)
	};
	const win = {
		...createTarget(windowListeners),
		location: {
			reload: vi.fn(() => {
				events.push('reload');
			})
		},
		navigator: serviceWorker ? { serviceWorker: worker } : {}
	};

	return {
		win: /** @type {import('./page-lifecycle.js').LifecycleWindow} */ (/** @type {unknown} */ (win)),
		events,
		registration,
		worker,
		drain: vi.fn(() => {
			events.push('drain');
		}),
		/** @param {string} type */
		fire: (type) => windowListeners.get(type)?.forEach((listener) => listener()),
		/** @param {string} type */
		fireWorker: (type) => workerListeners.get(type)?.forEach((listener) => listener())
	};
}

describe('page lifecycle', () => {
	it('drains pending writes every time the page is hidden', () => {
		const fake = createFakeWindow();
		setupPageLifecycle(fake.win, fake.drain);

		fake.fire('pagehide');
		fake.fire('pagehide');

		expect(fake.drain).toHaveBeenCalledTimes(2);
		expect(fake.win.location.reload).not.toHaveBeenCalled();
	});

	it('drains, then reloads once, when a new service worker takes control', async () => {
		const fake = createFakeWindow();
		setupPageLifecycle(fake.win, fake.drain);
		await Promise.resolve();

		fake.fireWorker('controllerchange');
		fake.fireWorker('controllerchange');

		expect(fake.events).toEqual(['update', 'drain', 'reload']);
	});

	it('asks the service worker to check for an update and ignores failures', async () => {
		const fake = createFakeWindow();
		setupPageLifecycle(fake.win, fake.drain);
		await vi.waitFor(() => expect(fake.registration.update).toHaveBeenCalledOnce());

		const failingUpdate = createFakeWindow({ update: async () => Promise.reject(new Error('offline')) });
		setupPageLifecycle(failingUpdate.win, failingUpdate.drain);
		await vi.waitFor(() => expect(failingUpdate.registration.update).toHaveBeenCalledOnce());

		const neverReady = createFakeWindow({ ready: Promise.reject(new Error('no worker')) });
		setupPageLifecycle(neverReady.win, neverReady.drain);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(neverReady.registration.update).not.toHaveBeenCalled();
	});

	it('still drains on pagehide without service worker support', () => {
		const fake = createFakeWindow({ serviceWorker: false });
		const teardown = setupPageLifecycle(fake.win, fake.drain);

		fake.fire('pagehide');
		expect(fake.drain).toHaveBeenCalledOnce();
		expect(() => teardown()).not.toThrow();
	});

	it('stops listening after teardown', () => {
		const fake = createFakeWindow();
		const teardown = setupPageLifecycle(fake.win, fake.drain);

		teardown();
		fake.fire('pagehide');
		fake.fireWorker('controllerchange');

		expect(fake.drain).not.toHaveBeenCalled();
		expect(fake.win.location.reload).not.toHaveBeenCalled();
		expect(fake.worker.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
	});
});
