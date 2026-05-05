import { normalizeTaskList } from './task-domain.js';

const PRODUCT_ID = '-//Todolist//Kanban Calendar//KO';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const ICS_LINE_BYTE_LIMIT = 75;
const ICS_CONTINUATION_PREFIX = ' ';
const textEncoder = new TextEncoder();

/**
 * @param {unknown[]} rawTasks
 * @param {{ calendarName?: string; now?: Date }} [options]
 */
export function createTaskCalendar(rawTasks, options = {}) {
	const tasks = normalizeTaskList(rawTasks);
	const calendarName = options.calendarName ?? 'Todolist';
	const timestamp = formatIcsTimestamp(options.now ?? new Date());
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${PRODUCT_ID}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeIcsText(calendarName)}`
	];

	for (const task of tasks) {
		lines.push(...createTaskEventLines(task, timestamp));
	}

	lines.push('END:VCALENDAR');
	return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * @param {import('./task-domain.js').Task} task
 * @param {string} timestamp
 */
function createTaskEventLines(task, timestamp) {
	const lines = [
		'BEGIN:VEVENT',
		`UID:${escapeIcsText(`${task.id}@todolist.local`)}`,
		`DTSTAMP:${timestamp}`,
		`DTSTART;VALUE=DATE:${formatIcsDate(task.startDate)}`,
		`DTEND;VALUE=DATE:${formatIcsDate(addDays(task.endDate, 1))}`,
		`SUMMARY:${escapeIcsText(task.text || 'Untitled task')}`,
		`DESCRIPTION:${escapeIcsText(createDescription(task))}`,
		`X-TODOLIST-STATUS:${task.status}`,
		`X-TODOLIST-PRIORITY:${task.priority}`,
		`X-TODOLIST-URGENCY:${task.urgency}`
	];

	if (task.category) {
		lines.push(`CATEGORIES:${escapeIcsText(task.category)}`);
	}

	lines.push('END:VEVENT');
	return lines;
}

/**
 * @param {import('./task-domain.js').Task} task
 */
function createDescription(task) {
	const checklist = task.subtasks.length
		? `\nChecklist:\n${task.subtasks.map((subtask) => `- ${subtask.done ? '[x]' : '[ ]'} ${subtask.text}`).join('\n')}`
		: '';

	return [
		`Status: ${task.status}`,
		`Priority: ${task.priority}`,
		`Urgency: ${task.urgency}`,
		task.category ? `Category: ${task.category}` : '',
		checklist
	].filter(Boolean).join('\n');
}

/**
 * @param {string} value
 */
function formatIcsDate(value) {
	return value.replaceAll('-', '');
}

/**
 * @param {Date} value
 */
function formatIcsTimestamp(value) {
	return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {string} value
 * @param {number} days
 */
function addDays(value, days) {
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day) + days * DAY_IN_MS);
	const nextYear = date.getUTCFullYear();
	const nextMonth = `${date.getUTCMonth() + 1}`.padStart(2, '0');
	const nextDay = `${date.getUTCDate()}`.padStart(2, '0');
	return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * @param {string} value
 */
function escapeIcsText(value) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,');
}

/**
 * @param {string} line
 */
function foldIcsLine(line) {
	if (getUtf8ByteLength(line) <= ICS_LINE_BYTE_LIMIT) {
		return line;
	}

	const chunks = [];
	let chunk = '';
	let chunkBytes = 0;
	let prefix = '';
	let limit = ICS_LINE_BYTE_LIMIT;

	for (const char of line) {
		const charBytes = getUtf8ByteLength(char);
		if (chunk && chunkBytes + charBytes > limit) {
			chunks.push(`${prefix}${chunk}`);
			prefix = ICS_CONTINUATION_PREFIX;
			limit = ICS_LINE_BYTE_LIMIT - getUtf8ByteLength(ICS_CONTINUATION_PREFIX);
			chunk = char;
			chunkBytes = charBytes;
			continue;
		}

		chunk += char;
		chunkBytes += charBytes;
	}

	if (chunk) {
		chunks.push(`${prefix}${chunk}`);
	}

	return chunks.join('\r\n');
}

/**
 * @param {string} value
 */
function getUtf8ByteLength(value) {
	return textEncoder.encode(value).length;
}
