import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import {
	advanceQueuedTaskVersion,
	clearOfflineWriteQueue,
	dropQueuedChecklistFields,
	dropQueuedTaskPatch,
	enqueueOfflineMutation,
	flushOfflineWriteQueue,
	getOfflineQueueOwner,
	hasQueuedTaskMutation,
	loadOfflineQueue,
	resolveQueuedChecklistCreate,
	setOfflineQueueOwner
} from './offline-write-queue.js';
import { normalizeTask } from '../shared/task-domain.js';

/** @type {Map<string, string>} */
let storage;

beforeEach(() => {
	storage = installMemoryStorage();
});

afterEach(() => {
	setOfflineQueueOwner(null);
});

describe('offline write queue', () => {
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

describe('offline write queue conflict behavior', () => {
	it('drops 409 conflicts instead of retrying forever', async () => {
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999',
			patch: { text: 'Stale write' }
		});

		const result = await flushOfflineWriteQueue(async () => new Response(JSON.stringify({
			message: 'Conflict.'
		}), {
			status: 409,
			headers: { 'content-type': 'application/json' }
		}));

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false
		});
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]).toMatchObject({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999'
		});
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('preserves order after a partial flush failure', async () => {
		const firstTask = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'First'
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: firstTask.id,
			patch: { text: 'First' }
		});
		enqueueOfflineMutation({
			type: 'task.delete',
			taskId: '22222222-2222-4222-8222-222222222222'
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '33333333-3333-4333-8333-333333333333',
			patch: { text: 'Later' }
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: firstTask }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}))
			.mockRejectedValueOnce(new Error('offline'));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 2,
			blocked: true,
			syncedTasks: [firstTask]
		});
		expect(loadOfflineQueue().map((item) => item.type)).toEqual(['task.delete', 'task.patch']);
		expect(loadOfflineQueue()[0].attempts).toBe(1);
	});

	it('keeps rate-limited mutations queued for a later sync instead of dropping them', async () => {
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999',
			patch: { text: 'Throttled write' }
		});

		const result = await flushOfflineWriteQueue(async () => new Response(JSON.stringify({
			message: 'Too many task changes.'
		}), {
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': '30' }
		}));

		expect(result).toMatchObject({
			flushed: 0,
			remaining: 1,
			blocked: true
		});
		expect(result.conflicts).toEqual([]);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'task.patch',
			taskId: '99999999-9999-4999-8999-999999999999'
		});
	});

	it('keeps queued mutations scoped to the active user', () => {
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			patch: { text: 'A' }
		});

		setOfflineQueueOwner('user-b');
		expect(loadOfflineQueue()).toEqual([]);
		enqueueOfflineMutation({
			type: 'task.delete',
			taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			ownerUserId: 'user-b',
			type: 'task.delete'
		});

		setOfflineQueueOwner('user-a');
		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			ownerUserId: 'user-a',
			type: 'task.patch'
		});
	});

	it('adds a mutation to the queue of a given owner while another user is active', () => {
		const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		setOfflineQueueOwner('user-a');
		expect(getOfflineQueueOwner()).toBe('user-a');
		enqueueOfflineMutation({ type: 'task.patch', taskId, patch: { text: 'A', priority: 'high' } });
		setOfflineQueueOwner(null);
		expect(getOfflineQueueOwner()).toBe('anonymous');

		// A write user A made before signing out fails now.
		expect(enqueueOfflineMutation({ type: 'task.patch', taskId, patch: { text: 'A2' } }, { ownerId: 'user-a' })).toBe(1);

		expect(loadOfflineQueue()).toEqual([]);
		expect(storage.has('kanbanOfflineWriteQueue:anonymous')).toBe(false);
		setOfflineQueueOwner('user-a');
		// Merged into user A's queue as if user A were active.
		expect(loadOfflineQueue()).toEqual([
			expect.objectContaining({
				ownerUserId: 'user-a',
				type: 'task.patch',
				patch: { text: 'A2', priority: 'high' }
			})
		]);
	});

	it('adds a mutation for the signed-out owner under the per-owner key while a user is active', () => {
		storage.set('kanbanOfflineWriteQueue', JSON.stringify([{
			id: 'legacy-mutation',
			type: 'task.delete',
			taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			createdAt: 1,
			attempts: 0
		}]));
		setOfflineQueueOwner('user-a');

		enqueueOfflineMutation({
			type: 'task.delete',
			taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
		}, { ownerId: 'anonymous' });

		expect(storage.has('kanbanOfflineWriteQueue')).toBe(false);
		expect(JSON.parse(storage.get('kanbanOfflineWriteQueue:anonymous') ?? '[]')).toEqual([
			expect.objectContaining({ id: 'legacy-mutation' }),
			expect.objectContaining({ ownerUserId: 'anonymous', taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
		]);
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('moves a queued edit or delete of a task up to a newer version only', () => {
		const patched = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const deleted = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const ahead = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
		const unversioned = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({ type: 'task.patch', taskId: patched, patch: { text: 'A', expectedVersion: 1 } });
		enqueueOfflineMutation({ type: 'task.delete', taskId: deleted, expectedVersion: 1 });
		enqueueOfflineMutation({ type: 'task.patch', taskId: ahead, patch: { text: 'C', expectedVersion: 5 } });
		enqueueOfflineMutation({ type: 'task.patch', taskId: unversioned, patch: { text: 'D' } });
		// The write landed while another user was signed in.
		setOfflineQueueOwner('user-b');

		for (const taskId of [patched, deleted, ahead, unversioned]) {
			advanceQueuedTaskVersion(taskId, 3, { ownerId: 'user-a' });
		}

		expect(loadOfflineQueue()).toEqual([]);
		setOfflineQueueOwner('user-a');
		expect(loadOfflineQueue().map((mutation) => {
			if (mutation.type === 'task.patch') return [mutation.taskId, mutation.patch];
			return mutation.type === 'task.delete' ? [mutation.taskId, mutation.expectedVersion] : null;
		})).toEqual([
			[patched, { text: 'A', expectedVersion: 3 }],
			[deleted, 3],
			[ahead, { text: 'C', expectedVersion: 5 }],
			[unversioned, { text: 'D' }]
		]);
	});

	it('drops what a landed newer edit covers from the queue of a given owner', () => {
		const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const renamedItem = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
		const checkedItem = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({ type: 'task.patch', taskId, patch: { text: 'A', expectedVersion: 1 } });
		// Also sets a parent the server does not have yet.
		enqueueOfflineMutation({ type: 'task.patch', taskId: childId, localParentId: 'local-parent', patch: { text: 'B' } });
		enqueueOfflineMutation({ type: 'checklist.patch', taskId, itemId: renamedItem, patch: { text: 'Old', done: true } });
		enqueueOfflineMutation({ type: 'checklist.patch', taskId, itemId: checkedItem, patch: { done: true } });
		setOfflineQueueOwner('user-b');
		expect(hasQueuedTaskMutation(taskId)).toBe(false);
		expect(hasQueuedTaskMutation(taskId, { ownerId: 'user-a' })).toBe(true);

		dropQueuedTaskPatch(taskId, { ownerId: 'user-a' });
		dropQueuedTaskPatch(childId, { ownerId: 'user-a' });
		dropQueuedChecklistFields(taskId, renamedItem, ['text'], { ownerId: 'user-a' });
		dropQueuedChecklistFields(taskId, checkedItem, ['done'], { ownerId: 'user-a' });

		setOfflineQueueOwner('user-a');
		expect(loadOfflineQueue()).toEqual([
			expect.objectContaining({ type: 'task.patch', taskId: childId, patch: { text: 'B' } }),
			expect.objectContaining({ type: 'checklist.patch', itemId: renamedItem, patch: { done: true } })
		]);
		expect(hasQueuedTaskMutation(taskId)).toBe(true);
		expect(hasQueuedTaskMutation('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBe(false);
	});

	it('turns a queued checklist create into an edit of the item made meanwhile, in its place', () => {
		const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const otherTaskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const createdItem = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', text: 'New', done: false };
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({ type: 'checklist.create', taskId, localItemId: 'renamed', text: 'Renamed' });
		enqueueOfflineMutation({ type: 'checklist.create', taskId, localItemId: 'checked', text: 'New', done: true });
		enqueueOfflineMutation({ type: 'checklist.create', taskId, localItemId: 'unchanged', text: 'New' });
		enqueueOfflineMutation({ type: 'task.delete', taskId: otherTaskId });
		const queuedIds = loadOfflineQueue().map((mutation) => mutation.id);
		// The creates landed after user A signed out.
		setOfflineQueueOwner(null);

		for (const localItemId of ['renamed', 'checked', 'unchanged', 'missing']) {
			resolveQueuedChecklistCreate(taskId, localItemId, createdItem, { ownerId: 'user-a' });
		}

		expect(loadOfflineQueue()).toEqual([]);
		setOfflineQueueOwner('user-a');
		expect(loadOfflineQueue()).toEqual([
			expect.objectContaining({ id: queuedIds[0], type: 'checklist.patch', taskId, itemId: createdItem.id, patch: { text: 'Renamed' }, ownerUserId: 'user-a' }),
			expect.objectContaining({ id: queuedIds[1], type: 'checklist.patch', taskId, itemId: createdItem.id, patch: { done: true }, ownerUserId: 'user-a' }),
			expect.objectContaining({ id: queuedIds[3], type: 'task.delete', taskId: otherTaskId })
		]);
	});

	it('resolves child creates queued under local parents', async () => {
		const localParentId = 'local-parent';
		const localChildId = 'local-child';
		const serverParent = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Parent'
		});
		const serverChild = normalizeTask({
			id: '22222222-2222-4222-8222-222222222222',
			text: 'Child',
			parentId: serverParent.id
		});

		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: localParentId,
			payload: { text: 'Parent', parentId: null }
		});
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: localChildId,
			localParentId,
			payload: { text: 'Child', parentId: null }
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: serverParent }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: serverChild }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 2,
			remaining: 0,
			blocked: false
		});
		expect(fetcher).toHaveBeenNthCalledWith(2, '/api/tasks', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ text: 'Child', parentId: serverParent.id })
		}));
		expect(result.createdTasks).toEqual([
			{ localTaskId: localParentId, task: serverParent },
			{ localTaskId: localChildId, task: serverChild }
		]);
	});

	it('coalesces local task edits into pending creates before flushing', async () => {
		const localTaskId = 'local-task';
		const serverTask = normalizeTask({
			id: '44444444-4444-4444-8444-444444444444',
			text: 'Edited task',
			status: 'doing'
		});

		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId,
			payload: {
				text: 'Draft task',
				status: 'todo',
				parentId: null
			}
		});
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: localTaskId,
			patch: {
				text: 'Edited task',
				status: 'doing'
			}
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'task.create',
			payload: {
				text: 'Edited task',
				status: 'doing',
				parentId: null
			}
		});

		const fetcher = vi.fn(async () => new Response(JSON.stringify({ task: serverTask }), {
			status: 201,
			headers: { 'content-type': 'application/json' }
		}));

		await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			createdTasks: [{ localTaskId, task: serverTask }]
		});
		expect(fetcher).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({
				text: 'Edited task',
				status: 'doing',
				parentId: null
			})
		}));
	});

	it('replays queued offline imports when connectivity returns', async () => {
		const importedTask = normalizeTask({
			id: '77777777-7777-4777-8777-777777777777',
			text: 'Imported offline'
		});

		enqueueOfflineMutation({
			type: 'import.tasks',
			mode: 'append',
			payload: [{ text: 'Imported offline' }]
		});

		const fetcher = vi.fn(async () => new Response(JSON.stringify({
			tasks: [importedTask],
			summary: {
				receivedTasks: 1,
				importedTasks: 1,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0
			}
		}), {
			status: 201,
			headers: { 'content-type': 'application/json' }
		}));

		const result = await flushOfflineWriteQueue(fetcher);

		expect(result).toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			completedImports: [{
				mode: 'append',
				tasks: [importedTask],
				localTaskIds: []
			}]
		});
		expect(fetcher).toHaveBeenCalledWith('/api/import', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify([{ text: 'Imported offline' }])
		}));
	});

	it('treats replace imports as a new offline baseline', () => {
		enqueueOfflineMutation({
			type: 'task.patch',
			taskId: '88888888-8888-4888-8888-888888888888',
			patch: { text: 'Older edit' }
		});
		enqueueOfflineMutation({
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Replacement import' }]
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'import.tasks',
			mode: 'replace',
			payload: [{ text: 'Replacement import' }]
		});
	});

	it('coalesces checklist create edits and replays a final done state', async () => {
		const taskId = '55555555-5555-4555-8555-555555555555';
		const localItemId = 'local-checklist';
		const serverItemId = '66666666-6666-4666-8666-666666666666';
		const createdTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Renamed checklist', done: false }]
		});
		const updatedTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Renamed checklist', done: true }]
		});

		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId,
			text: 'First checklist'
		});
		enqueueOfflineMutation({
			type: 'checklist.patch',
			taskId,
			itemId: localItemId,
			patch: { text: 'Renamed checklist' }
		});
		enqueueOfflineMutation({
			type: 'checklist.patch',
			taskId,
			itemId: localItemId,
			patch: { done: true }
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			text: 'Renamed checklist',
			done: true
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: createdTask }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: updatedTask }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}));

		await expect(flushOfflineWriteQueue(fetcher)).resolves.toMatchObject({
			flushed: 1,
			remaining: 0,
			blocked: false,
			syncedTasks: [updatedTask]
		});
		expect(fetcher).toHaveBeenNthCalledWith(1, `/api/tasks/${taskId}/checklist`, expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ text: 'Renamed checklist' })
		}));
		expect(fetcher).toHaveBeenNthCalledWith(2, `/api/tasks/${taskId}/checklist/${serverItemId}`, expect.objectContaining({
			method: 'PATCH',
			body: JSON.stringify({ done: true })
		}));
	});

	it('keeps the checked state of an offline create whose follow-up patch was throttled', async () => {
		const taskId = '55555555-5555-4555-8555-555555555555';
		const serverItemId = '66666666-6666-4666-8666-666666666666';
		const createdTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Checked offline', done: false }]
		});

		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId: 'local-checklist',
			text: 'Checked offline',
			done: true
		});

		const fetcher = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ task: createdTask }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Too many task changes.' }), {
				status: 429,
				headers: { 'content-type': 'application/json', 'retry-after': '30' }
			}));

		const result = await flushOfflineWriteQueue(fetcher);

		// The item landed, but the checked state must stay queued for retry.
		expect(result).toMatchObject({ flushed: 1, remaining: 1, blocked: false });
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.patch',
			taskId,
			itemId: serverItemId,
			patch: { done: true }
		});
	});

	it('settles the queue it sent, and queues a follow-up there, when another owner takes the queue meanwhile', async () => {
		const taskId = '55555555-5555-4555-8555-555555555555';
		const serverItemId = '66666666-6666-4666-8666-666666666666';
		const createdTask = normalizeTask({
			id: taskId,
			text: 'Task',
			subtasks: [{ id: serverItemId, text: 'Checked offline', done: false }]
		});
		setOfflineQueueOwner('user-b');
		enqueueOfflineMutation({ type: 'task.delete', taskId: '77777777-7777-4777-8777-777777777777' });
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId: 'local-checklist',
			text: 'Checked offline',
			done: true
		});
		const createAnswer = createDeferred();
		const fetcher = vi.fn()
			.mockReturnValueOnce(createAnswer.promise)
			.mockResolvedValueOnce(jsonResponse({ message: 'Too many task changes.' }, { status: 429 }));

		const flushing = flushOfflineWriteQueue(fetcher);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// User A signs out and user B signs in while the create is out.
		setOfflineQueueOwner('user-b');
		createAnswer.resolve(jsonResponse({ task: createdTask }, { status: 201 }));
		await flushing;

		expect(JSON.parse(storage.get('kanbanOfflineWriteQueue:user-a') ?? '[]')).toEqual([
			expect.objectContaining({ type: 'checklist.patch', taskId, itemId: serverItemId, patch: { done: true }, ownerUserId: 'user-a' })
		]);
		expect(loadOfflineQueue()).toEqual([expect.objectContaining({ type: 'task.delete', ownerUserId: 'user-b' })]);
	});

	// A sign-out that clears local data empties the queue while a flush is
	// out. A checked create's follow-up patch, queued when its checked
	// state is throttled, then goes back into the cleared queue.
	it.fails('queues no follow-up in a queue that was cleared while the flush was out', async () => {
		const taskId = '55555555-5555-4555-8555-555555555555';
		const serverItemId = '66666666-6666-4666-8666-666666666666';
		setOfflineQueueOwner('user-a');
		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId: 'local-checklist',
			text: 'Checked offline',
			done: true
		});
		const createAnswer = createDeferred();
		const fetcher = vi.fn()
			.mockReturnValueOnce(createAnswer.promise)
			.mockResolvedValueOnce(jsonResponse({ message: 'Too many task changes.' }, { status: 429 }));

		const flushing = flushOfflineWriteQueue(fetcher);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// A sign-out that clears local data.
		clearOfflineWriteQueue();
		createAnswer.resolve(jsonResponse({
			task: { id: taskId, text: 'Task', subtasks: [{ id: serverItemId, text: 'Checked offline', done: false }] }
		}, { status: 201 }));
		await flushing;

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(storage.has('kanbanOfflineWriteQueue:user-a')).toBe(false);
	});

	it('drops a pending checklist create when the local item is deleted before sync', () => {
		const taskId = '77777777-7777-4777-8777-777777777777';
		const localItemId = 'local-checklist';

		enqueueOfflineMutation({
			type: 'checklist.create',
			taskId,
			localItemId,
			text: 'Temporary checklist'
		});
		enqueueOfflineMutation({
			type: 'checklist.delete',
			taskId,
			itemId: localItemId
		});

		expect(loadOfflineQueue()).toEqual([]);
	});

	it('ignores corrupted queue records from another owner', () => {
		setOfflineQueueOwner('user-a');
		storage.set('kanbanOfflineWriteQueue:user-a', JSON.stringify([{
			id: 'mutation-id',
			ownerUserId: 'user-b',
			type: 'task.delete',
			taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			createdAt: Date.now(),
			attempts: 0
		}]));

		expect(loadOfflineQueue()).toEqual([]);
	});
});
