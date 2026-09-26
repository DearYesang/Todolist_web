import { timingSafeEqual } from 'node:crypto';

/**
 * The token of a request's `Authorization: Bearer <token>` header, trimmed,
 * or undefined when it has no Authorization header.
 * @param {Request} request
 */
export function readBearerToken(request) {
	return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Whether a presented secret equals the configured one, compared in
 * constant time. /api/health uses it for HEALTH_DETAILS_TOKEN and the
 * calendar cron for CRON_SECRET.
 * @param {string | undefined} candidate
 * @param {string} secret
 */
export function secretsMatch(candidate, secret) {
	if (!candidate || candidate.length !== secret.length) return false;
	return timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
}
