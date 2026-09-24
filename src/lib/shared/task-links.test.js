import { describe, expect, it } from 'vitest';
import {
	collectSubtreeLinks,
	extractTaskLinks,
	splitTextIntoLinkParts,
	toSafeHref,
	trimUrlTail
} from './task-links.js';

/**
 * @param {string} text
 */
function linksOf(text) {
	return splitTextIntoLinkParts(text).flatMap((part) =>
		part.type === 'url' ? [{ value: part.value, href: part.href }] : []
	);
}

/**
 * @param {string} id
 * @param {string} text
 * @param {string[]} items
 * @param {{ parentId?: string | null; status?: string; collapsed?: boolean; done?: boolean[] }} [extra]
 */
function task(id, text, items, extra = {}) {
	return {
		id,
		text,
		parentId: extra.parentId ?? null,
		status: extra.status ?? 'todo',
		collapsed: extra.collapsed ?? false,
		subtasks: items.map((item, index) => ({
			id: `${id}-item-${index}`,
			text: item,
			done: extra.done?.[index] ?? false
		}))
	};
}

describe('splitTextIntoLinkParts', () => {
	/** @type {Array<{ name: string; input: string; links: Array<{ value: string; href: string }> }>} */
	const cases = [
		{
			name: 'real backup: parenthesised nrf.re.kr link',
			input: '한국연구재단(https://www.nrf.re.kr/index)',
			links: [{ value: 'https://www.nrf.re.kr/index', href: 'https://www.nrf.re.kr/index' }]
		},
		{
			name: 'real backup: parenthesised seoulfuture link',
			input: '서울미래인재재단(https://www.seoulfuture.or.kr/home/kor/main.do)',
			links: [{
				value: 'https://www.seoulfuture.or.kr/home/kor/main.do',
				href: 'https://www.seoulfuture.or.kr/home/kor/main.do'
			}]
		},
		{
			name: 'real backup: databricks link with an unclosed opener',
			input: 'Databricks(https://www.databricks.com/kr/resources/webinar/databricks-kr-learning-festival-april2026/thank-you',
			links: [{
				value: 'https://www.databricks.com/kr/resources/webinar/databricks-kr-learning-festival-april2026/thank-you',
				href: 'https://www.databricks.com/kr/resources/webinar/databricks-kr-learning-festival-april2026/thank-you'
			}]
		},
		{
			name: 'trailing period',
			input: 'https://example.com/docs.',
			links: [{ value: 'https://example.com/docs', href: 'https://example.com/docs' }]
		},
		{
			name: 'trailing comma',
			input: 'https://kss.or.kr/,',
			links: [{ value: 'https://kss.or.kr/', href: 'https://kss.or.kr/' }]
		},
		{
			name: 'trailing semicolon',
			input: '참고 https://example.com/a;',
			links: [{ value: 'https://example.com/a', href: 'https://example.com/a' }]
		},
		{
			name: 'trailing exclamation mark',
			input: 'https://example.com/wow!',
			links: [{ value: 'https://example.com/wow', href: 'https://example.com/wow' }]
		},
		{
			name: 'trailing question mark',
			input: '여기 맞나 https://example.com/faq?',
			links: [{ value: 'https://example.com/faq', href: 'https://example.com/faq' }]
		},
		{
			name: 'several trailing characters at once',
			input: '(see https://example.com/x).',
			links: [{ value: 'https://example.com/x', href: 'https://example.com/x' }]
		},
		{
			name: 'balanced parentheses stay inside the link',
			input: 'https://en.wikipedia.org/wiki/Foo_(bar)',
			links: [{ value: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }]
		},
		{
			name: 'balanced parentheses inside a parenthesised link',
			input: '위키(https://en.wikipedia.org/wiki/Foo_(bar))',
			links: [{ value: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }]
		},
		{
			name: 'unbalanced square bracket',
			input: '[https://example.com/list]',
			links: [{ value: 'https://example.com/list', href: 'https://example.com/list' }]
		},
		{
			name: 'fullwidth parenthesis and CJK punctuation',
			input: '자료（https://example.jp/a）。、',
			links: [{ value: 'https://example.jp/a', href: 'https://example.jp/a' }]
		},
		{
			name: 'Hangul glued after a URL stops the match',
			input: 'https://kss.or.kr/에서 확인',
			links: [{ value: 'https://kss.or.kr/', href: 'https://kss.or.kr/' }]
		},
		{
			name: 'Hangul glued on both sides',
			input: '링크https://a.com/x입니다',
			links: [{ value: 'https://a.com/x', href: 'https://a.com/x' }]
		},
		{
			name: 'www. gets https://',
			input: 'www.kams.or.kr.',
			links: [{ value: 'www.kams.or.kr', href: 'https://www.kams.or.kr/' }]
		},
		{
			name: 'uppercase scheme',
			input: 'HTTP://EXAMPLE.COM/Path',
			links: [{ value: 'HTTP://EXAMPLE.COM/Path', href: 'http://example.com/Path' }]
		},
		{
			name: 'query and fragment are kept',
			input: 'https://example.com/search?q=a&b=1#result',
			links: [{ value: 'https://example.com/search?q=a&b=1#result', href: 'https://example.com/search?q=a&b=1#result' }]
		},
		{
			name: 'two URLs in one item',
			input: 'see https://a.com, and www.b.org.',
			links: [
				{ value: 'https://a.com', href: 'https://a.com/' },
				{ value: 'www.b.org', href: 'https://www.b.org/' }
			]
		},
		{
			name: 'quotes and angle brackets end a URL',
			input: '"https://example.com/q" <https://example.com/a>',
			links: [
				{ value: 'https://example.com/q', href: 'https://example.com/q' },
				{ value: 'https://example.com/a', href: 'https://example.com/a' }
			]
		},
		{
			name: 'typographic double quotes end a URL',
			input: '“https://a.com/x” 참고',
			links: [{ value: 'https://a.com/x', href: 'https://a.com/x' }]
		},
		{
			// Swallowing the closing quote would change the host to a punycode domain.
			name: 'typographic quotes around a bare host keep the host',
			input: '“https://a.com”',
			links: [{ value: 'https://a.com', href: 'https://a.com/' }]
		},
		{
			name: 'typographic single quotes end a URL',
			input: '‘https://a.com/x’',
			links: [{ value: 'https://a.com/x', href: 'https://a.com/x' }]
		},
		{
			name: 'trailing ellipsis',
			input: '자료 https://a.com/x… 참고',
			links: [{ value: 'https://a.com/x', href: 'https://a.com/x' }]
		},
		{
			name: 'CJK lenticular and tortoise-shell brackets',
			input: '【https://a.com/x】 〔https://b.com/y〕',
			links: [
				{ value: 'https://a.com/x', href: 'https://a.com/x' },
				{ value: 'https://b.com/y', href: 'https://b.com/y' }
			]
		},
		{
			name: 'guillemets',
			input: '«https://a.com/x»',
			links: [{ value: 'https://a.com/x', href: 'https://a.com/x' }]
		},
		{ name: 'javascript: text never becomes a link', input: 'javascript:alert(1)', links: [] },
		{ name: 'data: text never becomes a link', input: 'data:text/html,<script>alert(1)</script>', links: [] },
		{ name: 'scheme without a host stays text', input: '(http://)', links: [] },
		{ name: 'bare www. stays text', input: 'www..', links: [] },
		{ name: 'text without a URL', input: '논문 초록 정리하기', links: [] },
		{ name: 'empty text', input: '', links: [] }
	];

	it.each(cases)('$name', ({ input, links }) => {
		expect(linksOf(input)).toEqual(links);
	});

	it.each(cases)('round-trips the original text: $name', ({ input }) => {
		const parts = splitTextIntoLinkParts(input);
		expect(parts.map((part) => part.value).join('')).toBe(input);
	});

	it('returns trimmed tail characters as the following text part', () => {
		expect(splitTextIntoLinkParts('한국연구재단(https://www.nrf.re.kr/index)')).toEqual([
			{ type: 'text', value: '한국연구재단(' },
			{ type: 'url', value: 'https://www.nrf.re.kr/index', href: 'https://www.nrf.re.kr/index' },
			{ type: 'text', value: ')' }
		]);
	});

	it('returns a single text part when there is no link', () => {
		expect(splitTextIntoLinkParts('그냥 메모')).toEqual([{ type: 'text', value: '그냥 메모' }]);
		expect(splitTextIntoLinkParts('javascript:alert(1)')).toEqual([{ type: 'text', value: 'javascript:alert(1)' }]);
	});
});

