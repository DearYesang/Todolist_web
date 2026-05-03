/**
 * @param {unknown} payload
 * @returns {unknown[] | null}
 */
export function extractBackupTasks(payload) {
	if (Array.isArray(payload)) {
		return payload;
	}

	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const source = /** @type {Record<string, unknown>} */ (payload);
	for (const key of ['tasks', 'kanbanTasks']) {
		if (Array.isArray(source[key])) {
			return source[key];
		}
	}

	if (source.data && typeof source.data === 'object') {
		const data = /** @type {Record<string, unknown>} */ (source.data);
		if (Array.isArray(data.tasks)) {
			return data.tasks;
		}
	}

	return null;
}
