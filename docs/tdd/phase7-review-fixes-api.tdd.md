# Phase 7 review fixes: API, flow, packages and Android (Workflow 7C Stage 4)

The evidence of the `fix-api` fixer, one section per item, each with the commands actually run and their trimmed output. RED is the regression test seen failing for the intended reason; GREEN is the same test after the minimal fix. Order: K7C-1 and K7A-8 first (the console waits for them), then the blocking list, then the second list.

## K7C-1: a reviewer sees which verifications came from a rejected handoff (C96.3)

**RED contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run src/verifications.test.ts src/handoffs.test.ts
 ❯ src/verifications.test.ts (36 tests | 2 failed) 131ms
     × is built on every verification read, true for one the phone created before a rejection 29ms
     × parses on every type, and is optional so earlier answers still parse 5ms
 ❯ src/handoffs.test.ts (12 tests | 1 failed) 68ms
     × serves the method, the issuing session and the distance facts of a redeemed session 26ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/handoffs.test.ts > the handoff session fields (C91.1, C96.4) > serves the method, the issuing session and the distance facts of a redeemed session
AssertionError: expected { status: 'active', …(11) } to match object { 'device-handoff-method': 'qr', …(5) }
 FAIL  src/verifications.test.ts > from-rejected-handoff (C96.3) > is built on every verification read, true for one the phone created before a rejection
AssertionError: expected { status: 'submitted', …(26) } to match object { 'from-rejected-handoff': true }
 FAIL  src/verifications.test.ts > from-rejected-handoff (C96.3) > parses on every type, and is optional so earlier answers still parse
AssertionError: expected { status: 'submitted', …(3) } to match object { 'from-rejected-handoff': true }
 Test Files  2 failed (2)
      Tests  3 failed | 45 passed (48)
```

**RED API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run src/routes/server/verifications.test.ts src/routes/server/inquiry-session-handoff.test.ts
 ❯ src/routes/server/inquiry-session-handoff.test.ts (2 tests | 2 failed) 3935ms
     × are null on a session no handoff created 887ms
     × serve the redeemed session its method, issuing session, time and distance facts, unmasked 282ms
 ❯ src/routes/server/verifications.test.ts (12 tests | 1 failed) 5331ms
     × tells a reviewer which verifications came from the rejected session, to every reader 827ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/inquiry-session-handoff.test.ts > the session handoff fields (C91.1, C96.4, C96.7) > are null on a session no handoff created
AssertionError: expected { status: 'active', …(40) } to match object { 'device-handoff-method': null, …(6) }
 FAIL  src/routes/server/inquiry-session-handoff.test.ts > the session handoff fields (C91.1, C96.4, C96.7) > serve the redeemed session its method, issuing session, time and distance facts, unmasked
AssertionError: expected { status: 'active', …(40) } to match object { …(7) }
 FAIL  src/routes/server/verifications.test.ts > from-rejected-handoff (C96.3) > tells a reviewer which verifications came from the rejected session, to every reader
AssertionError: expected { status: 'failed', …(26) } to match object { 'from-rejected-handoff': true }
+   "status": "failed",
 Test Files  2 failed (2)
      Tests  3 failed | 11 passed (14)
```

**GREEN contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run src/verifications.test.ts src/handoffs.test.ts
 Test Files  2 passed (2)
      Tests  48 passed (48)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run src/routes/server/verifications.test.ts src/routes/server/inquiry-session-handoff.test.ts src/jobs/records.test.ts src/routes/dashboard/index.test.ts
 ❯ src/routes/server/verifications.test.ts (12 tests | 1 failed) 6311ms
     × returns a government ID verification with its checks and files 255ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/verifications.test.ts > GET /api/v1/verifications/:id > returns a government ID verification with its checks and files
AssertionError: expected { …(4) } to deeply equal { …(4) }
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 72 passed (73)
```

**GREEN contracts, fixtures** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/fixtures.test.ts src/verifications.test.ts src/handoffs.test.ts
 Test Files  3 passed (3)
      Tests  350 passed (350)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/verifications.test.ts src/routes/server/inquiry-session-handoff.test.ts src/jobs/records.test.ts
 Test Files  3 passed (3)
      Tests  35 passed (35)
```

**GREEN API, dashboard and events** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/dashboard/index.test.ts src/jobs/records.test.ts
 Test Files  2 passed (2)
      Tests  61 passed (61)
```

## K7A-8: system audit entries are served (owner decisions 3 after 7A, 5 after 7B)

**RED contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/user-audit-logs.test.ts
 ❯ src/user-audit-logs.test.ts (19 tests | 3 failed) 89ms
     × is served with the system actor, which names no id 27ms
     × is built from a record with the system actor 4ms
     × records who did what to which resource 12ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/user-audit-logs.test.ts > an entry no principal wrote (owner decisions 3 after 7A and 5 after 7B) > is served with the system actor, which names no id
ZodError: [
 FAIL  src/user-audit-logs.test.ts > an entry no principal wrote (owner decisions 3 after 7A and 5 after 7B) > is built from a record with the system actor
 FAIL  src/user-audit-logs.test.ts > user-audit-log resource (C15) > records who did what to which resource
AssertionError: expected [ 'user', 'api-key' ] to deeply equal [ 'user', 'api-key', 'system' ]
 Test Files  1 failed (1)
      Tests  3 failed | 16 passed (19)
```

**RED API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/audit-log.test.ts
 ❯ src/services/audit-log.test.ts (18 tests | 9 failed) 3986ms
     × serves an entry no principal wrote as the system actor, masked like every entry 50ms
     × serves the handoff.issued entry the system writes 91ms
     × serves the handoff.review-requested entry the system writes 54ms
     × serves the importer.completed entry the system writes 41ms
     × serves the graph-query.completed entry the system writes 25ms
     × serves the user.mfa-reset entry the system writes 45ms
     × serves the environment.otp-sms-budget-tripped entry the system writes 50ms
     × lists newest first, system entries included, as a C1 list document 76ms
     × gets one entry by id, a system entry too, and 404 across environments 53ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves an entry no principal wrote as the system actor, masked like every entry
AssertionError: expected undefined to match object { …(2) }
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the handoff.issued entry the system writes
AssertionError: expected undefined to match object { action: 'handoff.issued', …(2) }
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the handoff.review-requested entry the system writes
AssertionError: expected undefined to match object { …(3) }
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the importer.completed entry the system writes
TypeError: Unknown ID prefix "imp"
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the graph-query.completed entry the system writes
TypeError: Unknown ID prefix "gqr"
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the user.mfa-reset entry the system writes
AssertionError: expected undefined to match object { action: 'user.mfa-reset', …(2) }
 FAIL  src/services/audit-log.test.ts > toUserAuditLogResource > serves the environment.otp-sms-budget-tripped entry the system writes
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/user-audit-logs.test.ts src/fixtures.test.ts
 Test Files  2 passed (2)
      Tests  323 passed (323)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/audit-log.test.ts src/routes/server/user-audit-logs.test.ts src/routes/dashboard/audit-logs.test.ts
 ❯ src/services/audit-log.test.ts (18 tests | 1 failed) 2148ms
     × filters by action, actor, resource and creation time, and pages with the next link 60ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/audit-log.test.ts > listUserAuditLogDocument and getUserAuditLogDocument > filters by action, actor, resource and creation time, and pages with the next link
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 30 passed (31)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/audit-log.test.ts src/routes/server/user-audit-logs.test.ts src/routes/dashboard/audit-logs.test.ts
 Test Files  3 passed (3)
      Tests  31 passed (31)
```

## K7A-1: a session-cap expiry deletes a canceled capture's objects

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/signals/session-cap-objects.test.ts
 ❯ src/services/signals/session-cap-objects.test.ts (3 tests | 3 failed) 3049ms
     × on a resume 1031ms
     × on a one-time-link redemption 441ms
     × on a handoff redemption 29ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a resume
AssertionError: expected [ Array(1) ] to not include 'env_01M6CJRYXQ9NBA8TXKWF7Z9DNB/Coyi6A…'
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a one-time-link redemption
AssertionError: expected [ …(2) ] to not include 'env_01M6CJRYXQ9NBA8TXKWF7Z9DNB/ux1aza…'
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a handoff redemption
Error: expected HTTP 201, got 422: {"type":"about:blank","title":"Unprocessable Content","status":422,"detail":"A device_handoff step needs the environment’s organization-display-name, which the pho
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**RED, the handoff path with the environment's display name** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/signals/session-cap-objects.test.ts
 ❯ src/services/signals/session-cap-objects.test.ts (3 tests | 3 failed) 3408ms
     × on a resume 936ms
     × on a one-time-link redemption 427ms
     × on a handoff redemption 403ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a resume
AssertionError: expected [ Array(1) ] to not include 'env_01M6CJSRTP0JQYW36GMPJY3P96/7Kxrgf…'
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a one-time-link redemption
AssertionError: expected [ …(2) ] to not include 'env_01M6CJSRTP0JQYW36GMPJY3P96/g5P-El…'
 FAIL  src/services/signals/session-cap-objects.test.ts > a session-cap expiry deletes the canceled capture’s objects (K7A-1) > on a handoff redemption
AssertionError: expected [ …(3) ] to not include 'env_01M6CJSRTP0JQYW36GMPJY3P96/NQRUQf…'
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/signals/session-cap-objects.test.ts src/services/signals/sessions.test.ts src/services/handoff/flow-handoffs.test.ts
 Test Files  3 passed (3)
      Tests  36 passed (36)
```

## K7A-4: the desktop shows the completion screen after the phone completes (C96.8)

