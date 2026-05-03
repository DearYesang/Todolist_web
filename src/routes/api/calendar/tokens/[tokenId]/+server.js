import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarTokenConfigurationError,
	revokeCalendarTokenForUser
} from '$lib/server/calendar/tokens.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const token = await revokeCalendarTokenForUser(authResult.user.id, params.tokenId);
		return json({ token }, {
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof CalendarTokenConfigurationError) {
			return json({ message: error.message }, { status: 503 });
		}

		throw error;
	}
}
