import { redirect } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	completeCalendarProviderAuthorization
} from '$lib/server/calendar/provider-sync.js';
import {
	createCalendarOAuthErrorMessage,
	createCalendarSyncRedirect
} from '$lib/server/calendar/oauth-status.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, request, url }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const oauthError = url.searchParams.get('error');
	if (oauthError) {
		throw redirect(302, createCalendarSyncRedirect({
			status: 'error',
			provider: params.provider,
			message: createCalendarOAuthErrorMessage(
				params.provider,
				oauthError,
				url.searchParams.get('error_description')
			)
		}));
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		throw redirect(302, createCalendarSyncRedirect({
			status: 'error',
			provider: params.provider,
			message: 'Calendar OAuth callback is missing code or state.'
		}));
	}

	try {
		await completeCalendarProviderAuthorization(params.provider, code, state, url, {
			userId: authResult.user.id,
			sessionId: authResult.session.id
		});
		throw redirect(302, createCalendarSyncRedirect({
			status: 'connected',
			provider: params.provider
		}));
	} catch (error) {
		if (error instanceof CalendarSyncError || error instanceof CalendarProviderError || error instanceof CalendarTokenEncryptionError) {
			throw redirect(302, createCalendarSyncRedirect({
				status: 'error',
				provider: params.provider,
				message: error.message
			}));
		}

		throw error;
	}
}
