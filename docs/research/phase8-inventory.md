# Phase 8 inventory: the code Phase 8 builds on, at its base

Taken by `contracts-8a` (Workflow 8A Stage 1a) at the Phase 8 base `0d27c8f573565644cc0728fd22549f4aba6437ca`, before any Phase 8 code. Every claim carries its `path:line` at that commit; a path is relative to the repository root unless the section says otherwise. Drift against the plan is collected in the last section and recorded as "Workflow 8A Stage 1a amendments (contracts-8a)" at the end of `docs/plans/phase-8.plan.md`.

## 1. The Starting point, re-verified

| Row of the plan | At the base | Verdict |
|---|---|---|
| Identifiers | Two prefix tables, `packages/contracts/src/ids.ts:11` and `packages/db/src/ids.ts:8`, lower-case letters only; `wfl`, `wfv`, `wfd`, `wfr`, `srrun`, `accac`, `wsec`, `wfst`, `wftd`, `wfsc`, `wfef`, `wfrf`, `idec` and the 8B prefixes are free in both. Phase 7 took `dev`, `net`, `hnd`, `lst`, thirteen `li*`, `lmt`, `mprt`, `txn`, `txntp`, `txntpv`, `txnl`, `txnf`, `grphq`, `grqt`, `grqtv` (`ids.ts:48-82`) | Holds; the plan's list omits `hnd`, `txntp`, `txntpv`, `grqt`, `grqtv`, already named in its outcome 14 |
| Events and outbox | `createEventPublisher` at `apps/api/src/events/index.ts:48`; `stage` at `:52` (`createEvent` then `listWebhooksForEvent`); `StagedEvent { eventId, deliveries }` at `:32`; `EventPublisherOptions { db, deliveries, ids?, logger? }` at `:24`. Only webhook simulation calls `createEvent` itself, with `simulated: true`, at `apps/api/src/services/webhooks.ts:424` | Holds. The simulated caller is `services/webhooks.ts`, not `services/simulate.ts` |
| `stage()` call sites | 26 `events.stage(` calls in 18 files of `apps/api/src`, tests excluded | C121.3's "17 existing call sites" is out of date; the context read inside `stage()` is unaffected |
| Claims, sweeps, jobs | C74.1's fenced claim on `report_runs`: `not_before`, `enqueued_at`, `attempt`, `claimed_by`, `claimed_until` at `packages/db/src/tables/reports.ts:350-358`; sweeps take rows `FOR UPDATE SKIP LOCKED` (`packages/db/src/repositories/report-runs.ts:312`, `:373`); `describeJobError` in `apps/api/src/jobs/error-description.ts`; `upsertJobScheduler` at `apps/api/src/worker.ts:320`, `:944`; the left-over-id trap in the header of `apps/api/src/webhooks/queue.ts:4` | Holds |
| Queue library | `bullmq` 6.3.11 at `apps/api/package.json:61`; `cron-parser` 5.10.1 and `luxon` 3.7.2 in the lockfile through it (`pnpm-lock.yaml:2962`, `:3737`); Valkey runs `--appendonly` (`infra/docker-compose.yml:216`) | Holds; 6.3.14 (2026-10-13, 19 days old) depends on `cron-parser` 5.10.2 (2026-10-09) |
| Inquiry actions | `performInquiryAction` at `apps/api/src/services/inquiries.ts:774`, `applyInquiryAction` at `:738`, `transitionInquiryInTx` at `:658`; `INQUIRY_TRANSITIONS` at `packages/core/src/inquiry-state-machine.ts:34`; `INQUIRY_EVENT_BY_STATUS` at `:6`; the decline's face deletion at `services/inquiries.ts:691-694` | Holds |
| Principals and audit | 38 API scopes and 9 operator permissions, 47 permissions in all (`packages/core/src/permissions.ts:9`, `:65`); `NOT_FOR_VIEWERS` is `api-logs:read`, `audit-logs:read`, `sandbox:read`, `graph:read` (`:118`); `audit_actor_type` at `packages/db/src/tables/enums.ts:107` | **Drift**: the plan's "36 permissions (28 API scopes, 8 operator)" counts neither Phase 7 nor `settings:privacy` |
| Outbound HTTP | `createOutboundHttp` at `apps/api/src/http/index.ts:310`, `method: 'GET' \| 'POST'` at `:77`; the guard in `apps/api/src/webhooks/ssrf.ts` (`AddressCategory` `:15`, `WebhookNetworkPolicy` `:30`, `classifyAddress` `:144`, `isAddressAllowed` `:159`); `createVettedLookup` at `apps/api/src/webhooks/http-sender.ts:96` | Holds |
| C85.1 stream client | `apps/api/src/http/stream.ts`: `STREAM_NO_CONTENT_TYPE` `:46`, `followableRedirect` `:77` (one redirect keeping scheme, host and port); reached through `OutboundHttp.streamClient` (`http/index.ts:154`); the network clients use it since 7A | Holds; not refactored by 8A (outcome 9) |
| Webhook signatures | `packages/node/src/webhook-signature.ts:4` (`t=<unix>,v1=<hex>`), the header pattern at `:29` (at most `MAX_SIGNATURES` `v1`), `verifyWebhookSignature` at `:155` | Holds; the pattern already refuses a `w1=` value, so C124.6's refusal is a test, not new code |
| Mail and SMS | `Mailer` port at `apps/api/src/ports.ts:1695`, `createMailer` at `apps/api/src/mail/index.ts:39`; the sandbox SMS sink key `openverify:sandbox-sms:<environment>` at `apps/api/src/providers/sms/sandbox.ts:21-24`; `createSandboxSmsSender` `:51`, `readSandboxSmsSink` `:95` | Holds |
| Secrets at rest | `sealValue` `packages/db/src/sealed.ts:30`, `sealJson` `:50` | Holds |
| Idempotency | `apps/api/src/plugins/idempotency.ts:5` (24 hours), its principal columns at `:205-206` | Holds; `principal_type` (`enums.ts:133`) stays `api_key`, `user`: no run posts through a route |
| Files and storage | `files.verification_id` NOT NULL at `packages/db/src/tables/verifications.ts:155` | Holds |
| Dashboard | `next`, `react`, Tailwind 4, `cytoscape` at `apps/dashboard/package.json:21-43` | Holds |
| Rate limits | `RATE_LIMIT_POLICIES`, `RATE_LIMIT_DEFAULTS`, `RATE_LIMIT_POLICY_WINDOWS` at `packages/contracts/src/rate-limits.ts:8`, `:43`, `:66`, per window since 7A | Holds (outcome 14) |
| Test databases | `migratedTemplatePath` `packages/db/src/testing.ts:102`, `MIGRATED_TEMPLATES_KEPT` `:118` | Holds (outcome 1) |
| CI | 13 jobs with these `timeout-minutes` (`.github/workflows/ci.yml`): `lint` 30 (`:31`), `node` 20 (`:45`), `unit-api` 30 (`:81`), `unit-api-coverage` 20 (`:113`), `unit-dashboard` 20 (`:140`), `format` 10 (`:160`), `integration` 30 (`:172`), `infra` 10 (`:200`), `vision` 30 (`:242`), `android` 45 (`:313`), `android-instrumented` 60 (`:393`), `e2e` 70 (`:476`), `secrets` 10 (`:556`) | Holds (outcome 2) |
| Newest migration | `packages/db/drizzle/0026_transaction_relations_page_index.sql` | 8A's one migration is `0027` (outcome 12) |
| Pinned mail | `nodemailer` 10.1.6 at `apps/api/package.json:68`, past the 10.1.4 advisories | No bump (outcome 13) |

