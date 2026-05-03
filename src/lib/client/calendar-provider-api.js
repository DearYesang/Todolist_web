/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   configured: boolean;
 * }} CalendarProviderRecord
 *
 * @typedef {{
 *   id: string;
 *   provider: string;
 *   providerAccountId: string | null;
 *   createdAt: string;
 *   updatedAt: string;
 *   expiresAt: string | null;
 * }} CalendarConnectionRecord
 *
 * @typedef {{
 *   connectionId: string;
 *   provider: string;
 *   upserted: number;
 *   deleted: number;
 *   failed: number;
 * }} CalendarSyncSummary
 */

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<
 *   | { ok: true; providers: CalendarProviderRecord[]; connections: CalendarConnectionRecord[] }
 *   | { ok: false; status: number; message: string }
 * >}
 */
export async function listCalendarProviders(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Calendar provider API is not available.');
	}

	try {
		const response = await fetcher('/api/calendar/providers', {
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);
		if (response.ok && isProviderListBody(body)) {
			return {
				ok: true,
				providers: body.providers,
				connections: body.connections
			};
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Calendar provider API failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Calendar provider API request could not be completed.');
	}
}

/**
 * @param {string} connectionId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<
 *   | { ok: true; deleted: string }
 *   | { ok: false; status: number; message: string }
 * >}
 */
export async function deleteCalendarConnection(connectionId, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Calendar provider API is not available.');
	}

	try {
		const response = await fetcher(`/api/calendar/providers/${encodeURIComponent(connectionId)}`, {
			method: 'DELETE',
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);
		if (response.ok && body && typeof body === 'object' && typeof /** @type {{ deleted?: unknown }} */ (body).deleted === 'string') {
			return { ok: true, deleted: /** @type {{ deleted: string }} */ (body).deleted };
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Calendar provider API failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Calendar provider API request could not be completed.');
	}
}

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<
 *   | { ok: true; connections: number; tasks: number; summaries: CalendarSyncSummary[] }
 *   | { ok: false; status: number; message: string }
 * >}
 */
export async function syncCalendarProviders(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Calendar provider API is not available.');
	}

	try {
		const response = await fetcher('/api/calendar/sync', {
			method: 'POST',
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);
		if (response.ok && isSyncBody(body)) {
			return {
				ok: true,
				connections: body.connections,
				tasks: body.tasks,
				summaries: body.summaries
			};
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Calendar sync failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Calendar sync request could not be completed.');
	}
}

/**
 * @param {number} status
 * @param {string} message
 * @returns {{ ok: false; status: number; message: string }}
 */
function createErrorResult(status, message) {
	return { ok: false, status, message };
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
 * @returns {body is { providers: CalendarProviderRecord[]; connections: CalendarConnectionRecord[] }}
 */
function isProviderListBody(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& Array.isArray(/** @type {{ providers?: unknown }} */ (body).providers)
		&& Array.isArray(/** @type {{ connections?: unknown }} */ (body).connections)
	);
}

/**
 * @param {unknown} body
 * @returns {body is { connections: number; tasks: number; summaries: CalendarSyncSummary[] }}
 */
function isSyncBody(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& typeof /** @type {{ connections?: unknown }} */ (body).connections === 'number'
		&& typeof /** @type {{ tasks?: unknown }} */ (body).tasks === 'number'
		&& Array.isArray(/** @type {{ summaries?: unknown }} */ (body).summaries)
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
