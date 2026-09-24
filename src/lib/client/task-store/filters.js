import { writable } from 'svelte/store';
import { isServerTaskId } from '../task-create.js';
import { DEFAULT_FILTERS } from '../../shared/task-domain.js';

/** @type {import('svelte/store').Writable<import('../../shared/task-domain.js').TaskFilters>} */
export const filters = writable({ ...DEFAULT_FILTERS });

/**
 * @param {import('../../shared/task-domain.js').PriorityFilter} value
 */
export function setPriorityFilter(value) {
    filters.update((current) => ({ ...current, priority: value }));
}

/**
 * @param {import('../../shared/task-domain.js').UrgencyFilter} value
 */
export function setUrgencyFilter(value) {
    filters.update((current) => ({ ...current, urgency: value }));
}

/**
 * @param {string} value
 */
export function setSearchFilter(value) {
    filters.update((current) => ({ ...current, search: value }));
}

/**
 * @param {string} value
 * @param {string | null} [name]
 */
export function setCategoryFilter(value, name = null) {
    if (value === 'all') {
        filters.update((current) => ({ ...current, category: 'all', categoryId: 'all' }));
        return;
    }

    filters.update((current) => ({
        ...current,
        category: name ?? value,
        categoryId: isServerTaskId(value) ? value : 'all'
    }));
}

export function resetFilters() {
    filters.set({ ...DEFAULT_FILTERS });
}
