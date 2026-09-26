import { describe, expect, it, vi } from 'vitest';
import { deleteServerCategory, mergeServerCategory, updateServerCategory } from './category-api.js';

const CATEGORY = { id: 'category-1', name: '학습', color: null, sortOrder: 0, hiddenAt: null, archivedAt: null };

/**
 * @param {unknown} body
 * @returns {typeof fetch}
 */
function respondWith(body) {
	return /** @type {typeof fetch} */ (/** @type {unknown} */ (vi.fn(async () => Response.json(body))));
}

describe('category writes that rewrite tasks', () => {
	it('pass on the new version of each rewritten task and drop malformed entries', async () => {
		const taskVersions = [
			{ id: 'task-1', version: 4 },
			{ id: 'task-2', version: 8, extra: true },
			{ id: 'task-3' },
			{ id: '', version: 2 },
			{ id: 'task-4', version: '5' },
			null
		];

		await expect(
			updateServerCategory(
				'category-1',
				{ name: '학습' },
				respondWith({ category: CATEGORY, updatedTasks: 2, taskVersions })
			)
		).resolves.toEqual({
			ok: true,
			category: CATEGORY,
			updatedTasks: 2,
			taskVersions: [
				{ id: 'task-1', version: 4 },
				{ id: 'task-2', version: 8 }
			]
		});
		await expect(
			deleteServerCategory(
				'category-1',
				respondWith({ category: CATEGORY, clearedTasks: 1, taskVersions: taskVersions.slice(0, 1) })
			)
		).resolves.toEqual({ ok: true, category: CATEGORY, clearedTasks: 1, taskVersions: [{ id: 'task-1', version: 4 }] });
		await expect(
			mergeServerCategory(
				'category-0',
				'category-1',
				respondWith({ source: CATEGORY, target: CATEGORY, updatedTasks: 1, taskVersions: taskVersions.slice(0, 1) })
			)
		).resolves.toEqual({
			ok: true,
			source: CATEGORY,
			target: CATEGORY,
			updatedTasks: 1,
			taskVersions: [{ id: 'task-1', version: 4 }]
		});
	});

	it('read a response without taskVersions, from a server before the field, as none', async () => {
		await expect(
			updateServerCategory('category-1', { name: '학습' }, respondWith({ category: CATEGORY, updatedTasks: 2 }))
		).resolves.toMatchObject({ ok: true, updatedTasks: 2, taskVersions: [] });
		await expect(
			mergeServerCategory(
				'category-0',
				'category-1',
				respondWith({ source: CATEGORY, target: CATEGORY, updatedTasks: 1 })
			)
		).resolves.toMatchObject({ ok: true, updatedTasks: 1, taskVersions: [] });
	});
});
