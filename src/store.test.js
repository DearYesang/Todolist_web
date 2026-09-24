import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from './lib/shared/task-domain.js';
import { createTaskCalendarFilename } from './lib/client/calendar-download.js';
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
    createRecoveryCodes as createRecoveryCodesRequest,
    requestEmailVerificationCode
} from './lib/client/account-security-api.js';
import {
    deleteUserPasskey,
    listUserPasskeys,
    updateUserPasskeyName
} from './lib/client/passkey-management-api.js';
import {
    createCalendarToken as createCalendarTokenRequest,
    listCalendarTokens,
    revokeCalendarToken
} from './lib/client/calendar-token-api.js';
import {
    listCalendarProviders as listCalendarProvidersRequest,
    syncCalendarProviders as syncCalendarProvidersRequest
} from './lib/client/calendar-provider-api.js';
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
import {
    enqueueOfflineMutation,
    flushOfflineWriteQueue,
    loadOfflineQueue,
    setOfflineQueueOwner
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

        const versionedDeleteFetcher = vi.fn(async () => new Response(JSON.stringify({ deleted: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));
        await expect(deleteServerTask('55555555-5555-4555-8555-555555555555', {
            expectedVersion: 7
        }, versionedDeleteFetcher)).resolves.toEqual({
            ok: true,
            deleted: 1
        });
        expect(versionedDeleteFetcher).toHaveBeenCalledWith(
            '/api/tasks/55555555-5555-4555-8555-555555555555',
            expect.objectContaining({
                method: 'DELETE',
                body: JSON.stringify({ expectedVersion: 7 })
            })
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

        const wrappedPayload = { version: 1, tasks: payload };
        const wrappedFetcher = vi.fn(async () => new Response(JSON.stringify({
            tasks: [serverTask],
            summary
        }), {
            status: 201,
            headers: { 'content-type': 'application/json' }
        }));
        await expect(importServerTasks(wrappedPayload, wrappedFetcher)).resolves.toMatchObject({
            ok: true,
            tasks: [serverTask]
        });
        expect(wrappedFetcher).toHaveBeenCalledWith('/api/import', expect.objectContaining({
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
        setOfflineQueueOwner(null);
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

describe('calendar export', () => {
    it('creates safe filenames for individual task calendar downloads', () => {
        const filename = createTaskCalendarFilename(
            { text: 'Review / ship: celebrate?' },
            new Date('2026-05-03T00:00:00.000Z')
        );

        expect(filename).toBe('todolist_Review_-_ship-_celebrate_2026-05-03.ics');
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
        Reflect.deleteProperty(globalThis, 'fetch');
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
    const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS;

    afterEach(() => {
        if (originalAllowedEmails === undefined) {
            delete process.env.AUTH_ALLOWED_EMAILS;
        } else {
            process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails;
        }
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

    it('calls passkey management endpoints', async () => {
        const passkey = {
            id: 'passkey-id',
            name: 'iPad 패스키 - 2026-05-04',
            userId: 'user-id',
            credentialID: 'credential-id',
            deviceType: 'singleDevice',
            backedUp: true,
            transports: 'internal',
            createdAt: '2026-05-04T00:00:00.000Z'
        };
        const listFetcher = vi.fn(async () => new Response(JSON.stringify([passkey]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(listUserPasskeys(listFetcher)).resolves.toEqual({
            ok: true,
            passkeys: [passkey]
        });
        expect(listFetcher).toHaveBeenCalledWith('/api/auth/passkey/list-user-passkeys', expect.objectContaining({
            headers: { accept: 'application/json' }
        }));

        const updateFetcher = vi.fn(async () => new Response(JSON.stringify({
            passkey: { ...passkey, name: 'Mac 패스키 - 2026-05-04' }
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(updateUserPasskeyName('passkey-id', 'Mac 패스키 - 2026-05-04', updateFetcher)).resolves.toEqual({
            ok: true,
            passkey: { ...passkey, name: 'Mac 패스키 - 2026-05-04' }
        });
        expect(updateFetcher).toHaveBeenCalledWith('/api/auth/passkey/update-passkey', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ id: 'passkey-id', name: 'Mac 패스키 - 2026-05-04' })
        }));

        const deleteFetcher = vi.fn(async () => new Response(JSON.stringify({ status: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));

        await expect(deleteUserPasskey('passkey-id', deleteFetcher)).resolves.toEqual({ ok: true });
        expect(deleteFetcher).toHaveBeenCalledWith('/api/auth/passkey/delete-passkey', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ id: 'passkey-id' })
        }));
    });
});