describe('trimUrlTail', () => {
	it('strips unbalanced closing brackets but keeps balanced ones', () => {
		expect(trimUrlTail('https://a.kr/x)')).toBe('https://a.kr/x');
		expect(trimUrlTail('https://a.kr/Foo_(bar)')).toBe('https://a.kr/Foo_(bar)');
		expect(trimUrlTail('https://a.kr/Foo_(bar)),.')).toBe('https://a.kr/Foo_(bar)');
		expect(trimUrlTail('https://a.kr/x}')).toBe('https://a.kr/x');
		expect(trimUrlTail('https://a.kr/x）')).toBe('https://a.kr/x');
		expect(trimUrlTail('https://a.kr/x】')).toBe('https://a.kr/x');
		expect(trimUrlTail('https://a.kr/【x】')).toBe('https://a.kr/【x】');
	});
});

describe('toSafeHref', () => {
	it('accepts only http(s) URLs with a host', () => {
		expect(toSafeHref('https://example.com')).toBe('https://example.com/');
		expect(toSafeHref('http://example.com/a')).toBe('http://example.com/a');
		expect(toSafeHref('www.example.com')).toBe('https://www.example.com/');
		expect(toSafeHref('javascript:alert(1)')).toBeNull();
		expect(toSafeHref('data:text/html,hi')).toBeNull();
		expect(toSafeHref('ftp://example.com')).toBeNull();
		expect(toSafeHref('http://')).toBeNull();
		expect(toSafeHref('not a url')).toBeNull();
		expect(toSafeHref('')).toBeNull();
	});
});

