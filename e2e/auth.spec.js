import { expect, test } from '@playwright/test';
import { cardByTitle } from './fixtures/board.js';
import { recordDialogs } from './fixtures/page.js';

const E2E_SESSION = {
	session: { id: 'e2e-session', userId: 'e2e-user', expiresAt: '2099-01-01T00:00:00.000Z' },
	user: { id: 'e2e-user', email: 'e2e@example.com', name: null }
};

test('keeps the private app locked before login', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /나의 칸반 보드/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /칸반 뷰/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /매트릭스/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /불러오기/ })).toBeHidden();
});

test('keeps locked auth controls within an iPhone viewport', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);

	const authPanel = page.locator('.locked-app-state .auth-panel');
	await expect(authPanel).toBeVisible();

	const boxes = await authPanel.locator('input, button').evaluateAll((elements) =>
		elements.map((element) => {
			const box = element.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				width: box.width
			};
		})
	);

	expect(boxes.length).toBeGreaterThan(0);
	for (const box of boxes) {
		expect(box.left).toBeGreaterThanOrEqual(0);
		expect(box.right).toBeLessThanOrEqual(393);
		expect(box.width).toBeGreaterThan(0);
	}
});

test('checks the email code and recovery code before creating a passkey', async ({ page, browserName }) => {
	// Playwright's Linux WebKit build crashes ("Target crashed") or stops
	// painting partway through this email-code flow on CI. It does so with the
	// pre-split AuthPanel too: 7 of 20 repeated CI runs failed. macOS WebKit
	// and Chromium pass it reliably, so CI keeps it on Chromium only.
	test.skip(browserName === 'webkit' && Boolean(process.env.CI), 'Linux WebKit crashes on this flow on CI');
	/** @type {Array<{ status?: number; expiresAt?: string; previewCode?: string }>} */
	const codeAnswers = [
		{ status: 503 },
		{ expiresAt: '2099-01-01T00:00:00.000Z', previewCode: '123456' },
		{ expiresAt: '2000-01-01T00:00:00.000Z' }
	];
	/** @type {unknown[]} */
	const codeRequests = [];
	await page.route('**/api/account/email-verifications', (route) => {
		const body = route.request().postDataJSON();
		codeRequests.push(body);
		const answer = codeAnswers.shift() ?? {};
		if (answer.status) {
			return route.fulfill({ status: answer.status, json: { message: 'Database unavailable.' } });
		}
		return route.fulfill({ json: { email: body.email, expiresAt: answer.expiresAt, previewCode: answer.previewCode } });
	});

	await page.goto('/');
	const panel = page.locator('.locked-app-state .auth-panel');
	const status = panel.locator('.auth-status');
	const email = panel.getByPlaceholder('email@example.com');
	const sendCode = panel.getByRole('button', { name: '코드 받기' });
	const createPasskey = panel.getByRole('button', { name: '패스키 만들기' });
	const codeInput = panel.getByPlaceholder('확인 코드');

	await sendCode.click();
	await expect(status).toHaveText('이메일을 입력해 주세요.');
	await expect(status).toHaveAttribute('role', 'alert');
	expect(codeRequests).toEqual([]);

	await email.fill('  New@Example.com ');
	await createPasskey.click();
	await expect(status).toHaveText('이메일 확인 코드를 입력해 주세요.');

	await panel.getByPlaceholder('이름').fill('새 사용자');
	await sendCode.click();
	await expect(status).toHaveText('데이터베이스 설정 후 이용할 수 있습니다.');
	await sendCode.click();
	await expect(status).toHaveText('확인 코드: 123456');
	await expect(status).not.toHaveAttribute('role', 'alert');
	expect(codeRequests).toEqual([
		{ email: 'new@example.com', name: '새 사용자' },
		{ email: 'new@example.com', name: '새 사용자' }
	]);

	// The code belongs to the email it was sent to.
	await codeInput.fill('123456');
	await email.fill('other@example.com');
	await createPasskey.click();
	await expect(status).toHaveText('현재 이메일로 새 확인 코드를 받아 주세요.');

	// A new code clears the typed one; an expired code is refused locally.
	await panel.getByPlaceholder('이름').fill('');
	await sendCode.click();
	await expect(status).toHaveText('새 확인 코드를 보냈습니다. 가장 최근 코드만 사용할 수 있습니다.');
	expect(codeRequests.at(-1)).toEqual({ email: 'other@example.com', name: 'other@example.com' });
	await expect(codeInput).toHaveValue('');
	await codeInput.fill('654321');
	await createPasskey.click();
	await expect(status).toHaveText('확인 코드가 만료되었습니다. 새 코드를 받아 주세요.');

	// Recovery mode swaps the email-code input for a recovery-code input.
	await panel.getByRole('button', { name: '복구 모드' }).click();
	await expect(panel.getByRole('button', { name: '가입 모드' })).toBeVisible();
	await expect(codeInput).toHaveCount(0);
	await expect(sendCode).toHaveCount(0);
	await expect(panel.getByPlaceholder('복구 코드')).toBeVisible();
	await createPasskey.click();
	await expect(status).toHaveText('복구 코드를 입력해 주세요.');
	await panel.getByRole('button', { name: '가입 모드' }).click();
	await expect(codeInput).toHaveValue('654321');
	await expect(panel.getByRole('button', { name: '패스키 로그인' })).toBeEnabled();
});