## 2. The redaction guard and what it leaves

- `ENDED_BY_REDACTION` is `pending`, `completed`, `failed` at `packages/db/src/repositories/inquiries.ts:349`, read at `:387`. A redacted inquiry can therefore still move `completed -> approved | declined | needs_review`, `failed -> approved | declined | needs_review` and `needs_review -> approved | declined`, and it still expires.
- So `approve_inquiry`, `decline_inquiry`, `mark_inquiry_for_review` and the new `reopen` each check `redacted_at` under the inquiry lock themselves (outcome 6). `on-list-match` does the same in `apps/api/src/jobs/lists/screen.ts` (Phase 7 Stage 3 api-lists amendment 8).
- The report service answers 410 for a redacted link: `RedactedError` at `apps/api/src/services/reports/reports.ts:413` (account) and `:564` (inquiry), and 410 `report_redacted` from `assertNotRedacted` at `:164`.
- Row codes, not public errors: `inquiry_redacted` on `list_screenings` (`jobs/lists/screen.ts`) and on graph-index jobs. C127's `subject_redacted` stands.

## 3. The workflow-run actor: every pin

| Pin | Where | Reads as a run today | Change (this call) |
|---|---|---|---|
| `audit_actor_type` | `packages/db/src/tables/enums.ts:107` | refused by the enum | gains `workflow_run` |
| `audit_logs` | `packages/db/src/tables/audit-logs.ts:31` | the enum | none |
| `report_actions_actor_valid` | `packages/db/src/tables/reports.ts:439-442` | refused | gains `wfr_` |
| `transaction_status_history_actor_valid` | `packages/db/src/tables/transactions.ts:309-312` | refused | gains `wfr_` |
| `list_items_created_by_type_valid` | `packages/db/src/tables/lists.ts:252`, over `LIST_ITEM_CREATOR_TYPES` `:98` | refused | gains `workflow-run` |
| `REPORT_ACTOR_TYPES` | `packages/core/src/report-state-machine.ts:156` | absent | gains `workflow_run` |
| `ReportRedactionActor` | `apps/api/src/services/reports/redaction.ts:35-37` | absent | gains it |
| `createAuditLogger.record` | `apps/api/src/services/audit-log.ts:49` | **stored as `user`** with a `wfr_` id | exhaustive |
| `reportRedactionActorOf` | `apps/api/src/services/redaction.ts:95-102` | **stored as `api_key`**, refused by the check | exhaustive |
| `actionActor` | `apps/api/src/services/reports/reports.ts:686-693` | **stored as `api_key`**, refused by the check | exhaustive |
| `actorOfHistory` | `apps/api/src/services/transactions/transactions.ts:116-119` | **stored as `api_key`**, refused by the check | exhaustive |
| the bulk add-to-list creator | `apps/api/src/services/graph/actions.ts:196-199` | **recorded as a `user`** | exhaustive |
| the creator cast | `apps/api/src/services/lists/biometric/items.ts:123` | passes any type through a cast | the cast goes |
| `servedActorOf` | `apps/api/src/services/audit-log.ts:99-112` | fails typecheck on the new enum value | gains its case |
| `actorTypeOf` | `apps/api/src/services/transactions/history.ts:32-42` | fails typecheck on the new enum value | gains its case |
| `auditActorSchema`, `AUDIT_ACTOR_TYPES`, `actorIdSchema` | `packages/contracts/src/user-audit-logs.ts:19`, `:34`, `:76` | refused | gain `workflow-run`, `wfr_` |
| `reportActionResourceSchema.actor` | `packages/contracts/src/reports.ts:1273`, over `actorId` `:209` | **the plan names none: the parse would throw at `GET /reports/:id/history`** | gains `wfr_` for the action resource only |
| the ignored-match `user` | `packages/contracts/src/reports.ts:266` | n/a | stays `usr_` or `key_`: no run reviews or dismisses a report (outcome 15) |
| the review event's `reviewer` | `packages/contracts/src/events.ts:111` | n/a | stays, for the same reason |
| `listItemCreatorIdentifierSchema` | `packages/contracts/src/identifiers.ts:105` | refused | gains `workflow-run` |
| `labelOf` | `apps/dashboard/src/components/operators/audit-actor.tsx:23-39` | **reads "User"** | reads "Workflow run", test-first |
| `Actor` in the report history | `apps/dashboard/src/components/reports/report-history.tsx:103` | **reads "User"** (a binary `startsWith('key_')`, which no typecheck catches) | reads "Workflow run", test-first |
| the audit log's actor filter | `apps/dashboard/src/components/operators/audit-log-query.ts:51` | **refuses the link every run entry carries** | takes `wfr_`, test-first |
| `STATUS_CHANGE_ACTOR_WORDS` | `apps/dashboard/src/components/transactions/transaction-words.ts:14` | fails typecheck | gains its word |
| `Principal`, `actorOf` | `apps/api/src/ports.ts:1464`, `:1505` | a run has no `Principal` | none: a request is never a run, and `actorOf` stays two-way by type |
| every `principal.kind` ternary | `api-keys.ts:87`, `:159`; `graph/shared.ts:243`; `principal-auth.ts:133`; `idempotency.ts:205`; `api-logs.ts:105`; `rate-limit.ts:174`; `auth/pii.ts:70` | n/a | none: they read `Principal`, which does not widen |

