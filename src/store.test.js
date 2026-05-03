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
    createServerChecklistItem,
    createServerTask,
    deleteServerChecklistItem,
    deleteServerTask,
    exportServerTasks,
    importServerTasks,
    listServerTasks,
    updateServerChecklistItem,
    updateServerTask
} from './lib/client/task-api.js';
import { buildTaskCreateDraft, createLocalTaskFromDraft } from './lib/client/task-create.js';
import {
    CalendarTokenConfigurationError,
    createCalendarToken,
    hashCalendarToken
} from './lib/server/calendar/tokens.js';
import {
    parsePasskeyRegistrationContext,
    normalizeAccountEmail
} from './lib/server/auth/account-security.js';
import {
    createRecoveryCodes as createRecoveryCodesRequest,
    requestEmailVerificationCode
} from './lib/client/account-security-api.js';
import {
    createCalendarToken as createCalendarTokenRequest,
    listCalendarTokens,
    revokeCalendarToken
} from './lib/client/calendar-token-api.js';
import {
    decryptCalendarToken,
    encryptCalendarToken,
    CalendarTokenEncryptionError
} from './lib/server/calendar/oauth-encryption.js';
import {
    listCalendarProviders as listCalendarProvidersRequest,
    syncCalendarProviders as syncCalendarProvidersRequest
} from './lib/client/calendar-provider-api.js';
import { planTaskImport } from './lib/server/tasks/import-planner.js';
import { mapTaskRowsToClientTasks } from './lib/server/tasks/task-mapper.js';
import {
    assertValidTaskDateRange,
    parseCreateTaskInput,
    parseCreateChecklistItemInput,
    parseUpdateChecklistItemInput,
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
import {
    enqueueOfflineMutation,
    flushOfflineWriteQueue,
    loadOfflineQueue
} from './lib/client/offline-write-queue.js';

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

    it('calls checklist mutation endpoints', async () => {
        const serverTask = normalizeTask({
            id: '66666666-6666-4666-8666-666666666666',
            text: 'Task with checklist',
            subtasks: [{ id: '77777777-7777-4777-8777-777777777777', text: 'Check item', done: false }]
        });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(createServerChecklistItem(serverTask.id, 'Check item', fetcher)).resolves.toEqual({
            ok: true,
            task: serverTask
        });
        expect(fetcher).toHaveBeenLastCalledWith(
            `/api/tasks/${serverTask.id}/checklist`,
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ text: 'Check item' })
            })
        );

        await expect(updateServerChecklistItem(serverTask.id, '77777777-7777-4777-8777-777777777777', {
            done: true
        }, fetcher)).resolves.toEqual({
            ok: true,
            task: serverTask
        });
        expect(fetcher).toHaveBeenLastCalledWith(
            `/api/tasks/${serverTask.id}/checklist/77777777-7777-4777-8777-777777777777`,
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ done: true })
            })
        );

        await expect(deleteServerChecklistItem(serverTask.id, '77777777-7777-4777-8777-777777777777', fetcher)).resolves.toEqual({
            ok: true,
            task: serverTask
        });
        expect(fetcher).toHaveBeenLastCalledWith(
            `/api/tasks/${serverTask.id}/checklist/77777777-7777-4777-8777-777777777777`,
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('calls server import and export endpoints', async () => {
        const serverTask = normalizeTask({
            id: '88888888-8888-4888-8888-888888888888',
            text: 'Imported task'
        });
        const exportFetcher = vi.fn(async () => new Response(JSON.stringify([serverTask]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(exportServerTasks(exportFetcher)).resolves.toEqual({
            ok: true,
            tasks: [serverTask]
        });
        expect(exportFetcher).toHaveBeenCalledWith('/api/export', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));

        const summary = {
            receivedTasks: 1,
            importedTasks: 1,
            skippedTasks: 0,
            importedChecklistItems: 0,
            skippedChecklistItems: 0,
            repairedParentLinks: 0
        };
        const importFetcher = vi.fn(async () => new Response(JSON.stringify({
            tasks: [serverTask],
            summary
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));
        const payload = [{ id: 'legacy-task', text: 'Imported task' }];

        await expect(importServerTasks(payload, importFetcher)).resolves.toEqual({
            ok: true,
            tasks: [serverTask],
            summary
        });
        expect(importFetcher).toHaveBeenCalledWith('/api/import', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(payload)
        }));

        const replaceFetcher = vi.fn(async () => new Response(JSON.stringify({
            tasks: [serverTask],
            summary: { ...summary, replacedTasks: 3 }
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(importServerTasks(payload, { mode: 'replace' }, replaceFetcher)).resolves.toEqual({
            ok: true,
            tasks: [serverTask],
            summary: { ...summary, replacedTasks: 3 }
        });
        expect(replaceFetcher).toHaveBeenCalledWith('/api/import?mode=replace', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(payload)
        }));
    });
});

describe('offline write queue', () => {
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
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'localStorage');
    });

    it('coalesces task patches and flushes them in order', async () => {
        const taskId = '99999999-9999-4999-8999-999999999999';
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId,
            patch: { text: 'First' }
        });
        enqueueOfflineMutation({
            type: 'task.patch',
            taskId,
            patch: { status: 'doing' }
        });

        expect(loadOfflineQueue()).toHaveLength(1);
        expect(loadOfflineQueue()[0]).toMatchObject({
            type: 'task.patch',
            patch: { text: 'First', status: 'doing' }
        });

        const serverTask = normalizeTask({ id: taskId, text: 'First', status: 'doing' });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
            flushed: 1,
            remaining: 0,
            blocked: false,
            syncedTasks: [serverTask]
        });
        expect(fetcher).toHaveBeenCalledWith(`/api/tasks/${taskId}`, expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ text: 'First', status: 'doing' })
        }));
        expect(loadOfflineQueue()).toEqual([]);
    });

    it('keeps retryable failures for a later sync', async () => {
        const taskId = '99999999-9999-4999-8999-999999999999';
        enqueueOfflineMutation({
            type: 'task.delete',
            taskId
        });

        await expect(flushOfflineWriteQueue(async () => {
            throw new Error('offline');
        })).resolves.toMatchObject({
            flushed: 0,
            remaining: 1,
            blocked: true
        });
        expect(loadOfflineQueue()[0]).toMatchObject({
            type: 'task.delete',
            taskId,
            attempts: 1
        });
    });
});

