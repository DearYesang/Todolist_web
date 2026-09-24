import { get, writable } from 'svelte/store';

/**
 * Opens checklist links in new tabs and keeps the outcome for LinkOpenPanel.
 *
 * Browsers let one window.open through per click unless the site is allowed
 * pop-ups, so every open here must run synchronously inside a click handler:
 * no await, setTimeout or native confirm() before window.open.
 *
 * @typedef {import('$lib/shared/task-links.js').TaskLink} TaskLink
 * @typedef {(url: string) => unknown} OpenFn
 *
 * @typedef {{
 *   phase: 'confirm' | 'result';
 *   title: string;
 *   links: TaskLink[];
 *   opened: TaskLink[];
 *   blocked: TaskLink[];
 *   pending: TaskLink[];
 *   cursor: number;
 *   stepFailed: boolean;
 * }} LinkOpenState
 *
 * @typedef {{
 *   tone: 'confirm' | 'success' | 'partial' | 'blocked';
 *   message: string;
 *   hint: string | null;
 *   unopened: TaskLink[];
 *   stepLabel: string | null;
 *   remainingLabel: string | null;
 * }} LinkOpenSummary
 */

export const LINK_CONFIRM_THRESHOLD = 10;
export const LINK_OPEN_BATCH_LIMIT = 20;
export const LINK_RESULT_AUTO_HIDE_MS = 5000;

export const POPUP_PERMISSION_HINT = '한 번만 허용하면 다음부터 한 번에 모두 열립니다: 주소창(설치한 앱은 창 위쪽 제목 표시줄)의 ‘팝업 차단됨’ 아이콘 → ‘항상 허용’을 고른 뒤 다시 눌러 주세요. (Brave 설정: brave://settings/content/popups)';

/** @type {import('svelte/store').Writable<LinkOpenState | null>} */
export const linkOpenState = writable(null);

/** @type {ReturnType<typeof setTimeout> | null} */
let autoHideTimer = null;

/**
 * No features string on purpose: 'noopener'/'noreferrer' make window.open
 * return null even when the tab opens (blocked tabs become undetectable),
 * and 'popup' or a size opens a popup window instead of a tab. Opener
 * isolation comes from COOP same-origin, Referrer-Policy no-referrer and
 * the opener reset in openInNewTabs.
 * @param {string} url
 * @returns {unknown}
 */
function openInBlankTab(url) {
	return window.open(url, '_blank');
}

/**
 * One synchronous loop. A null return means the browser blocked that tab;
 * `closed` is never consulted because COOP flips it to true once the new
 * tab loads.
 * @param {string[]} hrefs
 * @param {OpenFn} [openFn]
 * @returns {{ opened: string[]; blocked: string[] }}
 */
export function openInNewTabs(hrefs, openFn = openInBlankTab) {
	/** @type {string[]} */
	const opened = [];
	/** @type {string[]} */
	const blocked = [];

	for (const href of hrefs) {
		const handle = openFn(href);
		if (handle) {
			detachOpener(handle);
			opened.push(href);
		} else {
			blocked.push(href);
		}
	}

	return { opened, blocked };
}

/**
 * @param {unknown} handle
 */
function detachOpener(handle) {
	try {
		/** @type {{ opener: unknown }} */ (handle).opener = null;
	} catch {
		// Cross-origin or frozen handles may refuse the write; COOP already
		// severs the link.
	}
}

/**
 * @param {TaskLink[]} links
 */
function uniqueLinks(links) {
	const seen = new Set();
	return links.filter((link) => {
		if (!link?.href || seen.has(link.href)) return false;
		seen.add(link.href);
		return true;
	});
}

/**
 * @param {TaskLink[]} batch
 * @param {OpenFn | undefined} openFn
 */
function openBatch(batch, openFn) {
	const result = openInNewTabs(batch.map((link) => link.href), openFn);
	const openedHrefs = new Set(result.opened);
	return {
		opened: batch.filter((link) => openedHrefs.has(link.href)),
		blocked: batch.filter((link) => !openedHrefs.has(link.href))
	};
}

function clearAutoHide() {
	if (!autoHideTimer) return;
	clearTimeout(autoHideTimer);
	autoHideTimer = null;
}

/**
 * @param {LinkOpenState | null} next
 */
function commit(next) {
	clearAutoHide();
	linkOpenState.set(next);

	if (next && isFullyOpened(next)) {
		autoHideTimer = setTimeout(() => {
			autoHideTimer = null;
			if (get(linkOpenState) === next) {
				linkOpenState.set(null);
			}
		}, LINK_RESULT_AUTO_HIDE_MS);
	}

	return next;
}

/**
 * @param {LinkOpenState} state
 */
function isFullyOpened(state) {
	return state.phase === 'result'
		&& state.pending.length === 0
		&& state.cursor >= state.blocked.length;
}

/**
 * Entry point for the "open all" buttons. Call it directly from the click
 * handler. Up to LINK_CONFIRM_THRESHOLD links open at once; more ask for a
 * confirming click inside the panel first (its own fresh activation).
 * @param {TaskLink[]} links
 * @param {{ title?: string; openFn?: OpenFn }} [options]
 */
