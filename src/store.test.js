import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    canAssignParent,
    normalizeDateRange,
    normalizeTask,
    normalizeTaskList
} from './lib/shared/task-domain.js';
import { createTaskCalendar as createIcsCalendar } from './lib/shared/calendar-ics.js';
import { createServerTask, deleteServerTask, listServerTasks, updateServerTask } from './lib/client/task-api.js';
import { buildTaskCreateDraft, createLocalTaskFromDraft } from './lib/client/task-create.js';
import { mapTaskRowsToClientTasks } from './lib/server/tasks/task-mapper.js';
import {
    assertValidTaskDateRange,
    parseCreateTaskInput,
    parseTaskIdParam,
    parseUpdateTaskInput,
    TaskWriteError
} from './lib/server/tasks/validation.js';
import {
    moveTask,
    mergeTasks,
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

describe('client task creation', () => {
    it('builds strict server payloads and keeps server parent ids', () => {
        const parent = normalizeTask({
            id: '11111111-1111-4111-8111-111111111111',
            text: 'Parent',
            status: 'doing'
        });

        expect(buildTaskCreateDraft({
            text: '  Child task  ',
            priority: 'high',
            urgency: 'urgent',
            category: '  개발  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parent
        })).toEqual({
            payload: {
                text: 'Child task',
                status: 'doing',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                priority: 'high',
                urgency: 'urgent',
                category: '개발',
                parentId: '11111111-1111-4111-8111-111111111111'
            },
            parent,
            hasLocalParent: false
        });
    });

    it('keeps local parent relationships out of server payloads', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 3, 12));

        const parent = normalizeTask({
            id: 'local-parent',
            text: 'Local parent',
            status: 'todo'
        });
        const draft = buildTaskCreateDraft({
            text: 'Local child',
            priority: 'medium',
            urgency: 'normal',
            category: '',
            startDate: '2026-05-03',
            endDate: '2026-05-05',
            parent
        });

        expect(draft).not.toBeNull();
        if (!draft) throw new Error('Expected a task create draft.');

        expect(draft.hasLocalParent).toBe(true);
        expect(draft.payload.parentId).toBeNull();

        const localTask = createLocalTaskFromDraft(draft.payload, draft.parent);
        expect(localTask.parentId).toBe('local-parent');
        expect(localTask.status).toBe('todo');

        vi.useRealTimers();
    });

    it('classifies task API responses for server create and fallback', async () => {
        const serverTask = normalizeTask({
            id: '22222222-2222-4222-8222-222222222222',
            text: 'Server task'
        });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(createServerTask({ text: 'Server task' }, fetcher)).resolves.toEqual({
            ok: true,
            task: serverTask
        });
        expect(fetcher).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ text: 'Server task' })
        }));

        await expect(createServerTask({}, async () => new Response(JSON.stringify({ message: 'Auth required.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
        }))).resolves.toMatchObject({
            ok: false,
            fallback: true,
            status: 401
        });

        await expect(createServerTask({}, async () => new Response(JSON.stringify({ message: 'Invalid task.' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
        }))).resolves.toMatchObject({
            ok: false,
            fallback: false,
            status: 400,
            message: 'Invalid task.'
        });
    });

    it('loads and normalizes server task lists', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            tasks: [
                {
                    id: '33333333-3333-4333-8333-333333333333',
                    text: '  Server list task  ',
                    status: 'done',
                    startDate: '2026-05-03',
                    endDate: '2026-05-03'
                }
            ]
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        const result = await listServerTasks(fetcher);
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error('Expected server task list result.');
        expect(result.tasks).toEqual([
            expect.objectContaining({
                id: '33333333-3333-4333-8333-333333333333',
                text: '  Server list task  ',
                status: 'done'
            })
        ]);
        expect(fetcher).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));
    });

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

    it('calls task mutation endpoints', async () => {
        const serverTask = normalizeTask({
            id: '44444444-4444-4444-8444-444444444444',
            text: 'Updated server task'
        });
        const updateFetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(updateServerTask('44444444-4444-4444-8444-444444444444', {
            text: 'Updated server task'
        }, updateFetcher)).resolves.toEqual({
            ok: true,
            task: serverTask
        });
        expect(updateFetcher).toHaveBeenCalledWith(
            '/api/tasks/44444444-4444-4444-8444-444444444444',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ text: 'Updated server task' })
            })
        );

        const deleteFetcher = vi.fn(async () => new Response(JSON.stringify({ deleted: 3 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));
        await expect(deleteServerTask('44444444-4444-4444-8444-444444444444', deleteFetcher)).resolves.toEqual({
            ok: true,
            deleted: 3
        });
        expect(deleteFetcher).toHaveBeenCalledWith(
            '/api/tasks/44444444-4444-4444-8444-444444444444',
            expect.objectContaining({ method: 'DELETE' })
        );
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

describe('server task mapping', () => {
    it('maps database task rows to the current client backup shape', () => {
        const tasks = mapTaskRowsToClientTasks([
            {
                id: 'task-db-id',
                boardId: 'board-id',
                parentTaskId: null,
                title: 'Server task',
                status: 'todo',
                priority: 'medium',
                urgency: 'normal',
                category: 'Sync',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                position: '0',
                createdBy: 'user-id',
                createdAt: new Date('2026-05-03T00:00:00.000Z'),
                updatedAt: new Date('2026-05-03T00:00:00.000Z'),
                completedAt: null,
                deletedAt: null
            }
        ], [
            {
                id: 'check-1',
                taskId: 'task-db-id',
                text: 'Mapped checklist',
                done: false,
                position: '0',
                createdAt: new Date('2026-05-03T00:00:00.000Z'),
                updatedAt: new Date('2026-05-03T00:00:00.000Z')
            }
        ]);

        expect(tasks).toEqual([
            {
                id: 'task-db-id',
                text: 'Server task',
                status: 'todo',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                priority: 'medium',
                urgency: 'normal',
                category: 'Sync',
                parentId: null,
                subtasks: [{ id: 'check-1', text: 'Mapped checklist', done: false }],
                collapsed: false,
                createdAt: new Date('2026-05-03T00:00:00.000Z').getTime()
            }
        ]);
    });
});

describe('server task validation', () => {
    it('accepts a strict create payload with safe defaults', () => {
        expect(parseCreateTaskInput({
            text: '  Server task  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            category: '  Sync  '
        })).toEqual({
            title: 'Server task',
            status: 'todo',
            priority: 'medium',
            urgency: 'normal',
            category: 'Sync',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: null
        });
    });

    it('rejects invalid create payloads instead of silently repairing them', () => {
        expect(() => parseCreateTaskInput({
            text: '',
            startDate: '2026-05-03',
            endDate: '2026-05-04'
        })).toThrow(TaskWriteError);

        expect(() => parseCreateTaskInput({
            text: 'Bad status',
            status: 'blocked',
            startDate: '2026-05-03',
            endDate: '2026-05-04'
        })).toThrow('Invalid status.');

        expect(() => parseCreateTaskInput({
            text: 'Bad date',
            startDate: '2026-05-04',
            endDate: '2026-05-03'
        })).toThrow('Invalid task date range.');

        expect(() => parseCreateTaskInput({
            text: 'Bad parent',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: 'local-timestamp-id'
        })).toThrow('parentId must be a UUID.');
    });

    it('accepts strict update payloads and task ids', () => {
        expect(parseTaskIdParam('55555555-5555-4555-8555-555555555555')).toBe('55555555-5555-4555-8555-555555555555');
        expect(parseUpdateTaskInput({
            text: '  Updated task  ',
            status: 'doing',
            priority: 'high',
            urgency: 'urgent',
            category: '  Sync  ',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: null
        })).toEqual({
            title: 'Updated task',
            status: 'doing',
            priority: 'high',
            urgency: 'urgent',
            category: 'Sync',
            startDate: '2026-05-03',
            endDate: '2026-05-04',
            parentId: null
        });
    });

    it('rejects invalid update payloads and date ranges', () => {
        expect(() => parseTaskIdParam('local-id')).toThrow('taskId must be a UUID.');
        expect(() => parseUpdateTaskInput({})).toThrow('At least one task field is required.');
        expect(() => parseUpdateTaskInput({ status: 'blocked' })).toThrow('Invalid status.');
        expect(() => parseUpdateTaskInput({ parentId: 'local-parent' })).toThrow('parentId must be a UUID.');
        expect(() => assertValidTaskDateRange('2026-05-04', '2026-05-03')).toThrow('Invalid task date range.');
    });
});
