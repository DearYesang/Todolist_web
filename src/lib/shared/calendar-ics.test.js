import { describe, expect, it } from 'vitest';
import { createTaskCalendar as createIcsCalendar } from './calendar-ics.js';

describe('calendar export', () => {
	it('creates all-day iCalendar events from normalized tasks', () => {
		const calendar = createIcsCalendar(
			[
				{
					id: 'task-1',
					text: 'Review, ship; celebrate',
					status: 'doing',
					startDate: '2026-05-03',
					endDate: '2026-05-04',
					priority: 'high',
					urgency: 'urgent',
					category: 'Release',
					subtasks: [{ id: 'sub-1', text: 'QA pass', done: true }]
				}
			],
			{
				now: new Date('2026-05-03T00:00:00.000Z'),
				calendarName: 'Project Calendar'
			}
		);

		expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
		expect(calendar).toContain('X-WR-CALNAME:Project Calendar');
		expect(calendar).toContain('UID:task-1@todolist.local');
		expect(calendar).toContain('DTSTAMP:20260503T000000Z');
		expect(calendar).toContain('DTSTART;VALUE=DATE:20260503');
		expect(calendar).toContain('DTEND;VALUE=DATE:20260505');
		expect(calendar).toContain('SUMMARY:Review\\, ship\\; celebrate');
		expect(calendar).toContain('CATEGORIES:Release');
		expect(calendar).toContain('Checklist:\\n- [x] QA pass');
	});

	it('folds long Korean iCalendar lines by UTF-8 bytes without corrupting text', () => {
		const title = '한글 일정 '.repeat(18).trim();
		const checklistText = '체크리스트 내용 '.repeat(12).trim();
		const calendar = createIcsCalendar(
			[
				{
					id: 'task-korean',
					text: title,
					status: 'todo',
					startDate: '2026-05-03',
					endDate: '2026-05-03',
					priority: 'medium',
					urgency: 'normal',
					category: '공부',
					subtasks: [{ id: 'sub-korean', text: checklistText, done: false }]
				}
			],
			{
				now: new Date('2026-05-03T00:00:00.000Z')
			}
		);
		const encoder = new TextEncoder();
		const physicalLines = calendar.trimEnd().split('\r\n');
		const unfolded = unfoldIcsLines(calendar);

		expect(physicalLines.every((line) => encoder.encode(line).length <= 75)).toBe(true);
		expect(unfolded).toContain(`SUMMARY:${title}`);
		expect(unfolded).toContain(`CATEGORIES:공부`);
		expect(unfolded).toContain(`- [ ] ${checklistText}`);
	});

	/**
	 * @param {string} calendar
	 */
	function unfoldIcsLines(calendar) {
		return calendar
			.split('\r\n')
			.reduce((lines, line) => {
				if (line.startsWith(' ') && lines.length > 0) {
					lines[lines.length - 1] += line.slice(1);
				} else if (line) {
					lines.push(line);
				}

				return lines;
			}, /** @type {string[]} */ ([]))
			.join('\n');
	}
});
