import { describe, expect, it } from 'vitest';
import {
	createServerChecklistItem,
	deleteServerTask,
	exportServerTasks,
	getBoardPreferences,
	importServerTasks,
	listServerTasks,
	updateBoardPreferences,
	updateServerTask
} from './task-api.js';
import {
	deleteServerCategory,
	listServerCategories,
	mergeServerCategory,
	reorderServerCategories,
	updateServerCategory
} from './category-api.js';
import { createCalendarToken, listCalendarTokens, revokeCalendarToken } from './calendar-token-api.js';
import { createRecoveryCodes, requestEmailVerificationCode, revokeRecoveryCodes } from './account-security-api.js';
import { deleteUserPasskey, listUserPasskeys, updateUserPasskeyName } from './passkey-management-api.js';
import { deleteCalendarConnection, listCalendarProviders, syncCalendarProviders } from './calendar-provider-api.js';

// Failure results of every client API module, pinned exactly (toEqual), so
// sharing their HTTP helpers cannot change a message, a status or the
// fallback (keep local state and retry) decision.

/**
 * @param {number} status
 * @param {unknown} body
 */
function respondJson(status, body) {
	return /** @type {typeof fetch} */ (
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			})
	);
}

/**
 * @param {number} status
 * @param {string} text
 */
function respondText(status, text) {
	return /** @type {typeof fetch} */ (async () => new Response(text, { status }));
}

const failNetwork = /** @type {typeof fetch} */ (
	async () => {
		throw new TypeError('Failed to fetch');
	}
);

// null, not undefined: undefined would pick the default globalThis.fetch.
const notAFetcher = /** @type {typeof fetch} */ (/** @type {unknown} */ (null));

describe('task-api failures', () => {
	it('retries 401, 409, 429 and 503 and nothing else', async () => {
		for (const status of [401, 409, 429, 503]) {
			await expect(listServerTasks(respondJson(status, { message: `status ${status}` }))).resolves.toEqual({
				ok: false,
				fallback: true,
				status,
				message: `status ${status}`
			});
		}

		for (const status of [400, 403, 404, 422, 500, 502]) {
			await expect(listServerTasks(respondJson(status, {}))).resolves.toEqual({
				ok: false,
				fallback: false,
				status,
				message: `Task API request failed with status ${status}.`
			});
		}
	});

	it('falls back to the status message for blank, non-string or unreadable bodies', async () => {
		await expect(updateServerTask('task-1', {}, respondJson(400, { message: '   ' }))).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 400,
			message: 'Task API request failed with status 400.'
		});
		await expect(deleteServerTask('task-1', respondJson(404, { message: 42, error: 'nope' }))).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 404,
			message: 'Task API request failed with status 404.'
		});
		await expect(createServerChecklistItem('task-1', 'item', respondText(503, '<html>busy</html>'))).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 503,
			message: 'Task API request failed with status 503.'
		});
		// A 200 with the wrong shape is a failure too, and not retryable.
		await expect(exportServerTasks(respondJson(200, { tasks: [] }))).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 200,
			message: 'Task API request failed with status 200.'
		});
	});

	it('reports unavailable and failed requests as retryable with status 0', async () => {
		await expect(listServerTasks(notAFetcher)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Task API is not available.'
		});
		await expect(updateServerTask('task-1', {}, failNetwork)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Task API request could not be completed.'
		});
		await expect(createServerChecklistItem('task-1', 'item', notAFetcher)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Task API is not available.'
		});
		await expect(importServerTasks([], failNetwork)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Task API request could not be completed.'
		});
	});

	it('uses board-preference wording for the preferences endpoint', async () => {
		await expect(getBoardPreferences(respondJson(503, {}))).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 503,
			message: 'Board preferences request failed with status 503.'
		});
		await expect(
			updateBoardPreferences({ defaultView: 'gantt' }, respondJson(400, { message: 'Invalid view.' }))
		).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 400,
			message: 'Invalid view.'
		});
		await expect(getBoardPreferences(notAFetcher)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Board preferences API is not available.'
		});
		await expect(updateBoardPreferences({ defaultView: 'gantt' }, failNetwork)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Board preferences request could not be completed.'
		});
	});

	it('rejects an unsupported import payload before any request', async () => {
		await expect(importServerTasks({ nope: true }, failNetwork)).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 400,
			message: 'Import payload must be an array of tasks or a backup object with a tasks array.'
		});
	});
});

describe('category-api failures', () => {
	it('retries only 401 and 503', async () => {
		for (const status of [401, 503]) {
			await expect(listServerCategories(respondJson(status, {}))).resolves.toEqual({
				ok: false,
				fallback: true,
				status,
				message: `Category API request failed with status ${status}.`
			});
		}

		for (const status of [400, 404, 409, 429, 500]) {
			await expect(listServerCategories(respondJson(status, { message: `status ${status}` }))).resolves.toEqual({
				ok: false,
				fallback: false,
				status,
				message: `status ${status}`
			});
		}
	});

	it('shares the wording across list, write, merge and reorder', async () => {
		await expect(updateServerCategory('category-1', { name: 'x' }, respondText(500, 'oops'))).resolves.toEqual({
			ok: false,
			fallback: false,
			status: 500,
			message: 'Category API request failed with status 500.'
		});
		await expect(deleteServerCategory('category-1', respondJson(401, { message: ' ' }))).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 401,
			message: 'Category API request failed with status 401.'
		});
		await expect(mergeServerCategory('a', 'b', notAFetcher)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Category API is not available.'
		});
		await expect(reorderServerCategories(['a'], failNetwork)).resolves.toEqual({
			ok: false,
			fallback: true,
			status: 0,
			message: 'Category API request could not be completed.'
		});
	});
});

