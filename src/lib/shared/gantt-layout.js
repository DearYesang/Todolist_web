import { addDays, formatLocalDate, parseLocalDateNoon, todayString } from './local-date.js';
import { buildHierarchy } from './task-domain.js';

/**
 * Pure Gantt geometry: which days the timeline shows, where each bar sits,
 * and how far a bar edge moves while it is dragged. Dates are parsed at
 * local noon (parseLocalDateNoon) so DST never shifts a day.
 *
 * @typedef {import('./task-domain.js').Task} Task
 * @typedef {{ task: Task; depth: number }} GanttRow
 * @typedef {{ key: string; label: string; isToday: boolean }} GanttHeaderDay
 * @typedef {{
 *   displayList: GanttRow[];
 *   gridWidth: number;
 *   headerDays: GanttHeaderDay[];
 *   minDate: Date;
 *   totalDays: number;
 * }} GanttLayout
 * @typedef {'start' | 'end'} GanttResizeEdge
 */

export const GANTT_DAY_WIDTH = 48;
/** Days kept on each side of today, so the timeline can center on it. */
export const GANTT_TODAY_PADDING_DAYS = 18;
const DAY_MS = 86400000;
const MIN_BAR_WIDTH = 24;
const LEADING_DAYS = 3;
const TRAILING_DAYS = 5;

/**
 * The timeline for already-filtered tasks: rows in hierarchy order (the
 * children of a collapsed task are left out), one header cell per day from
 * 3 days before the earliest start to 5 days after the latest end, widened
 * to at least GANTT_TODAY_PADDING_DAYS on each side of today.
 * @param {Task[]} visibleTasks
 * @param {{ now?: Date; dayWidth?: number; todayPaddingDays?: number }} [options]
 * @returns {GanttLayout}
 */
export function buildGanttLayout(visibleTasks, {
	now = new Date(),
	dayWidth = GANTT_DAY_WIDTH,
	todayPaddingDays = GANTT_TODAY_PADDING_DAYS
} = {}) {
	if (visibleTasks.length === 0) {
		return {
			displayList: [],
			gridWidth: dayWidth,
			headerDays: [],
			minDate: new Date(now),
			totalDays: 0
		};
	}

	const today = parseLocalDateNoon(todayString(now));
	let minDate = new Date(today);
	let maxDate = new Date(today);

	visibleTasks.forEach((task) => {
		const start = parseLocalDateNoon(task.startDate);
		const end = parseLocalDateNoon(task.endDate);
		if (start < minDate) minDate = new Date(start);
		if (end > maxDate) maxDate = new Date(end);
	});

	minDate.setDate(minDate.getDate() - LEADING_DAYS);
	maxDate.setDate(maxDate.getDate() + TRAILING_DAYS);

	const todayWindowStart = new Date(today);
	todayWindowStart.setDate(todayWindowStart.getDate() - todayPaddingDays);
	const todayWindowEnd = new Date(today);
	todayWindowEnd.setDate(todayWindowEnd.getDate() + todayPaddingDays);
	if (todayWindowStart < minDate) minDate = todayWindowStart;
	if (todayWindowEnd > maxDate) maxDate = todayWindowEnd;

	const totalDays = Math.round((maxDate.getTime() - minDate.getTime()) / DAY_MS);
	/** @type {GanttHeaderDay[]} */
	const headerDays = [];

	for (let index = 0; index <= totalDays; index += 1) {
		const date = new Date(minDate);
		date.setDate(date.getDate() + index);
		headerDays.push({
			key: date.toISOString(),
			label: `${date.getMonth() + 1}/${date.getDate()}`,
			isToday: formatLocalDate(date) === formatLocalDate(today)
		});
	}

	const { roots, childrenByParent } = buildHierarchy(visibleTasks);
	/** @type {GanttRow[]} */
	const displayList = [];

	/**
	 * @param {Task[]} list
	 * @param {number} depth
	 */
	function addToDisplay(list, depth) {
		list.forEach((task) => {
			displayList.push({ task, depth });
			const children = childrenByParent[task.id] || [];
			if (children.length > 0 && !task.collapsed) {
				addToDisplay(children, depth + 1);
			}
		});
	}

	addToDisplay(roots, 0);

	return {
		displayList,
		gridWidth: Math.max((totalDays + 1) * dayWidth, dayWidth),
		headerDays,
		minDate,
		totalDays
	};
}

/**
 * Horizontal position of a bar; both dates are inclusive, and a bar is
 * never narrower than MIN_BAR_WIDTH.
 * @param {{ startDate: string; endDate: string }} range
 * @param {Date} minDate the layout's first day
 * @param {number} [dayWidth]
 */
export function getBarCoords({ startDate, endDate }, minDate, dayWidth = GANTT_DAY_WIDTH) {
	const start = parseLocalDateNoon(startDate);
	const end = parseLocalDateNoon(endDate);
	const offsetDays = (start.getTime() - minDate.getTime()) / DAY_MS;
	const durationDays = (end.getTime() - start.getTime()) / DAY_MS + 1;

	return {
		left: offsetDays * dayWidth,
		width: Math.max(durationDays * dayWidth, MIN_BAR_WIDTH)
	};
}

/**
 * Whole days a resize handle has moved since the press.
 * @param {number} originX clientX at pointerdown
 * @param {number} clientX current clientX
 * @param {number} [dayWidth]
 */
export function getResizeDayOffset(originX, clientX, dayWidth = GANTT_DAY_WIDTH) {
	return Math.round((clientX - originX) / dayWidth);
}

/**
 * The preview for dragging one edge of a bar by `dayOffset` days. The
 * dragged edge stops at the other one, so a bar keeps at least one day;
 * only the dragged edge's preview date is returned.
 * @param {{ edge: GanttResizeEdge; originStartDate: string; originEndDate: string }} resize
 * @param {number} dayOffset
 * @returns {{ previewStartDate: string } | { previewEndDate: string }}
 */
export function getResizePreview(resize, dayOffset) {
	if (resize.edge === 'start') {
		let nextStartDate = addDays(resize.originStartDate, dayOffset);
		if (parseLocalDateNoon(nextStartDate).getTime() > parseLocalDateNoon(resize.originEndDate).getTime()) {
			nextStartDate = resize.originEndDate;
		}

		return { previewStartDate: nextStartDate };
	}

	let nextEndDate = addDays(resize.originEndDate, dayOffset);
	if (parseLocalDateNoon(nextEndDate).getTime() < parseLocalDateNoon(resize.originStartDate).getTime()) {
		nextEndDate = resize.originStartDate;
	}

	return { previewEndDate: nextEndDate };
}
