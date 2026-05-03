import { sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';

/** @type {Map<string, { count: number; resetAt: number }>} */
const buckets = new Map();

export class RateLimitError extends Error {
	/**
	 * @param {string} message
	 * @param {number} retryAfter
	 */
	constructor(message, retryAfter) {
		super(message);
		this.name = 'RateLimitError';
		this.status = 429;
		this.retryAfter = retryAfter;
	}
}

/**
 * @param {string} key
 * @param {{ limit: number; windowMs: number; message?: string }} options
 */
export async function assertRateLimit(key, options) {
	if (process.env.DATABASE_URL) {
		await assertPersistentRateLimit(key, options);
		return;
	}

	assertMemoryRateLimit(key, options);
}

/**
 * @param {string} key
 * @param {{ limit: number; windowMs: number; message?: string }} options
 */
function assertMemoryRateLimit(key, options) {
	const now = Date.now();
	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + options.windowMs });
		return;
	}

	if (existing.count >= options.limit) {
		const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
		throw new RateLimitError(options.message ?? 'Too many requests.', retryAfter);
	}

	existing.count += 1;
}

/**
 * @param {string} key
 * @param {{ limit: number; windowMs: number; message?: string }} options
 */
async function assertPersistentRateLimit(key, options) {
	const now = new Date();
	const resetAt = new Date(now.getTime() + options.windowMs);
	const [row] = await getDb()
		.insert(schema.rateLimitBuckets)
		.values({
			key,
			count: 1,
			resetAt,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: schema.rateLimitBuckets.key,
			set: {
				count: sql`case
					when ${schema.rateLimitBuckets.resetAt} <= ${now} then 1
					else ${schema.rateLimitBuckets.count} + 1
				end`,
				resetAt: sql`case
					when ${schema.rateLimitBuckets.resetAt} <= ${now} then ${resetAt}
					else ${schema.rateLimitBuckets.resetAt}
				end`,
				updatedAt: now
			}
		})
		.returning({
			count: schema.rateLimitBuckets.count,
			resetAt: schema.rateLimitBuckets.resetAt
		});
	const count = Number(row?.count ?? 1);
	if (count <= options.limit) {
		return;
	}

	const resetAtMs = row?.resetAt?.getTime() ?? resetAt.getTime();
	const retryAfter = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
	throw new RateLimitError(options.message ?? 'Too many requests.', retryAfter);
}

/**
 * @param {import('@sveltejs/kit').RequestEvent | { request: Request; getClientAddress?: () => string }} event
 * @param {string} scope
 * @param {string} [subject]
 */
export function createRateLimitKey(event, scope, subject = '') {
	const ip = typeof event.getClientAddress === 'function'
		? safeClientAddress(/** @type {{ getClientAddress: () => string }} */ (event))
		: event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
	return `${scope}:${ip}:${subject.trim().toLowerCase()}`;
}

/**
 * @param {RateLimitError} error
 */
export function createRateLimitHeaders(error) {
	return {
		'retry-after': String(error.retryAfter)
	};
}

export function resetRateLimitBuckets() {
	buckets.clear();
}

/**
 * @param {{ getClientAddress: () => string }} event
 */
function safeClientAddress(event) {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}