test('manages passkeys, recovery codes and sign-out for a signed-in account', async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('e2e-account-seeded')) {
			return;
		}
		sessionStorage.setItem('e2e-account-seeded', '1');
		localStorage.setItem('kanbanTasks:e2e-user', JSON.stringify([
			{ id: 'account-cached-task', text: 'Account cached task', status: 'todo' }
		]));
		localStorage.setItem('kanbanOfflineWriteQueue:e2e-user', JSON.stringify([{
			id: 'account-pending-patch',
			type: 'task.patch',
			taskId: '77777777-7777-4777-8777-777777777777',
			patch: { text: 'Pending edit' },
			ownerUserId: 'e2e-user',
			createdAt: Date.now(),
			attempts: 0
		}]));
	});
	// Confirm answers: delete passkey (no, yes), then sign out (no, yes).
	const dialogs = recordDialogs(page, [false, true, false, true]);
	let signedIn = true;
	let signOutFails = true;
	let passkeys = [
		{ id: 'passkey-mac', name: 'Mac 패스키', createdAt: '2026-05-01T12:00:00.000Z', backedUp: true },
		{ id: 'passkey-old', name: null, createdAt: '2026-05-02T12:00:00.000Z', backedUp: false }
	];
	await page.route('**/api/**', (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		const method = request.method();
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({ json: signedIn ? E2E_SESSION : null });
		}
		if (pathname === '/api/auth/passkey/list-user-passkeys') {
			return route.fulfill({ json: passkeys });
		}
		if (pathname === '/api/auth/passkey/update-passkey') {
			const { id, name } = request.postDataJSON();
			passkeys = passkeys.map((passkey) => passkey.id === id ? { ...passkey, name } : passkey);
			return route.fulfill({ json: { passkey: passkeys.find((passkey) => passkey.id === id) } });
		}
		if (pathname === '/api/auth/passkey/delete-passkey') {
			const { id } = request.postDataJSON();
			passkeys = passkeys.filter((passkey) => passkey.id !== id);
			return route.fulfill({ json: { status: true } });
		}
		if (pathname === '/api/account/recovery-codes' && method === 'POST') {
			return route.fulfill({
				json: {
					summary: { total: 10, available: 10, lastCreatedAt: '2026-05-03T12:00:00.000Z' },
					codes: ['AAAA-1111', 'BBBB-2222']
				}
			});
		}
		if (pathname === '/api/account/recovery-codes' && method === 'DELETE') {
			return route.fulfill({ json: { summary: { total: 0, available: 0, lastCreatedAt: null } } });
		}
		if (pathname === '/api/auth/sign-out') {
			if (signOutFails) {
				return route.fulfill({ status: 500, json: { message: 'Sign-out failed.' } });
			}
			signedIn = false;
			return route.fulfill({ json: { success: true } });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const panel = page.locator('.header .auth-panel');
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');
	await expect(panel.locator('input.auth-input-small')).toHaveValue(/^(Windows PC|Mac|iPhone|iPad|Android|내 기기) 패스키 - \d{4}-\d{2}-\d{2}$/);
	await expect(panel.locator('input.auth-input-small')).toHaveAttribute('aria-label', '패스키 이름');
	const status = panel.locator('.auth-status');

	// Passkey management.
	const manager = panel.getByLabel('등록된 패스키 관리');
	await expect(manager).toHaveCount(0);
	await panel.getByRole('button', { name: '패스키 관리' }).click();
	await expect(panel.getByRole('button', { name: '관리 닫기' })).toBeVisible();
	const rows = manager.locator('.passkey-row');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).locator('input')).toHaveValue('Mac 패스키');
	await expect(rows.nth(0).locator('small')).toHaveText('등록 2026-05-01 · 동기화됨');
	await expect(rows.nth(1).locator('input')).toHaveValue('패스키 2026-05-02');
	await expect(rows.nth(1).locator('small')).toHaveText('등록 2026-05-02 · 이 기기');
	await expect(manager).toContainText('Apple 패스키 선택 화면의 기존 이름은 기기 캐시 때문에 그대로 보일 수 있습니다.');

	await rows.nth(1).locator('input').fill('   ');
	await rows.nth(1).getByRole('button', { name: '저장' }).click();
	await expect(panel.locator('.auth-error')).toHaveText('패스키 이름을 입력해 주세요.');
	await rows.nth(1).locator('input').fill('iPhone 패스키');
	await rows.nth(1).getByRole('button', { name: '저장' }).click();
	await expect(status.first()).toHaveText('패스키 이름을 저장했습니다. Apple 선택 화면은 기존 이름을 계속 표시할 수 있습니다.');
	await expect(rows.nth(1).locator('input')).toHaveValue('iPhone 패스키');

	// The first delete is cancelled at the question, the second goes through.
	await rows.nth(0).getByRole('button', { name: '삭제' }).click();
	await expect.poll(() => dialogs.length).toBe(1);
	await expect(rows).toHaveCount(2);
	await rows.nth(0).getByRole('button', { name: '삭제' }).click();
	await expect.poll(() => dialogs.length).toBe(2);
	expect(dialogs).toEqual([
		'confirm:Mac 패스키 패스키를 삭제하시겠습니까? 이 기기로는 다시 로그인할 수 없을 수 있습니다.',
		'confirm:Mac 패스키 패스키를 삭제하시겠습니까? 이 기기로는 다시 로그인할 수 없을 수 있습니다.'
	]);
	await expect(status.first()).toHaveText('패스키를 삭제했습니다.');
	await expect(rows).toHaveCount(1);
	await expect(rows.nth(0).getByRole('button', { name: '삭제' })).toBeDisabled();
	await expect(rows.nth(0).getByRole('button', { name: '삭제' })).toHaveAttribute('title', '마지막 패스키는 삭제하지 않는 것이 안전합니다.');
	await manager.getByRole('button', { name: '다시 불러오기' }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.nth(0).locator('input')).toHaveValue('iPhone 패스키');
	await panel.getByRole('button', { name: '관리 닫기' }).click();
	await expect(manager).toHaveCount(0);

	// Recovery codes.
	const codeList = panel.getByLabel('새 복구 코드');
	await panel.getByRole('button', { name: '복구 코드', exact: true }).click();
	await expect(status.first()).toHaveText('새 복구 코드가 생성되었습니다.');
	await expect(status.nth(1)).toHaveText('복구 코드 10/10');
	await expect(codeList.locator('code')).toHaveText(['AAAA-1111', 'BBBB-2222']);
	await panel.getByRole('button', { name: '복구 폐기' }).click();
	await expect(status.first()).toHaveText('복구 코드가 폐기되었습니다.');
	await expect(status.nth(1)).toHaveText('복구 코드 0/0');
	await expect(codeList).toHaveCount(0);

	// Sign-out. Without the cache option there is no question.
	const clearCache = panel.getByRole('checkbox', { name: '캐시 삭제' });
	await expect(clearCache).toBeChecked();
	await clearCache.uncheck();
	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect(panel.locator('.auth-error')).toHaveText('Sign-out failed.');
	expect(dialogs).toHaveLength(2);

	// With it, pending offline changes are asked about first.
	signOutFails = false;
	await clearCache.check();
	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect.poll(() => dialogs.length).toBe(3);
	expect(dialogs[2]).toBe('confirm:아직 동기화되지 않은 오프라인 변경 1건이 있습니다. 로그아웃하면서 이 기기 캐시를 삭제할까요?');
	await expect(status.first()).toHaveText('로그아웃을 취소했습니다. 먼저 Sync로 오프라인 변경을 동기화해 주세요.');
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');

	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect(page.locator('.locked-app-state .auth-panel')).toBeVisible();
	expect(dialogs).toHaveLength(4);
	// The queue is dropped and the cached list emptied (the store writes the
	// empty list back under the same key).
	expect(await page.evaluate(() => [
		localStorage.getItem('kanbanOfflineWriteQueue:e2e-user'),
		localStorage.getItem('kanbanTasks:e2e-user')
	])).toEqual([null, '[]']);
});