describe('calendar-token-api failures', () => {
	it('returns the server message or a Korean default, with no status', async () => {
		await expect(listCalendarTokens(respondText(500, 'oops'))).resolves.toEqual({
			ok: false,
			message: '캘린더 구독 목록을 불러오지 못했습니다.'
		});
		await expect(listCalendarTokens(respondJson(401, { message: '로그인이 필요합니다.' }))).resolves.toEqual({
			ok: false,
			message: '로그인이 필요합니다.'
		});
		await expect(createCalendarToken('feed', respondJson(400, { message: '' }))).resolves.toEqual({
			ok: false,
			message: '캘린더 구독 링크를 만들지 못했습니다.'
		});
		await expect(revokeCalendarToken('token-1', failNetwork)).resolves.toEqual({
			ok: false,
			message: '캘린더 구독 링크를 해지하지 못했습니다.'
		});
		// No fetcher check: calling null throws inside the try.
		await expect(listCalendarTokens(notAFetcher)).resolves.toEqual({
			ok: false,
			message: '캘린더 구독 목록을 불러오지 못했습니다.'
		});
	});
});

describe('account-security-api failures', () => {
	it('returns status and message without a fallback flag', async () => {
		await expect(
			requestEmailVerificationCode({ email: 'a@example.com' }, respondJson(429, { message: 'Too many requests.' }))
		).resolves.toEqual({
			ok: false,
			status: 429,
			message: 'Too many requests.'
		});
		await expect(
			requestEmailVerificationCode({ email: 'a@example.com' }, respondJson(201, { email: 'a@example.com' }))
		).resolves.toEqual({
			ok: false,
			status: 201,
			message: 'Account API request failed with status 201.'
		});
		await expect(createRecoveryCodes(respondText(500, 'oops'))).resolves.toEqual({
			ok: false,
			status: 500,
			message: 'Account API request failed with status 500.'
		});
	});

	it('uses status 0 when the request cannot be made', async () => {
		await expect(requestEmailVerificationCode({ email: 'a@example.com' }, notAFetcher)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Account API is not available.'
		});
		await expect(requestEmailVerificationCode({ email: 'a@example.com' }, failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Email verification request could not be completed.'
		});
		await expect(revokeRecoveryCodes(notAFetcher)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Account API is not available.'
		});
		await expect(revokeRecoveryCodes(failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Recovery code request could not be completed.'
		});
	});
});

describe('passkey-management-api failures', () => {
	it('reads Better Auth errors from message, then error, then code', async () => {
		await expect(
			listUserPasskeys(respondJson(401, { message: 'Unauthorized', error: 'e', code: 'c' }))
		).resolves.toEqual({
			ok: false,
			status: 401,
			message: 'Unauthorized'
		});
		await expect(listUserPasskeys(respondJson(400, { message: 7, error: 'Bad request', code: 'c' }))).resolves.toEqual({
			ok: false,
			status: 400,
			message: 'Bad request'
		});
		await expect(updateUserPasskeyName('id', 'name', respondJson(404, { code: 'PASSKEY_NOT_FOUND' }))).resolves.toEqual(
			{
				ok: false,
				status: 404,
				message: 'PASSKEY_NOT_FOUND'
			}
		);
		// Unlike the other modules, a blank message string is returned as is.
		await expect(deleteUserPasskey('id', respondJson(400, { message: '', error: 'ignored' }))).resolves.toEqual({
			ok: false,
			status: 400,
			message: ''
		});
		await expect(deleteUserPasskey('id', respondText(500, 'oops'))).resolves.toEqual({
			ok: false,
			status: 500,
			message: 'Passkey API request failed with status 500.'
		});
	});

	it('uses status 0 when the request cannot be made', async () => {
		await expect(listUserPasskeys(notAFetcher)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Passkey API is not available.'
		});
		await expect(listUserPasskeys(failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Passkey list request could not be completed.'
		});
		await expect(updateUserPasskeyName('id', 'name', failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Passkey update request could not be completed.'
		});
		await expect(deleteUserPasskey('id', failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Passkey delete request could not be completed.'
		});
	});
});

describe('calendar-provider-api failures', () => {
	it('returns status and message', async () => {
		await expect(listCalendarProviders(respondJson(403, { message: 'Forbidden.' }))).resolves.toEqual({
			ok: false,
			status: 403,
			message: 'Forbidden.'
		});
		await expect(listCalendarProviders(respondText(500, 'oops'))).resolves.toEqual({
			ok: false,
			status: 500,
			message: 'Calendar provider API failed with status 500.'
		});
		await expect(deleteCalendarConnection('c1', respondJson(404, { message: '  ' }))).resolves.toEqual({
			ok: false,
			status: 404,
			message: 'Calendar provider API failed with status 404.'
		});
		await expect(syncCalendarProviders(respondJson(502, {}))).resolves.toEqual({
			ok: false,
			status: 502,
			message: 'Calendar sync failed with status 502.'
		});
	});

	it('uses status 0 when the request cannot be made', async () => {
		await expect(listCalendarProviders(notAFetcher)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Calendar provider API is not available.'
		});
		await expect(deleteCalendarConnection('c1', failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Calendar provider API request could not be completed.'
		});
		await expect(syncCalendarProviders(failNetwork)).resolves.toEqual({
			ok: false,
			status: 0,
			message: 'Calendar sync request could not be completed.'
		});
	});
});
