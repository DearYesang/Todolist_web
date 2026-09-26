/**
 * Checklist link parsing shared by card rendering and "open all links".
 *
 * @typedef {{ type: 'text'; value: string }} TextLinkPart
 * @typedef {{ type: 'url'; value: string; href: string }} UrlLinkPart
 * @typedef {TextLinkPart | UrlLinkPart} LinkPart
 *
 * @typedef {{
 *   href: string;
 *   label: string;
 *   taskId: string;
 *   taskText: string;
 * }} TaskLink
 *
 * @typedef {{
 *   id: string;
 *   text: string;
 *   parentId?: string | null;
 *   subtasks?: Array<{ text: string; done?: boolean }>;
 * }} LinkSourceTask
 *
 * @typedef {{ includeDone?: boolean }} LinkCollectOptions
 *
 * The full task list's lookups, as task-domain.js's buildTaskIndex builds
 * them (the client shares one as task-store.js's taskIndex).
 * @typedef {{
 *   byId: ReadonlyMap<string, LinkSourceTask>;
 *   childrenByParentId: ReadonlyMap<string, readonly LinkSourceTask[]>;
 * }} LinkSourceIndex
 */

// A match stops at whitespace, straight and typographic quotes, angle
// brackets, backticks and Hangul (Jamo, compatibility Jamo, syllables).
// Browsers copy Korean URL paths percent-encoded, so Hangul glued to a URL
// is usually surrounding prose; readUrlCandidate decides when it is not.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`“”‘’ᄀ-ᇿ㄰-㆏가-힣]*/gi;
// The same URL character class and the Hangul it excludes, for resuming a
// match after a Hangul run.
const URL_CHARS = /[^\s<>"'`“”‘’ᄀ-ᇿ㄰-㆏가-힣]*/y;
const HANGUL_RUN = /[ᄀ-ᇿ㄰-㆏가-힣]+/y;

const TRAILING_PUNCTUATION = new Set([
	'.',
	',',
	';',
	':',
	'!',
	'?',
	"'",
	'"',
	'。',
	'、',
	'」',
	'』',
	'》',
	'〉',
	'，',
	'．',
	'；',
	'：',
	'！',
	'？',
	'…',
	'‥',
	'»',
	'›'
]);

/** @type {Record<string, string>} */
const CLOSING_BRACKETS = {
	')': '(',
	']': '[',
	'}': '{',
	'）': '（',
	'］': '［',
	'｝': '｛',
	'】': '【',
	'〕': '〔',
	'〗': '〖',
	'〙': '〘'
};

/**
 * @param {string} value
 * @param {string} char
 */
function countChar(value, char) {
	let count = 0;
	for (const current of value) {
		if (current === char) count += 1;
	}
	return count;
}

/**
 * Strips trailing punctuation, and closing brackets that have no opener
 * inside the match, so `기관(https://a.kr/x)` links to https://a.kr/x while
 * `wiki/Foo_(bar)` stays intact.
 * @param {string} value
 */
export function trimUrlTail(value) {
	let end = value.length;

	while (end > 0) {
		const char = value[end - 1];
		if (TRAILING_PUNCTUATION.has(char)) {
			end -= 1;
			continue;
		}

		const opener = CLOSING_BRACKETS[char];
		if (opener) {
			const candidate = value.slice(0, end);
			if (countChar(candidate, char) > countChar(candidate, opener)) {
				end -= 1;
				continue;
			}
		}

		break;
	}

	return value.slice(0, end);
}

/**
 * Returns an absolute http(s) href, or null for anything that must not
 * become a link (javascript:, data:, malformed input, missing host).
 * @param {string} raw
 */
export function toSafeHref(raw) {
	if (typeof raw !== 'string' || !raw) return null;

	const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
	/** @type {URL} */
	let url;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!url.hostname) return null;
	return url.href;
}

/**
 * @param {string} url
 */
