import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthUser } from '$lib/server/auth/session.js';
import {
	AccountSecurityConfigurationError,
	AccountSecurityPolicyError,
	assertAllowedAccountEmail,
	createPasskeyEmailVerification,
	createRecoveryCodesForUser,
	getRecoveryCodeSummaryForUser,
	revokeRecoveryCodesForUser
} from '$lib/server/auth/account-security.js';
import { CalendarTokenEncryptionError } from '$lib/server/calendar/oauth-encryption.js';
import { createCalendarSyncRedirect } from '$lib/server/calendar/oauth-status.js';
import {
	CalendarSyncError,
	completeCalendarProviderAuthorization,
	createCalendarProviderAuthorizationUrl,
	deleteCalendarProviderConnection,
	listCalendarProviderConnections,
	syncCalendarProvidersForConnectedUsers,
	syncCalendarProvidersForUser
} from '$lib/server/calendar/provider-sync.js';
import { CalendarProviderError } from '$lib/server/calendar/providers.js';
import {
	CalendarTokenConfigurationError,
	CalendarTokenLimitError,
	createCalendarTokenForUser,
	getCalendarTasksForToken,
	listCalendarTokensForUser,
	revokeCalendarTokenForUser
} from '$lib/server/calendar/tokens.js';
import * as boardProvisioning from '$lib/server/boards/board-provisioning.js';
import * as categoryRepository from '$lib/server/categories/repository.js';
import { assertRateLimit, assertVolatileRateLimit, RateLimitError } from '$lib/server/security/rate-limit.js';
import * as taskRepository from '$lib/server/tasks/repository.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';
import * as emailVerificationsRoute from './account/email-verifications/+server.js';
import * as recoveryCodesRoute from './account/recovery-codes/+server.js';
import * as boardPreferencesRoute from './board/preferences/+server.js';
import * as calendarFeedRoute from './calendar.ics/+server.js';
import * as providersRoute from './calendar/providers/+server.js';
import * as providerConnectionRoute from './calendar/providers/[connectionId]/+server.js';
import * as providerCallbackRoute from './calendar/providers/[provider]/callback/+server.js';
import * as providerConnectRoute from './calendar/providers/[provider]/connect/+server.js';
import * as subscriptionRoute from './calendar/subscriptions/[token].ics/+server.js';
import * as calendarSyncRoute from './calendar/sync/+server.js';
import * as calendarCronRoute from './calendar/sync/cron/+server.js';
import * as calendarTokensRoute from './calendar/tokens/+server.js';
import * as calendarTokenRoute from './calendar/tokens/[tokenId]/+server.js';
import * as categoriesRoute from './categories/+server.js';
import * as categoryRoute from './categories/[categoryId]/+server.js';
import * as categoryMergeRoute from './categories/[categoryId]/merge/+server.js';
import * as categoryReorderRoute from './categories/reorder/+server.js';
import * as exportRoute from './export/+server.js';
import * as importRoute from './import/+server.js';
import * as tasksRoute from './tasks/+server.js';
import * as taskRoute from './tasks/[taskId]/+server.js';
import * as checklistRoute from './tasks/[taskId]/checklist/+server.js';
import * as checklistItemRoute from './tasks/[taskId]/checklist/[itemId]/+server.js';

// The answers every API route gives today, pinned before the routes share
// their error and body handling: each status, message and header, which
// errors a route answers and which it lets through as a 500, and how each
// route reads its body. The data modules are mocked; the error classes are
// the real ones.

const authState = vi.hoisted(() => ({
	databaseConfigured: true,
	configurationError: /** @type {string | null} */ (null)
}));

vi.mock('$lib/server/auth/index.js', () => ({
	get authDatabaseConfigured() {
		return authState.databaseConfigured;
	},
	get authConfigurationError() {
		return authState.configurationError;
	}
}));

vi.mock('$lib/server/auth/session.js', () => ({
	requireAuthUser: vi.fn()
}));

vi.mock('$lib/server/security/rate-limit-guard.js', () => ({
	enforceTaskWriteRateLimit: vi.fn(),
	enforceImportRateLimit: vi.fn()
}));

vi.mock('$lib/server/tasks/repository.js', () => ({
	createTaskForUser: vi.fn(),
	deleteTaskCascadeForUser: vi.fn(),
	listTasksForBoard: vi.fn(),
	listTasksForUser: vi.fn(),
	updateTaskForUser: vi.fn(),
	createChecklistItemForUser: vi.fn(),
	deleteChecklistItemForUser: vi.fn(),
	updateChecklistItemForUser: vi.fn(),
	importTasksForUser: vi.fn(),
	replaceTasksForUser: vi.fn()
}));

vi.mock('$lib/server/boards/board-provisioning.js', () => ({
	ensurePersonalBoardForUser: vi.fn(),
	getBoardPreferencesForUser: vi.fn(),
	updateBoardPreferencesForUser: vi.fn()
}));

vi.mock('$lib/server/categories/repository.js', () => ({
	listCategoriesForUser: vi.fn(),
	createCategoryForUser: vi.fn(),
	updateCategoryForUser: vi.fn(),
	deleteCategoryForUser: vi.fn(),
	mergeCategoryForUser: vi.fn(),
	reorderCategoriesForUser: vi.fn()
}));

vi.mock('$lib/server/auth/account-security.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertAllowedAccountEmail: vi.fn(),
	createPasskeyEmailVerification: vi.fn(),
	createRecoveryCodesForUser: vi.fn(),
	getRecoveryCodeSummaryForUser: vi.fn(),
	revokeRecoveryCodesForUser: vi.fn()
}));

