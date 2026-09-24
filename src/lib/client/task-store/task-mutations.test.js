import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveTask } from './task-mutations.js';
import { replaceTasks, tasks } from './task-cache.js';
import { resetFilters } from './filters.js';

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
