import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import { deleteCategoryForUser, mergeCategoryForUser, updateCategoryForUser } from './repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { drizzle } = await import('drizzle-orm/neon-http');
	const { neon } = await import('@neondatabase/serverless');
	const schema = await import('./../db/schema.js');
	// neon-http performs no I/O until a query executes, so statements can be
	// built and rendered against a fake URL.
	const db = drizzle(neon('postgresql://user:pass@categories-test.invalid/db'), { schema });
	return { getDb: () => db, schema };
});

vi.mock('$lib/server/tasks/repository.js', () => ({
	ensurePersonalBoardForUser: async () => ({ id: '22222222-2222-4222-8222-222222222222' })
}));

const USER_ID = 'user-id';
const BOARD_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_IDS = ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'];
const NOW = new Date('2026-07-06T12:00:00.000Z');
// toSQL() hands timestamp parameters over as ISO strings.
const STAMP = NOW.toISOString();
const CATEGORY_COLUMNS = '"id", "board_id", "user_id", "name", "normalized_name", "color", "sort_order", "hidden_at", "archived_at", "created_at", "updated_at"';

/**
 * @param {Record<string, unknown>} [overrides]
 */
function createCategoryRow(overrides = {}) {
	return {
		id: CATEGORY_ID,
		boardId: BOARD_ID,
		userId: USER_ID,
		name: '공부',
		normalizedName: '공부',
		color: '#58a6ff',
		sortOrder: 0,
		hiddenAt: null,
		archivedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

/**
 * Queues canned rows for the category lookups the writes run first.
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
			limit: () => chain,
			then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve(rows)
		};
		return chain;
	});
}

/**
 * @param {import('vitest').Mock} batchMock
 * @returns {{ sql: string; params: unknown[] }[]}
 */
function renderBatch(batchMock) {
	expect(batchMock).toHaveBeenCalledTimes(1);
	return batchMock.mock.calls[0][0].map((/** @type {{ toSQL: () => { sql: string; params: unknown[] } }} */ statement) => statement.toSQL());
}

describe('category writes that rewrite tasks', () => {
	/** @type {any} */
	let db;
	/** @type {import('vitest').Mock} */
	let batchMock;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		db = getDb();
		batchMock = vi.fn();
		db.batch = batchMock;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renames a category and the name on its tasks in one batch, bumping each task version', async () => {
		stubSelects(db, [[createCategoryRow()]]);
		const renamed = createCategoryRow({ name: '학습', normalizedName: '학습' });
		batchMock.mockResolvedValue([[renamed], TASK_IDS.map((id) => ({ id }))]);

		const result = await updateCategoryForUser(USER_ID, CATEGORY_ID, { name: ' 학습 ' });

		const [categoryUpdate, taskUpdate] = renderBatch(batchMock);
		expect(categoryUpdate).toEqual({
			sql: `update "categories" set "name" = $1, "normalized_name" = $2, "color" = $3, "hidden_at" = $4, "archived_at" = $5, "updated_at" = $6 where ("categories"."id" = $7 and "categories"."board_id" = $8) returning ${CATEGORY_COLUMNS}`,
			params: ['학습', '학습', '#58a6ff', null, null, STAMP, CATEGORY_ID, BOARD_ID]
		});
		expect(taskUpdate).toEqual({
			sql: 'update "tasks" set "category" = $1, "version" = "tasks"."version" + 1, "updated_at" = $2 where ("tasks"."board_id" = $3 and "tasks"."category_id" = $4 and "tasks"."deleted_at" is null) returning "id"',
			params: ['학습', STAMP, BOARD_ID, CATEGORY_ID]
		});
		expect(result).toEqual({
			category: { id: CATEGORY_ID, name: '학습', color: '#58a6ff', sortOrder: 0, hiddenAt: null, archivedAt: null },
			updatedTasks: 2
		});
	});

	it('leaves the tasks alone when only the colour or visibility changes', async () => {
		stubSelects(db, [[createCategoryRow()]]);
		batchMock.mockResolvedValue([[createCategoryRow({ color: '#ff0000' })]]);

		const result = await updateCategoryForUser(USER_ID, CATEGORY_ID, { color: '#FF0000' });

		const statements = renderBatch(batchMock);
		expect(statements).toHaveLength(1);
		expect(statements[0].sql).toMatch(/^update "categories" set/);
		expect(result).toMatchObject({ category: { color: '#ff0000' }, updatedTasks: 0 });
	});

	it('reports an unknown category as 404 and a taken name as 409', async () => {
		stubSelects(db, [[]]);
		await expect(updateCategoryForUser(USER_ID, CATEGORY_ID, { name: '학습' }))
			.rejects.toMatchObject({ status: 404 });
		expect(batchMock).not.toHaveBeenCalled();

		stubSelects(db, [[createCategoryRow()]]);
		batchMock.mockRejectedValue(new Error('duplicate key value violates unique constraint "categories_board_normalized_name_uidx"'));
		await expect(updateCategoryForUser(USER_ID, CATEGORY_ID, { name: '학습' }))
			.rejects.toMatchObject({ status: 409, message: 'A category with that name already exists.' });
	});

	it('merges by moving the tasks to the target, bumping each version, then archiving the source', async () => {
		const target = createCategoryRow({ id: TARGET_ID, name: '학습', normalizedName: '학습', color: null, sortOrder: 1 });
		stubSelects(db, [[createCategoryRow()], [target]]);
		const archived = createCategoryRow({ hiddenAt: NOW, archivedAt: NOW });
		batchMock.mockResolvedValue([TASK_IDS.map((id) => ({ id })), [archived]]);

		const result = await mergeCategoryForUser(USER_ID, CATEGORY_ID, { targetCategoryId: TARGET_ID });

		const [taskUpdate, categoryUpdate] = renderBatch(batchMock);
		expect(taskUpdate).toEqual({
			sql: 'update "tasks" set "category" = $1, "category_id" = $2, "version" = "tasks"."version" + 1, "updated_at" = $3 where ("tasks"."board_id" = $4 and "tasks"."category_id" = $5 and "tasks"."deleted_at" is null) returning "id"',
			params: ['학습', TARGET_ID, STAMP, BOARD_ID, CATEGORY_ID]
		});
		expect(categoryUpdate).toEqual({
			sql: `update "categories" set "hidden_at" = $1, "archived_at" = $2, "updated_at" = $3 where ("categories"."id" = $4 and "categories"."board_id" = $5) returning ${CATEGORY_COLUMNS}`,
			params: [STAMP, STAMP, STAMP, CATEGORY_ID, BOARD_ID]
		});
		expect(result).toEqual({
			source: { id: CATEGORY_ID, name: '공부', color: '#58a6ff', sortOrder: 0, hiddenAt: NOW.toISOString(), archivedAt: NOW.toISOString() },
			target: { id: TARGET_ID, name: '학습', color: null, sortOrder: 1, hiddenAt: null, archivedAt: null },
			updatedTasks: 2
		});
	});

	it('deletes by clearing the category from its tasks, bumping each version, then archiving it', async () => {
		stubSelects(db, [[createCategoryRow()]]);
		const archived = createCategoryRow({ hiddenAt: NOW, archivedAt: NOW });
		batchMock.mockResolvedValue([TASK_IDS.map((id) => ({ id })), [archived]]);

		const result = await deleteCategoryForUser(USER_ID, CATEGORY_ID);

		const [taskUpdate, categoryUpdate] = renderBatch(batchMock);
		expect(taskUpdate).toEqual({
			sql: 'update "tasks" set "category" = $1, "category_id" = $2, "version" = "tasks"."version" + 1, "updated_at" = $3 where ("tasks"."board_id" = $4 and "tasks"."category_id" = $5 and "tasks"."deleted_at" is null) returning "id"',
			params: ['', null, STAMP, BOARD_ID, CATEGORY_ID]
		});
		expect(categoryUpdate.sql).toMatch(/^update "categories" set "hidden_at" = \$1, "archived_at" = \$2/);
		expect(result).toEqual({
			category: { id: CATEGORY_ID, name: '공부', color: '#58a6ff', sortOrder: 0, hiddenAt: NOW.toISOString(), archivedAt: NOW.toISOString() },
			clearedTasks: 2
		});
	});
});
