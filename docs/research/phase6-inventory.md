# Phase 6 starting point: inventory (2026-10-22)

Phase 6 ("Reports", `docs/PLAN.md:399-403`; catalog `docs/PLAN.md:281-294`; feature row `docs/PLAN.md:63`):
- a `report/<type>` resource with templates, versions, statuses, history, tags, match review and dismissal, continuous monitoring (pause, resume, run) and redaction;
- `report/<type>.*` webhook events;
- watchlist ingestion and a fuzzy matcher;
- PEP and adverse media;
- email-risk, phone-risk, address-lookup, crypto-address-watchlist and business-watchlist reports;
- dashboard pages, and an inquiry-template trigger that runs reports when an inquiry completes.

**How this was taken**
- A read-only inventory of `/home/mhnoor/persona-opensource`. Reading started at `d862499` and ended at **HEAD `f9349edc359b7ed60e83354f72b794f0432ad91c`** (`f9349ed`).
- Workflow 5A (Stage 1b `foundation`) committed throughout. Between `d862499` and `f9349ed` only these changed: `apps/api/src/services/flow.ts`, `services/resources.ts`, `services/flow-preconditions.ts` and `services/submit/*`. Line numbers in those files are given at `f9349ed`. At the end, `services/submit/*` had uncommitted edits.
- Paths are relative to the repo root. `file:N` and `file:N-M` are line numbers. "Does not exist" means a repo-wide grep (excluding `node_modules`, `dist`, `coverage`) found nothing.

---

## 0. One-page summary

| Phase 6 item | Already exists | Does not exist |
|---|---|---|
| **`report/<type>` resource, `rep_` ids** | <ul><li>Two id-prefix tables:<ul><li>contracts `ID_PREFIXES` (`packages/contracts/src/ids.ts:11-39`);</li><li>DB `ID_PREFIXES` (`packages/db/src/ids.ts:8-36`).</li></ul></li><li>The JSON:API helpers (`packages/contracts/src/json-api.ts:37-93`).</li><li>The `type/subtype` resource-type precedent `verification/<type>` (`resource-types.ts:8-35`).</li></ul> | <ul><li>`rep`, `rptp`, `rptpv`, `rpr`, `ract`, `scrre` and `scatr` are all **free** in both prefix tables and in `tokens.ts`.</li><li>No report resource type, enum, table, contract, route, service or fixture exists. `report` appears in source only in the DB name-format comment and its test (`packages/db/src/tables/columns.ts:43-48`, `constraints.test.ts:387`).</li></ul> |
| **Report templates (`rptp_`, `rptpv_`), versioning** | <ul><li>Inquiry templates and versions: tables (`packages/db/src/tables/inquiry-templates.ts:18-104`), the draft, publish and supersede repository functions (`repositories/inquiry-templates.ts:98-412`), routes and contracts.</li><li>Verification "templates" exist only as keys of `verification-config` inside an inquiry template version (`inquiry-templates.ts:83-97`).</li></ul> | <ul><li>No report template.</li><li>No standalone verification-template resource.</li><li>No `report-templates` path in `docs/research/persona-surface.md`.</li></ul> |
| **Statuses** pending/ready/errored/submitted | The pattern: core state machines with an event per status (`packages/core/src/verification-state-machine.ts:13-20`, `inquiry-state-machine.ts:6-15`, `selfie-capture-state-machine.ts:32-37`) | No report status enum or state machine |
| **History (runs `rpr_`, actions `ract_`)** | <ul><li>Audit log (`audit_logs`, append-only trigger `0001_schema_v1.sql:314-320`).</li><li>The Events API with `filter[object-id]` (`packages/contracts/src/events.ts:145-155`).</li></ul> | No run or action table, and no `history` route |
| **Tags** | <ul><li>`add-tag`, `remove-tag` and `set-tags` on inquiries (`apps/api/src/routes/server/inquiries.ts:271-332`) and accounts (`routes/server/accounts.ts:168-235`).</li><li>Core rules (`packages/core/src/tags.ts:13,90,103,115`).</li><li>The DB backstop `openverify_tags_valid` plus a GIN `openverify_lower_tags` index (`tables/columns.ts:28-32`).</li></ul> | Report tags |
| **Dismiss / review of matches** | Nothing comparable. The nearest is the inquiry status actions (`routes/server/inquiries.ts:92-129`, `STATUS_ACTIONS`). | No match entity, no ignore list. Lists are Phase 7. |
| **Continuous monitoring** (pause, resume, run) | <ul><li>Repeatable BullMQ jobs: `inquiry-expiry` every 60 s (`apps/api/src/worker.ts:357-388`) and `retention` at `0 3 * * *` UTC (`jobs/retention.ts:32-43`).</li><li>`FOR UPDATE SKIP LOCKED` batches (`packages/db/src/repositories/retention.ts:144-284`).</li></ul> | <ul><li>No per-object schedules.</li><li>`apps/api/src/jobs/repeatable/` (planned C54.1 for 5B) does not exist.</li></ul> |
| **Redaction** | <ul><li>C16 inquiry and account redaction: header table (`packages/db/src/repositories/redaction.ts:1-26`), service (`apps/api/src/services/redaction.ts:1-24`).</li><li>Event stubbing (`repositories/redaction.ts:89-136`).</li><li>`inquiry.redacted` and `account.redacted`.</li></ul> | <ul><li>Redaction covers no report.</li><li>No `report/*.redacted` event, and none in the surface index.</li></ul> |
| **Webhook events** `report/<type>.ready\|matched\|dismissed\|errored\|redacted`, `report/screening.reviewed` | <ul><li>The DB check already allows one `/` subtype: `^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$` (`0001_schema_v1.sql:162`).</li><li>The event and webhook machinery (§3).</li></ul> | <ul><li>No report event name in `EVENT_NAMES` (`packages/contracts/src/event-names.ts:74-95`).</li><li>`eventSubject()` throws for any subject outside its 5-entry map (`event-names.ts:108-128`).</li></ul> |
| **Watchlist ingestion** (OFAC, EU, UK; PLAN also says UN) by operator sync, `pg_trgm`/GIN | <ul><li>A data fetcher for **pinned** files only (`scripts/fetch_data.py`, `data/manifest.json`).</li><li>The outbound client (`apps/api/src/http/index.ts`).</li><li>Sync design text only for the trust store (`docs/plans/phase-5.plan.md:522-528`, C62.7).</li></ul> | <ul><li>No watchlist table, sync, parser or CLI.</li><li>`pg_trgm` is used nowhere.</li><li>No trust-store sync code: `trust-anchors/` and the `trust-anchors:sync` script do not exist.</li><li>No XML or CSV parser in the runtime dependencies.</li></ul> |
| **TS matcher on `packages/checks/src/matching` (C58)** | <ul><li>Phase 1 `normalizeName`, `jaroWinkler`, `tokenSetSimilarity` and `compareNames` (`packages/checks/src/name-matching.ts:26-185`).</li><li>`namesAgree` (`extraction/agreement.ts:142`).</li><li>`PO_BOX_PATTERNS` and `normalizeAddress` (`id-po-box-detection.ts:18,48`).</li></ul> | <ul><li>`matching/` is a stub: only `MATCHING_CHECKS_AREA` (`matching/index.ts:10`).</li><li>No partial dates, nicknames, address normaliser, transliteration of non-Latin scripts, or `packages/checks/data/`.</li></ul> |
| **PEP (Wikidata mirror), adverse media (GDELT)** | Planned-data rows only (`THIRD_PARTY_LICENSES.md:285-286`, `docs/PLAN.md:144`) | No code, provider kind, data or fixture |
| **Email risk, phone risk, address lookup** | <ul><li>`libphonenumber-js@1.13.14` declared in `packages/checks` and `apps/flow` (`pnpm-workspace.yaml:36`).</li><li>The disposable list fetched into `data/` (`data/manifest.json:4-17`).</li><li>The `DnsResolver` port with `resolveMx`, `resolve4` and `resolve6` (`apps/api/src/ports.ts:1002-1006`).</li></ul> | <ul><li>No source file imports `libphonenumber-js`; it is mentioned only in a comment, `packages/checks/src/contact/index.ts:3`.</li><li>No disposable-list loader.</li><li>No `resolveTxt`.</li><li>No RDAP client (5B C61.4).</li><li>No address normaliser (C58.4).</li></ul> |
| **Crypto-address watchlist** | <ul><li>`CRYPTO_CHAINS`, `EVM_CHAIN_ID_PATTERN`, `normalizeCryptoChainId` and `cryptoChainIdSchema` (`packages/core/src/crypto-chains.ts:70-130`).</li><li>The per-environment blind index `cryptoAddressIndex` (`packages/db/src/blind-index.ts:159,194`).</li><li>The OFAC ticker counts (`docs/research/phase5-libraries.md:798`).</li></ul> | <ul><li>`packages/checks/src/crypto/` is a stub (`CRYPTO_CHECKS_AREA` only).</li><li>No address canonicaliser in code.</li><li>No OFAC ticker → CAIP-2 map.</li></ul> |
| **Business watchlist** | Business-name matching is planned (C58.6) | No code |
| **New provider kinds** | <ul><li>The binding pattern with per-process kinds (`apps/api/src/providers/index.ts:46-102`).</li><li>Kinds `aamva`, `publicFigure`, `ageEstimate`, `selfieAgeEstimate`, `selfiePublicFigure`, `suspiciousEntity`, `sms`, `database`, `evmRpc`.</li></ul> | <ul><li>The 5B kinds (`businessRegistry`, `domainAge`, `maliciousWebsite`, `backlink`) are not added.</li><li>No `none` provider name (`PROVIDER_NAMES = ['sandbox','twilio','json-rpc']`, `:71`).</li></ul> |
| **Scopes** | <ul><li>`API_SCOPES` (20) and `OPERATOR_PERMISSIONS` (8) in core (`packages/core/src/permissions.ts:9-50`).</li><li>The latest addition, `sandbox:read`, is the model.</li></ul> | No `reports:*` or `report-templates:*` scope |
| **Dashboard pages** | <ul><li>Index-with-filters (`apps/dashboard/src/app/inquiries/page.tsx`), detail, JSON template editor (`components/lifecycle/version-editor.tsx`).</li><li>`renderPage` guard, nav (`components/nav-items.ts:23-51`), mock routes (`testing/api-routes.ts`).</li></ul> | <ul><li>No report pages or nav group.</li><li>**No tab component** anywhere in `apps/dashboard` or `packages/ui`: inquiry and account pages are stacked sections.</li></ul> |
| **Trigger on inquiry completion** | <ul><li>`settleInquiry` (`apps/api/src/services/inquiry-settlement.ts:47-117`).</li><li>The single status choke point `transitionInquiryInTx` (`apps/api/src/services/inquiries.ts:572-610`).</li></ul> | <ul><li>Template `settings` is a strict 4-key schema (`packages/contracts/src/template-settings.ts:16-24`): no `reports` member.</li><li>No internal event subscriber.</li><li>No queue in settlement deps.</li></ul> |

