import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarSyncError,
	deleteCalendarProviderConnection
} from '$lib/server/calendar/provider-sync.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const deleted = await deleteCalendarProviderConnection(authResult.user.id, params.connectionId);
		return json({ deleted }, {
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof CalendarSyncError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
