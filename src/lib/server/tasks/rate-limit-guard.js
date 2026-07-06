import {
	assertRateLimit,
	createRateLimitHeaders,
	createRateLimitKey,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

// Generous for a personal board (an offline-queue flush replays mutations
// sequentially, far below this), but a hard stop for a leaked session or a
// runaway client loop hammering Neon writes.
const TASK_WRITE_LIMIT = {
	limit: 300,
	windowMs: 60_000,
	message: 'Too many task changes. Wait a moment and try again.'
};

// Imports admit up to 500 tasks + 2,500 checklist items per call, so the
// budget is per-call scarce.
const IMPORT_LIMIT = {
	limit: 10,
	windowMs: 10 * 60_000,
	message: 'Too many imports. Wait a few minutes and try again.'
};

/**
 * @typedef {import('@sveltejs/kit').RequestEvent | { request: Request; getClientAddress?: () => string }} RateLimitEvent
 */

/**
 * @param {RateLimitEvent} event
 * @param {string} userId
 * @returns {Promise<Response | null>} a 429 response when over budget
 */
export function enforceTaskWriteRateLimit(event, userId) {
	return enforceLimit(event, 'task-write', userId, TASK_WRITE_LIMIT);
}

/**
 * @param {RateLimitEvent} event
 * @param {string} userId
 * @returns {Promise<Response | null>} a 429 response when over budget
 */
export function enforceImportRateLimit(event, userId) {
	return enforceLimit(event, 'task-import', userId, IMPORT_LIMIT);
}

/**
 * @param {RateLimitEvent} event
 * @param {string} scope
 * @param {string} userId
 * @param {{ limit: number; windowMs: number; message?: string }} options
 * @returns {Promise<Response | null>}
 */
async function enforceLimit(event, scope, userId, options) {
	try {
		await assertRateLimit(createRateLimitKey(event, scope, userId), options);
		return null;
	} catch (error) {
		if (error instanceof RateLimitError) {
			return Response.json(
				{ message: error.message },
				{ status: 429, headers: createRateLimitHeaders(error) }
			);
		}

		throw error;
	}
}
