/**
 * @typedef {{
 *   id: string;
 *   name: string | null;
 *   userId?: string;
 *   credentialID?: string;
 *   deviceType?: string;
 *   backedUp?: boolean;
 *   transports?: string | null;
 *   createdAt?: string;
 *   updatedAt?: string;
 * }} ManagedPasskey
 *
 * @typedef {{
 *   ok: true;
 *   passkeys: ManagedPasskey[];
 * } | {
 *   ok: false;
 *   status: number;
 *   message: string;
 * }} ListPasskeysResult
 *
 * @typedef {{
 *   ok: true;
 *   passkey: ManagedPasskey;
 * } | {
 *   ok: false;
 *   status: number;
 *   message: string;
 * }} UpdatePasskeyResult
 *
 * @typedef {{
 *   ok: true;
 * } | {
 *   ok: false;
 *   status: number;
 *   message: string;
 * }} DeletePasskeyResult
 */

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ListPasskeysResult>}
 */
export async function listUserPasskeys(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Passkey API is not available.');
	}

	try {
		const response = await fetcher('/api/auth/passkey/list-user-passkeys', {
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);

		if (response.ok && Array.isArray(body)) {
			return {
				ok: true,
				passkeys: body.reduce((passkeys, item) => {
					const passkey = normalizePasskey(item);
					if (passkey) {
						passkeys.push(passkey);
					}
					return passkeys;
				}, /** @type {ManagedPasskey[]} */ ([]))
			};
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Passkey API request failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Passkey list request could not be completed.');
	}
}

/**
 * @param {string} id
 * @param {string} name
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<UpdatePasskeyResult>}
 */
export async function updateUserPasskeyName(id, name, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Passkey API is not available.');
	}

	try {
		const response = await fetcher('/api/auth/passkey/update-passkey', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ id, name })
		});
		const body = await readJsonBody(response);

		if (response.ok && body && typeof body === 'object' && 'passkey' in body) {
			const passkey = normalizePasskey(/** @type {{ passkey?: unknown }} */ (body).passkey);
			if (passkey) {
				return { ok: true, passkey };
			}
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Passkey API request failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Passkey update request could not be completed.');
	}
}

/**
 * @param {string} id
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<DeletePasskeyResult>}
 */
export async function deleteUserPasskey(id, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createErrorResult(0, 'Passkey API is not available.');
	}

	try {
		const response = await fetcher('/api/auth/passkey/delete-passkey', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ id })
		});
		const body = await readJsonBody(response);

		if (response.ok && body && typeof body === 'object' && /** @type {{ status?: unknown }} */ (body).status === true) {
			return { ok: true };
		}

		return createErrorResult(response.status, readErrorMessage(body) ?? `Passkey API request failed with status ${response.status}.`);
	} catch {
		return createErrorResult(0, 'Passkey delete request could not be completed.');
	}
}

/**
 * @param {unknown} value
 * @returns {ManagedPasskey | null}
 */
function normalizePasskey(value) {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const row = /** @type {Record<string, unknown>} */ (value);
	if (typeof row.id !== 'string') {
		return null;
	}

	return {
		id: row.id,
		name: typeof row.name === 'string' ? row.name : null,
		...(typeof row.userId === 'string' ? { userId: row.userId } : {}),
		...(typeof row.credentialID === 'string' ? { credentialID: row.credentialID } : {}),
		...(typeof row.deviceType === 'string' ? { deviceType: row.deviceType } : {}),
		...(typeof row.backedUp === 'boolean' ? { backedUp: row.backedUp } : {}),
		...(typeof row.transports === 'string' ? { transports: row.transports } : {}),
		...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
		...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {})
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
 * @param {number} status
 * @param {string} message
 * @returns {{ ok: false; status: number; message: string }}
 */
function createErrorResult(status, message) {
	return { ok: false, status, message };
}

/**
 * @param {unknown} body
 */
function readErrorMessage(body) {
	if (!body || typeof body !== 'object') {
		return null;
	}

	const error = /** @type {{ message?: unknown; error?: unknown; code?: unknown }} */ (body);
	if (typeof error.message === 'string') {
		return error.message;
	}
	if (typeof error.error === 'string') {
		return error.error;
	}
	if (typeof error.code === 'string') {
		return error.code;
	}

	return null;
}
