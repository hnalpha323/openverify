# TDD evidence: Workflow 5A Stage 1a, `contracts` (Phase 5)

- **Slice owner:** the Workflow 5A Stage 1a `contracts` agent, running alone (it may touch any path its deliverables need).
- **Date:** 2026-10-22.
- **Base:** `7e80351`; this stage's commits run from `0e4f949` to the commit that adds this file.
- **Input:** the "Stage 1a: contracts" bullet of `docs/plans/phase-5.plan.md` (C50, C51, C52, the C55 constants and limits, the C57.1 chain ids, `sandbox:read`, the C59.4 amendment, golden API fixtures, migration 0016, the minimum client changes, the PO-box exports, the C30.1 amendment, the V18 publish rule, the C55.7 settings and audit action, and the C67 records it owns). Its decisions and the Starting point drift are in the plan's "Workflow 5A Stage 1a amendments (contracts)".

Each change follows the same cycle:
1. A stub (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `feat` or `fix` commit), then a refactor with the suite green where one was worth making.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every name, address, number, wallet, LEI and chip value in these tests and fixtures is synthetic.

## 0. Starting point, re-verified

Re-checked before any change (`grep`, `ls` and the files named):
- **Drift:** `FACE_MATCH_DEFAULTS.threshold` is `0.394`, `calibrated` (C49), not SFace's 0.363; it now lives in `packages/core/src/check-config/basis.ts`.
- **Drift:** the K202 golden 409 problems already exist (`contracts/fixtures/problems/selfie-capture-{incomplete,invalid,limit,required}.json`), and Android's `ContractFixturesTest` already maps the session-cancel reasons and the selfie capture codes; Stage 1a added `problems/flow/` beside them.
- **Drift:** `runInquiryExpiry` already takes `storage` (`apps/api/src/jobs/inquiry-expiry.ts:41`), so K201 is fixed.
- **Drift:** Android's `FlowCoordinator` already treats `SKIPPED` as done and `CONFIRMED` as processing (`FlowCoordinator.kt:343-348`).
- **Drift:** TRON's CAIP-2 id is decimal (`tron:728126428`); ChainAgnostic/namespaces `463bae5625aaa8c184ccc74f1db457da8a43e72b` calls `tron:0x2b6653dc` a deprecated alias.
- **Drift:** `@openverify/contracts` may import only zod, core, flow-spec and flat local modules (its browser-safety test), so the reasons files are flat `<area>-check-reasons.ts`.
- **As stated:** 0015 was the newest migration; CI's Node floats at `'22'` (`.github/actions/setup-pnpm/action.yml`); `asn1js@3.1.0` is in the lockfile; `MASKED_ATTRIBUTES` is in `apps/api/src/auth/pii.ts`.

## 1. Core: types, lifecycle, scope, chains (C50.1, C50.7, C50.8, C55.11, C57.1)
Stubs 0e4f949, 4bdceaf; RED 7327e9a; GREEN 714812e.
RED:
$ (cd packages/core && pnpm exec vitest run src/enums.test.ts src/verification-state-machine.test.ts src/permissions.test.ts src/crypto-chains.test.ts --coverage.enabled=false)
     × lists every verification type value in order
     × keeps the Phase 1 scopes first, then adds the C12 scopes, then the Phase 5 one
     × gives developer templates, webhooks, ... (sandbox:read)
     × keeps the sandbox SMS sink, which serves one-time codes, away from viewer and reviewer (C55.11)
     × lists the fixed-id chains with their CAIP-2 ids, families and names, in order
     AssertionError: expected [] to deeply equal [ [ …(3) ], [ …(3) ], [ …(3) ], …(4) ]
     × accepts eip155:1 ... × accepts tron:728126428 ... × bounds the address, the signature and the signed message
     × declares exactly the C10 table; × allows submitted -> skipped and returns the event of the target
      Tests  25 failed | 163 passed (188)
GREEN: (cd packages/core && pnpm exec vitest run --coverage.enabled=false) Tests 609 passed (609).
Chain ids: `gh api repos/ChainAgnostic/namespaces/commits/main` -> 463bae5625aaa8c184ccc74f1db457da8a43e72b (2026-09-03); bip122/caip2.md, solana/caip2.md, xrpl/caip2.md list the planned ids unchanged; tron/caip2.md now makes the reference decimal (`tron:728126428`) and calls `tron:0x2b6653dc` a deprecated alias to accept on input and normalise.
Test changed with the plan (C50.1): check-registry.test.ts SECTION_4_3 verification types (aamva_* -> aamva, database_business_* -> database_business, business_website_* -> business_website).

