import { writable } from 'svelte/store';
import { isServerId } from '../../shared/task-rules.js';
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
        categoryId: isServerId(value) ? value : 'all'
    }));
}

export function resetFilters() {
    filters.set({ ...DEFAULT_FILTERS });
}

/**
 * Moves the category filter along with a category rename, merge or clear.
 * A filter on `source` (by name, or by id when it has one) moves to
 * `target`, or back to all categories when there is no target.
 * @param {{ id: string | null; name: string }} source
 * @param {{ id?: string | null; name: string } | null} target
 */
export function renameCategoryFilter(source, target) {
    filters.update((current) => {
        const categoryMatches = current.category === source.name || (source.id && current.categoryId === source.id);
        return categoryMatches
            ? { ...current, category: target?.name || 'all', categoryId: target?.id ?? 'all' }
            : current;
    });
}
