import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { deleteCategoryForUser, updateCategoryForUser } from '$lib/server/categories/repository.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const payload = await readJsonBody(request);
		const result = await updateCategoryForUser(authResult.user.id, params.categoryId, payload);
		return json(result);
	} catch (error) {
		return apiErrorResponse(error);
	}
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const result = await deleteCategoryForUser(authResult.user.id, params.categoryId);
		return json(result);
	} catch (error) {
		return apiErrorResponse(error);
	}
}
