import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMemoryStorage } from '$lib/test-support/browser-globals.js';
import { jsonResponse } from '$lib/test-support/http.js';
import {
	applyLocalConflict,
	dismissConflicts,
	dismissNotice,
	downloadConflictReport,
	isOnline,
	keepServerConflict,
	refreshAppData,
	runServerSync,
	setOnline,
	showNotice,
	syncStatus,
	toggleConflictDetails
} from './sync-status.js';
import { tasks } from './task-store.js';
import { applyUserScope } from './user-scope.js';

const USER_ID = 'user-a';
const PATCHED_TASK_ID = '44444444-4444-4444-8444-444444444444';
const DELETED_TASK_ID = '55555555-5555-4555-8555-555555555555';
const CHECKLIST_ITEM_ID = '66666666-6666-4666-8666-666666666666';
const PENDING_VIEW_KEY = 'todokanbanPendingDefaultView';

/**
 * A fake server behind a stubbed fetch. It lists `serverTasks`, answers
 * the task writes with `taskWrites` (409 by default, like a version
 * conflict), and records every request as `METHOD /path`.
 */
function installServer() {
	const server = {
		/** @type {Array<Record<string, unknown>>} */
		serverTasks: [],
		/** @type {() => Response} */
		listTasks: () => jsonResponse({ tasks: server.serverTasks }),
		/** @type {(request: { method: string; path: string; body: any }) => Response} */
		taskWrites: () => jsonResponse({ message: 'Version conflict.' }, { status: 409 }),
		/** @type {string[]} */
		requests: []
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
			const method = init?.method ?? 'GET';
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
			server.requests.push(`${method} ${url}`);
			if (url === '/api/tasks' && method === 'GET') {
				return server.listTasks();
			}
			if (url === '/api/categories') {
				return jsonResponse({ categories: [] });
			}
			if (url === '/api/board/preferences') {
				return method === 'PATCH' ? jsonResponse(body) : jsonResponse({ message: 'Unavailable.' }, { status: 503 });
			}
			if (url.startsWith('/api/tasks/')) {
				return server.taskWrites({ method, path: url, body });
			}
			return jsonResponse({ message: 'Not found.' }, { status: 404 });
		})
	);
	return server;
}

/**
 * Seeds three offline writes the server will reject with 409: a task
 * edit, a task delete and a checklist edit, as the e2e conflict test does.
 * @param {Map<string, string>} storage
 */
function seedConflictingQueue(storage) {
	const base = { ownerUserId: USER_ID, createdAt: Date.parse('2026-09-20T00:00:00.000Z'), attempts: 0 };
	storage.set(
		`kanbanOfflineWriteQueue:${USER_ID}`,
		JSON.stringify([
			{
				...base,
				id: 'conflict-patch',
				type: 'task.patch',
				taskId: PATCHED_TASK_ID,
				patch: { text: 'My offline title', expectedVersion: 2 }
			},
			{ ...base, id: 'conflict-delete', type: 'task.delete', taskId: DELETED_TASK_ID, expectedVersion: 1 },
			{
				...base,
				id: 'conflict-checklist',
				type: 'checklist.patch',
				taskId: PATCHED_TASK_ID,
				itemId: CHECKLIST_ITEM_ID,
				patch: { done: true }
			}
		])
	);
}

function readStatus() {
	return get(syncStatus);
}

