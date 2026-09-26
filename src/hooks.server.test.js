import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.js';

// The tests run without DATABASE_URL, as auth/index.js would see it: no
// database and so no auth configuration error. The auth describe block
// switches both.
const authState = vi.hoisted(() => ({
	databaseConfigured: false,
	configurationError: /** @type {string | null} */ (null)
}));

vi.mock('$lib/server/auth/index.js', () => ({
	get authDatabaseConfigured() {
		return authState.databaseConfigured;
	},
	get authConfigurationError() {
		return authState.configurationError;
	}
}));

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
	authState.databaseConfigured = false;
	authState.configurationError = null;
});

describe('server hook API write guard', () => {
	it('rejects cross-site unsafe API writes', async () => {
		const response = await handle({
			event: /** @type {any} */ (
				createEvent('POST', '/api/tasks', {
					origin: 'https://evil.example',
					'sec-fetch-site': 'cross-site'
				})
			),
			resolve: vi.fn(async () => new Response('ok'))
		});

		expect(response.status).toBe(403);
	});

	it('rejects missing Origin for production unsafe API writes', async () => {
		process.env.NODE_ENV = 'production';
		const response = await handle({
			event: /** @type {any} */ (createEvent('POST', '/api/tasks')),
			resolve: vi.fn(async () => new Response('ok'))
		});

		expect(response.status).toBe(403);
	});

	it('allows safe non-auth requests through resolve', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({
			event: /** @type {any} */ (createEvent('GET', '/')),
			resolve
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('adds baseline security headers to app responses', async () => {
		const response = await handle({
			event: /** @type {any} */ (createEvent('GET', '/')),
			resolve: vi.fn(async () => new Response('ok'))
		});

		expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
		expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	});
});

describe('server hook auth availability', () => {
	/**
	 * @param {string} pathname
	 */
	async function runHandle(pathname) {
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({ event: /** @type {any} */ (createEvent('GET', pathname)), resolve });
		return { resolve, response };
	}

	it('answers the auth routes 503 without a database and 500 with an auth configuration error', async () => {
		let { resolve, response } = await runHandle('/api/auth/get-session');
		expect([response.status, await response.json()]).toEqual([503, { message: 'Auth service unavailable.' }]);
		expect(resolve).not.toHaveBeenCalled();

		authState.databaseConfigured = true;
		authState.configurationError = 'BETTER_AUTH_SECRET is missing.';
		({ resolve, response } = await runHandle('/api/auth/get-session'));
		expect([response.status, await response.json()]).toEqual([500, { message: 'Auth service unavailable.' }]);
		expect(resolve).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'an API route without a database',
			pathname: '/api/tasks',
			databaseConfigured: false,
			configurationError: null
		},
		{
			name: 'an API route with an auth configuration error',
			pathname: '/api/tasks',
			databaseConfigured: true,
			configurationError: 'BETTER_AUTH_SECRET is missing.'
		},
		{
			name: 'an auth route with a working auth service',
			pathname: '/api/auth/get-session',
			databaseConfigured: true,
			configurationError: null
		},
		{
			name: 'an app page with a working auth service',
			pathname: '/',
			databaseConfigured: true,
			configurationError: null
		}
	])(
		'passes $name to the route with the security headers',
		async ({ pathname, databaseConfigured, configurationError }) => {
			authState.databaseConfigured = databaseConfigured;
			authState.configurationError = configurationError;
			const { resolve, response } = await runHandle(pathname);

			expect(resolve).toHaveBeenCalledOnce();
			expect(await response.text()).toBe('ok');
			expect(response.headers.get('x-frame-options')).toBe('DENY');
			expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
		}
	);
});

describe('open-all links isolation headers', () => {
	// "Open all links" calls window.open without 'noopener' so blocked tabs
	// stay detectable; COOP same-origin and no-referrer are what keep the
	// opened tabs cut off from the app. Pin both.
	/** @type {Array<{ name: string; method: string; pathname: string; headers: Record<string, string>; production: boolean }>} */
	const cases = [
		{ name: 'app page', method: 'GET', pathname: '/', headers: {}, production: false },
		{ name: 'production app page', method: 'GET', pathname: '/', headers: {}, production: true },
		{
			name: 'rejected cross-site API write',
			method: 'POST',
			pathname: '/api/tasks',
			headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
			production: false
		}
	];

	it.each(cases)(
		'sends COOP same-origin and no-referrer on $name responses',
		async ({ method, pathname, headers, production }) => {
			if (production) {
				process.env.NODE_ENV = 'production';
			}
			const response = await handle({
				event: /** @type {any} */ (createEvent(method, pathname, headers)),
				resolve: vi.fn(async () => new Response('ok'))
			});

			expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
			expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		}
	);
});

/**
 * @param {string} method
 * @param {string} pathname
 * @param {Record<string, string>} [headers]
 */
function createEvent(method, pathname, headers = {}) {
	const url = new URL(pathname, 'https://todo.example.com');
	return {
		url,
		request: new Request(url, { method, headers }),
		getClientAddress: () => '127.0.0.1'
	};
}
