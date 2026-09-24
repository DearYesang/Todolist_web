import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = new URL('./styles/', import.meta.url);
const IMPORT_STATEMENT = /^@import '\.\/styles\/([a-z0-9-]+\.css)';$/;

/** @param {string} css */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const appCssStatements = stripComments(readFileSync(new URL('./app.css', import.meta.url), 'utf8'))
	.split('\n')
	.map((line) => line.trim())
	.filter(Boolean);

const importedPartials = appCssStatements.map((line) => IMPORT_STATEMENT.exec(line)?.[1] ?? line);

/** @param {string} partial */
const readPartial = (partial) => stripComments(readFileSync(new URL(partial, STYLES_DIR), 'utf8'));

/**
 * The text before each top-level `{`, i.e. the selector list or at-rule.
 * @param {string} css
 */
const topLevelPreludes = (css) => {
	/** @type {string[]} */
	const preludes = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < css.length; index += 1) {
		if (css[index] === '{') {
			if (depth === 0) preludes.push(css.slice(start, index).trim());
			depth += 1;
		} else if (css[index] === '}') {
			depth -= 1;
			if (depth === 0) start = index + 1;
		}
	}
	return preludes;
};

describe('app.css', () => {
	it('holds nothing but imports of the partials in src/styles', () => {
		for (const line of appCssStatements) {
			expect(line).toMatch(IMPORT_STATEMENT);
		}
	});

	it('imports every partial in src/styles exactly once', () => {
		// A partial nobody imports would ship none of its rules.
		const partials = readdirSync(STYLES_DIR).filter((file) => file.endsWith('.css'));

		expect(new Set(importedPartials).size).toBe(importedPartials.length);
		expect([...importedPartials].sort()).toEqual(partials.sort());
	});

	it('keeps the partials flat, so app.css alone sets the cascade order', () => {
		for (const partial of importedPartials) {
			expect(readPartial(partial), partial).not.toMatch(/@import/);
		}
	});

	it('imports the media-query-only partials after every partial with base rules', () => {
		// The breakpoint and touch overrides win ties only because they come last.
		const isOverrideOnly = importedPartials.map((partial) =>
			topLevelPreludes(readPartial(partial)).every((prelude) => prelude.startsWith('@media'))
		);
		const firstOverride = isOverrideOnly.indexOf(true);

		expect(firstOverride).toBeGreaterThan(0);
		expect(isOverrideOnly.slice(firstOverride)).not.toContain(false);
	});
});
