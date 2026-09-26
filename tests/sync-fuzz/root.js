// Which checkout the sync fuzzer and probes run against. By default it is the
// checkout this folder is in; FUZZ_ROOT=<path> points them at another one
// (for example a worktree of origin/main) without copying anything there.
// The code under test is loaded from <root>/src with dynamic imports, so the
// other checkout needs its own node_modules (a symlink is enough).
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = process.env.FUZZ_ROOT
	? resolve(process.env.FUZZ_ROOT)
	: resolve(import.meta.dirname, '..', '..');

/** Where the fuzzer, replay and shrink write their output (git-ignored). */
export const OUT_DIR = resolve(import.meta.dirname, 'out');

export function ensureOutDir() {
	mkdirSync(OUT_DIR, { recursive: true });
	return OUT_DIR;
}

/**
 * Imports a module of the checkout under test.
 * @param {string} path relative to the checkout, e.g. 'src/lib/client/task-store.js'
 */
export function importFromRoot(path) {
	return import(/* @vite-ignore */ resolve(ROOT, path));
}

/**
 * Whether the checkout under test has a file, for probes that only apply to
 * some versions of the code.
 * @param {string} path
 */
export function rootHas(path) {
	return existsSync(resolve(ROOT, path));
}
