import { afterEach, describe, expect, it } from 'vitest';
import { formatLocalDate } from './local-date.js';

const originalTimeZone = process.env.TZ;

/**
 * Node re-reads TZ on assignment, so a test can pin a zone and restore it.
 * @param {string} timeZone
 */
function useTimeZone(timeZone) {
	process.env.TZ = timeZone;
}

afterEach(() => {
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
