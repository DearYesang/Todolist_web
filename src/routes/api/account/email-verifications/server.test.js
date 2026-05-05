import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AccountSecurityPolicyError,
	assertAllowedAccountEmail,
	createPasskeyEmailVerification
} from '$lib/server/auth/account-security.js';
import { resetRateLimitBuckets } from '$lib/server/security/rate-limit.js';
import { POST } from './+server.js';

vi.mock('$lib/server/auth/index.js', () => ({
	authDatabaseConfigured: true,
	authConfigurationError: null
}));

vi.mock('$lib/server/auth/account-security.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertAllowedAccountEmail: vi.fn(),
	createPasskeyEmailVerification: vi.fn()
}));

describe('/api/account/email-verifications route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		resetRateLimitBuckets();
		vi.mocked(createPasskeyEmailVerification).mockResolvedValue({
			email: 'primary@example.com',
			expiresAt: '2026-05-06T00:15:00.000Z'
		});
	});

	it('sends a code only after allowlist and subject rate checks pass', async () => {
		const response = await POST(createEvent('primary@example.com'));
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(body).toEqual({
			email: 'primary@example.com',
			expiresAt: '2026-05-06T00:15:00.000Z'
		});
		expect(assertAllowedAccountEmail).toHaveBeenCalledWith('primary@example.com');
		expect(createPasskeyEmailVerification).toHaveBeenCalledWith({
			email: 'primary@example.com',
			name: 'User'
		});
	});

	it('returns a generic accepted response for disallowed emails without sending mail', async () => {
		vi.mocked(assertAllowedAccountEmail).mockImplementation(() => {
			throw new AccountSecurityPolicyError('not allowed');
		});

		const response = await POST(createEvent('other@example.com'));
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(body).toEqual({
			email: 'other@example.com',
			expiresAt: expect.any(String)
		});
		expect(createPasskeyEmailVerification).not.toHaveBeenCalled();
	});

	it('uses a coarse IP limit before email-specific work', async () => {
		for (let index = 0; index < 20; index += 1) {
			const response = await POST(createEvent(`person-${index}@example.com`));
			expect(response.status).toBe(201);
		}

		const blocked = await POST(createEvent('person-20@example.com'));

		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toEqual(expect.any(String));
	});
});

/**
 * @param {string} email
 * @param {string} ip
 */
function createEvent(email, ip = '203.0.113.40') {
	return /** @type {any} */ ({
		request: new Request('https://todo.example.com/api/account/email-verifications', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': ip
			},
			body: JSON.stringify({ email, name: 'User' })
		}),
		getClientAddress: () => ip
	});
}
