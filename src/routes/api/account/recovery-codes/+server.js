import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	createRecoveryCodesForUser,
	getRecoveryCodeSummaryForUser,
	revokeRecoveryCodesForUser
} from '$lib/server/auth/account-security.js';
import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	return json(await getRecoveryCodeSummaryForUser(authResult.user.id), {
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	const { request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		await assertRateLimit(createRateLimitKey(event, 'recovery-code-create', authResult.user.id), {
			limit: 3,
			windowMs: 60 * 60 * 1000,
			message: 'Too many recovery code regeneration requests.'
		});
		return json(await createRecoveryCodesForUser(authResult.user.id), {
			status: 201,
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

		throw error;
	}
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE(event) {
	const { request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		await assertRateLimit(createRateLimitKey(event, 'recovery-code-revoke', authResult.user.id), {
			limit: 6,
			windowMs: 60 * 60 * 1000,
			message: 'Too many recovery code revoke requests.'
		});
		return json(await revokeRecoveryCodesForUser(authResult.user.id), {
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

		throw error;
	}
}