`actor.id` readers that need no change, because a run's id is a plain string: `auditEntryOf` (`services/context.ts:213`), `consumeListMatch` (`services/lists/lists.ts:305`, which a run never reaches: Get List Match calls the engine in `services/lists/match.ts`), `users.ts:334`.

`creatorOf` (`apps/api/src/services/lists/resources.ts:101`) passes any non-importer type through and needs no change; the contract widening above is what makes it serve.

## 4. Each action's service, its dependencies, and its `…InTx` form

C117.5 writes an internal effect in the same transaction as its effect row, so each needs a form that takes `tx`. **Exists** means a function that takes the caller's transaction today.

| Action | Service | Dependencies it reads | `…InTx` form |
|---|---|---|---|
| `approve_inquiry`, `decline_inquiry`, `mark_inquiry_for_review` | `applyInquiryAction` `services/inquiries.ts:738` | `events`, `clock`, `audit` (through `ApiDependencies`) | **Exists**: `tx` and a locked inquiry; `lockedInquiry` (`:223`) is private, so a caller needs it exported; the caller dispatches `staged` and deletes `storageKeys` |
| `create_inquiry` | `createInquiry` `services/inquiries.ts:258` | `db`, `ids`, `events`, `clock`, `accounts`, `audit` | **Missing** |
| `send_inquiry_link_*` | `generateOneTimeLink` `services/one-time-links.ts:49`; the session form `generateSessionOneTimeLink` in `services/signals/sessions.ts` | `db`, `clock`, `audit`, `flowPublicUrl` | **Missing** |
| `run_report` | `createReportResource` `services/reports/reports.ts:483` | `db`, `clock`, `ids`, `events`, `audit`, `rateLimiter`, `reportLimits`, `reportRuns` | **Missing**; its rate token (`consumeReportRate` `:338`) and `enqueueRun` (`:383`) sit outside the transaction |
| `rerun_report` | `changeReportMonitoring` `services/reports/reports.ts:737`, action `run` | as above | **Missing** |
| `run_verification` | none: `services/flow.ts:379` needs a session; server creation exists only in the AAMVA hook, `jobs/types/aamva.ts:211` | new | **Missing, and no service exists** |
| `get_list_match` | `matchLists` `services/lists/match.ts:514` | reads only; `options.matcherData` injected in tests (outcome 34) | **Exists** |
| `add_list_item` | `ListService.createItem` `services/lists/item-writer.ts:111`, over `ListItemWriter.insertItems` `:62` | `db`, `blindIndexKey`, `rateLimiter` | **Missing**; `insertItems` takes `tx`, but a `lists-write` token is taken and a transaction opened per item |
| `add_face_list_item` | `createBiometricListItem` `services/lists/biometric/items.ts:94` | `db`, `audit`, `listItemEmbeds`, `biometricListsGate` | **Missing** |
| `run_graph_query` | `createGraphQuery` `services/graph/queries.ts:237` | `db`, `ids`, `events`, `audit`, `blindIndexKey`, `graphQueries`, `dashboardPublicUrl`, `rateLimiter`; `GraphActing.principal` (`services/graph/acting.ts:10`) | **Missing**; `bindGraphQuery` reads a `Principal`, which a run does not have, so the form takes `canViewPii` |
| `sync_graph` | `kindsNotIndexedFor` `services/graph/queries.ts:86` and the job and state rows | `db` | reads only |
| `find_or_create_account` | `createAccount` `services/accounts.ts:510`; `AccountsService.resolveForInquiry(tx, ctx, input, staged)` `:456` | `db`, `ids`, `events`, `audit` | `resolveForInquiry` takes `tx` but only for the default type; **`findOrCreate` is missing** |
| `create_transaction` | `createTransaction` `services/transactions/transactions.ts:175` | `db`, `ids`, `events`, `audit`, `blindIndexKey`, `clock` | **Missing** (`change` in `services/transactions/shared.ts:32` owns the transaction) |
| `update_transaction_status` | `updateTransaction` `services/transactions/transactions.ts:379` | as above | **Missing** |
| `set_relation`, `unset_relation` | `addAccountRelation` `services/accounts.ts:797`, `removeAccountRelation` `:849`; `addTransactionRelation` `transactions.ts:789`, `removeTransactionRelation` `:825` | `db`, `events`, `audit` | **Missing** (`change` at `accounts.ts:306`) |
| `trust_device` | none; `packages/db/src/repositories/devices.ts` | new | **Missing, new** |
| `tag_object`, `remove_tag`, `copy_tags` | `changeInquiryTags` `inquiries.ts:540`, `changeAccountTags` `accounts.ts:743`, `changeReportTags` `reports.ts:644`, `changeTransactionTags` `transactions.ts:853` | `db`, `events`, `audit` | **Missing** in all four. Verifications hold no tags |
| `update_object` | `updateInquiry` `inquiries.ts:469`, `updateAccount` `accounts.ts:623`, `updateTransaction` `transactions.ts:379` | `db`, `events`, `audit` | **Missing** |
| `fetch_object` | the repositories, then `inquiryResourceOf` `inquiries.ts:174`, `accountResource` `accounts.ts:227`, `reportResourceOf` `reports.ts:136`, `getTransactionDocument` `transactions.ts:306`, `verificationResource` | `db` | reads only |
| `redact_object` | `RedactionService` (`ports.ts:1571-1603`), built by `createRedactionService` `services/redaction.ts:263`; `redactReportInTx` `services/reports/redaction.ts:62`, `redactTransactionInTx` `services/transactions/redaction.ts:62` | `db`, `storage`, `events`, `audit`, `clock`, `biometricItems` | **Exists** for reports and transactions; **missing** for inquiries and accounts, whose redaction spans several transactions and storage deletes after commit |
| `evaluate_code`, `make_https_request`, `send_*`, `calculate`, `update_variable`, `run_workflow`, `schedule_workflow` | C123-C126, the engine | new | n/a |

