import { timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { getRuntimeConfigReport } from '$lib/server/config/env.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, url }) {
	const report = getRuntimeConfigReport({ currentOrigin: url.origin });
	const strict = url.searchParams.get('strict') === 'true' || process.env.NODE_ENV === 'production';
	const status = strict && !report.ok ? 503 : 200;
	const detailed = shouldExposeDetails(request);
	const body = {
		ok: strict ? report.ok : true,
		checkedAt: new Date().toISOString(),
		status: report.ok ? 'ready' : 'blocked',
		...(detailed ? {
			nodeEnv: report.nodeEnv,
			databaseConfigured: report.databaseConfigured,
			authReady: report.authReady,
			emailDeliveryReady: report.emailDeliveryReady,
			calendarFeedReady: report.calendarFeedReady,
			calendarProviderReady: report.calendarProviderReady,
			blocking: report.blocking.map(toPublicCheck),
			checks: report.checks.map(toPublicCheck)
		} : {})
	};

	return json(body, {
		status,
		headers: {
			'cache-control': 'no-store'
		}
	});
}

/** @param {Request} request */
function shouldExposeDetails(request) {
	if (process.env.NODE_ENV !== 'production') {
		return true;
	}

	const token = process.env.HEALTH_DETAILS_TOKEN;
	const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
	return Boolean(token && token.length >= 32 && secretsMatch(bearer, token));
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
 * @param {import('$lib/server/config/env.js').ConfigCheck} check
 */
function toPublicCheck(check) {
	return {
		key: check.key,
		status: check.status,
		required: check.required,
		message: check.message
	};
}
