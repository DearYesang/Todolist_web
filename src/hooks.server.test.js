import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.js';

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe('server hook API write guard', () => {
	it('rejects cross-site unsafe API writes', async () => {
		const response = await handle({
			event: /** @type {any} */ (createEvent('POST', '/api/tasks', {
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site'
			})),
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
