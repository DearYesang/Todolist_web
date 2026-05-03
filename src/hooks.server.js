import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth, authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	if (!isTrustedUnsafeApiRequest(event)) {
		return Response.json({ message: 'Cross-site API writes are not allowed.' }, { status: 403 });
	}

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

/** @param {import('@sveltejs/kit').RequestEvent} event */
function isTrustedUnsafeApiRequest(event) {
	if (!event.url.pathname.startsWith('/api/') || isSafeMethod(event.request.method)) {
		return true;
	}

	const secFetchSite = event.request.headers.get('sec-fetch-site');
	if (secFetchSite === 'cross-site') {
		return false;
	}

	const origin = event.request.headers.get('origin');
	if (!origin) {
		if (process.env.NODE_ENV === 'production') {
			return false;
		}

		return !secFetchSite || secFetchSite === 'same-origin' || secFetchSite === 'same-site' || secFetchSite === 'none';
	}

	return getTrustedOrigins(event.url).has(origin);
}

/** @param {string} method */
function isSafeMethod(method) {
	return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

/** @param {URL} url */
function getTrustedOrigins(url) {
	const origins = new Set([url.origin]);
	const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
	if (!configured) {
		return origins;
	}

	configured
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
		.forEach((origin) => origins.add(origin));
	return origins;
}
