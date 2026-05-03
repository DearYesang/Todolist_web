import { beforeEach, describe, expect, it } from 'vitest';
import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError,
	resetRateLimitBuckets
} from './rate-limit.js';

describe('server rate limit helper', () => {
	beforeEach(() => {
		resetRateLimitBuckets();
	});

	it('throws a 429 with Retry-After when the bucket is exhausted', () => {
		assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });
		assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });

		expect(() => assertRateLimit('test-key', { limit: 2, windowMs: 60_000 })).toThrow(RateLimitError);
		try {
			assertRateLimit('test-key', { limit: 2, windowMs: 60_000 });
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
});
