import { vi } from 'vitest';

/**
 * Stubs globalThis.localStorage with an in-memory store whose getItem,
 * setItem and removeItem are vi.fn spies. The stub goes through
 * vi.stubGlobal, so `unstubGlobals` in vite.config.js removes it before the
 * next test.
 * @returns {Map<string, string>} the stored entries, to seed or inspect
 */
export function installMemoryStorage() {
	/** @type {Map<string, string>} */
	const entries = new Map();
	vi.stubGlobal('localStorage', {
		getItem: vi.fn((/** @type {string} */ key) => entries.get(key) ?? null),
		setItem: vi.fn((/** @type {string} */ key, /** @type {string} */ value) => {
			entries.set(key, String(value));
		}),
		removeItem: vi.fn((/** @type {string} */ key) => {
			entries.delete(key);
		})
	});
	return entries;
}