test('counts a task edit that fails while sign-out waits for it before asking to clear the cache', async ({ page }) => {
	const TASK_ID = '88888888-8888-4888-8888-888888888888';
	// Answers: keep the cache (cancel sign-out).
	const dialogs = recordDialogs(page, [false]);
	/** @type {string[]} */
	const requests = [];
	/** @type {(value?: unknown) => void} */
	let answerPatch = () => {};
	const patchAnswer = new Promise((resolve) => {
		answerPatch = resolve;
	});
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		const method = request.method();
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({ json: E2E_SESSION });
		}
		if (pathname === '/api/tasks' && method === 'GET') {
			return route.fulfill({ json: { tasks: [{ id: TASK_ID, text: 'Server task', status: 'todo', priority: 'medium', version: 1 }] } });
		}
		if (pathname === '/api/categories') {
			return route.fulfill({ json: { categories: [] } });
		}
		if (pathname === `/api/tasks/${TASK_ID}` && method === 'PATCH') {
			requests.push(`PATCH priority ${request.postDataJSON().priority}`);
			// Held until the test has clicked sign-out; 503 is retryable, so
			// the edit then moves to the offline queue.
			await patchAnswer;
			return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
		}
		if (pathname === '/api/auth/sign-out') {
			requests.push('sign-out');
			return route.fulfill({ json: { success: true } });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const modal = page.locator('.side-panel');
	await cardByTitle(page, 'Server task').locator('.card-text').click();
	await modal.locator('#modal-priority').selectOption('high');
	await modal.locator('.close-btn').click();
	await expect.poll(() => requests).toEqual(['PATCH priority high']);

	// The offline queue is empty when sign-out starts. It waits for the edit
	// in flight, which fails into the queue: the question counts it.
	const panel = page.locator('.header .auth-panel');
	const signOut = panel.getByRole('button', { name: '로그아웃' });
	await expect(panel.getByRole('checkbox', { name: '캐시 삭제' })).toBeChecked();
	await signOut.click();
	await expect(signOut).toBeDisabled();
	answerPatch();

	await expect.poll(() => dialogs.length).toBe(1);
	expect(dialogs[0]).toBe('confirm:아직 동기화되지 않은 오프라인 변경 1건이 있습니다. 로그아웃하면서 이 기기 캐시를 삭제할까요?');
	await expect(panel.locator('.auth-status').first()).toHaveText('로그아웃을 취소했습니다. 먼저 Sync로 오프라인 변경을 동기화해 주세요.');
	await expect(signOut).toBeEnabled();
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');
	expect(requests).toEqual(['PATCH priority high']);
	// The edit waits in the queue of the user still signed in.
	expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kanbanOfflineWriteQueue:e2e-user') ?? '[]'))).toMatchObject([
		{ type: 'task.patch', taskId: TASK_ID, patch: { priority: 'high' }, ownerUserId: 'e2e-user' }
	]);
});

