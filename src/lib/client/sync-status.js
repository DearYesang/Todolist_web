import { get, readonly, writable } from 'svelte/store';
import { createDatedFilename, downloadJson } from './download.js';
import {
	createOfflineConflictReport,
	describeServerSyncResult,
	resolveLocalConflict
} from './offline-conflicts.js';
import {
	deleteTaskCascade,
	flushPendingViewPreference,
	syncServerTasks,
	tasks,
	updateTask
} from './task-store.js';

/**
 * Server sync as the app starts it, and what the sync banner shows about
 * it: SyncNoticeBanner renders the store and calls the conflict actions,
 * AppHeader starts a refresh, and App.svelte syncs when the session
 * changes or the browser comes back online.
 *
 * @typedef {import('./offline-conflicts.js').OfflineConflictSummary} OfflineConflictSummary
 *
 * @typedef {{
 *   notice: string | null;
 *   conflicts: OfflineConflictSummary[];
 *   detailsOpen: boolean;
 *   isRefreshing: boolean;
 * }} SyncStatus
 */

/** @type {import('svelte/store').Writable<SyncStatus>} */
const status = writable({
	notice: null,
	conflicts: [],
	detailsOpen: false,
	isRefreshing: false
});

/** The banner's notice and offline conflicts, and whether a refresh runs. */
export const syncStatus = readonly(status);

const online = writable(true);

/**
 * Whether the browser is online, as App.svelte last read it (on mount and
 * on the online and offline events) or a refresh found it. It unlocks the
 * cached board offline.
 */
export const isOnline = readonly(online);

/** @param {boolean} value */
export function setOnline(value) {
	online.set(value);
}

/** @param {Partial<SyncStatus>} changes */
function patchStatus(changes) {
	status.update((current) => ({ ...current, ...changes }));
}

/** @param {string} notice */
export function showNotice(notice) {
	patchStatus({ notice });
}

export function dismissNotice() {
	patchStatus({ notice: null });
}

/**
 * Sends a default view chosen offline, syncs the tasks with the server
 * and shows the outcome. For a signed-in user: every caller has checked
 * the session first.
 * @param {{ showSuccess?: boolean }} [options] showSuccess: true for a
 *   manual 새로고침, which also reports a sync that went through
 */
export async function runServerSync({ showSuccess = false } = {}) {
	await flushPendingViewPreference({ signedIn: true });
	const result = await syncServerTasks();
	handleServerSyncResult(result, { showSuccess });
}

/**
 * @param {Awaited<ReturnType<typeof syncServerTasks>>} result
 * @param {{ showSuccess?: boolean }} options
 */
function handleServerSyncResult(result, { showSuccess = false } = {}) {
	const update = describeServerSyncResult(result, get(tasks), { showSuccess });
	/** @type {Partial<SyncStatus>} */
	const changes = {};
	if (update.conflicts) {
		changes.conflicts = update.conflicts;
		if (update.conflicts.length > 0) {
			changes.detailsOpen = false;
		}
	}
	if ('notice' in update) {
		changes.notice = update.notice ?? null;
	}
	patchStatus(changes);
}

/**
 * The header's 새로고침: checks the session again, then syncs and says how
 * it went. Does nothing while a refresh runs.
 * @param {{
 *   refetchSession: () => Promise<unknown>;
 *   getUserId: () => string | null | undefined;
 * }} session the signed-in session, read again after the refetch
 */
export async function refreshAppData({ refetchSession, getUserId }) {
	if (get(status).isRefreshing) return;

	if (!navigator.onLine) {
		setOnline(false);
		showNotice('오프라인 상태입니다. 온라인으로 돌아오면 새로고침할 수 있습니다.');
		return;
	}

	patchStatus({ isRefreshing: true, notice: null });

	try {
		setOnline(true);
		await refetchSession();

		if (!getUserId()) {
			showNotice('로그인 상태를 다시 확인한 뒤 새로고침해 주세요.');
			return;
		}

		await runServerSync({ showSuccess: true });
	} catch {
		showNotice('새로고침을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
	} finally {
		patchStatus({ isRefreshing: false });
	}
}

export function toggleConflictDetails() {
	status.update((current) => ({ ...current, detailsOpen: !current.detailsOpen }));
}

export function dismissConflicts() {
	patchStatus({ conflicts: [], detailsOpen: false });
}

/**
 * @param {string} conflictId
 */
function dismissConflict(conflictId) {
	status.update((current) => {
		const conflicts = current.conflicts.filter((conflict) => conflict.id !== conflictId);
		return {
			...current,
			conflicts,
			detailsOpen: conflicts.length === 0 ? false : current.detailsOpen
		};
	});
}

/**
 * @param {OfflineConflictSummary} conflict
 */
export function keepServerConflict(conflict) {
	dismissConflict(conflict.id);
	showNotice('서버의 최신 상태를 유지했습니다.');
}

/**
 * @param {OfflineConflictSummary} conflict
 */
export function applyLocalConflict(conflict) {
	const resolution = resolveLocalConflict(conflict, get(tasks));
	if (resolution.action === 'patch') {
		updateTask(resolution.taskId, resolution.patch);
	} else if (resolution.action === 'delete') {
		deleteTaskCascade(resolution.taskId);
	}
	if (resolution.dismiss) {
		dismissConflict(conflict.id);
	}
	showNotice(resolution.notice);
}

/**
 * Saves the listed conflicts as offline_conflicts_YYYY-MM-DD.json.
 * @param {import('./download.js').DownloadEnvironment} [environment] injectable for tests
 */
export function downloadConflictReport(environment) {
	const { conflicts } = get(status);
	if (conflicts.length === 0) return;

	downloadJson(createOfflineConflictReport(conflicts), createDatedFilename('offline_conflicts', 'json'), environment);
}
