/**
 * Signing out clears a pending default view together with the cached tasks,
 * so this key is shared by view-preference.js and task-cache.js.
 */
export const PENDING_VIEW_STORAGE_KEY = 'todokanbanPendingDefaultView';

/**
 * @returns {Storage | null}
 */
export function getStorage() {
    try {
        const storage = globalThis.localStorage;
        return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
            ? storage
            : null;
    } catch {
        return null;
    }
}
