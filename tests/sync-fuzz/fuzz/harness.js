// Model-based randomized tester for the client task store + user scope +
// offline write queue. loadApp() takes the checkout to test (see ../root.js
// and ../README.md); it adapts to checkouts with and without user-scope.js.
import { vi } from 'vitest';
import { get } from 'svelte/store';

export const USERS = ['ua', 'ub'];

export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function uuid(n) {
	return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

// ---------------------------------------------------------------- text ids
// Task title: `${user}.t${serial}:${k}`; checklist text: `${user}.i${serial}~${k}`
export function parseTaskText(text) {
	const m = /^([a-z]+)\.t(\d+):(\d+)$/.exec(text ?? '');
	return m ? { user: m[1], serial: Number(m[2]), k: Number(m[3]) } : null;
}
export function parseItemText(text) {
	const m = /^([a-z]+)\.i(\d+)~(\d+)$/.exec(text ?? '');
	return m ? { user: m[1], serial: Number(m[2]), k: Number(m[3]) } : null;
}

// ---------------------------------------------------------------- server
export class FakeServer {
	constructor(env) {
		this.env = env;
		this.nextId = 1;
		/** @type {Map<string, any>} */
		this.tasks = new Map();
		this.sessions = new Map();
		this.nextToken = 1;
		this.log = [];
	}
	newId() {
		return uuid(this.nextId++);
	}
	newSession(userId) {
		const token = `tok${this.nextToken++}`;
		this.sessions.set(token, { userId, valid: true });
		return token;
	}
	seedTask(owner, text, priority, items) {
		const id = this.newId();
		this.tasks.set(id, {
			id, owner, text, status: 'todo', priority, urgency: 'normal', category: '',
			startDate: '2026-10-01', endDate: '2026-10-02', parentId: null,
			subtasks: items.map((t) => ({ id: this.newId(), text: t, done: false })),
			version: 1, deleted: false, createdAt: 1
		});
		return id;
	}
	clientTask(t) {
		return {
			id: t.id, text: t.text, status: t.status, startDate: t.startDate, endDate: t.endDate,
			priority: t.priority, urgency: t.urgency, category: t.category, categoryId: null,
			parentId: t.parentId, subtasks: t.subtasks.map((s) => ({ ...s })), version: t.version,
			createdAt: t.createdAt
		};
	}
	liveTasksOf(user) {
		return [...this.tasks.values()].filter((t) => t.owner === user && !t.deleted);
	}
	record(entry) {
		this.log.push({ step: this.env.step, ...entry });
	}
	leak(kind, detail) {
		this.env.violate('I2', `server-${kind}`, detail);
	}
	/** @returns {{ status: number; body: any }} */
	handle(req) {
		const { url, method, body, token } = req;
		if (url === '/api/auth/sign-out') {
			const s = this.sessions.get(token);
			if (s) s.valid = false;
			return { status: 200, body: { success: true } };
		}
		const session = token ? this.sessions.get(token) : null;
		if (!session || !session.valid) {
			this.record({ kind: '401', url, method, seq: req.seq });
			return { status: 401, body: { message: 'Unauthorized' } };
		}
		const user = session.userId;
		if (method === 'GET' && url === '/api/tasks') {
			return { status: 200, body: { tasks: this.liveTasksOf(user).map((t) => this.clientTask(t)) } };
		}
		if (method === 'GET' && url === '/api/categories') return { status: 200, body: { categories: [] } };
		if (method === 'GET' && url === '/api/board/preferences') return { status: 200, body: { defaultView: 'kanban' } };
		if (method === 'POST' && url === '/api/tasks') {
			const p = body ?? {};
			const parsed = parseTaskText(p.text);
			if (!parsed || parsed.user !== user) this.leak('create-foreign', { user, text: p.text, seq: req.seq });
			const id = this.newId();
			const t = {
				id, owner: user, text: p.text, status: p.status ?? 'todo', priority: p.priority ?? 'medium',
				urgency: p.urgency ?? 'normal', category: p.category ?? '', startDate: p.startDate, endDate: p.endDate,
				parentId: null, subtasks: [], version: 1, deleted: false, createdAt: 2
			};
			this.tasks.set(id, t);
			this.record({ kind: 'create', user, id, text: p.text, seq: req.seq });
			return { status: 200, body: { task: this.clientTask(t) } };
		}
		let m = /^\/api\/tasks\/([^/]+)$/.exec(url);
		if (m) {
			const id = decodeURIComponent(m[1]);
			const t = this.tasks.get(id);
			if (t && t.owner !== user) this.leak('write-foreign-task', { user, owner: t.owner, url, method, seq: req.seq });
			if (!t || t.deleted || t.owner !== user) {
				this.record({ kind: '404', url, method, user, seq: req.seq, body });
				return { status: 404, body: { message: 'Task was not found.' } };
			}
			const ev = method === 'DELETE' ? body?.expectedVersion : body?.expectedVersion;
			if (typeof ev === 'number' && ev !== t.version) {
				this.record({ kind: '409', url, method, user, id, expected: ev, actual: t.version, seq: req.seq, body });
				return { status: 409, body: { message: 'stale' } };
			}
			if (method === 'DELETE') {
				t.deleted = true;
				t.version += 1;
				this.record({ kind: 'delete', user, id, text: t.text, seq: req.seq });
				return { status: 200, body: { deleted: 1 } };
			}
			if (method === 'PATCH') {
				const before = { text: t.text, priority: t.priority };
				for (const f of ['text', 'priority', 'status', 'urgency', 'startDate', 'endDate', 'category']) {
					if (body && f in body && body[f] !== undefined) t[f] = body[f];
				}
				if (body && typeof body.text === 'string') {
					const parsed = parseTaskText(body.text);
					if (!parsed || parsed.user !== user) this.leak('patch-foreign-text', { user, text: body.text });
				}
				t.version += 1;
				this.record({ kind: 'patch', user, id, before, text: t.text, priority: t.priority, version: t.version, seq: req.seq, body });
				return { status: 200, body: { task: this.clientTask(t) } };
			}
		}
		m = /^\/api\/tasks\/([^/]+)\/checklist(?:\/([^/]+))?$/.exec(url);
		if (m) {
			const id = decodeURIComponent(m[1]);
			const itemId = m[2] ? decodeURIComponent(m[2]) : null;
			const t = this.tasks.get(id);
			if (t && t.owner !== user) this.leak('write-foreign-task', { user, owner: t.owner, url, method, seq: req.seq });
			if (!t || t.deleted || t.owner !== user) {
				this.record({ kind: '404', url, method, user, seq: req.seq, body });
				return { status: 404, body: { message: 'Task was not found.' } };
			}
			if (method === 'POST' && !itemId) {
				const item = { id: this.newId(), text: body.text, done: false };
				const parsed = parseItemText(body.text);
				if (!parsed || parsed.user !== user) this.leak('item-foreign-text', { user, text: body.text });
				t.subtasks.push(item);
				t.version += 1;
				this.record({ kind: 'item-create', user, id, itemId: item.id, text: item.text, seq: req.seq });
				return { status: 200, body: { task: this.clientTask(t) } };
			}
			const item = t.subtasks.find((s) => s.id === itemId);
			if (!item) {
				this.record({ kind: '404-item', url, method, user, seq: req.seq, body });
				return { status: 404, body: { message: 'Checklist item was not found.' } };
			}
			if (method === 'PATCH') {
				const before = { text: item.text, done: item.done };
				if (typeof body.text === 'string') item.text = body.text;
				if (typeof body.done === 'boolean') item.done = body.done;
				t.version += 1;
				this.record({ kind: 'item-patch', user, id, itemId, before, text: item.text, done: item.done, seq: req.seq, body });
				return { status: 200, body: { task: this.clientTask(t) } };
			}
			if (method === 'DELETE') {
				t.subtasks = t.subtasks.filter((s) => s !== item);
				t.version += 1;
				this.record({ kind: 'item-delete', user, id, itemId, text: item.text, seq: req.seq });
				return { status: 200, body: { task: this.clientTask(t) } };
			}
		}
		return { status: 400, body: { message: `unhandled ${method} ${url}` } };
	}
}

// ---------------------------------------------------------------- app adapter
export async function loadApp(root) {
	vi.resetModules();
	const facade = await import(/* @vite-ignore */ `${root}/src/lib/client/task-store.js`);
	let scope;
	try {
		scope = await import(/* @vite-ignore */ `${root}/src/lib/client/user-scope.js`);
	} catch {
		scope = null;
	}
	const queue = await import(/* @vite-ignore */ `${root}/src/lib/client/offline-write-queue.js`);
	if (scope) {
		return {
			variant: 'head',
			facade,
			queue,
			applyUserScope: scope.applyUserScope,
			cacheAuthScope: scope.cacheAuthScope,
			readCachedAuthScope: scope.readCachedAuthScope,
			clearCachedAuthScope: scope.clearCachedAuthScope,
			// Only the sign-out wait of the sync-hardening WIP has it; without
			// it, sign-out does not wait for task writes (as on main).
			settle: facade.settlePendingTaskSyncs ? (ms) => facade.settlePendingTaskSyncs({ timeoutMs: ms }) : null,
			countPending: scope.countPendingLocalChanges,
			clearUserLocalData: scope.clearUserLocalData,
			clearPendingDefaultView: facade.clearPendingDefaultView
		};
	}
	// origin/main: App.svelte applyStorageScope + AuthAccountControls (no settle)
	const authScope = await import(/* @vite-ignore */ `${root}/src/lib/client/auth-session-scope.js`);
	const categoryStore = await import(/* @vite-ignore */ `${root}/src/lib/client/task-store/category-store.js`);
	let scopedUserId = null;
	return {
		variant: 'main',
		facade,
		queue,
		applyUserScope(userId) {
			if (userId === scopedUserId) return;
			scopedUserId = userId;
			facade.setTaskStorageOwner(userId);
			queue.setOfflineQueueOwner(userId);
			categoryStore.clearCategoryCatalog();
		},
		cacheAuthScope: authScope.cacheAuthScope,
		readCachedAuthScope: authScope.readCachedAuthScope,
		clearCachedAuthScope: authScope.clearCachedAuthScope,
		settle: null,
		countPending: () => queue.getOfflineQueueSize(),
		clearUserLocalData() {
			queue.clearOfflineWriteQueue();
			facade.clearLocalTaskCache();
		},
		clearPendingDefaultView: () => {}
	};
}

// ---------------------------------------------------------------- env
export class Env {
	constructor({ seed, root, config = {} }) {
		this.seed = seed;
		this.root = root;
		this.rng = mulberry32(seed);
		this.config = { pEarly: 0.3, ...config };
		this.step = 0;
		this.violations = [];
		this.pending = [];
		this.timers = [];
		this.flows = [];
		this.reqSeq = 0;
		this.online = true;
		this.cookie = null;
		this.sessionUser = null; // App's $session.data.user?.id
		this.cachedAuthScope = null;
		this.syncedSessionUserId = null;
		this.scope = undefined; // last applyUserScope arg
		this.signingOut = null; // { user, pastConfirm }
		this.conflictsShown = [];
		this.consoleErrors = [];
		this.trace = [];
		this.server = new FakeServer(this);
		this.model = new Model(this);
		this.storage = new Map();
	}
	violate(inv, kind, detail) {
		this.violations.push({ inv, kind, step: this.step, detail });
	}
	async install() {
		const storage = this.storage;
		vi.stubGlobal('localStorage', {
			getItem: (k) => (storage.has(k) ? storage.get(k) : null),
			setItem: (k, v) => storage.set(k, String(v)),
			removeItem: (k) => storage.delete(k)
		});
		vi.stubGlobal('window', { confirm: () => true });
		vi.stubGlobal('navigator', { onLine: true });
		const env = this;
		vi.stubGlobal('fetch', (url, init = {}) => env.fetch(url, init));
		const realSetTimeout = globalThis.setTimeout;
		const realClearTimeout = globalThis.clearTimeout;
		this.realSetTimeout = realSetTimeout;
		vi.stubGlobal('setTimeout', (cb, ms, ...args) => {
			if (ms === 5000) {
				const t = { id: Symbol('timer'), cb, args, fired: false, cleared: false };
				env.timers.push(t);
				return t;
			}
			return realSetTimeout(cb, ms, ...args);
		});
		vi.stubGlobal('clearTimeout', (t) => {
			if (t && typeof t === 'object' && 'fired' in t) {
				t.cleared = true;
				env.timers = env.timers.filter((x) => x !== t);
				return;
			}
			return realClearTimeout(t);
		});
		const errors = this.consoleErrors;
		vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(['error', env.step, a.map(String).join(' ')]));
		vi.spyOn(console, 'warn').mockImplementation((...a) => errors.push(['warn', env.step, a.map(String).join(' ')]));
		this.app = await loadApp(this.root);
	}
	fetch(url, init) {
		const method = init.method ?? 'GET';
		let body;
		try {
			body = init.body ? JSON.parse(init.body) : undefined;
		} catch {
			body = undefined;
		}
		const req = { seq: ++this.reqSeq, url, method, body, token: this.cookie, sentStep: this.step };
		if (this.traceRequests) {
			const tokUser = this.cookie ? this.server.sessions.get(this.cookie)?.userId : null;
			this.trace.push(`   -> #${req.seq} ${method} ${url} ${body ? JSON.stringify(body) : ''} [cookie:${tokUser ?? '-'}]${this.online ? '' : ' OFFLINE'}`);
		}
		if (!this.online) {
			return Promise.reject(new TypeError('Failed to fetch (offline)'));
		}
		return new Promise((resolve, reject) => {
			req.resolve = resolve;
			req.reject = reject;
			if (this.autoResolve) {
				this.deliver(req, this.server.handle(req));
				return;
			}
			const c = (this.currentAction?.c ?? Math.floor(this.rng() * 1e6)) + 7919 * (this.sendsInAction = (this.sendsInAction ?? 0) + 1);
			if ((c % 1000) < this.config.pEarly * 1000) {
				req.early = this.server.handle(req);
				if (this.traceRequests) this.trace.push(`      (#${req.seq} processed at send: ${req.early.status})`);
			}
			this.pending.push(req);
		});
	}
	deliver(req, res) {
		req.resolve({ ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body });
	}
	resolveRequest(req, outcome) {
		this.pending = this.pending.filter((r) => r !== req);
		if (req.early) {
			this.deliver(req, req.early);
			return;
		}
		if (outcome === 'ok') {
			this.deliver(req, this.server.handle(req));
		} else if (outcome === 'network') {
			req.reject(new TypeError('Failed to fetch'));
		} else {
			this.deliver(req, { status: outcome, body: { message: `forced ${outcome}` } });
		}
	}
	fireTimer(t) {
		this.timers = this.timers.filter((x) => x !== t);
		t.fired = true;
		t.cb(...t.args);
	}
	startFlow(name, fn) {
		const flow = { name, done: false, step: this.step };
		flow.promise = Promise.resolve()
			.then(fn)
			.then(
				(r) => {
					flow.done = true;
					flow.result = r;
				},
				(e) => {
					flow.done = true;
					flow.error = e;
					this.violate('CRASH', 'flow-threw', { name, error: String(e?.stack ?? e) });
				}
			);
		this.flows.push(flow);
		return flow;
	}
	activeFlows(name) {
		return this.flows.filter((f) => !f.done && (!name || f.name === name));
	}
	async quiesce() {
		for (let i = 0; i < 12; i++) {
			await new Promise((r) => setImmediate(r));
		}
	}

	// ------------------------------------------------ App.svelte model
	applyScope(userId) {
		this.app.applyUserScope(userId);
		this.scope = userId;
	}
	appEffect() {
		const user = this.sessionUser;
		if (user) {
			const nextScope = this.app.cacheAuthScope({ id: user, email: null, name: null });
			this.cachedAuthScope = nextScope;
			this.applyScope(nextScope?.id ?? null);
			if (nextScope?.id && this.syncedSessionUserId !== nextScope.id) {
				this.syncedSessionUserId = nextScope.id;
				this.runServerSync();
			}
			return;
		}
		if (!this.online && this.cachedAuthScope?.id) {
			this.applyScope(this.cachedAuthScope.id);
			return;
		}
		this.app.clearCachedAuthScope();
		this.cachedAuthScope = null;
		this.syncedSessionUserId = null;
		this.applyScope(null);
	}
	runServerSync() {
		const owner = this.scope;
		return this.startFlow('sync', async () => {
			const result = await this.app.facade.syncServerTasks();
			if (result.offlineConflicts?.length) {
				this.conflictsShown.push({ step: this.step, owner, conflicts: result.offlineConflicts });
				this.violate('I4', 'conflict-banner', { owner, conflicts: result.offlineConflicts.map((c) => ({ type: c.type, taskId: c.taskId, patch: c.patch, ev: c.expectedVersion })) });
			}
			return result;
		});
	}
	sessionTokenValid() {
		const s = this.cookie ? this.server.sessions.get(this.cookie) : null;
		return s && s.valid ? s.userId : null;
	}
	refetchSession() {
		// better-auth refetch: offline keeps the old data
		if (!this.online) return;
		this.sessionUser = this.sessionTokenValid();
		this.appEffect();
	}
	unlocked() {
		return Boolean(this.sessionUser || (!this.online && this.cachedAuthScope?.id));
	}
	boardUser() {
		// the user whose board the UI shows and edits
		if (!this.unlocked()) return null;
		if (this.signingOut?.pastConfirm) return null;
		return this.scope ?? null;
	}

	signIn(user) {
		this.cookie = this.server.newSession(user);
		this.sessionUser = user;
		this.appEffect();
	}
	signOut({ clear, confirmYes }) {
		const user = this.sessionUser;
		const flowState = { user, pastConfirm: false };
		this.signingOut = flowState;
		return this.startFlow('signout', async () => {
			try {
				if (this.app.settle) {
					const settled = await this.app.settle(5000);
					if (this.stats && !settled) this.stats['settle:timeout'] = (this.stats['settle:timeout'] ?? 0) + 1;
				}
				const bump = (k) => { if (this.stats) this.stats[k] = (this.stats[k] ?? 0) + 1; };
				if (clear) {
					const n = this.app.countPending();
					if (n >= 1) {
						bump(n > this.app.queue.getOfflineQueueSize() ? 'dialog:counts-inflight' : 'dialog');
						if (!confirmYes) { bump('signout-cancelled'); return 'cancelled'; }
						flowState.consented = true;
					}
				}
				flowState.pastConfirm = true;
				let ok = false;
				try {
					const res = await fetch('/api/auth/sign-out', { method: 'POST' });
					ok = res.ok;
				} catch {
					ok = false;
				}
				if (!ok) return 'error';
				this.cookie = null;
				this.app.clearPendingDefaultView();
				if (clear) {
					this.app.clearUserLocalData();
					if (flowState.consented) this.model.consentClear(user, this.step);
					bump(flowState.consented ? 'clear:confirmed' : 'clear:no-dialog');
					this.trace.push(`   [clear local data of ${user}${flowState.consented ? ' (confirmed)' : ' (no dialog)'}]`);
				}
				this.sessionUser = null;
				this.appEffect();
				return 'signed-out';
			} finally {
				this.signingOut = null;
			}
		});
	}
	goOffline() {
		this.online = false;
		this.appEffect();
	}
	goOnline() {
		this.online = true;
		this.refetchSession();
		if (this.sessionUser) this.runServerSync();
	}
}

// ---------------------------------------------------------------- model
class Model {
	constructor(env) {
		this.env = env;
		this.users = new Map(USERS.map((u) => [u, { tasks: new Map(), nextTask: 1, nextItem: 1 }]));
	}
	u(user) {
		return this.users.get(user);
	}
	newTask(user, { created = 'yes' } = {}) {
		const m = this.u(user);
		const serial = m.nextTask++;
		const t = { serial, created, deleted: false, loose: false, title: { k: 0, strict: true }, priority: { v: 'medium', strict: true }, items: new Map() };
		m.tasks.set(serial, t);
		return t;
	}
	newItem(user, task) {
		const m = this.u(user);
		const serial = m.nextItem++;
		const it = { serial, deleted: false, loose: false, text: { k: 0, strict: true }, done: { v: false, strict: true } };
		task.items.set(serial, it);
		return it;
	}
	consentClear(user, step) {
		for (const t of this.u(user).tasks.values()) {
			t.loose = true;
			t.title.strict = false;
			t.priority.strict = false;
			for (const it of t.items.values()) {
				it.loose = true;
				it.text.strict = false;
				it.done.strict = false;
			}
		}
	}
	clearedAt() {}
}