describe('extractTaskLinks', () => {
	it('returns checklist links in order with labels and task info', () => {
		const source = task('grant', '지원금 탐색', [
			'한국연구재단(https://www.nrf.re.kr/index)',
			'메모만 있는 항목',
			'https://kss.or.kr/,',
			'학회: https://kams.or.kr'
		]);

		expect(extractTaskLinks(source)).toEqual([
			{ href: 'https://www.nrf.re.kr/index', label: '한국연구재단', taskId: 'grant', taskText: '지원금 탐색' },
			{ href: 'https://kss.or.kr/', label: 'kss.or.kr', taskId: 'grant', taskText: '지원금 탐색' },
			{ href: 'https://kams.or.kr/', label: '학회', taskId: 'grant', taskText: '지원금 탐색' }
		]);
	});

	it('deduplicates repeated links by href', () => {
		const source = task('dup', '중복', [
			'https://example.com/a',
			'다시 https://example.com/a.',
			'www.example.com/b https://www.example.com/b'
		]);

		expect(extractTaskLinks(source).map((link) => link.href)).toEqual([
			'https://example.com/a',
			'https://www.example.com/b'
		]);
	});

	it('includes checked items by default and can skip them', () => {
		const source = task('mixed', '혼합', ['https://open.example.com', 'https://done.example.com'], {
			done: [false, true]
		});

		expect(extractTaskLinks(source).map((link) => link.href)).toEqual([
			'https://open.example.com/',
			'https://done.example.com/'
		]);
		expect(extractTaskLinks(source, { includeDone: false }).map((link) => link.href)).toEqual([
			'https://open.example.com/'
		]);
	});

	it('handles tasks without a checklist', () => {
		expect(extractTaskLinks({ id: 'empty', text: '빈 작업' })).toEqual([]);
	});
});

