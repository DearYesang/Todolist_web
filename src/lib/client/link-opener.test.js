import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	confirmOpen,
	dismissLinkOpen,
	LINK_OPEN_BATCH_LIMIT,
	LINK_RESULT_AUTO_HIDE_MS,
	linkOpenState,
	openInNewTabs,
	openNextBlocked,
	openPendingLinks,
	POPUP_PERMISSION_HINT,
	requestOpenLinks,
	summarizeLinkOpenState
} from './link-opener.js';

/**
 * @param {number} count
 * @returns {import('$lib/shared/task-links.js').TaskLink[]}
 */
function makeLinks(count) {
	return Array.from({ length: count }, (_, index) => ({
		href: `https://example.com/${index + 1}`,
		label: `링크 ${index + 1}`,
		taskId: 'task-1',
		taskText: '외부 정보 탐색'
	}));
}

/**
 * A fake window.open: `allow` decides per call whether a handle comes back.
 * @param {(callIndex: number) => boolean} allow
 */
function createOpener(allow) {
	/** @type {Array<{ opener: unknown }>} */
	const handles = [];
	let callIndex = 0;
	const openFn = vi.fn((/** @type {string} */ _url) => {
		const allowed = allow(callIndex);
		callIndex += 1;
		if (!allowed) return null;
		const handle = { opener: /** @type {unknown} */ ('app-window') };
		handles.push(handle);
		return handle;
	});
	return { openFn, handles };
}

function currentState() {
	const state = get(linkOpenState);
	if (!state) throw new Error('expected a link-open state');
	return state;
}

beforeEach(() => {
	dismissLinkOpen();
});