**Cross-cutting blockers** (detail in §16):
1. The event-name convention is undecided: Persona's surface writes `report_<type>.<action>`, the DB allows `report/<type>.<action>`, and every current event is `<subject>.<action>` with no type in the name.
2. There are no install-wide data tables and no environment-free audit trail.
3. A sanctions list cannot go through `fetch_data.py` (sha256-pinned).
4. The outbound client buffers whole bodies, returns no headers and caps at 1 MiB by default.
5. PGlite loads only `vector`.
6. C58 is unbuilt.
7. Masking and redaction lists are keyed to verification types.

---

## 1. Identifiers

- **Format** (C1): `<prefix>_<ULID>`, 26 Crockford base32 characters, time-sortable (`packages/contracts/src/ids.ts:1-7,46-51`).
  - `newId(prefix)` (`:150-153`), `isId` (`:160-163`), `idSchema(prefix)` (`:170-173`).
  - `anyIdSchema` builds its regex from every prefix (`:176-178`), so `filter[object-id]` accepts a new prefix automatically.
- **Contracts `ID_PREFIXES`** (`ids.ts:11-39`):
  - `organization: 'org'`, `environment: 'env'`, `apiKey: 'key'`, `user: 'usr'`, `userSession: 'uss'`;
  - `inquiryTemplate: 'itmpl'`, `inquiryTemplateVersion: 'itmplv'`, `inquiry: 'inq'`, `inquirySession: 'iqse'`;
  - `verification: 'ver'`, `file: 'file'`, `event: 'evt'`, `webhook: 'wbh'`, `webhookDelivery: 'whd'`;
  - `account: 'acc'`, `accountType: 'acctp'`, `role: 'role'`, `userAuditLog: 'aud'`, `apiLog: 'alog'`, `mfaFactor: 'mfa'`;
  - `selfieCapture: 'self'`, `otpChallenge: 'otpc'`, `cryptoChallenge: 'cwc'`, `chipChallenge: 'chc'`.
- **DB `ID_PREFIXES`** (`packages/db/src/ids.ts:8-36`) is a separate list:
  - it has `auditLog: 'aud'`, `faceTemplate: 'ftpl'` and `selfieBackground: 'sbg'`, which contracts does not have;
  - it lacks `chc`, which arrives with 5B;
  - `idPattern` (`:41`) feeds the `<table>_id_format` checks (`tables/columns.ts:16-21`).
