import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class CalendarTokenEncryptionError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'CalendarTokenEncryptionError';
		this.status = 503;
	}
}

/**
 * @param {string | null | undefined} value
 * @param {string} associatedData
 */
export function encryptCalendarToken(value, associatedData) {
	if (!value) {
		return null;
	}

	const key = getCalendarOauthKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(associatedData));
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [VERSION, toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join(':');
}

/**
 * @param {string | null | undefined} value
 * @param {string} associatedData
 */
export function decryptCalendarToken(value, associatedData) {
	if (!value) {
		return null;
	}

	const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(':');
	if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
		throw new CalendarTokenEncryptionError('Calendar OAuth token has an unsupported encryption format.');
	}

	const key = getCalendarOauthKey();
	const decipher = createDecipheriv('aes-256-gcm', key, fromBase64Url(encodedIv));
	decipher.setAAD(Buffer.from(associatedData));
	decipher.setAuthTag(fromBase64Url(encodedTag));
	return Buffer.concat([
		decipher.update(fromBase64Url(encodedCiphertext)),
		decipher.final()
	]).toString('utf8');
}

export function assertCalendarOauthEncryptionConfigured() {
	getCalendarOauthKey();
}

function getCalendarOauthKey() {
	const raw = process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;
	if (!raw || raw.includes('replace-with')) {
		throw new CalendarTokenEncryptionError('CALENDAR_OAUTH_ENCRYPTION_KEY must be configured before calendar provider sync can be used.');
	}

	const decoded = tryDecodeBase64(raw);
	if (decoded?.length === 32) {
		return decoded;
	}

	if (raw.length >= 32) {
		return createHash('sha256').update(raw).digest();
	}

	throw new CalendarTokenEncryptionError('CALENDAR_OAUTH_ENCRYPTION_KEY must be at least 32 bytes.');
}

/**
 * @param {string} value
 */
function tryDecodeBase64(value) {
	try {
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		const decoded = Buffer.from(normalized, 'base64');
		return decoded.length > 0 ? decoded : null;
	} catch {
		return null;
	}
}

/**
 * @param {Buffer} value
 */
function toBase64Url(value) {
	return value.toString('base64url');
}

/**
 * @param {string} value
 */
function fromBase64Url(value) {
	return Buffer.from(value, 'base64url');
}
