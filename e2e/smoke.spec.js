import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('keeps the private app locked before login', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /나의 칸반 보드/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /칸반 뷰/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /매트릭스/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /불러오기/ })).toBeHidden();
});

test('keeps locked auth controls within an iPhone viewport', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);

	const authPanel = page.locator('.locked-app-state .auth-panel');
	await expect(authPanel).toBeVisible();

	const boxes = await authPanel.locator('input, button').evaluateAll((elements) =>
		elements.map((element) => {
			const box = element.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				width: box.width
			};
		})
	);

	expect(boxes.length).toBeGreaterThan(0);
	for (const box of boxes) {
		expect(box.left).toBeGreaterThanOrEqual(0);
		expect(box.right).toBeLessThanOrEqual(393);
		expect(box.width).toBeGreaterThan(0);
	}
});

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
 * @param {import('@playwright/test').Page} page
 * @param {string} taskId
 */
function readPersistedTask(page, taskId) {
	return page.evaluate((id) =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]').find((task) => task.id === id),
	taskId);
}

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
	const box = await handle.boundingBox();
	expect(box).toBeTruthy();
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

	await expect.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
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
	await page.evaluate(({ foreignX, foreignY }) => {
		const init = { pointerId: 99, pointerType: 'touch', isPrimary: false, clientX: foreignX, clientY: foreignY, bubbles: true };
		window.dispatchEvent(new PointerEvent('pointermove', init));
		window.dispatchEvent(new PointerEvent('pointerup', init));
		window.dispatchEvent(new PointerEvent('pointercancel', init));
	}, { foreignX: x + 480, foreignY: y });
	await expect(bar).toHaveAttribute('title', `E2E cached task (${before.startDate} ~ ${shiftDate(before.endDate, 1)})`);
	expect((await readPersistedTask(page, 'local-e2e-task')).endDate).toBe(before.endDate);

	// The resize still follows the first pointer and ends when it lifts.
	await page.mouse.move(x + 96, y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
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
	await startHandle.evaluate((handle, { sx, sy }) => {
		const init = { pointerId: 99, pointerType: 'touch', isPrimary: false, clientX: sx, clientY: sy, bubbles: true, cancelable: true };
		handle.dispatchEvent(new PointerEvent('pointerdown', init));
		window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: sx - 480 }));
		window.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: sx - 480 }));
	}, { sx: startBox.x + startBox.width / 2, sy: startBox.y + startBox.height / 2 });
	await expect(bar).toHaveAttribute('title', `E2E cached task (${before.startDate} ~ ${shiftDate(before.endDate, 1)})`);
	expect(await readPersistedTask(page, 'local-e2e-task')).toMatchObject({
		startDate: before.startDate,
		endDate: before.endDate
	});

	// The mouse still owns the resize and commits only its own edge.
	await page.mouse.move(x + 96, y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await readPersistedTask(page, 'local-e2e-task')).endDate)
		.toBe(shiftDate(before.endDate, 2));
	expect((await readPersistedTask(page, 'local-e2e-task')).startDate).toBe(before.startDate);
});

test('suggests categories and manages category names offline', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /새 작업 추가/ }).click();
	await page.getByLabel('작업명').fill('네트워크 개념 공부');
	await page.getByRole('button', { name: /CS 공부/ }).click();
	await expect(page.getByLabel('카테고리')).toHaveValue('CS 공부');
	await page.getByRole('button', { name: /작업 추가/ }).click();

	await expect(page.getByText('네트워크 개념 공부')).toBeVisible();
	await page.getByRole('button', { name: '관리' }).click();
	await expect(page.getByRole('dialog', { name: '카테고리 관리' })).toBeVisible();

	const categoryRow = page.locator('.category-manager-row', { hasText: 'CS 공부' });
	await expect(categoryRow).toContainText('1 진행');
	await categoryRow.getByRole('button', { name: '이름 변경' }).click();
	await page.locator('.category-rename-input').fill('공부');
	await page.getByRole('button', { name: '저장' }).click();

	await expect(page.locator('.category-manager-row', { hasText: '공부' })).toBeVisible();
	await page.getByRole('dialog', { name: '카테고리 관리' }).getByRole('button', { name: '✕' }).click();
	await expect(page.getByRole('dialog', { name: '카테고리 관리' })).toBeHidden();
	await expect(page.locator('.category-tag', { hasText: '공부' }).first()).toBeVisible();
});

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

	const boxes = await Promise.all([
		todo.boundingBox(),
		doing.boundingBox(),
		done.boundingBox()
	]);
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

	const boxes = await Promise.all([
		todo.boundingBox(),
		doing.boundingBox(),
		done.boundingBox()
	]);
	expect(boxes.every(Boolean)).toBe(true);
	expect(boxes[0].y).toBeLessThan(boxes[1].y);
	expect(boxes[1].y).toBeLessThan(boxes[2].y);
});

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

/**
 * Plays the event sequence a Korean IME produces around the Enter that
 * confirms the last syllable. Playwright cannot drive a real IME, so this
 * only checks how the inputs react to those events; the real thing needs a
 * manual check with the Korean keyboard on a Mac and an iPhone.
 * @param {import('@playwright/test').Locator} input
 */
async function pressEnterThroughImeComposition(input) {
	await input.evaluate((node) => {
		const enter = (init = {}) => node.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
			...init
		}));
		node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		enter({ isComposing: true });
		// Some engines report the composing Enter without isComposing.
		enter();
		node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		// The confirming Enter's keydown right after compositionend.
		enter();
	});
}

/**
 * @param {import('@playwright/test').Locator} input
 */
async function pressEnterOnNextTask(input) {
	await input.evaluate(async (node) => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	});
}

