/**
 * @typedef {{
 *   total: number;
 *   available: number;
 *   lastCreatedAt: string | null;
 * }} RecoveryCodeSummary
 *
 * @typedef {{
 *   ok: true;
 *   email: string;
 *   expiresAt: string;
 *   previewCode?: string;
 * } | {
 *   ok: false;
 *   message: string;
 *   status: number;
 * }} EmailVerificationResult
 *
 * @typedef {{
 *   ok: true;
 *   summary: RecoveryCodeSummary;
 *   codes?: string[];
 * } | {
 *   ok: false;
 *   message: string;
 *   status: number;
 * }} RecoveryCodesResult
 */

/**
 * @param {{ email: string; name?: string }} payload
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<EmailVerificationResult>}
 */
export async function requestEmailVerificationCode(payload, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return { ok: false, status: 0, message: 'Account API is not available.' };
	}

	try {
		const response = await fetcher('/api/account/email-verifications', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const body = await readJsonBody(response);

		if (response.ok && body && typeof body === 'object') {
			const result = /** @type {{ email?: unknown; expiresAt?: unknown; previewCode?: unknown }} */ (body);
			if (typeof result.email === 'string' && typeof result.expiresAt === 'string') {
				return {
					ok: true,
					email: result.email,
					expiresAt: result.expiresAt,
					...(typeof result.previewCode === 'string' ? { previewCode: result.previewCode } : {})
				};
			}
		}

		return createErrorResult(response.status, body);
	} catch {
		return { ok: false, status: 0, message: 'Email verification request could not be completed.' };
	}
}

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<RecoveryCodesResult>}
 */
export async function getRecoveryCodeSummary(fetcher = globalThis.fetch) {
	return requestRecoveryCodes('GET', fetcher);
}

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<RecoveryCodesResult>}
 */
export async function createRecoveryCodes(fetcher = globalThis.fetch) {
	return requestRecoveryCodes('POST', fetcher);
}

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<RecoveryCodesResult>}
 */
export async function revokeRecoveryCodes(fetcher = globalThis.fetch) {
	return requestRecoveryCodes('DELETE', fetcher);
}

/**
 * @param {'GET' | 'POST' | 'DELETE'} method
 * @param {typeof fetch} fetcher
 * @returns {Promise<RecoveryCodesResult>}
 */
async function requestRecoveryCodes(method, fetcher) {
	if (typeof fetcher !== 'function') {
		return { ok: false, status: 0, message: 'Account API is not available.' };
	}

	try {
		const response = await fetcher('/api/account/recovery-codes', {
			method,
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);

		if (response.ok && isRecoveryCodeBody(body)) {
			return {
				ok: true,
				summary: 'summary' in body ? body.summary : body,
				...('codes' in body && Array.isArray(body.codes) ? { codes: body.codes.filter((code) => typeof code === 'string') } : {})
			};
		}

		return createErrorResult(response.status, body);
	} catch {
		return { ok: false, status: 0, message: 'Recovery code request could not be completed.' };
	}
}

/**
 * @param {Response} response
 */
async function readJsonBody(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {{ ok: false; status: number; message: string }}
 */
function createErrorResult(status, body) {
	return {
		ok: false,
		status,
		message: readErrorMessage(body) ?? `Account API request failed with status ${status}.`
	};
}

/**
 * @param {unknown} body
 * @returns {body is RecoveryCodeSummary | { summary: RecoveryCodeSummary; codes?: string[] }}
 */
function isRecoveryCodeBody(body) {
	if (!body || typeof body !== 'object') {
		return false;
	}

	if ('summary' in body) {
		const summary = /** @type {{ summary?: unknown }} */ (body).summary;
		return isRecoveryCodeSummary(summary);
	}

	return isRecoveryCodeSummary(body);
}

/**
 * @param {unknown} value
 * @returns {value is RecoveryCodeSummary}
 */
function isRecoveryCodeSummary(value) {
	return Boolean(
		value
		&& typeof value === 'object'
		&& typeof /** @type {{ total?: unknown }} */ (value).total === 'number'
		&& typeof /** @type {{ available?: unknown }} */ (value).available === 'number'
		&& (
			/** @type {{ lastCreatedAt?: unknown }} */ (value).lastCreatedAt === null
			|| typeof /** @type {{ lastCreatedAt?: unknown }} */ (value).lastCreatedAt === 'string'
		)
	);
}

/**
 * @param {unknown} body
 */
function readErrorMessage(body) {
	if (!body || typeof body !== 'object' || !('message' in body)) {
		return null;
	}

	const message = /** @type {{ message?: unknown }} */ (body).message;
	return typeof message === 'string' && message.trim() ? message : null;
}
