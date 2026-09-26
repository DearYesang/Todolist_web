import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { ROOT, ensureOutDir } from '../root.js';
import { ACTION_WEIGHTS, generateActions, runScenario } from './runner.js';
const WEIGHTS = { ...ACTION_WEIGHTS, ...JSON.parse(process.env.FUZZ_WEIGHTS ?? '{}') };

const SEED = Number(process.env.FUZZ_SEED ?? 1);
const LEN = Number(process.env.FUZZ_LEN ?? 40);
const CLASS = process.env.FUZZ_CLASS;
const OUT = process.env.FUZZ_OUT ?? resolve(ensureOutDir(), `min-${SEED}.json`);

async function fails(actions) {
	const env = await runScenario({ seed: SEED, root: ROOT, actions });
	return env.violations.some((v) => `${v.inv}:${v.kind}` === CLASS);
}

// Shrinking needs a class to keep (FUZZ_CLASS=I1:title-mismatch, say), so a
// plain run of the folder skips it.
it.skipIf(!CLASS)('shrink', async () => {
	let actions = generateActions(SEED, LEN, WEIGHTS);
	if (!(await fails(actions))) throw new Error('does not reproduce');
	let n = 2;
	while (actions.length >= 2) {
		const chunk = Math.ceil(actions.length / n);
		let reduced = false;
		for (let i = 0; i < actions.length; i += chunk) {
			const candidate = [...actions.slice(0, i), ...actions.slice(i + chunk)];
			if (await fails(candidate)) {
				actions = candidate;
				n = Math.max(n - 1, 2);
				reduced = true;
				break;
			}
		}
		if (!reduced) {
			if (n >= actions.length) break;
			n = Math.min(actions.length, n * 2);
		}
	}
	// one-at-a-time pass
	for (let i = actions.length - 1; i >= 0; i--) {
		const candidate = [...actions.slice(0, i), ...actions.slice(i + 1)];
		if (await fails(candidate)) actions = candidate;
	}
	writeFileSync(OUT, JSON.stringify(actions));
}, 600_000);
