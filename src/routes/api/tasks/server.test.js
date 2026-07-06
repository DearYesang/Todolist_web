import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { createTaskForUser, listTasksForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';
import { normalizeTask } from '$lib/shared/task-domain.js';
import { GET, POST } from './+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/tasks/rate-limit-guard.js', () => ({
	enforceTaskWriteRateLimit: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	createTaskForUser: vi.fn(),
	listTasksForUser: vi.fn()
}));

describe('/api/tasks route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		});
		vi.mocked(enforceTaskWriteRateLimit).mockResolvedValue(null);
	});

	it('returns 401 when the request is unauthenticated', async () => {
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: false,
			response: Response.json({ message: 'Authentication required.' }, { status: 401 })
		});

		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/tasks')
		}));

		expect(response.status).toBe(401);
		expect(listTasksForUser).not.toHaveBeenCalled();
	});

	it('returns the authenticated user task list', async () => {
		const task = normalizeTask({ id: 'task-id', text: 'Task' });
		vi.mocked(listTasksForUser).mockResolvedValue([task]);

		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/tasks')
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.tasks).toEqual([task]);
		expect(listTasksForUser).toHaveBeenCalledWith('user-id');
	});

	it('maps invalid JSON and task write errors to client-safe responses', async () => {
		const invalidJson = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/tasks', {
				method: 'POST',
				body: '{'
			})
		}));
		expect(invalidJson.status).toBe(400);

		vi.mocked(createTaskForUser).mockRejectedValue(new TaskWriteError('Conflict.', 409));
		const conflict = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/tasks', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'Task' })
			})
		}));
		const body = await conflict.json();

		expect(conflict.status).toBe(409);
		expect(body.message).toBe('Conflict.');
	});

	it('returns the rate-limit response before touching the repository', async () => {
		vi.mocked(enforceTaskWriteRateLimit).mockResolvedValue(
			Response.json({ message: 'Too many task changes.' }, { status: 429, headers: { 'retry-after': '30' } })
		);

		const response = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/tasks', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'Task' })
			})
		}));

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('30');
		expect(createTaskForUser).not.toHaveBeenCalled();
	});
});
