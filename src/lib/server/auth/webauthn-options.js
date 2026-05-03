/**
 * @param {string | undefined} value
 */
export function normalizeWebAuthnOrigin(value) {
	if (!value) {
		return null;
	}

	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * @param {string | undefined} value
 */
export function normalizeRpID(value) {
	if (!value) {
		return null;
	}

	const trimmed = value.trim().toLowerCase();
	try {
		return new URL(trimmed).hostname;
	} catch {
		return trimmed;
	}
}

/** @param {string} value */
export function getHostname(value) {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return 'localhost';
	}
}
