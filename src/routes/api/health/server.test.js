import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './+server.js';

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe('/api/health', () => {
	it('returns non-secret readiness details', async () => {
		const response = await GET(/** @type {any} */ ({ url: new URL('https://todo.example.com/api/health') }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual(expect.objectContaining({
			ok: true,
			databaseConfigured: expect.any(Boolean),
			checks: expect.any(Array)
		}));
		expect(JSON.stringify(body)).not.toContain('replace-with');
	});

	it('returns 503 in strict mode when required config is missing', async () => {
		process.env.NODE_ENV = 'production';
		delete process.env.DATABASE_URL;
		delete process.env.BETTER_AUTH_SECRET;

		const response = await GET(/** @type {any} */ ({ url: new URL('https://todo.example.com/api/health?strict=true') }));
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body.ok).toBe(false);
		expect(body.blocking.length).toBeGreaterThan(0);
	});
});
