/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   tokenPrefix: string;
 *   createdAt: string | Date;
 *   lastUsedAt: string | Date | null;
 *   revokedAt: string | Date | null;
 *   expiresAt: string | Date | null;
 * }} CalendarTokenRecord
 *
 * @typedef {{
 *   ok: true;
 *   tokens: CalendarTokenRecord[];
 * } | {
 *   ok: false;
 *   message: string;
 * }} CalendarTokenListResult
 *
 * @typedef {{
 *   ok: true;
 *   token: string;
 *   url: string;
 *   record: CalendarTokenRecord;
 * } | {
 *   ok: false;
 *   message: string;
 * }} CalendarTokenCreateResult
 *
 * @typedef {{
 *   ok: true;
 *   token: CalendarTokenRecord | null;
 * } | {
 *   ok: false;
 *   message: string;
 * }} CalendarTokenRevokeResult
 */

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CalendarTokenListResult>}
 */
export async function listCalendarTokens(fetcher = globalThis.fetch) {
	try {
		const response = await fetcher('/api/calendar/tokens', {
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);

		if (response.ok && isTokenListResponse(body)) {
			return { ok: true, tokens: body.tokens };
		}

		return { ok: false, message: readErrorMessage(body) ?? '캘린더 구독 목록을 불러오지 못했습니다.' };
	} catch {
		return { ok: false, message: '캘린더 구독 목록을 불러오지 못했습니다.' };
	}
}

/**
 * @param {string} name
 * @param {{ expiresInDays?: number } | typeof fetch} [options]
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CalendarTokenCreateResult>}
 */
export async function createCalendarToken(name, options = {}, fetcher = globalThis.fetch) {
	const requestOptions = typeof options === 'function' ? {} : options;
	const requestFetcher = typeof options === 'function' ? options : fetcher;
	try {
		const response = await requestFetcher('/api/calendar/tokens', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name,
				...(requestOptions.expiresInDays ? { expiresInDays: requestOptions.expiresInDays } : {})
			})
		});
		const body = await readJsonBody(response);

		if (response.ok && isTokenCreateResponse(body)) {
			return { ok: true, token: body.token, url: body.url, record: body.record };
		}

		return { ok: false, message: readErrorMessage(body) ?? '캘린더 구독 링크를 만들지 못했습니다.' };
	} catch {
		return { ok: false, message: '캘린더 구독 링크를 만들지 못했습니다.' };
	}
}

/**
 * @param {string} tokenId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CalendarTokenRevokeResult>}
 */
export async function revokeCalendarToken(tokenId, fetcher = globalThis.fetch) {
	try {
		const response = await fetcher(`/api/calendar/tokens/${encodeURIComponent(tokenId)}`, {
			method: 'DELETE',
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);

		if (response.ok && isTokenRevokeResponse(body)) {
			return { ok: true, token: body.token };
		}

		return { ok: false, message: readErrorMessage(body) ?? '캘린더 구독 링크를 해지하지 못했습니다.' };
	} catch {
		return { ok: false, message: '캘린더 구독 링크를 해지하지 못했습니다.' };
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
 * @param {unknown} body
 * @returns {body is { tokens: CalendarTokenRecord[] }}
 */
function isTokenListResponse(body) {
	return Boolean(body && typeof body === 'object' && 'tokens' in body && Array.isArray(body.tokens));
}

/**
 * @param {unknown} body
 * @returns {body is { token: string; url: string; record: CalendarTokenRecord }}
 */
function isTokenCreateResponse(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& 'token' in body
		&& typeof body.token === 'string'
		&& 'url' in body
		&& typeof body.url === 'string'
		&& 'record' in body
		&& body.record
	);
}

/**
 * @param {unknown} body
 * @returns {body is { token: CalendarTokenRecord | null }}
 */
function isTokenRevokeResponse(body) {
	return Boolean(body && typeof body === 'object' && 'token' in body);
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