`Acting` is `{ ctx, actor, mask, environmentKind }` at `services/inquiries.ts:112`. `TransactionActing` (`services/transactions/acting.ts:5`) adds an optional `allows`, and `GraphActing` a `Principal`.

**`redact_object`.** Redacting an inquiry or an account has no single transaction to share with an effect row: a redaction commits in stages and deletes objects after the commit. It is idempotent on `redacted_at`, so the action claims its effect first, runs the service, and a repeated attempt reads `no_change` (C127.8, C117.5). This is a deviation from "the effect and the change in one transaction" for these two types, recorded in the amendments.

## 5. Verification types that need no end-user capture

`VERIFICATION_TYPES` at `packages/core/src/enums.ts:80`, jobs at `apps/api/src/jobs/types/index.ts`.

| Type | End-user part | `run_verification` |
|---|---|---|
| `database` | entered values (`INPUT_VERIFICATION_TYPES`, `apps/api/src/services/inputs/index.ts:46`) | **Yes**, the values come from the step config |
| `aamva` | entered, or copied from the licence by the silent step (`jobs/types/aamva.ts`) | **Yes**, form source only: a silent step answers `verification_created_by_server` (`services/submit/stub.ts:14`) |
| `database_business` | entered values | **Yes** |
| `business_website` | entered values | **Yes** |
| `government_id`, `selfie`, `document`, `government_id_nfc` | capture | No |
| `phone_number`, `email_address` | a one-time code from the person (`routes/flow/otp.ts:25`) | No |
| `crypto_wallet` | a wallet signature | No |

