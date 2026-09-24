import { formatLocalDate } from '../shared/local-date.js';

/**
 * The navigator fields the device label reads; tests pass a fake.
 * @typedef {Pick<Navigator, 'platform' | 'userAgent' | 'maxTouchPoints'>} DeviceNavigator
 */

/**
 * The Korean message the auth panel shows for a failed auth, passkey or
 * account request. Known Better Auth and account-security errors get their
 * own wording; anything else shows the server's message.
 * @param {{ message?: string; status?: number; statusText?: string }} error
 */
export function getAuthErrorMessage(error) {
	if (error.status === 503) {
		return '데이터베이스 설정 후 이용할 수 있습니다.';
	}

	const message = error.message || error.statusText || '';
	if (/valid email verification code|required for passkey|INVALID_PASSKEY_EMAIL_CODE/i.test(message)) {
		return '확인 코드가 맞지 않거나 만료되었습니다. 가장 최근에 받은 코드를 입력해 주세요.';
	}
	if (/valid recovery code|INVALID_PASSKEY_RECOVERY_CODE/i.test(message)) {
		return '복구 코드가 맞지 않거나 이미 사용되었습니다.';
	}
	if (/not allowed|EMAIL_NOT_ALLOWED/i.test(message)) {
		return '가입이 허용된 이메일만 사용할 수 있습니다.';
	}
	if (/failed to verify registration/i.test(message)) {
		return '패스키 등록을 확인하지 못했습니다. 새 확인 코드를 받아 다시 시도해 주세요.';
	}
	if (/authentication failed|passkey not found/i.test(message)) {
		return '등록된 패스키를 찾지 못했습니다.';
	}

	return message || '인증 요청을 완료하지 못했습니다.';
}

/**
 * A short name for this device, used in the suggested passkey name. iPadOS
 * reports itself as a Mac, so a touch-capable MacIntel counts as an iPad.
 * @param {DeviceNavigator} [nav]
 */
export function detectDeviceLabel(nav = globalThis.navigator) {
	if (typeof nav === 'undefined') {
		return '내 기기';
	}

	const platform = nav.platform || '';
	const userAgent = nav.userAgent || '';
	const maxTouchPoints = nav.maxTouchPoints || 0;

	if (/iPad/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
		return 'iPad';
	}
	if (/iPhone/i.test(userAgent)) {
		return 'iPhone';
	}
	if (/Windows|Win32|Win64/i.test(platform) || /Windows/i.test(userAgent)) {
		return 'Windows PC';
	}
	if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) {
		return 'Mac';
	}
	if (/Android/i.test(userAgent)) {
		return 'Android';
	}

	return '내 기기';
}

/**
 * `<device> 패스키 - YYYY-MM-DD` (local date), the default name for a new
 * passkey.
 * @param {Date} [now]
 * @param {DeviceNavigator} [nav]
 */
export function createSuggestedPasskeyName(now = new Date(), nav) {
	return `${detectDeviceLabel(nav)} 패스키 - ${formatLocalDate(now)}`;
}

/**
 * The name shown for a passkey saved without one: its registration date,
 * or the start of its id when the date is missing.
 * @param {import('./passkey-management-api.js').ManagedPasskey} passkey
 */
export function createFallbackPasskeyName(passkey) {
	return `패스키 ${passkey.createdAt ? formatShortDate(passkey.createdAt) : passkey.id.slice(0, 6)}`;
}

/**
 * `등록 YYYY-MM-DD · 동기화됨|이 기기` under each managed passkey.
 * @param {import('./passkey-management-api.js').ManagedPasskey} passkey
 */
export function formatPasskeyMeta(passkey) {
	const created = passkey.createdAt ? `등록 ${formatShortDate(passkey.createdAt)}` : '등록일 알 수 없음';
	const backup = passkey.backedUp ? '동기화됨' : '이 기기';
	return `${created} · ${backup}`;
}

/**
 * @param {string} value
 */
function formatShortDate(value) {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) {
		return '알 수 없음';
	}

	return formatLocalDate(date);
}
