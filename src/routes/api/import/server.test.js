import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { importTasksForUser, replaceTasksForUser } from '$lib/server/tasks/repository.js';
import { normalizeTask } from '$lib/shared/task-domain.js';
import { POST } from './+server.js';

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	importTasksForUser: vi.fn(),
	replaceTasksForUser: vi.fn()
}));

describe('/api/import route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: true,
			user: { id: 'user-id' },
			session: { id: 'session-id' }
		});
	});

	it('requires authentication before importing', async () => {
		vi.mocked(requireAuthUser).mockResolvedValue({
			ok: false,
			response: Response.json({ message: 'Authentication required.' }, { status: 401 })
		});

		const response = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/import', {
				method: 'POST',
				body: '[]'
			}),
			url: new URL('https://todo.example.com/api/import')
		}));

		expect(response.status).toBe(401);
		expect(importTasksForUser).not.toHaveBeenCalled();
		expect(replaceTasksForUser).not.toHaveBeenCalled();
	});

	it('rejects malformed or oversized payloads before touching the repository', async () => {
		const malformed = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/import', {
				method: 'POST',
				body: '{'
			}),
			url: new URL('https://todo.example.com/api/import')
		}));
		expect(malformed.status).toBe(400);

		const oversized = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/import', {
				method: 'POST',
				headers: { 'content-length': String(6 * 1024 * 1024) },
				body: '[]'
			}),
			url: new URL('https://todo.example.com/api/import')
		}));
		expect(oversized.status).toBe(413);
		expect(importTasksForUser).not.toHaveBeenCalled();
	});

	it('runs replace imports and returns no-store responses', async () => {
		const importedTask = normalizeTask({ id: 'task-id', text: 'Imported' });
		vi.mocked(replaceTasksForUser).mockResolvedValue({
			tasks: [importedTask],
			summary: {
				receivedTasks: 1,
				importedTasks: 1,
				skippedTasks: 0,
				importedChecklistItems: 0,
				skippedChecklistItems: 0,
				repairedParentLinks: 0,
				replacedTasks: 2
			}
		});

		const response = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/import?mode=replace', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify([{ text: 'Imported' }])
			}),
			url: new URL('https://todo.example.com/api/import?mode=replace')
		}));
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(body.tasks).toEqual([importedTask]);
		expect(replaceTasksForUser).toHaveBeenCalledWith('user-id', [{ text: 'Imported' }]);
	});
});