test('does not submit the Enter that confirms an IME composition', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');

	const card = cardByTitle(page, 'E2E cached task');
	const checklistInput = card.locator('.add-subtask-input');
	await checklistInput.fill('한글 항목');
	await pressEnterThroughImeComposition(checklistInput);
	await expect(card.locator('.subtask-item')).toHaveCount(2);
	await expect(checklistInput).toHaveValue('한글 항목');
	// A later, separate Enter adds the item exactly once.
	await pressEnterOnNextTask(checklistInput);
	await expect(card.locator('.subtask-item')).toHaveCount(3);
	await expect(card.locator('.subtask-text').nth(2)).toHaveText('한글 항목');
	await expect(checklistInput).toHaveValue('');

	await page.getByRole('button', { name: /새 작업 추가/ }).click();
	const titleInput = page.locator('#task-text');
	await titleInput.fill('한글 작업');
	await pressEnterThroughImeComposition(titleInput);
	await expect(titleInput).toHaveValue('한글 작업');
	await expect(page.locator('.card-text', { hasText: '한글 작업' })).toHaveCount(0);
	await pressEnterOnNextTask(titleInput);
	await expect(page.locator('.card-text', { hasText: '한글 작업' })).toHaveCount(1);
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

test('narrows every view with the search box and highlights overdue work', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByLabel('작업 검색').fill('Urgent');

	await expect(page.getByText('Urgent important')).toBeVisible();
	await expect(page.getByText('E2E cached task')).toBeHidden();

	await page.getByRole('button', { name: '검색 지우기' }).click();
	await expect(page.getByText('E2E cached task')).toBeVisible();
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 */
function cardByTitle(page, title) {
	return page.locator('.task-card', { has: page.locator('.card-text', { hasText: title }) });
}

test.describe('in Korea before 09:00', () => {
	test.use({ timezoneId: 'Asia/Seoul' });

	test('names the backup export with the local date, not the UTC one', async ({ page }) => {
		// 2026-09-24 08:30 KST is still 2026-09-23 in UTC.
		await page.clock.setFixedTime(new Date('2026-09-23T23:30:00.000Z'));
		await seedOfflineBoard(page);
		await page.goto('/');

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '백업 JSON 내보내기' }).click();
		const download = await downloadPromise;

		expect(download.suggestedFilename()).toBe('kanban_backup_2026-09-24.json');
		const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
		expect(exported.map((task) => task.text)).toContain('E2E cached task');
	});
});

test('asks the same delete question on a card and in the detail panel', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');

	/** @type {string[]} */
	const questions = [];
	page.on('dialog', (dialog) => {
		questions.push(`${dialog.type()}:${dialog.message()}`);
		void dialog.dismiss();
	});

	const modal = page.locator('.side-panel');
	const parentCard = cardByTitle(page, 'Nested parent task');
	await parentCard.getByRole('button', { name: 'Nested parent task 삭제', exact: true }).click();
	await parentCard.locator('.card-text').click();
	await modal.getByRole('button', { name: /작업 삭제/ }).click();
	await modal.locator('.close-btn').click();
	await expect(modal).toHaveCount(0);

	const childCard = cardByTitle(page, 'Nested child task');
	await childCard.getByRole('button', { name: 'Nested child task 삭제', exact: true }).click();
	await childCard.locator('.card-text').click();
	await modal.getByRole('button', { name: /작업 삭제/ }).click();

	const withChildren = 'confirm:이 작업에는 1개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?';
	const leaf = 'confirm:이 작업을 삭제하시겠습니까?';
	await expect.poll(() => questions).toEqual([withChildren, withChildren, leaf, leaf]);
	// Dismissing the question deletes nothing and keeps the panel open.
	await expect(modal).toBeVisible();
	await expect(parentCard).toBeVisible();
	await expect(childCard).toBeVisible();
});

test('shows the card labels for status, priority and urgency in the detail panel', async ({ page }) => {
	await seedOfflineBoard(page, {
		extraTasks: [{ id: 'local-low-done', text: 'Low priority finished task', status: 'done', priority: 'low', urgency: 'normal' }]
	});
	await page.goto('/');

	const modal = page.locator('.side-panel');
	/** @type {Array<[string, [string, string, string], [string, string, string]]>} */
	const cases = [
		['Urgent important', ['할 일', '🔴 높음', '🔥 시급'], ['todo', 'high', 'urgent']],
		['Planned important', ['진행 중', '🔴 높음', '⏳ 여유'], ['doing', 'high', 'normal']],
		['E2E cached task', ['할 일', '🟡 보통', '⏳ 여유'], ['todo', 'medium', 'normal']],
		['Low priority finished task', ['완료', '🟢 낮음', '⏳ 여유'], ['done', 'low', 'normal']]
	];

	for (const [title, [status, priority, urgency], [statusValue, priorityValue, urgencyValue]] of cases) {
		const card = cardByTitle(page, title);
		await expect(card.locator('.priority-badge')).toHaveText(priority);
		await expect(card.locator('.urgency-badge')).toHaveText(urgency);

		await card.locator('.card-text').click();
		await expect(modal).toBeVisible();
		expect(await modal.locator('.summary-row .summary-chip').evaluateAll((chips) =>
			chips.slice(0, 3).map((chip) => chip.textContent)
		)).toEqual([status, priority, urgency]);
		await expect(modal.locator('#modal-status')).toHaveValue(statusValue);
		await expect(modal.locator('#modal-priority')).toHaveValue(priorityValue);
		await expect(modal.locator('#modal-urgency')).toHaveValue(urgencyValue);

		expect(await modal.locator('#modal-status option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['todo', '할 일'], ['doing', '진행 중'], ['done', '완료']]);
		expect(await modal.locator('#modal-priority option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['high', '🔴 높음'], ['medium', '🟡 보통'], ['low', '🟢 낮음']]);
		expect(await modal.locator('#modal-urgency option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['urgent', '🔥 시급'], ['normal', '⏳ 여유']]);

		await modal.locator('.close-btn').click();
		await expect(modal).toHaveCount(0);
	}

	// The selects still edit the task and the chips follow.
	await cardByTitle(page, 'E2E cached task').locator('.card-text').click();
	await modal.locator('#modal-priority').selectOption('low');
	await modal.locator('#modal-urgency').selectOption('urgent');
	await expect(modal.locator('.priority-chip')).toHaveText('🟢 낮음');
	await expect(modal.locator('.urgency-chip')).toHaveText('🔥 시급');
	await expect(modal.locator('#modal-priority')).toHaveValue('low');
	await modal.locator('.close-btn').click();
	await expect(cardByTitle(page, 'E2E cached task').locator('.priority-badge')).toHaveText('🟢 낮음');
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} card
 * @param {{ x: number; y: number }} dropPoint
 */
async function pointerDrag(page, card, dropPoint) {
	await card.scrollIntoViewIfNeeded();
	const cardBox = await card.boundingBox();
	expect(cardBox).toBeTruthy();

	// Pointer-based drag: press, cross the activation threshold, drop.
	await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 12);
	await page.mouse.down();
	await page.mouse.move(cardBox.x + cardBox.width / 2 + 30, cardBox.y + 44, { steps: 5 });
	await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 10 });
	await page.mouse.up();
}

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
	const persistedStatus = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]')
			.find((task) => task.id === 'local-e2e-task')?.status
	);
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
	const parentId = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]')
			.find((task) => task.id === 'local-child-task')?.parentId
	);
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

const LINK_TASKS = [
	{
		id: 'local-link-parent',
		text: 'E2E 링크 모음',
		subtasks: [
			{ id: 'local-link-nrf', text: '한국연구재단(https://www.nrf.re.kr/index)', done: false },
			// Checked items are included in "open all".
			{ id: 'local-link-kss', text: 'https://kss.or.kr/,', done: true }
		]
	},
	{
		id: 'local-link-child',
		text: 'E2E 링크 하위',
		parentId: 'local-link-parent',
		subtasks: [
			{ id: 'local-link-ksbmb', text: '학회 https://www.ksbmb.or.kr', done: false },
			{ id: 'local-link-kams', text: 'www.kams.or.kr.', done: false }
		]
	}
];

