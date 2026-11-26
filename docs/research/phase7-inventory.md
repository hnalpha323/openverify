# Phase 7 starting point: inventory (2026-10-27)

Phase 7 ("Signals, lists, graph, transactions", `docs/PLAN.md:405-411`; feature rows `docs/PLAN.md:67-70`; technology rows `:141-142,147`; catalog `:281-285`):
- a browser signal collector (fingerprint, automation detection, behavioural metrics, bot score) and Android device signals (ANDROID_ID, debugger);
- network intelligence: IP geolocation and ASN (DB-IP Lite), the Tor exit list, cloud ranges, VPN and datacenter ASN lists, a threat level, distances in metres;
- device handoff from desktop to phone by QR (and email);
- lists of 13 kinds with CSV importers and list matching;
- a graph of shared-attribute links with queries, query templates and a Cytoscape explorer with bulk actions;
- transactions with custom types, field schemas, statuses and labels.

**How this was taken**
- A read-only inventory of `/home/mhnoor/persona-opensource`. Reading started at **HEAD `0dec46788525e08de5cbe29b69188c6cffafb759`** (`0dec467`, 2026-10-27 18:29 UTC) and ended at **HEAD `5e666cbc1150c2daf3e6839cc54e9f7ae2ae8cec`** (`5e666cb`).
- Workflow 6A (Phase 6, Stage 1a) committed throughout. `git log 0dec467..5e666cb --name-only` lists only `apps/api/src/plugins/rate-limit.test.ts` (`5e666cbc`, the C12 rules test now includes the `reports` policy) and `apps/api/src/webhooks/samples.test.ts` (`76781998`, casts removed); neither was read (the inventory read `plugins/rate-limit.ts` and `webhooks/samples.ts`, which did not change); **no file read for this inventory changed**, so every line number holds at both HEADs. The working tree was clean at the end.
- Paths are relative to the repo root. `file:N` and `file:N-M` are line numbers at `0dec467`. "Does not exist" means a repo-wide grep (excluding `node_modules`, `dist`, `coverage`, `.next`, `build`, `.git`) found nothing; each such claim names what was grepped.
- `docs/plans/phase-6.plan.md` C73, C76, C77, C78, C83, C84 and ADR 0005 were read in full; so were `CLAUDE.md` and `docs/research/phase6-inventory.md`, whose shape this file follows.

---

## 0. One-page summary

| Phase 7 item | Already exists | Does not exist |
|---|---|---|
| **Identifiers** (`dev`, `net`, `lst`, `li`, `gq`, `gqt`, `txn`, `txntp`, `txntpv`, `txnl`, token `ovh_`) | <ul><li>Two prefix tables, lowercase letters only: contracts `ID_PREFIXES` (`packages/contracts/src/ids.ts:11-47`, frozen) and DB `ID_PREFIXES` (`packages/db/src/ids.ts:8-46`).</li><li>6A's `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `rpm` are taken in both.</li><li>Token prefixes `ovs_`, `ovu_`, `wbhsec_`, `ovo_`, `ovm_`, `ovi_` (`tokens.ts:10-18`); API keys `ov_sbx_`, `ov_prod_`.</li></ul> | <ul><li>All eleven candidates are **free** in both tables and as tokens.</li><li>`txn_` already appears as a literal in `packages/contracts/src/reports.test.ts:116`.</li><li>`REDACTION_SUBJECT_ID_PREFIXES` is still `inq, ver, iqse, acc, self`.</li></ul> |
| **Session capture** (IP, user agent) | <ul><li>`inquiry_sessions.ip` and `.user_agent`, sealed with a row AAD, from the **first** flow call, `request.ip` under `OPENVERIFY_TRUST_PROXY` (`auth/flow-session.ts:150-153`; `operator-auth/settings.ts:67-108`).</li><li>Consent jsonb with a static-AAD IP and UA.</li><li>Masked without `pii:view`.</li></ul> | <ul><li>No other per-call or per-device data; no index on IP or UA.</li><li>No session cap; `resume` revokes nothing.</li><li>No `session.*` event (only `inquiry-session.*`).</li></ul> |
| **Browser signal collector** | <ul><li>The selfie device snapshot with `webdriver: navigator.webdriver` (`apps/flow/src/selfie/device-snapshot.ts:122-135`), sealed in `selfie_captures.device`, used as a liveness integrity flag.</li><li>`client-elapsed-ms` on selfie uploads.</li></ul> | <ul><li>`packages/signals` and `@openverify/js` do not exist.</li><li>No fingerprint, behaviour (paste, focus, typing), CDP/headless detection or bot score anywhere.</li><li>No signal consent key; no bundle-size budget; the flow CSP has no `worker-src` and the serving layer sends no `frame-ancestors`/`Permissions-Policy`.</li><li>Only the hosted mode exists.</li></ul> |
| **Android device signals** | <ul><li>`User-Agent: OpenVerify-Android/0.1.0`; CameraX facts in the selfie snapshot; the NFC device report.</li></ul> | <ul><li>No `ANDROID_ID`, debugger, emulator, root or Play Integrity code (grep over `android/`).</li><li>Only `INTERNET` and `CAMERA` permissions. PLAN puts root/emulator in Phase 10 (`:432`).</li></ul> |
| **Network intelligence** | <ul><li>Address classification for SSRF (`webhooks/ssrf.ts:144`) and a `node:net` `BlockList` CIDR matcher for API-key allowlists (`plugins/principal-auth.ts:139-162`; `api_keys.allowed_ips cidr[]`).</li><li>Planned-data rows (`THIRD_PARTY_LICENSES.md:337-340`).</li><li>Runtime-fetch precedents: the malicious-feed job into Valkey and the CSCA trust-store sync.</li></ul> | <ul><li>No DB-IP, ASN, Tor, cloud-range or VPN data, loader, table or job; no geolocation or distance code (grep `db-?ip|geoip|mmdb|maxmind|exit-addresses|torproject|ip-ranges|\bASN\b|haversine`).</li><li>`fetch_data.py` takes only fixed SHA-256 snapshots; ADR 0005 covers public-sector lists only.</li><li>Outbound client: 1 MiB default, no streaming.</li></ul> |
| **Device handoff** (QR, email) | <ul><li>One-time links (`ovo_`, revoke older unused, 30/min redeem limit), resume sessions, the fragment link format (`flow-url.ts`).</li><li>`qrcode@1.5.4`, **dashboard server only** (`apps/dashboard/src/lib/qr.ts`).</li><li>The `Mailer` port (SMTP, Mailpit) used by invitations and email OTP.</li></ul> | <ul><li>No handoff token, step, route or QR in the flow; no scan on Android.</li><li>PLAN says QR only (`:408`).</li></ul> |
| **Lists** (13 kinds) and list matching | <ul><li>Per-environment HMAC indexes for ID numbers, OTP destinations, crypto addresses, chip data (`blind-index.ts`).</li><li>C58 exact matchers for phones, emails, ID numbers and the name library (`packages/checks/src/matching/`).</li><li>Template allow/deny email-domain lists (≤500) and `allowed-countries`.</li><li>`id_compromised_detection` accepts `compromisedList` (`government-id/inputs.ts:136-137`) — **never supplied** by the API.</li></ul> | <ul><li>No list, list-item or importer table, route, scope, event or page.</li><li>The surface has 11 list-item types and 6 importers; PLAN says 13 (adds face, selfie background).</li><li>No gallery outside inquiries for face lists (`face_templates.source` is `'selfie'` only).</li></ul> |
| **CSV importers** | <ul><li>Multipart uploads on the flow API only (one file, 10 MiB, magic-byte typed); Idempotency-Key fingerprints buffered multipart.</li></ul> | <ul><li>No CSV parser or writer dependency, no formula-injection neutraliser, no export, no server upload route; `files.verification_id` is NOT NULL.</li></ul> |
| **Graph** | <ul><li>Manual `account_relations` (directed, typed) and consolidation.</li><li>Repeat checks that look up shared values at run time (ID index or pHash, face scan, background HNSW, chip indexes).</li></ul> | <ul><li>No edge table, no `WITH RECURSIVE`, no graph query resource, no Cytoscape or any graph/chart library, no bulk actions, no row selection, no tab primitive.</li></ul> |
| **Transactions** | <ul><li>Account types' `fields-schema` with 4 types and additive-only changes (`account-types.ts:17,96-117`).</li><li>Tags (≤50, events per resource).</li><li>6A's report contract reserves `transaction: { data: null }` "until Phase 7" (`reports.ts:318-319`).</li></ul> | <ul><li>No transaction or transaction-type resource; no 9-type field schema (`file`, `float`/`int`, `hash`, `choices`, `array`); no custom statuses; no labels; no `redact-biometrics`.</li></ul> |
| **Events and webhooks** | <ul><li>`EventSubject` with `report` (6A); the DB name check allows `graph-query.completed`, `transaction-type.deleted-field`, one `/` subtype.</li></ul> | <ul><li>No list, graph, transaction, device or signal event; filters know only templates and account types.</li><li>The surface lacks `graph-query.submitted` and `transaction-type.converted-field`.</li></ul> |
| **RBAC and limits** | <ul><li>28 API scopes incl. 6A's report scopes; viewers get every `:read`; the dashboard's typed `PERMISSION_INFO`; rate limits `api`, `flow-session`, `flow-ip`, `one-time-link-redeem`, `reports`.</li></ul> | <ul><li>No scope, area or limit for lists, importers, graph, transactions or devices.</li></ul> |
| **Phase 6 reuse** | <ul><li>6A Stage 1a: report contracts, core registry and matching constants, `packages/watchlist` record and hashes, the rigour data pin, node methods, ADR 0005.</li><li>C58 matching (Phase 5).</li></ul> | <ul><li>6A's matcher, parsers, sync, tables, `pg_trgm`, C83 provider kinds, C85 streaming client and report API are **not committed** at HEAD (stubs only).</li></ul> |

**Cross-cutting blockers** (detail in §18):
1. Signals have no home: every check needs one of 11 verification types, and the session holds only first-call IP and UA.
2. IP, UA and device data are sealed with no index; blind indexes are per environment; CIDR lists cannot be HMACs.
3. Changing network data fits neither `fetch_data.py` (fixed hash) nor ADR 0005 (public-sector lists), and the outbound client caps bodies at 1 MiB without streaming.
4. The flow lacks `worker-src`, serving-layer headers, a bundle budget and a signal consent key; only hosted mode exists.
5. No handoff token or QR in the flow; no session cap; QR is dashboard-only.
6. No list, CSV, graph-edge, bulk-action or transaction machinery; 4 field types vs 9; the report contract's null `transaction` is a 6A contract to amend.
7. Face lists need an inquiry-free gallery; Phase 4 left the ANN question to Phase 7.
8. The migration number follows 6A (journal ends at 0019, which C73.1 still expects to take); PGlite migrations already time out under load.
9. Records: PLAN (13 list types, 9 field types, `packages/signals`, FingerprintJS v3, QR only, Android signals in Phase 10), `THIRD_PARTY_LICENSES.md` IP-data rows, the surface's 11 list types, and `CLAUDE.md:38`.

---

## 1. Identifiers

- **Format** (C1): `<prefix>_<ULID>`, 26 Crockford base32 characters, time-sortable (`packages/contracts/src/ids.ts:1-7,54-59`).
  - `isIdPrefix` (`:88`), `newId(prefix)` (`:158-161`, throws for an unknown prefix), `isId` (`:168-171`), `idSchema(prefix)` (`:178-181`).
  - `anyIdSchema` builds its alternation from every prefix (`:184-186`), so `filter[object-id]` on the events list accepts a new prefix automatically. Because `_` follows the prefix, `txn` and `txntp` (or `lst` and `li`) can coexist in the alternation.
  - Both tables require **lowercase letters only**: `ids.test.ts:64-70` (contracts) and `packages/db/src/ids.test.ts:16-23` (`/^[a-z]+$/`). A prefix with a digit or a hyphen is refused.
- **Contracts `ID_PREFIXES`** (`packages/contracts/src/ids.ts:11-47`, frozen):
  - `org`, `env`, `key`, `usr`, `uss`, `itmpl`, `itmplv`, `inq`, `iqse`, `ver`, `file`, `evt`, `wbh`, `whd` (`:12-25`);
  - Phase 2: `acc`, `acctp`, `role`, `aud` (`userAuditLog`), `alog`, `mfa` (`:26-32`);
  - Phase 4: `self` (`:33-34`); Phase 5: `otpc`, `cwc`, `chc` (`:35-38`);
  - **Phase 6 (6A, C70.1, committed `07c3ae8b`)**: `report: 'rep'`, `reportTemplate: 'rptp'`, `reportTemplateVersion: 'rptpv'`, `reportRun: 'rpr'`, `reportAction: 'ract'`, `reportMatch: 'rpm'` (`:39-46`).
- **DB `ID_PREFIXES`** (`packages/db/src/ids.ts:8-46`) is a separate, unfrozen list. It has `auditLog: 'aud'`, `faceTemplate: 'ftpl'` and `selfieBackground: 'sbg'` (`:26,31-32`), which contracts does not; it carries the same six Phase 6 prefixes (`:38-45`). `idPattern` (`:51`) feeds the `<table>_id_format` checks.
- **Token prefixes** (`packages/contracts/src/tokens.ts:10-18`): `ovs_` (flow session), `ovu_` (dashboard user session), `wbhsec_` (webhook secret), `ovo_` (one-time link), `ovm_` (MFA challenge), `ovi_` (invitation). Each is the prefix plus 32 random bytes in unpadded base64url (43 characters, `:1-5,38-39`). TTLs: session 24 h (`:21`), user session 12 h (`:23`), one-time link default 24 h, 5 min to 30 days (`:28-30`).
- **API key token prefixes** (`packages/contracts/src/api-keys.ts:22-25`): `ov_sbx_` and `ov_prod_`; the shown prefix keeps 4 secret characters (`packages/db/src/api-keys.ts:25`).
- **Prefix availability** (grep of `['"\`]<p>_` and `: '<p>'` over `packages apps android/openverify-sdk/src e2e docs/PLAN.md docs/research/persona-surface.md`, excluding `node_modules`, `dist`, `coverage`, `.next`, `build`):

  | Candidate | Status at `0dec467` |
  |---|---|
  | `iqse` | **taken** (inquiry session, both tables) |
  | `dev`, `net`, `lst`, `li`, `lsti`, `gq`, `gqt`, `txntp`, `txntpv`, `txnl`, `devc`, `dfp` | **free**: in neither prefix table, no token prefix, no fixture |
  | `txn` | **free** in both tables, but already **used as a literal** in one test: `packages/contracts/src/reports.test.ts:116` builds `{ type: 'transaction', id: 'txn_01M5…' }` to prove the report schema refuses a non-null `transaction` relationship |
  | `ovh` (handoff token) | **free**: no token constant, no literal `ovh_` anywhere |
  | `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `rpm` | **taken** by 6A (C70.1) in both tables |
  | `scrre`, `scatr` | still free (deferred by Phase 6 C88, `docs/plans/phase-6.plan.md:577`) |

- **Tests that pin the lists:** contracts `ids.test.ts:27-62` (`toEqual` the whole map, so a new prefix must be added there too); DB `ids.test.ts:5-14` (`toMatchObject`, Phase 6 only); `packages/db/src/schema.test.ts:88-103` (`prefixedTables`, the 14 Phase 1 tables only) and `:106-120` (`tenantTables`).
- **Redaction subject prefixes:** `REDACTION_SUBJECT_ID_PREFIXES = ['inq','ver','iqse','acc','self']` (`packages/db/src/repositories/subject-ids.ts:17-24`). Phase 6 C73.5 plans to add `rep` (`docs/plans/phase-6.plan.md:277`); not done at HEAD. A Phase 7 id (device, list item, transaction) is not scanned in API logs or idempotency copies until added.
- **Install-wide (no `environment_id`) tables already exist** since 5B: `trust_anchor_sources` (text id from the manifest), `trust_anchors` (sha256 key), `trust_anchor_memberships`, `trust_crls`, `trust_anchor_syncs` (bigint identity) (`packages/db/src/tables/trust-anchors.ts:30,47,77,107,135`). None uses a C1 prefix. Phase 6 plans more (`watchlist_sources`, `watchlist_syncs`, `watchlist_entries`, …, C73.3, `docs/plans/phase-6.plan.md:268-275`); none exists at HEAD.

## 2. Inquiry sessions (C10)

**Contract** (`packages/contracts/src/inquiry-sessions.ts`)
- Statuses `active`, `expired`, `canceled` (`:22-24`).
- `ipAddressSchema = z.string().min(1).max(64)` (IPv4, IPv6 or IPv4-mapped IPv6, `:26-27`); `userAgentSchema = z.string().max(1024)` (`:28`).
- Attributes (strict, `:30-51`): `status`, `created-at`, `started-at` (the first successful flow call; null until then), `expires-at`, `ip-address` (nullable), `user-agent` (nullable), and `consent` (`accepted-at`, `text-keys` ≤20, `optional-text-keys` ≤20, `locale` ≤35; nullable and optional; **never the client address**, C42.3/C47).
- Relationship: `inquiry` only (`:53-58`). **No device, network, geolocation, threat, handoff or fingerprint attribute exists.**
- Queries: `filter[inquiry-id]`, `filter[status]` (`:65-68`). Actions: `POST /inquiry-sessions/:id/expire` (empty body, `:71`), `POST /inquiry-sessions/expire-all` with `{ meta: { 'inquiry-id' } }` answering `{ meta: { 'expired-count' } }` (`:74-81`).
- Builder `buildInquirySessionResource` (`:113-140`) validates its output.

**Table** `inquiry_sessions` (`packages/db/src/tables/inquiries.ts:207-259`)
- Columns: `id` (`iqse`), `environment_id`, `inquiry_id`, `token_hash` (SHA-256 only, unique, hex check), `expires_at`, `revoked_at`, `status` (default `active`), `started_at`, `expired_at`, `canceled_at`, `ip` and `user_agent` (`sealedColumn`, **row AAD** `inquiry_sessions.ip#<id>` / `inquiry_sessions.user_agent#<id>`), `consent` (jsonb), timestamps.
- Composite FK `(environment_id, inquiry_id)` → inquiries, `ON DELETE CASCADE` (`:229-233`); indexes on `(environment_id, inquiry_id)`, `(environment_id, created_at desc nulls first, id desc nulls first)` and the partial `inquiry_sessions_active_expires_at_idx` `WHERE status = 'active'` for the expiry sweep (`:234-247`).
- `consent` is a custom jsonb type `{ accepted_at, text_keys, optional_text_keys?, locale, ip, user_agent }` in which **only `ip` and `user_agent` are encrypted**, with the **static** contexts `inquiry_sessions.consent.ip` and `inquiry_sessions.consent.user_agent` (`:130-197`). The rest stays queryable.
- `ENCRYPTED_COLUMNS` rows: `inquiry_sessions.consent` (static), `.ip` (row), `.user_agent` (row) (`packages/db/src/encrypted-columns.ts:48-50`); `SEALED.inquirySessionIp`, `SEALED.inquirySessionUserAgent` (`:74-75`).

