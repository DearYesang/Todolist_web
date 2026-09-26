// The passkey options read BETTER_AUTH_URL, PASSKEY_ORIGIN and PASSKEY_RP_ID
// with the rules the config report in env.js checks them by, so /api/health
// and Better Auth agree on what a value means.
export { normalizeOrigin as normalizeWebAuthnOrigin, normalizeRpId as normalizeRpID } from '$lib/server/config/env.js';

/**
 * The hostname to use as the RP ID when none is set. Unlike env.js's
 * getHostname, which reports an unusable origin as null, this falls back to
 * localhost so the auth module can always start.
 * @param {string} value
 */
export function getHostname(value) {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return 'localhost';
	}
}
