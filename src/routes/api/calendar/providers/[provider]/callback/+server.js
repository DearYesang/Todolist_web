import { redirect } from '@sveltejs/kit';
import {
	CalendarSyncError,
	completeCalendarProviderAuthorization
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url }) {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		return Response.json({ message: 'Calendar OAuth callback is missing code or state.' }, { status: 400 });
	}

	try {
		await completeCalendarProviderAuthorization(params.provider, code, state, url);
		throw redirect(302, '/?calendarSync=connected');
	} catch (error) {
		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			return Response.json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
