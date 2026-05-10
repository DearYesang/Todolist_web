import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { mergeCategoryForUser } from '$lib/server/categories/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let payload;
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const result = await mergeCategoryForUser(authResult.user.id, params.categoryId, payload);
		return json(result);
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}
		throw error;
	}
}
