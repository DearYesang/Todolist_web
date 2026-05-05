import { auth, authConfigurationError, authDatabaseConfigured } from './index.js';

const GENERIC_AUTH_UNAVAILABLE_MESSAGE = 'Auth service unavailable.';

/**
 * @param {Request} request
 * @returns {Promise<
 *   | { ok: true; user: { id: string; email?: string; name?: string }; session: { id: string; token?: string } }
 *   | { ok: false; response: Response }
 * >}
 */
export async function requireAuthUser(request) {
	if (!authDatabaseConfigured) {
		return {
			ok: false,
			response: Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 503 })
		};
	}

	if (authConfigurationError) {
		return {
			ok: false,
			response: Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 500 })
		};
	}

	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user?.id) {
		return {
			ok: false,
			response: Response.json({ message: 'Authentication required.' }, { status: 401 })
		};
	}

	return { ok: true, user: session.user, session: session.session };
}
