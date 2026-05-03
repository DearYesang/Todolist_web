import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	syncCalendarProvidersForUser
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';
import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	const { request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		await assertRateLimit(createRateLimitKey(event, 'calendar-sync', authResult.user.id), {
			limit: 6,
			windowMs: 60 * 60 * 1000,
			message: 'Calendar sync is cooling down.'
		});
		return json(await syncCalendarProvidersForUser(authResult.user.id), {
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

		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
