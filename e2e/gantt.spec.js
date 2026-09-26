import { expect, test } from '@playwright/test';
import { readPersistedTask, seedOfflineBoard } from './fixtures/board.js';
import { boxOf } from './fixtures/page.js';

test('opens an offline cached board and centers the Gantt timeline on today', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await expect(page.getByRole('button', { name: /새로고침/ })).toBeVisible();
	await page.getByRole('button', { name: /간트 뷰/ }).click();

	const timeline = page.locator('.gantt-timeline-area');
	const todayHeader = page.locator('.gantt-day-header.today');
	await expect(todayHeader).toBeVisible();

	const position = await todayHeader.evaluate((node) => {
		const timelineArea = node.closest('.gantt-timeline-area');
		if (!(timelineArea instanceof HTMLElement)) {
			return null;
		}

		const headerRect = node.getBoundingClientRect();
		const areaRect = timelineArea.getBoundingClientRect();
		return {
			headerCenter: headerRect.left + headerRect.width / 2,
			areaCenter: areaRect.left + areaRect.width / 2,
			areaWidth: areaRect.width
		};
	});

	expect(position).not.toBeNull();
	expect(Math.abs(position.headerCenter - position.areaCenter)).toBeLessThan(position.areaWidth * 0.2);
	await expect(timeline).toBeVisible();
});

test('opens the task form date picker and Gantt checklist preview', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /새 작업 추가/ }).click();
	await page.locator('.add-form .date-picker-toggle').click();
	await expect(page.locator('.add-form .date-picker-popover')).toBeVisible();
	await expect(page.locator('.add-form .date-picker-day.boundary').first()).toBeVisible();

	// Close the picker and the add sheet: on phone-width layouts the open
	// sheet overlays the view content and intercepts the clicks below.
	await page.locator('.add-form .date-picker-popover').getByRole('button', { name: '완료' }).click();
	await page.getByRole('button', { name: /닫기/ }).click();

	await page.getByRole('button', { name: /간트 뷰/ }).click();
	await page.locator('.gantt-sidebar-title', { hasText: 'E2E cached task' }).click();
	await expect(page.locator('.gantt-checklist-preview', { hasText: 'E2E checklist one' })).toBeVisible();
	await expect(page.locator('.gantt-checklist-preview', { hasText: 'E2E checklist done' })).toBeVisible();

	const row = page.locator('.gantt-sidebar-item', { hasText: 'E2E cached task' });
	await expect(row.locator('.gantt-checklist-count')).toHaveText('1/2');
	await row.getByRole('checkbox', { name: /E2E checklist one 완료/ }).check();
	await expect(row.locator('.gantt-checklist-count')).toHaveText('2/2');

	await page.reload();
	await page.getByRole('button', { name: /간트 뷰/ }).click();
	await page.locator('.gantt-sidebar-title', { hasText: 'E2E cached task' }).click();
	await expect(page.getByRole('checkbox', { name: /E2E checklist one 완료/ })).toBeChecked();

	await page.getByRole('button', { name: /칸반 뷰/ }).click();
	await expect(page.getByRole('button', { name: /일정 추가/ }).first()).toBeVisible();
});

/**
 * @param {string} dateString
 * @param {number} offset
 */
