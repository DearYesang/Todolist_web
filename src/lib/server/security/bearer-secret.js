import { timingSafeEqual } from 'node:crypto';

/**
 * The token of a request's `Authorization: Bearer <token>` header, trimmed,
 * or undefined when it has no Authorization header.
 * @param {Request} request
 */
export function readBearerToken(request) {
	return request.headers
		.get('authorization')
		?.replace(/^Bearer\s+/i, '')
		.trim();
}

/**
 * Whether a presented secret equals the configured one, compared in
 * constant time. /api/health uses it for HEALTH_DETAILS_TOKEN and the
 * calendar cron for CRON_SECRET.
 *
 * The lengths are compared in UTF-8 bytes, the unit timingSafeEqual
 * needs: a header can carry Latin-1 characters, which are one character
 * but two bytes, and comparing character counts let such a candidate
 * reach timingSafeEqual and throw.
 * @param {string | undefined} candidate
 * @param {string} secret
 */
export function secretsMatch(candidate, secret) {
	if (!candidate) return false;
	const candidateBytes = Buffer.from(candidate);
	const secretBytes = Buffer.from(secret);
	return candidateBytes.length === secretBytes.length && timingSafeEqual(candidateBytes, secretBytes);
}
