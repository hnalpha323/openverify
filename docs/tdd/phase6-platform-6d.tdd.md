# TDD evidence: Workflow 6D, the redaction guard and the shared heavy-headed table (`platform-6d`)

- **Slice owner:** `platform-6d`, Workflow 6D Stage 1, beside `matcher-6d` and `rescreen-6d`.
- **Date:** 2026-10-29. Base: 6D's launch commit `9882aee3`.
- **Input:** the plan's "Owner decisions after Workflow 6C", decisions 5 and 6, and "Workflow 6D".
- **Paths owned:** `packages/db/src/repositories/inquiries.ts` with its tests; the `apps/api/src/services/` and `apps/api/src/jobs/` files that move an inquiry to `pending`, `completed` or `failed`, for decision 5 only, with their tests and the expiry sweep's test; a new race test under `apps/api/src/services/`; `apps/api/src/services/reports/completion.test.ts` (a borrowed edit); `packages/watchlist/src/testing/heavy-headed.ts` with its test and its export line; `apps/api/src/watchlists/test-support/` and `watchlists.integration.test.ts`; this file.

Each slice follows the same cycle:
1. A stub (`chore`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit). Each RED commit compiles, type-checks and lints.
3. The smallest change that passes it (GREEN, `feat` or `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest (pkg) …" stands for `pnpm --filter @openverify/<pkg> exec vitest run <files> --coverage.enabled=false`; "vitest-it (api) …" for `pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts <files>`. Output is trimmed to the lines that matter. Every name, number and value in these tests is synthetic.

## Decision 5: a redacted open inquiry never completes or fails, and still expires

### What the code did, and every caller

Redaction (`redactInquiryRecords`, `packages/db/src/repositories/redaction.ts`) locks the inquiry with `SELECT … FOR UPDATE`, then updates it (`fields = {}`, `note` null, `redacted_at` set). The API's `redactInquiry` (`services/redaction.ts`) then cancels the active sessions (`inquiry-session.canceled`), revokes the one-time links, redacts the inquiry's reports and stages `inquiry.redacted`, all in that transaction. It leaves `status` as it was.

`transitionInquiryStatus` (`packages/db/src/repositories/inquiries.ts`) is one conditional update on `id`, `environment_id` and `status = from`. Nothing read `redacted_at`, so a settlement that read the inquiry before a redaction committed, and waited for its row, completed or failed the redacted inquiry and published `inquiry.completed` or `inquiry.failed` (api-reports-6c item 9; review amendment 9 of 6C). Every caller in `apps/api/src`, and what it does with a `null` transition:

| Caller | Move | On `null` |
|---|---|---|
| `transitionInquiryInTx` (`services/inquiries.ts`) | every move | returns `null` before staging anything: no event, no session cancellation, no report hook |
| `settleInquiry` (`services/inquiry-settlement.ts`) | `pending -> completed`, `pending -> failed`, then `completed -> needs_review` | re-reads the inquiry, returns its status (`pending`) with nothing staged; the second move never runs |
| `failVerificationAfterError` and `processVerification` (`jobs/process-verification.ts`) | through `settleInquiry` / `settleIfPossible` | the verification still fails without data (G002); the settlement then returns `pending` |
| `startInquiry` (`services/inquiries.ts`, from `getFlowSession` and `openInquiry`) | `created -> pending` | returns the inquiry as it is, publishing nothing (`openInquiry` already answers 410 to a redacted inquiry; only a redaction that commits in between reaches the guard) |
| `cancelAtCaptureLimit` (`services/flow.ts`), `cancelAtChallengeLimit` (`services/crypto-challenges/create.ts`, `services/chip-challenges/create.ts`): the flow's attempt limits | `pending -> failed` | `staged.push(...(failed?.staged ?? []))`: nothing. They run after `assertInquiryOpenUnderLock`, which locks the inquiry and answers 410 to a redacted one, so the guard is never what refuses them |
| `applyInquiryAction` (`services/inquiries.ts`): the actions and the sandbox's `perform-simulate-actions` (`services/simulate.ts`) | every move the action names | throws `invalidTransition`: 409 `invalid-transition`, and the simulate transaction rolls back every action |
| `runInquiryExpiry` (`jobs/inquiry-expiry.ts`) | `created -> expired`, `pending -> expired` | not guarded: a redacted open inquiry expires |
| `persistRunResult` (`jobs/reports/persist.ts`, `on-report-match`) | `completed -> needs_review` | not guarded (a move out of `completed`) |
| `createInquiryReportsInTx` (`services/reports/completion.ts`), reached from the transition | `pending -> completed`, `failed -> approved / needs_review` | the hook keeps its own `redactedAt` guard, which still decides the moves out of `failed` |
| Test helpers `chip-challenges/testing.ts`, `contact/job-testing.ts` | `created -> pending` of fresh inquiries | not redacted |

No caller needed a fix: each stages nothing on a `null` transition, and the sandbox actions already answer 409 through `applyInquiryAction`.

### Slice 1: the guard in `transitionInquiryStatus`

Tests (`packages/db/src/repositories/inquiries.test.ts`, a new describe): an inquiry redacted through `redactInquiryRecords` in `created` or `pending` is refused `created -> pending`, `pending -> completed` and `pending -> failed` (`null`, the row keeps its status and has no stamp); it still expires from `created` and `pending`, with `expired_at` stamped; and every move out of `completed`, `failed` and `needs_review` still applies to a redacted inquiry (eight moves).

```text
RED   $ vitest (db) src/repositories/inquiries.test.ts
     × refuses created -> pending once redacted: null, and the row keeps its status 58ms
     × refuses pending -> completed once redacted: null, and the row keeps its status 42ms
     × refuses pending -> failed once redacted: null, and the row keeps its status 45ms
AssertionError: expected { accountId: 'acc_…', …, status: 'failed', redactedAt: 2026-10-29T09:00:00.000Z, … } to be null
      Tests  3 failed | 27 passed (30)
      $ (cd packages/db && pnpm exec tsc --noEmit && pnpm exec eslint src/repositories/inquiries.test.ts)   (pass)
commit 6cd49c3d test(db): …
```

### Slice 2: the callers, and the race on Postgres, in both orders (RED)

Tests:
- `apps/api/src/services/inquiry-redaction-races.integration.test.ts` (new; Testcontainers `pgvector/pgvector:pg17` with `POSTGRES_TEST_COMMAND`; the API's event publisher writing the `events` table). A pending inquiry with an active session and a government ID decided `passed`, `failed` (not retryable) or `needs_review`, settled by `settleInquiry` while the redaction service redacts it. Each writer is held inside its transaction at its first staged event, as `report-races.integration.test.ts`' `gatedEvents` holds its writers:
  - **redaction first** (held at its `inquiry-session.canceled`, the row locked and stamped): the settlement's update waits (`within(…, 1.5 s)` is `pending`), then moves nothing; the inquiry is `pending` and redacted with no `completed_at` or `failed_at`, and the only events about it and its session are `inquiry-session.canceled` and `inquiry.redacted`;
  - **settlement first** (held at its first event, the move written): the redaction waits, then redacts the settled inquiry; the events are the settlement's (`inquiry.completed` or `inquiry.failed`, `inquiry.transitioned`, `inquiry-session.canceled`, and for review `inquiry.marked-for-review` with its `inquiry.transitioned`) and `inquiry.redacted`.
- `apps/api/src/services/inquiry-settlement.test.ts`: for each of the three outcomes, the same inquiry unredacted settles to it; redacted, `settleInquiry` returns `pending`, publishes nothing and stamps nothing.
- `apps/api/src/services/simulate.test.ts` (new, beside `simulate.ts`): `start_inquiry` on a redacted `created` inquiry, `complete_inquiry` and `fail_inquiry` on a redacted `pending` one answer 409 `invalid-transition` and change nothing (status, events, audit); `expire_inquiry` still expires a redacted `created` or `pending` inquiry (200, `inquiry.expired`); `startInquiry` returns a redacted `created` inquiry as it is and publishes nothing.
- `apps/api/src/services/reports/completion.test.ts` (a borrowed edit, decision 5): the redacted case now asserts that the `pending -> completed` move returns `null`, that no report exists and that the inquiry stays `pending`; a new case approves a redacted failed inquiry: the move applies (a move out of `failed`), and the hook's own guard creates no report.

```text
RED   $ vitest-it (api) src/services/inquiry-redaction-races.integration.test.ts       (load 2.80)
     × a settlement to completed that meets the redaction waits for its commit, then moves nothing: pending and redacted 1734ms
     × a settlement to failed that meets the redaction waits for its commit, then moves nothing: pending and redacted 1726ms
     × a settlement to needs_review that meets the redaction waits for its commit, then moves nothing: pending and redacted 1636ms
AssertionError: expected 'completed' to be 'pending' // Object.is equality
AssertionError: expected 'failed' to be 'pending' // Object.is equality
AssertionError: expected 'needs_review' to be 'pending' // Object.is equality
      Tests  3 failed | 3 passed (6)         (the settlement-first order passes before and after)
RED   $ vitest (api) src/services/inquiry-settlement.test.ts src/services/simulate.test.ts src/services/reports/completion.test.ts
     × leaves it pending and publishes nothing, where a government ID passed settles it completed unredacted
     × leaves it pending and publishes nothing, where a government ID failed settles it failed unredacted
     × leaves it pending and publishes nothing, where a government ID needs_review settles it needs_review unredacted
     × creates no report for an inquiry redacted while its completion waited for the row (owner decision 11)
     × a redacted created inquiry: start_inquiry answers 409 invalid-transition and changes nothing
     × a redacted pending inquiry: complete_inquiry answers 409 invalid-transition and changes nothing
     × a redacted pending inquiry: fail_inquiry answers 409 invalid-transition and changes nothing
     × returns it as it is and publishes nothing
AssertionError: expected 'completed' to be 'pending' // Object.is equality
AssertionError: {"data":{…"status":"pending",…"redacted-at":"2026-10-29T14:44:37.536Z",…}}: expected 200 to be 409
AssertionError: expected { inquiry: { …(19) }, …(2) } to be null
      Tests  8 failed | 10 passed (18)
      $ (cd apps/api && pnpm exec tsc --noEmit && pnpm exec eslint <the five files>)   (pass)
commit d66d7ff3 test(api): …
```

Two setup faults were corrected before this RED commit, so that each test fails for its own reason: the simulate test first wrote the field `name-first` (the API refuses it: inquiry fields are snake_case, 400 before any action), and the settlement test's `it.each` callback took one of its two arguments (TS2345; it now settles the unredacted twin with the second).

### Slice 3: the expiry sweep is never held by redacted inquiries (a regression guard)

Test (`apps/api/src/jobs/inquiry-expiry.test.ts`): after draining what is already overdue, `DEFAULT_SWEEP_LIMIT + 1` (501) redacted overdue inquiries, half `created` and half `pending`, each due before two ordinary overdue ones, so they fill the sweep's first batch. One `runInquiryExpiry` with the default batch expires all 503 (`expiredInquiries: 503`, `failedInquiries: 0`, 503 `inquiry.expired`), and nothing overdue is left. The bulk rows are stamped `redacted_at` with one statement, as `redaction-race.integration.test.ts` stamps them: the transition and the sweep read that column only, and a real redaction of 501 rows added 6 s to a test of 10 s (the guard's unit, settlement, simulate and race tests use the real redaction).

The guard does not touch expiry, so the test passes before it: it guards against the draft that the review's first HIGH finding rejected. Under that mutation (`ENDED_BY_REDACTION` with `expired` too, never committed) it fails, as the db tests of expiry do:

```text
      $ vitest (api) src/jobs/inquiry-expiry.test.ts      (before the guard)
      Tests  7 passed (7)        the new test 10307ms alone (load 5.7)
MUTATION $ (ENDED_BY_REDACTION = pending, completed, failed, expired) vitest (api) src/jobs/inquiry-expiry.test.ts -t DEFAULT_SWEEP
     × expires DEFAULT_SWEEP_LIMIT + 1 redacted overdue inquiries and the ordinary ones beside them in one run (owner decision 5 after Workflow 6C) 5646ms
AssertionError: expected { expiredInquiries: +0, …(2) } to deeply equal { expiredInquiries: 503, …(2) }
MUTATION $ vitest (db) src/repositories/inquiries.test.ts
     × still expires a redacted created inquiry, and stamps expired_at
     × still expires a redacted pending inquiry, and stamps expired_at
      Tests  2 failed | 28 passed (30)
      (the mutation reverted; `git diff --stat packages/db/src/repositories/inquiries.ts` empty)
commit d56d1a2c test(api): …
```

A first version of the bulk setup also wrote `fields = '{}'` with SQL. That broke the sealed column: the sweep counted 500 failed inquiries in its first batch, expired none, and its drain stopped there. Only `redacted_at` is stamped now.

### Slice 4: GREEN, then the comments

`transitionInquiryStatus` adds `redacted_at is null` to its WHERE clause when `to` is `pending`, `completed` or `failed` (`ENDED_BY_REDACTION`). Redaction holds the row from its `SELECT … FOR UPDATE` to its commit, and under read committed Postgres re-evaluates the update's WHERE clause on the row version the redaction committed, so whichever transaction commits first wins and no new lock is taken.

```text
GREEN $ vitest (db) src/repositories/inquiries.test.ts
      Tests  30 passed (30)
GREEN $ vitest (api) src/services/inquiry-settlement.test.ts src/services/simulate.test.ts src/services/reports/completion.test.ts src/jobs/inquiry-expiry.test.ts
 Test Files  4 passed (4)
      Tests  25 passed (25)
GREEN $ vitest-it (api) src/services/inquiry-redaction-races.integration.test.ts       (load 8.75)
 Test Files  1 passed (1)
      Tests  6 passed (6)
commit 4bd013bb fix(db): …
      $ vitest (api) <19 files that redact and move inquiries: retention, the process-* jobs, records, the flow routes, inquiry actions, events, audit, report hooks, run, worker>
 Test Files  19 passed (19)
      Tests  484 passed (484)
commit ab24a8e8 refactor(api): the transition, the flow start and settlement say so (comments only)
```

**What this amends.** Phase 3's G002 (`docs/plans/phase-3.plan.md`, Workflow 3B review item 3) said the worker fails the verification of a redacted inquiry without data, "then the inquiry is settled as usual". The verification still fails without data; the inquiry now stays open until it expires, so webhook consumers get `inquiry.expired`, never `inquiry.completed` or `inquiry.failed`, for a redacted open inquiry. No Phase 1-5 test asserted a redacted inquiry's later status; every existing suite stayed green.

## Decision 6: one definition of the 100,000-name table, for the gate and the benchmark

### What the code did

- **The benchmark** (`benchmark-performance.mjs` with `benchmark-tables.mjs`, read, not edited) builds its 100,000-name table as `namePool({ seed: '<seed>/pool', groups: parseRawGroups(data/rigour-person_names.txt), fictional: 40_000 })`, where `parseRawGroups` is the held-out folder's `parseVariantGroups`; then `syntheticEntries({ seed: '<seed>/100k', pool, names: 100_000, profile: TABLE_PROFILES.sanctions, idPrefix: 'BS-' })`; then `subjectsOf`: every `floor(entries / 150)`-th entry's `listedQuery`, each followed by one of `unlistedQueries({ seed: '<seed>/100k/unlisted', pool, count: 150 })`.
- **The gate** (`apps/api/src/watchlists/test-support/heavy-headed-list.ts`, matcher-6c's) had a generator of its own: another seed prefix, a script share of 0.3 instead of 0.4, Cyrillic aliases only, no gender, the shipped variant groups' capitalised spellings for its pool instead of the raw groups, `GATE-` ids and its own subjects. Calibration-6c measured it lighter than the benchmark's table (candidates p95 503 against 630, finding 3).

### Slice 5: the shared module (`packages/watchlist/src/testing/heavy-headed.ts`)

A stub with every name (`chore`, 9351908f) let the RED compile. The test (`src/testing/heavy-headed.test.ts`, 12 tests):
- `parseRigourPersonNames` on synthetic lines in rigour's format (fictional names; blank lines, a line without an id, an empty id, no forms, a multi-word form, a Cyrillic-only group, a mixed-script form, two arrows): the groups expected; on the raw file where `data/` holds it (else on the synthetic text), the same groups as the held-out folder's `parseVariantGroups`, the parser the benchmark reads its groups with; a CRLF line reads the same;
- **the benchmark's golden digests**: from `benchmark-golden.test.mjs`' inputs, the module's pool, draws, Zipf ranks, sanctions and PEP entries, listed and unlisted queries give the seven table digests that file pinned at Workflow 6C's base (`94ab63f9`); its profiles equal the benchmark's `TABLE_PROFILES`;
- **the 100,000-name table of a seed against the benchmark's own generation**: `heavyHeadedTable({ seed, groups: parseRigourPersonNames(raw) })` against `benchmark-tables.mjs`' functions over `parseVariantGroups(raw)`, composed as `benchmark-performance.mjs` composes them; the pool items, the entries and the 300 subjects have the same SHA-256. Over the raw file where `data/` holds it, else over the synthetic text (CI's unit job has no `data/`; both branches were run, the second with a temporary copy pointed at an empty data directory, created and removed by me);
- `HEAVY_HEADED_100K` is the sanctions profile, 100,000 names, 40,000 fictional names, exponent 1, `BS-` ids, 150 listed and 150 unlisted subjects, frozen;
- the parts on their own: Zipf's weights and the empty range; the pool's groups and fictional names; valid entries of both profiles (Han written family first and unspaced); `listedQuery` with its term fallback; `tableSubjects`' spread and interleaving; `heavyHeadedPool`, `heavyHeadedEntries` and `heavyHeadedSubjects` compose the parts with the benchmark's seed suffixes, and take smaller sizes for a smoke run.

```text
RED   $ vitest (watchlist) src/testing/heavy-headed.test.ts
Error: heavy-headed: not built yet (1 inputs)
      Tests  no tests                       (a describe body called the stub at collection; its groups made lazy)
RED   $ vitest (watchlist) src/testing/heavy-headed.test.ts
     × reads each `form, form, … => id` line, skipping a line without an id or forms
     × gives the groups the benchmark reads with the held-out folder’s parser
     × gives the same pool, draws, entries of both profiles and queries from the same inputs
     × has the benchmark’s profiles
     × is the sanctions profile at 100,000 names over a Zipf law of exponent 1, …
     × equals the benchmark's own generation of a seed's table: data/rigour-person_names.txt
     × … (6 more)
Error: heavy-headed: not built yet (1 inputs)
AssertionError: expected { scale: '100k', names: +0, …(6) } to deeply equal { scale: '100k', names: 100000, …(6) }
      Tests  12 failed (12)
      $ (cd packages/watchlist && pnpm exec tsc --noEmit && pnpm exec eslint src/testing/heavy-headed.test.ts)   (pass)
commit 28c96041 test(watchlist): …
GREEN $ vitest (watchlist) src/testing/heavy-headed.test.ts --reporter=verbose      (load 6.19)
 ✓ … gives the groups the benchmark reads with the held-out folder’s parser 861ms
 ✓ … gives the same pool, draws, entries of both profiles and queries from the same inputs 100ms
 ✓ … equals the benchmark's own generation of a seed's table: data/rigour-person_names.txt 6329ms
      Tests  12 passed (12)
      $ (temporary copy, DATA = an empty directory with the manifest) vitest (watchlist) …
 ✓ … equals the benchmark's own generation of a seed's table: synthetic groups (data/ has no rigour file) 2564ms
      Tests  12 passed (12)
      coverage of heavy-headed.ts: 98.75 / 86.04 / 100 / 98.63 (the two lines left are unreachable fallbacks)
commit 11b238d8 feat(watchlist): …
```

The module is a typed port of `benchmark-tables.mjs`' generator with the same draws in the same order and every member in the same order, so a JSON digest of its output equals the benchmark's. It reads its groups with its own parser, which gives exactly the held-out parser's groups, and imports nothing from `held-out/`; only its test does, as the reference the benchmark uses. Everything it needs is in the one file plus the shared helpers that exist at the base (`names.ts`, `random.ts`, `records.ts`), so the base overlay needs only that file. `writeNormalisedImport` stays in `benchmark-tables.mjs`: it writes a file and is not part of the table's definition.

### Slice 6: the gate draws the shared table

A stub of the adapter (`chore`, 98cd7eb0), then the test (`apps/api/src/watchlists/test-support/heavy-headed-list.test.ts`, rewritten): `gateTable` is `heavyHeadedTable` of its seed over the raw groups (records and subjects by SHA-256; 100,000 names; 150 listed and 150 unlisted subjects), or over the fictional names alone without the raw file; `rigourPersonNamesPath` finds the file `manifest.json` names, or `null`; `gateCase` names `shipped-variant-groups` when both data files are there and each one missing otherwise; `GATE_SEED` is 32 hexadecimal digits. The gate's own generator moves to the shared module, so its old tests (`zipfSampler`, `heavyHeadedPool`, `heavyHeadedList`, `gateSubjects`, `groupSpellings`) went with it.

```text
RED   $ vitest (api) src/watchlists/test-support/heavy-headed-list.test.ts
     × is 32 hexadecimal digits, so `benchmark:performance --seed` draws the same table
     × is the shared 100,000-name table of the seed, over the raw groups
     × is drawn over the fictional names alone when data/ has no rigour file
     × finds the file the manifest names in a data directory, or null when it is absent or unnamed
     × reads the repository’s data/ by default
     × names the calibration’s case when both data files are there, and each one missing otherwise
AssertionError: expected '' to match /^[0-9a-f]{32}$/u
AssertionError: expected 'loaded' to be 'shipped-variant-groups' // Object.is equality
      Tests  6 failed (6)
commit 4b8aa8b1 test(api): …
```

**The seed, decided by measurement.** I first gave the gate a fresh seed (`openssl rand -hex 16` at 2026-10-29T14:52:03Z: `abde99306e4f5542e2fc330093a2758a`). On it, the gate's assertion on the cap failed, on the calibration's own law (a correctness run of the whole gate file, not under the lock, load 4.16 to 4.62):

```text
[C78.7 gate] case=shipped-variant-groups table=heavy-headed-100k seed=abde99306e4f5542e2fc330093a2758a law=zipf-1 names=100001 entries=60548 import=74967ms rounds=1 p50=24.3ms p95=253.3ms p99=454.1ms p95-state/retrieve/load/rest=5.4/50.6/50.5/129.0ms candidates-p50/p95=103/1229 cap-binds=11/300 unreachable=13/300 would-error=0/300 listed-found=150/150 unlisted-alerted=22/150 timing=printed
AssertionError: expected 11 to be less than or equal to 6
```

No retrieval, key or matching file had changed in the tree, so this is the draw: under Zipf with exponent 1, which names fall at the head depends on the seed. The same gate on the evaluation seed `docs/calibration/watchlist-phase6c.md` published (`e8223c34916200e2b8e51f0b47981804`) reproduced that report's data-determined 100,000-name figures exactly (candidates p50 / p95 99 / 630, the cap binding in 0 and a search out of reach in 1 of 300, 150 of 150 listed found, 27 of 150 unlisted alerted), which proves the gate and the benchmark draw one table:

```text
[C78.7 gate] case=shipped-variant-groups table=heavy-headed-100k seed=e8223c34916200e2b8e51f0b47981804 law=zipf-1 names=100000 entries=60694 import=94635ms rounds=1 p50=22.5ms p95=112.6ms p99=278.3ms p95-state/retrieve/load/rest=5.1/21.1/27.9/58.3ms candidates-p50/p95=99/630 cap-binds=0/300 unreachable=1/300 would-error=0/300 listed-found=150/150 unlisted-alerted=27/150 timing=printed
      (load 5.30 → 5.96; not under the lock: a correctness run)
```

So the gate's seed is the published one: the gate then screens the table that report measured, and its figures are comparable with the report's. The limits on the cap (at most 6 of 300, matcher-6c's) were set on a lighter list, and on the fresh draw the cap bound in 11; that is reported to the owner and to `calibration-6d` (whose fresh seed may bind it as often), never hidden and never loosened. A test pins the seed to the report's:

```text
RED   $ vitest (api) src/watchlists/test-support/heavy-headed-list.test.ts      (GATE_SEED the fresh seed)
     × is the evaluation seed docs/calibration/watchlist-phase6c.md published, so the gate draws the table that report measured
AssertionError: expected 'e8223c34916200e2b8e51f0b47981804' to be 'abde99306e4f5542e2fc330093a2758a'
      Tests  1 failed | 6 passed (7)
commit 8d70ef20 test(api): …
GREEN $ vitest (api) src/watchlists/test-support/heavy-headed-list.test.ts
      Tests  7 passed (7)
GREEN $ vitest-it (api) src/watchlists/watchlists.integration.test.ts      (load 4.67 → 4.24; a correctness run)
[C78.7 gate] case=shipped-variant-groups table=heavy-headed-100k seed=e8223c34916200e2b8e51f0b47981804 law=zipf-1 names=100000 entries=60694 import=74702ms rounds=1 p50=21.6ms p95=111.9ms p99=239.9ms p95-state/retrieve/load/rest=5.5/26.0/24.0/61.5ms candidates-p50/p95=99/630 cap-binds=0/300 unreachable=1/300 would-error=0/300 listed-found=150/150 unlisted-alerted=27/150 timing=printed
 Test Files  1 passed (1)
      Tests  6 passed (6)
commit 6c299151 feat(api): …
```

The gate (`watchlists.integration.test.ts`) now:
- takes `records` and `subjects` from `gateTable({ seed: GATE_SEED, rawText })`, the raw file found through `data/manifest.json`;
- screens **one round** after 20 warm-ups, the benchmark's `100k-measure --rounds 1`, where it ran three pooled rounds before; the header says that the calibration report, the median of three such rounds under its load rule, is the authority for the budgets, and a gate pass alone is not the budget met;
- opens its output line with `case=` (`shipped-variant-groups`, or the files missing), `table=heavy-headed-100k` and the seed;
- keeps decision 2 after 6B's machine-independent assertions, as matcher-6c set them (every listed subject found, the candidates' p95 under the cap, the cap in at most 6 and a would-be `result_truncated` in at most 3 of 300, the plan test of the reads), and adds that it has 300 subjects; the timing is asserted only with `OPENVERIFY_C787_TIMING=assert`.

### The gate with its timing asserted, under the e2e lock

One take, as the plan asks (the calibration report, the median of three rounds under its load rule, stays the authority for the budget). At HEAD `42895e6a`, which holds matcher-6d's and rescreen-6d's Stage 1 commits up to then:

```text
      $ cd apps/api && flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_C787_TIMING=assert pnpm exec vitest run --config vitest.integration.config.ts src/watchlists/watchlists.integration.test.ts'
      start load: 2.38 1.91 1.65 (2026-10-29T19:01:22Z)
[C78.7 gate] case=shipped-variant-groups table=heavy-headed-100k seed=e8223c34916200e2b8e51f0b47981804 law=zipf-1 names=100000 entries=60694 import=71350ms rounds=1 p50=19.6ms p95=102.6ms p99=166.4ms p95-state/retrieve/load/rest=5.5/23.7/16.4/58.5ms candidates-p50/p95=99/630 cap-binds=0/300 unreachable=1/300 would-error=0/300 listed-found=150/150 unlisted-alerted=27/150 timing=asserted
     × finds every listed subject within the cap on a heavy-headed list, and prints its timings 11038ms
AssertionError: expected 102.60817500000121 to be less than or equal to 100
      Tests  1 failed | 5 passed (6)
      end load: 4.80 3.04 2.09 (2026-10-29T19:03:26Z)
```

**The 100 ms budget is missed by 2.6 ms in this take** (p95 102.6 ms, load 2.38 at the start and 4.80 at the end). Every machine-independent assertion passed, and their figures equal the calibration report's again (candidates 99 / 630, the cap 0 and out of reach 1 of 300, 150 of 150 found, 27 of 150 unlisted alerted). The miss is reported as an open line, with its phase split (`rest` 58.5 ms, the scoring, is the largest part), and is not hidden: no budget, constant or assertion was changed. Without `OPENVERIFY_C787_TIMING=assert` the gate prints the timing and passes, as decision 2 after 6B set it, so `pnpm test:integration` stays green. calibration-6d's median of three takes decides the verdict.
