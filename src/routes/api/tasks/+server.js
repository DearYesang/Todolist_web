import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { createTaskForUser, listTasksForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

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

	let payload;
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const task = await createTaskForUser(authResult.user.id, payload);
		return json({ task }, { status: 201 });
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