**One-time links** (`one_time_links`, `tables/inquiries.ts:261-294`): bigint identity id (no C1 prefix), `token_hash` (SHA-256, unique), `expires_at`, `used_at`, `revoked_at`; check `used_at IS NULL OR revoked_at IS NULL`; index on `expires_at` for C16 retention.
- **Generating one revokes the inquiry's older unused links**: `createOneTimeLink` calls `revokeLinks` in the same transaction and returns `revokedCount` (`packages/db/src/repositories/one-time-links.ts:16-19,32-55,94-116`); route `POST /inquiries/:id/generate-one-time-link`, body `optionalBody(generateOneTimeLinkBodySchema)` with `meta.expires-in-seconds`, answers `cache-control: no-store` (`apps/api/src/routes/server/inquiries.ts:337-365`); service header `apps/api/src/services/one-time-links.ts:1-46`.
- Redemption: `POST /flow/one-time-links/redeem` (no auth; one generic 401 for every failure; rate limited per client IP by `one-time-link-redeem`) (`services/one-time-links.ts:5-9`; route `routes/flow/index.ts:191-212`).
- **Resume does not revoke anything.** `resumeInquiry` (`apps/api/src/services/inquiries.ts:503-548`) creates a new `iqse` session under the inquiry row lock, valid `session-expiration-seconds` (default 24 h, `packages/contracts/src/template-settings.ts:20,37`), audited `inquiry.resumed`, and returns `meta: { 'session-token', 'flow-url' }`. Earlier sessions stay active.
- **No session cap exists.** A grep for `session_limit`, `too_many_sessions`, `max.?active.?sessions`, `SESSION_CAP`, `MAX_INQUIRY_SESSIONS` and "25 sessions" over `packages apps docs/plans docs/research/persona-surface.md` finds nothing; neither resume nor redemption counts sessions.

**Flow links** (`packages/contracts/src/flow-url.ts:1-8,61-71`): `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&session-token=ovs_…` or `…&one-time-token=ovo_…`. Credentials travel in the fragment only; the flow reads and clears it.

**How IP and user agent are captured**
- **Session start:** the flow-session auth plugin, on the first call of an `active` session with `started_at` null, calls `recordSessionStart(options, session, { ip: request.ip, userAgent: request.headers['user-agent'] })` (`apps/api/src/auth/flow-session.ts:17-18,150-153`). `recordSessionStart` truncates the IP to 64 and the user agent to 512 characters (`apps/api/src/services/inquiry-sessions.ts:40-43,138-158`), and `markInquirySessionStarted` seals both for the row, `WHERE started_at IS NULL`, so only the first call wins and `inquiry-session.started` is staged once (`packages/db/src/repositories/inquiry-sessions.ts:255-277`).
- **Consent:** `POST /flow/consent` passes `{ ip: request.ip, userAgent: request.headers['user-agent'] }` (`routes/flow/index.ts:229-251`) to `recordConsent` (`apps/api/src/services/flow.ts:229-270`), which stores both inside the consent jsonb (user agent cut to 512).
- Other `request.ip` readers: OTP send and check (`routes/flow/otp.ts:65,101`), the `flow-ip` rate limit (`plugins/rate-limit.ts:158`), audit entries (`routes/server/inquiries.ts:85-86`, `routes/server/webhooks.ts:61-62`), and the dashboard BFF path, which reads `x-openverify-client-ip` only with the BFF token (`apps/api/src/operator-auth/client-address.ts:1-45`).
- **Fastify `trustProxy`** (C15): env `OPENVERIFY_TRUST_PROXY`, default `false` (`apps/api/src/config.ts:71-74,256,597`). `trustProxySchema` accepts `false`, `true`, a hop count ≤100 (0 means false) or a comma-separated list of addresses and CIDR ranges (`apps/api/src/operator-auth/settings.ts:47,49,67-91`). Fastify 5 ignores a numeric `trustProxy`, so `fastifyTrustProxy` turns a hop count into `(address, hop) => hop < hops` (`:93-108`); passed to `Fastify({ trustProxy })` at `apps/api/src/app.ts:112`. With `false`, `request.ip` is the socket peer (and with an SMS sender bound the server warns, `apps/api/src/server.ts:43-48`).
- **No other client data** (headers, `Accept-Language`, client hints, TLS facts, geolocation) is recorded for a session.

**Masking without `pii:view`** (`apps/api/src/auth/pii.ts`)
- `MASKED_ATTRIBUTES` = `fields`, `note`, `ip-address`, `user-agent`, the government-ID extraction attributes and `PII_VERIFICATION_ATTRIBUTES` (`:26-35`); `PiiMask.ipAddress` / `.userAgent` (`:56-59`). Masking is by attribute name on any resource (`:91-102`). `canViewPii`: API keys unless minted masked; users need `pii:view` (`:41-45`).
- Stored API logs null `note`, `ip-address`, `user-agent`, `phone-number`, `email-address` at any depth (`MASKED_MEMBERS`, `apps/api/src/services/api-logs.ts:206`).
- `PII_REPORT_ATTRIBUTES` exists in contracts (`packages/contracts/src/reports.ts:989`) but is **not yet in `MASKED_ATTRIBUTES`** at HEAD.

**Expiry and cancellation**
- The expiry sweep takes overdue active sessions `FOR UPDATE SKIP LOCKED` (`listOverdueInquirySessions`, `repositories/inquiry-sessions.ts:359-382`; caller `apps/api/src/jobs/inquiry-expiry.ts:118`).
- Leaving `created`/`pending` cancels active sessions and revokes unused links inside `transitionInquiryInTx` (`apps/api/src/services/inquiries.ts:565-572,596`).
- A session canceled because its inquiry finished still answers `GET` for 15 minutes (`FINISHED_INQUIRY_READ_GRACE_SECONDS`, `apps/api/src/auth/flow-session.ts:13-16,41`).
- Events: `inquiry-session.started`, `.expired`, `.canceled` (`packages/contracts/src/event-names.ts:34-38`).

**Consent record (C42.3, C47) and optional keys**
- Flow-spec consent step: `textKeys` (≥1), `optionalTextKeys` (unique, ≤20, none also required), `required` (`packages/flow-spec/src/flow.ts:152-172`).
- `recordConsent` refuses a body missing a required key or naming a key the pinned step does not list (`apps/api/src/services/flow.ts:215-227,245-256`).
- The only optional key with behaviour is **`consent.biometric-matching`** (`MATCHING_CONSENT_TEXT_KEY`, `apps/api/src/services/inquiry-templates.ts:65`). Publish rule: `selfie_repeat_detection`, `selfie_account_comparison` and `selfie_similar_background_detection` may be **required** only when the key is a **required** text (`MATCHING_CONSENT_CHECKS`, `matchingConsentProblems`, `:67-96`). At run time `matchingConsentHolds` reads the latest consent across the inquiry's sessions (`getLatestInquiryConsent`, `repositories/inquiry-sessions.ts:111-131`) and needs the key listed by the step and accepted (`apps/api/src/jobs/selfie.ts:140-166`); callers `jobs/selfie.ts:601-710`, `jobs/types/selfie.ts:90`, `jobs/face-index-rebuild.ts:93`.
- **No consent key for device, network, behavioural or fingerprint signals exists** (grep `consent\.` in `packages/flow-spec/src`, `apps/api/src`).

**Existing device data that is not a session attribute**
- `selfie_captures.device` (sealed, row AAD; `encrypted-columns.ts:53`): the C40.4 snapshot `label`, `settings` (width, height, frame-rate, facing-mode, resize-mode), `capabilities`, `frame-stats`, **`webdriver`** and `image-mirrored` (`packages/contracts/src/selfie-captures.ts:241-296`), sent only with a selfie submit.
- `chip_challenges.device_report` (sealed, `encrypted-columns.ts:33`): the NFC device report.

## 3. The flow app (`apps/flow`) and the flow API

**Package** (`apps/flow/package.json`): runtime dependencies `@openverify/contracts`, `@openverify/flow-spec`, `@openverify/ui`, `i18next`, `libphonenumber-js` (catalog), `onnxruntime-web@1.30.0`, `react`, `react-dom`, `react-i18next`, `react-router@^8.4.0`, `zod`. **No QR library, no fingerprint library, no signal collector.** `packages/signals`, `packages/sdk-js`, `packages/sdk-react` and `apps/demo-web` do not exist (`ls`).

**Boot** (`apps/flow/src/main.tsx:1-39`)
1. `./security/csp-safe-zod` is imported first and sets `z.config({ jitless: true })`, because the CSP has no `unsafe-eval` (`apps/flow/src/security/csp-safe-zod.ts:1-11`).
2. `bootstrapSession` reads the fragment, then clears it from the address bar and history (`apps/flow/src/session/session-bootstrap.ts:1-10`):
   - a session link `#inquiry-id=…&session-token=ovs_…`: the credentials go to this tab's `sessionStorage` key `openverify.flow.session`, so a reload resumes (`:19-20`);
   - a one-time link `#inquiry-id=…&one-time-token=ovo_…`: redeemed for a session token held **in memory only**; the secret-free marker `openverify.flow.one-time-link` explains a reload (`:22-23`).
3. Language: `?lang=` wins over `navigator.languages` (`main.tsx:25-28`). The languages are not sent to the API.
4. `FlowRoutes` (`apps/flow/src/routes.tsx:16-74`): one index route rendering `FlowRenderer` (ready), `OneTimeLinkFlow` (redeem first) or `LinkError`, plus a not-found route. The step on screen comes from `GET /flow/session`, never from the URL (ADR 0003). BrowserRouter when hosted; MemoryRouter "later when embedded or inline" (`:62-63`).

**Hosted, embedded and inline modes**
- Only **hosted** exists. A grep for `postMessage`, `embedded`, `iframe`, `window.parent` in `apps/flow/src` finds only the two comments `routes.tsx:63` and `flow/flow-environment.tsx:3`. There is no `@openverify/js` SDK, no origin-checked `postMessage`, and no frame-domain allowlist (none in `packages/contracts/src/environments.ts` or `packages/db/src/tables/tenancy.ts`).

**Steps** (`packages/flow-spec/src/flow.ts`): `consent` (`:156`), `form` (`:178`), `government_id` (`:202`), `selfie` (`:216`), `document` (`:234`), `phone_otp` (`:250`), `email_otp` (`:266`), `database` (`:307`), `aamva` (`:349`), `nfc` (`:358`), `crypto_wallet` (`:371`), `database_business` (`:382`), `business_website` (`:392`), `completion` (`:400`), `failure` (`:408`). Form field types: `text`, `date`, `email`, `phone`, `select`, `country` (`:79-137`). The flow top level is a strict `{ metadata, steps, transitions }` (`:460-465`); transitions carry an opaque JSONLogic `condition` (`:455-457`). **No handoff step and no device or signal step.**

**Flow API** (C3, `/api/v1/flow`, `apps/api/src/routes/flow/index.ts`)
- Routes: `POST /one-time-links/redeem` (`:191`), `GET /session` (`:213`), `POST /consent` (`:229`), `POST /verifications` (`:253`), `POST /verifications/:id/files` (`:278`), `POST /verifications/:id/submit` (`:326`), `POST /verifications/:id/selfies` (`:363`), `GET /verifications/:id` (`:399`); plus `routes/flow/otp.ts:33,72`, `routes/flow/inputs.ts:37`, `routes/flow/crypto-wallet.ts:21`, `routes/flow/government-id-nfc.ts:21`.
- The plugin (`:160-188`) marks every non-OPTIONS route `auth: 'session-token'`, registers `@fastify/cors` with `origin: deps.flowCorsOrigins` (env `OPENVERIFY_FLOW_CORS_ORIGINS`, `apps/api/src/config.ts:93-94,271,601`), `methods: ['GET','POST']`, `allowedHeaders: ['authorization','content-type','x-request-id']`, `maxAge: 600`; registers multipart with `UPLOAD_LIMITS`; registers `flowSessionAuth`; and sets `cache-control: no-store` on every response.
- `GET /flow/session` answers `{ inquiry, flow, verifications, consent, environment?, 'face-template-retention-days'? }`; the first call moves the inquiry `created → pending` (`packages/contracts/src/flow-api.ts:31-48`).
- Rate limits: `flow-session` 120/min per session token, `flow-ip` 600/min per client IP, `one-time-link-redeem` 30/min per IP (`packages/contracts/src/rate-limits.ts:8-32`).

**CSP and security headers**
- Flow: a production-build-only `<meta http-equiv="Content-Security-Policy">` (`apps/flow/src/security/security-meta.ts:19-34,40-53`), exactly:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' <api origin>; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`.
  - **No `worker-src`** (falls back to `script-src`/`default-src` `'self'`, so a `blob:` worker is refused), no `frame-src`, no `style-src` (falls back to `default-src 'self'`).
  - `index.html` adds `<meta name="referrer" content="no-referrer">` (`apps/flow/index.html:5-7`).
  - The file states that `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` "must also be sent by the serving layer" (`security-meta.ts:6-8`). **No serving layer sends them**: compose serves the flow with `vite preview` on 4173 (`infra/docker-compose.yml:385-406`), and `vite.config.ts` sets no `preview.headers` (`apps/flow/vite.config.ts:15-37`). A grep for `frame-ancestors|Permissions-Policy|Referrer-Policy|worker-src|X-Frame-Options|Cross-Origin-` over `infra apps/flow apps/api/src` finds only the comment.
- Dashboard (`apps/dashboard/next.config.ts:7-15,59`), on every path: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`. **No script CSP** ("needs per-request nonces and is left for a later phase", `:3-6`), so no `worker-src`, `connect-src` or `blob:` rule exists.

**Bundle-size budgets:** **none.** A grep for `size-limit`, `bundle.?size`, `budget`, `chunkSizeWarningLimit`, `maxSize` over `apps/flow`, `apps/dashboard/{package.json,next.config.ts}`, `.github/workflows/ci.yml`, `package.json` and `infra/tests` finds only the vision CI timing budgets (`.github/workflows/ci.yml:196-209`, logged, never gated). The only code split is the lazy `import('onnxruntime-web/wasm')` of the face guidance (`apps/flow/src/flow/flow-environment.tsx:53`), whose model and WASM files are copied and SHA-256-checked by `guidanceAssetsPlugin` (`vite.config.ts:24-25`).

**QR codes:** `qrcode@1.5.4` (MIT) and `@types/qrcode@1.5.6` are dependencies of **`apps/dashboard` only** (`apps/dashboard/package.json:22,36`), used in `apps/dashboard/src/lib/qr.ts:1-29` (`import 'server-only'`; modules drawn as one SVG path, error correction `M`) for TOTP enrolment (`app/actions/account-security.ts:23`, `lib/mfa-enrolment.ts:9`). The flow has no QR encoder or scanner.

**Existing client-side device or browser collection** (grep for `userAgentData`, `hardwareConcurrency`, `deviceMemory`, `screen.width`, `getTimezoneOffset`, `toDataURL`, `WebGL`, `navigator.plugins`, `maxTouchPoints`, `devicePixelRatio`, `geolocation`, `keydown`, `visibilitychange` in `apps/flow/src`: nothing):
- Only the **selfie device snapshot** (`apps/flow/src/selfie/device-snapshot.ts:1-5,122-135`): camera label (sanitised), track settings, capabilities, frame stats and `webdriver: navigator.webdriver === true`, sent with a selfie submit (`flowSubmitCaptureSchema.device`, `packages/contracts/src/selfie-captures.ts:298-302`). It is a client claim; the server records it sealed (`selfie_captures.device`) and `selfie_liveness_detection` fails integrity on `webdriver` or a file-path label outside sandbox (`packages/checks/src/selfie/selfie-liveness-detection.ts:66-71,141-160`).
- `client-elapsed-ms` (0–600,000) on selfie uploads (`packages/contracts/src/selfie-captures.ts:230-239`).
- Nothing about typing, paste, focus, hesitation, automation beyond `webdriver`, or CDP artefacts.

## 4. Data at rest

**Envelope** (`packages/db/src/crypto.ts:1-35`)
- Per value: a random 256-bit DEK; AES-256-GCM under the DEK; the DEK AES-256-GCM-wrapped under the KEK; fresh 96-bit IVs.
- Text format `ov1.<kid>.<wrapped DEK>.<payload>`: `kid` is HKDF-derived from the KEK; the wrapped DEK's AAD is `ov1.<kid>`; the payload's AAD is the version plus the caller's `context`, **without** the kid, so `rewrap` re-wraps the DEK without touching the payload.
- Files (`encryptBytes`): the wrapped DEK goes in the row, the IV‖ciphertext‖tag is the storage object, AAD `ov1-bytes:<context>` with the file id as context.
- Ciphertexts are randomised: "encrypted columns cannot be indexed or compared for equality; use a separate keyed blind index" (`:31-34`).
- Keys: `OPENVERIFY_KEK` and `OPENVERIFY_KEK_PREVIOUS` (`:40-42`); `createKeyring`, `keyringFromEnv` (`:102,133`); `encrypt`/`decrypt`/`needsRewrap`/`rewrap` (`:257-288`); Phase 1 column types `encrypted()` and `encryptedJson()` with a **static** context (`:402,416`); `OTP_KEY_HKDF_INFO = 'openverify/otp/v1'` and `otpKey` (`:426-433`).

**Row-bound sealing** (`packages/db/src/sealed.ts`)
- AAD `<table>.<column>#<row id>` (`rowContext`, `:27`); columns are plain `text` typed `Sealed` (`sealedColumn`, `:24`). Repositories seal on write and open on read with the row id (`sealValue`, `openValue`, `sealJson`, `openJson`, `sealOptional`, `openOptional`, `sealOptionalJson`, `openOptionalJson`, `:30-89`).
- `ENCRYPTED_COLUMNS` (`packages/db/src/encrypted-columns.ts:22-58`, 35 entries over 20 tables) lists each column with its AAD kind `static`, `row` or `file`. `SEALED` (`:61-93`) names the row AADs. `schema-v2.test.ts` pins the set (`:1-3`).
- The `encrypted` helper named in `CLAUDE.md:95` is `encrypted()` / `encryptedJson()` for static columns and `sealedColumn` + `sealValue` for row-bound ones.

