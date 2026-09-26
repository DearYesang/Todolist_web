import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import { createTaskForUser, updateTaskForUser } from './repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { drizzle } = await import('drizzle-orm/neon-http');
	const { neon } = await import('@neondatabase/serverless');
	const schema = await import('./../db/schema.js');
	// neon-http performs no I/O until a query executes, so statements can be
	// built against a fake URL.
	const db = drizzle(neon('postgresql://user:pass@tasks-test.invalid/db'), { schema });
	return { getDb: () => db, schema };
});

const USER_ID = 'user-id';
const NOW = new Date('2026-07-06T12:00:00.000Z');
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const BOARD_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_PARENT_ID = '55555555-5555-4555-8555-555555555555';
const CATEGORY_ID = '66666666-6666-4666-8666-666666666666';
const NEW_CATEGORY_ID = '77777777-7777-4777-8777-777777777777';
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: USER_ID };
const BOARD = { id: BOARD_ID, workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'kanban' };

/**
 * @param {Record<string, unknown>} [overrides]
 */
function createTaskRow(overrides = {}) {
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
		version: 3,
		createdBy: USER_ID,
		createdAt: NOW,
		updatedAt: NOW,
		completedAt: null,
		deletedAt: null,
		...overrides
	};
}

/**
 * Replaces db.select/insert/update with builder chains that record the table,
 * the rendered where clause, the inserted or set values and the other builder
 * steps of each statement. Each statement resolves to the next queued rows.
 * @param {any} db
 * @param {unknown[][]} results
 */
function recordStatements(db, results) {
	const queue = [...results];
	/** @type {Record<string, any>[]} */
	const statements = [];

	/**
	 * @param {string} kind
	 * @param {any} table
	 */
	function createChain(kind, table) {
		/** @type {Record<string, any> & { steps: string[] }} */
		const statement = { kind, table: table ? getTableName(table) : null, steps: [] };
		statements.push(statement);
		const rows = queue.shift() ?? [];
		/** @param {string} name */
		const step = (name) => () => {
			statement.steps.push(name);
			return chain;
		};
		/** @type {any} */
		const chain = {
			from: (/** @type {any} */ source) => {
				statement.table = getTableName(source);
				return chain;
			},
			where: (/** @type {import('drizzle-orm').SQL} */ condition) => {
				const { sql: text, params } = new PgDialect().sqlToQuery(condition);
				statement.where = { text, params };
				return chain;
			},
			values: (/** @type {unknown} */ values) => {
				statement.values = values;
				return chain;
			},
			set: (/** @type {unknown} */ values) => {
				statement.set = values;
				return chain;
			},
			leftJoin: step('leftJoin'),
			orderBy: step('orderBy'),
			limit: step('limit'),
			onConflictDoNothing: step('onConflictDoNothing'),
			returning: step('returning'),
			then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve(rows)
		};
		return chain;
	}

	vi.spyOn(db, 'select').mockImplementation(() => createChain('select', null));
	vi.spyOn(db, 'insert').mockImplementation((table) => createChain('insert', table));
	vi.spyOn(db, 'update').mockImplementation((table) => createChain('update', table));
	return statements;
}

/**
 * @param {Record<string, any>[]} statements
 */
function describeStatements(statements) {
	return statements.map((statement) => `${statement.kind} ${statement.table}`);
}

const PROVISIONING = [[WORKSPACE], [], [BOARD]];
const PROVISIONING_STATEMENTS = ['select workspaces', 'insert workspace_members', 'select boards'];
const AUTHORIZATION = [[{ workspaceId: WORKSPACE.id }], [{ id: BOARD_ID }]];
const AUTHORIZATION_STATEMENTS = ['select workspace_members', 'select boards', 'select tasks'];

