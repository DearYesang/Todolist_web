import { describe, expect, it } from 'vitest';
import { buildTaskIndex, normalizeTask } from './task-domain.js';

/**
 * @param {string} id
 * @param {Record<string, unknown>} [overrides]
 */
function createTask(id, overrides = {}) {
	return normalizeTask({ id, text: id, startDate: '2026-09-01', endDate: '2026-09-03', ...overrides });
}

describe('buildTaskIndex', () => {
	const taskList = [
		createTask('root'),
		createTask('child-b', { parentId: 'root', status: 'done' }),
		createTask('other'),
		createTask('grandchild', { parentId: 'child-b' }),
		createTask('child-a', { parentId: 'root' }),
		createTask('orphan', { parentId: 'missing' })
	];

	it('lists direct children in task-list order', () => {
		const index = buildTaskIndex(taskList);

		expect(index.childrenByParentId.get('root')?.map((task) => task.id)).toEqual(['child-b', 'child-a']);
		expect(index.childrenByParentId.get('child-b')?.map((task) => task.id)).toEqual(['grandchild']);
		expect(index.childrenByParentId.get('other')).toBeUndefined();
	});

	it('gives the same answers as scanning the list for every task', () => {
		const index = buildTaskIndex(taskList);

		for (const task of taskList) {
			expect(index.childrenByParentId.get(task.id) ?? []).toEqual(
				taskList.filter((candidate) => candidate.parentId === task.id)
			);
			expect(index.byId.get(task.id)).toBe(taskList.find((candidate) => candidate.id === task.id));
		}
		expect(index.byId.get('missing')).toBeUndefined();
	});

	it('keeps the first task for a duplicated id, like Array#find', () => {
		const first = createTask('same', { text: 'first' });
		const second = createTask('same', { text: 'second' });

		expect(buildTaskIndex([first, second]).byId.get('same')).toBe(first);
	});

	it('handles an empty list', () => {
		const index = buildTaskIndex([]);

		expect(index.byId.size).toBe(0);
		expect(index.childrenByParentId.size).toBe(0);
	});
});
