import { createHash } from 'node:crypto';
import { createTaskCalendar } from '$lib/shared/calendar-ics.js';
import {
	CalendarTokenConfigurationError,
	getCalendarTasksForToken
} from '$lib/server/calendar/tokens.js';
import {
	assertVolatileRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const IP_RATE_LIMIT_MAX_REQUESTS = 120;
const TOKEN_RATE_LIMIT_MAX_REQUESTS = 60;
const CALENDAR_TOKEN_PATTERN = /^cal_[A-Za-z0-9_-]{16,128}$/;

/** @type {import('./$types').RequestHandler} */
export async function GET(event) {
	const { params } = event;
	try {
		assertVolatileRateLimit(createRateLimitKey(event, 'calendar-feed-ip'), {
			limit: IP_RATE_LIMIT_MAX_REQUESTS,
			windowMs: RATE_LIMIT_WINDOW_MS,
			message: 'Too many calendar feed requests.'
		});
		if (!isCalendarSubscriptionToken(params.token)) {
			return new Response('Not found', {
				status: 404,
				headers: { 'cache-control': 'no-store' }
			});
		}
		assertVolatileRateLimit(createCalendarFeedRateLimitKey(event), {
			limit: TOKEN_RATE_LIMIT_MAX_REQUESTS,
			windowMs: RATE_LIMIT_WINDOW_MS,
			message: 'Too many calendar feed requests.'
		});

		const tasks = await getCalendarTasksForToken(params.token);
		if (!tasks) {
			return new Response('Not found', { status: 404 });
		}

		return new Response(createTaskCalendar(tasks, { calendarName: 'Todolist' }), {
			headers: {
				'content-type': 'text/calendar;charset=utf-8',
				'cache-control': 'private, no-store',
				'x-robots-tag': 'noindex, nofollow, noarchive'
			}
		});
	} catch (error) {
		if (error instanceof CalendarTokenConfigurationError) {
			return new Response('Calendar token configuration is unavailable.', { status: 503 });
		}
		if (error instanceof RateLimitError) {
			return new Response(error.message, {
				status: error.status,
				headers: {
					...createRateLimitHeaders(error),
					'cache-control': 'no-store'
				}
			});
		}

		throw error;
	}
}

/**
 * @param {import('@sveltejs/kit').RequestEvent} event
 */
function createCalendarFeedRateLimitKey(event) {
	return createRateLimitKey(event, 'calendar-feed', hashRateLimitToken(event.params.token));
}

/** @param {string} rawToken */
function hashRateLimitToken(rawToken) {
	return createHash('sha256').update(rawToken).digest('base64url').slice(0, 32);
}

/** @param {string} rawToken */
function isCalendarSubscriptionToken(rawToken) {
	return CALENDAR_TOKEN_PATTERN.test(rawToken);
}
