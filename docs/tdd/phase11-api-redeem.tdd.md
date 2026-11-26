# Phase 11, Workflow 11A: api-redeem (family R, Stage 3)

Owner: `api-redeem`. Contracts: C234 (redeem: the route's synchronous part, the `connect-redeem` job,
clone, hydrate, transactions, limits, `redeem-summary`, `fill-inquiry`), C235 (provenance, what a
cloned pass counts for), C241.1's pending failure, C236.10 and the races of C287.2.

Owned paths: `apps/api/src/routes/server/connect-redeem.ts`, `apps/api/src/jobs/connect-redeem/`,
`apps/api/src/services/connect/{redeem,clone,hydrate,cloned-results}.ts` and their tests.

Every command below ran from the repository root after `source scripts/env.sh` unless it says
otherwise; the load average (`cat /proc/loadavg`) is written beside each timing.

## Checkpoint 3 (cloned results), built first

The plan's order puts checkpoint 3 after the route and the job, but its pure wiring needs nothing
from `api-connect`, so it was built while `api-connect`'s checkpoint 2 was outstanding (the bullet
says so).

### Stub (ca211d549)

`apps/api/src/services/connect/cloned-results.ts` gained the names the tests read, each answering as
the Stage 1b stub did (no clone counts): `acceptClonedResultsOf`, `clonedVerdictOf`,
`clonedInquiryReview`, `clonedRelianceOf`, `servedProvenance`, `withInquiryProvenance`;
`verificationCountsInWorkflows` takes an optional time.

### RED

