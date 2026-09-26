# Sync fuzzer and repro probes

Randomized and deterministic tests for the client's offline sync: the task
write chains (`src/lib/client/task-store/sync-engine.js`), the offline write
queue (`src/lib/client/offline-write-queue.js`), the server sync
(`task-store/server-sync.js`) and the per-user scope (`user-scope.js`, or
`App.svelte`'s `applyStorageScope` on checkouts before #84).

They were written during the PR #84 verification rounds (September 2026) and
are kept here for the offline sync hardening project. What each one found, and
on which commits, is written up in
[`docs/SYNC_HARDENING_NOTES.md`](../../docs/SYNC_HARDENING_NOTES.md).

These are **not** part of `npm test`: `vite.config.js` excludes
`tests/sync-fuzz/**`, and this folder has its own `vitest.config.js`. Most of the
repro tests state an invariant that the code does not keep yet, so they fail on
purpose. A failing repro is an open bug, not a broken test.

## Layout

| Path | What it is | Origin |
| --- | --- | --- |
| `root.js` | Picks the checkout under test (`FUZZ_ROOT`) and the output folder | new |
| `vitest.config.js` | Vitest config for this folder only | new |
| `fuzz/harness.js` | Fake server (per-user ownership, `expectedVersion` 409s, checklist version bumps, sessions that sign-out ends), a model of `App.svelte` + `AuthAccountControls.svelte`, and the adapter that loads the code under test | verify:fuzz lens |
| `fuzz/runner.js` | Random action generator, per-step and final invariant checks, reference model of each user's intent | verify:fuzz lens |
| `fuzz/fuzz.test.js` | Campaign: runs `FUZZ_SEEDS` seeds, writes a class summary | verify:fuzz lens |
| `fuzz/replay.test.js` | Replays one seed (or a shrunk action list) with a full request trace | verify:fuzz lens |
| `fuzz/shrink.test.js` | Delta-debugs one seed down to a minimal action list for one violation class | verify:fuzz lens |
| `fuzz/repro.test.js` | 14 deterministic repros (R1a–R8) of the shrunk fuzzer failures | verify:fuzz lens |
| `fuzz/shrink*.sh`, `fuzz/silentcmp.sh` | zsh helpers: shrink on this checkout, replay on this one and `FUZZ_MAIN_ROOT` | verify:fuzz lens |
| `crosstab/crosstab-harness.js` | Two tabs (or a page and its reload) as two module instances over one fake `localStorage`, with storage events delivered to the other tab | verify:crosstab-reload lens |
| `crosstab/crosstab-probe*.test.js` | Cross-tab and reload probes (R1, R1b, R2, R5, R5b, RL1, RL2, R6) | verify:crosstab-reload lens |
| `design/pr84-design-review.test.js` | Design review repros T1a, T1b, T2, T5 | verify:complexity lens |
| `design/pr84-design-scope.test.js` | Design review repros T3, T4 (needs `user-scope.js`) | verify:complexity lens |
| `recorded/` | Outputs recorded during the verification rounds, for comparison | verification rounds |

The originals were run from temporary folders outside the repo
(`pr84-deep-fuzz-artifacts/`, `pr84-deep-crosstab-probes/`,
`pr84-deep-design-repros/`, and `pr84-deep-fix-probes/`, which held copies of
the other three). The only changes made here: every module under test is loaded with a
dynamic import from the checkout `root.js` names instead of a relative path,
outputs go to `out/`, the shell helpers take `FUZZ_MAIN_ROOT` instead of a
hard-coded path, `shrink.test.js` skips without `FUZZ_CLASS`, and the harness
treats `settlePendingTaskSyncs` as optional (only the WIP has it).

## Running

From the repo root:

```bash
npm run test:sync-fuzz                        # everything in this folder
npm run test:sync-fuzz -- fuzz/repro          # only the fuzzer repros
npm run test:sync-fuzz -- crosstab design     # cross-tab probes and design repros
npm run test:sync-fuzz -- repro -t R4         # one repro by name
```

Add `--silent=false` if Vitest hides the `console.log` lines the repros print
(each prints what it observed, e.g. `R4 {"serverTitle":"ua.t1:0",...}`).
`REPRO_TRACE=1` makes some fuzzer repros print the full request trace.

### Against another checkout (FUZZ_ROOT)

Every test loads the code under test from `FUZZ_ROOT` (default: this
checkout). The test files themselves always come from this folder, so the same
scenarios run unchanged against any version of the code:

```bash
git worktree add --detach ../syncfuzz-main origin/main
ln -s "$PWD/node_modules" ../syncfuzz-main/node_modules
FUZZ_ROOT=../syncfuzz-main npm run test:sync-fuzz
```

The other checkout needs `node_modules` (a symlink to this one is enough). The
fuzzer adapts to the code it loads: with `src/lib/client/user-scope.js` it
drives `applyUserScope` / `clearUserLocalData` / `countPendingLocalChanges`
(variant `head` in the replay output); without it, it models main's
`App.svelte` `applyStorageScope` and sign-out (variant `main`). Tests that need
code a checkout does not have are skipped there (`T3`/`T4` need
`user-scope.js`; `T5` needs `settlePendingTaskSyncs`).

### Fuzzer campaigns, replay and shrink

```bash
# 2500 seeds of 40 actions from seed 100000; summary in tests/sync-fuzz/out/c40.json
FUZZ_START=100000 FUZZ_SEEDS=2500 FUZZ_LEN=40 FUZZ_OUT=$PWD/tests/sync-fuzz/out/c40.json \
  npm run test:sync-fuzz -- fuzz/fuzz.test.js

# isolate a root cause by turning actions off
FUZZ_WEIGHTS='{"createTask":0,"switchAccount":0}' npm run test:sync-fuzz -- fuzz/fuzz.test.js

# full trace of one seed -> tests/sync-fuzz/out/replay.txt
FUZZ_SEED=407 FUZZ_WEIGHTS='{"createTask":0,"switchAccount":0}' npm run test:sync-fuzz -- fuzz/replay.test.js

# shrink seed 407 to a minimal action list for one class -> out/min-407.json, then replay it
FUZZ_SEED=407 FUZZ_WEIGHTS='{"createTask":0,"switchAccount":0}' FUZZ_CLASS=I3:server-title-regressed \
  npm run test:sync-fuzz -- fuzz/shrink.test.js
FUZZ_SEED=407 FUZZ_ACTIONS=tests/sync-fuzz/out/min-407.json npm run test:sync-fuzz -- fuzz/replay.test.js

# shrink here, replay the minimal list here and on another checkout (zsh helpers);
# seed 100007 shrinks to: offline; createTask; online; editTitle (an edit of a
# task whose queued create is being sent is dropped, on every checkout)
FUZZ_MAIN_ROOT=../syncfuzz-main tests/sync-fuzz/fuzz/silentcmp.sh I1:title-mismatch 100007
FUZZ_MAIN_ROOT=../syncfuzz-main tests/sync-fuzz/fuzz/shrinkcmp.sh I1:title-mismatch 100007
```

| Variable | Used by | Meaning |
| --- | --- | --- |
| `FUZZ_ROOT` | all | Checkout whose `src/` is tested (default: this one) |
| `FUZZ_SEEDS`, `FUZZ_START`, `FUZZ_LEN` | fuzz | Number of seeds (50), first seed (1), actions per run (40) |
| `FUZZ_WEIGHTS` | fuzz, replay, shrink | JSON overriding `ACTION_WEIGHTS` in `runner.js` |
| `FUZZ_IGNORE` | fuzz | Comma-separated classes not to count against "clean" |
| `FUZZ_OUT` | fuzz, replay, shrink | Output file (default under `out/`) |
| `FUZZ_SEED`, `FUZZ_ACTIONS` | replay, shrink | Seed, or a JSON action list (e.g. a shrunk one) |
| `FUZZ_CLASS` | shrink | Violation class to keep while shrinking, e.g. `I1:title-mismatch` |
| `FUZZ_DUMPQ` | replay | Also dump every queue and the board after each step |
| `FUZZ_MAIN_ROOT`, `FUZZ_LINES` | `*.sh` | Checkout to compare with; trace lines to print |
| `REPRO_TRACE` | `fuzz/repro.test.js` | Print request traces |

A campaign of 2500 seeds × 40 actions takes about 25 s.

## What the fuzzer checks

Two users (`ua`, `ub`), each starting with two server tasks with one checklist
item. Actions: edit title or priority; add, toggle, rename or delete a
checklist item; delete or create a task; sign out (keep or clear local data,
confirm or cancel the question); sign in; switch account without signing out;
go offline or online; press Sync; answer a pending request (ok 55 %, network
error 17 %, 503 10 %, 429 6 %, 401 12 %); fire the 5 s sign-out timer. About 30 %
of requests are processed by the server when sent and answered later. Titles
and item texts encode the user and an edit counter (`ua.t1:3`, `ua.i2~1`), so
every value on the server can be traced to the edit that wrote it.

After each step and after a final drain (every user signs back in and syncs
until their queue is empty):

| Class | Invariant |
| --- | --- |
| `I1:*` | No silent loss: each user's server state matches the last edit they made (a confirmed "clear local data" relaxes that user's earlier edits) |
| `I2:*` | No cross-user leak: no user's task, edit or text in another user's board, cache, queue or server account |
| `I3:*` | No resurrection: a deleted task or item does not come back, an older value does not overwrite a newer one, no duplicates |
| `I4:*` | No spurious conflict: there is no second device, so every 409 and every conflict banner is spurious |
| `SILENT:*` | An `I1` class in a run that showed no conflict banner and had no `I2`: the loss was not visible to the user |
| `DIVERGE:*`, `HANG:*`, `CRASH:*` | Board differs from the server after the final sync; a create or drain never finished; an exception |

