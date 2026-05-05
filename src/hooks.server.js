import { building } from '$app/environment';
import { authConfigurationError, authDatabaseConfigured } from '$lib/server/auth/index.js';

const GENERIC_AUTH_UNAVAILABLE_MESSAGE = 'Auth service unavailable.';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	if (!isTrustedUnsafeApiRequest(event)) {
		return withSecurityHeaders(Response.json({ message: 'Cross-site API writes are not allowed.' }, { status: 403 }), event);
	}

	if (!authDatabaseConfigured) {
		if (isAuthRoute(event.url.pathname)) {
			return withSecurityHeaders(Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 503 }), event);
		}

		return withSecurityHeaders(await resolve(event), event);
	}

	if (authConfigurationError && isAuthRoute(event.url.pathname)) {
		return withSecurityHeaders(Response.json({ message: GENERIC_AUTH_UNAVAILABLE_MESSAGE }, { status: 500 }), event);
	}

	if (building) {
		return withSecurityHeaders(await resolve(event), event);
	}

	return withSecurityHeaders(await resolve(event), event);
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

/**
 * @param {Response} response
 * @param {import('@sveltejs/kit').RequestEvent} event
 */
function withSecurityHeaders(response, event) {
	const headers = response.headers;
	const production = process.env.NODE_ENV === 'production';
	if (!headers.has('content-security-policy')) {
		headers.set('content-security-policy', createFallbackContentSecurityPolicy(production));
	}

	headers.set('x-content-type-options', 'nosniff');
	headers.set('x-frame-options', 'DENY');
	headers.set('referrer-policy', 'no-referrer');
	headers.set('permissions-policy', [
		'accelerometer=()',
		'camera=()',
		'geolocation=()',
		'gyroscope=()',
		'magnetometer=()',
		'microphone=()',
		'payment=()',
		'usb=()'
	].join(', '));
	headers.set('cross-origin-opener-policy', 'same-origin');
	if (production && event.url.protocol === 'https:') {
		headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}

	return response;
}

/**
 * SvelteKit owns page CSP so it can add the inline bootstrap hash. This fallback
 * covers JSON/API responses that do not pass through the page renderer.
 * @param {boolean} production
 */
function createFallbackContentSecurityPolicy(production) {
	const scriptSrc = production
		? "script-src 'self'"
		: "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
	const connectSrc = production
		? "connect-src 'self'"
		: "connect-src 'self' http: https: ws:";
	const styleSrc = "style-src 'self' 'unsafe-inline'";

	const cspDirectives = [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		styleSrc,
		scriptSrc,
		connectSrc,
		"manifest-src 'self'",
		"worker-src 'self'",
		"form-action 'self'"
	];
	if (production) {
		cspDirectives.push('upgrade-insecure-requests');
	}
	return cspDirectives.join('; ');
}
