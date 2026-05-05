import { beforeEach, describe, expect, it } from 'vitest';
import {
	assertRateLimit,
	assertVolatileRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	getMemoryRateLimitBucketCount,
	RateLimitError,
	resetRateLimitBuckets
} from './rate-limit.js';

describe('server rate limit helper', () => {
	beforeEach(() => {
		resetRateLimitBuckets();
	});

	it('throws a 429 with Retry-After when the bucket is exhausted', async () => {
		await assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });
		await assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });

		await expect(assertRateLimit('test-key', { limit: 2, windowMs: 60_000 })).rejects.toThrow(RateLimitError);
		try {
			await assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });
		} catch (error) {
			expect(error).toBeInstanceOf(RateLimitError);
			expect(createRateLimitHeaders(/** @type {RateLimitError} */ (error))).toEqual({
				'retry-after': expect.any(String)
			});
		}
	});

	it('keys limits by ip, scope, and normalized subject', () => {
		const key = createRateLimitKey({
			request: new Request('https://todo.example.com/api', {
				headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }
			})
		}, 'email', ' USER@Example.COM ');

		expect(key).toBe('email:203.0.113.9:user@example.com');
	});

	it('caps volatile memory buckets to avoid unbounded token spray growth', () => {
		for (let index = 0; index < 2100; index += 1) {
			assertVolatileRateLimit(`spray-${index}`, { limit: 1, windowMs: 60_000 });
		}

		expect(getMemoryRateLimitBucketCount()).toBeLessThanOrEqual(2000);
	});
});