- **Token prefixes** (`packages/contracts/src/tokens.ts:10-18`): `ovs_`, `ovu_`, `wbhsec_`, `ovo_`, `ovm_`, `ovi_`.
- **Free:** `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `scrre` and `scatr` appear in neither prefix table nor any token prefix.
- **Tests that pin the list:**
  - `ids.test.ts:27` ("maps every C1 object to its prefix") and `:57` ("distinct, lowercase prefixes");
  - `packages/db/src/schema.test.ts:88-103` (`prefixedTables`).
- **API-log and idempotency redaction subjects:** `REDACTION_SUBJECT_ID_PREFIXES = ['inq','ver','iqse','acc','self']` (`packages/db/src/repositories/subject-ids.ts:17-24`). A report id is not scanned until it is added.

## 2. Resources and JSON:API shapes

**Declaring a resource type**
- `RESOURCE_TYPES` (`packages/contracts/src/resource-types.ts:4-36`) is a flat list: `'inquiry'`, …, `'selfie'`, and the 11 `'verification/<api-type>'` values.
- `identifiers.ts:7-23` declares the linkage schemas: `inquiryIdentifierSchema = resourceIdentifierSchema('inquiry','inq')`, `accountIdentifierSchema`, `verificationIdentifierSchema` (a union of types with `ver`), and others.

**Builders** (`json-api.ts`)
- `resourceIdentifierSchema(type, prefix)` `:37-39`.
- `toOneRelationshipSchema` `:41-43` and `toManyRelationshipSchema` `:45-47`.
- `resourceSchema` `:50-56` and `resourceWithRelationshipsSchema` `:59-70`.
- `singleDocumentSchema` `:73-75`, `listDocumentSchema` `:78-83` (`links.next`), `requestDocumentSchema` `:86-93`.
- All are strict objects. Response schemas carry no transforms (`:6-7`).

**Actions** (`actions.ts:8-18`): `actionBodySchema(meta)`, `optionalActionBodySchema` and `emptyActionBodySchema`, for `POST /<resource>/:id/<action>` with `{ meta }`.

**List queries:** `listQuerySchema(prefix, filters)` (`list-filters.ts:66`) gives cursor paging on the id prefix (`page[after]`) and `filter[...]` values separated by commas.

**Relationships to inquiries and accounts**
- Verification: `verificationRelationshipsSchema = { inquiry: toOne(inquiryIdentifierSchema), files: toMany(...), selfies?: toMany(...) }` (`verifications.ts:201-206`).
- Inquiry (`inquiries.ts:86-101`):
  - `'inquiry-template'` (toOne);
  - `verifications` (toMany);
  - `account` (toOne, nullable, optional);
  - `'inquiry-template-version'` (optional);
  - `selfies` (optional).
- Account (`accounts.ts:51-57`): `'account-type'` (toOne), and `inquiries`, the latest 100 (`MAX_ACCOUNT_INQUIRY_LINKAGE`, `:36`).
- Inquiry attributes (`inquiries.ts:71-84`) include `tags` (`tagsSchema.optional()`).

**Inquiry `include` and `included`**
- `INQUIRY_INCLUDES = ['verifications','selfies']` (`inquiries.ts:156`).
- `inquiryIncludeDocumentSchema.included` is a discriminated union of `VERIFICATION_RESOURCE_SCHEMAS` and `selfieCaptureResourceSchema` (`:123-130`).
- Each include needs its own scope (`INCLUDE_PERMISSIONS`, `routes/server/inquiries.ts:67-71`; both are `verifications:read`).
- The dashboard document's `included` is the verifications, `fileResourceSchema` and the selfie captures (`packages/contracts/src/dashboard-api.ts:209-221`).

**Masking:** see §4.

**Server routes and the API service layer**
- Each route file is a `FastifyPluginCallbackZod<ApiDependencies>` with `config: { scopes: [...] }` and zod `schema` (body, params, `response` with `problemResponses(...)`).
- Plugins are registered in `apps/api/src/routes/server/index.ts:29-42`.
- `apps/api/src/services/resources.ts` maps rows to contract builders. Each builder validates its output (`:1-5`).

**OpenAPI**
- Generated from the zod route schemas.
- `pnpm --filter @openverify/api openapi:write` runs `vitest run src/openapi.test.ts --update --coverage.enabled=false` (`apps/api/package.json`). It writes the snapshot `docs/api/openapi.json` (`apps/api/src/test-support/openapi.ts:9-11`), and `openapi.test.ts:30-35` compares against it.
- Named components are `NAMED_SCHEMAS` (`apps/api/src/plugins/openapi.ts:47-87`). A new resource adds its row there.

**`@openverify/node`**
- `OpenVerifyClient` is an explicit interface of method groups (`packages/node/src/client.ts:523-539`): `inquiries`, `inquirySessions`, `inquiryTemplates`, `inquiryTemplateVersions`, `verifications`, `selfies`, `accounts`, `accountTypes`, `webhooks`, `webhookDeliveries`, `events`, `apiKeys`, `apiLogs`, `rateLimits`, `userAuditLogs`. It is explicit because the inferred type hit TS7056 (5A Stage 1a decision 15).
- Guards: `isGovernmentIdVerification` (`types.ts:66`) and `isVerificationOfType` (`types.ts:118`).
- There is no `reports` group.

**Contracts import rule:** `@openverify/contracts` may import only zod, core, flow-spec and flat local modules, enforced by `browser-safety.test.ts` (`docs/tdd/phase5-contracts.tdd.md:23`). So report contracts must be flat files such as `packages/contracts/src/reports.ts`, and they cannot import `@openverify/checks`.

## 3. Events and webhooks

**Names** (`packages/contracts/src/event-names.ts`)
- The convention is `<subject>.<action>`, "where the subject is the type of the resource in the event payload" (`:1-4`).
- `INQUIRY_EVENT_NAMES` (`:16-29`): the status events from core (`inquiry.created`, `inquiry.started`, `inquiry.completed`, `inquiry.failed`, `inquiry.approved`, `inquiry.declined`, `inquiry.marked-for-review`, `inquiry.expired`; `inquiry-state-machine.ts:6-15`), plus `inquiry.transitioned`, `inquiry.updated-tags` and `inquiry.redacted`.
- `INQUIRY_SESSION_EVENT_NAMES` (`:32-36`).
- `VERIFICATION_EVENT_NAMES` (`:39-46`):
  - `verification.created`, `.submitted`, `.passed`, `.failed`, `.canceled`, `.skipped` (`verification-state-machine.ts:13-20`);
  - **the verification type is never in the name**: every type emits `verification.passed`;
  - `needs_review` emits no verification event (`verification-state-machine.ts:36-37`).
- `SELFIE_EVENT_NAMES` (`:49-54`): `selfie.created|submitted|processed|errored`.
- `ACCOUNT_EVENT_NAMES` (`:57-71`), including `account.redacted`.
- `EVENT_NAMES` (`:74-95`) is the full list, in that order; `eventNameSchema` (`:97`).

**No event name contains a slash.** The DB check `events_name_format` (`tables/webhooks.ts:73`, `columns.ts:43-48`, SQL `0001_schema_v1.sql:162`) already accepts one `/` subtype and was written with `report/watchlist.matched` as its example. Its test is `constraints.test.ts:387`. It allows no digits. The same check guards `audit_logs.action` (`0001_schema_v1.sql:216`).

**Subjects**
- `EventSubject = 'inquiry' | 'inquiry-session' | 'verification' | 'account' | 'selfie'` (`event-names.ts:108`).
- `eventSubject(name)` reads the part before the first dot and throws for an unmapped subject (`:110-128`). For `report/watchlist.ready` that part is `report/watchlist`.
- In `events.ts`, `payloadFitsName` treats `verification` as covering `verification/*` and otherwise requires `type === subject` (`:103-106`). So a `report/<type>.<action>` name fits a `report/<type>` payload without a special rule; a uniform `report.<action>` would need one.

**Payload contracts** (`packages/contracts/src/events.ts`)
- `PREFIX_BY_SUBJECT_TYPE` (`:26-33`).
- `redactedResourceStubSchema`: `{ data: { type, id, attributes: { 'redacted-at' } } }`, typed over a closed enum (`:39-54`).
- `eventPayloadSchema`: `data` is a union of inquiry, verifications, session, account and selfie; `included` adds file; `meta` (`:64-87`).
- `storedEventPayloadSchema` (`:95`) and `eventAttributesSchema` (`:108-129`).
- `listEventsQuerySchema` (`:145-155`): `filter[name]`, `filter[object-id]`, `filter[simulated]`, `filter[inquiry-id]`.

**Storage and API**
- Table `events` (`packages/db/src/tables/webhooks.ts:41-76`): `payload` encrypted (static AAD `events.payload`), `object_id`, `object_type` (taken from `payload.data`, `repositories/events.ts:72-82`), `simulated`, `redacted_at`.
- `filter[inquiry-id]` resolves the inquiry plus its verifications, sessions and selfie captures through `aboutInquiries` (`repositories/events.ts:128-158`). Reports would have to be added there.
- Routes: `GET /events`, `GET /events/:id` (`routes/server/events.ts:21-43`, scope `events:read`).

**Publisher and outbox**
- `createEventPublisher` (`apps/api/src/events/index.ts:48`): `stage(tx, {environmentId, name, payload})` first validates the name and payload with `buildEventResource` (`:52-56`), so the contracts must know a report event before any is staged. It then writes the event and its `webhook_deliveries` rows in the caller's transaction (`:57-70`). `dispatch(staged)` after commit enqueues them, and the worker sweep re-enqueues overdue ones every 30 s (`jobs/worker-config.ts:15`).
- There is no in-process subscriber: events reach only webhooks.

**Webhook filters (C14)**
- `filters` holds `inquiry-template-ids` and `account-type-ids` only (`packages/contracts/src/webhooks.ts:189-192`, core `webhook-payload.ts:64-67`).
- `webhookFilterSubject` reads the `inquiry-template` or `account-type` linkage (`webhook-payload.ts:88-102`).
- `eventFilterSubjects` falls back to `relationships.inquiry.data.id` and the template of that inquiry (`apps/api/src/events/subject.ts:18-63`). So a report payload with an `inquiry` relationship is filtered by template with no change.
- `enabled-events` is `['*']` or distinct `eventNameSchema` values (`webhooks.ts:69,88-100`).

**Simulation and samples**
- `POST /webhooks/:id/simulate` (scope `webhooks:write`, `routes/server/webhooks.ts:264`) with `{ meta: { 'event-name' } }` (`webhooks.ts:393-396`).
- Samples (`apps/api/src/webhooks/samples.ts`):
  - `EVENT_FIXTURES` (`:33-37`): three named fixtures;
  - `RESOURCE_FIXTURES` keyed by `EventSubject` (`:40-47`): one golden resource per subject from `contracts/fixtures/api/`;
  - `STATUS_BY_EVENT` (`:54-68`): the status each event announces.
- A new subject needs all three, plus a fixture `contracts/fixtures/api/report-<type>.json`.

**The `*.redacted` convention**
- `inquiry.redacted` and `account.redacted` are staged once, on the first redaction, in the redaction transaction.
- Their payload is the already-redacted resource, not a stub (`apps/api/src/services/redaction.ts:236-244, 304-307`).
- Every earlier event of the object and its children is replaced by the stub (`repositories/redaction.ts:89-136`). The inquiry's object list is `[inquiryId, ...verificationIds, ...sessionIds, ...captureIds]` (`:271-276`).
- An audit entry is written with counts. A re-run emits nothing.
- There is no `verification.redacted` or `selfie.redacted`.

**Persona surface** (`docs/research/persona-surface.md:238-382`, "Webhook events (142)")
- Report events are written `report_<type>.<action>`, with an underscore and no slash (`:304-353`). For example: `report_watchlist.matched`, `report_screening.reviewed` (`:343`), `report_address-lookup.submitted` (`:306`), `report_crypto-address-watchlist.matched`, `report_politically-exposed-person.dismissed`.
- No `report_*.redacted` event is listed.
- The actions present are `ready`, `errored`, `matched`, `dismissed`, `submitted` (address lookup only) and `reviewed` (screening only).

## 4. API keys, RBAC and PII

**Scopes** (`packages/core/src/permissions.ts`)
- `API_SCOPES` (`:9-31`): `inquiries:read`, `inquiries:write`, `inquiry-templates:read`, `inquiry-templates:write`, `verifications:read`, `webhooks:read`, `webhooks:write`, `events:read`, `accounts:read`, `accounts:write`, `accounts:redact`, `inquiries:redact`, `inquiry-sessions:read`, `inquiry-sessions:write`, `inquiry-templates:publish`, `api-keys:read`, `api-keys:write`, `api-logs:read`, `audit-logs:read`, `sandbox:read`.
- The format is `<resource>:<action>` in kebab-case, tested at `permissions.test.ts:53`.
- `OPERATOR_PERMISSIONS` (`:41-50`): `pii:view`, `users:read|write`, `roles:read|write`, `settings:read|write`, `environments:production`.
- `PERMISSIONS = [...API_SCOPES, ...OPERATOR_PERMISSIONS]` (`:53`).

**Built-in roles** (`:69-136`)
- `admin` has every permission.
- `developer` (`:103-122`) and `reviewer` (`:123-134`) are explicit lists. Reviewer holds `pii:view`, `accounts:write` and both redact scopes.
- `viewer` gets **every `:read` permission automatically** except `NOT_FOR_VIEWERS = ['api-logs:read','audit-logs:read','sandbox:read']` (`:91-95`). A new `reports:read` therefore reaches viewers unless it is listed there.
- Role rows are re-synced to core at every API startup and on organization creation (`apps/api/src/services/roles.ts:1-6,47-65`).

**Adding a scope** (the `sandbox:read` precedent; every file that names it):
1. `packages/core/src/permissions.ts`, and its tests `permissions.test.ts:47-58` (ordered list) and `:96-182` (roles).
2. `packages/contracts/src/scopes.ts:6` (re-export) and `vocabulary.test.ts:75-104` (exact list).
3. The dashboard `PERMISSION_INFO` (`apps/dashboard/src/components/operators/permissions.ts:28-58`, typed `Record<Permission,…>`, so the typecheck fails until a label and area exist) and `AREAS` (`:8-24`; there is no "Reports" area).
4. The route `config.scopes`.
5. `docs/api/openapi.json`.
6. The seed needs no change: its key holds `[...API_SCOPES]` (`apps/api/src/seed/dev-seed.ts:475`).

**PII masking** (C15, C53.7)
- `MASKED_ATTRIBUTES` (`apps/api/src/auth/pii.ts:26-35`) contains `fields`, `note`, `ip-address`, `user-agent`, `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES` and `PII_VERIFICATION_ATTRIBUTES`.
- `PII_VERIFICATION_ATTRIBUTES` is built only from `VERIFICATION_RESOURCE_SCHEMAS` members marked `.meta({ pii: true })` (`packages/contracts/src/verifications.ts:643-654`).
- `canViewPii`: API keys see PII unless minted masked; users need `pii:view` (`pii.ts:41-45`).
- Masking is by attribute name at any resource. `fields` is masked member-wise and anything else whole (`:91-102`).
- Stored API logs: `MASKED_MEMBERS = {note, ip-address, user-agent}` everywhere, and `MASKED_ATTRIBUTES` inside `attributes` (`apps/api/src/services/api-logs.ts:202-232`).
- Secret keys are redacted before storage (`API_LOG_REDACTED_KEYS`, `packages/contracts/src/redaction.ts:11`).
- A report's PII attributes (the screened name, birth date, address, crypto address) are masked nowhere until a report equivalent of the PII list exists. The C53.7 contract test refuses a masked name that is a non-PII attribute of another resource (`docs/plans/phase-5.plan.md:360`).

## 5. Tags

- **Contracts** (`packages/contracts/src/tags.ts:17-51`):
  - `tagInputSchema` (≤256 characters before trimming, rule from core);
  - `tagListInputSchema`, `tagSchema`, `tagsSchema`;
  - `tagMetaSchema = { 'tag-name' }` and `tagNamesMetaSchema = { 'tag-names' }`;
  - the bodies `addTagBodySchema`, `removeTagBodySchema` and `setTagsBodySchema`, all `{ meta: … }`.
- **Core rules** (`packages/core/src/tags.ts`): `MAX_TAGS_PER_OBJECT = 50` (`:13`), `normalizeTags` (`:90`), `addTag` (`:103`), `removeTag` (`:115`). Tags are unique ignoring case and keep their first spelling.
- **DB** (`packages/db/src/tables/columns.ts:28-32`):
  - a `tags text[] NOT NULL DEFAULT '{}'` column;
  - check `openverify_tags_valid(tags)`, the function created in `0003_schema_v2.sql:36`;
  - a GIN index on `openverify_lower_tags(tags)`: `inquiries_lower_tags_idx` (`tables/inquiries.ts:114`) and `accounts_lower_tags_idx` (`tables/accounts.ts:115`).
  - The repository helper is `applyTagOperation` (`repositories/tags.ts:50-74`).
- **Inquiry routes:**
  - `POST /inquiries/:id/add-tag`, `/remove-tag`, `/set-tags`, scope `inquiries:write` (`routes/server/inquiries.ts:271-332`);
  - the service `changeInquiryTags` runs under the inquiry row lock and emits **`inquiry.updated-tags` for all three operations** (`services/inquiries.ts:470-499`);
  - audited as `inquiry.updated-tags` with `{ operation }`.
- **Account routes:**
  - the same three paths, scope `accounts:write` (`routes/server/accounts.ts:168-235`);
  - the service emits `account.tag-added` (meta `tag-name`), `account.tag-removed` or `account.updated-tags` (`TAG_EVENTS`, `services/accounts.ts:688-692`; `changeAccountTags` `:700-747`);
  - audited under the event name with `{ 'tag-count' }`.
- **The two resources differ in their tag events.** The surface index lists `reports/{report-id}/add-tag|remove-tag|set-tags` (`persona-surface.md:514,519,523`) but no report tag event.
- Listing by tag: `filter[tag]` (`inquiries.ts:191`).

## 6. Templates and versioning

**Tables** (`packages/db/src/tables/inquiry-templates.ts`)
- `inquiry_templates` (`:18-38`): `id`, `environment_id`, `name`, `status` (enum `inquiry_template_status`: `active`, `archived`), timestamps.
- `inquiry_template_versions` (`:52-104`): `inquiry_template_id`, `version` (≥1), `flow` jsonb, `verification_config` jsonb, `settings` jsonb (default `{}`), `status` (enum `inquiry_template_version_status`: `draft`, `published`, `superseded`, `enums.ts:116-120`), `published_at`.
- Constraints:
  - unique `(inquiry_template_id, version)`;
  - partial unique index `inquiry_template_versions_one_published_key`, which allows one published version per template;
  - check `published_at` is null exactly when the status is `draft`.
- **No DB trigger makes a published version immutable.** Immutability is the repository's `WHERE status = 'draft'` (`repositories/inquiry-templates.ts:344-369`).

**Repository** (`repositories/inquiry-templates.ts`)
- `createInquiryTemplateVersion` inserts version N **published**; template creation uses it (`:98-105`).
- `insertNextVersion` locks the template row and numbers `max+1` (`:107-…`).
- `createDraftInquiryTemplateVersion` (`:331-338`).
- `updateDraftInquiryTemplateVersion` touches drafts only and returns `null` otherwise (`:344-369`).
- `publishInquiryTemplateVersion` runs in one transaction under the template row lock. It supersedes the published version and sets `published_at`; on a non-draft it returns `not_draft` (`:375-412`).

**Service** (`apps/api/src/services/inquiry-templates.ts`)
- `assertPublishable(flow, config)` is **synchronous** at `f9349ed` (`:100-119`). It applies the matching-consent rule and `templatePublishProblems` (contracts `inquiry-templates.ts:555`), answering 422 with pointers under `/data/attributes`. C54.1 plans async publish hooks.
- Called on create (`:203`) and on publish (`:416`).
- Publish writes audit `inquiry-template-version.published` (`:434`) and **emits no event**.

**Routes**
- `POST|GET /inquiry-templates`, `GET|PATCH /inquiry-templates/:id` (`routes/server/inquiry-templates.ts:33-94`). PATCH changes `name` or `status` only (`contracts inquiry-templates.ts:307-315`).
- `POST|GET /inquiry-template-versions`, `GET|PATCH /inquiry-template-versions/:id`, `POST /inquiry-template-versions/:id/publish` (`routes/server/inquiry-template-versions.ts:39-141`).
- Scopes: `inquiry-templates:read`, `:write`, `:publish`.

**Contracts**
- Version statuses `INQUIRY_TEMPLATE_VERSION_STATUSES` (`inquiry-template-versions.ts:35`); attributes `version-number`, `status`, `flow`, `verification-config`, `settings` (resolved), `created-at`, `published-at` (`:49-68`).
- Relationship `inquiry-template` (`:70-76`); create body (`:86-98`); draft update (`:107-124`); publish body `emptyActionBodySchema` (`:131`).
- The template resource embeds `current-version` and has **no relationships** (`inquiry-templates.ts:281-294`).

**Settings**
- `templateSettingsSchema` is a strict object of `inquiry-expiration-seconds`, `session-expiration-seconds`, `one-time-link-expiration-seconds`, `retention-days` (`template-settings.ts:16-24`); resolved form and defaults at `:27-40`.
- `verificationConfigSchema` is strict over the 11 API verification types (`inquiry-templates.ts:83-97`). A type's config is `verificationTemplateConfigSchema` (core `decision-engine.ts:37-61`: `checks`, `allowed-countries`, `allowed-chains`, …).
- Pinned settings are read with `pinnedSettings(db, inquiry)` (`services/inquiry-templates.ts:132-146`).

**Verification templates:** there is no standalone resource. They are the `verification-config` keys of an inquiry template version.

**What a report template would mirror:** the two tables with `environment_id`, composite FKs, the one-published partial index and the draft-only update; the three scopes; template creation publishing version 1.

## 7. Accounts

- **Table** `accounts` (`packages/db/src/tables/accounts.ts:58-124`): `account_type_id`, `reference_id` (unique per environment), `status` (`active`/`archived`), `fields` **sealed** (row AAD `accounts.fields`), `tags`, `consolidated_into`, `redacted_at`. Account types define the allowed `fields`.
- **Resolution for a new inquiry:** `createAccountsService(...).resolveForInquiry(tx, ctx, {accountId?, referenceId?}, staged?)` (`apps/api/src/services/accounts.ts:420-458`; port `apps/api/src/ports.ts:841-862`). The order is:
  1. `accountId`, which must be in the environment (404 otherwise; a consolidated account resolves to the account that absorbed it);
  2. the account with `referenceId`, or a new one with that reference id;
  3. a new account of type `user`, emitting `account.created` staged in the inquiry transaction.
  The account row is share-locked (`lockAbsorbingAccount`).
- **Account relationships:** `inquiries` (latest 100) and `account-type`. Relations are a separate list (`GET /accounts/:id/relations`).
  - `add-objects` and `remove-objects` accept **only `{type:'inquiry'}` objects** (`contracts accounts.ts:182-196`).
  - Consolidation moves inquiries and relations (`services/accounts.ts:895`). A report linked to an account would need its own move rule.
- **Locks:** account writes lock accounts in id order (`lockInIdOrder`, `:871-880`), then the inquiries (`lockForMove`, `:1032-1050`). Inquiry writes follow C40.6 (§8).
- **Redaction:** `POST /accounts/:id/redact` (scope `accounts:redact`, `routes/server/accounts.ts:390-393`) redacts the account's inquiries first, then the account (fields set to null, events stubbed, `account.redacted`), then every account consolidated into it (`services/redaction.ts:15-18`).
- **Account PII:** `fields` only, masked like inquiry fields.

## 8. Worker and jobs

**Process** (`apps/api/src/worker.ts:1-23`): two BullMQ workers over Valkey:
- `process-verification` (`PROCESS_VERIFICATION_QUEUE`, `jobs/index.ts:13-14`; job id = verification id; 5 attempts with exponential backoff, `:21-26`);
- `webhook-delivery`, plus a 30 s sweep.

**Repeatable jobs: two patterns**
1. The `RepeatableJob` list inside `startWorkers`: `{ name, repeat: { every } | { pattern }, run }` (`worker.ts:137-163`). Each gets its own queue, `upsertJobScheduler(name, repeat, { name })` and a concurrency-1 worker (`:357-388`). Today it holds only `inquiry-expiry` every 60 s (`INQUIRY_EXPIRY_QUEUE`, `jobs/inquiry-expiry.ts:32-34`), with marker comments `// api-lifecycle: begin/end` (`:365-366`).
2. A self-contained `startRetentionJob` (`jobs/retention.ts`): queue `retention`, scheduler id `retention-daily`, `{ pattern: '0 3 * * *', tz: 'UTC' }` (`:32-43`), started in `worker.ts:489-497`. `pnpm --filter @openverify/api retention:run` runs one pass from the CLI (`apps/api/scripts/retention-run.ts`).

`apps/api/src/jobs/repeatable/` and its index (planned by C54.1 for 5B: "the registry of repeatable jobs (feed refresh, trust refresh)", `docs/plans/phase-5.plan.md:375`) **do not exist**.

**Job naming:** kebab-case queue equals job name (`process-verification`, `webhook-delivery`, `inquiry-expiry`, `retention`). Jobs carry ids only (`jobs/index.ts:1-5`).

**Enqueue after commit**
- The flow submit dispatches events, then enqueues (`apps/api/src/services/flow.ts:594,605` at `f9349ed`).
- Decision hooks return `{ staged, enqueue }`, and `afterDecision` enqueues after the commit, logging failures with ids only (`jobs/process-verification.ts:225-250`).
- `ApiDependencies.queue` is the `VerificationQueue` (`services/context.ts:38`). It has one method, `enqueueProcessVerification` (`ports.ts:89-96`).

**`FOR UPDATE SKIP LOCKED`:** inquiry expiry (`jobs/inquiry-expiry.ts:12`), inquiry sessions (`repositories/inquiry-sessions.ts:382`) and retention deleters (`repositories/retention.ts:144,162,197,236,265,284`). **No advisory lock** is used anywhere.

**Lock order (C40.6, `docs/plans/phase-4.plan.md:151`):** lock the inquiry and re-check `redacted_at` (`assertInquiryOpenUnderLock`, now `apps/api/src/services/flow-preconditions.ts:61`), then the verification, then its sub-resources. The type-hook header restates it (`jobs/types/index.ts:13-15`).

**`PermanentJobError(reason)`** (`jobs/errors.ts:6-14`) becomes BullMQ `UnrecoverableError`. Before it fails for good, the verification is failed (`processVerificationProcessor`, `worker.ts:177-200`).

**Type hooks** (`jobs/types/index.ts:1-20`): `evaluate`, `persistInDecisionTx`, `afterCommit`, `onProcessingFailed` and `onInquiryVerificationDecided`, one file per type. They are verification-only. A report job would be a new queue, not a hook.

**Reaching vision or the network**
- `ProcessVerificationDeps` (`jobs/process-verification.ts:100-124`) carries `vision: VisionClient`, `providers`, `cache: KeyValueCache`, `outboundHttp: OutboundHttp`, `dnsResolver`, `rateLimiter` and `queue`.
- The worker builds them in `worker.ts:455-487`, each on its own lazy Valkey client.

## 9. Data at rest

**Sealing**
- `sealValue`/`sealJson` with row AAD `<table>.<column>#<rowId>` (`packages/db/src/sealed.ts:24-90`).
- `ENCRYPTED_COLUMNS` (`encrypted-columns.ts:22-52`, 29 entries) lists each column's AAD kind: `static`, `row` or `file`.
- `SEALED` names (`:55-80`). The set is checked by `schema-v2.test.ts`.

**Blind indexes** (`packages/db/src/blind-index.ts`)
- HMAC-SHA-256 under a **per-environment subkey** `HMAC(key, "openverify/blind-index/v1|<environmentId>")` (`:121-131`).
- Labels: `OTP_DESTINATION_INDEX_LABEL = 'openverify/otp-destination/v1'` (`:157`) and `CRYPTO_ADDRESS_INDEX_LABEL = 'openverify/crypto-address/v1'` (`:159`). The identification-number index is `:139`.
- Rebuild: `pnpm --filter @openverify/api blind-index:rebuild` (`apps/api/scripts/blind-index-rebuild.ts:1-14`).
- Because the subkey is per environment, an install-wide list cannot be joined to a blind index. Matching must compare plaintext in worker memory or index list values per environment.

**Key rotation:** `REWRAP_TABLES` (`repositories/key-rotation.ts:18-35`, 16 tables) and `ID_COLUMNS` (`:55-58`: `government_id_extractions` and `verification_inputs` are keyed by `verification_id`). `kek:rewrap` walks them.

**Redaction**
- Header table (`repositories/redaction.ts:1-26`): `inquiries`, `accounts`, `inquiry_sessions`, `verification_checks`, `government_id_extractions`, `files`, `selfie_captures`, `verification_inputs`, `otp_challenges`, `otp_verification_states`, `crypto_challenges`, `face_templates`, `selfie_backgrounds`, `events`, `api_logs`, `idempotency_keys`.
- `SUBJECT_PII_TABLES` (`apps/api/src/services/redaction.test-support.ts:47-63`, 15 tables) and `OPERATOR_PII_TABLES = ['audit_logs','mfa_factors','webhooks']` (`:66`). The coverage test seeds one row of each.
- API logs and idempotency copies are found through `REDACTION_SUBJECT_ID_PREFIXES` (§1).

**Retention**
- `DEFAULT_RETENTION` (`repositories/retention.ts:36-41`): `inquiry-retention-days: null` (forever), `api-log-retention-days: 30`, `webhook-delivery-retention-days: 30`, `event-retention-days: 90`. Face templates: 365 (`DEFAULT_FACE_TEMPLATE_SETTINGS`, `:49-53`).
- The run is described at `services/retention.ts:1-22` and executed by `retention:run [--now=] [--json]`.
- Settings live in `environments.settings` jsonb (`tables/tenancy.ts:37-50`).

**Tenancy:** every data table has `environment_id` and composite FKs.
- `phase5-tables.test.ts:1-8` asserts this for Phase 5 tables "but the install-wide trust tables (5B)".
- `schema.test.ts:106-120` lists `tenantTables`.
- **No install-wide data table exists yet.** Organization-scoped tables are `organizations`, `environments`, `users`, `roles` and the like.

**Audit:** audit log rows need an environment. A system entry (`appendSystemAuditEntry`, `apps/api/src/services/audit-log.ts:68-86`; DB enum `audit_actor_type` has `system`, `packages/db/src/tables/enums.ts:107`) is **never served by the API** (`toUserAuditLogResource` returns null, `:101-106`). Contracts `AUDIT_ACTOR_TYPES = ['user','api-key']` (`user-audit-logs.ts:19`).

**Migrations** (`packages/db/drizzle/`)
- `0000_schema_v0.sql` … `0017_phase5_inputs_otp_crypto.sql`. The journal's last entry is idx 17 (`meta/_journal.json`).
- 5A owns 0017, which creates `verification_inputs`, `otp_challenges`, `otp_verification_states` and `crypto_challenges`.
- 5B plans **0018**, which **does not exist yet**. Phase 6 gets 0019 only if 5B merges first.
- `migrate.test.ts` asserts contents by journal index (`:107-135`).
- Generate with `pnpm --filter @openverify/db db:generate` (drizzle-kit 0.31.11, `drizzle.config.ts`).

**`pg_trgm`**
- Used nowhere: no `pg_trgm`, `gin_trgm_ops` or `similarity(` in migrations, source or docs.
- Extensions today: `CREATE EXTENSION IF NOT EXISTS vector` in `0001_schema_v1.sql:6` and `0015_selfie_captures_face_templates.sql:2`; compose initdb `infra/postgres/initdb/001-extensions.sql` (vector only); image `pgvector/pgvector:pg17` (`infra/docker-compose.yml:72-73`, and every Testcontainers test, for example `packages/db/src/db.integration.test.ts:14`).
- Whether that image ships `pg_trgm` **cannot be checked from the repo** without Docker. It is built on the official Postgres image, whose server package carries the contrib modules (from knowledge, not verified here). A Testcontainers test should assert `pg_available_extensions`.
- **Unit tests run every migration on PGlite** with only `extensions: { vector }` (`packages/db/src/testing.ts:3,10-11,56,60`; `@electric-sql/pglite@0.4.6`). PGlite 0.4.6 ships `contrib/pg_trgm`, `fuzzystrmatch`, `unaccent` and `btree_gin` (`node_modules/.pnpm/@electric-sql+pglite@0.4.6/.../dist/contrib/`). A `pg_trgm` migration must add that loader in `testing.ts`.
- Neither bulk COPY nor an advisory-lock helper exists in `packages/db`.

## 10. Outbound HTTP and data

**`OutboundHttp`** (`apps/api/src/http/index.ts`, C54.6)
- Options `OutboundHttpClientOptions { name, contentTypes, maxResponseBytes?, timeoutMs?, allowPrivateNetworks?, allowPlainHttp? }` (`:52-65`).
- Request `{ method: 'GET'|'POST', url, headers?, body? }` (`:67-72`).
- Response `{ status, contentType, body: Uint8Array }`: **no response headers** (`:74-80`).
- Defaults: 1 MiB cap (`DEFAULT_MAX_RESPONSE_BYTES`, `:32`) and 10 s (`:34`).
- Behaviour:
  - a dedicated undici `Agent` with `createVettedLookup`, so private networks are refused and `HTTP_PROXY` is ignored (`:159-164`);
  - no redirect is followed: a 3xx is returned by status with its body dumped (`:183-193`);
  - a content-type allowlist on 2xx (`:194-198`);
  - the **whole body is buffered** (`Buffer.concat`) and over-cap answers are refused `too_large` (`:199-210`);
  - no streaming, no decompression, no conditional-request support.
- Errors: `OutboundHttpError` with code `invalid_url|blocked|dns|timeout|network|too_large|content_type` and `retryable`, never the URL (`:36-50`).
- Factory: `createOutboundHttp({ resolve? })` (`:219-228`). `ApiDependencies.outboundHttp` (`services/context.ts:65`) and the worker deps carry it.
- **No non-test caller** of `.client({...})` exists yet. The SMS and EVM providers are stubs (`providers/sms/index.ts:31-41`).
- The C54.6 plan caps are "1 MiB default; 5 MiB CRLs, 16 MiB master lists" (`docs/plans/phase-5.plan.md:380`).

**DNS:** `createDnsResolver()` uses a dedicated `node:dns/promises` `Resolver` with a 3 s timeout and 2 tries (`apps/api/src/dns/index.ts:11-12,66-80`). The port has only `resolveMx`, `resolve4` and `resolve6` (`ports.ts:1002-1006`). **There is no `resolveTxt`**, and no SPF, DMARC or `MX`-reputation helper.

**Provider bindings** (`apps/api/src/providers/index.ts`)
- The kind table is at `:6-16`.
- `PROVIDER_KINDS` (`:50-54`) combines `GOVERNMENT_ID_PROVIDER_KINDS`, `SELFIE_PROVIDER_KINDS` and `PHASE5A_PROVIDER_KINDS = ['sms','database','evmRpc']` (`:47`).
- `PROVIDER_ENV_PREFIXES` (`:58-68`): `OPENVERIFY_PROVIDER_<KIND>_<SANDBOX|PRODUCTION>`.
- `PROVIDER_NAMES = ['sandbox','twilio','json-rpc']` (`:71`) and `PROVIDER_NAMES_BY_KIND` (`:78-89`).
- `PROCESS_PROVIDER_KINDS`: `api` reads `['sms','database','aamva']`; `worker` reads every kind except `sms` (`:98-102`).
- `readProviderSettings(env, process)` refuses a sandbox value in production and unknown names without echoing them (`:148-179`). `createProviderBindings(settings, options)` (`:198-…`) builds the instances; ports types are at `ports.ts:466-744`.
- Unset means unbound, and the check then answers `provider_not_configured`.

**Data files**
- `data/manifest.json` (`schema_version: 1`) holds one entry, `disposable_email_domains`. An entry has `name`, `filename`, `url` (pinned commit), `sha256`, `size`, `license`, `license_url`, `source_repo`, `commit`, `description` and `notes` (`data/manifest.json:1-18`).
- `scripts/fetch_data.py`:
  - `PERMISSIVE_LICENSES` = `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `PostgreSQL`, `CC0-1.0`, `CC-BY-4.0` (`:48-59`); there is no identifier for US-government public-domain works, `OGL-UK-3.0` or the EU reuse notice;
  - required fields at `:62-71`; the file is written only if its sha256 and size match (`:248-300`); the reserved names are `manifest.json` and `malicious-feeds.json` (`:78`).
- The design fits fixed snapshots, **not lists that change daily**.
- CI's e2e job caches and fetches `data/*` (`.github/workflows/ci.yml:373-384`). `.dockerignore:21-26` re-includes the data files in the API image.

**Trust-store sync (C62.7):** design only (`docs/plans/phase-5.plan.md:522-528`). It describes:
- a manifest of sources with pinned roots;
- the `trust-anchors:sync [--source] [--import --root]` CLI, wrapped by `scripts/fetch_trust_anchors.sh`;
- a per-source advisory lock and a single transaction;
- refusal of a list whose signing time is older (rollback);
- `withdrawn_at` on memberships absent from the new list;
- a `trust_anchor_syncs` audit table;
- a refresh job only with `OPENVERIFY_TRUST_ANCHOR_REFRESH=true`, and never in CI.

**None of it exists:** no `trust-anchors/`, no script, no table, no repository.

**Parsers:** the API runtime dependencies have no XML, CSV or ZIP parser (`apps/api/package.json` dependencies). `saxes@6.0.0` is in the lockfile only through `jsdom@29.1.1` (test).

## 11. Checks the reports would use

**`packages/checks/src/matching/index.ts`** at HEAD: a comment naming C58 and `export const MATCHING_CHECKS_AREA = 'matching'` (`:1-10`). Nothing else. It is built by 5A Stage 2 `checks-matching`, which has not started. The siblings are stubs too: `contact/index.ts` (`CONTACT_CHECKS_AREA`), `crypto/index.ts` (`CRYPTO_CHECKS_AREA`), `database/index.ts`. All four are re-exported from `src/index.ts:26-29`.

**Phase 1 name matching** (`packages/checks/src/name-matching.ts`)
- `normalizeName` (`:26-35`) applies NFKD, strips marks, lowercases, maps `ß æ ø œ þ ð đ ł ı ħ`, drops apostrophes and collapses punctuation to spaces. **Non-Latin scripts are kept and not transliterated.**
- `jaroSimilarity` (`:43`) and `jaroWinkler(a, b, { prefixScale = 0.1, boostThreshold = 0.7 })` (`:105-121`).
- `tokenSetSimilarity` (`:133-154`): a subset scores 1.
- `compareNames` (`:171-185`) returns `exact`, `jaroWinkler`, `tokenSortJaroWinkler`, `tokenSet` and `score`.
- No input caps (C58.7 adds them).
- `NAME_TOKEN_THRESHOLD = 0.92` and `namesAgree` (`extraction/agreement.ts:15,142`).

**Dates:** `parseIsoDate`, `ageOn` and friends handle full ISO dates only (`dates.ts:22-62`). Partial dates (C58.5) do not exist.

**Addresses:** `PO_BOX_PATTERNS` (`id-po-box-detection.ts:18`) and `normalizeAddress(lines)` (`:48`). There is no address normaliser and no `packages/checks/data/`.

**Crypto**
- `CRYPTO_CHAINS` (7 fixed CAIP-2 chains), `EVM_CHAIN_ID_PATTERN = /^eip155:[1-9][0-9]{0,31}$/`, `cryptoChainFamily`, `normalizeCryptoChainId` (the TRON alias) and `cryptoChainIdSchema` (`packages/core/src/crypto-chains.ts:70-130`); `CRYPTO_INPUT_LIMITS` (`:134-`).
- The canonicalisation rules (EVM case-insensitive, bech32 lower-cased, base58 exact) exist only as plan text (C57.2, `docs/plans/phase-5.plan.md:418`).
- `@noble/curves`, `@noble/hashes`, `@scure/base` and `@scure/btc-signer` are declared in `packages/checks/package.json:32-36` (catalog `pnpm-workspace.yaml:31-34`).
- OFAC uses tickers (`XBT`, `ETH`, `TRX`, `USDT`, …; counts at `docs/research/phase5-libraries.md:798`), not CAIP-2. No map exists.

**Phone:** `libphonenumber-js@1.13.14` (catalog `pnpm-workspace.yaml:36`; `packages/checks/package.json:37`, `apps/flow/package.json:21`) has no import in any source file.

**Disposable list:** the data file is fetched (`data/disposable_email_blocklist.conf`). There is no loader: `grep disposable apps/api/src packages/checks/src` finds only the contact stub's comment.

**RDAP:** absent. It is 5B C61.4 and appears only in `http/index.test.ts:85-92` as a test client name.

## 12. Inquiry completion

**Where it completes**
- `settleInquiry(deps, environmentId, inquiryId, flow)` (`apps/api/src/services/inquiry-settlement.ts:47-117`):
  - it uses `decideInquiryOutcome(requiredVerifications(flow), …)` (`jobs/inquiry-outcome.ts:61,142`);
  - it moves `pending` to `completed` or `failed`, or to `completed` then `needs_review` in one transaction (C30.5);
  - it dispatches its own events after commit;
  - its deps are `{ db, events, clock, logger }`, with **no queue**.
- It is called only from the worker (`jobs/process-verification.ts:291,398,418,441`).
- Other completion paths: the sandbox `complete_inquiry` simulate action (`services/simulate.ts:30-60` → `applyInquiryAction`, `services/inquiries.ts:621`). Operator actions move `completed` to `approved` or `declined` (`performInquiryAction`, `:657`).

**Choke point:** `transitionInquiryInTx(tx, deps, inquiry, to)` (`services/inquiries.ts:572-610`). Every status change goes through it: settlement, actions, simulate, expiry (`jobs/inquiry-expiry.ts:87`), and the flow's failure (`services/flow.ts:664`). It stages:
- the status event (`inquiry.completed` and so on);
- `inquiry.transitioned` with `meta { from, to }`;
- on leaving an open status (`OPEN_STATUSES`, `:87`), `inquiry-session.canceled` per active session, with one-time links revoked;
- on expiry, `verification.canceled`.

It returns `staged` for the caller to dispatch and runs no hook.

**Where a "run reports on completion" hook could go**
- `settleInquiry` covers the worker path only.
- `transitionInquiryInTx`, when `to === 'completed'`, covers every path, but runs in either process and only stages events.
- Either way the report runs must be enqueued after the caller's commit. Today only `VerificationQueue` exists, and `InquirySettlementDeps` has no queue.

**Where a `reports` list could live**
- Not in `settings` today: `templateSettingsSchema` and `resolvedTemplateSettingsSchema` are strict 4-key objects (`template-settings.ts:16-32`), and the stored column is `inquiry_template_versions.settings` jsonb.
- Not in `verification-config` either, which is strict over verification types.
- Either needs a contract change. Because it is pinned per version, an inquiry keeps the report list it started with.
- The flow-spec top level is a strict `{ metadata, steps, transitions }` (`packages/flow-spec/src/flow.ts:460-465`).

## 13. Dashboard

**App router** (`apps/dashboard/src/app/`)
- One folder per resource with `page.tsx`, `[id]/page.tsx`, `layout.tsx`, `loading.tsx` and `error.tsx`. The resources are inquiries, accounts, account-types, templates (with `[id]/versions/[versionId]`), webhooks (with `deliveries/[deliveryId]`, `new`, `edit`), api-keys, api-logs, audit-logs, events, users, roles, settings and verifications.
- Server actions live in `<route>/actions.ts`.

**Index page with filters:** `app/inquiries/page.tsx:30-80`. It parses the query with `parseInquiryListQuery`, renders `InquiryFilters`, calls `listInquiries(filters, after)`, then `InquiriesTable`, `Pagination` and `EmptyState`.

**Detail page:** `app/inquiries/[id]/page.tsx` renders `components/lifecycle/inquiry-view.tsx` (417 lines), a stack of `PageSection`s with `ACTIONS` (`:36-48`). **There is no tab component** (no `tablist`/`Tabs` in `apps/dashboard/src` or `packages/ui/src`). An "inquiry tab" or "account tab" means a new section or a new UI primitive.

**Fetching**
- Server components only, through `renderPage({ permissions }, async ({ session, api }) => …)` (`lib/api/page.tsx:1-20`). It handles login, MFA, the forbidden panel and 404.
- Two clients:
  - dashboard endpoints through `apiRequest` with contract schemas, for masked documents (`lib/api/inquiries.ts:24-51`, `GET /dashboard/inquiries[/:id]`);
  - the server API through `@openverify/node` with the user session (`api.accounts.retrieve`, `app/accounts/[id]/page.tsx:57-62`; `api.inquiryTemplates`, `app/templates/[id]/page.tsx:75-78`).
- The timeline comes from `GET /events?filter[inquiry-id]=` (`listInquiryEvents`, `lib/api/inquiries.ts:57`).

**Navigation:** `NAV_GROUPS` (`components/nav-items.ts:23-51`):
- "Verifications": inquiries, accounts, account-types, templates;
- "Integrations": webhooks, api-keys, api-logs, events;
- "Organization": users, roles, audit-logs, settings.

Each item is gated by one `permission`. Hiding an item is UX only.

**Event groups:** `eventNameGroups()` (`lib/api/events.ts:75-84`): Inquiry, Inquiry session, Verification, Account, Selfie. Event words exist for selfie events only (`lib/event-words.ts:12-17`).

**Templates editor:** a JSON editor (`components/lifecycle/version-editor.tsx`, `components/json-editor.tsx`) and `new-draft-button.tsx`.

**Testing**
- `testing/api-routes.ts` (`routeApi()`; `.me()`, `.on()`, `.onProblem()`, `.find()`), `testing/api-mock.ts`, `api-fixtures.ts`, `lifecycle-fixtures.ts`, `selfie-fixtures.ts`.
- The per-area `testing/routes/<area>.ts` and `testing/fixtures/<type>.ts` planned by C66 do not exist yet.

**E2E UI specs:** 10 `e2e/tests/ui-*.spec.ts`, for example `ui-lifecycle.spec.ts:1-40`. They set up through `@openverify/node` (`recordingClient`, `defaultTemplateAttributes` in `e2e/tests/support/platform.ts`), sign in with `signInAs` (`support/ui.ts`), and assert by role and region.

**Labels:** `lib/labels.ts:12-91` (status, verification type, file kind).

## 14. Settings and seed

**Settings service**
- `getDashboardSettings` (`apps/api/src/services/settings.ts:35-46`) merges `organization.requireMfa` with `resolveRetentionSettings` and `resolveFaceTemplateSettings` from `environments.settings`.
- `updateDashboardSettings` (`:53-…`) writes them in one transaction with a `settings.updated` audit entry. `RETENTION_KEYS` is at `:21-29`.
- It does not yet serve the C55.7 OTP settings (5A Stage 1b pending).
- Routes: `GET`/`PATCH /dashboard/settings`, `settings:read`/`settings:write` (`apps/api/src/routes/dashboard/settings.ts:13-33`).

**Adding an environment setting** (the `face-search-max-templates` precedent):
1. A contracts schema and a bounds constant; `dashboardSettingsSchema` member (optional) (`dashboard-api.ts:152-176`), `DASHBOARD_SETTINGS_DEFAULTS` (`:178-186`) and `dashboardUpdateSettingsBodySchema` (`:189-202`).
2. The DB `EnvironmentSettings` interface (`tables/tenancy.ts:41-50`) and a `resolve…Settings` function with defaults (`repositories/retention.ts:55,67`).
3. `services/settings.ts` keys.
4. The dashboard `settings-fields.ts` (`components/operators/settings-fields.ts:1-50`) and its form.

**`seed:dev`** (`apps/api/src/seed/dev-seed.ts:1-14`)
- It creates one organization with sandbox and production environments, the four built-in roles, one operator per role, a sandbox API key holding every API scope (`:475`), and the default template from `contracts/fixtures/flows/default-gov-id-selfie.json` (`DEFAULT_TEMPLATE_PATH`, `:66`) with explicit settings (`:75`).
- `--mfa-admin` adds a TOTP admin.
- It is idempotent.
- It creates no report template, watchlist data or provider data. C62.8 plans that 5B's seed inserts the Utopia test CSCA and refuses to run in production mode.

## 15. Existing docs and records Phase 6 must correct

**`docs/PLAN.md`**
- §3 rows: `:143` `| Sanctions | OFAC SDN + Consolidated (incl. crypto addresses), UN SC, EU FSF, UK OFSI | public |` and `:144` `| PEP / adverse media | Wikidata (positions held) / GDELT DOC API adapters | CC0 / open |`.
- §6 Phase 6 `:400`: "Watchlist ingestion (OFAC, UN, EU, UK) with scheduled refresh". **UN is included, while the brief names OFAC, EU and UK.**
- `:63`: the Reports row names `packages/watchlist` and "`apps/api` reports".
- `:70`: Signals names `packages/signals`.
- `:116-117`: the layout lists `watchlist/ sanctions/PEP ingestion + fuzzy matching` and `signals/`.
- `:339`: Phase 0 step 5 names `scripts/fetch-watchlists.ts`, which does not exist. The fetchers are Python `scripts/fetch_{models,fixtures,data}.py`.

**`THIRD_PARTY_LICENSES.md` §4.2 "Planned data sources"** (`:277-286`):
- `:281` `| OFAC SDN + Consolidated lists (incl. crypto addresses) | US government work (public domain) | ofac.treasury.gov | Watchlist screening | to verify on adoption |`
- `:282` `| UN Security Council Consolidated List | Public, UN terms of use | un.org | Watchlist screening | to verify on adoption |`
- `:283` `| EU Financial Sanctions Files (FSF) | Public, EU reuse terms | data.europa.eu | Watchlist screening | to verify on adoption |`
- `:284` `| UK OFSI Consolidated List | Open Government Licence v3.0 | gov.uk | Watchlist screening | to verify on adoption |`
- `:285` `| Wikidata (positions held) | CC0 | wikidata.org | PEP screening | to verify on adoption |`
- `:286` `| GDELT DOC API | Open, attribution requested (terms to verify) | gdeltproject.org | Adverse media | to verify on adoption |`
- The UK row names the OFSI Consolidated List. The plan should verify the current UK source (not checked here).

**Earlier research**
- `docs/research/phase5-libraries.md:506-507` cites the OFAC `SDN.CSV` export and the EU FSF XML URL. Its note says the EU link carries a fixed public `token` query parameter.
- `:342` notes that opensanctions/rigour `person_names.txt` holds cross-script variant groups (code MIT, data CC0).

**`docs/research/persona-surface.md`**
- "Report types (52)" (`:167-221`) lists kebab-case type names: `watchlist`, `politically-exposed-person`, `adverse-media`, `crypto-address-watchlist`, `business-watchlist`, `email-address`, `phone-number`, `address-lookup`, `screening`, and others.
- Report events (`:304-353`) are written **`report_<type>.<action>`**, never with a slash.
- Paths (`:512-523`): `reports`, `reports/{report-id}`, `/add-tag`, `/dismiss`, `/history`, `/pause`, `/print`, `/remove-tag`, `/resume`, `/review`, `/run`, `/set-tags`.
- No `report-templates` path, and no `report_*.redacted` event.

**`CLAUDE.md:38`** layout table: `workflow-engine`, `watchlist`, `signals`, `sdk-js`, `sdk-react` and `apps/demo-web` do not exist. Phase 5 decision 45 (`docs/plans/phase-5.plan.md:765`) says agents do not edit `CLAUDE.md`. The packages that exist are `checks config contracts core db flow-spec node ui`.

**Precedent for non-SPDX public data:** Phase 5 decision 40 records "public-sector PKI data as an operator-fetched runtime exception to rule 4" (`docs/plans/phase-5.plan.md:758`). It is the closest precedent for sanctions lists.

---

## 16. Cross-cutting gaps the plan must resolve

1. **Event naming.**
   - Three conventions collide:
     - every current event is `<subject>.<action>` with no type (`verification.passed` for all 11 types);
     - the DB check allows `report/<type>.<action>`;
     - the surface index writes `report_<type>.<action>`.
   - `eventSubject` (`event-names.ts:122-128`), `EventSubject` (`:108`), `SUBJECTS` (`:110-116`), `PREFIX_BY_SUBJECT_TYPE` (`events.ts:26-33`), `redactedResourceStubSchema` (`:39-54`), `eventPayloadSchema` (`:64-87`), the samples' `RESOURCE_FIXTURES` and `STATUS_BY_EVENT` (`samples.ts:40-68`) and `eventNameGroups()` all need a report subject.
   - The surface has no `.redacted` report event and adds `report_address-lookup.submitted`.
2. **Install-wide data.**
   - Watchlist entries are the first install-wide data tables (5B's trust tables are not built).
   - Several pieces assume an environment: the tenancy tests, audit entries (no API-visible system actor), blind indexes (per environment) and retention.
   - The plan must decide: install-wide list tables, a sync-audit table (as `trust_anchor_syncs`), whether results and matches are environment-scoped, and how sandbox environments get deterministic lists.
3. **Ingestion path.**
   - `fetch_data.py` requires a fixed sha256 and size and refuses any mismatch, and `PERMISSIVE_LICENSES` lacks the list licences.
   - A changing list therefore needs an operator-run sync CLI, plus an optional repeatable refresh behind a flag.
   - Neither the trust-store sync it should mirror nor `jobs/repeatable/` exists.
4. **Outbound client limits.**
   - It buffers whole bodies, returns no headers (no `ETag`, `Last-Modified` or `Expires` for conditional fetches), does not decompress, and defaults to 1 MiB.
   - Large list files need a raised per-client cap, a streaming variant or a file-import path.
   - There is no runtime XML or CSV parser.
5. **Matching dependency.** C58 (`packages/checks/src/matching`) is a stub at HEAD. Phase 6's matcher sits on unfinished 5A Stage 2 work, as do crypto canonicalisation (C57.2), libphonenumber use (C55.8) and the disposable loader (C56).
6. **`pg_trgm` and tests.**
   - The production image is unverified.
   - PGlite unit tests load only `vector`, so a `pg_trgm` migration breaks every DB unit test until `testing.ts:56,60` loads `@electric-sql/pglite/contrib/pg_trgm`.
   - `unaccent()` is not immutable, so it cannot sit in an index expression without a wrapper.
7. **Migration number.** 0018 is 5B's and does not exist. Phase 6's number depends on merge order, and drizzle's journal is sequential.
8. **PII lists are verification-scoped.**
   - `PII_VERIFICATION_ATTRIBUTES` derives from verification schemas only.
   - `REDACTION_SUBJECT_ID_PREFIXES` lacks `rep`.
   - Inquiry redaction stubs the events of the inquiry, its verifications, sessions and captures only (`repositories/redaction.ts:271-276`).
   - `aboutInquiries` (event timeline) covers verifications, sessions and selfies only.
   - Redaction tables, `SUBJECT_PII_TABLES`, `REWRAP_TABLES`, `ENCRYPTED_COLUMNS` and `SEALED` all need report rows.
9. **Completion trigger.**
   - No queue in settlement, no internal event subscriber, and the strict template `settings`.
   - The plan must pick the hook point (`settleInquiry` or `transitionInquiryInTx`), the process (worker or API for simulate), enqueue-after-commit, and where the template's report list lives (settings or a new member).
10. **Accounts.**
    - `add-objects`, `remove-objects` and consolidation know only inquiries.
    - A report owned by an account needs a move rule on consolidation, a redaction path (account redaction redacts inquiries first), and a place in the lock order (accounts in id order, then inquiries; C40.6 for inquiry-owned rows).
11. **Tag events differ.** Inquiries emit only `inquiry.updated-tags`; accounts emit `tag-added`, `tag-removed` and `updated-tags`. The surface lists no report tag event.
12. **Scopes.** The viewer role automatically gets any new `:read` permission. The developer and reviewer lists are explicit. The dashboard has no "Reports" permission area.
13. **Provider kinds.**
    - The 5B kinds and the `none` name are not added yet.
    - New report kinds (PEP, adverse media, phone or email intelligence, address lookup) must choose a process. The worker reads every kind except `sms`.
14. **Dashboard.** There is no tab primitive, no reports nav group, no event words beyond selfie, and the per-area mock routes of C66 do not exist.
15. **Records.** UN is in PLAN §6, §3 and `THIRD_PARTY_LICENSES.md:282` but not in the brief. `scripts/fetch-watchlists.ts` and the `packages/watchlist` and `packages/signals` names are stale. `CLAUDE.md` cannot be edited by agents (decision 45).

## 17. Conventions a new resource must follow (end to end, in order)

This order is derived from how the account resource (Phase 2) and the Phase 5 types run through the code, and from the commit pattern on `main`.

**Every unit:**
- lands as `chore(...)` stub, then `test(...)` RED, then `feat(...)` GREEN, then optional `refactor(...)`;
- names the contract ids (for example `C70.1`) and ends with the `Claude-Session` line;
- records evidence in `docs/tdd/phase6-<agent>.tdd.md`;
- keeps every package at ≥80% coverage.

Shared files change only through the stage that owns them (the C54 rule).

**0. Plan:** `docs/plans/phase-6.plan.md`, with this file as its Starting point, Patterns to mirror, Locked contracts, Workflows, Validation, Risks, Acceptance and Decisions.

**1. `packages/core`**
1. `API_SCOPES` and role lists in `permissions.ts`, including `NOT_FOR_VIEWERS` if needed; update `permissions.test.ts`.
2. The report status enum and state machine with an `…_EVENT_BY_STATUS` map, in the model of `verification-state-machine.ts:13-25` (`as const satisfies …`); exported from `index.ts`.
3. Report type ids and any configuration schemas with defaults (`check-config/<area>.ts` style).

**2. `packages/contracts`** (flat files only)
1. `ids.ts` prefixes, plus the `ids.test.ts` lists.
2. `resource-types.ts` and `identifiers.ts` (`reportIdentifierSchema`).
3. `reports.ts`:
   - attributes with `.meta({ pii: true })` marks and a `PII_REPORT_ATTRIBUTES` list;
   - relationships (`inquiry`, `account`, `report-template`, …);
   - resource, document, list and query schemas (`listQuerySchema('rep', …)`);
   - action bodies (`actionBodySchema`/`emptyActionBodySchema`);
   - `build<Resource>` builders.
4. `report-templates.ts` and `report-template-versions.ts`, mirroring `inquiry-template(-version)s.ts`.
5. `event-names.ts`: a name list per subject in `EVENT_NAMES`, `EventSubject`, `SUBJECTS`. Then `events.ts`: `PREFIX_BY_SUBJECT_TYPE`, the stub enum, the `data` and `included` unions, `payloadFitsName` if needed.
6. `inquiries.ts` `INQUIRY_INCLUDES` and the include union, and the `dashboard-api.ts` included union, if reports are included.
7. `template-settings.ts`, or a new template member for the completion trigger.
8. `scopes.ts` re-export plus `vocabulary.test.ts`; `problem.ts` codes; `rate-limits.ts` if limited.
9. Golden fixtures `contracts/fixtures/api/report-<type>.json` (and template, version, run, action), a `contracts/README.md` row, and validation in `fixtures.test.ts`.
10. `index.ts` exports.

**3. `packages/db`**
1. `src/ids.ts` prefixes.
2. `src/tables/reports.ts` (plus template, run, action and, if install-wide, watchlist tables), with:
   - `environment_id` and composite FKs to `(environment_id, inquiry_id)` and `(environment_id, account_id)`;
   - `idFormat`, `validTags`/`lowerTags`, sealed PII columns;
   - list indexes `(environment_id, created_at desc nulls first, id desc nulls first)`;
   - status enums with `ALTER TYPE … ADD VALUE` on later changes.
3. Export the tables from `schema.ts`.
4. A drizzle-kit migration (SQL, `meta/` snapshot, journal) with `CREATE EXTENSION IF NOT EXISTS pg_trgm` in the migration itself. Load the PGlite `pg_trgm` contrib in `testing.ts`. Add a `migrate.test.ts` assertion and a Testcontainers migration test.
5. Add to `ENCRYPTED_COLUMNS`, `SEALED`, the `schema-v2.test.ts` list, `REWRAP_TABLES` and `ID_COLUMNS` (if keyed by parent), with a `kek:rewrap` test per table.
6. Repositories `src/repositories/<name>.ts` with exports in `repositories/index.ts`.
7. Redaction:
   - a `redaction.ts` header row and a `redact…` helper;
   - add the report ids to the inquiry's and the account's `stubEventPayloads` object lists;
   - `REDACTION_SUBJECT_ID_PREFIXES`;
   - `aboutInquiries` in `repositories/events.ts`;
   - retention.
8. A blind index with a new label and `blind-index:rebuild` coverage, if a report field must be searchable.

**4. `apps/api`**
1. `ports.ts` provider kinds and interfaces. Then `providers/index.ts` (`PROVIDER_ENV_PREFIXES`, `PROVIDER_NAMES(_BY_KIND)`, `PROCESS_PROVIDER_KINDS`), the sandbox providers, `config.ts`, `.env.example`, compose and `docs/checks/sandbox-providers.md`.
2. `services/reports.ts` (and templates, runs, actions):
   - every write in one transaction under the lock order (the inquiry first when the report belongs to one), with `events.stage` in the transaction, `events.dispatch` after commit, and enqueue after commit;
   - an audit entry per state change;
   - masking through `piiMaskFor` and a `MASKED_ATTRIBUTES` extension in `auth/pii.ts` and `services/api-logs.ts`.
3. `routes/server/reports.ts` (and templates): plugin-registered in `routes/server/index.ts`, `config.scopes`, zod schemas with `problemResponses`, `optionalBody` for actions, tag routes, the `NAMED_SCHEMAS` row in `plugins/openapi.ts`; then `openapi:write`.
4. Jobs:
   - a new queue module in the model of `jobs/index.ts` (job id = report or run id, attempts and backoff, `PermanentJobError`);
   - processors registered in `startWorkers`;
   - repeatable monitoring in the `RepeatableJob` list (or `jobs/repeatable/` once 5B adds it);
   - the sync CLI as `apps/api/scripts/<name>.ts` with a `package.json` script (`retention:run`, `kek:rewrap` style: counts only, never data);
   - race tests in the pattern of `redaction-race.integration.test.ts`.
5. The completion trigger at the chosen hook point, with tests on both the worker and the simulate paths.
6. Webhooks: `webhooks/samples.ts` fixtures and status maps. Add `rep` to `events/subject.ts` only if reports lack an `inquiry` relationship.
7. Settings: the `services/settings.ts` keys if any environment setting is added.
8. Redaction: `services/redaction.ts`, the `redaction.test-support.ts` `SUBJECT_PII_TABLES` and the seeded subject.
9. `seed/dev-seed.ts` if a default report template ships.

**5. `packages/node`:** a method group in `OpenVerifyClient` (`client.ts:523-539`) and its builder, guards in `types.ts`, exports and tests. Only the integration agent regenerates it, with the API fixtures and the OpenAPI snapshot.

**6. `apps/dashboard`**
1. `PERMISSION_INFO` and `AREAS`.
2. `NAV_GROUPS` items.
3. `lib/api/<resource>.ts` (dashboard endpoint or node client).
4. Routes `app/reports/{page,layout,loading,error}.tsx`, `[id]/page.tsx` and `actions.ts`.
5. Filters and table components in the model of `inquiry-filters.tsx` and `inquiries-table.tsx`.
6. Labels (`lib/labels.ts`), event words and `eventNameGroups()`.
7. Sections on the inquiry and account pages (no tab primitive exists).
8. Mock routes and fixtures in `testing/`.
9. Mocked page tests (`routeApi()`), and a full-stack `e2e/tests/ui-reports.spec.ts`.
10. `apps/dashboard/README.md`.

**7. Docs, data and records**
- `docs/checks/<report>.md` with "What a pass means" and the sandbox magic values.
- `THIRD_PARTY_LICENSES.md` §4.2 rows moved to verified, with sources pinned where possible.
- Fetchers in `scripts/fetch_*.py` only for fixed snapshots.
- Full-stack `e2e/tests/report-*.spec.ts` with no real network.
- A `docs/PROGRESS.md` entry.
- PLAN §3, §4.4 and §6 amendments, and the `persona-surface.md` naming note.
