// Deterministic repros of the fuzzer's shrunk failures. Each test states the
// invariant with expect(); run with FUZZ_ROOT=<worktree> to run the same
// scenario against another checkout (a checkout without user-scope.js uses the
// adapter in harness.js: App.svelte applyStorageScope + that AuthAccountControls).
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../root.js';
import { Env } from './harness.js';

async function boot() {
	const env = new Env({ seed: 1, root: ROOT, config: { pEarly: 0 } });
	env.traceRequests = Boolean(process.env.REPRO_TRACE);
	env.notes = new Set();
	env.reportedResurrect = new Set();
	await env.install();
	for (const user of ['ua', 'ub']) {
		for (let i = 1; i <= 2; i++) env.server.seedTask(user, `${user}.t${i}:0`, 'medium', [`${user}.i${i}~0`]);
	}
	env.signIn('ua');
	await env.quiesce();
	await answerAll(env);
	env.server.log = [];
	return env;
}

function pending(env, method, pattern) {
	return env.pending.find((r) => r.method === method && (typeof pattern === 'string' ? r.url === pattern : pattern.test(r.url)));
}

async function answer(env, method, pattern, outcome = 'ok') {
	const req = pending(env, method, pattern);
	if (!req) throw new Error(`no pending ${method} ${pattern}; pending: ${env.pending.map((r) => `${r.method} ${r.url}`).join(', ')}`);
	env.resolveRequest(req, outcome);
	await env.quiesce();
	return req;
}

/** The server handles the request now; its answer is delivered when answered. */
function processNow(env, method, pattern) {
	const req = pending(env, method, pattern);
	if (!req) throw new Error(`no pending ${method} ${pattern}`);
	req.early = env.server.handle(req);
	return req;
}

async function answerAll(env) {
	await env.quiesce();
	for (let i = 0; i < 50 && (env.pending.length || env.timers.length); i++) {
		for (const r of [...env.pending]) env.resolveRequest(r, 'ok');
		for (const t of [...env.timers]) env.fireTimer(t);
		await env.quiesce();
	}
}

const board = (env) => get(env.app.facade.tasks);
const task = (env, prefix) => board(env).find((t) => t.text.startsWith(prefix));
const serverTask = (env, owner, prefix) => env.server.liveTasksOf(owner).find((t) => t.text.startsWith(prefix));
const queueOf = (env, owner) => JSON.parse(env.storage.get(`kanbanOfflineWriteQueue:${owner}`) ?? '[]');
const cacheOf = (env, owner) => JSON.parse(env.storage.get(`kanbanTasks:${owner}`) ?? '[]');
const createValues = (text) => ({ text, priority: 'medium', urgency: 'normal', category: '', startDate: '2026-10-01', endDate: '2026-10-02', parentId: null });
const conflictsShown = (env) => env.conflictsShown.flatMap((c) => c.conflicts.map((m) => `${m.type}:${m.patch?.text ?? m.taskId}`));