vi.mock('$lib/server/calendar/tokens.js', async (importOriginal) => ({
	...(await importOriginal()),
	createCalendarTokenForUser: vi.fn(),
	getCalendarTasksForToken: vi.fn(),
	listCalendarTokensForUser: vi.fn(),
	revokeCalendarTokenForUser: vi.fn()
}));

vi.mock('$lib/server/calendar/provider-sync.js', async (importOriginal) => ({
	...(await importOriginal()),
	completeCalendarProviderAuthorization: vi.fn(),
	createCalendarProviderAuthorizationUrl: vi.fn(),
	deleteCalendarProviderConnection: vi.fn(),
	listCalendarProviderConnections: vi.fn(),
	syncCalendarProvidersForConnectedUsers: vi.fn(),
	syncCalendarProvidersForUser: vi.fn()
}));

vi.mock('$lib/server/security/rate-limit.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertRateLimit: vi.fn(),
	assertVolatileRateLimit: vi.fn()
}));

const CLIENT_IP = '203.0.113.7';
const USER_ID = 'user-id';
const CRON_SECRET = 'cron-secret-with-enough-length';
const FEED_TOKEN = `cal_${'a'.repeat(43)}`;
const INVALID_JSON = { message: 'Request body must be valid JSON.' };
const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * A request event as SvelteKit hands it to a handler.
 * @param {string} method
 * @param {{ path?: string; body?: string; headers?: Record<string, string>; params?: Record<string, string> }} [init]
 */
function createEvent(method, { path = '/api', body, headers = {}, params = {} } = {}) {
	const url = new URL(path, 'https://todo.example.com');
	return /** @type {any} */ ({
		params: {
			taskId: '11111111-1111-4111-8111-111111111111',
			itemId: '22222222-2222-4222-8222-222222222222',
			categoryId: '33333333-3333-4333-8333-333333333333',
			connectionId: 'connection-id',
			tokenId: 'token-id',
			provider: 'google',
			token: FEED_TOKEN,
			...params
		},
		url,
		request: new Request(url, { method, headers, body }),
		getClientAddress: () => CLIENT_IP
	});
}

/**
 * Checks a JSON answer whole: status, body and every header.
 * @param {Response} response
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers] the headers besides content-type and content-length
 */
async function expectJson(response, status, body, headers = {}) {
	const text = await response.text();
	expect({
		status: response.status,
		body: JSON.parse(text),
		headers: Object.fromEntries(response.headers)
	}).toEqual({
		status,
		body,
		headers: {
			'content-type': 'application/json',
			'content-length': String(new TextEncoder().encode(text).byteLength),
			...headers
		}
	});
}

/**
 * Checks a plain-text answer whole: status, body and every header.
 * @param {Response} response
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} [headers] the headers besides content-type
 */
async function expectText(response, status, body, headers = {}) {
	expect({
		status: response.status,
		body: await response.text(),
		headers: Object.fromEntries(response.headers)
	}).toEqual({
		status,
		body,
		headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers }
	});
}

/** @param {unknown} body */
const jsonBody = (body) => JSON.stringify(body);

/**
 * Each handler, called the way its route is used. Handlers that read a body
 * take it as a string.
 * @type {Record<string, (body?: string) => Response | Promise<Response>>}
 */
const call = {
	'GET /api/tasks': () => tasksRoute.GET(createEvent('GET')),
	'POST /api/tasks': (body = jsonBody({ text: 'Task' })) => tasksRoute.POST(createEvent('POST', { body })),
	'PATCH /api/tasks/[taskId]': (body = jsonBody({ text: 'Task' })) => taskRoute.PATCH(createEvent('PATCH', { body })),
	'DELETE /api/tasks/[taskId]': (body) => taskRoute.DELETE(createEvent('DELETE', { body })),
	'POST /api/tasks/[taskId]/checklist': (body = jsonBody({ text: 'Item' })) => checklistRoute.POST(createEvent('POST', { body })),
	'PATCH /api/tasks/[taskId]/checklist/[itemId]': (body = jsonBody({ done: true })) => checklistItemRoute.PATCH(createEvent('PATCH', { body })),
	'DELETE /api/tasks/[taskId]/checklist/[itemId]': () => checklistItemRoute.DELETE(createEvent('DELETE')),
	'POST /api/import': (body = '[]') => importRoute.POST(createEvent('POST', { path: '/api/import', body })),
	'POST /api/import?mode=replace': (body = '[]') => importRoute.POST(createEvent('POST', { path: '/api/import?mode=replace', body })),
	'GET /api/export': () => exportRoute.GET(createEvent('GET')),
	'GET /api/categories': () => categoriesRoute.GET(createEvent('GET')),
	'POST /api/categories': (body = jsonBody({ name: 'Work' })) => categoriesRoute.POST(createEvent('POST', { body })),
	'PATCH /api/categories/[categoryId]': (body = jsonBody({ name: 'Work' })) => categoryRoute.PATCH(createEvent('PATCH', { body })),
	'DELETE /api/categories/[categoryId]': () => categoryRoute.DELETE(createEvent('DELETE')),
	'POST /api/categories/[categoryId]/merge': (body = jsonBody({ targetCategoryId: 'x' })) => categoryMergeRoute.POST(createEvent('POST', { body })),
	'POST /api/categories/reorder': (body = jsonBody({ categoryIds: ['x'] })) => categoryReorderRoute.POST(createEvent('POST', { body })),
	'GET /api/board/preferences': () => boardPreferencesRoute.GET(createEvent('GET')),
	'PATCH /api/board/preferences': (body = jsonBody({ defaultView: 'gantt' })) => boardPreferencesRoute.PATCH(createEvent('PATCH', { body })),
	'GET /api/account/recovery-codes': () => recoveryCodesRoute.GET(createEvent('GET')),
	'POST /api/account/recovery-codes': () => recoveryCodesRoute.POST(createEvent('POST')),
	'DELETE /api/account/recovery-codes': () => recoveryCodesRoute.DELETE(createEvent('DELETE')),
	'POST /api/account/email-verifications': (body = jsonBody({ email: 'Primary@Example.com', name: 'User' })) =>
		emailVerificationsRoute.POST(createEvent('POST', { body })),
	'GET /api/calendar.ics': () => calendarFeedRoute.GET(createEvent('GET')),
	'GET /api/calendar/providers': () => providersRoute.GET(createEvent('GET')),
	'DELETE /api/calendar/providers/[connectionId]': () => providerConnectionRoute.DELETE(createEvent('DELETE')),
	'GET /api/calendar/providers/[provider]/connect': () => providerConnectRoute.GET(createEvent('GET')),
	'GET /api/calendar/providers/[provider]/callback': () =>
		providerCallbackRoute.GET(createEvent('GET', { path: '/api/calendar/providers/google/callback?code=code&state=state' })),
	'POST /api/calendar/sync': () => calendarSyncRoute.POST(createEvent('POST')),
	'GET /api/calendar/sync/cron': () =>
		calendarCronRoute.GET(createEvent('GET', { headers: { authorization: `Bearer ${CRON_SECRET}` } })),
	'POST /api/calendar/sync/cron': () =>
		calendarCronRoute.POST(createEvent('POST', { headers: { 'x-cron-secret': CRON_SECRET } })),
	'GET /api/calendar/tokens': () => calendarTokensRoute.GET(createEvent('GET')),
	'POST /api/calendar/tokens': (body = jsonBody({ name: 'Feed' })) => calendarTokensRoute.POST(createEvent('POST', { body })),
	'DELETE /api/calendar/tokens/[tokenId]': () => calendarTokenRoute.DELETE(createEvent('DELETE')),
	'GET /api/calendar/subscriptions/[token].ics': () => subscriptionRoute.GET(createEvent('GET'))
};