const LINK_TASK_URLS = [
	'https://www.nrf.re.kr/index',
	'https://kss.or.kr/',
	'https://www.ksbmb.or.kr/',
	'https://www.kams.or.kr/'
];

/**
 * Replaces window.open with a recorder and blocks every non-local host, so
 * no test ever reaches a real external site. Real pop-up blocking cannot be
 * exercised here (Playwright Chromium runs with --disable-popup-blocking and
 * Playwright WebKit does not block either), so 'one-per-click' models it:
 * each click grants a single window.open, like Chromium/Brave and Safari
 * before the site is allowed pop-ups.
 * @param {import('@playwright/test').Page} page
 * @param {'allow' | 'one-per-click' | 'block'} [mode]
 */
async function stubWindowOpen(page, mode = 'allow') {
	await page.context().route(
		(url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
		(route) => route.abort()
	);
	await page.addInitScript((openMode) => {
		const calls = [];
		let allowance = openMode === 'allow' ? Number.POSITIVE_INFINITY : 0;
		if (openMode === 'one-per-click') {
			window.addEventListener('click', () => {
				allowance = 1;
			}, true);
		}
		Object.defineProperty(window, '__opened', { value: calls });
		window.open = (...args) => {
			calls.push(args);
			if (allowance <= 0) {
				return null;
			}
			allowance -= 1;
			return {};
		};
	}, mode);
}

/**
 * @param {import('@playwright/test').Page} page
 */
function readOpenedUrls(page) {
	return page.evaluate(() => window.__opened.map((args) => args[0]));
}

/**
 * @param {import('@playwright/test').Page} page
 */
function linkParentCard(page) {
	return page.locator('.task-card', { has: page.locator('.card-text', { hasText: 'E2E 링크 모음' }) });
}

test('renders checklist links without trailing punctuation and opens them all', async ({ page }) => {
	await stubWindowOpen(page);
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });
	// Records open-links clicks that bubble past the app root. Svelte
	// dispatches onclick from the root, so OpenLinksButton's stopPropagation
	// is what keeps a click from reaching window (and any card-level
	// handler added later).
	await page.addInitScript(() => {
		const bubbled = [];
		Object.defineProperty(window, '__bubbled', { value: bubbled });
		window.addEventListener('click', (event) => {
			const button = event.target instanceof Element ? event.target.closest('.btn-open-links') : null;
			if (button) {
				bubbled.push(button.textContent.trim());
			}
		});
	});

	await page.goto('/');
	const card = linkParentCard(page);
	await expect(card).toBeVisible();

	const links = card.locator('a.subtask-link');
	await expect(links).toHaveCount(2);
	await expect(links.nth(0)).toHaveAttribute('href', 'https://www.nrf.re.kr/index');
	await expect(links.nth(0)).toHaveText('https://www.nrf.re.kr/index');
	await expect(links.nth(0)).toHaveAttribute('target', '_blank');
	await expect(links.nth(1)).toHaveAttribute('href', 'https://kss.or.kr/');
	await expect(links.nth(1)).toHaveText('https://kss.or.kr/');
	await expect(card.locator('.subtask-text').first()).toHaveText('한국연구재단(https://www.nrf.re.kr/index)');

	const ownButton = card.getByRole('button', { name: '모두 열기 (2)', exact: true });
	const subtreeButton = card.getByRole('button', { name: '하위 포함 모두 열기 (4)', exact: true });
	// The accessible name is the visible label (WCAG 2.5.3); the longer
	// wording is the tooltip and accessible description.
	await expect(ownButton).toHaveAccessibleDescription('체크리스트 링크 2개를 새 탭에서 모두 열기');
	await expect(subtreeButton).toHaveAccessibleDescription('하위 작업 포함 링크 4개를 새 탭에서 모두 열기');
	// The child card has 2 links of its own and no children.
	const childCard = page.locator('.task-card', { has: page.locator('.card-text', { hasText: 'E2E 링크 하위' }) });
	await expect(childCard.getByRole('button', { name: '모두 열기 (2)', exact: true })).toBeVisible();

	// A permanent live region carries only the short result message; the
	// panel itself is not a live region, so steps are not re-read in full.
	const liveRegion = page.locator('.link-open-live');
	await expect(liveRegion).toHaveCount(1);
	await expect(liveRegion).toHaveAttribute('role', 'status');
	await expect(liveRegion).toHaveText('');

	// Pressing an open-links button and moving past the 4px mouse threshold
	// must not pick up the card: pointer-dnd ignores presses on buttons.
	await subtreeButton.scrollIntoViewIfNeeded();
	const pressBox = await subtreeButton.boundingBox();
	expect(pressBox).toBeTruthy();
	await page.mouse.move(pressBox.x + pressBox.width / 2, pressBox.y + pressBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(pressBox.x + pressBox.width / 2 + 40, pressBox.y + pressBox.height / 2 + 40, { steps: 5 });
	await expect(page.locator('.dnd-ghost')).toHaveCount(0);
	await expect(page.locator('.dnd-source')).toHaveCount(0);
	await page.mouse.up();
	expect(await readOpenedUrls(page)).toEqual([]);

	await subtreeButton.click();
	expect(await readOpenedUrls(page)).toEqual(LINK_TASK_URLS);
	// window.open(url, '_blank') with no features string: 'noopener' would
	// make it return null even on success and hide blocked tabs.
	expect(await page.evaluate(() => window.__opened.map((args) => args.slice(1)))).toEqual([
		['_blank'],
		['_blank'],
		['_blank'],
		['_blank']
	]);

	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('링크 4개를 새 탭으로 열었습니다.');
	await expect(liveRegion).toHaveText('링크 4개를 새 탭으로 열었습니다.');
	await expect(panel).not.toHaveAttribute('role');
	await expect(panel).not.toHaveAttribute('aria-live');
	// The click stopped at the button: it neither bubbled out of the app nor
	// opened the detail modal or started a drag.
	expect(await page.evaluate(() => window.__bubbled)).toEqual([]);
	await expect(page.locator('.side-panel')).toHaveCount(0);
	await expect(page.locator('.dnd-ghost')).toHaveCount(0);
	const persisted = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]')
			.filter((task) => task.id.startsWith('local-link-'))
			.map((task) => [task.id, task.status, task.parentId])
	);
	expect(persisted).toEqual([
		['local-link-parent', 'todo', null],
		['local-link-child', 'todo', 'local-link-parent']
	]);
	await panel.getByRole('button', { name: '닫기' }).click();
	await expect(panel).toHaveCount(0);

	// Keyboard activation opens the task's own links. A full success only
	// announces itself; focus stays on the button.
	await ownButton.focus();
	await page.keyboard.press('Enter');
	expect(await readOpenedUrls(page)).toEqual([...LINK_TASK_URLS, ...LINK_TASK_URLS.slice(0, 2)]);
	await expect(panel).toContainText('링크 2개를 새 탭으로 열었습니다.');
	await expect(ownButton).toBeFocused();
	await panel.getByRole('button', { name: '닫기' }).click();

	// The detail modal (the only entry point from Gantt) offers the same buttons.
	await card.locator('.card-text').click();
	const modal = page.locator('.side-panel');
	await expect(modal).toBeVisible();
	await expect(modal.getByRole('button', { name: '모두 열기 (2)', exact: true })).toBeVisible();
	const modalSubtree = modal.getByRole('button', { name: '하위 포함 모두 열기 (4)', exact: true });
	await expect(modalSubtree).toHaveAccessibleDescription('하위 작업 포함 링크 4개를 새 탭에서 모두 열기');
	// They sit in the body, so the footer keeps its layout: on the 440px side
	// panel they used to squeeze '작업 삭제' into a 3-line column, and on
	// phones every footer button is its own full-width row.
	await expect(modal.locator('.panel-footer .btn-open-links')).toHaveCount(0);
	const deleteBox = await modal.locator('.panel-footer .btn-danger').boundingBox();
	expect(deleteBox).toBeTruthy();
	expect(deleteBox.height).toBeLessThan(50);
	await modalSubtree.click();
	expect(await readOpenedUrls(page)).toHaveLength(10);
	await expect(panel).toContainText('링크 4개를 새 탭으로 열었습니다.');
	await expect(modal).toBeVisible();
	expect(await page.evaluate(() => window.__bubbled)).toEqual([]);
});