afterEach(() => {
	dismissLinkOpen();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('openInNewTabs', () => {
	const hrefs = ['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/'];

	it('reports every link as opened when every call returns a handle', () => {
		const { openFn } = createOpener(() => true);

		expect(openInNewTabs(hrefs, openFn)).toEqual({ opened: hrefs, blocked: [] });
	});

	it('reports a partial result when only the first call returns a handle', () => {
		const { openFn } = createOpener((callIndex) => callIndex === 0);

		expect(openInNewTabs(hrefs, openFn)).toEqual({
			opened: ['https://a.example.com/'],
			blocked: ['https://b.example.com/', 'https://c.example.com/']
		});
	});

	it('reports everything as blocked when every call returns null', () => {
		const { openFn } = createOpener(() => false);

		expect(openInNewTabs(hrefs, openFn)).toEqual({ opened: [], blocked: hrefs });
	});

	it('detaches the opener on returned handles', () => {
		const { openFn, handles } = createOpener(() => true);

		openInNewTabs(hrefs, openFn);

		expect(handles).toHaveLength(3);
		expect(handles.every((handle) => handle.opener === null)).toBe(true);
	});

	it('tolerates a handle whose opener setter throws', () => {
		const hostile = {};
		Object.defineProperty(hostile, 'opener', {
			get: () => 'app-window',
			set: () => {
				throw new Error('SecurityError');
			}
		});

		expect(openInNewTabs(['https://a.example.com/'], () => hostile)).toEqual({
			opened: ['https://a.example.com/'],
			blocked: []
		});
	});

	it('calls openFn with the URL only, synchronously and in order', () => {
		const { openFn } = createOpener(() => true);

		openInNewTabs(hrefs, openFn);

		expect(openFn.mock.calls).toEqual(hrefs.map((href) => [href]));
	});

	it('defaults to window.open(url, "_blank") with no features string', () => {
		const open = vi.fn(() => ({ opener: 'app-window' }));
		vi.stubGlobal('window', { open });

		openInNewTabs(['https://a.example.com/']);

		expect(open).toHaveBeenCalledTimes(1);
		expect(open.mock.calls[0]).toEqual(['https://a.example.com/', '_blank']);
	});
});

describe('requestOpenLinks', () => {
	it('opens up to 10 links at once and shows the result', () => {
		const { openFn } = createOpener(() => true);

		requestOpenLinks(makeLinks(10), { title: '외부 정보 탐색', openFn });

		expect(openFn).toHaveBeenCalledTimes(10);
		const state = currentState();
		expect(state.phase).toBe('result');
		expect(state.title).toBe('외부 정보 탐색');
		expect(state.opened).toHaveLength(10);
		expect(summarizeLinkOpenState(state)).toMatchObject({
			tone: 'success',
			message: '링크 10개를 새 탭으로 열었습니다.'
		});
	});

	it('asks for confirmation above 10 links and opens nothing yet', () => {
		const { openFn } = createOpener(() => true);

		requestOpenLinks(makeLinks(11), { title: '많은 링크', openFn });

		expect(openFn).not.toHaveBeenCalled();
		const state = currentState();
		expect(state.phase).toBe('confirm');
		expect(state.pending).toHaveLength(11);
		expect(summarizeLinkOpenState(state)).toMatchObject({
			tone: 'confirm',
			message: '링크 11개를 새 탭으로 엽니다.',
			hint: null
		});
	});

	it('deduplicates links by href before counting', () => {
		const { openFn } = createOpener(() => true);
		const [first, second] = makeLinks(2);

		requestOpenLinks([first, second, { ...first, label: '중복' }], { openFn });

		expect(openFn).toHaveBeenCalledTimes(2);
	});

	it('ignores an empty request', () => {
		const { openFn } = createOpener(() => true);

		requestOpenLinks([], { openFn });

		expect(openFn).not.toHaveBeenCalled();
		expect(get(linkOpenState)).toBeNull();
	});

	it('describes a partial result with the pop-up permission hint', () => {
		const { openFn } = createOpener((callIndex) => callIndex === 0);

		requestOpenLinks(makeLinks(4), { openFn });

		const summary = summarizeLinkOpenState(currentState());
		expect(summary.tone).toBe('partial');
		expect(summary.message).toBe('링크 4개 중 1개만 열렸습니다. 브라우저가 나머지를 팝업으로 차단했습니다.');
		expect(summary.hint).toBe(POPUP_PERMISSION_HINT);
		expect(summary.unopened.map((link) => link.href)).toEqual([
			'https://example.com/2',
			'https://example.com/3',
			'https://example.com/4'
		]);
		expect(summary.stepLabel).toBe('다음 링크 열기 (1/3)');
	});

	it('describes an all-blocked result', () => {
		const { openFn } = createOpener(() => false);

		requestOpenLinks(makeLinks(3), { openFn });

		const summary = summarizeLinkOpenState(currentState());
		expect(summary.tone).toBe('blocked');
		expect(summary.message).toBe('이 환경에서는 새 탭을 자동으로 열 수 없습니다. 아래 링크를 하나씩 눌러 주세요.');
		expect(summary.unopened).toHaveLength(3);
		expect(summary.stepLabel).toBe('다음 링크 열기 (1/3)');
	});
});

describe('confirmOpen and remaining links', () => {
	it('opens at most 20 links per click and keeps the rest pending', () => {
		const { openFn } = createOpener(() => true);
		requestOpenLinks(makeLinks(25), { openFn });
		expect(summarizeLinkOpenState(currentState()).hint).toBe(`한 번에 최대 ${LINK_OPEN_BATCH_LIMIT}개씩 엽니다.`);

		confirmOpen({ openFn });

		expect(openFn).toHaveBeenCalledTimes(LINK_OPEN_BATCH_LIMIT);
		const state = currentState();
		expect(state.phase).toBe('result');
		expect(state.pending).toHaveLength(5);
		expect(summarizeLinkOpenState(state)).toMatchObject({
			tone: 'success',
			message: '링크 20개를 새 탭으로 열었습니다.',
			remainingLabel: '나머지 5개 열기'
		});

		openPendingLinks({ openFn });

		expect(openFn).toHaveBeenCalledTimes(25);
		expect(openFn.mock.calls.map(([url]) => url)).toEqual(makeLinks(25).map((link) => link.href));
		expect(currentState().pending).toHaveLength(0);
		expect(summarizeLinkOpenState(currentState())).toMatchObject({
			tone: 'success',
			message: '링크 25개를 새 탭으로 열었습니다.',
			remainingLabel: null
		});
	});

	it('does nothing when there is no confirm step', () => {
		const { openFn } = createOpener(() => true);

		expect(confirmOpen({ openFn })).toBeNull();
		expect(openFn).not.toHaveBeenCalled();
	});
});

describe('openNextBlocked', () => {
	it('opens one blocked link per call and advances the cursor', () => {
		const first = createOpener((callIndex) => callIndex === 0);
		requestOpenLinks(makeLinks(4), { openFn: first.openFn });

		const step = createOpener(() => true);
		openNextBlocked({ openFn: step.openFn });

		expect(step.openFn).toHaveBeenCalledTimes(1);
		expect(step.openFn).toHaveBeenCalledWith('https://example.com/2');
		expect(step.handles[0].opener).toBeNull();
		let summary = summarizeLinkOpenState(currentState());
		expect(summary.stepLabel).toBe('다음 링크 열기 (2/3)');
		expect(summary.unopened.map((link) => link.href)).toEqual(['https://example.com/3', 'https://example.com/4']);
		expect(summary.message).toBe('링크 4개 중 2개만 열렸습니다. 브라우저가 나머지를 팝업으로 차단했습니다.');

		openNextBlocked({ openFn: step.openFn });
		openNextBlocked({ openFn: step.openFn });

		expect(step.openFn.mock.calls.map(([url]) => url)).toEqual([
			'https://example.com/2',
			'https://example.com/3',
			'https://example.com/4'
		]);
		summary = summarizeLinkOpenState(currentState());
		expect(summary.tone).toBe('success');
		expect(summary.message).toBe('링크 4개를 새 탭으로 열었습니다.');

		openNextBlocked({ openFn: step.openFn });
		expect(step.openFn).toHaveBeenCalledTimes(3);
	});

	it('falls back to the link list when a single fresh open is blocked too', () => {
		const { openFn } = createOpener(() => false);
		requestOpenLinks(makeLinks(2), { openFn });

		openNextBlocked({ openFn });

		const state = currentState();
		expect(state.cursor).toBe(0);
		expect(state.stepFailed).toBe(true);
		const summary = summarizeLinkOpenState(state);
		expect(summary.tone).toBe('blocked');
		expect(summary.stepLabel).toBeNull();
		expect(summary.unopened).toHaveLength(2);
	});
});

describe('panel lifetime', () => {
	it('auto-hides a fully successful result after about 5 seconds', () => {
		vi.useFakeTimers();
		const { openFn } = createOpener(() => true);

		requestOpenLinks(makeLinks(2), { openFn });
		vi.advanceTimersByTime(LINK_RESULT_AUTO_HIDE_MS - 1);
		expect(get(linkOpenState)).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(get(linkOpenState)).toBeNull();
	});

	it('keeps partial and blocked results until dismissed', () => {
		vi.useFakeTimers();
		const { openFn } = createOpener((callIndex) => callIndex === 0);

		requestOpenLinks(makeLinks(3), { openFn });
		vi.advanceTimersByTime(LINK_RESULT_AUTO_HIDE_MS * 4);
		expect(get(linkOpenState)).not.toBeNull();

		dismissLinkOpen();
		expect(get(linkOpenState)).toBeNull();
	});

	it('keeps a confirm step until answered', () => {
		vi.useFakeTimers();
		const { openFn } = createOpener(() => true);

		requestOpenLinks(makeLinks(12), { openFn });
		vi.advanceTimersByTime(LINK_RESULT_AUTO_HIDE_MS * 4);

		expect(currentState().phase).toBe('confirm');
	});

	it('does not let an old auto-hide timer close a newer result', () => {
		vi.useFakeTimers();
		const allowAll = createOpener(() => true);
		const allowFirst = createOpener((callIndex) => callIndex === 0);

		requestOpenLinks(makeLinks(2), { openFn: allowAll.openFn });
		vi.advanceTimersByTime(LINK_RESULT_AUTO_HIDE_MS - 100);
		requestOpenLinks(makeLinks(3), { openFn: allowFirst.openFn });
		vi.advanceTimersByTime(LINK_RESULT_AUTO_HIDE_MS * 2);

		expect(summarizeLinkOpenState(currentState()).tone).toBe('partial');
	});
});
