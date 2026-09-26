import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { CalendarTokenConfigurationError, revokeCalendarTokenForUser } from '$lib/server/calendar/tokens.js';
import { apiErrorResponse } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const token = await revokeCalendarTokenForUser(authResult.user.id, params.tokenId);
		return json(
			{ token },
			{
				headers: {
					'cache-control': 'private, no-store'
				}
			}
		);
	} catch (error) {
		return apiErrorResponse(error, CalendarTokenConfigurationError);
	}
}
