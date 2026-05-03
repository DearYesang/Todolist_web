import { redirect } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	completeCalendarProviderAuthorization
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, request, url }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		return Response.json({ message: 'Calendar OAuth callback is missing code or state.' }, { status: 400 });
	}

	try {
		await completeCalendarProviderAuthorization(params.provider, code, state, url, {
			userId: authResult.user.id,
			sessionId: authResult.session.id
		});
		throw redirect(302, '/?calendarSync=connected');
	} catch (error) {
		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			return Response.json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
