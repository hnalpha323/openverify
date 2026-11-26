# TDD evidence: Workflow 5C review fixes, TypeScript (Phase 5, other verifications)

- **Slice owner:** the TypeScript fixer of the Workflow 5C review (`fix-ts`), in parallel with the Python and Kotlin fixer (`fix-other`).
- **Date:** 2026-10-24.
- **Paths owned:**
  - `apps/` (api, dashboard, flow, demo-web), `packages/`, `e2e/`;
  - `contracts/fixtures/` except `contracts/fixtures/vision/`;
  - `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/model/ContractFixturesTest.kt` (only when a changed fixture needs it);
  - `docs/plans/phase-5.plan.md`, `docs/api/openapi.json`, `docs/checks/`;
  - `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh`, `turbo.json` and this file.
- **Input:** the blocking findings P001, P006, P007, P020 and P021, then the MEDIUM items in their order (K1–K9, K13, P008, P023, P025, P002, P004, P005, P024) of the Workflow 5C review of `7e80351..HEAD`.

Each fix follows the same cycle:
1. A stub (`chore`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The regression test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest … " stands for `pnpm exec vitest run <files> --coverage.enabled=false` in the package named. Output is trimmed to the lines that matter. Every chip, certificate, document, email address and value in these tests is synthetic.

## P006 (HIGH): `parseVizDate` threw `RangeError` for a day past 31

`calendarDate` (`packages/checks/src/viz.ts`) refused only a day below 1. A day of 32 or more built an invalid `Date`, and `toISOString()` threw `RangeError: Invalid time value`. Phase 5 calls `parseVizDate` on arbitrary document text: every labelled date (`document/dates.ts`) and the first two words of every line (`startsWithDate` in `document/layout.ts`, for the transaction-table feature). One OCR misread (`80 September 2026`) or a table row such as `2 40 Hours` therefore threw out of `evaluateDocument`. The document job does not catch it, the error is not permanent, and it is deterministic, so all five attempts threw. The verification then failed with no check rows, and the inquiry failed with no hint and no review.

Tests:
- `packages/checks/src/viz.test.ts`: eight texts with a day past 31, in both orders, read as `null`;
- `packages/checks/src/document/evaluate.test.ts`: a bill whose statement day reads 80, a bill with the table rows `2 40 Hours` and `5 50 Litres`, and a photo whose period ends on day 45. Each is read by `evaluateDocument` with every document check enabled, without throwing.

```text
RED   $ vitest (packages/checks) src/viz.test.ts src/document/evaluate.test.ts
     × reads "45 SEP 2026" (DMY), a day past 31, as no date
     × reads "SEP 45 2026" (MDY), a day past 31, as no date
     × reads "41/10/2026" (DMY), a day past 31, as no date
     × reads "10/41/2026" (MDY), a day past 31, as no date
     × reads "2 40 2000" (DMY), a day past 31, as no date
     × reads "2026-10-41" (DMY), a day past 31, as no date
     × reads a labelled date whose day OCR misread as 80 without throwing
     × reads a table row opening with two numbers without throwing
     × reads a photo whose period ends on day 45 without throwing
RangeError: Invalid time value
      Tests  9 failed | 118 passed (127)
GREEN $ vitest (packages/checks) src/viz.test.ts src/document/
 Test Files  14 passed (14)
      Tests  522 passed (522)
```

`99999999` and `4099 2026` already read as `null`, because their year falls outside 1900–2100 before the day is read. They stay as pins.

Fix: `calendarDate` refuses a day above 31 before it builds the date. A day of 29 to 31 past the month's end still rolls over and is refused by the existing `startsWith` comparison.

Not done: the finding also suggests catching any evaluator exception in `documentJob.evaluate` and answering `execution_error`. The finding's own fuzz found no other source of an exception (6,000 date-heavy cases with `parseVizDate` wrapped threw nothing else). `evaluateDocument` also throws `InvalidCheckConfigError` on purpose, so a blanket catch would hide a configuration error as a review. The fix stays local.

## P001, P007 (MEDIUM, blocking): revocation was judged on every CRL of the CSCA's country

`checkRevocation` (`packages/emrtd/src/passive-authentication.ts`) kept every current CRL whose `issuerCountry` was the chosen anchor's country. Serial numbers are unique only per issuer (RFC 5280 §4.1.2.2). For a country with two CSCAs under different names, this caused two errors:
- a genuine DSC whose serial another CSCA's CRL listed read `revoked`, and the chip failed `dsc_revoked`;
- another CSCA's current CRL made a DSC whose own CSCA had no CRL read `unrevoked`. Under the default `strict` policy that passed where `crl_unavailable` (review) is due.

The fix scopes CRLs by the CSCA's **name**, not its key id. The verifier noted that a key-id scope would send every DSC of a rolled-over key to review once the new key signs the CRL. The name is the chosen anchor's subject DN, else the DSC's issuer DN when no anchor was chosen. This matches the sync's own signer check (`crl.issuerDnKey` against the signer's issuer, `apps/api/src/trust-anchors/sync.ts`).

Tests (`packages/emrtd/src/passive-authentication.test.ts`, "with two CSCAs of one country under different names"): CSCA `CSCA Utopia` issues the DSC; CSCA `CSCA Utopia 2` is the other one. The cases:
- the other CSCA's CRL lists the DSC's serial and the DSC's own CRL is current: `unrevoked`;
- only the other CSCA's CRL is current, empty or listing the serial: `undetermined` / `no_distribution_point`;
- the DSC's own CRL lists it: `revoked`;
- a rollover under one name, where the new key's CRL covers an old key's DSC: `unrevoked`, and `revoked` when that CRL lists it. This case already held, and stays as a pin against a key-id scope.

```text
RED   $ vitest (packages/emrtd) src/passive-authentication.test.ts
       × does not revoke the DSC for a serial the other CSCA revoked
-   "revocation": "unrevoked",
+   "revocation": "revoked",
       × leaves revocation undetermined when only the other CSCA's CRL is current
-   "revocation": "undetermined",
+   "revocation": "unrevoked",
-   "revocationGap": "no_distribution_point",
+   "revocationGap": null,
      Tests  2 failed | 46 passed (48)
GREEN $ vitest (packages/emrtd)
 Test Files  18 passed (18)
      Tests  311 passed (311)
      $ vitest (apps/api) src/jobs/types/government-id-nfc src/jobs/phase5b-golden-fixtures.test.ts src/emrtd-contract.test.ts
 Test Files  4 passed (4)
      Tests  34 passed (34)
```

The plan's emrtd Stage 2 amendment 6 ("CRLs match by the anchor's country") is amended in the Workflow 5C review amendments. `docs/checks/nfc.md` says the same.

## P020 (HIGH): the flow served libphonenumber's metadata without its Apache-2.0 licence

The flow's phone and country steps import `libphonenumber-js`, whose bundled metadata derives from Google's libphonenumber (Apache-2.0). The built chunk inlines that metadata, but `dist/licenses` held only onnxruntime-web's two files. `THIRD_PARTY_LICENSES.md` §2.1.7 already says the bundle must serve `LICENSE.Apache`.

Fix: `LIBPHONENUMBER_NOTICES` (`apps/flow/src/guidance/guidance-assets.ts`) lists `licenses/libphonenumber-js/LICENSE` and `LICENSE.Apache`, each pinned by SHA-256. The guidance-assets plugin copies them from the **installed package**, which ships both files and exports its `package.json`. They are not vendored copies, so a version whose licence text changes stops the build. The development server serves them too.

Tests:
- `apps/flow/src/vite-plugins/guidance-assets-plugin.test.ts`: the two notices come from the installed package, match their pins and are plain text, and the Apache file is the Apache License 2.0. The listing test includes them.
- `apps/flow/e2e/phone-otp.spec.ts` (mocked flow suite, against the production build that `vite preview` serves): both files answer with their text.

```text
stub  63222099 chore(flow): LIBPHONENUMBER_NOTICES, empty
RED   $ vitest (apps/flow) src/vite-plugins/guidance-assets-plugin.test.ts
     × serves libphonenumber-js’s MIT licence and its metadata’s Apache-2.0 licence, as installed
AssertionError: expected [] to deeply equal [ …(2) ]
      Tests  1 failed | 13 passed (14)
      $ flock /tmp/openverify-e2e.lock pnpm exec playwright test --config e2e/playwright.config.ts phone-otp -g "licence"   (apps/flow)
    > 279 |   expect(await licence.text()).toContain('MIT License');
  1 failed   (vite preview answered the SPA's index.html for the missing file)
GREEN $ vitest (apps/flow) src/vite-plugins/ src/guidance
      Tests  81 passed (81)
      $ … playwright test … phone-otp selfie-capture -g "licen"
  ✓  [chromium] › e2e/phone-otp.spec.ts:272:1 › serves libphonenumber-js’s licence and its metadata’s Apache-2.0 licence with the flow
  ✓  [chromium] › e2e/selfie-capture.spec.ts:252:1 › serves ONNX Runtime’s licence and third-party notices with the flow (C48)
  2 passed (3.0s)
```

No other web bundle imports libphonenumber-js: the dashboard does not.

## P021 (HIGH): the whole full-stack suite went over the API's login limits

The API allows 10 sign-in attempts per email and 50 per address, in fixed 15-minute windows (`apps/api/src/operator-auth/login-rate-limiter.ts`). Every attempt counts, and a success resets only the email window. Every spec signs in from 127.0.0.1. Most UI specs signed in per test (`signInAs`), and many API specs signed in per test as well (`signInToApi`). The dashboard-documents run recorded 58 `POST /dashboard/sessions` in 12.8 minutes and 8 tests refused with 429, so the documented `pnpm e2e` gate was red unless sharded.

Fix (test infrastructure only; no product limit changes):
- `e2e/src/session-keeper.ts`: `createSessionKeeper` keeps one session per seeded role for the run. It reuses a kept session while `GET /me` accepts it. When a spec switched the session into another environment, the keeper moves it back to the environment its sign-in opened. It signs in again only when the API refuses the kept session (signed out, expired). Two calls at once share one attempt, and a failed attempt is not kept.
- `e2e/tests/support/ui.ts`: `signInAs` signs in through the dashboard the first time in the run, then sets the kept session cookie and opens `/`, where a sign-in lands. `sessionTokenAs(stack, role)` gives the same session's `ovu_` token to API callers. `createOperator` uses it for the inviting admin.
- The specs that signed a seeded operator in through the API only to act as it now take `sessionTokenAs`: `operators`, `document-poa`, `redaction-retention`, `ui-client-address`, `ui-selfie`, `ui-operators` and `ui-people`. Sign-ins that are themselves under test still sign in every time: the TOTP admin, the invited operators, `ui-mfa` and the invitee of `ui-operators`.

The keeper lives in the worker process. With `workers: 1`, Playwright keeps that process across files until a test fails.

Tests (`e2e/src/session-keeper.test.ts`):
- one sign-in per role over 61 calls;
- a new sign-in after the API refused the kept session;
- a session moved back from production to its environment, with no new sign-in;
- two calls at once sharing one sign-in;
- a failed sign-in not kept.

```text
stub  5d72569e chore(e2e): createSessionKeeper, which still signs in on every call
RED   $ vitest (e2e) src/session-keeper.test.ts
     × signs each role in once, however often its session is asked for
     × signs in again once the API no longer accepts the kept session (signed out, expired)
     × moves a session a spec switched back into the environment its sign-in opened
     × signs a role in once when its session is asked for twice at the same time
AssertionError: expected { token: 'ovu_reviewer_2', …(1) } to deeply equal { token: 'ovu_reviewer_1', …(1) }
      Tests  4 failed | 1 passed (5)
GREEN $ vitest (e2e)
 Test Files  12 passed (12)
      Tests  90 passed (90)
      $ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test tests/ui-operators.spec.ts tests/ui-integrations.spec.ts tests/operators.spec.ts tests/ui-navigation.spec.ts
  11 passed (1.7m)
      $ grep -o '"method":"POST","url":"/api/v1/dashboard/sessions[^"]*"' e2e/.artifacts/logs/api.log | sort | uniq -c
      8 "method":"POST","url":"/api/v1/dashboard/sessions"
      3 "method":"POST","url":"/api/v1/dashboard/sessions/mfa"
```

These four files used to make 15 password sign-ins; now they make 8. The gate is the whole suite, run unsharded under the e2e lock (see "Final gates").

## K1 (MEDIUM): a verification whose post-commit enqueue failed waited in `submitted` for ever

`afterDecision` (`apps/api/src/jobs/process-verification.ts`) enqueues the verifications a decision hook created (the silent AAMVA attempt, C59.6) once the decision has committed. A failed enqueue was only logged, and nothing enqueued that id again, so the attempt stayed `submitted` and its inquiry never settled.

Fix: a repeatable job, `submitted-verification-sweep` (`apps/api/src/jobs/repeatable/submitted-verifications.ts`), runs every minute while the worker has its verification queue. It enqueues every verification submitted more than two minutes ago and still `submitted`, through `enqueueProcessVerification`. That call's BullMQ job id is the verification id, so a job that is still waiting, delayed or running is not added twice. A failed enqueue is logged with ids and the error class, and is tried again on the next run.
- The read is `listSubmittedVerificationsBefore` (`packages/db`): every environment, newest first, at most 500 a run, so a backlog of old rows cannot starve new ones.
- It runs over the new partial index `verifications_submitted_at_idx` (`submitted_at WHERE status = 'submitted'`) of migration `0019_submitted_verifications_index`. That migration is generated by drizzle-kit, holds only the index, and passes `drizzle-kit check`.
- The registry (`jobs/repeatable/index.ts`) schedules the sweep first when `verificationQueue` is given, and `startWorkers` passes it.

Tests:
- `packages/db/src/repositories/verifications.test.ts`: only still-`submitted` verifications submitted before the cutoff, in every environment, newest first, within `limit`;
- `packages/db/src/migrate.test.ts`: 0019 holds exactly that one `CREATE INDEX`;
- `apps/api/src/jobs/repeatable/submitted-verifications.test.ts`: the schedule and the grace; only the stale verification is enqueued (not a fresh one, not an initiated one, none of the four decided statuses); a failed enqueue is logged with ids and no message, the run goes on, and the next run enqueues it; through `createVerificationQueue` over a queue that ignores a known job id, two runs add one job;
- `apps/api/src/jobs/repeatable/index.test.ts` and `apps/api/src/worker.test.ts`: the sweep is scheduled every minute, one at a time, only with the queue;
- `apps/api/src/jobs/silent-aamva.test.ts`: the K1 path end to end. A US licence passes while Valkey is unreachable, so the created AAMVA attempt stays `submitted` and the inquiry `pending`. The sweep, three minutes later, enqueues it once, the job judges it, and the inquiry completes.

```text
stub  46789850, 24c4864b chore(api): listSubmittedVerificationsBefore (selects nothing), submittedVerificationSweepJob (does nothing), RepeatableJobDeps.verificationQueue
RED   $ vitest (packages/db) src/repositories/verifications.test.ts src/migrate.test.ts
     × adds only the partial index of submitted verifications in 0019 (Workflow 5C review K1)
     × lists still-submitted verifications of every environment submitted before the cutoff, newest first
     × takes at most `limit`, the newest
      Tests  3 failed | 29 passed (32)
      $ vitest (apps/api) src/jobs/repeatable/ src/worker.test.ts src/jobs/silent-aamva.test.ts
     × sweeps verifications left submitted every minute when the worker has a verification queue (Workflow 5C review K1)
     × enqueues a verification left submitted past the grace, and no other
     × keeps going past a failed enqueue, logs it with ids only, and enqueues it on the next run
     × adds one job however often it runs: the job id is the verification id
     × schedules the repair sweep of submitted verifications with the verification queue (Workflow 5C review K1)
     × a created attempt whose enqueue failed is enqueued by the repair sweep, and the inquiry completes (Workflow 5C review K1)
      Tests  6 failed | 71 passed (77)
GREEN $ pnpm --filter @openverify/db exec drizzle-kit generate --name submitted_verifications_index
[✓] Your SQL migration file ➜ drizzle/0019_submitted_verifications_index.sql
      $ pnpm --filter @openverify/db db:check
Everything's fine
      $ vitest (packages/db)
 Test Files  66 passed (66)
      Tests  847 passed (847)
      $ vitest (apps/api) src/jobs/repeatable/ src/worker.test.ts src/jobs/silent-aamva.test.ts
      Tests  77 passed (77)
```

Corrected in GREEN: the RED case "keeps going past a failed enqueue" armed `failNext` on the shared recording queue. Newest first, the first enqueue of the run belonged to another test's row of the same database, so the refusal never reached this test's rows (`expected 2 to be 1`). It now refuses the first enqueue of its own `first` verification. The intent is unchanged, and the corrected case fails against the stub too.

## K2 (MEDIUM): the sync followed no redirect of a CRL download

The German CSCA's CRL distribution point redirects. `fetchBytes` (`apps/api/src/trust-anchors/sync.ts`) treated every 3xx as a failure, so every German chip's revocation stayed undetermined (`crl_unavailable`, review under `strict`).

Owner decision 3 after Workflow 5B is built for CRL downloads only:
- the outbound client still follows nothing, but a 3xx answer now carries its `location` (`OutboundHttpResponse.headers`; no other header of a 3xx, never a cookie);
- `fetchCrlBytes` follows one redirect when the location, resolved against the distribution point, is an https URL without credentials;
- the hop is a request of the same CRL client, so the vetted lookup with its private-network refusal, the 5 MiB cap and the 15 s deadline apply again;
- a second redirect, a plain-http or credentialed target, or a location that is no URL is refused (logged as `redirect refused`, or the second answer's status), and the CRL is skipped as a failed download is;
- the CRL behind the hop must still verify under its anchor, be current and keep its number;
- master lists and root certificates keep `fetchBytes`, which follows no redirect.

Tests (`apps/api/src/trust-anchors/sync.test.ts`, "a CRL download that redirects"; `apps/api/src/http/index.test.ts`):
- one https redirect is followed, through a request with the CRL client's own options, and the CRL is stored;
- a second redirect, a plain-http target, a credentialed target, a location that is no URL, and a relative location under the http distribution point (which resolves to http) are all refused, storing no CRL;
- a CRL behind the redirect that another key signed is not kept;
- a master list or a root certificate that redirects still fails the source (`fetch_failed`), and the target is never asked.

The client's 302 test now expects the `location`, and shows a `set-cookie` is not kept. That existing test changed because the fix changed what a 3xx answer carries.

```text
stub  cb5b9100 chore(api): OutboundHttpResponse.headers (location), not filled
RED   $ vitest (apps/api) src/trust-anchors/sync.test.ts src/http/index.test.ts
     × returns a 302 without following it, its body discarded and its location kept (K2)
       × follows one redirect to https and stores the CRL verified under its anchor
AssertionError: expected { sourceId: 'bsi-de', …(6) } to match object { outcome: 'accepted', crlsUpdated: 1 }
      Tests  2 failed | 45 passed (47)
GREEN $ vitest (apps/api) src/trust-anchors/ src/http/
      Tests  61 passed (61)
```

The refusal cases passed before the fix (nothing followed a redirect then). They stay as pins of the new rule's limits.

## K3 (MEDIUM): a 2xx answer without a Content-Type was refused

The Netherlands and Swiss master lists are served without a `Content-Type`. The outbound client refused that as `content_type`, so those sources could never sync.

Owner decision 4: `OutboundHttpClientOptions.acceptMissingContentType` (default false). With it set, a 2xx answer without the header is taken, with `contentType: null`. A present type outside `contentTypes` is still refused, and the size cap still applies. The trust-store sync's three clients (root certificate, list, CRL) set it, since each payload is checked against its pin or signature before use.

Tests:
- `apps/api/src/http/index.test.ts`, "a 2xx answer without a Content-Type": refused by default; taken by a client that opts in; for that client a wrong type and the cap are still refused; and a source scan shows that only `http/index.ts` and `trust-anchors/sync.ts` name the option.
- `apps/api/src/trust-anchors/sync.test.ts`: every request of the sync goes through a client with the option set.

```text
stub  fe4b5a5d chore(api): acceptMissingContentType, not read
RED   $ vitest (apps/api) src/trust-anchors/sync.test.ts src/http/
       × is taken by a client that opts in, its content type null
       × still refuses a wrong Content-Type, and the cap, for a client that opts in
       × is opted into by the trust-store sync alone
     × accepts a list verified against the pinned root: CSCAs, verified links and national CRLs
AssertionError: expected undefined to be true
      Tests  4 failed | 47 passed (51)
GREEN $ vitest (apps/api) src/trust-anchors/ src/http/
      Tests  65 passed (65)
```

## K4 (MEDIUM): the KYB pacing ran on cache slots, not the worker's GCRA limiter

`createProviderPacer` (`apps/api/src/providers/business-registry/pacing.ts`) paced GLEIF, Companies House, EDGAR and each RDAP host through slot lists in Valkey, because the provider bindings did not receive the worker's `RateLimiter`.

Fix:
- `ProviderBindingOptions`, the KYB and domain-age factory options and `ProviderPacerOptions` gain `rateLimiter`. The worker's `main()` builds one GCRA limiter and hands it both to the bindings and to the jobs.
- `RateLimitRule.name` widens to `ProviderPacingLimitName` (`pacing:<rule>`).
- With a limiter, each turn is `consume(key, { name: 'pacing:<rule>', limit: 1, windowSeconds: interval / 1000 })`. That is the atomic GCRA script on Valkey's clock, one request per interval with no burst, as the slots meant.
- A refusal waits for the `resetAt` it names, within the 10 s wait; beyond that it is the existing retryable `rate_limited`.
- A limiter that rejects (Valkey down) falls back to this process's own pacing. The cache slots remain only where no limiter is bound (unit tests, or the API process, which runs no KYB provider).

Tests:
- `pacing.test.ts`, "createProviderPacer over the GCRA limiter": the rule and key asked, and no cache key written; Companies House at 0.5 s and EDGAR at 0.1 s; a refusal waits 400 ms, then asks again; a turn beyond the wait is `rate_limited`, retryable; a limiter that is down falls back to local pacing (a pin).
- `business-registry/index.test.ts`, `domain-age/index.test.ts` and `providers/index.test.ts`: GLEIF and RDAP pace through a bound limiter (`pacing:gleif`, `pacing:rdap`) and write no slot key.
- `pacing.integration.test.ts` (real Valkey, written after the code as a pin): two processes share one 200 ms turn per key, and keys stay apart. Only lower bounds on the time taken are asserted.

```text
stub  15baa7c7 chore(api): rateLimiter options and ProviderPacingLimitName, not read
RED   $ vitest (apps/api) src/providers/index.test.ts src/providers/business-registry/ src/providers/domain-age/
     × paces each RDAP host through the GCRA limiter when one is bound (Workflow 5C review K4)
     × asks the GCRA script for one request per interval under the rule’s pacing name, using no cache slot
     × keeps each register’s interval: Companies House 500 ms, EDGAR 100 ms
     × waits for the turn the limiter names when it refuses, then asks again
     × fails rate_limited, retryably, when the turn is further than the wait allows
     × paces the registers through the GCRA limiter when one is bound, not the cache slots (Workflow 5C review K4)
     × hands the GCRA limiter to the registers and RDAP, which pace through it (Workflow 5C review K4)
      Tests  7 failed | 128 passed (135)
GREEN $ vitest (apps/api) src/providers/ src/worker.test.ts src/rate-limit
      Tests  417 passed (417)
      $ vitest --config vitest.integration.config.ts src/providers/business-registry/pacing.integration.test.ts   (apps/api)
      Tests  2 passed (2)
```

## K5 (MEDIUM): the RDAP bootstrap was kept a fixed day

`OutboundHttpResponse` carried no header, so `createRdapDomainAgeProvider` kept IANA's `dns.json` for a fixed 24 hours.

Fix:
- **The client.** A 2xx answer now carries `headers` with `expires` and `cache-control` when sent. A repeated header is dropped, and no other header is kept, a cookie or an `etag` included. `MockOutbound` (the KYB test support) mirrors this. `requestJson` passes the headers on with a JSON answer.
- **The bootstrap.** `bootstrapTtlSeconds` reads `max-age` first (RFC 9111 §4.2.1), else `Expires` from now. It holds the lifetime within C61.4's 1 hour to 7 days, and falls back to a day when neither is present or parses.
- **Valkey and memory.** The Valkey entry lives that long. A bootstrap fetched by this worker is kept in memory for the same lifetime. One read back from Valkey is kept in memory for an hour, the shortest lifetime, so no worker outlives a short lifetime that another worker set.

Tests (`domain-age/rdap.test.ts`, "the bootstrap’s lifetime"): measured in quarter hours through a second worker sharing the cache:
- Expires in two days is kept two days;
- `max-age` of 30 hours wins over an Expires five days out;
- Expires in a month is kept 7 days;
- Expires in ten minutes, or already past, is kept an hour;
- a malformed Expires, or neither header, is kept a day;
- one worker refetches once its own lifetime has passed.

The client tests (`http/index.test.ts`) keep a 2xx answer's two headers but no cookie or `etag`, and give an answer without them no `headers` member.

```text
stub  b4884e5d chore(api): the expires and cache-control header names, and JsonAnswer.headers
RED   $ vitest (apps/api) src/providers/domain-age/ src/http/ src/providers/business-registry/
     × keeps a 2xx answer’s expires and cache-control, and no other header (K5)
       × Expires in two days
       × max-age of 30 hours, before Expires
       × Expires in a month, kept 7 days
       × Expires in ten minutes, kept an hour
       × Expires already past, kept an hour
       × refetches in the same worker once the lifetime has passed
AssertionError: expected 86400000 to be greater than or equal to 172800000
      Tests  7 failed | 129 passed (136)
GREEN $ vitest (apps/api) src/providers/ src/http/ src/trust-anchors
      Tests  441 passed (441)
```

Before the RED commit, the lifetime test was corrected twice:
- it counted a refetch exactly at the lifetime as "not past", although the cache treats an entry as expired at its TTL;
- it closed the last mock agent twice (`ClientDestroyedError`).

## K6 (MEDIUM): Companies House officers and PSCs were fetched on every lookup

`createCompaniesHouseRegister` read `/officers` and `/persons-with-significant-control` for every company it found, even for a step that collects no associated persons. That pulled names and birth months into memory for nothing.

Owner decision 7 after Workflow 5B:
- `BusinessRegistryRequest.withPersons`. Companies House reads its officers and PSCs only when it is `true`. Otherwise the record carries no `persons`, while `personsAvailable` still says the register publishes them.
- The KYB job sets `withPersons: true` only when the step collects associated persons and `database_business_associated_persons_comparison` is enabled. Otherwise the member is left out, so a request without persons is exactly what it was.
- The evaluator already answers `not_requested` for a step that does not collect persons, before it reads any.

Tests:
- `companies-house.test.ts`: a lookup without `withPersons`, or with `false`, asks for `/company/<number>` only, and its record carries no persons. The four existing cases that read persons now ask with `withPersons: true`, since the fix changed what a plain lookup reads.
- `jobs/types/database-business.test.ts`: the register is asked for persons for a collecting step with the check on, and not for a collecting step with the check off or for a step that does not collect them. The collecting case's persons check still passes.

```text
stub  cf12d71b chore(api): BusinessRegistryRequest.withPersons, not read
RED   $ vitest (apps/api) src/providers/business-registry/companies-house.test.ts src/jobs/types/database-business.test.ts
     × asks for no officer or PSC when the lookup does not ask for persons (Workflow 5C review K6)
MockNotMatchedError: Mock dispatch not matched for path '/company/01234567/officers?items_per_page=100'
     × asks a register for persons only when the step collects them and their check runs
AssertionError: expected [ undefined, undefined, undefined ] to deeply equal [ true, undefined, undefined ]
      Tests  2 failed | 27 passed (29)
GREEN $ vitest (apps/api) src/providers/business-registry/ src/jobs/types/database-business.test.ts src/jobs/types/kyb-valkey-scan.test.ts src/jobs/business-contract.test.ts src/jobs/phase5b-golden-fixtures.test.ts
      Tests  116 passed (116)
```

Corrected in GREEN: the RED case's second lookup needed its own reply (`.times(2)`); one interceptor serves one request.

`docs/checks/business.md` and `nfc.md` follow K2–K6 and P001. For K2: one redirect to https, and the known limit for German CRLs gone unless the redirect is to plain http. For K3: lists without a content type. For K4: GCRA pacing and its Valkey key. For K5: the bootstrap lifetime. For K6: persons read only when collected.

After K13, the console's trust-store words test (`apps/dashboard/src/components/trust-store/trust-store-words.test.ts`) reads every snake_case literal of `sync.ts` as a reason a sync row may record. It failed on `redirect_refused`, which no row records: it is only the message of a skipped CRL download. The message became the words `redirect refused` (`95a2406b`), and the test passes unchanged.

## K7 (MEDIUM): `chip-races.integration.test.ts` failed once as a whole file

The report said: "a first `pnpm test:integration` run failed `chip-races.integration.test.ts` as a whole file, with nothing else failing; it passed alone and in the full rerun" (`docs/tdd/phase5-api-kyb.tdd.md`).

Investigation, with no code changed:
- **The file's timing windows are one-sided.** `whileHeld` asserts that a writer did not settle within 1.5 s while another transaction holds the inquiry's lock. A blocked writer cannot settle before the commit, so load can only lengthen the wait, never break it. The only other clock in the path is passive authentication's 5 s budget per chip, which a test chip uses a few milliseconds of.
- **No load reproduced it.** Run under CPU load, with load averages of 22 to 30 on 12 cores, the file passed every time: once alone under 36 busy processes, and 5 copies at once under 24 busy processes. That is 66 of 66 tests:

```text
$ LOAD_PROCS=36 under-load.sh pnpm exec vitest run --config vitest.integration.config.ts src/services/chip-challenges/chip-races.integration.test.ts   (apps/api)
 load average: 22.60
      Tests  11 passed (11)
$ LOAD_PROCS=24 under-load.sh parallel-runs.sh 5
 load average: 30.41
run 1 exit 0 … run 5 exit 0    (Tests 11 passed (11), five times)
```

- **The failure's shape points to a parallel edit.** A whole file failing alone is what an import or `beforeAll` error looks like. The api-kyb gate ran while `api-nfc` was committing that file (`48d453eb`, 01:34) and editing its imports, in the same working tree.

No deterministic defect was found to fix, so nothing changed (K7 is reported as skipped). The final `pnpm test:integration` below runs the file with the rest.

## K8 (MEDIUM): the head-turn specs photographed the wrong pose under load

`reload-between-uploads` and `selfie-repeat` take the selfie from Chromium's file-backed fake camera, which plays the head-turn clip in real time.
- The in-browser guidance samples a frame, runs the detector on the main thread, and shoots once a pose has been held.
- On a loaded machine the detector falls behind the clip, so the still taken at the shutter shows the clip's next pose.
- The server then refuses the selfie ("We could not use your last photos", with the pose hints).

RED, the reported failure reproduced twice:
- **Under load.** Load started once the stack was ready (72 busy processes, load average about 75 on 12 cores), and `selfie-repeat` failed on the retry screen with both pose hints.
- **On a slowed CPU.** A probe (deleted, never committed) ran the same flow with `Emulation.setCPUThrottlingRate` at 8 through CDP, which slows the detector deterministically and nothing else. With the clip camera it failed the same way.

```text
$ LOAD_PROCS=72 LOAD_DELAY=45 delayed-load.sh flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test tests/reload-between-uploads.spec.ts tests/selfie-repeat.spec.ts
  ✓  1 … reload-between-uploads … (1.3m)
  ✘  2 … selfie-repeat … (2.6m)
    - alert: We could not use your last photos
      - listitem: Look straight at the camera for the first photo, with your face in the middle of the oval.
      - listitem: Your head was not turned far enough to the left. …
 load average: 75.87
$ K8_RATE=8 flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test tests/k8-probe.spec.ts
  ✘  1 … clip camera, slowed CPU (2.4m)      (the same retry screen)
  ✓  2 … prompted camera, slowed CPU (16.9s)
```

Fix (`e2e/tests/support/prompted-camera.ts`): `usePromptedCamera(page or context, person)` replaces `getUserMedia` for video, through an init script. The camera is a canvas stream that shows person A's C45.2 still of the pose the selfie step's live region announces. The picture changes only when the flow prompts the next pose, so the guidance, the auto-capture and the server see the prompted pose however slow the machine is. Everything else runs as built: the guidance, the shutter, the uploads and every server check. Both specs use it in place of the clip launch arguments. The other specs that play the clip (`verification-completes`, `ui-selfie`, `flow-bundle`, `government-id-review`, `selfie-review`) keep it on purpose: they exercise the real-time clip path (C45.3).

```text
GREEN $ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test tests/reload-between-uploads.spec.ts tests/selfie-repeat.spec.ts
  ✓  1 … reload-between-uploads … (13.8s)
  ✓  2 … selfie-repeat … (21.7s)
  2 passed (1.3m)
```

The same pair under 72 busy processes then failed elsewhere: at load average 90 vision took longer than 90 s to check the ID photo ("Checking your photos"), before any selfie. Server work that slow is outside the camera's reach, and outside K8. On the slowed CPU, which leaves the server alone, the prompted camera passed in 16.9 s where the clip failed.

Not changed, and worth an owner's look: the flow photographs the live frame at the shutter, not the frame the guidance judged (`apps/flow/src/steps/selfie-capture-step.tsx` `takePhoto`). On a slow phone a user's head can move in between. Capturing the judged frame would be the product fix; it is outside this test-honesty item.

## K9 (MEDIUM): the harness bound no SMS sender, so eight tests overrode providers

`phase5TestDependencies` (`apps/api/src/test-support/fakes.ts`) bound no provider, so every test that publishes `phase5TemplateAttributes()` (with a phone step) needed `providers: sandboxSmsProviders()`.

Fix: `phase5TestDependencies` binds the sandbox SMS sender for sandbox environments, as `.env.example` does, with its sink in the dependencies' own in-memory cache.
- The eight per-test overrides are gone, and so is the helper `sandboxSmsProviders`. The files: `kyb-flow`, `phase5-submit`, `inquiry-templates`, `phase5-create-upload`, `verification-mutations.contract`, `verifications`, `phase5-guidance` and `flow-preconditions`.
- Three tests need no sender, and now say so with `providers: { sandbox: {}, production: {} }`:
  - the channel guard at send time (`routes/flow/otp.test.ts`, which still answers `otp_channel_not_configured`);
  - the channel guard at publish (`services/otp/hooks.test.ts`);
  - the sink's unbound API (`sandbox-sms-sink.test.ts`).
  They changed because the default changed.

```text
RED   $ vitest (apps/api) src/test-support/fakes.test.ts
     × binds the sandbox SMS sender for sandbox environments and nothing for production
     × keeps the sandbox sender’s codes in its own cache, for the sandbox sink
AssertionError: expected undefined to match object { id: 'sandbox', sandbox: true }
      Tests  2 failed | 20 passed (22)
      $ vitest (apps/api)   (after the binding, before the three tests said they unbind)
 FAIL  src/sandbox-sms-sink.test.ts > … is served with the sandbox sender bound, outside production mode
 FAIL  src/routes/flow/otp.test.ts > … refuses a phone code without an SMS sender, and an email code without a mailer
 FAIL  src/services/otp/hooks.test.ts > … refuses a phone step without an SMS sender and an email step without a mailer
GREEN $ vitest (apps/api)
 Test Files  255 passed (255)
      Tests  3843 passed (3843)
```

## K13 (MEDIUM): the trust-store page could not say whether the store is refreshed

Owner decision 6 after Workflow 5B. The other fixer's K10 (`c2cb16c9`) already gives the API process both variables in compose.
- **The contract.** `dashboardTrustAnchorsSchema` gains a required `settings: { 'refresh-enabled', 'icao-crls-allowed' }` (`trustStoreSettingsSchema`), and the golden `contracts/fixtures/api/dashboard-trust-anchors.json` holds it.
- **The API.** `ApiDependencies.nfc` (the parsed `NfcSettings`; `container.ts` fills it from `config.nfc`) reaches the dashboard routes as `AdminRouteContext.nfc`, both off by default. `GET /dashboard/trust-anchors` fills `settings` from it, and the route's OpenAPI description says the values are what the API process reads.
- **The console.** The chip trust store page shows "Store refresh" (On / Off) and "ICAO PKD CRLs" (Fetched / Not fetched), each with a sentence naming its variable, in place of the note that it could not (`TRUST_STORE_SETTINGS_NOTE` is gone).

```text
stub  87a0a63c chore(api): ApiDependencies.nfc, AdminRouteContext.nfc, not reported
RED   $ vitest (packages/contracts) src/trust-anchors.test.ts src/fixtures.test.ts
     × parses the golden answer unchanged
     × reports the install’s refresh and ICAO-CRL settings
     × takes a store with no source synced and no anchor
     × dashboard-trust-anchors.json parses and re-serializes unchanged
      Tests  4 failed | 161 passed (165)
      $ vitest (apps/api) src/routes/dashboard/trust-anchors.test.ts
     × serves the trust store in its frozen schema, with settings:read
     × serves an empty store
     × reports whether the store is refreshed and ICAO PKD CRLs are allowed, as the API reads them
      Tests  3 failed | 3 passed (6)
GREEN $ vitest (packages/contracts)                      Tests  1809 passed
      $ vitest (apps/api) src/routes/dashboard/ src/openapi.test.ts
     × matches the committed snapshot (pnpm --filter @openverify/api openapi:write)
      $ pnpm --filter @openverify/api openapi:write   (twice)
fa612f93…c538 → c678374b…7127, then c678374b…7127 again
      $ vitest (apps/api) src/openapi.test.ts           Tests  13 passed (13)
RED   $ vitest (apps/dashboard) src/components/trust-store/
     × says whether the worker refreshes the store and whether ICAO PKD CRLs are fetched
TestingLibraryElementError: Unable to find an element with the text: Store refresh, which matches selector 'dt'.
GREEN $ vitest (apps/dashboard) src/components/trust-store/ src/app/trust-anchors
      Tests  48 passed (48)
```

Existing tests changed because the fix changed what they check:
- `trust-store-view.test.tsx`: "says which install settings it cannot show" became the settings test above;
- `trust-store-words.test.ts`: the note's test became the words test;
- `routes/dashboard/trust-anchors.test.ts`: the two exact answers carry `settings`;
- `services/context.test.ts`: the dependency key list gains `nfc`.

`docs/checks/nfc.md` gains the settings. Its known limit about the console is gone.

## P008, P025 (MEDIUM): the golden 5A verifications carried invented check metadata

The golden phone, email, database, AAMVA and crypto wallet fixtures were written in 5A Stage 1a, before the evaluators existed. Only one check (crypto validity) was tied to its evaluator.

Test (`apps/api/src/jobs/phase5a-golden-fixtures.test.ts`, like the 5B one): each fixture's `checks` are the evaluators' results on the inputs each job assembles from the fixture's own attributes:
- the OTP counts and sender (sandbox SMS, `smtp` for email);
- the pinned disposable list's identity, and the reserved sandbox domain `example.test` (no DNS);
- the sandbox database record that echoes the entry;
- the sandbox AAMVA answer for the ending `5555`;
- for crypto, the fixture's own address for validity (EIP-55's all-caps example, which no known key controls), and a synthetic key's EIP-191 signature over a challenge for the other three checks, whose results never name the address.

```text
RED   $ vitest (apps/api) src/jobs/phase5a-golden-fixtures.test.ts
     × serves the OTP, disposable and MX checks the evaluators write for a reserved sandbox domain
-     "metadata": { "match": "none" },        +     "metadata": {},
-       "route": "reserved",                  +       "record": "reserved-domain",
     × serves the checks the evaluators write on the sandbox record that echoes the entry
-       "fields": { "address": { "components": … }, … }   +       "matched-group": 0,
     × serves the checks the evaluators write for a jurisdiction the sandbox says does not take part
     × serves the checks the evaluators write for a valid EIP-191 signature over the challenge
      Tests  4 failed | 1 passed (5)      (the phone fixture already agreed)
GREEN (the four fixtures' checks rewritten from the evaluators' output, attributes unchanged)
      $ vitest (apps/api) src/jobs/phase5a-golden-fixtures.test.ts src/jobs/crypto-wallet-contract.test.ts
      Tests  8 passed (8)
      $ vitest (packages/contracts) · (packages/node) · (apps/dashboard) · (apps/flow) · (apps/api) src/jobs/
      Tests  1809 · 226 · 3027 · 1007 · 565 passed
```

The crypto fixture's checks now follow the configuration's order (validity, disallowed chain, address, statement), as the other golden fixtures do.

Existing tests changed because the fixtures now carry real data:
- `packages/contracts/src/fixtures.test.ts`: "holds synthetic data only" checks email addresses, which have a dotted domain after the `@`, against `@example.test`. The evaluator's model id `disposable-email-domains@6fcca80` (a name and a commit) is no address. Every real address still meets the check.
- `apps/dashboard/src/lib/aamva-evidence.test.ts`: the golden AAMVA identity check records the template's `on-jurisdiction-not-participating` (`review`). The silent step still reads "Skip the step".
- `apps/dashboard/src/lib/database-evidence.test.ts` and `components/evidence/database.test.tsx`: the "older shape" cases read `olderShapeDatabaseVerification()`, a fixture of their own (`testing/fixtures/database.ts`) that holds the golden's former metadata. That keeps the console's fallback covered. New cases read the golden through the identity check's own comparisons and its group's `met` outcome.

## P023 (MEDIUM): the mocked document spec's live-region check could skip itself

The mocked spec answered the upload at once, and checked the "Uploading your document…" status only `if ((await status.count()) > 0)`.

Fix: the spec holds the upload's answer (`page.route` on the files URL, then `route.fallback()` once released), asserts that the status is visible and in a live region on every run, and then releases the answer. A jsdom case (`document-step.test.tsx`) holds `uploadFile` open and asserts `role="status"` reads the words while the upload lasts.

```text
$ (mutation, not committed: <p role="status"> → <p>) vitest (apps/flow) src/steps/document/document-step.test.tsx
     × says the upload is under way in a status region while it lasts
$ (same mutation) flock … playwright test --config e2e/playwright.config.ts zz-document-old document -g "under way in a live region" --repeat-each=15   (apps/flow)
  30 failed     (15 the new spec, 15 the old one)
$ (code as built) … playwright test … document --repeat-each=3
  15 passed (10.7s)
```

On this machine the old spec also caught the mutation in all 15 runs: the race the finding describes, with the status gone before `count()`, did not happen here. The new spec no longer depends on that timing.

## P002 (MEDIUM): asn1js exceptions escaped as RangeError

`asn1js.fromBER` throws, rather than answering an error, for a BMPString of odd length, a UniversalString whose length is no multiple of 4, and a GeneralizedTime that is no time, all past the TLV pre-scan. Every caller handles `EmrtdError` only.

Fix: `decodeAsn1` turns any exception of `fromBER` into `EmrtdError('chip_data_malformed', step)`. The pkijs constructors were already guarded (`pkiObject`, and `signerIdentifier`'s try).

Tests:
- `asn1.test.ts`: the three strings and a nested one;
- `parse.test.ts`: `parseSod(77051e03414243)` and `parseDg15(6f051e03414243)`;
- `pki.test.ts`: a CRL whose issuer country is re-tagged `1c` (a UniversalString);
- `passive-authentication.test.ts`: such a SOD gives `not_established` / `chip_data_malformed`;
- `government-id-nfc-submit.test.ts`: the submit takes such a SOD (202, the job judges it), where it answered 500;
- `sync.test.ts`: a re-tagged CRL from a distribution point is skipped, and the list is accepted, where the run aborted.

```text
RED   $ vitest (packages/emrtd) src/asn1.test.ts src/parse.test.ts src/pki.test.ts src/passive-authentication.test.ts
RangeError: Offset is outside the bounds of the DataView
RangeError: byte length of Uint32Array should be a multiple of 4
Error: Wrong input string for conversion
      Tests  7 failed | 105 passed (112)
      $ vitest (apps/api) src/trust-anchors/sync.test.ts src/routes/flow/government-id-nfc-submit.test.ts
RangeError: byte length of Uint32Array should be a multiple of 4
AssertionError: expected 500 to be 202
      Tests  2 failed | 41 passed (43)
GREEN $ vitest (packages/emrtd)                        Tests  318 passed (318)
      $ vitest (apps/api) src/trust-anchors/ src/routes/flow/government-id-nfc-submit.test.ts
      Tests  57 passed (57)
```

## P004 (MEDIUM): the address check verified a signature over any bytes the client named

`crypto_wallet_address_comparison` passed a valid signature over whatever `signed-message` held. Only the statement check compared those bytes with our challenge, so a template that made the statement check advisory or disabled it accepted a signature replayed from elsewhere.

Fix: `challengeCoverage(context, signedBytes)` (`crypto-wallet-statement-comparison.ts`) is the statement check's own rule. The bytes count when they are the challenge's UTF-8 bytes, or a Solana off-chain envelope of them that names the claimed key. The address check applies the same rule:
- a key's valid signature over other bytes fails `signature_invalid`, a frozen user-behaviour reason, so no contract change;
- so does a contract wallet's ERC-1271 acceptance of other bytes.

The statement check still reports such a replay as `statement_mismatch`.

Tests:
- `crypto-wallet-address-comparison.test.ts`, "the challenge binding": a forum message signed by the claimed key fails; the challenge named as the signed message passes; an envelope of the challenge passes, while one of other content, or bare other bytes, fails; a contract accepting other bytes fails;
- `evaluate.test.ts`: the replay fails the verification with the statement check required, advisory or disabled.

```text
RED   $ vitest (packages/checks) src/crypto/
     × fails signature_invalid for the claimed key’s valid signature over bytes other than our challenge
     × passes a Solana off-chain envelope of our challenge naming the key, and no other envelope
     × fails signature_invalid for a contract wallet that accepts bytes other than our challenge
     × fails a replayed signature over another message with the statement check required
     × fails a replayed signature over another message with the statement check advisory
     × fails a replayed signature over another message with the statement check disabled
      Tests  6 failed | 328 passed (334)
GREEN $ vitest (packages/checks) src/crypto/            Tests  334 passed (334)
      $ vitest (apps/api) the crypto job, contract, challenges, submit, route and golden tests
      Tests  83 passed (83)
```

## P005 (MEDIUM): the NFC selfie reference could be a selfie still being judged

The NFC job took the latest selfie that was `passed`, `needs_review` or `submitted`. A selfie still `submitted` has had no liveness decision yet.

Fix (`apps/api/src/jobs/types/government-id-nfc.ts`): only a decided selfie (`passed` or `needs_review`) is a reference. While the inquiry's latest selfie is still `submitted`, the job throws `SelfieReferencePendingError` (no data), so BullMQ retries it with its backoff while attempts remain. On the last attempt it answers `no_reference_data` (review), comparing neither the undecided selfie nor an earlier one. Waiting avoids sending to review a client that submits the chip moments after the selfie. The MRZ readings keep their own statuses.

Tests (`jobs/types/government-id-nfc.test.ts`), with a later selfie whose centre photo is uploaded and still `submitted`:
- with attempts left, the job rejects, the verification stays `submitted` and no read is written;
- on the last attempt, the selfie comparison answers `no_reference_data`, the verification goes to review, and no selfie face is embedded.

```text
RED   $ vitest (apps/api) src/jobs/types/government-id-nfc.test.ts
     × retries later while attempts remain, deciding nothing
AssertionError: promise resolved "{ outcome: 'processed', …(2) }" instead of rejecting
     × answers no_reference_data on the last attempt, comparing neither the undecided selfie nor an earlier one
      Tests  2 failed | 10 passed (12)
GREEN $ vitest (apps/api) src/jobs/types/government-id-nfc.test.ts …-contract.test.ts src/jobs/phase5b-golden-fixtures.test.ts src/worker.test.ts
      Tests  69 passed (69)
```

Before the RED commit, the later selfie first had no photo. The current code then already answered `no_reference_data`, so the RED case would have proven nothing. The photo makes it the finding's case.

## P024 (MEDIUM): the document and chip evidence parts had no headings

The parts were titled with bold paragraphs. The Stage 1 layout rule (dashboard-documents amendment 10) avoided headings because the evidence sits under an h4 on the card and an h2 on the page. Named groups would break the one-group-per-evidence page test.

Fix:
- `EvidenceProps.partHeadingLevel` (3 to 6) tells the evidence where it sits: the card passes 5 and the page passes 3.
- `PartTitle` (`components/evidence/parts.tsx`) renders the title as `role="heading"` at that level, and as plain text without one.
- The document and chip evidence pass it to every part. The evidence is still one group.

Tests: both evidence components title their parts at the level given and keep one group. The card shows level 5 and no level 3, and the page shows level 3 and no level 5.

```text
stub  fa3d93ca chore(dashboard): EvidenceProps.partHeadingLevel, not read
RED   $ vitest (apps/dashboard) src/components/evidence/document.test.tsx src/components/evidence/government-id-nfc.test.tsx
     × titles each part with a heading at the level the host gives, still one group     (twice)
TestingLibraryElementError: Unable to find an accessible element with the role "heading"
      $ vitest (apps/dashboard) src/components/verification-card.test.tsx; src/app/verifications -t "titles a chip"
     × titles a document’s evidence parts with level 5 headings, under its Evidence heading
     × titles a chip verification’s evidence parts with level 3 headings, under its Evidence heading
GREEN $ vitest (apps/dashboard)
 Test Files  225 passed (225)
      Tests  3031 passed (3031)
```

## Final gates

Run at the end, after every fix above was committed. The whole full-stack suite ran **unsharded**: one `pnpm e2e` under the e2e lock, in the background because it outlasts one 10-minute foreground call, and waited on to its exit.

```text
$ pnpm typecheck                     Tasks: 13 successful, 13 total
$ pnpm lint                          Tasks: 13 successful, 13 total
$ pnpm test                          Tasks: 13 successful, 13 total
  api 256 files, 3,853 tests (97.01% statements, 89.39% branches)
  dashboard 225 files, 3,031 tests (98.64%, 94%)
  checks 148 files, 2,918 tests (98.7%, 90.96%)
  contracts 53 files, 1,809 tests · flow 65, 1,008 · db 66, 847 · core 16, 711
  emrtd 18 files, 318 tests (94.97%, 87.25%) · node 7, 226 · flow-spec 4, 113
  e2e 12 files, 90 tests · config 3, 71 · ui 8, 54
  every package ≥ 80%
$ pnpm format:check                  All matched files use Prettier code style!
$ pnpm test:integration
  api 25 files, 124 tests passed (chip-races and the new pacing file among them)
  db  11 files, 57 tests passed
$ pnpm --filter @openverify/api openapi:write   (twice)
  c678374ba3a525b2ae3046aaf98a6bf0838a1973b364911e2bc1b6a154df7127, unchanged by the second run
$ cd android && ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'
  BUILD SUCCESSFUL; ContractFixturesTest tests="80" skipped="0" failures="0" errors="0"
$ flock /tmp/openverify-e2e.lock pnpm e2e
  @openverify/flow:e2e   69 passed (18.8s)
  @openverify/e2e:e2e    82 passed (8.2m)      (unsharded, one stack)
  exit 0
$ grep -o '"method":"POST","url":"/api/v1/dashboard/sessions[^"]*"' e2e/.artifacts/logs/api.log | sort | uniq -c
     17 "method":"POST","url":"/api/v1/dashboard/sessions"
      9 "method":"POST","url":"/api/v1/dashboard/sessions/mfa"
$ grep -c '"statusCode":429' e2e/.artifacts/logs/api.log
0
```

The whole suite made 17 password sign-ins, where the dashboard-documents run made 58, and no request answered 429 (P021).
