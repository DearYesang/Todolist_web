import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { deleteTaskCascadeForUser, updateTaskForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request }) {
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
export async function DELETE({ params, request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
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