describe('task creation', () => {
	/** @type {any} */
	let db;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		db = getDb();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('inserts a top-level task on the personal board', async () => {
		const statements = recordStatements(db, [...PROVISIONING, [createTaskRow({ title: 'New', version: 1 })]]);

		const task = await createTaskForUser(USER_ID, { text: 'New', startDate: '2026-07-06', endDate: '2026-07-07' });

		expect(describeStatements(statements)).toEqual([...PROVISIONING_STATEMENTS, 'insert tasks']);
		expect(statements[3]).toEqual({
			kind: 'insert',
			table: 'tasks',
			steps: ['returning'],
			values: {
				boardId: BOARD_ID,
				parentTaskId: null,
				title: 'New',
				status: 'todo',
				priority: 'medium',
				urgency: 'normal',
				category: '',
				categoryId: null,
				startDate: '2026-07-06',
				endDate: '2026-07-07',
				position: '1783339200.000',
				version: 1,
				createdBy: USER_ID,
				createdAt: NOW,
				updatedAt: NOW,
				completedAt: null,
				deletedAt: null
			}
		});
		expect(task).toMatchObject({ id: TASK_ID, text: 'New', version: 1, subtasks: [] });
	});

	it('puts a subtask in the lane of its parent', async () => {
		const parent = createTaskRow({ id: PARENT_ID, status: 'done' });
		const statements = recordStatements(db, [...PROVISIONING, [parent], [createTaskRow()]]);

		await createTaskForUser(USER_ID, { text: 'Child', status: 'todo', parentId: PARENT_ID, startDate: '2026-07-06', endDate: '2026-07-07' });

		expect(describeStatements(statements)).toEqual([...PROVISIONING_STATEMENTS, 'select tasks', 'insert tasks']);
		expect(statements[3]).toMatchObject({
			steps: ['orderBy', 'limit'],
			where: {
				text: '("tasks"."id" = $1 and "tasks"."board_id" = $2 and "tasks"."deleted_at" is null)',
				params: [PARENT_ID, BOARD_ID]
			}
		});
		expect(statements[4].values).toMatchObject({ parentTaskId: PARENT_ID, status: 'done', completedAt: NOW });
	});

	it('rejects a parent that is not on the board', async () => {
		const statements = recordStatements(db, [...PROVISIONING, []]);

		await expect(createTaskForUser(USER_ID, { text: 'Child', parentId: PARENT_ID, startDate: '2026-07-06', endDate: '2026-07-07' }))
			.rejects.toMatchObject({ status: 400, message: 'Parent task was not found on this board.' });
		expect(describeStatements(statements)).toEqual([...PROVISIONING_STATEMENTS, 'select tasks']);
	});
});

