import { json } from '@sveltejs/kit';
import { CalendarSyncError, syncCalendarProvidersForConnectedUsers } from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';
import { apiErrorResponse } from '$lib/server/http/api-error.js';
import { readBearerToken, secretsMatch } from '$lib/server/security/bearer-secret.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, url }) {
	return runCalendarCronSync(request, url);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, url }) {
	return runCalendarCronSync(request, url);
}

/**
 * @param {Request} request
 * @param {URL} url
 */
async function runCalendarCronSync(request, url) {
	const secretCheck = checkCronSecret(request);
	if (!secretCheck.ok) {
		return json({ message: secretCheck.message }, { status: secretCheck.status });
	}

	try {
		return json(
			await syncCalendarProvidersForConnectedUsers({
				maxUsers: readMaxUsers(url)
			}),
			{
				headers: {
					'cache-control': 'private, no-store'
				}
			}
		);
	} catch (error) {
		return apiErrorResponse(error, CalendarSyncError, CalendarProviderError, CalendarTokenEncryptionError);
	}
}

/**
 * @param {Request} request
 */
function checkCronSecret(request) {
	const secret = process.env.CRON_SECRET;
	if (!secret) {
		return {
			ok: false,
			status: 503,
			message: 'CRON_SECRET is required before background calendar sync can run.'
		};
	}

	const bearer = readBearerToken(request);
	const headerSecret = request.headers.get('x-cron-secret')?.trim();
	if (!secretsMatch(bearer, secret) && !secretsMatch(headerSecret, secret)) {
		return {
			ok: false,
			status: 401,
			message: 'Calendar sync cron authentication failed.'
		};
	}

	return { ok: true };
}

/**
 * @param {URL} url
 */
function readMaxUsers(url) {
	const value = Number(url.searchParams.get('maxUsers'));
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
