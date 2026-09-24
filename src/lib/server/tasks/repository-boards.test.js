import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import {
	ensurePersonalBoardForUser,
	getBoardPreferencesForUser,
	listTasksForUser,
	updateBoardPreferencesForUser
} from './repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { drizzle } = await import('drizzle-orm/neon-http');
	const { neon } = await import('@neondatabase/serverless');
	const schema = await import('./../db/schema.js');
	// neon-http performs no I/O until a query executes, so statements can be
	// built against a fake URL.
	const db = drizzle(neon('postgresql://user:pass@boards-test.invalid/db'), { schema });
	return { getDb: () => db, schema };
});

const USER_ID = 'user-id';
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: USER_ID };
const BOARD = { id: 'board-id', workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'matrix' };

/**
 * Replaces db.select/insert/update with builder chains that record the table,
 * the rendered where clause, the inserted or set values and the other builder
 * steps of each statement. Each statement resolves to the next queued rows.
 * @param {any} db
 * @param {unknown[][]} results
 */
function recordStatements(db, results) {
	const queue = [...results];
	/** @type {Record<string, unknown>[]} */
	const statements = [];

	/**
	 * @param {string} kind
	 * @param {any} table
	 */
	function createChain(kind, table) {
		/** @type {Record<string, unknown> & { steps: string[] }} */
		const statement = { kind, table: table ? getTableName(table) : null, steps: [] };
		statements.push(statement);
		const rows = queue.shift() ?? [];
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
			leftJoin: () => step(chain, statement, 'leftJoin'),
			orderBy: () => step(chain, statement, 'orderBy'),
			limit: () => step(chain, statement, 'limit'),
			onConflictDoNothing: () => step(chain, statement, 'onConflictDoNothing'),
			returning: () => step(chain, statement, 'returning'),
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
 * @param {any} chain
 * @param {{ steps: string[] }} statement
 * @param {string} name
 */
function step(chain, statement, name) {
	statement.steps.push(name);
	return chain;
}

const SELECT_WORKSPACE = {
	kind: 'select',
	table: 'workspaces',
	steps: ['limit'],
	where: {
		text: '("workspaces"."owner_user_id" = $1 and "workspaces"."name" = $2)',
		params: [USER_ID, 'Personal']
	}
};
const INSERT_WORKSPACE = {
	kind: 'insert',
	table: 'workspaces',
	steps: ['onConflictDoNothing', 'returning'],
	values: { name: 'Personal', ownerUserId: USER_ID }
};
const INSERT_MEMBERSHIP = {
	kind: 'insert',
	table: 'workspace_members',
	steps: ['onConflictDoNothing'],
	values: { workspaceId: WORKSPACE.id, userId: USER_ID, role: 'owner' }
};
const SELECT_BOARD = {
	kind: 'select',
	table: 'boards',
	steps: ['limit'],
	where: {
		text: '("boards"."workspace_id" = $1 and "boards"."name" = $2)',
		params: [WORKSPACE.id, 'Inbox']
	}
};
const INSERT_BOARD = {
	kind: 'insert',
	table: 'boards',
	steps: ['onConflictDoNothing', 'returning'],
	values: { workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'kanban' }
};

describe('personal board provisioning', () => {
	/** @type {any} */
	let db;

	beforeEach(() => {
		vi.restoreAllMocks();
		db = getDb();
	});

	it('reuses the Personal workspace and Inbox board and still upserts the owner membership', async () => {
		const statements = recordStatements(db, [[WORKSPACE], [], [BOARD]]);

		await expect(ensurePersonalBoardForUser(USER_ID)).resolves.toEqual(BOARD);
		expect(statements).toEqual([SELECT_WORKSPACE, INSERT_MEMBERSHIP, SELECT_BOARD]);
	});

	it('creates the Personal workspace, the owner membership and the Inbox board on first use', async () => {
		const statements = recordStatements(db, [[], [WORKSPACE], [], [], [BOARD]]);

		await expect(ensurePersonalBoardForUser(USER_ID)).resolves.toEqual(BOARD);
		expect(statements).toEqual([SELECT_WORKSPACE, INSERT_WORKSPACE, INSERT_MEMBERSHIP, SELECT_BOARD, INSERT_BOARD]);
	});

	it('re-reads the workspace and board when a concurrent request created them first', async () => {
		const statements = recordStatements(db, [[], [], [WORKSPACE], [], [], [], [BOARD]]);

		await expect(ensurePersonalBoardForUser(USER_ID)).resolves.toEqual(BOARD);
		expect(statements).toEqual([
			SELECT_WORKSPACE,
			INSERT_WORKSPACE,
			SELECT_WORKSPACE,
			INSERT_MEMBERSHIP,
			SELECT_BOARD,
			INSERT_BOARD,
			SELECT_BOARD
		]);
	});

	it('fails with 500 when the workspace or the board is still missing after the insert', async () => {
		recordStatements(db, [[], [], []]);
		await expect(ensurePersonalBoardForUser(USER_ID))
			.rejects.toMatchObject({ status: 500, message: 'A default workspace could not be created.' });

		recordStatements(db, [[WORKSPACE], [], [], [], []]);
		await expect(ensurePersonalBoardForUser(USER_ID))
			.rejects.toMatchObject({ status: 500, message: 'A default workspace board could not be created.' });
	});
});

describe('task listing board lookup', () => {
	/** @type {any} */
	let db;

	beforeEach(() => {
		vi.restoreAllMocks();
		db = getDb();
	});

	it('returns no tasks without creating a workspace when the user has none', async () => {
		const statements = recordStatements(db, [[], []]);

		await expect(listTasksForUser(USER_ID)).resolves.toEqual([]);
		expect(statements).toEqual([
			SELECT_WORKSPACE,
			{
				kind: 'select',
				table: 'workspace_members',
				steps: [],
				where: { text: '"workspace_members"."user_id" = $1', params: [USER_ID] }
			}
		]);
	});

	it('falls back to the oldest board of any membership when there is no Personal workspace', async () => {
		const statements = recordStatements(db, [[], [{ workspaceId: 'shared-workspace-id' }], [{ id: 'shared-board-id' }], []]);

		await expect(listTasksForUser(USER_ID)).resolves.toEqual([]);
		expect(statements.slice(2)).toEqual([
			{
				kind: 'select',
				table: 'boards',
				steps: ['orderBy', 'limit'],
				where: { text: '"boards"."workspace_id" in ($1)', params: ['shared-workspace-id'] }
			},
			{
				kind: 'select',
				table: 'tasks',
				steps: ['leftJoin', 'orderBy'],
				where: { text: '("tasks"."board_id" = $1 and "tasks"."deleted_at" is null)', params: ['shared-board-id'] }
			}
		]);
	});

	it('reads the Personal Inbox board without inserting anything', async () => {
		const statements = recordStatements(db, [[WORKSPACE], [BOARD], []]);

		await expect(listTasksForUser(USER_ID)).resolves.toEqual([]);
		expect(statements.slice(0, 2)).toEqual([SELECT_WORKSPACE, SELECT_BOARD]);
		expect(statements[2]).toMatchObject({ kind: 'select', table: 'tasks', where: { params: [BOARD.id] } });
		expect(statements).toHaveLength(3);
	});
});

describe('board preferences', () => {
	/** @type {any} */
	let db;

	beforeEach(() => {
		vi.restoreAllMocks();
		db = getDb();
	});

	it('reads the default view from the provisioned board', async () => {
		const statements = recordStatements(db, [[WORKSPACE], [], [BOARD]]);

		await expect(getBoardPreferencesForUser(USER_ID)).resolves.toEqual({ defaultView: 'matrix' });
		expect(statements).toEqual([SELECT_WORKSPACE, INSERT_MEMBERSHIP, SELECT_BOARD]);
	});

	it('writes only the default view and updatedAt of the provisioned board', async () => {
		const statements = recordStatements(db, [[WORKSPACE], [], [BOARD], [{ ...BOARD, defaultView: 'gantt' }]]);

		await expect(updateBoardPreferencesForUser(USER_ID, { defaultView: 'gantt' })).resolves.toEqual({ defaultView: 'gantt' });
		expect(statements).toEqual([
			SELECT_WORKSPACE,
			INSERT_MEMBERSHIP,
			SELECT_BOARD,
			{
				kind: 'update',
				table: 'boards',
				steps: ['returning'],
				set: { defaultView: 'gantt', updatedAt: expect.any(Date) },
				where: { text: '"boards"."id" = $1', params: [BOARD.id] }
			}
		]);
	});

	it('rejects an invalid view before touching the database and reports an update that matched no board as 500', async () => {
		const statements = recordStatements(db, [[WORKSPACE], [], [BOARD], []]);

		await expect(updateBoardPreferencesForUser(USER_ID, { defaultView: 'calendar' }))
			.rejects.toMatchObject({ status: 400 });
		expect(statements).toEqual([]);

		await expect(updateBoardPreferencesForUser(USER_ID, { defaultView: 'gantt' }))
			.rejects.toMatchObject({ status: 500, message: 'Board preferences could not be updated.' });
	});
});
