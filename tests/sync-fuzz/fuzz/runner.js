import { get } from 'svelte/store';
import { Env, USERS, mulberry32, parseItemText, parseTaskText } from './harness.js';

const PRIORITIES = ['high', 'medium', 'low'];

export const ACTION_WEIGHTS = {
	editTitle: 8,
	editPriority: 5,
	addItem: 5,
	toggleItem: 5,
	renameItem: 5,
	deleteItem: 3,
	deleteTask: 2,
	createTask: 3,
	signOut: 3,
	signIn: 4,
	switchAccount: 1,
	offline: 2,
	online: 3,
	sync: 4,
	resolve: 30,
	timer: 3
};

export function generateActions(seed, length, weights = ACTION_WEIGHTS) {
	const rng = mulberry32(seed ^ 0x9e3779b9);
	const entries = Object.entries(weights);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	const actions = [];
	for (let i = 0; i < length; i++) {
		let r = rng() * total;
		let kind = entries[0][0];
		for (const [k, w] of entries) {
			if (r < w) {
				kind = k;
				break;
			}
			r -= w;
		}
		actions.push({ kind, a: Math.floor(rng() * 1e6), b: Math.floor(rng() * 1e6), c: Math.floor(rng() * 1e6) });
	}
	return actions;
}

function pick(list, n) {
	return list.length === 0 ? null : list[n % list.length];
}

function outcomeFor(n) {
	const r = n % 100;
	if (r < 55) return 'ok';
	if (r < 72) return 'network';
	if (r < 82) return 503;
	if (r < 88) return 429;
	return 401;
}

/**
 * Executes one action; returns a short description (or null when skipped).
 * @param {Env} env
 */