Tests: `apps/api/src/services/connect/cloned-results.test.ts` (PGlite) and
`apps/api/src/services/connect/cloned-results.workflow.test.ts` (Phase 8's action harness).

```
$ (cd apps/api && pnpm exec vitest run src/services/connect/cloned-results.test.ts \
    src/services/connect/cloned-results.workflow.test.ts --coverage.enabled=false)
 Test Files  2 failed (2)
      Tests  15 failed | 7 passed (22)
   Duration  19.40s            (load 3.45 2.31 2.36)
```

The 15 fail for the intended reason: the stub counts no clone (the setting reads off, the verdict is
always `accept_cloned_results_off`, the settlement stays `pending` with a listed fresh clone, the
workflow's approving branch never runs on a counted clone), the decision record writes
`relied_on_cloned = false` with no token (the repository drops both columns and `record.ts` computes
neither), and the inquiry resource has no `provenance`. The 7 that pass already hold today: no clone
counts while the setting is off, a verification the destination ran counts, an unlisted type and a
failure never count.

### GREEN (a930a12f9, fixed by bf618e675)

`cloned-results.ts` built over `connect-logic`'s `clonedResultVerdict`, `clonedInquiryOutcome` and
`reliedOnCloned`, with four named borrowed edits, each committed with the tests above:
`services/decisions/record.ts` (the decision record computes `clonedRelianceOf`),
`packages/db/src/repositories/inquiry-decisions.ts` (writes `relied_on_cloned` and `share_token_id`),
`services/inquiries.ts` (`inquiryResourceFor` serves a copy's `provenance`) and
`workflows/actions/objects/table.ts` (the hook passes the clock).

```
$ (cd apps/api && pnpm exec vitest run src/services/connect/cloned-results.test.ts \
    src/services/connect/cloned-results.workflow.test.ts src/services/connect/cloned-results.hooks.test.ts \
    src/services/decisions/ --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  55 passed (55)            (load 4.57 3.01 2.61)
$ (cd apps/api && pnpm exec vitest run src/services/inquiries src/routes/server/inquiries \
    src/workflows/actions/actions-objects.test.ts src/workflows/actions/decisions --coverage.enabled=false)
 Test Files  3 passed (3)
      Tests  122 passed (122)          (load 6.56 3.67 2.84)
```

a930a12f9 wrote `reliedOnCloned` and `shareTokenId` into `createInquiryDecision` without declaring
them on `NewInquiryDecision`, so the API typecheck failed (`TS2353`, `TS2339`); bf618e675 declared
them (the API typecheck then reported none of my files).

## The clone writer (`services/connect/clone.ts`)

Stub fad19b6bf; RED 12cb585b0: 7 of 7 fail (not built), load 7.97 7.74 5.60. GREEN 6b5ac65bc:
7 of 7, 22.0 s, load 7.63 7.84 5.82. Two test defects fixed before GREEN, each in the test: the
fixture used file kinds `front_photo`/`back_photo` (the enum is `front`/`back`), and the shared
fixture read `files[0]` of a material with no files.

## The hydrate writer (`services/connect/hydrate.ts`)

Stub b6c108a12; RED 63e8c5b76: 5 of 5 fail (not built), 106 s at load 29.23 25.95 21.12 (other
agents' suites). GREEN d788d248c: 5 of 5, 52 s at load 28.26 28.24 23.20. One test defect fixed: an
allowlisted key the destination does not declare (`not_declared`) is dropped and listed, as
`resolveHydrateMappings` says; the first expectation left it out.

## Checkpoint 1 (redeem route)

### The synchronous part (`services/connect/redeem.ts`)

Stub 81d42d809 (the service, its port `RedemptionCrossTenant` with the production binding
`redemptionCrossTenant`, and `loadRedemptionMaterial` in `clone.ts`); RED dd762d2e3: 14 of 14 fail
with 501 (not built), 59.6 s at load 10.73 15.02 16.71. GREEN 23802b51e: 14 of 14 (34.4 s, load
7.97 13.00 15.75) after two test defects: the destination record of the `subject` case had no
subject (a destination record's subject is its token until redemption, C236.1, so the coverage
answered `missing` first, as its order says), and the request entry was asserted from the audit log
while `deps.audit` in the harness records in memory: the entry is now written with `appendAuditLog`
directly, because the job reads the request and its actor back from it (ids and keys only).

### The route (`routes/server/connect-redeem.ts`)

RED 810010357: `connect-redeem.test.ts` 2 of 2 fail (the frozen route answers 501). GREEN 23802b51e: the
route calls `redeemShareToken` (rate policy first, then the service, 202). The conflict test first
named `/meta/account-id`; on a clone `shareRedeemMetaConflicts` names the auto-create members.
`routes/connect-routes.test.ts` (foundation-11a's, extended by api-connect) changed minimally: the
redeem route is no longer held to 501 but to "never 501".

```
$ (cd apps/api && pnpm exec vitest run src/services/connect/ src/routes/server/connect-redeem.test.ts \
    src/routes/connect-routes.test.ts src/services/decisions/ --coverage.enabled=false)
 Test Files  19 passed (19)
      Tests  255 passed (255)          (88 s, load 6.78 8.64 12.41)
```

**What the route cannot do yet.** The destination's change of an inbound token (`pending`, and the
job's `redeemed` or `failed`) is a write of a row in the source environment, so it belongs in
`cross-tenant.ts` (rule 20(a)); that module has no such entry point. The production binding calls
`crossTenant.markInboundShareToken` when it exists and otherwise rejects with `notBuilt` (501). The
suite passes a port whose `markInboundShareToken` writes the row with SQL, exactly as the entry point
would. Contract deviation: `api-connect` (or `integration-11a`) adds
`markInboundShareToken(tx, caller, token, changes): Promise<ConnectShareToken>` over
`connectShareTokensCrossEnv.updateInboundShareToken(tx, caller.environmentId, token.id, changes)`.

**For `workflow-connect`.** The `redeem_share_token` action calls
`redeemShareTokenInTx(tx, {deps, acting, now}, shareTokenId, body)` in the step's transaction
(`acting` is an `Acting`, optionally with `principal`); the answer is `{token, staged, job}`, and the
action enqueues `job` after the commit with `enqueueRedemption(deps, job)`.

## Checkpoint 2 (job)

Stub a2201f58c (the job's deps gain `events`, `api`, `ids` and the port; `requestFillInquiryRedemptionInTx`
rejects not built); RED 464c75a99: 8 of 8 fail (`connect-redeem is not built yet`), 26.3 s at load
7.31 9.44 11.16. GREEN 9ae07d768: 8 of 8 at load 10.62 10.33 11.27 after one fixture defect: the
seeded check was named `id_expired`, which the verification resource refuses (the registry's name is
`id_expired_detection`), so `loadShareSource` threw and the job ended `unrecoverable_error`.

```
$ (cd apps/api && pnpm exec vitest run src/jobs/connect-redeem/ src/services/connect/ \
    src/worker-connect.test.ts src/routes/connect-routes.test.ts src/routes/server/connect-redeem.test.ts \
    --coverage.enabled=false)
 Test Files  1 failed | 19 passed (20)
      Tests  1 failed | 247 passed (248)   (123 s, load 25.12 17.66 13.97)
```

The one failure is `worker-connect.test.ts > startWorkers: connect-token-expiry (C232.5) > fails a
pass loudly until api-connect builds it`: `api-connect` built the sweep, and that test (theirs) still
expects `notBuilt`. Not in my paths; reported to them in my contract deviations.

**What the job needs that is not there yet** (contract deviations, exact changes):

- `cross-tenant.ts`: `readRedemptionSource(tx, caller, token)` returning `RedemptionRead`
  (`services/connect/redeem.ts`): the connection FOR SHARE (`lockConnectionForShare`), the source
  consent record FOR SHARE (`lockConsentRecord(tx, token.environmentId, token.consentRecordId,
'share')`), the token FOR UPDATE, the policy version, the source organisation's name, and
  `{loaded: loadShareSource(...), material: loadRedemptionMaterial(tx, token.environmentId, ids)}`;
  `process.test.ts`'s port is exactly that body. And `markInboundShareToken` (checkpoint 1).
- `worker.ts` (one line): pass `events` (the worker's publisher) and `api` (an `ApiDependencies`
  for the hydrate write paths) to `processConnectRedeem`; without `events` a job fails loudly.

**For `api-consent`** (client-side redemption): in the destination-side accept's transaction call
`requestFillInquiryRedemptionInTx(tx, {deps, caller: {organizationId, environmentId,
environmentKind}, actor, request: {'share-token-id', 'inquiry-id', 'destination-consent-record-id'},
now})`; it answers `{job, token}`; enqueue `job` after the commit with `enqueueRedemption(deps, job)`.
`actor` is the principal that created the inquiry with `meta.share-token-id` (its fields are then
hydrated as that principal), or `null` (the verifications are cloned and the fields left alone).

## Checkpoint 3 (cloned results)

Built first (the sections above): `cloned-results.ts` behind foundation-11a's three hooks (the
decision path's loads, Phase 8's `fetch_object`, the rollup predicates), the decision record edit
(`relied_on_cloned`, `share_token_id`), the inquiry resource's `provenance` on every `inquiry.*`
read and event (C235.7(a)), and the event rule as the job keeps it: a clone stages no
`verification.*` or check event (`process.test.ts`, "tells both sides and stages no verification
event"; `clone.test.ts`, "stages no event"). A workflow routing on a verification's status cannot
approve on an uncounted clone (`cloned-results.workflow.test.ts`); the analytics exclusion is
foundation-11a's predicate, held by `cloned-results.hooks.test.ts`.

**Open:** C235.4's "a cloned failure routes the inquiry to review" holds for a cloned inquiry (the
job's settlement, `copy.ts`). For a live inquiry filled by `fill-inquiry` the decision path drops an
uncounted clone (a fresh listed failure is not counted), so the person's live step decides; routing
that inquiry to review needs a hook in the settlement and the engine that reads
`clonedInquiryReview`, which is a shared file: a contract deviation.

## Checkpoint 4 (races)

`jobs/connect-redeem/redeem-races.integration.test.ts` (Testcontainers Postgres through
`startIntegrationPostgres`), each race in both orders, one transaction held inside its locks
(`testing.ts`'s port holds) and the other started against it, `within(…, 1,500 ms)` showing it waits:

| Race              | First                      | Outcome                                                                                      |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| double redemption | same destination record    | the second waits on the record, then 409 `share_token_already_redeemed`                      |
| double redemption | another destination record | the second waits on the token, then 409 `share_token_already_redeemed`                       |
| expiry            | the sweep                  | the redemption waits on the token, then 409 `share_token_expired`                            |
| expiry            | the redemption             | the sweep skips the locked token (`SKIP LOCKED`); it stays `pending`                         |
| deactivation      | the deactivation           | the redemption waits on the token, then 409 `share_token_expired`                            |
| deactivation      | the redemption             | the deactivation waits, expires nothing (`created` only); the job ends `connection_inactive` |
| withdrawal        | the withdrawal             | the redemption waits on the record, then 422 `consent_required` (`withdrawn`)                |
| withdrawal        | the redemption             | the withdrawal waits; the job ends `consent_withdrawn`                                       |
| source redaction  | the redaction              | the job waits on the token, then ends `source_redacted` (C241.1)                             |
| source redaction  | the job                    | the redaction waits; the copy is of the committed source, `redeemed` (C241.2)                |

```
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts \
    --project api src/jobs/connect-redeem/redeem-races.integration.test.ts)
 Test Files  1 passed (1)
      Tests  10 passed (10)            (108 s with the container, load 22.30 24.07 19.93)
```

No RED run: these hold the locks checkpoints 1 and 2 built test-first, and they passed on their
first run; a RED would need the locks removed. The deactivation, the expiry sweep and the
withdrawal run the real repositories and cross-tenant entry points (`lockConnectionForUpdate`,
`updateConnection`, `crossTenant.expireTokensOnDeactivation`, `expireDueShareTokens`,
`lockConsentRecord`, `withdrawConsentRecord`). The source redaction is simulated as C241.1 asks the
redaction cascade to behave: the inquiry redacted and the source's tokens held FOR UPDATE in the same
transaction. That lock is `api-consent`'s redaction hook's to take (contract deviation); without it a
redaction does not serialise with a pending job.

C236.10 (the destination record follows the copy, the token id kept) is `process.test.ts`'s
"moves the destination record to the copy"; the Testcontainers case that redacts a clone and finds
the destination record's evidence cleared needs `api-consent`'s redaction cascade
(`redactConsentRecordsOfSubject` reached from `connectRedactionHooks.inquiryRedactedInTx`), so it is
listed as a followup for `api-consent` or `integration-11a`.

Lint (0f985c93d): the API lint over my files found 58 findings (non-null assertions in tests and two
sources, optional chains, unused bindings, a base-to-string); fixed without disabling a rule, and the
suites re-run green (58 of 58).

## Final gates (rule 23: beside five other Stage 3 agents)

Each call in the foreground through the heavy slots (rule 22), lock waits inside the times:

- API unit suite, 12 blob shards: 271, 487, 363, 385, 507, 449, 369, 192, 234, 443, 284, 332 s
  (load 18 to 34); the merge 163 s: **2 failed | 10,098 passed (10,100) in 763 files, 94.13% lines**.
  The two failures are other agents' files, not mine: `routes/connect-consent-routes.test.ts`
  (`api-consent` built the inquiry create with `meta.share-token-id`; its frozen-501 case still
  expects 501) and `workflows/reference-docs.test.ts` (`docs/workflows/actions.md` is not
  regenerated for `workflow-connect`'s actions). The merge exits 1 on them.
- `@openverify/db` suite with coverage: 2,272 passed in 158 files, 89.86% lines (477 s, load
  30.71); exit 0.
- `test:integration`, five calls, each exit 0: db 87 (375 s), graph 13 (134 s), api 103 / 114 / 177
  (245 / 406 / 263 s; load 23 to 51), the race suite among them.
- `pnpm --filter @openverify/api typecheck`: exit 0 (452 s, load 35.40).
- Forced API lint (`NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force
--concurrency=1 --filter=@openverify/api`): exit 0, but 811 s at load 21 to 32, past the 10-minute
  cap of one call (it finished in the background); a later run at this load splits it by folder.
- `pnpm exec prettier --check --ignore-path=.gitignore` over every file I touched: exit 0.
