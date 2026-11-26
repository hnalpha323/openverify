# Phase 11, Workflow 11B Stage 2: quotas (family P; C251, KP11-17, KP10-27)

TDD evidence of `quotas`: one admission model for every queue that holds one environment's work
(C251.1), the caps and the install ceiling (C251.2), the console's queue panel (C251.3), the metrics
and the warn line (C251.4), the repair sweep's admission check (a named borrowed edit), and the
recovery passes of KP11-17 (`connect-redeem`) and KP10-27 (`integrity-decode`). Commands run from the
repository root after `source scripts/env.sh` unless a `cd` is shown; every timing has
`cat /proc/loadavg` beside it.

Owned paths: `apps/api/src/services/quotas/`, `apps/api/src/jobs/quota-sweep.ts`,
`packages/db/src/repositories/queue-slots.ts`, `apps/dashboard/src/components/quotas/` and their
tests. Named borrowed edits: `apps/dashboard/src/app/settings/page.tsx` (the panel's page line),
`apps/api/src/jobs/repeatable/submitted-verifications.ts` (the repair sweep), and each metric entry of
`apps/api/src/metrics-registry.ts`.

## 1. Pure parts, built before foundation-11b's checkpoints (they live only in files quotas creates)

### 1.1 The caps and the at-cap watch (`services/quotas/caps.ts`, `at-cap.ts`)

- Stub `36652198a`; RED `aac63941e`; GREEN `72861ef4a`.
- RED (load `3.88 2.43 2.74`):

  ```
  $ cd apps/api && pnpm exec vitest run src/services/quotas --coverage.enabled=false
  Tests  40 failed | 2 passed (42)
  Error: effectiveQueueCap(report-run) is not built yet (quotas).
  Error: createAtCapWatch is not built yet (quotas).
  ```

  The two that pass at RED hold `ADMITTED_QUEUES`, a constant of the stub.
- GREEN (load `5.59 3.78 3.21`): `Tests  42 passed (42)`; eslint clean; `tsc --noEmit` shows no
  error in the folder.

### 1.2 The admission engine (`services/quotas/admission.ts`)

- Stub `2f5ed7b42`; RED `466e98b72`; GREEN `e2a2a3f31`.
- RED (load `6.08 6.99 5.50`): `Tests  18 failed | 43 passed (61)`, each failure
  `admitEnvironment ... / sweepQueue ... / recoverLostWork ... / AtCapWatch.retain is not built yet`.
- GREEN: `Tests  61 passed (61)`; coverage of the folder: statements 100 %, branches 98.57 %.
- What the fake store holds (review H12, counts and order): held rows admitted oldest first up to the
  cap; at the cap nothing is admitted and the oldest held row goes first once a slot frees; a quiet
  environment's job is admitted in the same tick a flooder is held at its cap, at the default cap
  (400 held, 50 admitted, 350 still held) and with the flooder at a 1,000 cap (1,500 held, 1,000
  admitted, 500 still held); environments in turn by `last_served_at` (never served first); the
  visit is the turn (R004); a failed enqueue is held again; `queue_in_flight`, `queue_in_flight_cap`
  and `queue_admission_wait_ms` per visited environment and queue; the warn line once after more than
  five minutes at the cap, forgotten when nothing waits; lost admitted work enqueued again.

### 1.3 The queue panel (`apps/dashboard/src/components/quotas/queue-panel.tsx`)

- Stub `f093f6e4b`; RED `fcce39e68` (`Tests  6 failed (6)`); GREEN `80ca6f5fe` (`Tests  6 passed
  (6)`). At GREEN the names test's "no hyphen" check was corrected to what it meant (words, never the
  queue's id): `List re-screens` keeps the project's spelling.
- The page line (a named borrowed edit of `apps/dashboard/src/app/settings/page.tsx`): RED
  `903dd3e94` (`Tests  2 failed (2)`: no table "Queues in Sandbox"); GREEN `62de834cd`
  (`app/settings` 169 of 169).

### 1.4 The cap admission reads (`services/quotas/cap-of.ts`)

- Stub `1172e5eef`; RED `2692e6b1b`; GREEN `059f39ad7`.
- Recorded from the commits after the restart of 2026-11-13 (their output was not written here before
  the stop): RED "3 of 3 fail on the stub"; GREEN "quotas 64 of 64". `createCapOf(install)` reads the
  environment in the admission's transaction: its stored `queue-in-flight-caps` value or the default,
  at most the install ceiling, and 0 for an environment that no longer exists.

### 1.5 The four metrics in `metrics-registry.ts` (named borrowed edit, rule 20)

- RED `c5e39c579`; GREEN `7291c0424` (after foundation-11b's checkpoint common, `d56b4d196`, which
  created the registry).
- Recorded from the commits (output not written here before the stop): RED "2 of 19 fail"; GREEN
  "71 of 71". Entries: `queue_admission_wait_ms`, `queue_at_cap_ms`, `queue_in_flight`,
  `queue_in_flight_cap`, each with the labels `environmentId` and `queue`; the sweep emits them through
  `metrics.emit`, and the warn line carries its counts.

## 2. After the restart (continuation run)

### 2.1 The quota sweep and recovery jobs (`jobs/quota-sweep.ts`)

- Stub `679de018f`; RED `313fc556b`; GREEN `2257b5252`.
- RED (load `39.02 17.77 6.99`):

  ```
  $ cd apps/api && pnpm exec vitest run src/jobs/quota-sweep.test.ts --coverage.enabled=false
  Test Files  1 failed (1)
       Tests  6 failed (6)
  Error: quotaQueuePass is not built yet (quotas)
  ```

  `tsc --noEmit -p apps/api/tsconfig.json` (through the heavy slot, 6 min 40 s at load
  `28.84 25.53 13.99`): no error in `jobs/quota-sweep*`; the errors it printed were in other agents'
  RED files then (`operator-auth/session-policy.test.ts`, `routes/dashboard/{end-sessions,sso}.ts`,
  `watchlists/conditional-policy.test.ts`).
- GREEN (load `16.84 22.81 13.62`): `Tests  6 passed (6)`; eslint clean.
- `quota-sweep` every 15 s runs `sweepQueue` per capped queue in turn; `quota-recovery` every 60 s runs
  `recoverLostWork` with a two-minute grace over the queues that have lost rows; a queue's failure is
  logged as `{queue, admittedQueue, error: <name>}` and the other queues go on.

### 2.2 The rule-27 wait, and the gate begun while foundation-11b gated (D)

- Waited for `checkpoint P` in 13 bounded calls (`timeout 540 ... grep -qF "Workflow 11B
  foundation-11b checkpoint P"`, each `rc=124`). At 16:56 no commit had touched `packages/db/drizzle/`
  or `docs/tdd/phase11-foundation-11b.tdd.md` for 63 minutes (rule 27's stop), so the wait stopped and
  my own gate began: API unit suite in 12 blob shards (each `rc=1`, the lone shard's partial
  coverage; 152-494 s at load 17-39). Shard 12 reached its 570 s cap (`rc=124`, load `33.71 38.02
  34.72`), so K was doubled in a fresh directory (rule 8): shards 1-13 of 24 ran (213-483 s each,
  load 11-41) before foundation-11b's (P) GREEN landed (`eb96a38ae`, `517debbe9`, amendments 11-17),
  which made the tree under the gate move; the gate was left there and is re-run at the end.

### 2.3 The admission rows and slots over Postgres (`packages/db/src/repositories/queue-slots.ts`)

- Stub `b530c35af` (with one export line in `packages/db/src/repositories/index.ts`); RED
  `6567f96a4`; GREEN `5ad1b7739`.
- RED (load `40.51 36.37 34.23`):

  ```
  $ cd packages/db && pnpm exec vitest run src/repositories/queue-slots.test.ts --coverage.enabled=false
  Tests  13 failed (13)
  Error: lockQueueSlot is not built yet (quotas)   (and the other eight names)
  ```

- GREEN (load `32.92 35.17 34.09`): `Tests  13 passed (13)`; eslint and `tsc --noEmit` clean. The
  first GREEN run failed one case on its own fixture (`inquiry_integrity_challenges_expires_after_created`:
  the test's challenge expired before `now()`); the fixture now expires ten minutes after `now()`.

### 2.4 The stores and the worker's passes (`services/quotas/queue-rows.ts`)

- Stub `a7de5bb7d`; RED `29e1a6127`; GREEN `16368b780`.
- RED (load `34.94 34.69 34.71`): `Tests  6 failed (6)`, each `... is not built yet (quotas)`.
  `tsc --noEmit -p apps/api/tsconfig.json` through the heavy slot: one error, in the stub's type guard
  (`() => never` for a type predicate), fixed in the stub before the commit; no other error in the
  project then.
- GREEN (load `24.95 32.07 34.97`): `Tests  6 passed (6)`. The flooder (60 held) is held at 50 while
  the quiet environment's one row is admitted in the same tick; with the flooder's setting at a 75
  ceiling, 75 of 80 admitted and the quiet one too; two finished rows free two slots, which admit the
  flooder's two oldest held rows.

### 2.5 The install ceiling on the settings route (named borrowed edits, amendment 14)

- RED `bfa344017` (`services/quotas/settings-caps.test.ts`): `Tests  2 failed | 1 passed (3)`: a
  `report-run` cap of 51 was stored (200), and a stored 900 was served as 900.
- GREEN `f8b9f5888` (`services/settings.ts`, `routes/dashboard/settings.ts`; load
  `25.09 28.92 33.03`): `Test Files  4 passed (4)`, `Tests  48 passed (48)` over
  `settings-caps.test.ts`, `settings-11b.test.ts`, `settings.test.ts`, `settings-workflows.test.ts`.

### 2.6 The repair sweep (named borrowed edit, C251.1, review F12)

- RED `10f92140a` (`jobs/repeatable/submitted-verifications.test.ts`): `Tests  1 failed | 4 passed
  (5)`: the held verification was enqueued beside the admitted one.
- GREEN `acd6b9d8a`: `Tests  111 passed (111)` over `jobs/repeatable/` and `jobs/silent-aamva.test.ts`,
  whose repair case now stamps the attempt admitted, as the wrapped producer does before the enqueue
  that fails (rule 12).

### 2.7 The producer's admission (`services/quotas/admit.ts`, after foundation-11b's checkpoint P)

- RED `6be2d0889` (`services/quotas/admit.test.ts`, on foundation-11b's stub; load `38.51 41.90
  39.71`): `Tests  3 failed | 1 passed (4)`: `expected [ true, true, true ] to deeply equal [ true,
  true, false ]`; `expected true to be false`; a finished row was stamped.
- RED on Postgres 17 `64c32d8e9` (`services/quotas/admission.integration.test.ts`, rule 6; the first
  call got no heavy slot, `rc=75`; the second 90 s at load `33.34 32.28 33.40`): `Tests  1 failed |
  1 passed (2)`: twenty racing producers admitted twenty, not five; the two racing sweeps admitted
  exactly the room, each row once, on the engine built before.
- Waited for `Workflow 11B foundation-11b checkpoint P` (it landed as `eccc47dd0`); `admit.ts` was
  unchanged since `eb96a38ae` and clean in the tree.
- GREEN `3c6f7a7b5` (load `26.48 33.45 35.95`): `Tests  90 passed` of 91 over `services/quotas/`,
  `foundation-11b-p.test.ts` and the repair sweep's test; the one failure was foundation-11b's stub
  case "admitOnProduce keeps today's behaviour ... (quotas removes this case)", which admitted an
  `initiated` verification; removed as its title asks (rule 12), then `Tests  9 passed (9)` over
  `foundation-11b-p.test.ts` and `admit.test.ts`. Postgres 17: `Tests  2 passed (2)`, 41 s at load
  `25.55 31.96 35.06`.

### 2.8 KP10-27: the integrity token route admits its decode (named borrowed edit)

- RED `582b538f3` (`services/quotas/integrity-admission.test.ts`): `Tests  1 failed (1)`:
  `expected false to be true` (the route enqueued the decode with no admission).
- GREEN `0cb0af9d2` (`services/device-integrity/challenges.ts`; load `46.50 45.23 38.72`):
  `Test Files  4 passed (4)`, `Tests  33 passed (33)` with `routes/flow/integrity.test.ts` and
  `services/device-integrity/`.

### 2.9 KP11-17 over real share tokens

- `274c6031f` (`services/quotas/connect-recovery.test.ts`; load `38.53 40.56 37.97`): `Tests  1 passed
  (1)` at its first run: it holds the recovery built test-first over the fake store (RED `466e98b72`,
  GREEN `e2a2a3f31`) and the SQL of `5ad1b7739`. As proof that it can fail, a mutant of
  `queue-slots.ts` counting every token but `created` as unfinished made it fail (`expected [ {…},
  {…}, {…} ] to deeply equal [ {…} ]`); the file was restored from its copy at once and was never
  committed changed.

## 3. End gates (rule 24: what quotas touched; each call's own exit code, read from its log)

Run from 23:08 on 2026-11-13 to 01:14 on 2026-11-14, beside the other Stage 2 agents. The tree
moved under the gate (other agents' commits); no failure was seen.

| Call | Exit | Time | Load before |
| --- | --- | --- | --- |
| `pnpm --filter @openverify/db typecheck` | 0 | 158 s | 25.59 30.66 34.42 |
| `pnpm --filter @openverify/db lint` | 0 | 223 s | 26.76 30.06 33.68 |
| db unit suite, `vitest run --coverage` (heavy slot) | 0 | 397 s | 19.33 24.94 30.84 |
| `pnpm --filter @openverify/api typecheck` (heavy; a first try got no slot, 75) | 0 | 415 s | 33.14 27.75 26.67 |
| `pnpm --filter @openverify/api lint` (4 GB heap; a first try under `timeout 440` was cut, 124) | 0 | 426 s | 21.93 26.71 27.06 |
| API unit suite, 12 blob shards (each 1: a lone shard's partial coverage) | 1 each | 155-387 s | 12.78-31.09 |
| API merge, the 80 % gate | 0 | 120 s | 20.69 21.74 23.41 |
| `pnpm --filter @openverify/dashboard typecheck` | 0 | 112 s | 16.50 20.27 22.70 |
| `pnpm --filter @openverify/dashboard lint` | 0 | 360 s | 12.87 18.78 21.94 |
| dashboard, 2 blob shards | 1 each | 300 s, 228 s | 24.61, 16.12 |
| dashboard merge, the 80 % gate | 0 | 6 s | 7.58 13.81 18.48 |
| `pnpm --filter @openverify/db test:integration` | 0 | 261 s | 15.94 20.03 22.60 |
| api integration `--project graph` | 0 | 165 s | 16.79 17.89 21.05 |
| api integration `--project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 148, 290, 158 s | 15.10, 27.08, 29.95 |
| `pnpm format:check` | 0 | 485 s | 19.15 20.54 25.03 |
| `prettier --check --ignore-path=.gitignore` over `services/quotas/*.ts`, `services/settings.ts`, `services/device-integrity/challenges.ts` | 0 | | |

Counts: db 2,357 tests in 165 files at 89.88 % statements; API 10,792 tests in 848 files at 94.17 %
statements (84.68 % branches); dashboard 7,092 tests in 619 files at 95.65 %; integration db 110 (23
files), graph 13, api 115 + 133 + 193 = 441 (75 files).
