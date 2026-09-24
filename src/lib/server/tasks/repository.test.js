import { describe, expect, it } from 'vitest';
import * as repository from './repository.js';

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
});
