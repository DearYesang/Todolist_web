import { getTableName } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, schema } from '$lib/server/db/index.js';
import { importTasksForUser, replaceTasksForUser } from './import-repository.js';

vi.mock('$lib/server/db/index.js', async () => {
	const { createFakeDbModule } = await import('$lib/test-support/fake-db.js');
	return createFakeDbModule();
});

const USER_ID = 'user-id';
const NOW = new Date('2026-07-06T12:00:00.000Z');
const WORKSPACE = { id: 'workspace-id', name: 'Personal', ownerUserId: USER_ID };
const BOARD = { id: 'board-id', workspaceId: WORKSPACE.id, name: 'Inbox', defaultView: 'kanban' };
const BACKUP = [
	{
		id: 'parent',
		text: 'Parent',
		status: 'doing',
		startDate: '2026-07-01',
		endDate: '2026-07-03',
		createdAt: Date.parse('2026-06-01T00:00:00.000Z'),
		subtasks: [
			{ id: 'item-1', text: ' First ', done: true },
			{ id: 'item-2', text: 'Second', done: false }
		]
	},
	{
		id: 'child',
		text: 'Child',
		status: 'todo',
		parentId: 'parent',
		startDate: '2026-07-02',
		endDate: '2026-07-02',
		createdAt: Date.parse('2026-06-02T00:00:00.000Z')
	},
	{
		id: 'solo',
		text: ' Solo ',
		status: 'done',
		startDate: '2026-07-04',
		endDate: '2026-07-05',
		createdAt: Date.parse('2026-06-03T00:00:00.000Z')
	}
];

/**
 * Serves the personal-board lookups from canned rows, keeps the membership
 * upsert off the network, and records the values given to every other
 * insert while still building the real statement for db.batch.
 * @param {any} db
 */
function stubBoardAndInserts(db) {
	const selectResults = [[WORKSPACE], [BOARD]];
	vi.spyOn(db, 'select').mockImplementation(() => {
		const rows = selectResults.shift() ?? [];
		/** @type {any} */
		const chain = {
			from: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve(rows)
		};
		return chain;
	});

	/** @type {Record<string, any>} */
	const insertedValues = {};
	const insert = db.insert.bind(db);
	vi.spyOn(db, 'insert').mockImplementation((table) => {
		if (table === schema.workspaceMembers) {
			/** @type {any} */
			const chain = {
				values: () => chain,
				onConflictDoNothing: () => chain,
				then: (/** @type {(rows: unknown[]) => unknown} */ resolve) => resolve([])
			};
			return chain;
		}

		const builder = insert(table);
		const values = builder.values.bind(builder);
		builder.values = (/** @type {unknown} */ rows) => {
			insertedValues[getTableName(/** @type {any} */ (table))] = rows;
			return values(rows);
		};
		return builder;
	});
	return insertedValues;
}

/**
 * @param {Record<string, unknown>} overrides
 */
function taskValues(overrides) {
	return {
		id: expect.any(String),
		boardId: BOARD.id,
		parentTaskId: null,
		priority: 'medium',
		urgency: 'normal',
		category: '',
		categoryId: null,
		version: 1,
		createdBy: USER_ID,
		updatedAt: NOW,
		completedAt: null,
		deletedAt: null,
		...overrides
	};
}

/**
 * @param {Record<string, any>} insertedValues
 */
function expectBackupValues(insertedValues) {
	const [parent] = insertedValues.tasks;
	// Parents are inserted before their children; ties keep backup order.
	expect(insertedValues.tasks).toEqual([
		taskValues({
			title: 'Parent',
			status: 'doing',
			startDate: '2026-07-01',
			endDate: '2026-07-03',
			position: '1783339200.000',
			createdAt: new Date('2026-06-01T00:00:00.000Z')
		}),
		taskValues({
			title: 'Solo',
			status: 'done',
			startDate: '2026-07-04',
			endDate: '2026-07-05',
			position: '1783339200.001',
			createdAt: new Date('2026-06-03T00:00:00.000Z'),
			completedAt: NOW
		}),
		taskValues({
			parentTaskId: parent.id,
			title: 'Child',
			status: 'doing',
			startDate: '2026-07-02',
			endDate: '2026-07-02',
			position: '1783339200.002',
			createdAt: new Date('2026-06-02T00:00:00.000Z')
		})
	]);
	expect(insertedValues.checklist_items).toEqual([
		{
			id: expect.any(String),
			taskId: parent.id,
			text: 'First',
			done: true,
			position: '1783339200.000',
			createdAt: NOW,
			updatedAt: NOW
		},
		{
			id: expect.any(String),
			taskId: parent.id,
			text: 'Second',
			done: false,
			position: '1783339200.001',
			createdAt: NOW,
			updatedAt: NOW
		}
	]);
}