## 2. Migration 0016 (C50.1, C52.4, F23)
Stub 763205f (the TypeScript pg enums); RED 029a1dc; GREEN 3a14811.
RED:
$ (cd packages/db && pnpm exec vitest run src/schema.test.ts src/migrate.test.ts --coverage.enabled=false)
     × holds only the Phase 5 enum changes in 0016, hand-written so no type is recreated (C50.1, C52.4, F23)
     × has no drift between the schema and the latest drizzle-kit snapshot
AssertionError: expected undefined to be '0016_phase5_verification_types'
      Tests  2 failed | 115 passed (117)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-v5.integration.test.ts)
     × applies in one batch on an empty database, after which every new value can be stored
     × upgrades a Phase 4 database with rows in it, and no row held business
AssertionError: expected [ 'government_id', 'selfie', …(7) ] to deeply equal [ 'government_id', 'selfie', …(9) ]
      Tests  2 failed (2)
GREEN: `pnpm --filter @openverify/db db:generate` wrote 0016_snapshot.json and an SQL file that drops and recreates verification_type (ALTER COLUMN ... SET DATA TYPE text; DROP TYPE; CREATE TYPE; ... USING); that file was replaced by the hand-written 0016_phase5_verification_types.sql (RENAME VALUE, ADD VALUE 'aamva' AFTER 'database', ADD VALUE 'business_website', eleven file_kind ADD VALUE) and the journal tag renamed.
  db unit: Tests 685 passed (685); integration migration-v5 + migration-v3: Tests 4 passed (4).
  The upgrade test's own query first sorted file kinds as text (back, front); it now orders by the enum column.

## 3. Phase 5 check config in per-area modules (C51.3, C58.1, V09)
Refactor 9616fd0 (basis to check-config/basis.ts, core 609 passed); stub 7828021; RED bed156b; GREEN 54b6bbf.
RED:
$ (cd packages/core && pnpm exec vitest run src/phase5-check-config.test.ts --coverage.enabled=false)
AssertionError: expected {} to deeply equal { …(26) }
AssertionError: expected undefined to be 0.394 // Object.is equality
AssertionError: document_type_detection: expected false to be true
      Tests  67 failed | 4 passed (71)
GREEN: (cd packages/core && pnpm exec vitest run --coverage.enabled=false) Tests 680 passed (680).

## 4. Registry (C50.8, C51.1) and PLAN §4.3
Stub 68a21de; RED 117cabf; GREEN 4091837 (with docs/PLAN.md §4.3 rewritten one row per check).
RED:
$ (cd packages/core && pnpm exec vitest run src/check-registry.test.ts --coverage.enabled=false)
     × registers §4.3 check document_expired_detection / document_recency_detection / document_name_comparison / database_identity_comparison / database_inquiry_comparison / database_po_box_detection / aamva_identity_comparison / database_business_enabled_country_detection / database_business_service_available_detection / business_website_resolution_detection / business_website_malicious_website_detection / crypto_wallet_address_comparison / id_nfc_repeat_detection
     × takes the defaults of every §4.3 check and the new ids from one explicit table (C51.1)
     × gives every check the category of its type, except the published or decided overrides (C50.8)
     × validates each Phase 5 check config with its area module schema, and only those (C51.3)
     × describes chip authentication as what the server can verify (C51.1)
     × keeps PLAN §4.3 in step with the registry, one row per check (C51.1)
     × lists the inputs of every §4.1 check, in CHECK_INPUTS order; × lists the inputs of every §4.3 check (C51.1)
      Tests  23 failed | 51 passed (74)
