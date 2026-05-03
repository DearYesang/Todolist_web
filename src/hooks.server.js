import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth, authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	if (!authDatabaseConfigured) {
		if (isAuthRoute(event.url.pathname)) {
			return Response.json({ message: 'Auth database is not configured.' }, { status: 503 });
		}

		return resolve(event);
	}

	if (authConfigurationError && isAuthRoute(event.url.pathname)) {
		return Response.json({ message: authConfigurationError }, { status: 500 });
	}

	return svelteKitHandler({ event, resolve, auth, building });
}

/** @param {string} pathname */
function isAuthRoute(pathname) {
	return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}
