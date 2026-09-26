import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyServerCategoryCatalog,
    assignTaskCategory,
    categories,
    categorySummaries,
    clearCategory,
    mergeCategory,
    renameCategory
} from './category-store.js';
import { replaceTasks, tasks } from './task-cache.js';
import { resetFilters } from './filters.js';
import { resetTaskSyncStateForTests, waitForPendingTaskSyncs } from './sync-engine.js';
import { updateTask } from './task-mutations.js';

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
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

describe('task versions after a category write', () => {
    const TASK_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const SOURCE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '공부', color: '#58a6ff', sortOrder: 0, hiddenAt: null, archivedAt: null };
    const TARGET = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '학습', color: null, sortOrder: 1, hiddenAt: null, archivedAt: null };
    const ARCHIVED = { ...SOURCE, hiddenAt: '2026-07-06T12:00:00.000Z', archivedAt: '2026-07-06T12:00:00.000Z' };
    /** @type {{ url: string; body: any }[]} */
    let requests;
    /** @type {Record<string, unknown>} */
    let categoryResponse;
    /** @type {number} The version of the task on the fake server. */
    let serverVersion;

    beforeEach(() => {
        requests = [];
        serverVersion = 3;
        vi.stubGlobal('window', {});
        vi.stubGlobal('navigator', { onLine: true });
        vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
            const body = init.body ? JSON.parse(String(init.body)) : undefined;
            requests.push({ url, body });
            if (url.startsWith('/api/categories/')) {
                // Like the server, the category write bumps every task in it.
                serverVersion += 1;
                return jsonResponse({ ...categoryResponse, taskVersions: [{ id: TASK_ID, version: serverVersion }] });
            }
            if (body.expectedVersion !== serverVersion) {
                return jsonResponse({ message: 'Task changed on another device. Sync and try again.' }, 409);
            }
            serverVersion += 1;
            const current = get(tasks).find((task) => task.id === TASK_ID);
            return jsonResponse({ task: { ...current, version: serverVersion } });
        }));
        replaceTasks([{ id: TASK_ID, text: 'Read', version: 3, category: '공부', categoryId: SOURCE.id, categoryMeta: SOURCE }]);
        applyServerCategoryCatalog([SOURCE, TARGET]);
    });

    afterEach(async () => {
        await waitForPendingTaskSyncs();
        resetTaskSyncStateForTests();
        replaceTasks([]);
        applyServerCategoryCatalog([]);
        vi.unstubAllGlobals();
    });

    // Fails until the client applies the taskVersions a category write
    // returns: the edit goes out with the stale expectedVersion 3 and gets 409.
    it.fails.each([
        ['rename', () => renameCategory(SOURCE, '국어'), { category: { ...SOURCE, name: '국어' }, updatedTasks: 1 }, '국어'],
        ['merge', () => mergeCategory(SOURCE, TARGET), { source: ARCHIVED, target: TARGET, updatedTasks: 1 }, '학습'],
        ['delete', () => clearCategory(SOURCE), { category: ARCHIVED, clearedTasks: 1 }, '']
    ])('edits a task after a category %s with the version the server gave it, without a false 409', async (_write, write, response, category) => {
        categoryResponse = response;
        const result = await write();

        expect(result).toMatchObject({ ok: true, changed: 1 });
        expect(get(tasks)[0]).toMatchObject({ category, version: 4 });

        updateTask(TASK_ID, { text: 'Read more' });
        await waitForPendingTaskSyncs();

        expect(requests.filter((request) => request.url === `/api/tasks/${TASK_ID}`).map((request) => request.body))
            .toEqual([expect.objectContaining({ text: 'Read more', category, expectedVersion: 4 })]);
        expect(get(tasks)[0]).toMatchObject({ text: 'Read more', category, version: 5 });
    });
});
