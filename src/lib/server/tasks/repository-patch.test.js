import { describe, expect, it } from 'vitest';
import { buildTaskPatchSet } from './repository.js';

const NOW = new Date('2026-07-06T12:00:00.000Z');

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
