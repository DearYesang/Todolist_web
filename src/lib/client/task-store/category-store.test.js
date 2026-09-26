import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyServerCategoryCatalog,
    assignTaskCategory,
    categories,
    categorySummaries,
    mergeCategory,
    renameCategory
} from './category-store.js';
import { replaceTasks, tasks } from './task-cache.js';
import { resetFilters } from './filters.js';
import { resetTaskSyncStateForTests, waitForPendingTaskSyncs } from './sync-engine.js';

/**
 * @param {unknown} body
 */
function jsonResponse(body) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
}

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

describe('assigning a task category', () => {
    const TASK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const DEV = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '개발', color: '#ff0000', sortOrder: 0, hiddenAt: null, archivedAt: null };
    const PLAN = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Plan', color: null, sortOrder: 1, hiddenAt: null, archivedAt: null };
    /** @type {Record<string, unknown>[]} */
    let patches;

    beforeEach(() => {
        patches = [];
        vi.stubGlobal('window', {});
        // The server answers a task PATCH with the task as sent, one version on.
        vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
            const patch = JSON.parse(String(init.body));
            patches.push(patch);
            const current = get(tasks).find((task) => task.id === TASK_ID);
            return jsonResponse({ task: { ...current, version: patch.expectedVersion + 1 } });
        }));
        replaceTasks([{ id: TASK_ID, text: 'Task', version: 3, category: '개발', categoryId: DEV.id, categoryMeta: DEV }]);
        applyServerCategoryCatalog([DEV, PLAN]);
    });

    afterEach(async () => {
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        applyServerCategoryCatalog([]);
        vi.unstubAllGlobals();
    });

    it('moves a task that has a category to another catalog category, ignoring case', async () => {
        assignTaskCategory(TASK_ID, ' plan ');

        expect(get(tasks)[0]).toMatchObject({ category: 'Plan', categoryId: PLAN.id, categoryMeta: PLAN });
        await waitForPendingTaskSyncs();
        expect(patches).toEqual([expect.objectContaining({ category: 'Plan', categoryId: PLAN.id, expectedVersion: 3 })]);
        expect(get(tasks)[0]).toMatchObject({ category: 'Plan', categoryId: PLAN.id, version: 4 });
    });

    it('sends a name the catalog does not hold without an id, for the server to find or create', async () => {
        assignTaskCategory(TASK_ID, '리서치');

        expect(get(tasks)[0]).toMatchObject({ category: '리서치', categoryId: null, categoryMeta: null });
        await waitForPendingTaskSyncs();
        expect(patches).toEqual([expect.objectContaining({ category: '리서치', categoryId: null })]);
    });

    it('keeps the space inside a name and tidies the spaces around it', async () => {
        assignTaskCategory(TASK_ID, '  신규   기획 ');

        expect(get(tasks)[0]).toMatchObject({ category: '신규 기획', categoryId: null, categoryMeta: null });
        await waitForPendingTaskSyncs();
        expect(patches).toEqual([expect.objectContaining({ category: '신규 기획', categoryId: null })]);
    });

    it('clears the category for an empty name', async () => {
        assignTaskCategory(TASK_ID, '  ');

        expect(get(tasks)[0]).toMatchObject({ category: '', categoryId: null, categoryMeta: null });
        await waitForPendingTaskSyncs();
        expect(patches).toEqual([expect.objectContaining({ category: '', categoryId: null })]);
    });

    it('changes and sends nothing for the name the task already has', async () => {
        const before = get(tasks);

        assignTaskCategory(TASK_ID, '개발');
        assignTaskCategory(TASK_ID, ' 개발 ');
        // Offline the catalog is empty; the task keeps its own category id.
        applyServerCategoryCatalog([]);
        assignTaskCategory(TASK_ID, '개발');

        expect(get(tasks)).toBe(before);
        await waitForPendingTaskSyncs();
        expect(patches).toEqual([]);
    });
});
