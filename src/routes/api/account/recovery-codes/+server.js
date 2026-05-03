import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	createRecoveryCodesForUser,
	getRecoveryCodeSummaryForUser,
	revokeRecoveryCodesForUser
} from '$lib/server/auth/account-security.js';

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
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	return json(await createRecoveryCodesForUser(authResult.user.id), {
		status: 201,
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	return json(await revokeRecoveryCodesForUser(authResult.user.id), {
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}
