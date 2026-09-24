import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    applyServerCategoryCatalog,
    categories,
    categorySummaries,
    mergeCategory,
    renameCategory
} from './category-store.js';
import { replaceTasks, tasks } from './task-cache.js';
import { resetFilters } from './filters.js';

describe('category entity client state', () => {
    beforeEach(() => {
        replaceTasks([]);
        resetFilters();
        applyServerCategoryCatalog([]);
    });

    afterEach(() => {
        replaceTasks([]);
        resetFilters();
        applyServerCategoryCatalog([]);
    });

    it('renames same-id server categories in the local task graph', async () => {
        const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        replaceTasks([
            {
                id: 'task-local',
                text: 'Read',
                category: '공부',
                categoryId,
                categoryMeta: {
                    id: categoryId,
                    name: '공부',
                    color: '#58a6ff',
                    sortOrder: 0,
                    hiddenAt: null,
                    archivedAt: null
                }
            }
        ]);

        const result = await renameCategory({ id: categoryId, name: '공부' }, '학습');

        expect(result.changed).toBe(1);
        expect(get(tasks)[0]).toMatchObject({
            category: '학습',
            categoryId,
            categoryMeta: {
                id: categoryId,
                name: '학습'
            }
        });
    });

    it('keeps hidden categories out of task input suggestions while retaining manager summaries', () => {
        const categoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        applyServerCategoryCatalog([
            {
                id: categoryId,
                name: '숨김',
                color: '#3fb950',
                sortOrder: 0,
                hiddenAt: '2026-05-10T00:00:00.000Z',
                archivedAt: null
            }
        ]);
        replaceTasks([
            {
                id: 'task-local',
                text: 'Hidden task',
                category: '숨김',
                categoryId
            }
        ]);

        expect(get(categories)).not.toContain('숨김');
        expect(get(categorySummaries).find((category) => category.id === categoryId)).toMatchObject({
            name: '숨김',
            total: 1
        });
    });

    it('merges local legacy categories even when both sides have no server id yet', async () => {
        replaceTasks([
            { id: 'task-a', text: 'A', category: 'Alpha' },
            { id: 'task-b', text: 'B', category: 'Beta' }
        ]);

        const result = await mergeCategory('Alpha', 'Beta');

        expect(result.changed).toBe(1);
        expect(get(tasks).map((task) => task.category)).toEqual(['Beta', 'Beta']);
    });
});
