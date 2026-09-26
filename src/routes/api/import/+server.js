import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { apiErrorResponse, readJsonBody } from '$lib/server/http/api-error.js';
import { enforceImportRateLimit } from '$lib/server/security/rate-limit-guard.js';
import { importTasksForUser, replaceTasksForUser } from '$lib/server/tasks/repository.js';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, url }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceImportRateLimit(authResult.user.id);
	if (limited) {
		return limited;
	}

	try {
		const payload = await readJsonBody(request, {
			maxLength: MAX_IMPORT_BYTES,
			tooLargeMessage: 'Import payload is too large.'
		});
		const mode = url.searchParams.get('mode') === 'replace' ? 'replace' : 'append';
		const result = mode === 'replace'
			? await replaceTasksForUser(authResult.user.id, payload)
			: await importTasksForUser(authResult.user.id, payload);
		return json(result, {
			status: 201,
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		return apiErrorResponse(error);
	}
}
