import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, formatLocalDate, parseLocalDateNoon, todayString } from './local-date.js';

const originalTimeZone = process.env.TZ;

/**
 * Node re-reads TZ on assignment, so a test can pin a zone and restore it.
 * @param {string} timeZone
 */
function useTimeZone(timeZone) {
	process.env.TZ = timeZone;
}

afterEach(() => {
	vi.useRealTimers();
	if (originalTimeZone === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTimeZone;
	}
});

describe('formatLocalDate', () => {
	it('formats the local calendar date with zero padding', () => {
		// Built from local components, so this holds in every time zone.
		expect(formatLocalDate(new Date(2026, 8, 4, 8, 30))).toBe('2026-09-04');
		expect(formatLocalDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
	});

	it('uses the Korean date before 09:00 KST, when UTC is still on the previous day', () => {
		useTimeZone('Asia/Seoul');
		const kstMorning = new Date('2026-09-23T23:30:00.000Z');

		expect(kstMorning.getHours()).toBe(8);
		expect(kstMorning.toISOString().slice(0, 10)).toBe('2026-09-23');
		expect(formatLocalDate(kstMorning)).toBe('2026-09-24');
	});
});

describe('todayString', () => {
	it('formats an injected moment as the local date', () => {
		useTimeZone('Asia/Seoul');

		expect(todayString(new Date('2026-09-23T23:30:00.000Z'))).toBe('2026-09-24');
		expect(todayString(new Date('2026-09-23T14:59:59.000Z'))).toBe('2026-09-23');
	});

	it('defaults to the current time', () => {
		useTimeZone('Asia/Seoul');
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-23T23:30:00.000Z'));

		expect(todayString()).toBe('2026-09-24');
	});
});

describe('parseLocalDateNoon', () => {
	it('returns local noon on that calendar date', () => {
		for (const timeZone of ['Asia/Seoul', 'America/Los_Angeles', 'UTC']) {
			useTimeZone(timeZone);
			const date = parseLocalDateNoon('2026-09-24');

			expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()])
				.toEqual([2026, 8, 24, 12, 0]);
		}
	});

	it('does not validate: malformed input gives an Invalid Date', () => {
		expect(Number.isNaN(parseLocalDateNoon('2026-9-24').getTime())).toBe(true);
		expect(Number.isNaN(parseLocalDateNoon('').getTime())).toBe(true);
	});
});

describe('addDays', () => {
	it('moves across month, year and leap-day boundaries', () => {
		expect(addDays('2026-09-24', 0)).toBe('2026-09-24');
		expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-01-01', 3650)).toBe('2035-12-30');
	});

	it('counts calendar days across DST changes', () => {
		// New York springs forward on 2026-03-08 and falls back on 2026-11-01.
		useTimeZone('America/New_York');
		expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
		expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
		expect(addDays('2026-03-09', -2)).toBe('2026-03-07');
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-11-01', 1)).toBe('2026-11-02');

		// Santiago's clocks jump at midnight, where a midnight anchor would
		// not exist; noon always does.
		useTimeZone('America/Santiago');
		expect(addDays('2026-09-05', 1)).toBe('2026-09-06');
		expect(addDays('2026-09-06', 1)).toBe('2026-09-07');
	});
});