async function execute(env, action) {
	const { kind, a, b, c } = action;
	const app = env.app;
	const f = app.facade;
	const U = env.boardUser();
	const model = env.model;
	const storeTasks = () => get(f.tasks);
	const editableTasks = () => storeTasks().filter((t) => {
		const p = parseTaskText(t.text);
		if (!p || p.user !== U) return false;
		const mt = model.u(U).tasks.get(p.serial);
		return mt && !mt.deleted;
	});
	const modelOf = (t) => model.u(U).tasks.get(parseTaskText(t.text).serial);

	switch (kind) {
		case 'editTitle': {
			if (!U) return null;
			const t = pick(editableTasks(), a);
			if (!t) return null;
			const mt = modelOf(t);
			const kk = Math.max(mt.titleCounter ?? 0, mt.title.k) + 1;
			mt.titleCounter = kk;
			f.updateTask(t.id, { text: `${U}.t${mt.serial}:${kk}` });
			mt.title = { k: kk, strict: true };
			mt.loose = false;
			return `editTitle ${U}.t${mt.serial} -> ${kk}`;
		}
		case 'editPriority': {
			if (!U) return null;
			const t = pick(editableTasks(), a);
			if (!t) return null;
			const mt = modelOf(t);
			const p = PRIORITIES[b % 3];
			f.updateTask(t.id, { priority: p });
			mt.priority = { v: p, strict: true };
			mt.loose = false;
			return `editPriority ${U}.t${mt.serial} -> ${p}`;
		}
		case 'addItem': {
			if (!U) return null;
			const t = pick(editableTasks(), a);
			if (!t) return null;
			const mt = modelOf(t);
			const it = model.newItem(U, mt);
			f.addSubtask(t.id, `${U}.i${it.serial}~0`);
			mt.loose = false;
			return `addItem ${U}.t${mt.serial} +i${it.serial}`;
		}
		case 'toggleItem':
		case 'renameItem':
		case 'deleteItem': {
			if (!U) return null;
			const t = pick(editableTasks().filter((x) => x.subtasks.length > 0), a);
			if (!t) return null;
			const mt = modelOf(t);
			const items = t.subtasks.filter((s) => {
				const p = parseItemText(s.text);
				return p && p.user === U && mt.items.has(p.serial) && !mt.items.get(p.serial).deleted;
			});
			const item = pick(items, b);
			if (!item) return null;
			const mi = mt.items.get(parseItemText(item.text).serial);
			mt.loose = false;
			mi.loose = false;
			if (kind === 'toggleItem') {
				f.toggleSubtask(t.id, item.id);
				const after = storeTasks().find((x) => x.id === t.id)?.subtasks.find((s) => s.id === item.id);
				mi.done = { v: Boolean(after?.done), strict: true };
				return `toggleItem ${U}.t${mt.serial}.i${mi.serial} -> ${mi.done.v}`;
			}
			if (kind === 'renameItem') {
				mi.counter = Math.max(mi.counter ?? 0, mi.text.k) + 1;
				f.renameSubtask(t.id, item.id, `${U}.i${mi.serial}~${mi.counter}`);
				mi.text = { k: mi.counter, strict: true };
				return `renameItem ${U}.t${mt.serial}.i${mi.serial} -> ${mi.counter}`;
			}
			f.deleteSubtask(t.id, item.id);
			mi.deleted = true;
			return `deleteItem ${U}.t${mt.serial}.i${mi.serial}`;
		}
		case 'deleteTask': {
			if (!U) return null;
			const t = pick(editableTasks(), a);
			if (!t) return null;
			const mt = modelOf(t);
			f.deleteTaskCascade(t.id);
			mt.deleted = true;
			mt.loose = false;
			return `deleteTask ${U}.t${mt.serial}`;
		}
		case 'createTask': {
			if (!U) return null;
			const mt = model.newTask(U, { created: 'pending' });
			const user = U;
			env.startFlow('create', async () => {
				const r = await f.createTask({
					text: `${user}.t${mt.serial}:0`, priority: 'medium', urgency: 'normal', category: '',
					startDate: '2026-10-01', endDate: '2026-10-02', parentId: null
				});
				mt.created = r.ok ? 'yes' : 'no';
				return r;
			});
			return `createTask ${U}.t${mt.serial}`;
		}
		case 'signOut': {
			if (!env.sessionUser || env.signingOut) return null;
			const clear = a % 2 === 0;
			const confirmYes = b % 2 === 0;
			env.signOut({ clear, confirmYes });
			return `signOut ${env.sessionUser} clear=${clear} confirm=${confirmYes}`;
		}
		case 'signIn': {
			if (env.sessionUser || env.signingOut || !env.online) return null;
			const user = USERS[a % USERS.length];
			env.signIn(user);
			return `signIn ${user}`;
		}
		case 'switchAccount': {
			if (!env.sessionUser || env.signingOut || !env.online) return null;
			const user = USERS.find((x) => x !== env.sessionUser);
			env.signIn(user);
			return `switchAccount -> ${user}`;
		}
		case 'offline': {
			if (!env.online) return null;
			env.goOffline();
			return 'offline';
		}
		case 'online': {
			if (env.online) return null;
			env.goOnline();
			return 'online';
		}
		case 'sync': {
			if (!env.online) return null;
			env.refetchSession();
			if (!env.sessionUser) return null;
			env.runServerSync();
			return `sync ${env.sessionUser}`;
		}
		case 'resolve': {
			const req = pick(env.pending, a);
			if (!req) return null;
			const outcome = req.early ? 'early' : outcomeFor(b);
			env.resolveRequest(req, outcome);
			return `resolve #${req.seq} ${req.method} ${req.url} -> ${outcome}${req.early ? `(${req.early.status})` : ''}`;
		}
		case 'timer': {
			const t = env.timers[0];
			if (!t) return null;
			env.fireTimer(t);
			return 'timer 5s';
		}
		default:
			return null;
	}
}

// ---------------------------------------------------------------- checks
function mutationUser(env, mutation) {
	const texts = [];
	if (mutation.payload?.text) texts.push(parseTaskText(mutation.payload.text)?.user);
	if (mutation.patch?.text) texts.push(parseTaskText(mutation.patch.text)?.user ?? parseItemText(mutation.patch.text)?.user);
	if (mutation.text) texts.push(parseItemText(mutation.text)?.user);
	if (mutation.taskId) texts.push(env.server.tasks.get(mutation.taskId)?.owner);
	return texts.filter(Boolean);
}

