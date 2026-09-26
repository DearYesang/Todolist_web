import { readdirSync, readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The import rules the code keeps, checked on the source text: every .js and
// .svelte file under src/, and the files they import by a relative or $lib
// path. Packages and SvelteKit's $app, $env and $service-worker modules are
// not part of the graph.

const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
// `import ... from '...'` and `export ... from '...'`, over several lines.
const FROM_IMPORT = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const NAMED_IMPORT = /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;

// Which lib/ folders each layer's production code may not import from.
const LAYER_RULES = [
	{ layer: 'shared', forbidden: ['client', 'server', 'components'] },
	{ layer: 'client', forbidden: ['server'] },
	{ layer: 'server', forbidden: ['client', 'components'] }
];
const TEST_SUPPORT = 'lib/test-support/';

/** @param {string} file */
const isTest = (file) => file.endsWith('.test.js');

/** @param {string} file */
const isProduction = (file) => !isTest(file) && !file.startsWith(TEST_SUPPORT);

/** Every .js and .svelte file under src/, as a POSIX path relative to src/. */
const files = readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
	.map((file) => file.split(sep).join('/'))
	.filter((file) => /\.(js|svelte)$/.test(file))
	.sort();
const fileSet = new Set(files);

/**
 * Where an internal import points: the path it names and the file under src/
 * that path resolves to, if any. Like Vite, a path without an extension may
 * name a .js file or a folder's index.js. Null for a package or a SvelteKit
 * module.
 * @param {string} importer
 * @param {string} specifier
 * @returns {{ path: string; target: string | undefined } | null}
 */
function resolveImport(importer, specifier) {
	let path;
	if (specifier.startsWith('$lib/')) {
		path = posix.join('lib', specifier.slice('$lib/'.length));
	} else if (specifier.startsWith('.')) {
		path = posix.join(posix.dirname(importer), specifier);
	} else {
		return null;
	}
	const target = [path, `${path}.js`, `${path}/index.js`].find((candidate) => fileSet.has(candidate));
	return { path, target };
}

/**
 * A file's source without its comments.
 * @param {string} file
 */
function readSource(file) {
	return readFileSync(posix.join(SRC_DIR, file), 'utf8')
		.replace(BLOCK_COMMENT, '')
		.replace(LINE_COMMENT, '');
}

/** @param {string} file */
function readSpecifiers(file) {
	const source = readSource(file);
	return [FROM_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT].flatMap((pattern) =>
		[...source.matchAll(pattern)].map((match) => match[1])
	);
}

/**
 * The local names a file gives the exports it imports from `module` with
 * `import { a, b as c } from '...'`.
 * @param {string} file
 * @param {string} module a file under src/
 */
function readNamedImports(file, module) {
	/** @type {Map<string, string>} imported name -> local name */
	const names = new Map();
	for (const [, list, specifier] of readSource(file).matchAll(NAMED_IMPORT)) {
		if (resolveImport(file, specifier)?.target !== module) {
			continue;
		}
		for (const entry of list.split(',').map((part) => part.trim()).filter(Boolean)) {
			const [imported, local = imported] = entry.split(/\s+as\s+/);
			names.set(imported, local);
		}
	}
	return names;
}

/** @type {Map<string, string[]>} each file's imports of other files under src/ */
const imports = new Map();
/** @type {string[]} */
const unresolved = [];
for (const file of files) {
	/** @type {string[]} */
	const targets = [];
	for (const specifier of readSpecifiers(file)) {
		const resolved = resolveImport(file, specifier);
		if (resolved?.target) {
			targets.push(resolved.target);
		} else if (resolved && !/\.(css|json)$/.test(resolved.path)) {
			unresolved.push(`${file} -> ${specifier}`);
		}
	}
	imports.set(file, [...new Set(targets)]);
}

/**
 * The imports that break a rule, as `importer -> imported` lines.
 * @param {(importer: string, imported: string) => boolean} breaksRule
 */
function findImports(breaksRule) {
	return files.flatMap((importer) =>
		(imports.get(importer) ?? [])
			.filter((imported) => breaksRule(importer, imported))
			.map((imported) => `${importer} -> ${imported}`)
	);
}

/**
 * Every import cycle among the production files, as `a -> b -> a` lines. A
 * component that renders itself, like TaskTreeCard.svelte, imports itself;
 * that is recursion, not a cycle.
 */
function findCycles() {
	/** @type {string[]} */
	const cycles = [];
	/** @type {Map<string, 'open' | 'done'>} */
	const state = new Map();
	/** @type {string[]} */
	const stack = [];

	/** @param {string} file */
	function visit(file) {
		state.set(file, 'open');
		stack.push(file);
		for (const next of (imports.get(file) ?? []).filter((target) => target !== file && isProduction(target))) {
			if (state.get(next) === 'open') {
				cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
			} else if (!state.has(next)) {
				visit(next);
			}
		}
		stack.pop();
		state.set(file, 'done');
	}

	for (const file of files.filter(isProduction)) {
		if (!state.has(file)) {
			visit(file);
		}
	}
	return cycles;
}

describe('source architecture', () => {
	it('resolves every relative and $lib import to a file, so the rules below see every import', () => {
		expect(files.length).toBeGreaterThan(100);
		expect(unresolved).toEqual([]);
	});

	it('has no import cycles', () => {
		expect(findCycles()).toEqual([]);
	});

	it.each(LAYER_RULES.map((rule) => ({ ...rule, names: rule.forbidden.join(', ') })))(
		'keeps $layer code from importing $names code',
		({ layer, forbidden }) => {
			// Tests may cross layers, e.g. to hold client and server to one format.
			expect(findImports((importer, imported) =>
				isProduction(importer)
					&& importer.startsWith(`lib/${layer}/`)
					&& forbidden.some((name) => imported.startsWith(`lib/${name}/`))
			)).toEqual([]);
		}
	);

	it('reaches the client task store modules only through task-store.js', () => {
		// Components and the sync modules outside the folder use the facade;
		// tests may import the module they test.
		const storeDir = 'lib/client/task-store/';
		const facade = 'lib/client/task-store.js';
		expect(findImports((importer, imported) =>
			isProduction(importer) && importer !== facade && !importer.startsWith(storeDir) && imported.startsWith(storeDir)
		)).toEqual([]);
	});

	it('writes the client task store stores only inside lib/client/task-store/', async () => {
		const facadePath = 'lib/client/task-store.js';
		/** @type {Record<string, unknown>} */
		const facade = await import('./lib/client/task-store.js');
		/** @param {unknown} value */
		const isStore = (value) => typeof /** @type {{ subscribe?: unknown }} */ (value)?.subscribe === 'function';
		const storeNames = Object.keys(facade).filter((name) => isStore(facade[name]));
		expect(storeNames).toContain('tasks');

		// The facade hands out read-only views of the stores ...
		expect(storeNames.filter((name) => {
			const store = /** @type {object} */ (facade[name]);
			return 'set' in store || 'update' in store;
		})).toEqual([]);

		// ... and no file outside the folder writes one: not with store.set()
		// or store.update(), and not with a component's `$store = ...`,
		// `$store.field = ...` or `bind:value={$store...}`, which svelte-check
		// lets through and which would only fail when they run.
		const writes = files
			.filter((file) => !file.startsWith('lib/client/task-store'))
			.flatMap((file) => {
				const source = readSource(file);
				return [...readNamedImports(file, facadePath)]
					.filter(([imported]) => storeNames.includes(imported))
					.filter(([, local]) => [
						new RegExp(`(?<![\\w$.])${local}\\s*\\.\\s*(?:set|update)\\s*\\(`),
						new RegExp(`\\$${local}(?:\\.[\\w$]+|\\[[^\\]]*\\])*\\s*(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])`),
						new RegExp(`bind:[\\w|]+=\\{\\s*\\$${local}\\b`)
					].some((pattern) => pattern.test(source)))
					.map(([imported]) => `${file} writes ${imported}`);
			});
		expect(writes).toEqual([]);
	});

	it('reaches the server task repository modules only through repository.js', () => {
		// A route importing a module behind repository.js would escape the
		// vi.mock('$lib/server/tasks/repository.js') factories in its tests.
		// Routes and the categories package also import validation.js
		// (TaskWriteError and the request parsers) and rate-limit-guard.js.
		const tasksDir = 'lib/server/tasks/';
		const publicModules = ['repository.js', 'validation.js', 'rate-limit-guard.js'].map((name) => tasksDir + name);
		expect(findImports((importer, imported) =>
			isProduction(importer) && !importer.startsWith(tasksDir) && imported.startsWith(tasksDir) && !publicModules.includes(imported)
		)).toEqual([]);
	});

	it('imports test-support only from tests', () => {
		expect(findImports((importer, imported) =>
			isProduction(importer) && imported.startsWith(TEST_SUPPORT)
		)).toEqual([]);
	});
});
