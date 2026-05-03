import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	CalendarTokenConfigurationError,
	createCalendarTokenForUser,
	listCalendarTokensForUser
} from '$lib/server/calendar/tokens.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const tokens = await listCalendarTokensForUser(authResult.user.id);
		return json({ tokens }, {
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

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let payload = {};
	try {
		payload = await request.json();
	} catch {
		payload = {};
	}

	try {
		const result = await createCalendarTokenForUser(authResult.user.id, payload);
		return json(result, {
			status: 201,
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
