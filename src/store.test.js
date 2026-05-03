import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    canAssignParent,
    normalizeDateRange,
    normalizeTask,
    normalizeTaskList
} from './lib/shared/task-domain.js';
import { createTaskCalendar as createIcsCalendar } from './lib/shared/calendar-ics.js';
import {
    moveTask,
    replaceTasks,
    resetFilters,
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

    it('normalizes invalid scalar fields and trims categories', () => {
        const task = normalizeTask({
            id: '',
            text: 123,
            status: 'later',
            priority: 'critical',
            urgency: 'now',
            category: '  개발  ',
            parentId: '',
            subtasks: [
                { id: 'sub-1', text: ' first ', done: 1 },
                { id: 'sub-1', text: 42, done: 0 }
            ],
            createdAt: Number.NaN
        });

        expect(task.id).toBeTruthy();
        expect(task.text).toBe('');
        expect(task.status).toBe('todo');
        expect(task.priority).toBe('medium');
        expect(task.urgency).toBe('normal');
        expect(task.category).toBe('개발');
        expect(task.parentId).toBeNull();
        expect(task.subtasks).toHaveLength(2);
        expect(new Set(task.subtasks.map((subtask) => subtask.id)).size).toBe(2);
        expect(task.subtasks[0].done).toBe(true);
        expect(task.subtasks[1].text).toBe('');
        expect(task.createdAt).toBe(Date.now());
    });

    it('normalizes invalid, inverted, and very long date ranges', () => {
        expect(normalizeDateRange('not-a-date', '10000-01-01')).toEqual({
            startDate: '2026-05-03',
            endDate: '2026-05-05'
        });

        expect(normalizeDateRange('2026-05-10', '2026-05-03')).toEqual({
            startDate: '2026-05-10',
            endDate: '2026-05-10'
        });

        expect(normalizeDateRange('2026-01-01', '2040-01-01')).toEqual({
            startDate: '2026-01-01',
            endDate: '2035-12-30'
        });
    });

    it('deduplicates task ids and repairs broken parent graphs', () => {
        const normalized = normalizeTaskList([
            { id: 'root', text: 'Root', status: 'doing' },
            { id: 'child', text: 'Child', parentId: 'root', status: 'todo' },
            { id: 'child', text: 'Duplicate id' },
            { id: 'orphan', text: 'Orphan', parentId: 'missing' },
            { id: 'self', text: 'Self parent', parentId: 'self' },
            { id: 'cycle-a', text: 'Cycle A', parentId: 'cycle-b' },
            { id: 'cycle-b', text: 'Cycle B', parentId: 'cycle-a' }
        ]);

        expect(new Set(normalized.map((task) => task.id)).size).toBe(normalized.length);
        expect(normalized.find((task) => task.id === 'child')?.status).toBe('doing');
        expect(normalized.find((task) => task.id === 'orphan')?.parentId).toBeNull();
        expect(normalized.find((task) => task.id === 'self')?.parentId).toBeNull();
        expect(normalized.find((task) => task.id === 'cycle-a')?.parentId).toBeNull();
        expect(normalized.find((task) => task.id === 'cycle-b')?.parentId).toBeNull();
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

    it('rejects parent assignment through a corrupt cycle instead of looping', () => {
        const corrupt = normalizeTaskList([
            { id: 'a', text: 'A', parentId: 'b' },
            { id: 'b', text: 'B', parentId: 'a' },
            { id: 'c', text: 'C' }
        ]);

        expect(canAssignParent(corrupt, 'c', 'a')).toBe(true);
        expect(canAssignParent([
            { id: 'a', text: 'A', status: 'todo', startDate: '2026-05-03', endDate: '2026-05-05', priority: 'medium', urgency: 'normal', category: '', parentId: 'b', subtasks: [], collapsed: false, createdAt: 1 },
            { id: 'b', text: 'B', status: 'todo', startDate: '2026-05-03', endDate: '2026-05-05', priority: 'medium', urgency: 'normal', category: '', parentId: 'a', subtasks: [], collapsed: false, createdAt: 1 }
        ], 'c', 'a')).toBe(false);
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

describe('calendar export', () => {
    it('creates all-day iCalendar events from normalized tasks', () => {
        const calendar = createIcsCalendar([
            {
                id: 'task-1',
                text: 'Review, ship; celebrate',
                status: 'doing',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                priority: 'high',
                urgency: 'urgent',
                category: 'Release',
                subtasks: [{ id: 'sub-1', text: 'QA pass', done: true }]
            }
        ], {
            now: new Date('2026-05-03T00:00:00.000Z'),
            calendarName: 'Project Calendar'
        });

        expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
        expect(calendar).toContain('X-WR-CALNAME:Project Calendar');
        expect(calendar).toContain('UID:task-1@todolist.local');
        expect(calendar).toContain('DTSTAMP:20260503T000000Z');
        expect(calendar).toContain('DTSTART;VALUE=DATE:20260503');
        expect(calendar).toContain('DTEND;VALUE=DATE:20260505');
        expect(calendar).toContain('SUMMARY:Review\\, ship\\; celebrate');
        expect(calendar).toContain('CATEGORIES:Release');
        expect(calendar).toContain('Checklist:\\n- [x] QA pass');
    });
});