Each runnable type reads its config from the inquiry's pinned version (`TypeEvaluationJob.config`, `jobs/types/index.ts`), so `run_verification` needs the type's step in that version's flow; values are sealed through `putEnteredVerificationInputs`. `VERIFICATION_RUNNABLE_WITHOUT_CAPTURE` is the name this list takes in `@openverify/workflow-engine`'s action contract.

## 6. Every Phase 7 list write path (F20, C127.12)

`lists.version` is bumped by two helpers, `bumpList` (`packages/db/src/repositories/list-items.ts:107`) and `touchList` (`packages/db/src/repositories/list-biometrics.ts:180`), plus one direct update (`list-biometrics.ts:746`).

| Write | Repository | Callers |
|---|---|---|
| Add items | `insertListItems` `list-items.ts:162` (bump `:211`) | `POST /list-item/<plural>`: `createListItem` `services/lists/items.ts:119`; `ListItemWriter.insertItems` `services/lists/item-writer.ts:87`, reached by `ListService.createItem` (`:111`, the graph add `services/graph/actions.ts`) and by the import job in batches (`jobs/importers/process.ts`, staging once when the import ends) |
| Archive an item | `archiveListItem` `list-items.ts:347` (bump `:361`) | `DELETE /list-item/<plural>/:id`: `services/lists/items.ts:154`, route `routes/server/list-items.ts:96` |
| Rewrite keys | `rewriteListItemKeys` `list-items.ts:691` (bumps `:706`, `:723`) | `blind-index:rebuild`: `services/lists/rebuild.ts:73` |
| Redact items | `redactListItems` `list-items.ts:734` (bump `:787`), `redactExpiredListItems` `:809` | the retention pass `services/retention.ts:362` |
| Pending biometric item | `insertBiometricListItem` `list-biometrics.ts:208` (touch `:223`) | `services/lists/biometric/items.ts:117`. Stages nothing (outcome 25) |
| Face or background ready | `completeListItemFace` `:307` (touch `:328`), `completeListItemBackground` `:333` (touch `:360`) | the embed job `jobs/lists/embed.ts:120`, `:228` |
| Biometric archived | `archiveUnavailableBiometricItem` `:365` (touch `:387`) | `jobs/lists/embed.ts:193` |
| Biometric redacted | `redactBiometricItems` `:643` (touch `:693`) | `services/lists/biometric/index.ts:27` (`redactBySource`), `jobs/lists/embed.ts:296` (masked-object purge) |
| Biometric lists cleared | `redactBiometricLists` `:712` (update `:746`) | `services/lists/biometric/settings-hook.ts:27` |
| Archive a list | `archiveList` `packages/db/src/repositories/lists.ts:172` bumps **nothing** today | `services/lists/lists.ts:249`, route `routes/server/lists.ts:151`. Outcome 25 makes it bump and stage |
| `PATCH` a list | `updateList` `lists.ts:145` bumps nothing | `services/lists/lists.ts:199`. Stays so unless a matching member changes (outcome 25) |

## 7. The redaction call sites (F35)

