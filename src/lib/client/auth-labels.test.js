import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createFallbackPasskeyName,
	createSuggestedPasskeyName,
	detectDeviceLabel,
	formatPasskeyMeta,
	getAuthErrorMessage
} from './auth-labels.js';

const IPHONE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
	'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID_UA =
	'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/**
 * @param {string} userAgent
 * @param {string} platform
 * @param {number} [maxTouchPoints]
 */
function fakeNavigator(userAgent, platform, maxTouchPoints = 0) {
	return { userAgent, platform, maxTouchPoints };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('auth error messages', () => {
	it('names an unavailable database before anything else', () => {
		expect(getAuthErrorMessage({ status: 503, message: 'INVALID_PASSKEY_EMAIL_CODE' })).toBe(
			'데이터베이스 설정 후 이용할 수 있습니다.'
		);
	});

	it.each([
		[
			'Passkey registration requires a valid email verification code.',
			'확인 코드가 맞지 않거나 만료되었습니다. 가장 최근에 받은 코드를 입력해 주세요.'
		],
		[
			'Email verification is required for passkey registration.',
			'확인 코드가 맞지 않거나 만료되었습니다. 가장 최근에 받은 코드를 입력해 주세요.'
		],
		['INVALID_PASSKEY_EMAIL_CODE', '확인 코드가 맞지 않거나 만료되었습니다. 가장 최근에 받은 코드를 입력해 주세요.'],
		['Enter a valid recovery code.', '복구 코드가 맞지 않거나 이미 사용되었습니다.'],
		['INVALID_PASSKEY_RECOVERY_CODE', '복구 코드가 맞지 않거나 이미 사용되었습니다.'],
		['This email is not allowed.', '가입이 허용된 이메일만 사용할 수 있습니다.'],
		['EMAIL_NOT_ALLOWED', '가입이 허용된 이메일만 사용할 수 있습니다.'],
		['Failed to verify registration', '패스키 등록을 확인하지 못했습니다. 새 확인 코드를 받아 다시 시도해 주세요.'],
		['Authentication failed', '등록된 패스키를 찾지 못했습니다.'],
		['Passkey not found', '등록된 패스키를 찾지 못했습니다.']
	])('translates %j', (message, expected) => {
		expect(getAuthErrorMessage({ status: 400, message })).toBe(expected);
	});

	it('falls back to the server message, the status text, then a generic message', () => {
		expect(getAuthErrorMessage({ status: 429, message: 'Too many requests.' })).toBe('Too many requests.');
		expect(getAuthErrorMessage({ status: 500, message: '', statusText: 'Internal Server Error' })).toBe(
			'Internal Server Error'
		);
		expect(getAuthErrorMessage({})).toBe('인증 요청을 완료하지 못했습니다.');
	});
});

describe('device label', () => {
	it.each([
		['iPhone', fakeNavigator(IPHONE_UA, 'iPhone', 5)],
		['iPad', fakeNavigator(IPAD_UA, 'iPad', 5)],
		// iPadOS asks for the desktop site: a Mac user agent with touch points.
		['iPad', fakeNavigator(MAC_UA, 'MacIntel', 5)],
		['Mac', fakeNavigator(MAC_UA, 'MacIntel', 0)],
		['Windows PC', fakeNavigator(WINDOWS_UA, 'Win32')],
		// Playwright's Desktop Chrome: a Windows user agent on any platform.
		['Windows PC', fakeNavigator(WINDOWS_UA, 'Linux x86_64')],
		['Android', fakeNavigator(ANDROID_UA, 'Linux armv8l', 5)],
		['내 기기', fakeNavigator('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')],
		['내 기기', fakeNavigator('', '')]
	])('calls %s', (label, nav) => {
		expect(detectDeviceLabel(nav)).toBe(label);
	});

	it('reads the global navigator, and copes without one', () => {
		vi.stubGlobal('navigator', fakeNavigator(IPHONE_UA, 'iPhone', 5));
		expect(detectDeviceLabel()).toBe('iPhone');

		vi.stubGlobal('navigator', undefined);
		expect(detectDeviceLabel()).toBe('내 기기');
	});
});

describe('passkey names', () => {
	it('suggests the device and the local date', () => {
		// 00:30 on 2026-09-24 local time; the UTC date may still be the 23rd.
		const now = new Date(2026, 8, 24, 0, 30);

		expect(createSuggestedPasskeyName(now, fakeNavigator(MAC_UA, 'MacIntel'))).toBe('Mac 패스키 - 2026-09-24');
		vi.stubGlobal('navigator', fakeNavigator(IPHONE_UA, 'iPhone', 5));
		expect(createSuggestedPasskeyName(now)).toBe('iPhone 패스키 - 2026-09-24');
	});

	it('names an unnamed passkey by its registration date, or its id', () => {
		const createdAt = new Date(2026, 4, 2, 12).toISOString();

		expect(createFallbackPasskeyName({ id: 'abcdef123456', name: null, createdAt })).toBe('패스키 2026-05-02');
		expect(createFallbackPasskeyName({ id: 'abcdef123456', name: null })).toBe('패스키 abcdef');
		expect(createFallbackPasskeyName({ id: 'abcdef123456', name: null, createdAt: 'not a date' })).toBe(
			'패스키 알 수 없음'
		);
	});

	it('describes when a passkey was registered and whether it syncs', () => {
		const createdAt = new Date(2026, 4, 1, 12).toISOString();

		expect(formatPasskeyMeta({ id: 'a', name: 'Mac', createdAt, backedUp: true })).toBe('등록 2026-05-01 · 동기화됨');
		expect(formatPasskeyMeta({ id: 'b', name: null, createdAt, backedUp: false })).toBe('등록 2026-05-01 · 이 기기');
		expect(formatPasskeyMeta({ id: 'c', name: null })).toBe('등록일 알 수 없음 · 이 기기');
		expect(formatPasskeyMeta({ id: 'd', name: null, createdAt: 'garbage' })).toBe('등록 알 수 없음 · 이 기기');
	});
});