**RED** (exit 1)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow/flow-renderer-handoff-end.test.tsx
 ❯ src/flow/flow-renderer-handoff-end.test.tsx (2 tests | 1 failed) 758ms
     × shows the template’s completion screen, even though its last signal body is refused 534ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/flow/flow-renderer-handoff-end.test.tsx > the desktop after the phone completes (K7A-4, C96.8) > shows the template’s completion screen, even though its last signal body is refused
Error: expect(element).toHaveTextContent()
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

**GREEN** (exit 0)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow/flow-renderer-handoff-end.test.tsx src/flow/flow-renderer-signals.test.tsx src/flow/flow-renderer.test.tsx
 Test Files  3 passed (3)
      Tests  50 passed (50)
```

## K7A-5 and K7A-7: the contract, `handed-off` and `next-sequence`

**RED contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/handoffs.test.ts src/flow-signals.test.ts src/fixtures.test.ts
 ❯ src/flow-signals.test.ts (11 tests | 1 failed) 50ms
     × tells the collector its next sequence, optional so earlier answers parse (K7A-7) 9ms
 ❯ src/handoffs.test.ts (13 tests | 2 failed) 49ms
     × is served on GET /flow/session with the phone context (F30) 18ms
     × says the issuing session is handed off, and leaves it out otherwise 3ms
 ❯ src/fixtures.test.ts (306 tests | 4 failed) 584ms
     × flow-session.json parses and re-serializes unchanged 14ms
     × flow-session-handed-off.json parses and re-serializes unchanged 4ms
     × flow-session.json carries the default flow 4ms
     × flow-session.json names the environment kind 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/fixtures.test.ts > API golden fixtures (C8, C20) > flow-session.json parses and re-serializes unchanged
ZodError: [
 FAIL  src/fixtures.test.ts > API golden fixtures (C8, C20) > flow-session-handed-off.json parses and re-serializes unchanged
 FAIL  src/fixtures.test.ts > API golden fixtures (C8, C20) > flow-session.json carries the default flow
 FAIL  src/fixtures.test.ts > Phase 1 fixtures carry what Phase 2 servers send (C10, C14, C19) > flow-session.json names the environment kind
 FAIL  src/flow-signals.test.ts > POST /api/v1/flow/signals body (C94.2) > tells the collector its next sequence, optional so earlier answers parse (K7A-7)
 FAIL  src/handoffs.test.ts > the handoff state (C96.3, F01, V05) > is served on GET /flow/session with the phone context (F30)
AssertionError: expected false to be true // Object.is equality
 FAIL  src/handoffs.test.ts > the handoff member of a flow session (K7A-5) > says the issuing session is handed off, and leaves it out otherwise
 Test Files  3 failed (3)
      Tests  7 failed | 323 passed (330)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/handoffs.test.ts src/flow-signals.test.ts src/fixtures.test.ts
 Test Files  3 passed (3)
      Tests  330 passed (330)
```

## K7A-5 and K7A-7: the server, the web flow

**RED db, API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/flow/signals.test.ts src/services/handoff/flow-handoffs.test.ts
 ❯ src/routes/flow/signals.test.ts (15 tests | 1 failed) 9779ms
     × reports the next sequence on GET /flow/session: past the highest stored, and past the counted bodies (K7A-7) 306ms
 ❯ src/services/handoff/flow-handoffs.test.ts (23 tests | 1 failed) 13946ms
     × reads handed-off on its step, and neither the phone nor a later read does 14ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/flow/signals.test.ts > POST /flow/signals (C94.2) > reports the next sequence on GET /flow/session: past the highest stored, and past the counted bodies (K7A-7)
AssertionError: expected { integrity: true, recognition: false } to match object { 'next-sequence': +0 }
 FAIL  src/services/handoff/flow-handoffs.test.ts > the desktop reloaded while the phone works (K7A-5) > reads handed-off on its step, and neither the phone nor a later read does
ReferenceError: redeemed is not defined
 Test Files  2 failed (2)
      Tests  2 failed | 36 passed (38)
```

**RED db** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-repositories.test.ts
 ❯ src/repositories/signal-repositories.test.ts (21 tests | 1 failed) 3041ms
     × answers 0 for a new session, then one past the highest stored sequence and the counted bodies 161ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/signal-repositories.test.ts > nextSessionSignalSequence (K7A-7) > answers 0 for a new session, then one past the highest stored sequence and the counted bodies
AssertionError: expected -1 to be +0 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

**RED flow** (exit 1)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow/flow-position.test.ts src/flow/flow-renderer-signals.test.tsx src/steps/device-handoff/device-handoff-step.test.tsx
 ❯ src/flow/flow-position.test.ts (82 tests | 1 failed) 149ms
     × keeps a desktop reloaded while the phone works on the step (K7A-5) 28ms
 ❯ src/flow/flow-renderer-signals.test.tsx (5 tests | 1 failed) 981ms
     × starts at the session’s next sequence, and a refreshed sequence keeps the collection (K7A-7) 146ms
 ❯ src/steps/device-handoff/device-handoff-step.test.tsx (11 tests | 1 failed) 1819ms
     × opens on its waiting screen, issuing nothing 517ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/flow/flow-position.test.ts > the device_handoff step (C96.1, F01, Stage 1a minimum) > keeps a desktop reloaded while the phone works on the step (K7A-5)
AssertionError: expected { kind: 'completion', …(1) } to deeply equal { kind: 'handoff', …(2) }
 FAIL  src/flow/flow-renderer-signals.test.tsx > FlowRenderer: the signal collection (C94.3, C94.6) > starts at the session’s next sequence, and a refreshed sequence keeps the collection (K7A-7)
AssertionError: expected undefined to be 6 // Object.is equality
 FAIL  src/steps/device-handoff/device-handoff-step.test.tsx > DeviceHandoffStep, reloaded while the phone works (K7A-5) > opens on its waiting screen, issuing nothing
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 Test Files  3 failed (3)
      Tests  3 failed | 95 passed (98)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/flow/signals.test.ts src/services/handoff/flow-handoffs.test.ts src/routes/handoff-routes.test.ts
 ❯ src/routes/flow/signals.test.ts (15 tests | 4 failed) 10281ms
     × reports null before consent, then session integrity under its notice, recorded on the session 1539ms
     × collects nothing under a consent step without the notice key, or with the tier off 433ms
     × adds device recognition only under its ticked optional key in consent mode 428ms
     × adds device recognition under its notice key in exempt mode 733ms
 ❯ src/services/handoff/flow-handoffs.test.ts (23 tests | 1 failed) 14946ms
     × redeems once: a new session with its handoff fields, its own consent, and the context screen 380ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/flow/signals.test.ts > GET /flow/session: the collection tiers (C94.6, P14) > reports null before consent, then session integrity under its notice, recorded on the session
AssertionError: expected { integrity: true, …(2) } to deeply equal { integrity: true, recognition: false }
 FAIL  src/routes/flow/signals.test.ts > GET /flow/session: the collection tiers (C94.6, P14) > collects nothing under a consent step without the notice key, or with the tier off
AssertionError: expected { integrity: false, …(2) } to deeply equal { Object (integrity, recognition) }
 FAIL  src/routes/flow/signals.test.ts > GET /flow/session: the collection tiers (C94.6, P14) > adds device recognition only under its ticked optional key in consent mode
AssertionError: expected { integrity: true, …(2) } to deeply equal { integrity: true, recognition: true }
 FAIL  src/routes/flow/signals.test.ts > GET /flow/session: the collection tiers (C94.6, P14) > adds device recognition under its notice key in exempt mode
 FAIL  src/services/handoff/flow-handoffs.test.ts > the phone’s preview, decline and redemption (C96.3, P15, P28, V04) > redeems once: a new session with its handoff fields, its own consent, and the
AssertionError: expected { 'step-id': 'device_handoff', …(2) } to deeply equal { 'step-id': 'device_handoff', …(1) }
 Test Files  2 failed | 1 passed (3)
      Tests  5 failed | 46 passed (51)
```

**GREEN db** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-repositories.test.ts
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

**GREEN flow** (exit 0)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow/flow-position.test.ts src/flow/flow-renderer-signals.test.tsx src/steps/device-handoff/device-handoff-step.test.tsx src/flow/flow-renderer-handoff-end.test.tsx
 Test Files  4 passed (4)
      Tests  101 passed (101)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/flow/signals.test.ts src/services/handoff/flow-handoffs.test.ts src/routes/handoff-routes.test.ts src/services/flow-preconditions.test.ts
 Test Files  4 passed (4)
      Tests  59 passed (59)
