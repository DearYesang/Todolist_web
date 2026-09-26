import { expect, test } from '@playwright/test';
import { readPersistedTask, seedOfflineBoard } from './fixtures/board.js';
import { pointerDrag } from './fixtures/page.js';

test('keeps iPad-width Kanban columns side by side', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 1366 });
	await seedOfflineBoard(page);

	await page.goto('/');

	const todo = page.locator('#col-todo');
	const doing = page.locator('#col-doing');
	const done = page.locator('#col-done');
	await expect(todo).toBeVisible();
	await expect(doing).toBeVisible();
	await expect(done).toBeVisible();

	const boxes = await Promise.all([todo.boundingBox(), doing.boundingBox(), done.boundingBox()]);
	expect(boxes.every(Boolean)).toBe(true);
	expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(4);
	expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(4);
	expect(boxes[0].x).toBeLessThan(boxes[1].x);
	expect(boxes[1].x).toBeLessThan(boxes[2].x);
});

test('stacks Kanban columns on iPhone-width screens', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await seedOfflineBoard(page);

	await page.goto('/');

	const todo = page.locator('#col-todo');
	const doing = page.locator('#col-doing');
	const done = page.locator('#col-done');
	await expect(todo).toBeVisible();
	await expect(doing).toBeVisible();
	await expect(done).toBeVisible();

	const boxes = await Promise.all([todo.boundingBox(), doing.boundingBox(), done.boundingBox()]);
	expect(boxes.every(Boolean)).toBe(true);
	expect(boxes[0].y).toBeLessThan(boxes[1].y);
	expect(boxes[1].y).toBeLessThan(boxes[2].y);
});

test('keeps nested checklist tasks attached on iPhone-sized offline reloads', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await seedOfflineBoard(page);

	await page.goto('/');
	const child = page.locator('.task-card', { hasText: 'Nested child task' }).first();
	await expect(child).toBeVisible();
	await expect(child).toHaveAttribute('style', /margin-left:\s*32px/);

	await child.locator('.add-subtask-input').fill('Offline checklist note');
	await child.locator('.add-subtask-input').press('Enter');
	await expect(child.getByText('Offline checklist note')).toBeVisible();

	await page.reload();
	const reloadedChild = page.locator('.task-card', { hasText: 'Nested child task' }).first();
	await expect(reloadedChild).toBeVisible();
	await expect(reloadedChild).toHaveAttribute('style', /margin-left:\s*32px/);
	await expect(reloadedChild.getByText('Offline checklist note')).toBeVisible();
});

test('drags a Kanban card to another column with pointer input', async ({ page }) => {
	// Tall viewport keeps every drag source and target on screen; pointer
	// events cannot reach elements outside the viewport.
	await page.setViewportSize({ width: 1280, height: 1400 });
	await seedOfflineBoard(page);

	await page.goto('/');
	const card = page.locator('.task-card', { has: page.getByText('E2E cached task') }).first();
	const target = page.locator('#col-doing .task-list');
	const targetBox = await target.boundingBox();
	expect(targetBox).toBeTruthy();

	// Drop into the empty space at the bottom of the list — dropping onto an
	// existing card means re-parenting, not a column move.
	await pointerDrag(page, card, {
		x: targetBox.x + targetBox.width / 2,
		y: targetBox.y + targetBox.height - 20
	});

	await expect(page.locator('#col-doing').getByText('E2E cached task')).toBeVisible();
	await expect(page.locator('#col-todo').getByText('E2E cached task')).toBeHidden();
	// Positive control for the write path: the move is persisted, not just
	// rendered.
	const persistedStatus = (await readPersistedTask(page, 'local-e2e-task'))?.status;
	expect(persistedStatus).toBe('doing');
});

test('keeps a dropped child in its own column attached to its parent', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1400 });
	await seedOfflineBoard(page);

	await page.goto('/');
	const child = page.locator('.task-card', { has: page.getByText('Nested child task') }).first();
	const column = page.locator('#col-todo .task-list');
	const columnBox = await column.boundingBox();
	expect(columnBox).toBeTruthy();

	// Drop into empty space of the SAME column: the old HTML5 handler
	// silently detached the child from its parent here.
	await pointerDrag(page, child, {
		x: columnBox.x + columnBox.width / 2,
		y: columnBox.y + columnBox.height - 20
	});

	// Still rendered as an indented child (child-card class survives)…
	await expect(page.locator('.task-card.child-card', { has: page.getByText('Nested child task') })).toBeVisible();
	// …and the persisted task graph still records the parent link.
	const parentId = (await readPersistedTask(page, 'local-child-task'))?.parentId;
	expect(parentId).toBe('local-parent-task');
	// A same-column drop must queue no sync write. Note: for cache-seeded
	// local tasks the queue also stays empty because coalescing drops
	// orphan patches, so the component's same-column guard itself is only
	// fully observable with server tasks — its residual value (avoiding
	// redundant PATCH/version churn) is documented rather than pinned here.
	const queuedWrites = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('kanbanOfflineWriteQueue:e2e-user') ?? '[]')
	);
	expect(queuedWrites).toEqual([]);
});