export function checkStep(env) {
	const owner = env.scope ?? null;
	const store = get(env.app.facade.tasks);
	for (const t of store) {
		const p = parseTaskText(t.text);
		if (!p) {
			env.violate('I2', 'store-unparseable', { owner, text: t.text });
		} else if (owner && p.user !== owner) {
			env.violate('I2', 'store-foreign', { owner, text: t.text, id: t.id });
		} else if (!owner) {
			env.notes.add(`anon-store:${t.text}`);
		}
		if (p && owner === p.user) {
			const mt = env.model.u(p.user).tasks.get(p.serial);
			if (mt && mt.deleted && !mt.loose && !env.reportedResurrect.has(`${p.user}.${p.serial}`)) {
				env.reportedResurrect.add(`${p.user}.${p.serial}`);
				env.violate('I3', 'store-resurrect-task', { owner, text: t.text });
			}
			if (mt) {
				for (const s of t.subtasks) {
					const ip = parseItemText(s.text);
					const mi = ip && mt.items.get(ip.serial);
					if (mi && mi.deleted && !mi.loose && !env.reportedResurrect.has(`${p.user}.i${ip.serial}`)) {
						env.reportedResurrect.add(`${p.user}.i${ip.serial}`);
						env.violate('I3', 'store-resurrect-item', { owner, task: t.text, item: s.text });
					}
				}
			}
		}
	}
	for (const [key, raw] of env.storage) {
		if (key.startsWith('kanbanTasks:')) {
			const cacheOwner = key.slice('kanbanTasks:'.length);
			let list = [];
			try {
				list = JSON.parse(raw);
			} catch {
				continue;
			}
			for (const t of list) {
				const p = parseTaskText(t.text);
				if (cacheOwner === 'anonymous') {
					env.notes.add(`anon-cache:${t.text}`);
				} else if (!p || p.user !== cacheOwner) {
					env.violate('I2', 'cache-foreign', { cacheOwner, text: t.text });
				}
			}
		}
		if (key.startsWith('kanbanOfflineWriteQueue:')) {
			const queueOwner = key.slice('kanbanOfflineWriteQueue:'.length);
			let list = [];
			try {
				list = JSON.parse(raw);
			} catch {
				continue;
			}
			for (const m of list) {
				const users = mutationUser(env, m);
				if (queueOwner === 'anonymous') {
					env.notes.add(`anon-queue:${m.type}:${JSON.stringify(users)}`);
				} else if (users.some((u) => u !== queueOwner)) {
					env.violate('I2', 'queue-foreign', { queueOwner, mutation: m });
				}
			}
		}
	}
}

async function drainAll(env) {
	env.autoResolve = true;
	for (let i = 0; i < 60; i++) {
		for (const req of [...env.pending]) env.resolveRequest(req, 'ok');
		for (const t of [...env.timers]) env.fireTimer(t);
		await env.quiesce();
		if (env.pending.length === 0 && env.timers.length === 0 && env.activeFlows().length === 0) return true;
	}
	env.violate('HANG', 'drain-did-not-quiesce', { pending: env.pending.length, flows: env.activeFlows().map((f) => f.name) });
	return false;
}

function queueOf(env, user) {
	const raw = env.storage.get(`kanbanOfflineWriteQueue:${user}`);
	return raw ? JSON.parse(raw) : [];
}

