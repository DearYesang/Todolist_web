import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import {
	CalendarSyncError,
	syncCalendarProvidersForConnectedUsers
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';

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
		return json(await syncCalendarProvidersForConnectedUsers({
			maxUsers: readMaxUsers(url)
		}), {
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

	const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
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
 * @param {string | undefined} candidate
 * @param {string} secret
 */
function secretsMatch(candidate, secret) {
	if (!candidate || candidate.length !== secret.length) return false;
	return timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
}

/**
 * @param {URL} url
 */
function readMaxUsers(url) {
	const value = Number(url.searchParams.get('maxUsers'));
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
