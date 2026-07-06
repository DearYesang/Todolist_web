import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceTaskWriteRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { deleteTaskCascadeForUser, updateTaskForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH(event) {
	const { params, request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceTaskWriteRateLimit(event, authResult.user.id);
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
		const task = await updateTaskForUser(authResult.user.id, params.taskId, payload);
		return json({ task });
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE(event) {
	const { params, request } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceTaskWriteRateLimit(event, authResult.user.id);
	if (limited) {
		return limited;
	}

	let payload;
	try {
		const body = await request.text();
		payload = body.trim() ? JSON.parse(body) : undefined;
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const deleted = await deleteTaskCascadeForUser(authResult.user.id, params.taskId, payload);
		return json({ deleted });
	} catch (error) {
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
