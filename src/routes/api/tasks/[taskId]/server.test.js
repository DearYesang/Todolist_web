import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { deleteTaskCascadeForUser, updateTaskForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';
import { normalizeTask } from '$lib/shared/task-domain.js';
import { DELETE, PATCH } from './+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	deleteTaskCascadeForUser: vi.fn(),
	updateTaskForUser: vi.fn()
}));

describe('/api/tasks/[taskId] route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		});
	});

	it('passes PATCH payloads through to the repository', async () => {
		const task = normalizeTask({
			id: '11111111-1111-4111-8111-111111111111',
			text: 'Updated',
			version: 2
		});
		vi.mocked(updateTaskForUser).mockResolvedValue(task);

		const response = await PATCH(/** @type {any} */ ({
			params: { taskId: task.id },
			request: new Request(`https://todo.example.com/api/tasks/${task.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'Updated', expectedVersion: 1 })
			})
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.task).toEqual(task);
		expect(updateTaskForUser).toHaveBeenCalledWith('user-id', task.id, {
			text: 'Updated',
			expectedVersion: 1
		});
	});

	it('passes DELETE expectedVersion payloads through to the repository', async () => {
		vi.mocked(deleteTaskCascadeForUser).mockResolvedValue(3);
		const taskId = '22222222-2222-4222-8222-222222222222';

		const response = await DELETE(/** @type {any} */ ({
			params: { taskId },
			request: new Request(`https://todo.example.com/api/tasks/${taskId}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ expectedVersion: 4 })
			})
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ deleted: 3 });
		expect(deleteTaskCascadeForUser).toHaveBeenCalledWith('user-id', taskId, { expectedVersion: 4 });
	});

	it('maps stale DELETE versions to 409 responses', async () => {
		const taskId = '33333333-3333-4333-8333-333333333333';
		vi.mocked(deleteTaskCascadeForUser).mockRejectedValue(new TaskWriteError('Task changed on another device. Sync and try again.', 409));

		const response = await DELETE(/** @type {any} */ ({
			params: { taskId },
			request: new Request(`https://todo.example.com/api/tasks/${taskId}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ expectedVersion: 1 })
			})
		}));
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.message).toBe('Task changed on another device. Sync and try again.');
	});
});
