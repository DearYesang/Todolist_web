const FALLBACK_STATUSES = new Set([401, 503]);

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   color: string | null;
 *   sortOrder: number;
 *   hiddenAt: string | null;
 *   archivedAt: string | null;
 * }} ClientCategory
 *
 * @typedef {{
 *   ok: true;
 *   categories: ClientCategory[];
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} ListCategoriesResult
 *
 * @typedef {{
 *   ok: true;
 *   category: ClientCategory;
 *   updatedTasks?: number;
 *   clearedTasks?: number;
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} CategoryWriteResult
 *
 * @typedef {{
 *   ok: true;
 *   source: ClientCategory;
 *   target: ClientCategory;
 *   updatedTasks: number;
 * } | {
 *   ok: false;
 *   fallback: boolean;
 *   status: number;
 *   message: string;
 * }} CategoryMergeResult
 */

/**
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ListCategoriesResult>}
 */
export async function listServerCategories(fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Category API is not available.');
	}

	try {
		const response = await fetcher('/api/categories', {
			headers: { accept: 'application/json' }
		});
		const body = await readJsonBody(response);

		if (response.ok && isCategoriesResponse(body)) {
			return {
				ok: true,
				categories: body.categories.map(normalizeCategory)
			};
		}

		return createErrorResult(response, body, 'Category API request failed');
	} catch {
		return createFallbackResult('Category API request could not be completed.');
	}
}

/**
 * @param {{ name: string; color?: string | null; hidden?: boolean }} payload
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CategoryWriteResult>}
 */
export async function createServerCategory(payload, fetcher = globalThis.fetch) {
	return writeCategory('/api/categories', 'POST', payload, fetcher);
}

/**
 * @param {string} categoryId
 * @param {{ name?: string; color?: string | null; hidden?: boolean; archived?: boolean }} patch
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CategoryWriteResult>}
 */
export async function updateServerCategory(categoryId, patch, fetcher = globalThis.fetch) {
	return writeCategory(`/api/categories/${encodeURIComponent(categoryId)}`, 'PATCH', patch, fetcher);
}

/**
 * @param {string} categoryId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CategoryWriteResult>}
 */
export async function deleteServerCategory(categoryId, fetcher = globalThis.fetch) {
	return writeCategory(`/api/categories/${encodeURIComponent(categoryId)}`, 'DELETE', undefined, fetcher);
}

/**
 * @param {string} sourceCategoryId
 * @param {string} targetCategoryId
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<CategoryMergeResult>}
 */
export async function mergeServerCategory(sourceCategoryId, targetCategoryId, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Category API is not available.');
	}

	try {
		const response = await fetcher(`/api/categories/${encodeURIComponent(sourceCategoryId)}/merge`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ targetCategoryId })
		});
		const body = await readJsonBody(response);

		if (response.ok && isCategoryMergeResponse(body)) {
			return {
				ok: true,
				source: normalizeCategory(body.source),
				target: normalizeCategory(body.target),
				updatedTasks: body.updatedTasks
			};
		}

		return createErrorResult(response, body, 'Category API request failed');
	} catch {
		return createFallbackResult('Category API request could not be completed.');
	}
}

/**
 * @param {string[]} categoryIds
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<ListCategoriesResult>}
 */
export async function reorderServerCategories(categoryIds, fetcher = globalThis.fetch) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Category API is not available.');
	}

	try {
		const response = await fetcher('/api/categories/reorder', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ categoryIds })
		});
		const body = await readJsonBody(response);

		if (response.ok && isCategoriesResponse(body)) {
			return {
				ok: true,
				categories: body.categories.map(normalizeCategory)
			};
		}

		return createErrorResult(response, body, 'Category API request failed');
	} catch {
		return createFallbackResult('Category API request could not be completed.');
	}
}

/**
 * @param {string} url
 * @param {'POST' | 'PATCH' | 'DELETE'} method
 * @param {unknown} payload
 * @param {typeof fetch} fetcher
 * @returns {Promise<CategoryWriteResult>}
 */
async function writeCategory(url, method, payload, fetcher) {
	if (typeof fetcher !== 'function') {
		return createFallbackResult('Category API is not available.');
	}

	try {
		const response = await fetcher(url, {
			method,
			headers: payload === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
			...(payload === undefined ? {} : { body: JSON.stringify(payload) })
		});
		const body = await readJsonBody(response);

		if (response.ok && isCategoryWriteResponse(body)) {
			return {
				ok: true,
				category: normalizeCategory(body.category),
				...(typeof body.updatedTasks === 'number' ? { updatedTasks: body.updatedTasks } : {}),
				...(typeof body.clearedTasks === 'number' ? { clearedTasks: body.clearedTasks } : {})
			};
		}

		return createErrorResult(response, body, 'Category API request failed');
	} catch {
		return createFallbackResult('Category API request could not be completed.');
	}
}

/**
 * @param {Response} response
 * @param {unknown} body
 * @param {string} fallbackMessage
 * @returns {{ ok: false; fallback: boolean; status: number; message: string }}
 */
function createErrorResult(response, body, fallbackMessage) {
	return {
		ok: false,
		fallback: FALLBACK_STATUSES.has(response.status),
		status: response.status,
		message: readErrorMessage(body) ?? `${fallbackMessage} with status ${response.status}.`
	};
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
 * @param {unknown} raw
 * @returns {ClientCategory}
 */
function normalizeCategory(raw) {
	const source = /** @type {Partial<ClientCategory> | null | undefined} */ (raw);
	return {
		id: typeof source?.id === 'string' ? source.id : '',
		name: typeof source?.name === 'string' ? source.name : '',
		color: typeof source?.color === 'string' && source.color ? source.color : null,
		sortOrder: typeof source?.sortOrder === 'number' ? source.sortOrder : 0,
		hiddenAt: typeof source?.hiddenAt === 'string' && source.hiddenAt ? source.hiddenAt : null,
		archivedAt: typeof source?.archivedAt === 'string' && source.archivedAt ? source.archivedAt : null
	};
}

/** @param {unknown} body */
function isCategoriesResponse(body) {
	return Boolean(body && typeof body === 'object' && 'categories' in body && Array.isArray(body.categories));
}

/** @param {unknown} body */
function isCategoryWriteResponse(body) {
	return Boolean(body && typeof body === 'object' && 'category' in body);
}

/** @param {unknown} body */
function isCategoryMergeResponse(body) {
	return Boolean(
		body
		&& typeof body === 'object'
		&& 'source' in body
		&& 'target' in body
		&& 'updatedTasks' in body
		&& typeof /** @type {{ updatedTasks?: unknown }} */ (body).updatedTasks === 'number'
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