/** The routes that answer only a signed-in user, through requireAuthUser. */
const AUTHENTICATED = Object.keys(call).filter((name) =>
	!name.startsWith('POST /api/account/email-verifications')
	&& !name.includes('/cron')
	&& !name.includes('/subscriptions/')
);

/** The routes that read a JSON body and answer 400 when it does not parse. */
const JSON_BODY = [
	'POST /api/tasks',
	'PATCH /api/tasks/[taskId]',
	'DELETE /api/tasks/[taskId]',
	'POST /api/tasks/[taskId]/checklist',
	'PATCH /api/tasks/[taskId]/checklist/[itemId]',
	'POST /api/import',
	'POST /api/categories',
	'PATCH /api/categories/[categoryId]',
	'POST /api/categories/[categoryId]/merge',
	'POST /api/categories/reorder',
	'PATCH /api/board/preferences',
	'POST /api/account/email-verifications'
];

/**
 * The data function behind each route of the task write API, which answers
 * a TaskWriteError with its status and message.
 * @type {Array<[string, import('vitest').Mock]>}
 */
const TASK_WRITES = [
	['POST /api/tasks', vi.mocked(taskRepository.createTaskForUser)],
	['PATCH /api/tasks/[taskId]', vi.mocked(taskRepository.updateTaskForUser)],
	['DELETE /api/tasks/[taskId]', vi.mocked(taskRepository.deleteTaskCascadeForUser)],
	['POST /api/tasks/[taskId]/checklist', vi.mocked(taskRepository.createChecklistItemForUser)],
	['PATCH /api/tasks/[taskId]/checklist/[itemId]', vi.mocked(taskRepository.updateChecklistItemForUser)],
	['DELETE /api/tasks/[taskId]/checklist/[itemId]', vi.mocked(taskRepository.deleteChecklistItemForUser)],
	['POST /api/import', vi.mocked(taskRepository.importTasksForUser)],
	['POST /api/import?mode=replace', vi.mocked(taskRepository.replaceTasksForUser)],
	['POST /api/categories', vi.mocked(categoryRepository.createCategoryForUser)],
	['PATCH /api/categories/[categoryId]', vi.mocked(categoryRepository.updateCategoryForUser)],
	['DELETE /api/categories/[categoryId]', vi.mocked(categoryRepository.deleteCategoryForUser)],
	['POST /api/categories/[categoryId]/merge', vi.mocked(categoryRepository.mergeCategoryForUser)],
	['POST /api/categories/reorder', vi.mocked(categoryRepository.reorderCategoriesForUser)],
	['PATCH /api/board/preferences', vi.mocked(boardProvisioning.updateBoardPreferencesForUser)]
];

/** Every mocked data function, to check a refused request reached none. */
const DATA_FUNCTIONS = [
	...Object.values(taskRepository),
	...Object.values(boardProvisioning),
	...Object.values(categoryRepository),
	assertAllowedAccountEmail,
	createPasskeyEmailVerification,
	createRecoveryCodesForUser,
	getRecoveryCodeSummaryForUser,
	revokeRecoveryCodesForUser,
	completeCalendarProviderAuthorization,
	createCalendarProviderAuthorizationUrl,
	deleteCalendarProviderConnection,
	listCalendarProviderConnections,
	syncCalendarProvidersForConnectedUsers,
	syncCalendarProvidersForUser,
	createCalendarTokenForUser,
	getCalendarTasksForToken,
	listCalendarTokensForUser,
	revokeCalendarTokenForUser
];

const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
	if (originalCronSecret === undefined) {
		delete process.env.CRON_SECRET;
	} else {
		process.env.CRON_SECRET = originalCronSecret;
	}
});

beforeEach(() => {
	vi.resetAllMocks();
	authState.databaseConfigured = true;
	authState.configurationError = null;
	process.env.CRON_SECRET = CRON_SECRET;
	vi.mocked(requireAuthUser).mockResolvedValue({
		ok: true,
		user: { id: USER_ID },
		session: { id: 'session-id' }
	});
});

