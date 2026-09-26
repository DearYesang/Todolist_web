import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { CalendarSyncError, deleteCalendarProviderConnection } from '$lib/server/calendar/provider-sync.js';
import { apiErrorResponse } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const deleted = await deleteCalendarProviderConnection(authResult.user.id, params.connectionId);
		return json(
			{ deleted },
			{
				headers: {
					'cache-control': 'private, no-store'
				}
			}
		);
	} catch (error) {
		return apiErrorResponse(error, CalendarSyncError);
	}
}
