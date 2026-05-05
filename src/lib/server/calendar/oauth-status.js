const MAX_OAUTH_MESSAGE_LENGTH = 320;

/**
 * @param {{
 *   status: 'connected' | 'error';
 *   provider?: string | null;
 *   message?: string | null;
 * }} options
 */
export function createCalendarSyncRedirect(options) {
	const params = new URLSearchParams({
		calendarSync: options.status
	});

	if (options.provider) {
		params.set('calendarSyncProvider', options.provider);
	}

	const message = sanitizeCalendarSyncMessage(options.message);
	if (message) {
		params.set('calendarSyncMessage', message);
	}

	return `/?${params.toString()}`;
}

/**
 * @param {string} provider
 * @param {string} error
 * @param {string | null} description
 */
export function createCalendarOAuthErrorMessage(provider, error, description = null) {
	const providerName = provider === 'google' ? 'Google Calendar' : provider === 'microsoft' ? 'Microsoft Calendar' : '외부 캘린더';
	if (provider === 'google' && error === 'access_denied') {
		return `${providerName} 접근이 차단되었습니다. Google Cloud OAuth 앱이 Testing 상태라면 로그인한 Google 계정을 Test users에 추가한 뒤 다시 시도하세요.`;
	}

	if (error === 'access_denied') {
		return `${providerName} 연결 권한이 거부되었습니다. 계정 접근 권한을 확인한 뒤 다시 시도하세요.`;
	}

	const suffix = sanitizeCalendarSyncMessage(description);
	return suffix
		? `${providerName} 연결을 완료하지 못했습니다: ${suffix}`
		: `${providerName} 연결을 완료하지 못했습니다. 잠시 후 다시 시도하세요.`;
}

/**
 * @param {string | null | undefined} message
 */
function sanitizeCalendarSyncMessage(message) {
	if (!message) {
		return '';
	}

	return message.replace(/\s+/g, ' ').trim().slice(0, MAX_OAUTH_MESSAGE_LENGTH);
}
