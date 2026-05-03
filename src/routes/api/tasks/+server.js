import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { listTasksForUser } from '$lib/server/tasks/repository.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const tasks = await listTasksForUser(authResult.user.id);
	return json({ tasks });
}
