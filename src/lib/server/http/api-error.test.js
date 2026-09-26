import { describe, expect, it } from 'vitest';
import { AccountSecurityConfigurationError, AccountSecurityPolicyError } from '$lib/server/auth/account-security.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';
import { CalendarSyncError } from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import { CalendarTokenConfigurationError, CalendarTokenLimitError } from '$lib/server/calendar/tokens.js';
import { RateLimitError } from '$lib/server/security/rate-limit.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';
import { ApiError, apiErrorResponse, readJsonBody } from './api-error.js';

/**
 * @param {Response} response
 */
async function readResponse(response) {
	return {
		status: response.status,
		body: await response.json(),
		headers: Object.fromEntries(response.headers)
	};
}

/**
 * @param {string | undefined} body
 * @param {Record<string, string>} [headers]
 */
function createRequest(body, headers = {}) {
	return new Request('https://todo.example.com/api', { method: 'POST', body, headers });
}

describe('ApiError', () => {
	it('is a 400 without headers unless told otherwise', () => {
		const error = new ApiError('Category name is required.');

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({
			name: 'ApiError',
			message: 'Category name is required.',
			status: 400,
			headers: undefined
		});
		expect(new ApiError('Gone.', 404, { 'x-reason': 'deleted' })).toMatchObject({
			status: 404,
			headers: { 'x-reason': 'deleted' }
		});
	});

	it.each([
		[new TaskWriteError('Invalid task.'), 'TaskWriteError', 400, true],
		[new TaskWriteError('Task changed on another device.', 409), 'TaskWriteError', 409, true],
		[new RateLimitError('Too many requests.', 30), 'RateLimitError', 429, true],
		[new CalendarTokenConfigurationError(), 'CalendarTokenConfigurationError', 503, false],
		[new CalendarTokenLimitError('Too many tokens.'), 'CalendarTokenLimitError', 429, true],
		[new CalendarTokenEncryptionError('No key.'), 'CalendarTokenEncryptionError', 503, false],
		[new CalendarProviderError('Provider failed.'), 'CalendarProviderError', 502, true],
		[new CalendarSyncError('Sync failed.'), 'CalendarSyncError', 500, true],
		[new AccountSecurityConfigurationError('No secret.'), 'AccountSecurityConfigurationError', 503, false],
		[new AccountSecurityPolicyError('Not allowed.'), 'AccountSecurityPolicyError', 403, true]
	])('%s is an ApiError that keeps its name and status', (error, name, status, answeredByDefault) => {
		expect(error).toBeInstanceOf(ApiError);
		expect(error.name).toBe(name);
		expect(error.status).toBe(status);
		expect(error.answeredByDefault).toBe(answeredByDefault);
	});

	it('gives a RateLimitError its Retry-After header', () => {
		const error = new RateLimitError('Too many requests.', 30);

		expect(error.retryAfter).toBe(30);
		expect(error.headers).toEqual({ 'retry-after': '30' });
	});
});

describe('apiErrorResponse', () => {
	it('answers an ApiError with its status, message and headers', async () => {
		expect(await readResponse(apiErrorResponse(new TaskWriteError('Task changed on another device.', 409)))).toEqual({
			status: 409,
			body: { message: 'Task changed on another device.' },
			headers: { 'content-type': 'application/json', 'content-length': '45' }
		});
	});

	it('answers a RateLimitError 429 with Retry-After', async () => {
		expect(await readResponse(apiErrorResponse(new RateLimitError('Too many task changes.', 42)))).toEqual({
			status: 429,
			body: { message: 'Too many task changes.' },
			headers: { 'content-type': 'application/json', 'content-length': '36', 'retry-after': '42' }
		});
	});

	it('throws anything that is not an ApiError again', () => {
		const failure = new Error('connection reset');

		expect(() => apiErrorResponse(failure)).toThrow(failure);
		expect(() => apiErrorResponse('not an error')).toThrow('not an error');
	});

	it.each([
		['CalendarTokenConfigurationError', new CalendarTokenConfigurationError(), CalendarTokenConfigurationError],
		[
			'CalendarTokenEncryptionError',
			new CalendarTokenEncryptionError('CALENDAR_OAUTH_ENCRYPTION_KEY must be at least 32 bytes.'),
			CalendarTokenEncryptionError
		],
		[
			'AccountSecurityConfigurationError',
			new AccountSecurityConfigurationError(
				'ACCOUNT_RECOVERY_SECRET or BETTER_AUTH_SECRET must be configured before account recovery can be used.'
			),
			AccountSecurityConfigurationError
		]
	])('throws %s again unless the route names its class', (_name, error, type) => {
		expect(() => apiErrorResponse(error)).toThrow(error);
		expect(apiErrorResponse(error, type).status).toBe(503);
	});

	it('answers only the named classes when a route names them', async () => {
		const limited = new RateLimitError('Too many requests.', 30);
		const unconfigured = new AccountSecurityConfigurationError('ACCOUNT_RECOVERY_SECRET must be configured.');

		expect(apiErrorResponse(limited, RateLimitError).status).toBe(429);
		expect(() => apiErrorResponse(unconfigured, RateLimitError)).toThrow(unconfigured);
		expect(apiErrorResponse(new CalendarSyncError('Busy.', 409), RateLimitError, CalendarSyncError).status).toBe(409);
	});
});

