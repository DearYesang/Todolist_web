import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import {
	createChecklistItemForUser,
	createTaskForUser,
	deleteChecklistItemForUser,
	updateChecklistItemForUser,
	updateTaskForUser
} from './repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { drizzle } = await import('drizzle-orm/neon-http');
	const { neon } = await import('@neondatabase/serverless');
	const schema = await import('./../db/schema.js');
	// neon-http performs no I/O until a query executes, so statements can be
	// built and rendered against a fake URL.
	const db = drizzle(neon('postgresql://user:pass@batch-test.invalid/db'), { schema });
	return { getDb: () => db, schema };
});

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const BOARD_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-07-06T12:00:00.000Z');
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: 'user-id' };
const BOARD = { id: BOARD_ID, workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'kanban' };
const ITEM_ROW = { id: ITEM_ID, taskId: TASK_ID, text: 'Item', done: true, position: '1.000', createdAt: NOW, updatedAt: NOW };
const CATEGORY_META = { id: CATEGORY_ID, name: '개발', color: '#ff0000', sortOrder: 0, hiddenAt: null, archivedAt: null };

/**
 * @param {number} [version]
 * @param {Record<string, unknown>} [overrides]
 */
function createTaskRow(version = 3, overrides = {}) {
	return {
		id: TASK_ID,
		boardId: BOARD_ID,
		parentTaskId: null,
		title: 'Task',
		status: 'todo',
		priority: 'medium',
		urgency: 'normal',
		category: '',
		categoryId: null,
		startDate: '2026-07-01',
		endDate: '2026-07-02',
		position: '1.000',
		version,
		createdBy: 'user-id',
		createdAt: NOW,
		updatedAt: NOW,
		completedAt: null,
		deletedAt: null,
		...overrides
	};
}

function createCategoryRow() {
	return {
		...CATEGORY_META,
		boardId: BOARD_ID,
		userId: 'user-id',
		normalizedName: '개발',
		createdAt: NOW,
		updatedAt: NOW
	};
}

/**
 * Queues canned results for the select chains repository helpers run
 * (memberships, boards, task lookup, checklist re-read).
 * @param {any} db
 * @param {unknown[][]} results
 */
function stubSelects(db, results) {
	const queue = [...results];
	vi.spyOn(db, 'select').mockImplementation(() => {
		const rows = queue.shift() ?? [];
		/** @type {any} */
		const chain = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			leftJoin: () => chain,
			limit: () => chain,
			then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve(rows)
		};
		return chain;
	});
}

/**
 * Stands in for the insert and update statements a write awaits on its own
 * (board provisioning, task create and update): one on the tasks table
 * returns taskRow, any other returns no rows. Statements handed to db.batch
 * are never awaited on their own, so the db.batch mock decides their rows.
 * @param {any} db
 * @param {Record<string, unknown>} taskRow
 */
function stubWrites(db, taskRow) {
	for (const kind of ['insert', 'update']) {
		vi.spyOn(db, kind).mockImplementation((/** @type {any} */ table) => {
			const rows = getTableName(table) === 'tasks' ? [taskRow] : [];
			/** @type {any} */
			const chain = {
				values: () => chain,
				set: () => chain,
				where: () => chain,
				onConflictDoNothing: () => chain,
				returning: () => chain,
				then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve(rows)
			};
			return chain;
		});
	}
}

function authSelects(taskRow = createTaskRow()) {
	return [
		[{ workspaceId: 'workspace-id' }],
		[{ id: BOARD_ID }],
		[taskRow]
	];
}

