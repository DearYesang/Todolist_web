const AUTH_SCOPE_KEY = 'todokanbanAuthScope';

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
 * @returns {Storage | null}
 */
function getStorage() {
	try {
		const storage = globalThis.localStorage;
		return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
			? storage
			: null;
	} catch {
		return null;
	}
}
