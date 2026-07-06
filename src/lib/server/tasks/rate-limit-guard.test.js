import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimitBuckets } from '$lib/server/security/rate-limit.js';
import { enforceImportRateLimit, enforceTaskWriteRateLimit } from './rate-limit-guard.js';

/**
 * @param {string} ip
 */
function createEvent(ip = '203.0.113.10') {
	return {
		request: new Request('https://todo.example.com/api/tasks', {
			method: 'POST',
			headers: { 'x-forwarded-for': ip }
		})
	};
}

describe('task write rate-limit guard', () => {
	beforeEach(() => {
		resetRateLimitBuckets();
	});

	it('allows writes under the budget and returns 429 with retry-after once exceeded', async () => {
		const event = createEvent();

		for (let call = 0; call < 300; call += 1) {
			expect(await enforceTaskWriteRateLimit(event, 'user-a')).toBeNull();
		}

		const limited = await enforceTaskWriteRateLimit(event, 'user-a');
		expect(limited).toBeInstanceOf(Response);
		expect(limited?.status).toBe(429);
		expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
		expect((await limited?.json())?.message).toContain('Too many task changes');
	});

	it('gives the import endpoint its own scarcer budget', async () => {
		const event = createEvent();

		for (let call = 0; call < 10; call += 1) {
			expect(await enforceImportRateLimit(event, 'user-a')).toBeNull();
		}

		const limited = await enforceImportRateLimit(event, 'user-a');
		expect(limited?.status).toBe(429);

		// The import budget must not consume the task-write budget.
		expect(await enforceTaskWriteRateLimit(event, 'user-a')).toBeNull();
	});

	it('scopes budgets per user', async () => {
		const event = createEvent();

		for (let call = 0; call < 10; call += 1) {
			await enforceImportRateLimit(event, 'user-a');
		}

		expect((await enforceImportRateLimit(event, 'user-a'))?.status).toBe(429);
		expect(await enforceImportRateLimit(event, 'user-b')).toBeNull();
	});
});
