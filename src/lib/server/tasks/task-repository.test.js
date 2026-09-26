import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/index.js';
import { BOARD_ID, NOW, TASK_ID, USER_ID, createTaskRow, recordStatements } from '$lib/test-support/fake-db.js';
import {
	buildCascadeDeleteStatement,
	buildTaskPatchSet,
	createTaskForUser,
	deleteTaskCascadeForUser,
	updateTaskForUser
} from './task-repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { createFakeDbModule } = await import('$lib/test-support/fake-db.js');
	return createFakeDbModule();
});

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_PARENT_ID = '55555555-5555-4555-8555-555555555555';
const CATEGORY_ID = '66666666-6666-4666-8666-666666666666';
const NEW_CATEGORY_ID = '77777777-7777-4777-8777-777777777777';
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: USER_ID };
const BOARD = { id: BOARD_ID, workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'kanban' };
const TASK = { id: TASK_ID, boardId: BOARD_ID };

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

	it('takes the category by name when the patched id is gone and the client lets the name decide', async () => {
		// The client's catalog still lists 개발, which another device deleted.
		const archived = {
			id: CATEGORY_ID,
			boardId: BOARD_ID,
			userId: USER_ID,
			name: '개발',
			normalizedName: '개발',
			color: '#ff0000',
			sortOrder: 0,
			hiddenAt: NOW,
			archivedAt: NOW,
			createdAt: NOW,
			updatedAt: NOW
		};
		const reactivated = { ...archived, hiddenAt: null, archivedAt: null };
		const statements = recordStatements(db, [
			...AUTHORIZATION,
			[createTaskRow()],
			[],
			[archived],
			[reactivated],
			[createTaskRow({ category: '개발', categoryId: CATEGORY_ID, version: 4 })],
			[],
			[reactivated]
		]);

		const task = await updateTaskForUser(USER_ID, TASK_ID, {
			category: '개발',
			categoryId: CATEGORY_ID,
			categoryByName: true,
			expectedVersion: 3
		});

		expect(describeStatements(statements)).toEqual([
			...AUTHORIZATION_STATEMENTS,
			'select categories',
			'select categories',
			'update categories',
			'update tasks',
			'select checklist_items',
			'select categories'
		]);
		expect(statements[4].where.params).toEqual([BOARD_ID, '개발']);
		expect(statements[5].set).toMatchObject({ hiddenAt: null, archivedAt: null });
		expect(statements[6].set).toMatchObject({ category: '개발', categoryId: CATEGORY_ID });
		expect(task).toMatchObject({ category: '개발', categoryId: CATEGORY_ID, categoryMeta: { id: CATEGORY_ID, name: '개발' } });
	});

	it('answers 400 for a patched id that is gone when the client does not let the name decide', async () => {
		for (const patch of [
			{ category: '개발', categoryId: CATEGORY_ID },
			{ category: '', categoryId: CATEGORY_ID, categoryByName: true }
		]) {
			const statements = recordStatements(db, [...AUTHORIZATION, [createTaskRow()], [], []]);

			await expect(updateTaskForUser(USER_ID, TASK_ID, { ...patch, expectedVersion: 3 }))
				.rejects.toMatchObject({ status: 400, message: 'Category was not found on this board.' });
			expect(describeStatements(statements)).not.toContain('update tasks');
		}
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

/**
 * @param {Partial<Record<string, unknown>>} overrides
 */
function createExisting(overrides = {}) {
	return /** @type {any} */ ({
		id: 'task-id',
		boardId: 'board-id',
		title: 'Existing title',
		status: 'todo',
		priority: 'medium',
		urgency: 'normal',
		category: 'Old category',
		categoryId: 'old-category-id',
		startDate: '2026-07-01',
		endDate: '2026-07-02',
		parentTaskId: null,
		completedAt: null,
		version: 3,
		...overrides
	});
}

/**
 * @param {Partial<Record<string, unknown>>} overrides
 */
function createComputed(existing = createExisting(), overrides = {}) {
	return {
		nextStatus: existing.status,
		nextParentTaskId: existing.parentTaskId,
		nextCategory: { id: existing.categoryId, name: existing.category },
		nextStartDate: existing.startDate,
		nextEndDate: existing.endDate,
		now: NOW,
		...overrides
	};
}

describe('buildTaskPatchSet', () => {
	it('writes only the patched columns plus bookkeeping, never the full row', () => {
		const existing = createExisting();
		const set = buildTaskPatchSet({ title: 'New title' }, existing, createComputed(existing));

		expect(Object.keys(set).sort()).toEqual(['title', 'updatedAt', 'version']);
		expect(set.title).toBe('New title');
		expect(set.updatedAt).toBe(NOW);
	});

	it('keeps concurrent single-field patches from clobbering each other', () => {
		const existing = createExisting();
		const titleSet = buildTaskPatchSet({ title: 'From device A' }, existing, createComputed(existing));
		const prioritySet = buildTaskPatchSet({ priority: 'high' }, existing, createComputed(existing));

		// Device B's priority-only patch must not carry device A's stale title.
		expect(prioritySet).not.toHaveProperty('title');
		expect(titleSet).not.toHaveProperty('priority');
	});

	it('writes status and completedAt together when status is patched', () => {
		const existing = createExisting();
		const set = buildTaskPatchSet(
			{ status: 'done' },
			existing,
			createComputed(existing, { nextStatus: 'done' })
		);

		expect(set.status).toBe('done');
		expect(set.completedAt).toBe(NOW);
		expect(set).not.toHaveProperty('title');
	});

	it('writes a parent-inherited status even when the patch only names parentId', () => {
		const existing = createExisting();
		const set = buildTaskPatchSet(
			{ parentId: 'parent-id' },
			existing,
			createComputed(existing, { nextParentTaskId: 'parent-id', nextStatus: 'doing' })
		);

		expect(set.parentTaskId).toBe('parent-id');
		expect(set.status).toBe('doing');
	});

	it('persists an implicit detach when a status change leaves the parent lane', () => {
		const existing = createExisting({ parentTaskId: 'parent-id' });
		const set = buildTaskPatchSet(
			{ status: 'done' },
			existing,
			createComputed(existing, { nextStatus: 'done', nextParentTaskId: null })
		);

		expect(set.parentTaskId).toBeNull();
		expect(set.status).toBe('done');
	});

	it('writes both category columns for either category-shaped patch', () => {
		const existing = createExisting();
		const byName = buildTaskPatchSet(
			{ category: 'Fresh' },
			existing,
			createComputed(existing, { nextCategory: { id: 'fresh-id', name: 'Fresh' } })
		);
		const byId = buildTaskPatchSet(
			{ categoryId: 'fresh-id' },
			existing,
			createComputed(existing, { nextCategory: { id: 'fresh-id', name: 'Fresh' } })
		);

		for (const set of [byName, byId]) {
			expect(set.category).toBe('Fresh');
			expect(set.categoryId).toBe('fresh-id');
			expect(set).not.toHaveProperty('status');
		}
	});
});

/**
 * @param {import('drizzle-orm').SQL} statement
 */
function renderSql(statement) {
	return new PgDialect().sqlToQuery(statement);
}

describe('cascade delete statement', () => {
	it('renders a cycle-safe recursive soft-delete scoped to the board', () => {
		const { sql: text, params } = renderSql(buildCascadeDeleteStatement(TASK, NOW, null));

		expect(text).toMatch(/with recursive descendants \(id, path\)/);
		// Recursive member must walk children by parent link, board-scoped.
		expect(text).toMatch(/inner join descendants on child\.parent_task_id = descendants\.id/);
		expect(text).toMatch(/child\.board_id = \$/);
		// The path array guards against parent cycles in corrupt data.
		expect(text).toMatch(/not child\.id = any\(descendants\.path\)/);
		// Both members and the outer update must skip already-deleted rows.
		expect((text.match(/deleted_at.{0,4} is null/g) ?? []).length).toBeGreaterThanOrEqual(3);
		expect(text).toMatch(/update "tasks"/);
		expect(text).toMatch(/returning "tasks"\."id"/);
		// Unversioned delete carries no version predicate.
		expect(text).toMatch(/and true/);
		expect(text).not.toMatch(/root\.version/);
		expect(params).toEqual([TASK.id, TASK.boardId, TASK.boardId, NOW, NOW]);
	});

	it('renders the optimistic-concurrency guard when a version is expected', () => {
		const { sql: text, params } = renderSql(buildCascadeDeleteStatement(TASK, NOW, 7));

		expect(text).toMatch(/exists \(\s*select 1 from "tasks" as root/);
		expect(text).toMatch(/root\.version = \$/);
		expect(text).toMatch(/root\.deleted_at is null/);
		expect(params).toContain(7);
	});
});

describe('deleteTaskCascadeForUser result handling', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('throws 409 on a stale expectedVersion and returns the deleted count otherwise', async () => {
		const db = getDb();
		const selectResults = [
			[{ workspaceId: 'ws' }],
			[{ id: TASK.boardId }],
			[{ ...TASK, deletedAt: null }]
		];
		vi.spyOn(db, 'select').mockImplementation(() => {
			const rows = selectResults.shift() ?? [];
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
		const execute = vi.spyOn(db, 'execute').mockResolvedValue(/** @type {any} */ ({ rows: [] }));

		await expect(deleteTaskCascadeForUser('user-id', TASK.id, { expectedVersion: 7 }))
			.rejects.toMatchObject({ status: 409 });
		expect(execute).toHaveBeenCalledTimes(1);

		selectResults.push([{ workspaceId: 'ws' }], [{ id: TASK.boardId }], [{ ...TASK, deletedAt: null }]);
		execute.mockResolvedValue(/** @type {any} */ ({ rows: [{ id: TASK.id }, { id: ITEM_ID }] }));

		await expect(deleteTaskCascadeForUser('user-id', TASK.id)).resolves.toBe(2);
	});
});
