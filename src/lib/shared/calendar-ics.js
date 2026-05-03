import { normalizeTaskList } from './task-domain.js';

const PRODUCT_ID = '-//Todolist//Kanban Calendar//KO';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

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
	if (line.length <= 75) {
		return line;
	}

	const chunks = [line.slice(0, 75)];
	let rest = line.slice(75);

	while (rest.length > 74) {
		chunks.push(` ${rest.slice(0, 74)}`);
		rest = rest.slice(74);
	}

	if (rest) {
		chunks.push(` ${rest}`);
	}

	return chunks.join('\r\n');
}