describe('collectSubtreeLinks', () => {
	// Shaped like the real '외부 정보 탐색' tree: 2 own links, 10 with children.
	const externalInfo = [
		task('other-root', '다른 작업', ['https://other.example.com']),
		task('explore', '외부 정보 탐색', [
			'한국연구재단(https://www.nrf.re.kr/index)',
			'서울미래인재재단(https://www.seoulfuture.or.kr/home/kor/main.do)',
			'메모'
		]),
		task('conferences', '학회 검색 리스트', [
			'https://kss.or.kr/,',
			'www.kams.or.kr.',
			'KSBMB https://www.ksbmb.or.kr',
			'Databricks(https://www.databricks.com/kr/resources/webinar/databricks-kr-learning-festival-april2026/thank-you'
		], { parentId: 'explore', collapsed: true }),
		task('papers', '논문 검색 리스트', [
			'https://pubmed.ncbi.nlm.nih.gov/',
			'https://scholar.google.com/'
		], { parentId: 'explore' }),
		task('grants', '지원금 탐색', [
			'https://www.iris.go.kr/',
			'https://www.ntis.go.kr/'
		], { parentId: 'explore', done: [true, false] })
	];

	it('counts 2 own links and 10 including children', () => {
		const root = /** @type {typeof externalInfo[number]} */ (externalInfo.find((candidate) => candidate.id === 'explore'));

		expect(extractTaskLinks(root)).toHaveLength(2);
		expect(collectSubtreeLinks(externalInfo, 'explore')).toHaveLength(10);
	});

	it('lists own links first, then children depth-first in list order', () => {
		const tree = [
			task('root', 'root', ['https://root.example.com']),
			task('child-a', 'a', ['https://a.example.com'], { parentId: 'root' }),
			task('grandchild', 'a1', ['https://a1.example.com'], { parentId: 'child-a' }),
			task('child-b', 'b', ['https://b.example.com'], { parentId: 'root' })
		];

		expect(collectSubtreeLinks(tree, 'root').map((link) => link.taskId)).toEqual([
			'root',
			'child-a',
			'grandchild',
			'child-b'
		]);
	});

	it('counts collapsed children and children in another status column', () => {
		const tree = [
			task('root', 'root', ['https://root.example.com'], { status: 'doing' }),
			task('collapsed-child', 'c', ['https://c.example.com'], { parentId: 'root', collapsed: true }),
			task('done-child', 'd', ['https://d.example.com'], { parentId: 'root', status: 'done' })
		];

		expect(collectSubtreeLinks(tree, 'root')).toHaveLength(3);
	});

	it('counts a link shared by parent and child once', () => {
		const tree = [
			task('root', 'root', ['https://shared.example.com', 'https://root.example.com']),
			task('child', 'child', ['https://shared.example.com/', 'https://child.example.com'], { parentId: 'root' })
		];

		const links = collectSubtreeLinks(tree, 'root');
		expect(links.map((link) => link.href)).toEqual([
			'https://shared.example.com/',
			'https://root.example.com/',
			'https://child.example.com/'
		]);
		expect(links[0].taskId).toBe('root');
	});

	it('terminates on parentId cycles', () => {
		const cyclic = [
			task('a', 'a', ['https://a.example.com'], { parentId: 'b' }),
			task('b', 'b', ['https://b.example.com'], { parentId: 'a' })
		];

		expect(collectSubtreeLinks(cyclic, 'a').map((link) => link.href)).toEqual([
			'https://a.example.com/',
			'https://b.example.com/'
		]);
	});

	it('passes includeDone through to every task', () => {
		expect(collectSubtreeLinks(externalInfo, 'explore', { includeDone: false })).toHaveLength(9);
	});

	it('returns nothing for an unknown task', () => {
		expect(collectSubtreeLinks(externalInfo, 'missing')).toEqual([]);
	});
});
