import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceImportRateLimit, enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import * as repository from '$lib/server/tasks/repository.js';
import { POST as createTask } from './tasks/+server.js';
import { PATCH as patchTask, DELETE as deleteTask } from './tasks/[taskId]/+server.js';
import { POST as createChecklistItem } from './tasks/[taskId]/checklist/+server.js';
import {
	PATCH as patchChecklistItem,
	DELETE as deleteChecklistItem
} from './tasks/[taskId]/checklist/[itemId]/+server.js';
import { POST as importTasks } from './import/+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/tasks/rate-limit-guard.js', () => ({
	enforceTaskWriteRateLimit: vi.fn(),
	enforceImportRateLimit: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	createTaskForUser: vi.fn(),
	listTasksForUser: vi.fn(),
	updateTaskForUser: vi.fn(),
	deleteTaskCascadeForUser: vi.fn(),
	createChecklistItemForUser: vi.fn(),
	updateChecklistItemForUser: vi.fn(),
	deleteChecklistItemForUser: vi.fn(),
	importTasksForUser: vi.fn(),
	replaceTasksForUser: vi.fn()
}));

/**
 * @param {string} method
 */
function createEvent(method) {
	return /** @type {any} */ ({
		params: { taskId: '11111111-1111-4111-8111-111111111111', itemId: '22222222-2222-4222-8222-222222222222' },
		url: new URL('https://todo.example.com/api'),
		request: new Request('https://todo.example.com/api', {
			method,
			headers: { 'content-type': 'application/json' },
			body: method === 'GET' ? undefined : JSON.stringify({ text: 'Task' })
		})
	});
}

const PROTECTED_HANDLERS = [
	{ name: 'POST /api/tasks', handler: createTask, method: 'POST', guard: enforceTaskWriteRateLimit },
	{ name: 'PATCH /api/tasks/[taskId]', handler: patchTask, method: 'PATCH', guard: enforceTaskWriteRateLimit },
	{ name: 'DELETE /api/tasks/[taskId]', handler: deleteTask, method: 'DELETE', guard: enforceTaskWriteRateLimit },
	{ name: 'POST /api/tasks/[taskId]/checklist', handler: createChecklistItem, method: 'POST', guard: enforceTaskWriteRateLimit },
	{ name: 'PATCH .../checklist/[itemId]', handler: patchChecklistItem, method: 'PATCH', guard: enforceTaskWriteRateLimit },
	{ name: 'DELETE .../checklist/[itemId]', handler: deleteChecklistItem, method: 'DELETE', guard: enforceTaskWriteRateLimit },
	{ name: 'POST /api/import', handler: importTasks, method: 'POST', guard: enforceImportRateLimit }
];

describe('rate-limit guard wiring on every protected write route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireAuthUser).mockResolvedValue(/** @type {any} */ ({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		}));
	});

	it.each(PROTECTED_HANDLERS)('$name returns the guard 429 before touching the repository', async ({ handler, method, guard }) => {
		vi.mocked(guard).mockResolvedValue(
			Response.json({ message: 'Too many requests.' }, { status: 429, headers: { 'retry-after': '30' } })
		);

		const response = await handler(createEvent(method));

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('30');
		expect(guard).toHaveBeenCalledWith('user-id');
		for (const repositoryFn of Object.values(repository)) {
			expect(repositoryFn).not.toHaveBeenCalled();
		}
	});

	it.each(PROTECTED_HANDLERS)('$name proceeds when the guard allows the request', async ({ handler, method, guard }) => {
		vi.mocked(guard).mockResolvedValue(null);

		const response = await handler(createEvent(method));

		// Repository mocks resolve undefined, so a pass-through reaches the
		// handler's success path (200/201) rather than the 429 short-circuit.
		expect(response.status).not.toBe(429);
		expect(guard).toHaveBeenCalledWith('user-id');
	});
});
