import { neon } from '@neondatabase/serverless';
import { getTableName } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { vi } from 'vitest';
import * as schema from '$lib/server/db/schema.js';

export const USER_ID = 'user-id';
export const TASK_ID = '11111111-1111-4111-8111-111111111111';
export const BOARD_ID = '22222222-2222-4222-8222-222222222222';
export const NOW = new Date('2026-07-06T12:00:00.000Z');

/**
 * A Drizzle client on a fake URL. neon-http performs no I/O until a query
 * executes, so statements can be built and rendered without a database.
 */
export function createFakeDb() {
	return drizzle(neon('postgresql://user:pass@fake-db.invalid/db'), { schema });
}

/**
 * Stands in for $lib/server/db/index.js, with getDb() always answering the
 * same fake client. vi.mock hoists its factory above the test file's
 * imports, so the factory loads this module itself:
 *
 *     vi.mock('$lib/server/db/index.js', async () => {
 *         const { createFakeDbModule } = await import('$lib/test-support/fake-db.js');
 *         return createFakeDbModule();
 *     });
 */
export function createFakeDbModule() {
	const db = createFakeDb();
	return { getDb: () => db, schema };
}

/**
 * A tasks row as the repository selects it: TASK_ID on BOARD_ID at version 3,
 * created by USER_ID at NOW, with no parent and no category.
 * @param {Record<string, unknown>} [overrides]
 */
export function createTaskRow(overrides = {}) {
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
export function recordStatements(db, results) {
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
