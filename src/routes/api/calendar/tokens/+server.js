import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarTokenConfigurationError,
	CalendarTokenLimitError,
	createCalendarTokenForUser,
	listCalendarTokensForUser
} from '$lib/server/calendar/tokens.js';
import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const tokens = await listCalendarTokensForUser(authResult.user.id);
		return json({ tokens }, {
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof CalendarTokenConfigurationError) {
			return json({ message: error.message }, { status: 503 });
		}

		throw error;
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	const { request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let payload = {};
	try {
		payload = await request.json();
	} catch {
		payload = {};
	}

	try {
		assertRateLimit(createRateLimitKey(event, 'calendar-token-create', authResult.user.id), {
			limit: 5,
			windowMs: 60 * 60 * 1000,
			message: 'Too many calendar feed token creation requests.'
		});
		const result = await createCalendarTokenForUser(authResult.user.id, payload);
		return json(result, {
			status: 201,
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof RateLimitError) {
			return json({ message: error.message }, {
				status: error.status,
				headers: createRateLimitHeaders(error)
			});
		}

		if (error instanceof CalendarTokenConfigurationError) {
			return json({ message: error.message }, { status: 503 });
		}

		if (error instanceof CalendarTokenLimitError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