**Blind indexes** (`packages/db/src/blind-index.ts`, 253 lines)
- Key `OPENVERIFY_BLIND_INDEX_KEY` (32 bytes, a separate secret from the KEK, `:24-27,40-56`).
- **Per-environment subkey** `HMAC-SHA-256(key, "openverify/blind-index/v1|<environment id>")` (`ENVIRONMENT_SUBKEY_LABEL`, `:120-131`). The same value in two environments gives unrelated indexes, by design (`:11-15`, Workflow 3B G003).
- Labels and functions today:
  - identification numbers (C31.8): no label constant; input `"<issuer>|<class group>|<number>"`, number upper-cased to `[A-Z0-9]` (`identificationNumberIndex`, `:139-155`; `normalizeIdentificationNumber`, `:68`); column `government_id_extractions.identification_number_index` (`tables/government-id-extractions.ts:46`);
  - `OTP_DESTINATION_INDEX_LABEL = 'openverify/otp-destination/v1'` (`:157`), input `<label>|<channel>|<destination>` (`:174-181`); column `otp_challenges.destination_index` (`tables/otp.ts:60,94-95`);
  - `CRYPTO_ADDRESS_INDEX_LABEL = 'openverify/crypto-address/v1'` (`:159`, `:198-203`); column `crypto_challenges.address_index` (`tables/crypto-challenges.ts:35`);
  - `CHIP_SOD_INDEX_LABEL = 'openverify/chip-sod/v1'` and `CHIP_DOCUMENT_NUMBER_INDEX_LABEL = 'openverify/chip-document-number/v1'` (`:208-253`); columns `chip_reads.sod_signature_index`, `.document_number_index` (`tables/chip.ts:104-106`).
  - Phase 6 plans `openverify/report-crypto-address/v1`, `openverify/report-match-entry/v1` and `openverify/report-match-evidence/v1` (C73.2, C73.4, `docs/plans/phase-6.plan.md:263,267,276`); **none is in `blind-index.ts` at HEAD.**
- **How a label is added** (the Phase 5 pattern): a `*_INDEX_LABEL` constant and a function hashing `<label>|<parts>` under `environmentSubkey`, exported from `@openverify/db`; a nullable `text` column with an `(environment_id, <index>)` index; a `rebuild…Indexes` repository function; its call in `apps/api/scripts/blind-index-rebuild.ts` (which imports `rebuildChipReadIndexes`, `rebuildCryptoAddressIndexes`, `rebuildIdentificationNumberIndexes`, `rebuildOtpDestinationIndexes`, `:1-30`); and a redaction rule that nulls it.
- **Not a blind index:** `government_id_extractions.front_phash` is a plaintext 64-bit perceptual hash with eight generated byte bands and a partial index per band for the C34 pigeonhole lookup (`tables/government-id-extractions.ts:25-71,91,110-113`).

**KEK rotation** (`pnpm --filter @openverify/api kek:rewrap [--dry-run] [--batch-size] [--state-file] [--restart]`, `apps/api/scripts/kek-rewrap.ts:1-20`)
- `REWRAP_TABLES` (`packages/db/src/repositories/key-rotation.ts:18-39`, 20 tables): `accounts`, `api_logs`, `audit_logs`, `business_registry_records`, `chip_challenges`, `chip_reads`, `crypto_challenges`, `document_extractions`, `events`, `face_templates`, `files`, `government_id_extractions`, `idempotency_keys`, `inquiries`, `inquiry_sessions`, `mfa_factors`, `otp_challenges`, `selfie_captures`, `verification_inputs`, `webhooks`.
- Columns per table come from `ENCRYPTED_COLUMNS` (`:66-80`); kinds `envelope`, `wrapped_dek` (files) and `consent` (the jsonb with two sealed members). `BIGINT_IDS = {audit_logs, idempotency_keys}` (`:53`); `ID_COLUMNS` maps the five tables keyed by `verification_id` (`:59-66`).
- Batches by primary key, conditional on the ciphertext being unchanged, with `openverify.kek_rewrap` set locally so `updated_at` is kept and append-only tables accept the rewrite (`:1-10`). Output is counts only.
- **A new sealed table joins** by: its `ENCRYPTED_COLUMNS` rows, `SEALED` names, the `schema-v2.test.ts` list, a `REWRAP_TABLES` entry (and `ID_COLUMNS` / `BIGINT_IDS` if its key is not a C1 `id`), and a `kek:rewrap` test.

