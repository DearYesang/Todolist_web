import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { ROOT, ensureOutDir } from '../root.js';
import { ACTION_WEIGHTS, generateActions, runScenario } from './runner.js';
const WEIGHTS = { ...ACTION_WEIGHTS, ...JSON.parse(process.env.FUZZ_WEIGHTS ?? '{}') };

const START = Number(process.env.FUZZ_START ?? 1);
const COUNT = Number(process.env.FUZZ_SEEDS ?? 50);
const LEN = Number(process.env.FUZZ_LEN ?? 40);
const OUT = process.env.FUZZ_OUT ?? resolve(ensureOutDir(), 'fuzz.json');
const IGNORE = (process.env.FUZZ_IGNORE ?? '').split(',').filter(Boolean);

it('fuzz', async () => {
	const classes = new Map();
	const perSeed = {};
	const stats = {};
	let runs = 0;
	let clean = 0;
	const t0 = Date.now();
	for (let seed = START; seed < START + COUNT; seed++) {
		const actions = generateActions(seed, LEN, WEIGHTS);
		const env = await runScenario({ seed, root: ROOT, actions });
		runs++;
		for (const [k, v] of Object.entries(env.stats ?? {})) stats[k] = (stats[k] ?? 0) + v;
		if (env.finalPhase) { stats['final-drain-runs'] = (stats['final-drain-runs'] ?? 0) + 1; }
		perSeed[seed] = [...new Set(env.violations.map((v) => `${v.inv}:${v.kind}`))];
		const kinds = new Set(env.violations.map((v) => `${v.inv}:${v.kind}`).filter((k) => !IGNORE.includes(k)));
		if (kinds.size === 0) clean++;
		for (const k of kinds) {
			if (!classes.has(k)) classes.set(k, { count: 0, seeds: [], example: null });
			const c = classes.get(k);
			c.count++;
			if (c.seeds.length < 12) c.seeds.push(seed);
			if (!c.example) c.example = { seed, v: env.violations.find((v) => `${v.inv}:${v.kind}` === k) };
		}
	}
	const summary = {
		runs, clean, ms: Date.now() - t0, len: LEN, start: START, stats,
		classes: Object.fromEntries([...classes.entries()].sort((a, b) => b[1].count - a[1].count))
	};
	writeFileSync(OUT, JSON.stringify(summary, null, 2));
	writeFileSync(OUT.replace(/\.json$/, '-perseed.json'), JSON.stringify(perSeed));
	console.log(JSON.stringify({ runs, clean, ms: summary.ms, classes: Object.fromEntries([...classes.entries()].map(([k, v]) => [k, v.count])) }, null, 1));
}, 3_600_000);