describe('readJsonBody', () => {
	const invalidJson = { name: 'ApiError', status: 400, message: 'Request body must be valid JSON.' };

	it('parses the body, keeping a JSON null', async () => {
		expect(await readJsonBody(createRequest('{"text":"Task"}'))).toEqual({ text: 'Task' });
		expect(await readJsonBody(createRequest('null'))).toBeNull();
	});

	it('refuses a body that is not JSON, an empty one and one that cannot be read with a 400', async () => {
		await expect(readJsonBody(createRequest('{'))).rejects.toMatchObject(invalidJson);
		await expect(readJsonBody(createRequest(undefined))).rejects.toMatchObject(invalidJson);

		const used = createRequest('{}');
		await used.text();
		await expect(readJsonBody(used)).rejects.toMatchObject(invalidJson);
	});

	it('takes an empty or blank body as no payload when the body is optional', async () => {
		expect(await readJsonBody(createRequest(undefined), { optional: true })).toBeUndefined();
		expect(await readJsonBody(createRequest(' \n\t'), { optional: true })).toBeUndefined();
		expect(await readJsonBody(createRequest('{"expectedVersion":2}'), { optional: true })).toEqual({
			expectedVersion: 2
		});
		await expect(readJsonBody(createRequest('{'), { optional: true })).rejects.toMatchObject(invalidJson);
	});

	it('takes a body that is not JSON, or none, as {} when lenient', async () => {
		expect(await readJsonBody(createRequest('{'), { lenient: true })).toEqual({});
		expect(await readJsonBody(createRequest(undefined), { lenient: true })).toEqual({});
		expect(await readJsonBody(createRequest('{"name":"Feed"}'), { lenient: true })).toEqual({ name: 'Feed' });
	});

	it('refuses a body over maxLength with a 413, by its declared length or by its text', async () => {
		const tooLarge = { status: 413, message: 'Import payload is too large.' };
		const options = { maxLength: 10, tooLargeMessage: 'Import payload is too large.' };

		await expect(readJsonBody(createRequest('[]', { 'content-length': '11' }), options)).rejects.toMatchObject(
			tooLarge
		);
		await expect(readJsonBody(createRequest('[1,2,3,4,5]'), options)).rejects.toMatchObject(tooLarge);
		expect(await readJsonBody(createRequest('[1,2,3,45]'), options)).toEqual([1, 2, 3, 45]);
		await expect(readJsonBody(createRequest('[', { 'content-length': '1' }), options)).rejects.toMatchObject(
			invalidJson
		);
		await expect(readJsonBody(createRequest('[1,2,3,4,5]'), { maxLength: 10 })).rejects.toMatchObject({
			status: 413,
			message: 'Request body is too large.'
		});
	});

	it('counts the text after reading in characters, not bytes, as the import route always has', async () => {
		// 10 characters, 18 bytes of UTF-8, sent without a content-length.
		const body = '"éééééééé"';
		expect(new TextEncoder().encode(body).byteLength).toBe(18);

		expect(await readJsonBody(createRequest(body), { maxLength: 10 })).toBe('éééééééé');
		await expect(readJsonBody(createRequest(body), { maxLength: 9 })).rejects.toMatchObject({ status: 413 });
	});
});
