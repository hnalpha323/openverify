# Phase 11, Workflow 11A Stage 4: integration-11a (TDD and validation evidence)

Agent: integration-11a (alone, last). Base `4db86122d`, start `cf23603cf`; this stage starts at `6f800d4e2`.
Every command ran from `/home/mhnoor/persona-opensource` after `source scripts/env.sh`. Load is `cat /proc/loadavg` (1, 5 and 15 minutes) before and after each call. Lock waits were 0 s on every Gradle, e2e, device and git lock. No call reached the 10-minute cap.

## 0. The phone first (the owner asked at launch)

Under the device lock: `adb -s <serial> get-state` answered `device` at once (no `adb connect` needed). The four device suites then ran at `7bfd03f20`, one connected task per hold:

| Task | Result (instrumentation XML) | Duration |
|---|---|---|
| `:openverify-sdk:connectedAndroidDeviceTest` | 14 tests, 0 failures, 0 skipped | 57 s |
| `:demo-app:connectedMinifiedSmokeAndroidTest` | 2, 0, 0 | 34 s |
| `:openverify-nfc:connectedDebugAndroidTest` | 2, 0, 0 | 37 s |
| `:openverify-face:connectedDebugAndroidTest` | 4, 0, 0 | 327 s |

`check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4` printed "connected tests: 22 passed" and exited 0. Every Gradle exit was 1, which is KP10-31 (the serial's colon), not a finding. The phone was a Pixel 9 on Android 17. The suites ran again last (section 9).

## 1. Settled blockers and deviations (test-first)

Each line is RED (the commit, and how it failed), then GREEN. The suites are named relative to `apps/api/src` unless a path says otherwise.

1. **The cross-tenant entry points** that api-redeem, api-consent and workflow-connect lacked.
   - RED `a69c6dc01`: the job suite, the client-side reservation and the destination accept now run on the production binding.
     - The job suite failed 7 of 8 with `NotImplementedError: connect: markInboundShareToken is not built yet`.
     - The two route cases answered 501.
   - GREEN `20ac91d65`: `crossTenant.markInboundShareToken` and `reserveInboundShareToken` (409 `share_token_in_use`). `readRedemptionSource` now carries `policyVersion` and the copy `material`. The bindings in `redeem.ts` and `client-side.ts` use them. 305 of 305 Connect suites pass.
   - One expectation changed: the double had fixed the source organisation's name as 'Example Partner'; the real one is the seeded tenant's.
2. **The worker.**
   - RED `842dfad43`: the redeem job got no publisher (`expected 'undefined' to be 'function'`).
   - RED `ad8743a63`: a source test showed that `main()` gives the workflow services no `connect-redeem` producer.
   - GREEN `d26cb8b67`: the job gets `events` and the workflow services as `api`. `main()` creates the producer while Connect is on and closes it. 63 of 63.
3. **A token a workflow step made.**
   - RED `f8218fb9c`:
     - contracts: a `workflow-run` creator did not parse;
     - the action: `execution_error`.
   - GREEN `b6991a998`: `shareTokenRelationshipsSchema.creator` accepts `{type: 'workflow-run', id: wfr_}`, and api-connect's builder serves it. The OpenAPI snapshot was regenerated: 4,771 contracts tests; the step's success case passes.
4. **The console activation's ports.**
   - RED `316156f53`: `activated-at` came from the system clock, not the injected one.
   - GREEN `31d53f8ae`: `routes/dashboard/index.ts` passes `options.admin.api`. The suite now stamps its step-up at the injected clock. 379 of 379.
5. **Client-side redemption needs `connect-share-tokens:redeem` (C238.5).**
   - RED `5f5a7b147`: `inquiries:write` alone answered 201 and reserved the token.
   - GREEN `dda167807`: 403, naming the scope, before anything is written.
6. **No built Connect route documents 501.**
   - RED `237bd2785`: 20 operations still did.
   - GREEN `7bfd03f20`: the 501 was dropped from every Connect route, the three exits and the inquiry create, and the snapshot was regenerated.
7. **The console's Cloned banner (found by the 11A spec).** The dashboard inquiry read dropped `provenance`.
   - RED `b5d22e06f`.
   - GREEN `2c9043769`: `toInquiryResource` wraps the resource in `withInquiryProvenance`.
8. **A live step beside an uncounted clone (found by stackTest).** With accept-cloned-results off, a cloned pass answered "already passed" at create, then at submit.
   - RED `86d99ba17` and `104edc2ab`: both answered 409.
   - GREEN `dfa6aee95` and `a7c4bfa7b`: `services/flow.ts` counts only `countedVerifications` at both sites. 463 flow-route tests pass.
9. **KP11-3.**
   - RED `db8056e0f`: `ci-workflow.test.sh` failed 2 checks: one fewer than 2,732 passed, and 10E's 2,691 passed.
   - GREEN `230c6238b`: `ci.yml` holds 2,732. 411 checks pass, 0 skipped.

## 2. New deliverables

- **`@openverify/node`'s connect group.**
  - RED `3a2161b70`: 17 endpoint cases failed.
  - GREEN `dc8765a1e`: `connectConnections`, `connectShareTokens` (with `peek` and `redeem`) and `connectConsentRecords` (with `attest` and `withdraw`).
  - Types: stub `60bcb44a8`, RED `34c7422cc`, GREEN `614aae065`. `isConnectEventName`, plus `Connection`, `ShareToken`, `ConsentRecord` and `ConnectEventName`.
  - README `338461d4e`. The suite is 504 tests at 98.62% lines.
- **The e2e stack seeds Connect.**
  - Stub `4966d012b`, RED `9c06c0677` (a record without the partner still parsed), GREEN `46ff28a7e`, lint `847634eb2`.
  - It runs `seed:dev --connect` and records `connect {partnerOrganizationId, partnerEnvironments, seededConnectionId, partnerAdmin}`.
- **The 11A spec** `e2e/tests/connect.spec.ts`, with `tests/support/connect.ts` (`73d6530cb`). Budget 90 s.
  - On the gate's fresh stack it took 21.0 s in shard 1; a second pass on a used stack took 14.7 s.
  - It was written as a full-stack spec over built behaviour, so it has no RED commit. It found defect 7.
- **The 11A Android stack test.**
  - Fixture builder and assert-only test: RED `2e06a3fb6` (no file), GREEN `29aecb0d7`.
  - `AndroidConnectFlowStackTest` and the `androidConnectFlow` property: `c4a935204`.
  - Its first runs found defect 8. It passes alone in 29 s and in the gate with 10A's and 10C's classes (3 of 3).
- **The cross-tenant probe** `security/cross-tenant-probe.integration.test.ts`, at `037042882`. It runs in 24 s.
  - It was written over built behaviour and found no defect, so it has no RED.
  - Its first run listed answers that differed only by the id the body named, and validation-first 400s. Both are now compared with the ids normalised.
- **The surface index's Connect rows** (`47d73d242`).
- **Format** (`c1047d784`): clients-connect's `share-consent.aria.yml` was formatted as its siblings are; `format:check` had found it.

## 3. The SDK host-test count (KP11-3)

`--rerun`, three groups: ui 532 (149 s), flow 427 (44 s) and rest 1,773 (100 s), none skipped. That is 2,732, which equals 2,691 (10E) + 5 (contracts-11a) + 36 (clients-connect). The floor is now 2,732. Screenshot tests: 97 over 217 goldens.

## 4. The Android gate (eleven calls, in order, this session)

| Call | Duration and result |
|---|---|
| (1) ui | 149 s |
| (1) flow | 44 s |
| (1) rest | 100 s |
| (2) | 65 s |
| (3) | 205 s |
| (4) | 25 s: demo 97 and 9; nfc 116; face 51 |
| (5) | 74 s |
| (6) | 21 s |
| (7) | 170 s |
| (8) | 24 s |
| (9) | 98 script tests OK; the three static checks 12 s |
| (10) | publish 22 s; consumer check 12 s; check-staged-repository passed |
| (11) | sdk,nfc 22 s; sdk,face 21 s; sdk,nfc,face 23 s |

Every call exited 0 with 0 s lock wait, at load 1.2 to 4.9. The first static-check attempt failed because `java` was not on that shell's PATH (env.sh was not sourced). It was re-run with the environment and exited 0.

## 5. The clean-build pass (Validation 9b)

`./gradlew clean`, from one new empty `GRADLE_USER_HOME`. The home grew to 2.9 GB, and Maven Central answered every request: no 429.

| Step | Duration |
|---|---|
| help | 80 s |
| clean | 18 s |
| testDebugUnitTest | 198 s |
| testAndroidHostTest (2,732 tests) | 274 s |
| koverVerify | 32 s |
| assembleDebug | 71 s |
| `:openverify-sdk:assemble` | 105 s |
| lint | 184 s |
| CI's second step | 167 s |
| the three static checks | 11 s |
| the three manifest calls | 72, 68 and 73 s |
| device-test compile | 215 s |
| sdk,nfc bundle and size | 156 s |
| sdk,face | 143 s |
| sdk,nfc,face release with the 16 KB and size checks | 162 s |
| staged repository | 71 s |
| consumer check | 39 s |

All exited 0. No lockfile and no `verification-metadata.xml` changed. This is the cold verify of contracts-11a's `okhttp-tls` line.

## 6. Whole-repo validation

| Step | Result | Duration | Load |
|---|---|---|---|
| (1) install | up to date | 0 s | 0.7 |
| (1) format:check | first run 1 (the aria snapshot), then 0 | 108 s | 0.9 |
| (2) typecheck | 17 tasks | 133 s | 1.0 to 5.8 |
| (2) lint, api | 0 | 208 s | 5.3 to 2.1 |
| (2) lint, dashboard and contracts | 0 | 216 s | 1.9 to 1.5 |
| (2) lint, the other 14 | 0 | 311 s | 1.3 to 1.9 |
| (3) fetch_models, fetch_data, person_a_id | 0 | 0 to 1 s | 1.7 |
| (4) build:variant-groups | 0 | 6 s | 1.7 |
| (5) watchlist and e2e | 820 tests (98.61%) and 144 (96.94%) | 274 s | 1.7 to 1.3 |
| (5) db | 2,272 (89.86%) | 156 s | 1.2 to 10.4 |
| (5) dashboard | 2 shards (198 and 212 s) and a merge: 6,985 in 604 files (95.66% lines) | 6 s merge | 5 to 8 |
| (5) the other 11 packages | 0 | 163 s | 4.9 to 14.5 |
| (5) `@openverify/js` | 19 | 5 s | 14.5 |
| (5) the API | 8 shards (151 to 189 s) and a 38 s merge: 10,117 in 766 files (94.28% lines) | | 6 to 14 |
| (6) benchmark:typecheck | 0 | 57 s | 4.3 |
| (6) benchmark:test | 119 | 11 s | 2.4 |
| (7) integration db | 87 | 87 s | 2.2 |
| (7) graph | 13 | 33 s | 16.4 |
| (7) api 1/3 | 103 | 80 s | 9.8 |
| (7) api 2/3 | 115 | 161 s | 16.9 |
| (7) api 3/3 | 178 (396 in all, the probe's 2 included) | 97 s | 8.0 |
| (8) vision static | 0 | 1 s | 13.0 |
| (8) vision first half | 1,358 tests | 188 s | 13.0 to 1.6 |
| (8) vision second half | 1,281 tests, 97.41% | 391 s | 1.5 to 1.4 |
| (10) `openapi:write` and `workflow-docs:write` | no diff | 22 s and 1 s | 5.4 |
| (11) mocked flow suite | 349 | 123 s | 3.5 to 11.6 |
| (11) stack up | | 95 s | 10.4 to 6.3 |
| (11) chromium shards | 49, 48, 49, 47 (193) | 293, 326, 301, 385 s | 3 to 6.2 |
| (11) console sweep | 108 (104 + the four Connect pages) | 306 s | 4.4 |
| (11) stackTest | 3 classes, 3 of 3 | 56 s | 4.9 |
| (11b) WebKit theme-csp (Docker) | 7 of 7 | 13 s | 3.5 |
| (12) `openverify/apps:dev` | built | 243 s | 3.4 |
| (12) vision | built | 26 s | 2.4 |
| (12) code-runner | built | 44 s | 2.5 |
| (13) infra tests | 11 scripts, 1,267 checks (ci-workflow 411, 0 skipped), all 0 | | |
| (14) workflow benchmark, reported | effectful 16, 49 and 48 steps/s and control-flow 91, 212 and 208 steps/s, at 1, 8 and 32 clients | 135 s | 1.6 to 2.5 |
| (15) gitleaks | no leaks | 10 s | |

## 7. Not applicable in 11A

- `load/` (11D on).
- `fetch_asvs.py` and `fetch_masvs.py` (11E on).
- `cyclonedxBom` and `supply-chain.sh` (11C on).
- The helm lint, unittest and kubeconform line, and the kind.sh line: `deploy/helm/openverify/` is 11C's.
- `security/zap/run.sh` (11F on).
- `release:check` (11E on).
- The gitleaks PII config (11C's).
- `analytics:benchmark --measure`: 11D's (KP11-7). 11A added migration 0035 and changed the rollup SQL, so its container needs `--teardown` and `--seed` first.

## 8. PGlite migration time

integration-11a added no migration, so it took no new measurement. The before-and-after of 0035 is foundation-11a's. Cold went from 5,985 and 6,520 ms to 5,447 and 5,632 ms, and warm from 1,302 and 1,226 ms to 1,291 and 1,322 ms.

## 9. Device suites (last)

At `c1047d784` the phone answered `device`.

| Task | Instrumentation XML (time stamp, UTC) | Duration |
|---|---|---|
| `:openverify-sdk:connectedAndroidDeviceTest` | 14, 0 failures (08:09:34) | 46 s |
| `:demo-app:connectedMinifiedSmokeAndroidTest` | 2, 0 (08:10:11) | 37 s |
| `:openverify-nfc:connectedDebugAndroidTest` | 2, 0 (08:10:48) | 37 s |
| `:openverify-face:connectedDebugAndroidTest` | 4, 0 (08:16:21) | 328 s |

`check-connected-results.sh` printed "connected tests: 22 passed" and exited 0. Gradle exited 1 on each call (KP10-31). 11A added no device test.
