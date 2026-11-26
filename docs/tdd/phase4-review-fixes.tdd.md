# TDD evidence: Workflow 4B review fixes, TypeScript (Phase 4, selfie checks and liveness)

- **Slice owner:** the TypeScript fixer of the Workflow 4B review, in parallel with the Python and Android fixers.
- **Date:** 2026-10-21.
- **Paths owned:**
  - `apps/` (api, dashboard, flow except `apps/flow/licenses`, demo-web), `packages/`, `e2e/`;
  - `contracts/fixtures/` except `contracts/fixtures/vision/`;
  - `android/openverify-sdk/src/test/kotlin/dev/openverify/sdk/model/ContractFixturesTest.kt` (K202 only);
  - `docs/plans/phase-4.plan.md`, `docs/api/openapi.json`, `docs/checks/`, `docs/calibration/`;
  - `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh`, `turbo.json` and this file.
- **Input:** the blocking finding H001 and the MEDIUM items K201, K202, K203, H002, H003 and H013 of the Workflow 4B review of `8350c31..HEAD`.

Each fix follows the same cycle:
1. A stub or a behaviour-preserving extraction (`chore` or `refactor`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The regression test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest … " stands for `pnpm exec vitest run <files> --coverage.enabled=false` in the package named. Output is trimmed to the lines that matter. Every layout, email address and value in these tests is synthetic.

## H001 (CRITICAL): a failed layout query reaches the worker log and Valkey with the layout

Drizzle wraps every failed query in a `DrizzleQueryError` whose message is `Failed query: <sql>\nparams: <params>`. A background-layout query (`findNearestSelfieBackgrounds`, `createSelfieBackground` in the decision transaction, `rewriteSelfieBackground` in `face-index:rebuild`) carries the 144 Lab values as a parameter. A transient failure (a statement timeout, a deadlock) was rethrown to BullMQ, which keeps `err.message` as `failedReason` and `err.stack` in Valkey for a week. The worker's `failed` listener logged it as `detail`, and the rebuild command printed it to stderr. Pino's redaction is by key, so a value inside a string passes.

The fix has three layers:
- **The repository** (`packages/db`): the three layout queries run through `withSensitiveParameters`. A failure becomes a `SensitiveQueryError`, whose message is `<operation> failed (SQLSTATE <code>)`, with no cause. `pgErrorCode` still reads its SQLSTATE.
- **The worker** (`apps/api/src/jobs/error-description.ts`): `describeJobError` describes any failure by its class and code. Only classes whose messages are built from codes, endpoints and statuses keep their message: `UnrecoverableError`, `PermanentJobError`, `VisionError`, `SensitiveQueryError` and the worker's own `DescribedJobError`. `withoutJobData` rethrows anything else as a `DescribedJobError`: the same name, the description, and the original stack frames only when the stack starts with `<name>: <message>`. Every processor (`process-verification`, `webhook-delivery` and the repeatable jobs) is wrapped, so BullMQ never sees a raw message. The `failed` listener logs `describeJobError(error)`. `describePermanent` became `describeJobError`, with the same words for every permanent failure.
- **The command:** `face-index:rebuild` prints a usage or configuration message whole (they name flags and variables) and anything else through `describeJobError`.

### Repository

Test: `packages/db/src/repositories/face-templates.test.ts`, "a failed layout query (Workflow 4B review H001)". A 143-value synthetic layout (37.123 in every cell) makes pgvector refuse each of the three queries (SQLSTATE 22000). The test walks every string the error holds: message, stack, own properties such as Drizzle's `params`, and causes. None may contain the value. The name, the message and `pgErrorCode` are also asserted. The search test stores one row first: on an environment with no rows, Postgres never measures a distance, and the short probe is not refused.

```text
RED   $ vitest (packages/db) src/repositories/face-templates.test.ts -t H001
 FAIL  … > findNearestSelfieBackgrounds: never in the error
AssertionError: expected [ …(4) ] to deeply equal []
+   "Error: Failed query: select \"selfie_backgrounds\".\"id\", …
+   "[37.123,37.123,37.123,…
 FAIL  … > writeFaceData (createSelfieBackground): never in the error
+   "Error: Failed query: insert into \"selfie_backgrounds\" (…) values ($1, …
+ params: sbg_…,env_…,ver_…,inq_…,ftpl_…,[37.123,37.123,37.123,…
 FAIL  … > rewriteSelfieBackground: never in the error
+   "Error: Failed query: update \"selfie_backgrounds\" set \"layout\" = $1, …
+ params: [37.123,37.123,37.123,…
      Tests  3 failed | 13 skipped (16)
GREEN $ vitest (packages/db) src/repositories/face-templates.test.ts src/repositories/selfie-captures.test.ts src/errors.test.ts
      Tests  40 passed (40)
```

With the GREEN commit, `src/errors.test.ts` covers the helper's branches: the value passed through, a server error rethrown with its SQLSTATE and no cause, and a failure without a SQLSTATE.

### Worker

Tests in `apps/api/src/worker.test.ts`, "startWorkers: a failed job carries no data". The failure is a real `DrizzleQueryError` whose parameters are a synthetic layout and a synthetic email address, with a `57014` server cause.
- **Processors.** The `process-verification`, `webhook-delivery` (its first read fails through a `Proxy` over the test database) and `inquiry-expiry` processors, as `startWorkers` registers them, each reject with an error whose message and stack hold neither value. The message is `DrizzleQueryError: the query failed (SQLSTATE 57014)`, and the error is not an `UnrecoverableError`, so BullMQ still retries.
- **Permanent failures** still reject with an `UnrecoverableError` through the same wrapper.
- **The log.** The real pino logger, writing to memory, logs the `failed` event with that description and neither value.

Changed existing test: in "logs failed jobs and worker errors with ids only", the first failure is now a `VisionUnavailableError`, whose message is kept. The second, `new Error('lost')`, now logs `detail: 'Error'` instead of `'lost'`, because the message of an error of unknown origin is left out.

```text
RED   $ vitest (apps/api) src/worker.test.ts
     × logs failed jobs and worker errors with ids only
-       "detail": "Error",
+       "detail": "lost",
     × the process-verification processor rethrows a failure to BullMQ (failedReason, stack trace) without its data
     × the webhook-delivery processor rethrows a failure to BullMQ (failedReason, stack trace) without its data
     × the inquiry-expiry processor rethrows a failure to BullMQ (failedReason, stack trace) without its data
     × logs a failed job with its class and SQLSTATE, never its message
AssertionError: expected true to be false // Object.is equality      (leaks(message + stack), leaks(log line))
      Tests  5 failed | 25 passed (30)
GREEN $ vitest (apps/api) src/worker.test.ts src/jobs/error-description.test.ts
      Tests  46 passed (46)
```

With the GREEN commit, `src/jobs/error-description.test.ts` covers every class `describeJobError` names. It also covers the frames kept, no frames when the stack does not start with the message (including a forged frame inside a parameter), and a thrown non-error. The GREEN commit also replaced the RED test's object spread of the database (lint `no-misused-spread`) with a `Proxy`.

### Command

A behaviour-preserving extraction (`refactor`) named the stderr line `describeFaceIndexRebuildFailure`, so the RED test type-checks.

```text
RED   $ vitest (apps/api) src/face-index-rebuild.test.ts
     × prints a failed query by its class and SQLSTATE, never its parameters
AssertionError: expected 'Failed query: update "selfie_backgrou…' not to contain '37.123'
      Tests  1 failed | 8 passed (9)
GREEN $ vitest (apps/api) src/face-index-rebuild.test.ts
      Tests  9 passed (9)
```

Not changed: the retention job's processor and the other operator commands. Their queries take ids, dates and settings, not biometric data, and the retention `failed` listener already logs the class only.

## K201 (MEDIUM): the inquiry expiry job leaves the objects of the capture files it deletes

Confirmed in the code. `runInquiryExpiry` expires through `transitionInquiryInTx`, which errors an open capture and deletes its file rows (`cancelInitiatedVerifications`) and returns their `storageKeys`. The expire action and the simulation delete those objects after commit. The job had no storage dependency, so it dropped them: each object stayed in the bucket, crypto-shredded, for ever.

The fix:
- `InquiryExpiryDeps.storage` is required.
- Each inquiry batch collects the `storageKeys` of the inquiries it expired. After the batch commits and its events are dispatched, `deleteObjects` deletes them, best effort.
- `deleteObjects` now returns how many it could not delete. A run with any logs one warning carrying a count only (`undeletedObjects`), never a key.
- The worker passes its storage.

The stub commit (`chore`) added an optional `storage` field that nothing read, so the RED tests type-check.

Tests:
- `apps/api/src/services/selfie-cancel-paths.test.ts`:
  - the expiry job test now also asserts the object is gone;
  - a `Proxy` over the database records each outer transaction's commit, and a recording storage records each delete. The capture file's delete comes after the first commit, never before;
  - a storage whose `delete` rejects: the inquiry still expires, and one `warn` carries `undeletedObjects` (at least 1) and no storage key.
- `apps/api/src/worker.test.ts`: the worker's default expiry run, on an overdue pending inquiry with an open capture and a centre file in the worker's storage, deletes the object.

Changed callers: `src/jobs/inquiry-expiry.test.ts`, `src/jobs/inquiry-expiry.integration.test.ts` and `src/services/selfie-capture-races.integration.test.ts` pass a storage.

```text
RED   $ vitest (apps/api) src/services/selfie-cancel-paths.test.ts
     × the inquiry expiry job: canceled with selfie.errored, its file rows and objects deleted (K201)
AssertionError: expected [ Array(1) ] to not include 'env_…/…'
     × the inquiry expiry job deletes the objects only after the batch committed (K201)
AssertionError: expected [ 'commit', 'commit' ] to include 'delete the capture file'
     × the inquiry expiry job counts the objects it could not delete and still expires (K201)
AssertionError: expected undefined to match object { level: 'warn', object: { …(1) } }
      Tests  3 failed | 4 passed (7)
RED   $ vitest (apps/api) src/worker.test.ts
     × deletes, with the worker's storage, the objects of the capture files an expiry deletes (K201)
AssertionError: expected Buffer[ 197, 117, 39, 210, 72, …(29) ] to be null
      Tests  1 failed | 30 passed (31)
GREEN $ vitest (apps/api) src/worker.test.ts src/services/selfie-cancel-paths.test.ts src/jobs/inquiry-expiry.test.ts
      Tests  44 passed (44)
GREEN $ pnpm exec vitest run --config vitest.integration.config.ts src/jobs/inquiry-expiry.integration.test.ts src/services/selfie-capture-races.integration.test.ts
      Tests  14 passed (14)
```

## K202 (MEDIUM): no golden 409 problems for the four selfie capture codes

Confirmed: `contracts/fixtures/problems/` held only the three `session_canceled` problems. Both clients branch on the C40 codes, but neither was tested against the bodies the API sends.

Four fixtures, `contracts/fixtures/problems/selfie-capture-{invalid,required,incomplete,limit}.json`. Each is the body the route really answered in the RED run, with a synthetic `instance` (the fixtures' selfie verification id) and `requestId`. Every RED test was written before any fixture existed.

- **`apps/api/src/routes/flow/selfie-golden-problems.test.ts`** (new) provokes each code on the real routes. It compares the answer to its fixture with `instance` and `requestId` set aside, and checks that both instances name the route (`files`, `submit`, `selfies`):
  - a pose uploaded with a wrong nonce;
  - a capture-bound selfie submitted without its capture;
  - a submit with only the centre pose, under a passive template so the missing poses are always `left, right`;
  - the 11th create.
- **`packages/contracts/src/fixtures.test.ts`.** `problems/` holds the three `session_canceled` problems and one problem per `SELFIE_CAPTURE_PROBLEM_CODES` entry. Each new file parses with `problemSchema`, encodes back unchanged, is `about:blank`/`Conflict`/409 with its code and no `reason`, and names a flow verification route. Changed existing test: the folder listing.
- **`apps/flow`:**
  - `src/testing/golden-problems.ts` documents both kinds;
  - `src/api/final-outcome.test.ts`: each `session_canceled` golden ends the flow on its screen, and each selfie golden is a 409 left to the step that made the call (`finalOutcomeOf` is `null`). Changed existing test: the outcome map gained the four files;
  - `src/selfie/capture-protocol.test.ts`: `captureFailure` reads each golden body as the flow branches on it. `invalid` and `incomplete` give `capture-invalid`, `limit` gives `capture-limit`, and `required` gives `conflict`.
- **`android/.../model/ContractFixturesTest.kt`**, in the same commit as the fixtures:
  - the listing test covers both kinds;
  - the `session_canceled` factory iterates its own map;
  - a new factory decodes each selfie problem (409, its code, no reason) and checks the SDK's branch on it through `SelfieCaptureProtocol.CAPTURE_REFUSED_CODES` and `CAPTURE_LIMIT_CODES`: restart the capture, start a new attempt, or an ordinary conflict.

```text
RED   $ vitest (apps/api) src/routes/flow/selfie-golden-problems.test.ts
     × selfie-capture-invalid.json: a pose uploaded with a wrong nonce   (and the three others)
AssertionError: expected { type: 'about:blank', …(6) } to deeply equal undefined
+ Received: { "code": "selfie_capture_invalid", "detail": "The selfie capture cannot be used; start a new capture.", "status": 409, "title": "Conflict", "type": "about:blank", … }
      Tests  4 failed (4)
RED   $ vitest (packages/contracts) src/fixtures.test.ts
     × problems/ holds one session_canceled problem per reason (C25.8) and one selfie capture problem per C40 code (K202)
AssertionError: expected [ …(3) ] to deeply equal [ …(7) ]
     × problems/selfie-capture-incomplete.json is the 409 Conflict with code selfie_capture_incomplete (K202)   (and three more)
Error: ENOENT: no such file or directory, open '…/contracts/fixtures/problems/selfie-capture-incomplete.json'
RED   $ vitest (apps/flow) src/api/final-outcome.test.ts src/selfie/capture-protocol.test.ts
       × covers every golden problem
AssertionError: expected [ …(3) ] to deeply equal [ …(7) ]
       × selfie-capture-*.json is left to the step that made the call   (4)
     × reads the golden selfie-capture-*.json as the API sends it as …   (4)
ZodError: [ …   (no golden body yet)
      Tests  9 failed | 43 passed (52)
# fixtures added, Kotlin listing not yet changed:
RED   $ cd android && ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'
FAILED every problems fixture has an expected reason() :: expected: <[problems/session-canceled-inquiry-expired.json, …]> but was: <[problems/self…
FAILED problems/selfie-capture-{incomplete,invalid,limit,required}.json :: expected: <401> but was: <409>
37 tests completed, 5 failed
GREEN $ vitest (apps/api) src/routes/flow/selfie-golden-problems.test.ts        Tests  4 passed (4)
GREEN $ vitest (packages/contracts) src/fixtures.test.ts                         Tests  90 passed (90)
GREEN $ vitest (apps/flow) src/api/final-outcome.test.ts src/selfie/capture-protocol.test.ts   Tests  52 passed (52)
GREEN $ cd android && ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'
37 tests, 0 failures, 0 errors (test-results XML)
```

## K203 (MEDIUM): Stage 1's `findReplayedFiles` is unused and has the wrong scope

Confirmed: `findReplayedFiles` (`packages/db/src/repositories/selfie-captures.ts`) joined `selfie_captures`, so it never saw a file without a capture. It also left out every file of the current inquiry, and nothing called it. The worker ran its own query in `apps/api/src/jobs/selfie.ts` (`replayedPosesOf`).

The fix keeps one lookup. The worker's query moved into the repository unchanged as `findReplayedDigests(db, environmentId, { sha256s, excludeCaptureId })`, which returns the distinct digests found, sorted. The worker calls it. `findReplayedFiles`, `ReplayedFile` and their test are deleted, and the `packages/checks` input comment names the new function. The worker's behaviour does not change: `process-selfie.test.ts` and `selfie-contract.test.ts` (60 tests, including the `capture_replayed` cases) pass unchanged.

The stub (`chore`) named `findReplayedDigests` as a query that matches nothing. Lint refused an unused-parameter stub, so the stub runs a real query with `false` in its condition.

Test, in `packages/db/src/repositories/selfie-captures.test.ts`: one environment, and the digests:
- found:
  - a file of an earlier attempt of the same inquiry (another selfie verification and its capture);
  - a file without a capture in the same inquiry;
  - a capture's file in another inquiry;
  - a file without a capture in another inquiry;
- not found:
  - this capture's own file;
  - a file whose object was deleted (`deleted_at`);
  - a file of a redacted inquiry;
  - a digest seen nowhere;
- an empty input answers `[]`.

```text
RED   $ vitest (packages/db) src/repositories/selfie-captures.test.ts -t K203
     × finds bytes stored anywhere in the environment outside this capture, but deleted or redacted ones
AssertionError: expected [] to deeply equal [ …(4) ]
-   "bbbb…", "cccc…", "dddd…", "eeee…"
+ []
      Tests  1 failed | 15 skipped (16)
GREEN $ vitest (packages/db) src/repositories/selfie-captures.test.ts      Tests  15 passed (15)
GREEN $ vitest (apps/api) src/jobs/process-selfie.test.ts src/jobs/selfie-contract.test.ts      Tests  60 passed (60)
```

(The first RED attempt failed on setup instead: one verification can hold only one `initiated` capture, `selfie_captures_one_initiated_per_verification_key`. The earlier attempt is therefore a second selfie verification of the same inquiry.)

## H002 (MEDIUM): the test named "bootstraps over identities" cannot fail on a pair resample

Confirmed: the only test of that property checks determinism and `0 <= low <= high <= 1`, which a pair-level resample satisfies too. The implementation (`counts[a] x counts[b]` per identity pair) is correct, so this is a test-only fix. Its RED run is against a mutant.

The new test in `packages/checks/src/calibration/selfie-report.test.ts` uses ten synthetic identities with two portraits each:
- every impostor pair of `p0001` scores 0.9 and every other pair 0, so 36 of the 180 impostor pairs belong to one identity (FAR 0.2 at each fixed threshold);
- an identity resample leaves `p0001` out of about 35% of replicates (FAR 0) and draws it three times in about 7% (FAR about 0.5);
- a pair resample stays near 0.2;
- the test asserts, for the three fixed rows below 0.9, `far.low === 0` and `far.high >= 2 x far.value`.

The mutant replaced the fixed rows' replicate FAR with a resample of the 180 impostor pairs. The file was copied to the scratchpad first and copied back afterwards; `git diff --quiet` confirmed it unchanged.

```text
GREEN $ vitest (packages/checks) src/calibration/selfie-report.test.ts          Tests  21 passed (21)
RED   (mutant: pair-level resample of the fixed rows' FAR)
     × bootstraps over identities, not pairs: one identity holding every high impostor widens the FAR interval (Workflow 4B review H002)
AssertionError: expected 0.14444444444444443 to be +0 // Object.is equality
      Tests  1 failed | 20 passed (21)
restored: no diff
GREEN $ vitest (packages/checks) src/calibration/selfie-report.test.ts          Tests  21 passed (21)
```

## H003 (MEDIUM): the docs and the report leave out what the default `min-passive-score` rejects of genuine photos

Confirmed:
- the C49 report gives the genuine portraits' passive-liveness mean p1 0.0057 and p5 0.2654;
- `selfie_liveness_detection` is a required fraud check in the default template (`contracts/fixtures/flows/default-gov-id-selfie.json`; registry type `F`), so `passive_liveness_low` fails the selfie with no retry (C30.1: retryable only when every failing required check is `user_behavior`);
- `docs/checks/selfie.md` said only that the webcam rate is unmeasured.

The fix states the rejection in three places:
- **The report generator** (`packages/checks/src/calibration/selfie-report.ts`, `passiveRejectionLine`) adds one paragraph under the genuine-portrait table. It gives the default, the reason and its lack of a retry, the p1 and p5, the bound, and the domain caveat. The bound comes only from the listed percentiles:
  - an interpolated percentile `q` below the default puts at least `floor(q (n - 1) / 100) + 1` values below it;
  - a p1 at or above it leaves at most `ceil((n - 1) / 100)`;
  - otherwise "all" or "none".
- **`docs/calibration/selfie-phase4.md`** carries that paragraph. Regenerating the report reads the calibration measurements, which this fixer must not read. So the paragraph was rendered by calling `passiveRejectionLine` on the report's own published row (n 1,743, min 0, p1 0.0057, p5 0.2654, median 0.9926, p95 0.9999, p99 1, max 1) through a scratch script, and pasted where the generator puts it. The next regeneration writes the same text.
- **`docs/checks/selfie.md`:**
  - "Known limits" gains "Passive liveness rejects some genuine photos": at least 88 of 1,743 (5.05%) below the 0.5 default, `passive_liveness_low` with no retry under the default template, and a studio-portrait proxy, not a webcam measurement;
  - the provisional-thresholds item points to it;
  - the liveness check's limits say the same in one sentence.

Not done: whether a first-attempt passive failure should keep a retry is a decision-rule change (C30.1, C39), not a local fix.

The first RED test claimed "at least q%". Working out the bound showed that an interpolated percentile does not always imply q% (with n = 3, a p95 below the default implies only 2 of 3). A second RED commit restated the test as the count bound, before any implementation.

```text
RED   $ vitest (packages/checks) src/calibration/selfie-report.test.ts
     × state what the default min-passive-score rejects of the genuine portraits (Workflow 4B review H003)
AssertionError: expected '# Face-match calibration (Phase 4, C4…' to contain '`selfie_liveness_detection` fails a c…'
      Tests  1 failed | 21 passed (22)          (both RED commits)
GREEN $ vitest (packages/checks) src/calibration/selfie-report.test.ts          Tests  22 passed (22)
$ (apps/api) pnpm exec tsx --conditions=@openverify/source <scratchpad>/passive-line.ts
`selfie_liveness_detection` fails a centre whose passive-liveness mean is below `min-passive-score` (default 0.5, provisional) with `passive_liveness_low`, a fraud reason that gives no retry. On these genuine portraits (n = 1,743) the p1 is 0.0057 and the p5 0.2654: at least 88 of them (5.05%) score below the default. Studio portraits are still and often retouched, so this is a false-positive proxy: the false-reject rate on genuine webcam selfies is unmeasured.
```

## H013 (MEDIUM): the web selfie never notices a camera track that ended or was muted

Confirmed: `useCameraStream` set `live` once and never watched the track, so a frozen `<video>` frame stayed usable by the guidance and the shutter.

The fix:
- **`useCameraStream`** listens for `ended` and `mute` on each video track. Either one, or a track already `ended` at grant, releases the stream and sets `failed` with `camera-in-use`. The step then shows its existing error ("Another app is using your camera…") and "Try again". The listeners are removed on cleanup.
- **The selfie step** runs the guidance only while the camera is `live`, and `takePhoto` refuses a frame otherwise. A hold that completes while the camera is stopped then takes nothing, and the guidance restarts once the camera is back.
- "Try again" restarts the camera, not the capture protocol: the same capture and prompt go on.
- Not done: `visibilitychange` handling. A hidden desktop tab keeps a live camera, and a backgrounded phone mutes or ends the track, which is now handled.

The stub (`chore`) gave the fake camera's track an `EventTarget`, `readyState` and `muted`, and `endTrack()` and `muteTrack()`. Each grant hands out a live track.

Tests, in `apps/flow/src/steps/selfie-capture-step.test.tsx`:
- for `ended` and for `mute` mid-capture:
  - the alert names `camera-in-use`, and the shutter and preview are gone;
  - the track is stopped, and no frame is taken;
  - after "Try again" the centre is shot and uploaded on the same capture, with the camera requested twice;
- with the guidance holding a frontal face: the track ends, the hold time passes, and nothing is taken. After "Try again" the guidance auto-captures the centre.
- With the GREEN commit: a track already over at grant reads as a stopped camera, and nothing is created.

```text
RED   $ vitest (apps/flow) src/steps/selfie-capture-step.test.tsx -t H013
     × when the video track ends, says so, never takes the frozen frame, and goes on after Try again
     × when the video track is muted, says so, never takes the frozen frame, and goes on after Try again
     × lets the guidance take no photo while the camera is stopped, and auto-captures once it is back
TestingLibraryElementError: Unable to find role="alert"
      Tests  3 failed | 30 skipped (33)
GREEN $ vitest (apps/flow) src/steps/selfie-capture-step.test.tsx               Tests  34 passed (34)
```

## Final gates

All gates ran after the last fix, with the other fixers' commits in the tree.

```text
$ pnpm typecheck                     Tasks: 12 successful, 12 total            exit 0
$ pnpm lint                          Tasks: 12 successful, 12 total            exit 0
$ pnpm test                          Tasks: 12 successful, 12 total            exit 0
    @openverify/api        Tests 2479 passed (2479)   coverage 97.63 / 90.63 / 98.62 / 97.66
    @openverify/db         Tests  684 passed (684)    coverage 98.82 / 91.83 / 99.3 / 98.76
    @openverify/checks     Tests 1330 passed (1330)   coverage 98.97 / 89.69 / 99.66 / 98.9
    @openverify/contracts  Tests 1409 passed (1409)   coverage 100 / 100 / 100 / 100
    @openverify/flow       Tests  728 passed (728)    coverage 96.71 / 91.46 / 96.66 / 96.77
    @openverify/dashboard  Tests 1805 passed (1805)   (core 569, node 212, flow-spec 88, ui 54, config 45 passed)
$ pnpm format:check                  All matched files use Prettier code style! exit 0
$ pnpm test:integration              api 62 passed (14 files), db 46 passed (8 files)   exit 0
$ pnpm --filter @openverify/api openapi:write    11 passed; docs/api/openapi.json unchanged (no route or schema changed)
$ cd android && ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --rerun --tests 'dev.openverify.sdk.model.ContractFixturesTest'
    BUILD SUCCESSFUL; 37 tests, 0 failures, 0 errors
$ flock /tmp/openverify-e2e.lock pnpm e2e
    @openverify/flow:e2e  38 passed (11.0s)
    @openverify/e2e:e2e   50 passed (6.5m)
    Tasks: 9 successful, 9 total   Time: 6m44.342s   exit 0
```

The e2e ran in the background (it can pass the 10-minute foreground limit while it waits for the lock, and a killed run would skip its teardown), and a watcher waited for its exit line.

## Orchestrator: a dashboard route test depended on verification order

GitHub CI run 39744166468 (push `8dfdd2b`, which changed only `android/`, CI files and docs) failed `unit-api` on one test:

```
FAIL  src/routes/dashboard/index.test.ts > GET /api/v1/dashboard/inquiries/:id > serves the extraction attributes of its government ID, masked without pii:view (C31.6)
AssertionError: expected { type: 'verification/selfie', …(3) } to match object { attributes: { …(2) } }
Tests  1 failed | 2478 passed (2479)
```

Cause: the test read `included[0]` as the government ID. The inquiry's verifications are ordered by `created_at`, then `id` (`packages/db/src/repositories/verifications.ts:186`); the test seeds the government ID and the selfie back to back, so both can share a millisecond, and the id tiebreak is random within it. The API's order is correct (deterministic for a given pair of rows); the test's assumption was not. The same test passed on the previous run (39721214030, `4be9b6b`).

Fix (test only): the test finds the included resource of type `verification/government-id`, so its assertions no longer depend on the order. No other API test indexes `included` of a live answer (`api-logs.test.ts` reads a fixed fixture).

```
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/index.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  38 passed (38)
```