describe('signed-out requests', () => {
	it.each(AUTHENTICATED)('%s answers with the response requireAuthUser gives', async (name) => {
		const refusal = Response.json({ message: 'Authentication required.' }, { status: 401 });
		vi.mocked(requireAuthUser).mockResolvedValue({ ok: false, response: refusal });

		expect(await call[name]()).toBe(refusal);
		for (const dataFunction of DATA_FUNCTIONS) {
			expect(dataFunction).not.toHaveBeenCalled();
		}
	});

	it('requireAuthUser answers 503, 500 and 401 with a message', async () => {
		/** @type {typeof import('$lib/server/auth/session.js')} */
		const session = await vi.importActual('$lib/server/auth/session.js');
		const request = new Request('https://todo.example.com/api/tasks');

		authState.databaseConfigured = false;
		let result = await session.requireAuthUser(request);
		expect(result.ok).toBe(false);
		expect(result.ok || [result.response.status, await result.response.json()]).toEqual([503, { message: 'Auth service unavailable.' }]);

		authState.databaseConfigured = true;
		authState.configurationError = 'BETTER_AUTH_SECRET is missing.';
		result = await session.requireAuthUser(request);
		expect(result.ok || [result.response.status, await result.response.json()]).toEqual([500, { message: 'Auth service unavailable.' }]);
	});
});

describe('request bodies', () => {
	it.each(JSON_BODY)('%s answers 400 to a body that is not JSON', async (name) => {
		await expectJson(await call[name]('{'), 400, INVALID_JSON);
		for (const dataFunction of DATA_FUNCTIONS) {
			expect(dataFunction).not.toHaveBeenCalled();
		}
	});

	it('DELETE /api/tasks/[taskId] takes an empty or blank body as no payload', async () => {
		vi.mocked(taskRepository.deleteTaskCascadeForUser).mockResolvedValue(1);

		await expectJson(await call['DELETE /api/tasks/[taskId]'](), 200, { deleted: 1 });
		await expectJson(await call['DELETE /api/tasks/[taskId]'](' \n '), 200, { deleted: 1 });
		await expectJson(await call['DELETE /api/tasks/[taskId]']('{"expectedVersion":3}'), 200, { deleted: 1 });

		expect(vi.mocked(taskRepository.deleteTaskCascadeForUser).mock.calls.map((args) => args[2]))
			.toEqual([undefined, undefined, { expectedVersion: 3 }]);
	});

	it('POST /api/tasks answers 400 to an empty body and passes a JSON null through', async () => {
		vi.mocked(taskRepository.createTaskForUser).mockResolvedValue(/** @type {any} */ ({ id: 'task-id' }));

		await expectJson(await tasksRoute.POST(createEvent('POST')), 400, INVALID_JSON);
		await expectJson(await call['POST /api/tasks']('null'), 201, { task: { id: 'task-id' } });
		expect(taskRepository.createTaskForUser).toHaveBeenCalledWith(USER_ID, null);
	});

	it('POST /api/calendar/tokens takes a body that is not JSON, or none, as {}', async () => {
		vi.mocked(createCalendarTokenForUser).mockResolvedValue(/** @type {any} */ ({ token: 'cal_token' }));

		await expectJson(await call['POST /api/calendar/tokens']('{'), 201, { token: 'cal_token' }, NO_STORE);
		await expectJson(await calendarTokensRoute.POST(createEvent('POST')), 201, { token: 'cal_token' }, NO_STORE);
		await expectJson(await call['POST /api/calendar/tokens']('null'), 201, { token: 'cal_token' }, NO_STORE);

		expect(vi.mocked(createCalendarTokenForUser).mock.calls.map((args) => args[1])).toEqual([{}, {}, null]);
	});

	it('POST /api/import answers 413 to a body over 5 MB, by its declared length or by its text', async () => {
		const tooLarge = { message: 'Import payload is too large.' };
		await expectJson(await importRoute.POST(createEvent('POST', {
			path: '/api/import',
			body: '[]',
			headers: { 'content-length': String(5 * 1024 * 1024 + 1) }
		})), 413, tooLarge);
		await expectJson(await call['POST /api/import'](`[${' '.repeat(5 * 1024 * 1024)}]`), 413, tooLarge);

		// Exactly 5 MB is allowed.
		vi.mocked(taskRepository.importTasksForUser).mockResolvedValue(/** @type {any} */ ({ tasks: [] }));
		await expectJson(await call['POST /api/import'](`[${' '.repeat(5 * 1024 * 1024 - 2)}]`), 201, { tasks: [] }, NO_STORE);
		expect(taskRepository.importTasksForUser).toHaveBeenCalledTimes(1);
	});

	it('POST /api/account/email-verifications answers 413 to a declared length over 10,000 bytes', async () => {
		await expectJson(await emailVerificationsRoute.POST(createEvent('POST', {
			body: jsonBody({ email: 'primary@example.com' }),
			headers: { 'content-length': '10001' }
		})), 413, { message: 'Request body is too large.' });
		expect(createPasskeyEmailVerification).not.toHaveBeenCalled();
	});
});

