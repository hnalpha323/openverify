# Phase 11, Workflow 11A: api-consent (family K)

Owner: `api-consent` (Stage 3). Contracts: C236 (consent records, both methods, the decline), C237
(withdrawal), C238's server part (the client view, the three exits, the session member, the publish
checks, client-side redemption), C241.1-C241.5 (redaction and retention). Every command ran from
`/home/mhnoor/persona-opensource` after `source scripts/env.sh`; the 1-minute load average from
`/proc/loadavg` is written beside each run. Lock waits were 0 s unless written.

## Checkpoint 1: consent records (C236)

### The repositories (`packages/db/src/repositories/consent-records.ts`, `consent-texts.ts`, `consent-records.cross-env.ts`)

Stub signatures first (`7e569b93a`), so the test typechecks.

RED (`93f9c8a00`), load 5.29:

```
$ cd packages/db && pnpm exec vitest run src/repositories/consent-records.test.ts --coverage.enabled=false
      Tests  18 failed (18)
     11 ConnectRepositoryNotBuiltError: createConsentRecord is not built yet (api-consent)
      2 ConnectRepositoryNotBuiltError: insertConsentTextIfAbsent is not built yet (api-consent)
      1 Error: consentRecordStatusOf is not built yet (api-consent)
rc=1
```

GREEN (`968f08768`), load 6.15: `Tests  18 passed (18)`, rc=0.

The account path of the decline guard (V08): RED `279b72eb8` (load ~6: `AssertionError: expected
false to be true`, 1 of 19), GREEN `d902b3e8f` (19 of 19).

The two reads the consent paths need of a connection and of the citing token, kept in this
repository so checkpoint 1 does not wait for `api-connect`'s repositories: RED with stubs (1 of 20,
`getConsentConnection is not built yet`), GREEN 20 of 20.

### The service and the routes (`apps/api/src/services/connect/consent.ts`, `routes/server/connect-consent-records.ts`)

Stub service first (`ea3292a29`). RED (`00e931f79`), load 7.38:

```
$ cd apps/api && pnpm exec vitest run src/routes/server/connect-consent-records.test.ts src/services/connect/consent.test.ts --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  12 failed | 1 passed (13)
  AssertionError: {... "status":501,"detail":"connect: attest consent record is not built yet." ...}: expected 501 to be 201
  Error: consentRecordResource is not built yet (api-consent)
  Error: consentBodyDigest is not built yet (api-consent)
rc=1
```

The one case already green is the scope case (`connect-consent-records:attest` is refused by the
auth plugin before the route runs), which holds independently of the build.

GREEN (`2dc79e517`), load 13.14:

```
$ pnpm exec vitest run src/routes/server/connect-consent-records.test.ts src/services/connect/consent.test.ts src/routes/connect-consent-routes.test.ts src/openapi.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  48 passed (48)
rc=0
```