export function requestOpenLinks(links, { title = '', openFn } = {}) {
	const unique = uniqueLinks(links);
	if (unique.length === 0) return get(linkOpenState);

	if (unique.length > LINK_CONFIRM_THRESHOLD) {
		return commit({
			phase: 'confirm',
			title,
			links: unique,
			opened: [],
			blocked: [],
			pending: unique,
			cursor: 0,
			stepFailed: false
		});
	}

	const { opened, blocked } = openBatch(unique, openFn);
	return commit({
		phase: 'result',
		title,
		links: unique,
		opened,
		blocked,
		pending: [],
		cursor: 0,
		stepFailed: false
	});
}

/**
 * Opens the next LINK_OPEN_BATCH_LIMIT pending links. Used for the confirm
 * button and for '나머지 {k}개 열기'.
 * @param {{ openFn?: OpenFn }} [options]
 */
export function openPendingLinks({ openFn } = {}) {
	const state = get(linkOpenState);
	if (!state || state.pending.length === 0) return state;

	const batch = state.pending.slice(0, LINK_OPEN_BATCH_LIMIT);
	const { opened, blocked } = openBatch(batch, openFn);
	return commit({
		...state,
		phase: 'result',
		opened: [...state.opened, ...opened],
		blocked: [...state.blocked, ...blocked],
		pending: state.pending.slice(LINK_OPEN_BATCH_LIMIT)
	});
}

/**
 * @param {{ openFn?: OpenFn }} [options]
 */
export function confirmOpen(options = {}) {
	const state = get(linkOpenState);
	if (!state || state.phase !== 'confirm') return state;
	return openPendingLinks(options);
}

/**
 * Opens the next blocked link, one per click (each click is a fresh user
 * activation). If even that returns null, programmatic opening does not work
 * here and only the plain link list is left.
 * @param {{ openFn?: OpenFn }} [options]
 */
export function openNextBlocked({ openFn } = {}) {
	const state = get(linkOpenState);
	if (!state || state.phase !== 'result' || state.cursor >= state.blocked.length) return state;

	const link = state.blocked[state.cursor];
	const { opened } = openBatch([link], openFn);
	if (opened.length === 0) {
		return commit({ ...state, stepFailed: true });
	}

	return commit({
		...state,
		opened: [...state.opened, link],
		cursor: state.cursor + 1,
		stepFailed: false
	});
}

export function dismissLinkOpen() {
	commit(null);
}

/** @type {string | null | undefined} */
let linkOpenOwner;

/**
 * Called whenever the signed-in account (the storage owner) changes. A
 * confirm step or a partial result lists the previous account's task titles
 * and URLs, so it must not survive a sign-out or an account switch.
 * @param {string | null} ownerId
 */
export function setLinkOpenOwner(ownerId) {
	const nextOwner = ownerId ?? null;
	if (nextOwner === linkOpenOwner) return;
	linkOpenOwner = nextOwner;
	dismissLinkOpen();
}

/**
 * Korean copy and derived lists for the panel.
 * @param {LinkOpenState} state
 * @returns {LinkOpenSummary}
 */
export function summarizeLinkOpenState(state) {
	if (state.phase === 'confirm') {
		return {
			tone: 'confirm',
			message: `링크 ${state.links.length}개를 새 탭으로 엽니다.`,
			hint: state.links.length > LINK_OPEN_BATCH_LIMIT
				? `한 번에 최대 ${LINK_OPEN_BATCH_LIMIT}개씩 엽니다.`
				: null,
			unopened: [],
			stepLabel: null,
			remainingLabel: null
		};
	}

	const stillBlocked = state.blocked.slice(state.cursor);
	const remainingLabel = state.pending.length > 0 ? `나머지 ${state.pending.length}개 열기` : null;
	const stepLabel = stillBlocked.length > 0 && !state.stepFailed
		? `다음 링크 열기 (${state.cursor + 1}/${state.blocked.length})`
		: null;

	if (stillBlocked.length === 0) {
		return {
			tone: 'success',
			message: `링크 ${state.opened.length}개를 새 탭으로 열었습니다.`,
			hint: null,
			unopened: [],
			stepLabel: null,
			remainingLabel
		};
	}

	const unopened = [...stillBlocked, ...state.pending];
	if (state.opened.length === 0 || state.stepFailed) {
		return {
			tone: 'blocked',
			message: '이 환경에서는 새 탭을 자동으로 열 수 없습니다. 아래 링크를 하나씩 눌러 주세요.',
			hint: null,
			unopened,
			stepLabel,
			remainingLabel: null
		};
	}

	return {
		tone: 'partial',
		message: `링크 ${state.links.length}개 중 ${state.opened.length}개만 열렸습니다. 브라우저가 나머지를 팝업으로 차단했습니다.`,
		hint: POPUP_PERMISSION_HINT,
		unopened,
		stepLabel,
		remainingLabel: null
	};
}
