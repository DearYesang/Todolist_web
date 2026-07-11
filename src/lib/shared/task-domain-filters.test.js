import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, getTaskDueStatus, matchesFilters, normalizeTask, resolveEisenhowerMove } from './task-domain.js';

function createTask(overrides = {}) {
	return normalizeTask({
		id: 'task-id',
		text: '네트워크 공부',
		category: 'CS',
		priority: 'medium',
		urgency: 'normal',
		startDate: '2026-07-01',
		endDate: '2026-07-20',
		subtasks: [{ id: 'sub-1', text: 'OSI 계층 정리', done: false }],
		...overrides
	});
}

describe('search filter', () => {
	it('matches task text, category, and checklist text case-insensitively', () => {
		const task = createTask();

		expect(matchesFilters(task, { ...DEFAULT_FILTERS, search: '네트워크' })).toBe(true);
		expect(matchesFilters(task, { ...DEFAULT_FILTERS, search: 'cs' })).toBe(true);
		expect(matchesFilters(task, { ...DEFAULT_FILTERS, search: 'osi 계층' })).toBe(true);
		expect(matchesFilters(task, { ...DEFAULT_FILTERS, search: '없는 단어' })).toBe(false);
	});

	it('treats blank or missing search as match-all', () => {
		const task = createTask();

		expect(matchesFilters(task, { ...DEFAULT_FILTERS, search: '   ' })).toBe(true);
		const legacyFilters = /** @type {any} */ ({ priority: 'all', urgency: 'all', category: 'all', categoryId: 'all' });
		expect(matchesFilters(task, legacyFilters)).toBe(true);
	});

	it('combines with the category-id filter instead of being bypassed by it', () => {
		const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const inCategory = createTask({ categoryId });

		// The categoryId branch returns early; search must still apply.
		expect(matchesFilters(inCategory, { ...DEFAULT_FILTERS, categoryId, search: '네트워크' })).toBe(true);
		expect(matchesFilters(inCategory, { ...DEFAULT_FILTERS, categoryId, search: '없는 단어' })).toBe(false);
	});
});

describe('due status', () => {
	it('classifies overdue, due-today, and future end dates', () => {
		const today = '2026-07-11';

		expect(getTaskDueStatus(createTask({ endDate: '2026-07-10' }), today)).toBe('overdue');
		expect(getTaskDueStatus(createTask({ endDate: '2026-07-11' }), today)).toBe('due-today');
		expect(getTaskDueStatus(createTask({ endDate: '2026-07-12' }), today)).toBe(null);
	});

	it('never flags completed tasks', () => {
		expect(getTaskDueStatus(createTask({ endDate: '2026-07-01', status: 'done' }), '2026-07-11')).toBe(null);
	});

	it('defaults to the local calendar date', () => {
		// Sanity only: a task ending far in the future is never overdue.
		expect(getTaskDueStatus(createTask({ endDate: '2099-01-01' }))).toBe(null);
	});
});

describe('eisenhower move policy', () => {
	it('is a no-op when the task is dropped into its own quadrant', () => {
		const task = createTask({ priority: 'medium', urgency: 'urgent' });

		expect(resolveEisenhowerMove(task, { importance: 'less-important', urgency: 'urgent' })).toBe(null);
	});

	it('promotes to high when dropped into an important quadrant', () => {
		const task = createTask({ priority: 'low', urgency: 'normal' });

		expect(resolveEisenhowerMove(task, { importance: 'important', urgency: 'urgent' }))
			.toEqual({ priority: 'high', urgency: 'urgent' });
	});

	it('only demotes high on the way out; medium and low survive unchanged', () => {
		expect(resolveEisenhowerMove(createTask({ priority: 'high', urgency: 'urgent' }), { importance: 'less-important', urgency: 'urgent' }))
			.toEqual({ priority: 'medium', urgency: 'urgent' });
		expect(resolveEisenhowerMove(createTask({ priority: 'low', urgency: 'urgent' }), { importance: 'less-important', urgency: 'normal' }))
			.toEqual({ priority: 'low', urgency: 'normal' });
	});
});