export async function finalCheck(env) {
	await drainAll(env);
	if (!env.online) {
		env.goOnline();
		await drainAll(env);
	}
	env.finalPhase = true;
	const storeByUser = new Map();
	for (const user of USERS) {
		if (env.sessionUser !== user) {
			if (env.sessionUser) {
				env.signOut({ clear: false, confirmYes: false });
				await drainAll(env);
			}
			env.signIn(user);
			await drainAll(env);
		} else {
			env.runServerSync();
			await drainAll(env);
		}
		for (let i = 0; i < 4 && queueOf(env, user).length > 0; i++) {
			env.runServerSync();
			await drainAll(env);
		}
		// one more to make sure the snapshot applied
		env.runServerSync();
		await drainAll(env);
		const q = queueOf(env, user);
		if (q.length > 0) env.violate('I1', 'queue-stuck', { user, queue: q });
		storeByUser.set(user, get(env.app.facade.tasks));
	}
	const anon = queueOf(env, 'anonymous');
	if (anon.length > 0) env.violate('I1', 'anon-queue-orphan', { queue: anon });

	for (const user of USERS) {
		checkUserAgainstServer(env, user, storeByUser.get(user));
	}
	// Server history checks
	const lastTitleK = new Map();
	const lastItemK = new Map();
	for (const e of env.server.log) {
		if (e.kind === '409') {
			env.violate('I4', 'server-409', e);
		}
		if (e.kind === 'patch' && typeof e.body?.text === 'string') {
			const p = parseTaskText(e.text);
			if (p) {
				const key = `${p.user}.t${p.serial}`;
				const prev = lastTitleK.get(key);
				if (prev !== undefined && p.k < prev) env.violate('I3', 'server-title-regressed', { key, from: prev, to: p.k, seq: e.seq, step: e.step });
				lastTitleK.set(key, Math.max(prev ?? -1, p.k));
			}
		}
		if (e.kind === 'item-patch' && typeof e.body?.text === 'string') {
			const p = parseItemText(e.text);
			if (p) {
				const key = `${p.user}.i${p.serial}`;
				const prev = lastItemK.get(key);
				if (prev !== undefined && p.k < prev) env.violate('I3', 'server-item-text-regressed', { key, from: prev, to: p.k, seq: e.seq, step: e.step });
				lastItemK.set(key, Math.max(prev ?? -1, p.k));
			}
		}
	}
	if (!env.violations.some((v) => v.inv === 'I4' && v.kind === 'conflict-banner') && !env.violations.some((v) => v.inv === 'I2')) {
		const silent = env.violations.filter((v) => v.inv === 'I1');
		for (const k of new Set(silent.map((v) => v.kind))) env.violate('SILENT', k, silent.find((v) => v.kind === k).detail);
	}
	for (const [, , msg] of env.consoleErrors) {
		if (msg.includes('Failed to run task sync operation')) env.violate('CRASH', 'chain-op-threw', { msg });
	}
}

function checkUserAgainstServer(env, user, storeTasks) {
	const live = env.server.liveTasksOf(user);
	const bySerial = new Map();
	for (const t of live) {
		const p = parseTaskText(t.text);
		if (!p || p.user !== user) {
			env.violate('I2', 'server-foreign-task', { user, text: t.text });
			continue;
		}
		if (!bySerial.has(p.serial)) bySerial.set(p.serial, []);
		bySerial.get(p.serial).push(t);
	}
	const m = env.model.u(user);
	for (const [serial, t] of bySerial) {
		if (!m.tasks.has(serial)) env.violate('I1', 'server-unknown-task', { user, serial });
	}
	for (const mt of m.tasks.values()) {
		const srv = bySerial.get(mt.serial) ?? [];
		const name = `${user}.t${mt.serial}`;
		if (mt.created === 'pending') {
			env.violate('HANG', 'create-never-finished', { name });
			continue;
		}
		if (mt.created === 'no') {
			if (srv.length > 0) env.violate('I3', 'refused-create-exists', { name });
			continue;
		}
		if (srv.length > 1) env.violate('I3', 'duplicate-task', { name, count: srv.length });
		if (mt.deleted) {
			if (srv.length > 0 && !mt.loose) env.violate('I1', 'deleted-task-exists', { name });
			continue;
		}
		if (srv.length === 0) {
			if (!mt.loose) env.violate('I1', 'task-missing', { name });
			continue;
		}
		const s = srv[0];
		const p = parseTaskText(s.text);
		if (mt.title.strict && p.k !== mt.title.k) env.violate('I1', 'title-mismatch', { name, server: p.k, intended: mt.title.k });
		if (mt.priority.strict && s.priority !== mt.priority.v) env.violate('I1', 'priority-mismatch', { name, server: s.priority, intended: mt.priority.v });
		const itemsBySerial = new Map();
		for (const it of s.subtasks) {
			const ip = parseItemText(it.text);
			if (!ip || ip.user !== user) {
				env.violate('I2', 'server-foreign-item', { name, text: it.text });
				continue;
			}
			if (!itemsBySerial.has(ip.serial)) itemsBySerial.set(ip.serial, []);
			itemsBySerial.get(ip.serial).push(it);
		}
		for (const [iserial] of itemsBySerial) {
			if (!mt.items.has(iserial)) env.violate('I1', 'server-unknown-item', { name, iserial });
		}
		for (const mi of mt.items.values()) {
			const list = itemsBySerial.get(mi.serial) ?? [];
			const iname = `${name}.i${mi.serial}`;
			if (list.length > 1) env.violate('I3', 'duplicate-item', { iname, count: list.length });
			if (mi.deleted) {
				if (list.length > 0 && !mi.loose) env.violate('I1', 'deleted-item-exists', { iname });
				continue;
			}
			if (list.length === 0) {
				if (!mi.loose) env.violate('I1', 'item-missing', { iname });
				continue;
			}
			const ip = parseItemText(list[0].text);
			if (mi.text.strict && ip.k !== mi.text.k) env.violate('I1', 'item-text-mismatch', { iname, server: ip.k, intended: mi.text.k });
			if (mi.done.strict && list[0].done !== mi.done.v) env.violate('I1', 'item-done-mismatch', { iname, server: list[0].done, intended: mi.done.v });
		}
	}
	// store vs server after the final sync
	const norm = (t) => `${t.text}|${t.priority}|${t.subtasks.map((s) => `${s.text}:${s.done}`).sort().join(',')}`;
	const a = live.map(norm).sort();
	const b = (storeTasks ?? []).map(norm).sort();
	if (JSON.stringify(a) !== JSON.stringify(b)) {
		env.violate('DIVERGE', 'store-server-diverge', { user, server: a, store: b });
	}
}

