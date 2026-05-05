import { normalizeDateRange } from '$lib/shared/task-domain.js';

const TASK_STATUSES = new Set(['todo', 'doing', 'done']);
const TASK_PRIORITIES = new Set(['high', 'medium', 'low']);
const TASK_URGENCIES = new Set(['urgent', 'normal']);
const APP_VIEWS = new Set(['kanban', 'gantt', 'matrix']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 300;
const MAX_CATEGORY_LENGTH = 80;
const MAX_CHECKLIST_TEXT_LENGTH = 500;

export class TaskWriteError extends Error {
	/**
	 * @param {string} message
	 * @param {number} [status]
	 */
	constructor(message, status = 400) {
		super(message);
		this.name = 'TaskWriteError';
		this.status = status;
	}
}

/**
 * @param {unknown} payload
 */
export function parseCreateTaskInput(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Task payload must be an object.');
	}

	const title = parseRequiredString(source.text ?? source.title, 'Task title', MAX_TITLE_LENGTH);
	const status = parseEnum(source.status, TASK_STATUSES, 'status', 'todo');
	const priority = parseEnum(source.priority, TASK_PRIORITIES, 'priority', 'medium');
	const urgency = parseEnum(source.urgency, TASK_URGENCIES, 'urgency', 'normal');
	const category = parseOptionalString(source.category, MAX_CATEGORY_LENGTH);
	const { startDate, endDate } = parseDateRange(source.startDate, source.endDate);
	const parentId = parseOptionalUuid(source.parentId, 'parentId');

	return {
		title,
		status,
		priority,
		urgency,
		category,
		startDate,
		endDate,
		parentId
	};
}

/**
 * @param {unknown} taskId
 */
export function parseTaskIdParam(taskId) {
	return parseRequiredUuid(taskId, 'taskId');
}

/**
 * @param {unknown} itemId
 */
export function parseChecklistItemIdParam(itemId) {
	return parseRequiredUuid(itemId, 'itemId');
}

/**
 * @param {unknown} payload
 */
export function parseUpdateTaskInput(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Task payload must be an object.');
	}

	/** @type {Record<string, string | null | number>} */
	const patch = {};
	let hasTaskField = false;

	if (hasField(source, 'text') || hasField(source, 'title')) {
		patch.title = parseRequiredString(source.text ?? source.title, 'Task title', MAX_TITLE_LENGTH);
		hasTaskField = true;
	}

	if (hasField(source, 'status')) {
		patch.status = parseRequiredEnum(source.status, TASK_STATUSES, 'status');
		hasTaskField = true;
	}

	if (hasField(source, 'priority')) {
		patch.priority = parseRequiredEnum(source.priority, TASK_PRIORITIES, 'priority');
		hasTaskField = true;
	}

	if (hasField(source, 'urgency')) {
		patch.urgency = parseRequiredEnum(source.urgency, TASK_URGENCIES, 'urgency');
		hasTaskField = true;
	}

	if (hasField(source, 'category')) {
		patch.category = parseOptionalString(source.category, MAX_CATEGORY_LENGTH);
		hasTaskField = true;
	}

	if (hasField(source, 'startDate')) {
		patch.startDate = parseDateValue(source.startDate, 'startDate');
		hasTaskField = true;
	}

	if (hasField(source, 'endDate')) {
		patch.endDate = parseDateValue(source.endDate, 'endDate');
		hasTaskField = true;
	}

	if (hasField(source, 'parentId')) {
		patch.parentId = parseOptionalUuid(source.parentId, 'parentId');
		hasTaskField = true;
	}

	if (hasField(source, 'expectedVersion') || hasField(source, 'version')) {
		patch.expectedVersion = parseExpectedVersion(source.expectedVersion ?? source.version);
	}

	if (!hasTaskField) {
		throw new TaskWriteError('At least one task field is required.');
	}

	return patch;
}

/**
 * @param {unknown} payload
 */
export function parseDeleteTaskInput(payload) {
	if (payload === undefined || payload === null || payload === '') {
		return { expectedVersion: null };
	}

	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Task delete payload must be an object.');
	}

	return {
		expectedVersion: hasField(source, 'expectedVersion') || hasField(source, 'version')
			? parseExpectedVersion(source.expectedVersion ?? source.version)
			: null
	};
}

