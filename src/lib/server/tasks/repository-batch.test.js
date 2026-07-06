import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import { deleteChecklistItemForUser, updateChecklistItemForUser } from './repository.js';

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
const NOW = new Date('2026-07-06T12:00:00.000Z');

function createTaskRow(version = 3) {
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
		deletedAt: null
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

function authSelects() {
	return [
		[{ workspaceId: 'workspace-id' }],
		[{ id: BOARD_ID }],
		[createTaskRow()]
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
});
