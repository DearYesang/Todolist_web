import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { reorderCategoriesForUser } from '$lib/server/categories/repository.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const payload = await readJsonBody(request);
		const categories = await reorderCategoriesForUser(authResult.user.id, payload);
		return json({ categories });
	} catch (error) {
		return apiErrorResponse(error);
	}
}
