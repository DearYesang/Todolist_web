/**
 * @param {import('@playwright/test').Page} page
 * @param {{ extraTasks?: Array<Record<string, unknown>> }} [options]
 */
export async function seedOfflineBoard(page, { extraTasks = [] } = {}) {
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} taskId
 */
export function readPersistedTask(page, taskId) {
	return page.evaluate((id) =>
		JSON.parse(localStorage.getItem('kanbanTasks:e2e-user') ?? '[]').find((task) => task.id === id),
	taskId);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 */
export function cardByTitle(page, title) {
	return page.locator('.task-card', { has: page.locator('.card-text', { hasText: title }) });
}
