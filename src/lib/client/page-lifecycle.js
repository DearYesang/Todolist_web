/**
 * The parts of `window` the page lifecycle uses; tests pass a fake.
 * @typedef {Pick<Window, 'addEventListener' | 'removeEventListener'> & {
 *   location: Pick<Location, 'reload'>;
 *   navigator: Pick<Navigator, 'serviceWorker'>;
 * }} LifecycleWindow
 */

/**
 * Keeps queued-but-unsent task writes when the page goes away on its own:
 * on `pagehide`, and before the reload that follows a new service worker
 * taking control (`controllerchange`, reloaded at most once). On setup it
 * also asks the service worker to check for an update. SvelteKit registers
 * the worker itself. Returns the teardown.
 * @param {LifecycleWindow} win
 * @param {() => void} drainPendingWrites moves pending task syncs into the offline queue
 * @returns {() => void}
 */
export function setupPageLifecycle(win, drainPendingWrites) {
	let reloadedForServiceWorkerUpdate = false;
	const handleServiceWorkerUpdate = () => {
		if (reloadedForServiceWorkerUpdate) return;
		reloadedForServiceWorkerUpdate = true;
		// Queued-but-unsent writes must survive this programmatic reload.
		drainPendingWrites();
		win.location.reload();
	};
	const handlePageHide = () => {
		drainPendingWrites();
	};
	win.addEventListener('pagehide', handlePageHide);

	if ('serviceWorker' in win.navigator) {
		win.navigator.serviceWorker.ready
			.then((registration) => registration.update())
			.catch(() => {});
		win.navigator.serviceWorker.addEventListener('controllerchange', handleServiceWorkerUpdate);
	}

	return () => {
		win.removeEventListener('pagehide', handlePageHide);
		win.navigator.serviceWorker?.removeEventListener('controllerchange', handleServiceWorkerUpdate);
	};
}
