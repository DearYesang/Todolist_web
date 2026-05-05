import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncCalendarProvidersForConnectedUsers } from '$lib/server/calendar/provider-sync.js';
import { GET, POST } from './+server.js';

vi.mock('$lib/server/calendar/provider-sync.js', () => ({
	CalendarSyncError: class CalendarSyncError extends Error {
		/**
		 * @param {string} message
		 * @param {number} [status]
		 */
		constructor(message, status = 500) {
			super(message);
			this.status = status;
		}
	},
	syncCalendarProvidersForConnectedUsers: vi.fn()
}));

describe('/api/calendar/sync/cron route', () => {
	const originalSecret = process.env.CRON_SECRET;

	beforeEach(() => {
		vi.resetAllMocks();
		process.env.CRON_SECRET = 'cron-secret-with-enough-length';
	});

	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.CRON_SECRET;
		} else {
			process.env.CRON_SECRET = originalSecret;
		}
	});

	it('requires a configured cron secret', async () => {
		delete process.env.CRON_SECRET;

		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/calendar/sync/cron'),
			url: new URL('https://todo.example.com/api/calendar/sync/cron')
		}));

		expect(response.status).toBe(503);
		expect(syncCalendarProvidersForConnectedUsers).not.toHaveBeenCalled();
	});

	it('rejects requests without the cron secret', async () => {
		const response = await GET(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/calendar/sync/cron', {
				headers: { authorization: 'Bearer wrong-secret' }
			}),
			url: new URL('https://todo.example.com/api/calendar/sync/cron')
		}));

		expect(response.status).toBe(401);
		expect(syncCalendarProvidersForConnectedUsers).not.toHaveBeenCalled();
	});

	it('runs background sync for authorized requests', async () => {
		vi.mocked(syncCalendarProvidersForConnectedUsers).mockResolvedValue({
			ok: true,
			users: 1,
			limit: 3,
			results: []
		});

		const response = await POST(/** @type {any} */ ({
			request: new Request('https://todo.example.com/api/calendar/sync/cron?maxUsers=3', {
				method: 'POST',
				headers: { authorization: 'Bearer cron-secret-with-enough-length' }
			}),
			url: new URL('https://todo.example.com/api/calendar/sync/cron?maxUsers=3')
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ ok: true, users: 1, limit: 3 });
		expect(syncCalendarProvidersForConnectedUsers).toHaveBeenCalledWith({ maxUsers: 3 });
	});
});
