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

/**
 * @param {import('@playwright/test').Page} page
 */
async function seedOfflineBoard(page) {
	await page.addInitScript(() => {
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
			}
		]));
	});
}
