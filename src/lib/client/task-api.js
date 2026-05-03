import { normalizeTask } from '../shared/task-domain.js';

const FALLBACK_STATUSES = new Set([401, 409, 503]);

/**
 * @typedef {{
 *   ok: true;
 *   task: import('../shared/task-domain.js').Task;
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} CreateServerTaskResult
 */

/**
 * @param {unknown} payload
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CreateServerTaskResult>}
 */
export async function createServerTask(payload, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher('/api/tasks', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		const body = await readJsonBody(response);

		if (response.ok && isTaskResponse(body)) {
			return {
				ok: true,
				task: normalizeTask(body.task)
			};
		}

		return {
			ok: false,
			fallback: FALLBACK_STATUSES.has(response.status),
			status: response.status,
			message: readErrorMessage(body) ?? `Task API request failed with status ${response.status}.`
		};
	} catch {
		return createFallbackResult('Task API request could not be completed.');
	}
}

/**
 * @param {string} message
 * @returns {{ ok: false; fallback: true; status: 0; message: string }}
 */
function createFallbackResult(message) {
	return {
		ok: false,
		fallback: true,
		status: 0,
		message
	};
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
 * @param {unknown} body
 * @returns {body is { task: import('../shared/task-domain.js').Task }}
 */
function isTaskResponse(body) {
	return Boolean(body && typeof body === 'object' && 'task' in body);
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