`src/routes/connect-consent-routes.test.ts` (foundation-11a's frozen-route suite) changed minimally:
its "while Connect is on, 501" case now covers only the withdrawal, which stays frozen until
checkpoint 2. The documented 501 stays in the route schemas, so `docs/api/openapi.json` is unchanged
(`src/openapi.test.ts` green); integration-11a drops it with the snapshot.

`pnpm exec tsc --noEmit -p tsconfig.json` in `apps/api`: rc=0 (load 31.3 before, 18.4 after; the
first attempt at load 14.0 met its own 400 s `timeout`, rc=124, and was run again).

The db package's whole suite (heavy slot), load 16.78 before and 21.61 after, 549 s: 2,269 of
2,270 passed; the one failure is `src/phase11a-connect-tables.test.ts` > "declares the own-environment
stubs on the entry, each refusing until api-connect builds it", which `api-connect`'s uncommitted
repositories in the shared tree now answer (their file, not this agent's).

### What checkpoint 1 holds

- An attestation (`POST /api/v1/connect/consent-records`, `connect-consent-records:attest`):
  `witnessed: false`, the digest computed over the NFC text sealed on the record, the evidence
  reference sealed, `attested-at` within the last 30 days and never ahead (422 at
  `/data/attributes/attested-at`), `biometric` only with `explicit-biometric` (422
  `explicit_consent_required`), the connection the caller's own (the one generic 404 otherwise, byte
  for byte), the subject in the caller's environment (404) and not redacted (409 `source_redacted`),
  refused while a witnessed decline stands on the subject, on any inquiry of its account, or (for an
  account) on any of its inquiries (409 `consent_declined_in_flow`, V08).
- The list and the retrieve (`connect-share-tokens:read`): the environment's records only, C1 order,
  the filters, the PII members only with `pii:view`.
- `recordFlowConsentInTx`: the `flow` records the step makes (accepted: texts by digest, sealed
  address and user agent; declined: neither, and `declined` whatever happens later).
- Events `consent-record.created` and `consent-record.declined`, each valid under the contract (which
  refuses evidence in a payload).
- The destination side of an attestation reads the inbound token through `cross-tenant.ts`
  (`api-connect`'s `getInboundShareToken`); its test lands once that entry point is built.

## Checkpoint 2: withdrawal (C237)

The copies' mark (`markShareCopiesConsentWithdrawn`, `packages/db`): RED with a stub (1 of 21, `not
built yet`), GREEN 21 of 21.

Stub service first (`withdrawal.ts`), then RED, load 7.71:

```
$ cd apps/api && pnpm exec vitest run src/services/connect/withdrawal.test.ts --coverage.enabled=false
      Tests  8 failed | 1 passed (9)
      3 AssertionError: expected 501 to be 200
      1 NotImplementedError: connect: withdrawConsentRecordInTx is not built yet.
      1 AssertionError: expected 501 to be 404
rc=1
```

The one case already green is the scope case (the auth plugin refuses a key without
`connect-share-tokens:write` before the route).

GREEN (`c96b5e1be`), load 16.4 to 18.5:

```
$ pnpm exec vitest run src/routes/connect-consent-routes.test.ts src/routes/server/connect-consent-records.test.ts src/services/connect/consent.test.ts src/services/connect/withdrawal.test.ts src/openapi.test.ts --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  56 passed (56)
$ pnpm exec tsc --noEmit -p tsconfig.json
rc=0
```

foundation-11a's frozen-route suite lost its "while Connect is on, 501" case for the consent-record
routes: all four are built now (their own suites hold them).

What checkpoint 2 holds: `POST /connect/consent-records/:id/withdraw` (`withdrawn-via: api`) and
`withdrawConsentRecordAs(deps, acting, id, {via: 'operator', reason})` for the console's action;
`withdrawConsentRecordInTx(tx, deps, {environmentId, id, via, reason, actor})` for every channel (the
flow's included). The record is taken `FOR UPDATE` first (the lock order: consent record, then
token); a created token is expired through `crossTenant.expireTokenOnWithdrawal` with
`connect/share-token.expired` on both sides (`stageTokenChange`, `api-connect`'s); a pending one is
left to the redeem job; a redeemed share recalls nothing and the counterparty hears
`connect/share-token.consent-withdrawn`; a destination record's copies gain
`provenance.consent-withdrawn-at`.

## Checkpoint 3: the step and publish (C238.2, C238.3, C238.4, C237.6)

### The publish hook (`services/connect/publish-checks.ts`)

The hook did not receive the publish's given acknowledgements (connect-logic's contractDeviation), so
`cloned_results_without_binding` could never be acknowledged. A named borrowed edit, committed first:
`FlowPublishInput.givenAcknowledgements` in `services/publish/flow-v2.ts`, passed to
`connectPublishChecks`, and `publishRulesInTx` (`services/inquiry-templates.ts`) passes its `given`.

RED, load 15.44: `Tests  12 failed | 2 passed (14)` (the no-op stub; the two already green are the
cross-check of connect-logic's mirrored names and a well-formed step that needs nothing). GREEN, after
making the test's `government_id` step valid (the first run parsed no flow: `sides`, `maxAttempts`
and `captureMethods` are required): `Tests  14 passed (14)`; the publish suites
(`inquiry-template-publish`, `client-unable`, `play-integrity-notice`, `flow-run-grants`,
`inquiry-template-flow-v2`) 19 of 19, load 10.51.

One test per code: `share_consent_connect_disabled`, `share_consent_connection_invalid` (unknown and
inbound connections), the warning `share_consent_connection_not_active`,
`share_consent_after_completion`, `share_consent_after_cloned_step`,
`share_consent_withdrawal_contact_missing`, `share_consent_retention_missing`,
`cloned_results_without_binding` (and its absence once `cloned-results-unbound` is given); one per
acknowledgement: `cloned-results`, `cloned-results-unbound`, `share-consent-default-text`; and the
hook inside `flowPublishReport` with the given acknowledgements.

### The view and the exits (`services/flow-views/share-consent.ts`, `routes/flow/share-consents.ts`)

RED, load 7.56: `Tests  7 failed (7)` (no view, 501). The first GREEN run failed 5 of 7 with 500
"Response doesn't match the schema" on `GET /flow/session`: the v1 projection
(`packages/flow-spec/src/v2/projection.ts`) listed the `share_consent` step, a type the v1 schema
refuses. A defect in a shared file, fixed by a borrowed edit test-first: RED 1 of 28 (the step listed),
GREEN 28 of 28 and the v2 suites 345 of 345 (`share_consent` has no v1 form: the placeholder).

GREEN (`ef27a190e`), load 9.09: the step test 7 of 7; with the session, preview, screen,
template-plumbing and hook suites 123 of 123 (after narrowing foundation-11a's frozen-exit and
stub-behaviour cases to what is still unbuilt). `tsc --noEmit` rc=0, load 10.77.

## Checkpoint 4: redaction and retention (C241.1-C241.5, C236.10)

`deleteEndedShareTokens` (`packages/db`): RED with a stub (1 of 22), GREEN 22 of 22.

RED (the hooks and the pass were no-ops), load 11.61:

```
$ cd apps/api && pnpm exec vitest run src/services/connect/redaction-hooks.test.ts --coverage.enabled=false
      Tests  4 failed (4)
AssertionError: expected { status: 'created', …(2) } to match object { status: 'failed', …(1) }
AssertionError: expected [] to include 'cnst_…'
AssertionError: expected null not to be null
AssertionError: expected 0 to be greater than or equal to 1
rc=1
```

GREEN, after reading the outbox through the events repository (the test first read the sealed
`events.payload` column with SQL): 4 of 4. The redaction and retention suites around the hooks
(`redaction.test.ts`, `redaction-transactions.test.ts`, `retention*.test.ts`, foundation's routes
suite): 79 and 47 of 79 and 47, load 19.67.

Testcontainers (Postgres 17), each through a heavy slot; written after the code they exercise, so
there is no RED run (the locks were built at `968f08768` and `c96b5e1be`):

- `packages/db/src/repositories/consent-texts.integration.test.ts`, 4 of 4, load 24.99: one row when
  two sessions store one text (the first commits, or rolls back); a pass skips a text a session holds;
  a text deleted first is written again. A first run failed on the test's own isolation (a count of
  every deletable text, 2 not 1), fixed in the test.
- `apps/api/src/services/connect/consent.integration.test.ts`, 4 of 4, load 30.66: V08's account
  path; two withdrawals at once, both orders; the source redacted 31 days after a redemption (the
  pass keeps the token, the destination hears `source-redacted`).

## Checkpoint 5: client-side redemption (C238.1, C238.4, C238.5, C234.11)

After `api-redeem`'s "checkpoint 2 (job)" (`b315bcb49`, `requestFillInquiryRedemptionInTx`).

RED, load 33.67: `Tests  4 failed | 1 passed (5)` for `services/connect/client-side.test.ts`
(`NotImplementedError: connect: client-side redemption is not built yet.`; the engine left the
position at `share-in`). The case already green is the route's 501, which holds while
`cross-tenant.ts` has no reservation entry point. That RED commit (`292946261`) carried an unused
import and a parameter typed `unknown`, which the GREEN commit fixed: it lint-failed and did not
typecheck in between (recorded, not hidden).

RED for the destination side (`routes/flow/share-consents.destination.test.ts`): the first run failed
on the test's own setup (the destination text needs a retention term, C238.9); with the
environment's `inquiry-retention-days` set, `Tests  2 failed | 1 passed (3)` (the token stayed
`created`, the route answered 200); the decline case holds already.

GREEN (`fa70765f1`): the engine skip first missed the entry's positioning (`position.ts` enters the
entry step itself), so the skip moved from `apply`'s `step` case into `leaveIfDecided`, which both
paths call: 5 of 5; with the step suites 15 of 15; the flow-engine suites 110 of 110 (load 29.77);
`tsc --noEmit` rc=0.

What it holds: `createInquiryWithShareToken` (the checks of C238.5 in order, the inquiry and the
reservation in one transaction under the token's lock); the engine skipping a destination step on an
inquiry without a token (outcome `skipped`); the destination accept recording the destination record
and requesting `fill-inquiry` in the exit's transaction, its job enqueued after the commit. Two
entry points `cross-tenant.ts` lacks (`reserveInboundShareToken`, and `api-redeem`'s
`markInboundShareToken`) make both answer 501 in production until `api-connect` or `integration-11a`
adds them; the tests pass fake ports, as `api-redeem`'s do. The waiting position until the job ends
needs a resume hook at the job's end, which the job does not have: the step is left at once instead.

## End gates (rule 23: the packages api-consent touched)

Lock waits are the heavy slot's (`/tmp/openverify-heavy.sh`); every gate below exited 0.

| Call | Wall | Load before / after | Result |
|---|---|---|---|
| `apps/api`: `pnpm run lint` (heavy slot) | 220 s | 10.38 / 1.63 | rc=0 |
| `apps/api`: `pnpm run typecheck` | 95 s | 1.50 | rc=0 |
| `packages/db`: `pnpm run lint`, `pnpm run typecheck` | 405 s, 209 s | 31 to 33 | rc=0 (the typecheck found a cast in the texts' race test, fixed in `fix(db)`) |
| `packages/flow-spec`: lint, typecheck | 72 s, 50 s | 29.21 | rc=0 |
| API unit, 24 blob shards (12 did not fit: shard 2 met its 420 s limit at load 54) | 85 to 361 s each | 14 to 54 | each rc=1 alone (partial coverage), as expected |
| API merge (the gate) | 114 s | 6.64 / 3.59 | rc=0: 10,108 tests in 765 files, 94.12% statements |
| db unit with coverage | 192 s | 3.19 / 12.27 | rc=0: 2,272 tests in 158 files, 89.86% |
| integration db / graph / api 1-3 of 3 | 125 / 50 / 119, 189, 118 s | 8 to 24 | rc=0: 87 / 13 / 103, 114, 177 |
| `pnpm exec prettier --check --ignore-path=.gitignore` over every file of this agent | | | rc=0 |

The first merge failed 1 of 10,108: foundation-11a's frozen case for `meta.share-token-id` still
expected 501; it now expects the one 404 for a token not inbound to the caller. Shard 1 (which holds
the file) ran again and the merge passed. The first forced turbo lint calls met the 10-minute cap at
load 25 to 34 (other agents' suites), so the package lint ran as `pnpm run lint` per package, the API
once the load fell.
