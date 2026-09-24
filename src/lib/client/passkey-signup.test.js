import { afterEach, describe, expect, it } from 'vitest';
import { parsePasskeyRegistrationContext } from '$lib/server/auth/account-security.js';
import {
	createPasskeySignupContext,
	getPasskeySignupError,
	isExpiredVerificationCode
} from './passkey-signup.js';

const NOW = Date.parse('2026-09-24T03:00:00.000Z');

/**
 * @param {Partial<import('./passkey-signup.js').PasskeySignupInput>} [overrides]
 * @returns {import('./passkey-signup.js').PasskeySignupInput}
 */
function signupInput(overrides = {}) {
	return {
		email: 'user@example.com',
		name: '',
		isRecoveryMode: false,
		emailVerificationCode: '123456',
		verificationEmail: 'user@example.com',
		verificationExpiresAt: '2026-09-24T03:10:00.000Z',
		recoveryCode: '',
		...overrides
	};
}

describe('passkey sign-up checks', () => {
	it('accepts the latest unexpired code sent to the same email', () => {
		expect(getPasskeySignupError(signupInput(), NOW)).toBeNull();
		// A code typed before any was sent here is left to the server.
		expect(getPasskeySignupError(signupInput({ verificationEmail: '', verificationExpiresAt: '' }), NOW)).toBeNull();
	});

	it('reports the first missing or stale input, in order', () => {
		expect(getPasskeySignupError(signupInput({ email: '', emailVerificationCode: '' }), NOW)).toBe('이메일을 입력해 주세요.');
		expect(getPasskeySignupError(signupInput({ emailVerificationCode: '   ', verificationEmail: 'other@example.com' }), NOW)).toBe('이메일 확인 코드를 입력해 주세요.');
		expect(getPasskeySignupError(signupInput({ verificationEmail: 'other@example.com', verificationExpiresAt: '2000-01-01T00:00:00.000Z' }), NOW)).toBe('현재 이메일로 새 확인 코드를 받아 주세요.');
		expect(getPasskeySignupError(signupInput({ verificationExpiresAt: '2026-09-24T03:00:00.000Z' }), NOW)).toBe('확인 코드가 만료되었습니다. 새 코드를 받아 주세요.');
	});

	it('asks for a recovery code instead of an email code in recovery mode', () => {
		const recovery = { isRecoveryMode: true, emailVerificationCode: '', verificationEmail: 'other@example.com', verificationExpiresAt: '2000-01-01T00:00:00.000Z' };

		expect(getPasskeySignupError(signupInput({ ...recovery, recoveryCode: '  ' }), NOW)).toBe('복구 코드를 입력해 주세요.');
		expect(getPasskeySignupError(signupInput({ ...recovery, recoveryCode: 'ABCD-1234' }), NOW)).toBeNull();
		expect(getPasskeySignupError(signupInput({ ...recovery, email: '', recoveryCode: 'ABCD-1234' }), NOW)).toBe('이메일을 입력해 주세요.');
	});

	it('treats a missing or unreadable expiry as not expired', () => {
		expect(isExpiredVerificationCode('', NOW)).toBe(false);
		expect(isExpiredVerificationCode('soon', NOW)).toBe(false);
		expect(isExpiredVerificationCode('2026-09-24T03:00:00.001Z', NOW)).toBe(false);
		expect(isExpiredVerificationCode('2026-09-24T03:00:00.000Z', NOW)).toBe(true);
	});
});

describe('passkey sign-up context', () => {
	const originalAllowedEmails = process.env.AUTH_ALLOWED_EMAILS;

	afterEach(() => {
		if (originalAllowedEmails === undefined) {
			delete process.env.AUTH_ALLOWED_EMAILS;
		} else {
			process.env.AUTH_ALLOWED_EMAILS = originalAllowedEmails;
		}
	});

	it('sends the email code, with the name defaulting to the email', () => {
		const context = createPasskeySignupContext(signupInput({ emailVerificationCode: ' 123456 ', recoveryCode: 'unused' }));

		expect(context).toBe('{"email":"user@example.com","name":"user@example.com","emailVerificationCode":"123456"}');
	});

	it('sends the recovery code instead in recovery mode', () => {
		const context = createPasskeySignupContext(signupInput({ name: '  사용자 ', isRecoveryMode: true, recoveryCode: ' ABCD-1234 ' }));

		expect(context).toBe('{"email":"user@example.com","name":"사용자","recoveryCode":"ABCD-1234"}');
	});

	it('is read back unchanged by the server', () => {
		delete process.env.AUTH_ALLOWED_EMAILS;

		expect(parsePasskeyRegistrationContext(createPasskeySignupContext(signupInput({ name: '사용자' })))).toEqual({
			email: 'user@example.com',
			name: '사용자',
			emailVerificationCode: '123456',
			recoveryCode: ''
		});
		expect(parsePasskeyRegistrationContext(createPasskeySignupContext(signupInput({ isRecoveryMode: true, recoveryCode: 'ABCD-1234' })))).toEqual({
			email: 'user@example.com',
			name: 'user@example.com',
			emailVerificationCode: '',
			recoveryCode: 'ABCD-1234'
		});
	});
});
