# TDD record: integration-7a (Phase 7, Workflow 7A Stage 4)

**Area:** the 7A integration: the default template's session-integrity notice, the sandbox network import of `seed:dev`, the network sources route, the flow's response headers, the compose and image checks, the QR libraries that lost, the reusable e2e stack with the trusted proxy and the 7A full-stack specs, CI, the docs of C109, the plan amendments of Stages 2 to 4, and the full validation.

**Base:** `b267a566` (flow-handoff's record, the last Stage 3 commit). Every command ran after `source scripts/env.sh`; outputs are abbreviated to the lines that decide. Every address is from the documentation ranges and every ASN from the documentation ASN ranges.

## Slice 1: the default template shows the session-integrity notice (C94.6, ADR 0006; contracts-7a and foundation-7a followups)

Until this slice the default template's consent step listed no `notice.session-integrity`, so every session's behaviour signals read `collection_disabled` (api-signals' `collectionTiersOf` requires the notice among the consent's shown keys). C94.6 says the default template lists it.

**RED** (the tests compile, typecheck and lint; they fail because the template, the texts and the SDK's keys do not have the notice yet):

```
$ (cd packages/contracts && pnpm exec vitest run src/default-template-selfie.test.ts --coverage.enabled=false)
     × offers the matching consent as an optional text
     × shows the session-integrity notice as a required text, so session integrity collects (C94.6, ADR 0006)
     × is published as a new flow version (3: the session-integrity notice, C94.6)
AssertionError: expected [ 'consent.biometric', …(1) ] to include 'notice.session-integrity'
AssertionError: expected 2 to be 3 // Object.is equality
      Tests  3 failed | 4 passed (7)
$ (cd apps/flow && pnpm exec vitest run src/i18n/consent-keys.test.ts --coverage.enabled=false)
     × has the texts of the collection tiers: the two notices and the recognition consent (C94.6, ADR 0006)   (en, es)
      Tests  2 failed | 4 passed (6)
$ cat /proc/loadavg
0.13 0.78 3.56 1/961 1627687
$ (cd android && ./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.MessagesTest' --tests 'dev.openverify.sdk.model.ContractFixturesTest')
104 tests completed, 3 failed
  the consent texts the SDK can show are the default template's(): expected: <[consent.biometric, consent.processing, consent.biometric-matching, notice.session-integrity, notice.device-recognition, consent.device-recognition]> but was: <[co…
  the optional matching consent has its own checkbox label (C42_3)(): expected: <[consent.biometric-matching, consent.device-recognition]> but was: <[consent.biometric-matching]>
  flow-session decodes the inquiry, the flow, the verifications and the consent(): expected: <[ConsentStep(id=consent, textKeys=[consent.biometric, consent.processing, notice.session-integrity], …
```

**GREEN:** the default template (`DEFAULT_TEMPLATE` in `packages/contracts/src/inquiry-templates.ts` and its golden copy `contracts/fixtures/flows/default-gov-id-selfie.json`, flow version 3) lists `notice.session-integrity` after the two consent texts; `contracts/fixtures/api/flow-session.json` carries the new default flow. The flow has English and Spanish texts for `notice.session-integrity`, `notice.device-recognition` (ADR 0006's default texts) and the optional `consent.device-recognition`; the Android SDK has the same three texts (en, es), the recognition consent's own checkbox, and the keys in `FlowCoordinator.Settings.consentTextKeys`.

Tests changed with the plan, because each pins the default template's required keys or what a consent on it records (no assertion weakened): `packages/contracts/src/inquiry-templates.test.ts`; `apps/flow/src/i18n/create-i18n.test.ts`, `src/flow/flow-renderer.test.tsx`, `e2e/consent.spec.ts`, `e2e/flow.spec.ts`; `e2e/tests/selfie-repeat.spec.ts`; the Android `FlowCoordinatorTest` (two cases); and the API tests that post a consent on the default template (`'text-keys'` gains the notice in 18 files; two recorded-consent expectations in `routes/flow/session.test.ts` and `consent-phase4.test.ts`). The blast radius was measured first: with the template changed and nothing else, the default-template API files gave `Tests 284 failed | 469 passed (753)`, every failure a 422 on the missing required key.

```
$ (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)
      Tests  2279 passed (2279)
$ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)        # after the two renderer pins
      Tests  1078 passed (1078)
$ (cd apps/api && pnpm exec vitest run src/jobs/selfie-contract.test.ts src/jobs/process-selfie.test.ts src/jobs/face-index-rebuild.test.ts src/jobs/signals/process.test.ts src/routes/flow src/services/submit src/services/publish src/services/handoff src/services/otp src/services/flow-preconditions.test.ts src/jobs/types src/seed --coverage.enabled=false)
      Tests  753 passed (753)
$ (cd android && ./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.*' --tests 'dev.openverify.sdk.model.ContractFixturesTest' --tests 'dev.openverify.sdk.flow.*')   # load 1.89
571 tests completed, 2 failed   (FlowCoordinatorTest: the two recorded-consent pins, then updated)
$ (cd android && ./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest')
(no failure)
```

## Slice 2: `seed:dev` gives the sandbox network import its object storage (C92.3, C93.6; foundation-7a amendment (N) 11)

`seedNetworkData` (api-network) imports `openverify-sandbox-network` only with object storage, and `scripts/seed-dev.ts` passed none, so a fresh stack's sandbox sessions answered `list_unavailable` for every network fact.

- Stub `0065b3f7`: `DevSeedSettings.s3` and `openDevSeedStorage(settings)` (always `undefined`).
- RED (`src/seed/dev-seed-network.test.ts`):

```
$ (cd apps/api && pnpm exec vitest run src/seed/dev-seed-network.test.ts --coverage.enabled=false)
     × is read from S3_* as the API reads it, path-style by default
     × refuses a bucket without its credentials, naming the variables and never a value
     × opens an S3 file storage that the script closes
AssertionError: expected undefined to deeply equal { …(6) }
AssertionError: expected [] to deeply equal [ …(3) ]
AssertionError: expected undefined to be defined
      Tests  3 failed | 5 passed (8)
```
- GREEN: `devSeedSettingsFromEnv` reads `S3_ENDPOINT`, `S3_REGION` (default `us-east-1`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` (default `true`) as the API does, only when `S3_BUCKET` is set; `openDevSeedStorage` builds the S3 `FileStorage`; `scripts/seed-dev.ts` passes it as `storage` and closes it. `src/seed`: `Tests 48 passed (48)`.

## Slice 3: the network sources page is served (C108, C92.4, C92.8; api-network's `066912fc`, "not registered until integration-7a moves the schema into contracts")

- RED (`apps/api/src/routes/dashboard/network-sources-registered.test.ts`, through the dashboard harness):

```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/network-sources-registered.test.ts --coverage.enabled=false)
     × needs an operator session
     × serves every manifest source to an operator with settings:read, in the frozen schema
AssertionError: expected 404 to be 401 // Object.is equality
AssertionError: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/dashboard/network-sources.", …}: expected 404 to be 200
      Tests  2 failed (2)
```
- GREEN: `dashboardNetworkSourcesSchema` and `DashboardNetworkSources` move, unchanged, to `packages/contracts/src/network-sources.ts` (exported from the entry; the route module re-exports them for the tests beside it); `admin.ts` registers `networkSourceRoutes` beside the watchlist sources page; the OpenAPI snapshot is regenerated (`docs/api/openapi.json`, +308 lines: the one path and its schema). Before the regeneration `src/openapi.test.ts` failed `× matches the committed snapshot`, as it should.

```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/network-sources --coverage.enabled=false)
      Tests  6 passed (6)
$ (cd apps/api && pnpm -s openapi:write && pnpm exec vitest run src/openapi.test.ts src/routes/dashboard/index.test.ts --coverage.enabled=false)
      Tests  51 passed (51)
```

## Slice 4: the flow's response headers (C107.9, carried since Phase 1A)

- Stub `1accce6d`: `FLOW_RESPONSE_HEADERS` (empty) in `apps/flow/src/security/response-headers.ts`.
- RED: the unit test (`src/security/response-headers.test.ts`, node environment, because it loads `vite.config.ts`) and the infra test `infra/tests/flow-headers.test.sh` (static half always; the live half runs the apps image's flow as compose does, in one container of its own, and reads the headers of the page and a built asset).

```
$ (cd apps/flow && pnpm exec vitest run src/security/response-headers.test.ts --coverage.enabled=false)
     × forbid framing, the camera beyond this origin, geolocation, the microphone, referrers and sniffing
     × are what `vite preview` sends
AssertionError: expected {} to deeply equal { …(4) }
AssertionError: expected undefined to deeply equal {}
      Tests  2 failed (2)
$ bash infra/tests/flow-headers.test.sh --static-only
FAIL - FLOW_RESPONSE_HEADERS holds exactly the four C107.9 headers (found: )
FAIL - vite.config.ts hands them to preview.headers
# 0 passed, 2 failed
```
- GREEN: `FLOW_RESPONSE_HEADERS` holds the four headers; `vite.config.ts` sets `preview.headers` from it; `docs/flow/README.md` gives them to operators who serve the build themselves (with an nginx example). The live half runs in the validation, after the apps image is built.

```
$ (cd apps/flow && pnpm exec vitest run src/security --coverage.enabled=false)
      Tests  14 passed (14)
$ bash infra/tests/flow-headers.test.sh --static-only
ok   - FLOW_RESPONSE_HEADERS holds exactly the four C107.9 headers
ok   - vite.config.ts hands them to preview.headers
# 2 passed, 0 failed
```

## Slice 5: the compose contract for 7A's settings, and no network data in the apps image (C92.5, C93.5, C96.3, C107.8, ADR 0006)

- The compose contract (`infra/tests/compose.test.sh`) gains foundation-7a's list (its (N) and (H) contractDeviations): `IP_REPUTATION` among both processes' provider kinds; the source lists in the API, the worker and migrate, read the same way; `OPENVERIFY_NETWORK_REFRESH` in the worker only; the MMDB path and the read-only `../data/ip-reputation` mount in the API and the worker, never in migrate; `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` in the API only; `.env.example` with the refresh off, the sandbox `ipReputation` bound, no MMDB path and the budget at 200. These pin what Stage 1b already wired, so they pass at once: `bash infra/tests/compose.test.sh --static-only` gave `# 442 passed, 0 failed`.
- The image context (`infra/tests/apps-image-context.test.sh`) gains the network data contract. RED:

```
$ bash infra/tests/apps-image-context.test.sh
FAIL - the apps image context has data/x4bnet-datacenter-ASN.txt (network facts read it) (excluded by .dockerignore)
FAIL - the apps image context has data/x4bnet-vpn-ASN.txt (network facts read it) (excluded by .dockerignore)
FAIL - the apps image context has data/bad-asn-list.csv (network facts read it) (excluded by .dockerignore)
FAIL - the apps image context leaves out network data: packages/signals/dbip-city-lite.mmdb (included)
FAIL - the apps image checks data/x4bnet-datacenter-ASN.txt against its pin in data/manifest.json
FAIL - the apps image checks data/x4bnet-vpn-ASN.txt against its pin in data/manifest.json
FAIL - the apps image checks data/bad-asn-list.csv against its pin in data/manifest.json
# 32 passed, 7 failed
```

Until now the image carried no ASN seed, so a container's VPN and hosting flags read `list_unavailable` whatever the operator fetched.
- GREEN: `.dockerignore` re-includes the three seeds and leaves out every `*.mmdb` and `*.mmdb.gz`; `apps.Dockerfile` checks each seed against its pin (`sha256sum -c`), as it does the disposable list. The Dockerfile check reads instructions only (its comments name what stays out). `bash infra/tests/apps-image-context.test.sh`: `# 39 passed, 0 failed`.

## Slice 6: the two QR encoders that lost (C96.5, owner decision 24)

flow-handoff measured the three candidates in the flow bundle (its record, "The QR measurement"): lean-qr 2.7.4 +3,557 B gzipped, uqr 0.1.3 +3,795 B, qrcode 1.5.4 +9,501 B, and chose lean-qr. RED (`apps/flow/src/handoff/qr-library.test.ts`):

```
$ (cd apps/flow && pnpm exec vitest run src/handoff/qr-library.test.ts --coverage.enabled=false)
     × leaves the two encoders that lost the measurement out of the flow
AssertionError: expected [ 'qrcode', 'uqr', '@types/qrcode' ] to deeply equal []
      Tests  1 failed | 1 passed (2)
```
- GREEN: `flock /tmp/openverify-pnpm.lock pnpm --filter @openverify/flow remove qrcode uqr @types/qrcode` (the lockfile loses 17 lines), then `uqr` leaves the catalog and a second `pnpm install` (no `minimumReleaseAgeExclude` entry appeared); `THIRD_PARTY_LICENSES.md` drops the uqr row and the flow's candidate rows, and lean-qr's row records the measurement. `src/handoff`: `Tests 22 passed (22)`.

## Slice 7: the flow depends on `@openverify/signals` (client-collector's deviation)

client-collector imported the collector by a path into `packages/signals/src`, because `apps/flow/package.json` did not list the package and only a dependency owner changes the lockfile. RED (`apps/flow/src/signals/collector-dependency.test.ts`):

```
$ (cd apps/flow && pnpm exec vitest run src/signals/collector-dependency.test.ts --coverage.enabled=false)
     × is declared as the workspace package
     × is imported through the package’s browser entry
AssertionError: expected undefined to be 'workspace:*' // Object.is equality
AssertionError: expected '/**\n * The flow\'s signal hook (plan…' to contain 'from \'@openverify/signals/browser\''
      Tests  2 failed (2)
```
- GREEN: `flock /tmp/openverify-pnpm.lock pnpm --filter @openverify/flow add '@openverify/signals@workspace:*'` (3 lockfile lines, no catalog change), and `collector.ts` imports `startCollector` from `@openverify/signals/browser`. `src/signals`: `Tests 12 passed (12)`. The flow's main bundle after Workflow 7A (the collector, the handoff screens and lean-qr; no lock, a size): `VITE_OPENVERIFY_API_URL=http://api.openverify.test pnpm exec vite build` gives `assets/index-*.js` 932,920 B, 274,981 B at gzip -9 (client-collector's wired figure was 902,717 B and 264,292 B).

## Slice 8: the reusable e2e stack, the trusted proxy and the sandbox addresses (C111.2, F20, F34, C93.6)

- Stubs: `eef6e30e` (`e2e/src/reusable-stack.ts`: `REUSE_STACK_ENV`, `REUSABLE_STACK_FILE`, `ReusableStackRecord`, `reuseRequested`, `encodeReusableStack`, `decodeReusableStack`, `processAlive`, `readReusableStack`) and `39e3327f` (`e2e/src/forwarded-for.ts`: `FORWARDED_FOR_HEADER`, `withForwardedFor`).
- RED: the harness's unit tests (`reusable-stack.test.ts`, `forwarded-for.test.ts`, and three cases in `env.test.ts` for `OPENVERIFY_TRUST_PROXY=127.0.0.1`, the sandbox `ipReputation` binding and the network settings the shell cannot change):

```
$ (cd e2e && pnpm exec vitest run src/reusable-stack.test.ts src/forwarded-for.test.ts src/env.test.ts --coverage.enabled=false)
     × adds X-Forwarded-For and changes no other header
     × replaces a header the page sent under any case, so one address reaches the API
     × takes only the documentation ranges the sandbox network answers for (C111.1)
     × is asked for with OPENVERIFY_E2E_REUSE_STACK=1 (or true), and only then
     × records the holding process and the stack info, and reads them back
     × refuses a record that is not one, without echoing it
     × gives the stack info of a running holder to the global setup
     × says to start the stack when there is no record, and that it stopped when its holder is gone
     × probes a process with signal 0, and reads a missing one as gone
     × trusts the loopback proxy, so a spec presents a sandbox address with X-Forwarded-For
     × binds the sandbox IP reputation for sandbox environments only, with no MMDB path
     × never refreshes network data and turns no source on or off, whatever the shell says
AssertionError: expected undefined to be '127.0.0.1' // Object.is equality
AssertionError: expected [Function] to throw error including 'no reusable e2e stack is running: sta…' but got 'not built (undefined, 0)'
Error: not built (1217)
      Tests  12 failed | 18 passed (30)
```
- GREEN:
  - `reusable-stack.ts`: `reuseRequested` (`1` or `true`), the record `{ pid, startedAt, info }` (the info checked with the stack info's own schema, through the new `parseStackInfo`), errors that name the record and never its content, `processAlive` (signal 0; `EPERM` counts as alive), and `readReusableStack`, which tells "start one" from "it stopped".
  - `forwarded-for.ts`: `withForwardedFor` adds `x-forwarded-for` (replacing one of any case) and nothing else, for documentation addresses only (`node:net` `BlockList`).
  - `env.ts`: `OPENVERIFY_TRUST_PROXY=127.0.0.1`, the sandbox `ipReputation` in sandbox environments, no MMDB path, no refresh, no source switched.
  - `setup/global-setup.ts`: with `OPENVERIFY_E2E_REUSE_STACK=1` it reads `e2e/.artifacts/stack.json` and starts nothing.
  - `setup/reusable-stack-cli.ts` with `e2e:stack:up` and `e2e:stack:down` (node with type transforms and `packages/checks/scripts/register-ts.mjs`, as the watchlist benchmarks run, so no new dependency): `up` starts a detached holder that runs `startStack()`, writes the record (mode 0600) and stops everything on SIGTERM, and returns once the record exists; `down` signals the holder and waits, or removes the compose project of a stack whose holder died.

```
$ (cd e2e && pnpm exec vitest run src --coverage.enabled=false)
      Tests  109 passed (109)
```

## Slice 9: a pending `ip-address` report could not be served (a defect the full-stack spec found; C106.1, C70.2)

The first run of `ip-address-report.spec.ts` on the reusable stack failed at `reports.create`: the API answered 500, because `buildReportResource` fills a pending report's type attributes with `null`, else `[]`, and the `ip-address` type has a boolean (`flagged`) and a record (`field-details`) that take neither:

```
OpenVerifyApiError: Internal Server Error: [
  { "expected": "boolean", "path": [ "attributes", "flagged" ], "message": "Invalid input: expected boolean, received array" },
  { "expected": "record", "path": [ "attributes", "field-details" ], "message": "Invalid input: expected record, received array" } ]
```

No unit test had built a pending report of that type: the job tests build ready ones. RED (`packages/contracts/src/reports.test.ts`):

```
$ (cd packages/contracts && pnpm exec vitest run src/reports.test.ts --coverage.enabled=false)
     × builds a pending report of every type before its first run, the ip-address type included (C106.1)
AssertionError: ip-address: expected [Function] to not throw an error but '[ { "expected": "boolean", … "expected": "record", …' was thrown
      Tests  1 failed | 66 passed (67)
```
- GREEN: a type attribute the record leaves out takes the first of `null`, `[]`, `{}` and `false` its schema accepts, so a pending `ip-address` report has `flagged: false` (as `has-match` is `false` before any run) and `field-details: {}`. `packages/contracts`: `Tests 2283 passed (2283)`.

## Slice 10: `@openverify/node` reads a session with its network and device (C91.1)

contracts-7a made `inquirySessions.retrieve` parse the include document, but the method took no `include`, so a client could not ask for `?include=network,device`; the signals spec needs it. Stub `7b23c984` (the parameter, not yet sent). RED (`packages/node/src/resources.test.ts`):

```
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
     × inquirySessions.retrieve with its network and device (C91.1)
AssertionError: expected 'https://api.example.test/api/v1/inqui…' to be 'https://api.example.test/api/v1/inqui…' // Object.is equality
      Tests  1 failed | 109 passed (110)
```
- GREEN: the parameter goes into the query, as `inquiries.retrieve`'s does. `packages/node`: every test passes (see the final gates).

## Slice 11: the last screen's body reached the server after the inquiry completed (a defect the signals spec found; C90.5, C94.3)

The first run of `signals.spec.ts` gave the Tor session, which consented and completed a one-step flow in Chromium, `bot_score` `null` with `collector_missing`. The API log showed the one `POST /api/v1/flow/signals` refused 401 (`SessionInactiveError: The session was canceled.`) two seconds after the inquiry completed: the collector sends a screen's body when the screen closes, the last screen closes only once its submission has settled, and the inquiry completes (ending its sessions, and freezing the signals) as that submission is decided. So the last screen of every flow was lost, and a one-step flow always read `collector_missing`. The fix is in the flow: before a request that can end the person's part (a verification submit, an OTP confirmation), flush the open screen, waiting at most a bound so signals never hold the flow.

- Stub `56704320`: `flushBeforeSubmission(client, flush, boundMs)` and `SIGNAL_FLUSH_BOUND_MS` (1,500 ms, provisional), returning the client unchanged.
- RED (`apps/flow/src/signals/flush-before-submission.test.ts`):

```
$ (cd apps/flow && pnpm exec vitest run src/signals/flush-before-submission.test.ts --coverage.enabled=false)
     × sends the open screen before a verification submit and before an OTP confirmation
     × waits at most the bound for a collector that does not answer, and goes on after a failed flush
AssertionError: expected [ 'submit', 'confirm' ] to deeply equal [ 'flush', 'submit', 'flush', …(1) ]
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  2 failed | 1 passed (3)
```
- GREEN: `flushBeforeSubmission` wraps `submitVerification` and `confirmOtp` (a collector that does not answer holds them at most the bound; a rejected flush is ignored, as the collector swallows its own failures); `SignalCollection` exposes the collector's `flush`; `useSignalCollection` (FlowRenderer folder) returns the wrapped client, which `FlowRenderer` hands to every step. It imports the wrapper by its file, so the renderer test's mock of `../signals` stays as it was. `apps/flow`: `Tests 1087 passed (1087)`.

## Slice 12: the 7A full-stack specs (C111.2)

Each spec states its budget (90 s) in its header and runs on the reusable stack (`OPENVERIFY_E2E_REUSE_STACK=1`), its addresses from the documentation ranges through the trusted proxy (`e2e/tests/support/network.ts`: `presentAddress`, and `flowCorsAllowedHeaders` for F34's check that the production CORS list is unchanged).

- `ip-address-report.spec.ts`: one report per C93.6 address. Its first run found slice 9's defect (a pending report answered 500); after the fix: `1 passed (2.8s)` (load 2.75).
- `signals.spec.ts`: two sessions (`192.0.2.20`, then `192.0.2.10` completing the database step in Chromium), the signals frozen at completion, `on-signal` moving the inquiry to `needs_review` with `signal_rule`, the sessions' network facts with `client-address-source: trusted-list` and the sandbox source. Its first run found slice 11's defect (`bot_score` null, `collector_missing`); after the fix: `1 passed (13.8s)` (load 5.24, including the stack restart).
- `e2e/tests/support/reports.ts`: `seededTemplateId` compares names without case, because the seed writes "Default IP address".
- `handoff.spec.ts` (two tests, two browser contexts, a Pixel 7 profile for the phone): the QR and its link on the desktop, the phone's context screen, its own consent, completion on the phone, "Continuing on your phone" on the desktop, the phone session's method, issuing session, distance (whole meters, > 0 between the two fictional points) and `handoff_count` 1; then "this was not me": the phone session and its initiated verification canceled, "Get a new code" on the desktop, the inquiry still pending. First run: the second test passed and the first failed on its last screen: the desktop showed "This verification session has ended" (the completion ends every session of the inquiry, so the desktop's poll ends its session), not the completion screen the plan's C96.8 names; the spec now asserts that screen and its wording ("because the verification was finished"), and the gap is a followup. Then `2 passed (18.8s)` (load 1.09).

## Slice 13: CI's SDK host-test floor (C94.7)

android-signals reported 1,268 host tests at its base and 1,327 at its end (50 signal tests, 6 common client tests in the host suite and flow-handoff's 9 coordinator tests; contracts-7a's 4 had not raised the floor). RED (`infra/tests/ci-workflow.test.sh`, whose scenarios run the step's own script):

```
$ bash infra/tests/ci-workflow.test.sh
FAIL - android: the test-count floor fails with one test fewer than the floor (1326) (exit 0: …; the floor is 1264)
FAIL - android: the test-count floor fails at Workflow 5C's earlier floor of 1264 (exit 0: …; the floor is 1264)
# 206 passed, 2 failed, 0 skipped
```
- GREEN: `ci.yml`'s floor step reads 1327, with its comment. `bash infra/tests/ci-workflow.test.sh`: `# 208 passed, 0 failed, 0 skipped`. CI's integration and e2e jobs already run `python3 scripts/fetch_data.py`, whose manifest now pins the three ASN seeds (contracts-7a), and their cache key follows the manifest's hash, so they fetch the seeds without a change.

## Slice 14: the docs of C109 and C111.2

Written after the code they describe, each fact checked against it (no RED; `src/report-docs.test.ts` still passes):
- `docs/checks/signals.md`: where signals appear and when they are computed, the catalogue with each signal's tier, stage, collection tier and what it cannot tell, null reasons and the combination rules, `signal-config` and `on-signal`, the two collection tiers and whose consent counts, the browser collector (what it reads, what it never reads, the fingerprints and why they are not identifiers, the caps and the accessibility caveat), the Android SDK, the law section ("not legal advice") and a DPIA outline;
- `docs/network/README.md`: the sources and their switches, the ASN seeds, the sync and its guards, freshness, attribution, the trust-proxy setting, `ipReputation` and the MMDB mount, and network-data's memory figures;
- `docs/reports/ip-address.md`: completed (running it, sources and freshness, the sandbox addresses, limits);
- `docs/checks/sandbox-providers.md`: the `ipReputation` kind, the sandbox addresses and the sandbox signal outcome;
- `docs/flow/README.md` (slice 4) and `e2e/README.md`: the reusable stack's commands, the three shards, one spec, and the network addresses in the specs.

## Slice 15: a redaction scan read a worker's pid as a birth year (found by the API unit gate)

The first API gate (two blob shards and the merge, loads 12.4 to 7.9) failed one Phase 6 test:

```
 FAIL  src/routes/server/report-redaction.test.ts > DELETE /reports/:id (C73.5) > redacts the report, its matches and actions, stubs its events and fires redacted once
AssertionError: 1977: expected '{"id":"rep_…' not to contain '1977'
+ {"id":"rpr_…","claimed_by":"MHNOOR:1701977:2809e8a9f880cb3a", …}
      Tests  1 failed | 4962 passed (4963)
```

The scan looks for the subject's birth year, `1977`, in every column of the report's rows, and found it in a run's `claimed_by`, the worker's `host:pid:random`: the worker that ran it had pid 1701977. The test passed alone (another pid). It looked for a short string inside output that holds random digits, which the rules forbid. Fix: the scan reads each row as `to_jsonb(t) - 'claimed_by'`, so the process identity is left out and every subject column is still searched for the broad `1977`. `src/routes/server/report-redaction.test.ts`: `Tests 9 passed (9)`. No RED could be shown on demand, because it needs a pid holding those digits; the evidence is the failure above. Other row scans (`packages/db/src/repositories/redaction.test.ts`) select data columns only.

## Slice 16: the flow offered a retry the server was about to refuse (found by the e2e gate under load; C30.1, C50.5)

Shard 1 of the first full-stack gate failed `government-id-checks.spec.ts` › "an expired card fails id_expired_detection, and the flow offers no retry" (load 7.8 to 5.3); alone it passed (`3 passed (33.4s)`). The page showed "Photograph your ID, Attempt 2 of 3" and never the failure. The database told why: the worker decides the verification (`failed`, at 23:29:40.19) in one transaction and settles the inquiry (`failed`, at 23:29:41.15) in the next (`process-verification.ts` steps 5 and 6), and the flow read the session in between: a failed latest verification with attempts left became a new capture attempt, which the server then refuses. In the passing run the gap was 0.25 s. A failure without a retry hint is never retryable (hints are the failed required `user_behavior` checks; `isRetryableFailure` needs every failed required check to be one), so the server always fails the inquiry after it; the flow now waits for that (`finalizing`, which polls) instead of offering an attempt. The race predates Phase 7; Workflow 7A's added transition work widens the window.

RED (`apps/flow/src/flow/flow-position.test.ts`):

```
$ (cd apps/flow && pnpm exec vitest run src/flow/flow-position.test.ts --coverage.enabled=false)
       × waits for the server to fail the inquiry after a failure with no retry hint, attempts left or not (C30.1, C50.5)
AssertionError: expected { kind: 'capture', …(5) } to deeply equal { kind: 'finalizing', step: { …(5) } }
      Tests  1 failed | 80 passed (81)
```
- GREEN: in `flow-position.ts`, a `failed` (or `requires_retry`) latest verification without hints is `finalizing`; with hints, the next attempt as before. `apps/flow`: `Tests 1088 passed (1088)`; the mocked flow suite: `79 passed (35.9s)` (load 8.03). The Android SDK's coordinator decides its own positions; whether it has the same window is a followup.

## The Validation list (foreground; the order of the plan's Phase 6 outcome 10, amended in Stage 4 amendment 14)

| Step | Result | Load |
|---|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | up to date; all files formatted (1 min 3 s) | 0.55 |
| `pnpm turbo run lint typecheck --force` | `Tasks: 30 successful, 30 total` (4 min 6 s); again for flow, api and e2e after the last fixes: `6 successful` | 1.36; 3.00 |
| `fetch_models.py`, `fetch_data.py`, `build:variant-groups` | present; `sha256 29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb` | 5.82 |
| `pnpm turbo run test --filter=!@openverify/api` | `Tasks: 14 successful` (2 min 23 s); per package below | 5.51 to 20.46 |
| the API suite, two blob shards and the merge (second take, after slice 15) | `Test Files 371 passed (371)`, `Tests 4963 passed (4963)`, statements 96.17%, branches 88.35% (shards 5 min 26 s and 5 min 22 s) | 4.77 to 9.27 |
| `benchmark:typecheck`, `benchmark:test` | pass; `Tests 119 passed (119)` | 3.69 |
| `pnpm test:integration` | db `Tests 65 passed (65)`; api `Test Files 31 passed (31)`, `Tests 172 passed (172)` (4 min 49 s); the C78.7 gate printed p95 109.1 ms, not asserted, as in Phase 6 | 3.08 to 20.80 |
| vision: ruff, format, mypy | all pass | 14.65 |
| vision: pytest in two halves (`--cov-append`) | `1458 passed` (7 min 2 s), then `1075 passed` (5 min 50 s); `Total coverage: 97.42%` | 10.59, 10.54 |
| the Android gate | `BUILD SUCCESSFUL in 3m 53s`; SDK host tests 1,327 (0 skipped, 0 failed); demo 18; Kover line coverage 97.55% | 2.52 to 10.88 |
| `openapi:write`, `git diff --exit-code docs/api/openapi.json` | unchanged | |
| the mocked flow suite | `79 passed (33.5s)`, and `79 passed (35.9s)` after slice 16 | 7.04; 8.03 |
| the full-stack suite on a fresh reusable stack (second take, after slice 16) | stack up 1 min 8 s; shard 1/3 `32 passed (1.7m)`, 2/3 `34 passed (4.3m)`, 3/3 `29 passed (3.9m)`: 95 tests | 7.19 to 1.63 |
| `docker build -t openverify/apps:dev -f infra/docker/apps.Dockerfile .` | built (4 min); the three seeds `OK`; no `*.mmdb` or IP reputation file in the image | 3.85 |
| `docker build services/vision` | built | 2.76 |
| every `infra/tests/*.test.sh` | apps-image-context 39, check-connected-results 11, ci-workflow 208, compose (live) 468, flow-headers (live) 11, install-gitleaks 9, pre-commit-hook 11, vision-container (live) 55: all passed | 2.06 to 5.61 |
| `gitleaks git --redact .` | `3609 commits scanned`, `no leaks found` | |

The first takes failed where slices 15 and 16 say: the API merge on the redaction scan (`Tests 1 failed | 4962 passed`), and shard 1/3 on `government-id-checks.spec.ts` (`1 failed, 31 passed (3.4m)`). The vision pytest in one call ran past its 10-minute cap at 89% (`exit 124`), so it runs in two halves.

Unit tests per package (the turbo call and the reruns): ui 54, core 787, emrtd 318, signals 186, flow-spec 117, checks 3,464, dashboard 3,945, watchlist 718, e2e 109, node 253, config 152, contracts 2,283, db 1,194, flow 1,088, api 4,963. Statement coverage: ui 100%, core 99.85%, emrtd 94.97%, signals 96.31%, flow-spec 100%, checks 98.74%, dashboard 98.71%, watchlist 98.62%, e2e 97.15%, node 98.87%, config 100%, contracts 98.98%, db 95.39%, flow 95.27%, api 96.17%.