```

## K7A-6 and K7A-7: Android (the wire members compile with the RED, so the coordinator tests are the RED)

**RED Kotlin** (exit 1)

```text
$ (cd android) ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.flow.FlowCoordinatorTest --tests dev.openverify.sdk.flow.FlowCoordinatorFormTest --tests dev.openverify.sdk.signals.FlowCoordinatorSignalsTest --tests dev.openverify.sdk.model.ContractFixturesTest
FlowCoordinatorFormTest > a typed step's failed attempt with no retry hints waits for the inquiry to fail, with attempts left (K7A-6, C50_5)() FAILED
FlowCoordinatorTest > a failed attempt with no retry hints waits for the inquiry to fail, with attempts left (K7A-6, C30_1)() FAILED
FlowCoordinatorSignalsTest > a later launch numbers its body from the session's next sequence (K7A-7)() FAILED
239 tests completed, 3 failed
> Task :openverify-sdk:testAndroidHostTest FAILED
FAILURE: Build failed with an exception.
Execution failed for task ':openverify-sdk:testAndroidHostTest'.
BUILD FAILED in 2m 4s
```

**GREEN Kotlin** (exit 1)

```text
$ (cd android) ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest
FlowCoordinatorTest > when the last attempt fails, the flow waits for the inquiry to fail instead of asking for photos the server refuses() FAILED
1333 tests completed, 1 failed
> Task :openverify-sdk:testAndroidHostTest FAILED
FAILURE: Build failed with an exception.
Execution failed for task ':openverify-sdk:testAndroidHostTest'.
BUILD FAILED in 2m 49s
```

**GREEN Kotlin, the whole host suite** (exit 1)

```text
$ (cd android) ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest
FlowCoordinatorTest > when the last attempt fails, the flow waits for the inquiry to fail instead of asking for photos the server refuses() FAILED
1333 tests completed, 1 failed
> Task :openverify-sdk:testAndroidHostTest FAILED
FAILURE: Build failed with an exception.
Execution failed for task ':openverify-sdk:testAndroidHostTest'.
BUILD FAILED in 2m 9s
```

**GREEN Kotlin, the whole host suite** (exit 0)

```text
$ (cd android) ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest
BUILD SUCCESSFUL in 3m 32s
```

## K7B-1: redacting an account or an inquiry reaches its transactions (owner decision 1 after 7B)

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/redaction-transactions.test.ts src/services/redaction.test.ts
 ❯ src/services/redaction-transactions.test.ts (9 tests | 7 failed) 6884ms
     × redacts those naming the inquiry or a verification, and leaves the account’s 1123ms
     × records the redaction as the system, once, and stages one event per transaction 589ms
     × redacts every kind of link, and leaves no field and no object 614ms
     × stays through a cascade, which never uses include-never 450ms
     × redacts an account, its inquiry and a transaction linked to both exactly once in one pass 514ms
     × leaves a failed object delete to the C16 purge, without failing the redaction 365ms
     × catches up with a transaction linked while the inquiry was being redacted 385ms
 ❯ src/services/redaction.test.ts (25 tests | 1 failed) 12179ms
     × leaves nothing of the subject in any table or in storage 1322ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/redaction-transactions.test.ts > an inquiry’s redaction reaches its transactions (K7B-1) > redacts those naming the inquiry or a verification, and leaves the account’s
AssertionError: expected { …(12) } to match object { …(2) }
 FAIL  src/services/redaction-transactions.test.ts > an inquiry’s redaction reaches its transactions (K7B-1) > records the redaction as the system, once, and stages one event per transaction
AssertionError: expected [] to have a length of 1 but got +0
 FAIL  src/services/redaction-transactions.test.ts > an account’s redaction reaches its transactions (K7B-1) > redacts every kind of link, and leaves no field and no object
 FAIL  src/services/redaction-transactions.test.ts > a `never` field (owner decision 1 after 7B) > stays through a cascade, which never uses include-never
AssertionError: expected { ledger: 'AML record', …(1) } to deeply equal { ledger: 'AML record' }
 FAIL  src/services/redaction-transactions.test.ts > the cascade stop rule (K7B-1, Phase 8) > redacts an account, its inquiry and a transaction linked to both exactly once in one pass
 FAIL  src/services/redaction-transactions.test.ts > after the commit (K7B-1, F04) > leaves a failed object delete to the C16 purge, without failing the redaction
AssertionError: expected Buffer[ 161, 195, 109, 175, 208, …(-56) ] to be null
 FAIL  src/services/redaction-transactions.test.ts > after the commit (K7B-1, F04) > catches up with a transaction linked while the inquiry was being redacted
 FAIL  src/services/redaction.test.ts > redactAccount (C16) > leaves nothing of the subject in any table or in storage
AssertionError: expected '[{"id":"acc_01M6CMD4QD66JFT0FSGFSXM8K…' not to contain 'Zyxw-synthetic-pii'
Received: "[{"id":"acc_01M6CMD4QD66JFT0FSGFSXM8KV","environmentId":"env_01M6CMD4Q224PB2HGQFGZ0646A","accountTypeId":"acctp_01M6CMD4Q40A52XAZ10P3QBRX8","referenceId":"ref-acc_01M6CMD4QE4ZN215PJD3ERVVJ3
 Test Files  2 failed (2)
      Tests  8 failed | 26 passed (34)
```

**GREEN** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/redaction-transactions.test.ts src/services/redaction.test.ts src/services/transactions/transactions.test.ts src/services/retention.test.ts
 ❯ src/services/redaction.test.ts (25 tests | 1 failed) 18294ms
     × finishes the file deletion on a retry when storage failed 448ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/redaction.test.ts > redactInquiry (C16) > finishes the file deletion on a retry when storage failed
AssertionError: promise resolved "{ …(2) }" instead of rejecting
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 71 passed (72)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/redaction-transactions.test.ts src/services/redaction.test.ts
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

## K7B-2: an account's graph component is served (owner decision 6 after 7B, C101.6)

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/account-graph-component.test.ts
 ❯ src/routes/server/account-graph-component.test.ts (6 tests | 5 failed) 2157ms
     × answers disabled while the setting is off, whatever a past run left 396ms
     × answers not-computed for an account newer than the last run 46ms
     × answers computed with its size and time, never the run-local component id 42ms
     × needs graph:read; accounts:read alone is refused 36ms
     × answers a redacted account as GET /accounts/:id does 38ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/account-graph-component.test.ts > GET /accounts/:id/graph-component (C101.6) > answers disabled while the setting is off, whatever a past run left
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/accounts/acc_01M6CMMPJXG30JD2B6863Q711X/graph-component.","instance":"/
 FAIL  src/routes/server/account-graph-component.test.ts > GET /accounts/:id/graph-component (C101.6) > answers not-computed for an account newer than the last run
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/accounts/acc_01M6CMMPNR683DGH7YGQMK2BBW/graph-component.","instance":"/
 FAIL  src/routes/server/account-graph-component.test.ts > GET /accounts/:id/graph-component (C101.6) > answers computed with its size and time, never the run-local component id
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/accounts/acc_01M6CMMPPZX00J3FKJ6K2FDXRR/graph-component.","instance":"/
 FAIL  src/routes/server/account-graph-component.test.ts > GET /accounts/:id/graph-component (C101.6) > needs graph:read; accounts:read alone is refused
AssertionError: expected 404 to be 403 // Object.is equality
 FAIL  src/routes/server/account-graph-component.test.ts > GET /accounts/:id/graph-component (C101.6) > answers a redacted account as GET /accounts/:id does
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches DELETE /api/v1/accounts/acc_01M6CMMPTYR9SD450EME8DJE1C.","instance":"/api/v1/accoun
 Test Files  1 failed (1)
      Tests  5 failed | 1 passed (6)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/account-graph-component.test.ts src/routes/server/openapi.test.ts
 FAIL  src/routes/server/account-graph-component.test.ts [ src/routes/server/account-graph-component.test.ts ]
ReferenceError: resourceSchema is not defined
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/graph-queries.test.ts src/fixtures.test.ts src/vocabulary.test.ts
 FAIL  src/fixtures.test.ts [ src/fixtures.test.ts ]
ReferenceError: resourceSchema is not defined
 FAIL  src/graph-queries.test.ts [ src/graph-queries.test.ts ]
 Test Files  2 failed | 1 passed (3)
      Tests  15 passed (15)
```

**GREEN node** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 FAIL  src/resources.test.ts [ src/resources.test.ts ]
ReferenceError: resourceSchema is not defined
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/account-graph-component.test.ts src/plugins/openapi.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/graph-queries.test.ts src/fixtures.test.ts src/vocabulary.test.ts
 Test Files  3 passed (3)
      Tests  345 passed (345)
```

**GREEN node** (exit 0)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 Test Files  1 passed (1)
      Tests  163 passed (163)
```

## R001: `ip-retention-days` deletes the `ip_address` graph rows (C91.7)

**RED** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-retention.test.ts
 ❯ src/repositories/signal-retention.test.ts (10 tests | 3 failed) 2574ms
     × deletes the ip_address rows past the window, and every other row stays 80ms
     × keeps them while ip-retention-days is unset 47ms
     × takes a batch at a time, so the C16 pass drains them 57ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > deletes the ip_address rows past the window, and every other row stays
Error: Failed query: 
Serialized Error: { length: 510, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMW124P68B3M8QJ1RV56AF, 14, d9ae182509f7cc82099342db572da2ae23dc5fe43b60afaa6662c31478e20100, 
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > keeps them while ip-retention-days is unset
Serialized Error: { length: 510, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMW14MS00AM44QSVG4TKFB, 14, 34552fd68a62f5665b34c3c8304e6f9bc780b2ca46093f15630c70f9798f739c, 
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > takes a batch at a time, so the C16 pass drains them
Serialized Error: { length: 510, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMW166T215B17TK829566J, 14, 2c8cfa82b2984b76db22828040c9574d577c90b10f44350c4b51fa52c7ce7cb1, 
 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

**RED, with the setup corrected (the first run stopped at a check constraint)** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-retention.test.ts
 ❯ src/repositories/signal-retention.test.ts (10 tests | 2 failed) 2422ms
     × deletes the ip_address rows past the window, and every other row stays 81ms
     × takes a batch at a time, so the C16 pass drains them 60ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > deletes the ip_address rows past the window, and every other row stays
Error: Failed query: update graph_attributes set first_seen_at = $1::timestamptz
Serialized Error: { length: 517, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMWP1X8VHC93QPC1987CFA, 14, 2e99ac002a0ef079b766d9eb82ac0915665617df3456e8b25d3995d9596fc9ec, 
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > takes a batch at a time, so the C16 pass drains them
Serialized Error: { length: 518, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMWP6A0F7BH21ZVCBA1QRC, 14, 66bfaf90459748fd258055293bdf33d20948586f7b116f2b0dfd1a98ddd74305, 
 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```

