import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { mergeCategoryForUser } from '$lib/server/categories/repository.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const payload = await readJsonBody(request);
		const result = await mergeCategoryForUser(authResult.user.id, params.categoryId, payload);
		return json(result);
	} catch (error) {
		return apiErrorResponse(error);
	}
}
