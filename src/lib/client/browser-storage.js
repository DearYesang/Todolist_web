/**
 * The page's localStorage, or null when there is none or it cannot be used
 * (reading it can throw when site data is blocked).
 * @returns {Storage | null}
 */
export function getStorage() {
	try {
		const storage = globalThis.localStorage;
		return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' ? storage : null;
	} catch {
		return null;
	}
}
