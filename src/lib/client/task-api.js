import { normalizeTask, normalizeTaskList } from '../shared/task-domain.js';
import { extractBackupTasks } from '../shared/task-backup.js';

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
 *
 * @typedef {{
 *   ok: true;
 *   tasks: import('../shared/task-domain.js').Task[];
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} ListServerTasksResult
 *
 * @typedef {CreateServerTaskResult} UpdateServerTaskResult
 *
 * @typedef {{
 *   ok: true;
 *   deleted: number;
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} DeleteServerTaskResult
 *
 * @typedef {{
 *   receivedTasks: number;
 *   importedTasks: number;
 *   skippedTasks: number;
 *   importedChecklistItems: number;
 *   skippedChecklistItems: number;
 *   repairedParentLinks: number;
 *   replacedTasks?: number;
 * }} TaskImportSummary
 *
 * @typedef {{
 *   ok: true;
 *   tasks: import('../shared/task-domain.js').Task[];
 *   summary: TaskImportSummary;
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} ImportServerTasksResult
 */

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ListServerTasksResult>}
 */
export async function listServerTasks(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher('/api/tasks', {
			headers: {
				accept: 'application/json'
			}
		});
		const body = await readJsonBody(response);

		if (response.ok && isTasksResponse(body)) {
			return {
				ok: true,
				tasks: normalizeTaskList(body.tasks)
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
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ListServerTasksResult>}
 */
export async function exportServerTasks(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher('/api/export', {
			headers: {
				accept: 'application/json'
			}
		});
		const body = await readJsonBody(response);

		if (response.ok && Array.isArray(body)) {
			return {
				ok: true,
				tasks: normalizeTaskList(body)
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
 * @param {unknown} payload
 * @param {{ mode?: 'append' | 'replace' } | typeof fetch} [options]
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ImportServerTasksResult>}
 */
export async function importServerTasks(payload, options = {}, fetcher = globalThis.fetch) {
	const requestOptions = typeof options === 'function' ? {} : options;
	const requestFetcher = typeof options === 'function' ? options : fetcher;
	if (typeof requestFetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	const tasks = extractBackupTasks(payload);
	if (!tasks) {
		return {
			ok: false,
			fallback: false,
			status: 400,
			message: 'Import payload must be an array of tasks or a backup object with a tasks array.'
		};
	}

	try {
		const mode = requestOptions.mode === 'replace' ? 'replace' : 'append';
		const url = mode === 'replace' ? '/api/import?mode=replace' : '/api/import';
		const response = await requestFetcher(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(tasks)
		});
		const body = await readJsonBody(response);

		if (response.ok && isImportResponse(body)) {
			return {
				ok: true,
				tasks: normalizeTaskList(body.tasks),
				summary: body.summary
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
 * @param {string} taskId
 * @param {unknown} patch
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<UpdateServerTaskResult>}
 */
export async function updateServerTask(taskId, patch, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}`, {
			method: 'PATCH',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(patch)
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
 * @param {string} taskId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<DeleteServerTaskResult>}
 */
export async function deleteServerTask(taskId, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}`, {
			method: 'DELETE',
			headers: {
				accept: 'application/json'
			}
		});
		const body = await readJsonBody(response);

		if (response.ok && isDeleteResponse(body)) {
			return {
				ok: true,
				deleted: body.deleted
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
 * @param {string} taskId
 * @param {string} text
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<UpdateServerTaskResult>}
 */
export async function createServerChecklistItem(taskId, text, fetcher = globalThis.fetch) {
	return writeServerTask(`/api/tasks/${encodeURIComponent(taskId)}/checklist`, {
		method: 'POST',
		body: { text }
	}, fetcher);
}

/**
 * @param {string} taskId
 * @param {string} itemId
 * @param {{ text?: string; done?: boolean }} patch
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<UpdateServerTaskResult>}
 */
export async function updateServerChecklistItem(taskId, itemId, patch, fetcher = globalThis.fetch) {
	return writeServerTask(`/api/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, {
		method: 'PATCH',
		body: patch
	}, fetcher);
}

/**
 * @param {string} taskId
 * @param {string} itemId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<UpdateServerTaskResult>}
 */
export async function deleteServerChecklistItem(taskId, itemId, fetcher = globalThis.fetch) {
	return writeServerTask(`/api/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, {
		method: 'DELETE'
	}, fetcher);
}

/**
 * @param {string} url
 * @param {{ method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }} request
 * @param {typeof fetch} fetcher
 * @returns {Promise<UpdateServerTaskResult>}
 */
async function writeServerTask(url, request, fetcher) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Task API is not available.');
	}

	try {
		const response = await fetcher(url, {
			method: request.method,
			headers: request.body === undefined
				? { accept: 'application/json' }
				: { 'content-type': 'application/json' },
			...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
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
 * @returns {body is { tasks: unknown[] }}
 */
function isTasksResponse(body) {
	return Boolean(body && typeof body === 'object' && 'tasks' in body && Array.isArray(body.tasks));
}

/**
 * @param {unknown} body
 * @returns {body is { deleted: number }}
 */
function isDeleteResponse(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& 'deleted' in body
		&& typeof /** @type {{ deleted?: unknown }} */ (body).deleted === 'number'
	);
}

/**
 * @param {unknown} body
 * @returns {body is { tasks: unknown[]; summary: TaskImportSummary }}
 */
function isImportResponse(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& 'tasks' in body
		&& Array.isArray(body.tasks)
		&& 'summary' in body
		&& body.summary
		&& typeof body.summary === 'object'
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
