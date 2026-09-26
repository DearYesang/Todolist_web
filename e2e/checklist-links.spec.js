import { expect, test } from '@playwright/test';
import { seedOfflineBoard } from './fixtures/board.js';

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
