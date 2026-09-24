import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as repository from './repository.js';
import * as boardProvisioning from './board-provisioning.js';
import * as checklistRepository from './checklist-repository.js';
import * as importRepository from './import-repository.js';
import * as taskRepository from './task-repository.js';
import * as taskRows from './task-rows.js';

/** @type {Record<string, Record<string, unknown>>} */
const OWNING_MODULES = {
	'board-provisioning.js': boardProvisioning,
	'checklist-repository.js': checklistRepository,
	'import-repository.js': importRepository,
	'task-repository.js': taskRepository,
	'task-rows.js': taskRows
};

// The API routes, categories/repository.js and the calendar modules import
// these names from repository.js, and the route tests replace the whole
// module with vi.mock factories, so this list is the module's contract.
const FUNCTIONS = [
	'buildCascadeDeleteStatement',
	'buildTaskPatchSet',
	'buildTaskVersionBump',
	'createChecklistItemForUser',
	'createPositionValue',
	'createTaskForUser',
	'deleteChecklistItemForUser',
	'deleteTaskCascadeForUser',
	'ensurePersonalBoardForUser',
	'getBoardPreferencesForUser',
	'importTasksForUser',
	'listTasksForBoard',
	'listTasksForUser',
	'replaceTasksForUser',
	'updateBoardPreferencesForUser',
	'updateChecklistItemForUser',
	'updateTaskForUser'
];

const SRC_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const TASKS_DIR = join('lib', 'server', 'tasks');
const SIBLING_IMPORT = /['"][^'"]*server\/tasks\/(board-provisioning|checklist-repository|import-repository|task-repository|task-rows)\.js['"]/;

describe('server task repository public API', () => {
	it('exports exactly the names the routes, the server modules and the tests import', () => {
		expect(Object.keys(repository).sort()).toEqual([...FUNCTIONS].sort());
	});

	it('exports only functions', () => {
		const api = /** @type {Record<string, unknown>} */ (repository);
		for (const name of FUNCTIONS) {
			expect(typeof api[name], name).toBe('function');
		}
	});

	it('re-exports each name from exactly one sibling module, as the same function', () => {
		const api = /** @type {Record<string, unknown>} */ (repository);
		for (const name of Object.keys(api)) {
			const owners = Object.entries(OWNING_MODULES).filter(([, module]) => name in module);
			expect(owners.map(([file]) => file), name).toHaveLength(1);
			expect(owners[0][1][name], name).toBe(api[name]);
		}
	});

	it('is the only task repository module that code outside server/tasks imports', () => {
		// A route importing a sibling module directly would escape the
		// vi.mock('$lib/server/tasks/repository.js') factories in its tests.
		const offenders = readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.(js|svelte)$/.test(file) && !file.startsWith(TASKS_DIR))
			.filter((file) => SIBLING_IMPORT.test(readFileSync(join(SRC_DIR, file), 'utf8')));

		expect(offenders).toEqual([]);
	});
});