/**
 * Leaves a default view chosen offline in an earlier visit, not yet sent,
 * with the account it was chosen under cached for offline unlock. Seeds once
 * per test, so a reload keeps what the app did since.
 * @param {import('@playwright/test').Page} page
 */
async function seedPendingDefaultView(page) {
	await page.addInitScript(({ user }) => {
		if (sessionStorage.getItem('e2e-view-seeded')) {
			return;
		}
		sessionStorage.setItem('e2e-view-seeded', '1');
		localStorage.setItem('todokanbanAuthScope', JSON.stringify({ ...user, cachedAt: Date.now() }));
		localStorage.setItem('todokanbanPendingDefaultView', 'gantt');
	}, { user: E2E_SESSION.user });
}

/** @param {import('@playwright/test').Page} page */
function readPendingDefaultView(page) {
	return page.evaluate(() => localStorage.getItem('todokanbanPendingDefaultView'));
}

test('keeps a default view chosen offline when the session check fails on a network that reports online', async ({ page }) => {
	await seedPendingDefaultView(page);
	// navigator.onLine stays true, but nothing reaches the server (captive
	// Wi-Fi, an outage) until the reload below.
	let reachable = false;
	/** @type {unknown[]} */
	const viewWrites = [];
	await page.route('**/api/**', (route) => {
		if (!reachable) {
			return route.abort('internetdisconnected');
		}
		const request = route.request();
		const { pathname } = new URL(request.url());
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({ json: E2E_SESSION });
		}
		if (pathname === '/api/tasks') {
			return route.fulfill({ json: { tasks: [] } });
		}
		if (pathname === '/api/categories') {
			return route.fulfill({ json: { categories: [] } });
		}
		if (pathname === '/api/board/preferences' && request.method() === 'PATCH') {
			viewWrites.push(request.postDataJSON());
			return route.fulfill({ json: request.postDataJSON() });
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	// The failed check signs the app out: it forgets the cached account...
	await expect.poll(() => page.evaluate(() => localStorage.getItem('todokanbanAuthScope'))).toBeNull();
	await expect(page.locator('.locked-app-state .auth-panel')).toBeVisible();
	// ...but no one signed out, so the view waits for the session to return.
	expect(await readPendingDefaultView(page)).toBe('gantt');

	reachable = true;
	await page.reload();
	await expect(page.locator('.header .auth-identity')).toHaveText('e2e@example.com');
	await expect.poll(() => viewWrites).toEqual([{ defaultView: 'gantt' }]);
	await expect.poll(() => readPendingDefaultView(page)).toBeNull();
});

test('drops a default view not yet sent when the user signs out and keeps the cache', async ({ page }) => {
	await seedPendingDefaultView(page);
	let signedIn = true;
	/** @type {unknown[]} */
	const viewWrites = [];
	await page.route('**/api/**', (route) => {
		const request = route.request();
		const { pathname } = new URL(request.url());
		if (pathname === '/api/auth/get-session') {
			return route.fulfill({ json: signedIn ? E2E_SESSION : null });
		}
		if (pathname === '/api/auth/sign-out') {
			signedIn = false;
			return route.fulfill({ json: { success: true } });
		}
		if (pathname === '/api/board/preferences' && request.method() === 'PATCH') {
			// The server cannot store it yet, so the view stays pending.
			viewWrites.push(request.postDataJSON());
		}
		return route.fulfill({ status: 503, json: { message: 'Database unavailable.' } });
	});

	await page.goto('/');
	const panel = page.locator('.header .auth-panel');
	await expect(panel.locator('.auth-identity')).toHaveText('e2e@example.com');
	await expect.poll(() => viewWrites).toEqual([{ defaultView: 'gantt' }]);
	expect(await readPendingDefaultView(page)).toBe('gantt');

	// Left behind, the next account to sign in here would send it as its own.
	await panel.getByRole('checkbox', { name: '캐시 삭제' }).uncheck();
	await panel.getByRole('button', { name: '로그아웃' }).click();
	await expect(page.locator('.locked-app-state .auth-panel')).toBeVisible();
	expect(await readPendingDefaultView(page)).toBeNull();
});
