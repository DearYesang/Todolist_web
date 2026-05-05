import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTask } from '../shared/task-domain.js';
import {
	addSubtask,
	currentView,
	deleteSubtask,
	mergeTasks,
	replaceTasks,
	renameSubtask,
	setCurrentView,
	tasks,
	toggleSubtask,
	updateTask
} from './task-store.js';
import {
	enqueueOfflineMutation,
	loadOfflineQueue,
	setOfflineQueueOwner
} from './offline-write-queue.js';
import { syncServerTasks } from './task-sync.js';

describe('client task sync', () => {
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
		replaceTasks([]);
		setCurrentView('kanban');
		setOfflineQueueOwner(null);
	});

	afterEach(() => {
		replaceTasks([]);
		setCurrentView('kanban');
		setOfflineQueueOwner(null);
		Reflect.deleteProperty(globalThis, 'fetch');
		Reflect.deleteProperty(globalThis, 'localStorage');
		Reflect.deleteProperty(globalThis, 'window');
	});

	it('applies the server board default view during task sync', async () => {
		const task = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Synced task'
		});
		const fetcher = vi.fn(async (url) => new Response(JSON.stringify(
			url === '/api/board/preferences'
				? { defaultView: 'matrix' }
				: { tasks: [task] }
		), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		}));

		setCurrentView('kanban');
		await syncServerTasks(fetcher);

		expect(get(currentView)).toBe('matrix');
		expect(fetcher).toHaveBeenCalledWith('/api/board/preferences', expect.objectContaining({
			headers: { accept: 'application/json' }
		}));
	});

	it('applies server UUID tasks as an authoritative snapshot while preserving pending local tasks', async () => {
		const currentServerTask = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Old server value',
			collapsed: true
		});
		const staleServerTask = normalizeTask({
			id: '22222222-2222-4222-8222-222222222222',
			text: 'Deleted on server'
		});
		const pendingLocalTask = normalizeTask({
			id: 'local-pending',
			text: 'Pending local'
		});
		const serverSnapshotTask = normalizeTask({
			id: currentServerTask.id,
			text: 'Fresh server value',
			status: 'doing'
		});
		const newServerTask = normalizeTask({
			id: '33333333-3333-4333-8333-333333333333',
			text: 'New server task'
		});
		const fetcher = vi.fn(async () => new Response(JSON.stringify({
			tasks: [serverSnapshotTask, newServerTask]
		}), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		}));

		replaceTasks([currentServerTask, staleServerTask, pendingLocalTask]);
		await syncServerTasks(fetcher);

		expect(get(tasks).map((task) => ({
			id: task.id,
			text: task.text,
			status: task.status,
			collapsed: task.collapsed
		}))).toEqual([
			expect.objectContaining({
				id: 'local-pending',
				text: 'Pending local'
			}),
			{
				id: currentServerTask.id,
				text: 'Fresh server value',
				status: 'doing',
				collapsed: true
			},
			expect.objectContaining({
				id: newServerTask.id,
				text: 'New server task'
			})
		]);
		expect(get(tasks).some((task) => task.id === staleServerTask.id)).toBe(false);
	});

	it('coalesces local pending task edits into the queued create payload', () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {}
		});
		const localTask = normalizeTask({
			id: 'local-task',
			text: 'Draft task',
			status: 'todo'
		});

		replaceTasks([localTask]);
		enqueueOfflineMutation({
			type: 'task.create',
			localTaskId: localTask.id,
			payload: {
				text: 'Draft task',
				status: 'todo',
				parentId: null
			}
		});

		updateTask(localTask.id, {
			text: 'Edited task',
			status: 'doing',
			category: 'Client'
		});

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'task.create',
			localTaskId: localTask.id,
			payload: {
				text: 'Edited task',
				status: 'doing',
				category: 'Client',
				parentId: null
			}
		});
	});

	it('preserves a child task parent link when merging a partial server response', () => {
		const parent = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Parent task',
			status: 'todo'
		});
		const child = normalizeTask({
			id: '22222222-2222-4222-8222-222222222222',
			text: 'Child task',
			status: 'todo',
			parentId: parent.id
		});
		const checklistSyncedChild = normalizeTask({
			...child,
			subtasks: [{ id: '33333333-3333-4333-8333-333333333333', text: 'Checklist item', done: false }],
			version: 2
		});

		replaceTasks([parent, child]);
		mergeTasks([checklistSyncedChild]);

		const mergedChild = get(tasks).find((task) => task.id === child.id);
		expect(mergedChild).toMatchObject({
			id: child.id,
			parentId: parent.id,
			subtasks: [{ id: '33333333-3333-4333-8333-333333333333', text: 'Checklist item', done: false }],
			version: 2
		});
	});

	it('coalesces pending checklist create edits and deletes through the task store', async () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {}
		});
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: vi.fn(async () => {
				throw new Error('offline');
			})
		});
		const task = normalizeTask({
			id: '44444444-4444-4444-8444-444444444444',
			text: 'Server task'
		});

		replaceTasks([task]);
		addSubtask(task.id, 'First checklist');
		await new Promise((resolve) => setTimeout(resolve, 0));

		const localItemId = get(tasks)[0]?.subtasks[0]?.id;
		expect(localItemId).toBeTruthy();
		if (!localItemId) {
			throw new Error('Expected a local checklist item.');
		}
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			taskId: task.id,
			localItemId,
			text: 'First checklist'
		});

		renameSubtask(task.id, localItemId, 'Renamed checklist');
		toggleSubtask(task.id, localItemId);

		expect(loadOfflineQueue()).toHaveLength(1);
		expect(loadOfflineQueue()[0]).toMatchObject({
			type: 'checklist.create',
			taskId: task.id,
			localItemId,
			text: 'Renamed checklist',
			done: true
		});

		deleteSubtask(task.id, localItemId);
		expect(loadOfflineQueue()).toEqual([]);
	});
});