test('falls back to a link list when the browser blocks pop-ups', async ({ page }) => {
	await stubWindowOpen(page, 'one-per-click');
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });

	await page.goto('/');
	await linkParentCard(page).getByRole('button', { name: '하위 포함 모두 열기 (4)', exact: true }).click();
	expect(await readOpenedUrls(page)).toEqual(LINK_TASK_URLS);

	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('링크 4개 중 1개만 열렸습니다');
	await expect(panel).toContainText('brave://settings/content/popups');
	await expect(page.locator('.link-open-live')).toHaveText(
		'링크 4개 중 1개만 열렸습니다. 브라우저가 나머지를 팝업으로 차단했습니다.'
	);
	// The panel is mounted last in the page: focus moves to its next step
	// instead of leaving keyboard users a board's worth of Tab stops away.
	await expect(panel.getByRole('button', { name: '다음 링크 열기 (1/3)' })).toBeFocused();
	const fallbackLinks = panel.locator('a');
	await expect(fallbackLinks).toHaveCount(3);
	expect(await fallbackLinks.evaluateAll((anchors) =>
		anchors.map((anchor) => [anchor.getAttribute('href'), anchor.getAttribute('target'), anchor.getAttribute('rel')])
	)).toEqual(LINK_TASK_URLS.slice(1).map((href) => [href, '_blank', 'noopener noreferrer']));

	// Each step is a fresh click, so exactly one more window.open per click.
	await panel.getByRole('button', { name: '다음 링크 열기 (1/3)' }).click();
	expect(await readOpenedUrls(page)).toEqual([...LINK_TASK_URLS, LINK_TASK_URLS[1]]);
	await expect(fallbackLinks).toHaveCount(2);

	await panel.getByRole('button', { name: '다음 링크 열기 (2/3)' }).click();
	expect(await readOpenedUrls(page)).toEqual([...LINK_TASK_URLS, ...LINK_TASK_URLS.slice(1, 3)]);

	await panel.getByRole('button', { name: '다음 링크 열기 (3/3)' }).click();
	expect(await readOpenedUrls(page)).toEqual([...LINK_TASK_URLS, ...LINK_TASK_URLS.slice(1)]);
	await expect(panel).toContainText('링크 4개를 새 탭으로 열었습니다.');
	await expect(fallbackLinks).toHaveCount(0);
	// The step button is gone, so focus lands on 닫기 rather than <body>.
	await expect(panel.getByRole('button', { name: '닫기' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
});

test('lists every link when new tabs cannot be opened at all', async ({ page }) => {
	await stubWindowOpen(page, 'block');
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });

	await page.goto('/');
	await linkParentCard(page).getByRole('button', { name: '하위 포함 모두 열기 (4)', exact: true }).click();

	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('이 환경에서는 새 탭을 자동으로 열 수 없습니다.');
	await expect(panel.locator('a[target="_blank"]')).toHaveCount(4);
	await expect(panel.getByRole('button', { name: '다음 링크 열기 (1/4)' })).toBeFocused();

	// A single fresh open failing too hides the step button; the list stays
	// and focus moves to its first link.
	await panel.getByRole('button', { name: '다음 링크 열기 (1/4)' }).click();
	await expect(panel.getByRole('button', { name: /다음 링크 열기/ })).toHaveCount(0);
	await expect(panel.locator('a[target="_blank"]')).toHaveCount(4);
	await expect(panel.locator('a[target="_blank"]').first()).toBeFocused();
});

const MANY_LINK_URLS = Array.from({ length: 21 }, (_, index) => `https://example.com/doc/${index + 1}`);

const MANY_LINK_TASKS = [
	{
		id: 'local-many-links',
		text: 'E2E 링크 21개',
		subtasks: MANY_LINK_URLS.map((url, index) => ({ id: `local-many-link-${index + 1}`, text: `자료 ${index + 1} ${url}`, done: false }))
	}
];

test('confirms more than 10 links and opens them in batches of 20 from the keyboard', async ({ page }) => {
	await stubWindowOpen(page);
	await seedOfflineBoard(page, { extraTasks: MANY_LINK_TASKS });

	await page.goto('/');
	const card = page.locator('.task-card', { has: page.locator('.card-text', { hasText: 'E2E 링크 21개' }) });
	const trigger = card.getByRole('button', { name: '모두 열기 (21)', exact: true });
	await trigger.focus();
	await page.keyboard.press('Enter');

	// Above 10 links nothing opens until a second, confirming activation.
	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('링크 21개를 새 탭으로 엽니다.');
	await expect(panel).toContainText('한 번에 최대 20개씩 엽니다.');
	expect(await readOpenedUrls(page)).toEqual([]);
	const confirmButton = panel.getByRole('button', { name: '모두 열기', exact: true });
	await expect(confirmButton).toBeFocused();

	await page.keyboard.press('Enter');
	expect(await readOpenedUrls(page)).toEqual(MANY_LINK_URLS.slice(0, 20));
	await expect(panel).toContainText('링크 20개를 새 탭으로 열었습니다.');
	const remainingButton = panel.getByRole('button', { name: '나머지 1개 열기' });
	await expect(remainingButton).toBeFocused();

	await page.keyboard.press('Enter');
	expect(await readOpenedUrls(page)).toEqual(MANY_LINK_URLS);
	await expect(panel).toContainText('링크 21개를 새 탭으로 열었습니다.');
	await expect(panel.getByRole('button', { name: '닫기' })).toBeFocused();

	// Escape closes the panel and returns focus to the button that opened it.
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(trigger).toBeFocused();

	// 취소 opens nothing.
	await page.keyboard.press('Enter');
	await expect(confirmButton).toBeFocused();
	await panel.getByRole('button', { name: '취소' }).click();
	await expect(panel).toHaveCount(0);
	expect(await readOpenedUrls(page)).toEqual(MANY_LINK_URLS);
});