GREEN: core Tests 694 passed (694).
Tests changed with the plan: check-registry.test.ts (the §4.1/§4.2 default rules now exclude the C51.1 table; id_nfc_expired_detection's inputs are upload, C51.1); check-config.test.ts (the exact list of checks with a config schema gains the Phase 5 ones, C51.3).

## 5. Decision engine (C30.1 and C30.2 amendments, V17), type-level options (C50.4), match-group thresholds
RED d8b970c; GREEN c437f0c.
RED:
$ (cd packages/core && pnpm exec vitest run src/decision-engine.test.ts src/check-result.test.ts --coverage.enabled=false)
     × accept a full provenance with models, a provider and every kind of threshold
     × sends a verification to review when no required check passed, since a non-blocking answer is no evidence (C30.1 amendment, V17)
     × never passes a government_id / selfie / document / database / aamva / phone_number / email_address / government_id_nfc / crypto_wallet / database_business / business_website verification on non-blocking answers alone (V17)
     × sends a template that requires nothing to review: nothing passed (C30.1 amendment, V17)
     × lets only feature_absent, not_requested, no_allowlist and chip_auth_not_server_verifiable leave a required check without evidence (C30.2 amendment, C51.2)
     × takes the chains a crypto wallet template allows, distinct and in canonical CAIP-2 form
     × takes accept-review-without-provider as a boolean
      Tests  17 failed | 71 passed (88)
GREEN: (cd packages/core && pnpm exec vitest run --coverage) Tests 711 passed (711); All files 100 / 96.61 / 100 / 100.
Tests changed with the plan (C30.1 amendment): "passes when every required check is not_applicable for a non-blocking reason" now holds a passing required check beside them; "passes vacuously when the template requires nothing" became "sends a template that requires nothing to review"; "ignores disabled checks" gained a passing required check.

## 6. Flow-spec steps (C50.3)
RED 4c6c431; GREEN 81c3f73 (schema/flow.schema.json regenerated with `pnpm --filter @openverify/flow-spec schema:export`).
Also c1002e6: packages/checks phase1 government-id-checks.test.ts keeps its not_requested assertion non-blocking beside a passing required check (C30.1 amendment); before it: `checks` Tests 2 failed | 1328 passed (1330), AssertionError: expected 'needs_review' to be 'passed'; after: 39 passed.
RED:
$ (cd packages/flow-spec && pnpm exec vitest run --coverage.enabled=false)
     × parses a flow that uses every step type
     × rejects no document capture method / an unknown document capture method / 11 document attempts / a 5-digit OTP / a 5-digit email OTP / a phone step without countries / ... / a crypto step without chains / an unknown chain / the hexadecimal TRON id / ... / zero website attempts
     × accepts the flow that parseFlow accepts
      Tests  37 failed | 76 passed (113)
GREEN: flow-spec Tests 113 passed (113); All files 100 / 94.44 / 100 / 100.

## 7. Contracts: types, step map, every union, categories (C50.1, C50.2, C50.6, C50.8)
Stubs 969adf4 (step names), 9e5b169 (optional check category); RED db19c19; GREEN 9f62e49.
The RED tests type their tables as the wider unions with casts, so they compile against the two-type contracts; GREEN's eslint --fix removed the casts once they were unnecessary.
RED:
$ (cd packages/contracts && pnpm exec vitest run src/verification-types.test.ts src/phase5-verification-resources.test.ts src/verifications.test.ts --coverage.enabled=false)
     × supports all eleven verification types since Phase 5 (C50.1)
     × maps document / database / aamva / phone_number / email_address / government_id_nfc / crypto_wallet / database_business / business_website both ways
     × maps every flow step type, and each verification type to exactly one step (total, injective)
     × gives every verification step a number of attempts: its own, else the type default (C50.1)
     × finds the step of each verification type in a flow, or none
     × are built from verification records (category served)
     × are the eleven supported types but government ID and selfie
     × are served on every check, derived from the registry at read time
      Tests  17 failed | 40 passed (57)
GREEN: contracts Tests 1472 passed (1472).
Tests changed with the plan: files.test.ts (an entry per type), government-id-check-reasons.test.ts (four non-blocking reasons, C30.2 amendment), vocabulary.test.ts (the nine resource types, sandbox:read), inquiry-templates.test.ts (the injected phone step names its countries, C50.3).

## 8. Reasons (C51.2), the AAMVA reason (C59.4), frozen retry strings in both clients
Contracts: stub 6cf959d; RED 9b07f4a; GREEN 5b41253 (with the fixture's 25 new reasons).
RED:
$ (cd packages/contracts && pnpm exec vitest run src/phase5-check-reasons.test.ts --coverage.enabled=false)
      Tests  23 failed | 13 passed (36)
  (× states the C51.2 table, row by row; × lets each check emit its row and the shared reasons ...; × freezes the failure reasons of its user-behaviour checks ...; × takes id_nfc_expired_detection from the government ID file to the NFC one; × answers not_applicable when the jurisdiction does not take part)
GREEN: contracts Tests 1523 passed (1523). Tests changed with the plan: government-id-check-reasons.test.ts (§4.1 checks less the chip expiry; the AAMVA lookup's new reason).
Web flow: stub d737fa3 (the four step cases, so the flow compiles after flow-spec gained them); RED d63242f; GREEN 17fbbdf.
$ (cd apps/flow && pnpm exec vitest run src/flow/flow-position.test.ts src/steps/unsupported-step.test.tsx src/i18n/retry-reasons.test.ts --coverage.enabled=false)
       × stops at a aamva / crypto_wallet / database_business / business_website step instead of skipping it
     × has its own message for every reason a retry hint can carry (en, es); × shows each of those messages in this language, not a fallback; × says something different for each reason
     × says plainly that a aamva / crypto_wallet / database_business / business_website step cannot be done here
      Tests  14 failed | 50 passed (64)
GREEN: flow Tests 736 passed (736); All files 96.71 / 91.49 / 96.66 / 96.77. Test changed with the plan: create-i18n.test.ts (the names of the four new unsupported steps).
Android: RED 958417e; GREEN 2ca4b37.
$ (cd android && ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.MessagesTest' --tests 'dev.openverify.sdk.ui.SpanishMessagesTest')
23 tests completed, 2 failed
  MessagesTest: java.lang.AssertionError: expected:<[]> but was:<[address_checksum_invalid, address_invalid, address_not_found, country_not_enabled, document_expired, ...
  SpanishMessagesTest: org.opentest4j.AssertionFailedError: expected: <[]> but was: <[address_checksum_invalid, ...
GREEN: MessagesTest tests="19" failures="0"; SpanishMessagesTest tests="4" failures="0"; ResourcesTest tests="7" failures="0".
Deviation: the plan asked for the fixture and both clients' strings in one commit; they landed in four consecutive commits (contracts 5b41253, flow d63242f/17fbbdf, android 958417e/2ca4b37), each package test-first.

## 9. Template rules (C50.4, V18) and default checks (C51.1)
Stub c9fadec; RED b809ff9; GREEN 65c0b71.
RED:
$ (cd packages/contracts && pnpm exec vitest run src/phase5-templates.test.ts src/inquiry-templates.test.ts --coverage.enabled=false)
     × are the registry defaults of document / database / aamva / phone_number / email_address / government_id_nfc / crypto_wallet / database_business / business_website
     × take every verification step with a config for each type
     × are taken by <each API type> as listed, and refused otherwise
     × need an earlier government ID step for an AAMVA step that reads it
     × need an earlier selfie step for an NFC step, and an earlier government ID step when the flow has one
     × keep the offered chains within the allowed chains; × refuse xrpl:0 while the address check is required ...
     × keep the database match groups to the fields the step collects, the default groups too
     × rejects the form step, the only step type clients cannot run (C50.4); × needs at least one verification step; × rejects allowed countries and ID classes on a selfie
      Tests  31 failed | 33 passed (64)
GREEN: contracts Tests 1553 passed (1553).
Tests changed with the plan (C50.4): inquiry-templates.test.ts (form is the one refused step type; "the flow needs a verification step"; selfie's countries message names database-business; `business`, not `document`, is the refused config key).

## 10. Files (C52.4, P16)
Stubs 5f795d4 (the names; the wider FILE_KINDS list made the old list test fail until RED rewrote it), afc5201 (requiredFileKinds over any verification step); RED dd436bf; GREEN (next commit).
RED:
$ (cd packages/contracts && pnpm exec vitest run src/files.test.ts --coverage.enabled=false)
     × lists every kind, and the kinds each verification type owns
     × keeps the server-written kinds out of what a client may upload (C52.4, P16)
     × caps images and documents at 10 MiB, DG2 at 1 MiB and the other chip files at 64 KiB
     × takes a document as an image, or as a PDF whose %PDF- header starts within the first 1,024 bytes
     × takes a chip-sod / chip-dg1 / chip-dg2 / chip-dg14 / chip-dg15 / chip-card-security / chip-card-access / chip-com file only with its first tag and a well-formed outer length
     × types the server-written kinds as PNG images; × lists every media type a file resource may carry
     × needs the document of a document step and the SOD, DG1 and DG2 of an NFC step
     × carry a PDF document or a chip file on their own verification type only
      Tests  16 failed | 27 passed (43)
GREEN: contracts Tests 1570 passed (1570).

## 11. Flow bodies, OTP constants and limits, challenges (C52.2, C52.3, C52.6, C55, C57.2, C57.3, C62.5)
Stub a4588d9; RED c99063a; GREEN 1ecf6da.
RED:
$ (cd packages/contracts && pnpm exec vitest run src/phase5-flow-bodies.test.ts --coverage.enabled=false)
      Tests  35 failed | 3 passed (38)
  (× takes { type: document } ... business-website; × name the OTP, crypto and chip challenges; × take a database body ...; × take an AAMVA body ...; × read registration numbers per registry and LEIs by ISO 17442; × take a business website by an http or https URL ...; × make codes of six to ten digits ...; × name their own limits outside the C12 policies; × are asked for a supported chain and a bounded address; × are submitted with the nonce, a bounded Active Authentication response and a device report; × carry at most one of a selfie capture, a crypto signature or a chip read)
GREEN: contracts Tests 1636 passed (1636); All files 99.84 / 97.86 / 100 / 99.84.
Synthetic LEIs from an independent oracle (python3 ISO 7064 MOD 97-10): 5493000OVERIFY0TES72, 529900SYNTHETIC00045 (valid); one changed check digit is refused.
Tests changed with the plan: flow-api.test.ts (`business`, not `document`, is the unknown type), ids.test.ts (otpc, cwc, chc).

## 12. Attributes with PII marks, PII_VERIFICATION_ATTRIBUTES, guidance (C52.2, C52.8, C53.7)
Stub aae3c89; RED 779a4d7; GREEN (next commit).
RED:
$ (cd packages/contracts && pnpm exec vitest run src/phase5-verification-attributes.test.ts --coverage.enabled=false)
     × describe a verification/<each Phase 5 type> verification
     × mark exactly the PII attributes of a verification/<each> verification, each nullable
     × mask the document fields member-wise; × are built from the record, as the attribute hooks loaded them
     × includes the government ID extraction and the Phase 5 PII
     × carry the guidance of a verification/<each> verification; × are built with the flow attributes the guidance hooks give
      Tests  31 failed | 13 passed (44)
GREEN: contracts Tests 1680 passed (1680); All files 99.85 / 97.86 / 100 / 99.85.
PII_VERIFICATION_ATTRIBUTES (printed with tsx): name-first, name-middle, name-last, birthdate, sex, nationality, identification-number, personal-number, issue-date, expiration-date, issuing-authority-code, address-street-1, address-street-2, address-city, address-subdivision, address-postal-code, address-country-code, endorsements, restrictions, vehicle-class, fields, phone-number, email-address, issuing-authority, wallet-address, expected-address, business-name, associated-persons, registry-legal-name, website-url, website-domain.

## 13. Problem codes and golden problems (C52.7)
Stub dda1806; RED db1eda6; GREEN (next commit, with the 22 fixtures).
RED: (cd packages/contracts && pnpm exec vitest run src/fixtures.test.ts --coverage.enabled=false) Tests 25 failed | 90 passed (115)
  (× freezes the Phase 5 problem codes with their statuses; × holds one golden problem per code, named by it; × carries code <each> with status <n>; × give the client what it needs to wait or retry)
GREEN: contracts Tests 1706 passed (1706). The RED test's own "no value in the problem" check first matched digits in requestId; it now checks the detail only.

## 14. OTP settings (C55.7, V08)
Stub 53a35f7; RED 79bb1a3 (dashboard-api.test.ts: × serve the OTP SMS budget and, read-only, when it last tripped (C55.7, V08); Tests 1 failed | 16 passed (17)); GREEN 1c6de18 (contracts 1707 passed).
The two defaults live in OTP_SETTINGS_DEFAULTS, not DASHBOARD_SETTINGS_DEFAULTS: the API's settings test asserts GET answers DASHBOARD_SETTINGS_DEFAULTS, and serving the setting (resolver, ceiling check, store) is Stage 1b's.

## 15. Golden API fixtures per type (C50.6)
RED edc86e9 (fixtures.test.ts: Tests 30 failed | 114 passed (144): × are exactly the C8 and C20 lists ...; × verification-<type>.json parses and re-serializes unchanged; × has a golden verification/<type> resource, served as Phase 5 servers serve it (C50.6)); GREEN 6fe3c4b (contracts 1736 passed).
The nine fixtures were written by a one-off tsx generator over buildVerificationResource and buildFileResource (not committed); the two Phase 1 verification fixtures gained each check's category by a minimal edit. A handcrafted ULID with an L failed the id pattern first and was corrected.

## 16. Checks: the C35 amendment (C59.4) and the PO-box exports (C67)
Stub fa0a6da; RED 8c3ceca:
$ (cd packages/checks && pnpm exec vitest run src/id-po-box-detection.test.ts src/government-id/providers.test.ts --coverage.enabled=false)
     × expose the mailbox patterns and the address normaliser the check uses
     × answers not_applicable, blocking, when the jurisdiction does not take part (C59.4, a C35 amendment)
      Tests  2 failed | 78 passed (80)
GREEN (next commit): checks Tests 1332 passed (1332); All files 98.97 / 89.69 / 99.66 / 98.9.

## 17. @openverify/node (C18, C50.6, C51.1)

### Refactor first: TS7056
`pnpm exec tsc --noEmit` in packages/node, after the contracts unions gained the nine types:
```
src/client.ts(225,10): error TS7056: The inferred type of this node exceeds the maximum length the compiler will serialize. An explicit type annotation is needed.
```
`OpenVerifyClient` was `ReturnType<typeof resources>`, whose declaration spelled out every response schema (dist/client.d.ts was 533,129 bytes with two types). It is now an interface of named method groups written against `typeof <schema>`; `resources(t): OpenVerifyClient` is checked against it. Behaviour unchanged: `vitest run` 212 passed before and after; declaration 17,027 bytes (`tsc -p tsconfig.build.json --outDir <scratch>`). Commit 45bd713 (refactor).

### Stubs
74ec672: VerificationResourceType, VerificationOf, isVerificationOfType (always false). 8711b36: CheckCategory and the nine narrowed types.

### RED (6524d3f)
`pnpm exec vitest run src/types.test.ts --coverage.enabled=false`:
```
× reads verification/<each of the 11 types> from its golden fixture, recognised by its own type only
× narrows to the attributes of the type it names
AssertionError: expected false to be true // Object.is equality
 ❯ src/types.test.ts:199:56   (expect(isVerificationOfType(verification, type)).toBe(true))
 ❯ src/types.test.ts:218:78
Tests  12 failed | 5 passed (17)
```
Every fixture parsed with the client; only the guard failed.

### GREEN
`resource.type === type`. `pnpm exec vitest run`: Tests 225 passed; 99.09 / 94.69 / 100 / 99.38.

## 18. API completion (C50.5, C59.6)

Stub d37e6b1: `RequiredVerification.silent?`, `VerificationSummary.id?` and `sourceVerificationId?`, unread.

RED ecc259a, `pnpm exec vitest run --coverage.enabled=false src/jobs/inquiry-outcome.test.ts`:
```
× counts every verification step, each with its own or its type default attempts
× marks an AAMVA step that reads the government ID as silent
× ignores a confirmed attempt: the code was accepted, the verification not yet submitted
× counts a latest skipped attempt as done
× completes when it is last and the server skipped it
× fails on a failed bound attempt, whatever attempts the step allows: the user cannot retry a step the server runs
AssertionError: expected [ …(2) ] to deeply equal [ …(11) ]
AssertionError: expected null to be 'completed' // Object.is equality
AssertionError: expected null to be 'failed' // Object.is equality
Tests  6 failed | 37 passed (43)
```
The other new rows ("waits for every new step", "stays open before any government ID decision", "ignores attempts bound to an earlier ID decision", the reviewed-passport-then-licence row) passed under the old rule by coincidence and pin the GREEN against a naive "skipped is done" rule.

GREEN: `requiredVerifications` maps every `isVerificationStep` through `STEP_VERIFICATION_TYPES` and `stepMaxAttempts`, `silent: true` for `aamva` with `source: government_id`; `stateOf` skips `initiated` and `confirmed`, takes `skipped` as passed, judges a silent step on `boundAttempt()` and fails it on a failed bound attempt; failures with a `sourceVerificationId` never count. The worker passes `id`. `vitest run src/jobs`: Tests 308 passed.

## 19. API publish rules and the interim refusal of unrun types (C50.4, C50.6, V18)

Plan-changed expectations first (efbf94f, 0ae7a49): served checks carry `category`; the face threshold lives in `check-config/basis.ts`; every type is recorded, named and served (the old tests asserted Phase 1 types only); the flow body test uses `business`, never an API type. Then the refactor 52df16b (supportedType and the dashboard filter go; `stepForVerificationType`, `stepMaxAttempts`), API unit suite green but the OpenAPI snapshot (regenerated at the end).

RED 34d119a, `pnpm exec vitest run --coverage.enabled=false` on the four files:
```
× answers 422 with a pointer for each publish rule the flow breaks (C50.4, V18)      expected 201 to be 422
× keeps a draft that breaks a C50.4 publish rule, and answers 422 ... when it is published   expected 200 to be 422
× fails permanently, touching nothing, on a type the worker does not run yet (C50.6, C54)
    - "reason": "unsupported_verification",  + "reason": "missing_selfie_center",
× answers 422 for a type whose step the server does not run yet, and creates nothing   expected 201 to be 422
Tests  4 failed | 155 passed (159)
```
(The worker judged a document verification with the selfie checks: the defect the guard closes.)

GREEN: `assertPublishable` adds `templatePublishProblems` (pointer under `/data/attributes`); `jobs/runnable-types.ts` (`RUNNABLE_VERIFICATION_TYPES`, `isRunnableVerificationType`) used by `createFlowVerification` and `processVerification`. Four files: 159 passed; API unit suite 2506 passed, 1 failed (the OpenAPI snapshot, regenerated with openapi:write at the end).

## 20. OpenAPI components (C50.6)
RED 898d61b: `vitest run src/openapi.test.ts` → `× names each verification resource type, full and as the flow serves it` — `AssertionError: expected [ 'ProblemInput', …(33) ] to include 'DocumentVerification'`. GREEN 1f54a33: the 18 Phase 5 resources named in `NAMED_SCHEMAS`; `pnpm --filter @openverify/api openapi:write` twice, md5 de9b4f8e4463e18747943037cc07177c both times (the snapshot diff fell from +52,197 lines without the names to +9,257 with them); src/openapi.test.ts and src/plugins: 140 passed.

## 21. dashboard (C50.6, C51.3, C52.4, C55.7, C55.11, C59.4)
RED from the earlier core and contracts commits, `vitest run` in apps/dashboard before any change:
```
× says aamva_jurisdiction_not_participating in short English words
× puts every permission in exactly one area   (and 13 more permission and role tests: PERMISSION_INFO['sandbox:read'] undefined)
Test Files  5 failed | 173 passed (178)
```
and `tsc --noEmit`: TS2741 'sandbox:read' missing; TS2345 settings-view (the OTP settings read as retention windows); TS2740 VERIFICATION_TYPE_LABELS and FILE_KIND_LABELS missing the new keys.
GREEN a0335ec: sandbox:read in the Environments area, the AAMVA reason words, `OtpSetting` excluded from `RetentionSetting`: 178 files, 1806 tests passed.
Stub b1360f7: empty labels. RED 49d60f2 (`src/lib/verification-type-coverage.test.ts`): 21 failed (`expected '' to match /^[A-Z][^_]{1,40}$/`, `expected 3 to be 11`). GREEN 88d106a for the labels; the nine remaining failures are `expected [ 'verification/government-id', …(1) ] to include 'verification/document'`, the Android values, closed by the Android slice.
RED 21fa0f0: `× says a list of match groups (C51.3) ...` received `match-groups: [object Object], [object Object]`. GREEN: `thresholdText` words match groups; 22 passed.

## 22. Android (C50.6, C52.4, C52.7)
RED 2ac1323, `./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'`: 79 tests completed, 11 failed:
```
api/verification-document.json | SerializationException: dev.openverify.FileKind has no value "document"   (decoder and typed test)
api/verification-database.json | AssertionFailedError: expected: <verification/database> but was: <unknown>   (and the seven other types)
a file kind added after this SDK version decodes instead of failing the document() | SerializationException: dev.openverify.FileKind has no value "kind-from-a-newer-server"
```
The 22 problems/flow fixtures and their listing test passed from the start (the Problem model ignores the extension members).
GREEN 2b45399: VerificationType + 9, FileKind + 11 + UNKNOWN (fallback in the serializer), captureCopy nullable for non-camera kinds, CaptureScreen returns early on none. Two existing WireModelTest expectations changed by the plan (an unknown file kind was rejected; `verification/document` was UNKNOWN). `testAndroidHostTest`: 971 tests, 0 failed. The dashboard coverage test (49d60f2): 29 passed.
RED 46b31fd: `uploadFile refuses the UNKNOWN placeholder kind ... expected: <IllegalArgumentException> but was: <FlowApiException.Rejected>`. GREEN: `require(kind != FileKind.UNKNOWN)`; 972 tests, 0 failed.

## 23. Records and the remaining fixes

- `b856572` (docs, C67): JMRTD and cert-cvc `LGPL-2.1-or-later` and SCUBA `LGPL-2.1-or-later AND GPL-2.0-only WITH Classpath-exception-2.0` in `android/openverify-nfc/NOTICE`, its README and build file, the root README, PLAN §1, §3 and §9 and `THIRD_PARTY_LICENSES.md`; URLhaus not CC0, Safe Browsing and OpenPhish Community excluded as non-commercial; Companies House's reuse statement and UK GDPR; the CSCA master lists operator-fetched and never committed; libphonenumber without carrier data; eight check identifiers and three `document/*` subtypes added to `docs/research/persona-surface.md`. The sources are `docs/research/phase5-nfc.md` §3.1 and §7.1 and `docs/research/phase5-libraries.md` §3.1 and §5. No test reads these files.
- `fcfc2ac` (refactor, dashboard): `pnpm lint` failed with `no-base-to-string` in `selfie-evidence.tsx` (its own `thresholdText` joined a list that may now hold match groups); it now imports the check results' `thresholdText`. Components: 593 passed.
- `b197045` (test, e2e): `no-base-to-string` on `String(threshold)` in `e2e/tests/ui-selfie.spec.ts`; a type guard narrows the face-match threshold to a number first. `pnpm exec eslint .` and `tsc --noEmit` clean in `e2e/`.
- The handoff check found `verification-attributes.ts` missing from the contracts entry point. RED `d67da8c` (`index.test.ts`, one name or more per Phase 5 module): `× re-exports the Phase 5 name DOCUMENT_VERIFICATION_ATTRIBUTES` and 13 more, `Tests 14 failed | 88 passed (102)`. GREEN `b14a9f7`: `export * from './verification-attributes.js'`; no name clashes (`tsc --noEmit` clean); contracts 1,778 passed.

## 24. Final gates

All run in the foreground on the final tree.
- `pnpm exec turbo run typecheck lint --force`: Tasks 24 successful, 24 total (the first forced run found `no-base-to-string` in `e2e/tests/ui-selfie.spec.ts`, fixed in `b197045`; an earlier cached run had hidden it).
- `pnpm format:check`: "All matched files use Prettier code style!".
- `pnpm exec turbo run test --force` (every package's `vitest run --coverage`, no cache), after `b14a9f7`; coverage All files (statements / branches / functions / lines):
  - api 2,508 passed, 97.67 / 90.70 / 98.63 / 97.70;
  - dashboard 1,836, 98.52 / 94.53 / 98.84 / 98.53;
  - contracts 1,778, 99.85 / 97.86 / 100 / 99.85;
  - checks 1,332, 98.97 / 89.69 / 99.66 / 98.90;
  - flow 736, 96.61 / 91.34 / 96.66 / 96.66;
  - core 711, 100 / 96.61 / 100 / 100;
  - db 685, 98.82 / 91.83 / 99.30 / 98.76;
  - node 225, 99.09 / 94.69 / 100 / 99.38;
  - flow-spec 113, 100 / 94.44 / 100 / 100;
  - e2e (unit) 79, 96.71 / 88.07 / 93.24 / 97.70;
  - ui 54, 100 / 97.72 / 100 / 100;
  - config 45, 100 / 100 / 100 / 100.
- `pnpm test:integration`: api 14 files, 62 passed; db 9 files, 48 passed.
- `(cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)`: BUILD SUCCESSFUL; testAndroidHostTest 972 passed and testDebugUnitTest 649 passed (JUnit XML of every module), koverVerify passed.
- `pnpm --filter @openverify/api openapi:write`, twice: the second run changed nothing (md5 `de9b4f8e4463e18747943037cc07177c` both times).
- `flock /tmp/openverify-e2e.lock pnpm e2e` (after `b14a9f7`, the last code commit): the flow's Playwright suite 38 passed; the full-stack suite 50 passed (6.9 min); Tasks 9 successful. Runs before `b197045` and after it had also passed 50 of 50.
