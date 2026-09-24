import { afterEach, describe, expect, it } from 'vitest';
import {
	buildGanttLayout,
	GANTT_DAY_WIDTH,
	getBarCoords,
	getResizeDayOffset,
	getResizePreview
} from './gantt-layout.js';
import { normalizeTask } from './task-domain.js';

const originalTimeZone = process.env.TZ;

afterEach(() => {
	if (originalTimeZone === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTimeZone;
	}
});

// Local components, so "today" is 2026-09-24 in every time zone.
const NOW = new Date(2026, 8, 24, 10, 0);

/**
 * @param {string} id
 * @param {string} startDate
 * @param {string} endDate
 * @param {Record<string, unknown>} [overrides]
 */
function createTask(id, startDate, endDate, overrides = {}) {
	return normalizeTask({ id, text: id, startDate, endDate, ...overrides });
}

/**
 * @param {import('./gantt-layout.js').GanttLayout} layout
 */
function headerLabels(layout) {
	return layout.headerDays.map((day) => day.label);
}

describe('buildGanttLayout', () => {
	it('returns an empty one-day grid when no task is visible', () => {
		const layout = buildGanttLayout([], { now: NOW });

		expect(layout.displayList).toEqual([]);
		expect(layout.headerDays).toEqual([]);
		expect(layout.totalDays).toBe(0);
		expect(layout.gridWidth).toBe(GANTT_DAY_WIDTH);
		expect(layout.minDate.getTime()).toBe(NOW.getTime());
	});

	it('keeps 18 days on each side of today when the tasks are close to it', () => {
		const layout = buildGanttLayout([createTask('a', '2026-09-20', '2026-09-22')], { now: NOW });

		// 2026-09-06 .. 2026-10-12: today +- 18 days wins over the task +3/-5 margin.
		expect(layout.totalDays).toBe(36);
		expect(layout.headerDays).toHaveLength(37);
		expect(headerLabels(layout)[0]).toBe('9/6');
		expect(headerLabels(layout).at(-1)).toBe('10/12');
		expect(layout.headerDays.filter((day) => day.isToday).map((day) => day.label)).toEqual(['9/24']);
		expect(layout.headerDays.findIndex((day) => day.isToday)).toBe(18);
		expect(layout.gridWidth).toBe(37 * GANTT_DAY_WIDTH);
		expect([layout.minDate.getMonth(), layout.minDate.getDate(), layout.minDate.getHours()]).toEqual([8, 6, 12]);
		expect(new Set(layout.headerDays.map((day) => day.key)).size).toBe(37);
	});

	it('pads long tasks 3 days before the start and 5 days after the end', () => {
		const layout = buildGanttLayout([
			createTask('long', '2026-08-01', '2026-11-30'),
			createTask('short', '2026-09-24', '2026-09-24')
		], { now: NOW });

		expect(headerLabels(layout)[0]).toBe('7/29');
		expect(headerLabels(layout).at(-1)).toBe('12/5');
		expect(layout.totalDays).toBe(129);
	});

	it('lists rows in hierarchy order and hides the children of collapsed tasks', () => {
		const layout = buildGanttLayout([
			createTask('parent', '2026-09-20', '2026-09-25'),
			createTask('collapsed', '2026-09-21', '2026-09-22', { collapsed: true }),
			createTask('child', '2026-09-21', '2026-09-22', { parentId: 'parent' }),
			createTask('hidden-child', '2026-09-21', '2026-09-22', { parentId: 'collapsed' }),
			createTask('grandchild', '2026-09-21', '2026-09-22', { parentId: 'child' }),
			createTask('orphan', '2026-09-21', '2026-09-22', { parentId: 'filtered-out' })
		], { now: NOW });

		expect(layout.displayList.map((row) => [row.task.id, row.depth])).toEqual([
			['parent', 0],
			['child', 1],
			['grandchild', 2],
			['collapsed', 0],
			['orphan', 0]
		]);
	});

	it('uses the local date for today at 08:30 KST', () => {
		process.env.TZ = 'Asia/Seoul';
		const layout = buildGanttLayout([createTask('a', '2026-09-24', '2026-09-24')], {
			now: new Date('2026-09-23T23:30:00.000Z')
		});

		expect(layout.headerDays.find((day) => day.isToday)?.label).toBe('9/24');
	});

	it('honours a custom day width and padding', () => {
		const layout = buildGanttLayout([createTask('a', '2026-09-24', '2026-09-24')], {
			now: NOW,
			dayWidth: 10,
			todayPaddingDays: 2
		});

		// 3 days before and 5 after the task now exceed the 2-day padding.
		expect(headerLabels(layout)).toEqual(['9/21', '9/22', '9/23', '9/24', '9/25', '9/26', '9/27', '9/28', '9/29']);
		expect(layout.gridWidth).toBe(90);
	});
});