**Redaction** (C16)
- Header table (`packages/db/src/repositories/redaction.ts:1-30`): `inquiries`, `accounts`, `inquiry_sessions` (`ip`, `user_agent` and the consent's `ip`, `user_agent` → null), `verification_checks`, `government_id_extractions`, `files`, `selfie_captures` (`device` → null), `verification_inputs`, `otp_challenges`, `otp_verification_states`, `crypto_challenges`, `document_extractions`, `chip_challenges`, `chip_reads`, `business_registry_records`, `trust_*` (nothing: install-wide, never about a subject), `face_templates` (deleted), `selfie_backgrounds` (deleted), `events` (stubbed), `api_logs`, `idempotency_keys`.
- `redactInquiryRecords` (`:184-…`) calls one `redact<Table>` helper per verification child table (`:249-258`), builds `objectIds = [inquiryId, ...verificationIds, …sessions, …captures]` (`:285-289`), then `stubEventPayloads` (`:98-…`, `:291`) and `forgetStoredResponses` (`:292`). `redactAccountRecords` (`:307-…`) stubs `[accountId]` (`:335`).
- **How a new table joins redaction:** a header row; a `redact<Table>` helper in its own repository (the Phase 5 pattern) called from `redactInquiryRecords` or `redactAccountRecords`; its ids in `objectIds` if events carry it; its prefix in `REDACTION_SUBJECT_ID_PREFIXES` (`repositories/subject-ids.ts:17-24`) if API logs or idempotency copies name it; `SUBJECT_PII_TABLES` (`apps/api/src/services/redaction.test-support.ts:51-71`, 19 tables) or `OPERATOR_PII_TABLES = ['audit_logs','mfa_factors','webhooks']` (`:74`), with a seeded row in `seedPiiSubject`. The coverage test fails when an `ENCRYPTED_COLUMNS` table is in neither list (`apps/api/src/services/redaction.test.ts:158-171`; `verification_checks` and `selfie_backgrounds` are the two listed subject tables with no sealed column).

**Retention** (C16; `pnpm --filter @openverify/api retention:run [--now=] [--json]`)
- Steps (`apps/api/src/services/retention.ts:1-22`): redact terminal inquiries past `settings.retention-days` or `inquiry-retention-days`; purge storage objects; delete API logs, finished deliveries, events, idempotency keys; delete user sessions and one-time links 30 days past expiry and expired auth challenges; delete face templates and backgrounds past `face-template-retention-days`. Inquiry sessions are kept with their inquiry (redaction clears them).
- `DEFAULT_RETENTION` (`packages/db/src/repositories/retention.ts:36-41`): inquiries `null` (forever), API logs 30, webhook deliveries 30, events 90 days. `DEFAULT_FACE_TEMPLATE_SETTINGS`: 365 days, 50,000 templates per search (`:49-53`).
- Settings live in `environments.settings` jsonb, typed `EnvironmentSettings` (`packages/db/src/tables/tenancy.ts:37-53`: `inquiry-retention-days`, `api-log-retention-days`, `webhook-delivery-retention-days`, `event-retention-days`, `face-template-retention-days`, `face-search-max-templates`, `otp-sms-max-per-hour`).
- Selectors and deleters (`repositories/retention.ts:128-320`) take rows `FOR UPDATE SKIP LOCKED` in batches (500 by default), called through `drain` in `runRetention` (`services/retention.ts:175-208`), which reports counts (`RetentionReport`, `:54-79`).
- **How a new table joins retention:** a setting key in `EnvironmentSettings` and a `resolve…` default (if it has its own window), a `deleteExpired<Table>` or `list<Table>DueForRetention` in `repositories/retention.ts`, a `drain(...)` call and a counter in `RetentionReport`, and the contracts/dashboard settings plumbing (§13 of `phase6-inventory.md`, the `face-search-max-templates` precedent). Phase 6 C73.6 plans `report-retention-days` this way (`docs/plans/phase-6.plan.md:278`); not built at HEAD.

**PGlite unit tests** load only `vector` (`packages/db/src/testing.ts:3-4,11,56,60`). 6A's planned `PGLITE_EXTENSIONS` with `pg_trgm` (C73.1, `docs/plans/phase-6.plan.md:261`) is not committed at HEAD.

## 5. Faces and biometrics (Phase 4)

**Storage**
- `face_templates` (`ftpl_`, `packages/db/src/tables/selfie.ts:111-152`): `environment_id`, `verification_id`, `inquiry_id`, `source` (`'selfie'` only), `model`, `template` (**sealed**, row AAD `face_templates.template#<id>`: the L2-normalised SFace embedding as base64 float32), `created_at`. Composite FKs to the verification and the inquiry; unique `(environment_id, id)`; indexes `(environment_id, created_at desc, id desc)` and `(environment_id, inquiry_id)`. **No `account_id` column and no pgvector column**: the embedding is never in plaintext in the database.
  - Written only for a **passed selfie with matching consent** (`:111-116`); deleted with its inquiry's redaction, an operator decline, a failed inquiry, and after `face-template-retention-days` (default 365, max 1,095; `tables/tenancy.ts:47-48`, `repositories/retention.ts:49-53`).
  - Codec: `encodeFaceTemplate` / `decodeFaceTemplate` (`packages/db/src/repositories/selfie-captures.ts:462-472`); `createFaceTemplate` (`:474`), `listFaceTemplates` (`:516-545`: newest first, `notInArray(inquiry_id, exclude)`, keyset `before`).
  - The embedding is 128 floats (`EMBEDDING_DIMENSIONS`, `services/vision/src/openverify_vision/schemas.py:18,63`).
- `selfie_backgrounds` (`sbg_`, `tables/selfie.ts:154-200`): `face_template_id` (FK), `layout` **`vector(144)`** (48 cells × mean Lab, `BACKGROUND_LAYOUT_DIMENSIONS`, `:155`) in **plaintext** pgvector, `valid_cells`, `coverage`; HNSW index `selfie_backgrounds_layout_hnsw_idx` with `vector_l2_ops` (`:195`). "Not biometric, but personal data" (`:157-160`).
  - `findNearestSelfieBackgrounds` (`packages/db/src/repositories/face-templates.ts:145-185`): `SET LOCAL hnsw.iterative_scan = strict_order`, `hnsw.ef_search = 100`, `l2Distance`, joined to unredacted inquiries of other accounts, wrapped in `withSensitiveParameters` (`packages/db/src/errors.ts:66-75`, which rethrows a `SensitiveQueryError` without the parameters).
- `selfie_captures` (`self_`) holds the sealed `device` snapshot (§2), not faces.
- The only pgvector columns in the schema are `selfie_backgrounds.layout`; `CREATE EXTENSION IF NOT EXISTS vector` runs in `0001_schema_v1.sql:6` and `0015_selfie_captures_face_templates.sql:2`.

**Thresholds** (`packages/core`)
- `FACE_MATCH_DEFAULTS.threshold = 0.394`, `basis: 'calibrated'` (C49 report, FAR 1e-3 on studio portrait pairs; SFace's published 0.363 gave FAR 2.40e-3; "not measured on selfies against ID card photos") (`packages/core/src/check-config/basis.ts:26-43`). Shared by `selfie_id_comparison`, `selfie_account_comparison`, `id_selfie_comparison`, the face half of `id_inconsistent_repeat_detection` (`'face-threshold'`) and `id_nfc_selfie_comparison` (`packages/core/src/check-config.ts:261,270,443-444`; `check-config/nfc.ts:36,68-69`).
- `selfie_repeat_detection.threshold = 0.5`, **provisional**, "a 1:N threshold above the 1:1 … since false matches grow with the gallery size" (`check-config.ts:445-450`).
- `selfie_similar_background_detection`: `min-orb-inliers` 100, `min-inlier-ratio` 0.5, `window-days` 30, `min-distinct-faces` 3, `min-coverage` 0.25, all provisional (`:451-469`).

**Consent key:** `consent.biometric-matching` (`MATCHING_CONSENT_TEXT_KEY`, `apps/api/src/services/inquiry-templates.ts:65`) gates `selfie_repeat_detection`, `selfie_account_comparison` and `selfie_similar_background_detection` (`MATCHING_CONSENT_CHECKS`, `:67-72`), both at publish (required only when the key is a required text, `:74-96`) and at run time (`matchingConsentHolds`, `apps/api/src/jobs/selfie.ts:140-166`). Without it no template is written (`jobs/selfie.ts:669-710`).

**1:N matching today** (`apps/api/src/jobs/face-search.ts`)
- `scanFaceTemplates` (`:51-…`): decrypts the environment's templates newest first, 1,000 per query (`FACE_SCAN_BATCH_SIZE`, `:13-14`), excluding the current inquiry **and every inquiry of its account**, up to `face-search-max-templates` (default 50,000; 1,000–200,000), scoring the dot product of unit vectors **in process** (`cosineOf`, `:38-48`); reports `searched`, `truncated`, `bestCosine`, `matchCosines` ≥ floor (`:27-36`). "Embeddings are biometric data: compared in memory, never logged or returned" (`:9`).
- `bestTemplateCosine` (the account comparison) and `faceGroups` (distinct faces at the 1:1 threshold for the background check, `:104-125`).
- Benchmark: `pnpm --filter @openverify/api face-scan:benchmark` (`apps/api/package.json:20`). Rebuild after a model change: `face-index:rebuild [--dry-run] [--batch-size]`, re-embedding from the stored centre file and deleting rows whose consent no longer holds (`apps/api/scripts/face-index-rebuild.ts:1-14`).
- **There is no gallery or list of faces outside inquiries** (no operator-uploaded face, no list table, no face importer; the public-figure gallery is a provider adapter, PLAN `:212,233`).

## 6. Phase 6 pieces Phase 7 would reuse

**What 6A has committed at HEAD** (31 commits `92ea5ec7..0dec467`; Stage 1a only):
- Ids `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `rpm` (§1).
- `packages/core`: `REPORT_REGISTRY` with nine `REPORT_TYPES` (`watchlist`, `business-watchlist`, `crypto-address-watchlist`, `politically-exposed-person`, `adverse-media`, `business-adverse-media`, `email-address`, `phone-number`, `address-lookup`) (`packages/core/src/report-registry.ts:1-24,134`); `REPORT_TIERS` R/H/A (`:30`); `REPORT_REVIEW_MODELS` (`:34`); `WATCHLIST_SOURCE_KINDS = ['sanctions','pep']` (`:38`); `REPORT_PROVIDER_KINDS` (C83 names, `:41-49`); `REPORT_EVENT_ACTIONS = ready, errored, matched, dismissed, reviewed, redacted` (`:55-64`); the report and match state machines (`report-state-machine.ts`, `report-match-state-machine.ts`); the C78.4 constants and presets `NAME_MATCHING_PRESETS = exact, strict, tolerant, custom` and `NAME_MATCHING_RULES` (`report-matching.ts:1-31,44-…`); report config defaults (`report-config.ts:150,215`).
- `packages/contracts`: `reports.ts` (with `PII_REPORT_ATTRIBUTES`, `:989`; a `transaction` relationship fixed to `{ data: null }` "until Phase 7 transactions", `:318-319`), `report-templates.ts`, `report-template-config.ts`, `report-queries.ts`, `report-parity.ts`, `report-types.ts`, `inquiry-report-config.ts` (C84.1 `reportConfigSchema`: `on-completion` ≤10 entries of `{ 'report-template-id' (rptp), 'query-source'?: 'inquiry' }`, `on-report-match: none | needs_review`, `:15-50`), `watchlist-sources.ts` (sync outcomes, actors, origins, `:1-30`), report event names in `EVENT_NAMES` with the `report` subject (`event-names.ts:75-79,103,116-149`), the `reports` rate-limit policy (`rate-limits.ts:13-14,31`), and the OpenAPI snapshot.
- `packages/watchlist` (`package.json`: `@openverify/checks`, `@openverify/core`, `any-ascii@0.3.3`, `saxes@6.0.0`, `zod`; export `./testing`): **only `record/` is implemented** — `watchlistRecordSchema`, `watchlistImportSchema`, `WATCHLIST_ENTRY_KINDS`, `IDENTIFIER_KINDS`, `canonicalJson`, `contentHash`, `riskDataHash`, `isHeldOutGroup` (`packages/watchlist/src/record/schema.ts:14-196`, `canonical.ts:27,35`, `hashes.ts:25,56`, `held-out.ts:13-16`). Every other folder (`names`, `translit`, `keys`, `score`, `match`, `crypto`, `reverse-index`, `parsers`, `zip`, `xml`, `diff`, `pep`, `testing`) is a stub exporting `WATCHLIST_<AREA>_AREA`; `keysVersion()` throws "not implemented" (`src/keys/index.ts:17-19`). The entry point re-exports all of them (`src/index.ts:13-25`).
- `packages/checks/src/reports/{email,phone,address,media}/index.ts` stubs (`d1b83baa`); the ICAO 9303 §6.A Latin table exported (`8ff30d94`).
- `data/manifest.json` entry `rigour_person_names` (`data/manifest.json:643-654`).
- `packages/node`: `reports`, `reportTemplates`, `reportTemplateVersions` method groups and `DELETE` in the transport (`31807b13`).
- ADR 0005 (`247ec356`).

**Not committed at HEAD** (grep and `ls`): no report or watchlist table or migration (journal ends at `0019_submitted_verifications_index`, `packages/db/drizzle/meta/_journal.json`); no `watchlists/sources.json`; no `apps/api/src/watchlists/` or report service, route, job or CLI; no `report_config` column (`packages/db/src/tables/inquiry-templates.ts`); no C83 provider kinds in `apps/api/src/providers/index.ts` (`PROVIDER_KINDS` is still government ID + selfie + 5A + 5B, `:68-85`; `PROVIDER_NAMES = ['sandbox','twilio','json-rpc','rdap','feed-list']`, `:108`); no `pg_trgm`; no C85.1 streaming client; no `resolveTxt`.

**As planned** (`docs/plans/phase-6.plan.md`, read in full for C73, C76, C77, C78, C83, C84)
- **C73 storage** (`:259-280`): the migration adds `pg_trgm` and `PGLITE_EXTENSIONS = { vector, pg_trgm }` (`:261`); environment tables `reports`, `report_accounts`, `report_runs`, `report_actions` (append-only trigger with `openverify.kek_rewrap` and `openverify.report_redaction` exceptions), `report_matches` (`:262-267`); **install-wide** `watchlist_sources`, `watchlist_syncs`, `watchlist_entries`, `watchlist_names` (`keys` text[] GIN, `normalised` `gin_trgm_ops`), `watchlist_identifiers (kind, value_normalised)`, `watchlist_crypto_addresses`, `watchlist_key_df` (`:268-275`).
  - **HMAC entry keys (C73.2, C73.4):** `report_matches.entry_index` = HMAC under the environment's blind-index subkey with label `openverify/report-match-entry/v1` over `<source>:<publisher id>`; `evidence_hash` under `openverify/report-match-evidence/v1`; `reports.crypto_address_index` under `openverify/report-crypto-address/v1`. A readable entry key "would join to the public list and name the person the subject resembles", so only `source_id`, `score` and statuses stay plain (`:267,276`). `blind-index:rebuild` recomputes them from sealed values through `rebuildReportIndexes` (`:276`).
  - Redaction nulls every index and snapshot (`:277`); retention by `report-retention-days` through redaction, never deletion (`:278`); lock order accounts → inquiry → report → runs and matches (`:279`); Postgres `log_parameter_max_length=0` because retrieval binds names as parameters (`:280`).
- **C76 source sync pattern** (`:349-382`): a committed manifest `watchlists/sources.json` (per source `id`, `publisher`, `kind`, `urls`, `redirect_host`, `content_types`, `max_bytes`, `timeout_seconds`, `parser`, `change_signal`, `refresh_interval_hours`, `stale_after_hours`, `enabled_by_default`, `sandbox_only`, `terms`, `attribution`; `:351`); an operator CLI `watchlists:sync [--source] [--import <file> --source] [--allow-mass-removal] [--accept-older-publication] [--allow-normalised] [--json]` and a `watchlists-refresh` job only with `OPENVERIFY_WATCHLIST_REFRESH=true`, 15-minute tick, never in CI (`:361`). Per source: a session-level `pg_try_advisory_lock` (`busy` otherwise), the change signal, a download into a 0700 `mkdtemp` directory through the list client (HTTPS, vetted lookup, at most one redirect to the exact `redirect_host`, caps), hash and parse the same descriptor, schema validation (`refused_schema`), `refused_future` beyond +24 h, apply in one transaction under `pg_advisory_xact_lock` + `FOR UPDATE` with `refused_rollback` and the 10% `refused_mass_removal` guard, upsert by `(source_id, entry_id)`, `removed_at`, `watchlist_syncs` row, enqueue `report-rescreen` after commit (`:362-368`). Imports record `origin: import` (`:371`). Staleness counts from `last_checked_at`; sandbox-only sources are never stale (`:373`). `reconcileWatchlistSources` at API, worker and CLI start (`:375`). Removed entries purged after `OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS` (default 90) (`:382`).
- **C77 record and parsers** (`:384-394`): streaming `saxes` XML with `<!DOCTYPE` refused, ≤5 predefined entities, depth ≤64, caps; an own single-member ZIP reader over `node:zlib`; never the publishers' CSVs; a hostile-input test set; diff by `(source_id, entry_id)` and content hash.
- **C78 matcher package API** (`:396-420`): name analysis on C58 plus the ICAO §6.A fold (both folds emitted as keys); ICAO §6.B/§6.C transliteration and `any-ascii` lossy forms; rigour variant groups filtered at build time and baked into the worker image; `keysVersion()`; **retrieval** is one repository function `retrieveCandidates(tx, { environmentKind, sourceIds, keys, identifiers, cryptoAddresses, normalisedName, cap }) → { candidates, truncated }` (frozen in Stage 1b, implemented in `packages/db/src/repositories/watchlists.ts`), keys `t:<token>`, `s:<skeleton>`, `g:<group>`, `j:<pair>` filtered by ≤2% document frequency, `pg_trgm` as the second path, cap 2,000 (`:407`); identifier retrieval by exact `(kind, value_normalised)` (`:408`); the score rules (`:409-416`); coverage `same_script | transliterated | lossy | not_compared` (`:417`); an in-memory reverse index in chunks of ≤50,000 subjects (`:418`); budgets p95 ≤100 ms at 100,000 names (`:419`).
- **C58 (built in Phase 5)**, which the matcher sits on: `packages/checks/src/matching/` exports levels and match groups, limits (`MATCHING_INPUT_LIMITS` name 200, business name 300, address 500), partial dates, `foldText`/`foldedTokens`/`writingSystemsOf`, nicknames, dictionaries, `matchPersonNames`/`matchNameStrings` (`NAME_TOKEN_SIMILARITY = 0.92`), postal codes, addresses, business names, and **exact identifier matchers** `matchPhoneNumbers` (digits; `partial` when ≥7 trailing digits agree), `matchEmailAddresses` (trimmed, lower-cased), `matchIdentificationNumbers` (`[0-9A-Z]` upper-cased) (`packages/checks/src/matching/index.ts:12-22`, `identifiers.ts:1-57`, `limits.ts:7-15`, `names.ts:38,271,351`, `text.ts:63-133`).
- **C83 provider kinds** (`:512-522`): `adverseMedia` (`gdelt-doc`, `sandbox`), `emailIntelligence` (`hibp`, `sandbox`), `phoneIntelligence` (`twilio-lookup`, `sandbox`), `addressVerification` (`smarty`, `sandbox`), `cryptoExposure` (`sandbox`); bound by `OPENVERIFY_PROVIDER_<KIND>_{SANDBOX,PRODUCTION}`, read by the worker; credentials join the secret-scan list; each adapter goes through the outbound client with its own allowlist and cap; a disclosure section per adapter in `docs/reports/`.
- **C84 inquiry and account integration** (`:524-545`): `report-config` on the version (stored in `inquiry_template_versions.report_config` jsonb; publish rule `report_template_not_published`); the hook `createInquiryReportsInTx` inside `transitionInquiryInTx` on `pending → completed` and `failed → approved | needs_review`, creating reports and initial runs in the transaction, **no account lock there**, and an outbox swept every 15 s; query sources per type (government ID extraction, inquiry `fields`, account `fields`, confirmed OTP destinations, the passed crypto wallet, the passed business verification) recorded in `query-sources`; `on-report-match: needs_review` moving a `completed` inquiry through `transitionInquiryInTx`; `report_accounts` links, moved on consolidation.
- **C88 deferred to Phase 7** (`:577`): "custom-list reports (Phase 7 lists)" and "re-screening when a linked account's fields change (… Phase 7 with the account graph)".

**ADR 0005** (`docs/adr/0005-report-honesty-and-live-public-sector-data.md`, read in full)
- §1 (`:18-20`): report types carry R/H/A tiers and a stage in `REPORT_REGISTRY`; only `crypto-address-watchlist` may become `ga`; others `beta` until a calibration report.
- §2 (`:22-34`): no "no match" for a search not made in full (partial runs error `list_unavailable`/`list_stale`/`matcher_data_unavailable`; `has-match` false only beside `ready`; coverage; unknown is never `false`; provenance on every result; freshness from the last successful check; sandbox data never in production; a match never changes an inquiry except through opt-in `on-report-match`).
- §3 **what it allows for live data** (`:36-43`): rule 4 is interpreted "for live public-sector list data as Phase 5 decision 40 interpreted it for the CSCA trust store": **operator-fetched at run time, never committed, shipped, fetched by CI or by a test**; **verified instead of pinned** through a committed manifest (URLs, one redirect host, content types, byte caps, deadline, parser, change signal, intervals, terms, attribution) with HTTPS, the vetted lookup, schema validation, the +24 h, rollback and 10% guards, and `watchlist_syncs` audit; terms per source (OFAC, EU FSF with `OPENVERIFY_EU_FSF_TOKEN`, FCDO UK enabled; UN shipped disabled; OFSI never; OpenSanctions data not used; Wikidata only by the operator's sync with `OPENVERIFY_WIKIDATA_USER_AGENT`; GDELT unbound by default behind `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`); **static matching data still goes through `scripts/fetch_data.py`** pinned by SHA-256.
- §4 enforcement table (`:45-53`), including "`.gitignore` (`data/*`)".
- Scope: the ADR speaks of "sanctions, PEP and media data" and "public-sector" lists (`:3,9,38`). It says nothing about IP-intelligence data (DB-IP, Tor exit list, cloud ranges, VPN ASN lists), which are not public-sector publications.

**Other runtime-fetched-list precedents already built**
- **Malicious-website feeds (C61.5):** `data/malicious-feeds.json` is committed and ships `"feeds": []`, each feed `{ id, url (https), format (domains | urls), category, refresh_interval_seconds (300–604800), terms }` (`data/malicious-feeds.json:1-5`); the `malicious-feed-refresh` repeatable job fetches due feeds every 5 minutes through an outbound client (`text/plain`, `text/csv`, `application/octet-stream`; 32 MiB; 30 s) into **Valkey** keys `malicious-feed:<id>` and `…:entries:<generation>` with TTL `2 × interval + 600 s`; up to 1,000,000 hosts; a failed feed keeps its last list and goes stale; logs never carry the URL (`apps/api/src/jobs/repeatable/feeds.ts:1-9,26-33,128-145`; `apps/api/src/providers/malicious-website/store.ts:26-34,128`). Not pinned, not in the database.
- **CSCA trust store (C62.7):** committed `trust-anchors/manifest.json` pinning each source's root certificate by SHA-256 (`trust-anchors/manifest.json:1-15`); `trust-anchors:sync [--source] [--import --root]` (`apps/api/scripts/trust-anchors-sync.ts:1-10`, wrapper `scripts/fetch_trust_anchors.sh`); apply in one transaction under `pg_advisory_xact_lock(hashtext(<source>))` and `FOR UPDATE` (`packages/db/src/repositories/trust-anchors.ts:225-240`); install-wide tables (§1); `trust-anchor-refresh` repeatable job only with `OPENVERIFY_TRUST_ANCHOR_REFRESH=true` (`apps/api/src/config.ts:139,321`; `jobs/repeatable/index.ts:6-8,55-57`); race tests `apps/api/src/trust-anchors/sync-races.integration.test.ts`.

## 7. Data and model downloads

- **`data/manifest.json`** (`schema_version: 1`, `:1-4`): 50 entries at HEAD — `disposable_email_domains` (CC0-1.0, `:5-17`), 46 libpostal dictionary files (MIT), `opencage_state_codes` (MIT), `libaddressinput_countryinfo` (CC-BY-4.0, 1,700,044 bytes), `rigour_person_names` (MIT, 8,610,609 bytes, `:643-654`). **No IP, ASN, Tor, cloud-range, VPN or geolocation entry.**
- **A pinned entry looks like** (`data/manifest.json:643-654`): `name` (`^[a-z0-9][a-z0-9_]*$`), `filename`, `url` (https, at a pinned commit), `sha256` (64 hex), `size` (positive bytes), `license` (SPDX), `license_url`, `source_repo`, optional `commit` (40 hex), `description`, `notes` (licence verification date and the "more than 14 days old when adopted" rule).
- **`scripts/fetch_data.py`** (stdlib only, `:1-21`): `PERMISSIVE_LICENSES` = **`MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `PostgreSQL`, `CC0-1.0`, `CC-BY-4.0`** (`:48-60`); required fields (`:62-71`); URL fields must be https (`:72,170-182`); `commit` optional but 40-hex when present (`:165-167`); reserved filenames `manifest.json`, `malicious-feeds.json` (`:78`); redirects followed only to https (`:224-238`); the body is refused past the declared `size` (`:275-277`) and written only when its SHA-256 matches. **No identifier for BlueOak-1.0.0, PSF-2.0, MIT-CMU or CC-BY-SA**, although `CLAUDE.md:98` allows the first three.
- **`scripts/fetch_models.py`**: the same eight SPDX ids (`:47-59`), over `models/manifest.json`.
- **`scripts/fetch_fixtures.py`**: public-domain only, `LICENSE = "public-domain"` and Commons `PD-USGov…` templates (`:6-21,147-154`).
- **`scripts/fetch_trust_anchors.sh`**: wraps `trust-anchors:sync` (§6). There is no `scripts/fetch-watchlists.ts` (PLAN `:339` now says none is fetched by a script).
- **Committed vs downloaded:** `.gitignore` ignores `data/*` except `!data/manifest.json` and `!data/malicious-feeds.json` (`.gitignore:42-45`), and `models/**/*.onnx|tflite|task|obj|yml`, `data/raw/` (`:34-41`), `fixtures/faces/`, `fixtures/generated/` (`:47-48`). `git ls-files data` lists only `data/malicious-feeds.json` and `data/manifest.json`.
- **Images:** `.dockerignore:21-26` re-includes `data/manifest.json`, `data/malicious-feeds.json` and `data/disposable_email_blocklist.conf` only; `infra/docker/apps.Dockerfile:37-39` checks the disposable list's SHA-256. The API reads data files from `data/` relative to the module (`apps/api/src/contact/disposable-list.ts:3-48`, `apps/api/src/providers/malicious-website/feed-list.ts:63-83`).
- **The fit for Phase 7 data:** a monthly DB-IP Lite file, a Tor exit list or a cloud-range JSON changes over time, so a fixed `sha256` and `size` would have to be bumped each release; ADR 0005's "verified instead of pinned" path covers only public-sector list data (§6).

## 8. Outbound HTTP and jobs

**Outbound client** (C54.6, `apps/api/src/http/index.ts`)
- One client for every request the API or worker makes on its own initiative (`:1-5`). `OutboundHttpClientOptions { name, contentTypes, maxResponseBytes?, timeoutMs?, allowPrivateNetworks?, allowPlainHttp? }` (`:54-66`); request `{ method: GET|POST, url, headers?, body? }` (`:75-80`); response `{ status, contentType, body, headers? }` where `headers` holds **only** `location`, `expires`, `cache-control` (Workflow 5C K2/K5, `:82-96,210-251`).
- Defaults: 1 MiB (`DEFAULT_MAX_RESPONSE_BYTES`, `:34`) and 10 s (`DEFAULT_OUTBOUND_TIMEOUT_MS`, `:36`), applied as connect, headers and body timeouts plus an `AbortSignal.timeout` (`:175-206`).
- **SSRF guards:** a dedicated undici `Agent` (so `HTTP_PROXY` and the global dispatcher never apply) whose lookup is the webhook guard's `createVettedLookup` (`apps/api/src/webhooks/http-sender.ts:96`): every resolved address is classified and the socket connects to that address (`:7-12`). `classifyAddress` (`apps/api/src/webhooks/ssrf.ts:144`) refuses private, loopback, link-local, CGNAT, multicast, unspecified, documentation, benchmarking, reserved and cloud-metadata ranges for IPv4 and IPv6, including IPv4-mapped and NAT64 (`:1-28`); `allowPrivateNetworks` lifts only loopback, private and CGNAT (`PRIVATE_NETWORK_CATEGORIES`, `:36-40`), only for the EVM RPC client. No redirect is followed (a 3xx returns its `location`; only the trust sync follows one for CRLs) (`:13-16`). Content-type allowlist on 2xx; other bodies discarded (`:17-19`). Errors `invalid_url | blocked | dns | timeout | network | too_large | content_type` with `retryable`, never the URL (`:38-52`).
- `classifyAddress` and `isAddressAllowed` are reusable address classifiers; `apps/api/src/plugins/principal-auth.ts:139-162` has a `node:net` `BlockList` CIDR matcher (`isAddressAllowed(address, cidrs)`, IPv4-mapped handled) for API key `allowed-ips` (`cidr[]` column `api_keys.allowed_ips`, `packages/db/src/tables/tenancy.ts:104-105`; contract `allowedIpsSchema` ≤50 `z.cidrv4()|z.cidrv6()`, `packages/contracts/src/api-keys.ts:50-56`). **No IP-range index, ASN lookup or geolocation code exists** (grep `db-?ip|geoip|mmdb|maxmind|exit-addresses|torproject|ip-ranges|ipinfo|ip2location|\bASN\b|haversine|great.?circle` over `apps packages scripts services/vision/src android/openverify-sdk/src data/manifest.json pnpm-workspace.yaml`: only ASN.1 hits in `packages/emrtd`).
- C85.1's streaming form, exposed `etag`/`last-modified`/`content-length` and one-hop redirect are **planned, not built** (`docs/plans/phase-6.plan.md:550`).

**BullMQ worker** (`apps/api/src/worker.ts`)
- Queues: `process-verification` (job id = verification id; 5 attempts, exponential backoff 5 s with jitter; completed ids kept a day, failed a week; `apps/api/src/jobs/index.ts:1-26`), `webhook-delivery` plus its 30 s sweep, the repeatable queues, and the `retention` job (`startRetentionJob`, `worker.ts:62,533`).
- **Repeatable jobs:** `RepeatableJob { name, repeat: RepeatSchedule, run(): Promise<unknown> }` (`:165-173`); "its name is also its queue's and its scheduler's, so a restart upserts the same scheduler". `startWorkers` builds the list (`:375-396`): `inquiry-expiry` (`every`), the empty `api-lifecycle` marker block (`:383-384`), then `...phase5RepeatableJobs({ db, clock, logger, cache, outboundHttp, maliciousFeeds, nfc, verificationQueue })` (`:385-395`). For each: its own queue, `upsertJobScheduler(job.name, job.repeat, { name: job.name })` (a failure is logged by queue name), and a concurrency-1 worker wrapped in `withoutFailureData` (`:397-415`); `failed` and `error` handlers log codes only (`:416-438`). `run()` takes **no argument**, and each repeatable job has one fixed scheduler (as C85.4 notes, `docs/plans/phase-6.plan.md:553`).
- **Registry (C54.1)** `apps/api/src/jobs/repeatable/index.ts:1-60`: `RepeatableJobDeps` (`:29-41`) and `phase5RepeatableJobs(deps)` (`:44-57`), which adds `submitted-verification-sweep` (with a verification queue), `malicious-feed-refresh` (only when the feed list holds a feed) and `trust-anchor-refresh` (only with `OPENVERIFY_TRUST_ANCHOR_REFRESH=true`). "An owner builds its job in its own file; this registry and its tests stay as they are" (`:14`). `unbuiltRepeatableJob(name, repeat, deps)` is the stub for an owner who has not landed: it logs and fails with `repeatable_job_not_built` (`stub.ts:1-25`).
- **How a new repeatable job is registered and tested:** a file `jobs/repeatable/<name>.ts` exporting a `<NAME>_QUEUE` constant, an interval constant and a factory returning `{ name, repeat: { every } | { pattern }, run }` (the model is `feeds.ts:26-33,138-145`); a gated `jobs.push(...)` in `phase5RepeatableJobs` with any new member of `RepeatableJobDeps`, which `worker.ts:386-395` passes; unit tests of the factory's name and schedule and of `run` with injected deps (`feeds.test.ts:71-215`) and of the registry's gating and order (`index.test.ts:47-100`). The registry is named for Phase 5; Phase 6 C85.4 plans `report-sweep` (15 s) and `watchlists-refresh` (15 min) there (`docs/plans/phase-6.plan.md:553`), not yet built.
- **On-demand queues** follow `jobs/index.ts` (job id = object id, attempts, backoff, `PermanentJobError` → `UnrecoverableError`, `jobs/errors.ts`); BullMQ ids may not contain `:` (`apps/api/src/webhooks/queue.ts:41`, cited at `docs/plans/phase-6.plan.md:553`).
- Advisory locks in use: `pg_advisory_xact_lock(hashtextextended('openverify/otp-sms-budget/<env>', 0))` (`packages/db/src/repositories/otp-verification-states.ts:157`) and the trust sync's two (`repositories/trust-anchors.ts:235,389`). `FOR UPDATE SKIP LOCKED` batches in expiry, sessions and retention (§4).

## 9. Accounts, account types, custom fields and the values that could link records

**Account types** (C13, `packages/contracts/src/account-types.ts`)
- `fields-schema`: snake_case key (`INQUIRY_FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/`, `packages/contracts/src/inquiries.ts:38`) → `{ type, label (1–200) }`, at most 100 keys (`MAX_ACCOUNT_TYPE_FIELDS`, `account-types.ts:16-34`).
- **`ACCOUNT_FIELD_TYPES = ['string','number','boolean','date']`** (`:17-19`): 4 types. `accountFieldIssues` checks unknown keys and wrong types (`date` = `z.iso.date()`), `null` clears (`:150-190`); `accountTypeFieldsChangeIssues` allows only additive changes (no removal, no type change, `:96-117`). Seeded type `user` (`DEFAULT_ACCOUNT_TYPE_NAME`, `:15`).
- This is the **only custom-field-schema machinery** in the repo. There is no `file`, `float`/`int` split, `hash`, `choices` or `array` field type, no per-field validation options, and no field-level PII flag.
- Routes `POST|GET /account-types`, `GET|PATCH /account-types/:id` (`apps/api/src/routes/server/account-types.ts:33,57,75,96`).

**Field values** (`packages/contracts/src/inquiries.ts:41-58`): `string (≤10,000) | number | boolean | null`, ≤100 keys. Account `fields` reuse it (`accounts.ts:33-34`) and are marked `.meta({ pii: true })` (`:39-40`).

**Accounts** (`packages/contracts/src/accounts.ts`; table `packages/db/src/tables/accounts.ts:58-124`)
- Attributes: `reference-id` (unique per environment), `status` (`active`, `archived`), `fields` (PII), `tags`, `consolidated-into`, timestamps, `redacted-at` (`accounts.ts:36-48`). Relationships: `account-type`, `inquiries` (latest 100, `MAX_ACCOUNT_INQUIRY_LINKAGE`, `:35,50-56`); the contract imports `REPORT_RESOURCE_SCHEMAS` for the C70.5 `include=reports` (`:27`).
- Storage: `reference_id` **plaintext**; `fields` **sealed** (row AAD `accounts.fields#<id>`); `tags`; `consolidated_into` (partial index) (`tables/accounts.ts:58-124`).
- Routes (`apps/api/src/routes/server/accounts.ts`): `POST|GET /accounts` (`:69,94`), `GET|PATCH /accounts/:id` (`:118,136`), `add-tag`, `remove-tag`, `set-tags` (`:169,193,215`), `add-relation`, `remove-relation`, `GET relations` (`:238,263,288`), `consolidate` (`:309`), `add-objects`, `remove-objects` (`:342,365`, **inquiries only**: `{ type: z.literal('inquiry'), id }`, `packages/contracts/src/accounts.ts:186-197`), `redact` (`:391`).
- **Relations** (`account_relations`, `tables/accounts.ts:130-…`): bigint identity id, `from_account_id`, `to_account_id`, `relation_type` (`RELATION_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/`, `contracts accounts.ts:107-110`), directed and unique per (from, to, type) (`:118`), composite FKs to accounts `ON DELETE CASCADE`. Listed both ways (`ACCOUNT_RELATION_DIRECTIONS = ['outgoing','incoming']`, `:126-150`). Events `account.added-relation`, `account.removed-relation` (`event-names.ts:65-66`). These are **operator-declared edges**, not computed from shared attributes.
- **Inquiry ↔ account:** every inquiry has a non-null `account_id` (`tables/inquiries.ts:44,86`); resolution order `account-id`, then `reference-id`, then a new `user` account (`resolveForInquiry`, `apps/api/src/services/accounts.ts:406-450`, as `phase6-inventory.md` §7). Consolidation moves inquiries and relations; the absorbed account is archived (check `accounts_consolidated_is_archived`, `packages/db/src/tables/accounts.ts:118`).

**Where identifying values live, and in what form**

| Value | Where | Form at rest | Searchable by |
|---|---|---|---|
| Inquiry `reference_id` | `inquiries.reference_id` (`tables/inquiries.ts:47,101`) | plaintext | `(environment_id, reference_id)` index |
| Account `reference_id` | `accounts.reference_id` | plaintext, unique per env | unique index |
| Inquiry fields (names, emails, phones, addresses, birthdates as entered) | `inquiries.fields` | `encryptedJson`, **static** AAD `inquiries.fields` (`tables/inquiries.ts:48`) | nothing |
| Account fields | `accounts.fields` | sealed, row AAD | nothing |
| Government ID number | `government_id_extractions.identification_number_index` (`tables/government-id-extractions.ts:46`) | HMAC (per-env subkey); the number itself sealed in `fields` | `(environment_id, index)` |
| Government ID front image | `government_id_extractions.front_phash` + 8 bands | plaintext 64-bit pHash | band indexes |
| Names, birthdate, address from an ID | `government_id_extractions.fields` | sealed | nothing |
| OTP email or phone destination | `otp_challenges.destination` sealed; `.destination_index` HMAC `openverify/otp-destination/v1` (`tables/otp.ts:60,94-95`) | sealed + HMAC | `(environment_id, destination_index, sent_at)` |
| Database / AAMVA entered values | `verification_inputs.values` | sealed | nothing |
| Crypto wallet address | `crypto_challenges.wallet_address` sealed; `.address_index` HMAC `openverify/crypto-address/v1` (`tables/crypto-challenges.ts:35`) | sealed + HMAC | index |
| Chip SOD and document number | `chip_reads.sod_signature_index`, `.document_number_index` (`tables/chip.ts:104-106`) | HMAC | indexes |
| Face | `face_templates.template` | sealed | in-process scan only (§5) |
| Selfie background | `selfie_backgrounds.layout` | plaintext `vector(144)` | HNSW L2 |
| Session IP, user agent | `inquiry_sessions.ip`, `.user_agent`; consent jsonb | sealed (row / static) | **nothing** |
| Camera device snapshot | `selfie_captures.device` | sealed | nothing |

**Checks that already link inquiries by a shared value** (all environment-scoped, other accounts only)
- `id_repeat_detection` (C34): `findRepeatCandidates` matches `identification_number_index` **or** a front pHash within `max-phash-distance` (0–7, pigeonhole bands then `bit_count`), from unredacted extractions of **another account** (`packages/db/src/repositories/government-id-extractions.ts:140-200`; caller `apps/api/src/jobs/government-id.ts:262-285`). The pHash half ships disabled (no default `max-phash-distance`, `packages/core/src/check-config.ts:215,260`).
- `id_inconsistent_repeat_detection`: same blind index, then decrypted name and birthdate and a re-embedded front face (`'face-threshold'` 0.394) (`apps/api/src/jobs/government-id.ts:287-320`; `check-config.ts:261`).
- `selfie_repeat_detection` and `selfie_account_comparison`: the face scan (§5), excluding the inquiry's account.
- `selfie_similar_background_detection`: HNSW background neighbours of other accounts within `window-days` (§5).
- `id_nfc_repeat_detection`: the chip SOD and document-number indexes (`apps/api/src/jobs/types/government-id-nfc.ts:98`; default requirement `advisory`, `packages/core/src/check-registry.ts:195`).
- **None links by email, phone, IP address, device, browser fingerprint or name**, and no check writes a durable edge: each answers inside one verification and keeps only its result.

## 10. Tags, statuses, bulk actions, CSV, uploads and idempotency

**Tags** (unchanged since `phase6-inventory.md` §5; checked at HEAD)
- Contracts `packages/contracts/src/tags.ts` (`tagInputSchema`, `tagsSchema`, `addTagBodySchema`, `removeTagBodySchema`, `setTagsBodySchema`); core `MAX_TAGS_PER_OBJECT = 50`, `normalizeTags`, `addTag`, `removeTag` (`packages/core/src/tags.ts:13,90,103,115`); DB `tags text[]` with `openverify_tags_valid` and a GIN `openverify_lower_tags` index (`packages/db/src/tables/columns.ts:28-32`; `validTags`, `tables/inquiries.ts:125`); repository `applyTagOperation` (`repositories/tags.ts:50-74`).
- Routes: inquiries `add-tag`, `remove-tag`, `set-tags` (`apps/api/src/routes/server/inquiries.ts:274,295,316`, event `inquiry.updated-tags`); accounts the same (`routes/server/accounts.ts:169,193,215`, events `account.tag-added`, `.tag-removed`, `.updated-tags`). Reports carry `tags` in the 6A contracts.

**Statuses with operator actions**
- Inquiry: `approve`, `decline`, `mark-for-review` (`STATUS_ACTIONS`, `apps/api/src/routes/server/inquiries.ts:95-115`), through `transitionInquiryInTx`.
- Account: `status` `active` ↔ `archived` by `PATCH /accounts/:id`, emitting `account.status-updated` plus `account.archived` or `account.restored` (`routes/server/accounts.ts:136-150`).
- Inquiry sessions: `expire` and `expire-all` (§2). Webhooks: enable/disable and rotation (C14).
- There is **no custom status machinery** (operator-defined statuses on any resource) and no "label" concept distinct from tags.

**Bulk actions:** **none.** Every action takes one object id; the closest is `POST /inquiry-sessions/expire-all` for one inquiry (`packages/contracts/src/inquiry-sessions.ts:73-81`). A grep for `bulk`, `batch-?action`, `selectAll`, `select-all`, `selectedIds`, `aria-selected` over `apps packages` finds only `packages/ui/src/checkbox.tsx` (a form checkbox) and test setup comments. No dashboard table has row selection.

**CSV:** **none.** A grep for `text/csv`, `.csv`, `csv-parse`, `papaparse`, `fast-csv`, `csv-stringify`, `formula.?injection`, "CSV injection" over `apps packages` (ts, tsx, json) finds only the malicious-feed client's accepted content types (`apps/api/src/jobs/repeatable/feeds.ts:132`) and the report parity note "CSV bulk creation" (deferred, `packages/contracts/src/report-parity.ts:41`). No CSV parser or writer is a dependency anywhere (`apps/*/package.json`, `packages/*/package.json`); no formula-injection neutraliser exists; no export endpoint exists. Phase 6 deferred CSV bulk creation and exports (`docs/plans/phase-6.plan.md:577`).

**File uploads and the `files` resource**
- Only the **flow** API accepts uploads: `POST /flow/verifications/:id/files`, multipart via `@fastify/multipart@10.1.3` (`apps/api/package.json:41`) with `UPLOAD_LIMITS = { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6, fieldSize: 64, headerPairs: 20 }` (`apps/api/src/routes/flow/index.ts:55-66`). `MAX_UPLOAD_BYTES = 10 MiB` (`packages/contracts/src/files.ts:154-155`).
- Types are sniffed from magic bytes, never the client's `Content-Type` or filename: images `image/jpeg`, `image/png`, `image/webp` (`files.ts:150-152,164-…`), and `application/pdf` for documents (`:189,284`).
- `files` rows (`packages/db/src/tables/verifications.ts:136-160`): `verification_id` **NOT NULL**, `kind` (enum of 17 kinds, `FILE_KINDS`, `files.ts:23-42`), `storage_key`, `mime_type`, `byte_size`, `sha256`, `wrapped_dek` (encrypted object in S3/RustFS), `selfie_capture_id`. **A file always belongs to a verification**; there is no file owned by a list, transaction or operator import, and the server API (API key) has no upload route.
- Content: `GET /api/v1/dashboard/files/:id/content` (C4), decrypted, audited, never cached, `pii:view` required (`apps/api/src/routes/dashboard/files.ts:123-135`; `requirePiiView`, `apps/api/src/auth/pii.ts:115-120`).

**Idempotency-Key** (C12, `apps/api/src/plugins/idempotency.ts:1-16`)
- On server API `POST` and `PATCH`; key = printable ASCII 1–255 (`idempotencyKeySchema`, `packages/contracts/src/http-headers.ts:15-19`); claimed per environment and principal with a SHA-256 fingerprint of method, route, path, query and canonical-JSON body; answers stored 24 h with the body sealed (`idempotency_keys.response_body`, row AAD); replay with `Idempotent-Replayed: true`; another fingerprint → 422 `idempotency-key-reused`; in flight → 409 `idempotency-key-in-use`; 5xx releases the key.
- A **multipart** body is fingerprinted by part names, sizes and SHA-256s, which needs the route to buffer (`parseAs: 'buffer'`); a key on a **streamed** multipart body is refused (`:12-16`). This applies to any future CSV upload route.
- Stored copies are cleared by redaction through `REDACTION_SUBJECT_ID_PREFIXES` (§1) and deleted by retention (`deleteExpiredIdempotencyKeys`, `repositories/retention.ts:301`).

## 11. Events, webhooks and the surface index

**Names** (`packages/contracts/src/event-names.ts`)
- Convention `<subject>.<action>`, the subject being the payload's resource type (`:1-4`).
- Lists: `INQUIRY_EVENT_NAMES` (`:18-31`), `INQUIRY_SESSION_EVENT_NAMES = inquiry-session.started | .expired | .canceled` (`:34-38`), `VERIFICATION_EVENT_NAMES` (`:41-48`), `SELFIE_EVENT_NAMES` (`:51-56`), `ACCOUNT_EVENT_NAMES` (13, `:59-73`), and since 6A `REPORT_EVENT_NAMES` from core (`report/<type>.<action>`, `:75-79`). `EVENT_NAMES` concatenates them in order (`:82-104`); `eventNameSchema` (`:106`).
- `EventSubject = 'inquiry' | 'inquiry-session' | 'verification' | 'account' | 'selfie' | 'report'` (`:117-118`); `SUBJECTS` map (`:120-126`); `eventSubject` reads the head before the dot, mapping any `report/…` to `report`, and throws otherwise (`:133-143`); `eventResourceType` (`:146-149`).
- DB check `dottedName` = `^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$` on `events.name` (`packages/db/src/tables/columns.ts:44-48`; `tables/webhooks.ts:73`): one `/` subtype, **no digits**. `graph-query.completed`, `transaction-type.deleted-field`, `transaction.labeled` all fit it.

**Payloads** (`packages/contracts/src/events.ts`)
- `PREFIX_BY_SUBJECT_TYPE` (`:33-42`: inquiry, inquiry-session, every verification type, account, selfie, every report type).
- `redactedResourceStubSchema` (`:48-65`), `eventPayloadSchema` with a `data` discriminated union (inquiry, verifications, inquiry-session, account, selfie, reports) and `included` (inquiry, verifications, file, inquiry-session, account, selfie) (`:95-121`), `storedEventPayloadSchema` (`:128`), `payloadFitsName` (`:137-140`), report meta refinement (`:142-155`), `listEventsQuerySchema` with `filter[name]`, `filter[object-id]` (`anyIdSchema`), `filter[simulated]`, `filter[inquiry-id]` (`:198-209`).
- `filter[inquiry-id]` expands through `aboutInquiries` (`packages/db/src/repositories/events.ts:128-174`); the stored `object_type` comes from `payload.data` (`:38,99`).

**How a new resource's events are added** (the selfie and report precedents)
1. Core: a status → event map if statused (`as const satisfies`), exported.
2. `event-names.ts`: a `<RESOURCE>_EVENT_NAMES` list, appended to `EVENT_NAMES`, a `SUBJECTS` entry and an `EventSubject` member.
3. `events.ts`: `PREFIX_BY_SUBJECT_TYPE`, the resource schema in `data` (and `included` if embedded), `payloadFitsName` if the name is not the type.
4. API webhook samples (`apps/api/src/webhooks/samples.ts`): `EVENT_FIXTURES` (`:37`), `RESOURCE_FIXTURES` keyed by `Exclude<EventSubject,'report'>` (`:44-60`), `STATUS_BY_EVENT` (`:68-…`, with a `report` map at `:82-83`), plus a golden fixture `packages/contracts/fixtures/api/<type>.json`.
5. Dashboard `eventNameGroups()` (`apps/dashboard/src/lib/api/events.ts:76-87`: Inquiry, Inquiry session, Verification, Account, Selfie, Report) and event words.
6. Webhook filters: C14 `filters` know only `inquiry-template-ids` and `account-type-ids` (`packages/contracts/src/webhooks.ts:185-190`); `webhookFilterSubject` reads the `inquiry-template` or `account-type` linkage (`packages/core/src/webhook-payload.ts:64-111`); `eventFilterSubjects` falls back to `relationships.inquiry` and that inquiry's template (`apps/api/src/events/subject.ts:1-30`). A resource with neither linkage (a list, a graph query, a transaction without an inquiry) is **never filtered**.
7. `applyAttributeBlocklist` (`webhook-payload.ts:51`) strips blocked attribute names from delivered payloads.
8. The publisher validates name and payload with `buildEventResource` before staging, then writes the event and deliveries in the caller's transaction; `dispatch` after commit (`apps/api/src/events/index.ts`, as `phase6-inventory.md` §3).

**Surface index** (`docs/research/persona-surface.md`; identifiers only, extracted 2026-10-19 from `persona-openapi` 2026-09-29, `:1-5`)
- **List-item types (11)** (`:227-239`): `browser-fingerprints`, `countries`, `device-fingerprints`, `email-addresses`, `fields`, `geolocations`, `government-id-numbers`, `ip-addresses`, `names`, `phone-numbers`, `strings`. **No `faces` and no `selfie-backgrounds`**; PLAN §2 lists 13 (`docs/PLAN.md:67`). The check section notes "PLAN §4 adds checks implied by Lists (face, selfie background)" (`:9`).
- **Report types:** `custom-list` (`:200`), `ip-address` (`:206`, added 2026-10-27 per `:169`).
- **Events** (`:242-387`):
  - sessions: `inquiry-session.canceled`, `.expired`, `.started` (`:294-296`) — the three OpenVerify has; **no `session.*` event** is listed;
  - graph: `graph-query.cancelled`, `.completed`, `.errored`, `.reran`, `.timed-out` (`:283-287`); **`graph-query.submitted` is not listed**;
  - transactions: `transaction-type.deleted-field` (`:364`), `transaction.added-relation`, `.created`, `.labeled`, `.redacted`, `.removed-relation`, `.sentinel-session-processed`, `.status-updated`, `.updated-fields` (`:365-372`); **`transaction-type.converted-field` is not listed**, and no `transaction.updated-tags`;
  - importers: `importer-pipeline-run.canceled`, `.completed`, `.errored`, `.paused`, `.resumed`, `.started` (`:288-293`);
  - **no list, list-item, device or network event** is listed.
- **API paths** (`:390-545`):
  - `devices`, `devices/{device-id}` (`:437-438`);
  - `graph-queries`, `graph-queries/{graph-query-id}` (`:444-445`);
  - `importer/accounts`, `importer/list-item/{email-addresses, geolocations, government-id-numbers, ip-addresses, names, phone-numbers}`, `importers`, `importers/{importer-id}` (`:446-454`) — six list-item importers, none for browser or device fingerprints, countries, fields or strings;
  - `inquiry-sessions`, `/expire-all`, `/{id}`, `/{id}/expire`, `/{id}/generate-one-time-link` (`:469-473`) — the last one does not exist in OpenVerify, whose one-time links hang off the inquiry (§2);
  - `list-item/<type>` and `list-item/<type>/{list-item-id}` for all 11 types (`:478-499`); `list/<type>` for nine (`browser-fingerprints`, `countries`, `email-addresses`, `geolocations`, `government-id-numbers`, `ip-addresses`, `names`, `phone-numbers`, `strings`; **no `list/device-fingerprints` or `list/fields`**) (`:500-508`); `lists`, `lists/{list-id}` (`:509-510`);
  - `transaction-types/{transaction-type-id}` only (no collection path) (`:532`); `transactions`, `/{id}`, `/add-objects`, `/add-relation`, `/add-tag`, `/label`, `/redact-biometrics`, `/remove-objects`, `/remove-relation`, `/remove-tag`, `/set-tags` (`:533-543`).
- **No signal, network or handoff identifier** appears anywhere in the index (grep `network|signal|handoff|geoloc`: only `list-item` and two verification type names).

## 12. RBAC, API key scopes and rate limits

**Scopes** (`packages/core/src/permissions.ts`)
- `API_SCOPES` (`:9-41`, 28 at HEAD): `inquiries:read|write`, `inquiry-templates:read|write`, `verifications:read`, `webhooks:read|write`, `events:read`, `accounts:read|write|redact`, `inquiries:redact`, `inquiry-sessions:read|write`, `inquiry-templates:publish`, `api-keys:read|write`, `api-logs:read`, `audit-logs:read`, `sandbox:read` (C55.11), and **6A's** `reports:read|write|review|redact`, `report-templates:read|write|publish`, `watchlists:read` (C72.2, `:31-40`).
- `OPERATOR_PERMISSIONS` (`:51-60`): `pii:view` ("unmasks `fields`, `note` and session IP and user agent, and allows file content", `:46-50`), `users:read|write`, `roles:read|write`, `settings:read|write`, `environments:production`. `PERMISSIONS = [...API_SCOPES, ...OPERATOR_PERMISSIONS]` (`:63`).
- **No scope** for devices, networks, signals, lists, list items, importers, graph queries, transactions or transaction types (grep `lists:|graph|transactions:|devices:` in `permissions.ts`: none).

**Built-in roles** (`:79-160`)
- `admin`: every permission (`:112`).
- `developer` (`:113-139`) and `reviewer` (`:140-158`): explicit lists; 6A added report scopes to both (developer without `reports:review|redact`; reviewer with all four report scopes, `report-templates:read` and `watchlists:read`).
- `viewer`: **every `:read` permission automatically** except `NOT_FOR_VIEWERS = ['api-logs:read','audit-logs:read','sandbox:read']` (`:97-105,159`). A new `lists:read`, `graph-queries:read` or `transactions:read` reaches viewers unless listed there.
- Role rows are re-synced to core at API startup and on organization creation (`apps/api/src/services/roles.ts`, `phase6-inventory.md` §4).

**Contracts and dashboard**
- `packages/contracts/src/scopes.ts:1-6` re-exports `API_SCOPES` from core; `vocabulary.test.ts` pins the exact list.
- Dashboard `AREAS` (`apps/dashboard/src/components/operators/permissions.ts:8-26`): Inquiries, Inquiry sessions, Verifications, Accounts, **Reports** (6A), Templates, Webhooks, Events, API keys, API logs, Personal data, Users, Roles, Audit logs, Settings, Environments. `PERMISSION_INFO` is `Record<Permission, { area, label }>` (`:30-68`), so a new core permission **fails the dashboard typecheck** until it has a label and an area (`:1-4`). There is no Lists, Graph, Transactions, Devices or Signals area.

**API keys**
- A key holds a subset of `API_SCOPES`, optional `allowed-ips` (≤50 CIDRs, empty = any; `packages/contracts/src/api-keys.ts:50-56`), and is masked when minted by a principal without `pii:view` (`apps/api/src/auth/pii.ts:1-3,41-45`). Token `ov_sbx_…` / `ov_prod_…` (§1).
- The dev seed's sandbox key holds `[...API_SCOPES]` (`apps/api/src/seed/dev-seed.ts:493-500`), so a new scope reaches it with no seed change.

**Rate limits** (C12, `packages/contracts/src/rate-limits.ts:8-32`)
- Policies: `api` 300/min per API key or user session (`OPENVERIFY_RATE_LIMIT_API_PER_MINUTE`, `apps/api/src/config.ts:277,603-604`), `flow-session` 120/min per session token, `flow-ip` 600/min per client IP, `one-time-link-redeem` 30/min per IP, `reports` 600/min per environment (6A, C72.5). Window 60 s; GCRA in Valkey.
- Enforcement (`apps/api/src/plugins/rate-limit.ts:150-173`): `onRequest` applies `api` to any principal and `flow-ip` (plus `one-time-link-redeem` on the redeem route) to flow routes; `preParsing` applies `flow-session` after the session token is authenticated. A limiter failure **fails open** with an error log (`:127-134`). A new unauthenticated endpoint (for example a handoff redemption or a signal beacon) would get only `flow-ip` unless a policy is added.

## 13. Dashboard (`apps/dashboard`)

**Stack:** Next.js (catalog `^16.4.2`, `pnpm-workspace.yaml:27`) App Router, React, Tailwind 4; runtime dependencies `@openverify/{contracts,core,node,ui}`, `@simplewebauthn/browser@14.0.0`, `qrcode@1.5.4`, `server-only`, `zod` (`apps/dashboard/package.json:15-26`). A custom `server.ts` serves the build (records each request's socket peer; `infra/docker-compose.yml:419-421`).

**App router** (`apps/dashboard/src/app/`): `accept-invitation`, `account`, `account-types`, `accounts`, `actions`, `api-keys`, `api-logs`, `audit-logs`, `events`, `files`, `inquiries`, `login`, `roles`, `settings`, `templates`, `trust-anchors`, `users`, `verifications`, `webhooks`, plus `layout.tsx`, `page.tsx`, `error.tsx`, `not-found.tsx`. One folder per resource with `page.tsx`, `[id]/page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` and `actions.ts` (e.g. `app/accounts/`). **No `reports` route yet** (6A added only labels, the permission area and the event group; 6B builds pages, `docs/plans/phase-6.plan.md:555-561`).

**Navigation** (`apps/dashboard/src/components/nav-items.ts:23-56`): "Verifications" (inquiries, accounts, account-types, templates), "Integrations" (webhooks, api-keys, api-logs, events), "Organization" (users, roles, audit-logs, settings, `trust-anchors` "Chip trust store"). Each item has one `permission`; hiding is UX only (`:1-6`). No Lists, Graph, Transactions, Devices or Reports item.

**Page pattern** (`apps/dashboard/src/lib/api/page.tsx:1-25`): server components through `renderPage({ permissions }, async ({ api, session }) => …)`, which handles sign-in, required MFA, the forbidden panel (without calling the API) and 401/403/404 mapping. Data through `@openverify/node` with the user session, or `apiRequest` for dashboard endpoints.

**Server actions** (`apps/dashboard/src/app/accounts/actions.ts:1-30`): `'use server'` modules beside the route that validate the form with the contract schemas (`addAccountObjectsBodySchema`, `addAccountRelationBodySchema`, `consolidateAccountsBodySchema`, tag bodies, …), call the server API as the operator through `runAction`/`parseInput`/`formString` (`lib/api/action`), `revalidatePath` the pages they change, and answer `{ ok } | { problem }`; inputs parsed by `components/lifecycle/action-input` (`idListOf`, `jsonOf`, `tagNamesOf`). Destructive ones ask for a typed phrase (`REDACT_PHRASE`).

**Components**
- `DataTable<Row>` (`apps/dashboard/src/components/data-table.tsx:1-40`): a semantic table with typed `columns`, `rows`, `getRowKey`, `caption`, `emptyMessage`, a focusable scroll region; "works in Server Components". **No selection, sorting or virtualisation.**
- Resource tables and filters: `inquiries-table.tsx`, `inquiry-filters.tsx`, `lifecycle/accounts-table.tsx`, `lifecycle/account-filters.tsx`, `lifecycle/list-filters.ts`, `pagination.tsx` (cursor), `empty-state.tsx`, `status-badge.tsx`, `masked-value.tsx`, `hidden-value.tsx`, `json-editor.tsx`, `confirm-dialog.tsx`, `dialog.tsx`, `toasts.tsx`, `copy-button.tsx`.
- Inquiry page sections: `lifecycle/inquiry-view.tsx` stacks `OptionalSection`s, including **Sessions** (`:346`; `lifecycle/inquiry-sessions.tsx:117-124` shows `ip-address` and `user-agent` through `MaskedValue`), loaded when the user has `inquiry-sessions:read` (`app/inquiries/[id]/page.tsx:65-66`). Accounts: `account-view.tsx`, `account-relations.tsx`, `account-inquiries.tsx`, `add-inquiries-form.tsx`, `consolidate-button.tsx`, `fields-editor.tsx`.
- **No tab component** (as in Phase 6), **no graph, network or chart library** (grep `cytoscape|@xyflow|recharts|chart\.js|d3-|vis-network|sigma|graphology|echarts` over `apps/*/package.json`, `packages/*/package.json`, `pnpm-workspace.yaml`: nothing), no map component.
- `packages/ui` (`packages/ui/src/index.ts`): `Alert`, `Button`, `Card`, `Checkbox`, `cx`, `Field`, `Input` and `styles.css` only.

**CSP:** headers only `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy`, `nosniff`, `Permissions-Policy` (§3). **No `script-src`, `worker-src`, `connect-src` or `blob:` rule exists**, so a client-side graph renderer or a Web Worker is not blocked today, and a later nonce CSP would need `worker-src` if one is used.

**Testing:** mocked-API page tests (`testing/api-routes.ts` `routeApi()`), fixtures in `testing/`; full-stack UI specs `e2e/tests/ui-*.spec.ts` (as `phase6-inventory.md` §13).

## 14. Android SDK (`android/openverify-sdk`, Kotlin Multiplatform)

- Source sets: `commonMain`, `androidMain`, `iosMain`, `commonTest`, `androidHostTest`, `androidDeviceTest`, `iosTest` (`ls android/openverify-sdk/src`); 188 tracked files under `src`. `minSdk 26`, `compileSdk 36` (`android/gradle/libs.versions.toml:17,19`).
- Manifest permissions: `INTERNET` and `CAMERA` only; `android.hardware.camera.any` not required (`android/openverify-sdk/src/androidMain/AndroidManifest.xml:1-20`). **No `READ_PHONE_STATE`, location or network-state permission.**
- **API it calls:** only the flow API (C3) with the session token (`commonMain/.../api/FlowApi.kt:24`): `getSession`, `acceptConsent`, `createVerification`, `createSelfieCapture`, `uploadFile`, `uploadDocument`, `submitVerification`, `getVerification`, `sendOtp`, `confirmOtp`, `enterInputs`, `createCryptoChallenge`, `submitCryptoSignature`, `pollVerification` (`:29-115`), plus one-time link redemption (`api/OneTimeLinkClient.kt`, `OneTimeLinkFlowApi.kt`). Ktor with `expectSuccess = false`, `followRedirects = false` (`api/FlowHttpPlatform.kt:15-23`); OkHttp on Android with 15/30/60 s timeouts and no redirects (`androidMain/.../api/FlowHttpPlatform.android.kt:12-25`).
- **What it sends about the device:**
  - `User-Agent: OpenVerify-Android/0.1.0` (`SDK_VERSION`, `USER_AGENT`, `commonMain/.../api/FlowHttp.kt:117-120`; `PLATFORM_NAME = "Android"`, `FlowHttpPlatform.android.kt:12`) — which the API stores as the session's `user-agent` on the first call (§2);
  - the C40.4 selfie **camera facts** mapped onto the device snapshot: camera ids as `label`, lens facing as `facing-mode`, resolution, frame rate and maximum (`commonMain/.../camera/CameraFacts.kt:8-45`); the model has an optional `webdriver` (`model/SelfieCapture.kt:115`);
  - the NFC chip device report (protocols tried and `read-ms`, `packages/contracts/src/chip-challenges.ts:51-67`), which the NFC module would send.
- **No device signals:** a grep for `ANDROID_ID`, `Settings.Secure`, `isDebuggerConnected`, `Debug.`, `Build.FINGERPRINT|MODEL|MANUFACTURER|PRODUCT|HARDWARE|BRAND|DEVICE`, `ro.kernel.qemu`, `goldfish`, `ranchu`, `isRooted`, `PlayIntegrity`, `SafetyNet` over `android/` (`.kt`, `.kts`, `.toml`, tests excluded) finds nothing; "emulator" appears only for the `10.0.2.2` host alias (`api/ApiBaseUrl.kt:39`, `api/FlowApiClient.kt:58`, `demo-app/.../DemoForm.kt:12`). PLAN puts "device signals: root/emulator, optional Play Integrity adapter" in Phase 10 (`docs/PLAN.md:432`), and §4.4 lists "emulator/root (Android)" (`:284`).
- `android/openverify-nfc` holds only `NOTICE`, `README.md` and `build.gradle.kts` in git (`git ls-files android/openverify-nfc`).
- The SDK has no handoff (QR display or scan) and no web-to-app link handling beyond one-time links.

## 15. Checks registry (`packages/core`)

- **Definition** (`packages/core/src/check-registry.ts:80-137`): `id` (snake_case, `/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/`, `:82-84`), **`verificationType`** (one of the 11 `VERIFICATION_TYPES`, `packages/core/src/enums.ts:80-93`), `checkType` (`user_behavior` | `fraud`, `enums.ts:12-14`), `category` (C50.8), `tier` (`R` | `H` | `A`, `enums.ts:36-42`) and optional `alternateTier`, `stage` (`ga` | `beta` | `sunset`, `enums.ts:32-34`), `version` ≥1, `modelBased`, `inputs` ⊆ `CHECK_INPUTS = ['upload','vision','extraction','history','provider']` (`enums.ts:44-57`), `defaultRequired`, `defaultEnabled`, `description`, optional `configSchema`.
- **Registration:** a `defineCheck(id, verificationType, checkType, tierSpec, description, { inputs, modelBased?, configSchema? })` entry in the frozen `CHECK_REGISTRY` array (`:365-…`). `defineCheck` (`:309-…`) sets `stage: 'beta'` whenever H is involved or the check is model-based, else `ga` (`:330`); defaults come from `PHASE5_CHECK_DEFAULTS` (`required` | `advisory` | `disabled`, `:142-197`) or the tier rule in `defaultsOf` (A disabled; R required except `OPTIONAL_BY_DEFAULT`, `:257-265,284-298`). `CHECK_IDS`, `checkIdSchema`, `isCheckId`, `getCheckDefinition`, `listChecks(verificationType)` (`:1199-1220`). Config defaults live in `check-config.ts` and `check-config/*.ts` with a `basis` (`calibrated` | `provisional`) and source (`check-config/basis.ts:10-24`).
- **Results** (`packages/core/src/check-result.ts:62-81`): `confidence` in [0,1] or null, "an H-tier `passed` or `failed` result always carries one"; `metadata` never holds PII, OCR text or embeddings.
- **ADR 0002** (`docs/adr/0002-check-tiers.md:25-60`): R/H/A meanings and combined tiers `R+A`, `A/H`, `H/A`; H entries are `beta`; never fake `passed` (absent input → `not_applicable`, failure → `not_applicable` with `execution_error`); a required check without evidence routes the inquiry to `needs_review`.
- **Every check belongs to a verification type.** There is no inquiry-level, session-level or account-level check, no `signals`/`session`/`list` input kind, and no verification type for device, network or behaviour signals. PLAN §4.4's network, device and behaviour items (`docs/PLAN.md:283-285`) have **no registry entry** (grep `is_proxy|is_vpn|is_tor|is_datacenter|threat_level|bot_score|behavior_threat|fingerprint|handoff` in `packages/core/src`: none).
- **Existing checks that read device, IP, GPS or list data**
  - Device: `selfie_liveness_detection` reads the capture's device snapshot (`webdriver`, a file-path label, a virtual-camera label) as integrity flags, waived in sandbox (`packages/checks/src/selfie/selfie-liveness-detection.ts:66-71,141-160`; `capture-signals.ts:17,43`).
  - IP and GPS: **none**. No check reads the session IP, user agent or any location.
  - Lists:
    - `email_address_disposable_detection`: the CC0 disposable list plus per-template `allow-domains` and `deny-domains` (≤500 each, `MAX_EMAIL_DOMAIN_LIST`, `packages/core/src/check-config/contact.ts:8-42`);
    - `id_disallowed_country_detection` and the type-level `allowed-countries` / `allowed-chains` (`packages/core/src/decision-engine.ts:32-42`);
    - `id_compromised_detection` ("ID numbers on compromised lists", `check-registry.ts:598-605`) takes an input `compromisedList?: { matched: boolean }` (`packages/checks/src/government-id/inputs.ts:136-137`) and fails with `compromised_list_match` when it is true (`id-compromised-detection.ts:57`; reason `reasons.ts:175`). **No API code supplies `compromisedList`** (grep `compromisedList` in `apps/api/src`: nothing), so the list half never fires today: an existing hook for a government-ID-number list.
    - `business_website_malicious_website_detection`: the operator feed list (§6).

## 16. Existing docs and records Phase 7 must correct

**`docs/PLAN.md`**
- §1 `:12`: "a multi-tenant API covering … lists, graph, transactions …"; `:15` "an end-user verification flow (hosted page, embedded iframe, inline)" (only hosted exists, §3); `:16` "a JS/React SDK" (none exists); `:17` "(… graph explorer …)"; `:19` the Android SDK "and device signals".
- §2 feature map:
  - `:67` `| Lists | browser fingerprint, device fingerprint, country, email, face, geolocation, gov-ID number, field, IP, name, phone, selfie background, string. CSV importers. | \`apps/api\` lists |` — **13 types**; the surface index has **11** (no face, no selfie background) and **six** importers (`persona-surface.md:227-239,446-452`).
  - `:68` `| Graph | Link analysis across accounts by shared attributes, query templates, explorer UI, bulk actions | \`apps/api\` graph + dashboard explorer |`.
  - `:69` `| Transactions | Custom types (field schemas: bool/date/file/float/hash/int/string/choices/array), custom statuses, labels, redact-biometrics | \`apps/api\` transactions |` — **9 field types**; account types have 4 (`string`, `number`, `boolean`, `date`, `packages/contracts/src/account-types.ts:17`).
  - `:70` `| Signals | Session: IP, UA, OS/browser/device, **is-proxy / is-vpn / is-tor / is-datacenter**, threat-level, geo (IP + GPS), ISP, device-handoff method. Inquiry: \`bot_score\`, \`behavior_threat_level\`. Distances are in **meters**. | \`packages/signals\`, Android signals, \`apps/api\` network intel |`.
- §3:
  - layout `:117` `signals/        browser fingerprint, behavioural + bot signals` (`packages/signals` does not exist); `:118` `sdk-js/ sdk-react/ node/` (only `node` exists); `:109` `demo-web/` (does not exist); `:116` `watchlist/` (exists since 6A);
  - `:141` `| Workflow editor / graph UI | **@xyflow/react** / **Cytoscape.js** | MIT |`;
  - `:142` `| Browser fingerprint | own collector (+ FingerprintJS **v3** MIT only, not v4 BSL) | MIT |`;
  - `:147` `| IP intel | DB-IP Lite geo (CC BY 4.0), Tor exit list, cloud provider IP ranges, VPN ASN lists | public |`;
  - hardening `:158-160`: "CSP and Permissions-Policy (camera) on the flow", "iframe domain allowlist; `localhost` embedding is allowed in sandbox only", "SSRF guard on the HTTPS-request workflow action" — the flow's Permissions-Policy and frame-ancestors are not sent by any serving layer (§3) and no domain allowlist exists.
- §4.4 `:283` "**Network:** is_proxy, is_vpn, is_tor, is_datacenter, threat_level; IP-geo vs ID-country vs GPS distance (meters); ISP/ASN."; `:284` "**Device:** fingerprint reuse/velocity, emulator/root (Android), automation (`navigator.webdriver`, headless/CDP artifacts)."; `:285` "**Behaviour:** bot_score, behavior_threat_level (paste/autofill, hesitation, focus loss, typing cadence), device-handoff (QR)." None is a registry check id (§15).
- §6 Phase 7 `:405-411`: `:406` "Browser signal collector: fingerprint, automation detection, behavioral metrics, bot score."; `:407` "Network intel: DB-IP geo, Tor, cloud ranges, VPN ASN; threat level; geo distances in meters."; `:408` "Device handoff by QR." (**no email handoff**, which the brief adds); `:409` "**Lists** (all 13 types) plus CSV importers and list-match checks."; `:410` "**Graph:** a shared-attribute edge index with recursive-CTE queries, query templates, and a Cytoscape explorer with bulk actions."; `:411` "**Transactions:** custom types, schemas and statuses, labels."
- §6 Phase 10 `:432` "device signals: root/emulator, optional Play Integrity adapter" — the brief puts Android ANDROID_ID and debugger signals in Phase 7.
- §10 `:508` "Reports, lists, graph, workflows and cases are usable from the dashboard and the API."

**`THIRD_PARTY_LICENSES.md`**
- `:8` "No non-commercial terms, no BSL, no source-available terms (RSAL, SSPL)."
- §2.2 Planned `:263-271`: `:270` `| Cytoscape.js | MIT | npm \`cytoscape\` | Graph explorer | to verify on adoption |`; `:271` `| FingerprintJS **v3 only** | MIT | npm \`@fingerprintjs/fingerprintjs@3\` | Browser fingerprint (v4+ is BSL, see Excluded) | to verify on adoption |`; `:269` `@xyflow/react`.
- §2.1.2 `:113` `| qrcode | 1.5.4 | MIT | npm | The TOTP enrolment QR code, computed on the dashboard server (C22) | verified 2026-10-20 |` (and its transitives `:114-116`) — dashboard only.
- §4.2 Planned data `:337` `| DB-IP Lite | CC BY 4.0 (attribution required) | db-ip.com | IP geolocation | to verify on adoption |`; `:338` `| Tor exit node list | Public (Tor Project) | check.torproject.org | is_tor signal | to verify on adoption |`; `:339` `| Cloud provider IP ranges | Published by each provider (terms vary) | AWS / GCP / Azure JSON feeds | is_datacenter signal | to verify on adoption |`; `:340` `| VPN ASN lists | Source not chosen yet | TBD | is_vpn signal | to verify on adoption |`.
- Excluded `:394` `| FingerprintJS v4+ | BSL 1.1 | BSL | FingerprintJS v3 (MIT) plus our own collector |`.
- `CLAUDE.md:104` "For example, InsightFace pretrained packs and FingerprintJS v4+ are not allowed." (agents do not edit `CLAUDE.md`, Phase 5 decision 45).
- Not checked here (needs the network): whether FingerprintJS v3's last MIT release is still installable and maintained, and whether `cytoscape` and its layout extensions stay MIT.

**`docs/research/persona-surface.md`**
- List-item types `:227-239` (11, no `faces`, no `selfie-backgrounds`); importers `:446-452` (accounts plus six list-item importers; **no face importer**); lists `:500-510` (`list/<type>` for nine types, none for `device-fingerprints` or `fields`).
- `graph-query.*` events `:283-287` are `cancelled`, `completed`, `errored`, `reran`, `timed-out`: **no `graph-query.submitted`**.
- `transaction-type.deleted-field` `:364` only: **no `transaction-type.converted-field`**; transaction events `:365-372`.
- Session events `:294-296` are `inquiry-session.*` only: **no `session.*` event**.
- Report types `custom-list` `:200` and `ip-address` `:206` (the latter added 2026-10-27, `:169`); no `report/ip-address.*` or `report/custom-list.*` event is listed (the events note `:244` says the 76 missing report events are not listed one by one).
- Paths `devices`, `devices/{device-id}` `:437-438`, `graph-queries` `:444-445`, `transaction-types/{transaction-type-id}` `:532` (no collection path), `inquiry-sessions/{id}/generate-one-time-link` `:473`.

**`CLAUDE.md:38`** names `signals`, `sdk-js`, `sdk-react`, `workflow-engine` and `apps/demo-web`, none of which exists; the packages at HEAD are `checks config contracts core db emrtd flow-spec node ui watchlist` (`ls packages`). `docs/research/phase5-inventory.md:734` already noted it.

**Earlier plans that defer work to Phase 7**
- `docs/plans/phase-4.plan.md:218`: "The public-figure gallery and Lists: Face (Phase 7) may use the same table with other `source` values; an ANN mode is their decision." `:477`: "an ANN mode for very large galleries is left to Phase 7, with that finding attached" (a keyed rotation in a pgvector index "is probably recoverable from the database plus the public model"). `:488`: "Known-fraudster faces belong to Phase 7's face lists."
- `docs/plans/phase-3.plan.md:338`: "a public-figure gallery needs stored embeddings, which Phase 4 and the Phase 7 face lists decide."
- `docs/research/phase4-selfie-behaviour.md:744-748` (face lists with a bulk image importer and a consent precondition; "A match surfaces as a **list match** … not as a check"), `:749-752` (selfie-background list), `:764` ("Graph nodes. Selfie similarity, image-background similarity, and camera fingerprint, for Phase 7").
- `docs/plans/phase-6.plan.md:177,207` (`transaction` relationship null until Phase 7), `:577` (custom-list reports; re-screening on account changes "with the account graph"); `docs/plans/phase-6-review-resolution.md:80,146`.

## 17. `docs/PROGRESS.md` items carried forward into Phase 7's areas

- **Status table** (`docs/PROGRESS.md:5-17`): Phase 6 "planned", Phase 7 "pending". There is **no Phase 6 entry yet** (6A running), so no Phase 6 "Carried forward" list exists at HEAD; the newest entry is Phase 5 done (`:20-138`).
- **Phase 5 done, carried forward** (`:113-136`). Items touching Phase 7 work:
  - test infrastructure (`:128-135`): newest-first DB tests that do not stamp `created_at` (`:129`); under load, two `flow` tests hit the 20 s timeout and four `db`/`api` `beforeAll` hooks hit 60 s **while migrating PGlite** (`:130`), which a further migration lengthens; re-measure the e2e timeouts at 82 tests (`:131`); the axe-core check (`:135`);
  - console: no words for `verification.*` events (`:127`) — the same gap applies to any new event subject.
  - Nothing else is about signals, lists, graph or transactions.
- **Phase 5B** (`:207-223`): nothing in Phase 7's areas.
- **Phase 5A** (`:269-284`): decision for the owner `:279` "An `otp-ip-hour` refusal is not recorded" (the only per-IP limit outside the C12 policies); `:270` the post-commit enqueue repair sweep (since built as `submitted-verification-sweep`, `apps/api/src/jobs/repeatable/index.ts:10-12,47-49`).
- **Phase 4B** (`:382-387`): nothing in Phase 7's areas. **Phase 4A** (`:450-466`): `:463` "Chromium's plain fake camera label `fake_device_0` is not on the virtual-camera list" (a device-signal gap in the selfie integrity flags).
- **Phase 3A** (`:599-604`): `:603` "`compromised_list_match` cannot fire until the Phase 7 lists" (§15); `:604` every e2e run submits the same card, so `id_repeat_detection` fails across runs.
- **Phase 1A** (`:1091-1097`): `:1094` "**Flow: response headers.** CSP `frame-ancestors`, `Permissions-Policy: camera=(self)` and `Referrer-Policy` need a serving layer; `vite preview` sends none." — **still true at HEAD** (§3).
- **Phase 2A** (`:1006-1009`): `:1008` the BFF client-IP headers — **resolved since** (`apps/dashboard/src/lib/api/client-address.ts`, `lib/config.ts`; `apps/dashboard/README.md:24,49`).

---

## 18. Cross-cutting gaps the plan must resolve

1. **Where signals live.**
   - Every check belongs to one of the 11 verification types (`packages/core/src/check-registry.ts:86-88`), and `CHECK_INPUTS` has no session, device, network or list input (`enums.ts:55`). PLAN §4.4's network, device and behaviour items have no check id, no verification type and no resource.
   - The inquiry session carries only `ip-address` and `user-agent` from the first call (§2), and nothing records later calls, other sessions' devices, GPS or a handoff.
   - The plan must decide whether signals are session attributes, an inquiry-level resource, new check ids (and under which verification type, or a registry change), or list-match results, and how ADR 0002's tiers and `beta` apply to them.
2. **Searching by IP, device or fingerprint.** IP and user agent are sealed with a row AAD and have no index (`tables/inquiries.ts:221-222`); the device snapshot is sealed (`selfie_captures.device`). Nothing can be matched or linked by them today. Blind indexes are per environment (`blind-index.ts:120-131`), so any list or graph join must be environment-scoped or keep plaintext. An IP-range (CIDR) list cannot be an equality HMAC.
3. **Live network data.**
   - DB-IP Lite, the Tor exit list, cloud ranges and VPN ASN lists change over time. `fetch_data.py` needs a fixed `sha256` and `size` (`scripts/fetch_data.py:62-71,275-277`); ADR 0005's "verified instead of pinned" covers public-sector list data only (`docs/adr/0005-report-honesty-and-live-public-sector-data.md:36-43`); the malicious-feed job (operator feeds, Valkey, no pin, `jobs/repeatable/feeds.ts:1-9`) and the CSCA sync (manifest with pinned roots, DB tables, advisory lock) are the two built precedents.
   - Licences: DB-IP Lite is CC-BY-4.0 (on the allowlist, attribution needed); "Public (Tor Project)", "terms vary" (cloud ranges) and "Source not chosen yet" (VPN ASN) have no SPDX id on `PERMISSIVE_LICENSES` (`THIRD_PARTY_LICENSES.md:337-340`).
   - The outbound client caps bodies at 1 MiB by default (32 MiB is the largest client today, the feeds), exposes only `location`, `expires`, `cache-control`, and has no streaming (§8); C85.1's streaming form is planned for 6A, not built.
   - No IP-range, ASN, geolocation or distance code exists (§8 grep); `node:net` `BlockList` (`plugins/principal-auth.ts:139-162`) and `classifyAddress` (`webhooks/ssrf.ts:144`) are the only address utilities.
4. **The flow's collector.**
   - No client-side signal code exists beyond the selfie snapshot's `webdriver` (§3). The flow CSP has no `worker-src` (a `blob:` worker is refused) and is a production-only `<meta>`; the serving-layer headers (`frame-ancestors`, `Permissions-Policy`, `Referrer-Policy`) are still not sent (PROGRESS `:1094`, still open).
   - There is **no bundle-size budget** to guard a collector's weight, and no consent key for signals or fingerprinting (only `consent.biometric-matching` has behaviour).
   - Only the hosted mode exists; there is no `@openverify/js` SDK and no `postMessage` channel for embedded collection.
   - Where collection is sent: the flow API takes only `GET`/`POST` with `authorization`, `content-type`, `x-request-id` under CORS (`routes/flow/index.ts:176-182`); every route is session-authenticated.
5. **Handoff.** No handoff token (`ovh_` is free), no QR in the flow (the only QR library is the dashboard's server-only `qrcode`), no flow step, no Android scan. Existing link mechanics: one-time links (`ovo_`) revoke the inquiry's older unused links; `resume` creates sessions without revoking any; there is **no cap on sessions per inquiry**; redemption is limited to 30/min per IP. Email: the `Mailer` port (SMTP via nodemailer, Mailpit in dev) is used by invitations and email OTP (`apps/api/src/mail/index.ts:1-5`; `services/otp/send.ts`). PLAN `:408` says QR only.
6. **Lists.**
   - No list, list-item or importer table, route, scope, event or console page. PLAN says 13 types (`docs/PLAN.md:67`), the surface 11 (no `faces`, no `selfie-backgrounds`) with six importers (`persona-surface.md:227-239,446-452`).
   - Value normalisation must match what is stored: the ID-number index hashes `<issuer>|<class group>|<number>` (`blind-index.ts:139-155`), the OTP index `<label>|<channel>|<destination>` (`:174-181`); C58 offers exact matchers for phones, emails and ID numbers (`packages/checks/src/matching/identifiers.ts`). A list of ID numbers without an issuer cannot join the existing index as is.
   - Face lists: `face_templates.source` is `'selfie'` only and rows are tied to a verification and inquiry with composite FKs (`tables/selfie.ts:117-152`); Phase 4 left "Lists: Face" and an ANN mode to Phase 7 (`docs/plans/phase-4.plan.md:218,477,488`); 1:N search decrypts up to 50,000 templates in process.
   - `id_compromised_detection` already accepts `compromisedList` and nobody supplies it (§15).
   - Matching on list items of names would sit on C58 (built) and, for fuzzy screening, on 6A's matcher (stubs at HEAD).
7. **CSV import.** No CSV parser, writer or formula-injection neutraliser exists; the only upload route is the flow's single-image route (10 MiB, `files: 1`); every `files` row needs a `verification_id`; an `Idempotency-Key` on a streamed multipart body is refused (`plugins/idempotency.ts:12-16`). The plan must choose the parser (licence check), size and row caps, whether the file is stored, and the import job.
8. **Graph.** No edge table, no `WITH RECURSIVE` anywhere (grep over `packages apps`), no graph library, no bulk-action endpoint or row selection, no tab primitive. Account relations (`account_relations`) are manual, directed, typed edges. The only shared-value lookups are the repeat checks (§9), which keep no edges. The plan must decide which attributes become edges (plaintext, HMAC, or per-environment index), how edges follow redaction, consolidation and retention, and query limits.
9. **Transactions.**
   - Field types: account types support 4 (`string`, `number`, `boolean`, `date`) with additive-only changes (`account-types.ts:17,96-117`); PLAN lists 9 (`docs/PLAN.md:69`), and the surface has `transaction-type.deleted-field` but no conversion event.
   - No custom-status machinery and no "labels" exist anywhere; tags are the only operator vocabulary.
   - The 6A report contract fixes `transaction` to `{ data: null }` "until Phase 7" (`packages/contracts/src/reports.ts:318-319`), and `reports.test.ts:100-118` asserts a non-null transaction is refused, using the literal `txn_` prefix (`:116`): adding transactions changes a 6A contract, its fixtures and the parity table.
   - `redact-biometrics` (surface `:539`) implies transactions can own biometric data (files or face templates); `files` and `face_templates` are verification- and inquiry-owned today.
10. **Event naming and filters.** The DB name check allows `graph-query.completed`, `transaction-type.deleted-field` and `list-item/<type>.created`-style names (one `/`, no digits; `columns.ts:47-48`). `EventSubject`, `SUBJECTS`, `PREFIX_BY_SUBJECT_TYPE`, the payload unions, the sample maps and `eventNameGroups` need each new subject (§11). Webhook filters know only templates and account types, so list, graph and transaction events are never filtered. The surface lacks `graph-query.submitted` and `transaction-type.converted-field`, which the plan may still adopt from Persona's events page (not checked here).
11. **Install-wide versus environment data.** Network data (DB-IP, Tor, cloud ranges) is install-wide and public; lists, graph and transactions are environment data. Install-wide tables exist (5B trust store; 6A watchlists planned), but tenancy tests, blind indexes, audit (no API-visible system actor) and retention assume an environment (`phase6-inventory.md` §9).
12. **PII, redaction and retention.** Every new sealed column joins `ENCRYPTED_COLUMNS`, `SEALED`, `REWRAP_TABLES`, `SUBJECT_PII_TABLES` or `OPERATOR_PII_TABLES` (the coverage test fails otherwise, `redaction.test.ts:158-171`), `REDACTION_SUBJECT_ID_PREFIXES`, `MASKED_ATTRIBUTES` (by attribute name at every resource; `pii-collisions.test.ts` refuses a PII name that is non-PII elsewhere, `:1-17`). Session IPs live as long as their inquiry (`inquiry-retention-days` default `null`), so any IP- or device-derived index inherits that. 6A has not yet added report rows to any of these lists.
13. **Scopes.** No scope exists for lists, importers, graph queries, transactions, transaction types or devices. The viewer role gets every new `:read` automatically; `PERMISSION_INFO` fails the dashboard typecheck until each new permission has an area and a label (§12).
14. **Rate limits.** A beacon, handoff redemption or importer gets only `flow-ip` (and `api` once authenticated) unless a policy is added to `RATE_LIMIT_POLICIES` (§12); limiter failures fail open.
15. **Migration number and test load.** The journal ends at `0019_submitted_verifications_index`; Phase 6 C73.1 still says "expected `0019`" (`docs/plans/phase-6.plan.md:261`), so 6A will take `0020` or later and Phase 7 follows 6A/6B. Each migration lengthens the PGlite migration in every DB unit test, which already hits 60 s hooks under load (PROGRESS `:130`).
16. **Android.** No device signal is collected; PLAN places root/emulator and Play Integrity in Phase 10 (`docs/PLAN.md:432`), while the brief puts ANDROID_ID and debugger detection in Phase 7. Only `INTERNET` and `CAMERA` permissions are declared. The SDK talks only to the session-authenticated flow API.
17. **Records.** PLAN `:67` (13 list types), `:69` (9 field types), `:117-118` (`packages/signals`, `sdk-js`, `sdk-react`), `:142` (FingerprintJS v3), `:147` and `THIRD_PARTY_LICENSES.md:337-340` (IP data rows "to verify"), `:270-271` (Cytoscape, FingerprintJS v3), `:394` (FingerprintJS v4+ excluded), `:408` (QR only), `:432` (Android signals in Phase 10), the surface's 11 list types and its missing events, and `CLAUDE.md:38` (stale layout, owner item) need reconciling with whatever the plan decides.

## 19. Conventions a new resource must follow (end to end, in order)

Derived from how the account resource (Phase 2), the Phase 5 types and 6A's report Stage 1a run through the code at `0dec467`, and from the commit pattern on `main` (`chore(...)` stub → `test(...)` RED → `feat(...)` GREEN → optional `refactor(...)`, each naming its contract ids, e.g. `07c3ae8b`, `ad67bf97`, `2478a8c5`). Evidence goes to `docs/tdd/phase7-<agent>.tdd.md`; every package stays ≥80% coverage; shared files change only through the stage that owns them.

**0. Plan:** `docs/plans/phase-7.plan.md` in the shape of `docs/plans/phase-6.plan.md` (Summary `:44`, Starting point `:61`, Patterns to mirror `:121`, Locked contracts `:140`, Workflows `:591`, Rules `:635`, Validation `:647`, Risks `:663`, Acceptance `:687`, Decisions `:699`).

**1. `packages/core`**
1. Scopes and role lists in `permissions.ts` (`API_SCOPES` `:9-41`, roles `:111-160`, `NOT_FOR_VIEWERS` `:101`), with `permissions.test.ts`.
2. Status enums and state machines with an `…_EVENT_BY_STATUS` map (`as const satisfies`), as `report-state-machine.ts`, `verification-state-machine.ts`; exported from `index.ts`.
3. Registries and constants (as `report-registry.ts:1-24,134`; checks through `defineCheck` in `check-registry.ts:309-365` with config defaults and a `basis` in `check-config/*.ts`).

**2. `packages/contracts`** (flat files; imports only zod, core, flow-spec and local modules — the `browser-safety.test.ts` rule)
1. `ids.ts` prefix (`:11-47`) and the `ids.test.ts` `toEqual` list (`:27-62`).
2. `resource-types.ts` (`RESOURCE_TYPES`, `:4-51`) and `identifiers.ts`.
3. `<resource>.ts`: attributes with `.meta({ pii: true })` marks and a `PII_<RESOURCE>_ATTRIBUTES` list (as `reports.ts:989`), relationships, resource/document/list schemas with `listQuerySchema('<prefix>', …)` (`list-filters.ts`), action bodies (`actions.ts`), `build<Resource>` builders that validate output.
4. `event-names.ts` lists, `EVENT_NAMES`, `SUBJECTS`, `EventSubject` (`:17-149`); `events.ts` `PREFIX_BY_SUBJECT_TYPE` and the `data`/`included` unions (`:33-121`).
5. `scopes.ts` (re-export) and `vocabulary.test.ts`; `problem.ts` codes; `rate-limits.ts` policies (`:8-32`) if limited.
6. Golden fixtures in `contracts/fixtures/api/<type>.json` (43 files today, e.g. `account.json`, `inquiry-session.json`, `report-watchlist.json`), `contracts/README.md` row, `fixtures.test.ts`; `pii-collisions.test.ts` passes.
7. `index.ts` exports; the OpenAPI snapshot is regenerated later by the API.

**3. `packages/db`**
1. `src/ids.ts` prefix (`:8-46`) and `ids.test.ts`.
2. `src/tables/<name>.ts`: `environmentId()` and composite FKs `(environment_id, <parent>_id)` → parent `(environment_id, id)`, a unique `(environment_id, id)` for children to reference (as `selfie.ts:79,140`), `idFormat`, `validTags`/`lowerTags`, sealed columns via `sealedColumn`, list indexes `(environment_id, created_at desc nulls first, id desc nulls first)`, partial indexes for sweeps; enums in `tables/enums.ts`.
3. Export from `src/schema.ts`; add to `schema.test.ts` `prefixedTables`/`tenantTables` where they apply (`:88-120`) or the phase's own tenancy test (`phase5-tables.test.ts`).
4. Migration by `pnpm --filter @openverify/db db:generate` (`packages/db/package.json:25`: drizzle-kit then prettier) into `packages/db/drizzle/00NN_<name>.sql` with `meta/` snapshot and journal; any extension created in the migration itself (`CLAUDE.md:77`) and loaded in `src/testing.ts` for PGlite; a `migrate.test.ts` assertion by journal index and a Testcontainers `migration-00NN.integration.test.ts` (as `migration-0018.integration.test.ts`).
5. Sealing: `ENCRYPTED_COLUMNS`, `SEALED` (`encrypted-columns.ts:22-93`), `schema-v2.test.ts`, `REWRAP_TABLES`/`ID_COLUMNS`/`BIGINT_IDS` (`repositories/key-rotation.ts:18-66`), a `kek:rewrap` test.
6. Blind indexes, if searchable: a label and function in `blind-index.ts`, a `rebuild…Indexes` repository function and its call in `apps/api/scripts/blind-index-rebuild.ts`.
7. Repositories `src/repositories/<name>.ts` (row mappers that open sealed values, keyset pagination via `pagination.ts`, `FOR UPDATE` / `SKIP LOCKED` where swept), exported from `repositories/index.ts` (33 `export *` lines).
8. Redaction: a header row and a `redact<Table>` helper called from `redactInquiryRecords`/`redactAccountRecords` (`repositories/redaction.ts:1-30,184-335`), the object-id list for event stubs, `REDACTION_SUBJECT_ID_PREFIXES` (`subject-ids.ts:17-24`), `aboutInquiries` (`repositories/events.ts:128`) if the inquiry timeline should show it.
9. Retention: an `EnvironmentSettings` key and resolver if it has its own window (`tables/tenancy.ts:37-53`, `repositories/retention.ts:36-75`), and a batch deleter or redaction selector (`:128-320`).

**4. `apps/api`**
1. Ports and providers if external data is needed: `ports.ts`, `providers/index.ts` (`PROVIDER_KINDS`, `PROVIDER_ENV_PREFIXES`, `PROVIDER_NAMES_BY_KIND`, `PROCESS_PROVIDER_KINDS`, `:68-170`), sandbox providers, `config.ts`, `.env.example`, compose, `docs/checks/sandbox-providers.md`; outbound calls only through `http/index.ts` clients.
2. Services `services/<name>.ts`: one transaction per write under the C40.6 lock order, `events.stage` inside and `events.dispatch` after commit, enqueue after commit, an audit entry per change (`auditEntryOf`, `services/context.ts`), masking through `piiMaskFor` and `MASKED_ATTRIBUTES` (`auth/pii.ts:26-35`) and `services/api-logs.ts:206`; builders in `services/resources.ts`.
3. Routes `routes/server/<name>.ts` as a `FastifyPluginCallbackZod<ApiDependencies>` with `config: { scopes }`, zod `schema` with `problemResponses(...)`, `optionalBody` for actions, registered in `routes/server/index.ts:29-42` (only plugin-registered routes reach `/openapi.json`, `CLAUDE.md:76`); flow routes in `routes/flow/` (session auth, CORS, `no-store`); dashboard routes in `routes/dashboard/`.
4. OpenAPI: a `NAMED_SCHEMAS` row (`plugins/openapi.ts:62-115`), then `pnpm --filter @openverify/api openapi:write` (`apps/api/package.json:24`) to refresh `docs/api/openapi.json`.
5. Webhooks: `webhooks/samples.ts` (`EVENT_FIXTURES` `:37`, `RESOURCE_FIXTURES` `:47`, `STATUS_BY_EVENT` `:68`); `events/subject.ts` if the resource needs filtering.
6. Jobs: an on-demand queue in the model of `jobs/index.ts:1-26` (job id = object id, attempts, backoff, `PermanentJobError`), processors in `startWorkers`; repeatable jobs as a `jobs/repeatable/<name>.ts` factory gated in the registry (`jobs/repeatable/index.ts:44-57`); CLIs as `apps/api/scripts/<name>.ts` plus a `package.json` script (counts only, never data; `retention-run.ts`, `kek-rewrap.ts`, `trust-anchors-sync.ts`); race tests as `*-race.integration.test.ts` / `sync-races.integration.test.ts`.
7. Settings: `services/settings.ts` keys and `routes/dashboard/settings.ts` if an environment setting is added.
8. Redaction tests: `services/redaction.ts`, `redaction.test-support.ts` (`SUBJECT_PII_TABLES` `:51-71`, `seedPiiSubject`).
9. Seed: `seed/dev-seed.ts` if sandbox data ships (its key already holds every scope, `:493-500`).

**5. `packages/node`:** a method group in `OpenVerifyClient` (`packages/node/src/client.ts:649-670`) and its builder in `resources(t)` (`:673-…`), types, guards and tests (6A's `ca272ad1` → `ff7d05c1` → `31807b13` sequence).

**6. `apps/dashboard`**
1. `PERMISSION_INFO` and `AREAS` (`components/operators/permissions.ts:8-68`).
2. `NAV_GROUPS` (`components/nav-items.ts:23-56`).
3. `lib/api/<resource>.ts` (node client or dashboard endpoint) and `renderPage` pages (`lib/api/page.tsx:1-25`).
4. Routes `app/<resource>/{page,layout,loading,error}.tsx`, `[id]/page.tsx`, `actions.ts` (`'use server'`, contract-validated forms, `revalidatePath`; `app/accounts/actions.ts:1-30`).
5. Tables and filters on `DataTable` (`components/data-table.tsx`) in the model of `inquiries-table.tsx` and `inquiry-filters.tsx`; sections on the inquiry and account pages (`lifecycle/inquiry-view.tsx` `OptionalSection`).
6. Labels (`lib/labels.ts`), event words (`lib/event-words.ts`), `eventNameGroups()` (`lib/api/events.ts:76-87`), and the type-coverage tests (`lib/report-type-coverage.test.ts`, `lib/verification-type-coverage.test.ts` style).
7. Mock routes and fixtures in `testing/routes/` and `testing/fixtures/`; mocked page tests with `routeApi()`; full-stack `e2e/tests/ui-<area>.spec.ts`.
8. `apps/dashboard/README.md`.

**7. Flow and Android** (when the resource has an end-user part)
- Flow: a flow-spec step (`packages/flow-spec/src/flow.ts`), its screen in `apps/flow/src/steps/`, strings in `i18n/locales`, CSP changes in `security/security-meta.ts` with its test, and `apps/flow/e2e/*.spec.ts`.
- Android: `commonMain` code first (ADR 0004), Kotlin `PascalCase.kt` filenames, `FlowApi` methods and `model/` serializers, tests in `commonTest`/`androidHostTest`, `koverVerify`.

**8. Docs, data and records**
- `docs/checks/<area>.md` (or a `docs/<area>/README.md`, as Phase 6 plans `docs/reports/`) with "What a pass means", sandbox values and limits.
- `THIRD_PARTY_LICENSES.md` rows moved from "to verify" to verified; data through `data/manifest.json` + `scripts/fetch_data.py` (fixed snapshots) or an operator sync with a committed manifest (changing data); `.gitignore`/`.dockerignore` entries.
- An ADR for any rule-4 interpretation (ADR 0005 is the model).
- `docs/research/persona-surface.md` corrections, PLAN §2/§3/§4.4/§6 amendments, a `docs/PROGRESS.md` entry; `CLAUDE.md` is an owner item.
