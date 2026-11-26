# Phase 11, Workflow 11B Stage 2: dsar-export (family D)

TDD evidence of `dsar-export`: C253 (the per-account access export) and the data family's carries
from Workflow 11A (KP11-14, KP11-15, KP11-16) and Phase 10 (KP10-54). Commands are run from the
repository root after `source scripts/env.sh` unless a `cd` is shown; the load average
(`cat /proc/loadavg`) is written beside every timing. Synthetic data only (rule 9).

## 1. KP11-15: the production redaction hook against a pending redemption

Hypothesis (read at the base): `services/connect/redaction-hooks.ts` locks each token it acts on
(`lockOutboundShareTokenForUpdate`) after an unlocked `crossTenant.listSharesTouching`, and skips a
`pending` token **after** locking it, so the lock is held to the redaction's commit; 11A's race suite
simulated the redaction.

Test: `apps/api/src/services/connect/redaction-hook-races.integration.test.ts` (new), over the
production hook (`connectRedactionHooks.inquiryRedactedInTx`) after `redactInquiryRecords` in one
transaction, and the production redemption port (`redemptionCrossTenant`, with a hold after its
source read, so the token is held FOR UPDATE):

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api \
    src/services/connect/redaction-hook-races.integration.test.ts
load 0.76 1.49 2.52
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  23.91s
```

- redaction first: the job waits (`within(job, 1500 ms)` is `pending`), then ends
  `{outcome: 'failed', failureReason: 'source_redacted'}` and the token is `failed`/`source_redacted`;
- job first: the redaction waits on the token, the job ends `redeemed`, and the destination's events
  hold `connect/share-token.source-redacted` (C241.2);
- a `created` token: the hook fails it `source_redacted` in the redaction.

Green at first run: **the item is already done** by the hook as 11A built it; no change to the hook.
Commit `e3ddd8a5c` (test). KP11-15 is reported open: already done, with this test.

## 2. KP11-14: `consent_records` into `SUBJECT_PII_TABLES`

RED (`9516bb6a1`): `consent_records` moved from `CONSENT_PII_TABLES` into `SUBJECT_PII_TABLES`
(`apps/api/src/services/redaction.test-support.ts`, a named borrowed edit) and three tests in
`apps/api/src/services/redaction.test.ts` (a named borrowed edit): the seeded subject holds consent
records on its inquiry and its account with sealed evidence; an inquiry's and an account's redaction
clears the evidence and keeps the bare fact.

```
$ cd apps/api && pnpm exec vitest run src/services/redaction.test.ts --coverage.enabled=false \
    -t "consent records|covers every table"
load 4.75 3.48 3.10
     × the subject holds consent records with sealed evidence, on its inquiry and its account
     × an inquiry’s redaction clears the evidence and keeps the bare fact
     × an account’s redaction clears the evidence and keeps the bare fact
AssertionError: expected [] to deeply equal [ 'account', 'inquiry' ]
AssertionError: expected [] to have a length of 1 but got +0
AssertionError: expected [] to have a length of 2 but got +0
      Tests  3 failed | 1 passed | 26 skipped (30)
```

The coverage test ("seeds every encrypted table except operator data") still passes: the table only
moved category. GREEN (`e3153e070`): `seedPiiSubject` writes a `flow` record on the inquiry (sealed
address and user agent) and an `attested` record on the account (sealed text and evidence reference)
over one self-connection per organisation (the first run failed on
`connect_connections_source_destination_key` when a test seeded two subjects in one tenant, so a
second subject reuses the connection).

```
$ cd apps/api && pnpm exec vitest run src/services/redaction.test.ts \
    src/services/redaction-transactions.test.ts src/services/retention.test.ts \
    src/jobs/retention.test.ts --coverage.enabled=false
load 8.74 5.84 4.07   real 1m35.4s
 Test Files  4 passed (4)
      Tests  72 passed (72)
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api \
    src/services/lifecycle.integration.test.ts
load 10.88 7.64 4.91   real 41.2s
      Tests  7 passed (7)
```

The clone case (api-redeem's followup, C236.10; `31a583933`): in the same integration file, a real
redemption moves the destination record (sealed `198.51.100.23` and user agent) onto the clone, and
the clone's redaction at the destination (`createRedactionService().redactInquiry`) clears its
evidence and subject, keeping the token id, the digest and the time. Green at first run (built by 11A).

```
load 8.26 7.56 5.15
      Tests  4 passed (4)
