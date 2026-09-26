import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { createCategoryForUser, listCategoriesForUser } from '$lib/server/categories/repository.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const categories = await listCategoriesForUser(authResult.user.id);
	return json({ categories }, {
		headers: {
			'cache-control': 'private, no-store'
		}
	});
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	try {
		const payload = await readJsonBody(request);
		const category = await createCategoryForUser(authResult.user.id, payload);
		return json({ category }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
}
