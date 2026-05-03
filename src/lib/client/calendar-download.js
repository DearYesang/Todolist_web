import { createTaskCalendar } from '$lib/shared/calendar-ics.js';

/**
 * @param {import('$lib/shared/task-domain.js').Task} task
 * @param {{ now?: Date }} [options]
 */
export function downloadTaskCalendar(task, options = {}) {
	const now = options.now ?? new Date();
	const calendar = createTaskCalendar([task], {
		calendarName: task.text?.trim() || 'Todolist task',
		now
	});
	const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = createTaskCalendarFilename(task, now);
	anchor.click();
	URL.revokeObjectURL(url);
}

/**
 * @param {Pick<import('$lib/shared/task-domain.js').Task, 'text'>} task
 * @param {Date} [now]
 */
export function createTaskCalendarFilename(task, now = new Date()) {
	const date = now.toISOString().slice(0, 10);
	return `todolist_${sanitizeFilenamePart(task.text || 'task')}_${date}.ics`;
}

/**
 * @param {string} value
 */
function sanitizeFilenamePart(value) {
	const cleaned = value
		.normalize('NFKC')
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/-+/g, '-')
		.replace(/^[._-]+|[._-]+$/g, '')
		.slice(0, 60)
		.replace(/[._-]+$/g, '');

	return cleaned || 'task';
}