describe(`repro on ${ROOT.split('/').pop()}`, () => {
	it('R1a: a task create still out at sign-out lands in the anonymous queue, not its user\'s', async () => {
		const env = await boot();
		const f = env.app.facade;
		void f.createTask(createValues('ua.t3:0'));
		await env.quiesce();
		const countedBeforeSignOut = env.app.countPending();
		env.signOut({ clear: false, confirmYes: false });
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out'); // signed out, board -> anonymous
		await answer(env, 'POST', '/api/tasks', 'network'); // the create's request fails after sign-out
		const where = {
			counted: countedBeforeSignOut,
			ua: queueOf(env, 'ua').map((m) => m.type),
			anonymous: queueOf(env, 'anonymous').map((m) => `${m.type}:${m.payload?.text}`)
		};
		console.log('R1a', JSON.stringify(where));
		expect(where.ua).toContain('task.create');
	});

	it('R1c: with "clear local data" on, the in-flight create is not counted, no dialog is shown, and it ends up on the device anyway', async () => {
		const env = await boot();
		const f = env.app.facade;
		void f.createTask(createValues('ua.t3:0'));
		await env.quiesce();
		env.signOut({ clear: true, confirmYes: false }); // confirmYes=false: a dialog would cancel the sign-out
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out');
		const signedOut = env.sessionUser === null;
		await answer(env, 'POST', '/api/tasks', 'network');
		const r = {
			signedOutWithoutDialog: signedOut,
			anonymousQueue: queueOf(env, 'anonymous').map((m) => `${m.type}:${m.payload?.text}`),
			anonymousCache: cacheOf(env, 'anonymous').map((t) => t.text)
		};
		console.log('R1c', JSON.stringify(r));
		expect(r.anonymousQueue).toEqual([]);
		expect(r.anonymousCache).toEqual([]);
	});

	it('R1b: a task create still out when the next user signs in is created in that user\'s account', async () => {
		const env = await boot();
		const f = env.app.facade;
		void f.createTask(createValues('ua.t3:0'));
		await env.quiesce();
		env.signOut({ clear: false, confirmYes: false });
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out');
		env.signIn('ub');
		await env.quiesce();
		await answer(env, 'POST', '/api/tasks', 503); // user A's create fails now
		const onBBoard = board(env).map((t) => t.text);
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const bAccount = env.server.liveTasksOf('ub').map((t) => t.text);
		console.log('R1b', JSON.stringify({ onBBoard, bAccount, aAccount: env.server.liveTasksOf('ua').map((t) => t.text) }));
		if (process.env.REPRO_TRACE) console.log(env.trace.join('\n'), JSON.stringify(env.consoleErrors));
		expect(bAccount).not.toContain('ua.t3:0');
	});

	it('R2: a sync snapshot answered after sign-out and the next sign-in is applied to the next user\'s board', async () => {
		const env = await boot();
		env.runServerSync();
		await env.quiesce();
		processNow(env, 'GET', '/api/tasks'); // A's snapshot, answered late
		env.signOut({ clear: true, confirmYes: true }); // nothing pending: no dialog, local data cleared
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out');
		const anonCacheAfterClear = cacheOf(env, 'anonymous').map((t) => t.text);
		env.signIn('ub');
		await env.quiesce();
		await answer(env, 'GET', '/api/tasks'); // first pending GET is A's
		const bBoard = board(env).map((t) => t.text);
		const bCache = cacheOf(env, 'ub').map((t) => t.text);
		console.log('R2', JSON.stringify({ anonCacheAfterClear, bBoard, bCache }));
		expect(bBoard.filter((t) => t.startsWith('ua.'))).toEqual([]);
		expect(bCache.filter((t) => t.startsWith('ua.'))).toEqual([]);
	});

	it('R2b: after "clear local data", a late snapshot writes the signed-out user\'s tasks to the anonymous cache', async () => {
		const env = await boot();
		env.runServerSync();
		await env.quiesce();
		processNow(env, 'GET', '/api/tasks');
		env.signOut({ clear: true, confirmYes: true });
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out');
		await answer(env, 'GET', '/api/tasks');
		const anonCache = cacheOf(env, 'anonymous').map((t) => t.text);
		console.log('R2b', JSON.stringify({ anonCache }));
		expect(anonCache).toEqual([]);
	});

	it('R3: a queue sync keeps sending user A\'s queue with user B\'s session after B signs in', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.goOffline();
		await env.quiesce();
		f.updateTask(task(env, 'ua.t1').id, { text: 'ua.t1:1' });
		f.updateTask(task(env, 'ua.t2').id, { text: 'ua.t2:1' });
		await env.quiesce();
		await f.createTask(createValues('ua.t3:0')); // offline: local task + queued create
		await env.quiesce();
		env.goOnline(); // A's sync starts its queue flush: PATCH t1 goes out
		await env.quiesce();
		processNow(env, 'PATCH', /\/api\/tasks\/[^/]+$/); // server applies it; the answer is slow
		env.signOut({ clear: false, confirmYes: false });
		await env.quiesce();
		await answer(env, 'POST', '/api/auth/sign-out');
		env.signIn('ub');
		await env.quiesce();
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/); // A's first flush answer arrives; the flush goes on
		await answerAll(env);
		const sent = env.server.log.filter((e) => e.kind !== '401').map((e) => `${e.kind}:${e.user}:${e.text ?? e.url}`);
		const r = {
			sent,
			aQueue: queueOf(env, 'ua').map((m) => m.type),
			aServer: env.server.liveTasksOf('ua').map((t) => t.text),
			bServer: env.server.liveTasksOf('ub').map((t) => t.text)
		};
		console.log('R3', JSON.stringify(r));
		expect(r.bServer.filter((t) => t.startsWith('ua.'))).toEqual([]);
		expect([...r.aServer, ...queueOf(env, 'ua').map((m) => m.patch?.text ?? m.payload?.text)]).toContain('ua.t2:1');
	});

	it('R4: a queued task edit is dropped without a conflict after a queue sync reverted it on the board', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.goOffline();
		await env.quiesce();
		const t1 = task(env, 'ua.t1');
		f.toggleSubtask(t1.id, t1.subtasks[0].id); // queued checklist.patch
		f.updateTask(t1.id, { text: 'ua.t1:1' }); // queued task.patch
		await env.quiesce();
		env.goOnline();
		await env.quiesce();
		await answer(env, 'PATCH', /\/checklist\//); // flush: checklist edit lands
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/, 503); // flush: title edit refused for now, stays queued
		const boardTitleAfterPartialSync = task(env, 'ua.t1')?.text;
		const queuedAfterPartialSync = queueOf(env, 'ua').map((m) => m.patch?.text);
		f.updateTask(task(env, 'ua.t1').id, { priority: 'high' });
		await env.quiesce();
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/); // the priority edit lands
		const queuedAfterPriority = queueOf(env, 'ua').map((m) => m.patch?.text);
		env.runServerSync();
		await answerAll(env);
		const r = {
			boardTitleAfterPartialSync,
			queuedAfterPartialSync,
			queuedAfterPriority,
			serverTitle: serverTask(env, 'ua', 'ua.t1').text,
			conflicts: conflictsShown(env)
		};
		console.log('R4', JSON.stringify(r));
		// The title edit reaches the server, or the user is told it did not.
		expect(r.serverTitle === 'ua.t1:1' || r.conflicts.length > 0).toBe(true);
	});

	it('R4b: same, when a late sync snapshot reverted the queued edit on the board', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.runServerSync();
		await env.quiesce();
		processNow(env, 'GET', '/api/tasks'); // a snapshot from before the edit below
		f.updateTask(task(env, 'ua.t2').id, { priority: 'high' });
		await env.quiesce();
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/, 503); // queued
		await answer(env, 'GET', '/api/tasks'); // the older snapshot reverts the board
		const boardPriority = task(env, 'ua.t2').priority;
		f.updateTask(task(env, 'ua.t2').id, { text: 'ua.t2:1' });
		await env.quiesce();
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const s = serverTask(env, 'ua', 'ua.t2');
		const r = { boardPriority, server: `${s.text}/${s.priority}`, conflicts: conflictsShown(env) };
		console.log('R4b', JSON.stringify(r));
		expect(s.priority === 'high' || r.conflicts.length > 0).toBe(true);
	});

	it('R5: a queued task edit meets a 409 after the same user\'s own checklist edit of the task lands', async () => {
		const env = await boot();
		const f = env.app.facade;
		const t1 = task(env, 'ua.t1');
		f.updateTask(t1.id, { text: 'ua.t1:1' });
		await env.quiesce();
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/, 503); // queued at the version it started from
		f.toggleSubtask(t1.id, t1.subtasks[0].id);
		await env.quiesce();
		await answer(env, 'PATCH', /\/checklist\//); // lands, task version +1
		env.runServerSync();
		await answerAll(env);
		const r = {
			server409: env.server.log.filter((e) => e.kind === '409').length,
			conflicts: conflictsShown(env),
			serverTitle: serverTask(env, 'ua', 'ua.t1').text
		};
		console.log('R5', JSON.stringify(r));
		if (process.env.REPRO_TRACE) console.log(env.trace.join('\n'), JSON.stringify(env.server.log, null, 0), JSON.stringify(env.consoleErrors));
		expect(r.conflicts).toEqual([]);
		expect(r.serverTitle).toBe('ua.t1:1');
	});

	it('R5b: deleting a task while the queue sync sends its queued edit meets a 409, and the task stays', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.goOffline();
		await env.quiesce();
		f.updateTask(task(env, 'ua.t1').id, { priority: 'high' });
		await env.quiesce();
		env.goOnline();
		await env.quiesce(); // flush: PATCH t1 out
		f.deleteTaskCascade(task(env, 'ua.t1').id); // chain: DELETE t1 expecting the version before the PATCH
		await env.quiesce();
		const patch = pending(env, 'PATCH', /\/api\/tasks\/[^/]+$/);
		env.resolveRequest(patch, 'ok');
		await env.quiesce();
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const r = { conflicts: conflictsShown(env), t1OnServer: Boolean(serverTask(env, 'ua', 'ua.t1')), t1OnBoard: Boolean(task(env, 'ua.t1')) };
		console.log('R5b', JSON.stringify(r));
		expect(r.t1OnServer).toBe(false);
	});

	it('R6: a queue sync sends its stale copy of a queued edit after a newer edit of the task landed', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.goOffline();
		await env.quiesce();
		const t1 = task(env, 'ua.t1');
		f.renameSubtask(t1.id, t1.subtasks[0].id, 'ua.i1~1'); // queued checklist.patch
		f.updateTask(t1.id, { text: 'ua.t1:1' }); // queued task.patch
		await env.quiesce();
		env.goOnline();
		await env.quiesce(); // flush: checklist PATCH out
		f.updateTask(task(env, 'ua.t1').id, { text: 'ua.t1:2' });
		await env.quiesce();
		await answer(env, 'PATCH', /\/api\/tasks\/[^/]+$/); // the newer title lands (chain)
		await answer(env, 'PATCH', /\/checklist\//); // flush goes on with its copy of the older title
		await answerAll(env);
		const titles = env.server.log.filter((e) => e.kind === 'patch').map((e) => e.text);
		const r = { titlesWritten: titles, serverTitle: serverTask(env, 'ua', 'ua.t1').text, conflicts: conflictsShown(env) };
		console.log('R6', JSON.stringify(r));
		expect(r.serverTitle).toBe('ua.t1:2');
	});

	it('R6b: renaming a checklist item while the queue sync sends its queued create is dropped', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.goOffline();
		await env.quiesce();
		f.addSubtask(task(env, 'ua.t1').id, 'ua.i9~0'); // queued checklist.create
		await env.quiesce();
		env.goOnline();
		await env.quiesce(); // flush: POST checklist out
		const item = task(env, 'ua.t1').subtasks.find((s) => s.text === 'ua.i9~0');
		f.renameSubtask(task(env, 'ua.t1').id, item.id, 'ua.i9~1');
		await env.quiesce();
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const items = serverTask(env, 'ua', 'ua.t1').subtasks.map((s) => s.text);
		const warn = env.consoleErrors.filter(([, , m]) => m.includes('raced')).map(([, , m]) => m);
		console.log('R6b', JSON.stringify({ items, warn }));
		expect(items).toContain('ua.i9~1');
	});

	it('R7: a drain (pagehide, or the sign-out wait timing out) loses the edit of a new checklist item an earlier answer wiped from the board', async () => {
		const env = await boot();
		const f = env.app.facade;
		const t2 = task(env, 'ua.t2');
		f.deleteSubtask(t2.id, t2.subtasks[0].id); // chain: DELETE out
		f.addSubtask(t2.id, 'ua.i9~0'); // chain: create waits
		await env.quiesce();
		const local = task(env, 'ua.t2').subtasks.find((s) => s.text === 'ua.i9~0');
		f.toggleSubtask(t2.id, local.id); // chain: check waits
		await env.quiesce();
		await answer(env, 'DELETE', /\/checklist\//); // answer merges the server copy: the new item leaves the board
		const boardItems = task(env, 'ua.t2').subtasks.map((s) => s.text);
		f.drainPendingTaskSyncsToOfflineQueue(); // pagehide; sign-out's 5 s timeout does the same on the PR branch
		const queued = queueOf(env, 'ua').map((m) => m.type);
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const item = serverTask(env, 'ua', 'ua.t2').subtasks.find((s) => s.text === 'ua.i9~0');
		console.log('R7', JSON.stringify({ boardItemsAfterDeleteAnswer: boardItems, queuedByDrain: queued, serverItem: item }));
		expect(item?.done).toBe(true);
	});

	it('R8: a snapshot that already lists a task the queue sync just created leaves a permanent local duplicate', async () => {
		const env = await boot();
		const f = env.app.facade;
		env.runServerSync(); // sync 1: its GET /api/tasks stays out
		await env.quiesce();
		env.goOffline();
		await env.quiesce();
		await f.createTask(createValues('ua.t3:0')); // offline: local task + queued create
		await env.quiesce();
		env.goOnline(); // sync 2: flush sends the create
		await env.quiesce();
		processNow(env, 'POST', '/api/tasks'); // the server creates it; the answer is slow
		await answer(env, 'GET', '/api/tasks'); // sync 1's snapshot, read after the create, lands first
		await answer(env, 'POST', '/api/tasks'); // the flush maps the local task to the created one
		await answerAll(env);
		env.runServerSync();
		await answerAll(env);
		const copies = board(env).filter((t) => t.text === 'ua.t3:0').map((t) => t.id);
		console.log('R8', JSON.stringify({ copies, onServer: env.server.liveTasksOf('ua').filter((t) => t.text === 'ua.t3:0').length }));
		expect(copies.length).toBe(1);
	});
});
