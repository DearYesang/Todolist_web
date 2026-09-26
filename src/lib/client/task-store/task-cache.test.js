import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { normalizeTask } from '../../shared/task-domain.js';
import {
    insertTask,
    mergeTasks,
    replaceTasks,
    setTaskStorageOwner,
    tasks
} from './task-cache.js';
import { resetFilters } from './filters.js';

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

    it('inserts a created task at the end through the same normalization boundary', () => {
        replaceTasks([{ id: 'parent', text: 'Parent', status: 'doing' }]);

        // The parent moved lanes while its child's create was in flight.
        insertTask(normalizeTask({ id: 'child', text: 'Child', status: 'todo', parentId: 'parent' }));

        expect(get(tasks).map((task) => [task.id, task.status])).toEqual([['parent', 'doing'], ['child', 'doing']]);
    });

    it('keeps the copy the list already holds when a created task is no newer', () => {
        // A sync listed the task while its create was in flight, and the user
        // edited that copy since. Local edits do not bump the version.
        replaceTasks([
            { id: 'created', text: 'Edited after sync', status: 'doing', collapsed: true, version: 1 },
            { id: 'other', text: 'Other', status: 'todo' }
        ]);

        insertTask(normalizeTask({ id: 'created', text: 'Created', status: 'todo', version: 1 }));

        expect(get(tasks).map((task) => ({ id: task.id, text: task.text, status: task.status }))).toEqual([
            { id: 'created', text: 'Edited after sync', status: 'doing' },
            { id: 'other', text: 'Other', status: 'todo' }
        ]);
    });

    it('merges a created task that is newer than the copy the list already holds', () => {
        replaceTasks([
            { id: 'created', text: 'Listed', status: 'todo', collapsed: true, version: 1 },
            { id: 'other', text: 'Other', status: 'todo' }
        ]);

        insertTask(normalizeTask({ id: 'created', text: 'Created', status: 'doing', version: 2 }));

        expect(get(tasks).map((task) => ({ id: task.id, text: task.text, collapsed: task.collapsed }))).toEqual([
            { id: 'created', text: 'Created', collapsed: true },
            { id: 'other', text: 'Other', collapsed: false }
        ]);
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

describe('task storage owner scope', () => {
    /** @type {Map<string, string>} */
    let storage;

    beforeEach(() => {
        storage = installMemoryStorage();
        setTaskStorageOwner(null);
        replaceTasks([]);
    });

    afterEach(() => {
        setTaskStorageOwner(null);
        replaceTasks([]);
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
