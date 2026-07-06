import {
	assertRateLimit,
	createRateLimitHeaders,
	RateLimitError
} from '$lib/server/security/rate-limit.js';

// Keyed on the user id alone (no client IP) so the budget is a true per-user
// hard stop: a leaked session replayed through rotating egress IPs shares one
// bucket. Generous enough that an offline-queue flush that trips it merely
// blocks and resumes on the next sync window (the client treats 429 as
// retryable), but a hard ceiling on Neon write amplification.
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
 * @param {string} userId
 * @returns {Promise<Response | null>} a 429 response when over budget
 */
export function enforceTaskWriteRateLimit(userId) {
	return enforceLimit('task-write', userId, TASK_WRITE_LIMIT);
}

/**
 * @param {string} userId
 * @returns {Promise<Response | null>} a 429 response when over budget
 */
export function enforceImportRateLimit(userId) {
	return enforceLimit('task-import', userId, IMPORT_LIMIT);
}

/**
 * @param {string} scope
 * @param {string} userId
 * @param {{ limit: number; windowMs: number; message?: string }} options
 * @returns {Promise<Response | null>}
 */
async function enforceLimit(scope, userId, options) {
	try {
		await assertRateLimit(`${scope}:user:${userId}`, options);
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
