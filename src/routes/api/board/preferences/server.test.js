import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	getBoardPreferencesForUser,
	updateBoardPreferencesForUser
} from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';
import { GET, PATCH } from './+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	getBoardPreferencesForUser: vi.fn(),
	updateBoardPreferencesForUser: vi.fn()
}));

describe('/api/board/preferences route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		});
	});

	it('returns the authenticated user board preferences', async () => {
		vi.mocked(getBoardPreferencesForUser).mockResolvedValue({ defaultView: 'matrix' });

		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/board/preferences')
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ defaultView: 'matrix' });
		expect(getBoardPreferencesForUser).toHaveBeenCalledWith('user-id');
	});

	it('updates the authenticated user board default view', async () => {
		vi.mocked(updateBoardPreferencesForUser).mockResolvedValue({ defaultView: 'gantt' });

		const response = await PATCH(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/board/preferences', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ defaultView: 'gantt' })
			})
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ defaultView: 'gantt' });
		expect(updateBoardPreferencesForUser).toHaveBeenCalledWith('user-id', { defaultView: 'gantt' });
	});

	it('maps invalid JSON and write errors to client-safe responses', async () => {
		const invalidJson = await PATCH(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/board/preferences', {
				method: 'PATCH',
				body: '{'
			})
		}));
		expect(invalidJson.status).toBe(400);

		vi.mocked(updateBoardPreferencesForUser).mockRejectedValue(new TaskWriteError('Invalid defaultView.', 400));
		const invalidView = await PATCH(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/board/preferences', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ defaultView: 'timeline' })
			})
		}));
		const body = await invalidView.json();

		expect(invalidView.status).toBe(400);
		expect(body.message).toBe('Invalid defaultView.');
	});
});
