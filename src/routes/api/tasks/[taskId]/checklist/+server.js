import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';
import { enforceTaskWriteRateLimit } from '$lib/server/security/rate-limit-guard.js';
import { createChecklistItemForUser } from '$lib/server/tasks/repository.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request }) {
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
		const task = await createChecklistItemForUser(authResult.user.id, params.taskId, payload);
		return json({ task }, { status: 201 });
	} catch (error) {
		return apiErrorResponse(error);
	}
}