// ---------------------------------------------------------------- run
export async function runScenario({ seed, root, actions, config, keepTrace = false }) {
	const env = new Env({ seed, root, config });
	env.traceRequests = keepTrace;
	env.stats = {};
	env.notes = new Set();
	env.reportedResurrect = new Set();
	await env.install();
	// seed: each user has two tasks on the server, one checklist item each
	for (const user of USERS) {
		for (let i = 0; i < 2; i++) {
			const mt = env.model.newTask(user);
			const mi = env.model.newItem(user, mt);
			env.server.seedTask(user, `${user}.t${mt.serial}:0`, 'medium', [`${user}.i${mi.serial}~0`]);
		}
	}
	env.server.log = [];
	// start signed in as the first user
	env.cachedAuthScope = env.app.readCachedAuthScope();
	env.signIn(USERS[0]);
	await env.quiesce();
	for (let i = 0; i < actions.length; i++) {
		env.step = i;
		let desc = null;
		const traceMark = env.trace.length;
		env.currentAction = actions[i];
		env.sendsInAction = 0;
		try {
			desc = await execute(env, actions[i]);
		} catch (error) {
			env.violate('CRASH', 'action-threw', { action: actions[i], error: String(error?.stack ?? error) });
		}
		if (desc) {
			const key = desc.startsWith('resolve') ? `resolve:${desc.split('-> ')[1]?.split('(')[0]}` : desc.startsWith('signOut') ? `signOut:${desc.includes('clear=true') ? 'clear' : 'keep'}` : actions[i].kind;
			env.stats[key] = (env.stats[key] ?? 0) + 1;
		}
		if (keepTrace && desc) env.trace.splice(traceMark, 0, `${i}: ${desc}`);
		await env.quiesce();
		if (keepTrace && desc && process.env.FUZZ_DUMPQ) {
			for (const [k, v] of env.storage) if (k.startsWith('kanbanOfflineWriteQueue:')) env.trace.push(`      Q[${k.slice(24)}] ${JSON.parse(v).map((m) => `${m.type}(${(m.taskId ?? m.localTaskId ?? '').slice(-2)}${m.itemId ? '/' + m.itemId.slice(-4) : ''}${m.localItemId ? '/L' : ''}) ${JSON.stringify(m.patch ?? m.payload?.text ?? m.text ?? '')}${m.done ? ' done' : ''}${m.expectedVersion ? ' ev' + m.expectedVersion : ''}`).join(' | ')}`);
			env.trace.push(`      S ${get(env.app.facade.tasks).map((t) => `${t.text}@v${t.version}[${t.subtasks.map((x) => `${x.text}${x.done ? '*' : ''}`).join(',')}]`).join(' ')}`);
		}
		checkStep(env);
	}
	env.step = actions.length;
	env.currentAction = null;
	await finalCheck(env);
	return env;
}
