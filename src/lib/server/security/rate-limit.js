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
export function assertRateLimit(key, options) {
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