describe('getBarCoords', () => {
	const minDate = buildGanttLayout([createTask('a', '2026-09-20', '2026-09-22')], { now: NOW }).minDate;

	it('offsets a bar from the first day and spans every inclusive day', () => {
		expect(getBarCoords({ startDate: '2026-09-20', endDate: '2026-09-22' }, minDate)).toEqual({
			left: 14 * GANTT_DAY_WIDTH,
			width: 3 * GANTT_DAY_WIDTH
		});
		expect(getBarCoords({ startDate: '2026-09-06', endDate: '2026-09-06' }, minDate)).toEqual({
			left: 0,
			width: GANTT_DAY_WIDTH
		});
	});

	it('never draws a bar narrower than 24px', () => {
		expect(getBarCoords({ startDate: '2026-09-06', endDate: '2026-09-06' }, minDate, 10).width).toBe(24);
		expect(getBarCoords({ startDate: '2026-09-06', endDate: '2026-09-08' }, minDate, 10).width).toBe(30);
	});
});

describe('getResizeDayOffset', () => {
	it('rounds the pointer travel to whole days', () => {
		expect(getResizeDayOffset(100, 100)).toBe(0);
		expect(getResizeDayOffset(100, 123)).toBe(0);
		expect(getResizeDayOffset(100, 124)).toBe(1);
		expect(getResizeDayOffset(100, 172)).toBe(2);
		expect(getResizeDayOffset(100, 70)).toBe(-1);
		expect(getResizeDayOffset(0, 25, 10)).toBe(3);
	});
});

describe('getResizePreview', () => {
	const bar = { originStartDate: '2026-09-20', originEndDate: '2026-09-22' };

	it('moves the start edge, stopping at the end date', () => {
		expect(getResizePreview({ ...bar, edge: 'start' }, -3)).toEqual({ previewStartDate: '2026-09-17' });
		expect(getResizePreview({ ...bar, edge: 'start' }, 2)).toEqual({ previewStartDate: '2026-09-22' });
		expect(getResizePreview({ ...bar, edge: 'start' }, 9)).toEqual({ previewStartDate: '2026-09-22' });
	});

	it('moves the end edge, stopping at the start date', () => {
		expect(getResizePreview({ ...bar, edge: 'end' }, 10)).toEqual({ previewEndDate: '2026-10-02' });
		expect(getResizePreview({ ...bar, edge: 'end' }, -2)).toEqual({ previewEndDate: '2026-09-20' });
		expect(getResizePreview({ ...bar, edge: 'end' }, -9)).toEqual({ previewEndDate: '2026-09-20' });
	});

	it('returns the origin date when the pointer has not moved a full day', () => {
		expect(getResizePreview({ ...bar, edge: 'start' }, 0)).toEqual({ previewStartDate: '2026-09-20' });
		expect(getResizePreview({ ...bar, edge: 'end' }, 0)).toEqual({ previewEndDate: '2026-09-22' });
	});
});
