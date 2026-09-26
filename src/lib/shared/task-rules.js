/**
 * The task rules the browser, the API and the database share: which ids the
 * server issued, and the values a task's status, priority and urgency and a
 * board's view can take. The database CHECK constraints in
 * server/db/schema.js repeat the enums; task-rules.test.js holds them equal.
 */

/** A UUID, the shape of every id the server issues. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TASK_STATUSES = /** @type {const} */ (['todo', 'doing', 'done']);
export const TASK_PRIORITIES = /** @type {const} */ (['high', 'medium', 'low']);
export const TASK_URGENCIES = /** @type {const} */ (['urgent', 'normal']);
export const APP_VIEWS = /** @type {const} */ (['kanban', 'gantt', 'matrix']);

/**
 * @typedef {typeof TASK_STATUSES[number]} TaskStatus
 * @typedef {typeof TASK_PRIORITIES[number]} TaskPriority
 * @typedef {typeof TASK_URGENCIES[number]} TaskUrgency
 * @typedef {typeof APP_VIEWS[number]} AppView
 */

/**
 * Whether an id of a task, checklist item or category was issued by the
 * server. Ids made on this device while offline are not UUIDs.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isServerId(value) {
	return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is AppView}
 */
export function isAppView(value) {
	return isOneOf(APP_VIEWS, value);
}

/**
 * @template {string} T
 * @param {readonly T[]} values
 * @param {unknown} value
 * @returns {value is T}
 */
export function isOneOf(values, value) {
	return typeof value === 'string' && /** @type {readonly string[]} */ (values).includes(value);
}
