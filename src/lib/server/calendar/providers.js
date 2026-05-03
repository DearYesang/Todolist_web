export const CALENDAR_PROVIDERS = {
	google: {
		id: 'google',
		name: 'Google Calendar',
		authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
		scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.events']
	},
	microsoft: {
		id: 'microsoft',
		name: 'Microsoft Calendar',
		authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
		tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
		profileUrl: 'https://graph.microsoft.com/v1.0/me',
		scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite']
	}
};

export class CalendarProviderError extends Error {
	/** @param {string} message */
	constructor(message, status = 502) {
		super(message);
		this.name = 'CalendarProviderError';
		this.status = status;
	}
}

/**
 * @param {string} provider
 */
export function getCalendarProvider(provider) {
	const config = /** @type {Record<string, typeof CALENDAR_PROVIDERS.google>} */ (CALENDAR_PROVIDERS)[provider];
	if (!config) {
		throw new CalendarProviderError('Unsupported calendar provider.', 404);
	}

	return config;
}

export function listCalendarProviders() {
	return Object.values(CALENDAR_PROVIDERS).map((provider) => ({
		id: provider.id,
		name: provider.name,
		configured: Boolean(getProviderCredentials(provider.id))
	}));
}

/**
 * @param {string} provider
 * @param {string} state
 * @param {string} redirectUri
 */
