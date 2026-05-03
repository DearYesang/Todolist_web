import { json } from '@sveltejs/kit';
import { authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';
import {
	AccountSecurityConfigurationError,
	createPasskeyEmailVerification
} from '$lib/server/auth/account-security.js';

const MAX_BODY_BYTES = 10_000;

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	if (!authDatabaseConfigured) {
		return json({ message: 'Auth database is not configured.' }, { status: 503 });
	}

	if (authConfigurationError) {
		return json({ message: authConfigurationError }, { status: 500 });
	}

	let payload;
	try {
		const contentLength = Number(request.headers.get('content-length') ?? '0');
		if (contentLength > MAX_BODY_BYTES) {
			return json({ message: 'Request body is too large.' }, { status: 413 });
		}

		payload = await request.json();
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const result = await createPasskeyEmailVerification({
			email: payload?.email,
			name: payload?.name
		});
		return json(result, {
			status: 201,
			headers: {
				'cache-control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof AccountSecurityConfigurationError) {
			return json({ message: error.message }, { status: error.status });
		}

		throw error;
	}
}