test('drops a leftover link panel when another account signs in', async ({ page }) => {
	await stubWindowOpen(page, 'one-per-click');
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });

	await page.goto('/');
	await linkParentCard(page).getByRole('button', { name: '하위 포함 모두 열기 (4)', exact: true }).click();
	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('링크 4개 중 1개만 열렸습니다');

	// Another account's session arrives in the same tab, with no page reload
	// (sign-out, then a different sign-in). The DB-less server has no auth, so
	// the session and task endpoints are faked here.
	await page.route('**/api/auth/get-session**', (route) => route.fulfill({
		json: {
			session: { id: 'e2e-session-2', userId: 'e2e-user-2', expiresAt: '2099-01-01T00:00:00.000Z' },
			user: { id: 'e2e-user-2', email: 'other@example.com', name: null }
		}
	}));
	await page.route('**/api/tasks**', (route) => route.fulfill({ status: 503, json: { message: 'unavailable' } }));
	await page.evaluate(() => window.dispatchEvent(new Event('online')));

	await expect(page.locator('.auth-identity')).toHaveText('other@example.com');
	await expect(page.getByRole('button', { name: /간트 뷰/ })).toBeVisible();
	// The previous account's task title and URLs must not reappear.
	await expect(panel).toHaveCount(0);
	await expect(page.getByText('E2E 링크 모음')).toHaveCount(0);
});

/**
 * @param {Array<Record<string, unknown>> | Record<string, unknown> | string} content
 */
function backupFile(content) {
	return {
		name: 'kanban_backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
	};
}

/**
 * Records every alert/confirm text. Confirms take the next queued answer
 * (dismissed when none is left); alerts are just closed.
 * @param {import('@playwright/test').Page} page
 * @param {boolean[]} [confirmAnswers]
 */
function recordDialogs(page, confirmAnswers = []) {
	/** @type {string[]} */
	const dialogs = [];
	page.on('dialog', (dialog) => {
		dialogs.push(`${dialog.type()}:${dialog.message()}`);
		if (dialog.type() === 'confirm' && confirmAnswers.shift()) {
			void dialog.accept();
		} else {
			void dialog.dismiss();
		}
	});
	return dialogs;
}

