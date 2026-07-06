import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { deleteChecklistItemForUser, updateChecklistItemForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request }) {
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
		const task = await updateChecklistItemForUser(authResult.user.id, params.taskId, params.itemId, payload);
		return json({ task });
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceTaskWriteRateLimit(authResult.user.id);
	if (limited) {
		return limited;
	}

	try {
		const task = await deleteChecklistItemForUser(authResult.user.id, params.taskId, params.itemId);
		return json({ task });
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
