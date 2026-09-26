import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import { recordStatements } from '$lib/test-support/fake-db.js';
import {
	ensurePersonalBoardForUser,
	getBoardPreferencesForUser,
	updateBoardPreferencesForUser
} from './board-provisioning.js';
import { listTasksForUser } from '$lib/server/tasks/task-repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { createFakeDbModule } = await import('$lib/test-support/fake-db.js');
	return createFakeDbModule();
});

const USER_ID = 'user-id';
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: USER_ID };
const BOARD = { id: 'board-id', workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'matrix' };

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