test('imports a backup file by replacing or appending, and reports unreadable files', async ({ page }) => {
	await seedOfflineBoard(page);
	const dialogs = recordDialogs(page, [true, false]);
	/** @type {string[]} */
	const importRequests = [];
	await page.route('**/api/import**', (route) => {
		const url = new URL(route.request().url());
		importRequests.push(`${url.pathname}${url.search}`);
		if (url.searchParams.get('mode') === 'replace') {
			return route.fulfill({
				json: {
					tasks: [{ id: '33333333-3333-4333-8333-333333333333', text: 'Server imported task', status: 'todo' }],
					summary: {
						receivedTasks: 1,
						importedTasks: 1,
						skippedTasks: 0,
						importedChecklistItems: 0,
						skippedChecklistItems: 0,
						repairedParentLinks: 0,
						replacedTasks: 7
					}
				}
			});
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	await expect(page.getByText('E2E cached task')).toBeVisible();
	const fileInput = page.locator('#import-file');

	// Confirm accepted: replace through the server, which answers with its list.
	await fileInput.setInputFiles(backupFile([{ id: 'backup-replaced', text: 'Backup replaced task' }]));
	await expect.poll(() => dialogs).toEqual([
		'confirm:현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.',
		'alert:데이터를 성공적으로 불러왔습니다. 가져온 작업: 1개. 교체된 작업: 7개.'
	]);
	await expect(page.getByText('Server imported task')).toBeVisible();
	await expect(page.getByText('E2E cached task')).toHaveCount(0);
	await expect(fileInput).toHaveValue('');

	// Confirm dismissed: append. The server is unavailable, so the file lands
	// on this device first and is queued for the server.
	await fileInput.setInputFiles(backupFile({ tasks: [{ id: 'backup-appended', text: 'Backup appended task' }] }));
	await expect.poll(() => dialogs.length).toBe(4);
	expect(dialogs.slice(2)).toEqual([
		'confirm:현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.',
		'alert:오프라인 상태라 이 기기에 먼저 불러왔습니다. 온라인이 되면 서버와 다른 기기에 자동 반영을 시도합니다.'
	]);
	await expect(page.getByText('Server imported task')).toBeVisible();
	await expect(page.getByText('Backup appended task')).toBeVisible();
	expect(importRequests).toEqual(['/api/import?mode=replace', '/api/import']);
	const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('kanbanOfflineWriteQueue:e2e-user') ?? '[]'));
	expect(queued).toEqual([expect.objectContaining({ type: 'import.tasks', mode: 'append', localTaskIds: ['backup-appended'] })]);

	// Not a backup shape, then not JSON at all: nothing is asked or sent.
	await fileInput.setInputFiles(backupFile({ notTasks: true }));
	await expect.poll(() => dialogs.length).toBe(5);
	await fileInput.setInputFiles(backupFile('{ not json'));
	await expect.poll(() => dialogs.length).toBe(6);
	expect(dialogs.slice(4)).toEqual([
		'alert:올바른 칸반 데이터 형식이 아닙니다.',
		'alert:파일을 읽는 중 오류가 발생했습니다.'
	]);
	expect(importRequests).toHaveLength(2);
	await expect(fileInput).toHaveValue('');
});

const CONFLICT_TASK_ID = '44444444-4444-4444-8444-444444444444';
const CONFLICT_DELETE_TASK_ID = '55555555-5555-4555-8555-555555555555';

test('lists offline conflicts and applies, keeps or saves them', async ({ page }) => {
	await seedOfflineBoard(page);
	// Three queued offline writes that the server rejects with 409.
	await page.addInitScript(({ taskId, deleteTaskId }) => {
		if (sessionStorage.getItem('e2e-conflicts-seeded')) {
			return;
		}
		sessionStorage.setItem('e2e-conflicts-seeded', '1');
		const base = { ownerUserId: 'e2e-user', createdAt: Date.now(), attempts: 0 };
		localStorage.setItem('kanbanOfflineWriteQueue:e2e-user', JSON.stringify([
			{ ...base, id: 'conflict-patch', type: 'task.patch', taskId, patch: { text: 'My offline title', expectedVersion: 2 } },
			{ ...base, id: 'conflict-delete', type: 'task.delete', taskId: deleteTaskId, expectedVersion: 1 },
			{ ...base, id: 'conflict-checklist', type: 'checklist.patch', taskId, itemId: '66666666-6666-4666-8666-666666666666', patch: { done: true } }
		]));
	}, { taskId: CONFLICT_TASK_ID, deleteTaskId: CONFLICT_DELETE_TASK_ID });

	const serverTasks = [
		{ id: CONFLICT_TASK_ID, text: 'Conflict server task', status: 'todo', version: 3 },
		{ id: CONFLICT_DELETE_TASK_ID, text: 'Conflict kept task', status: 'todo', version: 2 }
	];
	/** @type {string[]} */
	const writes = [];
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({
				json: {
					session: { id: 'e2e-session', userId: 'e2e-user', expiresAt: '2099-01-01T00:00:00.000Z' },
					user: { id: 'e2e-user', email: 'e2e@example.com', name: null }
				}
			});
		}
		if (pathname === '/api/tasks' && request.method() === 'GET') {
			return route.fulfill({ json: { tasks: serverTasks } });
		}
		if (pathname.startsWith('/api/tasks/') && request.method() !== 'GET') {
			writes.push(`${request.method()} ${pathname}`);
			if (writes.length <= 3) {
				return route.fulfill({ status: 409, json: { message: 'Version conflict.' } });
			}
			const patch = request.postDataJSON() ?? {};
			return route.fulfill({ json: { task: { ...serverTasks[0], ...patch, version: 4 } } });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const banner = page.locator('.sync-notice.conflict-notice');
	await expect(banner).toHaveAttribute('role', 'status');
	await expect(banner).toContainText('오프라인 변경 3건이 서버의 최신 상태와 충돌했습니다.');
	expect(writes).toEqual([
		`PATCH /api/tasks/${CONFLICT_TASK_ID}`,
		`DELETE /api/tasks/${CONFLICT_DELETE_TASK_ID}`,
		`PATCH /api/tasks/${CONFLICT_TASK_ID}/checklist/66666666-6666-4666-8666-666666666666`
	]);

	const rows = banner.locator('.sync-conflict-row');
	await expect(rows).toHaveCount(0);
	await banner.getByRole('button', { name: '내역 보기' }).click();
	await expect(banner.getByRole('button', { name: '내역 닫기' })).toBeVisible();
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0).locator('strong')).toHaveText('작업 수정');
	await expect(rows.nth(0).locator('span')).toHaveText('Conflict server task');
	await expect(rows.nth(0).locator('small')).toHaveText('충돌 필드: 작업명');
	await expect(rows.nth(1).locator('strong')).toHaveText('작업 삭제');
	await expect(rows.nth(1).locator('span')).toHaveText('Conflict kept task');
	await expect(rows.nth(1).locator('small')).toHaveText('서버의 최신 버전과 맞지 않아 삭제가 적용되지 않았습니다.');
	await expect(rows.nth(2).locator('strong')).toHaveText('체크리스트 수정');
	await expect(rows.nth(2).locator('small')).toHaveText('체크리스트 변경을 서버에 적용하지 못했습니다.');
	const applyButtons = banner.getByRole('button', { name: '내 변경 적용' });
	await expect(applyButtons.nth(0)).toBeEnabled();
	await expect(applyButtons.nth(0)).toHaveAttribute('title', '내 오프라인 변경을 최신 서버 상태 위에 다시 적용합니다.');
	await expect(applyButtons.nth(1)).toBeEnabled();
	await expect(applyButtons.nth(2)).toBeDisabled();
	await expect(applyButtons.nth(2)).toHaveAttribute('title', '이 충돌은 내역 저장 후 수동 확인이 안전합니다.');

	const downloadPromise = page.waitForEvent('download');
	await banner.getByRole('button', { name: '내역 저장' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^offline_conflicts_\d{4}-\d{2}-\d{2}\.json$/);
	const report = JSON.parse(await readFile(await download.path(), 'utf8'));
	expect(report.conflicts.map((conflict) => [conflict.id, conflict.title, conflict.target])).toEqual([
		['conflict-patch', '작업 수정', 'Conflict server task'],
		['conflict-delete', '작업 삭제', 'Conflict kept task'],
		['conflict-checklist', '체크리스트 수정', 'Conflict server task']
	]);

	// Apply my edit: it goes back onto the server task, and the row leaves.
	await applyButtons.nth(0).click();
	await expect(page.getByText('My offline title')).toBeVisible();
	await expect(rows).toHaveCount(2);
	await expect(banner).toContainText('오프라인 변경 2건이 서버의 최신 상태와 충돌했습니다.');

	// Keep the server's version of the deleted task.
	await rows.nth(0).getByRole('button', { name: '서버 유지' }).click();
	await expect(rows).toHaveCount(1);
	await expect(page.getByText('Conflict kept task')).toBeVisible();

	// Dismissing the rest shows the last notice, which 확인 then clears.
	await banner.getByRole('button', { name: '확인' }).click();
	await expect(banner).toHaveCount(0);
	const notice = page.locator('.sync-notice');
	await expect(notice).toHaveText(/서버의 최신 상태를 유지했습니다\./);
	await expect(notice).toHaveAttribute('role', 'status');
	await notice.getByRole('button', { name: '확인' }).click();
	await expect(notice).toHaveCount(0);
});

