import { json } from '@sveltejs/kit';
import { requireAuthUser } from '$lib/server/auth/session.js';
import { enforceImportRateLimit } from '$lib/server/tasks/rate-limit-guard.js';
import { importTasksForUser, replaceTasksForUser } from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	const { request, url } = event;
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const limited = await enforceImportRateLimit(event, authResult.user.id);
	if (limited) {
		return limited;
	}

	let payload;
	try {
		const contentLength = Number(request.headers.get('content-length') ?? '0');
		if (contentLength > MAX_IMPORT_BYTES) {
			return json({ message: 'Import payload is too large.' }, { status: 413 });
		}

		const body = await request.text();
		if (body.length > MAX_IMPORT_BYTES) {
			return json({ message: 'Import payload is too large.' }, { status: 413 });
		}

		payload = JSON.parse(body);
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
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
		if (error instanceof TaskWriteError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