| Redaction | Entry | Internal call sites |
|---|---|---|
| Inquiry | `RedactionService.redactInquiry` `services/redaction.ts:340`; `routes/server/inquiries.ts:411` through `services/inquiries.ts:815`; retention `services/retention.ts:206` | `redactInquiryRecords` `packages/db/src/repositories/redaction.ts:209` at `redaction.ts:356`; `redactInquiryReportsInTx` `:369`; `redactLinkedTransactionsInTx` `:387`, catch-up `:418` |
| Account | `redactAccount` `services/redaction.ts:434`; `routes/server/accounts.ts:478` | `redactAccountRecords` `repositories/redaction.ts:414` at `:463`; inquiries `:453`, `:529`; `redactAccountReportsInTx` `:474`, `:511`; transactions `:482`, catch-up `:520`; consolidated sources `:536` |
| Report | `redactReport` `services/redaction.ts:546`; `services/reports/reports.ts:191`; retention `services/retention.ts:229` | `redactReportInTx` `services/reports/redaction.ts:62` at `redaction.ts:555`; from the cascades through `services/reports/redaction.ts:138` |
| Transaction | `redactTransaction` `services/redaction.ts:587`; `services/transactions/transactions.ts:510`; retention `services/retention.ts:235` | `redactTransactionInTx` `services/transactions/redaction.ts:62` at `redaction.ts:298`, and through `redactLinkedTransactionsInTx` `:293`; `redactTransactionRecords` `packages/db/src/repositories/transaction-redaction.ts:179` at `transactions/redaction.ts:81` |
| Lock order | `lockInquiryTransactions`, `lockAccountTransactions` `packages/db/src/repositories/transaction-redaction.ts:99`, `:131`, called at `redaction.ts:355`, `:462` before the object's row | |

So `redactRunsForSubjectsInTx`, `redactDecisionCommentsInTx` and `redactTransactionChildrenInTx` go in `redactInquiry`'s and `redactAccount`'s main transactions (`services/redaction.ts:355-387`, `:462-482`), in `redactReportInTx` and in `redactTransactionInTx`, the last two being reached from every path above, so a hook placed in them is reached once per object.

## 8. The event publisher, the guard and the sink

- **The publisher:** `apps/api/src/events/index.ts`, `apps/api/src/events/subject.ts`; the input type `PublishEventInput` in `apps/api/src/ports.ts`; the webhook filter subject `EventSubject` in `packages/db/src/repositories/webhooks.ts`, the contracts' `EventSubject` in `packages/contracts/src/event-names.ts`.
- **The three places that build it:** `apps/api/src/container.ts:209`, `apps/api/src/worker.ts:665`, `apps/api/src/jobs/retention.ts:179`. A fourth, `apps/api/src/contact/job-testing.ts:69`, is test support and passes no scheduler.
- **The address guard:** `apps/api/src/webhooks/ssrf.ts`, `apps/api/src/webhooks/http-sender.ts`.
- **The sandbox sink:** `apps/api/src/providers/sms/sandbox.ts`, read by `routes/server/sandbox-sms.ts`.

## 9. The custom-list re-screen

`report_runs_trigger_sync_with_list_update` at `packages/db/src/tables/reports.ts:404`, `report_runs_report_id_trigger_sync_id_key` at `:383`, `REPORT_RUN_TYPES` at `packages/core/src/report-state-machine.ts:95`, `report_origin` at `packages/db/src/tables/enums.ts:178`. The check is an equality, so `list_update` with a null `trigger_sync_id` is refused today, which is what C127.12 widens (`foundation-8a`).

## 10. The signal view of a run (outcome 20)

`servedInquirySignals` at `apps/api/src/services/signals/served.ts:108` serves `[]` and `computed-at` alone when `exposeSignals` is off. `signalViewOf` (`services/inquiries.ts:195`) reads `expose-signals`; `CONSOLE_SIGNAL_VIEW` (`served.ts:129`) is used only by `routes/dashboard/resources.ts:50`. `inquiryResourceOf`, which builds every inquiry event's payload, reads `signalViewOf` at `inquiries.ts:188`.

**The choice:** the trigger view and `fetch_object` read the **server API's view**, `signalViewOf`, never `CONSOLE_SIGNAL_VIEW`. A trigger snapshot comes from the event payload, which already holds that view, so `fetch_object` agrees with it; and a run's values can leave through an egress step, so a run sees no more than an API client does. The amendment says how an empty array stays unknown.

## 11. Other names 8A and 8B need

- **The flow's terminal screen:** `apps/flow/src/steps/outcome-screens.tsx` (`CompletionScreen` `:16`), chosen by `terminalPosition` in `apps/flow/src/flow/flow-position.ts`, which shows the completion screen for `approved`, `declined` and `needs_review` (`FINISHED`, `:133`), so the screen "never reveals the decision". C128.7's contest route is the first thing the flow shows for `declined`.
- **The verification processing sites (V27):** `apps/api/src/jobs/process-verification.ts:367` (`persistInDecisionTx`) and `:410` (`afterCommit`).
- **The graph bulk-action files:** `apps/api/src/services/graph/actions.ts`; `apps/dashboard/src/app/graph/actions.ts`, `components/graph/bulk-actions.tsx`, `components/graph/graph-words.ts` (outcome 30).
- **Providers:** `PROVIDER_KINDS` and `PROCESS_PROVIDER_KINDS` in `apps/api/src/providers/index.ts`.
- **What builds an image:** `infra/docker/apps.Dockerfile` copies the workspace whole and `infra/tests/apps-image-context.test.sh` checks the context, so a new package needs no Dockerfile line.

