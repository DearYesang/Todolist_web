/** The account the offline board is cached for. */
const E2E_USER = { id: 'e2e-user', email: 'e2e@example.com', name: null };

const TASKS_STORAGE_KEY = `kanbanTasks:${E2E_USER.id}`;

/**
 * The tasks every offline board starts with. seedOfflineBoard fills in the
 * fields left out here, as it does for extra tasks.
 * @type {Array<Record<string, unknown>>}
 */
const BASE_TASKS = [
	{ id: 'local-urgent-important', text: 'Urgent important', priority: 'high', urgency: 'urgent' },
	{ id: 'local-planned-important', text: 'Planned important', status: 'doing', priority: 'high' },
	{ id: 'local-interrupting-task', text: 'Interrupting task', urgency: 'urgent' },
	{
		id: 'local-e2e-task',
		text: 'E2E cached task',
		subtasks: [
			{ id: 'local-e2e-checklist-one', text: 'E2E checklist one', done: false },
			{ id: 'local-e2e-checklist-done', text: 'E2E checklist done', done: true }
		]
	},
	{ id: 'local-parent-task', text: 'Nested parent task' },
	{ id: 'local-child-task', text: 'Nested child task', parentId: 'local-parent-task' },
	{ id: 'local-completed-matrix-task', text: 'Completed matrix task', status: 'done', priority: 'high', urgency: 'urgent' }
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ extraTasks?: Array<Record<string, unknown>> }} [options]
 */
export async function seedOfflineBoard(page, { extraTasks = [] } = {}) {
	await page.addInitScript(({ user, tasksKey, seedTasks }) => {
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
		// Dates and createdAt come from the page's clock, so a test that fixes
		// the clock or the time zone seeds tasks for that day.
		/** @param {Record<string, unknown>} task */
		const seedTask = (task) => ({
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
		});

		localStorage.setItem('todokanbanAuthScope', JSON.stringify({
			...user,
			cachedAt: Date.now()
		}));
		if (localStorage.getItem(tasksKey)) {
			return;
		}

		localStorage.setItem(tasksKey, JSON.stringify(seedTasks.map(seedTask)));
	}, { user: E2E_USER, tasksKey: TASKS_STORAGE_KEY, seedTasks: [...BASE_TASKS, ...extraTasks] });
}

/**
 * The task list the app has persisted for the E2E account.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<any[]>}
 */
export function readPersistedTasks(page) {
	return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), TASKS_STORAGE_KEY);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} taskId
 */
export async function readPersistedTask(page, taskId) {
	return (await readPersistedTasks(page)).find((task) => task.id === taskId);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 */
export function cardByTitle(page, title) {
	return page.locator('.task-card', { has: page.locator('.card-text', { hasText: title }) });
}
