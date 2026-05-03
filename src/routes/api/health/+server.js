import { json } from '@sveltejs/kit';
import { getRuntimeConfigReport } from '$lib/server/config/env.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
	const report = getRuntimeConfigReport();
	const strict = url.searchParams.get('strict') === 'true' || process.env.NODE_ENV === 'production';
	const status = strict && !report.ok ? 503 : 200;

	return json({
		ok: strict ? report.ok : true,
		checkedAt: new Date().toISOString(),
		nodeEnv: report.nodeEnv,
		databaseConfigured: report.databaseConfigured,
		authReady: report.authReady,
		emailDeliveryReady: report.emailDeliveryReady,
		calendarFeedReady: report.calendarFeedReady,
		calendarProviderReady: report.calendarProviderReady,
		blocking: report.blocking.map(toPublicCheck),
		checks: report.checks.map(toPublicCheck)
	}, {
		status,
		headers: {
			'cache-control': 'no-store'
		}
	});
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
