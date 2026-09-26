import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';
import {
	getBoardPreferencesForUser,
	updateBoardPreferencesForUser
} from '$lib/server/tasks/repository.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	return json(await getBoardPreferencesForUser(authResult.user.id));
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const payload = await readJsonBody(request);
		return json(await updateBoardPreferencesForUser(authResult.user.id, payload));
	} catch (error) {
		return apiErrorResponse(error);
	}
}
