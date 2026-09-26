import { getStorage } from './browser-storage.js';
import { setLinkOpenOwner } from './link-opener.js';
import { clearOfflineWriteQueue, getOfflineQueueSize, setOfflineQueueOwner } from './offline-write-queue.js';
import {
	clearCategoryCatalog,
	clearLocalTaskCache,
	clearPendingDefaultView,
	setTaskStorageOwner
} from './task-store.js';

/**
 * What this device keeps for one user: the user last seen signed in, so the
 * app can open offline, and the per-user state that applyUserScope switches
 * when the signed-in user changes (the task cache, the offline queue, the
 * link-open state and the category catalog).
 */

const AUTH_SCOPE_KEY = 'todokanbanAuthScope';

/** @type {string | null} */
let scopedUserId = null;

/**
 * @typedef {{
 *   id: string;
 *   email: string | null;
 *   name: string | null;
 *   cachedAt: number;
 * }} CachedAuthScope
 */

/**
 * @returns {CachedAuthScope | null}
 */
export function readCachedAuthScope() {
	try {
		const storage = getStorage();
		const raw = storage?.getItem(AUTH_SCOPE_KEY);
		if (!raw) {
			return null;
		}

		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}

		const scope = /** @type {Record<string, unknown>} */ (parsed);
		return typeof scope.id === 'string' && scope.id
			? {
					id: scope.id,
					email: typeof scope.email === 'string' ? scope.email : null,
					name: typeof scope.name === 'string' ? scope.name : null,
					cachedAt: typeof scope.cachedAt === 'number' ? scope.cachedAt : 0
				}
			: null;
	} catch {
		return null;
	}
}

/**
 * @param {{ id?: unknown; email?: unknown; name?: unknown }} user
 * @returns {CachedAuthScope | null}
 */
export function cacheAuthScope(user) {
	if (typeof user.id !== 'string' || !user.id) {
		return null;
	}

	const scope = {
		id: user.id,
		email: typeof user.email === 'string' ? user.email : null,
		name: typeof user.name === 'string' ? user.name : null,
		cachedAt: Date.now()
	};

	try {
		getStorage()?.setItem(AUTH_SCOPE_KEY, JSON.stringify(scope));
	} catch {
		// Offline mode should keep working even if browser storage is unavailable.
	}

	return scope;
}

export function clearCachedAuthScope() {
	try {
		getStorage()?.removeItem(AUTH_SCOPE_KEY);
	} catch {
		// Ignore storage cleanup failures; server session state remains authoritative.
	}
}

/**
 * Points the per-user stores at `userId`, or at the signed-out (anonymous)
 * data for null. Called again with the same id, as every session refetch
 * does, it changes nothing.
 * @param {string | null} userId
 */
export function applyUserScope(userId) {
	if (userId === scopedUserId) {
		return;
	}

	scopedUserId = userId;
	setTaskStorageOwner(userId);
	setOfflineQueueOwner(userId);
	setLinkOpenOwner(userId);
	// The catalog belongs to the previous user's board until the next
	// finished sync loads this one (a blocked queue skips it). Kept, it
	// would list their categories and give the task panel their ids.
	clearCategoryCatalog();
}

/**
 * Deletes the signed-in user's data from this device, for a sign-out that
 * asks for it: the offline queue, the cached tasks and a default view
 * still waiting to be sent.
 */
export function clearUserLocalData() {
	clearOfflineWriteQueue();
	clearLocalTaskCache();
	clearPendingDefaultView();
}

/**
 * The number of the signed-in user's offline changes not yet sent to the
 * server.
 */
export function countPendingLocalChanges() {
	return getOfflineQueueSize();
}
