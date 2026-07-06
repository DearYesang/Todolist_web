import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema.js';
import {
	buildCascadeDeleteStatement,
	buildTaskVersionBump,
	deleteTaskCascadeForUser
} from './repository.js';

const NOW = new Date('2026-07-06T12:00:00.000Z');
const TASK = { id: '11111111-1111-4111-8111-111111111111', boardId: '22222222-2222-4222-8222-222222222222' };
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

// neon-http performs no I/O until a query executes, so a fake URL is enough
// to build statements for SQL rendering.
function createOfflineDb() {
	return drizzle(neon('postgresql://user:pass@sql-render-test.invalid/db'), { schema });
}

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

describe('checklist version bump statement', () => {
	it('gates the bump on the checklist item existing when asked', () => {
		const db = createOfflineDb();
		const gated = buildTaskVersionBump(db, TASK.id, NOW, { requireChecklistItemId: ITEM_ID }).toSQL();

		expect(gated.sql).toMatch(/update "tasks" set/);
		expect(gated.sql).toMatch(/"version" = "tasks"\."version" \+ 1/);
		expect(gated.sql).toMatch(/exists \(\s*select 1 from "checklist_items"/);
		expect(gated.sql).toMatch(/"checklist_items"\."id" = \$/);
		expect(gated.sql).toMatch(/"checklist_items"\."task_id" = \$/);
		expect(gated.params).toEqual(expect.arrayContaining([TASK.id, ITEM_ID]));
	});

	it('bumps unconditionally when no gate is requested', () => {
		const db = createOfflineDb();
		const plain = buildTaskVersionBump(db, TASK.id, NOW).toSQL();

		expect(plain.sql).not.toMatch(/exists/);
		expect(plain.sql).toMatch(/"tasks"\."deleted_at" is null/);
	});
});

describe('deleteTaskCascadeForUser result handling', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('throws 409 on a stale expectedVersion and returns the deleted count otherwise', async () => {
		vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@sql-render-test.invalid/db');
		const dbModule = await import('$lib/server/db/index.js');
		const db = dbModule.getDb();
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
