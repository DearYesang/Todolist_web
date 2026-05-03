import { normalizeDateRange } from '$lib/shared/task-domain.js';

const TASK_STATUSES = new Set(['todo', 'doing', 'done']);
const TASK_PRIORITIES = new Set(['high', 'medium', 'low']);
const TASK_URGENCIES = new Set(['urgent', 'normal']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 300;
const MAX_CATEGORY_LENGTH = 80;

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
 * @param {Set<string>} allowed
 * @param {string} label
 * @param {string} fallback
 */
function parseEnum(value, allowed, label, fallback) {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}

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

	const normalized = normalizeDateRange(startDate, endDate);
	if (normalized.startDate !== startDate || normalized.endDate !== endDate) {
		throw new TaskWriteError('Invalid task date range.');
	}

	return normalized;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseOptionalUuid(value, label) {
	if (value === undefined || value === null || value === '') {
		return null;
	}

	if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
		throw new TaskWriteError(`${label} must be a UUID.`);
	}

	return value;
}