## 12. Drift, and traps found on the way

1. **Permissions:** 47, not 36 (section 1).
2. **`stage()`:** 26 call sites in 18 files, not 17 (section 1).
3. **Simulation:** in `services/webhooks.ts:424` (section 1).
4. **Three actor pins the plan names nowhere:** `reportActionResourceSchema.actor`, the report history's `Actor` and the audit log's actor filter (section 3).
5. **`ALTER TYPE ... ADD VALUE` cannot be used in its own transaction.** Drizzle's migrator runs every pending migration in one transaction, so a CHECK comparing `actor_type` with the new label in the same migration fails on an upgraded database with "unsafe use of new value", while it passes on a fresh one, where the type is created in the same transaction. The checks compare `actor_type::text`. `report_origin` gaining `workflow` has the same trap for any statement that uses the value.
6. **Neither `redactInquiry` nor `redactAccount` has an `…InTx` form,** and cannot be given one that shares a transaction with an effect row (section 4).
7. **`run_verification` has no service to call** (section 4).
8. **`bindGraphQuery` reads a `Principal`,** which a run does not have (section 4).

## 13. What Workflow 8B's plumbing needs (added by `contracts-8b` at `367560b4`)

Every `path:line` below is at the Workflow 8B base `367560b4db331c11013fe5548a107d2d2780be14`, not at the base this file opened with.

### 13.1 Where `requestRenditionsForFiles` is called (C135.3, V27)

`apps/api/src/jobs/process-verification.ts` is the one job every verification type runs through, so the hook goes there and in no per-type file.

| Site | Line | What it holds | Use |
|---|---|---|---|
| `persistInDecisionTx`, with the staged `verificationEvent` | `process-verification.ts:367` | `files` read at `:303`; a type may write a file here (the document's preview, the chip portrait), so that list is out of date inside the transaction | **Not here**: a decision transaction never enqueues. Any job it would add is lost if the transaction rolls back |
| `afterCommit`, after `events.dispatch` and `afterDecision` | `process-verification.ts:410` | the type's own hook (`jobs/types/index.ts:151`), which only `document.ts:334` and `government-id-nfc.ts:547` define | **Here**, in the job itself on the line after `typeJob.afterCommit?.(...)`, reading `listVerificationFiles(db, environmentId, [verificationId])` again (`:384`'s reason), so a preview written in the decision gets a rendition too. A failed request is logged and fails nothing: the console's first request makes the rendition (C135.3) |

The path that reaches `:410` only runs for a verification this job decided. A verification another job decided first returns at `:300` or at the `staged === null` branch before `:410`, and that job makes the request. `processing failed` paths make none, and the first request covers them.

### 13.2 Every place a file's `deleted_at` is set (C135.3, V19)

`files.deleted_at` is written by one function, `markFilesDeleted` (`packages/db/src/repositories/files.ts:143`, the update at `:154`). Its callers, each after the object's storage delete:

| Caller | Line | When |
|---|---|---|
| `deleteAndMarkFiles`, through `deleteStoredFiles` | `apps/api/src/services/redaction.ts:164` (reached from `:464`) | an inquiry's redaction, which an account's reaches through `:453`, `:529` |
| `purgeRedactedFiles` | `services/redaction.ts:734`, called from `services/retention.ts:333` | the C16 leftover retry, and the one "file-retention step": no other retention step deletes a `files` row's object, because a file's retention is its inquiry's redaction |
| `redactTransactionBiometrics` | `services/transactions/transactions.ts:620` | `POST /transactions/:id/redact-biometrics` |
| the rejected handoff | `services/handoff/flow-handoffs.ts:783` | the phone session's files after a rejection |

`deleteAndMarkFiles` also serves `transaction_files` (`redaction.ts:327`, `:670`) with `markTransactionFilesDeleted`, which `workflow_run_files` and `transaction_files` do not need a rendition hook for: only `files` has renditions.

**Three deletes of a `files` row, which no `deleted_at` hook sees** (a trap the plan does not name): `replaceVerificationFile`, a client's upload (`files.ts:91`), `replaceServerWrittenFile` (`files.ts:189`) and the discarded selfie capture (`repositories/selfie-captures.ts:241`). `file_renditions`' foreign key on `files(id)` cascades the row away there and leaves the rendition's storage object behind. So the foreign key must not cascade silently: `foundation-8b` either refuses the delete (`on delete restrict`, which breaks all three) or, better, keeps the rendition's `storage_key` readable through the `.returning()` of each delete, and each of the three adds its rendition keys to the objects its caller already deletes after commit. `deleteRenditionsForFilesInTx` is the call. A rendition exists only after a file was processed or first requested; `files.ts:91` and `selfie-captures.ts:241` run while the verification is `initiated`, so they can hold one only through a first request, and `files.ts:189` runs on every re-run of a job.

