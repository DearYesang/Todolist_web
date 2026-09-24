/**
 * What the signed-out auth panel holds when "패스키 만들기" is pressed.
 * @typedef {{
 *   email: string;
 *   name: string;
 *   isRecoveryMode: boolean;
 *   emailVerificationCode: string;
 *   verificationEmail: string;
 *   verificationExpiresAt: string;
 *   recoveryCode: string;
 * }} PasskeySignupInput
 *
 * `email` is already trimmed and lower-cased. `verificationEmail` and
 * `verificationExpiresAt` describe the last code the server sent, and stay
 * empty until one is sent.
 */

/**
 * The first reason a new account's passkey cannot be created yet, or null.
 * Sign-up needs the email and the latest, unexpired code sent to that
 * email; recovery mode needs the email and a recovery code instead.
 * @param {PasskeySignupInput} input
 * @param {number} [now] epoch milliseconds
 * @returns {string | null}
 */
export function getPasskeySignupError(input, now = Date.now()) {
	if (!input.email) {
		return '이메일을 입력해 주세요.';
	}
	if (!input.isRecoveryMode && !input.emailVerificationCode.trim()) {
		return '이메일 확인 코드를 입력해 주세요.';
	}
	if (!input.isRecoveryMode && input.verificationEmail && input.verificationEmail !== input.email) {
		return '현재 이메일로 새 확인 코드를 받아 주세요.';
	}
	if (!input.isRecoveryMode && isExpiredVerificationCode(input.verificationExpiresAt, now)) {
		return '확인 코드가 만료되었습니다. 새 코드를 받아 주세요.';
	}
	if (input.isRecoveryMode && !input.recoveryCode.trim()) {
		return '복구 코드를 입력해 주세요.';
	}

	return null;
}

/**
 * An unknown or unparsable expiry never counts as expired; the server
 * still checks the code.
 * @param {string} expiresAt ISO date-time from the server, or ''
 * @param {number} [now] epoch milliseconds
 */
export function isExpiredVerificationCode(expiresAt, now = Date.now()) {
	const expiresAtMs = Date.parse(expiresAt);
	return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

/**
 * The registration context sent with a new account's passkey, which the
 * server reads in parsePasskeyRegistrationContext: the email, a name that
 * defaults to the email, and either the email code or the recovery code.
 * @param {PasskeySignupInput} input
 */
export function createPasskeySignupContext(input) {
	return JSON.stringify({
		email: input.email,
		name: input.name.trim() || input.email,
		...(input.isRecoveryMode
			? { recoveryCode: input.recoveryCode.trim() }
			: { emailVerificationCode: input.emailVerificationCode.trim() })
	});
}
