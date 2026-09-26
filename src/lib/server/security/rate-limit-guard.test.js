import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimitBuckets } from '$lib/server/security/rate-limit.js';
import { enforceImportRateLimit, enforceTaskWriteRateLimit } from './rate-limit-guard.js';

describe('task write rate-limit guard', () => {
	beforeEach(() => {
		resetRateLimitBuckets();
	});

	it('allows writes under the budget and returns 429 with retry-after once exceeded', async () => {
		for (let call = 0; call < 300; call += 1) {
			expect(await enforceTaskWriteRateLimit('user-a')).toBeNull();
		}

		const limited = await enforceTaskWriteRateLimit('user-a');
		expect(limited).toBeInstanceOf(Response);
		expect(limited?.status).toBe(429);
		expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
		expect((await limited?.json())?.message).toContain('Too many task changes');
	});

	it('keys the budget on the user alone, so no request context can mint a fresh bucket', async () => {
		// A leaked session replayed through rotating egress IPs must share one
		// budget: the guard takes only the user id, nothing request-derived.
		for (let call = 0; call < 10; call += 1) {
			await enforceImportRateLimit('user-a');
		}

		expect((await enforceImportRateLimit('user-a'))?.status).toBe(429);
		expect(enforceImportRateLimit.length).toBe(1);
		expect(enforceTaskWriteRateLimit.length).toBe(1);
	});

	it('gives the import endpoint its own scarcer budget', async () => {
		for (let call = 0; call < 10; call += 1) {
			expect(await enforceImportRateLimit('user-a')).toBeNull();
		}

		const limited = await enforceImportRateLimit('user-a');
		expect(limited?.status).toBe(429);

		// The import budget must not consume the task-write budget.
		expect(await enforceTaskWriteRateLimit('user-a')).toBeNull();
	});

	it('scopes budgets per user', async () => {
		for (let call = 0; call < 10; call += 1) {
			await enforceImportRateLimit('user-a');
		}

		expect((await enforceImportRateLimit('user-a'))?.status).toBe(429);
		expect(await enforceImportRateLimit('user-b')).toBeNull();
	});
});
