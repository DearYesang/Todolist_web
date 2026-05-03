import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	syncCalendarProvidersForUser
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		return json(await syncCalendarProvidersForUser(authResult.user.id), {
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