### 13.3 The graph bulk action (C140.6)

| Side | Site | Line |
|---|---|---|
| The action list | `GRAPH_BULK_ACTIONS` in `packages/core/src/graph-queries.ts` | `:56`, and its comment "Creating a case waits for Phase 8" at `:55` |
| The outcomes and the cap | `GRAPH_BULK_OUTCOMES`, `GRAPH_LIMITS.bulkAccounts` | `:67`, `:47` |
| The body and the answer | `graphQueryActionAttributesSchema`, `graphQueryActionResultDocumentSchema` in `packages/contracts/src/graph-queries.ts` | `:557`, `:571` |
| The refusal test that changes with the plan | `packages/contracts/src/graph-queries.test.ts` | `:350` |
| The API | `authorize` and `runGraphQueryAction`'s action switch in `apps/api/src/services/graph/actions.ts`; both `switch`es are exhaustive by type | `:97`, `:327` |
| The route | `POST /graph-queries/:id/actions` in `apps/api/src/routes/server/graph-queries.ts` | |
| The console | `ACTION_PERMISSIONS`, `membersOf`, `graphBulkAction` in `apps/dashboard/src/app/graph/actions.ts` | `:67`, `:134`, `:152` |
| | `questionOf` and the list of offered actions in `apps/dashboard/src/components/graph/bulk-actions.tsx` | `:43`, `:88` |
| | `GRAPH_ACTION_WORDS` in `apps/dashboard/src/components/graph/graph-words.ts` | `:150` |

### 13.4 Each exit `filterCaseVisibility` is called from (C129.4, V08)

| Exit | Function | Line | What it filters |
|---|---|---|---|
| `GET /events` | `listEvents` | `apps/api/src/services/events.ts:98` | rows of a page whose subject is a case of a template the reader cannot see. A page can come back short, and `links.next` still moves on |
| `GET /events/:id` | `getEventDocument` | `services/events.ts:71` | answers 404, as an event of another environment does |
| `GET /api-logs` | `listApiLogs` | `services/api-logs.ts:396` | entries whose `resource_id` or subject ids name such a case |
| `GET /api-logs/:id` | `getApiLog` | `services/api-logs.ts:374` | 404 |
| `GET /workflow-runs` | `listWorkflowRuns` | `apps/api/src/workflows/runs/service.ts:141` | runs whose `workflow_run_subjects` include such a case |
| `GET /workflow-runs/:id` and every run route behind `requireRun` | `requireRun` | `workflows/runs/service.ts:129` | one call covers `:213`, `:279` and the resume, rerun, cancel and redact routes |
| `GET /workflow-runs/:id/steps` | `listWorkflowRunSteps`, through `requireRun` | `workflows/runs/service.ts:272` | as above |
| `GET /workflow-trigger-deliveries` | `listWorkflowTriggerDeliveries` | `workflows/triggers/service.ts:315` | **not in the plan's list**: a delivery names a run and an event id and no value, so it is left out of V08's four and `api-cases` decides. Recorded so it is decided, not missed |
| `GET /dashboard/notifications` | `routes/dashboard/notifications.ts` (new) | | notifications of a case the user can no longer see |
| The case routes, `POST /cases/search`, exports, `POST /cases/next`, bulk | `services/cases/visibility.ts` itself (`api-cases`) | | a predicate in each query, so a limit counts what is visible |
| `notify-on-create` | publish refuses, send skips (P38) | | |

**Not filtered, by the plan:** webhooks (C129.4, "an operator-configured system exit"). `getWebhookDelivery` (`services/webhooks.ts:561`) reads the delivered event under `webhooks:read`, so it stands with the webhook, and the docs say so. The internal readers `workflows/triggers/deliver.ts:216` and `webhooks/dispatcher.ts:175` are system paths.

### 13.5 Which `fieldsValidatorOf` a case calls (C130.2, C136.4)

`fieldsValidatorOf(content)` (`packages/core/src/transactions/fields-validator.ts:436`) caches by `content.id`, and `TransactionTypeVersionContent` (`engine.ts:45`) requires `statuses` and `relationSchemas`. A `ctmplv_` id can never equal a `txntpv_` id, so C130.2's "`(kind, version id)`" is met by the id alone. `transactionTypeVersionProblems` (`version-rules.ts:371`) runs the status and relation rules, which a case version does not have, so `caseFieldSchemaProblems` (`packages/core/src/cases/`, this call) is what a case reads.

