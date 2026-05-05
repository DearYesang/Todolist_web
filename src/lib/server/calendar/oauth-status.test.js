import { describe, expect, it } from 'vitest';
import {
	createCalendarOAuthErrorMessage,
	createCalendarSyncRedirect
} from './oauth-status.js';

describe('calendar oauth status helpers', () => {
	it('creates compact redirect query strings for calendar oauth status', () => {
		expect(createCalendarSyncRedirect({
			status: 'connected',
			provider: 'google'
		})).toBe('/?calendarSync=connected&calendarSyncProvider=google');
	});

	it('explains Google testing access_denied errors', () => {
		const message = createCalendarOAuthErrorMessage('google', 'access_denied', null);

		expect(message).toContain('Google Calendar 접근이 차단되었습니다');
		expect(message).toContain('Test users');
	});

	it('sanitizes long provider error descriptions before redirecting', () => {
		const redirect = createCalendarSyncRedirect({
			status: 'error',
			provider: 'google',
			message: `failed\n${'x'.repeat(400)}`
		});
		const params = new URL(`https://todo.example.com${redirect}`).searchParams;

		expect(params.get('calendarSync')).toBe('error');
		expect(params.get('calendarSyncMessage')).toHaveLength(320);
		expect(params.get('calendarSyncMessage')).not.toContain('\n');
	});
});
