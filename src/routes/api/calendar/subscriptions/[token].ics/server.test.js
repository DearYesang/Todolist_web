import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCalendarTasksForToken } from '$lib/server/calendar/tokens.js';
import { resetRateLimitBuckets } from '$lib/server/security/rate-limit.js';
import { GET } from './+server.js';

vi.mock('$lib/server/calendar/tokens.js', async (importOriginal) => ({
	...(await importOriginal()),
	getCalendarTasksForToken: vi.fn()
}));

describe('/api/calendar/subscriptions/[token].ics route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		resetRateLimitBuckets();
		vi.mocked(getCalendarTasksForToken).mockResolvedValue([]);
	});

	it('returns a no-store iCalendar feed for a valid token', async () => {
		const response = await GET(createEvent());
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/calendar;charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
		expect(body).toContain('BEGIN:VCALENDAR');
		expect(getCalendarTasksForToken).toHaveBeenCalledWith('cal_token');
	});

	it('rate limits repeated token and IP requests before touching the database', async () => {
		for (let index = 0; index < 60; index += 1) {
			const response = await GET(createEvent());
			expect(response.status).toBe(200);
		}

		const blocked = await GET(createEvent());

		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toEqual(expect.any(String));
		expect(getCalendarTasksForToken).toHaveBeenCalledTimes(60);
	});
});

/**
 * @param {string} token
 * @param {string} ip
 */
function createEvent(token = 'cal_token', ip = '203.0.113.10') {
	return /** @type {any} */ ({
		params: { token },
		request: new Request(`https://todo.example.com/api/calendar/subscriptions/${token}.ics`),
		getClientAddress: () => ip
	});
}