test('checks the email code and recovery code before creating a passkey', async ({ page }) => {
	/** @type {Array<{ status?: number; expiresAt?: string; previewCode?: string }>} */
	const codeAnswers = [
		{ status: 503 },
		{ expiresAt: '2099-01-01T00:00:00.000Z', previewCode: '123456' },
		{ expiresAt: '2000-01-01T00:00:00.000Z' }
	];
	/** @type {unknown[]} */
	const codeRequests = [];
	await page.route('**/api/account/email-verifications', (route) => {
		const body = route.request().postDataJSON();
		codeRequests.push(body);
		const answer = codeAnswers.shift() ?? {};
		if (answer.status) {
			return route.fulfill({ status: answer.status, json: { message: 'Database unavailable.' } });
		}
		return route.fulfill({ json: { email: body.email, expiresAt: answer.expiresAt, previewCode: answer.previewCode } });
	});

	await page.goto('/');
	const panel = page.locator('.locked-app-state .auth-panel');
	const status = panel.locator('.auth-status');
	const email = panel.getByPlaceholder('email@example.com');
	const sendCode = panel.getByRole('button', { name: '코드 받기' });
	const createPasskey = panel.getByRole('button', { name: '패스키 만들기' });
	const codeInput = panel.getByPlaceholder('확인 코드');

	await sendCode.click();
	await expect(status).toHaveText('이메일을 입력해 주세요.');
	await expect(status).toHaveAttribute('role', 'alert');
	expect(codeRequests).toEqual([]);

	await email.fill('  New@Example.com ');
	await createPasskey.click();
	await expect(status).toHaveText('이메일 확인 코드를 입력해 주세요.');

	await panel.getByPlaceholder('이름').fill('새 사용자');
	await sendCode.click();
	await expect(status).toHaveText('데이터베이스 설정 후 이용할 수 있습니다.');
	await sendCode.click();
	await expect(status).toHaveText('확인 코드: 123456');
	await expect(status).not.toHaveAttribute('role', 'alert');
	expect(codeRequests).toEqual([
		{ email: 'new@example.com', name: '새 사용자' },
		{ email: 'new@example.com', name: '새 사용자' }
	]);

	// The code belongs to the email it was sent to.
	await codeInput.fill('123456');
	await email.fill('other@example.com');
	await createPasskey.click();
	await expect(status).toHaveText('현재 이메일로 새 확인 코드를 받아 주세요.');

	// A new code clears the typed one; an expired code is refused locally.
	await panel.getByPlaceholder('이름').fill('');
	await sendCode.click();
	await expect(status).toHaveText('새 확인 코드를 보냈습니다. 가장 최근 코드만 사용할 수 있습니다.');
	expect(codeRequests.at(-1)).toEqual({ email: 'other@example.com', name: 'other@example.com' });
	await expect(codeInput).toHaveValue('');
	await codeInput.fill('654321');
	await createPasskey.click();
	await expect(status).toHaveText('확인 코드가 만료되었습니다. 새 코드를 받아 주세요.');

	// Recovery mode swaps the email-code input for a recovery-code input.
	await panel.getByRole('button', { name: '복구 모드' }).click();
	await expect(panel.getByRole('button', { name: '가입 모드' })).toBeVisible();
	await expect(codeInput).toHaveCount(0);
	await expect(sendCode).toHaveCount(0);
	await expect(panel.getByPlaceholder('복구 코드')).toBeVisible();
	await createPasskey.click();
	await expect(status).toHaveText('복구 코드를 입력해 주세요.');
	await panel.getByRole('button', { name: '가입 모드' }).click();
	await expect(codeInput).toHaveValue('654321');
	await expect(panel.getByRole('button', { name: '패스키 로그인' })).toBeEnabled();
});

test('manages passkeys, recovery codes and sign-out for a signed-in account', async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('e2e-account-seeded')) {
			return;
		}
		sessionStorage.setItem('e2e-account-seeded', '1');
		localStorage.setItem('kanbanTasks:e2e-user', JSON.stringify([
			{ id: 'account-cached-task', text: 'Account cached task', status: 'todo' }
		]));
		localStorage.setItem('kanbanOfflineWriteQueue:e2e-user', JSON.stringify([{
			id: 'account-pending-patch',
			type: 'task.patch',
			taskId: '77777777-7777-4777-8777-777777777777',
			patch: { text: 'Pending edit' },
			ownerUserId: 'e2e-user',
			createdAt: Date.now(),
			attempts: 0
		}]));
	});
	// Confirm answers: delete passkey (no, yes), then sign out (no, yes).
	const dialogs = recordDialogs(page, [false, true, false, true]);
	let signedIn = true;
	let signOutFails = true;
	let passkeys = [
		{ id: 'passkey-mac', name: 'Mac 패스키', createdAt: '2026-05-01T12:00:00.000Z', backedUp: true },
		{ id: 'passkey-old', name: null, createdAt: '2026-05-02T12:00:00.000Z', backedUp: false }
	];
	await page.route('**/api/**', (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		const method = request.method();
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({
				json: signedIn
					? {
						session: { id: 'e2e-session', userId: 'e2e-user', expiresAt: '2099-01-01T00:00:00.000Z' },
						user: { id: 'e2e-user', email: 'e2e@example.com', name: null }
					}
					: null
			});
		}
		if (pathname === '/api/auth/passkey/list-user-passkeys') {
			return route.fulfill({ json: passkeys });
		}
		if (pathname === '/api/auth/passkey/update-passkey') {
			const { id, name } = request.postDataJSON();
			passkeys = passkeys.map((passkey) => passkey.id === id ? { ...passkey, name } : passkey);
			return route.fulfill({ json: { passkey: passkeys.find((passkey) => passkey.id === id) } });
		}
		if (pathname === '/api/auth/passkey/delete-passkey') {
			const { id } = request.postDataJSON();
			passkeys = passkeys.filter((passkey) => passkey.id !== id);
			return route.fulfill({ json: { status: true } });
		}
		if (pathname === '/api/account/recovery-codes' && method === 'POST') {
			return route.fulfill({
				json: {
					summary: { total: 10, available: 10, lastCreatedAt: '2026-05-03T12:00:00.000Z' },
					codes: ['AAAA-1111', 'BBBB-2222']
				}
			});
		}
		if (pathname === '/api/account/recovery-codes' && method === 'DELETE') {
			return route.fulfill({ json: { summary: { total: 0, available: 0, lastCreatedAt: null } } });
		}
		if (pathname === '/api/auth/sign-out') {
			if (signOutFails) {
				return route.fulfill({ status: 500, json: { message: 'Sign-out failed.' } });
			}
			signedIn = false;
			return route.fulfill({ json: { success: true } });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const panel = page.locator('.header .auth-panel');
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');
	await expect(panel.locator('input.auth-input-small')).toHaveValue(/^(Windows PC|Mac|iPhone|iPad|Android|내 기기) 패스키 - \d{4}-\d{2}-\d{2}$/);
	await expect(panel.locator('input.auth-input-small')).toHaveAttribute('aria-label', '패스키 이름');
	const status = panel.locator('.auth-status');

	// Passkey management.
	const manager = panel.getByLabel('등록된 패스키 관리');
	await expect(manager).toHaveCount(0);
	await panel.getByRole('button', { name: '패스키 관리' }).click();
	await expect(panel.getByRole('button', { name: '관리 닫기' })).toBeVisible();
	const rows = manager.locator('.passkey-row');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).locator('input')).toHaveValue('Mac 패스키');
	await expect(rows.nth(0).locator('small')).toHaveText('등록 2026-05-01 · 동기화됨');
	await expect(rows.nth(1).locator('input')).toHaveValue('패스키 2026-05-02');
	await expect(rows.nth(1).locator('small')).toHaveText('등록 2026-05-02 · 이 기기');
	await expect(manager).toContainText('Apple 패스키 선택 화면의 기존 이름은 기기 캐시 때문에 그대로 보일 수 있습니다.');

	await rows.nth(1).locator('input').fill('   ');
	await rows.nth(1).getByRole('button', { name: '저장' }).click();
	await expect(panel.locator('.auth-error')).toHaveText('패스키 이름을 입력해 주세요.');
	await rows.nth(1).locator('input').fill('iPhone 패스키');
	await rows.nth(1).getByRole('button', { name: '저장' }).click();
	await expect(status.first()).toHaveText('패스키 이름을 저장했습니다. Apple 선택 화면은 기존 이름을 계속 표시할 수 있습니다.');
	await expect(rows.nth(1).locator('input')).toHaveValue('iPhone 패스키');

	// The first delete is cancelled at the question, the second goes through.
	await rows.nth(0).getByRole('button', { name: '삭제' }).click();
	await expect.poll(() => dialogs.length).toBe(1);
	await expect(rows).toHaveCount(2);
	await rows.nth(0).getByRole('button', { name: '삭제' }).click();
	await expect.poll(() => dialogs.length).toBe(2);
	expect(dialogs).toEqual([
		'confirm:Mac 패스키 패스키를 삭제하시겠습니까? 이 기기로는 다시 로그인할 수 없을 수 있습니다.',
		'confirm:Mac 패스키 패스키를 삭제하시겠습니까? 이 기기로는 다시 로그인할 수 없을 수 있습니다.'
	]);
	await expect(status.first()).toHaveText('패스키를 삭제했습니다.');
	await expect(rows).toHaveCount(1);
	await expect(rows.nth(0).getByRole('button', { name: '삭제' })).toBeDisabled();
	await expect(rows.nth(0).getByRole('button', { name: '삭제' })).toHaveAttribute('title', '마지막 패스키는 삭제하지 않는 것이 안전합니다.');
	await manager.getByRole('button', { name: '다시 불러오기' }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.nth(0).locator('input')).toHaveValue('iPhone 패스키');
	await panel.getByRole('button', { name: '관리 닫기' }).click();
	await expect(manager).toHaveCount(0);

	// Recovery codes.
	const codeList = panel.getByLabel('새 복구 코드');
	await panel.getByRole('button', { name: '복구 코드', exact: true }).click();
	await expect(status.first()).toHaveText('새 복구 코드가 생성되었습니다.');
	await expect(status.nth(1)).toHaveText('복구 코드 10/10');
	await expect(codeList.locator('code')).toHaveText(['AAAA-1111', 'BBBB-2222']);
	await panel.getByRole('button', { name: '복구 폐기' }).click();
	await expect(status.first()).toHaveText('복구 코드가 폐기되었습니다.');
	await expect(status.nth(1)).toHaveText('복구 코드 0/0');
	await expect(codeList).toHaveCount(0);

	// Sign-out. Without the cache option there is no question.
	const clearCache = panel.getByRole('checkbox', { name: '캐시 삭제' });
	await expect(clearCache).toBeChecked();
	await clearCache.uncheck();
	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect(panel.locator('.auth-error')).toHaveText('Sign-out failed.');
	expect(dialogs).toHaveLength(2);

	// With it, pending offline changes are asked about first.
	signOutFails = false;
	await clearCache.check();
	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect.poll(() => dialogs.length).toBe(3);
	expect(dialogs[2]).toBe('confirm:아직 동기화되지 않은 오프라인 변경 1건이 있습니다. 로그아웃하면서 이 기기 캐시를 삭제할까요?');
	await expect(status.first()).toHaveText('로그아웃을 취소했습니다. 먼저 Sync로 오프라인 변경을 동기화해 주세요.');
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');

	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect(page.locator('.locked-app-state .auth-panel')).toBeVisible();
	expect(dialogs).toHaveLength(4);
	// The queue is dropped and the cached list emptied (the store writes the
	// empty list back under the same key).
	expect(await page.evaluate(() => [
		localStorage.getItem('kanbanOfflineWriteQueue:e2e-user'),
		localStorage.getItem('kanbanTasks:e2e-user')
	])).toEqual([null, '[]']);
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ extraTasks?: Array<Record<string, unknown>> }} [options]
 */
