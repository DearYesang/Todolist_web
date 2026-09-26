import { afterEach, describe, expect, it } from 'vitest';
import {
	assertAllowedAccountEmail,
	assertValidPasskeyEmailCode,
	assertValidRecoveryCodeForEmail,
	normalizeAccountEmail,
	parsePasskeyRegistrationContext
} from './account-security.js';

describe('account security passkey errors', () => {
	it('returns a client-safe error for malformed registration context', () => {
		let error;
		try {
			parsePasskeyRegistrationContext('{');
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_REGISTRATION_CONTEXT'
			}
		});
	});

	it('returns a client-safe error for missing email verification codes', async () => {
		await expect(assertValidPasskeyEmailCode('primary@example.com', '')).rejects.toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_EMAIL_CODE'
			}
		});
	});

	it('returns a client-safe error for missing recovery codes', async () => {
		await expect(assertValidRecoveryCodeForEmail('primary@example.com', '')).rejects.toMatchObject({
			name: 'APIError',
			statusCode: 400,
			body: {
				code: 'INVALID_PASSKEY_RECOVERY_CODE'
			}
		});
	});
});

describe('account security helpers', () => {
	const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS;

	afterEach(() => {
		if (originalAllowedEmails === undefined) {
			delete process.env.AUTH_ALLOWED_EMAILS;
		} else {
			process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails;
		}
	});

	it('normalizes registration context and requires an email', () => {
		expect(normalizeAccountEmail('  USER@Example.COM ')).toBe('user@example.com');
		expect(
			parsePasskeyRegistrationContext(
				JSON.stringify({
					email: ' USER@Example.COM ',
					name: ' User ',
					emailVerificationCode: '123456'
				})
			)
		).toEqual({
			email: 'user@example.com',
			name: 'User',
			emailVerificationCode: '123456',
			recoveryCode: ''
		});

		expect(() =>
			parsePasskeyRegistrationContext(
				JSON.stringify({
					email: 'not-email',
					emailVerificationCode: '123456'
				})
			)
		).toThrow('패스키 등록에 사용할 이메일을 다시 확인해 주세요.');
	});

	it('limits registration to configured personal emails', () => {
		process.env.AUTH_ALLOWED_EMAILS = 'primary@example.com, backup@example.com';

		expect(() => assertAllowedAccountEmail(' PRIMARY@EXAMPLE.COM ')).not.toThrow();
		expect(() =>
			parsePasskeyRegistrationContext(
				JSON.stringify({
					email: 'backup@example.com',
					emailVerificationCode: '123456'
				})
			)
		).not.toThrow();
		expect(() => assertAllowedAccountEmail('other@example.com')).toThrow('not allowed');
	});
});