function isInHost(url) {
	return !/[/?#]/.test(url.replace(/^https?:\/\//i, ''));
}

/**
 * Unencoded Hangul right after a URL is part of it only where it cannot be
 * prose: after `://`, `=`, `?`, `&`, `#`, `_` or `-` (a host label, a query
 * or fragment value, a slug word), as a host label after a dot, or when URL
 * structure follows it (`/대한민국/역사`, `/대한민국_임시정부`, `/파일.pdf`,
 * `맛집&page=2`). Hangul that ends a path segment stays out, because
 * `/wiki/대한민국` and `https://kss.or.kr/에서` cannot be told apart.
 * @param {string} url the match so far
 * @param {string} source
 * @param {number} hangulEnd index just past the Hangul run
 */
function continuesThroughHangul(url, source, hangulEnd) {
	if (/(?::\/\/|[=?&#_-])$/.test(url)) return true;
	if (url.endsWith('.') && isInHost(url)) return true;

	const next = source[hangulEnd];
	if (next === '/' || next === '_' || next === '-') return true;
	return /^[.?#=&%+~][A-Za-z0-9%]/.test(source.slice(hangulEnd, hangulEnd + 2));
}

/**
 * The raw URL starting at `start`: the pattern match, extended through
 * Hangul runs that belong to the URL, and cut before a Markdown `](` so
 * `[https://a.com](https://a.com)` yields two links instead of one broken
 * one.
 * @param {string} source
 * @param {number} start
 * @param {number} matchLength
 */
function readUrlCandidate(source, start, matchLength) {
	let end = start + matchLength;

	for (;;) {
		HANGUL_RUN.lastIndex = end;
		const hangul = HANGUL_RUN.exec(source);
		if (!hangul) break;

		const hangulEnd = end + hangul[0].length;
		if (!continuesThroughHangul(source.slice(start, end), source, hangulEnd)) break;

		URL_CHARS.lastIndex = hangulEnd;
		end = hangulEnd + (URL_CHARS.exec(source)?.[0].length ?? 0);
	}

	const candidate = source.slice(start, end);
	const markdownBreak = candidate.indexOf('](');
	return markdownBreak > 0 ? candidate.slice(0, markdownBreak) : candidate;
}

/**
 * Splits text into plain and link parts. Joining every part's value gives
 * back the original text; unsafe matches stay plain text.
 * @param {string} text
 * @returns {LinkPart[]}
 */
export function splitTextIntoLinkParts(text) {
	const source = typeof text === 'string' ? text : '';
	/** @type {LinkPart[]} */
	const parts = [];
	let cursor = 0;
	const pattern = new RegExp(URL_PATTERN);

	for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
		const start = match.index;
		const raw = readUrlCandidate(source, start, match[0].length);
		pattern.lastIndex = start + raw.length;

		const value = trimUrlTail(raw);
		const href = value ? toSafeHref(value) : null;
		if (!href) continue;

		if (start > cursor) {
			parts.push({ type: 'text', value: source.slice(cursor, start) });
		}
		parts.push({ type: 'url', value, href });
		cursor = start + value.length;
	}

	if (cursor < source.length) {
		parts.push({ type: 'text', value: source.slice(cursor) });
	}

	return parts.length > 0 ? parts : [{ type: 'text', value: source }];
}

/**
 * @param {LinkPart[]} parts
 * @param {string} href
 */
function createLinkLabel(parts, href) {
	const label = parts
		.filter((part) => part.type === 'text')
		.map((part) => part.value)
		.join(' ')
		.replace(/[(（[]\s*[)）\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;:!?。、，])/g, '$1')
		.replace(/^[\s)）\],.;:!?。、，：\-–—]+/u, '')
		.replace(/[\s(（[,.;:!?。、，：\-–—]+$/u, '');

	return /[\p{L}\p{N}]/u.test(label) ? label : new URL(href).hostname;
}

/**
 * Links in a task's checklist, in checklist order, deduplicated by href.
 * @param {LinkSourceTask} task
 * @param {LinkCollectOptions} [options]
 * @returns {TaskLink[]}
 */
export function extractTaskLinks(task, { includeDone = true } = {}) {
	/** @type {TaskLink[]} */
	const links = [];
	const seen = new Set();

	for (const subtask of task.subtasks ?? []) {
		if (!includeDone && subtask.done) continue;

		const parts = splitTextIntoLinkParts(subtask.text);
		for (const part of parts) {
			if (part.type !== 'url' || seen.has(part.href)) continue;
			seen.add(part.href);
			links.push({
				href: part.href,
				label: createLinkLabel(parts, part.href),
				taskId: task.id,
				taskText: task.text
			});
		}
	}

	return links;
}

/**
 * The task's own links first, then every descendant (via parentId over the
 * full task list, so collapsed, filtered and other-column children count)
 * depth-first in list order. Deduplicated by href; parentId cycles stop.
 * @param {LinkSourceIndex} index the full task list's index, not a filtered one
 * @param {string} taskId
 * @param {LinkCollectOptions} [options]
 * @returns {TaskLink[]}
 */
export function collectSubtreeLinks(index, taskId, options = {}) {
	const root = index.byId.get(taskId);
	if (!root) return [];

	/** @type {TaskLink[]} */
	const links = [];
	const seenHrefs = new Set();
	const visited = new Set();
	/** @type {LinkSourceTask[]} */
	const stack = [root];

	while (stack.length > 0) {
		const task = /** @type {LinkSourceTask} */ (stack.pop());
		if (visited.has(task.id)) continue;
		visited.add(task.id);

		for (const link of extractTaskLinks(task, options)) {
			if (seenHrefs.has(link.href)) continue;
			seenHrefs.add(link.href);
			links.push(link);
		}

		const children = index.childrenByParentId.get(task.id) ?? [];
		for (let position = children.length - 1; position >= 0; position -= 1) {
			stack.push(children[position]);
		}
	}

	return links;
}