function shiftDate(dateString, offset) {
	const date = new Date(`${dateString}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + offset);
	return date.toISOString().slice(0, 10);
}

/**
 * Presses the end handle of a task's Gantt bar with the mouse.
 * @param {import('@playwright/test').Page} page
 * @param {string} taskText
 */
async function pressGanttEndHandle(page, taskText) {
	const bar = page.getByRole('button', { name: `${taskText} 일정 막대` });
	const handle = bar.locator('.resize-handle.end');
	await handle.scrollIntoViewIfNeeded();
	const box = await boxOf(handle);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	return { bar, x, y };
}

test('resizes a Gantt bar by dragging its end handle', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');
	await page.getByRole('button', { name: /간트 뷰/ }).click();

	const before = await readPersistedTask(page, 'local-e2e-task');
	const { bar, x, y } = await pressGanttEndHandle(page, 'E2E cached task');
	// Two 48px days to the right.
	await page.mouse.move(x + 60, y, { steps: 4 });
	await page.mouse.move(x + 96, y, { steps: 4 });
	await expect(bar).toHaveAttribute('title', `E2E cached task (${before.startDate} ~ ${shiftDate(before.endDate, 2)})`);
	await page.mouse.up();

	await expect
		.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
		.toBe(shiftDate(before.endDate, 2));
	expect((await readPersistedTask(page, 'local-e2e-task')).startDate).toBe(before.startDate);
	// Letting go of a resize is not a click on the bar: no detail panel.
	await expect(page.locator('.side-panel')).toHaveCount(0);
});

test('ignores a second pointer while a Gantt bar is being resized', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');
	await page.getByRole('button', { name: /간트 뷰/ }).click();

	const before = await readPersistedTask(page, 'local-e2e-task');
	const { bar, x, y } = await pressGanttEndHandle(page, 'E2E cached task');
	await page.mouse.move(x + 48, y, { steps: 4 });

	// A second finger (or a resting palm) moves far right and lifts while the
	// first pointer still holds the handle. The mouse is pointer 1.
	await page.evaluate(
		({ foreignX, foreignY }) => {
			const init = {
				pointerId: 99,
				pointerType: 'touch',
				isPrimary: false,
				clientX: foreignX,
				clientY: foreignY,
				bubbles: true
			};
			window.dispatchEvent(new PointerEvent('pointermove', init));
			window.dispatchEvent(new PointerEvent('pointerup', init));
			window.dispatchEvent(new PointerEvent('pointercancel', init));
		},
		{ foreignX: x + 480, foreignY: y }
	);
	await expect(bar).toHaveAttribute('title', `E2E cached task (${before.startDate} ~ ${shiftDate(before.endDate, 1)})`);
	expect((await readPersistedTask(page, 'local-e2e-task')).endDate).toBe(before.endDate);

	// The resize still follows the first pointer and ends when it lifts.
	await page.mouse.move(x + 96, y, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
		.toBe(shiftDate(before.endDate, 2));
});

test('ignores a second pointer pressing a handle while a Gantt bar is being resized', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');
	await page.getByRole('button', { name: /간트 뷰/ }).click();

	const before = await readPersistedTask(page, 'local-e2e-task');
	const { bar, x, y } = await pressGanttEndHandle(page, 'E2E cached task');
	await page.mouse.move(x + 48, y, { steps: 4 });

	// A second finger lands on the start handle mid-resize, drags far left and
	// lifts. It must not take the resize over from the mouse (pointer 1).
	const startHandle = bar.locator('.resize-handle.start');
	const startBox = await startHandle.boundingBox();
	expect(startBox).toBeTruthy();
	await startHandle.evaluate(
		(handle, { sx, sy }) => {
			const init = {
				pointerId: 99,
				pointerType: 'touch',
				isPrimary: false,
				clientX: sx,
				clientY: sy,
				bubbles: true,
				cancelable: true
			};
			handle.dispatchEvent(new PointerEvent('pointerdown', init));
			window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: sx - 480 }));
			window.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: sx - 480 }));
		},
		{ sx: startBox.x + startBox.width / 2, sy: startBox.y + startBox.height / 2 }
	);
	await expect(bar).toHaveAttribute('title', `E2E cached task (${before.startDate} ~ ${shiftDate(before.endDate, 1)})`);
	expect(await readPersistedTask(page, 'local-e2e-task')).toMatchObject({
		startDate: before.startDate,
		endDate: before.endDate
	});

	// The mouse still owns the resize and commits only its own edge.
	await page.mouse.move(x + 96, y, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
		.toBe(shiftDate(before.endDate, 2));
	expect((await readPersistedTask(page, 'local-e2e-task')).startDate).toBe(before.startDate);
});
