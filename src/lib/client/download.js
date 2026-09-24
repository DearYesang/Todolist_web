import { formatLocalDate } from '../shared/local-date.js';

/**
 * @typedef {{
 *   document?: Pick<Document, 'createElement'>;
 *   url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
 * }} DownloadEnvironment
 */

/**
 * Saves a blob as a file through a temporary `<a download>` click.
 * @param {Blob} blob
 * @param {string} filename
 * @param {DownloadEnvironment} [environment] injectable for tests
 */
export function downloadBlob(blob, filename, environment = {}) {
	const doc = environment.document ?? document;
	const urlApi = environment.url ?? URL;
	const url = urlApi.createObjectURL(blob);
	const anchor = doc.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	urlApi.revokeObjectURL(url);
}

/**
 * Saves `value` as pretty-printed JSON (2-space indent).
 * @param {unknown} value
 * @param {string} filename
 * @param {DownloadEnvironment} [environment]
 */
export function downloadJson(value, filename, environment) {
	const data = JSON.stringify(value, null, 2);
	downloadBlob(new Blob([data], { type: 'application/json' }), filename, environment);
}

/**
 * `${prefix}_YYYY-MM-DD.${extension}`, stamped with the LOCAL calendar date
 * so a backup saved at 08:30 in Korea carries today's date, not yesterday's
 * UTC one.
 * @param {string} prefix
 * @param {string} extension without the leading dot
 * @param {Date} [now]
 */
export function createDatedFilename(prefix, extension, now = new Date()) {
	return `${prefix}_${formatLocalDate(now)}.${extension}`;
}
