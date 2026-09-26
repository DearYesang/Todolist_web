import { afterEach, describe, expect, it } from 'vitest';
import { decryptCalendarToken, encryptCalendarToken, CalendarTokenEncryptionError } from './oauth-encryption.js';

describe('calendar provider sync helpers', () => {
	const originalKey = process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;
		} else {
			process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = originalKey;
		}
	});

	it('encrypts OAuth tokens with associated data', () => {
		process.env.CALENDAR_OAUTH_ENCRYPTION_KEY = 'calendar-oauth-encryption-key-for-tests';
		const encrypted = encryptCalendarToken('access-token', 'connection:user:google');
		expect(encrypted).toMatch(/^v1:/);
		expect(encrypted).not.toContain('access-token');
		expect(decryptCalendarToken(encrypted, 'connection:user:google')).toBe('access-token');
		expect(() => decryptCalendarToken(encrypted, 'connection:user:microsoft')).toThrow();

		delete process.env.CALENDAR_OAUTH_ENCRYPTION_KEY;
		expect(() => encryptCalendarToken('token', 'aad')).toThrow(CalendarTokenEncryptionError);
	});
});
