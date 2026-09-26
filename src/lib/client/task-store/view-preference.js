import { writable } from 'svelte/store';
import { isAppView } from '../../shared/task-rules.js';
import { getStorage } from '../browser-storage.js';
import { updateBoardPreferences } from '../task-api.js';

const VIEW_STORAGE_KEY = 'todokanbanCurrentView';
const PENDING_VIEW_STORAGE_KEY = 'todokanbanPendingDefaultView';

/** @typedef {import('../../shared/task-rules.js').AppView} AppView */

/** @type {import('svelte/store').Writable<AppView>} */
export const currentView = writable(readInitialView());

/**
 * @param {unknown} value
 */
export function setCurrentView(value) {
	if (isAppView(value)) {
		currentView.set(value);
	}
}

/**
 * Shows `view`, and for a signed-in user saves it as the default view on
 * the server. Offline, or when the server cannot be reached, the view is
 * kept as pending and the next sync sends it (flushPendingViewPreference).
 * Resolves to the server's message when it refuses the view for any other
 * reason, for the caller to show, and to null otherwise.
 * @param {AppView} view
 * @param {{ signedIn: boolean; fetcher?: typeof fetch }} options
 * @returns {Promise<string | null>}
 */
export async function selectView(view, { signedIn, fetcher }) {
	setCurrentView(view);

	if (!signedIn) {
		return null;
	}

	if (!navigator.onLine) {
		markPendingDefaultView(view);
		return null;
	}

	const result = await updateBoardPreferences({ defaultView: view }, fetcher);
	if (result.ok) {
		clearPendingDefaultView();
	} else if (result.fallback) {
		markPendingDefaultView(view);
	} else {
		return result.message;
	}
	return null;
}

/**
 * Sends a default view that selectView kept as pending, for a signed-in
 * user who is online. It stays pending if the server does not take it.
 * @param {{ signedIn: boolean; fetcher?: typeof fetch }} options
 */
export async function flushPendingViewPreference({ signedIn, fetcher }) {
	const pendingView = readPendingDefaultView();
	if (!pendingView || !signedIn || !navigator.onLine) {
		return;
	}

	const result = await updateBoardPreferences({ defaultView: pendingView }, fetcher);
	if (result.ok) {
		clearPendingDefaultView();
	}
}

/**
 * @param {unknown} value
 */
export function markPendingDefaultView(value) {
	if (!isAppView(value)) return;

	try {
		const storage = getStorage();
		storage?.setItem(PENDING_VIEW_STORAGE_KEY, value);
	} catch (error) {
		console.error('Failed to persist pending default view', error);
	}
}

/** @returns {AppView | null} */
export function readPendingDefaultView() {
	try {
		const storage = getStorage();
		const stored = storage?.getItem(PENDING_VIEW_STORAGE_KEY);
		return isAppView(stored) ? stored : null;
	} catch {
		return null;
	}
}

export function clearPendingDefaultView() {
	try {
		getStorage()?.removeItem(PENDING_VIEW_STORAGE_KEY);
	} catch (error) {
		console.error('Failed to clear pending default view', error);
	}
}

currentView.subscribe((value) => {
	try {
		const storage = getStorage();
		if (!storage || !isAppView(value)) return;

		storage.setItem(VIEW_STORAGE_KEY, value);
	} catch (error) {
		console.error('Failed to persist current view', error);
	}
});

/** @returns {AppView} */
function readInitialView() {
	try {
		const storage = getStorage();
		const stored = storage?.getItem(VIEW_STORAGE_KEY);
		return isAppView(stored) ? stored : 'kanban';
	} catch {
		return 'kanban';
	}
}
