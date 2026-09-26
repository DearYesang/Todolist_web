import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { seedOfflineBoard } from './fixtures/board.js';
import { recordDialogs } from './fixtures/page.js';

test.describe('in Korea before 09:00', () => {
	test.use({ timezoneId: 'Asia/Seoul' });

	test('names the backup export with the local date, not the UTC one', async ({ page }) => {
		// 2026-09-24 08:30 KST is still 2026-09-23 in UTC.
		await page.clock.setFixedTime(new Date('2026-09-23T23:30:00.000Z'));
		await seedOfflineBoard(page);
		await page.goto('/');

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '백업 JSON 내보내기' }).click();
		const download = await downloadPromise;

		expect(download.suggestedFilename()).toBe('kanban_backup_2026-09-24.json');
		const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
		expect(exported.map((task) => task.text)).toContain('E2E cached task');
	});
});

/**
 * @param {Array<Record<string, unknown>> | Record<string, unknown> | string} content
 */
function backupFile(content) {
	return {
		name: 'kanban_backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
	};
}

test('imports a backup file by replacing or appending, and reports unreadable files', async ({ page }) => {
	await seedOfflineBoard(page);
	const dialogs = recordDialogs(page, [true, false]);
	/** @type {string[]} */
	const importRequests = [];
	await page.route('**/api/import**', (route) => {
		const url = new URL(route.request().url());
		importRequests.push(`${url.pathname}${url.search}`);
		if (url.searchParams.get('mode') === 'replace') {
			return route.fulfill({
				json: {
					tasks: [{ id: '33333333-3333-4333-8333-333333333333', text: 'Server imported task', status: 'todo' }],
					summary: {
						receivedTasks: 1,
						importedTasks: 1,
						skippedTasks: 0,
						importedChecklistItems: 0,
						skippedChecklistItems: 0,
						repairedParentLinks: 0,
						replacedTasks: 7
					}
				}
			});
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	await expect(page.getByText('E2E cached task')).toBeVisible();
	const fileInput = page.locator('#import-file');

	// Confirm accepted: replace through the server, which answers with its list.
	await fileInput.setInputFiles(backupFile([{ id: 'backup-replaced', text: 'Backup replaced task' }]));
	await expect.poll(() => dialogs).toEqual([
		'confirm:현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.',
		'alert:데이터를 성공적으로 불러왔습니다. 가져온 작업: 1개. 교체된 작업: 7개.'
	]);
	await expect(page.getByText('Server imported task')).toBeVisible();
	await expect(page.getByText('E2E cached task')).toHaveCount(0);
	await expect(fileInput).toHaveValue('');

	// Confirm dismissed: append. The server is unavailable, so the file lands
	// on this device first and is queued for the server.
	await fileInput.setInputFiles(backupFile({ tasks: [{ id: 'backup-appended', text: 'Backup appended task' }] }));
	await expect.poll(() => dialogs.length).toBe(4);
	expect(dialogs.slice(2)).toEqual([
		'confirm:현재 목록을 파일 내용으로 교체하시겠습니까? 취소하면 기존 목록에 추가합니다.',
		'alert:오프라인 상태라 이 기기에 먼저 불러왔습니다. 온라인이 되면 서버와 다른 기기에 자동 반영을 시도합니다.'
	]);
	await expect(page.getByText('Server imported task')).toBeVisible();
	await expect(page.getByText('Backup appended task')).toBeVisible();
	expect(importRequests).toEqual(['/api/import?mode=replace', '/api/import']);
	const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('kanbanOfflineWriteQueue:e2e-user') ?? '[]'));
	expect(queued).toEqual([expect.objectContaining({ type: 'import.tasks', mode: 'append', localTaskIds: ['backup-appended'] })]);

	// Not a backup shape, then not JSON at all: nothing is asked or sent.
	await fileInput.setInputFiles(backupFile({ notTasks: true }));
	await expect.poll(() => dialogs.length).toBe(5);
	await fileInput.setInputFiles(backupFile('{ not json'));
	await expect.poll(() => dialogs.length).toBe(6);
	expect(dialogs.slice(4)).toEqual([
		'alert:올바른 칸반 데이터 형식이 아닙니다.',
		'alert:파일을 읽는 중 오류가 발생했습니다.'
	]);
	expect(importRequests).toHaveLength(2);
	await expect(fileInput).toHaveValue('');
});

const CONFLICT_TASK_ID = '44444444-4444-4444-8444-444444444444';
const CONFLICT_DELETE_TASK_ID = '55555555-5555-4555-8555-555555555555';

test('lists offline conflicts and applies, keeps or saves them', async ({ page }) => {
	await seedOfflineBoard(page);
	// Three queued offline writes that the server rejects with 409.
	await page.addInitScript(({ taskId, deleteTaskId }) => {
		if (sessionStorage.getItem('e2e-conflicts-seeded')) {
			return;
		}
		sessionStorage.setItem('e2e-conflicts-seeded', '1');
		const base = { ownerUserId: 'e2e-user', createdAt: Date.now(), attempts: 0 };
		localStorage.setItem('kanbanOfflineWriteQueue:e2e-user', JSON.stringify([
			{ ...base, id: 'conflict-patch', type: 'task.patch', taskId, patch: { text: 'My offline title', expectedVersion: 2 } },
			{ ...base, id: 'conflict-delete', type: 'task.delete', taskId: deleteTaskId, expectedVersion: 1 },
			{ ...base, id: 'conflict-checklist', type: 'checklist.patch', taskId, itemId: '66666666-6666-4666-8666-666666666666', patch: { done: true } }
		]));
	}, { taskId: CONFLICT_TASK_ID, deleteTaskId: CONFLICT_DELETE_TASK_ID });

	const serverTasks = [
		{ id: CONFLICT_TASK_ID, text: 'Conflict server task', status: 'todo', version: 3 },
		{ id: CONFLICT_DELETE_TASK_ID, text: 'Conflict kept task', status: 'todo', version: 2 }
	];
	/** @type {string[]} */
	const writes = [];
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({
				json: {
					session: { id: 'e2e-session', userId: 'e2e-user', expiresAt: '2099-01-01T00:00:00.000Z' },
					user: { id: 'e2e-user', email: 'e2e@example.com', name: null }
				}
			});
		}
		if (pathname === '/api/tasks' && request.method() === 'GET') {
			return route.fulfill({ json: { tasks: serverTasks } });
		}
		if (pathname.startsWith('/api/tasks/') && request.method() !== 'GET') {
			writes.push(`${request.method()} ${pathname}`);
			if (writes.length <= 3) {
				return route.fulfill({ status: 409, json: { message: 'Version conflict.' } });
			}
			const patch = request.postDataJSON() ?? {};
			return route.fulfill({ json: { task: { ...serverTasks[0], ...patch, version: 4 } } });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const banner = page.locator('.sync-notice.conflict-notice');
	await expect(banner).toHaveAttribute('role', 'status');
	await expect(banner).toContainText('오프라인 변경 3건이 서버의 최신 상태와 충돌했습니다.');
	expect(writes).toEqual([
		`PATCH /api/tasks/${CONFLICT_TASK_ID}`,
		`DELETE /api/tasks/${CONFLICT_DELETE_TASK_ID}`,
		`PATCH /api/tasks/${CONFLICT_TASK_ID}/checklist/66666666-6666-4666-8666-666666666666`
	]);

	const rows = banner.locator('.sync-conflict-row');
	await expect(rows).toHaveCount(0);
	await banner.getByRole('button', { name: '내역 보기' }).click();
	await expect(banner.getByRole('button', { name: '내역 닫기' })).toBeVisible();
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0).locator('strong')).toHaveText('작업 수정');
	await expect(rows.nth(0).locator('span')).toHaveText('Conflict server task');
	await expect(rows.nth(0).locator('small')).toHaveText('충돌 필드: 작업명');
	await expect(rows.nth(1).locator('strong')).toHaveText('작업 삭제');
	await expect(rows.nth(1).locator('span')).toHaveText('Conflict kept task');
	await expect(rows.nth(1).locator('small')).toHaveText('서버의 최신 버전과 맞지 않아 삭제가 적용되지 않았습니다.');
	await expect(rows.nth(2).locator('strong')).toHaveText('체크리스트 수정');
	await expect(rows.nth(2).locator('small')).toHaveText('체크리스트 변경을 서버에 적용하지 못했습니다.');
	const applyButtons = banner.getByRole('button', { name: '내 변경 적용' });
	await expect(applyButtons.nth(0)).toBeEnabled();
	await expect(applyButtons.nth(0)).toHaveAttribute('title', '내 오프라인 변경을 최신 서버 상태 위에 다시 적용합니다.');
	await expect(applyButtons.nth(1)).toBeEnabled();
	await expect(applyButtons.nth(2)).toBeDisabled();
	await expect(applyButtons.nth(2)).toHaveAttribute('title', '이 충돌은 내역 저장 후 수동 확인이 안전합니다.');

	const downloadPromise = page.waitForEvent('download');
	await banner.getByRole('button', { name: '내역 저장' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^offline_conflicts_\d{4}-\d{2}-\d{2}\.json$/);
	const report = JSON.parse(await readFile(await download.path(), 'utf8'));
	expect(report.conflicts.map((conflict) => [conflict.id, conflict.title, conflict.target])).toEqual([
		['conflict-patch', '작업 수정', 'Conflict server task'],
		['conflict-delete', '작업 삭제', 'Conflict kept task'],
		['conflict-checklist', '체크리스트 수정', 'Conflict server task']
	]);

	// Apply my edit: it goes back onto the server task, and the row leaves.
	await applyButtons.nth(0).click();
	await expect(page.getByText('My offline title')).toBeVisible();
	await expect(rows).toHaveCount(2);
	await expect(banner).toContainText('오프라인 변경 2건이 서버의 최신 상태와 충돌했습니다.');

	// Keep the server's version of the deleted task.
	await rows.nth(0).getByRole('button', { name: '서버 유지' }).click();
	await expect(rows).toHaveCount(1);
	await expect(page.getByText('Conflict kept task')).toBeVisible();

	// Dismissing the rest shows the last notice, which 확인 then clears.
	await banner.getByRole('button', { name: '확인' }).click();
	await expect(banner).toHaveCount(0);
	const notice = page.locator('.sync-notice');
	await expect(notice).toHaveText(/서버의 최신 상태를 유지했습니다\./);
	await expect(notice).toHaveAttribute('role', 'status');
	await notice.getByRole('button', { name: '확인' }).click();
	await expect(notice).toHaveCount(0);
});