async function seedOfflineBoard(page, { extraTasks = [] } = {}) {
	await page.addInitScript((seedExtraTasks) => {
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			get: () => false
		});
		const today = new Date();
		const formatDate = (date) => {
			const year = date.getFullYear();
			const month = `${date.getMonth() + 1}`.padStart(2, '0');
			const day = `${date.getDate()}`.padStart(2, '0');
			return `${year}-${month}-${day}`;
		};
		const past = new Date(today);
		past.setDate(past.getDate() - 16);
		const extraSeedTasks = seedExtraTasks.map((task) => ({
			status: 'todo',
			startDate: formatDate(past),
			endDate: formatDate(past),
			priority: 'medium',
			urgency: 'normal',
			category: '',
			parentId: null,
			subtasks: [],
			collapsed: false,
			createdAt: Date.now(),
			...task
		}));

		localStorage.setItem('todokanbanAuthScope', JSON.stringify({
			id: 'e2e-user',
			email: 'e2e@example.com',
			name: null,
			cachedAt: Date.now()
		}));
		if (localStorage.getItem('kanbanTasks:e2e-user')) {
			return;
		}

		localStorage.setItem('kanbanTasks:e2e-user', JSON.stringify([
			{
				id: 'local-urgent-important',
				text: 'Urgent important',
				status: 'todo',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'high',
				urgency: 'urgent',
				category: '',
				parentId: null,
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-planned-important',
				text: 'Planned important',
				status: 'doing',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'high',
				urgency: 'normal',
				category: '',
				parentId: null,
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-interrupting-task',
				text: 'Interrupting task',
				status: 'todo',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'medium',
				urgency: 'urgent',
				category: '',
				parentId: null,
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-e2e-task',
				text: 'E2E cached task',
				status: 'todo',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'medium',
				urgency: 'normal',
				category: '',
				parentId: null,
				subtasks: [
					{ id: 'local-e2e-checklist-one', text: 'E2E checklist one', done: false },
					{ id: 'local-e2e-checklist-done', text: 'E2E checklist done', done: true }
				],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-parent-task',
				text: 'Nested parent task',
				status: 'todo',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'medium',
				urgency: 'normal',
				category: '',
				parentId: null,
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-child-task',
				text: 'Nested child task',
				status: 'todo',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'medium',
				urgency: 'normal',
				category: '',
				parentId: 'local-parent-task',
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			{
				id: 'local-completed-matrix-task',
				text: 'Completed matrix task',
				status: 'done',
				startDate: formatDate(past),
				endDate: formatDate(past),
				priority: 'high',
				urgency: 'urgent',
				category: '',
				parentId: null,
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			},
			...extraSeedTasks
		]));
	}, extraTasks);
}
