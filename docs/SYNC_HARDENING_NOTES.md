# Offline Sync Hardening Notes

Last updated: 2026-09-27

These notes hand the offline sync work cut from PR #84 over to a separate
"offline sync hardening" project. They record what the #84 verification rounds
found, which findings were already on `main`, which ones the WIP introduced and
then fixed, what is still open, and the design the complexity review
recommended as the starting point.

## Status

- **PR #84** (`feature/r2-pr5-user-scope`) was descoped to the refactor and the
  account-switch fixes: `user-scope.js`, resetting filters and a pending view
  when the user changes, and keeping a pending view when a session check
  fails. It no longer waits for task writes at sign-out (`513a4ae`, `b31d239`
  and `c8e2ea0` were dropped), so sign-out and in-flight write behavior is the
  same as on `main`. The fuzzer gives identical results for the descoped
  branch and `origin/main` on all 2,500 seeds of the comparison campaign
  (see [Fuzzer numbers](#fuzzer-numbers)).
- **`wip/sync-hardening`** (this branch) keeps the dropped work. It starts at
  `sync-hardening-wip` = `21a3e0b`: the 9 commits pushed as #84, then 23
  unpushed commits that tried to fix the Codex P1 below and what the
  verification rounds found in each attempt. On top of that it adds the
  fuzzer and repro probes (`tests/sync-fuzz/`) and this document. It is not
  meant to merge as is. See [Recommended design](#recommended-design-for-the-follow-up).
- All gates passed at `21a3e0b` (the repair round's report): 71 test files and 625
  tests, `svelte-check` 0/0, build, Playwright chromium 36 passed,
  webkit-iphone 35 passed and 1 skipped.

### The WIP commit stack

| Commits | What they do |
| --- | --- |
| `cd805bb` … `e355d4b`, `ea157f9`, `b52b309` | The parts that stay in #84 (rebuilt on the descoped branch): rename, `user-scope.js`, filter and pending-view resets, README |
| `513a4ae` test, `b31d239` fix | Sign-out waits up to 5 s for task write chains (`settlePendingTaskSyncs`), then drains the writes that have not started into the signed-in user's queue |
| `c8e2ea0` | Asks the "clear local data" question after that wait, so the count includes what the wait queued |
| `320004d` test, `ecdd6be`, `79bee3c`, `3bd0a4c`, `bfcec00` | Round 1 fix of the Codex P1: every chained write is bound to its owner (`TaskSyncWrite`: `queueOwnerId`, `storeOwnerId`, `drained`, `discarded`, `taskStateQueued`); a late failure goes to that owner's queue (`enqueueOfflineMutation(m, { ownerId })`); `countPendingTaskSyncs` and `discardPendingTaskSyncs` for the clear question; `applyUserScope` drains the chains before switching owners |
| `d2275da` test, `f86c6fa` | Advance rule: a landed write moves a queued edit drained behind it to the answer's version (`advanceQueuedTaskVersion`) |
| `fe2f895` test, `da0b423` | Checklist writes in flight record what the drain queued behind them (`queuedItemEdits`, `markQueuedBehindRequestsInFlight`, `withoutFieldsQueuedLater`, `resolveQueuedChecklistCreate`) |
| `ccf000f` test, `f90c5d0` | Retire rule: a landed chain write drops the older queued edit of the same task or item (`dropQueuedTaskPatch`, `dropQueuedChecklistFields`, `hasQueuedTaskMutation`) |
| `5d0603a` test, `a938a9d` | A late answer after an owner change updates that owner's cached board (`updateCachedTaskOf`, `advanceToServerTask`) |
| `78cbf7f` test, `7819023` | A queue flush loads, reconciles and saves the queue of the owner it started with; `syncServerTasks` sends a flush's results to that owner's cached board (`updateCachedBoardOf`) |
| `c72472e` test, `256130e` | A flush answer after a confirmed clear goes nowhere (`countLocalTaskCacheClears`, a queue clear counter) |
| `731e024` test, `e919913` | Retire rule made safe: a write drops only the one queued edit it was made on (`TaskSyncWrite.olderQueuedEdit`, `syncTaskSnapshot(task, previous)`) |
| `0ce6aa8` test, `9796ff0` | Advance rule narrowed: move a queued edit only when it expects `version - 1` |
| `e85639d` test, `21a3e0b` | `executeFlush` stops before each request when its owner left or the queue was cleared, and keeps a departed owner's 409s in that owner's queue |

Size: `b52b309..21a3e0b` changes 14 files, +2,544/−160. Production code is
+1,104/−155: `sync-engine.js` +591/−74, `offline-write-queue.js` +277/−27,
`task-cache.js` +121/−34 and `server-sync.js` +60/−1. The rest is tests.

## The Codex P1

Codex reviewed `b31d239` (PR #84 as pushed) and flagged `sync-engine.js:253`,
the timeout path of `settlePendingTaskSyncs`, as P1:

> When a task request has already started but remains pending for more than
> five seconds, its drain descriptor has already been removed before
> operation() runs, so this call queues only operations waiting behind it and
> leaves the active request unprotected. The caller then ends the session; if
> that request subsequently fails, reportSyncFailure can enqueue the edit after
> applyUserScope(null) under the anonymous owner, while the cache-deletion path
> can see zero pending changes and erase the only local copy without
> prompting. The timed-out active mutation must be retained under the current
> user's queue (or aborted and reconstructed) before sign-out proceeds.

The descoped #84 answers it by removing the wait. That does not make the
underlying problem go away: on `main`, sign-out does not wait at all, so any
write in flight or waiting in a chain at sign-out can fail after the session
ended and land in the anonymous queue (finding [M1](#m1)).

## Terms

- **Chain**: the per-task queue of writes in `task-store/sync-engine.js`
  (`enqueueTaskSyncOperation`). One request per task is **in flight**; later
  writes of the task **wait** behind it.
- **Queue**: the offline write queue (`offline-write-queue.js`), one
  `localStorage` key per owner (`kanbanOfflineWriteQueue:<owner>`, or
  `anonymous`). `coalesceQueue` merges a task's patches with the later one on
  top and cancels a create with its delete, so it relies on mutations arriving
  in the order the user made them.
- A write that fails with a **fallback** result (network error, 401, 409, 429,
  503; `task-api.js` `FALLBACK_STATUSES`) is queued by `reportSyncFailure`.
- **Drain**: `drainPendingTaskSyncsToOfflineQueue` moves writes that have not
  started into the queue, built from the board. On `main` it runs on
  `pagehide` and before the `controllerchange` reload (`page-lifecycle.js`).
  The WIP also runs it on the sign-out timeout and on every owner change.
- **Flush**: `flushOfflineWriteQueue` / `executeFlush` sends the queue.
- **Sync**: `syncServerTasks` waits for the chains, flushes, then applies the
  **snapshot** (`GET /api/tasks` through `applyServerTaskSnapshot`), the
  categories and the board preferences.
- **Owner change**: `applyUserScope` (WIP, #84) or `App.svelte`
  `applyStorageScope` (`main`). It happens on sign-out, on an account switch
  without sign-out, when another tab signs out (better-auth broadcasts it),
  when the server revokes the session, and when a session check fails on a
  network that reports online (App.svelte treats that as signed out).

## Verification rounds

| Round | Target | Who | What |
| --- | --- | --- | --- |
| 0 | `db129c8` (#84 before push) | PR5 review | Real-browser probes. Found that the clear question counted before the wait; fixed by `c8e2ea0` |
| — | `b31d239` (#84 pushed) | Codex | The P1 above |
| 1 | `f86c6fa` (after `320004d`…`f86c6fa`) | verify-1, verify-2 | Differential probes against the #84 base `b52b309`. 2 regressions, 1 regression that trades against a data loss, several residual and pre-existing issues |
| 2 | `256130e` (after the round 1 repair) | three lenses | **fuzz**: about 56k randomized runs and 14 shrunk repros, compared with `main`. **crosstab-reload**: a two-tab and reload harness with 8 probes. **complexity**: a design review with 6 repros |
| 3 | `21a3e0b` (after the round 2 repair) | repair | Re-ran the lens probes: T1a, T1b, T3, T4, T5, crosstab R1, R1b, R2, probe3, probe5 and fuzz R3, R4, R4b pass; the rest fail as on `main` |
| — | 2026-09-27 | this branch | Every probe and a 2,500-seed campaign on the WIP, the descoped #84 (`9dee2b4`) and `origin/main` (`c0c7f51`); results in `tests/sync-fuzz/README.md` |

The repro files are in `tests/sync-fuzz/` (how to run them against any
checkout: `tests/sync-fuzz/README.md`). The WIP's own failing-first unit tests
are in `src/lib/client/user-scope.test.js`,
`src/lib/client/task-store/sync-engine.test.js`,
`src/lib/client/offline-write-queue.test.js` and
`src/lib/client/task-store/task-cache.test.js`, added by the `test(client)`
commits listed above. They pass on this branch.

Invariants used throughout: **I1** no silent loss of a user's edit, **I2** no
cross-user leak, **I3** no resurrection (a deleted task or item returning, an
older value overwriting a newer one, a duplicate), **I4** no spurious conflict
(the user's own sequential edits reported as a 409).

## Findings already on main

All of these are open on `origin/main` and on the descoped #84. The last line
of each says what the WIP does about it.

<a id="m1"></a>
### M1. A task write that outlives sign-out lands in the anonymous queue (I1, I2)

The original #84 probe, and the Codex P1 on `main`. A write in flight at
sign-out, or waiting in its chain behind one, is sent or answered after the
session ended. It gets 401 (or any fallback), and `reportSyncFailure` queues it
for whoever owns the queue by then: `anonymous`. "Clear local data" only clears
the signed-in user's queue, and its count (the queue size) does not include
writes in flight, so the question can be skipped while the edit is still
unsent. The edit never reaches its user, and its text stays on the
device. A real-browser probe on the PR4 base (two quick priority edits, then
sign-out) sent only the first edit.

- Repro: the WIP's `src/lib/client/user-scope.test.js` › "signing out during
  a task edit" (`513a4ae`: a chained edit sent after sign-out) and › "signing
  out while a task write is still in flight" (`320004d`: a write still out
  after the wait). Both drive the WIP's sign-out flow. On any checkout, the
  fuzzer: `I1:anon-queue-orphan` 340 and `I2:queue-foreign` 168 of 2,500 runs
  on `main`, against 32 and 27 on the WIP. With `createTask` disabled, the WIP
  has 0 of either and `main` still has 310 and 147, so what is left on the WIP
  is M2.
- WIP: fixed by `b31d239` (wait), `79bee3c` (owner binding), `3bd0a4c` (count
  and discard), `bfcec00` (drain before an owner change).

<a id="m2"></a>
### M2. `createTask` and `importTasks` are not bound to their user (I1, I2)

`task-mutations.js` `createTask` awaits the server outside any chain, so no
wait, count or discard sees it. Its fallback runs `insertTask` and
`enqueueOfflineMutation` for the current owner, and its success runs
`insertTask` into the current store. A create still out at sign-out lands in
the anonymous queue and cache; with "clear local data" on, the count is 0, no
question is asked, and the title is left in `kanbanTasks:anonymous`. If B
signs in first, a fallback queues A's task in B's queue and B's next sync
creates it in B's account; a late success inserts it into B's board and
`kanbanTasks:ub`. `importTasks` has the same shape.

- Repro: `tests/sync-fuzz/fuzz/repro.test.js` › R1a, R1c (sign-out), R1b
  (next user). Fuzzer: the only source of `I1:anon-queue-orphan` on the WIP
  (251 of 20k runs at `256130e`, 0 with `createTask` disabled); seed 120 shrinks
  to "createTask; switchAccount; POST → 503"; seed 10 shows the late-success
  leak (`I2:store-foreign`).
- WIP: open. Suggested fix (round 1 notes): capture the owner before the
  await, skip `insertTask` when it changed, queue a fallback under the captured
  owner, and include the request in the count and the discard.

<a id="m3"></a>
### M3. A late sync snapshot is applied after the owner changed (I2)

`syncServerTasks` checks the owner (on the WIP, also the clear counter) only
around the flush. The `listServerTasks`, `listServerCategories` and
`getBoardPreferences` answers are applied without checking again. A's
snapshot answered after A signed out and B signed in writes A's whole board
into B's store and `kanbanTasks:ub` (B's own snapshot replaces it only if it
lands later). With no next sign-in it writes A's tasks into
`kanbanTasks:anonymous` right after A confirmed "clear local data".

- Repro: `repro.test.js` › R2, R2b. Fuzzer: `I2:store-foreign` /
  `I2:cache-foreign`, 162–166 per 2,500 runs on every checkout; seeds 81 and
  1565 shrink to 3–6 steps.
- WIP: open. The fix is the same guard as the flush's, applied to each answer.

<a id="m4"></a>
### M4. A queue flush outlives its user (I2, I1)

On `main`, `executeFlush` loads the queue once, sends each mutation with
whatever session cookie is current, and reconciles and saves under whoever owns
the queue when it ends. If A signs out and B signs in while a flush request is
out:

- A's remaining mutations go out under B's session: A's queued `task.create`
  is created in B's server account, and A's patches get 404, which is not a
  fallback.
- The reconcile writes B's key, so A's key keeps every entry, and they replay
  at A's next sign-in (409s, duplicate creates). A replace or append import
  that completes mid-switch puts A's tasks on B's board and cache. The
  throttled "done" follow-up is queued under B.
- A flush that is still out when the user confirms "clear local data" can
  put data back. It enqueues its throttled "done" follow-up into the cleared
  queue, and `syncServerTasks` writes a completed import's tasks to the
  cleared board and cache (`replaceTasks` / `mergeTasks`). This was found while
  fixing M4 in round 1 (tests `c72472e`); the `main` behavior comes from
  reading the code, not from a probe.

- Repro: `repro.test.js` › R3; `tests/sync-fuzz/design/pr84-design-scope.test.js`
  › T4 (needs `user-scope.js`); `user-scope.test.js` › "a sync of the offline
  queue that outlives its user" (`78cbf7f`) and the clear cases (`c72472e`).
  Fuzzer: `I2:server-write-foreign-task` 211 of 2,500 on `main`, 0 on the WIP;
  seeds 748 and 841.
- WIP: fixed by `7819023`, `256130e` and `21a3e0b`. One gap was reported and
  not verified: an owner change after `executeFlush` returns but before
  `syncServerTasks` resumes (the Web Locks task hop) still drops that flush's
  conflicts.

<a id="m5"></a>
### M5. A spurious 409 after the user's own later write (I4)

A queued `task.patch` keeps the `expectedVersion` it was queued with. Any later
write of the same task by the same user that lands outside that flush moves
the server's version. Examples: a chained checklist toggle, rename, create or
delete (the server bumps the task version on checklist writes), or a task
delete. The next flush then gets a 409, and the banner reports the user's own
sequential edit, which is not applied unless the user picks "내 변경 적용". A
variant: deleting a task while the flush sends its queued edit. The DELETE
expects the version before that PATCH, gets 409, the banner shows it, and the
task stays on the server and the board.

- Repro: `repro.test.js` › R5, R5b; `tests/sync-fuzz/design/pr84-design-review.test.js`
  › T2. This is the most frequent fuzzer class: `I4:conflict-banner` in 1,616 of 20k runs at
  `256130e`, and 407 of 2,500 on `main`. On the WIP, seed 522 also reaches it
  through the sign-out timeout's drain.
- WIP: partly. `f86c6fa` and `9796ff0` advance only a queued edit that was
  drained behind the landed write. `e919913` retires a queued edit that a later
  edit was built on. T2, R5 and R5b still fail. A landed checklist write
  cannot prove that no other device wrote in between, because checklist writes
  carry no `expectedVersion`.

<a id="m6"></a>
### M6. The flush works from a stale copy of the queue (I1, I3)

`executeFlush` reads the queue once, at the start.

- (a) An edit that supersedes a queued edit in storage does not stop the flush
  from sending its older in-memory copy. `withRefreshedExpectedVersion` gives
  that copy the version from an earlier answer in the same flush, so it passes
  the version check and overwrites the newer value. R6: `ua.t1:2` lands, then
  the flush writes `ua.t1:1`.
- (b) An edit that coalesces into a mutation the flush has already read (the
  same queue entry id) is dropped by `reconcileQueueAfterFlush` with only
  `console.warn('Dropped an offline edit that raced its own completed sync.')`.
  This covers renaming, checking or deleting an item whose queued create is
  being sent (R6b: the rename is lost, or a deleted item is created), and a
  title edit of a task whose queued create is being sent (fuzz seed 100007
  shrinks to "offline; createTask; online; editTitle"). It also covers a late
  chain failure, from this tab or another, merged into the entry a flush is
  sending (crosstab probe6).

- Repro: `repro.test.js` › R6, R6b; `tests/sync-fuzz/crosstab/crosstab-probe6.test.js`.
  Fuzzer: `I3:server-title-regressed`, `I3:server-item-text-regressed`
  (seeds 1435, 704, 831, 229), coalesce drops (seeds 84, 1757, 907, 39).
- WIP: open. The WIP only stops the loop when the owner changes.

<a id="m7"></a>
### M7. A drain loses the edit of a new checklist item (I1)

Take a chain holding [DELETE item i2 (in flight), create item i9 (waiting),
check i9 (waiting)]. The DELETE answer merges the server copy, which has no i9
yet, so i9 leaves the board until its create lands. A drain in that window
cannot find i9 for the check (`buildChecklistDrainMutation`) and queues
nothing, so the create lands unchecked. On `main` the drain comes from
`pagehide`. The WIP adds the sign-out timeout (fuzz seed 79).

- Repro: `repro.test.js` › R7.
- WIP: open.

<a id="m8"></a>
### M8. A snapshot and a flush create leave a permanent local duplicate (I3)

1. Sync 1's `GET /api/tasks` is out. The user goes offline and creates a task
   (a local task plus a queued create), then comes back online.
2. Sync 2's flush creates the task on the server, but its answer is slow.
3. Sync 1's snapshot, read after the create, lands first. It adds the server
   copy and keeps the local one.
4. The flush answer runs `replaceLocalTaskInList` (local id → server id), which
   leaves two tasks with the same id. `normalizeTaskList` gives one of them a
   fresh local id.

That local copy survives every later snapshot, because snapshots keep
local-id tasks. Its edits are dropped by the queue's coalescing, because it
has no pending create.

- Repro: `repro.test.js` › R8. Fuzzer: `DIVERGE:store-server-diverge`
  (seed 103716 shrinks to 3 actions), `I3:duplicate-task`.
- WIP: open.

<a id="m9"></a>
### M9. `applyServerTaskSnapshot` resurrects deleted tasks and items (I3)

The snapshot re-adds any server task missing from the board (`if (!existing)`
in `applyServerTaskSnapshot`), including one the user just deleted while its
DELETE is still chained. It also replaces tasks whose edits or deletes are
queued rather than chained, because it checks only `hasPendingTaskSync`.
Seed 407 (weights `createTask` and `switchAccount` 0), replayed on the WIP
after shrinking:

1. A sync's `GET /api/tasks` is out (in the shrunk run, the sign-in sync's).
2. Edit t2's title to 1. The PATCH goes out.
3. Edit it to 2. The snapshot write waits in the chain.
4. Delete t2. The DELETE waits, and t2 leaves the board.
5. The GET is answered with the server state from before the PATCH, and
   `applyServerTaskSnapshot` puts t2 back as `t2:0`.
6. The PATCH lands at v2. The waiting write builds from the resurrected copy
   and sends `t2:0` at v2, which passes, so the server title goes back from 1
   to 0. Edit 2 never reaches the server.
7. The DELETE lands last.

In seed 70, an item's DELETE fails into the queue, then an older snapshot shows
the item again.

- Repro: `FUZZ_WEIGHTS='{"createTask":0,"switchAccount":0}' FUZZ_SEED=407 npm run test:sync-fuzz -- fuzz/replay.test.js`
  (then `fuzz/shrink.test.js` with `FUZZ_CLASS=I3:server-title-regressed`).
  Fuzzer: `I3:store-resurrect-item` 1,591 and `I3:store-resurrect-task` 444
  of 20k runs at `256130e`; 283 and 56 of 2,500 on `main`.
- WIP: open.

<a id="m10"></a>
### M10. The board drops an edit that is still queued (UX; loss with the retire rule)

Three paths replace a task on the board while it has a queued (not chained)
mutation, because each checks only chain state (`hasPendingTaskSync`):

- `applyServerTaskSnapshot`: a snapshot whose GET was out when the edit
  failed.
- `applyServerTaskResults`: the answers of a partly blocked flush, for
  example a checklist edit landing while the task's title edit is blocked.
- The cross-tab handler: `handleExternalTaskStorageEvent`.

On `main` the edit is still queued. It comes back as a 409 banner, so it is
visible and "내 변경 적용" restores it, but the board shows the old value in
the meantime. This is the premise the WIP's first retire rule got wrong
([W5](#w5)).

- Repro: the board revert is visible in R4 and R4b (`boardTitleAfterPartialSync: "ua.t1:0"`
  on every checkout), `crosstab-probe3.test.js`, `crosstab-probe5.test.js` and
  design T1b.
- WIP: open. The WIP protects only chain answers, through
  `hasQueuedTaskMutation` in `applyWriteResult`.

<a id="m11"></a>
### M11. A reload or tab close with a request in flight (I1, I4)

`drainPendingTaskSyncsToOfflineQueue` only moves writes that have not started.

- RL1: a write whose request is out at `pagehide`, a reload or a tab close
  exists only in the cached board. If the unload aborts it before the server
  commits (an edit followed right away by Cmd+W, or the `controllerchange`
  reload), the next page's first snapshot replaces the task and the edit
  disappears without notice.
- RL2: edit 1 is out and edit 2 waits. The `controllerchange` reload after a
  deploy, or a `pagehide`, drains edit 2 with edit 1's `expectedVersion`. Edit
  1 commits, but no page is left to read its answer, so after the reload the
  flush sends the old version and the banner reports the user's own
  sequential edit.

- Repro: `tests/sync-fuzz/crosstab/crosstab-probe4.test.js` › RL1, RL2.
- WIP: open. `taskStateQueued` and `writesInFlight` exist only in memory.

<a id="m12"></a>
### M12. A drained later edit is overwritten by the earlier request's late failure (I1, I3)

When a drain queues a later edit while an earlier request for the same task or
item is still out, and that request then fails with a fallback, queueing the
failure merges it on top ("later on top"). The older text or `done` value
replaces the newer one. A failed checklist create next to a drained create
queues a second create. On `main` the only drain is `pagehide`, so this needs
a page that survives it (bfcache) and a request that fails afterwards. The
sign-out timeout in `b31d239` made it common, and the owner binding in
`79bee3c` moved the sign-out case from the anonymous queue into the user's own
queue ([W3](#w3)).

- Repro: `sync-engine.test.js` and `user-scope.test.js` tests from `fe2f895`
  ("keeps the later toggle…", "queues one create of an item…").
- WIP: fixed for task writes (`taskStateQueued`) and checklist writes
  (`da0b423`).

<a id="m13"></a>
### M13. A create that lands after its drained re-create duplicates the item (I3)

A checklist create is out and a drain queues its item again (as a create with
the later edits). If the POST lands, nothing updates the queued re-create,
which replays and makes a duplicate item. This has the same bfcache-only reach
on `main`.

- Repro: `fe2f895` › "turns the queued create into an edit of the item when
  its create lands after the sign-out".
- WIP: fixed by `resolveQueuedChecklistCreate` (`da0b423`).

<a id="m14"></a>
### M14. A late answer after an owner change leaves the previous user's cache stale (I4, I3)

A write that lands after the owner changed is not applied to that user's
cached board. `kanbanTasks:<A>` keeps the old version, so an edit made after A
comes back (for example through the cached offline unlock), before the first
snapshot, gets a 409. It is queued at the stale version and conflicts again at
the flush. A created item's local id also stays in the cache and turns into
an orphan beside the server's copy.

- Repro: `user-scope.test.js` › tests from `5d0603a`.
- WIP: fixed by `a938a9d`.

<a id="m15"></a>
### M15. The next user's first sync waits on the previous user's request

`syncServerTasks` awaits `waitForPendingTaskSyncs()`, which waits on every
chain, including a previous user's request that has no answer yet. When the
owner changes mid-sync, the next user's first sync is also blocked by the
flush lock and skips its snapshot until the next trigger.

- WIP: open (round 1 and round 2 repair notes).

<a id="m16"></a>
### M16. A version-only advance can hide another device's edit (I3, policy)

`toChainedServerTaskPatch` adopts any chained answer's version. Checklist
writes carry no `expectedVersion`, so their answer's version can include
another device's edit. The chained task patch that follows sends all fields
(`toServerTaskPatch`) at that version and overwrites the other device's edit
without a 409. On `main` this stays inside one chain.

- WIP: `f86c6fa` extended it to the queue ([W7](#w7)), and `9796ff0` took that
  back. The board's own version-only advance for a task with a newer queued
  edit is unchanged.

<a id="m17"></a>
### M17. Cross-tab limits

- "Clear local data" in one tab counts and discards only that tab's writes.
  Another tab still on the same user can refill the user's queue and cache
  through its in-flight answers, its drain at `applyUserScope`, and its
  persistence. This is not an I1–I4 violation, and `main` does the same.
- bfcache restore: there is no `pageshow` resync, so storage events missed
  while the page was frozen leave a stale board. Not verified.
- Sending a user's queue under another user's cookie from a stale tab:
  better-auth broadcasts the sign-out and the next request gets a 401, which
  blocks the flush. No practical path was found. Not verified.

## Findings introduced by the WIP, then fixed in the WIP

<a id="w0"></a>
### W0. The clear question was asked before the wait (round 0)

`b31d239` asked "clear local data" and then waited. A write that failed during
the wait went into the user's queue after the count and was deleted without
asking; a 409 there was a conflict the user could have resolved. Fixed by
`c8e2ea0`. With the wait dropped from #84, this is moot there.

<a id="w1"></a>
### W1. The Codex P1: the timed-out request was left unprotected

The quoted P1. `settlePendingTaskSyncs` drained only the writes waiting behind
the active request, and `c8e2ea0` made the count run after the wait, so the
clear path could count 0 while the active write was still unsent. Before
`b31d239`, on `main`, the same write went to the anonymous queue with no wait
at all (M1). What `b31d239` added was a sign-out that looked safe but was not.

- Fixed by `79bee3c`, `3bd0a4c` and `bfcec00`. Tests: `320004d`.

<a id="w2"></a>
### W2. The timeout drain queued edits at a stale version (round 1)

`b31d239` accepted this trade-off in its message. A patch drained while an
earlier PATCH of the task is out carries that PATCH's `expectedVersion`.
After the PATCH lands, the next sync gets a 409, and on the same user's board
the late answer puts the older text back.

- Fixed by `f86c6fa` (`advanceQueuedTaskVersion`, `newerEditQueued`), which
  `9796ff0` later narrowed ([W7](#w7)).

<a id="w3"></a>
### W3. Owner binding let an older write win in the user's own queue (round 1, verify-1)

- verify-1 #1, a regression from `79bee3c`. User A renames a server checklist
  item to "first", and the PATCH stalls. A renames it to "last", which waits
  in the chain. A signs out (keeping data), and the 5 s wait drains "last"
  into A's queue. The stalled PATCH then gets 401, and `queueWrite` merges
  "first" on top of "last" in A's own queue. A's next sign-in sends "first".
  Toggles behave the same way. At `b52b309`, "last" stayed in A's queue and
  "first" went to the anonymous queue.
- verify-1 #2, a regression from `79bee3c`. `addSubtask` stalls, a toggle of
  the new item is chained behind it, and the drain queues
  `checklist.create {done:true}`. The POST then gets 401 and appends a second
  create, so A's queue holds two creates for one item.
- The design flaw behind both, which round 1's fix found for task patches
  itself: once a late failure goes to the owner's own queue, it lands on top
  of the later edit the drain queued behind it.
- Fixed by `taskStateQueued` in round 1 for task writes, and by `da0b423` for
  checklist writes (with `fe2f895`). `da0b423` also fixes two variants: a
  failed create that brought back an item deleted while the create was out,
  and a landed create whose drained delete never reached the server.

<a id="w4"></a>
### W4. A spurious 409 after signing out and back in while a write hangs (round 1, verify-2 #1)

This is a regression from `bfcec00`, which drains the chains on every owner
change.

1. User A's PATCH W1 (`Edit 1`) hangs, and W2 (`Edit 2`) waits behind it.
2. The session goes to no user and back to A: another tab signs out, or the
   server revokes the session and A signs in again.
3. A edits the task again (`Edit 3`) before W1 settles.
4. W2 was drained as P (`Edit 2`, v1), and `Edit 3` becomes W3.
5. W1 lands at v2, so P is advanced to v2. W3 lands at v3.
6. The flush sends P and gets a 409. The banner offers the older `Edit 2` as
   "local", and applying it would overwrite `Edit 3`.

The base had no conflict here, because W2 stayed in the chain and read
`Edit 3` from the board. The residual variant (verify-2 #2), where A edits
again before W1 settles after a plain sign-out, was already in `b31d239`.

- Fixed by the retire rule `f90c5d0`, later made safe by `e919913`. Test:
  `ccf000f` › "retires the queued edit once the edit made after the user
  came back lands".

<a id="w5"></a>
### W5. The retire rule silently dropped queued edits (round 2: all three lenses)

`f90c5d0` (`dropQueuedTaskPatch` in `scheduleTaskSnapshotSync`,
`dropQueuedChecklistFields`) dropped a task's queued edit whenever a chained
edit of that task landed. It assumed the board held every queued edit, which
is false in three ways ([M10](#m10)):

- Another tab queued the edit, and this tab ignored that tab's cache update
  while its own chain was busy. Crosstab R1 (a 409 variant) and R1b (a
  network-error variant) lose B's rename. R2 loses B's newer uncheck: the
  server keeps `done:true`, the opposite of the user's last action. Design
  T1a shows the same.
- A snapshot applied while a failed edit waited in the queue: `crosstab-probe5`,
  fuzz R4b, design T1b.
- The answers of a partly blocked flush reverted the board: `crosstab-probe3`,
  fuzz R4 (the fuzzer shrank this independently from seeds 1019, 1234, 1779
  and 3270).

In all of these the next edit was built from the reverted board, and when it
landed the rule deleted the queued edit. On `main` every one of these edits
stays queued and comes back as a 409 banner (for a checklist field, it is
simply applied).

- Made safe by `e919913`. A write now records the one queued edit it was made
  on (`TaskSyncWrite.olderQueuedEdit`: the entry id and the fields it sets),
  and only if every field matches the board copy just before the user's edit
  (`syncTaskSnapshot(task, previous)`, passed by `moveTask`, `assignParent`,
  `updateTask` and `category-store.js`). It drops that entry, and only while
  the entry is unchanged. Tests: `731e024`; all the probes above pass at
  `21a3e0b`.

<a id="w6"></a>
### W6. A queue sync lost its 409s when the owner changed (round 2, complexity T3)

This was introduced by `7819023`. `executeFlush` counted a 409'd mutation as
processed and removed it from the owner's queue, and `syncServerTasks` then
reported no conflicts because the owner had changed. The edit was not on the
server, not in the queue, and not shown to anyone.

- Fixed by `21a3e0b`: the 409s stay in the departed owner's queue and are
  reported at their next sync. Repro: `pr84-design-scope.test.js` › T3,
  `e85639d`.

<a id="w7"></a>
### W7. The advance rule moved a queued edit past another device's version (round 2, complexity T5)

This was introduced by `f86c6fa`. `applyWriteResult` advanced the drained
patch whenever `taskStateQueued` was set, including after a checklist write,
whose answer can include another device's edit. The moved patch, which sends
all fields, then overwrote that edit without a 409.

- Fixed by `9796ff0`: advance only when the queued edit expects
  `version - 1`. Repro: `pr84-design-review.test.js` › T5, `0ce6aa8`.

### Rejected

- verify-2 #5: "countPendingLocalChanges double-counts". The in-flight write
  and its drained successor are two user edits, and counting a request that
  may still succeed only means asking more often.

## Still open on the WIP (`21a3e0b`)

- **Findings from main**: M2, M3, M5 (T2, R5, R5b), M6, M7, M8, M9, M10, M11,
  M15, M16 and M17.
- **The Web Locks gap in M4**: an owner change between `executeFlush`
  returning and `syncServerTasks` resuming drops that flush's conflicts.
- **Coupling** (complexity review): `sync-engine.js` imports 8 names from the
  queue module, and 5 of them edit queue entries in place. Their correctness
  depends on `coalesceQueue` internals that `sync-engine.js` comments restate,
  and no test pins that contract. The comment in `src/architecture.test.js`
  ("The folder adds to the queue and flushes it") is out of date.
- **Retire and advance rules**: they are a set of local repairs, not one
  invariant. T2 shows the gap they leave for the user's own sequential edits.

## Recommended design for the follow-up

### What the complexity review said

This is the verify:complexity lens's conclusion at `256130e`, before
`e919913`, `9796ff0` and `21a3e0b`.

**Recommendation:** do not ship the 17 commits as they are. Keep the
owner-binding core with small fixes, take the retire rule out, and replace the
timeout-interplay layer with a simpler design.

**Proportionality:** the core fixes the Codex P1 at a reasonable size:

- each write is bound to its owner, so a late failure goes to that user's
  queue (`queueWrite`);
- `writesInFlight` and `countPendingTaskSyncs` let the clear question count
  requests still out;
- `discardPendingTaskSyncs` drops them on a confirmed clear;
- the chains are drained before the owner changes;
- a late answer goes to the old user's cached board;
- the flush saves to its own owner's queue.

About 200 more lines exist only because the sign-out timeout drains later
writes into the queue while an earlier request is still out. That breaks
enqueue order, which the queue's coalescing ("later on top", "delete cancels
create") depends on. The WIP then repairs that break case by case:
`taskStateQueued`, `queuedItemEdits`, `markQueuedBehindRequestsInFlight`,
`withoutFieldsQueuedLater`, `handQueuedEditsToCreatedItem`,
`resolveQueuedChecklistCreate`, `advanceQueuedTaskVersion`, and the retire
rule.

**Small changes:**

1. In the `executeFlush` loop, stop and keep the rest when the owner or the
   clear count changes, and put that flush's conflicts back in the owner's
   queue. Done in `21a3e0b`.
2. Use one scope token `{ ownerId, cleared }` instead of `queueOwnerId`,
   `storeOwnerId` (always set together; only null vs `'anonymous'` differs),
   the `discarded` flag, `queueClears` and `localTaskCacheClears`. Merge
   `drained` and `discarded` into one state field.
3. Call the drain from `setTaskStoreOwner` (`owner.js`), so `user-scope.js`
   no longer needs to know chain internals or the "drain before switching"
   order.
4. Take out `f90c5d0`, or at least make `hasPendingTaskSync` count queued
   mutations and retire only entries this tab queued that are unchanged
   since. The WIP did a version of the latter in `e919913`.
5. Advance a queued version only when `answer.version === queued.expectedVersion + 1`.
   Done in `9796ff0`.

**Simpler timeout layer: freeze in the chain instead of draining.**

- At the sign-out timeout, drain nothing. The count already includes waiting
  and in-flight writes, and a cancelled sign-out then needs no undo, which
  removes the need to retire anything on that path. A confirmed clear still
  discards.
- On an owner change, freeze the old owner's pending writes: capture the
  board task each would build from and leave them in the chain. When a frozen
  write's turn comes (after the earlier request settles), it sends nothing.
  It builds its mutation from the captured task plus the chain's latest
  version and resolved item ids, and queues that under its owner.
- Causal order is then back, so the existing coalescing does the job of
  `taskStateQueued`, the item marks, the create hand-over,
  `resolveQueuedChecklistCreate` and `advanceQueuedTaskVersion`. That removes
  about 250 lines and 4–5 queue exports.
- Risks:
  - Frozen writes live only in memory until the earlier request settles. The
    `pagehide` drain still covers unload.
  - A hung fetch holds them. Add `AbortSignal.timeout` to chained requests,
    treated as a retryable failure. That can duplicate a checklist create,
    which the drain builder already accepts.
  - Sign-out tests that expect drained entries must switch to counts.
  - The `pagehide` 409 limitation (M11 RL2) stays.

**Alternatives it rejected:**

- An `AbortController` on owner change plus re-queueing is not safe without
  server idempotency keys. An abort does not undo a request the server already
  committed, so re-queued patches would conflict with themselves and creates
  would duplicate.
- A per-task "latest intended state" record needs per-field sequence numbers,
  and it is still lossy across tabs with all-field patches.

**The lasting fix** is a server-side precondition on the client's last write
(a write id), in a later PR.

### Starting design

What follows is the proposal for the new project. It combines the review
above with what the fuzzer and probes showed.

1. **Keep the owner-binding core.** Bind each chained write to its owner when
   it is chained. A late failure goes to that owner's queue, and a late answer
   goes to that owner's cached board, never the current one. Count waiting and
   in-flight writes for the clear question, and discard them on a confirmed
   clear. Bind the flush to its owner and stop it between requests when the
   owner changes or the queue is cleared, keeping that owner's 409s. Hold all
   of this in one scope token (small change 2), and run the chains' owner-change
   step from `setTaskStoreOwner` (small change 3; with step 2 that step
   freezes instead of draining). This covers M1, M4, M14 and W1.
2. **Drop the retire and advance rules and the drain-order repairs**
   (`taskStateQueued`, `queuedItemEdits`, `olderQueuedEdit`,
   `dropQueuedTaskPatch`, `dropQueuedChecklistFields`,
   `advanceQueuedTaskVersion`, `resolveQueuedChecklistCreate`,
   `hasQueuedTaskMutation`, and the rest of the list above). Restore causal
   order instead:
   - Freeze pending writes in the chain on an owner change, and do not drain
     at a sign-out timeout (the review's design).
   - Give every queued mutation a per-owner sequence number, taken when the
     user makes the edit rather than when the mutation reaches the queue.
     Coalescing then applies "later on top" and "delete cancels create" by
     sequence, so a late failure of an older write can never land over a
     newer queued edit, whatever order they arrive in. That covers the
     `pagehide` and bfcache cases (M12, M13) without per-case marks.
   - The same numbers let a flush record the highest sequence it has read.
     An edit made after that is appended as a new entry instead of being
     merged into one the flush is sending, and the flush re-reads an entry
     before sending it and skips a copy that a newer entry superseded
     (M6 a and b).
   - This is not the per-field "latest intended state" record the review
     rejected. It orders whole mutations and leaves merging to the existing
     coalescing.
3. **Close the other owner leaks on the same token**: bind `createTask` and
   `importTasks` (M2), and guard each snapshot, category and preference
   answer (M3). These are I2 leaks on `main` today, independent of the rest,
   and each has a repro that should turn green (R1a–R1c, R2, R2b).
4. **Then the version policy** (M5, M16), as its own decision. Advance a
   queued `expectedVersion` only when a versioned answer proves adjacency
   (`answer.version === expectedVersion + 1`). Checklist writes cannot prove
   it today. Options to evaluate:
   - checklist writes send and check an `expectedVersion`;
   - answers report the version they started from;
   - task patches send only the fields the user changed (the server has
     accepted partial PATCH since #56; the client sends all fields in
     `toServerTaskPatch`), so an advanced patch cannot overwrite another
     device's fields.
5. **Then the snapshot and flush races** (M6, M7, M8, M9, M10, M11). Their
   repros are listed below. Make the snapshot respect queued mutations, not
   only chains, before relying on the board for anything.
6. **The lasting fix**: a client write id checked by the server (idempotency
   and last-write precondition). That also makes abort-and-requeue safe.

Each step should turn specific repros from ✗ to ✓ on its branch; the
`tests/sync-fuzz/README.md` table is the baseline, and the fuzzer's class
counts should only go down. The WIP's unit tests (`320004d` … `e85639d`) are
also worth keeping as behavior specs where they still apply to the new
design.

## Repro index

| ID | File › test | Finding | WIP | descoped #84 | main |
| --- | --- | --- | --- | --- | --- |
| R1a, R1c | `tests/sync-fuzz/fuzz/repro.test.js` | M2 | ✗ | ✗ | ✗ |
| R1b | `fuzz/repro.test.js` | M2 | ✗ | ✗ | ✗ |
| R2, R2b | `fuzz/repro.test.js` | M3 | ✗ | ✗ | ✗ |
| R3 | `fuzz/repro.test.js` | M4 | ✓ | ✗ | ✗ |
| R4, R4b | `fuzz/repro.test.js` | W5 (M10) | ✓ | ✓ | ✓ |
| R5, R5b | `fuzz/repro.test.js` | M5 | ✗ | ✗ | ✗ |
| R6, R6b | `fuzz/repro.test.js` | M6 | ✗ | ✗ | ✗ |
| R7 | `fuzz/repro.test.js` | M7 | ✗ | ✗ | ✗ |
| R8 | `fuzz/repro.test.js` | M8 | ✗ | ✗ | ✗ |
| seed 407 | `fuzz/replay.test.js`, `fuzz/shrink.test.js` | M9 | ✗ | ✗ | ✗ |
| seed 100007 | `fuzz/silentcmp.sh` | M6 (b) | ✗ | ✗ | ✗ |
| R1 (409), R1b (network) | `crosstab/crosstab-probe.test.js`, `crosstab-probe1b.test.js` | W5 | ✓ | ✓ | ✓ |
| R2 (checklist) | `crosstab/crosstab-probe2.test.js` | W5 | ✓ | ✓ | ✓ |
| R5 (blocked flush) | `crosstab/crosstab-probe3.test.js` | W5 (M10) | ✓ | ✓ | ✓ |
| R5b (snapshot race) | `crosstab/crosstab-probe5.test.js` | W5 (M10) | ✓ | ✓ | ✓ |
| RL1, RL2 | `crosstab/crosstab-probe4.test.js` | M11 | ✗ | ✗ | ✗ |
| R6 (cross-tab coalesce) | `crosstab/crosstab-probe6.test.js` | M6 (b) | ✗ | ✗ | ✗ |
| T1a, T1b | `design/pr84-design-review.test.js` | W5 | ✓ | ✓ | ✓ |
| T2 | `design/pr84-design-review.test.js` | M5 | ✗ | ✗ | ✗ |
| T3 | `design/pr84-design-scope.test.js` | W6 | ✓ | ✓ | – |
| T4 | `design/pr84-design-scope.test.js` | M4 | ✓ | ✗ | – |
| T5 | `design/pr84-design-review.test.js` | W7 | ✓ | – | – |

✓ = the invariant holds, ✗ = it fails, – = not applicable (the code is not
there). All the ✓ in the WIP column were ✗ at `256130e`
(`tests/sync-fuzz/recorded/`). R4/R4b, the crosstab retire probes and T1a/T1b
pass on `main` because `main` has no retire rule. There they show the board
revert of M10 and end in a 409 banner.

## Fuzzer numbers

Campaigns over seeds 100000–102499, 40 actions each (the fuzzer's defaults
otherwise):

| Checkout | Clean | `I4:server-409` | `I4:conflict-banner` | `I1:title-mismatch` | `I1:anon-queue-orphan` | `I2:server-write-foreign-task` | `I2:queue-foreign` | `I3:store-resurrect-item` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `256130e` (round 2) | 1784 | 249 | 203 | 167 | 32 | 17 | 27 | 214 |
| WIP `21a3e0b` | 1786 | 258 | 219 | 164 | 32 | 0 | 27 | 214 |
| descoped #84 `9dee2b4` | 1200 | 436 | 407 | 384 | 340 | 211 | 168 | 283 |
| origin/main `c0c7f51` | 1200 | 436 | 407 | 384 | 340 | 211 | 168 | 283 |

Round 2 volume on `256130e`: about 56k runs.

- 20,000 runs × 40 actions: 14,465 clean.
- 4,000 runs × 100 actions: 1,915 clean.
- About 19k runs with `createTask` or `switchAccount` disabled.

Against `main` on the same seeds: 1,949 clean against 2,783 on one 4,000-seed
set, and 3,417 against 4,703 on 6,000 seeds with `createTask` and
`switchAccount` disabled. In the runs with `createTask` disabled, no chain
write reached the anonymous queue or another user's board.

The same 2,500 seeds with `createTask` disabled (`FUZZ_WEIGHTS='{"createTask":0}'`),
run for these notes:

| Checkout | Clean | `I1:anon-queue-orphan` | `I2:queue-foreign` | `I2:store-foreign` | `I2:server-write-foreign-task` | `I4:conflict-banner` |
| --- | --- | --- | --- | --- | --- | --- |
| WIP `21a3e0b` | 1895 | 0 | 0 | 106 | 0 | 229 |
| origin/main `c0c7f51` | 1333 | 310 | 147 | 100 | 198 | 382 |

The `I2:store-foreign` left on the WIP is the class M3 produces; the fuzz lens
shrank seeds of it (81, 1565) to the late snapshot. These 106 runs were not
shrunk one by one.

The fuzzer does not cover:

- backup import, category writes and default-view writes;
- parent/child tasks;
- cross-tab storage events (the crosstab harness covers those);
- page reload and module re-init;
- answers the server processed but the client never received (duplicate
  creates);
- a real concurrent second device;
- edits made between the confirm dialog and `clearUserLocalData`.
