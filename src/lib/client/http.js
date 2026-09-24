/**
 * Response helpers shared by the client *-api.js modules. Each module keeps
 * its own wording and, where it has one, its own set of retryable statuses:
 * task-api and category-api differ on purpose.
 *
 * @typedef {{ ok: false; status: number; message: string }} ErrorResult
 * @typedef {{ ok: false; fallback: boolean; status: number; message: string }} HttpErrorResult
 * @typedef {{ ok: false; fallback: true; status: 0; message: string }} FallbackResult
 * @typedef {{ fields?: readonly string[]; allowBlank?: boolean }} ErrorMessageOptions
 */

/**
 * The parsed JSON body, or null when the body is empty or not JSON.
 * @param {Response} response
 * @returns {Promise<any>}
 */
export async function readJsonBody(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

/**
 * The error text of a JSON error body, or null. By default only a
 * non-blank `message` string counts. `fields` lists the keys to try in
 * order and `allowBlank` accepts empty strings; the passkey module uses both
 * for Better Auth's `{ message | error | code }` bodies.
 * @param {unknown} body
 * @param {ErrorMessageOptions} [options]
 * @returns {string | null}
 */
export function readErrorMessage(body, { fields = ['message'], allowBlank = false } = {}) {
	if (!body || typeof body !== 'object') {
		return null;
	}

	const record = /** @type {Record<string, unknown>} */ (body);
	for (const field of fields) {
		const value = record[field];
		if (typeof value === 'string' && (allowBlank || value.trim())) {
			return value;
		}
	}

	return null;
}

/**
 * @param {number} status 0 when no HTTP answer arrived
 * @param {string} message
 * @returns {ErrorResult}
 */
export function createErrorResult(status, message) {
	return { ok: false, status, message };
}

/**
 * A failed HTTP answer from an API whose callers can fall back to local
 * state: `fallback` is true for the module's own retryable statuses. The
 * message is the body's, else `${failureMessage} with status ${status}.`
 * @param {Response} response
 * @param {unknown} body
 * @param {string} failureMessage e.g. 'Task API request failed'
 * @param {ReadonlySet<number>} fallbackStatuses
 * @returns {HttpErrorResult}
 */
export function createHttpErrorResult(response, body, failureMessage, fallbackStatuses) {
	return {
		ok: false,
		fallback: fallbackStatuses.has(response.status),
		status: response.status,
		message: readErrorMessage(body) ?? `${failureMessage} with status ${response.status}.`
	};
}

/**
 * No HTTP answer at all (no fetch, or the request threw): always a
 * fallback, with status 0.
 * @param {string} message
 * @returns {FallbackResult}
 */
export function createFallbackResult(message) {
	return {
		ok: false,
		fallback: true,
		status: 0,
		message
	};
}
