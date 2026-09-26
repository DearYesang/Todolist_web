import { afterEach, describe, expect, it } from 'vitest';
import { CalendarTokenConfigurationError, createCalendarToken, hashCalendarToken } from './tokens.js';

describe('calendar subscription tokens', () => {
	const originalSecret = process.env.CALENDAR_TOKEN_SECRET;

	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.CALENDAR_TOKEN_SECRET;
		} else {
			process.env.CALENDAR_TOKEN_SECRET = originalSecret;
		}
	});

	it('generates url-safe high entropy tokens without exposing the hash input', () => {
		const token = createCalendarToken();
		expect(token).toMatch(/^cal_[A-Za-z0-9_-]{40,}$/);
		expect(token).not.toContain('=');
	});

	it('hashes tokens with a required keyed secret', () => {
		process.env.CALENDAR_TOKEN_SECRET = 'calendar-secret-one-with-32-bytes';
		const hash = hashCalendarToken('cal_test-token');
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		expect(hashCalendarToken('cal_test-token')).toBe(hash);

		process.env.CALENDAR_TOKEN_SECRET = 'calendar-secret-two-with-32-bytes';
		expect(hashCalendarToken('cal_test-token')).not.toBe(hash);

		delete process.env.CALENDAR_TOKEN_SECRET;
		expect(() => hashCalendarToken('cal_test-token')).toThrow(CalendarTokenConfigurationError);
	});
});