describe('task updates', () => {
	/** @type {any} */
	let db;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		db = getDb();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('writes only the named fields, guarded by the expected version', async () => {
		const existing = createTaskRow();
		const statements = recordStatements(db, [...AUTHORIZATION, [existing], [createTaskRow({ title: 'Renamed', version: 4 })], []]);

		const task = await updateTaskForUser(USER_ID, TASK_ID, { text: 'Renamed', expectedVersion: 3 });

		expect(describeStatements(statements)).toEqual([...AUTHORIZATION_STATEMENTS, 'update tasks', 'select checklist_items']);
		expect(statements[2].where.params).toEqual([TASK_ID, BOARD_ID]);
		expect(Object.keys(statements[3].set)).toEqual(['updatedAt', 'version', 'title']);
		expect(statements[3].set).toMatchObject({ updatedAt: NOW, title: 'Renamed' });
		expect(statements[3].where).toEqual({
			text: '("tasks"."id" = $1 and "tasks"."board_id" = $2 and "tasks"."deleted_at" is null and "tasks"."version" = $3)',
			params: [TASK_ID, BOARD_ID, 3]
		});
		expect(statements[4].where.params).toEqual([TASK_ID]);
		expect(task).toMatchObject({ text: 'Renamed', version: 4 });
	});

	it('keeps a subtask in the lane of its parent when only its status changes', async () => {
		const existing = createTaskRow({ parentTaskId: PARENT_ID, status: 'todo' });
		const parent = createTaskRow({ id: PARENT_ID, status: 'todo' });
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[existing],
			[parent],
			[{ id: PARENT_ID, parentTaskId: null }, { id: TASK_ID, parentTaskId: PARENT_ID }],
			[existing],
			[]
		]);

		await updateTaskForUser(USER_ID, TASK_ID, { status: 'doing' });

		expect(describeStatements(statements)).toEqual([
			...AUTHORIZATION_STATEMENTS,
			'select tasks',
			'select tasks',
			'update tasks',
			'select checklist_items'
		]);
		// The cycle check reads every live task on the board.
		expect(statements[4]).toMatchObject({
			steps: [],
			where: {
				text: '("tasks"."board_id" = $1 and "tasks"."deleted_at" is null)',
				params: [BOARD_ID]
			}
		});
		expect(statements[5].set).toMatchObject({ status: 'todo', completedAt: null });
		expect(statements[5].set).not.toHaveProperty('parentTaskId');
		expect(statements[5].where.params).toEqual([TASK_ID, BOARD_ID]);
	});

	it('moves a task under a new parent and into the lane of that parent', async () => {
		const existing = createTaskRow();
		const parent = createTaskRow({ id: OTHER_PARENT_ID, status: 'done' });
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[existing],
			[parent],
			[{ id: OTHER_PARENT_ID, parentTaskId: null }, { id: TASK_ID, parentTaskId: null }],
			[createTaskRow({ parentTaskId: OTHER_PARENT_ID, status: 'done', completedAt: NOW, version: 4 })],
			[]
		]);

		await updateTaskForUser(USER_ID, TASK_ID, { parentId: OTHER_PARENT_ID });

		expect(Object.keys(statements[5].set)).toEqual(['updatedAt', 'version', 'parentTaskId', 'status', 'completedAt']);
		expect(statements[5].set).toMatchObject({ parentTaskId: OTHER_PARENT_ID, status: 'done', completedAt: NOW });
	});

	it('rejects a parent that would make a cycle before writing anything', async () => {
		const existing = createTaskRow();
		const parent = createTaskRow({ id: OTHER_PARENT_ID, parentTaskId: TASK_ID });
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[existing],
			[parent],
			[{ id: OTHER_PARENT_ID, parentTaskId: TASK_ID }, { id: TASK_ID, parentTaskId: null }]
		]);

		await expect(updateTaskForUser(USER_ID, TASK_ID, { parentId: OTHER_PARENT_ID }))
			.rejects.toMatchObject({ status: 400, message: 'Parent task was not found on this board.' });
		expect(describeStatements(statements)).toEqual([...AUTHORIZATION_STATEMENTS, 'select tasks', 'select tasks']);
	});

	it('finds or creates the category by name when the patch names one without an id and asks for it', async () => {
		// The client sends its whole task with every patch. A category typed in
		// the task panel that the catalog does not hold yet has a name and a
		// null id, and must not be read as "no category".
		const existing = createTaskRow({ category: '개발', categoryId: CATEGORY_ID });
		const created = {
			id: NEW_CATEGORY_ID,
			boardId: BOARD_ID,
			userId: USER_ID,
			name: '신규 기획',
			normalizedName: '신규 기획',
			color: null,
			sortOrder: 2,
			hiddenAt: null,
			archivedAt: null,
			createdAt: NOW,
			updatedAt: NOW
		};
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[existing],
			[],
			[{ nextSortOrder: 2 }],
			[created],
			[createTaskRow({ category: '신규 기획', categoryId: NEW_CATEGORY_ID, version: 4 })],
			[],
			[created]
		]);

		const task = await updateTaskForUser(USER_ID, TASK_ID, {
			category: ' 신규  기획 ',
			categoryId: null,
			categoryByName: true,
			expectedVersion: 3
		});

		expect(describeStatements(statements)).toEqual([
			...AUTHORIZATION_STATEMENTS,
			'select categories',
			'select categories',
			'insert categories',
			'update tasks',
			'select checklist_items',
			'select categories'
		]);
		expect(statements[3].where.params).toEqual([BOARD_ID, '신규 기획']);
		expect(statements[5].values).toMatchObject({ name: '신규 기획', normalizedName: '신규 기획', sortOrder: 2 });
		expect(statements[6].set).toMatchObject({ category: '신규 기획', categoryId: NEW_CATEGORY_ID });
		expect(task).toMatchObject({ category: '신규 기획', categoryId: NEW_CATEGORY_ID, categoryMeta: { id: NEW_CATEGORY_ID, name: '신규 기획' } });
	});

	it('answers a stale version with 409 before finding, creating or reactivating a category', async () => {
		// The copy is on version 2; the server's task is on 3. Resolving the
		// name first would write a category row for a write that then fails.
		const statements = recordStatements(db, [...AUTHORIZATION, [createTaskRow()]]);

		await expect(updateTaskForUser(USER_ID, TASK_ID, {
			category: '기획',
			categoryId: null,
			categoryByName: true,
			expectedVersion: 2
		})).rejects.toMatchObject({ status: 409 });

		expect(describeStatements(statements)).toEqual(AUTHORIZATION_STATEMENTS);
	});

	it('clears the category for a null id from a client that does not ask for the name to decide', async () => {
		// Clients cached from before categoryByName send a patch per keystroke
		// in the task panel; a half-typed name must not become a category.
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[createTaskRow()],
			[createTaskRow({ version: 4 })],
			[]
		]);

		await updateTaskForUser(USER_ID, TASK_ID, { category: 'ㄱ', categoryId: null, expectedVersion: 3 });

		expect(describeStatements(statements)).toEqual([...AUTHORIZATION_STATEMENTS, 'update tasks', 'select checklist_items']);
		expect(statements[3].set).toMatchObject({ category: '', categoryId: null });
	});

	it('clears the category when the patch sends a null id with an empty or missing name', async () => {
		for (const patch of [
			{ category: '', categoryId: null },
			{ categoryId: null },
			{ category: '', categoryId: null, categoryByName: true },
			{ categoryId: null, categoryByName: true }
		]) {
			const statements = recordStatements(db, [
				...AUTHORIZATION,
				[createTaskRow({ category: '개발', categoryId: CATEGORY_ID })],
				[createTaskRow({ version: 4 })],
				[]
			]);

			await updateTaskForUser(USER_ID, TASK_ID, patch);

			expect(describeStatements(statements)).toEqual([...AUTHORIZATION_STATEMENTS, 'update tasks', 'select checklist_items']);
			expect(statements[3].set).toMatchObject({ category: '', categoryId: null });
		}
	});

	it('reports a stale version as 409, a vanished task as 404 and an unknown task as 404', async () => {
		// Changed before the request read the task (version 3)...
		recordStatements(db, [...AUTHORIZATION, [createTaskRow()]]);
		await expect(updateTaskForUser(USER_ID, TASK_ID, { text: 'Renamed', expectedVersion: 2 }))
			.rejects.toMatchObject({ status: 409, message: 'Task changed on another device. Sync and try again.' });

		// ...and between that read and the UPDATE, which then matches no row.
		recordStatements(db, [...AUTHORIZATION, [createTaskRow()], []]);
		await expect(updateTaskForUser(USER_ID, TASK_ID, { text: 'Renamed', expectedVersion: 3 }))
			.rejects.toMatchObject({ status: 409, message: 'Task changed on another device. Sync and try again.' });

		recordStatements(db, [...AUTHORIZATION, [createTaskRow()], []]);
		await expect(updateTaskForUser(USER_ID, TASK_ID, { text: 'Renamed' }))
			.rejects.toMatchObject({ status: 404, message: 'Task was not found.' });

		const statements = recordStatements(db, [...AUTHORIZATION, []]);
		await expect(updateTaskForUser(USER_ID, TASK_ID, { text: 'Renamed' }))
			.rejects.toMatchObject({ status: 404, message: 'Task was not found.' });
		expect(describeStatements(statements)).toEqual(AUTHORIZATION_STATEMENTS);
	});
});
