# TDD evidence: Workflow 6B review fixes, API and packages (Phase 6, reports)

- **Slice owner:** the API and packages fixer of the Workflow 6B review (`fix-api`), in parallel with the console fixer (`fix-console`).
- **Date:** 2026-10-28.
- **Paths owned:**
  - `apps/api/`, `apps/flow/`, `apps/demo-web/`, `packages/`;
  - `e2e/` except the UI specs (`e2e/tests/ui-*.spec.ts`, `e2e/tests/support/ui.ts` and `ui-*.ts`);
  - `contracts/fixtures/`, `scripts/fetch_*.py`, `data/manifest.json`, `THIRD_PARTY_LICENSES.md`;
  - `docs/plans/phase-6.plan.md`, `docs/api/openapi.json`, `docs/reports/`, `docs/checks/`, `docs/adr/0005-*.md`;
  - `.github/workflows/ci.yml`, `infra/`, `.dockerignore`, `turbo.json` and this file.
- **Input:** the blocking findings R001 and R008, then the MEDIUM items in their order (K6A-3 to K6A-13, P5-5 to P5-7, R002, R003, R005, R007, R009, R010) of the Workflow 6B review of `fe4850ca..HEAD`, and evaluation-6's performance findings.

Each fix follows the same cycle:
1. A stub (`chore`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The regression test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest … " stands for `pnpm exec vitest run <files> --coverage.enabled=false` in the package named. Output is trimmed to the lines that matter. Every name, list and value in these tests is synthetic.

## R008 (HIGH): the XML run-length guard reset on every `>`, so a hostile list was buffered to the byte cap

`GuardedReader.parse` (`packages/watchlist/src/xml/reader.ts`) reset its run counter on every `<` and every `>`. A DOCTYPE internal subset alternates them, and `>` is legal in text and in quoted attribute values, so `maxNodeLength` (262,144) never fired for those. saxes buffers a DOCTYPE whole and fires `doctype` only at its last `>`, and buffers text until the next `<`. The finding measured about 20x amplification: a 300 MB DOCTYPE aborted Node with a heap out-of-memory error. The OFAC SDN ZIP may inflate to 512 MiB.

Tests (`packages/watchlist/src/xml/reader.test.ts`):
- an endless source of `<!DOCTYPE r [` and then `<!ENTITY a "b">` is refused `doctype` after fewer than four chunks, and a DOCTYPE cut into 1, 3 and 7-byte pieces is refused `doctype`;
- an endless text node, double-quoted and single-quoted attribute value made of `a>` is refused `too_long` after fewer than four chunks, without the content in the message;
- a legal document with 40 `>` in an attribute value and 40 `Q>` in its text, read in 5-byte pieces, is accepted.

```text
RED   $ vitest (packages/watchlist) src/xml/reader.test.ts
     × refuses a DOCTYPE at its start, before its internal subset is read (R008)
AssertionError: expected 'too_large' to be 'doctype'
     × bounds a text run or an attribute value that is full of ">" before buffering it (R008)
AssertionError: expected 'too_large' to be 'too_long'
      Tests  2 failed | 14 passed (16)
GREEN $ vitest (packages/watchlist) src/xml/ src/parsers/
 Test Files  8 passed (8)
      Tests  101 passed (101)
      $ pnpm exec vitest run --coverage   (packages/watchlist)
 Test Files  50 passed (50)
      Tests  469 passed (469)
All files          |   98.63 |    90.61 |   98.61 |   98.66 |
```

The RED shows the old guard: the whole 1,000,000-byte cap was read before any refusal.

Fix: the pre-scan follows the lexical context across chunks: text, a tag (with its quote state), a comment, a CDATA section, an instruction, or the opening of a `<!` declaration. Each construct is measured from its opening `<` to its end, or, for text, from the end of the last markup to the next `<`. A `>` inside text, a quoted value, a comment or a CDATA section counts as an ordinary character. `<!D` is refused `doctype` at once. Any other `<!` that opens neither `<!--` nor `<![CDATA[` is refused `malformed`, which saxes would do later. The messages name the construct and never its content. Refactor: pins for the malformed declarations and for near-terminators (`a->b` in a comment, `a?b>` in an instruction, `]]]>` ending CDATA), read one byte at a time.

Probe after the fix (`node … r008-probe.mts <kind> 300`, feeding `readXml` 300 MB with `maxBytes` 512 MiB):

```text
doctype 300MB -> doctype: line 1, column 0: a DOCTYPE declaration is refused
maxRSS 91 MB 4 ms
text 300MB -> too_long: line 1, column 262150: a text run is longer than the cap
maxRSS 92 MB 25 ms
attr 300MB -> too_long: line 1, column 253961: a tag is longer than the cap
maxRSS 92 MB 26 ms
```

## R001 (HIGH): one environment's budget-waiting runs could starve the install-wide outbox sweep

`stampEnqueueableReportRuns` (`packages/db/src/repositories/report-runs.ts`) took the claimable runs install-wide, oldest `scheduled_for` first, and the sweep (`apps/api/src/jobs/reports/sweep.ts`) takes at most 10 batches of 500 every 15 s. A budget wait (`deferReportRun`) puts a run back to `pending` with `enqueued_at` cleared, its `scheduled_for` unchanged and `not_before` a few seconds ahead. So 5,000 or more older waiting media runs of one environment filled every sweep, and another environment's newer runs were never stamped. Only the sweep enqueues completion, scheduled and `list_update` runs.

Test (`packages/db/src/repositories/report-repositories.test.ts`, on its own PGlite database so no other test's runs compete): a flooding environment has six budget-waiting runs older than everything else and one newer run that is not waiting; a victim environment has one run in between. A stamp of three takes the victim's run, then the flooding environment's run that is not waiting, then its oldest waiting run. The next stamp takes the next three waiting runs.

```text
RED   $ vitest (packages/db) src/repositories/report-repositories.test.ts
     × stamps each environment in turn and an environment’s budget-waiting runs after its others (R001)
  [
-   "rpr_01M613WTSYB89ESMYB6CYS4065",     (the victim's run)
-   "rpr_01M613WTTA3HJ35NVTXAWBYTJ9",     (the flooding environment's run that is not waiting)
    "rpr_01M613WTPMGSMSM8BV2FZFB6FM",
+   "rpr_01M613WTQMQ1404X3C2MZ8FT70",
+   "rpr_01M613WTR31YKVV4FZHNK1DSD7",
  ]
      Tests  1 failed | 10 passed (11)
GREEN $ vitest (packages/db) src/repositories/report-repositories.test.ts
      Tests  11 passed (11)
      $ vitest (apps/api) src/jobs/reports/sweep.test.ts src/jobs/repeatable/phase6.test.ts
      Tests  8 passed (8)
      $ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts   (apps/api, Postgres 17)
      Tests  12 passed (12)
```

The integration run shows that the locking clause (`FOR UPDATE OF report_runs SKIP LOCKED` over a join with the ranked sub-select) is valid on Postgres 17: two sweeps run it there at once.

Fix: each batch ranks the enqueueable runs within their environment (`row_number() over (partition by environment_id order by not_before is not null, scheduled_for, id)`) and takes them by that turn, then by `scheduled_for`. Each environment's first run therefore comes before any environment's second. Within an environment, the runs that are not waiting on a budget come before its budget-waiting ones. The outer select checks the conditions again on the locked row, so a run that another sweep took meanwhile is left out. The batch is enqueued in that order. Refactor: the sweep's comment says so.

Not done here, for the owner (recorded in the plan amendments): a per-environment cap on pending media runs at creation (C72.5 has none for non-recurring reports), which would answer 429 and needs a new problem. The fairness fix ends the starvation. A large backlog still delays others behind the jobs already in the queue, but never past one pass through it, because a queued run is not stamped again for five minutes.

## K6A-3 (MEDIUM, owner decision 2): not done

The frozen-record additions (`alias-quality`, `list-memberships` for OFAC Consolidated entries, `relative-of-class`) are not local. They change the record schema and both of its hashes, so every entry of every source would read as changed at the next sync and trigger a re-screen. They also touch three parsers (OFAC, EU and UK alias strength, Wikidata relatives), the matcher's reasons and the match snapshot. A weak alias is already parsed per name (`quality: 'weak'`, from OFAC `isLowQuality`, UN `QUALITY`, EU `strong` and UK `AliasStrength`), and weak aliases are already screened by exact equality under `screen-weak-aliases` (`weak_alias` retrieval). This item goes back to the owner as a planned slice.

## K6A-4 (MEDIUM, owner decision 3): `general_delivery` done, the phone reasons not

**The phone reasons are not done.** `prepaid`, `payphone` and `other_line_type` extend `PHONE_RISK_REASONS`, and the dashboard's `PHONE_RISK_REASON_WORDS` (`apps/dashboard/src/lib/report-field-words.ts`) is a `Record` keyed by that list. Stage 1 dashboard-reports amendment 12 says the same change must add their words. That file is the console fixer's, so a change made here alone would break `pnpm typecheck`. The item goes back to the orchestrator, to be run as one change across both paths.

**`general_delivery` is done.** The dashboard's `VALUE_WORDS` is keyed by string, so a new designator shows as its code there until it has words (amendment 10).

The existing test "keeps general delivery among the matched patterns, not the designators" encoded the earlier rule. It now reads the owner's decision (rule 12): `General Delivery` and `Poste Restante` read `['general_delivery']` without a CMRA hint, and `PO Box 9` with `General Delivery` reads `['po_box', 'general_delivery']`.

```text
RED   $ vitest (packages/checks) src/reports/address/report.test.ts
     × reads general delivery as a designator of its own, with no CMRA hint (owner decision 3)
- Expected
+ Received
      Tests  1 failed | 19 passed (20)
GREEN $ vitest (packages/checks) src/reports/address
      Tests  35 passed (35)
      $ vitest (packages/contracts)
      Tests  2071 passed (2071)
      $ vitest (apps/api) src/jobs/report-types/address-lookup.test.ts src/jobs/report-types/report-golden-fixtures.test.ts
      Tests  13 passed (13)
      $ pnpm --filter @openverify/api openapi:write
 docs/api/openapi.json | 10 ++++++++--
```

Fix:
- `ADDRESS_DESIGNATORS` and the contract enum gain `general_delivery`, and `designatorOf` maps the `general_delivery` pattern to it.
- The API's pin of the designator list follows the contract.
- `docs/reports/address-lookup.md` states each designator with its basis: general delivery (USPS) or poste restante (UPU) holds mail at a post office for the addressee to collect. The report states it and never scores it, because it has no risk level.

No golden fixture holds a general delivery address, so none changed.

## Order of the MEDIUM items

The small local items (R005, R007, R009, R003, R002, P5-5, K6A-13, P5-7) were taken before the larger ones (K6A-7, K6A-8, K6A-11, R010, P5-6), so that the large items could not crowd out the small ones. K6A-5, K6A-9, K6A-10 and K6A-12 are LOW and are not fixed (the rules say never fix LOW findings). K6A-6 is skipped: see its section.

## R005 (MEDIUM): resuming a report whose next run was still ahead pushed it out by one interval

`nextBoundary(from, interval, now)` (`apps/api/src/services/reports/reports.ts`) clamped a negative count of passed intervals to 0 and then took at least one step. So a `from` still ahead came back as `from + interval`. The sweep calls it with a due `from`, which is correct, but `changeReportMonitoring`'s `resume` calls it with the paused report's `next_run_at`, which a pause keeps and which may still be ahead: a 30-day report resumed 10 days before its run moved to 40 days out.

Tests:
- `apps/api/src/services/reports/next-boundary.test.ts` (new): a boundary still ahead is kept; a due one moves to the first `from + k` intervals after now (`k >= 1`), whatever the number of intervals missed.
- `apps/api/src/routes/server/reports.test.ts`, "pauses, resumes and runs a recurring report": the resumed report's `next-run-at` equals the paused one's.

```text
RED   $ vitest (apps/api) src/services/reports/next-boundary.test.ts src/routes/server/reports.test.ts
     × keeps a boundary still ahead (a resume before the next run is due)
AssertionError: expected 2026-12-07T12:00:00.000Z to deeply equal 2026-11-07T12:00:00.000Z
     × pauses, resumes and runs a recurring report, refusing what does not apply
AssertionError: expected '2026-11-03T12:00:00.000Z' to be '2026-10-27T12:00:00.000Z'
      Tests  2 failed | 14 passed (16)
GREEN $ vitest (apps/api) src/services/reports/next-boundary.test.ts src/routes/server/reports.test.ts src/jobs/reports/sweep.test.ts src/routes/server/report-review.test.ts
      Tests  34 passed (34)
```

Fix: `nextBoundary` returns `from` when it is after `now`. Otherwise it takes `floor((now - from) / step) + 1` steps, which is at least one.

## R007 (MEDIUM): the first subject name lost its trigram fallback when an additional name had a rare key

`retrieveNames` (`apps/api/src/jobs/reports/screening.ts`) sent one search with the keys of every subject name and the first name's trigram and weak-alias paths. `retrieveCandidates` (`packages/db/src/repositories/watchlists.ts`) skips the trigram path for a multi-word name when the search has any rare key. So a rare key of an additional name skipped the primary name's fallback, even when none of the primary's own keys was rare. A one-letter-different listed spelling of a common primary name was then never retrieved, and the report read `ready` with no match and complete coverage.

Test (`apps/api/src/jobs/report-types/matching-reports.test.ts`): the in-memory reads record each search. A watchlist report on `Perpetua Nonesuchly` with the additional name `Quillon Zephyrine` sends exactly one search with the primary's name path. That search carries `t:nonesuchly` and no key of the additional name. Every name's keys are still searched, and the additional name has its own path.

```text
RED   $ vitest (apps/api) src/jobs/report-types/matching-reports.test.ts -t R007
     × decides the first name’s trigram path on its own keys, never on an additional name’s (R007)
AssertionError: expected [ 'j:quillonzephyrine', …(3) ] to deeply equal []
      Tests  1 failed | 24 skipped (25)
GREEN $ vitest (apps/api) src/jobs/report-types/ src/jobs/reports/ src/watchlists/
 Test Files  20 passed (20)
      Tests  192 passed (192)
```

Fix: with additional names, the searches are:
- the combined search with every name's keys and the identifiers, unchanged, but without a name path;
- the first name's trigram and weak-alias paths in a search of their own, keyed by that name's own keys (`queryNameKeys` of that name alone; the union over names is exact);
- each additional name's own search, unchanged (keys `[]`, so its trigram path always runs).

A subject with one name sends the single search it sent before. `retrieveCandidates` is unchanged. This revises Stage 3 api-reports amendment 7, and it is recorded in the plan.

## R009 (MEDIUM): a first publication with zero entries was applied and made the source fresh

The mass-removal guard needs `previous > 0`, so a publication without entries was applied on a source with no live entries yet, a first sync included. For example, a publisher schema change can move the entity elements and keep the root and the publication time. The source then read fresh, and every report on it read `ready` with no match until the next good sync: a false clear (ADR 0002).

Test (`apps/api/src/watchlists/sync.test.ts`): a UK Sanctions List file with no designations, imported into a source with no sync yet, is refused `refused_schema` with `entryCount: 0`. The source keeps `last_applied_at` and `last_checked_at` null and `last_error_code` `refused_schema`. With `--allow-mass-removal` it applies, and the override is recorded.

```text
RED   $ vitest (apps/api) src/watchlists/sync.test.ts -t R009
     × refuses a publication with no entries, the first one included, unless the operator allows it (R009)
-   "errorCode": "refused_schema",
-   "outcome": "refused_schema",
+   "errorCode": null,
+   "outcome": "applied",
      Tests  1 failed | 23 skipped (24)
GREEN $ vitest (apps/api) src/watchlists/ src/jobs/ src/seed
 Test Files  70 passed (70)
      Tests  840 passed (840)
```

Fix: in the apply transaction, after the mass-removal guard, a publication with no entries is refused `refused_schema` ("the publication has no entries") unless `--allow-mass-removal` is given. That override is recorded once, even when the mass-removal guard also needed it. The refusal keeps the previous data, as every refusal does. The sync header and `docs/reports/README.md` say so.

Not done, the second half of the suggestion: making screening availability treat a source with no live entries as `list_unavailable`. `WatchlistSourceState`, a frozen read, carries no entry count. With the refusal in place, a source can be empty only through the operator's explicit override, and that override is recorded in `watchlist_syncs` and shown on the sources page.

## R003 (MEDIUM): the C73.8 log test had no positive control

`packages/db/src/postgres-logging.integration.test.ts` asserted only that the string `Synthetic Person` was absent from whatever `container.logs()` gave in a fixed 500 ms window. An empty, late or unread log passed it, and so did a session whose `log_statement` did not take effect.

The fix is to the test itself, so the RED shows the defect with a mutation: `set log_statement = 'none'` in place of `'all'`. Under it, statement logging is off and the parameter can never reach the log. The old test and the new one ran under that mutation, each from a temporary copy that was then deleted:

```text
RED   $ pnpm exec vitest run --config vitest.integration.config.ts src/zz-old-mutant.integration.test.ts src/zz-new-mutant.integration.test.ts   (packages/db, Postgres 17)
     × keeps them out of the log when a session turns statement logging on 10093ms        (the new test)
AssertionError: expected 'The files belonging to this database …' to contain 'select $1::text as name'
      Tests  1 failed | 4 passed (5)        (the old test's two cases passed with logging off)
GREEN $ pnpm exec vitest run --config vitest.integration.config.ts src/postgres-logging.integration.test.ts
      Tests  3 passed (3)
```

Fix (test only):
- `logUntil` polls the container's log until it holds the expected text, with a 10-second deadline, instead of waiting a fixed 500 ms.
- The second test first asserts that the log holds the statement (`select $1::text as name`), and only then that the parameter is absent.
- A third test starts a Postgres without `POSTGRES_TEST_COMMAND` as the control. With statement logging on, its log holds both the statement and the parameter (`Synthetic Control`), so the check can be seen to detect a logged parameter.

## R002 (MEDIUM): the recurring caps were checked outside any lock for API-created reports

`createReportResource` (`apps/api/src/services/reports/reports.ts`) read `recurringCapReached` on the pool before its transaction opened, and never read it again. Concurrent `POST /reports` with a recurring template all read the same count, and all inserted.

Test (`apps/api/src/jobs/reports/report-races.integration.test.ts`, Postgres 17): a new environment with `maxRecurringPerEnvironment: 3` receives eight concurrent creations with a recurring template. Three are created, five answer `report_recurring_limit`, and the environment holds three reports.

```text
RED   $ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts -t R002   (apps/api)
     × keeps an environment at its recurring cap when many creations race for the last places
AssertionError: expected [ 'created', 'created', …(6) ] to have a length of 3 but got 8
      Tests  1 failed | 12 skipped (13)
GREEN $ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
      Tests  13 passed (13)
      $ vitest (apps/api) src/routes/server/reports.test.ts src/routes/server/report-routes.test.ts src/routes/dashboard/ src/services/reports/
 Test Files  23 passed (23)
      Tests  268 passed (268)
```

Fix: `lockRecurringReportCaps` (`packages/db/src/repositories/reports.ts`) takes `pg_advisory_xact_lock(hashtextextended('openverify/report-recurring-caps/<environment>', 0))`. A recurring creation takes that lock first in its transaction, before the account and inquiry locks, so it never waits while holding another lock. It then reads both caps (the recurring count and the scheduled media runs per day) inside the transaction, and the insert commits before the next creation reads them. A non-recurring creation takes no lock. The completion path keeps its own re-check (`beyondRecurringCaps` in `persist.ts`), which counts the report itself.

## P5-5 (MEDIUM, Phase 5 carry-forward): retry compose up once on a Docker Desktop port-allocation error

Docker Desktop sometimes keeps a host port reserved for a moment after the container that held it is gone. `compose up` then fails although the harness found the port free, and the whole e2e run failed.

Tests (`e2e/src/compose-retry.test.ts`, the harness library, under the 80% gate). Stub first (`chore`), so the RED typechecks.
- The daemon's `port is already allocated` and Docker Desktop's `Ports are not available … bind: address already in use` are recognised. An unhealthy container, a plain `Error` and a string are not.
- After a port-allocation error, the steps run in this order: `up`, a log line, `down`, a pause, then `up` once more.
- A second failure fails the run with that second error. Any other failure is never retried.

```text
RED   $ vitest (e2e) src/compose-retry.test.ts
     × knows the Docker port-allocation refusals
     × takes the project down and runs up once more after a port-allocation error
     × fails the run when the second up fails too, with the second error
      Tests  3 failed | 2 passed (5)
GREEN $ pnpm exec vitest run --coverage   (e2e)
      Tests  97 passed (97)
All files          |   96.81 |    88.42 |   93.33 |   97.66 |
```

Fix: `composeUpWithRetry` (`e2e/src/compose-retry.ts`). `e2e/setup/stack.ts` runs the infrastructure's `up --detach --wait` through it, with `down --volumes --remove-orphans` and a 5-second pause between the two tries. The test's fake step rejects with `Error` values only, so it lints clean (`prefer-promise-reject-errors`).

## K6A-13 (MEDIUM, owner decision 9): unit-api as two shards and a merge job with the 80% gate

A shard run with `--coverage` applies the configuration's thresholds to its own half of the code, and fails. This was measured on `packages/watchlist`, with the same flags the workflow uses:

```text
$ pnpm exec vitest run --coverage --shard=1/4 --reporter=blob --outputFile=<scratch>/blob-1.json   (exit 1)
ERROR: Coverage for lines (56.95%) does not meet global threshold (80%)
$ vitest run --coverage --coverage.thresholds.{lines,functions,branches,statements}=0 --shard=N/2 --reporter=blob …   (N = 1, 2: exit 0)
$ pnpm exec vitest run --merge-reports=<scratch> --coverage                                       (exit 0)
      Tests  470 passed (470)
All files          |   98.71 |     90.7 |   98.61 |   98.74 |
$ pnpm exec vitest run --merge-reports=<one shard only> --coverage                                (exit 1)
      Tests  190 passed (190)
ERROR: Coverage for branches (77.43%) does not meet global threshold (80%)
```

So each shard turns off only its own four thresholds, and the merge applies the configuration's 80% to the whole suite. The merged run reproduces the full suite's count and coverage, and a merge of half the shards fails the gate. The gate on the whole is unchanged.

## P5-7 (MEDIUM, Phase 5 carry-forward): the infra job runs the static parts of the other infra tests

Run locally first, with no stack up:

```text
compose.test.sh --static-only: exit 0, 2 s, 405 ok, 0 fail, 0 skip
apps-image-context.test.sh: exit 0, 0 s, 24 ok, 0 fail, 0 skip
check-connected-results.test.sh: exit 0, 0 s, 11 ok, 0 fail, 0 skip
pre-commit-hook.test.sh: exit 0, 3 s, 11 ok, 0 fail, 0 skip
ci-workflow.test.sh: exit 0, 6 s, 182 ok, 0 fail, 0 skip
```

Tests for both items (`infra/tests/ci-workflow.test.sh`):
- **`unit-api`** is a two-shard matrix with `fail-fast: false`. It installs with a frozen lockfile. Its one shard step runs in `apps/api` with `pnpm exec vitest run --coverage`, `--shard=${{ matrix.shard }}/2` and `--reporter=blob`, and turns off all four of the shard's own thresholds. It uploads each shard's blob report, and its timeout is at least 25 minutes.
- **`unit-api-coverage`** needs `unit-api` and downloads every `unit-api-blob-*` report with `merge-multiple`. It runs `pnpm exec vitest run --merge-reports=… --coverage` in `apps/api` with no thresholds flag, and uploads the merged coverage. No job runs the API suite unsharded.
- **`infra`** runs `compose.test.sh --static-only` and never the compose contract's live half. It also runs `apps-image-context.test.sh`, `check-connected-results.test.sh`, `ci-workflow.test.sh` and `pre-commit-hook.test.sh`, and installs the pinned gitleaks before the hook test.

```text
RED   $ bash infra/tests/ci-workflow.test.sh
FAIL - job 'unit-api-coverage' exists
FAIL - unit-api: runs as a matrix of two shards ({})
FAIL - unit-api: each shard runs the api suite in apps/api with coverage, as a blob report
FAIL - unit-api: a shard turns off only its own thresholds (all four), never the merge's
FAIL - unit-api-coverage: merges the reports in apps/api and applies the 80% coverage gate to the whole
FAIL - infra: runs bash infra/tests/compose.test.sh --static-only
FAIL - infra: installs the pinned gitleaks before the pre-commit hook test
… (18 FAIL in all)
exit 1
GREEN $ bash infra/tests/ci-workflow.test.sh
# 203 passed, 0 failed, 0 skipped      (actionlint ran; gh verified every pin remotely)
```

Fix (`.github/workflows/ci.yml`):
- **The shards.** `unit-api` runs the two shards, 30 minutes each, and uploads `apps/api/.vitest-reports/` with `include-hidden-files: true`.
- **The merge.** `unit-api-coverage` downloads the shards' reports, merges them under the gate and uploads `apps/api/coverage/`. `actions/download-artifact` is pinned to v8.0.2 (`9000827c…`, released 2026-10-07), which `gh` resolved and the contract re-verified.
- **The infra job** gains the five static steps and gitleaks through `infra/scripts/install-gitleaks.sh`, as the secrets job installs it. The CI workflow contract step needs PyYAML in the runner's system Python. That is expected on the GitHub Ubuntu image, but it was not verified here: the orchestrator's `workflow_dispatch` run on a branch must confirm it.

## Evaluation-6 performance finding: every sync rewrote every unchanged entry

Evaluation-6 found that `writeWatchlistEntries` (`packages/db/src/repositories/watchlists.ts`) ran `update watchlist_entries set last_seen_sync_id = <sync>` on every unchanged entry of each publication. `markUnseenEntriesRemoved` then removed the live entries whose `last_seen_sync_id` was not the sync. Eight full publications left 412,549 live entries in 3.0 GB (680 MB after `VACUUM FULL`), and a weekly full PEP sync would rewrite the whole table each time. This is a defect in code, not a constant: the sync already computes the removed entries in its diff (`PublicationDiff`, read under the source's lock) for its counts and the mass-removal guard.

Test (`apps/api/src/watchlists/sync.test.ts`): a UK file of 30 designations is applied, then the same file without its first designation. The second sync reports `added: 0, changed: 0, removed: 1, entryCount: 29`. The 29 kept entries are live, the dropped one is not, and every kept row keeps its row version (`xmin`), so it was not written.

```text
RED   $ vitest (apps/api) src/watchlists/sync.test.ts -t evaluation-6
     × removes exactly the entries a publication dropped and never rewrites an unchanged one (evaluation-6)
AssertionError: expected { entryId: 'SYN0002', version: '745' } to deeply equal { entryId: 'SYN0002', version: '743' }
      Tests  1 failed | 24 skipped (25)
GREEN $ vitest (packages/db) src/repositories/watchlists.test.ts
      Tests  23 passed (23)
      $ vitest (apps/api) src/watchlists/ src/jobs/reports/rescreen.test.ts
 Test Files  9 passed (9)
      Tests  85 passed (85)
      $ pnpm --filter @openverify/watchlist benchmark:typecheck     (pass)
```

Fix:
- `writeWatchlistEntries` writes only added and changed entries. An unchanged entry is not touched, so `last_seen_sync_id` is now the sync that last wrote the entry.
- `markEntriesRemoved(db, { sourceId, entryIds, at })` replaces `markUnseenEntriesRemoved`. It removes the live entries the diff found gone, in batches of 500, and returns how many.
- The sync passes it `summary.removed`.
- The repository test that pinned the old meaning (rule 12) now expects the unchanged entry's `last_seen_sync_id` to stay at the sync that wrote it, and removes by id. A never-listed id counts nothing.

Measured again with evaluation-6's commands from its handoff: seed `05b49d0100c2c9a67c4e76536470946f`, the steps `machine`, `100k-import`, `rescreen-seed`, `rescreen-100`, `rescreen-1000` and `100k-teardown`, into an empty scratch directory. The same machine was shared with another fixer's e2e stack, at load averages of 3.5 to 7.2.

| Step | Run 1 (before) | This run (after) |
| --- | --- | --- |
| `100k-import`: sync of 60,784 entries, the first one | 44.2 s | 45.7 s (`watchlist_entries` 71.3 MB) |
| `rescreen-100`: sync adding 100 to 60,784 entries | 23.6 s | **19.3 s** |
| `rescreen-100`: re-screen of 200,000 subjects | 28.4 s, 5,401 runs | 28.2 s, 5,401 runs |
| `rescreen-1000` (this run skipped `rescreen-300`, so its cumulative file added 1,300) | 25.9 s sync, 99.2 s re-screen, 13,920 runs | 26.7 s sync, 120.9 s re-screen, 16,347 runs: **not comparable** |

The first import writes every entry in both runs, as it must. A sync that adds 100 entries no longer rewrites the 60,784 unchanged ones: it took 19.3 s against 23.6 s, under a higher load. The rest of that sync is parsing, the diff, the full key-frequency rebuild (owner decision 11 carries its incremental form) and `ANALYZE`. The re-screen is unchanged, as expected: this fix does not touch it. The dead space of successive full publications is no longer written; the 2,000,000-name import (eight syncs, about 30 minutes) was not re-run.

## K6A-7 (MEDIUM, owner decision 7): the missing races on Postgres, four of seven

Added to `apps/api/src/jobs/reports/report-races.integration.test.ts` (Postgres 17):
1. **A budget-waiting run.** A run that waits until `not_before` = now + 5 s is not enqueued by a sweep 1 ms before it. It is enqueued by the first sweep tick after it (+15 s), still `pending`, its claim not counted (`attempt: 0`).
2. **An exhausted job against a live worker.** One worker holds the claim and is paused inside the type job. Another worker's last attempt of the same run answers `not_claimed`, and the run stays `running` (`attempt: 1`). The live worker then completes it `ready`, and the exhausted job's match is never written.
3. **An eleventh claim.** A run at `attempt = 10` is ended `errored` (`execution_error`, `attempt: 11`) without the type job running, and its report reads `errored`.
4. **A re-screen against a redaction.** A report redaction is paused before its commit. `insertListUpdateRuns` for that report waits for it: the run's foreign-key check waits on the report row lock. After the commit, any `list_update` run it inserted is never stamped by the sweep and never claimed (`not_claimed`, the type job does not run), no match is written, and the report stays redacted.

```text
      $ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
     × a re-screen during a redaction leaves a run that is never enqueued, claimed or run
AssertionError: expected 'pending' to be 'settled'
      Tests  1 failed | 16 passed (17)
      (after correcting the test's expectation)
      Tests  17 passed (17)
```

These pin behaviour that was already correct, so there was no RED of the code. The one failure was my test's wrong assumption that the insert takes no lock it waits on: the foreign-key check waits on the redaction's row lock. The test now asserts that wait. No race was exposed, so no code changed.

Not done: completion-hook creation against consolidation, completion-hook creation against account redaction, and the initial run's account link against consolidation. Each needs the inquiry transition with its report hooks (`transitionInquiryInTx`, `createInquiryReportsInTx`) or the account consolidation service held inside its transaction on Postgres. This file has no harness for those, and building it is a slice of its own. They go back to the owner.

## K6A-8 (MEDIUM, owner decision 5 (a)-(d)): (a), (b) and (c) done, (d) not

- **(a) `hops`** (`CryptoExposureResult`, rated). Stub first, so the RED typechecks. Test (`apps/api/src/jobs/report-types/matching-reports.test.ts`): an indirect exposure is served with the provider's `hops: 3`. Without `hops`, and for a provider's 0 or 2.5, it is served with 1 ("at least one hop").

  ```text
  RED   $ vitest (apps/api) src/jobs/report-types/matching-reports.test.ts -t "hop distance"
  -       "hops": 3,
  +       "hops": 1,
        Tests  1 failed | 25 skipped (26)
  GREEN $ vitest (apps/api) src/jobs/report-types/
        Tests  86 passed (86)
  ```

  The sandbox provider states no hops, so no fixture changed.
- **(b) `environmentId` and `names` on `AdverseMediaSearch`.** These are the members api-providers' `AdverseMediaSearchRequest` added. The type is folded into the port and removed, and `searchNamesOf` and `searchEnvironmentOf` read the port without a cast. This is a refactor with the suite green (`vitest (apps/api) src/jobs/report-types/ src/providers/`: 50 files, 533 tests).
- **(c) `lookup` on `PhoneIntelligenceResult`** (risk-logic's `PhoneIntelligenceLookup`). `phoneIntelligenceLookupOf` reads `result.lookup` when present, and a bare answer keeps the conservative reading. This is a refactor with the suite green (10 files, 98 tests). A test's cast became unnecessary and was removed; the assertion is unchanged.
- **(d) not done:** an actor on `ReportRedactionOptions`, so that every redaction writes a `redact` action. That would change every redaction path: the report route, the inquiry and account cascades in `services/redaction.ts`, and retention (`retention:run`). It would also change the report action log that the console and the history read. That is not local, and it goes back to the owner.

## K6A-11 (MEDIUM, owner decision 6): the refresh back-off, with migration 0021

The refresh tick asked a failing source again on every 15-minute tick: `last_checked_at` moves only on a good check, so a failing source stayed due.

Stub first (`refreshBackoffMs`, returning 0), so the RED typechecks. Tests (`apps/api/src/jobs/repeatable/watchlists.test.ts`):
- `refreshBackoffMs` gives 15, 30, 60, 120, 240 and 360 minutes for 1 to 6 failures at a 6-hour interval, the interval at 40 failures, 24 h at 12 failures for a 168-hour source, and 0 without a failure.
- A tick on its own PGlite database, with OFAC always answering 503 and the UK list failing once:
  - at 0 minutes, one sync of each;
  - at 10 minutes, neither is asked again (`due: 2`, the two unconfigured sources);
  - at 15 minutes, both are asked; the UK list applies and resets its count to 0, and OFAC's count is 2;
  - at 40 minutes, OFAC is not asked (30 minutes since its second failure);
  - at 45 minutes, it is asked again, and its count is 3.

```text
RED   $ vitest (apps/api) src/jobs/repeatable/watchlists.test.ts
     × doubles from 15 minutes after the first failure, capped at the refresh interval and at 24 h
AssertionError: expected [ +0, +0, +0, +0, +0, +0 ] to deeply equal [ 15, 30, 60, 120, 240, 360 ]
     × asks a failing source again only after its back-off, and a successful check resets it
AssertionError: expected 5 to be 2
      Tests  2 failed | 6 passed (8)
GREEN $ vitest (apps/api) src/jobs/repeatable/ src/watchlists/
 Test Files  15 passed (15)
      Tests  108 passed (108)
      $ pnpm exec vitest run src/ --coverage   (packages/db)
 Test Files  75 passed (75)
      Tests  963 passed (963)
All files          |   95.45 |    89.61 |   96.33 |   95.79 |
```

Fix:
- **The migration.** `packages/db/drizzle/0021_watchlist_check_backoff.sql` was generated by `drizzle-kit generate --name watchlist_check_backoff` from the table schema. It adds `watchlist_sources.check_failures integer NOT NULL DEFAULT 0` (checked non-negative) and `last_failed_at timestamptz NULL`.
- **Counting failures.** `recordWatchlistSourceError` takes an optional `failedAt`. The sync passes it for a download error and for a refusal, because both asked the publisher or read its file. It does not pass it for `source_not_configured` or `refused_matcher_data`, which make no request. With `failedAt`, the count goes up by one and `last_failed_at` is set.
- **Resetting.** `recordWatchlistSourceCheck` and `recordWatchlistSourceApplied` reset both.
- **The state.** `WatchlistSourceState` gains the optional `checkFailures` and `lastFailedAt`, so the hand-built states of other tests still typecheck.
- **The tick.** A source is due only once its back-off has passed since `last_failed_at`: 15 minutes times two to the power of (failures - 1), capped at its refresh interval and at 24 hours. Freshness and staleness are unchanged.
- **Tests and docs.** The repository test that compared a whole state with `toEqual` gained the two fields (rule 12), and its error test now counts and resets failures. `docs/reports/README.md` says so.

Deviation from owner decision 6: migration 0021 adds `last_failed_at` beside `check_failures`, because a back-off counted from the last failure needs its time, and `last_checked_at` dates only good checks. It does not add `last_change_signal`: K6A-6 is not done (see its section), and an unused column would be dead schema. The change signal's own migration adds it.

## K6A-6 (MEDIUM, owner decision 6, Stage 4 amendment 17): not done

Reading the change signal before the download is not local. It needs:
- a migration and the repository writes;
- in `syncWatchlistSource`, a request through the list client to each publisher's signal endpoint: OFAC's `/changes/latest` redirect, whose `Location` the client must read without following it to its credentialled S3 URL, the EU RSS feed and the GOV.UK content API;
- MockAgent tests for each.

The risk is an honesty risk (ADR 0002, ADR 0005). A signal that does not move when a list changes would make the sync answer `unchanged` and set `last_checked_at`, so a changed list would read fresh while reports screen the old one. Today every check downloads and compares the SHA-256, which is correct, only slower. This goes back to the owner, with tests against each publisher's real signal semantics.

## LOW items and P5-6: not done

- K6A-5, K6A-9, K6A-10 and K6A-12 are LOW, and the rules say never fix LOW findings.
- **P5-6** (16 db test files that assert newest-first order on rows written back to back without stamping `created_at`) is test hardening against PGlite's millisecond `now()`. It would edit 16 test files, and no ordering failure was seen in this run (`packages/db`: 963 tests passed). Once the blocking findings and the other items were done, the time left went to the final gates. It goes back to the orchestrator.

## R010 (MEDIUM): the UN list was described as an operator opt-in that no setting provides

Confirmed by reading the code. `reconcileWatchlistSources` (`apps/api/src/watchlists/reconcile.ts`) sets `enabled = enabled_by_default and not disabled`, and the upsert writes it back on every start and every refresh tick. `config.ts` parses only `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`.

Not done: the opt-in setting itself. It would need:
- a new setting in `WatchlistSettings`, read by the six reconcile callers (API, worker, refresh tick, CLI, sandbox import, `seed:dev`);
- compose wiring;
- a declaration in `.env.example`. That file is outside these paths, and `infra/tests/compose.test.sh` requires every app setting there.

It is also a policy choice: a source under non-commercial terms needs an acknowledgement step, as GDELT's `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE` has. This goes back to the owner.

Done (docs only): `docs/reports/README.md` no longer says to "enable it only after reading" the terms. It now says that this release has no setting that enables `un-sc`, that a hand edit is reverted at the next start or tick, that a CLI sync stores the list but a template pinning it errors `list_unavailable`, and that the OFAC, EU and UK lists carry most UN designations. The manifest's own note (`watchlists/sources.json`) still says "enable it only after reading those terms". That file is outside these paths, so the owner must change the wording there.

## F15: the whole e2e suite with the UI specs

```text
$ flock /tmp/openverify-e2e.lock pnpm e2e        (2026-10-28 12:30 UTC, after the last code commit)
@openverify/flow:e2e: Running 69 tests using 6 workers
@openverify/flow:e2e:   69 passed (20.1s)
@openverify/e2e:e2e: Running 91 tests using 1 worker
@openverify/e2e:e2e:   91 passed (9.7m)
e2e exit 0 after 604 s
```

The full-stack suite, the UI specs included, takes 9.7 minutes against Playwright's `globalTimeout` of 45. The CI e2e job allows 70 minutes and took 14 at the end of Phase 5. Neither limit is raised, the job is not sharded, and `infra/tests/ci-workflow.test.sh` is unchanged for it. This is recorded in the plan (Workflow 6B review amendment 17).

## Final gates

All ran after `source scripts/env.sh`, on the final code. The only commits after the last code commit are documentation.

| Command | Result |
| --- | --- |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` | exit 0 in 774 s. Typecheck and lint: 14 of 14 tasks successful, replayed by turbo from the identical-input run at 08:32. Unit tests: 14 of 14 successful, 8 run and 6 replayed for unchanged inputs. `api` 317 files and 4,479 tests (96.37% statements, 88.31% branches, 98.11% functions, 96.41% lines). `db` 963 tests (95.45%). `watchlist` 470 (98.71%). `checks` 3,304 (98.73%). `contracts` 2,071 (99.22%). `e2e` harness 97 (96.81%). `dashboard` 264 files. Prettier: all files formatted |
| `pnpm test:integration` | exit 0 in 183 s, 0 cached: `db` 12 files and 60 tests, `api` 27 files and 146 tests (the C78.7 gate and `report-races` with its new tests among them) |
| `pnpm --filter @openverify/api openapi:write`, twice | both exit 0 (13 tests). After the run, `git status docs/api/openapi.json` is empty: the committed spec, regenerated with the `general_delivery` designator, is what the routes give |
| `bash infra/tests/ci-workflow.test.sh` | 203 passed, 0 failed, 0 skipped (actionlint ran; gh verified the pins) |
| `bash infra/tests/{compose.test.sh --static-only,apps-image-context,check-connected-results,pre-commit-hook}.test.sh` | 405, 24, 11 and 11 ok, 0 failed (run before the CI change; none of these scripts changed) |
| `flock /tmp/openverify-e2e.lock pnpm e2e` | exit 0: 69 mocked and 91 full-stack tests passed (above) |
| Android `ContractFixturesTest` | not run: no file under `contracts/fixtures/` changed. The contract enum changed in `packages/contracts`, and no Android model carries designators |
