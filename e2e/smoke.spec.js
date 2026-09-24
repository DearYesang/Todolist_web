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

	const ownButton = card.getByRole('button', { name: '체크리스트 링크 2개를 새 탭에서 모두 열기' });
	const subtreeButton = card.getByRole('button', { name: '하위 작업 포함 링크 4개를 새 탭에서 모두 열기' });
	await expect(ownButton).toContainText('모두 열기 (2)');
	await expect(subtreeButton).toContainText('하위 포함 모두 열기 (4)');
	// The child card has 2 links of its own and no children.
	const childCard = page.locator('.task-card', { has: page.locator('.card-text', { hasText: 'E2E 링크 하위' }) });
	await expect(childCard.getByRole('button', { name: '체크리스트 링크 2개를 새 탭에서 모두 열기' })).toBeVisible();

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
	// The click neither opened the detail modal nor started a drag.
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

	// Keyboard activation opens the task's own links.
	await ownButton.focus();
	await page.keyboard.press('Enter');
	expect(await readOpenedUrls(page)).toEqual([...LINK_TASK_URLS, ...LINK_TASK_URLS.slice(0, 2)]);
	await expect(panel).toContainText('링크 2개를 새 탭으로 열었습니다.');
	await panel.getByRole('button', { name: '닫기' }).click();

	// The detail modal (the only entry point from Gantt) offers the same buttons.
	await card.locator('.card-text').click();
	const modal = page.locator('.side-panel');
	await expect(modal).toBeVisible();
	await expect(modal.getByRole('button', { name: '체크리스트 링크 2개를 새 탭에서 모두 열기' })).toContainText('모두 열기 (2)');
	const modalSubtree = modal.getByRole('button', { name: '하위 작업 포함 링크 4개를 새 탭에서 모두 열기' });
	await expect(modalSubtree).toContainText('하위 포함 모두 열기 (4)');
	await modalSubtree.click();
	expect(await readOpenedUrls(page)).toHaveLength(10);
	await expect(panel).toContainText('링크 4개를 새 탭으로 열었습니다.');
	await expect(modal).toBeVisible();
});

test('falls back to a link list when the browser blocks pop-ups', async ({ page }) => {
	await stubWindowOpen(page, 'one-per-click');
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });

	await page.goto('/');
	await linkParentCard(page).getByRole('button', { name: '하위 작업 포함 링크 4개를 새 탭에서 모두 열기' }).click();
	expect(await readOpenedUrls(page)).toEqual(LINK_TASK_URLS);

	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('링크 4개 중 1개만 열렸습니다');
	await expect(panel).toContainText('brave://settings/content/popups');
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
});

test('lists every link when new tabs cannot be opened at all', async ({ page }) => {
	await stubWindowOpen(page, 'block');
	await seedOfflineBoard(page, { extraTasks: LINK_TASKS });

	await page.goto('/');
	await linkParentCard(page).getByRole('button', { name: '하위 작업 포함 링크 4개를 새 탭에서 모두 열기' }).click();

	const panel = page.locator('.link-open-panel');
	await expect(panel).toContainText('이 환경에서는 새 탭을 자동으로 열 수 없습니다.');
	await expect(panel.locator('a[target="_blank"]')).toHaveCount(4);

	// A single fresh open failing too hides the step button; the list stays.
	await panel.getByRole('button', { name: '다음 링크 열기 (1/4)' }).click();
	await expect(panel.getByRole('button', { name: /다음 링크 열기/ })).toHaveCount(0);
	await expect(panel.locator('a[target="_blank"]')).toHaveCount(4);
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