## Results at the time of writing (2026-09-27)

Deterministic tests (`npm run test:sync-fuzz`, with `FUZZ_ROOT` pointing at
each checkout). ✓ = the invariant holds, ✗ = the test fails (open bug),
– = skipped (code not there).

| Test | WIP `21a3e0b` (`wip/sync-hardening` base) | descoped #84 `9dee2b4` | origin/main `c0c7f51` |
| --- | --- | --- | --- |
| fuzz R1a, R1b, R1c (createTask unbound) | ✗ | ✗ | ✗ |
| fuzz R2, R2b (late snapshot after owner change) | ✗ | ✗ | ✗ |
| fuzz R3 (flush goes on under the next session) | ✓ | ✗ | ✗ |
| fuzz R4, R4b (retire rule drops a queued edit) | ✓ | ✓ | ✓ |
| fuzz R5, R5b (spurious 409 after own write) | ✗ | ✗ | ✗ |
| fuzz R6, R6b (flush sends a stale copy / reconcile drop) | ✗ | ✗ | ✗ |
| fuzz R7 (drain misses a new item's edit) | ✗ | ✗ | ✗ |
| fuzz R8 (permanent local duplicate) | ✗ | ✗ | ✗ |
| crosstab R1, R1b, R2 (retire rule across tabs) | ✓ | ✓ | ✓ |
| crosstab probe3, probe5 (retire rule after board revert) | ✓ | ✓ | ✓ |
| crosstab RL1, RL2 (reload mid-flight) | ✗ | ✗ | ✗ |
| crosstab probe6 (late failure merged into a flushed entry) | ✗ | ✗ | ✗ |
| design T1a, T1b (retire rule) | ✓ | ✓ | ✓ |
| design T2 (spurious 409 after own checklist toggle) | ✗ | ✗ | ✗ |
| design T3 (flush conflicts lost on owner change) | ✓ | ✓ | – |
| design T4 (flush goes on under the next owner) | ✓ | ✗ | – |
| design T5 (advance past another device's version) | ✓ | – | – |

Totals: WIP 15 failed / 15 passed / 1 skipped; descoped 17 / 12 / 2;
main 16 / 11 / 4 (the skipped `shrink` included).

At the PR head the verification rounds tested (`256130e`), R3/T3/T4/T5 and the
retire-rule tests (R4, R4b, crosstab R1, R1b, R2, probe3, probe5, T1a, T1b)
failed; the last repair round fixed them in the WIP. See `recorded/`.

Fuzzer campaign, seeds 100000–102499, 40 actions each (the same seeds as the
recorded `256130e` campaign):

| Checkout | Clean runs | `I4:server-409` | `I1:title-mismatch` | `I1:anon-queue-orphan` | `I2:server-write-foreign-task` | `I2:queue-foreign` |
| --- | --- | --- | --- | --- | --- | --- |
| `256130e` (recorded) | 1784 / 2500 | 249 | 167 | 32 | 17 | 27 |
| WIP `21a3e0b` | 1786 / 2500 | 258 | 164 | 32 | 0 | 27 |
| descoped #84 `9dee2b4` | 1200 / 2500 | 436 | 384 | 340 | 211 | 168 |
| origin/main `c0c7f51` | 1200 / 2500 | 436 | 384 | 340 | 211 | 168 |

The descoped #84 and main give identical results on every seed: the descoped
PR does not change sync behavior.
