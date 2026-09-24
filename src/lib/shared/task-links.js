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
 */

// A match stops at whitespace, straight and typographic quotes, angle
// brackets, backticks and Hangul (Jamo, compatibility Jamo, syllables).
// Browsers copy Korean URL paths percent-encoded, so Hangul glued to a URL
// is surrounding prose.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`“”‘’ᄀ-ᇿ㄰-㆏가-힣]+/gi;

const TRAILING_PUNCTUATION = new Set([
	'.', ',', ';', ':', '!', '?', "'", '"',
	'。', '、', '」', '』', '》', '〉',
	'，', '．', '；', '：', '！', '？',
	'…', '‥', '»', '›'
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

	for (const match of source.matchAll(URL_PATTERN)) {
		const start = match.index ?? 0;
		const value = trimUrlTail(match[0]);
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
 * @param {LinkSourceTask[]} allTasks
 * @param {string} taskId
 * @param {LinkCollectOptions} [options]
 * @returns {TaskLink[]}
 */
export function collectSubtreeLinks(allTasks, taskId, options = {}) {
	const root = allTasks.find((task) => task.id === taskId);
	if (!root) return [];

	/** @type {Map<string, LinkSourceTask[]>} */
	const childrenByParent = new Map();
	for (const task of allTasks) {
		if (!task.parentId) continue;
		const siblings = childrenByParent.get(task.parentId);
		if (siblings) {
			siblings.push(task);
		} else {
			childrenByParent.set(task.parentId, [task]);
		}
	}

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

		const children = childrenByParent.get(task.id) ?? [];
		for (let index = children.length - 1; index >= 0; index -= 1) {
			stack.push(children[index]);
		}
	}

	return links;
}