**GREEN** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-retention.test.ts src/repositories/list-plumbing.test.ts
 ❯ src/repositories/signal-retention.test.ts (10 tests | 2 failed) 2796ms
     × deletes the ip_address rows past the window, and every other row stays 90ms
     × takes a batch at a time, so the C16 pass drains them 74ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > deletes the ip_address rows past the window, and every other row stays
Error: Failed query: update graph_attributes set first_seen_at = $1::timestamptz
Serialized Error: { length: 517, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMWWTCG7DX78A113RSV269, 14, d858b2bcf231280b74ec776c730c2bc81346f6298f8adf43b1f934ffcea87734, 
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > takes a batch at a time, so the C16 pass drains them
Serialized Error: { length: 518, severity: 'ERROR', code: '23514', detail: 'Failing row contains (env_01M6CMWX0GG37W7CSVG5TA2MQB, 14, 787752ed5d4652fa8da53c58cfff69d0c53961443b1800be57a1fb430542398b, 
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 25 passed (27)
```

**RED, with the setup corrected** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-retention.test.ts
 ❯ src/repositories/signal-retention.test.ts (10 tests | 2 failed) 2297ms
     × deletes the ip_address rows past the window, and every other row stays 101ms
     × takes a batch at a time, so the C16 pass drains them 85ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > deletes the ip_address rows past the window, and every other row stays
AssertionError: expected +0 to be 1 // Object.is equality
 FAIL  src/repositories/signal-retention.test.ts > nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2) > takes a batch at a time, so the C16 pass drains them
 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```

**GREEN** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/signal-retention.test.ts src/repositories/list-plumbing.test.ts
 Test Files  2 passed (2)
      Tests  27 passed (27)
```

## R002, R004, R006: a source not read is a gap; an undated publication is read; a frozen exit list is stale

**RED signals** (exit 1)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/network/lookup.test.ts
 ❯ src/network/lookup.test.ts (29 tests | 4 failed) 175ms
       × makes the fact null with its reason, never not_in_known_ranges, beside a fresh sibling 13ms
       × says list_unavailable for a source never loaded 2ms
       × never reads a false from a Tor list while another of the role was not read 1ms
       × reads every other fact the same way: the ASN, the country and the relay 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/network/lookup.test.ts > evaluateNetwork: unknowns are null with their reason, never false (C90.3, C93.3) > a source of the role that was not read (R002, ADR 0006) > makes the fact null wit
AssertionError: expected { value: null, …(3) } to match object { value: null, …(1) }
 FAIL  src/network/lookup.test.ts > evaluateNetwork: unknowns are null with their reason, never false (C90.3, C93.3) > a source of the role that was not read (R002, ADR 0006) > says list_unavailable f
AssertionError: expected { value: null, …(3) } to match object { value: true }
 FAIL  src/network/lookup.test.ts > evaluateNetwork: unknowns are null with their reason, never false (C90.3, C93.3) > a source of the role that was not read (R002, ADR 0006) > never reads a false fro
AssertionError: expected { Object (value, nullReason, ...) } to match object { value: null, …(1) }
 FAIL  src/network/lookup.test.ts > evaluateNetwork: unknowns are null with their reason, never false (C90.3, C93.3) > a source of the role that was not read (R002, ADR 0006) > reads every other fact 
 Test Files  1 failed (1)
      Tests  4 failed | 25 passed (29)
```

**RED API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/network/snapshots.test.ts
 ❯ src/network/snapshots.test.ts (11 tests | 3 failed) 1750ms
     × is read by the lookup, dated by when it was applied, and shown as such 142ms
     × turns stale by its own publication time, whatever the last check says 23ms
     × is reported, so the lookup reads the gap and never "not listed" 43ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/network/snapshots.test.ts > an undated publication (R004, C92.2) > is read by the lookup, dated by when it was applied, and shown as such
AssertionError: expected { sourceId: 'cloudflare-ips', …(5) } to match object { freshness: 'fresh', …(1) }
 FAIL  src/network/snapshots.test.ts > a frozen exit list (R006, C92.4) > turns stale by its own publication time, whatever the last check says
AssertionError: expected 'fresh' to be 'stale' // Object.is equality
 FAIL  src/network/snapshots.test.ts > a source that could not be loaded (R002) > is reported, so the lookup reads the gap and never "not listed"
TypeError: loader.unloaded is not a function
 Test Files  1 failed (1)
      Tests  3 failed | 8 passed (11)
```

**GREEN signals** (exit 0)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/network
 Test Files  11 passed (11)
      Tests  111 passed (111)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/network src/jobs/report-types/ip-address.test.ts
 Test Files  11 passed (11)
      Tests  119 passed (119)
```

## R003: a CSV of refused rows stops at the row cap

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/importers/read-file.test.ts -t R003
 ❯ src/services/importers/read-file.test.ts (57 tests | 1 failed | 54 skipped) 36306ms
       × stops at the cap, not at the end of the file: its cost is bounded by the cap 29389ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/importers/read-file.test.ts > readImportFile: the row cap (C100.2) > a file of refused rows (R003) > stops at the cap, not at the end of the file: its cost is bounded by the cap
AssertionError: expected 29981.01 to be less than 15000
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed | 54 skipped (57)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/importers/read-file.test.ts
 Test Files  1 passed (1)
      Tests  57 passed (57)
```

## K7A-3 and K7A-17: the per-session one-time link takes its lifetime, in the API and in @openverify/node

**RED API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/signals/sessions.test.ts -t K7A-3
 ❯ src/services/signals/sessions.test.ts (12 tests | 1 failed | 11 skipped) 4172ms
     × gives the link the requested lifetime (K7A-3) 1154ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/signals/sessions.test.ts > POST /inquiry-sessions/:id/generate-one-time-link (C91.5) > gives the link the requested lifetime (K7A-3)
AssertionError: expected '2026-10-21T12:00:00.000Z' to be '2026-10-20T12:10:00.000Z' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 11 skipped (12)
```

**RED node** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts -t K7A-17
 ❯ src/resources.test.ts (164 tests | 1 failed | 163 skipped) 32ms
     × inquirySessions.generateOneTimeLink (K7A-17) 26ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/resources.test.ts > resource methods > inquirySessions.generateOneTimeLink (K7A-17)
Error: not built yet (K7A-17)
 Test Files  1 failed (1)
      Tests  1 failed | 163 skipped (164)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/signals/sessions.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**GREEN node** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 ❯ src/resources.test.ts (164 tests | 1 failed) 450ms
     × covers every resource group of C2 and C10-C14 16ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/resources.test.ts > resource methods > covers every resource group of C2 and C10-C14
AssertionError: inquirySessions.generateOneTimeLink has no endpoint test: expected [ 'inquiryTemplates.create', …(160) ] to include 'inquirySessions.generateOneTimeLink'
 Test Files  1 failed (1)
      Tests  1 failed | 163 passed (164)
```

## K7A-10: an evaluation or a session-start index that writes nothing leaves a trace

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/network/evaluate.test.ts src/services/graph/session-start.test.ts
 ❯ src/services/graph/session-start.test.ts (2 tests | 1 failed) 23ms
     × logs a failed indexer once, with the error’s name only, and answers 0 19ms
 ❯ src/network/evaluate.test.ts (17 tests | 3 failed) 2299ms
     × logs a failed adapter once, with the error’s name only 49ms
     × logs an unparsable address once, never the address 28ms
     × logs a failed evaluation once, with the error’s name only 37ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/network/evaluate.test.ts > an evaluation that writes nothing leaves a trace (K7A-10, C93.7) > logs a failed adapter once, with the error’s name only
AssertionError: expected [] to match object [ { …(2) } ]
-     "message": "ip reputation lookup failed",
    274|       { message: 'ip reputation lookup failed', object: { error: 'Erro…
 FAIL  src/network/evaluate.test.ts > an evaluation that writes nothing leaves a trace (K7A-10, C93.7) > logs an unparsable address once, never the address
AssertionError: expected [] to match object [ Array(1) ]
 FAIL  src/network/evaluate.test.ts > an evaluation that writes nothing leaves a trace (K7A-10, C93.7) > logs a failed evaluation once, with the error’s name only
-     "message": "session network evaluation failed",
    298|       { message: 'session network evaluation failed', object: { error:…
 FAIL  src/services/graph/session-start.test.ts > indexSessionAddressInTx (K7A-10) > logs a failed indexer once, with the error’s name only, and answers 0
AssertionError: expected [] to match object [ { level: 'warn', …(2) } ]
 Test Files  2 failed (2)
      Tests  4 failed | 15 passed (19)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/network/evaluate.test.ts src/services/graph/session-start.test.ts src/container.test.ts
 Test Files  3 passed (3)
      Tests  41 passed (41)
```

## K7A-9: the API-level redaction scan sees the networks table

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/redaction.test.ts -t K7A-9
 ❯ src/services/redaction.test.ts (27 tests | 1 failed | 25 skipped) 3037ms
     × holds a seeded row, so the scan sees it, and an inquiry’s redaction empties it 598ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/redaction.test.ts > the networks table (K7A-9, C91.3, C91.4) > holds a seeded row, so the scan sees it, and an inquiry’s redaction empties it
AssertionError: expected '[]' to contain 'Zyxw-synthetic-pii'
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 25 skipped (27)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/redaction.test.ts
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

## K7B-14: filter[identifier] needs pii:view

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts -t K7B-14
 ❯ src/services/transactions/transactions.test.ts (20 tests | 1 failed | 18 skipped) 2493ms
     × refuses a principal who may not see values: a masked key and a viewer read no membership 151ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/transactions/transactions.test.ts > filter[identifier] is a search by a value (K7B-14) > refuses a principal who may not see values: a masked key and a viewer read no membership
AssertionError: expected 200 to be 403 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 18 skipped (20)
```

**RED, both principals** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts -t K7B-14
 ❯ src/services/transactions/transactions.test.ts (20 tests | 1 failed | 18 skipped) 2182ms
     × refuses a principal who may not see values: a masked key and a viewer read no membership 121ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/transactions/transactions.test.ts > filter[identifier] is a search by a value (K7B-14) > refuses a principal who may not see values: a masked key and a viewer read no membership
AssertionError: expected 200 to be 403 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 18 skipped (20)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

## K7B-4: a transaction's status history and labels have read routes (owner decision 8 after 7B)

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/transaction-history.test.ts
 ❯ src/routes/server/transaction-history.test.ts (7 tests | 6 failed) 3606ms
     × lists the changes newest first, with who moved it by type 676ms
     × pages by a cursor, and refuses a cursor of nothing 30ms
     × keeps who and when of a redacted transaction, and nulls the free text 161ms
     × answers 404 for a transaction this environment does not hold, and needs transactions:read 50ms
     × lists the labels newest first, as transaction-label resources, and pages 34ms
     × leaves out the labels of a redacted transaction 86ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/status-changes (C108) > lists the changes newest first, with who moved it by type
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6CNSHBD9JPHB327SPN0JE9A/status-changes.","instance"
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/status-changes (C108) > pages by a cursor, and refuses a cursor of nothing
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6CNSHZT0WZ7111PFCXD6MS4/status-changes.","instance"
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/status-changes (C108) > keeps who and when of a redacted transaction, and nulls the free text
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6CNSJ0R33E3Y9NZ58P6E4T6/status-changes.","instance"
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/status-changes (C108) > answers 404 for a transaction this environment does not hold, and needs transactions:read
AssertionError: expected 404 to be 403 // Object.is equality
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/labels (C108) > lists the labels newest first, as transaction-label resources, and pages
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6CNSJ7CACWPHG6GFH09S1NC/labels.","instance":"/api/v
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/labels (C108) > leaves out the labels of a redacted transaction
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6CNSJ8GP05Y23ED2XC96XJD/labels.","instance":"/api/v
 Test Files  1 failed (1)
      Tests  6 failed | 1 passed (7)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/transaction-history.test.ts
 ❯ src/routes/server/transaction-history.test.ts (7 tests | 2 failed) 9079ms
     × keeps who and when of a redacted transaction, and nulls the free text 186ms
     × leaves out the labels of a redacted transaction 140ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/status-changes (C108) > keeps who and when of a redacted transaction, and nulls the free text
AssertionError: expected { 'from-status': 'created', …(4) } to match object { 'from-status': null, …(3) }
 FAIL  src/routes/server/transaction-history.test.ts > GET /transactions/:id/labels (C108) > leaves out the labels of a redacted transaction
AssertionError: expected [ { type: 'transaction-label', …(2) } ] to deeply equal []
 Test Files  1 failed (1)
      Tests  2 failed | 5 passed (7)
```

**GREEN db** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/repositories/transaction-repositories.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/fixtures.test.ts src/vocabulary.test.ts
 Test Files  2 passed (2)
      Tests  327 passed (327)
```

**GREEN node** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 ❯ src/resources.test.ts (166 tests | 1 failed) 516ms
     × transactions.statusChanges 13ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/resources.test.ts > resource methods > transactions.statusChanges
AssertionError: expected 'https://api.example.test/api/v1/trans…' to be 'https://api.example.test/api/v1/trans…' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 165 passed (166)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/transaction-history.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**GREEN node** (exit 0)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 Test Files  1 passed (1)
      Tests  166 passed (166)
```

## K7B-3: versions are listed, and the parents name their latest version (owner decision 7 after 7B)

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/version-lists.test.ts
 ❯ src/routes/server/version-lists.test.ts (4 tests | 4 failed) 3560ms
     × lists a type’s versions newest first, and the type names its latest and published 609ms
     × pages by a cursor, keeps to its environment, and needs transactions:read 161ms
     × lists a template’s versions newest first, and the template names its latest 97ms
     × needs graph:read 14ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/version-lists.test.ts > GET /transaction-type-versions (K7B-3) > lists a type’s versions newest first, and the type names its latest and published
TypeError: Cannot read properties of undefined (reading 'published-version')
 FAIL  src/routes/server/version-lists.test.ts > GET /transaction-type-versions (K7B-3) > pages by a cursor, keeps to its environment, and needs transactions:read
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transaction-type-versions.","instance":"/api/v1/transaction-type-versio
 FAIL  src/routes/server/version-lists.test.ts > GET /graph-query-template-versions (K7B-3) > lists a template’s versions newest first, and the template names its latest
AssertionError: expected '' to match /^grqtv_/
 FAIL  src/routes/server/version-lists.test.ts > GET /graph-query-template-versions (K7B-3) > needs graph:read
AssertionError: expected 404 to be 403 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/version-lists.test.ts src/routes/graph-query-routes.test.ts src/routes/graph-routes.test.ts src/services/transactions/types.test.ts src/services/transactions/transactions.test.ts
 ❯ src/routes/server/version-lists.test.ts (4 tests | 1 failed) 11200ms
     × pages by a cursor, keeps to its environment, and needs transactions:read 217ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/server/version-lists.test.ts > GET /transaction-type-versions (K7B-3) > pages by a cursor, keeps to its environment, and needs transactions:read
AssertionError: expected '/api/v1/transaction-type-versions?fil…' to contain 'page%5Bafter%5D'
 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 79 passed (80)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/fixtures.test.ts src/graph-queries.test.ts src/transactions.test.ts
 Test Files  3 passed (3)
      Tests  354 passed (354)
```

**GREEN node** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 ❯ src/resources.test.ts (168 tests | 1 failed) 1141ms
     × covers every resource group of C2 and C10-C14 43ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/resources.test.ts > resource methods > covers every resource group of C2 and C10-C14
AssertionError: expected [ 'accountTypes', 'accounts', …(28) ] to deeply equal [ 'accountTypes', 'accounts', …(26) ]
 Test Files  1 failed (1)
      Tests  1 failed | 167 passed (168)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/server/version-lists.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

**GREEN node** (exit 0)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/resources.test.ts
 Test Files  1 passed (1)
      Tests  168 passed (168)
```

## K7B-5: a replaced transaction file stays findable until its object is gone (owner decision 9 after 7B)

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/files.test.ts -t K7B-5
 ❯ src/services/transactions/files.test.ts (12 tests | 3 failed | 7 skipped) 5450ms
       × keeps the row findable, its name gone, until the object is gone 440ms
       × is finished by the C16 pass, and the row then reads deleted 255ms
       × is reached by a redaction of the transaction, then the C16 pass 311ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/transactions/files.test.ts > uploading a file field (C105.2, P22) > a replaced file whose object could not be deleted (K7B-5, owner decision 9) > keeps the row findable, its name g
AssertionError: expected { …(5) } to match object { …(3) }
 FAIL  src/services/transactions/files.test.ts > uploading a file field (C105.2, P22) > a replaced file whose object could not be deleted (K7B-5, owner decision 9) > is finished by the C16 pass, and t
AssertionError: expected [ …(4) ] to not include 'env_01M6CPF9QWA23J0FBRQ79RRPQ8/eZ4bze…'
 FAIL  src/services/transactions/files.test.ts > uploading a file field (C105.2, P22) > a replaced file whose object could not be deleted (K7B-5, owner decision 9) > is reached by a redaction of the t
AssertionError: expected [ …(5) ] to not include 'env_01M6CPF9QWA23J0FBRQ79RRPQ8/Ae0Ewu…'
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed | 7 skipped (12)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/files.test.ts src/services/redaction-transactions.test.ts src/services/redaction.test.ts
 Test Files  3 passed (3)
      Tests  48 passed (48)
```

**GREEN db** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/migrate.test.ts src/phase7-transaction-tables.test.ts src/repositories/transaction-repositories.test.ts
 Test Files  3 passed (3)
      Tests  77 passed (77)
```

**GREEN db, the upgrade on PGlite** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/migration-0025.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## K7A-11: the open screen is sent on pagehide, with keepalive (owner decision 2 after 7A)

**RED** (exit 1)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow/flow-renderer-signals.test.tsx src/api/flow-api-client.test.ts
 ❯ src/api/flow-api-client.test.ts (76 tests | 1 failed) 499ms
       × asks the browser to keep the request alive, so a body outlives the page (K7A-11) 61ms
 ❯ src/flow/flow-renderer-signals.test.tsx (6 tests | 1 failed) 2320ms
       × flushes on pagehide, and not before consent or after the flow is gone 295ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/api/flow-api-client.test.ts > createFlowApiClient > sendSignals (C94.2, Workflow 7A) > asks the browser to keep the request alive, so a body outlives the page (K7A-11)
AssertionError: expected { method: 'POST', …(6) } to match object { keepalive: true }
 FAIL  src/flow/flow-renderer-signals.test.tsx > FlowRenderer: the signal collection (C94.3, C94.6) > the open screen when the page goes (K7A-11, owner decision 2 after 7A) > flushes on pagehide, and 
AssertionError: expected +0 to be 1 // Object.is equality
 Test Files  2 failed (2)
      Tests  2 failed | 80 passed (82)
```

**GREEN** (exit 0)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/flow src/api/flow-api-client.test.ts src/signals
 Test Files  16 passed (16)
      Tests  317 passed (317)
```

## K7A-12 and K7A-13: the weak cut-offs and the Tor window live in the core registry (owner decisions 4 and 5 after 7A)

**RED core** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/signal-registry.test.ts
 ❯ src/signal-registry.test.ts (18 tests | 2 failed) 76ms
     × holds every cut-off a signal applies: the two weak rules join the bot score (K7A-12) 22ms
     × keeps the Tor window in the registry, provisional, and bumps no signal (K7A-13) 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/signal-registry.test.ts > the signal constants (C93.4, C94.3, C94.8, C95.3) > holds every cut-off a signal applies: the two weak rules join the bot score (K7A-12)
AssertionError: expected undefined to match object { value: 10, basis: 'provisional' }
 FAIL  src/signal-registry.test.ts > the signal constants (C93.4, C94.3, C94.8, C95.3) > keeps the Tor window in the registry, provisional, and bumps no signal (K7A-13)
AssertionError: expected undefined to match object { value: 24, basis: 'provisional' }
 Test Files  1 failed (1)
      Tests  2 failed | 16 passed (18)
```

**RED checks** (exit 1)

```text
$ (cd packages/checks) pnpm exec vitest run --coverage.enabled=false src/signals/bot-score.test.ts
 ❯ src/signals/bot-score.test.ts (25 tests | 1 failed) 1161ms
     × keeps its two weak cut-offs provisional, with their basis 16ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/signals/bot-score.test.ts > BOT_SCORE_RULES (C94.8) > keeps its two weak cut-offs provisional, with their basis
AssertionError: expected { …(2) } to deeply equal { 'many-focus-losses-min': 10, …(1) }
 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
```

**RED signals** (exit 1)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/network/lookup.test.ts
 ❯ src/network/lookup.test.ts (29 tests | 1 failed) 233ms
     × reads the core registry constants by their keys 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/network/lookup.test.ts > networkLookupRules and sessionNetworkFacts > reads the core registry constants by their keys
ReferenceError: TOR_EXIT_WINDOW_HOURS is not defined
 Test Files  1 failed (1)
      Tests  1 failed | 28 passed (29)
```

**core after the move** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/signal-registry.test.ts
 ❯ src/signal-registry.test.ts (18 tests | 2 failed) 81ms
     × hold the plan values 30ms
     × pins every entry and the collector by version (golden) 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/signal-registry.test.ts > the signal constants (C93.4, C94.3, C94.8, C95.3) > hold the plan values
AssertionError: expected { 'strong-artefact-floor': 90, …(9) } to deeply equal { 'strong-artefact-floor': 90, …(7) }
 FAIL  src/signal-registry.test.ts > the signal constants (C93.4, C94.3, C94.8, C95.3) > pins every entry and the collector by version (golden)
AssertionError: expected { …(14) } to deeply equal { …(14) }
 Test Files  1 failed (1)
      Tests  2 failed | 16 passed (18)
```

**GREEN core** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/signal-registry.test.ts
 ❯ src/signal-registry.test.ts (18 tests | 1 failed) 39ms
     × hold the plan values 13ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/signal-registry.test.ts > the signal constants (C93.4, C94.3, C94.8, C95.3) > hold the plan values
AssertionError: expected { 'tor-exit-window-hours': 24, …(6) } to deeply equal { …(6) }
 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

**GREEN signals** (exit 1)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/network/lookup.test.ts
 ❯ src/network/lookup.test.ts (29 tests | 1 failed) 294ms
     × reads the core registry constants by their keys 12ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/network/lookup.test.ts > networkLookupRules and sessionNetworkFacts > reads the core registry constants by their keys
RangeError: the Tor window is a positive number of hours
 Test Files  1 failed (1)
      Tests  1 failed | 28 passed (29)
```

**checks** (exit 1)

```text
$ (cd packages/checks) pnpm exec vitest run --coverage.enabled=false src/signals
 ❯ src/signals/rules.test.ts (3 tests | 2 failed) 31ms
     × pins BOT_SCORE_RULES, its constants and step types with inquiry/bot_score 26ms
     × pins BEHAVIOUR_RULES with inquiry/behavior_threat_level 1ms
 ❯ src/signals/compute.test.ts (37 tests | 1 failed) 927ms
     × golden: one consented web session on fresh lists with nothing listed 40ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/signals/compute.test.ts > computeInquirySignals (C90.2, C90.4, C90.5) > golden: one consented web session on fresh lists with nothing listed
AssertionError: expected { tier: 'H', stage: 'beta', …(7) } to deeply equal { tier: 'H', stage: 'beta', …(7) }
 FAIL  src/signals/rules.test.ts > the rule tables by version (golden, H24) > pins BOT_SCORE_RULES, its constants and step types with inquiry/bot_score
AssertionError: expected '2:63a10f39d871d54c' to be '1:5dab7aefa24189e9' // Object.is equality
 FAIL  src/signals/rules.test.ts > the rule tables by version (golden, H24) > pins BEHAVIOUR_RULES with inquiry/behavior_threat_level
AssertionError: expected '2:f8b98aa6eb4139a8' to be '1:f8b98aa6eb4139a8' // Object.is equality
 Test Files  2 failed | 10 passed (12)
      Tests  3 failed | 151 passed (154)
```

**GREEN core** (exit 0)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/signal-registry.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

**GREEN signals** (exit 0)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/network/lookup.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

**GREEN checks** (exit 0)

```text
$ (cd packages/checks) pnpm exec vitest run --coverage.enabled=false src/signals
 Test Files  12 passed (12)
      Tests  154 passed (154)
```

**GREEN API readers** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/jobs/signals src/services/inquiry-signals-served.test.ts src/network src/jobs/report-types/ip-address.test.ts
 Test Files  13 passed (13)
      Tests  136 passed (136)
```

## K7A-14: packages/signals takes DOM and the workspace packages properly

**RED typecheck, without the lib and the devDependencies** (exit 2)

```text
$ (cd packages/signals) pnpm exec tsc --noEmit
src/browser/bundle.test.ts(6,35): error TS2307: Cannot find module '@openverify/contracts' or its corresponding type declarations.
src/browser/collector.jsdom.test.ts(3,35): error TS2307: Cannot find module '@openverify/contracts' or its corresponding type declarations.
src/browser/collector.jsdom.test.ts(25,14): error TS2304: Cannot find name 'window'.
src/browser/collector.jsdom.test.ts(26,14): error TS2584: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.
src/browser/collector.jsdom.test.ts(27,14): error TS2584: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.
src/browser/collector.jsdom.test.ts(29,19): error TS2304: Cannot find name 'Document'.
src/browser/collector.jsdom.test.ts(32,14): error TS2584: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.
src/browser/collector.jsdom.test.ts(33,14): error TS2304: Cannot find name 'HTMLCanvasElement'.
```

**GREEN typecheck** (exit 0)

```text
$ (cd packages/signals) pnpm exec tsc --noEmit

```

**GREEN tests** (exit 0)

```text
$ (cd packages/signals) pnpm exec vitest run --coverage.enabled=false src/browser
 Test Files  7 passed (7)
      Tests  59 passed (59)
```

## K7A-15: flow-handoffs uses stageSessionEvents (a guard: the payload is pinned, then the copy goes)

**the pin, on the copy** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/handoff/flow-handoffs.test.ts -t K7A-15
 ❯ src/services/handoff/flow-handoffs.test.ts (24 tests | 1 failed | 23 skipped) 3425ms
     × carries the session with its device and network, as every session event does 1290ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/handoff/flow-handoffs.test.ts > the rejected phone’s inquiry-session.canceled (K7A-15) > carries the session with its device and network, as every session event does
Error: Failed query: insert into networks (id, environment_id, inquiry_session_id, threat_level,
Serialized Error: { length: 349, severity: 'ERROR', code: '23505', detail: 'Key (environment_id, inquiry_session_id)=(env_01M6CQ31BC6W6KF0P02XTCNRSQ, iqse_01M6CQ32HAT4K8QY008RE43HSC) already exists.',
 Test Files  1 failed (1)
      Tests  1 failed | 23 skipped (24)
```

**the pin, on the copy** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/handoff/flow-handoffs.test.ts -t K7A-15
 Test Files  1 passed (1)
      Tests  1 passed | 23 skipped (24)
```

**GREEN, the same payload** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/handoff/flow-handoffs.test.ts src/services/handoff/flow-handoffs-cases.test.ts
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

## D001: the re-screen asks once whether the frequency table fits

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/jobs/reports/rescreen-frequency.test.ts
 ❯ src/jobs/reports/rescreen-frequency.test.ts (3 tests | 1 failed) 14ms
     × asks once whether the table fits, however many chunks read it 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/jobs/reports/rescreen-frequency.test.ts > keyFrequencyReader (D001) > asks once whether the table fits, however many chunks read it
AssertionError: expected "vi.fn()" to be called 1 times, but got 3 times
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/jobs/reports/rescreen-frequency.test.ts src/jobs/reports/rescreen-work.test.ts
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

## D002: the screening shortcuts on company subjects (a guard: it passed on its first run, so it has no RED)

**first run** (exit 0)

```text
$ (cd packages/watchlist) pnpm exec vitest run --coverage.enabled=false src/match/shortcuts.test.ts
 Test Files  1 passed (1)
      Tests  129 passed (129)
```

## K7B-6 and K7B-7: the two limits have codes, and a file field has a ceiling (owner decisions 10, 11 after 7B)

**RED API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts -t K7B-6
 ❯ src/services/transactions/transactions.test.ts (22 tests | 2 failed | 20 skipped) 3005ms
     × answers relation_cardinality_exceeded for a second target of a one-target relation 160ms
     × answers related_objects_limit for the 101st related object 1141ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/transactions/transactions.test.ts > the two transaction limits have codes (K7B-6, owner decision 10) > answers relation_cardinality_exceeded for a second target of a one-target rel
AssertionError: expected 400 to be 200 // Object.is equality
 FAIL  src/services/transactions/transactions.test.ts > the two transaction limits have codes (K7B-6, owner decision 10) > answers related_objects_limit for the 101st related object
AssertionError: expected undefined to be 'related_objects_limit' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 20 skipped (22)
```

**RED contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/fixtures.test.ts
 ❯ src/fixtures.test.ts (314 tests | 1 failed) 490ms
     × freezes the transaction problem codes with their statuses 16ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/fixtures.test.ts > problems/transactions/ (Workflow 7B) > freezes the transaction problem codes with their statuses
AssertionError: expected { card_number_refused: 422, …(13) } to deeply equal { card_number_refused: 422, …(15) }
 Test Files  1 failed (1)
      Tests  1 failed | 313 passed (314)
```

**RED core** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/transactions/field-schemas.test.ts
 ❯ src/transactions/field-schemas.test.ts (37 tests | 1 failed) 51ms
     × bounds a file field’s sizes by the ceiling: the upload is held in memory (K7B-7) 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/transactions/field-schemas.test.ts > the field-schema union (C104.2) > bounds a file field’s sizes by the ceiling: the upload is held in memory (K7B-7)
AssertionError: expected undefined to be 20000000 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 36 passed (37)
```

**RED core, the constant in place and no bound on the schema** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/transactions/field-schemas.test.ts
 ❯ src/transactions/field-schemas.test.ts (37 tests | 1 failed) 47ms
     × bounds a file field’s sizes by the ceiling: the upload is held in memory (K7B-7) 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/transactions/field-schemas.test.ts > the field-schema union (C104.2) > bounds a file field’s sizes by the ceiling: the upload is held in memory (K7B-7)
AssertionError: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 36 passed (37)
```

**RED API, the relation body corrected** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts -t K7B-6
 ❯ src/services/transactions/transactions.test.ts (22 tests | 2 failed | 20 skipped) 4114ms
     × answers relation_cardinality_exceeded for a second target of a one-target relation 317ms
     × answers related_objects_limit for the 101st related object 1613ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/transactions/transactions.test.ts > the two transaction limits have codes (K7B-6, owner decision 10) > answers relation_cardinality_exceeded for a second target of a one-target rel
AssertionError: expected undefined to be 'relation_cardinality_exceeded' // Object.is equality
 FAIL  src/services/transactions/transactions.test.ts > the two transaction limits have codes (K7B-6, owner decision 10) > answers related_objects_limit for the 101st related object
AssertionError: expected undefined to be 'related_objects_limit' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 20 skipped (22)
```

**GREEN API** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/transactions.test.ts src/services/transaction-hooks.test.ts
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

**GREEN core** (exit 0)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/transactions
 Test Files  6 passed (6)
      Tests  356 passed (356)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/fixtures.test.ts src/problem.test.ts
 Test Files  2 passed (2)
      Tests  330 passed (330)
```

## K7B-8: dropping or converting a nested field raises a type event, with a dotted field-key (owner decision 2 after 7B)

**RED core** (exit 1)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/transactions/version-reads.test.ts
 ❯ src/transactions/version-reads.test.ts (28 tests | 4 failed) 28ms
       × names a dropped or converted member of a hash by its dotted path 11ms
       × walks every level, up to the deepest path a version can hold 1ms
       × adds no segment for an array’s item schema: its members follow the array’s own key 1ms
       × names a converted item schema by the array’s key 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/transactions/version-reads.test.ts > transactionTypeVersionDiff (C104.6) > a nested field (K7B-8, owner decision 2 after 7B) > names a dropped or converted member of a hash by its dotted pa
AssertionError: expected { deletedFields: [], …(1) } to deeply equal { deletedFields: [ 'h.y' ], …(1) }
 FAIL  src/transactions/version-reads.test.ts > transactionTypeVersionDiff (C104.6) > a nested field (K7B-8, owner decision 2 after 7B) > walks every level, up to the deepest path a version can hold
AssertionError: expected [] to deeply equal [ { key: 'a.b.c.d', …(2) } ]
 FAIL  src/transactions/version-reads.test.ts > transactionTypeVersionDiff (C104.6) > a nested field (K7B-8, owner decision 2 after 7B) > adds no segment for an array’s item schema: its members foll
AssertionError: expected { deletedFields: [], …(1) } to deeply equal { deletedFields: [ 'list.y' ], …(1) }
 FAIL  src/transactions/version-reads.test.ts > transactionTypeVersionDiff (C104.6) > a nested field (K7B-8, owner decision 2 after 7B) > names a converted item schema by the array’s key
AssertionError: expected [] to deeply equal [ { key: 'list', …(2) } ]
 Test Files  1 failed (1)
      Tests  4 failed | 24 passed (28)
```

**RED contracts** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/transactions.test.ts
 ❯ src/transactions.test.ts (22 tests | 1 failed) 86ms
     × takes one segment, as every existing consumer reads, and a dotted path 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/transactions.test.ts > the type events’ field-key (K7B-8, owner decision 2 after 7B) > takes one segment, as every existing consumer reads, and a dotted path
AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
```

## K7B-12: the integration configs turn the file-system module cache off (owner decision 19 after 7B)

**RED** (exit 1)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/integration-config.test.ts
 ❯ src/integration-config.test.ts (2 tests | 2 failed) 10ms
     × packages/db keeps no module cache on disk 8ms
     × apps/api keeps no module cache on disk 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/integration-config.test.ts > the integration configs (K7B-12) > packages/db keeps no module cache on disk
 FAIL  src/integration-config.test.ts > the integration configs (K7B-12) > apps/api keeps no module cache on disk
AssertionError: expected undefined to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

**GREEN** (exit 0)

```text
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/integration-config.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

**K7B-10, the golden vectors** (exit 0)

```text
$ (cd packages/checks) pnpm exec vitest run --coverage.enabled=false src/lists src/matching
 Test Files  20 passed (20)
      Tests  583 passed (583)
```

**GREEN core K7B-8** (exit 0)

```text
$ (cd packages/core) pnpm exec vitest run --coverage.enabled=false src/transactions/version-reads.test.ts
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

**GREEN contracts K7B-8** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/transactions.test.ts src/events.test.ts
 Test Files  2 passed (2)
      Tests  47 passed (47)
```

**GREEN API K7B-8** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/transactions/types.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## K7B-11: explorer-url comes from the resolved operator setting, and is null without one (owner decision 13 after 7B)

**GREEN API** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/graph/explorer-url.test.ts src/routes/graph-query-routes.test.ts src/routes/graph-routes.test.ts src/jobs/graph src/worker-graph.test.ts src/container.test.ts
 ❯ src/routes/graph-query-routes.test.ts (17 tests | 3 failed) 5892ms
     × answers the result at once with meta.run-sync, two hops counted the public way 139ms
     × unmasks a linking value from an account that holds it 111ms
     × adds the selected accounts’ values of a kind to a list, and sets their status 126ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/routes/graph-query-routes.test.ts > running a graph query (C102.3, C102.4) > answers the result at once with meta.run-sync, two hops counted the public way
AssertionError: expected 500 to be 201 // Object.is equality
 FAIL  src/routes/graph-query-routes.test.ts > values opened from their sources (C102.6, C103.2) > unmasks a linking value from an account that holds it
TypeError: Cannot read properties of undefined (reading 'id')
 FAIL  src/routes/graph-query-routes.test.ts > values opened from their sources (C102.6, C103.2) > adds the selected accounts’ values of a kind to a list, and sets their status
 Test Files  1 failed | 7 passed (8)
      Tests  3 failed | 91 passed (94)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/graph-queries.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

**RED, the old explorerUrlOf (taken from HEAD for this one run, because the fix was written before the test was run)** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/graph/explorer-url.test.ts
 ❯ src/services/graph/explorer-url.test.ts (3 tests | 3 failed) 18ms
     × builds the console’s page of a result on the configured URL 13ms
     × answers null with no configured URL, whatever the process environment holds 2ms
     × answers null for a URL that does not parse, never a guess 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/services/graph/explorer-url.test.ts > explorerUrlOf (K7B-11) > builds the console’s page of a result on the configured URL
AssertionError: expected 'http://localhost:3001/graph/grphq_01M…' to be 'https://console.example.test/graph/gr…' // Object.is equality
 FAIL  src/services/graph/explorer-url.test.ts > explorerUrlOf (K7B-11) > answers null with no configured URL, whatever the process environment holds
AssertionError: expected 'https://elsewhere.example.test/graph/…' to be null
 FAIL  src/services/graph/explorer-url.test.ts > explorerUrlOf (K7B-11) > answers null for a URL that does not parse, never a guess
AssertionError: expected 'http://localhost:3001/graph/grphq_01M…' to be null
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**RED contracts, likewise** (exit 1)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/graph-queries.test.ts
 ❯ src/graph-queries.test.ts (23 tests | 1 failed) 63ms
     × is null without a configured console, never a guess 11ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/graph-queries.test.ts > explorer-url (K7B-11) > is null without a configured console, never a guess
ZodError: [
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

**GREEN** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/graph/explorer-url.test.ts src/routes/graph-query-routes.test.ts src/routes/graph-routes.test.ts src/jobs/graph src/worker-graph.test.ts src/container.test.ts
 Test Files  8 passed (8)
      Tests  94 passed (94)
```

**GREEN contracts** (exit 0)

```text
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false src/graph-queries.test.ts src/fixtures.test.ts
 Test Files  2 passed (2)
      Tests  337 passed (337)
```

## K7B-9: @openverify/node covers every Phase 7 route (owner decision 12 after 7B)

**RED** (exit 1)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src/raw-answers.test.ts src/resources.test.ts
 ❯ src/raw-answers.test.ts (5 tests | 5 failed) 56ms
     × sends the bytes as multipart, under the field’s route, and parses the transaction 12ms
     × answers the bytes unchanged, with their type 1ms
     × throws the API’s problem for a refusal 4ms
     × posts the export action with an Idempotency-Key and answers the CSV text 1ms
     × refuses export, whose answer is not a JSON document, before any request 34ms
 ❯ src/resources.test.ts (172 tests | 4 failed) 350ms
     × transactions.addTag 8ms
     × transactions.removeTag 1ms
     × transactions.setTags 1ms
     × transactions.redactBiometrics 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/raw-answers.test.ts > transactions.uploadFile > sends the bytes as multipart, under the field’s route, and parses the transaction
Error: not built yet
 FAIL  src/raw-answers.test.ts > transactions.fileContent > answers the bytes unchanged, with their type
 FAIL  src/raw-answers.test.ts > transactions.fileContent > throws the API’s problem for a refusal
AssertionError: expected Error: not built yet to be an instance of OpenVerifyApiError
 FAIL  src/raw-answers.test.ts > graphQueries.exportCsv > posts the export action with an Idempotency-Key and answers the CSV text
 FAIL  src/raw-answers.test.ts > graphQueries.action > refuses export, whose answer is not a JSON document, before any request
AssertionError: expected [Function] to throw error matching /exportCsv/ but got 'The API answer is not JSON'
```

**GREEN** (exit 0)

```text
$ (cd packages/node) pnpm exec vitest run --coverage.enabled=false src
 Test Files  8 passed (8)
      Tests  320 passed (320)
```

## R005: proven harmless, no change

An address with no AS record reads `is-vpn` and `hosting-asn` null with `not_in_known_ranges`, and counts as evaluated. C93.4 says so in full: "the lookup ran against fresh seeds, whether it answered `true` or `null` with `not_in_known_ranges`". The seeds are present and the ASN source is fresh in that path; `asnSets === null`, and a stale or corrupt ASN source, carry their gap through `seeded()`. `lookup.test.ts` pins the case ("No AS record for the address: not in the lists we hold, which still counts as evaluated"), and its new gap test pins the other side: an ASN source that was not read gives `list_unavailable`, never this reason.

## R007: confirmed, the documentation half done

The finding is real: the synthetic graph is rings of ten, so no scenario nears the node limit. `docs/graph/README.md` now states the nodes beside each p95 and says what the figures do and do not measure. Dense scenarios need a change to `synthetic.ts`, the builder of the CI gate at 100,000 accounts and of the `graph-engine` template, and a new one-million-account run: not a local fix, so it stays open.

**the K7A-5 step after usePoll's first delay** (exit 0)

```text
$ (cd apps/flow) pnpm exec vitest run --coverage.enabled=false src/steps/device-handoff/device-handoff-step.test.tsx
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## The SDK host test floor: 1333 tests

**RED, the test at 1333 and CI at 1327** (exit 1)

```text
$ (cd infra) bash tests/ci-workflow.test.sh
ok   - unit-api: one failed shard does not cancel the other
FAIL - android: the test-count floor fails with one test fewer than the floor (1332) (exit 0: SDK host tests: 1332 in 2 classes, 0 skipped, 0 failed; the floor is 1327)
FAIL - android: the test-count floor fails at Workflow 7A's earlier floor of 1327 (exit 0: SDK host tests: 1327 in 2 classes, 0 skipped, 0 failed; the floor is 1327)
ok   - android: the test-count floor fails when a host test failed
# 215 passed, 2 failed, 0 skipped
```

**GREEN** (exit 0)

```text
$ (cd infra) bash tests/ci-workflow.test.sh
ok   - unit-api: one failed shard does not cancel the other
ok   - android: the test-count floor fails when a host test failed
# 217 passed, 0 failed, 0 skipped
```

## K7A-2 and K7A-4, full stack: the email handoff, and the desktop's completion

The email test is a new proof of a path that already worked, so it has no RED of its own; the QR test's desktop assertion changed with K7A-4.

**the spec, on a fresh stack** (exit 0)

```text
$ (cd .) flock /tmp/openverify-e2e.lock sh -c OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/handoff.spec.ts
  ✓  1 [chromium] › tests/handoff.spec.ts:148:1 › the desktop shows a QR, the phone previews, continues, consents and completes, and the desktop shows the completion (C96.8) (18.7s)
  ✓  2 [chromium] › tests/handoff.spec.ts:206:1 › "this was not me" on the desktop ends the phone session, cancels its unfinished verification and shows the step again (C96.3, V02) (4.3s)
  ✓  3 [chromium] › tests/handoff.spec.ts:247:1 › by email: the desktop confirms an address, the link reaches it, and the phone consents and completes in its own context (C96.8, K7A-2) (10.8s)
  3 passed (37.0s)
```

## The API suite after the contract changes

The first whole run failed 50 tests in 9 files, none of them a defect in the fixes. Seven `typeAttributes` helpers strip the members every verification carries so the rest is the type's own, and `from-rejected-handoff` is one of those now; one session read pinned the attributes exactly, without `handoff-rejected-at`; a mock of `assertSessionCapInTx` answered no `storageKeys`. Each now states the new shape.

**the nine files** (exit 0)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/attributes src/services/otp/dashboard-attributes.test.ts src/services/otp/hooks.test.ts src/routes/flow/session-signal-hooks.test.ts src/routes/server/inquiry-sessions.test.ts
 Test Files  15 passed (15)
      Tests  115 passed (115)
```

## Final gates

After the integration suites (C78.7 among them, `rescreen.ts` having changed): 15 files and 69 tests in `packages/db`, 36 files and 217 tests in `apps/api`, exit 0.

Watchlist benchmark: `benchmark:typecheck` exit 0; `benchmark:test` exit 0, 12 files and 119 tests. Android gate: `./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint` exit 0, 1,333 host tests, none failed or skipped. `openapi:write` twice: the second changed nothing.

The first shard failed one test, `operators.spec.ts`: it looked for the default template on the first page of a list, ten templates long, on a stack the specs share, and the new email test's template pushed it off that page. The session token is what the test proves, so it now reads the template by id.

The second shard then failed `report-inquiry.spec.ts` with no mail in 30 s, and the API log says why: `otp-ip-hour` answered 429 on the eleventh code from the stack's loopback address, because shard 1 had run twice on that stack. A clean run sends about half that from the loopback address, and the new email test sends from its own sandbox address. It is the rate limit working, not a fault, so the gate went again on a fresh stack, each shard once.

The next attempt's shards 1 and 2 exited 1 within seconds, before any test ran: `readReusableStack` found no record, because the console fixer had taken its own stack down and started another between this run's `e2e:stack:up` and its first shard. That is not a test failure. The peer's shards then ran on that stack, and a second pass of any shard on one stack is what spent `otp-ip-hour` above, so this run waited for that stack to stop rather than share it. It kept the README's one step per hold, and compared the stack record's holder before every shard, to stop rather than run on a stack it had not started.

All of these ran at 011c53ab, the last commit to touch code; 92776b65 after it is the console's TDD record alone.

```
$ pnpm format:check                                                exit 0
$ git diff --exit-code docs/api/openapi.json                       exit 0 (sha256 32004434ea483ef1...)
$ pnpm turbo run lint typecheck --force --concurrency=4            exit 0, 30 of 30 tasks, 5.0 min
$ pnpm turbo run test --force --filter='!@openverify/api' --concurrency=4
                                                                   exit 0, 14 of 14 tasks, 11.7 min
$ (cd apps/api) vitest run --coverage, thresholds 0, --shard=i/4 --reporter=blob, i = 1 to 4
                                                                   exit 0 each, 8.1 min, side by side
$ (cd apps/api) vitest run --merge-reports=<the four blobs> --coverage
                                                                   exit 0, 443 files, 5956 tests,
                                                                   95.65% statements, 87.17% branches,
                                                                   97.68% functions, 95.7% lines
$ pnpm turbo run test:integration --force                          exit 0, db 15 files, api 36 files, 5.0 min
```

The suite, one fresh stack, one hold per step, every shard once, the machine otherwise idle but for the end of the package tests before shard 1 (`/proc/loadavg`'s one, five and fifteen minutes when each shard ended):

```
$ playwright test --list                 Total: 108 tests in 54 files (19 of them the ui-* specs)
$ e2e:stack:down && turbo run build      exit 0
$ e2e:stack:up                           exit 0
$ playwright test --shard=1/3            exit 0, 36 passed (2.3m), load 3.13 10.06 12.33
$ playwright test --shard=2/3            exit 0, 39 passed (4.9m), load 1.54 5.16 9.61
$ playwright test --shard=3/3            exit 0, 33 passed (4.1m), load 2.20 3.51 7.88
$ e2e:stack:down                         exit 0
```

108 passed, none failed, none flaky, none skipped, each shard under 8 minutes: the three shards, the 45-minute global timeout and the CI job stay as they are. The Android gate and the watchlist benchmark ran after the last commits under `android/` (10d81a5c) and `packages/watchlist/` (fc682b06). `services/vision` did not change.
