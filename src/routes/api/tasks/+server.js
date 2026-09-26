import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';
import { enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { createTaskForUser, listTasksForUser } from '$lib/server/tasks/repository.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const tasks = await listTasksForUser(authResult.user.id);
	return json({ tasks });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceTaskWriteRateLimit(authResult.user.id);
	if (limited) {
		return limited;
	}

	try {
		const payload = await readJsonBody(request);
		const task = await createTaskForUser(authResult.user.id, payload);
		return json({ task }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
}
