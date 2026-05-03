import { expect, test } from '@playwright/test';

test('keeps the private app locked before login', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /나의 칸반 보드/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /칸반 뷰/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /불러오기/ })).toBeHidden();
});

test('opens an offline cached board and centers the Gantt timeline on today', async ({ page }) => {
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
		localStorage.setItem('kanbanTasks:e2e-user', JSON.stringify([
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
				subtasks: [],
				collapsed: false,
				createdAt: Date.now()
			}
		]));
	});

	await page.goto('/');
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