describe('server task import planning', () => {
    it('remaps legacy ids and preserves valid parent/checklist relationships', () => {
        const ids = [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000003'
        ];
        const { plans, summary } = planTaskImport([
            {
                id: 'parent',
                text: 'Parent',
                status: 'doing',
                startDate: '2026-05-03',
                endDate: '2026-05-04',
                subtasks: [{ id: 'sub', text: '  Checklist  ', done: true }]
            },
            {
                id: 'child',
                text: 'Child',
                status: 'todo',
                parentId: 'parent',
                startDate: '2026-05-04',
                endDate: '2026-05-05'
            }
        ], {
            idFactory: () => ids.shift() ?? '00000000-0000-4000-8000-000000000099'
        });

        expect(plans.map((plan) => ({
            oldId: plan.oldId,
            id: plan.id,
            parentTaskId: plan.parentTaskId,
            checklistItems: plan.checklistItems
        }))).toEqual([
            {
                oldId: 'parent',
                id: '00000000-0000-4000-8000-000000000001',
                parentTaskId: null,
                checklistItems: [{
                    oldId: 'sub',
                    id: '00000000-0000-4000-8000-000000000003',
                    text: 'Checklist',
                    done: true
                }]
            },
            {
                oldId: 'child',
                id: '00000000-0000-4000-8000-000000000002',
                parentTaskId: '00000000-0000-4000-8000-000000000001',
                checklistItems: []
            }
        ]);
        expect(summary).toEqual({
            receivedTasks: 2,
            importedTasks: 2,
            skippedTasks: 0,
            importedChecklistItems: 1,
            skippedChecklistItems: 0,
            repairedParentLinks: 0
        });
    });

    it('rejects non-array imports and skips empty task titles', () => {
        expect(() => planTaskImport({ text: 'Not an array' })).toThrow('Import payload must be an array of tasks.');

        const { plans, summary } = planTaskImport([
            { id: 'empty', text: '' },
            { id: 'valid', text: 'Valid task', parentId: 'missing' }
        ], {
            idFactory: () => '99999999-9999-4999-8999-999999999999'
        });

        expect(plans).toHaveLength(1);
        expect(plans[0].oldId).toBe('valid');
        expect(plans[0].parentTaskId).toBeNull();
        expect(summary.skippedTasks).toBe(1);
        expect(summary.repairedParentLinks).toBe(0);
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

describe('calendar subscription tokens', () => {
    const originalSecret = process.env.CALENDAR_TOKEN_SECRET;

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.CALENDAR_TOKEN_SECRET;
        } else {
            process.env.CALENDAR_TOKEN_SECRET = originalSecret;
        }
    });

    it('generates url-safe high entropy tokens without exposing the hash input', () => {
        const token = createCalendarToken();
        expect(token).toMatch(/^cal_[A-Za-z0-9_-]{40,}$/);
        expect(token).not.toContain('=');
    });

    it('hashes tokens with a required keyed secret', () => {
        process.env.CALENDAR_TOKEN_SECRET = 'calendar-secret-one-with-32-bytes';
        const hash = hashCalendarToken('cal_test-token');
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
        expect(hashCalendarToken('cal_test-token')).toBe(hash);

        process.env.CALENDAR_TOKEN_SECRET = 'calendar-secret-two-with-32-bytes';
        expect(hashCalendarToken('cal_test-token')).not.toBe(hash);

        delete process.env.CALENDAR_TOKEN_SECRET;
        expect(() => hashCalendarToken('cal_test-token')).toThrow(CalendarTokenConfigurationError);
    });

    it('calls calendar token management endpoints', async () => {
        const tokenRecord = {
            id: 'token-id',
            name: 'Calendar feed',
            tokenPrefix: 'cal_preview',
            createdAt: '2026-05-03T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
            expiresAt: null
        };
        const listFetcher = vi.fn(async () => new Response(JSON.stringify({ tokens: [tokenRecord] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(listCalendarTokens(listFetcher)).resolves.toEqual({
            ok: true,
            tokens: [tokenRecord]
        });
        expect(listFetcher).toHaveBeenCalledWith('/api/calendar/tokens', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));

        const createFetcher = vi.fn(async () => new Response(JSON.stringify({
            token: 'cal_raw',
            url: '/api/calendar/subscriptions/cal_raw.ics',
            record: tokenRecord
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(createCalendarTokenRequest('Calendar feed', createFetcher)).resolves.toEqual({
            ok: true,
            token: 'cal_raw',
            url: '/api/calendar/subscriptions/cal_raw.ics',
            record: tokenRecord
        });
        expect(createFetcher).toHaveBeenCalledWith('/api/calendar/tokens', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Calendar feed' })
        }));

        const revokeFetcher = vi.fn(async () => new Response(JSON.stringify({ token: { ...tokenRecord, revokedAt: '2026-05-03T00:00:00.000Z' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));
        await expect(revokeCalendarToken('token-id', revokeFetcher)).resolves.toMatchObject({
            ok: true,
            token: expect.objectContaining({ id: 'token-id' })
        });
        expect(revokeFetcher).toHaveBeenCalledWith('/api/calendar/tokens/token-id', expect.objectContaining({
            method: 'DELETE'
        }));
    });
});

describe('calendar provider sync helpers', () => {
    const originalKey = process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;

    afterEach(() => {
        if (originalKey === undefined) {
            delete process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;
        } else {
            process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = originalKey;
        }
    });

    it('encrypts OAuth tokens with associated data', () => {
        process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = 'calendar-oauth-encryption-key-for-tests';
        const encrypted = encryptCalendarToken('access-token', 'connection:user:google');
        expect(encrypted).toMatch(/^v1:/);
        expect(encrypted).not.toContain('access-token');
        expect(decryptCalendarToken(encrypted, 'connection:user:google')).toBe('access-token');
        expect(() => decryptCalendarToken(encrypted, 'connection:user:microsoft')).toThrow();

        delete process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;
        expect(() => encryptCalendarToken('token', 'aad')).toThrow(CalendarTokenEncryptionError);
    });

    it('calls calendar provider list and sync endpoints', async () => {
        const providerBody = {
            providers: [{ id: 'google', name: 'Google Calendar', configured: true }],
            connections: [{
                id: 'connection-id',
                provider: 'google',
                providerAccountId: 'account-id',
                createdAt: '2026-05-03T00:00:00.000Z',
                updatedAt: '2026-05-03T00:00:00.000Z',
                expiresAt: null
            }]
        };
        const listFetcher = vi.fn(async () => new Response(JSON.stringify(providerBody), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(listCalendarProvidersRequest(listFetcher)).resolves.toEqual({
            ok: true,
            ...providerBody,
            syncRuns: []
        });
        expect(listFetcher).toHaveBeenCalledWith('/api/calendar/providers', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));

        const syncBody = {
            connections: 1,
            tasks: 2,
            summaries: [{ connectionId: 'connection-id', provider: 'google', upserted: 2, deleted: 0, failed: 0 }]
        };
        const syncFetcher = vi.fn(async () => new Response(JSON.stringify(syncBody), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(syncCalendarProvidersRequest(syncFetcher)).resolves.toEqual({
            ok: true,
            ...syncBody
        });
        expect(syncFetcher).toHaveBeenCalledWith('/api/calendar/sync', expect.objectContaining({
            method: 'POST'
        }));
    });
});

describe('account security helpers', () => {
    it('normalizes registration context and requires an email', () => {
        expect(normalizeAccountEmail('  USER@Example.COM ')).toBe('user@example.com');
        expect(parsePasskeyRegistrationContext(JSON.stringify({
            email: ' USER@Example.COM ',
            name: ' User ',
            emailVerificationCode: '123456'
        }))).toEqual({
            email: 'user@example.com',
            name: 'User',
            emailVerificationCode: '123456',
            recoveryCode: ''
        });

        expect(() => parsePasskeyRegistrationContext(JSON.stringify({
            email: 'not-email',
            emailVerificationCode: '123456'
        }))).toThrow('A valid email is required');
    });

    it('calls account verification and recovery endpoints', async () => {
        const verificationFetcher = vi.fn(async () => new Response(JSON.stringify({
            email: 'user@example.com',
            expiresAt: '2026-05-03T00:15:00.000Z',
            previewCode: '123456'
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(requestEmailVerificationCode({
            email: 'user@example.com',
            name: 'User'
        }, verificationFetcher)).resolves.toEqual({
            ok: true,
            email: 'user@example.com',
            expiresAt: '2026-05-03T00:15:00.000Z',
            previewCode: '123456'
        });
        expect(verificationFetcher).toHaveBeenCalledWith('/api/account/email-verifications', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: 'user@example.com', name: 'User' })
        }));

        const recoveryFetcher = vi.fn(async () => new Response(JSON.stringify({
            codes: ['td-AAAA-BBBB-CCCC'],
            summary: {
                total: 10,
                available: 10,
                lastCreatedAt: '2026-05-03T00:00:00.000Z'
            }
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(createRecoveryCodesRequest(recoveryFetcher)).resolves.toEqual({
            ok: true,
            codes: ['td-AAAA-BBBB-CCCC'],
            summary: {
                total: 10,
                available: 10,
                lastCreatedAt: '2026-05-03T00:00:00.000Z'
            }
        });
        expect(recoveryFetcher).toHaveBeenCalledWith('/api/account/recovery-codes', expect.objectContaining({
            method: 'POST'
        }));
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

    it('validates checklist create and update payloads', () => {
        expect(parseCreateChecklistItemInput({ text: '  Read docs  ' })).toEqual({ text: 'Read docs' });
        expect(parseUpdateChecklistItemInput({ text: '  Review  ', done: true })).toEqual({
            text: 'Review',
            done: true
        });

        expect(() => parseCreateChecklistItemInput({ text: '' })).toThrow('Checklist text is required.');
        expect(() => parseUpdateChecklistItemInput({})).toThrow('At least one checklist field is required.');
        expect(() => parseUpdateChecklistItemInput({ done: 'yes' })).toThrow('done must be a boolean.');
    });
});
