import { redirect } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	createCalendarProviderAuthorizationUrl
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, request, url }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const authorizationUrl = await createCalendarProviderAuthorizationUrl(authResult.user.id, params.provider, url);
		throw redirect(302, authorizationUrl);
	} catch (error) {
		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			return Response.json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