describe('sync status', () => {
	/** @type {Map<string, string>} */
	let storage;
	/** @type {ReturnType<typeof installServer>} */
	let server;

	beforeEach(() => {
		storage = installMemoryStorage();
		// The sync engine sends task writes only in a browser.
		vi.stubGlobal('window', {});
		vi.stubGlobal('navigator', { onLine: true });
		server = installServer();
		server.serverTasks = [
			{ id: PATCHED_TASK_ID, text: 'Conflict server task', status: 'todo', version: 3 },
			{ id: DELETED_TASK_ID, text: 'Conflict kept task', status: 'todo', version: 2 }
		];
		applyUserScope(USER_ID);
	});

	afterEach(async () => {
		// The fake server answers at once, so one macrotask lets the task
		// writes a test started finish before the user scope is cleared.
		await new Promise((resolve) => setTimeout(resolve, 0));
		applyUserScope(null);
		dismissConflicts();
		dismissNotice();
		setOnline(true);
		vi.useRealTimers();
	});

	/** The session as AppHeader hands it to a refresh. */
	function createSession({ userId = /** @type {string | null} */ (USER_ID) } = {}) {
		return {
			refetchSession: vi.fn(async () => {}),
			getUserId: () => userId
		};
	}

	describe('refreshing', () => {
		it('says the browser is offline instead of refreshing', async () => {
			vi.stubGlobal('navigator', { onLine: false });
			const session = createSession();

			await refreshAppData(session);

			expect(readStatus()).toMatchObject({
				notice: '오프라인 상태입니다. 온라인으로 돌아오면 새로고침할 수 있습니다.',
				isRefreshing: false
			});
			expect(get(isOnline)).toBe(false);
			expect(session.refetchSession).not.toHaveBeenCalled();
			expect(server.requests).toEqual([]);
		});

		it('asks to check the sign-in when the refetched session has no user', async () => {
			setOnline(false);
			const session = createSession({ userId: null });

			await refreshAppData(session);

			expect(readStatus()).toMatchObject({
				notice: '로그인 상태를 다시 확인한 뒤 새로고침해 주세요.',
				isRefreshing: false
			});
			expect(get(isOnline)).toBe(true);
			expect(session.refetchSession).toHaveBeenCalledTimes(1);
			expect(server.requests).toEqual([]);
		});

		it('sends a pending view, reloads the tasks and says so', async () => {
			storage.set(PENDING_VIEW_KEY, 'gantt');
			showNotice('이전 알림');
			const session = createSession();

			const refreshing = refreshAppData(session);
			// The old notice goes as the refresh starts, and a second press
			// does nothing while it runs.
			expect(readStatus()).toMatchObject({ notice: null, isRefreshing: true });
			await refreshAppData(session);
			await refreshing;

			expect(readStatus()).toMatchObject({
				notice: '최신 작업 목록으로 새로고침했습니다.',
				conflicts: [],
				isRefreshing: false
			});
			expect(session.refetchSession).toHaveBeenCalledTimes(1);
			expect(server.requests).toEqual([
				'PATCH /api/board/preferences',
				'GET /api/tasks',
				'GET /api/categories',
				'GET /api/board/preferences'
			]);
			expect(storage.has(PENDING_VIEW_KEY)).toBe(false);
			expect(get(tasks).map((task) => task.text)).toEqual(['Conflict server task', 'Conflict kept task']);
		});

		it('keeps the board when the server cannot be reached, and shows any other failure as the server put it', async () => {
			server.listTasks = () => jsonResponse({ message: 'Database unavailable.' }, { status: 503 });
			await refreshAppData(createSession());
			expect(readStatus().notice).toBe('지금은 서버에 연결할 수 없어 이 기기의 작업 목록을 유지합니다.');

			server.listTasks = () => jsonResponse({ message: 'Task list failed.' }, { status: 500 });
			await refreshAppData(createSession());
			expect(readStatus()).toMatchObject({ notice: 'Task list failed.', isRefreshing: false });
		});

		it('says the refresh failed when checking the session throws', async () => {
			const session = createSession();
			session.refetchSession.mockRejectedValueOnce(new Error('network down'));

			await refreshAppData(session);

			expect(readStatus()).toMatchObject({
				notice: '새로고침을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
				isRefreshing: false
			});
			expect(server.requests).toEqual([]);
		});
	});

	describe('offline conflicts', () => {
		async function syncConflicts() {
			seedConflictingQueue(storage);
			await runServerSync();
			return readStatus().conflicts;
		}

		it('lists the offline writes the server rejected, with the details closed', async () => {
			toggleConflictDetails();
			expect(readStatus().detailsOpen).toBe(true);

			const conflicts = await syncConflicts();

			expect(conflicts.map((conflict) => [conflict.id, conflict.title, conflict.target, conflict.detail])).toEqual([
				['conflict-patch', '작업 수정', 'Conflict server task', '충돌 필드: 작업명'],
				[
					'conflict-delete',
					'작업 삭제',
					'Conflict kept task',
					'서버의 최신 버전과 맞지 않아 삭제가 적용되지 않았습니다.'
				],
				[
					'conflict-checklist',
					'체크리스트 수정',
					'Conflict server task',
					'체크리스트 변경을 서버에 적용하지 못했습니다.'
				]
			]);
			expect(readStatus()).toMatchObject({ notice: null, detailsOpen: false, isRefreshing: false });

			toggleConflictDetails();
			expect(readStatus().detailsOpen).toBe(true);
		});

		it('keeps the conflicts after a sync that could not finish, and clears them after one that did', async () => {
			await syncConflicts();

			server.listTasks = () => jsonResponse({ message: 'Database unavailable.' }, { status: 503 });
			await runServerSync();
			expect(readStatus().conflicts).toHaveLength(3);

			server.listTasks = () => jsonResponse({ tasks: server.serverTasks });
			await runServerSync();
			expect(readStatus()).toMatchObject({ conflicts: [], notice: null });
		});

		it('keeps the server state for a conflict and closes the details with the last one', async () => {
			const conflicts = await syncConflicts();
			toggleConflictDetails();
			const writesBefore = server.requests.length;

			keepServerConflict(conflicts[1]);
			expect(readStatus()).toMatchObject({ notice: '서버의 최신 상태를 유지했습니다.', detailsOpen: true });
			expect(readStatus().conflicts.map((conflict) => conflict.id)).toEqual(['conflict-patch', 'conflict-checklist']);

			keepServerConflict(conflicts[0]);
			keepServerConflict(conflicts[2]);
			expect(readStatus()).toMatchObject({ conflicts: [], detailsOpen: false });
			expect(server.requests).toHaveLength(writesBefore);
		});

		it('applies my edit and my delete on top of the server state', async () => {
			const conflicts = await syncConflicts();
			/** @type {Array<{ method: string; path: string; body: any }>} */
			const writes = [];
			server.taskWrites = (request) => {
				writes.push(request);
				return request.method === 'DELETE'
					? jsonResponse({ deleted: 1 })
					: jsonResponse({ task: { ...server.serverTasks[0], ...request.body, version: 4 } });
			};

			applyLocalConflict(conflicts[0]);
			expect(readStatus().notice).toBe('내 변경을 최신 서버 상태 위에 다시 적용했습니다.');
			applyLocalConflict(conflicts[1]);
			expect(readStatus().notice).toBe('삭제 변경을 최신 서버 상태 위에 다시 적용했습니다.');

			// The writes go out on the tasks' sync chains: wait for the answers.
			await vi.waitFor(() => {
				expect(writes.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
					{
						method: 'PATCH',
						path: `/api/tasks/${PATCHED_TASK_ID}`,
						body: expect.objectContaining({ text: 'My offline title', expectedVersion: 3 })
					},
					{ method: 'DELETE', path: `/api/tasks/${DELETED_TASK_ID}`, body: { expectedVersion: 2 } }
				]);
				expect(get(tasks).map((task) => [task.text, task.version])).toEqual([['My offline title', 4]]);
			});
			// Let anything still queued behind those answers go out, then check
			// that no extra write followed (the fake server answers at once).
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(writes).toHaveLength(2);
			expect(readStatus().conflicts.map((conflict) => conflict.id)).toEqual(['conflict-checklist']);
		});

		it('leaves a conflict it cannot re-apply in the list and says to check it by hand', async () => {
			const conflicts = await syncConflicts();

			applyLocalConflict(conflicts[2]);

			expect(readStatus().notice).toBe('이 충돌은 자동 적용보다 내역 저장 후 수동 확인이 안전합니다.');
			expect(readStatus().conflicts).toHaveLength(3);
		});

		it('dismisses every conflict at once', async () => {
			await syncConflicts();
			toggleConflictDetails();

			dismissConflicts();

			expect(readStatus()).toMatchObject({ conflicts: [], detailsOpen: false });
		});

		it('saves the conflicts as a dated JSON report, and nothing when there are none', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(2026, 8, 26, 12, 0, 0));
			/** @type {Blob[]} */
			const blobs = [];
			const anchor = { href: '', download: '', click: vi.fn() };
			const environment = {
				document: { createElement: vi.fn(() => anchor) },
				url: {
					createObjectURL: vi.fn((/** @type {Blob} */ blob) => {
						blobs.push(blob);
						return 'blob:conflicts';
					}),
					revokeObjectURL: vi.fn()
				}
			};

			downloadConflictReport(/** @type {any} */ (environment));
			expect(environment.document.createElement).not.toHaveBeenCalled();

			await syncConflicts();
			downloadConflictReport(/** @type {any} */ (environment));

			expect(anchor).toMatchObject({ href: 'blob:conflicts', download: 'offline_conflicts_2026-09-26.json' });
			expect(anchor.click).toHaveBeenCalledTimes(1);
			expect(environment.url.revokeObjectURL).toHaveBeenCalledWith('blob:conflicts');
			const report = JSON.parse(await blobs[0].text());
			expect(report.conflicts.map((/** @type {{ id: string }} */ conflict) => conflict.id)).toEqual([
				'conflict-patch',
				'conflict-delete',
				'conflict-checklist'
			]);
		});
	});

	it('shows a notice until it is dismissed', () => {
		showNotice('Default view is invalid.');
		expect(readStatus().notice).toBe('Default view is invalid.');

		dismissNotice();
		expect(readStatus().notice).toBeNull();
	});
});
