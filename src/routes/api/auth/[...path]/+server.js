import { auth, authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';
import { normalizePasskeyRegistrationRequest } from '$lib/server/auth/passkey-request.js';

const GENERIC_AUTH_UNAVAILABLE_MESSAGE = 'Auth service unavailable.';

/** @type {import('./$types').RequestHandler} */
async function handleAuth({ request }) {
	if (!authDatabaseConfigured) {
		return Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 503 });
	}

	if (authConfigurationError) {
		return Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 500 });
	}

	return auth.handler(await normalizePasskeyRegistrationRequest(request));
}

export const GET = handleAuth;
export const POST = handleAuth;
export const PUT = handleAuth;
export const PATCH = handleAuth;
export const DELETE = handleAuth;
export const OPTIONS = handleAuth;