describe('the task write API', () => {
	it.each(TASK_WRITES)('%s answers a TaskWriteError with its status and message', async (name, dataFunction) => {
		dataFunction.mockRejectedValue(new TaskWriteError('Task changed on another device. Sync and try again.', 409));
		await expectJson(await call[name](), 409, { message: 'Task changed on another device. Sync and try again.' });

		dataFunction.mockRejectedValue(new TaskWriteError('Category was not found.', 404));
		await expectJson(await call[name](), 404, { message: 'Category was not found.' });

		dataFunction.mockRejectedValue(new TaskWriteError('Task payload must be an object.'));
		await expectJson(await call[name](), 400, { message: 'Task payload must be an object.' });
	});

	it.each(TASK_WRITES)('%s lets any other error through', async (name, dataFunction) => {
		const failure = new Error('connection reset');
		dataFunction.mockRejectedValue(failure);
		await expect(call[name]()).rejects.toBe(failure);
	});

	it.each([
		['GET /api/tasks', vi.mocked(taskRepository.listTasksForUser)],
		['GET /api/export', vi.mocked(taskRepository.listTasksForUser)],
		['GET /api/categories', vi.mocked(categoryRepository.listCategoriesForUser)],
		['GET /api/board/preferences', vi.mocked(boardProvisioning.getBoardPreferencesForUser)],
		['GET /api/calendar.ics', vi.mocked(taskRepository.listTasksForUser)]
	])('%s lets even a TaskWriteError through', async (name, dataFunction) => {
		const failure = new TaskWriteError('A default workspace board could not be created.', 500);
		dataFunction.mockRejectedValue(failure);
		await expect(call[name]()).rejects.toBe(failure);
	});

	it.each([
		['GET /api/tasks', () => vi.mocked(taskRepository.listTasksForUser).mockResolvedValue([]), 200, { tasks: [] }, {}],
		['POST /api/tasks', () => vi.mocked(taskRepository.createTaskForUser).mockResolvedValue(/** @type {any} */ ({ id: 't' })), 201, { task: { id: 't' } }, {}],
		['PATCH /api/tasks/[taskId]', () => vi.mocked(taskRepository.updateTaskForUser).mockResolvedValue(/** @type {any} */ ({ id: 't' })), 200, { task: { id: 't' } }, {}],
		['DELETE /api/tasks/[taskId]', () => vi.mocked(taskRepository.deleteTaskCascadeForUser).mockResolvedValue(2), 200, { deleted: 2 }, {}],
		['POST /api/tasks/[taskId]/checklist', () => vi.mocked(taskRepository.createChecklistItemForUser).mockResolvedValue(/** @type {any} */ ({ id: 't' })), 201, { task: { id: 't' } }, {}],
		['PATCH /api/tasks/[taskId]/checklist/[itemId]', () => vi.mocked(taskRepository.updateChecklistItemForUser).mockResolvedValue(/** @type {any} */ ({ id: 't' })), 200, { task: { id: 't' } }, {}],
		['DELETE /api/tasks/[taskId]/checklist/[itemId]', () => vi.mocked(taskRepository.deleteChecklistItemForUser).mockResolvedValue(/** @type {any} */ ({ id: 't' })), 200, { task: { id: 't' } }, {}],
		['POST /api/import', () => vi.mocked(taskRepository.importTasksForUser).mockResolvedValue(/** @type {any} */ ({ tasks: [] })), 201, { tasks: [] }, NO_STORE],
		['POST /api/import?mode=replace', () => vi.mocked(taskRepository.replaceTasksForUser).mockResolvedValue(/** @type {any} */ ({ tasks: [] })), 201, { tasks: [] }, NO_STORE],
		['GET /api/categories', () => vi.mocked(categoryRepository.listCategoriesForUser).mockResolvedValue([]), 200, { categories: [] }, NO_STORE],
		['POST /api/categories', () => vi.mocked(categoryRepository.createCategoryForUser).mockResolvedValue(/** @type {any} */ ({ id: 'c' })), 201, { category: { id: 'c' } }, {}],
		['PATCH /api/categories/[categoryId]', () => vi.mocked(categoryRepository.updateCategoryForUser).mockResolvedValue(/** @type {any} */ ({ category: { id: 'c' } })), 200, { category: { id: 'c' } }, {}],
		['DELETE /api/categories/[categoryId]', () => vi.mocked(categoryRepository.deleteCategoryForUser).mockResolvedValue(/** @type {any} */ ({ deleted: true })), 200, { deleted: true }, {}],
		['POST /api/categories/[categoryId]/merge', () => vi.mocked(categoryRepository.mergeCategoryForUser).mockResolvedValue(/** @type {any} */ ({ merged: 1 })), 200, { merged: 1 }, {}],
		['POST /api/categories/reorder', () => vi.mocked(categoryRepository.reorderCategoriesForUser).mockResolvedValue([]), 200, { categories: [] }, {}],
		['GET /api/board/preferences', () => vi.mocked(boardProvisioning.getBoardPreferencesForUser).mockResolvedValue({ defaultView: 'matrix' }), 200, { defaultView: 'matrix' }, {}],
		['PATCH /api/board/preferences', () => vi.mocked(boardProvisioning.updateBoardPreferencesForUser).mockResolvedValue({ defaultView: 'gantt' }), 200, { defaultView: 'gantt' }, {}]
	])('%s answers %i on success', async (name, arrange, status, body, headers) => {
		arrange();
		await expectJson(await call[name](), status, body, headers);
	});

	it('GET /api/export answers the task list as a dated attachment', async () => {
		vi.useFakeTimers({ now: new Date('2026-09-26T12:00:00.000Z'), toFake: ['Date'] });
		try {
			vi.mocked(taskRepository.listTasksForUser).mockResolvedValue([]);
			await expectJson(await call['GET /api/export'](), 200, [], {
				'content-disposition': 'attachment; filename="todolist_backup_2026-09-26.json"',
				...NO_STORE
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('GET /api/calendar.ics answers the tasks as an iCalendar attachment', async () => {
		vi.mocked(taskRepository.listTasksForUser).mockResolvedValue([]);
		const response = await call['GET /api/calendar.ics']();

		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toEqual({
			'content-type': 'text/calendar;charset=utf-8',
			'content-disposition': 'attachment; filename="todolist_calendar.ics"',
			...NO_STORE
		});
		expect(await response.text()).toContain('BEGIN:VCALENDAR');
	});
});

describe('account routes', () => {
	const SUMMARY = { total: 10, available: 9, lastCreatedAt: '2026-09-26T00:00:00.000Z' };

	it.each([
		['GET /api/account/recovery-codes', () => vi.mocked(getRecoveryCodeSummaryForUser).mockResolvedValue(SUMMARY), 200, SUMMARY],
		['POST /api/account/recovery-codes', () => vi.mocked(createRecoveryCodesForUser).mockResolvedValue({ codes: ['A'], summary: SUMMARY }), 201, { codes: ['A'], summary: SUMMARY }],
		['DELETE /api/account/recovery-codes', () => vi.mocked(revokeRecoveryCodesForUser).mockResolvedValue(SUMMARY), 200, SUMMARY]
	])('%s answers %i with no-store on success', async (name, arrange, status, body) => {
		arrange();
		await expectJson(await call[name](), status, body, NO_STORE);
	});

	it.each([
		['POST /api/account/recovery-codes', 'recovery-code-create', 3, 'Too many recovery code regeneration requests.', vi.mocked(createRecoveryCodesForUser)],
		['DELETE /api/account/recovery-codes', 'recovery-code-revoke', 6, 'Too many recovery code revoke requests.', vi.mocked(revokeRecoveryCodesForUser)]
	])('%s keys its limit on the IP and user and answers 429 with Retry-After', async (name, scope, limit, message, dataFunction) => {
		vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitError(message, 1800));

		await expectJson(await call[name](), 429, { message }, { 'retry-after': '1800' });
		expect(assertRateLimit).toHaveBeenCalledWith(`${scope}:${CLIENT_IP}:${USER_ID}`, {
			limit,
			windowMs: 60 * 60 * 1000,
			message
		});
		expect(dataFunction).not.toHaveBeenCalled();
	});

	it.each([
		['POST /api/account/recovery-codes', vi.mocked(createRecoveryCodesForUser)],
		['DELETE /api/account/recovery-codes', vi.mocked(revokeRecoveryCodesForUser)]
	])('%s lets a missing recovery secret and any other error through', async (name, dataFunction) => {
		const unconfigured = new AccountSecurityConfigurationError('ACCOUNT_RECOVERY_SECRET or BETTER_AUTH_SECRET must be configured before account recovery can be used.');
		dataFunction.mockRejectedValue(unconfigured);
		await expect(call[name]()).rejects.toBe(unconfigured);

		const failure = new Error('connection reset');
		dataFunction.mockRejectedValue(failure);
		await expect(call[name]()).rejects.toBe(failure);
	});

	describe('POST /api/account/email-verifications', () => {
		const send = call['POST /api/account/email-verifications'];

		it('answers 503 and 500 while the auth service is unavailable', async () => {
			authState.databaseConfigured = false;
			await expectJson(await send(), 503, { message: 'Auth service unavailable.' });

			authState.databaseConfigured = true;
			authState.configurationError = 'BETTER_AUTH_SECRET is missing.';
			await expectJson(await send(), 500, { message: 'Auth service unavailable.' });
			expect(assertRateLimit).not.toHaveBeenCalled();
		});

		it('checks the IP limit, then the IP and email limit, then sends the code', async () => {
			vi.mocked(createPasskeyEmailVerification).mockResolvedValue({ email: 'primary@example.com', expiresAt: '2026-09-26T00:15:00.000Z' });

			await expectJson(await send(), 201, { email: 'primary@example.com', expiresAt: '2026-09-26T00:15:00.000Z' }, NO_STORE);
			expect(vi.mocked(assertRateLimit).mock.calls).toEqual([
				[`email-verification-ip:${CLIENT_IP}:`, { limit: 20, windowMs: 15 * 60 * 1000, message: 'Too many email verification requests.' }],
				[`email-verification-send:${CLIENT_IP}:primary@example.com`, { limit: 5, windowMs: 15 * 60 * 1000, message: 'Too many email verification requests.' }]
			]);
			expect(createPasskeyEmailVerification).toHaveBeenCalledWith({ email: 'primary@example.com', name: 'User' });
		});

		it('answers 429 with Retry-After once a limit is spent', async () => {
			vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitError('Too many email verification requests.', 600));
			await expectJson(await send(), 429, { message: 'Too many email verification requests.' }, { 'retry-after': '600' });
			expect(createPasskeyEmailVerification).not.toHaveBeenCalled();
		});

		it('answers a delivery or configuration failure with a generic 503', async () => {
			vi.mocked(createPasskeyEmailVerification).mockRejectedValue(new AccountSecurityConfigurationError('Email verification delivery failed.'));
			await expectJson(await send(), 503, { message: 'Auth service unavailable.' });
		});

		it('answers an invalid or refused email as if it sent a code', async () => {
			const accepted = { email: 'primary@example.com', expiresAt: expect.any(String) };

			await expectJson(await send(jsonBody({ email: 'not-an-email' })), 201, { ...accepted, email: 'not-an-email' }, NO_STORE);

			vi.mocked(assertAllowedAccountEmail).mockImplementation(() => {
				throw new AccountSecurityPolicyError('This email is not allowed to create an account.');
			});
			await expectJson(await send(), 201, accepted, NO_STORE);

			vi.mocked(assertAllowedAccountEmail).mockReset();
			vi.mocked(createPasskeyEmailVerification).mockRejectedValue(new AccountSecurityPolicyError('This email is not allowed to create an account.'));
			await expectJson(await send(), 201, accepted, NO_STORE);
			expect(createPasskeyEmailVerification).toHaveBeenCalledTimes(1);
		});

		it('lets any other error through', async () => {
			const failure = new Error('connection reset');
			vi.mocked(createPasskeyEmailVerification).mockRejectedValue(failure);
			await expect(send()).rejects.toBe(failure);
		});
	});
});

describe('calendar routes', () => {
	const syncErrors = () => [
		new CalendarSyncError('Calendar sync is already running for this user.', 409),
		new CalendarProviderError('Google Calendar request failed.', 502),
		new CalendarTokenEncryptionError('CALENDAR_OAUTH_ENCRYPTION_KEY must be configured.')
	];

	it.each([
		['GET /api/calendar/providers', () => vi.mocked(listCalendarProviderConnections).mockResolvedValue(/** @type {any} */ ({ providers: [] })), 200, { providers: [] }],
		['DELETE /api/calendar/providers/[connectionId]', () => vi.mocked(deleteCalendarProviderConnection).mockResolvedValue('connection-id'), 200, { deleted: 'connection-id' }],
		['POST /api/calendar/sync', () => vi.mocked(syncCalendarProvidersForUser).mockResolvedValue(/** @type {any} */ ({ ok: true })), 200, { ok: true }],
		['GET /api/calendar/sync/cron', () => vi.mocked(syncCalendarProvidersForConnectedUsers).mockResolvedValue(/** @type {any} */ ({ ok: true })), 200, { ok: true }],
		['POST /api/calendar/sync/cron', () => vi.mocked(syncCalendarProvidersForConnectedUsers).mockResolvedValue(/** @type {any} */ ({ ok: true })), 200, { ok: true }],
		['GET /api/calendar/tokens', () => vi.mocked(listCalendarTokensForUser).mockResolvedValue([]), 200, { tokens: [] }],
		['POST /api/calendar/tokens', () => vi.mocked(createCalendarTokenForUser).mockResolvedValue(/** @type {any} */ ({ token: 'cal_token' })), 201, { token: 'cal_token' }],
		['DELETE /api/calendar/tokens/[tokenId]', () => vi.mocked(revokeCalendarTokenForUser).mockResolvedValue(null), 200, { token: null }]
	])('%s answers %i with no-store on success', async (name, arrange, status, body) => {
		arrange();
		await expectJson(await call[name](), status, body, NO_STORE);
	});

	it('DELETE /api/calendar/providers/[connectionId] answers a CalendarSyncError and lets the rest through', async () => {
		vi.mocked(deleteCalendarProviderConnection).mockRejectedValue(new CalendarSyncError('Calendar connection was not found.', 404));
		await expectJson(await call['DELETE /api/calendar/providers/[connectionId]'](), 404, { message: 'Calendar connection was not found.' });

		for (const failure of [new CalendarProviderError('Google Calendar request failed.', 502), new Error('connection reset')]) {
			vi.mocked(deleteCalendarProviderConnection).mockRejectedValue(failure);
			await expect(call['DELETE /api/calendar/providers/[connectionId]']()).rejects.toBe(failure);
		}
	});

	it('POST /api/calendar/sync keys its limit on the IP and user and answers 429 with Retry-After', async () => {
		vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitError('Calendar sync is cooling down.', 900));

		await expectJson(await call['POST /api/calendar/sync'](), 429, { message: 'Calendar sync is cooling down.' }, { 'retry-after': '900' });
		expect(assertRateLimit).toHaveBeenCalledWith(`calendar-sync:${CLIENT_IP}:${USER_ID}`, {
			limit: 6,
			windowMs: 60 * 60 * 1000,
			message: 'Calendar sync is cooling down.'
		});
		expect(syncCalendarProvidersForUser).not.toHaveBeenCalled();
	});

	it.each(['POST /api/calendar/sync', 'GET /api/calendar/sync/cron'])('%s answers the calendar sync errors with their status', async (name) => {
		const dataFunction = name.includes('cron') ? syncCalendarProvidersForConnectedUsers : syncCalendarProvidersForUser;
		for (const error of syncErrors()) {
			vi.mocked(dataFunction).mockRejectedValue(error);
			await expectJson(await call[name](), error.status, { message: error.message });
		}
		expect(syncErrors().map((error) => error.status)).toEqual([409, 502, 503]);

		for (const failure of [new TaskWriteError('A default workspace board could not be created.', 500), new Error('connection reset')]) {
			vi.mocked(dataFunction).mockRejectedValue(failure);
			await expect(call[name]()).rejects.toBe(failure);
		}
	});

	it('GET /api/calendar/sync/cron answers 503 without a secret and 401 to a wrong one', async () => {
		delete process.env.CRON_SECRET;
		await expectJson(await call['GET /api/calendar/sync/cron'](), 503, { message: 'CRON_SECRET is required before background calendar sync can run.' });

		process.env.CRON_SECRET = CRON_SECRET;
		const wrong = createEvent('GET', { headers: { authorization: 'Bearer cron-secret-with-enough-lengtH', 'x-cron-secret': 'short' } });
		await expectJson(await calendarCronRoute.GET(wrong), 401, { message: 'Calendar sync cron authentication failed.' });
		expect(syncCalendarProvidersForConnectedUsers).not.toHaveBeenCalled();
	});

	it('GET and DELETE on the calendar tokens answer a missing token secret with 503', async () => {
		const unconfigured = new CalendarTokenConfigurationError();
		vi.mocked(listCalendarTokensForUser).mockRejectedValue(unconfigured);
		vi.mocked(revokeCalendarTokenForUser).mockRejectedValue(unconfigured);

		for (const name of ['GET /api/calendar/tokens', 'DELETE /api/calendar/tokens/[tokenId]']) {
			await expectJson(await call[name](), 503, {
				message: 'CALENDAR_TOKEN_SECRET must be configured before calendar subscription tokens can be used.'
			});
		}

		for (const failure of [new CalendarTokenLimitError('limit'), new Error('connection reset')]) {
			vi.mocked(listCalendarTokensForUser).mockRejectedValue(failure);
			vi.mocked(revokeCalendarTokenForUser).mockRejectedValue(failure);
			await expect(call['GET /api/calendar/tokens']()).rejects.toBe(failure);
			await expect(call['DELETE /api/calendar/tokens/[tokenId]']()).rejects.toBe(failure);
		}
	});

	it('POST /api/calendar/tokens answers its limit, a missing secret and the token cap', async () => {
		const create = call['POST /api/calendar/tokens'];
		vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitError('Too many calendar feed token creation requests.', 3600));
		await expectJson(await create(), 429, { message: 'Too many calendar feed token creation requests.' }, { 'retry-after': '3600' });
		expect(assertRateLimit).toHaveBeenCalledWith(`calendar-token-create:${CLIENT_IP}:${USER_ID}`, {
			limit: 5,
			windowMs: 60 * 60 * 1000,
			message: 'Too many calendar feed token creation requests.'
		});
		expect(createCalendarTokenForUser).not.toHaveBeenCalled();

		vi.mocked(createCalendarTokenForUser).mockRejectedValue(new CalendarTokenConfigurationError());
		await expectJson(await create(), 503, { message: 'CALENDAR_TOKEN_SECRET must be configured before calendar subscription tokens can be used.' });

		vi.mocked(createCalendarTokenForUser).mockRejectedValue(new CalendarTokenLimitError('Calendar feeds are limited to 5 active tokens per user.'));
		await expectJson(await create(), 429, { message: 'Calendar feeds are limited to 5 active tokens per user.' });

		for (const failure of [new TaskWriteError('A default workspace board could not be created.', 500), new Error('connection reset')]) {
			vi.mocked(createCalendarTokenForUser).mockRejectedValue(failure);
			await expect(create()).rejects.toBe(failure);
		}
	});

	describe('GET /api/calendar/subscriptions/[token].ics', () => {
		it('answers a token of the wrong shape and an unknown token with 404', async () => {
			await expectText(await subscriptionRoute.GET(createEvent('GET', { params: { token: 'not-a-token' } })), 404, 'Not found', { 'cache-control': 'no-store' });

			vi.mocked(getCalendarTasksForToken).mockResolvedValue(null);
			await expectText(await call['GET /api/calendar/subscriptions/[token].ics'](), 404, 'Not found');
		});

		it('answers a missing token secret with 503 and a spent limit with 429', async () => {
			vi.mocked(getCalendarTasksForToken).mockRejectedValue(new CalendarTokenConfigurationError());
			await expectText(await call['GET /api/calendar/subscriptions/[token].ics'](), 503, 'Calendar token configuration is unavailable.');

			vi.mocked(assertVolatileRateLimit).mockImplementation(() => {
				throw new RateLimitError('Too many calendar feed requests.', 45);
			});
			await expectText(await call['GET /api/calendar/subscriptions/[token].ics'](), 429, 'Too many calendar feed requests.', {
				'retry-after': '45',
				'cache-control': 'no-store'
			});
		});

		it('lets any other error through', async () => {
			const failure = new Error('connection reset');
			vi.mocked(getCalendarTasksForToken).mockRejectedValue(failure);
			await expect(call['GET /api/calendar/subscriptions/[token].ics']()).rejects.toBe(failure);
		});
	});

	describe('the OAuth connect and callback redirects', () => {
		/** @param {Record<string, string>} query */
		const back = (query) => createCalendarSyncRedirect({ status: 'error', provider: 'google', ...query });

		it('connect redirects to the provider, or back with the error message', async () => {
			vi.mocked(createCalendarProviderAuthorizationUrl).mockResolvedValue('https://accounts.example/auth');
			await expect(call['GET /api/calendar/providers/[provider]/connect']()).rejects.toMatchObject({ status: 302, location: 'https://accounts.example/auth' });

			for (const error of syncErrors()) {
				vi.mocked(createCalendarProviderAuthorizationUrl).mockRejectedValue(error);
				await expect(call['GET /api/calendar/providers/[provider]/connect']()).rejects.toMatchObject({ status: 302, location: back({ message: error.message }) });
			}

			const failure = new TaskWriteError('A default workspace board could not be created.', 500);
			vi.mocked(createCalendarProviderAuthorizationUrl).mockRejectedValue(failure);
			await expect(call['GET /api/calendar/providers/[provider]/connect']()).rejects.toBe(failure);
		});

		it('callback redirects back connected, or with the error message', async () => {
			vi.mocked(completeCalendarProviderAuthorization).mockResolvedValue(/** @type {any} */ (undefined));
			await expect(call['GET /api/calendar/providers/[provider]/callback']()).rejects.toMatchObject({
				status: 302,
				location: createCalendarSyncRedirect({ status: 'connected', provider: 'google' })
			});

			await expect(providerCallbackRoute.GET(createEvent('GET', { path: '/api/calendar/providers/google/callback?state=state' })))
				.rejects.toMatchObject({ status: 302, location: back({ message: 'Calendar OAuth callback is missing code or state.' }) });

			for (const error of syncErrors()) {
				vi.mocked(completeCalendarProviderAuthorization).mockRejectedValue(error);
				await expect(call['GET /api/calendar/providers/[provider]/callback']()).rejects.toMatchObject({ status: 302, location: back({ message: error.message }) });
			}

			const failure = new TaskWriteError('A default workspace board could not be created.', 500);
			vi.mocked(completeCalendarProviderAuthorization).mockRejectedValue(failure);
			await expect(call['GET /api/calendar/providers/[provider]/callback']()).rejects.toBe(failure);
		});
	});
});
