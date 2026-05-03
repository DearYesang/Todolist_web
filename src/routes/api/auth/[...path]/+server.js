import { auth, authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';

/** @type {import('./$types').RequestHandler} */
async function handleAuth({ request }) {
	if (!authDatabaseConfigured) {
		return Response.json({ message: 'Auth database is not configured.' }, { status: 503 });
	}

	if (authConfigurationError) {
		return Response.json({ message: authConfigurationError }, { status: 500 });
	}

	return auth.handler(request);
}

export const GET = handleAuth;
export const POST = handleAuth;
export const PUT = handleAuth;
export const PATCH = handleAuth;
export const DELETE = handleAuth;
export const OPTIONS = handleAuth;