const BACKUP_SUMMARY = {
	receivedTasks: 3,
	importedTasks: 3,
	skippedTasks: 0,
	importedChecklistItems: 2,
	skippedChecklistItems: 0,
	repairedParentLinks: 0
};

describe('task import writes', () => {
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

	it('inserts the planned tasks and their checklist items in one batch', async () => {
		const insertedValues = stubBoardAndInserts(db);
		batchMock.mockImplementation(async () => [insertedValues.tasks, insertedValues.checklist_items]);

		const result = await importTasksForUser(USER_ID, BACKUP);

		expect(batchMock).toHaveBeenCalledTimes(1);
		const statements = batchMock.mock.calls[0][0];
		expect(statements.map((/** @type {any} */ statement) => statement.toSQL().sql.split(' (')[0])).toEqual([
			'insert into "tasks"',
			'insert into "checklist_items"'
		]);
		expectBackupValues(insertedValues);
		expect(result.summary).toEqual(BACKUP_SUMMARY);
		expect(
			result.tasks.map((task) => ({
				text: task.text,
				status: task.status,
				parentId: task.parentId,
				subtasks: task.subtasks.map((item) => item.text)
			}))
		).toEqual([
			{ text: 'Parent', status: 'doing', parentId: null, subtasks: ['First', 'Second'] },
			{ text: 'Solo', status: 'done', parentId: null, subtasks: [] },
			{ text: 'Child', status: 'doing', parentId: insertedValues.tasks[0].id, subtasks: [] }
		]);
	});

	it('leaves the checklist insert out of the batch when no item is imported', async () => {
		const insertedValues = stubBoardAndInserts(db);
		batchMock.mockImplementation(async () => [insertedValues.tasks]);

		const result = await importTasksForUser(USER_ID, [BACKUP[2]]);

		const statements = batchMock.mock.calls[0][0];
		expect(statements).toHaveLength(1);
		expect(statements[0].toSQL().sql).toMatch(/^insert into "tasks"/);
		expect(insertedValues.checklist_items).toBeUndefined();
		expect(result.tasks.map((task) => task.text)).toEqual(['Solo']);
	});

	it('returns an empty import without reading the board or running a batch', async () => {
		stubBoardAndInserts(db);

		const result = await importTasksForUser(USER_ID, []);

		expect(result).toEqual({
			tasks: [],
			summary: {
				receivedTasks: 0,
				importedTasks: 0,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0
			}
		});
		expect(db.select).not.toHaveBeenCalled();
		expect(batchMock).not.toHaveBeenCalled();
	});

	it('soft-deletes the live tasks of the board before inserting the backup, in one batch', async () => {
		const insertedValues = stubBoardAndInserts(db);
		batchMock.mockImplementation(async () => [
			[{ id: 'old-1' }, { id: 'old-2' }],
			insertedValues.tasks,
			insertedValues.checklist_items
		]);

		const result = await replaceTasksForUser(USER_ID, BACKUP);

		const statements = batchMock.mock.calls[0][0];
		expect(statements).toHaveLength(3);
		expect(statements[0].toSQL()).toEqual({
			sql: 'update "tasks" set "version" = "tasks"."version" + 1, "updated_at" = $1, "deleted_at" = $2 where ("tasks"."board_id" = $3 and "tasks"."deleted_at" is null) returning "id"',
			params: [NOW.toISOString(), NOW.toISOString(), BOARD.id]
		});
		expect(statements[1].toSQL().sql).toMatch(/^insert into "tasks"/);
		expect(statements[2].toSQL().sql).toMatch(/^insert into "checklist_items"/);
		expectBackupValues(insertedValues);
		expect(result.summary).toEqual({ ...BACKUP_SUMMARY, replacedTasks: 2 });
		expect(result.tasks).toHaveLength(3);
	});

	it('soft-deletes every live task when the backup is empty', async () => {
		stubBoardAndInserts(db);
		batchMock.mockResolvedValue([[{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }]]);

		const result = await replaceTasksForUser(USER_ID, { tasks: [] });

		const statements = batchMock.mock.calls[0][0];
		expect(statements).toHaveLength(1);
		expect(statements[0].toSQL().sql).toMatch(
			/^update "tasks" set .* "deleted_at" = \$2 where \("tasks"\."board_id" = \$3/
		);
		expect(result).toEqual({
			tasks: [],
			summary: {
				receivedTasks: 0,
				importedTasks: 0,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0,
				replacedTasks: 3
			}
		});
	});
});
