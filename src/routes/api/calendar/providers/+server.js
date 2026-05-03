import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { listCalendarProviderConnections } from '$lib/server/calendar/provider-sync.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	return json(await listCalendarProviderConnections(authResult.user.id), {
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}