/**
 * @param {unknown} payload
 */
export function parseBoardPreferencesInput(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Board preferences payload must be an object.');
	}

	return {
		defaultView: parseRequiredEnum(source.defaultView, APP_VIEWS, 'defaultView')
	};
}

/**
 * @param {string} startDate
 * @param {string} endDate
 */
export function assertValidTaskDateRange(startDate, endDate) {
	const normalized = normalizeDateRange(startDate, endDate);
	if (normalized.startDate !== startDate || normalized.endDate !== endDate) {
		throw new TaskWriteError('Invalid task date range.');
	}
}

/**
 * @param {unknown} payload
 */
export function parseCreateChecklistItemInput(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Checklist payload must be an object.');
	}

	return {
		text: parseRequiredString(source.text, 'Checklist text', MAX_CHECKLIST_TEXT_LENGTH)
	};
}

/**
 * @param {unknown} payload
 */
export function parseUpdateChecklistItemInput(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TaskWriteError('Checklist payload must be an object.');
	}

	/** @type {{ text?: string; done?: boolean }} */
	const patch = {};

	if (hasField(source, 'text')) {
		patch.text = parseRequiredString(source.text, 'Checklist text', MAX_CHECKLIST_TEXT_LENGTH);
	}

	if (hasField(source, 'done')) {
		if (typeof source.done !== 'boolean') {
			throw new TaskWriteError('done must be a boolean.');
		}
		patch.done = source.done;
	}

	if (Object.keys(patch).length === 0) {
		throw new TaskWriteError('At least one checklist field is required.');
	}

	return patch;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} field
 */
function hasField(source, field) {
	return Object.prototype.hasOwnProperty.call(source, field);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} maxLength
 */
function parseRequiredString(value, label, maxLength) {
	if (typeof value !== 'string') {
		throw new TaskWriteError(`${label} is required.`);
	}

	const trimmed = value.trim();
	if (!trimmed) {
		throw new TaskWriteError(`${label} is required.`);
	}

	if (trimmed.length > maxLength) {
		throw new TaskWriteError(`${label} must be ${maxLength} characters or less.`);
	}

	return trimmed;
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 */
function parseOptionalString(value, maxLength) {
	if (value === undefined || value === null) {
		return '';
	}

	if (typeof value !== 'string') {
		throw new TaskWriteError('category must be a string.');
	}

	const trimmed = value.trim();
	if (trimmed.length > maxLength) {
		throw new TaskWriteError(`category must be ${maxLength} characters or less.`);
	}

	return trimmed;
}

/**
 * @param {unknown} value
 */
function parseExpectedVersion(value) {
	if (value === undefined || value === null || value === '') {
		return null;
	}

	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new TaskWriteError('expectedVersion must be a positive integer.');
	}

	return value;
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} label
 * @param {string} fallback
 */
function parseEnum(value, allowed, label, fallback) {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}

	return parseRequiredEnum(value, allowed, label);
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} label
 */
function parseRequiredEnum(value, allowed, label) {
	if (typeof value !== 'string' || !allowed.has(value)) {
		throw new TaskWriteError(`Invalid ${label}.`);
	}

	return value;
}

/**
 * @param {unknown} startDate
 * @param {unknown} endDate
 */
function parseDateRange(startDate, endDate) {
	if (typeof startDate !== 'string' || typeof endDate !== 'string') {
		throw new TaskWriteError('startDate and endDate are required.');
	}

	assertValidTaskDateRange(startDate, endDate);

	return { startDate, endDate };
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseDateValue(value, label) {
	if (typeof value !== 'string') {
		throw new TaskWriteError(`${label} must be a date string.`);
	}

	assertValidTaskDateRange(value, value);
	return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseOptionalUuid(value, label) {
	if (value === undefined || value === null || value === '') {
		return null;
	}

	return parseRequiredUuid(value, label);
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseRequiredUuid(value, label) {
	if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
		throw new TaskWriteError(`${label} must be a UUID.`);
	}

	return value;
}
