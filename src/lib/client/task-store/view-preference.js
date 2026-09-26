import { writable } from 'svelte/store';
import { isAppView } from '../../shared/task-rules.js';
import { getStorage, PENDING_VIEW_STORAGE_KEY } from '../browser-storage.js';

const VIEW_STORAGE_KEY = 'todokanbanCurrentView';

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
 * @param {unknown} value
 */
export function applyServerDefaultView(value) {
    setCurrentView(value);
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
