import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { createDeferred, jsonResponse } from '$lib/test-support/http.js';
import { loadOfflineQueue, setOfflineQueueOwner } from '../offline-write-queue.js';
import { createTask, importTasks, moveTask } from './task-mutations.js';
import { applyServerTaskSnapshot } from './sync-engine.js';
import { replaceTasks, tasks } from './task-cache.js';
import { filters, resetFilters, setPriorityFilter } from './filters.js';

const SERVER_PARENT_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_TASK_ID = '22222222-2222-4222-8222-222222222222';
const CREATE_FAILED_MESSAGE = '작업을 추가하지 못했습니다. 입력값을 확인해 주세요.';

/**
 * The add-task form's values for a task called `text`.
 * @param {string} text
 * @param {string | null} [parentId]
 * @returns {import('./task-mutations.js').TaskFormValues}
 */
function formValues(text, parentId = null) {
	return {
		text: `  ${text}  `,
		priority: 'high',
		urgency: 'urgent',
		category: ' 개발 ',
		startDate: '2026-05-03',
		endDate: '2026-05-04',
		parentId
	};
}

/**
 * The server payload formValues(text) turns into.
 * @param {string} text
 * @param {{ status?: string; parentId?: string | null }} [overrides]
 */
function createPayload(text, { status = 'todo', parentId = null } = {}) {
	return {
		text,
		status,
		startDate: '2026-05-03',
		endDate: '2026-05-04',
		priority: 'high',
		urgency: 'urgent',
		category: '개발',
		parentId
	};
}

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

