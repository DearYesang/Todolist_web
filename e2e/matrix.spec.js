import { expect, test } from '@playwright/test';
import { seedOfflineBoard } from './fixtures/board.js';
import { pointerDrag } from './fixtures/page.js';

test('opens the Eisenhower matrix view with all quadrants', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /매트릭스/ }).click();

	await expect(page.getByRole('heading', { name: '즉시 실행' })).toBeVisible();
	await expect(page.getByRole('heading', { name: '계획하기' })).toBeVisible();
	await expect(page.getByRole('heading', { name: '줄이기' })).toBeVisible();
	await expect(page.getByRole('heading', { name: '보류/제거' })).toBeVisible();
	await expect(page.getByText('Urgent important')).toBeVisible();
	await expect(page.getByText('Planned important')).toBeVisible();
	await expect(page.getByText('Interrupting task')).toBeVisible();
	await expect(page.getByText('E2E cached task')).toBeVisible();
	await expect(page.getByText('Completed matrix task')).toBeHidden();

	await page.getByRole('button', { name: /완료 보기/ }).click();
	await expect(page.getByText('Completed matrix task')).toBeVisible();
	await expect(page.getByRole('button', { name: /완료 숨기기/ })).toBeVisible();
});

test('remembers the selected view across reloads', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /매트릭스/ }).click();
	await expect(page.getByRole('heading', { name: '즉시 실행' })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: '즉시 실행' })).toBeVisible();
	await expect(page.getByRole('button', { name: /매트릭스/ })).toHaveClass(/active/);
});

test('moves a task between Eisenhower quadrants with pointer input', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1400 });
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /매트릭스/ }).click();

	const card = page.locator('.task-card', { has: page.getByText('Interrupting task') }).first();
	const target = page.locator('.eisenhower-quadrant[data-quadrant="do"]');
	await card.scrollIntoViewIfNeeded();
	const targetBox = await target.boundingBox();
	expect(targetBox).toBeTruthy();

	await pointerDrag(page, card, {
		x: targetBox.x + targetBox.width / 2,
		y: targetBox.y + targetBox.height / 2
	});

	// 'Interrupting task' was medium/urgent (줄이기); dropping on 즉시 실행
	// promotes it to important while keeping urgency.
	await expect(target.getByText('Interrupting task')).toBeVisible();
	const persisted = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]')
			.find((task) => task.id === 'local-interrupting-task')
	);
	expect(persisted).toMatchObject({ priority: 'high', urgency: 'urgent' });
});

test('keeps the matrix view framed on iPad Pro width', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 1366 });
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /매트릭스/ }).click();

	const board = page.locator('.eisenhower-board');
	await expect(board).toBeVisible();
	const box = await board.boundingBox();
	expect(box).toBeTruthy();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(1024);

	const first = page.locator('.eisenhower-quadrant').nth(0);
	const second = page.locator('.eisenhower-quadrant').nth(1);
	const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
	expect(firstBox).toBeTruthy();
	expect(secondBox).toBeTruthy();
	expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(4);
	expect(firstBox.x).toBeLessThan(secondBox.x);
});
