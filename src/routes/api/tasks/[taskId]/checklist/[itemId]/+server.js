import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';
import { enforceTaskWriteRateLimit } from '$lib/server/security/rate-limit-guard.js';
import { deleteChecklistItemForUser, updateChecklistItemForUser } from '$lib/server/tasks/repository.js';

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

	try {
		const payload = await readJsonBody(request);
		const task = await updateChecklistItemForUser(authResult.user.id, params.taskId, params.itemId, payload);
		return json({ task });
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

	const limited = await enforceTaskWriteRateLimit(authResult.user.id);
	if (limited) {
		return limited;
	}

	try {
		const task = await deleteChecklistItemForUser(authResult.user.id, params.taskId, params.itemId);
		return json({ task });
	} catch (error) {
		return apiErrorResponse(error);
	}
}