describe('checklist batch transactions', () => {
	/** @type {any} */
	let db;
	/** @type {import('vitest').Mock} */
	let batchMock;

	beforeEach(() => {
		vi.restoreAllMocks();
		db = getDb();
		batchMock = vi.fn();
		db.batch = batchMock;
	});

	it('runs the gated version bump before the item update in one batch', async () => {
		stubSelects(db, [...authSelects(), []]);
		batchMock.mockResolvedValue([
			[createTaskRow(4)],
			[{ id: ITEM_ID, taskId: TASK_ID, text: 'Item', done: true }]
		]);

		const task = await updateChecklistItemForUser('user-id', TASK_ID, ITEM_ID, { done: true });

		expect(batchMock).toHaveBeenCalledTimes(1);
		const statements = batchMock.mock.calls[0][0];
		expect(statements).toHaveLength(2);
		// The bump must run first, gated on the item existing, so a missing
		// item cannot spuriously advance the version.
		const bumpSql = statements[0].toSQL();
		expect(bumpSql.sql).toMatch(/^update "tasks" set/);
		expect(bumpSql.sql).toMatch(/exists \(\s*select 1 from "checklist_items"/);
		expect(statements[1].toSQL().sql).toMatch(/^update "checklist_items" set/);
		// The response must reflect the bumped row, not the stale pre-read.
		expect(task.version).toBe(4);
	});

	it('returns 404 from the item statement result, not the bump result', async () => {
		stubSelects(db, authSelects());
		batchMock.mockResolvedValue([[], []]);

		await expect(updateChecklistItemForUser('user-id', TASK_ID, ITEM_ID, { done: true }))
			.rejects.toMatchObject({ status: 404, message: 'Checklist item was not found.' });
	});

	it('deletes with the same bump-first gated ordering', async () => {
		stubSelects(db, [...authSelects(), []]);
		batchMock.mockResolvedValue([
			[createTaskRow(4)],
			[{ id: ITEM_ID }]
		]);

		const task = await deleteChecklistItemForUser('user-id', TASK_ID, ITEM_ID);

		const statements = batchMock.mock.calls[0][0];
		const bumpSql = statements[0].toSQL();
		expect(bumpSql.sql).toMatch(/^update "tasks" set/);
		expect(bumpSql.sql).toMatch(/exists \(\s*select 1 from "checklist_items"/);
		expect(statements[1].toSQL().sql).toMatch(/^delete from "checklist_items"/);
		expect(task.version).toBe(4);
	});

	it('reports a missing item as 404 on delete as well', async () => {
		stubSelects(db, authSelects());
		batchMock.mockResolvedValue([[], []]);

		await expect(deleteChecklistItemForUser('user-id', TASK_ID, ITEM_ID))
			.rejects.toMatchObject({ status: 404 });
	});

	it.each([
		['create', () => createChecklistItemForUser('user-id', TASK_ID, { text: 'Item' }), [[ITEM_ROW], [createTaskRow(4, { category: '개발', categoryId: CATEGORY_ID })]]],
		['update', () => updateChecklistItemForUser('user-id', TASK_ID, ITEM_ID, { done: true }), [[createTaskRow(4, { category: '개발', categoryId: CATEGORY_ID })], [ITEM_ROW]]],
		['delete', () => deleteChecklistItemForUser('user-id', TASK_ID, ITEM_ID), [[createTaskRow(4, { category: '개발', categoryId: CATEGORY_ID })], [{ id: ITEM_ID }]]]
	])('answers a checklist %s with the category of the task', async (_name, write, batchResult) => {
		// The client replaces its whole copy of the task with the response, so
		// a missing categoryMeta used to drop a custom category colour.
		const categorized = createTaskRow(3, { category: '개발', categoryId: CATEGORY_ID });
		stubSelects(db, [...authSelects(categorized), [ITEM_ROW], [createCategoryRow()]]);
		batchMock.mockResolvedValue(batchResult);

		const task = await write();

		expect(task).toMatchObject({
			category: '개발',
			categoryId: CATEGORY_ID,
			categoryMeta: CATEGORY_META,
			version: 4,
			subtasks: [{ id: ITEM_ID, text: 'Item', done: true }]
		});
	});
});

describe('task write responses', () => {
	/** @type {any} */
	let db;
	/** @type {import('vitest').Mock} */
	let batchMock;

	beforeEach(() => {
		vi.restoreAllMocks();
		db = getDb();
		batchMock = vi.fn();
		db.batch = batchMock;
	});

	it('answer with the same client task from every write that returns one', async () => {
		const taskRow = createTaskRow(4, { category: '개발', categoryId: CATEGORY_ID });
		const categoryRow = createCategoryRow();
		const reload = [[], [categoryRow]];
		stubSelects(db, [
			// createTaskForUser: the personal workspace and board, then the category.
			[WORKSPACE],
			[BOARD],
			[categoryRow],
			// Every other write: the authorization read, then the task reload.
			...authSelects(taskRow),
			...reload,
			...authSelects(taskRow),
			...reload,
			...authSelects(taskRow),
			...reload,
			...authSelects(taskRow),
			...reload
		]);
		stubWrites(db, taskRow);
		batchMock
			.mockResolvedValueOnce([[ITEM_ROW], [taskRow]])
			.mockResolvedValueOnce([[taskRow], [ITEM_ROW]])
			.mockResolvedValueOnce([[taskRow], [{ id: ITEM_ID }]]);

		const responses = {
			createTask: await createTaskForUser('user-id', { text: 'Task', categoryId: CATEGORY_ID, startDate: '2026-07-01', endDate: '2026-07-02' }),
			updateTask: await updateTaskForUser('user-id', TASK_ID, { text: 'Task', expectedVersion: 3 }),
			createChecklistItem: await createChecklistItemForUser('user-id', TASK_ID, { text: 'Item' }),
			updateChecklistItem: await updateChecklistItemForUser('user-id', TASK_ID, ITEM_ID, { done: true }),
			deleteChecklistItem: await deleteChecklistItemForUser('user-id', TASK_ID, ITEM_ID)
		};

		expect(responses.createTask.categoryMeta).toEqual(CATEGORY_META);
		for (const [write, task] of Object.entries(responses)) {
			expect(Object.keys(task).sort(), write).toEqual(Object.keys(responses.createTask).sort());
			expect(task, write).toEqual(responses.createTask);
		}
	});
});