```

## 3. The manifest (C253.2, C253.3, C253.5)

Stub `48582a745`, RED `4de254a47`, GREEN `3f8d53eb5`:
`apps/api/src/services/account-export/manifest.ts` and its test, held to the golden
`contracts/fixtures/api/account-exports/manifest.json` (the golden counts 14 items: every record of
both parts, every share and file, and the face templates counted as present).

```
$ cd apps/api && pnpm exec vitest run src/services/account-export/manifest.test.ts --coverage.enabled=false
(RED, on the stub)
     × assembles the golden manifest from what the collector read
     × counts every record, share, file and face template, and the account (C253.5)
     ... 8 of 8 fail
(GREEN)
      Tests  8 passed (8)
```

The RED's second count row expected 9 for the golden without its face templates, files, signal and
share; 14 - 2 - 2 - 1 - 1 is 8, corrected in the GREEN commit.

## 4. The collector (C253.2)

Stub `96f04a7c2`, RED `ece0245c1`, GREEN `4778b9928` (with the named borrowed edit `5a8e67e0f`,
`export` on `resourceFor` in `apps/api/src/workflows/runs/service.ts`, and `b0751391f`, the C16
seed's transaction field stored in its `{type, value}` shape, which the transaction resource needs).
`apps/api/src/services/account-export/collect.ts` over the C16 suite's `seedPiiSubject` on PGlite:

```
$ cd apps/api && pnpm exec vitest run src/services/account-export/collect.test.ts --coverage.enabled=false
(RED, on the stub)  Tests  11 failed (11)   (each "collectAccountExport is not built yet (dsar-export)")
(GREEN, first run)  ZodError at attributes.fields.note: the seed stored a bare string; the seed fixed
(GREEN)             Tests  11 passed (11)
(the seed's other users, after the seed fix; load 5.46 8.25 7.83)
$ pnpm exec vitest run src/services/redaction.test.ts src/services/redaction-transactions.test.ts \
    src/services/retention.test.ts src/jobs/retention.test.ts --coverage.enabled=false
      Tests  72 passed (72)
```

`c6dff5506` adds the families the C16 seed has none of (a decision, a report with an action, a case
holding the inquiry with a comment, a workflow run of the account, an outbound redeemed share): green
at first run against the GREEN collector (12 of 12; the folder's 20 tests at 86.97% statements).

The Connect read (C240.5's Testcontainers test for the export; KP11-16): `f2d30912a`, `e466cbaf0`,
`collect.integration.test.ts`, a real redemption between two organisations, then each side's export:

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api \
    src/services/account-export/collect.integration.test.ts
load 14.64 15.84 13.68
      Tests  1 passed (1)
```

## 5. The API log keeps no export content (amendment 48)

RED `6894e8238` (`apps/api/src/plugins/api-logs.test.ts`, probe routes at the two route patterns):

```
     × never keeps the access export’s manifest or file in the log (C253.1, amendment 48)
AssertionError: expected { …(2) } to be null
      Tests  1 failed | 14 passed (15)
```

GREEN `920bd4071`: `UNLOGGED_RESPONSE_ROUTES` and `loggedResponseJson` in
`apps/api/src/services/api-logs.ts` (the named borrowed edit), read by `apps/api/src/plugins/api-logs.ts`
(a second borrowed edit the plugin needs: it alone knows the route):

```
$ cd apps/api && pnpm exec vitest run src/plugins/api-logs.test.ts src/services/api-logs.test.ts \
    --coverage.enabled=false
      Tests  42 passed (42)
```

## 6. The problems

Stub `dbec7cdad`, RED `4970c9f8a` (4 of 4 fail on the stub's 500),
GREEN `639948c03`, fix `9d5c18596`: the GREEN commit landed while the too-large row still failed
(its title read "Unprocessable Entity", Node's name; the golden has RFC 9110's "Unprocessable
Content"), because the commit was chained after the test run with `;` instead of `&&`; the fix sets
the title, 4 of 4.

## 7. The service, the live files, the cut and the deletion (ports over the store)

`foundation-11b`'s table and frozen routes had not landed when these were built, so each takes the
store as a port that `packages/db/src/repositories/account-exports.ts` implements once the table
exists (`AccountExportStore` in `service.ts`, `AccountExportJobStore` in `cut.ts`,
`AccountExportDeletionStore` in `deletion.ts`), each tested over PGlite with a fake store.

| Module | Stub | RED | GREEN | RED output (on the stub) | GREEN |
| --- | --- | --- | --- | --- | --- |
| `service.ts` (who, create, read, manifest, files) | `5529dc2da` | `9373a0dc3` | `5b97e870f` | 24 of 24 fail | 24 of 24 |
| `files.ts` (`readLiveFile`) | `44413e3e8` | `088b67e2b` | `bf5e4f973` | 6 of 6 fail | 6 of 6 |
| `cut.ts` (the job's work) | `e20fac410` | `a47e722e5` | `484089fcf` | 6 of 6 fail | 6 of 6 |
| `deletion.ts` (C253.4) | `06376ca7c` | `11ba5478a` | `549de3bde` | 4 of 4 fail | 4 of 4 |

The service's first GREEN run failed 8 of 24 on the RED test itself (two rows expected a `forbidden`
code that `PermissionDeniedError` does not carry; the test's export ids were 24 characters, not a
ULID's 26), both corrected in the GREEN commit. A shared-scratchpad collision (another agent's file
of the same name in the session's scratchpad) briefly put foreign code in the working copy of
`service.ts` before the GREEN; it was never committed, and every later scratch file of this agent is
under `scratchpad/dsar-export/`.

The four refusal counters were registered in `apps/api/src/metrics-registry.ts` by `e36067fce` (a
named borrowed edit, rule 20) and the golden rows of `service.test.ts` typed by `bbe3a7e9e`; the
C253.4 header's KP10-54 decision was stated by `36d012504`. (These three commits are the last of the
first run, cut off at about 14:06 on 2026-11-13; this entry is written from the commits themselves.)

## 8. The rate gate and the refusal counters (C253.5, C253.7, C250.7)

Second run (after the restart). `apps/api/src/services/account-export/refusals.ts`: stub
`e9c6bf1df`, RED `532ad4a5d`, GREEN `fc68260a8`.

```
$ cd apps/api && pnpm exec vitest run src/services/account-export/refusals.test.ts --coverage.enabled=false
load 29.60 10.82 4.07
(RED, on the stub)
     × counts one use of account-export under the environment id and emits nothing when allowed
     × answers 429 past the limit and counts account_export_refused_rate_limited
     × fails closed with 503 account_export_unavailable when the store does not answer, counted
     × names the refusal of each access export problem, and none for any other error
     × emits each registered counter with the environment as its only label
Error: enforceAccountExportRate is not built yet (dsar-export)
      Tests  5 failed (5)
$ pnpm exec tsc --noEmit -p apps/api/tsconfig.json      (load 36.97; 3m40s)
5 errors, none in this agent's files (routes/dashboard/end-sessions.ts, routes/dashboard/sso.ts,
watchlists/conditional-policy.test.ts: other agents' work in progress)
(GREEN; load 16.65 16.67 8.79)
      Tests  5 passed (5)
```

The job counts a failure past the item limit too (`cut.ts`): RED `3c5943f20`
(`expected [] to deeply equal [ { level: 'info', …(2) } ]`, 1 of 6 fails; load 32.60), GREEN
`67abe2428` (cut and refusals, 11 of 11).

## 9. KP10-54 and the cut: a ready row that cannot be written

RED `349d63ab4`: `completeExport` rejects after the manifest is stored; the export must fail
`account_export_unavailable` (never stay `pending`, which would refuse every later export of the
account with 409) and leave no object.

```
load 3.70 6.57 9.21
     × deletes the stored manifest and fails the export unavailable when its row cannot be written (KP10-54)
Error: synthetic write failure Zyxw-synthetic-pii
      Tests  1 failed | 6 passed (7)
```

GREEN `57096c282` (7 of 7; the plaintext is zeroed in a `finally`). KP10-54's decision, as built: no
sweep of objects without rows. A replaced upload's ciphertext (`replaceVerificationFile`,
`sandbox-chip.ts`) and an export's manifest are unreadable once their row's wrapped data key is gone;
the export's own paths delete the object on every failure after the put (`cut.ts`: a deleted or
unwritable row) and after every deletion's commit (`deleteExportObjects`), keeping the key only when
storage itself fails, logged by key, never by content (`deletion.ts` header, `36d012504`).

## 10. The `account_exports` repository (`packages/db`)

After foundation-11b's (D) GREEN `747da78dc` (table `packages/db/src/tables/account-exports.ts`), stub
`f590a84ff` (with the repositories barrel's export line, a named borrowed edit), RED `8ca7c1e77`,
GREEN `cc15fc84e`, fix `143198f83`.

```
$ cd packages/db && pnpm exec vitest run src/repositories/account-exports.test.ts --coverage.enabled=false
load 12.70 13.03 16.33
(RED)    6 of 6 fail: "lockAccountForExport is not built yet (dsar-export)", ...
(GREEN)  Tests  6 passed (6)
```

`cc15fc84e` landed with `tsc` and ESLint failing on the expiry's raw result (`'result' is of type
'unknown'`; the commit was chained with `;` after the checks); `143198f83` reads the result through its
row type (tsc 0, lint 0, 6 of 6).

## 11. The store adapter, the hooks, the job and the routes

| Step | Stub | RED | GREEN | RED on the stub | GREEN |
| --- | --- | --- | --- | --- | --- |
| `store.ts` (the ports over the rows) | `2304e949f` | `999e065db` | `cfa23d9db` | 3 of 3 (`lockAccount is not built yet`) | 3 of 3 |
| `hooks.ts` (foundation-11b's C253.4 hooks) | foundation `d0b08fd8b` | `1ec15c420` | `ae3a8e772` | 4 of 4 | 4 of 4 |
| `jobs/account-export/process.ts` | foundation `d0b08fd8b` | `1c724a655` (integration) | `ae3a8e772` | `NotImplementedError: account-export is not built yet.` | 7 of 7 (integration) |
| `routes/server/account-exports.ts` | foundation `d0b08fd8b` | `93b599d76` | `2a075abfe` | 5 of 5 (`got 501`) | 5 of 5 |
| rule 22 on the create | — | `839b47923` | `041960118` | 1 of 6 (`expected 503 to be 404`) | 6 of 6 |

- The store's RED expiry case was corrected in its GREEN: the C16 drain is install-wide, and the
  file's first case had made an export with the same life (`expected { expired: 2 } … { expired: 1 }`).
- `foundation-11b-d.test.ts` lost dsar-export's two stub cases in `ae3a8e772`, as its header asks of
  each owner (a named borrowed edit, after `git status --porcelain` showed the file clean).
- The routes keep foundation-11b's schemas, the documented 501 included (integration-11b regenerates
  the snapshot): `src/openapi.test.ts` and `src/plugins/api-logs.test.ts` 30 of 30 (load 19.45).
- Rule 22: the cross-tenant probe (`src/security/cross-tenant-probe.integration.test.ts`) met
  `POST /api/v1/accounts/{id}/export: 503` for B on A's account, because the probe's app has no
  Valkey and the policy fails closed. The create now answers the generic 404 for an account outside
  the caller's environment before it counts the policy (C253.7's other answers unchanged):

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api \
    src/security/cross-tenant-probe.integration.test.ts
(before 041960118; load 24.04)
     × answers B on A’s ids as on made-up ids: 404, with nothing that tells them apart
+   "POST /api/v1/accounts/{id}/export: 503 {... \"detail\":\"Account exports are unavailable ...
(after; load 24.10)
      Tests  2 passed (2)    Duration  57.60s
```

## 12. Testcontainers: the export on Postgres and Valkey

`src/services/account-export/account-export.integration.test.ts` (RED `1c724a655`):

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api \
    src/services/account-export/account-export.integration.test.ts
(RED; load 29.29 27.21 24.77; real 58 s)
     × exports an account touching every seeded family, each part with its rows
     × answers 410 for a listed file deleted after the cut
     × a redaction after the cut deletes the export and its manifest in its cascade
     × a redaction while the job cuts leaves no export and no object
       (expected { outcome: 'ready', itemCount: 34 } to deeply equal { outcome: 'skipped' })
     × the C16 hook expires an export past its life and deletes its manifest
Caused by: NotImplementedError: account-export is not built yet.
      Tests  5 failed | 2 passed (7)
(GREEN after ae3a8e772 and 2a075abfe; load 28.36 25.16 27.47; real 3m24s with the heavy-slot wait)
      Tests  7 passed (7)
```

The two that passed on the stubs are the lock race (two creates at once: one 202, one 409) and the
policy against Valkey 9.1 (10 an hour per environment, then 429; with the container stopped, 503
`account_export_unavailable`), both built before this file.

## 13. Admission (C251.1)

Foundation-11b's (P) wraps only the `process-verification` and `report-run` producers
(`admitOnProduce`); the access export's enqueue site is this agent's create, so its admission is built
here over its own rows, as `admitOnProduce`'s stub admits the produced queues: stamped, then enqueued
by the export's id; a failed enqueue clears the stamp (the export stays `pending`, held).

| Step | Stub | RED | GREEN | RED on the stub |
| --- | --- | --- | --- | --- |
| the service admits by `(environmentId, exportId)` | — | `61fc4573e` | `23cdebd9d` | 1 of 24 (`expected [ 'env_…' ] to deeply equal [ Array(1) ]`) |
| `markAccountExportAdmitted`, `releaseAccountExportAdmission` (db) | `5cb9d2c65` | `4cac6d50f` | `272a8064e` | 1 of 7 |
| `createAccountExportAdmission` | `053d9c8a4` | `6c1ba4baf` | `146f104f9` | 3 of 3 |
| the route wires it over `ApiDependencies.accountExports` | — | `e462bb7dd` | `6769557a3` | 1 of 6 (`expected [] to deeply equal [ { …(2) } ]`) |

The typecheck of each RED ran on a temporary tsconfig that includes only the test file (and through
its imports everything it reads), because the whole API's `tsc` did not finish inside one 10-minute
call at load 25 to 38 (`tsc=124`, three times): admission 10m30s wall, 5m30s CPU, `tsc=0`; the route
test `tsc=0`. The temporary tsconfig files were deleted after each run and never committed.

## 14. End gates (rule 24: the packages this agent touched, `@openverify/api` and `@openverify/db`)

Every call is its own foreground call, the load average beside it; each heavy call through
`/tmp/openverify-heavy.sh` (an exit 75 run again). The machine ran six other agents' suites at once
(load 10 to 49), so several calls were split further than GATE_MEANING's (rule 8: a call past 10
minutes is split, never given a longer timeout).

| Gate | Calls | Result | Time and load |
| --- | --- | --- | --- |
| db typecheck | `pnpm --filter @openverify/db typecheck` | exit 0 | 424 s, load 49.26 |
| db lint | `eslint .` did not fit one call (`rc=124` at 590 s, load 37.45); split: `eslint src/repositories`, then `eslint . --ignore-pattern 'src/repositories/**'` | exit 0, exit 0 | 540 s (load 42.88), 254 s (load 36.74) |
| db unit | the whole run did not fit one call (`rc=124`, load 26.61); 3 blob shards and a merge | merge exit 0: **2,357 tests in 165 files, 89.88 % statements** | shards 387, 273, 261 s (load 25.61 to 40.10), merge 183 s (load 32.17) |
| db integration | `pnpm --filter @openverify/db test:integration` | exit 0: 110 tests in 23 files | 303 s, load 41.36 |
| API typecheck | `tsc --noEmit --incremental -p apps/api/tsconfig.json` (a full run did not fit one call at load 25 to 38; the first incremental run, a full check from nothing, ran in the background for 452 s and exited 0; the gate's run on the final tree) | exit 0, 0 errors | 155 s, load 17.74 |
| API lint | `eslint src/services`; `eslint src/routes src/jobs`; `eslint . --ignore-pattern` the three | exit 0 ×3 | 458 s (load 23.09), 261 s (load 25.71), 261 s (load 20.41) |
| API unit | 12 blob shards: shard 5 met the cap (`rc=124` at 570 s, its blob truncated at 2 MiB), so K doubled to 24 in a fresh directory (rule 8) | merge exit 0: **10,792 tests in 848 files, 94.17 % statements** | shards 115 to 412 s (load 11.18 to 41.90), merge 317 s (load 23.33) |
| integration graph | `--project graph` | exit 0: 13 tests | 95 s, load 21.03 |
| integration api 1/3 | `--project api --shard=1/3` | exit 0: 115 tests in 25 files | 130 s, load 20.69 |
| integration api 2/3 | `--shard=2/3` | exit 0: 133 tests in 25 files | 195 s, load 20.77 |
| integration api 3/3 | `--shard=3/3` | **first run exit 1**: 1 failed, 192 passed; re-run exit 0: 193 | 245 s (load 9.80), 167 s (load 24.58) |
| format | `pnpm format:check`, and `prettier --check --ignore-path=.gitignore` over this agent's files under `services/` | exit 0, exit 0 | 325 s, load 16.17 |

The one failure, in the first run of the third API integration shard:

```
 FAIL  |api| src/providers/business-registry/pacing.integration.test.ts > createProviderPacer over
   the GCRA script in Valkey > lets one request through per interval for a key, across two processes
AssertionError: expected 263.53355699999975 to be greater than or equal to 380
 ❯ src/providers/business-registry/pacing.integration.test.ts:58:41
```

That is KP11-13 (the pacing test failing under load, cause not established), integration-11b's known
item, not this agent's paths; it is reported, not fixed here and not counted as passed. The shard's
re-run (rule 24) passed 193 of 193.

The dashboard's suite is not run: this agent changed nothing under `apps/dashboard` (rule 24).
