import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from './lib/shared/task-domain.js';
import {
    applyServerCategoryCatalog,
    categories,
    clearDoneTasks,
    categorySummaries,
    mergeCategory,
    moveTask,
    mergeTasks,
    renameCategory,
    replaceTasks,
    resetFilters,
    setTaskStorageOwner,
    tasks
} from './lib/client/task-store.js';

describe('task data normalization', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 3, 12));
        replaceTasks([]);
        resetFilters();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('routes replaceTasks through the same normalization boundary', () => {
        replaceTasks([
            { id: 'a', text: 'A', status: 'done', startDate: '2026-05-10', endDate: '2026-05-01' },
            { id: 'a', text: 'Duplicate A', parentId: 'missing', priority: 'urgent' }
        ]);

        const value = get(tasks);
        expect(value).toHaveLength(2);
        expect(new Set(value.map((task) => task.id)).size).toBe(2);
        expect(value[0].endDate).toBe('2026-05-10');
        expect(value[1].parentId).toBeNull();
        expect(value[1].priority).toBe('medium');
    });
});

describe('task relationship mutations', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 3, 12));
        replaceTasks([
            { id: 'parent', text: 'Parent', status: 'todo' },
            { id: 'child', text: 'Child', status: 'todo', parentId: 'parent' }
        ]);
        resetFilters();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('detaches a child when it moves to a different lane', () => {
        moveTask('child', 'doing');

        const child = get(tasks).find((task) => task.id === 'child');
        expect(child?.status).toBe('doing');
        expect(child?.parentId).toBeNull();
    });

    it('ignores invalid target statuses', () => {
        moveTask('child', 'archived');

        const child = get(tasks).find((task) => task.id === 'child');
        expect(child?.status).toBe('todo');
        expect(child?.parentId).toBe('parent');
    });
});

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

describe('client task creation', () => {
    it('merges server tasks without dropping local-only tasks', () => {
        replaceTasks([
            { id: 'local-only', text: 'Local only', status: 'todo' },
            { id: 'shared-id', text: 'Old local value', status: 'todo' }
        ]);

        mergeTasks([
            { id: 'shared-id', text: 'Server value', status: 'doing' },
            { id: 'server-only', text: 'Server only', status: 'done' }
        ]);

        expect(get(tasks).map((task) => ({
            id: task.id,
            text: task.text,
            status: task.status
        }))).toEqual([
            { id: 'local-only', text: 'Local only', status: 'todo' },
            { id: 'shared-id', text: 'Server value', status: 'doing' },
            { id: 'server-only', text: 'Server only', status: 'done' }
        ]);
    });
});

describe('task store server sync', () => {
    afterEach(() => {
        replaceTasks([]);
        Reflect.deleteProperty(globalThis, 'fetch');
        Reflect.deleteProperty(globalThis, 'window');
    });

    it('syncs clear-done deletes for server-backed tasks', async () => {
        const parent = normalizeTask({
            id: '11111111-1111-4111-8111-111111111111',
            text: 'Done parent',
            status: 'done'
        });
        const child = normalizeTask({
            id: '22222222-2222-4222-8222-222222222222',
            text: 'Done child',
            status: 'done',
            parentId: parent.id
        });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ deleted: 2 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {}
        });
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: fetcher
        });

        replaceTasks([parent, child]);
        clearDoneTasks();

        expect(get(tasks)).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(`/api/tasks/${parent.id}`, expect.objectContaining({
            method: 'DELETE'
        }));
    });
});

describe('task storage owner scope', () => {
    /** @type {Map<string, string>} */
    let storage;

    beforeEach(() => {
        storage = new Map();
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((key) => storage.get(key) ?? null),
                setItem: vi.fn((key, value) => {
                    storage.set(key, String(value));
                }),
                removeItem: vi.fn((key) => {
                    storage.delete(key);
                })
            }
        });
        setTaskStorageOwner(null);
        replaceTasks([]);
    });

    afterEach(() => {
        setTaskStorageOwner(null);
        replaceTasks([]);
        Reflect.deleteProperty(globalThis, 'localStorage');
    });

    it('keeps cached task lists scoped by user', () => {
        const taskA = normalizeTask({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            text: 'User A task'
        });
        const taskB = normalizeTask({
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            text: 'User B task'
        });

        setTaskStorageOwner('user-a');
        replaceTasks([taskA]);
        expect(JSON.parse(storage.get('kanbanTasks:user-a') ?? '[]')).toHaveLength(1);

        setTaskStorageOwner('user-b');
        expect(get(tasks)).toEqual([]);
        replaceTasks([taskB]);
        expect(JSON.parse(storage.get('kanbanTasks:user-b') ?? '[]')).toHaveLength(1);

        setTaskStorageOwner('user-a');
        expect(get(tasks)).toEqual([taskA]);
    });
});
