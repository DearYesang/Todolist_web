import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { ROOT, ensureOutDir } from '../root.js';
import { ACTION_WEIGHTS, generateActions, runScenario } from './runner.js';
const WEIGHTS = { ...ACTION_WEIGHTS, ...JSON.parse(process.env.FUZZ_WEIGHTS ?? '{}') };

const SEED = Number(process.env.FUZZ_SEED ?? 1);
const LEN = Number(process.env.FUZZ_LEN ?? 40);
const OUT = process.env.FUZZ_OUT ?? resolve(ensureOutDir(), 'replay.txt');
const ACTIONS = process.env.FUZZ_ACTIONS; // optional JSON file with an action list

it('replay', async () => {
	const actions = ACTIONS ? JSON.parse(readFileSync(ACTIONS, 'utf8')) : generateActions(SEED, LEN, WEIGHTS);
	const env = await runScenario({ seed: SEED, root: ROOT, actions, keepTrace: true });
	const lines = [];
	lines.push(`variant=${env.app.variant} seed=${SEED} actions=${actions.length}`);
	lines.push('--- trace');
	lines.push(...env.trace);
	lines.push('--- violations');
	for (const v of env.violations) lines.push(JSON.stringify(v));
	lines.push('--- server log');
	for (const e of env.server.log) lines.push(JSON.stringify(e));
	lines.push('--- console');
	for (const e of env.consoleErrors) lines.push(JSON.stringify(e));
	lines.push('--- notes');
	lines.push(...env.notes);
	writeFileSync(OUT, lines.join('\n'));
}, 600_000);