describe('creating a task from the add-task form', () => {
	/** @type {import('vitest').Mock} */
	let fetcher;

	beforeEach(() => {
		installMemoryStorage();
		fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		setOfflineQueueOwner(null);
		replaceTasks([
			{ id: SERVER_PARENT_ID, text: 'Server parent', status: 'doing' },
			{ id: 'local-parent', text: 'Local parent', status: 'todo' }
		]);
	});

	afterEach(() => {
		replaceTasks([]);
	});

	it('adds the task the server created', async () => {
		fetcher.mockResolvedValue(
			jsonResponse(
				{
					task: { id: SERVER_TASK_ID, text: 'Write report', status: 'todo', version: 1 }
				},
				{ status: 201 }
			)
		);

		const result = await createTask(formValues('Write report'));

		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST' }));
		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(createPayload('Write report'));
		expect(result).toEqual({ ok: true, task: expect.objectContaining({ id: SERVER_TASK_ID, version: 1 }) });
		expect(get(tasks).map((task) => task.id)).toEqual([SERVER_PARENT_ID, 'local-parent', SERVER_TASK_ID]);
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('sends a child of a server task with its parent id and lane', async () => {
		fetcher.mockResolvedValue(
			jsonResponse(
				{
					task: { id: SERVER_TASK_ID, text: 'Child', status: 'doing', parentId: SERVER_PARENT_ID }
				},
				{ status: 201 }
			)
		);

		await createTask(formValues('Child', SERVER_PARENT_ID));

		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(
			createPayload('Child', {
				status: 'doing',
				parentId: SERVER_PARENT_ID
			})
		);
		expect(get(tasks).find((task) => task.id === SERVER_TASK_ID)?.parentId).toBe(SERVER_PARENT_ID);
	});

	it('keeps the copy a sync added while the create was in flight instead of adding a second one', async () => {
		const response = createDeferred();
		fetcher.mockReturnValue(response.promise);

		const created = createTask(formValues('Write report'));
		// The server snapshot already lists the new task, edited on another
		// device since.
		applyServerTaskSnapshot([
			{ id: SERVER_PARENT_ID, text: 'Server parent', status: 'doing', version: 1 },
			{ id: SERVER_TASK_ID, text: 'Write report (edited)', status: 'todo', version: 2 }
		]);
		response.resolve(
			jsonResponse(
				{
					task: { id: SERVER_TASK_ID, text: 'Write report', status: 'todo', version: 1 }
				},
				{ status: 201 }
			)
		);
		const result = await created;

		expect(result.ok).toBe(true);
		expect(get(tasks).map((task) => task.id)).toEqual(['local-parent', SERVER_PARENT_ID, SERVER_TASK_ID]);
		expect(get(tasks)[2]).toMatchObject({ text: 'Write report (edited)', version: 2 });
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('adds nothing and reports the form message when the server refuses the task', async () => {
		fetcher.mockResolvedValue(jsonResponse({ message: 'Task title is required.' }, { status: 400 }));

		const result = await createTask(formValues('Refused'));

		expect(result).toEqual({ ok: false, message: CREATE_FAILED_MESSAGE });
		expect(get(tasks).map((task) => task.id)).toEqual([SERVER_PARENT_ID, 'local-parent']);
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('adds the task on this device and queues its create when the server is unavailable', async () => {
		fetcher.mockResolvedValue(jsonResponse({ message: 'Database unavailable.' }, { status: 503 }));

		const result = await createTask(formValues('Offline task'));

		expect(result.ok).toBe(true);
		const localTask = get(tasks)[2];
		expect(localTask).toMatchObject({ text: 'Offline task', status: 'todo', category: '개발', parentId: null });
		expect(result).toEqual({ ok: true, task: localTask });
		expect(loadOfflineQueue()).toEqual([
			{
				id: expect.any(String),
				type: 'task.create',
				localTaskId: localTask.id,
				localParentId: null,
				payload: createPayload('Offline task'),
				ownerUserId: 'anonymous',
				createdAt: expect.any(Number),
				attempts: 0
			}
		]);
	});

	it('makes a child of a local task on this device without asking the server', async () => {
		const result = await createTask(formValues('Local child', 'local-parent'));

		expect(fetcher).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		const localChild = get(tasks)[2];
		expect(localChild).toMatchObject({ text: 'Local child', status: 'todo', parentId: 'local-parent' });
		expect(loadOfflineQueue()).toEqual([
			expect.objectContaining({
				type: 'task.create',
				localTaskId: localChild.id,
				localParentId: 'local-parent',
				payload: createPayload('Local child')
			})
		]);
	});

	it('adds nothing for a blank title', async () => {
		const result = await createTask(formValues('   '));

		expect(result).toEqual({ ok: false, message: CREATE_FAILED_MESSAGE });
		expect(fetcher).not.toHaveBeenCalled();
		expect(get(tasks)).toHaveLength(2);
		expect(loadOfflineQueue()).toEqual([]);
	});
});

describe('importing backup tasks', () => {
	const FILE_TASKS = [{ id: 'file-task', text: 'File task', status: 'doing' }];
	const IMPORTED_TASK = { id: SERVER_TASK_ID, text: 'Imported task', status: 'todo' };

	/** @type {import('vitest').Mock} */
	let fetcher;

	beforeEach(() => {
		installMemoryStorage();
		fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		setOfflineQueueOwner(null);
		replaceTasks([{ id: 'existing-task', text: 'Existing task', status: 'todo' }]);
		setPriorityFilter('high');
	});

	afterEach(() => {
		replaceTasks([]);
		resetFilters();
	});

	/**
	 * @param {Partial<import('../task-api.js').TaskImportSummary>} [summary]
	 */
	function importedResponse(summary = {}) {
		return jsonResponse({
			tasks: [IMPORTED_TASK],
			summary: {
				receivedTasks: 1,
				importedTasks: 1,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0,
				...summary
			}
		});
	}

	it('replaces the board with the tasks the server imported', async () => {
		fetcher.mockResolvedValue(importedResponse({ replacedTasks: 1 }));

		const result = await importTasks(FILE_TASKS, 'replace');

		expect(fetcher).toHaveBeenCalledWith('/api/import?mode=replace', expect.objectContaining({ method: 'POST' }));
		expect(result).toEqual({
			ok: true,
			queued: false,
			summary: expect.objectContaining({ importedTasks: 1, replacedTasks: 1 })
		});
		expect(get(tasks).map((task) => task.id)).toEqual([SERVER_TASK_ID]);
		expect(get(filters).priority).toBe('all');
		expect(loadOfflineQueue()).toEqual([]);
	});

	it('appends the tasks the server imported', async () => {
		fetcher.mockResolvedValue(importedResponse());

		const result = await importTasks(FILE_TASKS, 'append');

		expect(fetcher).toHaveBeenCalledWith('/api/import', expect.objectContaining({ method: 'POST' }));
		expect(result.ok).toBe(true);
		expect(get(tasks).map((task) => task.id)).toEqual(['existing-task', SERVER_TASK_ID]);
		expect(get(filters).priority).toBe('all');
	});

	it.each([
		{ mode: /** @type {const} */ ('replace'), ids: ['file-task'] },
		{ mode: /** @type {const} */ ('append'), ids: ['existing-task', 'file-task'] }
	])(
		'imports the file on this device and queues a $mode import when the server is unavailable',
		async ({ mode, ids }) => {
			fetcher.mockResolvedValue(jsonResponse({ message: 'Database unavailable.' }, { status: 503 }));

			const result = await importTasks(FILE_TASKS, mode);

			expect(result).toEqual({ ok: true, queued: true });
			expect(get(tasks).map((task) => task.id)).toEqual(ids);
			expect(get(filters).priority).toBe('all');
			expect(loadOfflineQueue()).toEqual([
				expect.objectContaining({
					type: 'import.tasks',
					mode,
					payload: FILE_TASKS,
					localTaskIds: ['file-task']
				})
			]);
		}
	);

	it('leaves the board and the filters alone when the server refuses the import', async () => {
		fetcher.mockResolvedValue(jsonResponse({ message: 'Too many tasks.' }, { status: 400 }));

		const result = await importTasks(FILE_TASKS, 'replace');

		expect(result).toEqual({ ok: false, message: 'Too many tasks.' });
		expect(get(tasks).map((task) => task.id)).toEqual(['existing-task']);
		expect(get(filters).priority).toBe('high');
		expect(loadOfflineQueue()).toEqual([]);
	});
});