export function buildCalendarAuthorizationUrl(provider, state, redirectUri) {
	const config = getCalendarProvider(provider);
	const credentials = requireProviderCredentials(provider);
	const url = new URL(config.authUrl);
	url.searchParams.set('client_id', credentials.clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', config.scopes.join(' '));
	url.searchParams.set('state', state);
	url.searchParams.set('prompt', provider === 'google' ? 'consent' : 'select_account');
	if (provider === 'google') {
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('include_granted_scopes', 'true');
	}

	return url.toString();
}

/**
 * @param {string} provider
 * @param {string} code
 * @param {string} redirectUri
 */
export async function exchangeCalendarCode(provider, code, redirectUri) {
	const config = getCalendarProvider(provider);
	const credentials = requireProviderCredentials(provider);
	const body = new URLSearchParams({
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		code,
		redirect_uri: redirectUri,
		grant_type: 'authorization_code'
	});

	return requestToken(config.tokenUrl, body);
}

/**
 * @param {string} provider
 * @param {string} refreshToken
 */
export async function refreshCalendarToken(provider, refreshToken) {
	const config = getCalendarProvider(provider);
	const credentials = requireProviderCredentials(provider);
	const body = new URLSearchParams({
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		refresh_token: refreshToken,
		grant_type: 'refresh_token'
	});

	return requestToken(config.tokenUrl, body);
}

/**
 * @param {string} provider
 * @param {string} accessToken
 */
export async function fetchCalendarProviderAccount(provider, accessToken) {
	const config = getCalendarProvider(provider);
	const body = await requestJson(config.profileUrl, {
		headers: {
			authorization: `Bearer ${accessToken}`
		}
	});

	if (provider === 'google') {
		return {
			id: readString(body, 'sub') ?? readString(body, 'email') ?? 'google-account',
			email: readString(body, 'email')
		};
	}

	return {
		id: readString(body, 'id') ?? readString(body, 'userPrincipalName') ?? 'microsoft-account',
		email: readString(body, 'mail') ?? readString(body, 'userPrincipalName')
	};
}

/**
 * @param {string} provider
 * @param {string} accessToken
 * @param {string | null} eventId
 * @param {import('$lib/shared/task-domain.js').Task} task
 */
export async function upsertProviderCalendarEvent(provider, accessToken, eventId, task) {
	if (provider === 'google') {
		const url = eventId
			? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
			: 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
		const body = await requestJson(url, {
			method: eventId ? 'PATCH' : 'POST',
			headers: createJsonAuthHeaders(accessToken),
			body: JSON.stringify(toGoogleEvent(task))
		});
		return {
			id: readString(body, 'id') ?? eventId,
			etag: readString(body, 'etag')
		};
	}

	const url = eventId
		? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`
		: 'https://graph.microsoft.com/v1.0/me/events';
	const body = await requestJson(url, {
		method: eventId ? 'PATCH' : 'POST',
		headers: createJsonAuthHeaders(accessToken),
		body: JSON.stringify(toMicrosoftEvent(task))
	});
	return {
		id: readString(body, 'id') ?? eventId,
		etag: readString(body, '@odata.etag')
	};
}

/**
 * @param {string} provider
 * @param {string} accessToken
 * @param {string} eventId
 */
export async function deleteProviderCalendarEvent(provider, accessToken, eventId) {
	const url = provider === 'google'
		? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
		: `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
	const response = await fetch(url, {
		method: 'DELETE',
		headers: {
			authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok && response.status !== 404 && response.status !== 410) {
		throw new CalendarProviderError(`Calendar provider delete failed with status ${response.status}.`);
	}
}

/**
 * @param {string} tokenUrl
 * @param {URLSearchParams} body
 */
async function requestToken(tokenUrl, body) {
	const json = await requestJson(tokenUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: body.toString()
	});

	return {
		accessToken: readString(json, 'access_token'),
		refreshToken: readString(json, 'refresh_token'),
		expiresIn: readNumber(json, 'expires_in')
	};
}

/**
 * @param {string} url
 * @param {RequestInit} init
 */
async function requestJson(url, init) {
	const response = await fetch(url, init);
	const body = await readJson(response);
	if (!response.ok) {
		throw new CalendarProviderError(`Calendar provider request failed with status ${response.status}.`);
	}

	return body;
}

/**
 * @param {Response} response
 */
async function readJson(response) {
	try {
		return await response.json();
	} catch {
		return {};
	}
}

/**
 * @param {string} accessToken
 */
function createJsonAuthHeaders(accessToken) {
	return {
		authorization: `Bearer ${accessToken}`,
		'content-type': 'application/json'
	};
}

/**
 * @param {import('$lib/shared/task-domain.js').Task} task
 */
function toGoogleEvent(task) {
	return {
		summary: task.text,
		description: createTaskDescription(task),
		start: { date: task.startDate },
		end: { date: addDays(task.endDate, 1) }
	};
}

/**
 * @param {import('$lib/shared/task-domain.js').Task} task
 */
function toMicrosoftEvent(task) {
	return {
		subject: task.text,
		body: {
			contentType: 'text',
			content: createTaskDescription(task)
		},
		isAllDay: true,
		start: {
			dateTime: `${task.startDate}T00:00:00`,
			timeZone: 'UTC'
		},
		end: {
			dateTime: `${addDays(task.endDate, 1)}T00:00:00`,
			timeZone: 'UTC'
		}
	};
}

/**
 * @param {import('$lib/shared/task-domain.js').Task} task
 */
function createTaskDescription(task) {
	const lines = [
		`Status: ${task.status}`,
		`Priority: ${task.priority}`,
		`Urgency: ${task.urgency}`
	];
	if (task.category) {
		lines.push(`Category: ${task.category}`);
	}
	if (task.subtasks.length > 0) {
		lines.push('', 'Checklist:');
		task.subtasks.forEach((subtask) => {
			lines.push(`- [${subtask.done ? 'x' : ' '}] ${subtask.text}`);
		});
	}

	return lines.join('\n');
}

/**
 * @param {string} date
 * @param {number} days
 */
function addDays(date, days) {
	const next = new Date(`${date}T00:00:00.000Z`);
	next.setUTCDate(next.getUTCDate() + days);
	return next.toISOString().slice(0, 10);
}

/**
 * @param {string} provider
 */
function requireProviderCredentials(provider) {
	const credentials = getProviderCredentials(provider);
	if (!credentials) {
		throw new CalendarProviderError(`${getCalendarProvider(provider).name} OAuth credentials are not configured.`, 503);
	}

	return credentials;
}

/**
 * @param {string} provider
 */
function getProviderCredentials(provider) {
	const prefix = provider === 'google' ? 'GOOGLE_CALENDAR' : 'MICROSOFT_CALENDAR';
	const clientId = process.env[`${prefix}_CLIENT_ID`];
	const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
	if (!clientId || !clientSecret || clientId.includes('replace-with') || clientSecret.includes('replace-with')) {
		return null;
	}

	return { clientId, clientSecret };
}

/**
 * @param {unknown} value
 * @param {string} key
 */
function readString(value, key) {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const result = /** @type {Record<string, unknown>} */ (value)[key];
	return typeof result === 'string' && result ? result : null;
}

/**
 * @param {unknown} value
 * @param {string} key
 */
function readNumber(value, key) {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const result = /** @type {Record<string, unknown>} */ (value)[key];
	return typeof result === 'number' ? result : null;
}
