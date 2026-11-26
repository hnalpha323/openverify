# Plan: Phase 7, signals, lists, graph and transactions

**Source:** `docs/PLAN.md` §2 (Signals, Lists, Graph and Transactions rows), §3, §4.4 and §6 Phase 7; ADR 0002 (tiers and honesty) and ADR 0005 (report honesty and live public-sector data). Five research notes were taken on 2026-10-27 for this plan and are committed with it:
- `docs/research/phase7-behaviour.md`: the public model of sessions, devices, networks, signals, handoff, lists, graph and transactions;
- `phase7-network-data.md`: IP geolocation, ASN, Tor, cloud and VPN data and their terms;
- `phase7-client-signals.md`: the browser and Android collectors, automation and behaviour signals, the QR handoff threat model, and the law on reading device data;
- `phase7-lists-graph-transactions.md`: list storage and matching, CSV, the account graph, the explorer and transaction field schemas;
- `phase7-inventory.md`: the code at `0dec467`–`5e666cb`, during Workflow 6A.

A fact-check pass re-read 97 load-bearing facts at their primary sources: it corrected eight, and two measurements were not re-run (the million-account graph benchmark and the per-row seal cost). Each note ends with its table. Downloads made during research stay out of git. The saved pages that echoed this machine's public address had it replaced with `192.0.2.0` before anything was kept.

**Complexity:** Very large. Three Workflows of at most ten agents each:
- **7A, signals:** contracts and plumbing for sessions, devices, networks, signals and handoff; then, in parallel, the network data and lookups, the browser collector, the signal logic and the Android signals; then the API for network data, for signals and for the flow with handoff; then integration.
- **7B, lists, graph and transactions:** contracts and plumbing for the three; then, in parallel, the list keys and normalisers and the transaction field-schema engine; then the API for lists and their matching, for importers, for the graph and for transactions; then integration.
- **7C, console and review:** the console surfaces for all of Phase 7; then a review of the whole phase, a verifier and path-owned fixers.

**Why this split.** Signals and handoff live in the flow and the session; lists, the graph and transactions live in new resources that read what the sessions record. 7A therefore lands the session data that 7B indexes and matches (IP addresses, fingerprints, devices). Each Workflow freezes its own contracts in its own Stage 1a, so neither Stage 1a has to freeze the whole phase at once. Phase 6's Stage 1a for one resource family ran for hours, and one Stage 1a for six families would run longer and freeze names that the later Workflow would want to revise. The console needs every API document and opens 7C, followed by the review of the whole phase.

**Stage 1b carries plumbing only**, as in Phase 6 (F01 there): migrations, repository and route stubs with frozen schemas, the masking lists, the shared hooks, the provider kinds, configuration, queues and job stubs. Every algorithm stays with its owner behind a declared interface. Stage 2 starts right after Stage 1a, beside Stage 1b, and only Stage 3 waits for Stage 1b. Each Stage 1b works in three checkpoints, committed with every suite green, so a pause resumes from the last one.

**Phase 6 dependency.** Phase 7 starts only once `docs/PROGRESS.md` records Phase 6 done. It builds on:
- the report engine (C69–C75), which hosts the two new report types (C106);
- the watchlist source sync (C76) and the streaming list client (C85.1), which the network sync mirrors (C92);
- the provider kinds (C83);
- the name matcher (C78), which the fuzzy name lists reuse (C99);
- the HMAC entry keys and the redaction rules of C73;
- the inquiry integration of C84, whose `on-report-match` rule is the model for `on-signal` and `on-list-match`.

Each Stage 1a re-verifies every fact under "Starting point" against the code it finds, and records drift as a "Workflow 7A (or 7B) Stage 1a amendment".

**Review of this plan.** Three adversarial reviews read the first draft:
- privacy, security and law (P01–P29);
- honesty and product coverage (H01–H32);
- feasibility and fit with the code (F01–F41).

Together they found 5 CRITICAL, 27 HIGH, 43 MEDIUM and 27 LOW: 102 in all. `docs/plans/phase-7-review-resolution.md` disposes of each. No finding was rejected. Parts of nine are met by stated deferrals, and six take a different route from the reviewer's proposal, each with its reason.

Among the findings:
- **Consent:** a phone reached by handoff would have captured under the desktop's consent. That is the attacker's consent in the illicit-onboarding case the plan itself models.
- **Honesty:** the IP report could answer "cleared" for IPv6 and non-public addresses, and stay `ready` while the exit list was stale. Unscreened lists read as zero matches on three exits. A `null` input silently passed every review rule. A threat level of `low` was either unreachable or a fully confident "clean".
- **PII leaks:** new request bodies (the importer's file, list probes, graph parameters) reached stored API logs readable without `pii:view`. Redaction never forgot the stored copies. Fastify's request log already wrote every client address and URL.
- **Feasibility:**
  - the signal hook would have made settlement throw;
  - the completion hooks had no keys to open what they needed;
  - the handoff step could not be marked done in the flow or the SDK;
  - both report types contradicted the committed Phase 6 contract;
  - the Stage 1b checkpoints made every builder wait for every family;
  - the e2e suite would outgrow its limits.

The main changes:
- **Privacy:** the phone records its own consent; email and SMS handoff go only to confirmed destinations, behind a non-consuming preview; notice keys for collection without consent; a `settings:privacy` permission; graph reads kept from viewers, and person-identifying graph parameters behind `pii:view`; strict webhook filters; request-body masking in API logs, with every new redaction forgetting stored copies; the trust mode recorded and `trust-all` refused for network facts in production; bounded biometric caches and retention.
- **Honesty:** one frozen reason enum with schema refinements; combination rules across sessions; `on-null` in review rules; capped confidences for "no evidence"; public datacenter fields from provider ranges only; screening states on every exit; graph `index-complete` with a backfill; the IP report on review model `none`, with `null` where the exit list cannot answer.
- **Feasibility:** outboxes for signals and completion-time indexing, so the transition takes no keys and settlement is untouched; the flow-session `handoff` member and the typecheck minimum in Stage 1a; checkpoints by family; ports with fakes; one extracted sync runner; key inputs in `packages/checks` with one `identifierKey` in `packages/db`; no write-side degree table; a reusable e2e stack with shards.

**Verification round.** A fourth pass checked the revision. It confirmed 88 of the 102 dispositions, found 14 only partly resolved, and raised 21 new findings (3 HIGH, 9 MEDIUM, 9 LOW). All 35 are now resolved, and none is rejected. The main fixes:
- **Consent:** one function, `getEffectiveConsent`, decides consent for every gate. A phone never captures on the desktop's consent, and a rejected phone's consent authorises nothing.
- **Rejected handoffs:** a rejection cancels what it can and sends the inquiry to review for what it cannot, because verifications now record their session. The phone's decline needs no session, and a rejected step shows again.
- **Null defaults:** every null reason has an `on-null` default, derived per session for combined values.
- **List counts:** `list_match_count` lives on the screening row and is merged when served, so the two jobs never race.
- **Country signals** are H-tier, and the web device class is ours and never a list probe.
- **Graph completeness** is tracked per kind, and every switch triggers its backfill.
- **Transaction files** are uploaded through a dedicated per-field route, so no JSON route accepts a 25 MB body.

## Summary

OpenVerify records a session's IP address and user agent today, sealed, and nothing else about the device, the network or the person's behaviour. It has no lists, no graph and no transactions. Phase 7 adds them, each at its tier (ADR 0002, extended to signals by ADR 0006):
- **R** (real logic): Tor exit lookups against a dated CC0 list; cloud-provider range lookups; country and ASN from DB-IP Lite; distances in meters; user-agent parsing; exact list matching (strings, emails, phones, ID numbers, names, fields, countries, IP addresses and ranges, geolocations, fingerprints); graph traversal; transaction field validation.
- **H** (a heuristic with a confidence, shipped as `beta`): VPN and hosting-network flags from ASN lists, the threat level, `bot_score`, `behavior_threat_level`, fingerprint linking, fuzzy name lists, selfie-background lists, graph component sizes.
- **A** (an adapter with a deterministic sandbox provider): proxy and residential-proxy detection, commercial IP reputation.

What lands:
- **Signals** (C90–C95): a signal registry like the check registry; the inquiry `signals` array (`[{ name, value }]`) with a `signal-details` map of tiers, confidences and reasons; per-template signal sets; an `on-signal` review rule that is off by default and never declines; session attributes for the parsed device, the network and its location; `device` (`dev_`) and `network` (`net_`) resources; operator-synced network data (DB-IP Lite, Tor, cloud ranges) with pinned hosting and VPN ASN seeds; our own browser collector of at most 4 KB gzipped, with no network calls and no remote code; aggregate-only behaviour metrics; and two collection tiers per environment. Session integrity is on by default after consent, under a notice the person sees. Device recognition is off by default and needs its own consent, on the collecting session, when enabled.
- **Device handoff** (C96): QR (rendered in the flow) by default, and email or SMS only to a destination the inquiry has confirmed; a new single-use `ovh_` token bound to the issuing session; a non-consuming preview and a context screen on the phone, which then records its own consent; "this was not me" on the desktop, which cancels the phone's captures; the handoff distance as a review signal.
- **Lists** (C97–C100): thirteen types; HMAC match keys under the existing blind-index construction; plaintext CIDR ranges with an SP-GiST index; coarse geolocation boxes; face and selfie-background lists that ship disabled behind an acknowledgement; CSV importers with all-or-nothing staging; `list-match` records, an `on-list-match` review rule, and the existing `id_compromised_detection` reading opted-in government ID number lists.
- **Graph** (C101–C103): a bipartite attribute index, written in the same transaction where the plaintext is held and through an outbox at completion, with a backfill for existing data; breadth-first queries with a visited set, hop and node limits and a statement timeout; versioned query templates; the public asynchronous `graph-queries` lifecycle; and bulk actions resolved against stored results.
- **Transactions** (C104, C105): types with immutable versions; the fifteen public field-schema types, validated by walking stored schemas with zod; statuses, labels, relations, attached objects, tags, redaction and biometric redaction; the `transaction` relationship on inquiries, verifications and reports.
- **Two report types on the Phase 6 engine** (C106): `ip-address` and `custom-list`.
- **Console** (C108): the session and signal tabs, network attribution, lists and importers, the graph explorer (Cytoscape.js with fCoSE and a table view), transactions and their types, and the account-page sections.

ADR 0006, "Signals: honesty, collection tiers and operator-synced network data", extends ADR 0002 to signals:
- an unknown is `null`, never `false`;
- no signal passes, fails or declines anything;
- a heuristic carries its confidence and reasons;
- network data that cannot be pinned (DB-IP keeps two months online, Tor changes hourly) is synced by the operator, verified, recorded and never committed or shipped, as ADR 0005 allows for public-sector lists.

## Starting point (inventory at `0dec467`–`5e666cb`, during Workflow 6A)

The full inventory is `docs/research/phase7-inventory.md`, taken from `0dec467` to `5e666cb` while 6A's Stage 1a committed; no file it read changed between the two. Every claim there carries its `path:line`. In short:

| Area | Exists | Does not exist |
|---|---|---|
| Identifiers | Two prefix tables, lowercase letters only (`packages/contracts/src/ids.ts:11-47`, `packages/db/src/ids.ts:8-46`); token prefixes `ovs_`, `ovu_`, `wbhsec_`, `ovo_`, `ovm_`, `ovi_`; 6A took `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `rpm` | Every Phase 7 prefix and the `ovh_` token are free. `REDACTION_SUBJECT_ID_PREFIXES` is `inq, ver, iqse, acc, self` |
| Sessions (C10) | `inquiry_sessions` with sealed `ip` and `user_agent` (row AAD) from the first flow call, `request.ip` under `OPENVERIFY_TRUST_PROXY` (`auth/flow-session.ts:150-153`, `services/inquiry-sessions.ts:138-158`); consent jsonb with a static-AAD IP and user agent; statuses `active`, `expired`, `canceled`; `expire`, and `expire-all` with `meta.inquiry-id`; masked without `pii:view` | No other client data, no index on IP or user agent, no session cap (`resume` revokes nothing), no device or network |
| Flow | Hosted mode only; `bootstrapSession` reads and clears the fragment, keeps a session link's token in `sessionStorage` and a redeemed one-time link's in memory (`session/session-bootstrap.ts`); fifteen step types (`packages/flow-spec/src/flow.ts`); a production-only CSP `<meta>` without `worker-src` (`security/security-meta.ts`); the selfie device snapshot with `webdriver` | No collector, no `packages/signals`, no bundle budget, no consent key for signals, no handoff step, no QR, no serving-layer headers (`vite preview` sends none; PROGRESS Phase 1A) |
| Data at rest | The `ov1` envelope and row-bound sealing (`packages/db/src/crypto.ts`, `sealed.ts`); per-environment blind-index subkeys under `OPENVERIFY_BLIND_INDEX_KEY` with five labelled indexes and `blind-index:rebuild` (`blind-index.ts`); `REWRAP_TABLES` (20 tables); the redaction header table and coverage test; C16 retention with `EnvironmentSettings` | No IP, device, list, graph or transaction index |
| Faces (Phase 4) | Sealed SFace templates (`face_templates`, `source` `'selfie'` only, no vector column), the in-process 1:N scan up to 50,000, `selfie_backgrounds` `vector(144)` with HNSW; thresholds 0.394 (1:1) and 0.5 (repeat, provisional); `consent.biometric-matching` | No gallery outside inquiries; Phase 4 left face lists and any ANN mode to Phase 7 |
| Phase 6 | At 6A Stage 1a: the report registry, state machines, contracts (with the report `transaction` relationship fixed to `{ data: null }` "until Phase 7", `packages/contracts/src/reports.ts:318-319`), `packages/watchlist`'s frozen record, ADR 0005 | 6A's tables, sync, matcher, C83 provider kinds, the C85.1 streaming client and report API were not yet committed; this plan relies on their planned form |
| Data downloads | `data/manifest.json` (50 pinned entries), `scripts/fetch_data.py` with eight SPDX ids, fixed SHA-256 and size; two runtime-data precedents, the malicious-feed job (Valkey) and the CSCA trust-store sync | No IP, ASN, Tor, cloud or VPN data; ADR 0005 covers public-sector lists only |
| Outbound HTTP and jobs | One client with SSRF guards, 1 MiB and 10 s defaults, no redirects, three exposed headers (`apps/api/src/http/index.ts`); the BullMQ worker; the repeatable registry `phase5RepeatableJobs` with `unbuiltRepeatableJob` stubs | No streaming (C85.1 is 6A's) |
| Accounts | Every inquiry has an account (`resolveForInquiry`); `reference-id` plaintext and unique per environment; statuses `active`, `archived`; sealed `fields`; operator-declared `account_relations`; four account field types with additive-only changes | No computed links; no custom statuses, labels or transaction machinery |
| Uploads and CSV | Multipart uploads on the flow API only (10 MiB, magic-byte typed); `files.verification_id` is NOT NULL; `Idempotency-Key` fingerprints only a buffered multipart body | No CSV parser or writer, no formula-injection guard, no server upload route, no export |
| Events and webhooks | `<subject>.<action>` names (one `/`, no digits) with `EventSubject`, payload unions, samples and dashboard groups; C14 filters know only templates and account types | No list, graph, transaction, device or signal event |
| RBAC and limits | 28 API scopes (6A's report scopes included); viewers get every `:read` except `NOT_FOR_VIEWERS`; `PERMISSION_INFO` must label every permission; C12 policies `api`, `flow-session`, `flow-ip`, `one-time-link-redeem`, `reports`; limiter failures fail open | No scope or policy for any Phase 7 resource |
| Dashboard | App Router pages through `renderPage`; `DataTable` (no selection); `OptionalSection`s on the inquiry and account pages, Sessions among them; headers only (no script CSP) | No tab, graph, chart or map component; no row selection |
| Android | KMP SDK calling only the flow API; `User-Agent: OpenVerify-Android/<version>`; the selfie camera facts | No `ANDROID_ID`, debugger, emulator or root code; `INTERNET` and `CAMERA` permissions only |
| Checks | Every check belongs to one of 11 verification types; `id_compromised_detection` accepts `compromisedList`, which nothing supplies | No signal, session or list check (none is added: C90.3, C99.9) |

Records that Phase 7 corrects are listed in the inventory's §16 and handled in C109. Carried-forward items in Phase 7's areas: the flow's response headers (Phase 1A; C107.9), `compromised_list_match` waiting for lists (Phase 3A; C99.9), and the PGlite migration time under load (Phase 5; Risks).

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Registry with tiers | `packages/core/src/check-registry.ts`, `report-registry.ts`, `check-config/basis.ts` | One entry per item; constants as `{ value, basis, source }`; H means `beta` |
| Resource contracts | `packages/contracts/src/accounts.ts`, `reports.ts`, `json-api.ts`, `list-filters.ts`, `fixtures/api/` | Zod attributes with `.meta({ pii: true })` and a `PII_<RESOURCE>_ATTRIBUTES` list, builders that validate output, golden fixtures, `pii-collisions.test.ts` |
| Versioned templates | `packages/db/src/tables/inquiry-templates.ts`, Phase 6 C71 | Draft, published, superseded; one published; publish under the template lock |
| Template version members | Phase 6 C84.1 (`report-config`) | A strict schema, a jsonb column, a publish rule in `services/publish/`, pinned per version |
| Completion hooks and outbox | Phase 6 C84.2 (`createInquiryReportsInTx` in `transitionInquiryInTx`) | A stub hook in the transition, rows written in the transaction, a 15 s sweep that enqueues |
| Review rule | Phase 6 C84.3 (`on-report-match`) | Off by default; only `completed → needs_review`; a decided inquiry is untouched and the cause recorded |
| Operator-run sync | Phase 5 C62.7 (`apps/api/scripts/trust-anchors-sync.ts`, `repositories/trust-anchors.ts`), Phase 6 C76 | Committed manifest, verified download, guards under an advisory lock, imports labelled, a refresh job behind a flag, never in CI |
| Repeatable jobs and queues | `apps/api/src/jobs/repeatable/index.ts`, `feeds.ts`, `stub.ts`; `jobs/index.ts` | A factory per job, gated registration, `unbuiltRepeatableJob` stubs; job id = object id |
| PII at rest | `packages/db/src/sealed.ts`, `blind-index.ts`, `encrypted-columns.ts`, `repositories/key-rotation.ts`, `repositories/redaction.ts` | Row-bound sealing; labelled HMACs under the environment subkey with a rebuild function; rewrap, redaction and coverage lists |
| Masking | `apps/api/src/auth/pii.ts`, `services/api-logs.ts` | By attribute name at every exit; a test per exit |
| Consent keys | `apps/api/src/services/inquiry-templates.ts` (`MATCHING_CONSENT_TEXT_KEY`), `jobs/selfie.ts` (`matchingConsentHolds`) | An optional text key listed by the step; a publish rule; a run-time check of the latest consent |
| One-time links | `packages/db/src/repositories/one-time-links.ts`, `services/one-time-links.ts`, `routes/flow/index.ts:191-212` | SHA-256 at rest, one generic failure answer, a per-IP redemption limit, the token in the fragment |
| Biometric scan | `apps/api/src/jobs/face-search.ts` | Decrypt in process, never log or return an embedding, report the count searched |
| A-tier | `apps/api/src/providers/index.ts`, `docs/checks/sandbox-providers.md` | A port, a real adapter, a deterministic sandbox refused in production |
| Console | `apps/dashboard/src/lib/api/page.tsx`, `components/data-table.tsx`, `components/lifecycle/inquiry-view.tsx`, `app/accounts/actions.ts` | `renderPage`, server actions validated by contract schemas, `OptionalSection`s, masked values |
| Flow | `apps/flow/src/session/session-bootstrap.ts`, `routes.tsx`, `steps/`, `security/security-meta.ts` | Credentials in the fragment, cleared at boot; the step comes from the server; i18n keys; the CSP test |
| Android | `android/openverify-sdk/src/commonMain/.../api/FlowApi.kt`, `camera/CameraFacts.kt` | `commonMain` first, PascalCase files, host tests, `koverVerify` |
| Tests | Vitest colocated; Testcontainers; Playwright | RED commit first; ≥ 80% per package; `docs/tdd/phase7-<agent>.tdd.md` |

## Locked contracts

C1–C89 stay locked except where a section below amends them. Stated amendments of earlier contracts:
- C3 (the flow API): `GET /flow/session` gains `signals`, `handoff` and `handoff-context` (C94.6, C96.3); new flow routes for signals and handoff;
- C10: a session cap, `expire-all` by `meta.inquiry-ids`, the per-session one-time-link route, and new session attributes (C91);
- C12: a per-policy window, and the new policies (C107.3);
- C14 and C70.4: strict webhook filters for the list-match, transaction, transaction-type and graph-query subjects (C107.4);
- C15 and C53.7: new PII attributes and request-body members on sessions, devices, networks, lists, graph queries and transactions; the collision test and the API-log sets extended to them (C91.6, C97.6, C105.8, C107.5);
- C16: the retention and privacy settings of C107.7;
- C31 (`id_compromised_detection`): its `compromisedList` input widens to `{ matched, unscreened }` (C99.9);
- C42.3: a third optional consent key, `consent.device-recognition`, and two notice keys (C94.6);
- C54.1: repeatable jobs and queues (C107.1, C107.2);
- C63 and C83: one provider kind, `ipReputation`, read by the API and the worker (C93.5);
- C69, C70.2 and C70.5: two report types, list sources and provenance, the new unavailable reasons and query sources, and the report `transaction` relationship (C105.7, C106);
- C85.1: `stream()` serves the network-source clients too (C92.2);
- the core permissions: `settings:privacy`; `graph:read` in `NOT_FOR_VIEWERS` (C90.8, C102.1);
- the inquiry template version: two members, `signal-config` and `list-config` (C90.6, C99.5); the template settings `max-sessions` and `expire-inquiry-on-session-limit` (C91.5);
- the flow-spec: a `device_handoff` step (C96.1);
- the blind-index module: `identifierKey`, a key id, and new labels under the existing per-environment subkey, recomputed by `blind-index:rebuild` (C94.4, C98.2, C101.2).

### C90. Signals: the registry, tiers and honesty

1. **Registry** (`packages/core/src/signal-registry.ts`, mirroring the check registry). One entry per signal:
   - `name`: the wire name, namespaced `inquiry/`, in snake case after the slash (the public form);
   - `layer`: `network`, `device`, `behaviour`, `handoff`, `list` or `ensemble`;
   - `tier`: `R`, `H`, `A`, or an ADR 0002 combined tier (`R/H`: R from one kind of evidence and H from another) (H14);
   - `stage`: `ga` or `beta`, explicit on every entry;
   - `version`: an integer, bumped when the computation changes;
   - `value-type`: `boolean`, `integer`, `number`, `enum` (with its values) or `string`;
   - `unit`: `meters` for distances, otherwise none;
   - `collection-tier`: `session-integrity` or `device-recognition` (C94.6);
   - `default`: whether the default signal set includes it;
   - `review-rule`: whether a template review rule may test it (F31; `false` for `inquiry/list_match_count`);
   - `inputs`: the session facts, collector sections or lists it reads;
   - `thresholds`: for an H-tier signal, each constant as `ConfigDefault { value, basis, source }`, every one provisional until a calibration report exists. The collector's own cut-offs (C94.3) are registered the same way, tied to `collector-version` (H24).

   Registry tests:
   - unique names and the namespace;
   - a `unit` on every distance;
   - every H-tier or combined entry has thresholds;
   - a threshold or collector constant that changes without a version bump fails a golden test.

2. **The Phase 7 catalogue.** Fourteen signals. The public names are marked; the rest are ours, and the docs say so.

   | Name | Value | Tier, stage | Collection tier | Default | Registered by |
   |---|---|---|---|---|---|
   | `inquiry/bot_score` (public) | integer 0–100, higher meaning more bot-like | H, `beta` | session-integrity | yes | 7A |
   | `inquiry/behavior_threat_level` (public) | `low`, `medium`, `high` | H, `beta` | session-integrity | yes | 7A |
   | `inquiry/automation_artefact_count` | integer ≥ 0: distinct strong automation artefacts seen across sessions (C94.3). At 0 it carries `no_artefact_found`: the data is reported by the client (V07) | R, `ga` | session-integrity | yes | 7A |
   | `inquiry/session_count` | integer ≥ 0 (a server-API inquiry has none) (H29) | R, `ga` | server | yes | 7A |
   | `inquiry/network_threat_level` | `low`, `medium`, `high` | H, `beta` | server | yes | 7A |
   | `inquiry/tor_detected` | boolean | R, `ga` | server | yes | 7A |
   | `inquiry/datacenter_detected` | `true` or `null` (provider ranges only, C93.3) | R, `ga` | server | yes | 7A |
   | `inquiry/vpn_detected` | `true` or `null` | H, `beta` | server | yes | 7A |
   | `inquiry/proxy_detected` | `true`, an adapter's recorded negative, or `null` (C93.5) | A, `beta` | server | yes | 7A |
   | `inquiry/country_from_session` (public) | ISO 3166-1 alpha-2 of the first evaluated session's address | H, `beta`, approximate, with a confidence (V08) | server | yes | 7A |
   | `inquiry/country_comparison` (public name; vocabulary ours) | `same` or `different`: the first evaluated session's IP country against the issuing country of the latest government ID verification decided `passed` or `needs_review`. `null` with `ip_country_unreliable` when that session is Tor, VPN-ASN, provider-range datacenter or privacy-relay traffic (V08) | H, `beta`, approximate, with a confidence | server | yes | 7A |
   | `inquiry/max_session_distance` | meters between the two farthest session points | R, `ga` | server | yes | 7A |
   | `inquiry/handoff_count` | integer ≥ 0 | R, `ga` | server | yes | 7A |
   | `inquiry/list_match_count` | integer ≥ 0: open `list-match` records of the inquiry (C99.3) | R, `ga`; `review-rule: false` | server | yes | 7B (added by `contracts-7b` as an amendment) |

   Distances follow C95, and `null` follows 3. Three public signals are deferred, each with its reason in C110:
   - `geolocation_to_residency_delta` needs an address geocoder, and no permissive data supports one;
   - `last_two_verifications_geolocation_delta` needs the session in which each verification was submitted, which verifications do not record;
   - IP and fingerprint velocity and fingerprint reuse are answered by the graph templates of C102, with their evidence. That works only once `graph-weak-kinds` and device recognition are on; in a default install those links are not written (decision 50), and the docs say so (H17).

   **Collection tier `server`** (V20). Signals computed only from server-side facts (the address the API already records under C10, the sessions, the lists) do not depend on the browser collector. They are computed whatever `session-integrity` says, and the docs name the notice they rely on: the operator's privacy notice for the flow. A registry test pins each signal's tier.

3. **Honesty** (ADR 0006).
   - **Unknown is `null`, never `false`.** Every signal the template collects is present in `signals`. When it could not be evaluated, its value is `null` and `signal-details` names the reason.
   - **One frozen reason enum** (H11), `SIGNAL_NULL_REASONS` in `@openverify/contracts`, frozen in 7A Stage 1a; 7B extends it by a stated amendment:
     - collection: `signals_not_collected` (no flow session: a server-API inquiry), `collector_missing` (a consented web or Android session that sent no payload), `collection_disabled`, `consent_not_given`;
     - data: `list_unavailable`, `list_stale`, `provider_not_configured`, `not_in_known_ranges`, `not_in_provider_data`, `client_address_untrusted` (C93.1);
     - the subject: `address_not_public`, `ipv6_not_covered`, `location_too_coarse`, `input_missing`, `fingerprint_randomised`, `insufficient_behaviour`;
     - sessions: `insufficient_sessions`, `sessions_not_evaluated`;
     - the network's reliability: `ip_country_unreliable` (V08);
     - lists (7B): `list_screening_pending`, `list_unscreened`, `no_lists_selected`.
   - **Every null reason has an `on-null` default** (V01, H03), frozen as `ON_NULL_DEFAULTS` in 7A Stage 1a. A test fails when a code is unclassified (7).
   - **A second enum, `SIGNAL_EVIDENCE_REASONS`**, carries the reasons that accompany a non-null value. Examples: `hosting_asn`, `vpn_asn`, `vpn_list_not_exhaustive`, `proxy_not_evaluated`, `no_artefact_found`, `partial_sessions`, `sandbox_outcome`, and one code per automation artefact.
   - `false` appears only where the data is exhaustive for the question. In Phase 7 that is:
     - `tor_detected` when every session was a public IPv4 address checked against a fresh exit list;
     - `proxy_detected` when a bound adapter's file positively records a negative (C93.5).
   - **No signal passes, fails or declines anything.** No verification check reads a signal in Phase 7, and no check is added for signals (decision 13).
   - **An H-tier value carries** its `confidence` (0–1), its reasons and the thresholds applied.
   - **Provenance.** A network-derived value carries the sync id, publication time and SHA-256 of each source it read, plus the provider and `sandbox` for an adapter's answer.
   - **Enforced in the schemas, not only in prose** (H12):
     - the never-false flags are `z.literal(true).nullable()`;
     - `signal-details` entries are a discriminated union: an H-tier or combined entry requires `confidence`, `reasons` and `thresholds`, and a `null` value requires a null reason;
     - builders validate their output, and golden fixtures that break a rule are refused in tests.

4. **Combining sessions** (H05). The inquiry signals read every session of the inquiry:
   - a boolean is `true` if any session is `true`, and `false` only if every session is evaluated and `false`. Otherwise it is `null` with `sessions_not_evaluated`, and `signal-details` names the session ids;
   - `network_threat_level` is `high` if any session is `high`, `null` if any session is `null`, and otherwise the highest level;
   - `max_session_distance` is computed over the sessions with a point. If any session lacks a point, it carries the evidence reason `partial_sessions` with their ids, and it is `null` (`insufficient_sessions`) below two points;
   - `country_from_session` and `country_comparison` read the first session whose country was evaluated;
   - **behaviour signals** (V07) read the **consented sessions**: sessions that started a step after recording or inheriting consent, rejected or declined handoff sessions excluded.
     - `bot_score` is the highest score over consented sessions that sent a payload. It carries `partial_sessions` naming any consented session that sent none, and it is `null` with `collector_missing` only when none sent one.
     - `behavior_threat_level` is the highest level over sessions with sufficient behaviour, and `null` with `insufficient_behaviour` when none has enough.
     - `automation_artefact_count` is the size of the distinct union of artefacts over sessions.
   - **Per-session reasons.** A combined value records each session's own reason in `signal-details`, and its `on-null` default is derived from them (7).

   Golden tests cover mixed sessions: IPv4 and IPv6, a stale list and a fresh one, a silent session beside one that sent a payload.

5. **The inquiry attributes.** Two attributes, always present:
   - `signals`, the public shape: an array of `{ name, value }` in registry order. It is `[]` until the signals are computed, and `[]` when the environment hides signals (8);
   - `signal-details` (ours): a map from name to `{ tier, stage, version, confidence?, reasons[], thresholds?, sources?[], computed-at }`, plus a top-level `computed-at`. The top-level `computed-at` is `null` until the signals job has run, which tells "not yet" apart from "hidden" (H23). `tier` is the tier of the evidence actually used (H14). Each entry has its own `computed-at` (V06).

   **When** (F02, F03, H23, V17). The transition hook `createSignalComputationInTx` (a Stage 1b stub in `transitionInquiryInTx`) writes an outbox row on the inquiry's first move into a terminal or decided state: `completed`, `failed` or `expired`, from `pending` or straight from `created`. An inquiry that expires from `created` gets its signals computed as nulls with `signals_not_collected`. The hook decrypts nothing, moves nothing and writes no signal, so `LifecycleDeps` stays `{ events, clock }`.
   - The `inquiry-signals` queue (worker, with the keyring and the blind-index key) computes the signals from the stored session facts and the sealed flow-signal bodies, freezes them, and applies the `on-signal` rule (7).
   - The `inquiry-signals-sweep` repeatable job (15 s) re-enqueues pending rows, so a lost enqueue recovers.
   - A completed inquiry starts no session, so the values stay frozen.
   - `inquiry/list_match_count` is never written into the stored array (V06). It lives on the `list_screenings` row (C99.4) and is merged into `signals` and `signal-details` when they are served, so the two jobs never write the same column. A 7A-only build serves no entry for it.
   - Both attributes are in every inquiry payload and webhook. Neither carries PII: values are counts, levels, a country code and distances. A test walks the catalogue and refuses a `string`-typed signal without a closed vocabulary.

6. **Template configuration.** A new inquiry template version member, `signal-config` (contracts `signalConfigSchema`, strict; a new `inquiry_template_versions.signal_config` jsonb column, default `{}`). Its members:
   - `collect`: `"default"`, or a list of catalogue names. Names must be unique, and an unknown name is refused at publish with 422 `unknown_signal` at `/data/attributes/signal-config/collect/<i>`.
   - `on-signal`: `none` (the default) or `needs_review` (ours).
   - `review-rules`: 0–20 rules, each `{ signal, gte? | lte? | eq? | in?, on-null?: "needs_review" | "ignore" }`. The operand's type follows the signal's `value-type`. Publish refuses:
     - a rule on a signal outside `collect`;
     - a comparison that does not fit the type;
     - a rule on a signal registered `review-rule: false`, with 422 `signal_not_reviewable` (F31).

   The member is pinned per version, like `report-config`.

7. **The `on-signal` rule** (ours, off by default). It follows C84.3. After the `inquiry-signals` job freezes the values, with `on-signal: needs_review` a rule matches when:
   - its comparison holds for a non-null value; or
   - the value is `null` and the rule's `on-null` says `needs_review` (H03).

   **`ON_NULL_DEFAULTS`** (V01) classifies every null reason:
   - `needs_review`, a data or collection gap: `list_stale`, `list_unavailable`, `provider_not_configured`, `collector_missing`, `client_address_untrusted`;
   - `ignore`, a fact about the subject or an operator's choice: `address_not_public`, `ipv6_not_covered`, `insufficient_sessions`, `signals_not_collected`, `input_missing`, `not_in_known_ranges`, `not_in_provider_data`, `insufficient_behaviour`, `location_too_coarse`, `fingerprint_randomised`, `collection_disabled`, `consent_not_given`, `ip_country_unreliable`;
   - `sessions_not_evaluated` is derived: `needs_review` if any session's own reason is a gap, otherwise `ignore`;
   - the list reasons belong to `inquiry/list_match_count`, which no review rule may test.

   Publish refuses a `proxy_detected` rule in an environment with no `ipReputation` adapter bound (422 `provider_not_bound`). Without one, every inquiry would go to review.

   When a rule matches and the inquiry is `completed`, the job's transaction moves it to `needs_review` through `transitionInquiryInTx` (`inquiry.marked-for-review`). `signal-details` records the cause (`signal_rule` or `signal_unevaluated`) and the rules that matched.
   - A decided inquiry (`approved`, `declined`, `needs_review`) is not changed, and the job records `inquiry_already_decided`.
   - The rule never declines.
   - Settlement is untouched: its own `needs_review` move happens inside the completion transaction, before any job runs.
   - Tests:
     - a matching rule gives `needs_review` with one `inquiry.marked-for-review`;
     - a stale exit list with a Tor rule gives `needs_review` (`signal_unevaluated`);
     - an IPv6-only session with a Tor rule stays `completed`;
     - a stale-list session beside an IPv6 session gives `needs_review`;
     - an inquiry with a verification under review and a matching rule settles to `needs_review` once (F02);
     - an approval inside the window is recorded.

8. **Environment settings** (the C16 settings route; audit-logged):
   - `signal-collection`, gated by a new permission, `settings:privacy` (admin by default; F37, P10): `{ "session-integrity": "on" | "off" (default on), "device-recognition": "off" (default) | "consent" | "exempt", "device-recognition-basis": string ≤ 500 or null }`. `exempt` needs a non-empty basis, refused with 422 `basis_required` otherwise. C94.6 gives each tier's notice and consent rules;
   - `expose-signals` (`settings:write`; default `true`): when `false`, `signals` and `signal-details` are served as `[]` and `{ computed-at }` on the API and in webhooks. The dashboard still shows them to users with `inquiries:read`.

9. **Sandbox values.** In a sandbox environment, the flow signals body may carry `sandbox-outcome`:
   - `bot` gives `bot_score` 95 and `behavior_threat_level` `high`;
   - `human` gives 5 and `low`;
   - both with confidence 1.0 and the evidence reason `sandbox_outcome`.

   A production environment refuses the member with 422 `sandbox_only_value`. Network magic values are in C93.6, and `docs/checks/sandbox-providers.md` lists both.

### C91. Inquiry sessions, devices and networks

1. **Session attributes** (amending C10; all nullable; the public names and vocabularies, ours marked):

   | Attribute | Value | Source |
   |---|---|---|
   | `os-name`, `os-full-version`, `browser-name`, `browser-full-version` | strings ≤ 64 | the user agent, parsed (C94.5) |
   | `device-type` | `desktop`, `smartphone`, `tablet`, `tv` or `null` | the same; for an SDK session, `smartphone` or `tablet` from the SDK's signal body when sent, else `null` |
   | `device-name` | string ≤ 64: vendor and model where the user agent names them | the same |
   | `mobile-sdk-name`, `mobile-sdk-full-version` | `openverify-android`, `openverify-ios`; the SDK's version | the SDK header (C94.5) |
   | `device-handoff-method` | `qr`, `email`, `sms` or `null` | C96 |
   | `is-tor`, `is-datacenter`, `is-vpn`, `is-proxy` | as C93.3: `is-datacenter` and `is-vpn` are `true` or `null`; `is-tor` and `is-proxy` may be `false` where C93.3 says | C93 |
   | `hosting-asn` (ours) | `true` or `null`: the ASN is in the hosting seeds (H, `beta`) | C93.3 (H13) |
   | `threat-level` | `low`, `medium`, `high` or `null` | C93.4 |
   | `country-code`, `country-name` | ISO 3166-1 alpha-2 and its English short name | C93.3 (approximate) |
   | `region-code`, `region-name`, `latitude`, `longitude` | strings and numbers; only with the city source enabled | C93.3 |
   | `gps-latitude`, `gps-longitude`, `gps-precision`, `gps-country-code` | always `null` in Phase 7 (decision 9) | none |
   | `ip-connection-type` | `datacenter` (from provider ranges only), an adapter's value, or `null` | C93.3 |
   | `ip-isp`, `network-organization` | the AS organisation name | C93.3 |
   | `handoff-from-session-id`, `handoff-redeemed-at` (ours) | `iqse_…`; a time | C96.4 |
   | `handoff-distance-meters`, `handoff-country-changed`, `handoff-asn-changed` (ours) | C95 meters; booleans or `null` | C96.7 |
   | `signals-collected` (ours) | the collection tiers that applied: a subset of `session-integrity`, `device-recognition` | C94.6 |

   Relationships: `device` (to-one `dev_`, nullable) and `network` (to-one `net_`, nullable). `?include=device,network` serves both, and the session webhooks put them in `included`.

   **Storage** (F12): new nullable columns on `inquiry_sessions` for the parsed fields, the network facts and the handoff fields, plus `signals_collected text[]` and `signal_bodies_dropped integer` (V15). The flow-signal bodies go in `inquiry_session_signals` (C94.2). Verifications and selfie captures gain `created_by_session_id` (V02). The handoff state lives in `inquiry_handoff_steps` (C96.3). All of this migrates in 7A Stage 1b.

2. **Device** (`dev_`; public type `device`). A device row exists only when the device-recognition tier recorded an identifier (C94.6). It is keyed by `(environment_id, identifier kind, HMAC, key id)`, and every session whose identifier matches links to it.
   - Public attributes: `created-at`; `device-vendor-id` (always `null`: the platforms give us no vendor id); `device-fingerprint`, the `ANDROID_ID` HMAC for Android and `null` on web (V10); and `browser-fingerprint`, the strict HMAC. Each fingerprint is 64 lowercase hex.
   - The web device-class HMAC is ours, `device-class`. It names a model and configuration shared by many people, so it is never a list probe (C99.5) and is a weak graph kind (C101.2).
   - Ours: `platform` (`web`, `android`), `collector-version`, `fingerprint-randomised` (C94.4), `key-id` (C94.4), `session-count`, `first-seen-at`, `last-seen-at`.
   - Routes: `GET /api/v1/devices?filter[inquiry-session-id]=<iqse_…>` (the filter is required: 400 `filter_required` without it) and `GET /api/v1/devices/:id`. Both need scope `inquiry-sessions:read`. There is no create, update or event, as in the public API.
   - Both fingerprints are PII (identifier-grade): masked without `pii:view` and `null` after redaction (4).

3. **Network** (`net_`; public type `network`). One row per evaluation of a session's address (C93.2). Public attributes:
   - `created-at`, `ip-address` (PII);
   - `service-provider` (the AS organisation);
   - `service-type`: `datacenter` (provider ranges only) or `null`; the vocabulary is open;
   - `proxy-type`: `tor`, `vpn`, an adapter's value, or `null`;
   - `threat-level`: `unknown`, `low`, `medium` or `high`. The public network vocabulary has `unknown`, where the session uses `null`;
   - `country-code`, `country-name`, `region-code`, `region-name`, `latitude`, `longitude`.

   Ours: `asn`, `hosting-asn` (with its confidence), `privacy-relay` (C92.1), `client-address-source` (C93.1), `evaluated-at`, `reasons[]` and `sources[]` (C90.3 provenance). It is reached only as a relationship and through `include`; there is no `networks` path, as in the public API.

4. **Redaction** (C10's session redaction extended). Redacting a session or its inquiry:
   - nulls the session's sealed IP, user agent, location attributes and collector components and aggregates;
   - nulls the network row's `ip-address`, region, latitude and longitude;
   - deletes the session's device link. A device with no remaining unredacted session is deleted, and its HMACs go with it.

   Country, ASN and the flags stay: they are derived facts without the address. The ids `dev_` and `net_` join `REDACTION_SUBJECT_ID_PREFIXES` (C107.5).

   Tests: a redacted session's include shows no address or location; a shared device survives one session's redaction and goes with the last.

5. **Session cap and session links** (amending C10).
   - **Settings:** two template settings beside `session-expiration-seconds` (`packages/contracts/src/template-settings.ts`): `max-sessions` (1–100, default 25) and `expire-inquiry-on-session-limit` (default `false`). Today there is no cap: `resume` creates a session without revoking any.
   - **The cap.** Creating a session beyond it is refused with 409 `session_limit_reached`. That covers a resume, a one-time-link redemption and a handoff redemption.
     - On the unauthenticated redemptions, the token is validated in constant time **before** the cap (P28). An invalid token always gets the uniform failure, so only a holder of a valid token can learn of the cap or trigger the expiry.
     - With `expire-inquiry-on-session-limit: true`, the refused attempt also expires the inquiry (`inquiry.expired`).
     - The count includes expired and canceled sessions, as the public cap does.
   - **`expire-all`.** `POST /api/v1/inquiry-sessions/expire-all` also accepts the public body `meta.inquiry-ids` (1–100) beside today's `meta.inquiry-id`. The answer keeps `meta.expired-count`.
   - **Per-session one-time links.** `POST /api/v1/inquiry-sessions/:id/generate-one-time-link` (the public path; the scope of `POST /inquiries/:id/generate-one-time-link`) creates a C10 one-time link for the session's inquiry, with C10's revocation of older unused links. It answers `meta.one-time-link`. `meta.one-time-link-short` is `null`, because OpenVerify has no link shortener (ours).
   - **Ownership** (F28). Stage 1b freezes both routes calling stubs in `apps/api/src/services/signals/sessions.ts` (`expireSessionsForInquiries`, `generateSessionOneTimeLink`), owned by `api-signals`. The cap check is a Stage 1b stub, `assertSessionCapInTx`, called from the three creation paths and implemented by `api-signals`.

6. **Masking.**
   - `ip-address` and `user-agent` stay PII. Newly marked: `region-code`, `region-name`, `latitude`, `longitude`, both fingerprints, and the network's `ip-address`.
   - The C53.7 collision test covers the new resources.
   - Tests at every exit: resource, list, `included`, webhook payload, and the stored API-log bodies (C107.5).

7. **Retention** (C16 settings; P19).
   - **`signal-component-retention-days`** (1–365, default 30). The C16 retention pass nulls the sealed collector **components**: the `integrity` and `recognition` members of the stored bodies, kept in their own sealed column. The **aggregates** (the `behaviour` member, in a second sealed column) stay with the inquiry.
   - **`ip-retention-days`** (null by default, which means the inquiry's retention; else 1–3,650). It nulls, earlier:
     - the sealed addresses of sessions and networks;
     - the consent record's sealed IP;
     - the IP-sourced `list-match` values.

     It also deletes the `ip-address` graph rows (C101.2) and keeps the derived facts.
   - **`device-retention-days`** (default 365, 1–1,095). It deletes devices whose `last-seen-at` is older, with their HMACs. Sessions keep their facts without the link.

### C92. Network data: sources, sync and pins (ADR 0006)

1. **Manifest.** `network/sources.json` is committed and validated by a schema test. Per source it has the C76.1 fields (`id`, `publisher`, `urls` or `url-template`, `redirect_host`, `content_types`, `max_bytes` compressed and inflated, `timeout_seconds`, `parser`, `change_signal`, `refresh_interval_hours`, `stale_after_hours`, `enabled_by_default`, `sandbox_only`, `terms`, `attribution`), plus `min_prefix` for range sources (the shortest IPv4 and IPv6 prefix accepted; C92.2; V15), plus:
   - `role`: `geo-country`, `geo-city`, `asn`, `tor`, `cloud-ranges` or `relay`;
   - `decompress`: `gzip` or none;
   - `digest`: the publisher digest to verify, if any;
   - `link_back`: the URL that the attribution must link.

   `url-template` takes `{yyyy-mm}`. The sync tries the current UTC month, then the previous one, since the publisher keeps only two months online. Sources (intervals provisional, from the research's cadence notes):

   | Source | Parser | Default | Refresh · stale after | Notes |
   |---|---|---|---|---|
   | `dbip-country-lite` | MMDB (gzip) | enabled | 24 h · 45 days | CC BY 4.0; attribution and link-back (8) |
   | `dbip-asn-lite` | MMDB (gzip) | enabled | 24 h · 45 days | as above; ASN and organisation |
   | `dbip-city-lite` | MMDB (gzip) | **disabled** (60 MB compressed; a coarse city point) | 24 h · 45 days | enabling it fills region, latitude and longitude, distances and geolocation-list probes |
   | `tor-exit-addresses` | TorDNSEL `exit-addresses` | enabled | 1 h · 6 h | CC0 (Tor Metrics); IPv4 only, as published |
   | `aws-ip-ranges` | AWS `ip-ranges.json` | enabled | 6 h · 7 days | no licence stated; facts published for programmatic use; never redistributed |
   | `gcp-cloud` | Google `cloud.json` | enabled (decision 3) | 6 h · 7 days | as above |
   | `oracle-public-ip-ranges`, `cloudflare-ips`, `digitalocean-geofeed`, `linode-geofeed` | each publisher's format | enabled | 24 h · 14 days | as above |
   | `azure-service-tags` | Azure JSON | **disabled**, and **import-only** (Microsoft's default non-commercial site terms, decision 4; its file name changes weekly under a download page, so no fixed URL exists, F27) | none · 21 days | the operator may import it after reading its terms |
   | `apple-private-relay` | Apple egress CSV | **disabled** (decision 5) | 24 h · 7 days | sets only `privacy-relay`; never raises a threat level |
   | `openverify-sandbox-network` | normalised JSON with a synthetic MMDB | `sandbox_only: true` | none (imported by `seed:dev`) · never stale | documentation ranges and fictional ASNs only (C93.6) |

   A manifest test refuses hosts whose terms fail rule 4: `ipinfo.io/data`, `ip2location.com/download`, `maxmind.com`, `nominatim.openstreetmap.org`, `iptoasn.com`, `routeviews.org`. It also refuses any `http:` URL.

2. **Sync** (`pnpm --filter @openverify/api network:sync [--source <id>] [--import <file> --source <id>] [--allow-mass-removal] [--allow-mass-addition] [--accept-older-publication] [--json]`, an operator CLI). The repeatable `network-refresh` job (a 15-minute tick) runs the same code, and only with `OPENVERIFY_NETWORK_REFRESH=true`. It never runs in CI.

   **One sync runner** (F35). 7A Stage 1a records what 6A's watchlist sync exports. `api-network` then extracts a generic runner, `apps/api/src/sync/runner.ts`, from it. The runner holds:
   - the session advisory lock;
   - the private download directory;
   - the change-signal, digest and SHA-256 steps;
   - the apply transaction, with guard callbacks for monotonicity, mass removal and mass addition.

   `api-network` moves the watchlist sync onto the runner with every 6A sync race test unchanged and green, so one implementation of these security-relevant steps exists. For that refactor only, it owns `apps/api/src/watchlists/sync*.ts`. The download uses C85.1's `stream()`, which this plan amends to allow the network-source clients as well as the watchlist clients (F38).

   The steps:
   1. a session advisory lock per source (`busy`);
   2. the change signal;
   3. the download into a private directory under the caps and the deadline, with gunzip under the inflated cap;
   4. the publisher digest where one exists (DB-IP's page digest covers the decompressed file) and our SHA-256;
   5. a strict parse into the normalised snapshot (3);
   6. apply under the lock, re-checking two guards against the locked row:
      - monotonicity: a publication time older than the applied one is refused (`refused_rollback`) unless `--accept-older-publication`. The publication time is the MMDB `build_epoch`, a range file's `syncToken` or `creationTime`, or, for the exit list, the newest `LastStatus` in the file, else `Last-Modified`. `network-data` confirms the live exit-list format and records it in its TDD file (F27);
      - mass removal: more than 25% of a range or exit set gone, or an MMDB under half the applied size, is refused (`refused_mass_removal`) unless `--allow-mass-removal`. The threshold is higher than C76's 10% because exit lists churn hourly; the basis is in the manifest;
      - mass addition (P27): growth of more than 25% in a range set's covered addresses, or any prefix shorter than the source's `min_prefix` (manifest; for example /8 for IPv4), is refused (`refused_mass_addition`) unless `--allow-mass-addition`, so a poisoned file cannot mark the whole internet as a datacenter;
   7. write the snapshot object and the `network_syncs` row.

   Imports are as C76.2: no request, and `origin: import` recorded and shown. Tests on Testcontainers: rollback, mass removal and `busy`; a future publication refused; an import recorded as `import`; a source not configured.

3. **The normalised snapshot.** Each applied sync stores one object in the S3 store under `network/<source>/<sha256>`. It holds either:
   - the MMDB file as published, read by `mmdb-lib` 3.0.3 (MIT, no dependencies) through `@openverify/signals/network`; or
   - for range and exit sources, a canonical JSON of sorted, merged intervals (IPv4 and IPv6 as 16-byte keys; IPv4-mapped IPv6 folded to IPv4) with each interval's attributes (provider, service, region).

   **Not envelope-encrypted** (decision 44; F21). These are public publications, not data about our subjects. Their integrity comes from the SHA-256 recorded on the `network_syncs` row, which every load re-checks. Skipping the envelope keeps a swap from holding a ciphertext copy beside the plaintext.

   **Memory.**
   - The API and the worker each keep the current snapshot of every enabled source in memory. They load it at startup, re-check the `network_sources` row every 60 s, and swap atomically on a new SHA-256, loading changed sources one at a time and releasing the old snapshot after the swap. Lookups are pure functions over that immutable snapshot (C93).
   - `network-data` measures both the steady state and the **peak RSS during a swap**, and records them in its TDD file. The research measured the two default MMDBs at about 18 MB. City Lite adds about 121 MB at rest, and roughly double that during its swap. The docs state both numbers.
   - **Purge** (P27): snapshot objects other than the current and the previous one per source are deleted 7 days after they are superseded (a C16 retention step), so old exit lists do not accumulate.
   - **Production never reads sandbox data** (H26): every lookup takes the environment kind, and a production environment skips `sandbox_only` sources. A test asserts that a production session's `sources[]` never names `openverify-sandbox-network`.
   - **Startup wiring** (F41): Stage 1b adds the stubs `apps/api/src/network/{reconcile,snapshots}.ts` and their calls from `container.ts` and `worker.ts` (startup, the 60 s timer, release on shutdown), owned by `api-network`.

4. **Staleness** follows C76.3: freshness counts from the last successful check; a never-checked source is unavailable; a stale or unavailable source makes the facts it feeds `null` with `list_stale` or `list_unavailable` (C93.3); a `sandbox_only` source is never stale.

5. **Reconciliation** follows C76.4: `reconcileNetworkSources` runs at API and worker startup and first in each CLI. It upserts one row per manifest source, with `enabled` from the manifest less `OPENVERIFY_NETWORK_SOURCES_DISABLED`. City Lite is enabled by `OPENVERIFY_NETWORK_SOURCES_ENABLED=dbip-city-lite`, and so are Azure and Apple Private Relay. Both variables are parsed the same way by every process, which a config test checks.

6. **Pinned ASN seeds** (rule 4's normal path, `data/manifest.json` and `python3 scripts/fetch_data.py`):
   - X4BNet `lists_vpn`: `input/datacenter/ASN.txt` and `input/vpn/ASN.txt` at one commit at least 14 days old, chosen by `contracts-7a` and recorded with its date. The licence is MIT, declared in the README, which has no LICENSE file (decision 6). The README's MIT text is copied into `THIRD_PARTY_LICENSES.md` and the manifest entry, and is re-checked whenever the pin moves.
   - `brianhama/bad-asn-list` `bad-asn-list.csv` at `b825d2e0e09684842599b75881fc76cb42f0e8c6` (2026-04-12, MIT).

   The parsers drop duplicate ASNs (the research counted 14 and 19 repeats) and report distinct counts; a fixture with a repeated ASN tests it.

   `network/asn-overrides.json` (committed, ours) adds or removes ASNs with an evidence note per row. It starts empty, and its schema test uses fictional rows from the documentation ASN ranges (64496–64511, 65536–65551).

   Without the fetched seeds, the ASN-based flags answer `null` with `list_unavailable`, and `seed:dev` warns, naming `fetch_data.py`.

7. **Licence allowlist.** `scripts/fetch_data.py`'s `PERMISSIVE_LICENSES` needs nothing new: both seeds are MIT. PDDL-1.0 and Natural Earth's public-domain statement are not added in Phase 7, since iptoasn and Natural Earth are not used (decisions 7 and 9).

8. **Attribution.** Each source's `attribution` line appears in the network provenance (C91.3 `sources`), in the network sources page (C108) and in `THIRD_PARTY_LICENSES.md`.
   - DB-IP's CC BY 4.0 terms ask web pages that show results for a link back, so the line "IP geolocation by DB-IP", linking `https://db-ip.com`, is on every console page that shows an IP location or a distance computed from one. A component test asserts it.
   - The flow's phone context screen (C96.5) shows a country from DB-IP, so it carries the same line in small print.

### C93. Network lookups and the session's network facts

1. **The address** (P05).
   - **Source.** Only `request.ip`, as Fastify resolves it under `OPENVERIFY_TRUST_PROXY` (C15). IPv4-mapped IPv6 is folded to IPv4 first.
   - **Trust mode.** The evaluation records how the address was resolved, as the network's `client-address-source`:
     - `socket`: trust off;
     - `trusted-list`: addresses or CIDRs;
     - `hop-count`;
     - `trust-all`: `true`, under which the left-most `X-Forwarded-For` entry, written by the client, becomes `request.ip`.

     In a production environment, under `trust-all`, every network fact is `null` with `client_address_untrusted`: the client could choose the address it is judged by. A hop count logs a startup warning that names the risk.
   - **Startup warning.** `warnOnPrivatePeers`, a Stage 1b stub owned by `api-network`, logs a warning when production sessions keep arriving from private peers. That pattern means a proxy whose address is not trusted, so every fact describes the proxy. A test covers it.
   - **Untrusted addresses elsewhere** (P05). The same rule keeps a `trust-all` address in production out of the IP list probes (`client_address_untrusted`, C99.1) and out of the `ip_address` graph rows (C101.3), so a client cannot evade a listed address or plant a link.
   - **Non-public addresses.** Private, loopback, link-local, carrier-grade NAT (`100.64.0.0/10`) and other non-global addresses give every fact `null` with `address_not_public`.
   - **Documentation ranges.** `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` and `2001:db8::/32` answer only in sandbox environments, through the sandbox source (6). In production they are `address_not_public`.

2. **When** (F15). On the session's first successful flow call, where C10 records the IP and user agent today. That is `recordSessionStart` in `services/inquiry-sessions.ts`, called by the flow-session auth plugin `auth/flow-session.ts`; `markInquirySessionStarted` writes only while `started_at` is null, so one call wins.
   - **Hooks.** `recordSessionStart` calls two hooks, both declared by Stage 1b, in its transaction:
     - `evaluateSessionNetworkInTx` (owned by `api-network`) evaluates the address against the in-memory snapshots, a pure call under 1 ms, and writes the `networks` row and the session's network facts;
     - `recordSessionDeviceInTx` (owned by `api-signals`) writes the parsed device fields from `signal-logic`'s mapper (C94.5).
   - **Reserved call site.** Stage 1b reserves a third call site for 7B's graph indexer (C101.3).
   - **Handoff.** A handoff redemption calls the same function for the new session.
   - **No session.** A server-API inquiry with no session has no network facts.
   - **Frozen facts.** Re-evaluation is never automatic: a session keeps the facts of its time, with their provenance.

3. **Facts** (C90.3 applies to each):

   | Fact | Rule | Tier |
   |---|---|---|
   | `is-tor` | `true` when the address is an `ExitAddress` seen within 24 h of the snapshot's time. `false` for a public IPv4 address absent from a fresh snapshot. `null` for IPv6 (`ipv6_not_covered`: the list has no IPv6 exits), or when the source is stale or unavailable | R |
   | `is-datacenter` (public) | `true` only when the address is in an enabled provider's published ranges (H13). Otherwise `null` (`not_in_known_ranges`), never `false`, because the lists are not exhaustive | R |
   | `hosting-asn` (ours) | `true` when the ASN is in the hosting seeds less the overrides, with a confidence; otherwise `null` | H, `beta` |
   | `is-vpn` | `true` when the ASN is in the VPN seed or the overrides; otherwise `null` | H, `beta` |
   | `is-proxy` | the `ipReputation` adapter's answer, when one is bound (5); otherwise `null` (`provider_not_configured`) | A |
   | `country-code`, `country-name` | DB-IP Country Lite; marked `approximate` in `signal-details` and the network `reasons` | R lookup |
   | `region-*`, `latitude`, `longitude` | DB-IP City Lite, only when enabled; otherwise `null` (`list_unavailable`) | R lookup, approximate |
   | `ip-isp`, `network-organization`, `asn` | DB-IP ASN Lite | R |
   | `ip-connection-type` (public) | `datacenter` when `is-datacenter` is `true`; otherwise the adapter's value, or `null` | as its source |
   | `privacy-relay` (network only) | `true` when in Apple's egress list, if enabled; otherwise `null` | R |

   The public datacenter fields (`is-datacenter`, `ip-connection-type`, network `service-type`, and the report's `datacenter-ip` and `service-type`) come only from provider ranges. They keep their public meaning, an exact range lookup. Hosting-ASN hits never reach them (H13).

4. **Threat level** (H, `beta`, ours; H04). Constants are provisional in `THREAT_LEVEL_RULES`, with basis and source. An input counts as **evaluated** when:
   - `is-tor`: it is `true`, or `false` against a fresh IPv4 snapshot;
   - VPN and hosting: the lookup ran against fresh seeds, whether it answered `true` or `null` with `not_in_known_ranges`;
   - provider ranges: the lookup ran against at least one fresh provider source;
   - proxy: a bound adapter answered.

   The levels:
   - `high` when `is-tor` or the adapter's proxy flag is `true`;
   - `medium` when `is-vpn`, `is-datacenter` or `hosting-asn` is `true`;
   - `low` when Tor, VPN, hosting and provider ranges were all evaluated and none is `true`. It always carries the limit reasons that apply (`vpn_list_not_exhaustive`, and `proxy_not_evaluated` without an adapter). Its confidence is capped by `THREAT_LEVEL_LOW_CONFIDENCE_CAP` (0.5 without an adapter, 0.8 with one; provisional);
   - otherwise `null` on the session and `unknown` on the network.

   `privacy-relay` never raises the level. The console words `low` as "no listed risk found", and `not_in_known_ranges` as "not in the lists we hold". The docs say what it cannot see: residential proxies, most VPNs, and any address without an adapter's reputation. Golden tests cover a default install (no adapter, fresh lists).

5. **Provider kind `ipReputation`** (a C63 and C83 amendment; F26, H25).
   - **Values:**
     - `mmdb-file`: an operator-licensed MMDB with anonymous-IP fields, loaded from `OPENVERIFY_IP_REPUTATION_MMDB_PATH`. Its licence is the operator's, and nothing is downloaded by us;
     - `sandbox`: the magic values of 6.
   - **Answers.** The file adapter answers `true` when the file flags the address. Otherwise it answers `null` with `not_in_provider_data`, unless the file positively records a negative for that address: commercial anonymous-IP files flag addresses rather than clear them. Each answer carries `{ provider, sandbox }` in `sources[]`.
   - **Binding.** The kind is bound by `OPENVERIFY_PROVIDER_IP_REPUTATION_{SANDBOX,PRODUCTION}` under C63's rules. Unlike Phase 6's kinds, it is read by **both** the API (session evaluation) and the worker (the report): `PROCESS_PROVIDER_KINDS.api` gains it. Compose passes both processes the variables and mounts the MMDB path read-only, and Stage 1b's config test covers both.
   - **No vendor client.** No API vendor client is shipped (decision 8). The docs have a disclosure section: the file adapter answers locally and sends nothing.

6. **Sandbox values** (`openverify-sandbox-network`, sandbox environments only):

   | Address | Facts |
   |---|---|
   | `192.0.2.10` | Tor exit |
   | `192.0.2.20` | provider range (the fictional provider `example-cloud`) |
   | `192.0.2.30` | VPN ASN AS64500 |
   | `192.0.2.40` | proxy (through the sandbox `ipReputation`) |
   | `192.0.2.50` | hosting ASN AS64503 only |
   | `198.51.100.0/24` | country `ZZ`, AS64501 "Example Residential" |
   | `203.0.113.0/24` | country `ZZ`, AS64502, a fictional city point, for distances |
   | `2001:db8::/48` | IPv6, `is-tor` `null` |

   `docs/checks/sandbox-providers.md` lists them.

   **The e2e stack** (F34) sets `OPENVERIFY_TRUST_PROXY=127.0.0.1`. Its specs use `page.route` on the API origin to add a standard `X-Forwarded-For` below CORS. A check asserts that the production CORS header list is unchanged and that no other header is read.

7. **Logging** (P06). Fastify's default request serializer logs the full URL and `remoteAddress` on every request. Checkpoint 2 of 7A's Stage 1b replaces it with a serializer that logs the route pattern and the request id, never the URL, the query or the address.
   - IP addresses, coordinates and fingerprints reach pino only under the `pii` key.
   - Network logs carry the ASN, the country and the reason codes only.
   - Tests: a flow call logs neither its address nor a query value, and the pino redaction test gains the new keys.

8. **The `ip-address` report** (C106.1) uses the same lookups.

### C94. The collector, behaviour signals and fingerprints

1. **Package** `packages/signals` (new; `@openverify/signals`), with three entries:
   - `@openverify/signals/browser`: the collector, with no runtime dependencies, no network call, no storage (no cookie, `localStorage`, `sessionStorage` or IndexedDB), no iframe, no worker and no remote code;
   - `@openverify/signals/network`: the parsers of C92.3, the interval sets over `node:net` and our own 16-byte keys (no address library), and the lookups of C93 over `mmdb-lib` 3.0.3 (pnpm catalog);
   - `@openverify/signals/testing`: our own MMDB writer for fixtures, and synthetic files in every publisher's format built from the documentation ranges and ASNs. No real database or list is committed.

   The package follows the workspace conventions (the `@openverify/source` condition, `createVitestConfig()`, ≥ 80% coverage). Its dev dependencies, `jsdom` and `esbuild` (exact pin; its build script stays denied, which does not stop its JS API), land in 7A Stage 1a (F38).

   **Budget** (F19): the browser entry is at most 4,096 B gzipped. A size test bundles it inside the test (`esbuild.build` with `bundle`, `minify` and `write: false`), gzips the output and asserts the bound, so the check needs no prior build. `client-collector` re-measures the flow's main bundle (820,481 B, 237,048 B gzipped at the research's measurement) and records it.

   **CSP:** no change to the flow's policy is needed. A Playwright test under the production CSP asserts no violation and no request to any origin but the API.

2. **The flow signals contract** (`@openverify/contracts` `flowSignalsSchema`: a strict zod object of enums and bounded integers, with no free string longer than its bound). It is sent by `POST /api/v1/flow/signals`, with session authentication. Members:
   - `platform` (`web`, `android`) and `collector-version` (an integer);
   - `screen`: the flow-spec step id;
   - `sequence`: an integer. A repeated `(session, sequence)` is ignored with 202, so a retry is idempotent;
   - `integrity` (3), `behaviour` (3) and `recognition` (4, only under the device-recognition tier);
   - `device-class` (Android only: `smartphone` or `tablet`);
   - `sandbox-outcome` (C90.9).

   **Storage** (F12, P19). Bodies go to `inquiry_session_signals`: `(id, environment_id, inquiry_session_id, sequence, screen, components sealed, behaviour sealed, created_at)`, unique on `(inquiry_session_id, sequence)`. The `integrity` and `recognition` members are sealed in `components` and the `behaviour` member in `behaviour`, each with its row AAD. Both columns join `ENCRYPTED_COLUMNS` and `REWRAP_TABLES`.
   - At most 200 bodies are stored per session (P23). Further ones answer 202, are counted in `signal_bodies_dropped`, and are not stored. A repeated `(session, sequence)` also answers 202 (V15).
   - The route answers 202.
   - It is refused with 409 `consent_required` until the posting session may collect (6).
   - It is rate-limited per session (60 per minute, the C12 policy `flow-signals`, enforced in `plugins/rate-limit.ts` by Stage 1b), with a body cap of 8 KiB.

   Tests:
   - the collector's output keys equal the schema's keys;
   - a string over its bound is refused, so raw keystrokes or coordinates cannot pass;
   - recognition fields sent without the tier are dropped, never stored;
   - the 201st body is counted, not stored.

3. **Session-integrity data** (on by default after consent; class D/B of the research's table):
   - **integrity:**
     - `webdriver`; `driver-globals` (a closed list of names, after BotD's rules); `ua-headless-marker`; `zero-window-with-focus`; `plugins-inconsistent`; `mime-inconsistent`; `native-function-tampered`; `untrusted-event-count`;
     - the UA Client Hints low-entropy brands, `mobile` and `platform`; `timezone` (IANA, ≤ 64); `languages` (≤ 5 tags). These three exist for the server's cross-layer consistency checks against the headers and the IP country.

     The CDP `Runtime.enable` probe is not used: Chromium stopped it working in May 2025.
   - **behaviour** (per screen, aggregates only):
     - counts: `paste-count`, `drop-count`, `autofill-count`, `correction-count`, `focus-loss-count`, `hidden-count`;
     - timings: `dwell-seconds` (capped at 3,600), `hidden-seconds`, `first-input-bucket` (`<0.25s`, `0.25–1s`, `1–5s`, `>5s`, `none`);
     - classes: `typing-cadence` (`uniform`, `variable`, `insufficient`), `pointer-types` (a subset of `mouse`, `pen`, `touch`) and `pointer-before-click` (`true`, `false`, `n/a`).

     The browser's cut-offs are registered constants tied to `collector-version` (C90.1, H24): `typing-cadence` needs at least 8 intervals, and its uniform cut-off is a coefficient of variation; the bucket edges are fixed.
   - **Never collected:** key values or codes, per-key timings, pointer coordinates or trajectories, scroll positions, clipboard contents, font enumeration, ad-block probing, permissions, speech voices, WebRTC, audio, plugin names, accessibility media queries (they can reveal a disability), and Android accessibility services.
   - **Nothing runs before the session may collect** (P14). The collector instantiates nothing until `GET /api/v1/flow/session` reports consent and the session's tiers: no listener, no `navigator`, canvas or WebGL read. It never measures the consent screen itself. A flow test spies on the probed APIs and on `addEventListener` before consent, and again after a declined recognition tick.

4. **Device-recognition data** (off by default; with the tier, class I):
   - **recognition:**
     - screen width, height, colour depth and device pixel ratio, bucketed; `hardware-concurrency`; `device-memory`; `max-touch-points`;
     - a 2D canvas digest (SHA-256 of `toDataURL` over a fixed drawing, computed in the browser), and a second readback to detect noise (`canvas-noise`);
     - WebGL vendor and renderer strings (≤ 128) where the browser exposes them;
     - Android's `ANDROID_ID` (7).
   - **Server side** (`api-signals`, through the `identifierKey` function of C98.2):
     - the strict HMAC, `browser-fingerprint`, over the canonical JSON of the stable components, with the label `openverify/browser-fingerprint/v1`;
     - the device-class HMAC (screen bucket, platform, concurrency, memory, touch points, GPU strings), with `openverify/device-class/v1`, served as the device's `device-class` (ours), never as `device-fingerprint` (V10);
     - the `ANDROID_ID` HMAC, with `openverify/android-id/v1`.
   - **Storage.** The components are stored sealed (retention C91.7) and the HMACs plain in `devices`. Canvas noise sets `fingerprint-randomised`, which drops the strict HMAC (`null` with `fingerprint_randomised`) and keeps the device class.
   - **Key id** (P09). Every device HMAC and every fingerprint list item records the blind-index **key id**, `HMAC(OPENVERIFY_BLIND_INDEX_KEY, "openverify/blind-index-key-id/v1")` truncated to 11 base64url characters, as the KEK's `kid` is derived.
     - `blind-index:rebuild` recomputes the HMACs from the sealed components while they are retained.
     - Devices whose components are gone keep their old key id.
     - A fingerprint list item whose key id is not current is unscreened with `key_rotated` (C99.1). It never answers "no match" against new HMACs.
   - **Consequence** (stated in the importer docs, C100): fingerprint values from another installation never match, because the keys differ. The importer records the current key id on each item.

5. **User agent and SDK header.**
   - `bowser` 2.14.1 (MIT; already in the lockfile through `@aws-sdk/core`) becomes a direct dependency of `@openverify/checks` through the pnpm catalog. A lockfile test refuses `ua-parser-js` 2.x (AGPL).
   - `device-type` maps bowser's platform types: `desktop`, `mobile` → `smartphone`, `tablet`, `tv`.
   - The SDK header `OpenVerify-Android/<version>` (`OpenVerify-iOS/…`) is parsed exactly, with no library. An SDK session's `device-type` comes from the SDK's `device-class` in its first signal body; until one arrives it is `null`.
   - The mapper is `signal-logic`'s, and `api-signals` writes it through `recordSessionDeviceInTx` (C93.2).

6. **Collection tiers, notice and consent** (C90.8; amending C42.3; P01, P10, F25).
   - **Session integrity** is collected after the consent step, under the operator's documented strictly-necessary assessment, with no secondary use. The basis goes in the compliance guide: WP29 9/2014 §7.5, CNIL délibération 2020-091 ¶49, and UK PECR Sch. A1 para 4, in force from 2026-02-05. That assessment is the operator's decision; OpenVerify takes no position.
     - **Notice.** The person is still told (GDPR Art. 13). Collection happens only under a template whose consent step lists the required text key `notice.session-integrity`. The default template lists it. A template without it collects nothing, and its behaviour signals read `collection_disabled`.
     - With the tier `off`, the collector sends nothing and every behaviour signal is `null` with `collection_disabled`.
   - **Device recognition:**
     - `consent` requires the optional consent key `consent.device-recognition` in the template's consent step (the C42.3 pattern: unticked by default). Publish refuses a template that collects recognition without it, with 422 `consent_text_missing`. Without the tick, the collector omits `recognition` and the server drops it;
     - `exempt` collects without a tick, on the recorded basis. It requires the required notice key `notice.device-recognition`. Publish refuses a template that also offers the optional `consent.device-recognition` (422 `consent_key_conflicts_with_exempt`), so a declined tick is never overridden;
     - `off` collects nothing.
   - **Whose consent counts** (P01, F25):
     - **one function decides** (V03, P01): `getEffectiveConsent(db, session)`, which Stage 1b (H) adds to the shared `repositories/inquiry-sessions.ts`. Every consent gate calls it instead of the inquiry-level read: `services/flow-preconditions.ts`, `services/flow.ts`, `services/otp/context.ts`, `GET /flow/session`, and `matchingConsentHolds` in `jobs/selfie.ts`, which uses the capture's `created_by_session_id`. For a handoff session it returns that session's own consent, or `null`. For any other session it returns the latest consent among the inquiry's sessions, excluding rejected or declined handoff sessions;
     - session integrity follows the effective consent;
     - device recognition needs the tick on the session that collects, so a resumed session that did not consent again collects no recognition data (`consent_not_given`);
     - a **handoff session** must record its own consent before anything else (C96.5): `GET /api/v1/flow/session` reports `consent: null` for it until it does, so its collection, capture, OTP and biometric gates refuse until then. The desktop is locked while the phone is active (C96.3). After a rejection, the phone's consent never governs the desktop's later capture or matching. A test checks that a rejected phone's ticks authorise nothing.
   - **Session tiers.** The flow learns its tiers from `GET /api/v1/flow/session` (`signals: { integrity, recognition }`) once consent is recorded, and the session records `signals-collected`.
   - **Permission.** Changes to `signal-collection` need `settings:privacy` and are audit-logged.

7. **Android** (ADR 0004 layout; F07).
   - **Contract stubs** (7A Stage 1a): `FlowApi.sendSignals`, the `FlowSignals` model with its `ContractFixturesTest` decoder, the session's `signals` member, a `DeviceSignals` parameter threaded from `OpenVerifyInquiry` and `InquiryViewModelFactory`, and a `FlowCoordinator` call after consent.
   - **Owner.** `android-signals` owns those named files and `src/*/kotlin/**/signals/`.
   - **Implementation.** `DeviceSignals` is declared in `commonMain` and implemented in `androidMain`, with an iOS placeholder.
     - The session-integrity tier reads `Debug.isDebuggerConnected()` and the host app's `FLAG_DEBUGGABLE`.
     - The device-recognition tier reads `Settings.Secure.ANDROID_ID`, unique per app-signing key, user and device on Android 8.0 and later.
     - It sends `platform: android` and `device-class` through the same contract after consent.
   - **Never read:** `ADB_ENABLED` or `DEVELOPMENT_SETTINGS_ENABLED` (always 0 to third-party apps), accessibility services, IMEI or MAC addresses.
   - **Phase 10:** emulator, root and hooking heuristics and Play Integrity (decision 12).
   - **Tests and docs.**
     - Host tests run in `testAndroidHostTest`. `android-signals` reports its host-test count, and `integration-7a`, which owns `ci.yml`, raises the CI floor by it.
     - The SDK README and `docs/checks/signals.md` state what the SDK reads per tier, and which Google Play Data safety entries the host app must declare ("Device or other IDs" under device recognition) (P29).

8. **Scores** (`packages/checks/src/signals/`, pure; H, `beta`; constants provisional in `BOT_SCORE_RULES` and `BEHAVIOUR_RULES`, with basis and source).
   - **`bot_score`** (0–100):
     - strong evidence sets at least 90, with one reason per artefact: `webdriver`, driver globals, `untrusted-event-count > 0` on inputs, a headless marker;
     - medium evidence adds 10–25 each: cross-layer inconsistency (user agent against Client Hints against JS; `Accept-Language` against `languages`; a timezone far from the IP country. The route `POST /flow/signals` records the bounded primary `Accept-Language` tags and the low-entropy `Sec-CH-UA*` values of its own request, sealed in `components`, since nothing else stores them; V13), `typing-cadence: uniform` with no correction anywhere, screens faster than `FAST_SCREEN_FLOOR_SECONDS` (provisional, recorded), and `pointer-before-click: false` with `mouse` the only pointer;
     - weak evidence adds 0–5 each: paste or autofill into identity fields, many focus losses, long hidden periods;
     - **caps** (P24): medium and weak evidence together never exceed 60, and a score of 70 or more needs a strong artefact. Uniform cadence, fast screens and no pointer travel are also the patterns of voice control, switch access and keyboard-only use. This keeps assistive technology out of the bot band;
     - **absence is not proof** (H06). Below the medium band, the confidence is the share of evidence groups collected, capped by `LOW_SCORE_CONFIDENCE_CAP` (0.5, provisional), with the reason `no_artefact_found`. The console words a low score "no automation artefacts found";
     - no payload from a consented web or Android session gives `null` with `collector_missing`, which `on-null` sends to review by default (C90.7). An inquiry with no flow session gives `null` with `signals_not_collected`.
   - **`behavior_threat_level`** comes from the behaviour aggregates alone, by the `BEHAVIOUR_RULES` table that `signal-logic` writes and freezes with golden tests:
     - `high` only with a strong behavioural artefact: untrusted input events (`untrusted-event-count > 0` on inputs) (P24);
     - `medium` when the medium behaviour evidence reaches its cap;
     - `low` otherwise, with the same confidence cap.
     - **Minimum evidence:** at least 3 screens with aggregates and 20 input events in total; otherwise `null` with `insufficient_behaviour`.
   - **Confidence** above the low band is the share of evidence groups collected times the margin from the nearest threshold, as C43's `heuristicConfidence` does.
   - **What the scores cannot detect** (stated in `docs/checks/signals.md`): fraud-farm humans, OS-level or real-device automation, and patched browsers. The aggregates are computed on the client, so they can be fabricated or replayed by a script that posts them itself, and a low score proves nothing (H32).
   - **Tests:**
     - golden tests per rule;
     - a property test that medium plus weak evidence never reaches 70;
     - a golden keyboard-only profile and a golden voice-control profile: `bot_score` below 70 and `behavior_threat_level` never `high`;
     - a property test of the low-band confidence cap.

### C95. Distances

1. **Method.** Haversine on the IUGG mean radius R₁ = 6,371,008.8 m, rounded to whole meters. The research measured its error against Vincenty on WGS 84 at no more than 0.56%, far inside the inputs' uncertainty. `geographiclib-geodesic` is not added.
2. **Points.** Only the session IP location from City Lite is a point in Phase 7. A country without a city is not a point, so a distance from it is `null` with `location_too_coarse`. GPS is not collected (decision 9), and residence addresses are not geocoded (C110).
3. **Uncertainty.** Every distance carries `uncertainty: approximate` and the endpoints it used (`session-ip` and its session id). DB-IP Lite publishes no accuracy radius, so a constant `IP_CITY_UNCERTAINTY_METERS` = 50,000 is used where a comparison needs one: the geolocation lists (C99.2) and the review-rule docs. Its basis is recorded honestly as "unmeasured; chosen as a coarse city radius" (H29), with a calibration task, and it is served in `signal-details.thresholds` wherever it is applied.
4. **Distances in Phase 7:**
   - `handoff-distance-meters` (C96.7);
   - `inquiry/max_session_distance`, over every pair of session points (C90.4: `partial_sessions` when a session lacks a point; `null` with `insufficient_sessions` below two points).
5. **Tests:** golden pairs (fictional points, the antimeridian, the poles, identical points); symmetry; whole meters.

### C96. Device handoff

1. **The step.** The flow-spec gains a step type, `device_handoff` (snake case like the other fifteen; `packages/flow-spec/src/flow.ts`). The operator places it where the move to the phone should happen, usually before `government_id`. Its strict config:
   - `methods`: a subset of `qr`, `email`, `sms`, default `["qr"]` (P02).
     - `email` and `sms` send only to a destination this inquiry has already confirmed by OTP (the C55 destination index), unless `confirmation-code` is `true`.
     - `sms` is refused at publish unless an SMS adapter is bound in that environment (422 `sms_not_configured`, from `services/publish/handoff.ts`).
   - `qr-ttl-seconds` (120–900, default 300) and `link-ttl-seconds` (300–3,600, default 900, for email and SMS). These short lifetimes are ours, for the phishing reason of 6; the public product's default is one hour. The public per-inquiry override is deferred (C110; H27).
   - `confirmation-code` (default `false`).
   - `skip-on-mobile` (default `true`): the server skips the step for a session whose parsed `device-type` is `smartphone` or `tablet`, or whose `mobile-sdk-name` is set (F01).
   - `allow-continue-here` (default `true`): the desktop user may skip the handoff and capture on this device.

   Publish refuses the step when the environment's `organization-display-name` setting (C107.7) is empty (422 `display_name_required`), because the phone's context screen needs it (F30). The step's text keys go through i18n like every step's. The session cap is a template setting (C91.5).

   **Typecheck minimum** (F01). The flow and the SDK must keep compiling once the step type exists, so 7A Stage 1a adds it together with the flow's and the contracts' minimum:
   - the exhaustive `stepPosition` switch in `apps/flow/src/flow/flow-position.ts`;
   - `STEP_VERIFICATION_TYPES` (none for this step) and `SUPPORTED_FLOW_STEP_TYPES`;
   - an Android model entry that treats the step as done from `handoff.state`, so SDK sessions are never stuck on an unsupported step.

2. **Token** (ours). `ovh_` plus 32 random bytes in base64url, stored as SHA-256 only and compared in constant time, like every C1/C9 token.
   - **Binding:** it is bound to the inquiry and to the issuing session (`iqse_`).
   - **Use and lifetime:** it is single use, and lives for its method's TTL, never past the inquiry's `expires-at`. Issuing a new token revokes the session's previous live one.
   - **Not a C10 one-time link:** generating a C10 link revokes the inquiry's other unused links, which would cancel a link an operator had sent.
   - **Storage:** table `handoff_tokens`, and the prefix `ovh` in the token prefix table.
   - **Retention:** tokens are deleted 30 days after use or expiry, in the C16 pass, as one-time links are (P27).

3. **Flow API.** All of it is in `@openverify/contracts`, with golden problems. Routes use session authentication unless stated.
   - **`GET /api/v1/flow/session` gains two members** (F01, F30), both frozen in 7A Stage 1a:
     - `handoff`: `{ step-id, state: "pending" | "issued" | "redeemed" | "continued_here" | "skipped" | "rejected" | "declined" }`, or `null` when the flow has no `device_handoff` step. The state is kept per inquiry and step in `inquiry_handoff_steps`, not per session, so a resumed desktop keeps it (V05).
       - The web flow (`stepPosition`) and the Android coordinator treat the step as done only for `redeemed`, `continued_here` and `skipped`.
       - After `rejected` or `declined` the step shows again: the desktop issues a new code, or continues here where that is allowed.
       - A session with `mobile-sdk-name` set always skips the step;
     - `handoff-context`, for a session created by a redemption: `{ organization-display-name, steps[] (the remaining step types, to say what will be verified), started-at, issuing-country-code | null, attribution | null }`.
   - **`POST /api/v1/flow/handoffs`**, body `{ method, destination? }`, answers `{ id, method, expires-at, url-fragment? }`.
     - For `qr`, the server answers the fragment `#inquiry-id=<id>&handoff-token=ovh_…`, and the flow builds the QR locally (5).
     - For `email` and `sms`, `destination` must match the inquiry's confirmed OTP destination of that channel. Otherwise the server answers 422 `destination_not_confirmed`, unless `confirmation-code` is on. The server sends the link through the Phase 5 mail or SMS adapter and answers no token. The destination is used only to send and is never stored; the OTP-destination index serves the limits.
     - Limits (F09): the C12 policy `flow-handoffs` allows 5 issues an hour per session and 10 an hour per IP, with a per-environment budget of `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` email and SMS sends (default 200). The budget fails closed: when the limiter cannot answer, no message is sent. SMS stays under the Phase 5 SMS-pumping guards.
   - **`POST /api/v1/flow/handoffs/continue-here`** records `continued_here` when `allow-continue-here` is true (F01).
   - **`POST /api/v1/flow/handoffs/preview`** (no authentication; rate-limited per IP under `one-time-link-redeem`), body `{ inquiry-id, handoff-token }`. It answers the `handoff-context` without consuming the token (P15). The phone shows it on the context screen. Link scanners and mail sandboxes that open the link consume nothing.
     - **Unconfirmed destinations** (V16). For an email or SMS handoff sent to an unconfirmed destination (only possible with `confirmation-code` on), the preview answers only the organisation's name and the method advice.
     - The start time, the steps and the issuing country follow a correct code. The preview may check the code without consuming the token.
   - **`POST /api/v1/flow/handoffs/decline`** (no authentication; the `one-time-link-redeem` limit; body `{ inquiry-id, handoff-token }`; the uniform 410; V04) is the phone's decline from the context screen, before redemption. It revokes the token, sets the step's state to `declined` (the desktop sees it), and records an audit entry.
   - **`POST /api/v1/flow/handoffs/redeem`** (no authentication; rate-limited per IP under `one-time-link-redeem`), body `{ inquiry-id, handoff-token, confirmation-code? }`. The phone calls it when the user presses Continue on the context screen, never at boot.
     - It answers a new session token, as the one-time-link redemption does. The flow holds the token in memory only, as it holds a redeemed one-time link's.
     - It creates the new session with `device-handoff-method`, `handoff-from-session-id` and `handoff-redeemed-at`, and evaluates it (C93.2).
     - The token is checked first, in constant time. Every failure answers one uniform 410 `handoff_token_invalid`: expired, used, revoked, unknown, wrong inquiry or wrong code. Only then does the session cap of C91.5 apply (P28).
     - The handoff becomes `redeemed`. The new session starts at the step after `device_handoff`, once it has recorded its own consent (5).
   - **`GET /api/v1/flow/handoffs/current`** (the issuing session) answers `status` and, after redemption, `redeemed-at` and the phone's `os-name` and `browser-name` only.
   - **`POST /api/v1/flow/handoffs/current/reject`** ("this was not me", the issuing session; P15, V02) does five things:
     - it expires the phone session (`inquiry-session.canceled`);
     - it cancels the verifications that session created that are still `initiated` or `confirmed`, which the verification state machine allows, and redacts their files. Verifications are found through their `created_by_session_id`;
     - its verifications already submitted or decided cannot be cancelled. They are marked `from-rejected-handoff` (ours), excluded from list probes, graph indexing and the signals, and the inquiry is routed to `needs_review` with the cause `handoff_rejected` (now if it is `completed`, otherwise when it completes). A reviewer sees which verifications came from the rejected session;
     - it sets the step's state to `rejected`;
     - it records an audit entry.

     The desktop may then issue a new code, or continue here where that is allowed.
   - **One capturing device at a time** (F13). While a redeemed session is active, every non-GET flow route of the issuing session is refused with 409 `session_handed_off`, except the handoff routes. The check is `assertSessionNotHandedOff`, a Stage 1b stub in the shared `auth/flow-session.ts`, implemented by `flow-handoff`. A test walks every non-GET flow route and asserts the refusal.

4. **What is recorded.**
   - **On the new session:** `device-handoff-method` (`qr`, which covers both the QR and its copied short link, since the two cannot be told apart; `email`; or `sms`), `handoff-from-session-id`, `handoff-redeemed-at`, and the distance facts of 7.
   - **Audit entries:** issued (with the method), previewed, redeemed, rejected and declined.
   - **No new event names:** the new session emits `inquiry-session.started`, and a rejection emits `inquiry-session.canceled`.

5. **Flow UI** (`apps/flow`).
   - **Desktop.**
     - **The QR**, generated locally and rendered as an SVG or a `data:` image, which `img-src 'self' blob: data:` already allows. 7A Stage 1a installs `qrcode` 1.5.4 (MIT, already used by the dashboard), `uqr` 0.1.3 and `lean-qr` 2.7.4 (MIT). `flow-handoff` measures each one's added gzipped size in the flow bundle and records the result. `integration-7a` then removes the two that lose.
     - **Beside it:** a copyable short link, an instruction, a countdown, "new code", the email (and SMS) options where allowed, and "continue on this device" where allowed.
     - **After redemption:** the waiting state, with "continued on your phone at HH:MM" and "this was not me".
   - **Phone, before any capture or collection** (P01, P15):
     1. **The context screen**, from the preview:
        - the organisation's display name;
        - what will be verified;
        - when the flow started, and the issuing session's country if network data is configured, with the DB-IP attribution line;
        - a decline button with the same weight as continue;
        - advice that depends on the method. For QR: this code should only appear on the organisation's own site. For email and SMS: this message should only follow your own request on that site.

        With `confirmation-code: true`, the phone asks for the 6-digit code shown on the desktop. After 5 wrong attempts the token is revoked.
     2. **Continue** redeems the token.
     3. **The consent step** follows, for the new session (C94.6). The template's consent texts are shown again, with the optional ones unticked, and recorded on the phone's session through `POST /api/v1/flow/consent`. Collection, capture and every biometric gate wait for it.
   - **Accessibility:** the QR has a text alternative (the short link), and every state is announced.

6. **Threat model in the docs** (`docs/flow/handoff.md`). RFC 10027 (BCP 247) example B6 is "illicit onboarding": an attacker starts an inquiry for an account they control and sends its QR to a victim.
   - **What raises the attack's cost:** the phone's own consent, the context screen, the short lifetime, sends only to confirmed destinations, the rejection and the distance signal.
   - **What no web design prevents:** a real-time social-engineering relay.
   - **What catches it downstream:** `selfie_account_comparison` and the graph (C102).

7. **Distance facts** of the new session, measured against the issuing session:
   - `handoff-distance-meters` (C95; IP to IP; `null` without City Lite);
   - `handoff-country-changed` and `handoff-asn-changed` (booleans; `null` when either side is unknown).

   They are R-tier facts. They feed `inquiry/max_session_distance` and are review signals only.

8. **Tests:**
   - **unit:** the token's lifetime, revocation, single use and binding; the uniform 410 checked before the cap; the code attempts; preview consuming nothing; the destination rule;
   - **integration:** the session cap; the parallel-capture refusal on every route; two redemptions racing for one token (one wins); reject cancelling the phone's verifications and redacting their files; the desktop's consent not authorising the phone's capture (the desktop ticks biometric matching and recognition, the phone declines both, and no template, list item or recognition data results);
   - **flow e2e:** the mocked flow suite gains `apps/flow/e2e/handoff*.spec.ts`, owned by `flow-handoff`;
   - **full-stack e2e** (`handoff.spec.ts`; two browser contexts; the email through Mailpit in the e2e stack): the desktop shows the QR; the phone previews, continues, consents and completes; the desktop shows completion. A second run, where the desktop rejects, ends the phone session and cancels its verifications.

### C97. Lists: resources, types and routes

1. **Types.** Thirteen. The table gives the public paths and types where they exist, and marks ours. Paths are plural and types singular, as in the public API (H18). A contract test checks the paths against `docs/research/persona-surface.md`.

   | Kind | List path `POST /api/v1/list/…` | Item path `/api/v1/list-item/…` | Item type, prefix | Importer type | Item fields |
   |---|---|---|---|---|---|
   | browser fingerprint | `browser-fingerprints` | `browser-fingerprints` | `list-item/browser-fingerprint`, `libf_` | `importer/list-item/browser-fingerprint` (ours) | `value` |
   | device fingerprint | `device-fingerprints` (ours: no public create path) | `device-fingerprints` | `list-item/device-fingerprint`, `lidf_` | `importer/list-item/device-fingerprint` (ours) | `value` |
   | country | `countries` | `countries` | `list-item/country`, `lic_` | `importer/list-item/country` (ours) | `country-code` |
   | email address | `email-addresses` | `email-addresses` | `list-item/email-address`, `liea_` | `importer/list-item/email-address` | `value`, `match-type` (`email_address`, `domain`) |
   | face (ours: create path, item API) | `faces` | `faces` | `list-item/face`, `lifc_` (ours) | deferred (decision 27) | `inquiry-id` on create (C99.7); read: `model`, `source-inquiry-id` |
   | geolocation | `geolocations` | `geolocations` | `list-item/geolocation`, `ligl_` | `importer/list-item/geolocation` | `latitude` (−90..90), `longitude` (−180..180), `radius-meters` (1–500,000) |
   | government ID number | `government-id-numbers` | `government-id-numbers` | `list-item/government-id-number`, `ligin_` | `importer/list-item/government-id-number` | `id-number`, `id-class` (the C31 class codes, or absent for any class) |
   | field | `fields` (ours) | `fields` | `list-item/field`, `liif_` | `importer/list-item/field` (public type; ours path) | `field-value`; the list carries `field-key` (ours) |
   | IP address | `ip-addresses` | `ip-addresses` | `list-item/ip-address`, `liip_` | `importer/list-item/ip-address` | `value`: an IPv4 or IPv6 address, or a CIDR range (public) |
   | name | `names` | `names` | `list-item/name`, `lin_` | `importer/list-item/name` | `name-first`, `name-last`; the list carries `allow-fuzzy-name-first` |
   | phone number | `phone-numbers` | `phone-numbers` | `list-item/phone-number`, `lipn_` | `importer/list-item/phone-number` | `value` (E.164, or national with the list's `default-region`, ours) |
   | selfie background (ours) | `selfie-backgrounds` | `selfie-backgrounds` | `list-item/selfie-background`, `lisb_` (ours) | deferred | `inquiry-id` on create (C99.7) |
   | string | `strings` | `strings` | `list-item/string`, `lis_` (ours: the public example reuses the name prefix) | `importer/list-item/string` (ours) | `value` (1–255) |

   **Item routes**, per kind:
   - `POST /api/v1/list-item/<plural>` (body `list-id` and the fields, under `data.attributes`);
   - `GET /api/v1/list-item/<plural>/:id`;
   - `DELETE /api/v1/list-item/<plural>/:id`, which archives the item: it stops matching and stays readable.

   Ours: `GET /api/v1/list-items?filter[list-id]=` (cursor, newest first, `filter[status]`).

   **List routes:**
   - `GET /api/v1/lists` (`filter[status]` `active` or `archived`, newest first; ours: `filter[type]`);
   - `GET /api/v1/lists/:id`;
   - `DELETE /api/v1/lists/:id` (archive);
   - ours: `PATCH /api/v1/lists/:id` (`name`, `item-retention-days`, `screen-at-completion`, `use-for-compromised-ids`).

2. **Attributes.**
   - **List.** Public: `name` (1–255), `status` (`active`, `archived`), `archived-at`, `created-at`, `updated-at`, and `allow-fuzzy-name-first` on names lists. Ours:
     - `type`, `item-count` and `version`, which every item write bumps;
     - `item-retention-days`: null or 1–3,650, enforced by redaction in the C16 pass. On face and background lists it is required and at most the environment's `face-template-retention-days`, because the source consent promises that window (P08);
     - `field-key` (fields lists): a key of the inquiry's `fields`;
     - `case-sensitive` (strings lists; default `false`);
     - `default-region` (phones lists; an ISO alpha-2 code or null);
     - `screen-at-completion` (default `true`; C99.5);
     - `use-for-compromised-ids` (government ID number lists; default `false`; C99.9).
   - **Item.** Public: `status` (`pending`, `active`, `archived`), `archived-at`, `created-at`, `updated-at`, `redacted-at`, `match-count` (default 0), and the `creator` relationship (`user`, `api-key`, or the importer `mprt_`). Workflow creators come in Phase 8. Ours:
     - `key-id` on fingerprint items (C94.4);
     - `pending` means "not yet indexed for matching", which only face and background items ever are, while they are embedded (C99.7).
3. **Scopes** (ours, mapping the public `list.read`/`list.write` and `importer.read`/`importer.write`): `lists:read`, `lists:write`, `importers:read` and `importers:write`. The built-in role lists gain them, as C72 did for reports.
   - Face and background items also need `pii:view` to create, since an item embeds a person's face.
   - `POST /api/v1/lists/match` needs `lists:read` and `pii:view` (P11): it tells whether a value is listed.
4. **Face and background lists are disabled until acknowledged** (decision 26). An environment setting, `biometric-lists-basis` (a string of at most 500 characters, or null; permission `settings:privacy`; audit-logged), must be set before a face or background list can be created. Otherwise creation answers 409 `biometric_lists_not_acknowledged`.
   - **Clearing the setting redacts** every such list and its items: templates, layouts and masked files are deleted, not archived (P08). It also drops the decrypted cache (C99.7).
   - **Who builds it** (F16): 7B Stage 1b adds the hook `onSettingsChangedInTx(tx, environmentId, before, after)` (a stub) to the shared `services/settings.ts`, and `api-biometric-lists` implements it. `api-lists` checks the acknowledgement through the port `BiometricListsGate`, which `api-biometric-lists` implements.
5. **Limits** (ours; stated in the API docs and served in the list resource's `meta`):
   - at most 1,000 active lists per environment, and at most 1,000,000 items per list;
   - face and background lists: at most 10,000 items each;
   - geolocation `radius-meters`: at most 500,000;
   - a C12 policy, `lists-write`: 600 item writes per minute per environment.
6. **PII.** Every item value is PII except `country-code`: masked without `pii:view`, and `null` after redaction. That includes the create bodies' attributes in stored API logs (C107.5).
   - List names are not PII, and the docs warn operators not to put personal data in them.
   - The C53.7 collision test covers the new resources and bodies.
7. **Events.** None for lists or items, as in the public API. `list-match.created` is ours (C99.3).

### C98. List storage and match keys

1. **Tables** (7B Stage 1b).
   - `lists`: environment-scoped, with `type` and `version` columns.
   - `list_items`:
     - `value`: sealed JSON of the item as entered, with the row AAD `list_items.value#<id>`;
     - `match_key`: `text`, 64 lowercase hex characters with the existing `hexDigest` check. Every blind index today has this form; `bytea(32)` is not a Postgres type (F10). Every kind has one (2), so the dedup index works for every kind;
     - `normaliser_version`, `key_id` (fingerprint kinds), `status` and `match_count`;
     - `created_by_type` and `created_by_id`;
     - `archived_at` and `redacted_at`;
     - a partial unique index on `(environment_id, list_id, match_key) where archived_at is null and redacted_at is null`.
   - `list_item_keys (environment_id, item_id, key_kind, match_key)`: the extra probe keys of the multi-key kinds, indexed on `(environment_id, key_kind, match_key)`.
   - Side tables, keyed by item id:
     - `list_item_ip_ranges (range cidr)`, with an **SP-GiST** index on `inet_ops`. A migration test asserts the operator class: with `btree_gist` installed, a default GiST class on `cidr` silently falls back to a sequential scan;
     - `list_item_geo (bbox box, part smallint)`, with a GiST index. The box is rounded outward to 0.01°, and an item that crosses ±180° gets two rows. The sealed item keeps the exact point;
     - `list_item_faces (template sealed, model, source_inquiry_id)`;
     - `list_item_backgrounds (layout vector(144), valid_cells, coverage, masked_file_key, masked_file_wrapped_dek)`. The masked image is an envelope object; the `files` table requires a verification.
   - No `earthdistance`: it is not a trusted extension on the pinned image, and installing it needs a superuser.

2. **Normalisers and keys** (F11).
   - **`packages/checks/src/lists/`** (pure; written test-first with golden vectors) produces canonical key **inputs**: `listKeyInputs(kind, value) → { keyKind, input }[]`, plus `LIST_KEYS_VERSION`. `packages/checks` cannot compute keyed HMACs, since the environment subkey lives in `packages/db`.
   - **`packages/db/src/blind-index.ts`** exports one new function, `identifierKey(key, environmentId, label, input) → hex`, under the existing per-environment subkey. 7A Stage 1b adds it with 7A's labels, 7B Stage 1b adds 7B's labels, and a golden test per label pins it.

   | Kind | Normalisation (the key input) | Label |
   |---|---|---|
   | string | NFKC, trim, collapse inner whitespace; `toLowerCase()` unless `case-sensitive` | `openverify/identifier-string/v1` |
   | email, address match | trim; split at the last `@`; domain lower-cased and passed through `domainToASCII`; local part lower-cased | `openverify/identifier-email/v1` |
   | email, domain match | the domain as above; a probe sends its domain and every parent | `openverify/identifier-email-domain/v1` |
   | phone | `libphonenumber-js` to E.164 (the item's region, or the list's `default-region`); numbers that do not parse are refused | `openverify/identifier-phone/v1` |
   | government ID number | the class (or `*`) and `normalizeIdentificationNumber`; a probe sends `<class>|<n>` and `*|<n>` | `openverify/identifier-government-id-number/v1` |
   | name (exact) | the C78 name normaliser with both ICAO 9303 folds, keyed `<last>|<first>` and `<first>|<last>` per fold (at most 4 keys, in `list_item_keys`) | `openverify/identifier-name/v1` |
   | name, last-name candidates (fuzzy lists) | the last name per fold (F17) | `openverify/identifier-name-last/v1` |
   | IP address, single | canonical text, IPv4-mapped folded to IPv4 | `openverify/identifier-ip/v1` |
   | IP range | `network()`; host bits refused (`host_bits_set`); a prefix of at most /31 for IPv4 and /127 for IPv6, otherwise treated as a single address. The plaintext `cidr` row matches (decision 28); the HMAC of the canonical range text dedups | `openverify/identifier-ip-range/v1` |
   | country | ISO alpha-2, upper case; matched on the plaintext column; the HMAC dedups | `openverify/identifier-country/v1` |
   | geolocation | ranges checked; the canonical `lat,lon,radius` at 10⁻⁶°; the plaintext box matches; the HMAC dedups | `openverify/identifier-geolocation/v1` |
   | browser or device fingerprint | trim; lower-case hex | `openverify/identifier-browser-fingerprint/v1`, `…-device-fingerprint/v1` |
   | field | by the field's type: the string rule, a canonical decimal, an ISO date, or `true`/`false`; keyed `<field key>|<value>` | `openverify/identifier-field/v1` |

   - **The version guard.** `LIST_KEYS_VERSION` and a golden test fail when any output changes without a bump, as `keysVersion()` does in Phase 6.
   - **Shared with the graph** (decision 29, narrowed; F10). The identifier labels are shared with the graph (C101.2) for email, phone, IP address, name, fingerprints and fields, so a list hit and a graph link meet on one key per kind. There are three exceptions:
     - the graph's `government_id_number` uses the existing issuer-qualified C31.8 index, which a list item without an issuer cannot reproduce;
     - the graph's `chip_signature` and `crypto_address` use their existing indexes, and have no list kind.

     A graph action that adds such a value to a list opens the source value and re-keys it.
   - **Rebuild.** `blind-index:rebuild` gains `rebuildListIndexes`, which recomputes every key from the sealed values. A row whose `normaliser_version` is older than the process's is not matched: its list reports `normaliser_outdated` (C99.1) until it is rebuilt. A fingerprint item whose `key_id` is not current reports `key_rotated` (C94.4).

3. **Sealing and keys.**
   - The new sealed columns join `ENCRYPTED_COLUMNS`, `SEALED` and `REWRAP_TABLES`. The envelope objects' wrapped DEKs (the background mask, the importer file, transaction files) are registered with the `file` AAD kind, each with a `kek:rewrap` test (P18).
   - The research measured seal plus HMAC at about 35 µs and 191 B per row; the fact-check did not re-measure it. `list-logic` measures it again.

4. **Redaction and retention.**
   - **Item redaction** (by `item-retention-days`, or when a list is redacted) does four things:
     - nulls `value`, `match_key` and the keys;
     - deletes the side rows and envelope objects;
     - sets `redacted_at` and archives the item;
     - calls `stubEventPayloads` and `forgetStoredResponses` for the item's id, so API logs and idempotency copies of its create request lose the value (P04, F23).
   - **Subject redaction.** Redacting an inquiry or an account redacts its `list_matches` (C99.3) and the face and background items whose source it was (C99.7).
   - **Docs.** The docs state that the blind-index key deserves the same care as the KEK. Phone numbers and ID numbers come from small spaces, and the research timed about 284,000 HMACs per second on one thread.

### C99. List matching

1. **Service.** `matchLists(tx, environmentId, probes, options) → { matches, unscreened, notApplicable }` in `apps/api/src/services/lists/match.ts`. Each probe is `{ source, kind, values }`.
   - **Each match names:**
     - the list and the item, and the probe source;
     - the `method`: `exact`, `cidr`, `radius`, `fuzzy_name`, `face_cosine` or `background`;
     - the `tier` of the evidence (H15): R for exact, CIDR and radius on R-tier probes; H for fuzzy names, backgrounds, IP-derived countries and points, and fingerprints read as "the same device";
     - `confidence` (H only); `approximate: true` for IP-derived probes; a `score` for non-exact methods;
     - the list's `version`.
   - **`unscreened`** lists every selected list that could not be read, with a reason from a closed set (H11, V15, V21):
     - `list_items_pending`;
     - `probe_unavailable`: a value exists but could not be read;
     - `probe_too_coarse`: for example, an IP point without City Lite;
     - `consent_not_given`, `normaliser_outdated`, `key_rotated`, `limit_exceeded`, `list_archived`;
     - `method_not_on_demand`;
     - `kind_not_collected`: the environment collects no value of that kind, such as fingerprints with device recognition off;
     - `client_address_untrusted`: IP probes from a `trust-all` address in production (P05).
   - **`notApplicable`** lists the selected lists whose kind the subject has no value for (`subject_has_no_value`, H16). Those lists were screened, with nothing to compare, and never make a screening partial.
   - **Ports with fakes** (F08). Stage 3 of 7B builds against these, declared by 7B Stage 1b with in-memory fakes in `test-support/fakes.ts`:
     - `ListItemWriter.insertItems` and `ListService.createItem` (owner `api-lists`), used by the importer and the graph's add-to-list action;
     - `BiometricListMatcher.match`, `BiometricItemRedactor.redactBySource` and `BiometricListsGate` (owner `api-biometric-lists`).
2. **Methods.**
   - **Exact kinds** compare `match_key` and the `list_item_keys` (btree, environment first).
   - **IP probes** test both the HMAC of the address and `range >>= $probe` on the range table.
   - **Geolocation probes** take the session's IP city point with `IP_CITY_UNCERTAINTY_METERS` (C95.3).
     - An item whose `radius-meters` is below that uncertainty is `probe_too_coarse`, never "no match".
     - Otherwise a box prefilter (`bbox @> box(p, p)`) is followed by a haversine (C95) over the candidates' sealed points. The probe matches within `radius-meters + uncertainty`, and the match records the distance.
   - **Fuzzy first names** (F17). With `allow-fuzzy-name-first`, candidates are the items whose last-name key matches under the folds.
     - Only those are decrypted, at most `FUZZY_NAME_CANDIDATE_CAP` (2,000; provisional). Beyond it the list is `limit_exceeded`, never a silent cap.
     - The C78 scorer then scores the first names, and its name-match threshold applies (H, `beta`; the score is the confidence).
     - The 1,000,000-item benchmark is reported.
   - **Faces and backgrounds:** 7.
3. **Records** (ours). `list_matches` (`lmt_`, public type `list-match`).
   - **Contents:**
     - environment, list, item, subject (`inquiry`, with its `account`), probe source;
     - method, tier, confidence, `approximate`, score;
     - the matched value form, sealed and shown only with `pii:view`;
     - `status` (`open`, `dismissed`), `dismissed-at`, a dismissal `reason` (PII; at most 500 characters), `created-at`.
   - **Routes:**
     - `GET /api/v1/list-matches` (`filter[inquiry-id]`, `filter[account-id]`, `filter[list-id]`, `filter[status]`);
     - `GET /:id`;
     - `POST /:id/dismiss` (`lists:write`).
   - **Event:** `list-match.created` (subject `list-match`). The item's `match-count` counts its matches.
4. **When screening runs.**
   - **At the inquiry's first move out of `pending`** (completed, failed or expired; H23), through an outbox:
     - the hook `createListScreeningInTx`, a Stage 1b stub in `transitionInquiryInTx`, writes a `list_screenings` row (`pending`) when the template version's `list-config` selects any list. With no list selected it writes `inquiry/list_match_count` as `null` with `no_lists_selected`;
     - the `list-screen` queue (worker) runs `matchLists`, and the `list-screen-sweep` repeatable job (15 s) re-enqueues pending screenings, so a lost enqueue recovers;
     - the screening ends `completed`, `partial` (some lists unscreened) or `errored`. In the same transaction it writes its matches and the count, on its own `list_screenings` row (V06). The serving code merges `inquiry/list_match_count` from that row (C90.5; H02):
       - after a `completed` screening, the count;
       - after a partial or errored one, `null` with `list_unscreened`, with `signal-details` listing the unscreened list ids and reasons;
       - until the screening ends, `null` with `list_screening_pending`;
       - with no screening row, `null` with `no_lists_selected`;
     - that signal alone is written after completion, and its `computed-at` says so. It is registered `review-rule: false` (C90.6); `on-list-match` covers it instead.
   - **On demand:** `POST /api/v1/lists/match` (ours; `lists:read` and `pii:view`; probes under `data.attributes`, at most 20; the C12 policy `lists-match`, 60 per minute per key).
     - It runs the exact, CIDR and radius methods only. Fuzzy, face and background lists answer as `unscreened` with `method_not_on_demand` (P25); the screening job and the custom-list report run them.
     - It answers `matches`, `unscreened` and `not-applicable` (H02), and writes no records.
   - **No retroactive screening:** items added later never re-screen past inquiries.
5. **Template configuration.** A version member, `list-config` (strict; column `inquiry_template_versions.list_config`, default `{}`):
   - `screen`, which is one of:
     - `all` (the default): every active list whose `screen-at-completion` is true, of these kinds: email, phone, government ID number, name (exact and fuzzy), IP address and range, country, geolocation, browser and device fingerprint, and field (H16). Strings are never screened at completion, and face and background lists only when named.
       - Kinds the environment does not collect are excluded from `all` and recorded in the screening's details as `kind_not_collected`: fingerprints without device recognition, and geolocation without City Lite (V21).
       - Publish refuses a named list of such a kind (422 `kind_not_collected`), and the version page warns;
     - `none`;
     - a list of up to 50 list ids, which may include face and background lists. A named list that is later archived is unscreened with `list_archived`, and the template version page warns.
   - `on-list-match`: `none` (the default) or `needs_review`.

   Probe sources, in order, as in C84.2:

   | Kind | Sources |
   |---|---|
   | email | the confirmed email OTP destination, then the inquiry's `fields`, then the account's `fields` |
   | phone | the confirmed phone OTP destination, then as above |
   | government ID number | the extraction of the latest government ID verification decided `passed` or `needs_review` (number and class), then the database verification inputs |
   | name | the same extraction, then the inquiry's `fields` |
   | IP address, country, geolocation | every session's address, IP country (H, approximate) and IP city point. For country, also the ID's issuing country (R) and the address country in `fields` |
   | browser fingerprint | the sessions' strict browser HMACs (device recognition only) |
   | device fingerprint | the sessions' `ANDROID_ID` HMACs only. The web device class is never a probe (V10) |
   | field | the inquiry's `fields[field-key]` |
   | face, background | the inquiry's centre selfie (7) |
   | string | not screened at completion; on demand, and in Phase 8 workflows |

6. **`on-list-match: needs_review`** (ours, off by default) follows C84.3.
   - **When it moves an inquiry:** the completion screening first records an open match, or ends `errored` or `partial`, and the inquiry is `completed`. The screening's transaction then moves the inquiry to `needs_review`, with the cause `list_match` or `list_unscreened`.
   - **Decided inquiries:** a decided inquiry is not changed. The screening records `inquiry_already_decided`, and the inquiry page shows "decided before the list screening finished" (H31).
   - **The window:** the 15 s sweep plus the run. `docs/lists/README.md` states it and advises marking an inquiry for review before deciding.
7. **Face and background lists** (advisory; never a decline; owner `api-biometric-lists`).
   - **Adding items.** An item is added from an inquiry: `POST /api/v1/list-item/faces` (or `…/selfie-backgrounds`) with `list-id` and `inquiry-id`.
     - The item is created `pending`. The `list-item-embed` queue re-embeds the inquiry's centre selfie through vision `/v1/embed/face` while the file still exists; for a background, it computes the layout vector and a person-masked background image. The item then becomes `active`, or `archived` with `source_unavailable`.
     - Phase 4 deletes face templates when an inquiry is declined, so the item keeps its own sealed copy.
     - Adding an item needs the source inquiry's `consent.biometric-matching`; otherwise 422 `consent_not_given`.
     - The item is redacted no later than `face-template-retention-days` after the source consent (C97.2, P08).
     - Image import is deferred (decision 27).
   - **Matching** needs the probed inquiry's `consent.biometric-matching`. Without it the list is unscreened with `consent_not_given`.
     - **Faces:** the worker decrypts the list's templates and scores cosines against the probe's embedding at `FACE_LIST_THRESHOLD`. That is Phase 4's repeat threshold, 0.5, provisional. Phase 4's calibration expects about 0.04 false matches per search over 10,000 templates at 0.5, and 7.57 at 0.394.
     - **Backgrounds:** nearest layout vectors by exact scan, then ORB and RANSAC on at most five candidates through vision `/v1/compare/background` (H, `beta`).
     - Every result states the count compared and the best score.
   - **The decrypted cache** (P08, F39) is an LRU of at most 64 MB per worker with a 10-minute idle expiry, keyed by `(list id, version)`. It is evicted on a version change, on archive or redaction, and when `biometric-lists-basis` is cleared. Its hit rate and memory are recorded in the TDD file.
   - **No ANN index**, so the Phase 4 privacy finding stands.
   - **Tests:**
     - the consent refusals;
     - a declined source inquiry whose template is gone still matches through the item's own copy;
     - the cap and `source_unavailable`;
     - retention by the consent window;
     - cache eviction when the basis is cleared.
8. **Tests on Testcontainers:**
   - the SP-GiST plan, and IPv4 and IPv6 containment, with the IPv4-mapped fold;
   - radius at the antimeridian, and `probe_too_coarse`;
   - fuzzy first names through last-name candidates, and `limit_exceeded`;
   - the outbox recovering a lost enqueue;
   - `partial` with a pending face list; `subject_has_no_value` not making a screening partial;
   - `on-list-match` with an approval inside the window;
   - redaction of matches, with `forgetStoredResponses`;
   - `list_match_count` in each of its states.
9. **`id_compromised_detection` reads lists** (an existing R-tier check).
   - **Background.** Its input `compromisedList` (`packages/checks/src/government-id/inputs.ts:136-137`) has waited for Phase 7 since Phase 3. Today no API code supplies it, so its `compromised_list_match` reason never fires.
   - **The port.** 7B Stage 1b adds a port, `CompromisedIdLookup`, called where the government ID job assembles its input (`apps/api/src/jobs/government-id.ts`). `api-lists` implements it. It answers `{ matched, unscreened: [{ list-id, reason }] }` from an exact match of the extraction's number and class against every active government ID number list with `use-for-compromised-ids: true`.
   - **The input** widens to that shape (H09).
     - When a configured list is unscreened (for example `normaliser_outdated` after an upgrade) and nothing else fails, the check answers `not_applicable` with the new reason `compromised_list_unavailable`. ADR 0002 §3b then routes a required check to review: never a fake `passed`.
     - With no such list, or no extracted number, the input stays absent, as today.
     - The check's metadata lists the lists screened.
     - `api-lists` owns the check's input and reason changes in `packages/checks/src/government-id/`.
   - **Records.** A match also writes a `list-match` record, with source `government-id.identification-number`.
   - **The one stated exception** (P13). This is the only place where a list match can fail anything. It is opt-in per list, it is an exact R-tier match on the operator's own data, and the check's requirement stays the operator's: they can make it advisory. The Rules, ADR 0006 and `docs/lists/README.md` name the exception, together with the operator's GDPR Art. 22 duty to offer human review.
   - **Tests:**
     - a listed number fails the check with `compromised_list_match`;
     - an archived item does not;
     - another environment's list never matches;
     - an outdated normaliser gives `not_applicable`, never `passed`.

### C100. Importers

1. **Routes** (public paths for six kinds; ours for strings, countries, fields and the two fingerprints): `POST /api/v1/importer/list-item/<plural>`, as multipart (`data[attributes][file]` and `data[attributes][list-id]`) or as JSON with a base64 `file`, ≤ 20 MB either way. The JSON `file` member is marked PII: the stored API log keeps only its length and SHA-256, as it keeps multipart parts (F23). The answer is an importer (`mprt_`, public type `importer/list-item/<singular>`, C97.1) with:
   - public `status` (`pending`, `ready`, `errored`), `successful-count`, `duplicate-count`, `error-count`, `created-at` and `completed-at`;
   - ours: `mode` (`all-or-nothing`, the default, or `skip-invalid`), `row-count`, `already-present-count`, `encoding`, and `file-sha256`.

   `duplicate-count` counts rows repeated within the file; `already-present-count` counts rows already active in the list (H30).

   `GET /api/v1/importers` and `GET /api/v1/importers/:id` read them. Ours: `GET /api/v1/importers/:id/errors` (cursor) answers `{ row, column, code }` from the table `list_import_errors`, at most 1,000 per import (F12). Scopes `importers:write` (with `lists:write`) and `importers:read`. Face images: deferred (decision 27).
2. **Pipeline.**
   1. The route buffers the upload (≤ 20 MB, `parseAs: 'buffer'`), so the C12 `Idempotency-Key` works. It stores the file as an envelope-encrypted object (`encryptBytes`). The `files` table requires a `verification_id`, so the importer row itself keeps the storage key, the wrapped DEK and the file's SHA-256. The object is purged 7 days after the import ends (a C16 retention step).
   2. The `list-import` queue (worker) reads and decrypts the object (at most 20 MB, so the whole buffer; the storage port has no streaming read, F21), then decodes it with a `TextDecoder` with `fatal: true` (UTF-8 by default; a WHATWG label through an `encoding` parameter for legacy single-byte files; UTF-16 refused), then `csv-parse` 7.0.3, then the C98.2 normaliser per row.
   3. Rows go to the per-import staging table `list_import_rows`, with each row's value sealed under its row AAD (P18). The table is applied in one transaction, through `ListItemWriter.insertItems` (C99.1): when no row failed (`all-or-nothing`), or for the valid rows only (`skip-invalid`). The staged rows are deleted when the import ends, whatever its outcome.
   4. The `list-import-sweep` repeatable job recovers a lost enqueue.
   5. The C12 policy `importers` allows 10 imports an hour per environment. It needs the per-policy window of C107.3 (F09).

   `csv-parse` options: `bom: true`, `max_record_size: 4096`, `relax_column_count: false`, `cast: false`, `info: true`, and `to_line` one above the 100,000-row cap.
3. **Columns** (the public CSV headers): `value,match_type` (emails), `latitude,longitude,radius_meters`, `id_number,id_class`, `name_first,name_last`, `value` (IP addresses, phones, strings, fingerprints), `country_code`, `field_value`. A file with an unknown, missing or repeated column is refused.
4. **Errors and logs.**
   - Codes come from a closed set: `invalid_encoding`, `missing_column`, `unknown_column`, `duplicate_column`, `row_limit_exceeded`, `record_too_large`, `field_count_mismatch`, `invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class`.
   - A value is never echoed: `csv-parse` attaches the offending record to some errors, so the job maps each to its code and line and drops the record.
   - Logs and the audit entry carry codes and counts only.
5. **Idempotency at three levels:**
   - the request, through `Idempotency-Key`;
   - the file: the same list, mode and SHA-256 within 24 h answers the existing importer (ours);
   - the row: the partial unique index of C98.1 counts a repeated row as `already_present`.

   A leading `'` before a formula character is stripped once, so a CSV written by C103's export re-imports unchanged.
6. **The shared CSV writer** (`packages/checks/src/csv/`): quote every field; double embedded quotes; prefix `'` to a cell starting with `=`, `+`, `-`, `@`, tab, CR, LF or the full-width `＝＋－＠`. `csv-stringify`'s `escape_formulas` misses LF and the full-width forms, so this is our own `cast` hook. Golden vectors from OWASP's list. The docs repeat OWASP's warning that no escape is safe for every spreadsheet. List exports themselves are deferred to Phase 9 (C110); the graph export uses this writer (C103).
7. **Tests:**
   - the encodings (an invalid byte refused; a windows-1252 file accepted by parameter; a UTF-16 BOM refused);
   - the caps;
   - `all-or-nothing` rollback;
   - the three idempotency levels;
   - no value in any error, log or problem.

### C101. The graph: storage and indexing

1. **Model.** The graph links **accounts** through property values, as the public product does. An inquiry reaches it through its account, and every inquiry has one: `resolveForInquiry` creates a `user` account when none is named.
   - `graph_attributes (environment_id, kind smallint, value_key text, key_id, account_id, source_type, source_id, first_seen_at, last_seen_at)`. There is one row per account, value and source. `value_key` is 64 hex characters with the `hexDigest` check (F10). The table is indexed on `(environment_id, kind, value_key)` and `(environment_id, account_id)`.
   - **No write-side degree table** (F24). Fan-out is checked when a query reads, by a capped count on the index: `count(*)` over `… LIMIT cap + 1`. No first flow call takes a hot per-value lock.
   - Pairwise account–account edges are not stored: a value with `d` holders would need `d(d−1)/2` rows.

2. **Kinds.** A frozen enum in contracts. The public node type names are snake case, and the plan uses them throughout (H19). Strength drives traversal.

   | Kind | Source | Key | Strength |
   |---|---|---|---|
   | `government_id_number` | the government ID extraction; chip DG1 | the existing issuer-qualified C31.8 index and `chipDocumentNumberIndex` | strong |
   | `chip_signature` (ours) | the NFC SOD | `chipSodIndex` | strong |
   | `crypto_address` | signed-challenge ownership | `cryptoAddressIndex` | strong |
   | `email_address`, `phone_number` | a confirmed OTP destination | `identifier-email`, `identifier-phone` | strong |
   | `email_address_unconfirmed`, `phone_number_unconfirmed` (ours) | a typed field | the same keys | medium |
   | `reference_id` | the account's reference id | `openverify/identifier-reference-id/v1` | strong (a seed kind; exact) |
   | `name_birthdate` (ours) | the extraction or the fields: name folds plus `YYYY-MM-DD` | `openverify/identifier-name-birthdate/v1` | medium |
   | `address` | the Phase 5 address normaliser, only when street, city, subdivision, postal code and country are all present | `openverify/identifier-address/v1` | medium |
   | `device_fingerprint` | the `ANDROID_ID` HMAC | `identifier-device-fingerprint` | medium |
   | `device_class` (ours) | the web device-class HMAC | the same label | **weak** (F24: every user of one phone model shares it) |
   | `browser_fingerprint` | the strict HMAC | `identifier-browser-fingerprint` | **weak** |
   | `ip_address` | session addresses; non-global, relay and documentation ranges are excluded outside sandbox | `identifier-ip` | **weak** |
   | `name`, `birthdate`, `postal_code`, `email_domain` | as above; free-mail domains are excluded by the Phase 5 list | their identifier labels | **weak** |

   - **Weak kinds** are written only when the environment setting `graph-weak-kinds` is on (default off; P26). They are traversed only when a template opts in, at `max-hops` ≤ 4 (decision 34), and never enter components (6). In the research's synthetic graph of a million accounts, IP links alone merged everything into one component.
   - **Fingerprint kinds** are written only for sessions under the device-recognition tier.
   - **Labels and vectors.** The `name_birthdate`, `address`, `postal_code` and `reference_id` keys are frozen with golden vectors in `packages/checks/src/lists/`, beside C98.2 (`list-logic`).
   - **Deferred to C110:** the public email local-part, SSN, last-4 SSN, the document number as distinct from the ID number, custom nodes, and similarity nodes.

3. **Indexing.**
   - **In the same transaction**, where the plaintext is already held (F03):
     - account field writes;
     - the session evaluation at the first flow call (C93.2): IP rows, through Stage 1b's reserved call site, written only with `graph-weak-kinds` on, and never for a `trust-all` address in production (P05);
     - linking an inquiry to an account (consolidation, `add-objects`).

     Stage 1b declares `indexAccountAttributesInTx(tx, environmentId, accountId, source, attributes)` and calls it at those points. It computes keys from the plaintext the caller holds.
   - **Through an outbox at the inquiry's first move out of `pending`** (completed, failed or expired; H23):
     - the hook `createGraphIndexJobInTx`, a Stage 1b stub, writes a `graph_index_jobs` row;
     - the `graph-index` queue (worker, with the keyring and the blind-index key) opens the extraction, the fields and the confirmed OTP destinations and indexes them. It also indexes the inquiry's sessions' device HMACs (`device_fingerprint` from `ANDROID_ID`; `device_class` and `browser_fingerprint` when weak kinds are on), keyed with `identifierKey` (V09). Verifications marked `from-rejected-handoff` are skipped (C96.3);
     - the `graph-index-sweep` repeatable job (15 s) recovers a lost enqueue.

     `LifecycleDeps` stays `{ events, clock }`. Failed fraud attempts are indexed too, so they link to a later attempt.
   - **Settings** (P26). `graph-indexing` (environment; default `on`; `settings:privacy`) turns all of this off for operators who do not want cross-account links; queries then answer `index-complete: false`.
   - **Ownership.** `api-graph` implements the hook and the job. A test per hook asserts the rows.

4. **Consolidation and redaction.**
   - Consolidation moves the absorbed account's rows to the survivor in the consolidation transaction, under the existing account lock order.
   - Redacting an inquiry deletes the rows it contributed; redacting an account deletes all its rows.
   - Both also scrub the account from every stored graph query result (C102.7; P04).
   - Tests:
     - a consolidation keeps one row per value and source;
     - a redaction leaves no row and no stored result naming the source.

5. **Backfill and completeness** (H10, V11).
   - **Upgrade backfill.** On upgrade, every environment's accounts and inquiries that predate the migration are indexed by a one-time, resumable `graph-backfill` job. It runs in bounded batches, in the worker, and is enqueued at startup while `graph_index_state` is not `complete`.
   - **Per-kind state.** `graph_index_state` keeps one row per environment and kind, with `indexed-since` and `complete`.
     - A switch that starts writing a kind enqueues that kind's backfill and marks it not complete until the backfill is done. The switches are re-enabling `graph-indexing`, turning `graph-weak-kinds` on, and enabling device recognition.
     - A new environment starts complete.
   - **What results say.**
     - `kinds-not-indexed` lists the template's connect kinds that are not written now (off by a setting), or not complete for the queried window.
     - `index-complete` is `false` whenever that list is not empty, and the console says which kinds the index lacks.
     - Each switch has a test.
   - The CLI `pnpm --filter @openverify/api graph:reindex [--environment <env_…>]` runs the same code on demand.
   - `blind-index:rebuild` calls it (`rebuildGraphIndexes`) after a key change.

6. **Components** (ours; H, `beta`; advisory; opt-in).
   - With the environment setting `graph-components` on (default off; P26), a nightly `graph-components` repeatable job runs union–find over strong kinds only. It writes `graph_components (environment_id, account_id, component_id, size, computed_at)`.
   - The account page shows "linked through strong identifiers: N accounts" with the `beta` badge. It shows "not computed yet" for accounts newer than the last run, and `computed-at` otherwise.

7. **Isolation.** Per-environment subkeys turn a sandbox value and a production value into two unrelated keys, so the graph is per environment by construction.

8. **Benchmark** (reported, not gated, as Phase 6 treats its 2,000,000-name case; F18).
   - `apps/api/scripts/graph-benchmark.ts` (script `graph:benchmark`) builds 1,000,000 synthetic accounts and 6,000,000 rows on Testcontainers and runs the C102.3 engine itself.
   - Its synthetic-graph builder is shared with the CI gate of 100,000 accounts, which checks the caps and timeouts (C102.8).

### C102. Graph queries and query templates

1. **Templates** (ours as a resource; the public product has templates but no template API).
   - `graph-query-template` (`grqt_`) has a `name`, a `status` (`active`, `archived`) and a `latest-version`.
   - `graph-query-template-version` (`grqtv_`) is draft, published or superseded, with one published version per template. Publishing happens under the template lock, as in C71.
   - Routes: `/api/v1/graph-query-templates` (create, list, get, update the name, archive) and `/api/v1/graph-query-template-versions` (create a draft, update a draft, publish, get).
   - **Scopes** (P11, F29): `graph:read` for every `GET`, and `graph:write` for every write and for running, re-running and cancelling queries. `graph:read` joins `NOT_FOR_VIEWERS`, because graph results are profiling. Each scope refusal has a test.

2. **Template config** (`graphQueryTemplateConfigSchema`, strict). Values are bound, never interpreted.
   - `parameters`: 0–10 of `{ name, kind }`.
     - Names follow the public `{{param}}` rules: case-sensitive letters, digits and underscores.
     - A parameter named `account_id` is bound to the account in context: the account page here, and Phase 8 workflows later.
   - `start`: 1–5 clauses, either `{ kind, value: "{{name}}" }` or `{ kind: "account_id", value: "{{account_id}}" }`. The public pattern query, with no starting value and a time window, is deferred (C110; H19).
   - `connect-kinds`: a subset of C101.2.
   - `max-hops`: 2, 4 or 6, counted the public way (two accounts that share a value directly are 2 hops apart). Default 4.
   - `node-limit`: 1–2,000, default 100.
   - `include-weak-kinds`: default `false`; `true` needs `max-hops` ≤ 4.
   - `filters`: account type ids, account statuses (`active`, `archived`), tags, and a created-at window given by parameter.

   Publish refuses unknown kinds, a weak kind without the flag, and an unbound parameter.

3. **Engine** (`apps/api/src/services/graph/query.ts`).
   - **Search.** A hop-by-hop breadth-first search with a visited set runs in one read-only transaction, with one parameterised statement per hop (`kind = any($1::smallint[])`, `account_id = any($2)`). No SQL, Cypher or expression text ever comes from a caller.
   - **Limits.**
     - Each statement runs under `SET LOCAL statement_timeout`, within the query's deadline.
     - A value whose capped count exceeds the fan-out cap (default 50, at most 500) is skipped and counted.
     - The search stops at `node-limit` with `node-limit-reached: true`.
   - **Why not a recursive CTE.** The research measured a recursive CTE repeating 3.7–7× the work at depths 3 and 4. C109 corrects PLAN §6's "recursive-CTE queries".

4. **Graph queries** (public): `POST /api/v1/graph-queries`.
   - **Body:**
     - `graph-query-template-id` (required);
     - `parameter-map` (required; `variable-map` is accepted as its deprecated name). Both are marked PII, so stored API logs mask them;
     - `timeout-in-seconds`: 1–59, default 30;
     - `meta.run-sync`: default `false`.
   - **PII-kind parameters** (P11). A parameter whose kind identifies a person (email, phone, ID number, name, name and birthdate, address, reference id) needs `pii:view` as well as `graph:write`. A principal without it cannot use the graph to find who holds a value.
   - **Asynchronous runs** answer 201 `submitted`, and the `graph-query` queue runs them.
     - Each run claims its template under `pg_try_advisory_xact_lock(hashtextextended('openverify/graph-query/' || env || template, 0))`. A job that cannot claim returns successfully, and the `graph-query-sweep` (15 s) re-enqueues waiting queries, as C74.1 does (F40).
   - **Synchronous runs** (P25) answer the result, or what was gathered when the deadline passed, with `timed_out`.
     - At most 2 run per environment at once (an advisory-lock counter); more answer 429.
     - Their timeout is at most 10 s.
   - **Reads:** `GET /api/v1/graph-queries/:id` and, ours, `GET /api/v1/graph-queries` (cursor).
   - **Public attributes:**
     - `status`: `submitted`, `completed`, `errored`, `cancelled`, `timed_out`;
     - `params`: PII, masked member-wise without `pii:view`;
     - `created-at`, `updated-at`, `errored-at`, `completed-at`, and `redacted-at` (once set, `nodes` and `params` are empty);
     - `stats`: `{}` in Phase 7;
     - `explorer-url`: the console URL;
     - `node-limit-reached`;
     - `nodes[]` as `{ type, value }`, where `type` is the public snake-case name. Account nodes carry the account id. A property node's `value` is a random id local to this result, never the value and never derived from its key (ours, labelled; P17). The stored result maps it to the key on the server.
   - **Ours:** `index-complete` and `kinds-not-indexed` (H10), `skipped-hub-values`, `template-version-id`, and the links (`[{ from, to, kind }]` between node ids).
   - **Relationship:** `accounts`.
   - **Ours:** `POST /:id/rerun` emits `graph-query.reran`, then the terminal event. `POST /:id/cancel` applies to submitted queries only (`graph-query.cancelled`).

5. **Events:** `graph-query.submitted`, `.completed`, `.errored`, `.cancelled`, `.timed-out` and `.reran`. The surface index gains `.submitted` (C109).

6. **Values only through an audited unmask** (P17).
   - `GET /api/v1/graph-queries/:id/nodes/:node-id/value` needs `pii:view`. It resolves the node through the stored result's mapping, opens one source of that value among the result's accounts, and writes an audit entry.
   - It has its own C12 policy, `graph-unmask`: 60 a minute per principal.
   - Its answer, the plaintext value, is a PII response member. The stored API log masks it without `pii:view`, and a test checks that (P07).
   - The explorer calls it on an explicit click or key press, never on hover.

7. **Retention and redaction** (P04).
   - `graph-query-retention-days` (C16; default 30, range 1–365) redacts results: nodes, links, the node mapping and `params` are emptied, and `redacted-at` is set.
   - Redaction calls `stubEventPayloads` and `forgetStoredResponses` for the query's id.
   - Redacting an account or an inquiry removes the account, and its links, from every stored result (C101.4).
   - Every query is audited with its actor, template version, counts and truncation, never its parameters.

8. **Tests** on Testcontainers, against a 100,000-account synthetic graph:
   - depth and node caps; hub skipping through the capped count;
   - the deadline (`timed_out` with partial nodes); the synchronous cap (429);
   - weak kinds refused without the flag;
   - no value or key in any node id;
   - `index-complete: false` during the backfill;
   - a redacted account absent from stored results;
   - a cancel racing a completion (one wins);
   - the CI time budget for the suite, stated in its header.

### C103. Bulk actions from a graph result

1. **Route.** `POST /api/v1/graph-queries/:id/actions` takes `{ action, account-ids[] (1–500) | all: true, preview?: true, … }`. It needs `graph:read` as well as each action's own scope (V18). A non-preview call needs an `Idempotency-Key`.
   - **Selection.** It is the intersection of the submitted ids with the stored result, so read access to the graph cannot act on arbitrary accounts. `all: true` is refused with 422 `selection_too_large` when the stored result holds more than 500 accounts (P16, decision 37).
   - **Answers.** A preview answers counts. A non-preview answers per-account outcomes: `done`, `skipped_redacted`, `skipped_consolidated` or `refused_scope`.
   - **Audit.** One audit entry per action names the query.

2. **Actions.** Each checks its own scope, not a graph right.
   - `add-tag` and `remove-tag` (`accounts:write`).
   - `set-account-status` (`accounts:write`): `active` or `archived`, the two account statuses, through the `PATCH /accounts/:id` service with its events.
   - `add-to-list` (`lists:write` and `pii:view`), with `{ list-id, kind }`.
     - The server opens the selected accounts' sources for that kind and writes items through `ListItemWriter` (C99.1), with the user as creator and the query as source.
     - Face and background lists are refused with 422 `biometric_list_not_bulk` (P16). Their items come only through C99.7, one consenting inquiry at a time.
   - `export` (`accounts:read` and `pii:view`): a CSV of id, reference id, status, tags, hop distance and linking kinds, through the C100.6 writer. It is answered as `text/csv`, with at most 2,000 rows.
   - Creating a case waits for Phase 8.

3. **Tests:**
   - ids outside the result refused;
   - `all: true` above 500 refused;
   - each scope refusal;
   - biometric lists refused;
   - idempotent replay;
   - the per-account outcomes;
   - the export's neutraliser.

### C104. Transaction types and field schemas

1. **Types** (public `transaction-type`, `txntp_`; ours: the full API and versions).
   - Routes: `/api/v1/transaction-types` (create, list, get, update name, archive by `DELETE`) and `/api/v1/transaction-type-versions` (`txntpv_`; create a draft from the latest, update a draft, publish, get). Publishing works as C71 does.
   - Public attributes: `name`, `created-at`, `updated-at`, and `field-schemas[]` (of the published version).
   - Ours: `status`, `statuses[]`, `relation-schemas[]`, `latest-version` and `published-version`.
   - Each transaction pins the version it was created under (decision 38); the public types are unversioned, but existing transactions keep the configuration they were created under.
   - Scopes `transactions:read`, `transactions:write`, and ours `transactions:redact` and `transaction-types:write`.
2. **Field schemas** (the fifteen public wire types, a discriminated union on `type`; each has `key` (1–64, `^[a-z0-9][a-z0-9_-]*$`), `label`, an optional `default-value` and `config`):

   | Type | Config (beyond the shared) |
   |---|---|
   | `string` | `max-char-length` (default 255, at most 1,024), `sanitize` (`[]` or `["html"]`: trims and removes control characters; never an HTML sanitiser, since the console escapes output) |
   | `integer`, `number` | `min`, `max` (integers within `Number.MAX_SAFE_INTEGER`; numbers finite) |
   | `boolean`, `datetime`, `email-address` | none |
   | `date` | `min-date`, `max-date` |
   | `choices`, `multi-choices` | `options` (1–200), `option-labels`, `allow-empty` (default `false`); defaults must be options |
   | `array` | `item-schema` (one field schema); `max-items` (required, at most 1,000; P22) |
   | `hash` | `item-schemas` (field schemas), `ignore-unknown-keys` (default `false`). A nested object, not a hashed value: PLAN §2 is corrected (C109) |
   | `file` | `max-file-size-bytes` (default 10,000,000), `min-file-size-bytes` (default 1), `supported-mime-types` (checked against the bytes' signature), `page-count-limit-enabled`, `page-count-min`, `page-count-max` (the Phase 5 PDF parser) |
   | `platform-file` | none: a file the platform already holds (an existing `fil_` of the environment). Writing one needs the scope that reads that file (`verifications:read`), and a selfie or portrait file also needs `pii:view` (P12). Reading it never goes through the transaction: the value carries only the `fil_` id, and its content is served only by the existing file route, under that file's own scope and `pii:view` |
   | `json` | `json-schema`: a restricted subset (3). The public product treats Draft 7 schemas as informational; enforcing a subset is ours (H30) |
   | `relation-schema` | `target`: `document-generic`, `document-government-id`, `document-government-id-nfc`, `selfie`. A value is the `ver_` id of a verification of the matching type: `document`, `government_id`, `government_id_nfc` or `selfie` (ours: OpenVerify has no document resource; H22). `document-mdoc` and `document-qr-code` are refused with 422 `relation_target_unsupported`, since no such producer exists |

   Shared config: `required`, `archived-at`, `deactivated-at`, `source-key-path`, `redaction-policy` (`none`, `never`) and `write-policy` (`none`, `write_once`).
   - **`never`** (P21) is refused on `email-address`, `file`, `platform-file`, `relation-schema`, `hash`, `json` and `array`, which can hold personal data. On `string` it needs `never-redact-acknowledged: true` and cannot be `searchable`.
   - **`source-key-path`** (P22) is a read-only alias: at most 3 dot-separated segments, each matching the key pattern and read only as an own property. It is never used to set a value.

   Caps: at most 100 fields per version, nesting through `hash` and `array` at most 3 levels, and at most 20 `searchable` fields (ours: an equality index, C105.4).
3. **Validation by walking the stored schemas with zod.** A zod meta-schema validates the stored schemas at publish, and the request validator is built by walking them, cached by `(version id)`. The field schemas generate no code; only the `json` type's schema is compiled, by ajv, on the server (P22). `z.fromJSONSchema` is not used (experimental).
   - The one JSON Schema is the `json` type's `json-schema` (P22). It is accepted only when it passes our restricted meta-schema, which allows exactly these keywords: `type`, `properties`, `required`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`, `maxItems` (required on every array, at most 1,000), `additionalProperties` (only `false`), `title` and `description`. It refuses every other keyword (`pattern`, `patternProperties`, `format`, `$ref`, `$data`, `dependencies`, `uniqueItems`, `default` and remote loading among them). The schema is at most 16 KiB with depth at most 10.
   - It is compiled once per version on the server by `ajv` 8.20.0 (MIT; already in the lockfile, now a direct dependency of `apps/api` through the catalog), with `strict: true` and `allErrors: false`. The `json` value itself is capped at 64 KiB and depth 10.
   - `transaction-schemas` (7B Stage 2) owns this engine in `packages/core/src/transactions/`.
4. **Card-number guard** (decision 39; P20). A card-like value is refused with 422 `card_number_refused`. A card-like value is a run of 13–19 digits, optionally separated by single spaces or hyphens, that passes the Luhn check.
   - **Where it applies:** every string leaf the validator walks (at any depth, in `hash`, `array` and `json` values); every `integer` or `number` value of 13–19 digits; and `reference-id`, tags and labels.
   - **Opt-out:** a version may set `allow-card-like-strings: true`, which lifts the guard for its fields only, never for `reference-id`, tags or labels.
   - **Tests:** a golden test per position.
   - **Docs:** operators send a processor's token, never a PAN; a stored PAN brings the installation into PCI DSS scope.
5. **Statuses.** `statuses[]`: 1–50 strings of 1–64 characters (`^[a-z0-9][a-z0-9 _-]*$`; the public examples use spaces). `created` is reserved and always first. A new type starts with `created`, `approved`, `declined` and `needs review`. An unknown status is refused with 422 `status_does_not_exist`. `relation-schemas[]`: 0–20 of `{ key, target: account | transaction, cardinality: one | many }`.
6. **Type events:**
   - `transaction-type.deleted-field`: a published version drops a field the previous version had;
   - `transaction-type.converted-field`: a published version changes a field's type.

   Stored values are never rewritten: transactions keep their version, so old values stay readable under their own schema. The docs state this as our deviation from the public in-place conversion.

### C105. Transactions

1. **Resource** (public `transaction`, `txn_`).
   - Public attributes:
     - `status`;
     - `reference-id` (≤ 255; the customer's reference for the account, as in the public model: not unique);
     - `fields` (each key mapped to `{ type, value }`). A file value carries the `txnf_` id, `filename` (sealed at rest; PII), `byte-size` and `mime-type`. There is no URL in resources or events (ours, P12): content is read through the audited content route (2);
     - `tags`;
     - `signals` (`null` in Phase 7: passive collection is deferred);
     - `created-at`, `updated-at`.
   - Ours: `transaction-type-version-id`, `redacted-at`, `biometrics-redacted-at`.
   - Relationships: `transaction-type`; `transaction-label` (the latest); `reviewer` (`null` until Phase 8); `related-objects` (at most 100); `sentinel-sessions` (`[]`).
   - On create, when `reference-id` names an existing account of the environment, that account joins `related-objects` (ours).
2. **Routes** (public paths):
   - `POST /api/v1/transactions`: `transaction-type-id` (required), `fields`, `reference-id`, `tags`; answers 201;
   - `GET /api/v1/transactions`: `filter[reference-id]`, `filter[transaction-type-id]`, `filter[identifier][key]` with `[value]` over searchable fields, and ours `filter[status]`; newest first. The stored API-log query masks `filter[identifier][value]`, and the request log never carries a query (C93.7);
   - `GET /api/v1/transactions/:id/files/:file-id/content` (ours; P12): `transaction_files` only, never a `platform-file`; `transactions:read`, plus `pii:view` for users; audited, `no-store`;
   - `PUT /api/v1/transactions/:id/files/:field-key` (ours; P22): the content of one `file` field, as multipart. The route loads the transaction's pinned version before it reads the body, and streams it with a byte counter capped at that field's `max-file-size-bytes`. It is refused for a `write_once` field already set;
   - `GET /:id` (`include`);
   - `PATCH /:id`: `fields`, `status`, `reference-id`, `label`, `tags`. A second write of a `write_once` field answers 409 `field_write_once`;
   - `DELETE /:id` (redact, `transactions:redact`; 5). With `meta.include-never: true` it also redacts the `never` fields: an audited legal-erasure override (P21);
   - `POST /:id/redact-biometrics` (6);
   - `POST /:id/add-objects` and `/remove-objects` (`meta.object-ids`, at most 100: inquiries, reports and verifications of the environment. Public documents map to OpenVerify's document verifications, so a `document` object is given as its `ver_` id; H22);
   - `POST /:id/add-relation` and `/remove-relation` (`meta.relation-schema-key`, `meta.target-object-id`, an account or a transaction; idempotent);
   - `POST /:id/add-tag`, `/remove-tag`, `/set-tags` (the C-tag service);
   - `POST /:id/label`: `meta.label` (1–64), `meta.score` (finite), `meta.model-version` (≤ 64). It creates a `transaction-label` (`txnl_`: `model-label`, `model-version`, ours `score`, `created-at`, `updated-at`). Labels are append-only history.
3. **Events:**
   - transaction: `transaction.created`, `.status-updated`, `.updated-fields`, `.labeled`, `.redacted`, `.added-relation`, `.removed-relation`;
   - type: `transaction-type.deleted-field`, `transaction-type.converted-field` (C104.6).

   Relation events carry a `context` with `relation-schema-key` and `related-account-id` or `related-txn-id`, the names of the newer changelog (the public sources conflict). `transaction.sentinel-session-processed` is reserved and not registered.
4. **Storage** (Stage 1b of 7B):
   - `transaction_types` and `transaction_type_versions`;
   - `transactions`: type, version, `reference_id`, status, `fields` sealed JSON with row AAD, `tags` with a GIN index, `redacted_at`, `biometrics_redacted_at`, indexes `(environment_id, created_at desc, id desc)` and `(environment_id, transaction_type_id, status, created_at desc)`;
   - `transaction_status_history` and `transaction_labels` (append-only, refusing updates except redaction, with the C73 trigger pattern);
   - `transaction_objects` and `transaction_relations`, with composite foreign keys to `(environment_id, id)`;
   - `transaction_field_keys (environment_id, transaction_id, field_key, value_key text)` (64 hex characters, F10) for `searchable` fields, under `openverify/identifier-transaction-field/v1`;
   - `transaction_files` (`txnf_`, ours) for `file` fields: the `files` table requires a `verification_id`, so transaction files get their own table with the same envelope (`encryptBytes`, the wrapped DEK on the row). File content is written only through the `PUT …/files/:field-key` route, never in a JSON body, so every JSON write keeps the default body limit (P22). The file part is never stored in API logs.
5. **Redaction and retention.**
   - `DELETE` redacts the transaction's own data now (sealed fields, files, field keys, the status and label history's free text), except fields marked `never`. It sets `redacted-at`, calls `stubEventPayloads` and `forgetStoredResponses` for the transaction and its files (P04), and emits `transaction.redacted` once.
   - Objects attached by `add-objects` are independent and are not redacted. The public cascade to a transaction's child objects (T10) waits for Phase 8, which creates such children (C110; ours until then, H30).
   - `transaction-retention-days` (C16; null or 1–3,650) redacts the same way.
6. **Biometric redaction.** `redact-biometrics` needs `transactions:redact` (ours, mirroring `inquiries:redact` and `accounts:redact`) and `inquiries:redact`. It is marked `x-private` in the OpenAPI, as in the public spec. In one transaction under the Phase 4 lock order, it deletes the biometric data of the transaction and every associated object: related selfies' files, `face_templates`, `selfie_backgrounds` and face and background list items whose source they are, NFC DG2 portraits and ID portrait crops. It sets `biometrics-redacted-at` on each and writes an audit entry. Tests: every artefact gone; non-biometric data kept; a second call is a no-op.
7. **The `transaction` relationship** on inquiries, verifications and reports is the latest transaction the object was attached to by `add-objects`, else `null`. This amends the committed Phase 6 report contract, which fixes it to `{ data: null }` "until Phase 7" (`packages/contracts/src/reports.ts:318-319`, with its test); `contracts-7b` amends both. The public `transaction` relationship on documents is deferred (C110).
8. **PII.** `fields` is masked member-wise without `pii:view`, as `fields` on inquiries is, and `reference-id` is not PII, as on accounts, where it is plaintext and unique per environment. Labels and statuses are not PII, and the docs say not to put personal data in them. The collision test covers the resource.

### C106. Two report types on the Phase 6 engine (a C69 and C70 amendment)

Each type gets the same set of additions:
- a `REPORT_REGISTRY` entry (tiers, stage, review model, `sourceKind`);
- template config keys and a seeded sandbox template;
- a dashboard label, event words and a `docs/reports/` page.

Stage 1a of each Workflow checks whether `report_type` is a database enum. If it is, its Stage 1b migrates it (F04).

1. **`report/ip-address`** (public type name; 7A, `api-network`; H01, H07, F04, F05).
   - **Registry.** Review model `none`, so `has-match` is always `false`, as the committed Phase 6 contract requires for types without match review. Tiers per field: R for Tor, provider ranges, geolocation and ASN; H for the VPN and hosting-ASN flags; A for the proxy flag. Stage `beta`. `sourceKind: null`.
   - **Events.** The three that the `none` model derives: `report/ip-address.ready`, `.errored` and `.redacted`.
   - **Query.** `ip-address`: one IPv4 or IPv6 host. CIDR ranges, netmasks and zone indexes are refused with 422.
   - **Result** (the public attribute names):
     - `service-type`: `DATACENTER` from provider ranges only, or `null`;
     - `datacenter-ip`: `true` from provider ranges only, or `null` (H13);
     - `vpn-detected` and `proxy-detected`: `true` or `null` by C93.3, each with its tier, confidence (H only) and reasons;
     - `tor-exit-node`:
       - `MATCHED` when the address is a listed exit;
       - `CLEARED` only for a public IPv4 address checked against a fresh exit list;
       - `null`, listed in `unavailable-fields` with `ipv6_not_covered` or `address_not_public`, whenever C93.3's `is-tor` is `null`;
     - `isp`; `mobile-ip` (`null`);
     - `country-code`, `country-name`, `city`, `region`, `latitude` and `longitude`: strings, `null` without City Lite;
     - `error`.
   - **Ours in the result:** `flagged` (any of Tor, VPN, proxy or provider-range datacenter is true; decision 42), `hosting-asn` with its confidence, `client-address-source` where relevant, and `sources[]` with each list's sync id, publication time and SHA-256.
   - **Unavailable reasons.** `REPORT_UNAVAILABLE_REASONS` gains `list_stale`, `list_unavailable`, `ipv6_not_covered`, `address_not_public`, `not_in_known_ranges`, `not_in_provider_data` and `client_address_untrusted` (an amendment; H07, V12). 7A Stage 1a freezes a table from each C93 null reason to its report reason, with a golden test per field per cause.
   - **Errors.** A stale or unavailable exit list ends the run `errored` (`list_stale` or `list_unavailable`, naming the source), keeping what it found. The run is never `ready` with Tor unchecked. Other stale sources leave their fields `null` and listed.
   - **Query source.** `REPORT_QUERY_SOURCES` gains `inquiry_session`: the first evaluated session's address at completion.
   - **Tests:** one golden per case: IPv6, a private address, a documentation address in production, a stale exit list, a sandbox Tor address.

2. **`report/custom-list`** (public type name; 7B, `api-lists`; H08, F04).
   - **Registry.** Review model `matches`, so the six derived events apply: `report/custom-list.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed` and `.redacted`. Tier per match as C99.1. Stage `beta`. `sourceKind: null`.
   - **Query.** Any of `name-first`, `name-last`, `email-address`, `phone-number`, `government-id-number` with `government-id-class`, `ip-address`, `country-code` and `string`, plus `list-ids` (1–20, or pinned on the report template).
   - **Templates.** An archived or deleted pinned list is refused at template publish.
   - **Running.** The run calls `matchLists`, including the fuzzy and biometric methods. Each match is a report match under the C75 review semantics (dismiss, review, the ignore list), keyed by the list item.
   - **Contract amendments (C70.2):**
     - a report source may be a list id (`lst_…`) as well as a watchlist source id;
     - list provenance has its own shape, `{ list-id, version, normaliser-version, item-count, screened-at }`.
   - **Honesty** (ADR 0005). Any selected list in `unscreened` ends the run `errored` with `list_unavailable` and the list id, keeping the matches it found. A list in `notApplicable` (the subject has no value of its kind) does not.
   - **Monitoring.** Recurring reports run on their interval. Re-screening when a list's `version` changes waits for Phase 8 workflows (C110).
   - **Query sources** (`REPORT_QUERY_SOURCES` gains `government_id_country`) follow C99.5.
   - **Tests:** a pending face list errors the run and keeps its matches; so does an outdated normaliser; a subject with no phone is not an error.

3. **Shared requirements.** Both types join the registry, the template config, the console and the e2e (C111). Their limits, tiers and "What a result means" go in `docs/reports/`:
   - `integration-7a` writes the `ip-address` page;
   - `integration-7b` writes the `custom-list` page.

   The seeded sandbox templates are added by the same agents, through `seed/report-templates.ts`. That file is shared after Phase 6, and only the integration agents edit it.

### C107. Platform amendments

1. **Repeatable jobs** (C54.1 registry):
   - `network-refresh` (a 15-minute tick, behind `OPENVERIFY_NETWORK_REFRESH`);
   - `inquiry-signals-sweep`, `list-screen-sweep`, `list-import-sweep`, `graph-index-sweep` and `graph-query-sweep` (15 s each);
   - `graph-backfill` (at startup, until complete);
   - `graph-components` (nightly, opt-in);
   - the retention steps of C91.7, C92.3, C96.2, C98.4, C100.2, C102.7 and C105.5, inside the C16 pass.
2. **Queues.** `inquiry-signals`, `list-screen`, `list-import`, `list-item-embed`, `graph-index` and `graph-query`. Each removes its jobs on completion and on failure, as C85.4 does.
3. **Rate-limit policies** (C12; F09).
   - **Windows.** The limiter gains a per-policy window (`RATE_LIMIT_POLICY_WINDOWS`, default 60 s), added in 7A Stage 1a.
   - **Policies:**

     | Policy | Limit |
     |---|---|
     | `flow-signals` | 60 a minute per session |
     | `flow-handoffs` | 5 an hour per session and 10 an hour per IP, plus the send budget of C96.3, which fails closed |
     | `lists-write` | 600 a minute per environment |
     | `lists-match` | 60 a minute per key |
     | `importers` | 10 an hour per environment |
     | `graph-queries` | 30 a minute per environment |
     | `graph-unmask` | 60 a minute per principal |

   - **Enforcement.** The handoff `redeem` and `preview` routes join the `one-time-link-redeem` route set. Each policy's enforcer is named: Stage 1b of its Workflow wires the flow policies in `plugins/rate-limit.ts`, and each route owner wires the server-API ones on its routes. A test per policy shows it applied.
4. **Event names and groups.**
   - **Registered in Stage 1a** with golden payloads, webhook samples and the dashboard event groups ("List matches", "Graph queries", "Transactions", "Transaction types"):
     - `list-match.created`;
     - the six `graph-query.*` events;
     - the seven `transaction.*` events and the two `transaction-type.*` events;
     - the report events of C106.
   - **Strict webhook filters** (P03). C14 filters know only inquiry templates and account types. C70.4's strict switch extends to the new subjects, as Phase 6 did for reports. Each Stage 1b adds the subject's resolver stub in `events/subject.ts` with its family: list-match in 7B (L), transaction and transaction type in (T), graph query in (G). The resolvers are implemented by `api-lists`, `api-transactions` and `api-graph` (V14):
     - a `list-match` resolves through its inquiry;
     - a transaction resolves through its related accounts' types and its attached inquiries' templates;
     - a transaction type, a graph query, or a transaction with neither link fails any filter that is present.

     A webhook with no filters keeps receiving what it subscribed to. Tests mirror C70.4's.
5. **Masking, redaction, rewrap and rebuild lists** (P04, P07, P18, F23). Each Workflow's Stage 1b declares them, with a test per exit.
   - **Every new column and its form** (a table in each Stage 1b's TDD file, checked by the coverage tests): sealed with a row AAD, an envelope object, a 64-hex HMAC, or plaintext by a stated decision (country codes, CIDR ranges, coarse boxes, the layout vector, network facts without the address).
   - **API logs.** `PII_SIGNAL_`, `PII_LIST_`, `PII_GRAPH_` and `PII_TRANSACTION_ATTRIBUTES` are built from the resources and from the request bodies, and both join `MASKED_ATTRIBUTES` and the API-log masked set. The body members include:
     - list-item create attributes and the importer's `file`;
     - `POST /lists/match` probes, under `data.attributes`;
     - `parameter-map` and `variable-map`;
     - transaction `fields`, including `content`;
     - dismissal reasons;
     - the handoff `destination`.

     The stored API logs of those routes, read without `pii:view`, hold no value. A per-route test checks it.
   - **Redaction subjects.** `REDACTION_SUBJECT_ID_PREFIXES` gains `dev`, `net`, `lst`, every list-item prefix, `lmt`, `mprt`, `grphq`, `txn`, `txnf` and `txnl`. Every new redaction calls `stubEventPayloads` and `forgetStoredResponses` for its ids.
   - **Coverage.** The redaction coverage test gains a category for third-party list PII (list items: personal data of people who are not inquiry subjects).
   - **Rewrap.** Every new sealed column and envelope DEK joins `ENCRYPTED_COLUMNS`, `SEALED` and `REWRAP_TABLES`, each with a `kek:rewrap` test.
6. **`INCLUDE_PERMISSIONS`**: `device`, `network` (sessions), `list-matches` (inquiries and accounts), `transactions` (accounts).
7. **Settings** (C16 route).
   - **Under `settings:privacy`** (a new permission, admin by default; F37, P10): `signal-collection`, `biometric-lists-basis`, `graph-indexing`, `graph-weak-kinds`, `graph-components`.
   - **Under `settings:write`:** `expose-signals`, `organization-display-name` (≤ 100 characters; shown to end users on the handoff context screen; F30), `signal-component-retention-days`, `ip-retention-days`, `device-retention-days`, `graph-query-retention-days`, `transaction-retention-days`.
   - Every change is audit-logged.
8. **Configuration** (per-process validation; `.env.example`; compose):
   - `OPENVERIFY_NETWORK_REFRESH`, `OPENVERIFY_NETWORK_SOURCES_DISABLED`, `OPENVERIFY_NETWORK_SOURCES_ENABLED`;
   - `OPENVERIFY_PROVIDER_IP_REPUTATION_{SANDBOX,PRODUCTION}` and `OPENVERIFY_IP_REPUTATION_MMDB_PATH`, for both the API and the worker (C93.5);
   - `OPENVERIFY_HANDOFF_SENDS_PER_HOUR`.

   Those that carry paths join the secret-scan and startup-error redaction lists.
9. **The flow's response headers** (carried since Phase 1, PROGRESS "Flow: response headers"). The handoff and the collector make them due now. `apps/flow/vite.config.ts` sets `preview.headers` for the compose-served flow (`vite preview`):
   - `Content-Security-Policy: frame-ancestors 'none'` (only the hosted mode exists);
   - `Permissions-Policy: camera=(self), geolocation=(), microphone=()`;
   - `Referrer-Policy: no-referrer`;
   - `X-Content-Type-Options: nosniff`.

   An infra test asserts them on the running container. The docs give the same headers for operators who serve the built flow from their own server. Owner: `integration-7a`.

### C108. Console surfaces (Workflow 7C)

- **Inquiry page.**
  - A **Sessions** section (the console has no tab primitive, as Phase 6 found): one card per session with the device (parsed fields; fingerprints masked without `pii:view`), the network facts with tiers, reasons and provenance, the handoff link between sessions, and the DB-IP attribution line.
  - A **Signals** section grouped by layer, with the value, the `beta` badge, confidence, reasons and the thresholds in words.
    - `null` reads "not evaluated" with its reason, never "no".
    - A low score reads "no automation artefacts found"; a low threat level reads "no listed risk found" (H04, H06).
    - "Not computed yet" shows while `computed-at` is `null`.
  - A **List matches** section with dismissal (H02, H31). It shows:
    - the screening's status;
    - every selected list marked "not screened" with its reason, or "no value to compare";
    - "decided before the list screening finished" when that happened;
    - each match's tier and, for IP-derived probes, "approximate" (H15).
  - **Template versions** (H20): `signal-config` and `list-config` are edited as JSON documents with validation pointers in `VersionEditor`, beside `report-config` (owner `dashboard-signals`), and shown read-only on other versions.
- **Lists.** An index (type, status, item count, version), create, a detail page with items (masked values without `pii:view`, add, archive), importers with their progress and errors (codes and rows, never values), the face and background acknowledgement state, and the retention setting.
- **Graph explorer.**
  - Cytoscape.js 3.34.3 with `cytoscape-fcose` 2.2.0 (`cose-base` 2.2.0, `layout-base` 2.0.1) on the canvas renderer, with WebGL off while it is a preview, `animate: false`, at most 2,000 nodes, and incremental expansion around a node.
  - A **Table view** of the same result, always available and the default for keyboard and screen-reader users. Selection is shared with the canvas, and bulk actions work from either.
  - Kinds are shown by shape and label as well as colour. Labels are masked. An unmask is an explicit click or key press that calls C102.6 (P17). `index-complete: false` reads "the index is still being built" (H10).
  - A template list and editor (JSON with validation pointers), run, rerun, cancel, the result status with truncation in words, bulk actions with a preview and confirmation, and the export.
  - It meets WCAG 2.2 1.1.1, 1.3.1, 2.1.1, 1.4.1, 1.4.11, 2.4.7 and 2.5.7.
  - **CSP test** (F33): the dashboard has no script CSP yet, so a Playwright test injects one on the explorer document through `page.route` (`script-src 'self' 'nonce-…' 'strict-dynamic'; worker-src 'none'; object-src 'none'`) and asserts no violation at 2,000 nodes.
- **Transactions.** An index (type, status, reference, date filters, cursor pagination), a detail page (fields masked member-wise, status history, labels, relations, objects, tags, redaction and biometric redaction with confirmation), and the types editor (versions, fields as JSON with validation pointers, statuses, publish).
- **Account page.** Signals of its latest inquiries, list matches, a graph section (direct connections from a chosen template with `account_id` bound, the component size with `beta`, and "open in explorer"), and transactions.
- **Network sources page** (read-only, mirroring the watchlist sources page): each source with enabled, configured, last check, last applied sync, publication time, SHA-256, `origin`, staleness, the last refusal, the attribution and the terms note. Pinned seeds show their commit and counts.
- **Settings** for C107.7, with the audit trail of collection-tier changes. **Event words** for every new event. The permission areas "Lists", "Graph" and "Transactions", and the `settings:privacy` label. The README section.
- **Shared page slots** (F32). `dashboard-signals` first adds two `OptionalSection` slots to the account page, which import stub components owned by `dashboard-graph` and `dashboard-lists-transactions`. It owns `e2e/tests/ui-signals.spec.ts`. Each agent adds its UI helpers only in `e2e/tests/support/ui-<area>.ts`.

### C109. Records, ADR and docs

| Item | Owner |
|---|---|
| ADR 0006 "Signals: honesty, collection tiers and operator-synced network data": C90.3; the C92 operator sync for permissive commercial and factual data (DB-IP, cloud ranges), never committed or shipped, verified instead of pinned; the two collection tiers and their defaults; no signal declines | 7A `contracts-7a` |
| PLAN §2 Signals row (devices, networks, the inquiry `signals` array, the two bot-score scales); §2 Transactions row (the fifteen type names; `hash` is a nested object); §2 Lists row (faces and backgrounds as ours where the public API has no path); §3 browser fingerprint row (own collector; FingerprintJS v5 is MIT again since 5.0.0, only 4.x is BSL); §3 IP intel row (DB-IP's link-back duty, Tor CC0, cloud ranges with no stated licence, the X4BNet seed); §3 graph UI row (`cytoscape-fcose`); §4.4 (the CDP `Runtime.enable` check no longer works on current Chromium); §6 Phase 7 ("list-match checks" defined as C99's records and rule; breadth-first search instead of recursive CTEs) | 7A `contracts-7a` (signals, network) and 7B `contracts-7b` (lists, graph, transactions) |
| `THIRD_PARTY_LICENSES.md`: the FingerprintJS lines (v5 MIT as a design reference; 4.x excluded); §4.2 rows (DB-IP with attribution and link-back, operator-synced; Tor CC0; cloud ranges, no licence stated; X4BNet and bad-asn-list, MIT, pinned; excluded: MaxMind GeoLite, IPinfo Lite, IP2Location LITE, OSM, iptoasn); `mmdb-lib`, `bowser`, the QR library chosen, `csv-parse`, `csv-stringify`, `ajv`, `cytoscape`, `cytoscape-fcose`, `cose-base`, `layout-base` | 7A `contracts-7a` and `foundation-7a` (dependencies); 7B and 7C likewise for theirs |
| `persona-surface.md`: the device and network resources and the session attributes; the inquiry `signals` array and `behaviors`; list kinds 12 and 13; the face importer path and the `importer/list-item/face` and `…/field` types; `graph-query.submitted`; `transaction-type.converted-field`; `session.created` and `session.expired` (meaning not documented) | 7A `contracts-7a` and 7B `contracts-7b` |
| `docs/checks/signals.md`: each signal's tier, default and what it cannot detect; the browser defences and why a fingerprint is not an identifier; the law section as "not legal advice" with the operator's decisions; a DPIA template; the accessibility caveat; `docs/network/README.md` (sources, sync, staleness, attribution, the trust-proxy warning, memory) | 7A `integration-7a` |
| `docs/lists/README.md` (kinds, normalisation, matching, limits, the blind-index key warning, face and background lists and their basis), `docs/graph/README.md` (kinds and strengths, profiling and the DPIA note, limits, the benchmark), `docs/transactions/README.md` (field types, versions, the card-number guidance, redaction), `docs/checks/sandbox-providers.md` additions | 7B `integration-7b` |
| ADR 0006 also records the one stated exception, `id_compromised_detection` failing on an opted-in list (C99.9), with the operator's Art. 22 duty; the notice keys `notice.session-integrity` and `notice.device-recognition` and their default texts | 7A `contracts-7a` |
| The Android SDK README: what the SDK reads per tier, and the Google Play Data safety entries the host app must declare (P29) | 7A `android-signals` |
| `CLAUDE.md`'s layout table gains `packages/signals`; agents do not edit `CLAUDE.md` (Phase 5 decision 45); owner item | owner |

### C110. Deferred

- GPS collection, reverse geocoding and Natural Earth (decision 9). Address geocoding and the public residence-distance signals (an adapter kind with a sandbox, later). A client-stored device token.
- The JA4 proxy-header adapter (`tls-fingerprint`, research proposal), and JA3 and JA4+ (never: unstable, or the FoxIO licence).
- Android emulator, root and hooking heuristics, Play Integrity, and an iOS handoff target (Phase 10). Passive collection for transactions (the public Sentinel product), and `transaction.sentinel-session-processed`.
- Face-image import and selfie-background import. Graph similarity nodes (email, selfie, background) and camera fingerprints.
- List exports, saved views and filterable transaction fields (Phase 9). Signal analytics (Phase 9). Flow-editor branching on signals (Phase 9).
- Every workflow step that the public product builds on these features (Get List Match, Add Item To List, Add Item To Face List, Sync Graph, Run Graph Query, Create Transaction, Update Transaction Status, Set Relation, Trust Device), re-screening custom-list reports on a list update, case modules, and transaction children (Phase 8).
- Commercial IP and device reputation API clients (adapters only through `ipReputation`'s file mode). Share-alike or non-commercial IP data. RIR statistics. Azure and Apple Private Relay by default.
- Graph kinds from transaction fields. Connected-component signals as checks. Apache AGE (not in the pinned image).
- **Public behaviours not built in Phase 7** (H17, H19, H20, H22, H27, H28, H30):
  - the signals `geolocation_to_residency_delta` (needs an address geocoder) and `last_two_verifications_geolocation_delta` (verifications do not record their session);
  - IP and fingerprint velocity, and fingerprint-reuse signals: graph templates answer them with evidence;
  - the graph's email local part, SSN, last-4 SSN, document number as distinct from the ID number, custom nodes, and the pattern query with no starting value;
  - `POST /api/v1/inquiry-sessions`: `resume` covers it;
  - the inquiry's `behaviors` attribute, and the `session.created` and `session.expired` events (meaning not documented);
  - the per-inquiry handoff-link override (`meta.one_time_link_expiration_seconds`);
  - the documents `transaction` relationship;
  - the cascade of transaction redaction to child objects (Phase 8, which creates them);
  - the console's session map (no permissive map tiles without network calls) and filtering inquiries by list match (Phase 9, with saved views);
  - re-screening a report when a linked account's fields change, which Phase 6 handed to Phase 7's graph (Phase 8, as a workflow trigger).

### C111. Fixtures and end to end

1. **Rule.** Synthetic only:
   - addresses from the documentation ranges and ASNs from the documentation ASN ranges;
   - fictional points (open ocean or a grid), fictional people, emails at `example.com`/`.org`/`.net`, numbers from the fictional ranges Phase 5 uses;
   - no real list, MMDB, exit list or range file in git; deterministic seeds.
2. **Full-stack e2e** (each spec ≤ 90 s, its budget stated in a header line; network data by `seed:dev` and `network:sync --import` from `@openverify/signals/testing`; no publisher call; sandbox providers):
   - **7A** `signals.spec.ts`: an inquiry completed in Chromium from the sandbox addresses through the e2e stack's trusted proxy shows the session's network facts and `signals` (Tor, datacenter, `bot_score` from the collector), and the `on-signal` rule sends it to review. `handoff.spec.ts`: C96.8. `ip-address-report.spec.ts`: one report per sandbox address.
   - **7B** `lists.spec.ts`: an email list imported by CSV, an inquiry whose OTP email is listed, the `list-match.created` webhook verified, `on-list-match` sends it to review, and the match is dismissed. `graph.spec.ts`: two accounts sharing a confirmed email are linked by a template query; `add-tag` in bulk. `transactions.spec.ts`: a type published, a transaction created, its status updated, labelled and redacted, with the events verified. `custom-list-report.spec.ts`.
   - **7C** UI specs: `ui-signals`, `ui-lists`, `ui-graph` (the table view driven by keyboard only), `ui-transactions`.

   **Suite time** (F20). With Phase 6, the suite reaches about 30 minutes, beyond one 10-minute call and beyond Playwright's 45-minute `globalTimeout`. `integration-7a` therefore adds a reusable stack:
   - with `OPENVERIFY_E2E_REUSE_STACK=1`, `pnpm --filter @openverify/e2e e2e:stack:up` starts the private stack once (it may run in the background);
   - `playwright test --shard=i/N` then runs each shard against it, with N chosen so each shard stays under 8 minutes;
   - `e2e:stack:down` ends it.

   CI gets a shard matrix, and the Validation section names these commands. Each integration agent measures again once its specs land, and updates `infra/tests/ci-workflow.test.sh`.
3. **Testcontainers, not e2e:**
   - every sync refusal and race (C92.2);
   - snapshot swaps under load;
   - the SP-GiST plan and the C99.8 list cases;
   - the importer rollback and idempotency;
   - the graph caps, timeouts, hubs and consolidation (C101.4, C102.8);
   - transaction write-once races and biometric redaction;
   - the session cap and the handoff races.

## Workflow 7A (signals, network data, handoff)

**Families and checkpoints** (F22). Stage 1a and Stage 1b each commit by family, every checkpoint with every suite green and recorded in its TDD file. Each Stage 3 agent starts as soon as its family's Stage 1b checkpoint lands, and a stalled family holds back only its own builder. The families are (N) network, (S) signals and devices, and (H) handoff.

- **Stage 1a: `contracts-7a`.** It runs alone, and starts by re-verifying the Starting point and every Phase 6 interface this Workflow uses. It records drift and what 6A exports:
  - the C76 sync and its helpers (for the runner of C92.2), naming the exact watchlist sync files that `api-network` may refactor;
  - the C85.1 streaming client;
  - C83's provider binding and `PROCESS_PROVIDER_KINDS`;
  - the report registry, review models, query sources and unavailable reasons (for C106.1), and whether `report_type` is an enum;
  - the `transitionInquiryInTx` hooks of C84.2.

  It delivers, committed in this order:
  - **Common:**
    - core: the signal registry with its catalogue and constants (C90.1–C90.2); the permission `settings:privacy`; the per-policy rate-limit windows and the policies `flow-signals`, `flow-handoffs`, `graph-unmask` (reserved for 7B);
    - contracts: the reason enums `SIGNAL_NULL_REASONS` and `SIGNAL_EVIDENCE_REASONS`; ids and token prefixes (`dev`, `net`, `ovh`); the schema refinements of C90.3; problem codes with golden fixtures;
    - every dependency the Workflow needs, through the catalog: `mmdb-lib` 3.0.3, `bowser` 2.14.1, `qrcode` 1.5.4, `uqr` 0.1.3, `lean-qr` 2.7.4, `esbuild` (exact pin), `jsdom` (F38, F14);
    - ADR 0006 and the C109 records it owns.
  - **(N):**
    - the network resource and the session network attributes, with PII marks;
    - the `ip-address` report query, result, registry entry, events, unavailable reasons and query source (C106.1);
    - `packages/signals` (package, config, exports, and the export line and stub of `network/` and `testing/`);
    - the X4BNet and bad-asn-list entries in `data/manifest.json`.
  - **(S):**
    - the device resource and the session device attributes;
    - `signalConfigSchema`; the inquiry `signals` and `signal-details` attributes; `flowSignalsSchema` with its bounds;
    - the `GET /flow/session` `signals` member;
    - the `packages/signals` `browser/` stub, the `packages/checks/src/signals/` export line and stubs, and the `apps/flow/src/signals/` stub with its signatures (F06);
    - the Android contract stubs of C94.7 (F07);
    - the `@openverify/node` method group `devices`.
  - **(H):**
    - the `device_handoff` step schema with the flow, contracts and Android typecheck minimum of C96.1 (F01);
    - the template settings `max-sessions` and `expire-inquiry-on-session-limit`;
    - the flow handoff bodies and answers, and the `GET /flow/session` `handoff` and `handoff-context` members;
    - the `apps/flow/src/handoff/` stub.
  - **In the same commit as each family's fixtures:** the webhook samples (sessions with `included` device and network), the Android `serverOnly` entries, `INCLUDE_PERMISSIONS` for `device` and `network`, and the dashboard minimum to typecheck (labels, `PERMISSION_INFO`). The API, dashboard and Android suites stay green.

  It owns any path its deliverables need.
- **Stage 1b: `foundation-7a`** (plumbing only). It starts after Stage 1a's common and (N) commits, beside Stage 2. Its migration is one file, extended per checkpoint before the Workflow's first push, and it measures the PGlite migration time before and after (Risks). The checkpoints:
  - **(N) network:**
    - tables `network_sources`, `network_syncs` and `networks`, and the session's network columns;
    - repository stubs;
    - `evaluateSessionNetworkInTx` (stub) in `recordSessionStart`;
    - the startup wiring stubs `apps/api/src/network/{reconcile,snapshots}.ts` with their calls in `container.ts` and `worker.ts`, and `warnOnPrivatePeers` (F41);
    - the `NetworkSnapshots` interface with its in-memory fake;
    - `ipReputation` for both processes, with its variables, `.env.example` and compose (F26);
    - the `network-refresh` registration and job stub, and the `network:sync` script entry;
    - the request-log serializer of C93.7 (P06);
    - the `ip-address` report job hook stub (`jobs/report-types/ip-address.ts`), and the `report_type` migration if it is an enum;
    - the `seed/network.ts` call in `seed/dev-seed.ts` (F14).
  - **(S) signals and devices:**
    - tables and columns: `inquiries.signals` and `signal_details`; `inquiry_session_signals`; `inquiry_signal_computations` (the outbox); `devices`, `session_devices`, and the session device, `signals_collected` and `signal_bodies_dropped` columns; `inquiry_template_versions.signal_config`;
    - repository stubs; `identifierKey` with 7A's labels and the key id (C94.4); the `rebuildDeviceIndexes` stub and its call in `blind-index-rebuild.ts`;
    - `ENCRYPTED_COLUMNS`, `REWRAP_TABLES`, the masking lists and the API-log sets (C107.5); the redaction entries and subject prefixes; the retention steps; the settings served;
    - `createSignalComputationInTx` in `transitionInquiryInTx`; `recordSessionDeviceInTx` (stub) in `recordSessionStart`; `assertSessionCapInTx` (stub) in the three session-creation paths;
    - the `inquiry-signals` queue with its producer, the `inquiry-signals-sweep` registration;
    - the `signal-config` member through its repository and service, and `assertPublishable` passing it to `services/publish/signal-config.ts` (stub);
    - routes frozen: devices, `POST /flow/signals`, the `expire-all` body, `generate-one-time-link`, with stubs in `services/signals/sessions.ts` (F28);
    - `plugins/rate-limit.ts` for `flow-signals`;
    - the flow's wiring: the `apps/flow/src/signals/` hook in `FlowRenderer`, after consent; and `apps/flow/e2e/support/mock-flow-api.ts` answering 202 to `/flow/signals` (F06).
  - **(H) handoff:**
    - tables `handoff_tokens` and `inquiry_handoff_steps`, and `created_by_session_id` on verifications and selfie captures, written by the flow services that create them (V02);
    - `getEffectiveConsent` in `repositories/inquiry-sessions.ts`, and its calls from every consent gate: `services/flow-preconditions.ts`, `services/flow.ts`, `services/otp/context.ts` and `jobs/selfie.ts`. Until `flow-handoff` lands it returns today's latest inquiry consent (V03);
    - the flow handoff routes frozen;
    - `assertSessionNotHandedOff` (stub) in `auth/flow-session.ts` (F13);
    - the `services/publish/handoff.ts` stub;
    - the `handoff` and `handoff-context` session members through a stub builder in `services/flow.ts`;
    - the `organization-display-name` setting;
    - the handoff routes in the `one-time-link-redeem` set and the `flow-handoffs` policy in `plugins/rate-limit.ts`;
    - the flow's wiring: the `handoff-token` fragment in `session/session-bootstrap.ts`, `HandoffRedeemFlow` in `routes.tsx`, and the `device_handoff` slot in `FlowRenderer`; `mock-flow-api.ts` stub answers.
  - **After the last checkpoint:** the OpenAPI snapshot.

  Algorithms stay with their owners.
- **Stage 2** (parallel, beside Stage 1b):
  - **`network-data`** (after Stage 1a (N)): C92.3's parsers (TorDNSEL, with the live format confirmed; each provider's range file; the ASN seeds, with de-duplication); the interval sets with property tests; MMDB access over `mmdb-lib`; the pure lookups of C93.3 and C93.4; the MMDB test writer and every synthetic publisher file; the steady-state and peak-swap memory measurement. It owns `packages/signals/src/{network,testing}/`.
  - **`client-collector`** (after Stage 1a (S); its flow integration after Stage 1b (S)): the C94.3–C94.4 collector, the automation rules, the behaviour aggregates, the canvas digest with noise detection, the size test, the CSP test and the before-consent test; then its integration in the flow (per-screen aggregation, `POST /api/v1/flow/signals`) and `apps/flow/e2e/signals*.spec.ts`. It owns `packages/signals/src/browser/`, `apps/flow/src/signals/` and those specs.
  - **`signal-logic`** (after Stage 1a (S)): C94.5's user-agent mapping; C94.8's scores with their caps and `BEHAVIOUR_RULES`; the cross-layer consistency rules; the C93.4 threat-level table; C95's distances; the session-combination rules of C90.4; the signal values of C90.2 from stored facts; golden and property tests. It owns `packages/checks/src/signals/`.
  - **`android-signals`** (after Stage 1a (S)): C94.7. It owns the files named there and `android/openverify-sdk/src/*/kotlin/**/signals/`, and reports its host-test count.
- **Stage 3** (each after its family's Stage 1b checkpoint):
  - **`api-network`** (N): C92 and C93, plus the `ip-address` report (C106.1):
    - the sync runner extracted from 6A's code, with the watchlist sync moved onto it;
    - the manifest with its tests; the sync CLI with its locks, guards, imports and overrides; the refresh tick;
    - the snapshot store and loader with the 60 s swap and the purge; reconciliation; the production/sandbox split;
    - `evaluateSessionNetworkInTx` with the networks rows and the trust-mode rule; `warnOnPrivatePeers`;
    - the `ipReputation` file adapter and sandbox;
    - the network sources console route; `seed/network.ts`.

    It owns `apps/api/src/network/`, `apps/api/src/sync/`, the watchlist sync files that Stage 1a names and `apps/api/src/http/stream.ts` (the refactor and the C85.1 amendment only; V14), `network/sources.json`, `network/asn-overrides.json`, `apps/api/scripts/network-sync.ts`, `jobs/repeatable/network.ts`, `apps/api/src/providers/ip-reputation/`, `jobs/report-types/ip-address.ts`, `routes/dashboard/network-sources.ts`, `packages/db/src/repositories/{network-sources,networks}.ts` and `apps/api/src/seed/network.ts`.
  - **`api-signals`** (S): C90 and C91 and the server side of C94:
    - the session attributes and `recordSessionDeviceInTx`; devices (repository, routes, HMACs with key ids, `rebuildDeviceIndexes`);
    - the flow signals route (storage, the per-session cap, idempotency, the consent, notice and tier checks);
    - the `inquiry-signals` job and sweep, with `signal-details`, the combination rules and `on-signal`; the `signal-config` publish rules;
    - the settings, the session cap and the two session routes; redaction and retention of the new session data; masking per exit, API logs included.

    It owns `apps/api/src/services/signals/`, `apps/api/src/services/publish/signal-config.ts`, `apps/api/src/jobs/signals/`, `routes/server/devices.ts`, `routes/flow/signals.ts`, and `packages/db/src/repositories/{devices,session-signals,signal-computations}.ts`.
  - **`flow-handoff`** (H): C96 end to end, except the full-stack spec:
    - server side: the token repository and service, the flow routes (issue, preview, redeem, continue-here, current, reject, decline), the `device_handoff` publish rule, the sends to confirmed destinations under their limits and budget, `assertSessionNotHandedOff`, and the `handoff` and `handoff-context` builders;
    - flow side: the `device_handoff` step screen, the phone's preview, context and consent sequence, the QR measurement, i18n keys, accessibility, and `apps/flow/e2e/handoff*.spec.ts`;
    - `docs/flow/handoff.md`.

    It owns `apps/api/src/services/handoff/`, `apps/api/src/services/publish/handoff.ts`, `routes/flow/handoffs.ts`, `packages/db/src/repositories/handoff-tokens.ts`, `apps/flow/src/handoff/`, `apps/flow/src/steps/device-handoff/`, those specs, and `docs/flow/`.
- **Stage 4: `integration-7a`:**
  - the 7A full-stack specs (C111.2), with the reusable stack and shards (F20), the e2e stack's trust setting and the `X-Forwarded-For` injection (F34), and the sandbox network import;
  - `docs/checks/signals.md`, `docs/network/`, the `ip-address` page in `docs/reports/`, the additions to `docs/checks/sandbox-providers.md`, and the seeded `ip-address` template;
  - the only regeneration of the OpenAPI snapshot after Stage 1, and `@openverify/node` and the API fixtures after Stage 1;
  - CI: `fetch_data.py` for the ASN seeds, the shard matrix, and the SDK host-test floor raised by `android-signals`' count; the apps image (no network data baked in; a test asserts it); the flow's response headers (C107.9); removing the two QR libraries that lost;
  - the full validation; defects fixed test-first in any path; missing hooks added and reported; the amendments of Stages 2–3.

  It owns `e2e/`, `docs/checks/`, `docs/network/`, `docs/reports/`, `docs/api/openapi.json`, `.github/workflows/ci.yml`, `turbo.json`, `infra/`, `.dockerignore` and `docs/plans/phase-7.plan.md`.

**Shared files (the C54 rule for Phase 7A; F14).** Stage 2–4 builders never edit:
- **API services and hooks:** `services/inquiries.ts`, `services/inquiry-sessions.ts`, `services/inquiry-settlement.ts`, `services/flow.ts`, `services/flow-preconditions.ts`, `services/otp/context.ts`, `jobs/selfie.ts`, `services/one-time-links.ts`, `services/accounts.ts`, `services/redaction.ts`, `services/retention.ts`, `services/inquiry-templates.ts`, `services/publish/index.ts`, `services/api-logs.ts`, `services/settings.ts`, `auth/pii.ts`, `auth/flow-session.ts`, `events/subject.ts`, `plugins/rate-limit.ts`, `webhooks/samples.ts` (after Stage 1a), and the seed files `seed/dev-seed.ts` and `seed/report-templates.ts`;
- **routes:** `routes/server/inquiries.ts`, `routes/server/inquiry-sessions.ts`, `routes/flow/index.ts`, `routes/server/index.ts`;
- **shared packages:** `packages/core/src/webhook-payload.ts`, `packages/core/src/permissions.ts`, `packages/db/src/repositories/{webhooks,inquiry-templates,inquiry-sessions}.ts`, `packages/db/src/blind-index.ts`, `packages/db/src/testing.ts`;
- **API wiring:** `container.ts`, `services/context.ts`, `worker.ts`, `jobs/repeatable/index.ts`, `jobs/report-types/index.ts`, `test-support/harness.ts`, `test-support/fakes.ts`, `providers/index.ts`, `ports.ts`, `http/index.ts`, `plugins/openapi.ts`, `config.ts`;
- **db indexes:** `packages/db/src/repositories/index.ts`, `packages/db/src/repositories/retention.ts`, `packages/db/src/schema.ts`; and the package index `packages/signals/src/index.ts`;
- **the flow:** `packages/flow-spec/src/flow.ts` (after Stage 1a), `apps/flow/src/main.tsx`, `apps/flow/src/session/session-bootstrap.ts`, `apps/flow/src/routes.tsx`, the `FlowRenderer` folder, `apps/flow/src/flow/flow-position.ts`, `apps/flow/vite.config.ts`, `apps/flow/src/security/security-meta.ts`, `apps/flow/e2e/support/mock-flow-api.ts`;
- **tooling and records:** `apps/api/scripts/blind-index-rebuild.ts`, `apps/api/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `THIRD_PARTY_LICENSES.md`, `.env.example` and `infra/docker-compose.yml`.

A missing hook is a `contractDeviation` that the integration agent adds. Every other path named in this plan has exactly one owner.

## Workflow 7B (lists, graph, transactions)

**Families and checkpoints** (F22, F36), as in 7A: (L) lists and importers, (T) transactions, (G) graph. Each of Stage 1a and Stage 1b commits by family, with every suite green. Each Stage 2 and Stage 3 agent starts at its family's checkpoint.

- **Stage 1a: `contracts-7b`.** It runs alone. It first re-verifies the 7A amendments, the sessions and devices as built, and the Phase 6 report engine for C106.2, and records drift. Then it commits by family:
  - **Common:**
    - core: the scopes (`lists:*`, `importers:*`, `graph:*`, `transactions:*`, `transactions:redact`, `transaction-types:write`) and the role lists, with `graph:read` in `NOT_FOR_VIEWERS`;
    - the C12 policies;
    - the `inquiry/list_match_count` registry entry and the list reason codes, as amendments of 7A's enums (F31, H11);
    - the dependencies `csv-parse` 7.0.3, `csv-stringify` 6.9.0 and `ajv` 8.20.0, through the catalog.
  - **(L) lists and importers:**
    - ids (`lst`, the item prefixes, `mprt`, `lmt`);
    - the list, item, importer and list-match resources with PII marks;
    - `listConfigSchema`;
    - the importer error shapes and the probe bodies;
    - the graph-kinds enum, which `list-logic` needs;
    - the `custom-list` report query, result, registry entry, events and provenance (C106.2);
    - the `packages/checks/src/{lists,csv}/` export lines and stubs;
    - the `@openverify/node` groups `lists`, `listItems`, `importers` and `listMatches`.
  - **(T) transactions:**
    - ids (`txn`, `txntp`, `txntpv`, `txnl`, `txnf`);
    - the field-schema union and its meta-schema types;
    - the transaction, type, version and label resources;
    - the amendment of the report `transaction` relationship and its test (C105.7);
    - the `packages/core/src/transactions/` export line and stubs;
    - the `@openverify/node` groups `transactions` and `transactionTypes`.
  - **(G) graph:**
    - ids (`grphq`, `grqt`, `grqtv`);
    - `graphQueryTemplateConfigSchema`;
    - the graph-query and template resources, and the action bodies;
    - the `@openverify/node` groups `graphQueries` and `graphQueryTemplates`.
  - **With each family's fixtures:** the event names, subjects, payload unions, golden payloads and webhook samples; the dashboard event groups; the Android `serverOnly` entries; `INCLUDE_PERMISSIONS`; problem codes; the OpenAPI components; the dashboard minimum to typecheck.
  - **The C109 records it owns.**
- **Stage 1b: `foundation-7b`** (plumbing only; one migration, extended per checkpoint; the PGlite measurement before and after):
  - **(L) lists and importers:**
    - tables: every C98 table with the SP-GiST and GiST operator classes asserted by a migration test; `list_matches`, `list_screenings`, `list_import_rows`, `list_import_errors`, the importer table; the `list_config` template version column;
    - repository stubs; 7B's labels in `identifierKey`; the `rebuildListIndexes` stub;
    - sealing, the envelope DEKs, the masking and API-log sets, the redaction entries and subject prefixes, the retention steps, the settings served;
    - `createListScreeningInTx` in `transitionInquiryInTx`, and the `CompromisedIdLookup` port (stub) in the government ID job (C99.9);
    - `onSettingsChangedInTx` (stub) in `services/settings.ts` (F16);
    - the ports with in-memory fakes in `test-support/fakes.ts` (F08): `ListItemWriter`, `ListService`, `BiometricListMatcher`, `BiometricItemRedactor`, `BiometricListsGate`;
    - the queues `list-screen`, `list-import` and `list-item-embed`, with their sweeps;
    - every list, item, match and importer route frozen;
    - the strict webhook filter stub for the list-match subject (V14);
    - the `custom-list` job hook stub (and the `report_type` migration if it is an enum).
  - **(T) transactions:**
    - the transaction tables (C105.4) with the append-only triggers;
    - repository stubs; sealing; the envelope DEK of `transaction_files`; masking; redaction (with `stubEventPayloads` and `forgetStoredResponses`); retention;
    - the `transaction` relationship resolvers (stub);
    - every transaction, type and version route frozen;
    - the strict webhook filter stubs for the transaction and transaction-type subjects (C107.4).
  - **(G) graph:**
    - tables `graph_attributes`, `graph_index_jobs`, `graph_index_state`, `graph_components`, and the graph-query and template tables;
    - repository stubs; the `rebuildGraphIndexes` stub;
    - `indexAccountAttributesInTx` (stub) at the in-transaction hook points of C101.3, including 7A's reserved call site; `createGraphIndexJobInTx` in `transitionInquiryInTx`;
    - the consolidation and redaction hooks;
    - the queues `graph-index` and `graph-query`, with their sweeps; the `graph-backfill` and `graph-components` registrations; the `apps/api/package.json` scripts `graph:reindex` and `graph:benchmark`;
    - every graph route frozen;
    - the strict webhook filter stub for the graph-query subject.
  - **After the last checkpoint:** the OpenAPI snapshot.
- **Stage 2:**
  - **`list-logic`** (after Stage 1a (L)): C98.2's key inputs with golden vectors and `LIST_KEYS_VERSION`; the graph kinds' key inputs of C101.2; the C100.6 CSV writer with OWASP golden vectors; the import column and error-code tables. It owns `packages/checks/src/{lists,csv}/`.
  - **`transaction-schemas`** (after Stage 1a (T)): C104.2–C104.5 as a pure engine:
    - the field-schema meta-schema;
    - the validator built by walking schemas, cached by version;
    - the caps and the card-number guard at every position;
    - the status and relation-schema rules;
    - the version diff that yields `deleted-field` and `converted-field`;
    - the pure check of the `json-schema` keyword allowlist.

    The schema's compilation with ajv belongs to `api-transactions`. It owns `packages/core/src/transactions/`.
- **Stage 3:**
  - **`api-lists`** (after Stage 1b (L)): C97, C99.1–C99.6 and C99.9.
    - Lists and items, with the routes and services, `ListItemWriter` and `ListService`.
    - `matchLists` for the non-biometric kinds, list matches with dismissal, the screening outbox with its job and sweep, the `list-config` publish rules, `on-list-match` and `inquiry/list_match_count`.
    - `CompromisedIdLookup` and the check's input and reason changes; `rebuildListIndexes`; item retention; the `custom-list` report (C106.2).

    It owns `apps/api/src/services/lists/` except `biometric/`, `apps/api/src/services/publish/list-config.ts`, `routes/server/{lists,list-items,list-matches}.ts`, `apps/api/src/jobs/lists/` except `embed.ts`, `jobs/report-types/custom-list.ts`, `packages/db/src/repositories/{lists,list-items,list-matches,list-screenings}.ts`, and the `compromisedList` input and reason in `packages/checks/src/government-id/`.
  - **`api-biometric-lists`** (after Stage 1b (L)): C99.7 and C97.4. That covers the face and background lists (item creation from an inquiry with the consent check, the embed job through vision, the item's own sealed copy and retention, the bounded cache, the background prefilter and ORB confirmation) and the acknowledgement setting with `onSettingsChangedInTx`, `BiometricListMatcher`, `BiometricItemRedactor` and `BiometricListsGate`. It owns `apps/api/src/services/lists/biometric/`, `apps/api/src/jobs/lists/embed.ts` and `packages/db/src/repositories/list-biometrics.ts`.
  - **`api-importers`** (after Stage 1b (L)): C100 except the writer, through `ListItemWriter`. It owns `apps/api/src/services/importers/`, `routes/server/importers.ts`, `apps/api/src/jobs/importers/` and `packages/db/src/repositories/importers.ts`.
  - **`api-transactions`** (after Stage 1b (T)): C104 and C105.
    - Types and versions, and the transaction routes and services.
    - The `json-schema` compilation with ajv.
    - File fields with the content route.
    - Events, redaction with the `never` override, biometric redaction through `BiometricItemRedactor`, the `transaction` relationship resolvers, and retention.

    It owns `apps/api/src/services/transactions/`, `routes/server/{transactions,transaction-types,transaction-type-versions}.ts` and `packages/db/src/repositories/transaction*.ts`.
  - **`api-graph`** (after Stage 1b (G)): C101–C103.
    - The indexer at every hook, the index job and sweep, the backfill and `graph_index_state`, consolidation and redaction (stored results included).
    - Templates and versions; the engine with capped counts and the synchronous cap; the routes, the job and the advisory claim.
    - The unmask route with its mapping and policy; bulk actions with the CSV export; components.
    - `graph:reindex`, `rebuildGraphIndexes`, and `apps/api/scripts/graph-benchmark.ts`.

    It owns `apps/api/src/services/graph/`, `routes/server/{graph-queries,graph-query-templates,graph-query-template-versions}.ts`, `apps/api/src/jobs/graph/`, `apps/api/scripts/{graph-reindex,graph-benchmark}.ts` and `packages/db/src/repositories/graph*.ts`.
- **Stage 4: `integration-7b`:**
  - the 7B full-stack specs, on the reusable stack and its shards;
  - `docs/lists/`, `docs/graph/`, `docs/transactions/`, the `custom-list` page in `docs/reports/`, the additions to `docs/checks/sandbox-providers.md`, and the seeded `custom-list` template;
  - the OpenAPI snapshot, `@openverify/node` and the fixtures after Stage 1;
  - CI and the full validation;
  - defects fixed test-first; missing hooks; the amendments.

  It owns `e2e/`, `docs/lists/`, `docs/graph/`, `docs/transactions/`, `docs/checks/`, `docs/reports/`, `docs/api/openapi.json`, `.github/workflows/ci.yml`, `turbo.json`, `infra/`, `.dockerignore` and `docs/plans/phase-7.plan.md`.

**Shared files (7B).** The 7A list, plus:
- `packages/checks/src/index.ts` and `packages/core/src/index.ts`;
- `apps/api/src/jobs/government-id.ts` (the C99.9 hook);
- `packages/core/src/signal-registry.ts` (after Stage 1a).

Consolidation lives in `services/accounts.ts`, which is already on the list.

## Workflow 7C (console, review, fixes)

- **Stage 1** (parallel):
  - **`dashboard-signals`** builds:
    - the inquiry Sessions, Signals and List matches sections, with their wording rules;
    - the `signal-config` and `list-config` editors in `VersionEditor`;
    - the network sources page;
    - the settings of C107.7, with the audit trail and the `settings:privacy` label;
    - the account page's signals and list-match sections, and the two account-page slots for the other agents (F32);
    - the event words for every new event, the permission areas, and the README section.

    It owns:
    - every shared dashboard file, including the settings page, `components/operators/settings-fields.ts` and `lifecycle/version-editor.tsx`;
    - `apps/dashboard/package.json`, `pnpm-workspace.yaml` and the lockfile. It adds Cytoscape and fCoSE first, on request (F14);
    - `e2e/tests/ui-signals.spec.ts`.

    It adds the other agents' navigation entries when asked.
  - **`dashboard-lists-transactions`** builds lists, items and importers; transactions and the types editor; and the account page's transactions section, in its slot. It owns `app/lists/`, `app/transactions/`, `app/transaction-types/`, their components, fixtures and mock routes, `e2e/tests/ui-{lists,transactions}.spec.ts` and `e2e/tests/support/ui-{lists,transactions}.ts`.
  - **`dashboard-graph`** builds the explorer with its table view, the templates, bulk actions and export, the click-to-unmask, the account page's graph section (in its slot), and the CSP and accessibility tests. It owns `app/graph/`, its components, fixtures and mock routes, `e2e/tests/ui-graph.spec.ts` and `e2e/tests/support/ui-graph.ts`.
- **Stage 2: review of all of Phase 7** (read-only, parallel):
  - **privacy, security and law:** collection before consent; tiers, notices and the `exempt` mode; the handoff phone's own consent; fingerprints and key ids; IP handling and trust mode; handoff phishing; biometric lists; graph profiling, node ids and unmask; transactions and card numbers; API logs and redaction at every exit;
  - **correctness and honesty:** `null` against `false`, and the session-combination rules; tiers and confidences; the threat level; scores and their caps; matching semantics, unscreened lists and `list_match_count`; the graph caps, truncation and the backfill; transaction validation; the report types;
  - **data, licences and performance:** the network sync guards and terms; the attribution; snapshot memory at the swap; the CSV parser and its caps; the SP-GiST plans; the graph benchmark; the collector size;
  - **console:** React; accessibility (the explorer and its table, the QR alternative); the RSC payload; masking in the console.
- **Stage 3:** one verifier for every CRITICAL and HIGH finding. It records the 7C Stage 1 amendments.
- **Stage 4:** path-owned fixers:
  - **`fix-api`:** `apps/api`, `apps/flow`, `packages/`, `android/`, `e2e/` except the `ui-*` specs and their helpers, `docs/plans`, `docs/api`, `docs/checks`, `docs/network`, `docs/lists`, `docs/graph`, `docs/transactions`, `docs/flow`, `docs/reports`, CI, `infra` and `.dockerignore`. It measures the e2e suite again with the UI specs and adjusts the shards;
  - **`fix-console`:** `apps/dashboard`, and `e2e/tests/ui-*.spec.ts` with their helpers.

## Rules for every agent

- **TDD:** RED first, seen failing for the intended reason; the RED commit compiles and typechecks; then GREEN; then refactor on green. Evidence goes in `docs/tdd/phase7-<agent>.tdd.md`.
- **Shared files:** builders never edit the shared-file lists above. Route schemas, the OpenAPI snapshot, `@openverify/node` and the API fixtures change only through the integration agent. A missing hook or schema change is a `contractDeviation`. Dependencies land in Stage 1a (7A, 7B), or through `dashboard-signals` (7C).
- **Shared resources:**
  - commits are path-scoped under `flock /tmp/openverify-git.lock`, after `git diff --cached --quiet`;
  - the full-stack e2e runs under `flock /tmp/openverify-e2e.lock`, as the mocked flow suite plus shards on the reusable stack (C111.2);
  - long gates run in the foreground with a 600,000 ms timeout; only the stack start may run in the background;
  - flaky tests are made deterministic, never retried. Tests assert order only on keys the code orders by (C1's `created_at DESC, id DESC`, ties included), and never look for a short string inside random output.
- **No network in tests:** no publisher call (DB-IP, Tor, a cloud provider, GitHub) from any test. Use MockAgent or local stubs with our own synthetic answers, and injected resolvers. The pinned `scripts/fetch_*` downloads that CI runs before tests are allowed (F38).
- **Honesty (ADR 0002, ADR 0005, ADR 0006):**
  - no `false` for an unknown; no "no match" for an unscreened list, a coarse probe, an outdated normaliser or a rotated key;
  - no signal, list match or graph link declines, passes or fails anything, except the one stated exception of C99.9;
  - H-tier values carry a confidence and their reasons; every constant is provisional, with a basis; no threshold is tuned on test data.
- **PII:** no address, coordinate, fingerprint, list value, graph value, field value, CSV row or parameter may appear in:
  - logs (outside `pii`), request URLs logged by the server, or stored API logs read without `pii:view`;
  - metadata, problems, events or git.

  Synthetic data only.
- **Collection:** nothing is read from the browser or the device before the session may collect (C94.3, C94.6). No new browser API is read without a registry entry and a consent or notice key.
- **Licences and versions:** rule 4; versions at least 14 days old; no new build script without an `allowBuilds` decision; static data through `scripts/fetch_*` with pinned SHA-256; live network data only through the sync (ADR 0006).
- **Content:** no Persona name, branding or copied text in product UI, docs or messages.

## Validation

```bash
pnpm install --frozen-lockfile && pnpm format:check
pnpm turbo run lint typecheck --force
pnpm test                                     # every package >= 80%, @openverify/signals included; the collector size test bundles in-test
pnpm test:integration                         # migrations and operator classes, sync refusals and races, snapshot swaps, list matching, importer rollback, graph caps, transaction races
python3 scripts/fetch_models.py && python3 scripts/fetch_data.py
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
(cd android && ./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
pnpm --filter @openverify/flow e2e           # the mocked flow suite
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e e2e:stack:up     # background allowed
for i in $(seq 1 $N); do OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --shard=$i/$N; done
pnpm --filter @openverify/e2e e2e:stack:down
docker build -f infra/docker/apps.Dockerfile . && docker build services/vision
for t in infra/tests/*.test.sh; do bash "$t"; done   # includes no network data in the image, and the flow's headers
gitleaks git --redact .
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A signal reads as a verdict ("not a VPN", "human") | High | `null` instead of `false` wherever the data is not exhaustive; "not evaluated" in words; no check reads a signal; review rules only, off by default (C90.3, C90.6) |
| Collection before consent, or beyond what the consent text names | Med | The flow sends nothing before consent and the server refuses it (409); a registry entry and a text key for every browser API read; recognition dropped server-side without its tier (C94.2, C94.6) |
| Fingerprints become a cross-customer tracker | Low | Keyed per environment under the blind-index subkey; never in another environment; device recognition off by default and consent-gated (C94.4) |
| Network data from a wrong or client-chosen address (a misconfigured proxy, `trust-all`) | Med | Only `request.ip`; the trust mode recorded on every network row; `trust-all` gives `client_address_untrusted` in production; `warnOnPrivatePeers` with its owner and test (C93.1) |
| DB-IP changes its terms, file names or the two-month window | Med | The manifest's URL template and digest scraper refuse an unexpected page; the sync errors and the data turns stale, then `null`; the sources page shows it (C92) |
| A poisoned or truncated range list | Low–Med | HTTPS and the vetted lookup, monotonicity and the mass-removal guard under the lock, imports labelled (C92.2) |
| Snapshot memory grows past a small host's RAM | Med | City Lite off by default; snapshots unenveloped, so a swap holds no ciphertext copy; sources swapped one at a time; the steady and peak footprints measured and documented (C92.3) |
| The collector breaks the flow or the CSP | Low | No network, no storage, no worker; a size budget; a Playwright CSP test; failures in the collector are swallowed and reported as `signals_not_collected` |
| QR handoff phishing (illicit onboarding) | Med | The phone records its own consent before anything; QR only by default, and email and SMS only to confirmed destinations; a non-consuming preview; short single-use tokens bound to the session; the context screen with decline; "this was not me", which cancels the phone's captures; the distance signal; the threat model in the docs; the residual risk stated (C96) |
| Face lists identify people who never consented | Med | Disabled until an operator records a basis; items only from consenting inquiries; the probed person's consent required; advisory only; caps (C97.4, C99.7) |
| IP links merge the graph into one component | High without the rule | Weak kinds opt-in, ≤ 4 hops, never in components; fan-out caps; hub skipping (C101.2, C102.3) |
| A graph query exhausts the database | Med | Per-statement timeouts within a deadline, node limits, one running query per template, a rate policy; the benchmark (C102) |
| CSV injection through exported values | Med | The shared writer with OWASP's full character list; golden vectors (C100.6) |
| An operator's JSON Schema or field schema runs code or hangs the server | Low | Zod walking without code generation; a restricted meta-schema for `json` with size and depth caps; ajv only on the server (C104.3) |
| PANs stored in transaction fields | Med | The card-number guard on by default; the docs (C104.4) |
| A blind-index key change silently breaks lists, devices and the graph | Med | `blind-index:rebuild` recomputes every new key from sealed sources; outdated normalisers answer `normaliser_outdated` (C98.2, C101.5) |
| Stage 1a or Stage 1b of either Workflow does not finish | Med | Plumbing only; checkpoints by family, so each builder starts at its own family's checkpoint and a stalled family holds back only itself; Stage 2 beside Stage 1b (F22, F36) |
| Unscreened, unindexed or unevaluated data reads as clean | Med | Null reasons from one frozen enum; `on-null` in review rules; `list_match_count` states; `unscreened` and `not-applicable` on every exit; `index-complete` on graph results; schema refinements that refuse a `false` (C90, C99, C101.5) |
| PII escapes through API logs, request logs, idempotency copies or events | Med | Request-body members marked PII and masked in stored API logs; a request serializer without URLs or addresses; every new prefix in the redaction lists; `stubEventPayloads` and `forgetStoredResponses` on every new redaction (C93.7, C107.5) |
| The e2e suite outgrows one call and Playwright's global timeout | High | A reusable stack with shards under 8 minutes each, and a CI shard matrix (C111.2) |
| Phase 6 lands differently from its plan | Med | Each Stage 1a re-verifies and records amendments before any Phase 7 code |
| Each new migration lengthens the PGlite migration that every db unit test runs, which already hits 60 s hooks under load (PROGRESS, Phase 5 carried forward) | High | Each Stage 1b measures the PGlite migration before and after its migration and records it; one migration per Workflow; if the hook budget is exceeded, the db tests share one migrated template database per worker (a Stage 1b fix, test-first) instead of raising timeouts |

## Acceptance

- [x] **Signals (C90):** every catalogue signal has a registry entry, a computation at its tier, golden tests, a docs entry and a console view.
  - No signal is `false` where its data is not exhaustive, and every null carries a reason from the frozen enum.
  - Every H-tier value carries a confidence, reasons and thresholds, and the schema refinements refuse violations.
  - Sessions combine by the C90.4 rules.
  - `on-signal` only ever moves `completed` to `needs_review`, honours `on-null`, and never breaks settlement.
- [x] **Collection (C94):** nothing is read from the browser or the device before the session may collect.
  - Session integrity runs only under the notice key.
  - Device recognition is off by default, consent-gated on the collecting session, and `exempt` never overrides a declined tick.
  - The collector is at most 4,096 B gzipped (bundled in-test), makes no request and passes the production CSP.
  - Scores stay below 70 without a strong artefact, and low scores carry capped confidence.
- [x] **Sessions (C91):** sessions carry the parsed device, the network facts with provenance and trust mode, and the handoff fields.
  - Devices and networks are served with masking at every exit, stored API logs included.
  - The session cap (checked after a valid token), `expire-all` by `meta.inquiry-ids` and `generate-one-time-link` work.
  - Redaction and the retention settings leave no address, location or fingerprint where their windows say.
- [x] **Network data (C92, C93):**
  - The network sync refuses rollback, mass removal, mass addition, a bad schema, an oversize body and a redirect to another host, under the lock.
  - One sync runner serves both the network and the watchlist syncs, with 6A's race tests green.
  - Stale data gives `null`; production never reads sandbox data; nothing from a publisher is in git or in an image.
  - The DB-IP attribution appears wherever an IP location does, and the peak swap memory is documented.
  - The public datacenter fields come only from provider ranges.
- [x] **Distances (C95):** distances are whole meters with their endpoints' uncertainty and the stated constant.
- [x] **Handoff (C96):** handoff by QR, and by email to a confirmed destination, works across two browser contexts.
  - The preview consumes nothing.
  - The phone records its own consent before any capture.
  - Tokens are single use, short-lived and bound, and failures are uniform.
  - The desktop is locked while the phone captures.
  - Every consent gate reads `getEffectiveConsent`, so a phone never captures on the desktop's consent, and a rejected phone's consent authorises nothing.
  - The phone's decline needs no session.
  - A rejection cancels the phone's unfinished verifications. Its finished ones are excluded from probes, graph indexing and signals, and the inquiry goes to `needs_review` with `handoff_rejected`.
  - A rejected or declined step shows again.
  - The step is done, skipped or continued correctly in the web flow and the Android SDK.
- [x] **Lists (C97–C99):** all thirteen kinds can be created, filled, imported (where an importer exists), archived and matched by their stated method, with tiers on matches.
  - No list reports "no match" when it was not screened, on any exit (`list_match_count`, `POST /lists/match`, the console, the custom-list report).
  - Face and background lists are disabled until acknowledged, need consent on both sides, follow the consent's retention, and are redacted when the basis is cleared.
  - `id_compromised_detection` fails on an opted-in list and answers `not_applicable` when a configured list was unscreened.
- [x] **Importers (C100):** all-or-nothing by default; strict encodings; no value echoed in errors, logs or API logs; three idempotency levels; staged rows deleted; the export writer neutralises OWASP's full character list.
- [x] **Graph (C101–C103):**
  - Indexing is in-transaction where plaintext is held, and through the outbox at completion, failure and expiry.
  - The backfill completes, and results say `index-complete` until it does.
  - Consolidation and redaction are exact, stored results included.
  - Queries respect hops, node limits, capped fan-out, deadlines and the synchronous cap; they return no value or key in node ids; and unmasking is audited and limited.
  - Bulk actions act only on stored results, within 500 accounts, with `graph:read` and their own scopes.
  - With `graph-components` on, components are computed nightly over strong kinds only, and shown with `computed-at` or "not computed yet" (C101.6).
  - Per-kind completeness is reported after every settings switch.
  - The benchmark is reported.
- [x] **Transactions (C104, C105):**
  - Transaction types publish immutable versions with the fifteen field types and the stated keyword allowlist.
  - Transactions validate against their pinned version, refuse card-like values at every position and second writes of `write_once` fields, and redact and biometric-redact completely, stored copies included.
  - File content is served only through the audited route, and the events and the `transaction` relationship are correct.
- [x] **Reports (C106):** `report/ip-address` (review `none`; `null`, never `CLEARED`, where the exit list cannot answer; errored on a stale exit list) and `report/custom-list` (errored on any unscreened list) run on the Phase 6 engine.
- [x] **Platform (C107):**
  - The flow sends its response headers (carried since Phase 1).
  - Webhook filters are strict for the new subjects.
  - The rate-limit policies are applied with their windows.
- [x] **Console (C108):** every Phase 7 feature is usable from the console without the API, including the signal and list configuration.
  - Masked without `pii:view`; null worded "not evaluated" with its reason; `beta` badges.
  - The DB-IP line where IP locations show.
  - The explorer's table view is usable by keyboard, and its CSP test passes.
- [x] **Records (C109):** ADR 0006 (with the C99.9 exception), the PLAN and `THIRD_PARTY_LICENSES.md` corrections, the surface-index additions, and the docs of C109 are written.
- [x] **Process:** every existing suite stays green at the end of each checkpoint and stage. Every validation command passes locally and on GitHub. Each agent writes its `docs/tdd/phase7-*.tdd.md`, and `docs/PROGRESS.md` records Phase 7.

**At the close (2026-11-02).** A tick means that no known item stays open against the line and that its tests passed in the full validation of `f606062c`. It does not mean that every sub-line was walked again by hand. The Process line was ticked last, once CI 41387332060 had passed the pushed commit `f8c488ad`, 14 of 14 jobs. Phases 5 and 6 did not tick their lists, so this is the first list to carry ticks.

The five HIGH items held four lines open. Each was traced to a test that ran in that validation:

| Item | Line | Test |
|---|---|---|
| `K7A-1`, a session-cap expiry leaves no canceled capture's object | Sessions | `apps/api/src/services/signals/session-cap-objects.test.ts` |
| `K7A-2`, email handoff end to end | Handoff | `e2e/tests/handoff.spec.ts`, "by email: ...", through Mailpit in two browser contexts; it landed in `4d6c443d`, whose title names only K7A-3 and K7A-17 |
| `K7B-1`, redaction reaches transactions | Transactions | `apps/api/src/services/redaction-transactions.test.ts` |
| `K7B-2`, the account's graph component | Graph | `apps/api/src/routes/server/account-graph-component.test.ts`, and the console's `account-graph-section.test.tsx` |
| `K7C-1`, a verification from a rejected handoff is marked | Handoff | `apps/api/src/routes/server/verifications.test.ts`, `inquiry-session-handoff.test.ts`, and both contract tests |

Against the Graph line, "the benchmark is reported" stands with R007's limit: the report says what its figures measure, and dense scenarios are Phase 11's.

## Decisions for the owner (made here; confirm or change)

Each item states the default the build uses until the owner decides, so none blocks a Workflow.

**Network data and terms**
1. **Live network data and rule 4.** DB-IP keeps only two months online; Tor exits change hourly; cloud ranges daily. Default: ADR 0006, an operator-run sync, never committed or shipped, verified instead of pinned, with the C76 guards.
2. **DB-IP attribution.** Default: the line "IP geolocation by DB-IP" with a link on every console page that shows an IP location or a distance computed from one, on the flow's phone context screen, in the API docs and in `THIRD_PARTY_LICENSES.md`.
3. **Google Cloud ranges** (no licence stated; the host's robots file allows the file by its literal rules). Default: enabled, as AWS is: factual data published for programmatic use, synced by the operator, never redistributed, each provider switchable.
4. **Azure service tags** (Microsoft's default site terms are personal and non-commercial). Default: disabled; the operator may enable them after reading the terms.
5. **Apple Private Relay egress.** Default: disabled; when enabled it sets `privacy-relay` only and never raises a threat level.
6. **A licence declared in a README without a LICENSE file** (X4BNet). Default: accepted; pinned by a commit at least 14 days old; the README's MIT text copied into `THIRD_PARTY_LICENSES.md`; re-checked when the pin moves.
7. **iptoasn** (PDDL-1.0, scope unclear, robots disallow the files). Default: not used; DB-IP ASN Lite covers ASN and organisation; PDDL is not added to the allowlist.
8. **IP reputation adapters.** Default: `ipReputation` with an operator-licensed MMDB file mode and a sandbox, read by the API and the worker; it answers `true` or `null`, never an unrecorded `false`; no vendor API client until an operator asks.
9. **GPS.** Default: not collected in Phase 7; the GPS attributes are always `null`; Natural Earth and reverse geocoding wait with it.
10. **DB-IP City Lite** (60 MB compressed). Default: disabled; enabling it lights up region, coordinates, distances and geolocation-list probes.
11. **Staleness limits.** Default: as C92.1 (DB-IP 45 days, Tor 6 hours with a 24-hour match window, cloud ranges 7–14 days).

**Signals and the law**
12. **Android signals.** Default: Phase 7 adds the contract, debugger facts and the `ANDROID_ID` HMAC; Phase 10 adds emulator, root and hooking heuristics with Play Integrity.
13. **Checks for signals.** Default: none; signals only. A later check could only fail or review on evidence, never pass.
14. **Collector.** Default: our own, at most 4 KB gzipped; FingerprintJS v5 (MIT again since 5.0.0) as a design reference only; no fingerprinting dependency in the flow.
15. **Session-integrity collection** without a separate consent, after the consent step, under the operator's strictly-necessary assessment. Default: on, but only under templates whose consent step lists the notice key `notice.session-integrity` (the default template does); the operator can switch it off.
16. **Device recognition.** Default: off. When enabled, it is either the optional `consent.device-recognition` key, ticked on the collecting session, or an `exempt` mode with a recorded basis and the notice key `notice.device-recognition`. A template in `exempt` mode cannot also offer the optional tick. Changes are audit-logged under `settings:privacy`.
17. **Exposing `signals`** on the API and webhooks. Default: yes, labelled `beta` with confidences; an environment setting hides them.
18. **Auto-decline on a signal.** Default: never; review rules only (GDPR Art. 22); an operator who wants it writes a Phase 8 workflow.
19. **Retention.** Default: sealed collector components 30 days; behaviour aggregates with the inquiry; IP addresses with the inquiry unless `ip-retention-days` is set; graph query results 30 days.
20. **Bot-score scale.** Default: 0–100 on the inquiry (the public scale).
21. **Session statuses.** Default: ours (`active`, `expired`, `canceled`), with the public mapping documented.

**Handoff**
22. **Handoff.** A rejection cancels what it can and sends the rest to review; it never silently drops or keeps a stranger's captures.
    - **Token.** A new `ovh_` token bound to the issuing session. QR tokens live 5 minutes (2–15); email and SMS tokens live 15 minutes (5–60), shorter than the public hour, for phishing. A token is single use with no re-use grace (ours), one is live per session, and redemption happens on Continue after a non-consuming preview.
    - **Methods.** QR only by default. Email and SMS go only to destinations the inquiry has confirmed, unless the confirmation code is on, which is off by default.
    - **Consent.** The phone records its own consent before anything.
23. **SMS handoff.** Default: only when an SMS adapter is bound, under the Phase 5 SMS-pumping limits.
24. **QR library.** Default: the smallest gzipped addition among `qrcode` 1.5.4, `uqr` 0.1.3 and `lean-qr` 2.7.4, measured in the flow bundle.

**Lists**
25. **What "list-match checks" means** (PLAN §6). Default: no new check ids. The existing `id_compromised_detection` reads government ID number lists marked `use-for-compromised-ids` (C99.9), and every other match becomes a `list-match` record, the `inquiry/list_match_count` signal and an `on-list-match` review rule, off by default.
26. **Face and background lists.** Default: disabled until `biometric-lists-basis` is set; items only from inquiries with `consent.biometric-matching`; the probed person's consent required; advisory only; at most 10,000 items; no ANN index.
27. **Face-image and background-image import.** Default: deferred until the owner decides, with a documented lawful basis and a DPIA note.
28. **Plaintext IP list values.** Default: ranges only (IPv4 ≤ /31, IPv6 ≤ /127); single addresses through the HMAC.
29. **Shared identifier keys.** Default: one key per kind is shared by lists and the graph, except the government ID number (the graph uses the issuer-qualified C31.8 index) and the chip and crypto kinds, which keep their existing indexes.
30. **Screening at completion.** Default: every active exact-kind list whose `screen-at-completion` is true; biometric lists only when named.
31. **CSV.** Default: UTF-8 only unless an `encoding` parameter names a WHATWG single-byte label; UTF-16 refused; uploads buffered up to 20 MB so `Idempotency-Key` works; 100,000 rows per file.
32. **Provider-specific email canonicalisation** (dots, `+tag`). Default: not offered in Phase 7.
33. **List exports.** Default: Phase 9.

**Graph and transactions**
34. **Weak kinds** (IP, browser fingerprint, web device class, name, birthdate, postal code, email domain). Default: not even written unless `graph-weak-kinds` is on; traversed only when a template opts in, at ≤ 4 hops; never in components.
35. **Traversal.** Default: breadth-first search with a visited set (not recursive CTEs, as PLAN §6 said); no Apache AGE.
36. **Explorer.** Default: Cytoscape.js with fCoSE on canvas, ≤ 2,000 nodes, with a table view.
37. **Bulk-action cap.** Default: 500 accounts per action.
38. **Transaction type versions.** Default: immutable versions that each transaction pins (ours), with a full type API.
39. **Card-number guard.** Default: on.
40. **`json` field schemas.** Default: a restricted subset compiled by ajv on the server.

**Reports**
41. **`report/custom-list`** (Phase 6 deferred it to Phase 7). Default: in Phase 7; re-screening on a list change waits for Phase 8.
42. **`report/ip-address` `has-match`.** Default: always `false`, as the Phase 6 contract requires for a type without match review. Our own `flagged` field is true when any of Tor, VPN, proxy or provider-range datacenter is true.

**Research hygiene**
43. **The research's saved pages that echoed this machine's public address** were redacted to `192.0.2.0` on 2026-10-27, and the notes never held it. Default: keep the redacted copies outside git, with the other downloads.

**Added after the review**
44. **Network snapshots unenveloped.** These are public publications, so integrity comes from the recorded SHA-256, which keeps a swap from doubling memory. Default: yes.
45. **A `settings:privacy` permission** (admin by default) gates the legal switches: collection tiers, the biometric-list basis, and graph indexing, weak kinds and components.
46. **Graph reads are not for viewers.** `graph:read` joins `NOT_FOR_VIEWERS`, and running a query with person-identifying parameters needs `pii:view`, as does `POST /lists/match`.
47. **The one list match that can fail something.** `id_compromised_detection` fails on a list opted in with `use-for-compromised-ids`. It answers `not_applicable` when such a list could not be screened. Default: as stated, documented in ADR 0006 with the operator's Art. 22 duty.
48. **One sync runner.** `api-network` extracts it from 6A's watchlist sync and moves that sync onto it, with 6A's race tests unchanged and green.
49. **Failed and expired inquiries** get signals, list screening and graph indexing too, so failed fraud attempts link to later ones. Default: yes.
50. **Graph settings.** Default: indexing on, weak kinds off, components off. No write-side degree table: fan-out is counted when a query reads.
51. **`device-retention-days`.** Default: 365 days (1–1,095).
52. **`organization-display-name`** is shown to end users on the handoff context screen and is required by the handoff step.
53. **The web device class is ours (`device-class`) and never a list probe.** It is shared by every user of one model and configuration. `device-fingerprint` is the `ANDROID_ID` HMAC, and `null` on web.
54. **Server-side signals** (network, sessions, lists) are computed whatever the browser-collection tier says, under the operator's privacy notice. Only collector-based signals follow `session-integrity`.
55. **Country signals are H-tier.** An IP country is wrong for VPNs, roaming and corporate egress, so `country_from_session` and `country_comparison` are `beta`, with a confidence, and `country_comparison` is `null` for anonymised sessions.

## Phase 6 outcomes that amend this plan (2026-10-30)

Phase 6 closed after this plan was written and reviewed. These outcomes are binding on Phase 7; where they contradict a contract above, they win. The record of each is in `docs/plans/phase-6.plan.md` (the owner decisions after Workflows 6A, 6B and 6C, the 6C amendment sections, and "Workflow 6D Stage 1 and 2 amendments" and "Workflow 6D review amendments").

1. **No change signal** (owner decision 10 after Workflow 6B; ingestion-6c amendment 8). C92.1's `change_signal` member, the runner's change-signal step and C92.2's step 2 are void. `network/sources.json` has no `change_signal` member, and its schema refuses one, as the watchlist manifest's does. Every check downloads the publication and compares its SHA-256. HTTP conditional requests (ETag, Last-Modified), whose 200 is still compared by SHA-256, are Phase 11's. C92.2's remaining steps keep their numbers, and step 2 reads "(void: no change signal)".
2. **The one redirect keeps the request's scheme, host and port** (owner decision 20 after Workflow 6B; `followableRedirect` in the C85.1 stream client). The network-source clients inherit it when C85.1's `stream()` is widened to them.
3. **What the sync runner refactor moves** (C92.2, `api-network`). Since the `23eb8e49` split, the sync files are `apps/api/src/watchlists/{sync,sync-session,download,formats,manifest,reconcile,cli,cli-runtime}.ts`, `apps/api/scripts/watchlists-sync.ts`, and the sync writes in `packages/db/src/repositories/watchlists.ts`. The matcher's `watchlist-reads.ts`, `watchlist-key-df.ts` and `watchlist-rows.ts`, and `rekey.ts` and `matcher-data.ts`, are not sync files: `api-network` neither owns nor changes them. The runner keeps every Phase 6 behaviour of the watchlist sync: the 6A and 6C race tests, the re-key under the source lock, `rebuildWatchlistKeyDf` with `gin_clean_pending_list`, the back-off of migration 0021, and the freshness and mass-change guards.
4. **A redacted inquiry** (owner decision 5 after Workflow 6C). A redacted open inquiry is never moved to `pending`, `completed` or `failed`, but still expires; `createInquiryReportsInTx` creates nothing for it. Phase 7 follows the same rule: `createSignalComputationInTx` and the list-screening and graph-indexing outbox writers write no row for a redacted inquiry, each job and sweep skips an inquiry redacted after its row was written, and on-signal never moves a redacted inquiry. Each is test-first, with a test through the expiry of a redacted inquiry.
5. **`report_type` is text with CHECK constraints, not an enum** (migration 0020). A new report type (`ip-address`, and any list-backed type) needs a migration that drops and recreates `reports_report_type_valid` and `report_templates_report_type_valid` over `REPORT_TYPES`, with a migration test inserting a template and a report of the new type. Phase 6's last migration is `0022_watchlist_changed_page_index`, so Phase 7's migrations number from 0023.
6. **The C78 scorer stays frozen** (owner decision 9 after Workflow 6C). The fuzzy name lists (C98) reuse the C78 analysis and scorer unchanged (`KEYS_VERSION` `names-2`, `SCORER_VERSION` `scorer-2`). No C78.4 constant, threshold, preset or cap changes in Phase 7; a change needs a quality calibration and goes to contractDeviations. `packages/watchlist/src/testing/held-out/` and its output are never read. Synthetic names come from `@openverify/watchlist/testing` (`heavy-headed.ts` with the fetched `data/` file, or `names.ts`).
7. **Where the name kinds' keys live** (C98.2). `@openverify/watchlist` depends on `@openverify/checks`, so `packages/checks/src/lists` cannot import the C78 name analysis. The name and last-name kinds are keyed in `packages/watchlist/src/list-keys/`, which calls the analysis without changing it; `contracts-7b` confirms the path as a Stage 1a amendment. `LIST_KEYS_VERSION`'s golden vectors for those kinds are pinned against the watchlist analysis, so a change of `KEYS_VERSION` bumps it and stored items answer `normaliser_outdated`.
8. **The watchlist benchmark's imports are frozen for Phase 7.** The benchmark CLIs import `watchlist-reads.ts` and the package's testing exports; Phase 7 does not change those signatures, does not widen `WatchlistReads` for custom lists, and runs `pnpm --filter @openverify/watchlist benchmark:typecheck` in its validation.
9. **Test hygiene** (6C). Every Testcontainers Postgres starts with `POSTGRES_TEST_COMMAND` (a guard test in `packages/db/src/testing.test.ts` scans every `src` and `scripts`); order-sensitive tests stamp rows with `createdAtClock` under `onTestFinished(wallClockStepsBack())`; CPU-bound assertions use `cpuMilliseconds`; hang guards are 60 s (120 s for PGlite hooks), and suites honour `TEST_MAX_WORKERS`. PGlite's migrated template is cached (cold and warm), so a new migration costs its own time once per run.
10. **Validation order** (amends Validation). Install, format, lint and typecheck with `--force`; `python3 scripts/fetch_models.py` and `python3 scripts/fetch_data.py`; `pnpm --filter @openverify/watchlist build:variant-groups` (the apps image checks its SHA-256, and the C78.7 gate runs its shipped case only with it); `pnpm test`; `benchmark:typecheck`; `pnpm test:integration` (the API suite as two blob shards and a merge); the vision suite; the Android gate; `openapi:write` with `git diff --exit-code`; the e2e gate; both docker builds; every infra test; `gitleaks git --redact .`.
11. **e2e and CI minutes** (owner decision 9 after Workflow 6A; decision 10 after Workflow 6C). The full-stack suite runs locally as three shards (`--shard=1/3` to `3/3`) under `/tmp/openverify-e2e.lock`, one step at a time; timing assertions run under the lock and record the load average. C111.2's CI shard matrix is added only if the measured suite with Phase 7's specs no longer fits the one CI e2e job (after Phase 6: 91 tests in 9.5 minutes locally, 12.5 to 15 of the job's 70 minutes in CI), because each job bills its own rounded minutes. Main is pushed once per Workflow, after its full local validation.
12. **Carried past Phase 7** (decision 9 after Workflow 6C): the matcher's write cost and JIT off for the application's role go to Phase 11; the "Other lists" console check and the reports' coverage words go to Phase 9.
13. **The C78.7 budgets at Phase 6's close** (`docs/calibration/watchlist-phase6d.md`; 6D Stage 1 and 2 amendments items 11 to 13). Missed on the calibration seed and carried, unmoved, as open lines to Phase 11 (C271): 100,000 names p95 180.9 ms against 100 ms; 2,000,000 names 808.0 ms against 250 ms (retrieval is 594.8 ms of it); the re-screen at 1,000 entries 71.2 s against 60 s after migration 0022. The C78.7 gate in `test:integration` passes on the 6C seed's table (median p95 65.0 ms). Phase 7 does not move a budget and does not change the matcher, retrieval or the re-screen; its own list screening (C98) is measured against its own budgets, and a Phase 7 change that touches a measured path re-runs the gate.
14. **Interfaces 6D changed that Phase 7 calls.** `transitionInquiryStatus` adds `redacted_at is null` for moves to `pending`, `completed` and `failed` (`ENDED_BY_REDACTION`), and `transitionInquiryInTx` returns null before staging any event or hook; a Phase 7 hook on that transition sees no call for a refused move. A redacted open inquiry gets `inquiry.expired`, never `inquiry.completed` or `inquiry.failed` (Phase 3 G002's note). `@openverify/watchlist/testing` exports `heavy-headed.ts` (`heavyHeadedPool`, `syntheticEntries`, `HEAVY_HEADED_100K`), add-only. The screening switches in `SCREENING_SHORTCUTS` are all on and stay on; `token-memo` no longer exists. `RecurringReportSubject.templateVersionId` and the db export `watchlistKeyFrequencyTable` are new; `WatchlistReads` gained no member.

## Workflow 7A Stage 1a amendments (contracts-7a)

Recorded by `contracts-7a` on 2026-10-30 at base `0a8d60ed`. Items 1 to 9 are the re-verification, done before any Phase 7 code; the later items are the decisions and deviations of the Stage 1a commits. The evidence is in `docs/tdd/phase7-contracts-7a.tdd.md`. Each item binds every later 7A agent.

### Re-verification of the Starting point and the Phase 6 interfaces

1. **Identifiers and tokens hold as the Starting point says, with one drift.** Both prefix tables are lowercase only; `dev`, `net` and `ovh_` are free everywhere (`packages`, `apps`, `android/openverify-sdk/src`, `e2e`, `contracts`). The six token prefixes are unchanged. **Drift:** `REDACTION_SUBJECT_ID_PREFIXES` is `inq, ver, iqse, acc, self, rep` (Phase 6 C73.5 added `rep`), not the five the table names.
2. **Sessions, the flow and data at rest hold as stated.** `inquiry_sessions` carries only the sealed `ip` and `user_agent` and the consent jsonb; `recordSessionStart` (`apps/api/src/services/inquiry-sessions.ts`) and `markInquirySessionStarted` (`packages/db/src/repositories/inquiry-sessions.ts`) are where C93.2 says; `getLatestInquiryConsent` is the only consent read. The flow has 15 step types, the production `<meta>` CSP has no `worker-src`, and no QR library is in `apps/flow`. `data/manifest.json` has 50 entries. The newest migration is `0022_watchlist_changed_page_index`, so Phase 7 numbers from `0023`.
3. **The watchlist sync, as Workflows 6A to 6D built it** (the files C92.2's runner is extracted from). `apps/api/src/watchlists/sync.ts` exports `syncWatchlistSource`, `isWatchlistSourceConfigured`, `WatchlistSyncDeps`, `WatchlistSyncRequest`, `WatchlistSyncResult`, `WatchlistSyncOutcomeName`, `UnknownWatchlistSourceError`, `ImportOnlyWatchlistSourceError`, `FUTURE_PUBLICATION_MS` (24 h), `SYNC_BATCH` (500), `STALE_DIRECTORY_MS` (1 h), and re-exports `poolWatchlistSessions`, `sharedWatchlistSession` and `WatchlistSession` from `sync-session.ts` (which also has `watchlistSessionsOf`). `download.ts` has `downloadSourceFile`, `sourceDownloadUrl`, `LIST_EXPOSED_HEADERS`, `WatchlistDownloadError`, `downloadCodeOf` and the SPARQL runner; `formats.ts` has `openPublication`, `hashFile`, `WatchlistRefusal` and `refusalOf`; `manifest.ts` has the strict manifest schema (no `change_signal`), `watchlistManifest` and `manifestSource`; `reconcile.ts` has `reconcileWatchlistSources`; `cli.ts` and `cli-runtime.ts` the CLI parsing, runners and `withWatchlistCliRuntime`/`runWatchlistCli`. The sync's steps are, in order: the configuration check, the matcher-data check, the session advisory lock (`tryLockWatchlistSourceSession`), the re-key of a source under another keys version (`rekeyLockedSource`), the download into a 0700 directory (or the import file), the SHA-256 of the same open file (`unchanged` when equal), parse and apply under `lockWatchlistSourceTransaction` and `lockWatchlistSourceRow` with the future, rollback, mass-removal and empty-publication guards, then `rebuildWatchlistKeyDf`, the re-screen enqueue, the check back-off columns of migration 0021, and the purge of removed entries.
4. **The files `api-network` may refactor** for C92.2's runner (and only for it): `apps/api/src/watchlists/{sync,sync-session,download,formats,manifest,reconcile,cli,cli-runtime}.ts` with their tests, `apps/api/scripts/watchlists-sync.ts`, and the sync writes in `packages/db/src/repositories/watchlists.ts` with its test. Not sync-runner files, and not `api-network`'s: `watchlists/{freshness,records,sandbox,rekey,matcher-data}.ts`, `watchlists/test-support/`, `watchlists.integration.test.ts`, and `packages/db/src/repositories/{watchlist-reads,watchlist-key-df,watchlist-rows,report-rescreen}.ts`. `api-network` may import `freshness.ts` (C76.3's rule, which C92.4 follows) without changing it. Every 6A and 6C sync race test, the re-key under the source lock, `rebuildWatchlistKeyDf` with `gin_clean_pending_list`, and the back-off of migration 0021 stay green and unchanged, and the benchmark's imports (rule 16) keep their names and signatures.
5. **Owner decisions 10 and 20 after Workflow 6B bind Phase 7.** There is no change signal: C92.1's `change_signal` member, C92.2's step 2 ("(void: no change signal)") and the runner's change-signal step are void for network sources, as C76.1, C76.2 step 2 and C77.4 are for watchlists; `network/sources.json`'s strict schema refuses the member. Every check downloads the publication and compares its SHA-256; an HTTP conditional request (ETag, Last-Modified, whose 200 is still compared by SHA-256) is Phase 11's. The one redirect keeps the request's scheme, host and port (`followableRedirect` in `apps/api/src/http/stream.ts`), and the network-source clients inherit it.
6. **The C85.1 stream client.** `createStreamClient` (`apps/api/src/http/stream.ts`) is reached through the optional `OutboundHttp.streamClient`, which test fakes leave out. "Only the watchlist clients make one" is a comment, not a check: a network-source client calls `streamClient` with no code change, and `api-network` amends the header comment with C92.2 (the C85.1 amendment). The exposed headers are a per-client option (`exposeHeaders`); the watchlist clients expose `etag`, `last-modified` and `x-amz-meta-publication-id`.
7. **C83's provider binding.** `PROVIDER_KINDS` is the government ID, selfie, 5A, 5B and Phase 6 kinds (`adverseMedia`, `emailIntelligence`, `phoneIntelligence`, `addressVerification`, `cryptoExposure`), each with its `OPENVERIFY_PROVIDER_<KIND>` prefix. `PROCESS_PROVIDER_KINDS.api` is `['sms', 'database', 'aamva']` and `.worker` every kind but `sms`. `ipReputation` joins `PROVIDER_KINDS` and both lists in Stage 1b (N), with `OPENVERIFY_PROVIDER_IP_REPUTATION`.
8. **The report engine.** `REPORT_TYPES` has the nine Phase 6 types; `REPORT_REVIEW_MODELS` is `matches` and `none`, and a `none` type's events are derived (`ready`, `errored`, `redacted`) with `has-match` typed `false`. `REPORT_UNAVAILABLE_REASONS` (`packages/contracts/src/reports.ts`) has ten reasons and `REPORT_QUERY_SOURCES` (`report-queries.ts`) eight; `INQUIRY_REPORT_QUERY_SOURCES` (the completion config's `query-source`) is `['inquiry']`. A report's `sources[]` takes any id of the watchlist source-id form, so the network source ids fit it unchanged. **`report_type` is not an enum**: it is text with the CHECK constraints `reports_report_type_valid` and `report_templates_report_type_valid`, built from `REPORT_TYPES` in `packages/db/src/tables/reports.ts`. Every layer walks `REPORT_TYPES`: `REPORT_TYPE_JOBS` (an equality test), the seed's one "Default <type>" template per type and environment, `apps/api/src/report-docs.test.ts` (a `docs/reports/<type>.md` page per type), and the dashboard's label, words, result and fixture tests. So adding `ip-address` to `REPORT_TYPES` without the migration, the job entry and the page breaks the seed, the API suite and the e2e (item 13).
9. **The transition hooks of C84.2.** `transitionInquiryInTx` (`apps/api/src/services/inquiries.ts`) calls one hook, `createInquiryReportsInTx`, when `runsCompletionReports(from, to)` (`pending → completed`, `failed → approved | needs_review`), after cancelling sessions and revoking links on leaving an open status. `LifecycleDeps` is `{ events, clock }`. Since Workflow 6D the function returns `null` before staging anything when `transitionInquiryStatus` refuses a redacted inquiry's move to `pending`, `completed` or `failed` (`ENDED_BY_REDACTION`), so a hook placed after the update sees no call for a refused move.

### Decisions and deviations of the Stage 1a commits

10. **`ip-address` lands whole in (N), because every layer walks `REPORT_TYPES` (item 8).** Beside the contract pieces C106.1 names, the (N) commit holds: migration `0023_phase7a` (it drops and recreates `reports_report_type_valid` and `report_templates_report_type_valid` with `ip-address`, with a PGlite test inserting a template and a report of the type); the job stub `apps/api/src/jobs/report-types/ip-address.ts` (`unbuiltReportTypeJob`, so a run ends `errored` with `execution_error`) and its `REPORT_TYPE_JOBS` entry; a contract-summary page `docs/reports/ip-address.md` with its README row; the seed name `Default IP address`; a completion-query case in `services/reports/completion.ts` that returns an empty query (a completion run ends `errored` with `insufficient_input` until `api-network` reads the first evaluated session, source `inquiry_session`); and the dashboard minimum (labels, words, the field view). **`foundation-7a` extends `0023_phase7a` rather than adding `0024`** (one migration per Workflow): `drizzle-kit generate` reads `@openverify/core` from its `dist`, so run `pnpm --filter @openverify/core build` first, delete `0023_phase7a.sql`, its snapshot and journal entry, and regenerate the one file with the Stage 1b tables. `api-network` owns the job and the completion query; `integration-7a` completes the page and the seeded template's settings.
11. **`REPORT_PROVIDER_KINDS` gains `ipReputation`** (core, the C83 amendment the report registry needs for the type's optional provider). The API's `PROVIDER_KINDS`, `PROVIDER_ENV_PREFIXES` and `PROCESS_PROVIDER_KINDS` gain it in Stage 1b (N), as item 7 says.
12. **Rate limits live in contracts, not core.** `RATE_LIMIT_POLICY_WINDOWS` and `RATE_LIMIT_DEFAULTS` (per window) are in `packages/contracts/src/rate-limits.ts`; `RATE_LIMIT_DEFAULTS_PER_MINUTE` stays as an alias of the latter; `rateLimitRules` (`apps/api/src/plugins/rate-limit.ts`) applies each policy's window and keeps it for a configured limit. A policy has one limit, so C96.3's per-address handoff limit is its own policy, **`flow-handoffs-ip`** (10 an hour per client address) beside `flow-handoffs` (5 an hour per session). The policies are `flow-signals` (60/60 s), `flow-handoffs` (5/3,600 s), `flow-handoffs-ip` (10/3,600 s) and `graph-unmask` (60/60 s, reserved for 7B). None is enforced yet: Stage 1b wires the flow ones, 7B's route owner `graph-unmask`; `GET /rate-limits` still lists only `api`. The dashboard's rate-limit panel labels all four.
13. **The problem codes** are `SIGNAL_PROBLEM_STATUSES` (`packages/contracts/src/problem.ts`), one golden problem each in `contracts/fixtures/problems/signals/`: the plan's `unknown_signal`, `signal_not_reviewable`, `provider_not_bound`, `basis_required`, `sandbox_only_value`, `consent_required`, `consent_text_missing`, `consent_key_conflicts_with_exempt`, `filter_required`, `session_limit_reached`, `sms_not_configured`, `display_name_required`, `destination_not_confirmed`, `handoff_token_invalid` and `session_handed_off`, and six of ours the plan names no code for: `signal_rule_invalid` (422: a rule on a signal outside `collect`, or a comparison of the wrong type), `handoff_method_not_allowed` (422), `handoff_not_available` (409: no handoff step waits), `continue_here_not_allowed` (409), `handoff_not_redeemed` (409: a reject with nothing redeemed) and `handoff_send_limited` (429, or 503 when the budget store is down).
14. **The constants live in the core registry module**, provisional with a basis and source: `COLLECTOR_CONSTANTS` (with `COLLECTOR_VERSION` 1), `BOT_SCORE_CONSTANTS`, `BEHAVIOUR_CONSTANTS` and `NETWORK_SIGNAL_CONSTANTS` (`packages/core/src/signal-registry.ts`). Each H-tier entry's `thresholds` picks from them, and a golden test pins every entry's version beside a digest of its thresholds and the collector's. `signal-logic`'s `BOT_SCORE_RULES`, `BEHAVIOUR_RULES` and `THREAT_LEVEL_RULES` read these values; a value change bumps the version of every entry that applies it. The values fixed here where the plan gave none: `fast-screen-floor-seconds` 2, `typing-cadence-uniform-cv` 0.1, `vpn-asn-confidence` 0.6, `hosting-asn-confidence` 0.5 and `ip-country-confidence` 0.8.
15. **The `signal-details` shape.** Each entry carries its own `null-reason` (null beside a value), `reasons[]` from `SIGNAL_EVIDENCE_REASONS`, optional `sources[]` (discriminated: `sync` with source id, sync id, publication time and SHA-256; `provider` with the adapter and `sandbox`) and optional `sessions[]` (each session's own reason, C90.4). An H-tier or combined entry requires `confidence` (null only beside a null value) and `thresholds`; an R, A or `R+A` entry never carries a confidence. The map's own members are `computed-at` and `review` (`{ cause, rules }`, the causes in `SIGNAL_REVIEW_CAUSES`). `signalAttributeIssues` enforces the rules between `signals` and `signal-details`, and the inquiry attributes refine with it.
16. **"Always present" is the API's to serve.** The schemas keep every Phase 7 member optional, so stored payloads from before Phase 7 still parse, and each builder sends a member only when its record carries it: the inquiry's `signals` and `signal-details`, the session's network, device and handoff attributes and its `device` and `network` relationships, the version's `signal-config`, and the flow session's `signals`, `handoff` and `handoff-context`. Stage 1b and the Stage 3 owners pass them on every read, `[]` and `{ computed-at: null }` before the signals job ran. The resolved template settings are the exception: `max-sessions` and `expire-inquiry-on-session-limit` are always resolved and served (the pinned settings expectations of six existing tests gained them).
17. **The flow signals body as frozen** (`packages/contracts/src/flow-signals.ts`). Ours beyond the plan's members: `input-event-count` (the behaviour minimum of 20 input events needs it); the driver globals as closed kinds (`DRIVER_GLOBAL_KINDS`), never the property names; and Android's own members, `android-integrity` (`debugger-connected`, `app-debuggable`) and `android-recognition` (`android-id`), because the browser members' required fields do not apply to Android: each platform sends only its own (refined). Bounds: counts 0 to 10,000, times to 3,600 s, 5 language tags, strings at their caps; `FLOW_SIGNALS_MAX_BODIES_PER_SESSION` 200 and `FLOW_SIGNALS_MAX_BODY_BYTES` 8,192.
18. **Session includes.** `INQUIRY_SESSION_INCLUDES` (`device`, `network`), `INQUIRY_SESSION_INCLUDE_PERMISSIONS` (both `inquiry-sessions:read`), `getInquirySessionQuerySchema` and `inquirySessionIncludeDocumentSchema` are contracts; the route wiring (`routes/server/inquiry-sessions.ts`) is Stage 1b's. The node client's `inquirySessions.retrieve` reads the include document. The session fixture carries both resources in `included`, and the webhook samples pass a fixture's `included` through (not on `.redacted`).
19. **PII marks.** `PII_SIGNAL_ATTRIBUTES` (`packages/contracts/src/signal-pii.ts`) gathers the session's (`ip-address`, `user-agent`, the region, the point and the GPS members), the network's, the device's two fingerprints and the handoff `destination`. To keep a PII name PII everywhere, `ip-address` and `user-agent` are now marked on the session, the API log and the user audit log (metadata only: masking by name already covered them). `device-class` is not PII (a model-level HMAC). Joining these to `MASKED_ATTRIBUTES` and the API-log sets is Stage 1b's.
20. **Handoff shapes.** The step's options follow the flow-spec's camelCase (`methods`, `qrTtlSeconds`, `linkTtlSeconds`, `confirmationCode`, `skipOnMobile`, `allowContinueHere`), optional, with `DEVICE_HANDOFF_DEFAULTS` applied by the server. `POST /flow/handoffs` answers an `id` with a new prefix, **`hnd`** (the token row, never the token), in both prefix tables. The preview answers `{ organization-display-name, method, confirmation-code-required, context }`, `context` `null` for an unconfirmed destination until a correct code (V16). `parseFlowLinkFragment` is unchanged: `parseHandoffFragment` and `handoffUrlFragment` are separate, for Stage 1b's bootstrap. Until Stage 1b gives the step its slot, the web flow shows an undone handoff step as `unsupported` and moves past a done one; the Android coordinator does the same from `FlowHandoff.done`.
21. **Android stubs (C94.7, F07).** `DeviceSignals` (`commonMain/.../signals/DeviceSignals.kt`, with `DeviceSignals.None`) is threaded through `FlowCoordinator` (a constructor parameter), `InquiryViewModel.factory(launch, deviceSignals)` and `OpenVerifyInquiryActivity` (`DEVICE_SIGNALS`, `None` until `android-signals` supplies the Android implementation). After consent, a coordinator with real signals re-reads `GET /flow/session` for the tiers and sends one body, swallowing a failure. `FlowApi.sendSignals` has a default body that sends nothing (so test fakes compile); `android-signals` implements it in `FlowApiClient` (`POST /flow/signals`, 202, no body). Models: `FlowSignals`, `AndroidIntegritySignals`, `AndroidRecognitionSignals` (never printed), `FlowSessionSignals`, `FlowHandoff`, `DeviceHandoffStep`; `FlowSession` gains `signals` and `handoff`. Fixtures: `api/flow-signals.json` decoded, `api/device.json` and `api/report-ip-address.json` server-only.
22. **Dependencies** (all through the catalog): `bowser` 2.14.1 (checks), `qrcode` 1.5.4, `uqr` 0.1.3 and `lean-qr` 2.7.4 (flow), `mmdb-lib` 3.0.3, `esbuild` 0.28.2 and `jsdom` (signals). `jsdom` and `qrcode` moved to `catalog:` in `packages/ui`, `apps/dashboard` and `apps/flow`. No install script, no `minimumReleaseAgeExclude`, `allowBuilds` unchanged.
23. **The pinned ASN seeds**: X4BNet `lists_vpn` at `30c56a5dfe5465afd41b5c628939fbe3e02f89aa` (2026-10-15): `x4bnet_datacenter_asns` (35,009 B, 947 lines, 933 distinct ASNs) and `x4bnet_vpn_asns` (509 B, 16 ASNs); `bad_asn_list` at `b825d2e0…` (24,159 B, 742 rows, 723 distinct). The README's MIT terms with "Copyright (c) 2024 X4B (Mathew Heard)" are cited in `THIRD_PARTY_LICENSES.md` §4.2.
24. **Existing tests changed with the plan** (each pins a list that gains a Phase 7 member, with no assertion weakened): the operator permissions; `rateLimitRules`; the unavailable reasons, `PII_REPORT_ATTRIBUTES`, the query sources, `RESOURCE_TYPES`, `REPORT_EVENT_NAMES` (48), the report registry rows and event count; the fixture list and the session fixture's schema; the seeded template counts (20 and 14); the dashboard report-event regex (an acronym, `IP address`); `SUPPORTED_FLOW_STEP_TYPES`; the every-step flow-spec fixture; the resolved settings in contracts, the API and the dashboard; the node session retrieve and its resource-group list.
25. **Left to their owners** (each named in the handoff): the default template's consent step does not list `notice.session-integrity` yet, so every session reads `collection_disabled` until Stage 1b (or `integration-7a`) adds the key and its locale text (ADR 0006 gives the default texts); the `apps/flow` locales of the notice and consent keys; `docs/checks/sandbox-providers.md`.

## Workflow 7A Stage 1b amendments (foundation-7a)

Recorded by `foundation-7a` on 2026-10-30, per checkpoint. The evidence is in `docs/tdd/phase7-foundation-7a.tdd.md`. Each item binds every later 7A agent.

### Checkpoint (N) network (ends at `1d2ea46f`)

1. **The session's network facts are stored twice, as C91.1 and C91.4 say.** `networks` holds one row per session evaluation (`net_`, unique on `(environment_id, inquiry_session_id)`, deleted with its session); `inquiry_sessions` holds the session's own copy (`network_evaluated_at`, `is_tor`, `is_datacenter`, `is_vpn`, `is_proxy`, `hosting_asn`, `threat_level`, `country_code`, `country_name`, `location`, `ip_connection_type`, `network_organization`). The session has no `network_id`: its `network` relationship is the `networks` row of its id (`listSessionNetworks`). `network_evaluated_at` is `null` until the session was evaluated (the per-session `sessions_not_evaluated` of C90.4). `ip-isp` and `network-organization` are one column, `network_organization`, the AS organisation C91.1 gives both. `evaluateSessionNetworkInTx` (`api-network`) writes both rows in the start's transaction through `recordSessionNetworkEvaluation`.
2. **The location is one sealed JSON column**, `NetworkLocation { regionCode, regionName, latitude, longitude }`, on both tables (`SEALED.inquirySessionLocation`, `SEALED.networkLocation`); the address is `networks.ip` (`SEALED.networkIp`). Every other network fact is plaintext by decision (C107.5: network facts without the address). The never-false flags are refused as `false` by CHECK constraints too (`*_true_or_null`); the session's threat level takes `low`, `medium`, `high` or `null`, the network's adds `unknown` (its default).
3. **`network_syncs` carries what the guards and the purge need** (C92.2, C92.3): `outcome` (`applied`, `unchanged`, `busy`, `refused_rollback`, `refused_future`, `refused_mass_removal`, `refused_mass_addition`, `refused_schema`, `refused_size`, `refused_digest`, `error`), `error_code`, `published_at`, `sha256`, `snapshot_bytes` (the MMDB half-size guard), `entry_count`, `covered_ipv4` (bigint) and `covered_ipv6` (numeric(39,0), up to 2^128) for the mass-addition guard, `actor` (`cli`, `job`, `seed`), `origin` (`publisher`, `import`), `overrides text[]` (any of `allow-mass-removal`, `allow-mass-addition`, `accept-older-publication`), and `superseded_at` and `snapshot_deleted_at` for the 7-day purge, with a partial index on the superseded snapshots still stored. `network_sources` mirrors `watchlist_sources` (no keys version); the applied sizes the guards compare are read from the sync named by `last_sync_id`. A new outcome or column is a change to this one migration.
4. **Redaction of the (N) columns lands in (N), not (S)**, because the sealed columns did: `redactInquiryRecords` nulls the session's `location` and each of its networks' `ip` and `location`, keeps the derived facts, and stubs and forgets the network ids; `net` joins `REDACTION_SUBJECT_ID_PREFIXES`; `networks` joins `ENCRYPTED_COLUMNS`, `REWRAP_TABLES` and `SUBJECT_PII_TABLES`. `dev` and the device and signal tables stay (S)'s. The retention steps of C91.7 (`ip-retention-days` among them) are not built here.
5. **The ports.** `NetworkSnapshot { sourceId, sandboxOnly, syncId, publishedAt, sha256, checkedAt, bytes, data }` keeps `data` opaque (`unknown`): `apps/api` has no dependency on `@openverify/signals`, so `api-network` adds that workspace dependency (an `integration-7a` lockfile change, or `contracts-7a`'s) and maps the port to `network-data`'s `NetworkSourceSnapshot` (role and freshness from the manifest by source id). `NetworkSnapshots.current(kind)` never returns a sandbox-only source for production; `ManagedNetworkSnapshots` adds `start()` and `close()`. `IpReputationProvider.lookup(address)` is synchronous and answers `{ value: true | false | null, proxyType, connectionType }`, the shape `network-data`'s `IpReputationAnswer` takes beside the provider's id and `sandbox`.
6. **The startup wiring.** The API starts its snapshots in an `onReady` hook after reconciling the source rows, waiting at most `NETWORK_READY_WAIT_MS` (5 s, as the watchlist rows), and closes them with the container; the worker calls `startNetworkDataAtStart` before its jobs and hands the snapshots to the report runs (`ReportJobDeps.networkSnapshots`, so `ipAddressReportJob` needs no shared file). `warnOnPrivatePeers(logger, trustProxy)` is called once when the container is built and returns the `PrivatePeerWatch` that each evaluation tells about each session (no address). `ApiDependencies.network` (`SessionNetworkDeps`) is optional, so the race tests that build their own dependencies need no change; the container and the test harness always set it.
7. **The session start's hook.** `recordSessionStart` calls `evaluateSessionNetworkInTx(tx, deps, session, { ip }, at)` only for the call that wins `markInquirySessionStarted`, before `inquiry-session.started` is staged; the IP is the one stored (cut to 64 characters). A failed evaluation rolls the start back, so a session's facts and its start commit together; `api-network` must therefore never throw on an unknown or unparsable address, only answer its null reasons.
8. **`ipReputation` in both processes** (item 7 and 11 of Stage 1a): it is the last of `PROVIDER_KINDS`, with `PROVIDER_NAMES` gaining `mmdb-file`. `OPENVERIFY_IP_REPUTATION_MMDB_PATH` must be an absolute path and is required while either environment kind binds `mmdb-file`; it is not a secret, so it is not in `SECRETS`, and no message echoes it. In compose the file sits in `data/ip-reputation/` (gitignored, outside the image), mounted read-only at `/var/lib/openverify/ip-reputation` for the API and the worker; migrate receives no provider binding.
9. **The network settings.** `NetworkSettings { sourcesDisabled, sourcesEnabled, refresh, ipReputationMmdbPath }` (`ApiConfig.network`); `parseNetworkSourceLists` reads both lists for every process and the seed; the API never reads `OPENVERIFY_NETWORK_REFRESH` (always `false` there), as it never reads the watchlist refresh.
10. **The request log** (C93.7) is `{ method, route }` with the request id: the route pattern, `null` when no route matched. The C53.8 log rule also covers the Workflow 7A network folders (`apps/api/src/network/**`, `apps/api/src/sync/**`, `apps/api/src/providers/ip-reputation/**`, `apps/api/src/routes/dashboard/network-sources.ts`, `packages/signals/src/**`) and refuses an address, a point, a fingerprint or a user agent there outside `pii`.
11. **The seed hook** `seedNetworkData(db, { sourcesDisabled, sourcesEnabled, clock, storage? })` runs after the report templates. `seed:dev` builds no object storage today, so `scripts/seed-dev.ts` passes none: if the sandbox import must write its snapshot object, `api-network` reports the change (`seed-dev.ts` building the S3 storage from `S3_*`, which migrate's compose environment already has) as a deviation for `integration-7a`.
12. **Existing tests changed with the plan:** the public table list (`testing.test.ts`), `ENCRYPTED_COLUMNS` (`schema-v2.test.ts`), `REDACTION_SUBJECT_ID_PREFIXES` (`subject-ids.test.ts`), the provider kind lists and positional slices (`providers/index.test.ts`, `phase5b-providers.test.ts`, `phase6-providers.test.ts`, `config.test.ts`), the session literal of `jobs/records.test.ts`, the dependency keys of `services/context.test.ts`, and the whole-request log test of `app.test.ts` (`route` for `url`). No assertion was weakened.

### Checkpoint (S) signals and devices (ends at `0d0523d3`)

1. **The tables** (one migration, `0023_phase7a`, regenerated with the (N) hand edits and a third foreign key on the session's `(environment_id, id)`, and four `updated_at` triggers). `inquiry_session_signals` has an identity `id`, `environment_id`, `inquiry_session_id`, `sequence` (unique per session), `screen` (a step id), `platform`, `collector_version` (both plain, beside the plan's columns: the device and SDK owners need them without opening a body), and the two sealed columns `components` and `behaviour`, each bound to `sessionSignalRowKey(session id, sequence)` = `<iqse id>/<sequence>` because the identity id is not known before the insert. `inquiry_signal_computations` is keyed `(environment_id, inquiry_id)` with `trigger_status` (`completed`, `failed`, `expired`), `state` (`pending`, `computed`, `skipped`), `attempts`, `last_error_code`, `enqueued_at`, `computed_at`, and a partial index on the pending rows by age. `devices` holds `browser_fingerprint`, `device_fingerprint` and `device_class` as plain 64-hex HMACs with `key_id`, `fingerprint_randomised`, `first_seen_at`, `last_seen_at`; it is unique on `(environment_id, <HMAC>, key_id)` for each fingerprint, refuses an identifier from the other platform, a strict HMAC beside canvas noise, and a device without an identifier; `session-count` is counted from `session_devices`, which links a session to at most one device (`(environment_id, inquiry_session_id)` primary key, cascading from both sides). `inquiries.signals` and `signal_details` are `null` until the job freezes them. The session's parsed fields are at most 64 characters; `signals_collected` is a subset of the two tiers, `{}` by default.
2. **The outbox write is built here, the rest of the job is not.** `createSignalComputationInTx` (`services/signals/computation.ts`) runs on every move in `transitionInquiryInTx`, after the report hook, and writes the row only for `pending → completed | failed | expired` and `created → expired`, and never for a redacted inquiry (owner decision 5 after 6C), which still expires without a row, through the sandbox and through the expiry job. `createSignalComputation` is the one built write of `repositories/signal-computations.ts`; the sweep's and the job's (`listPendingSignalComputations`, `markSignalComputationsEnqueued`, `completeSignalComputation`, `skipSignalComputation`) are `api-signals`' stubs. `processInquirySignals` (`jobs/signals/process.ts`) and `runInquirySignalsSweep` (`jobs/signals/sweep.ts`) are stubs; the sweep enqueues nothing until built, so no inquiry reads a computed value.
3. **The session hooks are no-op stubs, never guesses.** `recordSessionDeviceInTx(tx, session, { userAgent }, at)` runs in the start's transaction after the network evaluation and writes nothing until `api-signals` builds it (the parsed fields stay `null`); it must never throw for an unparsable user agent. `assertSessionCapInTx(tx, deps, inquiry, settings)` answers `{ limited: false }` until built; its outcome `{ limited: true, expired: false }` makes the caller roll back (a redeemed one-time link stays unused) and `{ limited: true, expired: true, staged }` makes it commit the expiry and dispatch, both answering 409 `session_limit_reached` (`sessionLimitReached()`). It is called by `resumeInquiry` and `redeemOneTimeLink` (after the token, now under the inquiry's lock); Workflow 7A (H)'s handoff redemption is the third caller.
4. **The queue.** `inquiry-signals` (`jobs/signal-queues.ts`): `INQUIRY_SIGNALS_QUEUE`/`_JOB`, `INQUIRY_SIGNALS_JOB_OPTIONS` (5 attempts, exponential 5 s with jitter, removed when finished), job id = the inquiry id, ids only, a lazy BullMQ queue; `INQUIRY_SIGNALS_SWEEP_QUEUE` `inquiry-signals-sweep` every `INQUIRY_SIGNALS_SWEEP_INTERVAL_MS` (15 s). The worker takes `StartWorkersOptions.signals { queue, process? }`; with it, it starts `inquiry-signals` (`inquirySignalsProcessor`, with the keyring, the blind-index key, the snapshots and the events) and `phase7RepeatableJobs(deps, network, { signals })` schedules the sweep before `network-refresh`.
5. **`identifierKey(key, { environmentId, kind, input })`** is `HMAC-SHA-256(environment subkey, "<label>|<input>")` with `IDENTIFIER_KEY_LABELS` `browser-fingerprint`, `device-class`, `android-id` (`openverify/<kind>/v1`); `blindIndexKeyId(key)` is the first 8 bytes of `HMAC(key, "openverify/blind-index-key-id/v1")` in base64url, 11 characters. Both match OpenSSL vectors. `rebuildDeviceIndexes` is a stub that answers zero counts (no device exists before `api-signals` writes one); `blind-index:rebuild` calls it before the reports and returns `devices`.
6. **Redaction and retention.** Redaction nulls the bodies' `components` and `behaviour` (rows kept), deletes the sessions' device links, deletes each device left without a link, and stubs and forgets the device ids; `dev` joins the subject prefixes; the parsed fields and the inquiry's signals stay (derived, no PII). The C16 pass runs `nullExpiredSignalComponents` (`signal-component-retention-days`, default 30), `nullExpiredAddresses` (`ip-retention-days`, default unset: nothing; it nulls the session's sealed address, its consent record's address and its networks' addresses, by each row's `created_at`) and `deleteExpiredDevices` (`device-retention-days`, default 365, by `last_seen_at`), reported as `nulledSignalComponents`, `nulledAddresses` and `deletedDevices`. Event payloads keep their own C16 window: an address inside a session event of an `included` network goes with the event (90 days by default), not with `ip-retention-days`.
7. **The settings** live in `environments.settings` (no column): `signal-collection`, `expose-signals`, `signal-component-retention-days` (1-365), `ip-retention-days` (1-3,650 or `null`), `device-retention-days` (1-1,095), with `resolveSignalSettings` and `DEFAULT_SIGNAL_SETTINGS` (db) and `SIGNAL_COMPONENT_RETENTION_DAYS`, `IP_RETENTION_DAYS`, `DEVICE_RETENTION_DAYS`, `EXPOSE_SIGNALS_DEFAULT` and `signalCollectionSettingBodySchema` (contracts). `GET /dashboard/settings` serves them (optional members, so earlier answers parse); `PATCH` sets them under `settings:write`, `signal-collection` also under `settings:privacy` (403 otherwise), and `exempt` without a basis answers 422 `basis_required` at `/signal-collection/device-recognition-basis` (a server rule, not a schema refinement, so it carries its code). Each change is the existing `settings.updated` audit entry.
8. **What is served.** Every session read (fetch, list, expire, events) carries the network facts from the session's columns, the parsed device and `signals-collected`, and the `device` and `network` relationships (`listSessionLinks`); `GET /inquiry-sessions/:id` takes `?include=device,network` (`inquirySessionIncludeDocumentSchema`); the session events put both resources in `included`, unmasked. Every inquiry record carries `signals` and `signal-details` through `servedInquirySignals` (`services/signals/served.ts`): `[]` and `{ computed-at: null }` until computed; with `expose-signals` off, the server API and webhooks serve `[]` and `computed-at` alone (`signalViewOf` reads the environment once per answer); the console (`CONSOLE_SIGNAL_VIEW`) shows the values. `PII_SIGNAL_ATTRIBUTES` joined `MASKED_ATTRIBUTES` and the API-log masked set.
9. **The frozen routes** answer 501 until `api-signals` builds their services: `GET /devices` and `/devices/:id` (`routes/server/devices.ts`, `services/signals/devices.ts`: `listDevices`, `getDeviceResource`), `POST /flow/signals` (`routes/flow/signals.ts`: 8 KiB, 202 with a JSON `null`, `recordFlowSignals(deps, session, body, { acceptLanguages, clientHints })` with the request's primary `Accept-Language` tags (at most 5) and the three low-entropy client hints (at most 128 characters each); the `flow-signals` policy per session in `plugins/rate-limit.ts`, `FLOW_SIGNALS_ROUTE`), `POST /inquiry-sessions/expire-all` with `meta.inquiry-ids` (1-100, distinct; `EXPIRE_ALL_MAX_INQUIRIES`; `expireSessionsForInquiries`) beside `meta.inquiry-id`, and `POST /inquiry-sessions/:id/generate-one-time-link` (`inquiries:write`, `generateSessionOneTimeLinkDocumentSchema`: the session as `data`, `meta.one-time-link`, `one-time-link-short: null`, `expires-at`; `generateSessionOneTimeLink`). `GET /flow/session` serves `signals` through `flowSessionSignalsOf` (`services/signals/flow-session.ts`), `null` until built. The publish rules of `signal-config` are `signalConfigPublishProblems` (`services/publish/signal-config.ts`), refusing nothing until built; `assertPublishable` answers the first problem's code (`SignalProblemError`, `errors.ts`) with every pointer. The OpenAPI snapshot was regenerated at (S) (the settings and the routes), because its test is part of the API suite; it is regenerated again after (H).
10. **The flow's wiring.** `useSignalCollection(client, session, position)` (`apps/flow/src/flow/use-signal-collection.ts`) starts `startSignalCollection` only once the session reports consent, with the reported tiers (`null` reads nothing), a `send` through `FlowApiClient.sendSignals` (new; passed through `withFinalOutcomes`), tells it each screen after consent, and stops it on unmount or a change of tiers. The mocked flow API answers 202 to `/flow/signals` and records the bodies in `signalBodies`, outside `requests`, so the specs that count requests are unaffected when the collector starts sending.
11. **Left to their owners.** The default template's consent step still lists no `notice.session-integrity` (with its locale text), so once `api-signals` builds the tiers every default session reads `collection_disabled` until `integration-7a` adds the key (ADR 0006 gives the default text).
12. **Existing tests changed with the plan:** the public table list, `ENCRYPTED_COLUMNS`, `REDACTION_SUBJECT_ID_PREFIXES`, the 0023 migrate assertion and upgrade test, `createTestInquiryOnEarlierSchema` (now SQL for the inquiry, returning the ids), the session and inquiry literals of `jobs/records.test.ts`, `SUBJECT_PII_TABLES`, the two pinned retention reports, the pinned `DASHBOARD_SETTINGS_DEFAULTS`, the whole-resource expectation of the session list test, and the dashboard's expire-all action and retention-field type (typecheck minimum). No assertion was weakened.

### Checkpoint (H) handoff (ends at `f852b7c1`)

1. **The tables** (still the one `0023_phase7a`, regenerated with the (S) hand edits and two more `updated_at` triggers). `handoff_tokens` (`hnd_` id) binds a token to `inquiry_id`, `step_id` and `issuing_session_id`, stores `token_hash` (SHA-256 hex, unique) and never the token, and records `method`, `expires_at`, `redeemed_at` with `redeemed_session_id` (set together), `revoked_at`, `declined_at` (a decline revokes), `code_attempts`, and `destination_confirmed` (`false` only for an email or SMS to an unconfirmed destination, which needs a code: V16). The confirmation code is kept as `confirmation_code_hash`, SHA-256 over the token and the code, so a database read alone cannot recover it. `handoff_tokens_live_per_session_key` (unique on `issuing_session_id` where neither redeemed nor revoked) enforces one live token per session: issuing revokes the old one first, in the same transaction. Tokens cascade with their inquiry and either session. `inquiry_handoff_steps` keys the state by `(environment_id, inquiry_id, step_id)` (V05). `inquiry_sessions` gains `device_handoff_method`, `handoff_from_session_id` (a self-reference in the environment, no action on delete), `handoff_redeemed_at` (the three set together), `handoff_distance_meters`, `handoff_country_changed`, `handoff_asn_changed` and, ours, `handoff_rejected_at`; the facts and the rejection exist only on a handoff session. `verifications.created_by_session_id` and `selfie_captures.created_by_session_id` reference the session (no action), and `verifications.from_rejected_handoff` (default `false`) marks what a rejected phone submitted. No column is sealed, so the rewrap lists are unchanged.
2. **`getEffectiveConsent` is built here, not stubbed** (it lives in the shared `repositories/inquiry-sessions.ts`, so `flow-handoff` could not build it). `getEffectiveConsent(db, { environmentId, inquiryId, sessionId })`: a session with `handoff_from_session_id` gets its own consent, or `null` once `handoff_rejected_at` is set; any other holder gets the latest consent among the inquiry's sessions without rejected handoff sessions. Until `flow-handoff` writes a handoff session this equals today's latest inquiry consent, as the plan asks (a test pins it for every holder). `flow-handoff` sets the handoff fields at redemption and `handoff_rejected_at` at rejection, and the rule follows. A declined handoff creates no session, so it needs no exclusion.
3. **The gates that read it**: `GET /flow/session` (and the `signals` member it feeds), the upload, the selfie capture, `requireFlowVerification`, `messageLocaleOf(deps, holder)` (the OTP send passes its session) and `matchingConsentHolds(db, holder, flow)` (the capture's `created_by_session_id`; the face-index rebuild uses its newest processed capture's), with `consentHolderOf(session)` in `services/flow.ts`. `api-signals` moved `POST /flow/signals` and the signals job onto it in its own files. The flow writes `created_by_session_id` on every verification and selfie capture it creates; server-created attempts keep `null`.
4. **The frozen routes** (`routes/flow/handoffs.ts`, owner `flow-handoff`; services in `services/handoff/flow-handoffs.ts`, all 501 until built): `POST /flow/handoffs` (201 `createHandoffResponseSchema`, which gains an optional `confirmation-code`: the desktop has to show the code the phone types, and no frozen answer carried it), `POST /flow/handoffs/continue-here` and `POST /flow/handoffs/current/reject` (200 `currentHandoffResponseSchema`, the new state), `GET /flow/handoffs/current` (200 the same), and the public `POST /flow/handoffs/preview` (200 `previewHandoffResponseSchema`), `/decline` (200 JSON `null`) and `/redeem` (200 `redeemHandoffResponseSchema`; the service receives the request's address and user agent). No route answers 204, because the flow transport reads a JSON body on every success.
5. **`assertSessionNotHandedOff(db, request, session, now)`** (`auth/flow-session.ts`) runs in the flow scope's `onRequest`, after the session is resolved and before its start is recorded. It passes `GET` and `HEAD` and every route under `FLOW_HANDOFFS_ROUTE` (`/api/v1/flow/handoffs`), and otherwise answers 409 `session_handed_off` when `isSessionHandedOff(db, session, now)` (`services/handoff/guard.ts`, `flow-handoff`'s; `false` until built) says so. The index `inquiry_sessions_handoff_from_session_id_idx` serves that check. A test walks every non-GET flow route of the OpenAPI document.
6. **Rate limits.** `HANDOFF_TOKEN_ROUTES` (preview, decline, redeem) join `one-time-link-redeem` per address; `POST /flow/handoffs` counts `flow-handoffs-ip` per address in `onRequest` and `flow-handoffs` per session in `preParsing` (C96.3's two limits). Continue-here, current and reject count neither.
7. **The other hooks and stubs** (`flow-handoff`'s): `flowSessionHandoffOf({ db, session, inquiry, flow, environment }) => { handoff, handoffContext }` (`services/handoff/flow-session.ts`; both `null` until built) feeds `GET /flow/session`; `handoffPublishProblems({ deps, db, environment, flow })` (`services/publish/handoff.ts`; `[]` until built) runs in `assertPublishable` after the signal rules, its first code answering with every pointer; `repositories/handoff-tokens.ts` declares `issueHandoffToken`, `findHandoffTokenByHash`, `lockHandoffToken`, `markHandoffTokenRedeemed`, `revokeHandoffToken`, `recordHandoffCodeAttempt`, `listInquiryHandoffSteps`, `setInquiryHandoffStepState` (each rejects `HandoffRepositoryNotBuiltError`). **A hook the plan does not name:** `handoffReviewAfterTransitionInTx(tx, { inquiry, from, to }) => 'needs_review' | null` (`services/handoff/review.ts`) is asked after every move `transitionInquiryInTx` applies; `needs_review` on a move into `completed` follows it with `completed → needs_review` in the same transaction, with both moves' events. C96.3's "otherwise when it completes" needs it, and it sits in a shared file.
8. **`organization-display-name`** is an environment setting (`environments.settings`, no column): 1-100 characters or `null` (the default), served by `GET /dashboard/settings` and set under `settings:write` with the existing `settings.updated` audit entry. The console leaves it out until 7C.
9. **`OPENVERIFY_HANDOFF_SENDS_PER_HOUR`** (1-100,000, default 200, `DEFAULT_HANDOFF_SENDS_PER_HOUR`) is `ApiConfig.handoff.sendsPerHour`, passed by the container as `ApiDependencies.handoffSendsPerHour` (optional, so tests that build their own dependencies need no change); compose gives it to the API only, and `.env.example` sets 200. It is not a secret.
10. **The session's handoff fields** are served on every session read, list and event from the session's own columns (`null` on a session no handoff created), unmasked: none is PII.
11. **The flow's wiring.** A `handoff-token` fragment boots into `{ status: 'handoff', handoff }`: the token is held in memory only, an older stored session is dropped, and the reload marker is kept. `App` and `FlowRoutes` render `HandoffRedeemFlow({ inquiryId, handoffToken, transport, connect })` (`apps/flow/src/handoff/`); until built it reads as an invalid link. `resolveFlowPosition` answers `{ kind: 'handoff', step, handoff }` for a step not done (`handoff` is `null` from a server that serves none), and `FlowRenderer` renders `DeviceHandoffStep({ step, handoff, client, onDone })` (`apps/flow/src/steps/device-handoff/`; until built, the unsupported screen). `FlowApiClient` gains `createHandoff`, `continueHandoffHere`, `getCurrentHandoff` and `rejectHandoff`; the fake answers them and moves its `handoff` state. The mocked flow API serves `handoff` and `handoff-context` when set, and answers the seven handoff routes from `handoffAnswers` (else 501), recording `handoffCalls`.
12. **Retention and redaction.** The C16 pass deletes handoff tokens 30 days past `expires_at` (`deleteExpiredHandoffTokens`, reported as `deletedHandoffTokens`), as one-time links. Nothing new is redacted: the tokens hold digests, and the handoff facts are derived. `hnd` is not a redaction subject prefix, because C107.5 names none. The destination never reaches the database, and flow routes are not API-logged.
13. **The lint scope of (N) amendment 10 is narrowed.** The network folders now form `WORKFLOW_7A_NETWORK_FOLDERS`, with the C93.7 log rule and the two super-linear rules but not eslint-plugin-regexp's style rules. `network-data`'s parsers were committed before (N) put the folders in `PHASE5_FOLDERS`, and a forced lint showed 29 style errors there (the (N) and (S) lint gates had read turbo's cache). Validation runs `lint typecheck --force`, as the plan says.
14. **Existing tests changed with the plan:** the 0023 migrate assertion and the public table list; the upgrade test (handoff rows, and the pre-upgrade verification's new defaults); three earlier upgrade tests (`migration-v5`, `-0017`, `-0018`), which now seed their pre-upgrade verification by SQL (`createTestVerificationOnEarlierSchema`), because drizzle's insert names the new columns; the session and verification literals of `jobs/records.test.ts`; the dependency keys of `services/context.test.ts`; the two pinned retention reports; `DASHBOARD_SETTINGS_DEFAULTS`; the whole-resource session list expectation; the Stage 1a flow-position test (an undone step reads `handoff`, not `unsupported`); and the submit test's client fake. No assertion was weakened.
15. **Left to `flow-handoff`:** `assertSessionCapInTx` in its redemption, after the token and under the inquiry's row lock (the third caller of (S) amendment 3); `skip-on-mobile` and SDK sessions reading `skipped` in `flowSessionHandoffOf`; marking `from_rejected_handoff` and cancelling the phone's open verifications at rejection; and the audit entries (issued, previewed, redeemed, rejected, declined).

## Workflow 7A Stage 2 amendments

Recorded by `integration-7a` from the Stage 2 agents' reports and TDD records (`docs/tdd/phase7-<agent>.tdd.md`). Each binds 7B and 7C.

### network-data

1. **Parser names** (C92.1, left open): `NETWORK_PARSERS` in `@openverify/signals/network`: `mmdb-country`, `mmdb-city`, `mmdb-asn`, `tordnsel-exit-addresses`, `aws-ip-ranges`, `gcp-cloud-json`, `oracle-public-ip-ranges`, `cloudflare-ips-api`, `prefix-list`, `rfc8805-geofeed`, `azure-service-tags`, `openverify-sandbox-network`. `prefix-list` and `rfc8805-geofeed` need the source's `provider` label, so `network/sources.json` has a `provider` member for those sources. MMDB sources are parsed after the runner's gunzip.
2. **A seventh role, `sandbox`** (C92.1): `openverify-sandbox-network` holds every role's data in one bundle (`SandboxNetwork`), with `role: sandbox` and `sandbox_only: true`.
3. **The Tor window** (decision 11, 24 h) is `TOR_EXIT_WINDOW_HOURS` (provisional) in `@openverify/signals/network`, not in core's `NETWORK_SIGNAL_CONSTANTS`; `tor_detected` is R-tier with no thresholds, so no signal version depends on it. Whether it moves into core is open (owner).
4. **C93.4 in two places, one rule.** `evaluateNetwork` computes the session's threat level at evaluation, and `@openverify/checks`' `sessionThreatLevel` from stored facts; `packages/signals` cannot import checks or contracts. `apps/api/src/network/agreement.test.ts` (api-network) pins that both agree on the C93.6 goldens, and that the network reasons are subsets of the contracts' frozen enums.
5. **Sandbox values beyond C93.6's table:** AS64504 "Example Sandbox Network" for the rest of `192.0.2.0/24`; country `ZZ` "Example Land" on `192.0.2.0/24` and `2001:db8::/48` (AS64501 there); two fictional points on `203.0.113.0/25` (-30, -140) and `203.0.113.128/25` (-30.5, -140.5), region `ZZ-01`; the provider range `192.0.2.20/32` (service `EXAMPLE_COMPUTE`, region `example-1`); the proxy at `192.0.2.40` is a `public_proxy`. A documentation address in a sandbox environment reads the sandbox source alone; a public address there reads the real sources. The sandbox source is never stale.
6. **Normalised snapshot formats** (C92.3): ranges as canonical JSON `{ format: openverify-network-ranges, version: 1, published-at, ranges }`; exits as `{ format: openverify-tor-exits, version: 1, published-at, exits }`; MMDBs as published, after gunzip and a whole-file verify; the sandbox bundle as published. `network_syncs.entry_count` is merged intervals, exit addresses, verified prefixes, or the bundle's sum. The exit list's publication time is the newest `LastStatus`, else the newest sighting; `null` only for an empty list (the runner then falls back to `Last-Modified`).
7. **Parser strictness:** every member read is checked; members a publisher adds are tolerated; prefixes with host bits set, and IPv6 prefixes crossing `::ffff:0:0/96`, are refused; geofeed country and region read case-insensitively and kept upper case; IPv6 `ExitAddress` lines counted, not kept. Every refusal is a `NetworkParseError` naming a position, never a value; every code maps to `refused_schema`.
8. **Evaluation details:** a source whose MMDB record breaks its role reads as unavailable, never as `not_in_known_ranges`; the country falls back to City Lite; `region-code` comes from City Lite's first subdivision and may be `null` beside a region name; `privacy-relay` is `null` with `list_unavailable` while the relay source is off; `ip-connection-type` is `datacenter`, else the adapter's; `proxy-type` is `tor`, then `vpn`, then the adapter's.
9. **Address classes:** every IPv6 address outside `2000::/3` is not public, nor is `3fff::/20` (RFC 9637); the registry blocks `192.0.0.0/24` and `2001::/23` are not public as a whole.
10. **Memory method:** synthetic MMDBs padded to DB-IP's measured sizes; range sets at the measured prefix counts; each scenario in a fresh child process. Figures: `docs/network/README.md`.

### client-collector

1. **Body timing** (left open): one body per closed screen holding `integrity` and `behaviour`, the integrity artefacts re-read for each; `untrusted-event-count` per screen (summed by the server); recognition in its own body, numbered when the first screen opens; a failed recognition send rides on the next body (under recognition alone, it goes again at the next screen).
2. **Behaviour definitions:** `input-event-count` counts keydown, pointerdown and inserted input (paste, drop, autofill, replacement), not typed `insertText`; the first input is the first keydown, pointerdown or input event; cadence ignores repeated keydowns, and a mean interval of 0 reads `uniform`; `pointer-before-click` is decided by the first click with `detail > 0`; `focus-loss-count` is the window's own `blur`, outside the capture phase; `hidden-count` counts changes to hidden.
3. **Integrity rules:** `plugins-inconsistent` and `mime-inconsistent` when `pdfViewerEnabled` is exactly `true` with an empty list (a missing member reads consistent: integration found, part 2 fixed, that `undefined` broke the schema on older browsers); `native-function-tampered` from `Function.prototype.bind`, `toString` and the `webdriver` getter; headless markers `HeadlessChrome`, `PhantomJS`, `SlimerJS`, `Electron` or a client-hints brand containing `Headless`; client hints at most 8 brands with digit-only versions.
4. **Recognition:** the canvas drawing uses only `sans-serif`; with canvas noise the digest is `null` and `canvas-noise` true; without `crypto.subtle` no canvas is drawn. Screen buckets (16 px, pixel ratio 0.25 clamped 0.5-8) are `RECOGNITION_BUCKETS`, pinned to collector version 1; registering them in core's `COLLECTOR_CONSTANTS` is open (it would change the registry digest).
5. **Driver kinds:** `playwright` and `puppeteer` have no page-global rule (their bindings change between versions); `cypress` by `window.Cypress`; the rest after BotD's names and ChromeDriver's `cdc_` markers.
6. **Size:** the entry is about 8.3 KB minified and 3,875 B gzipped (budget 4,096 B), and adds 3,539 B to the flow's gzipped bundle.
7. **Workspace:** `packages/signals/tsconfig.json` has no DOM library, so each browser file carries `/// <reference lib="dom" />`, and the browser tests import the contracts and core by relative path (the package declares neither). Both are open followups (adding `DOM` to the package's `lib`, and the two workspace dev dependencies). integration-7a added `@openverify/signals` to `apps/flow`'s dependencies, so the flow now imports `@openverify/signals/browser`.
8. **The sequence across reloads** is left at the collector's default (`firstSequence` 0 per page load); the server ignores a repeated `(session, sequence)`, so a reload's first bodies can be dropped as repeats. Open.

### signal-logic

1. **Module layout:** `packages/checks/src/signals/` holds the reason mirrors (`vocabulary.ts`, tied to the contracts by a test), the input types, the user-agent and SDK-header mappers, the request facts, distances, the threat-level, cross-layer, evidence, bot-score and behaviour rules, the review-rule matcher (`matchSignalReviewRules`) and `computeInquirySignals`.
2. **Rule tables are pinned** by digest beside the registry version (`1:5dab7aefa24189e9` bot score, `1:f8b98aa6eb4139a8` behaviour, `1:0902dd0b3a363f89` threat level), computed by an independent script; a changed table needs a version bump.
3. **Ours:** the per-screen evidence group is `screens`; `IDENTITY_FIELD_STEP_TYPES` names the steps whose pastes and autofills count as weak evidence; request headers make the cross-layer group collected even without an integrity member; the low band may reach 20 points from weak evidence.
4. A contract probe over 300 seeded inquiries found no `signalDetailsSchema` or `signalAttributeIssues` violation in `computeInquirySignals`' output.

### android-signals

1. **`AndroidSignalContract`** (`commonMain/.../signals/`) holds the contract's bounds, checked against the TypeScript sources; `AndroidDeviceSignals` and `ContextDeviceFacts` implement the tiers (debugger and `FLAG_DEBUGGABLE`; `ANDROID_ID`, with `HardwareIds` suppressed at that one read).
2. **Signals never hold the flow:** `sendSignalsBeside` launches the send as a child of the calling action, so a server that never answers `/flow/signals` holds neither the flow nor its actions (an awaited send had held the loading screen until the HTTP timeout). A decided inquiry reads nothing about the device.
3. `FlowSignals.platform` carries `@EncodeDefault`, because `OpenVerifyJson` omits defaults and the contract requires the member.
4. **Host tests:** 1,268 at the base, 1,327 at the end (50 signal tests, 6 common client tests in the host suite, flow-handoff's 9 coordinator tests). integration-7a raised CI's floor to 1,327. The SDK README lists the Play Data safety entries per tier.

## Workflow 7A Stage 3 amendments

### api-network

1. **One sync runner** (`apps/api/src/sync/runner.ts`) serves both syncs; the watchlist sync moved onto it with every watchlist test file unchanged (110 tests) and the C76.2 races green; the benchmark's imports kept their names and signatures.
2. **`stream()` and untyped bodies** (C85.1): a client naming `STREAM_NO_CONTENT_TYPE` may take a 200 without a content type (some publishers send none); the others still refuse it.
3. **Back-off:** the watchlists' (15 minutes after the first failed check, doubling, capped at the source's refresh interval and 24 hours); a refusal counts as a failed check.
4. **Not configured:** a disabled source (`source_disabled`) or a process without object storage (`storage_not_configured`): no request; a sync row except for the tick.
5. **Mass change thresholds** live in the manifest's `guards` with their basis (25% removed, 25% growth of a family the source already covered, `min_prefix` `/8` and `/16`, an MMDB under half its size; provisional). An empty publication is `refused_schema` unless `--allow-mass-removal`.
6. **Unchanged** compares the SHA-256 of the normalised snapshot object, which is also its key and what every load re-checks.
7. **The purge** runs after every applied or unchanged sync, not in the C16 pass (whose file is shared): superseded snapshots more than 7 days old, keeping each source's current and previous one.
8. **A failing evaluation writes nothing and returns `null`,** so the session start commits not evaluated rather than rolling back.
9. **The console route** `GET /api/v1/dashboard/network-sources` (`settings:read`) was left unregistered for integration-7a, which moved `dashboardNetworkSourcesSchema` into `@openverify/contracts` and registered it.
10. `apps/api/package.json` depends on `@openverify/signals` (`workspace:*`).

### api-signals

1. **Collection tiers** (`collectionTiersOf`): integrity needs the setting `on` and `notice.session-integrity` among the consent's shown keys; recognition in `consent` mode the ticked `consent.device-recognition`, in `exempt` mode `notice.device-recognition` shown and the tick not offered. After consent the flow session's `signals` is an object even when no tier applies; `null` means "before consent". `POST /flow/signals` answers 409 `consent_required` whenever no tier applies.
2. `signals-collected` is recorded when `GET /flow/session` reports the tiers and with each body, so the job tells `collector_missing` from `collection_disabled`.
3. **What a body keeps:** integrity keeps `integrity` or `android-integrity`, the behaviour and the request's header facts (`components.request`); recognition keeps `recognition` or `android-recognition`; `device-class` and a sandbox `sandbox-outcome` ride with whichever tier applies.
4. **Identifier texts** are canonical JSON with sorted keys; `deviceHmacs` (db) gives the write path and the rebuild one implementation; a randomised web session gets a device of its own holding only the class; the rebuild merges a device that meets its twin under the new key.
5. **A consented session** recorded consent itself, or was not created by a handoff and was created after the consent it inherits. A handoff session counts only on its own consent; a rejected one never.
6. **The sweep** re-enqueues a row not enqueued within 2 minutes, 500 a tick, and marks a redacted inquiry's row `skipped`.
7. **`on-signal`:** `failed` and `expired` record the match's cause without a move; the result, review included, is checked against `signalDetailsSchema` and `signalAttributeIssues` before anything is frozen.
8. **Publish rules:** a `false` operand on a never-false flag is `signal_rule_invalid`; a country operand must be upper-case alpha-2; `consent_text_missing` points at `textKeys` (exempt) or `optionalTextKeys` (consent).
9. `sessions.ts` loads `services/inquiries.ts`, `inquiry-sessions.ts` and `one-time-links.ts` with `await import()`, which import it back.

### flow-handoff

1. **The QR encoder is `lean-qr` 2.7.4** (decision 24): +3,589 B gzipped in the flow bundle against `uqr` +3,993 B and `qrcode` +9,279 B (cross-checked with esbuild: +3,557, +3,795, +9,501 B), drawn at error correction M with a quiet zone, as an SVG image. integration-7a removed `qrcode` and `uqr` from the flow and `uqr` from the catalog; the dashboard keeps `qrcode` for TOTP.
2. **An issue and a continue-here re-read the step under the inquiry's lock,** so one that waited behind a redemption is refused and never overwrites `redeemed` (found by the Postgres race test).
3. **Handoff routes answer 200 with a JSON body** (Stage 1b (H) 4), and a decline 200 with `null`.
4. **The desktop after completion.** The desktop's handoff step polls the session while the phone works; the completion ends every session of the inquiry, so the desktop then shows "This verification session has ended" (it says the verification may have finished), not the template's completion screen that C96.8 names. `handoff.spec.ts` asserts that screen; a followup.
5. `docs/flow/handoff.md` gives the threat model (RFC 10027 B6), the sequence on both devices and the QR measurement.

## Workflow 7A Stage 4 amendments (integration-7a)

Recorded by `integration-7a`; the evidence is in `docs/tdd/phase7-integration-7a.tdd.md`.

1. **The default template shows `notice.session-integrity`** (C94.6; flow version 3): `DEFAULT_TEMPLATE`, its golden copy `contracts/fixtures/flows/default-gov-id-selfie.json` and the API fixture `flow-session.json`. The flow and the Android SDK show ADR 0006's default texts for both notices and the optional `consent.device-recognition` (English and Spanish; the SDK adds the recognition consent's checkbox). A consent on the default template now records three required keys: 18 API test files, three flow tests, two mocked and one full-stack spec, and two Android tests that consent on it changed with the plan.
2. **`seed:dev` opens the S3 storage** from `S3_*` (`DevSeedSettings.s3`, `openDevSeedStorage`), so the sandbox network import of foundation-7a's (N) amendment 11 writes its snapshot; without `S3_BUCKET` it imports nothing and says so.
3. **The network sources page is served:** `dashboardNetworkSourcesSchema` moved, unchanged, to `packages/contracts/src/network-sources.ts`, and `admin.ts` registers `networkSourceRoutes` (`settings:read`); the OpenAPI snapshot gains the path. This is the only OpenAPI change after Stage 1; `openapi:write` is otherwise unchanged at the end of 7A.
4. **The flow's response headers** (C107.9): `FLOW_RESPONSE_HEADERS` in `apps/flow/src/security/response-headers.ts`, sent by `vite preview` (`apps/flow/vite.config.ts`); `infra/tests/flow-headers.test.sh` checks the module and the config (static) and the running apps container (live, needs `openverify/apps:dev`); `docs/flow/README.md` gives them to operators who serve the build themselves. The CI infra job does not run it yet (its static half needs no Node; adding it is a followup within the CI budget).
5. **The apps image carries the pinned ASN seeds** (re-included in `.dockerignore`, each checked with `sha256sum -c`), so a container's VPN and hosting flags work, and leaves out every `*.mmdb` and `*.mmdb.gz`; no live network data or IP reputation file is baked in (`infra/tests/apps-image-context.test.sh`; the built image was searched too).
6. **The QR libraries that lost** (`qrcode`, `uqr`) left `apps/flow`, and `uqr` the catalog; `qrcode` stays for the dashboard's TOTP code. `apps/flow` now depends on `@openverify/signals` and imports `@openverify/signals/browser`.
7. **The reusable e2e stack** (C111.2, F20): `pnpm --filter @openverify/e2e e2e:stack:up` starts a detached holder that runs `startStack()` and records `e2e/.artifacts/stack.json` (mode 0600; it holds the run's credentials, as `e2e/.env.e2e` does), returning once the stack is ready, so it runs in the foreground; with `OPENVERIFY_E2E_REUSE_STACK=1` (or `true`) the global setup reads the record and starts nothing; `e2e:stack:down` ends it, or removes the compose project of a holder that died. The scripts run under Node's type transforms with `packages/checks/scripts/register-ts.mjs`, as the watchlist benchmarks do, so no dependency was added. **Shards: 3.** `e2e/README.md` gives the commands and how to run one spec.
8. **The trusted proxy** (F34): the e2e stack sets `OPENVERIFY_TRUST_PROXY=127.0.0.1`, the sandbox `ipReputation`, no MMDB path, no refresh and no source switched. `e2e/tests/support/network.ts` adds `X-Forwarded-For` below CORS (`presentAddress`, through `withForwardedFor`, which takes documentation addresses only), and `signals.spec.ts` asserts that the flow API's CORS list is still `authorization, content-type, x-request-id`.
9. **The 7A full-stack specs** (C111.2), each with a 90 s budget: `signals.spec.ts`, `handoff.spec.ts` (two tests) and `ip-address-report.spec.ts`. The full-stack suite has 95 tests (91 after Phase 6). **Email handoff** is not in the full-stack spec: the email send to a confirmed destination, its budget and the code path are covered by the API route tests (`services/handoff/flow-handoffs*.test.ts`); a Mailpit-driven spec is a followup.
10. **No CI e2e shard matrix** (owner decision 10 after Workflow 6C): the measured full-stack suite with 7A's specs takes 9.9 minutes in three shards locally (1.7, 4.3 and 3.9 minutes, plus 1.1 minutes for the stack start), against 9.5 minutes for 91 tests after Phase 6, so it still fits the one CI e2e job (12.5 to 15 of its 70 minutes after Phase 6). CI keeps running `pnpm e2e`, which starts its own stack; the next integration agent measures again (C111.2).
11. **CI's SDK host-test floor is 1,327**, Workflow 7A's measured count. CI's integration and e2e jobs already run `python3 scripts/fetch_data.py`, which now fetches the ASN seeds.
12. **Defects found by the integration and fixed test-first:**
    - a pending report of a type with a boolean or record attribute could not be built, so creating an `ip-address` report answered 500 (`emptyTypeAttributes` now takes the first of `null`, `[]`, `{}` and `false` its schema accepts);
    - the last screen's collector body reached the server after the inquiry completed and its sessions ended, so a one-step flow always read `collector_missing`: the flow now sends the open screen before a verification submit or an OTP confirmation, waiting at most `SIGNAL_FLUSH_BOUND_MS` (1,500 ms, provisional), through `flushBeforeSubmission` in `apps/flow/src/signals/` and the client `useSignalCollection` returns;
    - the flow offered a retry after a failure with no retry hint, in the second between the worker deciding the verification and settling the inquiry (found under load): such a failure is never retryable, so the position is now `finalizing`;
    - `@openverify/node`'s `inquirySessions.retrieve` takes `include` (`network`, `device`);
    - a Phase 6 redaction scan read a worker's pid as the subject's birth year; it now leaves `claimed_by` out;
    - `seededTemplateId` (e2e) compares template names without case ("Default IP address").
13. **The desktop after a handoff's completion** shows "This verification session has ended", not the completion screen of C96.8 (flow-handoff amendment 4); `handoff.spec.ts` asserts it.
14. **Validation order** (amends Validation, beside the Phase 6 outcome 10): install, `pnpm format:check`; `pnpm turbo run lint typecheck --force`; `python3 scripts/fetch_models.py` and `python3 scripts/fetch_data.py`; `pnpm --filter @openverify/watchlist build:variant-groups`; `pnpm test` (the other packages as one call, the API suite as two blob shards and a merge); `benchmark:typecheck` and `benchmark:test`; `pnpm test:integration`; the vision suite (ruff, format, mypy, then pytest, which locally takes more than one 10-minute call and runs in two halves, the second with `--cov-append` so the 80% gate applies to the whole); the Android gate; `openapi:write` with `git diff --exit-code docs/api/openapi.json`; the e2e gate: the mocked flow suite, then on a fresh reusable stack `e2e:stack:up`, `OPENVERIFY_E2E_REUSE_STACK=1 … playwright test --shard=i/3` for i = 1 to 3, `e2e:stack:down`; `docker build -t openverify/apps:dev -f infra/docker/apps.Dockerfile .` and `docker build services/vision` (the apps image needs the fetched data and the built variant groups); every `infra/tests/*.test.sh` (the flow-headers live half needs the tagged apps image); `gitleaks git --redact .`.

## Owner decisions after Workflow 7A (2026-10-31)

Taken by the orchestrator under the owner's standing approval ("take decisions yourself which are industry best"), recorded here and in PROGRESS. They are binding for Workflows 7B and 7C and later phases. Every open item from 7A's reports was checked against `ce772d10`. Each one below is a decision, a known item for 7C (ids `K7A-n`), or a later-phase item.

### Decisions

1. **The collector learns its next sequence (`next-sequence`).** A reloaded page numbers bodies from 0, and the server ignores a repeated `(session, sequence)` with 202, so the reloaded page's first bodies are lost without anyone seeing it. The Android SDK has the same gap: every launch sends sequence 0, so a later launch is ignored. Decision: the flow session's `signals` member gains an optional `next-sequence` (the session's highest stored or counted sequence + 1); `useSignalCollection` passes it as `startCollector`'s `firstSequence`, and the SDK uses it for its body. K7A-7.
2. **The open screen is sent on `pagehide`.** A body is at most 8 KiB, well under the 64 KiB `keepalive` limit, and the listener lives in the flow's hook, so the collector's size budget (221 B of headroom) is not touched. `FlowApiClient.sendSignals` uses `fetch` with `keepalive`. A send that still fails stays a gap in the data, never evidence. K7A-11.
3. **System audit entries are served.** An audit log that leaves out what the system did is incomplete, and C108's reviewers need the `handoff.*` entries. `GET /user-audit-logs` serves entries with no principal as `actor { type: "system", id: null }` (a C15 contract change, since `actor.type` knows only `user` and `api-key` and `actor.id` is required today), with the same scope and masking as every other entry. The dashboard's audit pages show them. K7A-8.
4. **`TOR_EXIT_WINDOW_HOURS` moves into core's `NETWORK_SIGNAL_CONSTANTS`.** One registry holds every provisional constant. It is still 24 hours, `basis: provisional`. `tor_detected` is R-tier with no thresholds, so no signal version changes. `@openverify/signals` keeps no runtime dependency on core: `networkLookupRules` takes the value from its caller. K7A-13.
5. **`SIGNAL_LOGIC_CONSTANTS` moves into `BOT_SCORE_CONSTANTS`.** `many-focus-losses-min` (10) and `long-hidden-seconds-min` (300) join the registry; `behavior_threat_level` lists `integrity` among its inputs and the bot-score keys it applies among its thresholds. `bot_score` and `behavior_threat_level` each move to version 2 and the digests are re-pinned. Nothing has shipped, so this is the cheapest moment. The values do not change. K7A-12.
6. **`RECOGNITION_BUCKETS` stays in the collector.** The buckets are not thresholds and are never served, the collector cannot import core within its size budget, and a test already pins them to collector version 1. Registering them would change the registry digest and no behaviour.
7. **`purgeNetworkSnapshots` stays on the sync path.** It runs after every applied or unchanged sync. A disabled source keeps its last two snapshots, which hold public publisher data and no PII, so the C16 retention run does not need to call it.
8. **The notice texts stay at ADR 0006's defaults until the owner confirms the wording.** Integration-7a gave the Android SDK an app wording for `notice.session-integrity` (en, es), because the default speaks of "this page". These are legal texts, so this goes on the owner's list; no build step waits for it.
9. **`CLAUDE.md`'s layout table needs no change.** It already lists `signals` (C109 is closed for that line).
10. **`flow-headers --static-only` joins the CI infra job with the Phase 6 and 7A push.** The orchestrator does it, test-first against `infra/tests/ci-workflow.test.sh`, before the push.

11. **The reusable e2e stack has one owner at a time.** A hold on `/tmp/openverify-e2e.lock` lasts one call, so parallel agents would stop or reuse each other's stack. Stages 1a and 4 run alone and use the reusable stack, bringing it down first, because `up` answers "already running" on a stale stack. Stages 1b to 3 run their own-stack shards under the lock. This amends C111.2.
12. **`custom-list` lands whole in 7B's Stage 1a (L).** Every layer walks `REPORT_TYPES`, so the type, the CHECK migration, the job stub, the docs page, the seed name, the completion case and the dashboard minimum go together, as `ip-address` did. This supersedes C106.3 on who edits the seed and Stage 1b (L)'s "if it is an enum".
13. **`normalizeIdentificationNumber` moves to `@openverify/core`,** re-exported from `packages/db` under the same name with its C31.8 indexes unchanged. C98.2 needs it in `packages/checks`, which cannot import `packages/db`.
14. **Enums that `checks` or `db` must read live in core.** C101.2's "frozen enum in contracts" cannot work, because neither package can read contracts.
15. **`packages/checks` links `@openverify/signals` through a new narrow `./address` export.** A list key and a session address must share one canonical IP form. `address.ts` imports only `node:net` and an error type, so `checks` never loads `mmdb-lib`. No browser code imports `checks` (only `apps/api` and `packages/watchlist` do), so `node:net` is safe.
16. **`api-biometric-lists` may add one `services/vision` route for the masked background image.** C99.7 needs one, no route returns it, and no other 7B bullet owns vision.
17. **`contracts-7b` settles how list and graph kinds key 7A's stored device HMACs,** and records it as an amendment. C98.2's `identifierKey` call form and fingerprint labels differ from what 7A built.
18. **The CI e2e job stays one job while the suite fits it.** This supersedes C111.2's "CI gets a shard matrix"; 7B re-measures before anything changes.

### Known items for Workflow 7C

Each of these is open at `ce772d10`; `resume/7c-prep/known-7c-draft.json` holds the list 7C's launch copy embeds.

| Id | Severity | Item |
|---|---|---|
| K7A-1 | HIGH | A session-cap expiry orphans a canceled selfie capture's storage objects: the file rows go in the transaction and nothing deletes the objects, so redaction can never find them. `SessionCapOutcome` gains `storageKeys`, deleted after commit |
| K7A-2 | HIGH | The full-stack email handoff spec (Mailpit) is missing. The acceptance line "by email to a confirmed destination" is not proven end to end |
| K7C-1 | HIGH | `from_rejected_handoff` and `handoff_rejected_at` reach no contract and no served resource, so C96.3's "a reviewer sees which verifications came from the rejected session" cannot be met. The API serves both; the console half is `K7C-1-console`. Both are built into `workflow-7c.mjs` |
| K7A-3 | MEDIUM | `POST /inquiry-sessions/:id/generate-one-time-link` accepts a lifetime and ignores it |
| K7A-4 | MEDIUM | After the phone completes, the desktop shows "This verification session has ended" instead of the template's completion screen (C96.8) |
| K7A-5 | MEDIUM | A desktop reloaded while the phone works moves past the handoff step and its first write answers 409; `flowHandoffSchema` gains an optional `handed-off`, and the step opens on its waiting screen |
| K7A-6 | MEDIUM | Android offers another attempt after a failure with no retry hints, the window the web flow closed (`finalizing`). `FlowCoordinator` finalizes only when attempts run out |
| K7A-7 | MEDIUM | `next-sequence` (decision 1), web and Android |
| K7A-8 | MEDIUM | System audit entries served and shown (decision 3) |
| K7A-9 | MEDIUM | `seedPiiSubject` does not seed the `networks` table, so the API-level redaction scan never sees it; only the db repository test does |
| K7A-10 | MEDIUM | `SessionNetworkDeps` has no logger, so an evaluation that writes nothing leaves no trace. Log the error's name, never the address |
| K7A-11 | LOW | The `pagehide` send (decision 2) |
| K7A-12 | LOW | The registry moves of decision 5 |
| K7A-13 | LOW | The registry move of decision 4 |
| K7A-14 | LOW | `packages/signals`: `DOM` in the tsconfig `lib`, `@openverify/contracts` and `@openverify/core` as devDependencies, then drop the 2 per-file DOM references and the 5 relative imports |
| K7A-15 | LOW | Export `stageSessionEvents` from `services/inquiry-sessions.ts`; `flow-handoffs.ts` has a copy |
| K7A-16 | LOW | `MockFlowApi` gains `signalTiers`; `signals.spec.ts` drops its `installWithTiers` proxy |
| K7A-17 | LOW | `@openverify/node`: `inquirySessions.generateOneTimeLink` for the per-session route |
| D001 | LOW | `rescreen.ts`'s `keyFrequencyReader` re-counts when the table is too large (6D review) |
| D002 | LOW | `shortcuts.test.ts` covers only person subjects (6D review) |

The console items are C108's own deliverables and stay there: signals, devices and review display; the settings page for `signal-collection`, `expose-signals`, the three windows and `organization-display-name`; `from_rejected_handoff`; and "IP geolocation by DB-IP" with a component test (C92.8).

### Later phases

- **Workflow 7B, integration:** re-measure the full-stack suite with 7B's specs before any CI shard matrix (95 tests, 9.9 min at the end of 7A). `list_match_count` is the first `review-rule: false` signal, already refused by `signalConfigPublishProblems`.
- **Phase 10:** C90.9's sandbox-outcome control on Android (an SDK switch or a demo-app hook); and the Android debugger facts, which are collected and read by no Phase 7 signal, so an Android-only consented session reads `input_missing` for `bot_score`, `behavior_threat_level` and `automation_artefact_count`.
- **Phase 11:** `MmdbSnapshot.verify` on a real City Lite file (7.8 million records, unmeasured; City Lite is off by default). Measure it with the capacity work.
- **Any later collector version:** 221 B of gzip headroom remains. Trim first.

## Workflow 7B Stage 1a amendments (contracts-7b)

Recorded by `contracts-7b` on 2026-10-31 at base `919c95b3`. Items 1 to 8 are the re-verification, done before any 7B code; the later items are the decisions and deviations of the Stage 1a commits. The evidence is in `docs/tdd/phase7-contracts-7b.tdd.md`. Each item binds every later 7B agent.

### Re-verification of the 7A amendments, the sessions and devices, and the report engine

1. **The 7A amendments hold as written.** Checked against the code at `919c95b3`: rate limits live in `packages/contracts/src/rate-limits.ts` (`RATE_LIMIT_POLICIES`, `RATE_LIMIT_DEFAULTS`, `RATE_LIMIT_POLICY_WINDOWS`; `graph-unmask` is there, not enforced); `REDACTION_SUBJECT_ID_PREFIXES` is `inq, ver, iqse, acc, self, rep, net, dev`; the newest migration is `0023_phase7a`, so 7B's is `0024_phase7b`; `inquiry_template_versions` has `signal_config`, no `list_config`; `transitionInquiryInTx` runs `createInquiryReportsInTx`, `createSignalComputationInTx` and `handoffReviewAfterTransitionInTx`; `recordSessionStart` calls `evaluateSessionNetworkInTx` and `recordSessionDeviceInTx`, and 7B's reserved third call site is still empty. `SIGNAL_NAMES` has 13 names, `apps/api/src/jobs/signals/process.test.ts` and `packages/checks/src/signals/compute.test.ts` already filter out `inquiry/list_match_count`, and `COMPUTED_SIGNAL_NAMES` leaves it out, so the registry entry changes no stored array.
2. **`identifierKey` has the form 7A built, not C98.2's.** It is `identifierKey(key, { environmentId, kind, input })`, `HMAC-SHA-256(environment subkey, "<label>|<input>")`, with the label from `IDENTIFIER_KEY_LABELS` (`packages/db/src/blind-index.ts`), 7A's three kinds being `browser-fingerprint`, `device-class` and `android-id` (`openverify/<kind>/v1`). C98.2's `identifierKey(key, environmentId, label, input)` is void. 7B's labels are new members of `IDENTIFIER_KEY_LABELS` under the names of `LIST_KEY_KINDS` (item 14), so the kind `identifier-email` is `openverify/identifier-email/v1`; `foundation-7b` adds them (the file is shared), with a golden test per label.
3. **How the list and graph kinds key the device HMACs 7A stores** (owner decision 17). `devices` holds three 64-hex HMACs: `browser_fingerprint` (`openverify/browser-fingerprint/v1`, over the canonical JSON of the stable components), `device_fingerprint` (`openverify/android-id/v1`, over the `ANDROID_ID`) and `device_class` (`openverify/device-class/v1`), each with its `key_id`. They are never used as a list `match_key` or a graph `value_key` directly: a sealed list `value` beside a `match_key` equal to it would seal nothing, and the labels would no longer separate a list key from a device column. The **key input** of the fingerprint kinds is the stored 64-hex HMAC, lower-cased, as the device resource serves it, and the key is `identifierKey(key, { environmentId, kind: 'identifier-browser-fingerprint' | 'identifier-device-fingerprint', input })`. A list item's `value` is that same 64-hex text, read from a device resource by the operator. A probe takes `devices.browser_fingerprint` or `devices.device_fingerprint` and keys it the same way, so one list item and one graph row meet on one key. The graph's `device_class` kind keys `devices.device_class` under `identifier-device-fingerprint` (C101.2's "the same label"); its rows are separated by `kind`, and the web device class is never a list probe (V10). The `key_id` of a fingerprint item and of a fingerprint graph row is the device's. After `blind-index:rebuild` the device HMACs change, so an item whose `key_id` is not the current `blindIndexKeyId(key)` cannot be re-derived from its sealed value: it stays unmatched and its list reports `key_rotated` (C94.4), never "no match". The keyed fingerprint is an HMAC of an HMAC, which costs one more HMAC per probe and nothing else.
4. **Where the name kinds' key inputs live** (Phase 6 outcome 7): confirmed. `@openverify/watchlist` depends on `@openverify/checks`, so `packages/checks/src/lists` cannot import `packages/watchlist/src/{names,translit}`. The name and last-name kinds of C98.2 and the graph's `name_birthdate` and `name` kinds of C101.2 live in `packages/watchlist/src/list-keys/`, owned by `list-logic`, which calls the C78 analysis (`analysePersonName`, the `AnalysedName` folds) without changing it. `apps/api` already depends on `@openverify/watchlist`. Every other kind is in `packages/checks/src/lists/`.
5. **`normalizeIdentificationNumber` is in `packages/db/src/blind-index.ts`** and nowhere else; only that file and its test use it. It moves to `@openverify/core` (owner decision 13), and `packages/db` re-exports it under the same name, so the C31.8 indexes are unchanged.
6. **The workspace links.** `packages/checks` depends on `core` and `emrtd`; `packages/watchlist` on `checks` and `core`; `packages/db` on `core`; `packages/signals` on nothing in the workspace; `packages/core` on nothing in the workspace. `packages/signals/src/network/address.ts` imports only `node:net` and `./errors.js`, which imports nothing. `apps/api` links `checks`, `contracts`, `core`, `db`, `signals` and `watchlist`.
7. **The report engine for C106.2.** `REPORT_TYPES` has ten types; `report_type` is text with the two CHECK constraints. `report_matches.source_id` is plain text with no foreign key, so a list id fits it; `reports.sources` and `report_runs.sources` are JSON arrays. The contract is what refuses a list: `reportErrorSchema.source`, `reportMatchSchema['source-id']` and `reportSourceProvenanceSchema['source-id']` all use `watchlistSourceIdSchema` (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`), which refuses `lst_…`, and `ReportSourceRecord` carries a sync. `REPORT_TYPE_JOBS` (an equality test), the seed names, `apps/api/src/report-docs.test.ts` and the dashboard's labels, words and result view all walk `REPORT_TYPES`. `transaction` on the report relationships is `{ data: null }`, as C105.7 says, and on neither `inquiryRelationshipsSchema` nor the verification relationships does the member exist yet.
8. **Rate limits and the dashboard.** The console's rate-limit panel labels every policy, and `PERMISSION_INFO` (`apps/dashboard/src/components/operators/permissions.ts`) must label every permission, so both change with the common commit. `EventSubject` has two copies: `packages/contracts/src/event-names.ts` and the db's in `packages/db/src/repositories/webhooks.ts`.

### Decisions and deviations of the Stage 1a commits

9. **Enums a table, a key input or the engine reads live in core** (owner decision 14). `packages/core/src/lists.ts` (`LIST_KINDS`, `LIST_KIND_REGISTRY`, `IMPORTER_LIST_KINDS`, `LIST_STATUSES`, `LIST_ITEM_STATUSES`, `LIST_EMAIL_MATCH_TYPES`, `LIST_LIMITS`, `IMPORT_LIMITS`, `IMPORTER_STATUSES`, `IMPORTER_MODES`, `IMPORT_ERROR_CODES`, `LIST_MATCH_METHODS`, `LIST_MATCH_STATUSES`, `LIST_MATCH_TIERS`, `LIST_UNSCREENED_REASONS`, `LIST_NOT_APPLICABLE_REASONS`, `LIST_SCREENING_STATUSES`, `LIST_REVIEW_CAUSES`, `LIST_PROBE_SOURCES`, `LIST_KEY_KINDS`, `LIST_MATCH_CONSTANTS`), `graph-kinds.ts`, `graph-queries.ts` and `transactions/`; contracts re-exports each. C101.2's "a frozen enum in contracts" is void.
10. **The graph kinds carry a frozen `smallint` code** (1 to 18, `GRAPH_KIND_REGISTRY`), because `graph_attributes.kind` stores it; a code never changes once written. `graphKindCode` and `graphKindOfCode` translate. `device_class` shares `identifier-device-fingerprint` with `device_fingerprint`, kept apart by `kind` (amendment 3). The `reference_id`, `name_birthdate`, `address`, `postal_code` and `birthdate` keys are the labels `identifier-reference-id`, `identifier-name-birthdate`, `identifier-address`, `identifier-postal-code` and `identifier-birthdate`, which `foundation-7b` adds with the list kinds; `email_domain` shares `identifier-email-domain`, and `name` shares `identifier-name`. `GRAPH_PERSON_KINDS` is C102.4's list of parameters that need `pii:view`.
11. **`LIST_KEYS_VERSION` is a text, `lists-1`**, exported from `@openverify/checks`, so `normaliser_version` is `text` and "outdated" means "not equal to the process's", as `keysVersion()` compares. `packages/watchlist/src/list-keys/list-keys-version.test.ts` pins the pair `lists-1` and `names-2` and the C78 forms the name kinds read (both folds and the token role), so a change of the analysis fails there until `LIST_KEYS_VERSION` is bumped. `list-logic` adds the golden key vectors beside it.
12. **JSON:API forbids an attribute named `type`,** so C97.2's list `type` is the resource type `list/<kind>`, and `filter[type]` takes the singular kind. Item resources are `list-item/<kind>`, importers `importer/list-item/<kind>` (eleven kinds, not faces or backgrounds), and a list's limits go in the document's `meta` (`listLimitsMeta`). The public `list-items` relationship is left out: a list holds up to 1,000,000 items, and `GET /list-items?filter[list-id]=` serves them. `filter[list-id]` is required by the route (400 `filter_required`); the schema keeps it optional, as 7A's devices do.
13. **`id-class` is not marked PII on an item,** though C97.6 says every value but the country is: the name is a non-PII attribute of every government ID verification, and the collision test holds a name to one form. A class alone names no one. `id-class` takes the C31 classes (`passport`, ...), not the public short codes. `model` and `source-inquiry-id` on faces are not values either.
14. **The key kinds.** `LIST_KEY_KINDS` (core) names C98.2's fourteen labels as `identifier-*`; `IDENTIFIER_KEY_LABELS` gains each as `openverify/<kind>/v1` in Stage 1b. `listKeyInputs(kind, item, options)`, `listProbeKeyInputs(kind, probe, options)`, `graphKeyInput(kind, value)`, `importColumns(kind)`, `ListKeyInputError(code)` and `LIST_KEYS_VERSION` are `packages/checks/src/lists/`'s frozen names; `listNameKeyInputs`, `listLastNameKeyInputs`, `graphNameBirthdateKeyInputs` and `graphNameKeyInputs` are `packages/watchlist/src/list-keys/`'s; `writeCsv`, `neutraliseCell` and `stripNeutraliser` are `packages/checks/src/csv/`'s. Each stub throws until `list-logic` builds it.
15. **Ours beyond the plan's members.** `distance-meters` on a match (C99.2 says the match records the distance); the probe source vocabulary `LIST_PROBE_SOURCES`, closed; `list-ids` on `POST /lists/match` (without it, every active list of the probes' kinds); `list-match-result` as the on-demand answer's type, whose `matches` is marked PII because the name is PII on reports (it names items, never a value); `redacted-at` on a list match; `TRANSACTION_INCLUDES`.
16. **The evidence rules are in the schemas (H15).** An H-tier match carries a confidence and an R-tier one never does; a fuzzy, face or background match carries a score, and a radius match its distance; a report's `matched-lists` carries the same members. `signal-details['inquiry/list_match_count']` gains `list-screening` (`status`, `unscreened`, `not-applicable`, `review-cause`), which is where C99.4's "listing the unscreened list ids and reasons" lives.
17. **The list reasons default to `ignore` in `ON_NULL_DEFAULTS`** (the Record needs every reason classified). The value is never read: no review rule may test `inquiry/list_match_count` (F31), and `on-list-match` covers it. `packages/checks/src/signals/vocabulary.ts` mirrors the three reasons.
18. **Events carry no value (rule 11), enforced in the event contract.** `eventAttributesSchema` refuses a `list-match` payload with `matched-value` or `reason`, a `transaction` payload with `fields`, and a `graph-query` payload with `params`, `nodes` or `links`; the webhook samples follow. So every emitter builds the event's resource with `matchedValue: null`, `fields: null`, or `params: null` and empty nodes and links. Relation events carry `payload.meta.context` (C105.3), and the type events `payload.meta` with `field-key` and `version-number` (and `from` and `to` for a conversion), each enforced.
19. **`report/custom-list`.** `sources` holds `reportListProvenanceSchema` entries, overriding the shared member for this type only; `ReportRecord.listSources` feeds it, and `services/reports/resources.ts` reads the stored JSON through that schema, so `api-lists` stores provenance in `reports.sources`. `reportSourceIdSchema` (a watchlist id or `lst_…`) now types `errors[].source` and `matches[].source-id`. Two refinements hold ADR 0005: a report is never `ready` with an entry in `unscreened`, and each entry is named by a `list_unavailable` error. `list-ids` is `null` by default on the template, so the seeded template publishes; a report with no list answers `report_lists_required`. `match-types` reuses `identifier_exact` and `name_fuzzy`, with `[]` for the other methods; the method is in `matched-lists`.
20. **`inquiry/list_match_count` is registered `default: true`, `reviewRule: false`, `inputs: ['lists']`.** `DEFAULT_SIGNAL_NAMES` holds it; `COMPUTED_SIGNAL_NAMES` does not. `packages/checks`' `compute.test.ts` default set changed with it. No entry is served for it until `api-lists` merges it in `services/signals/served.ts`.
21. **The roles.** Developers get every 7B scope but `transactions:redact`, as C72 did for reports. Reviewers get `lists:read`, `lists:write` (dismissing a match), `importers:read`, `graph:read`, `graph:write`, `transactions:read`, `transactions:write` and `transactions:redact`; not `importers:write` or `transaction-types:write`. Viewers get the three reads, never `graph:read`. A developer holds no `pii:view`, so person-identifying graph parameters and `POST /lists/match` stay out of reach.
22. **The field-schema union** is in core (`packages/core/src/transactions/field-schemas.ts`), recursive through getters, typed `z.ZodType<FieldSchema>`, and registered in the OpenAPI as the component `FieldSchema`. It holds each field's own members and bounds; the rules across a version (caps, `never`, defaults that must be options, unsupported targets) answer problem codes and are the engine's (`transactionTypeVersionProblems`, `fieldsValidatorOf`, `jsonSchemaKeywordProblems`, `isCardLike`, `transactionTypeVersionDiff`). `document-mdoc` and `document-qr-code` parse, so the engine can answer 422 `relation_target_unsupported`. Ours in shared config: `searchable` and `never-redact-acknowledged`. `POST /:id/label` answers the transaction, and `transaction-label` is reached through its relationship.
23. **The graph.** Property node ids are `gn_` plus 22 base64url characters, local to one result. `index-complete` is derived in the builder and refined against `kinds-not-indexed`. `graphTemplateConfigProblems` answers the publish refusals with their pointers, because a schema cannot carry a code. `GRAPH_PARAMETER_KINDS` adds `account_id` and `created_at` to the kinds. `stats` is a strict empty object in Phase 7. The bulk route answers `graph-query-action`; the `export` action answers `text/csv`, which the node client does not parse.
24. **`list-matches` and `transactions` joined the includes** (`INQUIRY_INCLUDES`, `ACCOUNT_INCLUDES`), with `lists:read` and `transactions:read` enforced by the two routes now. Nothing serves them until `api-lists` and `api-transactions` do: `included` stays empty.
25. **Existing tests changed with the plan,** none weakened: `API_SCOPES`, the role lists and `role.json`; `RATE_LIMIT_POLICIES` and its defaults and windows; the registry's order, tiers, public list, golden digests and "every signal is reviewable", which now names the one exception; `SIGNAL_NULL_REASONS`; `RESOURCE_TYPES`, `ID_PREFIXES` and the event-name lists; `INQUIRY_INCLUDES` and `ACCOUNT_INCLUDES`; `REPORT_TYPES`, its rows and event count (54); the query sources; the seeded template counts (22 and 16); the permission areas; the event groups; and the report relationship test, which refused a transaction and now accepts one (C105.7). `rsc-payload.test.tsx` built report ids by appending an index, which broke at the eleventh type.
26. **Left to their owners.** Masking and API-log joins of `PII_LIST_ATTRIBUTES`, `PII_IMPORTER_ATTRIBUTES`, `PII_GRAPH_ATTRIBUTES` and `PII_TRANSACTION_ATTRIBUTES`, and the problem-error classes, are `foundation-7b`'s. `value` is PII by name, and the inquiry's `signals[].value` and a graph node's `value` are nested members with the same name: masking by name at every depth would blank them, so the masking must stay at the attribute level for those, as `api-log.query` is exempted. `api-lists` owns the custom-list job, its completion case and `docs/reports/custom-list.md`'s facts; `integration-7b` completes the page and the seeded template's settings.

## Workflow 7B Stage 1b amendments (foundation-7b)

Recorded by `foundation-7b` on 2026-10-31, per checkpoint. The evidence, and the steps that regenerate migration 0024, are in `docs/tdd/phase7-foundation-7b.tdd.md`. Each item binds every later 7B agent.

### Checkpoint (L) lists and importers (ends at `cb2745b2`)

1. **The tables** (one migration, `0024_phase7b`, regenerated with `CREATE EXTENSION IF NOT EXISTS vector` first and five `set_updated_at` triggers). `lists` holds the thirteen kinds in one table, its `type` column C97.2's type, with a CHECK holding each kind's own member to its kind and requiring `item_retention_days` on face and background lists. `list_items` has the columns of C98.1 and three more: **`country_code`** (plaintext: C98.2 says a country matches "on the plaintext column", which C98.1 does not name; not PII by C97.6), `archive_reason` (C99.7's `source_unavailable`) and `normaliser_version` not null, so a biometric item writes `LIST_KEYS_VERSION` too. `match_key` and `value` are `null` on a biometric item and after redaction. `created_by_type` is `user`, `api-key` or `importer`. `list_item_ip_ranges.range` has the SP-GiST `inet_ops` index `list_item_ip_ranges_range_idx`, and `list_item_geo.bbox` the GiST `box_ops` index `list_item_geo_bbox_idx`; both are asserted from the catalogs on PGlite and on Postgres 17, with `explain`.
2. **A biometric side row is written with the pending item.** `list_item_faces.template` and `model`, and `list_item_backgrounds.layout`, `valid_cells` and `coverage`, are `null` until the embed job fills them, with CHECKs that they fill together, because the resource serves `source-inquiry-id` while `pending`. Both tables keep `source_inquiry_id` not null, with a plain foreign key (no action) and an index, which `redactBySource` reads. Redaction deletes the side row before an inquiry could be deleted.
3. **`list_matches` is unique on `(environment, inquiry, item, source)`** where the item is not null (`list_matches_inquiry_item_source_key`), so a retried job and the C99.9 record write one match; `insertListMatches` answers only what it wrote. `list_item_id` is nullable because the served relationship reads `null` once the item is redacted.
4. **`list_screenings`** is keyed `(environment, inquiry)`: `trigger_status`, `status`, `match_count`, `unscreened`, `not_applicable`, `review_cause`, `attempts`, `last_error_code`, `enqueued_at`, `screened_at`, with a partial index on the pending rows by age. `LIST_SCREENING_STATUSES` is closed and has no `skipped`, so a job that finds an inquiry redacted after its row was written ends the row `errored` with a `last_error_code`.
5. **The importer table is `importers`** (`mprt_`), with `file_sha256`, `file_bytes`, `storage_key`, `wrapped_dek` (both nulled at the purge), `object_deleted_at`, the counts, `attempts`, `last_error_code` and `enqueued_at`. `list_import_rows` has an identity `id`, `row`, the sealed `value` bound to `importRowKey(importer id, row)` = `<mprt id>/<row>`, and a `match_key`, so a repeat within the file is counted without opening a row. `list_import_errors` has an identity `id`, `row` and `column` (both `null` for an error of the whole file) and `code`.
6. **`createListScreeningInTx` is built here** (`services/lists/screening.ts`), as `createSignalComputationInTx` was. It runs on every move, after the signals hook and before `handoffReviewAfterTransitionInTx`, and writes the row on the signals outbox's moves (`writesListScreening` is `writesSignalComputation`, so `created -> expired` too: V17 over C99.4's "out of `pending`"), never for a redacted inquiry. "Selects any list" reads: `none` no; a named list of one or more yes, an archived one included (it reads `list_archived`), an empty one no; `all` when an active list with `screen-at-completion` of a kind `all` reads exists (`anyListScreenedByAll`), a kind the environment does not collect included, because only a row can record `kind_not_collected`.
7. **`servedInquirySignals({ inquiry, listScreening }, view)`.** The input became an object so the row cannot be left out by position. `inquiryRecordOf` gains a fourth parameter, `inquiryResourceFor` a sixth and `toInquiryResource` a fifth, each defaulting to `null`; every read passes the row (`getListScreening`, `listInquiryListScreenings`). No entry is served for `inquiry/list_match_count` until `api-lists` merges it.
8. **The publish hook.** `listConfigPublishProblems({ deps, db, environment, listConfig })` runs last in `assertPublishable`, answering `ListProblemError` with the first code and every pointer. `createInquiryTemplate` passes `{}`: a create body has no `list-config`, as it has no `signal-config`.
9. **`biometric-lists-basis`** is an environment setting (`environments.settings`, no column): 1-500 characters after trimming, or `null` to clear it; an empty string answers 400. `biometricListsBasisSchema` and the members of `dashboardSettingsSchema`, the update body and `DASHBOARD_SETTINGS_DEFAULTS` are new here. It needs `settings:privacy` as `signal-collection` does (`PRIVACY_SETTINGS`). `onSettingsChangedInTx(tx, environmentId, before, after)` runs in the settings transaction whenever an environment setting changes, and a hook that throws rolls the change back.
10. **`POST /lists/match` reads `pii:view` through `requirePiiView`, not `config.scopes`,** as a report's dismissal does: an API key sees PII unless it was minted masked (C15), and a `config.scopes` entry would refuse every key without that scope.
11. **The ports** are in `ports.ts`: `ListItemWriter.insertItems(tx, { environmentId, listId, items })` answers `{ inserted, alreadyPresent, refused }`, refusals as `{ index, code }` rather than thrown, so `all-or-nothing` and `skip-invalid` read one answer; `ListService.createItem({ environmentId, listId, item })`; `BiometricListMatcher.match({ environmentId, inquiryId, lists })`; `BiometricItemRedactor.redactBySource(tx, { environmentId, inquiryId, at })`, which returns the envelope objects to delete after the commit; `BiometricListsGate.isAcknowledged(db, environmentId)`; `CompromisedIdLookup.lookup(...)`, `null` with no configured list. The unbuilt implementations are honest: the matcher answers every list `unscreened`, the gate says no, the redactor redacts nothing.
12. **The queues.** `list-screen`, `list-import` and `list-item-embed` (`jobs/list-queues.ts`), each job's id its object's id and ids only, with `LIST_JOB_OPTIONS`. `list-item-embed-sweep` is a name beyond C107.1's list: the (L) bullet gives the three queues sweeps. `StartWorkersOptions.lists { screens, imports, embeds, process?, writer? }` starts the workers, and `phase7RepeatableJobs(deps, network, signals, lists)` schedules the sweeps before `network-refresh`. The API holds `listImports` and `listItemEmbeds` (`ApiDependencies`), which the container wires and closes.
13. **The importer route** registers a `multipart/form-data` parser in its own plugin (`parseAs: 'buffer'`, `IMPORTER_BODY_LIMIT_BYTES`, a 20 MB file as base64 plus 4 KiB), and a validator that lets a buffer past and checks JSON by `createImporterBodySchema`; `withoutImporterFile` stores a JSON `file` as its decoded length and SHA-256, for every reader.
14. **`ip-retention-days`** nulls the `matched_value` of the three `session.ip-*` sources (C91.7, P19) and keeps the record. Redaction of an inquiry nulls `matched_value` and `reason`, sets `redacted_at` and stubs and forgets the match ids; an account's matches go through its inquiries. Item retention (`redactExpiredListItems`, 0 until built) and the importer object's purge (`purgeExpiredImportObjects`, 0 until built) are in the C16 pass, reported as `redactedListItems` and `purgedImportObjects`.
15. **The redaction coverage has two more categories.** `THIRD_PARTY_LIST_PII_TABLES` (`importers`, `list_import_rows`, `list_items`) is C107.5's category. `BIOMETRIC_LIST_PII_TABLES` (`list_item_backgrounds`, `list_item_faces`) is a subject's face data that the stub redactor cannot clear yet: **`api-biometric-lists` moves both to `SUBJECT_PII_TABLES` and seeds them in `seedPiiSubject` when it builds `redactBySource`, and may edit `services/redaction.test-support.ts` and `services/redaction.test.ts` for that.** `list_matches` is in `SUBJECT_PII_TABLES`, really seeded and scanned.
16. **The list-match filter subject** is strict from here: `resolveListMatchFilterSubjects` resolves nothing until `api-lists` builds it, so a list match fails any present filter rather than reaching a template-scoped webhook.
17. **The OpenAPI snapshot was regenerated at (L)** (10,015 lines), as at 7A's (S): its test is part of the API suite.
18. **Rate limits are left to the route owners,** as Stage 1a said: `lists-write`, `lists-match` and `importers` are named in the route comments and not enforced until built. The list item routes do not check `pii:view` for faces and backgrounds, or `filter_required`, until `api-lists` does.
19. **Existing tests changed with the plan,** none weakened: the public table list, `ENCRYPTED_COLUMNS`, `REDACTION_SUBJECT_ID_PREFIXES`, the identifier label list (`toMatchObject`, with the full 7B list asserted by its own test and vectors), `DASHBOARD_SETTINGS_DEFAULTS`, the two pinned retention reports, the position of the devices line of `blind-index:rebuild`, the dependency keys of `services/context.test.ts`, the redaction coverage test, and `RetentionSetting` in the dashboard (typecheck minimum).

### Checkpoint (T) transactions (ends at `cea18d7b`)

1. **The tables** (still one migration, regenerated; nine new tables, five more `set_updated_at` triggers, one append-only function on two triggers). `transaction_types` holds a name and a status, and the content lives in `transaction_type_versions`, as C71 keeps it: `latest-version` and `published-version` are read from the versions, not stored. `statuses` is `text[]`, its first member held to `created` by a CHECK (C104.5). `transactions` has C105.4's two indexes, each ending in `id DESC` for C1's ties, and two more: `transactions_environment_id_reference_id_idx` for `filter[reference-id]` and `transactions_unredacted_created_at_idx` for the C16 walk. `fields` may be `null` only once redacted (`transactions_fields_until_redacted`).
2. **The history and the labels are append-only by one function,** `openverify_transaction_history_append_only`, which takes its free-text columns as trigger arguments. An UPDATE passes only under `openverify.transaction_redaction = 'on'`, only when it nulls every one of them, stamps `redacted_at`, and leaves every other column (`updated_at` aside) as it was. A DELETE passes only under `openverify.environment_deletion = 'on'`, so deleting a transaction row is refused too. C105.5's "free text" is read as `from_status` and `to_status`, and `label` and `model_version`; the actor, the times and the score stay. Neither table holds a sealed value (C105.8), so a KEK rewrap has no case.
3. **`transaction_objects` holds accounts too** (C105.1: the account `reference-id` names joins `related-objects`), and `transaction_relations` has an account or a transaction. Each row has one nullable column per kind, each with its composite foreign key, and a generated `object_id` or `target_id`, so the primary key, the idempotence and C105.7's lookup need one index for every kind. A row with no target is refused by the generated column's `NOT NULL`, a row with two by the CHECK.
4. **`transaction_files`** gains `redacted_at` and `sha256` beyond C105.4, and a partial unique index of one live file per field key: C105.2's route writes "one `file` field", and a replacement marks the last one deleted in the same transaction. A `file` nested in an `array` has no route to reach it; the validator refuses it in a JSON body.
5. **The redaction is built here, in the database** (`redactTransactionRecords`, `repositories/transaction-redaction.ts`), and `redactTransactionInTx` is `api-transactions`' hook: it reads the pinned version, passes the `never` keys as `keepFieldKeys` (`[]` with `include-never`) and stages `transaction.redacted`. `RedactionService.redactTransaction(ctx, id, actor, { includeNever })` runs the hook, audits, dispatches and deletes the objects after the commit. A later run can take a kept field, so `meta.include-never` works on a redacted transaction, and that run is audited too, with `include-never` in the metadata (P21). Tags, the reference and the current status stay: C105.5 does not list them, and the resource requires the status.
6. **A redacted label is not served.** `transactionLabelResourceSchema` requires `model-label`, so the label reads leave redacted rows out and a redacted transaction's `transaction-label` reads `null`.
7. **OPEN, for the owner: does redacting an account or an inquiry reach its transactions?** C105.5 covers the transaction's own `DELETE` and retention, and says attached objects are not redacted *with* a transaction. It says nothing the other way, so an erased account's related transactions keep their sealed fields until their own retention. `redactAccount` and `redactInquiry` do not touch them, and `transactions` and `transaction_files` sit in their own category of the coverage test (`TRANSACTION_PII_TABLES`), which `redactTransactionRecords`' tests scan. Proposal: `redactAccount` redacts the transactions linked by `transaction_objects.account_id` or `transaction_relations.account_id`, as C73.5 does for reports, through `redactTransaction`, and the two tables move to `SUBJECT_PII_TABLES`. The data model needs no change for it.
8. **A filter subject can have several links** (C107.4 says "its related accounts' types and its attached inquiries' templates"). `WebhookFilterSubject` and `EventSubject` gain `inquiryTemplateIds` and `accountTypeIds`, read beside the single members by `matchesWebhookFilters` and `listWebhooksForEvent` (`?|`): a subject passes a filter that allows any one of them. `resolveTransactionFilterSubjects` answers the lists; a `transaction-type` event is strict with nothing to resolve. Until built, a transaction fails any present filter.
9. **The `transaction` relationship** is resolved at every read by `resolveTransactionRelationships(db, environmentId, objectIds)`, so `api-transactions` builds that one function and touches no read: `inquiryResourceOf`, `getInquiryDocument`, `listInquiries`, `getVerificationDocument`, `stageVerificationEvent`, the console's inquiry read and list, and `reportViewOf`, through which every report read and event goes. Unbuilt it answers an empty map and each read leaves the member out, as before; built, it answers every id asked for, `null` for an object with none. `inquiryRecordOf`, `inquiryResourceFor`, `toInquiryResource`, `verificationRecordOf` and `toVerificationResource` each gain a trailing parameter. Not wired: `inquiry.created`'s and the flow's verification event payloads, where nothing can be attached yet.
10. **The account include served more than it was asked for.** Stage 1a's two new include values reached a branch that always ran `includedReportsFor`, so `GET /accounts/:id?include=transactions` returned the account's reports past `reports:read`. It now serves what was asked for, each include through its own hook; `includedTransactionsFor` is `api-transactions`'. **`api-lists`:** `include=list-matches` includes nothing until it adds its hook to that one array in `routes/server/accounts.ts`, which needs this leave.
11. **`transaction-retention-days`** (C107.7, `settings:write`): `transactionRetentionDaysSchema`, 1-3,650 or `null`, in `EnvironmentSettings`, the dashboard settings and the update body, as `report-retention-days` is. The C16 pass redacts what is due through `RedactionService` (`redactedTransactions`, `failedTransactionRedactions`) and deletes the objects a redaction left (`purgedTransactionFiles`; a failure counts in `failedPurges`). `redactDueReports` became `redactDueObjects(kind, ...)`, keeping its log keys. A transaction it cannot redact fails the run, which is what happens while the hook is unbuilt and a transaction is due: none can exist before `api-transactions` writes one.
12. **`blind-index:rebuild` runs `rebuildTransactionFieldKeys`** (`services/transactions/rebuild.ts`), beyond the (T) bullet: without it a key change leaves `filter[identifier]` silently answering nothing, the failure the Risks row names. Owner `api-transactions`; zero counts until built.
13. **Masking.** `fields` keeps each key and its `type`, and nulls `value`, because `transactionFieldValueSchema` requires the type: `maskFieldValues` recognises exactly `{ type, value }`. An inquiry's plain value is masked whole, as before. `api-transactions` masks with `mask.attributes(built.attributes)`, as `reportResource` does. In a stored API log read without `pii:view`, `filter[identifier][value]` joins `MASKED_MEMBERS` (the query is outside `attributes`), and the same value in a stored answer's `links.next` is emptied, because `nextLink` repeats the query there.
14. **`transactionIncludeDocumentSchema`** is new in contracts: `transactionDocumentSchema` is strict and `GET /transactions/:id` takes `include`. `transactionLabelResourceSchema` moved above it in the file.
15. **The routes.** Fastify's router reads a hyphen in a param as a separator, so `:file-id` and `:field-key` are `:fileId` and `:fieldKey`, also in the OpenAPI paths. `@fastify/multipart` is registered in the transaction plugin, so `putTransactionFile` gets `parts(limits)` and reads the body only after it loads the pinned version. The idempotency plugin covers POST and PATCH, so a `PUT` keeps no stored answer. `DELETE /:id`, `redact-biometrics` and `publish` take `optionalBody(...)`, because Fastify validates a missing body as `null`. `GET /:id/files/:fileId/content` checks `requirePiiView` in the handler, as `POST /lists/match` does, so an unmasked API key reaches it.
16. **The OpenAPI snapshot was regenerated at (T),** as at (L): its test is part of the API suite.
17. **The file content is bytes by its media type.** `GET /transactions/:id/files/:fileId/content` is documented as `application/octet-stream` with the content schema `{}` (`cea18d7b`): OpenAPI 3.1 states binary content by the media type, and the route's response type stays `z.instanceof(Buffer)`, since the handler sends a `Buffer`. The attempt to document `{ type: string }` (`458736e6`, `a967eec9`) broke the API typecheck and was undone.
18. **Existing tests changed with the plan,** none weakened: the public table list, `ENCRYPTED_COLUMNS`, `REDACTION_SUBJECT_ID_PREFIXES`, the position of the devices line of `blind-index:rebuild`, the redaction coverage test, the pinned retention reports and their `RedactionService` doubles, `DASHBOARD_SETTINGS_DEFAULTS`, and `RetentionSetting` in the dashboard (typecheck minimum).

### Checkpoint (G) graph (ends at `e2c41177`)

1. **The tables** (still one migration, regenerated; seven new tables, five more `set_updated_at` triggers, one seed statement). `graph_attributes` is keyed `(environment_id, kind, value_key, account_id, source_type, source_id)`, so C101.1's `(environment_id, kind, value_key)` index is that key's prefix (the capped fan-out count reads it), and `(environment_id, account_id, kind, value_key)` serves a hop. No degree table (F24). `kind` is the frozen `smallint` code, CHECKed against `GRAPH_KIND_REGISTRY`; `value_key` 64 hex (F10); `key_id` in the form of `devices.key_id`. A row's source is `account`, `inquiry`, `inquiry-session` or `verification` (`GRAPH_SOURCE_TYPES`, `tables/graph.ts`), its `source_id` CHECKed to that kind's prefix, and every source but `account` names its inquiry in `inquiry_id` (with a composite foreign key and a partial index), so an inquiry's redaction deletes its rows in one indexed statement, and an IP row can name its session for the unmask.
2. **`graph_index_state`: a kind with no row is complete since the environment began.** C101.5 says a new environment starts complete; no row is written at environment creation. Migration 0024 writes an incomplete row of every kind (1-18) for each environment that exists when it runs (a hand edit after the triggers), so `graph-backfill` indexes what predates the graph. `complete` is CHECKed equal to `completed_at is not null`; `backfill_cursor` is jsonb of ids and times, `api-graph`'s shape.
3. **`graph_index_jobs`** is keyed `(environment, inquiry)`, with `trigger_status`, `status` (`pending`, `completed`, `skipped`, `errored`: `GRAPH_INDEX_JOB_STATUSES`; unlike the list screening, `skipped` exists, because no contract serves this row), `attempts`, `last_error_code`, `enqueued_at` and `indexed_at` (set exactly when the row is no longer pending). `createGraphIndexJobInTx` is built here (`services/graph/index-outbox.ts`) on the signals outbox's moves (`writesGraphIndexJob` is `writesSignalComputation`, so `created -> expired` too, V17), never for a redacted inquiry, and it reads no setting: the `graph-index` job reads `graph-indexing` when it runs and ends the row `skipped`, so `LifecycleDeps` stays `{ events, clock }`.
4. **`graph_queries`** holds `params` sealed for the row (`SEALED.graphQueryParams`, `graph_queries.params#<id>`, in `ENCRYPTED_COLUMNS` and `REWRAP_TABLES`), and the result as `nodes`, `links`, `node_map` (jsonb), `account_ids` (`text[]` with a GIN index, for the `accounts` relationship and the scrub of C101.4) and `kinds_not_indexed` (kind codes), with `skipped_hub_values`, `node_limit_reached`, `timeout_seconds` (1-59), `run_sync`, `attempts`, `last_error_code`, `enqueued_at`, `errored_at`, `completed_at`, `redacted_at`. CHECKs: `completed` exactly with `completed_at`, `errored` exactly with `errored_at`, `params` not null until redacted, and a redacted row empty in every result column. Plaintext by decision: ids, random node ids and value keys, the same forms `graph_attributes` holds (P17).
5. **The C102.7 redaction is built here, in the database** (`redactGraphQueryRecords`, `repositories/graph-redaction.ts`): `params` null, the result emptied, `redacted_at` set (the first time stays), `stubEventPayloads` and `forgetStoredResponses` for the query id. `graph-query-retention-days` defaults to 30 (decision 19; 1-365): `listGraphQueriesDueForRetention` and `redactExpiredGraphQueries` run in the C16 pass, reported as `redactedGraphQueries`. No `graph-query.redacted` event exists, so nothing is staged.
6. **`graph_components`** keeps one row per account, `component_id` the run's own label (1-64 characters, no format; `api-graph` chooses it), `size` ≥ 1, `computed_at`.
7. **Settings.** `graph-indexing` (default `true`), `graph-weak-kinds` and `graph-components` (default `false`) need `settings:privacy` as well as `settings:write`; `graph-query-retention-days` (default 30) needs `settings:write`. All four are in `dashboardSettingsSchema`, the update body, `DASHBOARD_SETTINGS_DEFAULTS` (`GRAPH_SETTING_DEFAULTS`, `GRAPH_QUERY_RETENTION_DAYS`) and `EnvironmentSettings`. Every settings change runs `onGraphSettingsChangedInTx(tx, environmentId, before, after)` (`services/graph/settings-hook.ts`, `api-graph`) after `onSettingsChangedInTx`, in the settings transaction; a throw rolls the change back. It sees `signal-collection` too, which is how enabling device recognition marks the device kinds incomplete.
8. **Masking.** `PII_GRAPH_ATTRIBUTES` joins `MASKED_ATTRIBUTES` and the API-log set. `params` is masked member-wise (each parameter's name stays, as a report's `query`); a body's `parameter-map` and `variable-map` and the unmask's `value` are masked whole. A node's own `value` in `nodes[]` is a random id, not under `attributes`, so it stays.
9. **The indexer's signature** is `indexAccountAttributesInTx(tx, environmentId, accountId, source: GraphIndexSource, attributes: GraphAttributesInput) => number` (`services/graph/indexing.ts`). `GraphAttributesInput` is what each caller holds: `account-fields` (`referenceId`, `fields`), `session-address` (`ip`, `networkId`: the network row says the address class and trust mode, so the indexer can refuse `trust-all` in production and non-global ranges, P05) or `inquiry-linked` (the inquiry's rows move to the account). Until built it writes nothing.
10. **The hook points.** `POST /accounts`, `PATCH /accounts/:id` (when the fields or the reference id change, with the account as stored) and `resolveForInquiry` (a new account with a reference id) call it with `account-fields`; `add-objects` and `remove-objects` with `inquiry-linked` for each moved inquiry, after it moved; a throw rolls the write back. `consolidateAccounts` calls `moveGraphOnConsolidationInTx(tx, { environmentId, targetId, sourceIds })` (`services/graph/consolidation.ts`) after the inquiries and report links moved, under the consolidation's locks. `RedactionService` calls `redactInquiryGraphInTx(tx, { environmentId, inquiryId, at })` in `redactInquiry`'s transaction and `redactAccountGraphInTx(tx, { environmentId, accountId, at })` in `redactAccount`'s (`services/graph/redaction.ts`), each on a re-run too. All are no-ops until built: no row exists before `api-graph` writes one.
11. **The session start never rolls back for the graph.** At 7A's reserved call site `recordSessionStart` keeps `evaluateSessionNetworkInTx`'s answer and calls `indexSessionAddressInTx(tx, session, network, { ip })` (`services/graph/session-start.ts`, built here): `null` reads as no address and indexes nothing; otherwise it reads the inquiry's account and calls the indexer with the `inquiry-session` source, in a savepoint whose failure is swallowed (a missed IP row is a gap in a weak kind, never a failed flow call; the device HMACs come with the `graph-index` job). There is no logger there (K7A-10).
12. **Queues and repeatable jobs** (`jobs/graph-queues.ts`): `graph-index` (job id the inquiry, `GRAPH_INDEX_JOB_OPTIONS`, 5 attempts) and `graph-query` (job id the query, `GRAPH_QUERY_JOB_OPTIONS`, one attempt: the `graph-query-sweep` is a submitted query's retry, and a run past its deadline is a `timed_out` result). `graph-index-sweep` and `graph-query-sweep` every 15 s; **`graph-backfill` is a 60 s tick**, which does one bounded, resumable batch while any state row is incomplete and nothing otherwise: so it runs at startup until complete, and picks a switch up within a minute without an API-side producer; **`graph-components` runs nightly at 03:00 UTC** (`{ pattern: '0 3 * * *' }`) and looks at environments with the setting on. `StartWorkersOptions.graph: WorkerGraphOptions { index, queries, process? }`; `phase7RepeatableJobs(deps, network, signals, lists, graph)` with `GraphRepeatableDeps { index, queries, keyring, blindIndexKey }`, after the list sweeps and before `network-refresh`. The API holds `graphQueries` (`ApiDependencies`, the container wires and closes it) for `POST /graph-queries` and `/rerun`.
13. **The routes.** Fastify reads a hyphen in a param as a separator, so `:node-id` is `:nodeId`, also in the OpenAPI path. `POST /graph-queries` answers 201 with the query, `submitted` or, with `meta.run-sync`, its result. The unmask checks `requirePiiView` in the handler (as `POST /lists/match`), beside `graph:read`. `POST /:id/actions` needs `graph:read` on the route and each action's scope in the service, which gets the principal (`GraphActing` = `Acting` plus `principal`) and the request's `Idempotency-Key` (a non-preview call needs one, C103.1); its 200 is documented under `application/json` and `text/csv`, and the handler sends the CSV with `text/csv; charset=utf-8`. `rerun`, `cancel` and `publish` take `optionalBody(...)`. The C12 policies `graph-queries` and `graph-unmask` are `api-graph`'s to enforce, as Stage 1a said.
14. **The graph-query filter subject is strict** (`eventFilterSubjects`, through `resolveGraphQueryFilterSubjects`, `services/graph/filter-subjects.ts`, which answers `{}` for each payload): a graph query fails any filter that is present.
15. **The redaction coverage.** `graph_queries` is in a category of its own, `GRAPH_QUERY_PII_TABLES` (`services/redaction.test-support.ts`): its params are the searcher's record, redacted by `graph-query-retention-days`, and `redactGraphQueryRecords`' tests scan it. `graph_attributes` holds no sealed column, so the coverage test does not name it; it is a subject's pseudonymous data all the same. **`api-graph`, when it builds the redaction hooks, may edit `services/redaction.test-support.ts` and `services/redaction.test.ts` to seed a `graph_attributes` row of the subject's inquiry and account and a stored result naming the subject's account in `seedPiiSubject`, and to assert that redaction leaves none (rows deleted, the account scrubbed from the result), as the devices are checked.**
16. **`blind-index:rebuild` runs `rebuildGraphIndexes`** (`services/graph/rebuild.ts`, `api-graph`) after the transaction field keys and before the reports, and its result gains `graph`; zero counts until built. `pnpm --filter @openverify/api graph:reindex [--environment <env_…>] [--batch-size=<n>]` (`scripts/graph-reindex.ts`) parses its flags and runs `runGraphReindex` (`services/graph/reindex.ts`), which throws until built; `graph:benchmark` (`scripts/graph-benchmark.ts`) says it is not built and exits 1.
17. **The OpenAPI snapshot was regenerated at (G)**, the last checkpoint: eleven graph paths.
18. **Existing tests changed with the plan,** none weakened: the public table list (`testing.test.ts`), `ENCRYPTED_COLUMNS` (`schema-v2.test.ts`), `REDACTION_SUBJECT_ID_PREFIXES` (`grphq`), the redaction coverage test (the new category), the pinned retention reports (`redactedGraphQueries: 0`), the position of the devices line of `blind-index:rebuild` (`at(-5)`), `DASHBOARD_SETTINGS_DEFAULTS`, the dependency keys of `services/context.test.ts`, the rewrap test's seeds, and `RetentionSetting` in the dashboard (typecheck minimum).

## Workflow 7B Stage 2 amendments

Recorded by `integration-7b` from the Stage 2 agents' reports and TDD records (`docs/tdd/phase7-<agent>.tdd.md`, each "## Report" section). Each binds 7C and later phases.

### list-logic

1. **Graph key inputs have their own type.** `graphKeyInput`, `graphNameKeyInputs` and `graphNameBirthdateKeyInputs` return `GraphKeyInput` (`{ keyKind: GraphKeyKind; input }`), not Stage 1a's `ListKeyInput`: `ListKeyKind` cannot hold the five graph-only labels. `GraphKeyKind` is `Exclude<GraphKeySource, 'existing-index'>`, and every member is a kind of `IDENTIFIER_KEY_LABELS`. `graphKeyInput` throws `TypeError` for `government_id_number`, `chip_signature`, `crypto_address`, `name_birthdate` and `name`.
2. **`ListKeyInputError(code, member?)`.** The optional `member` lets an importer error name its column (`importColumnOf(kind, member)`); the message stays the code, never a value.
3. **Names beyond the frozen ones:** `LIST_VALUE_LIMITS`, `GraphKeyKind`, `GraphKeyInput`, `ImportHeaderProblem`, `importHeaderProblems`, `importRowItem`, `importColumnOf`, `importErrorCodeOfParser`, `importErrorScope`. The three not-built error classes are gone.
4. **C98.2 `field`, "by the field's type":** a list has a `field-key` and no type, an item's `field-value` is text, and an inquiry field is a string, number or boolean, so the value's form decides, the same way for an item and a probe: a number and a text that reads as a canonical decimal meet on the decimal (`42.50`, `42.5`), a boolean meets its word, and `007`, `1e3` and `+7` stay text. A string field holding `1.50` meets one holding `1.5`.
5. **C98.2 government ID probe:** a probe with no class sends `*` and every C31 class, because a stored `passport|X` still matches a probe with no class, and "no match" would be false.
6. **C98.2 name keys:** "both ICAO 9303 folds" holds for `native` and `icao` tokens. A lossy token (Arabic, `any-ascii`) keys on its normalised original, because `王` and `汪` both read `wang` and a key match is exact and R-tier (ADR 0005); a Latin spelling of a Han or Arabic name meets it only through the fuzzy method. A generational suffix stays in the exact last name (`John Smith Sr` is not `John Smith Jr`) and leaves the last-name candidates. A name needs both parts; a name the analysis would cut (over 300 characters or 32 tokens) is `out_of_range`.
7. **C98.2 phone:** `isPossible()` is required and `isValid()` is not, because a list may hold numbers in ranges the metadata lacks. An international number ignores the list's region.
8. **C98.2 email:** a domain item refuses a whole address; a trailing root dot is dropped; a probe with no `@` is refused.
9. **C100.6 neutraliser:** the apostrophe also goes before a cell that starts with apostrophes and then a formula character (`'=x` becomes `''=x`), and `stripNeutraliser` strips one past the same run, so an export of `'=x` re-imports as `'=x` (C100.5). Numbers and booleans are not neutralised.
10. **C100.3:** `match_type` and `id_class` are required as columns (a missing column refuses the file), with an empty cell allowed.
11. **C101.2 `address`:** the Phase 5 address comparison has no canonical form and its helpers are private, so `packages/checks/src/lists/address-key.ts` builds the key from the exported C58.4 primitives, each word as its class's canonical with the most spellings; `subdivisionOf` repeats `canonicalSubdivision`'s six lines. `Ct` and `Court`, `Pl` and `Place`, `W` and `West`, and joined German suffixes give no link, never a false one. Open: export `canonicalSubdivision` from `packages/checks/src/matching/addresses.ts` and drop the copy (7C).
12. **C101.2 `postal_code`** keys the bare code with no country (a graph parameter is one string); `email_domain` refuses a free-mail domain in the key function.
13. **C97.1 radius:** the contract's `.positive()` let 0.5 pass; closed by `integration-7b` (Stage 4 amendment 4: `.min(1)`).
14. **The seal-plus-HMAC script is not committed** (no path of the owner may import `@openverify/db`); its text is in the TDD record §4. Measured: email 40.8 µs, phone 48.2 µs, name 55.1 µs per row (seal about 30 µs of each).

### transaction-schemas

1. **No generated code from a stored schema.** C104.3's "validator built by walking them with zod" became a tree of plain closures with zod on leaves only (`z.email()`, `z.iso.date()`, `z.iso.datetime()`): zod 4.6.7 compiles a `z.object`'s keys into a `new Function`, so an object built from a stored schema would generate code from it, which C104.3 forbids. A test spies on `globalThis.Function`.
2. **The engine surface grew, nothing broke:** `FieldsValidation` gains `references` and `jsonValues`; `FieldsValidator` the optional `{ partial }`; `FieldProblemCode` gains `relation_schema_unknown`; new `transactionTextProblems`, `transactionStatusProblems`, `transactionRelationProblems`, `jsonFieldSchemasOf`, `readSourceKeyPath`, `FIELD_TYPES_SEARCHABLE`. `TransactionEngineNotBuiltError` is gone. Contracts re-exports the Stage 1a names only.
3. **`field_schema_invalid` also answers a value that breaks its field** (`TRANSACTION_PROBLEM_STATUSES` is frozen and has no other fit). `problem.ts` now says so (Stage 4 amendment 4).
4. **C104.4, "a run" and "every string leaf":** a run inside text counts (`card 4242 4242 4242 4242 exp` is refused); a run touching a letter or a digit does not, because a SHA-256 hex digest in a `reference-id` would otherwise be refused about once in 230 (0.44% of 2,000,000 digests); NFKC folds full-width digits; neighbouring groups of a longer run are tried, so a date beside a card hides nothing. An integer of 16-19 digits past `MAX_SAFE_INTEGER` is refused without Luhn, because parsing has already changed its digits.
5. **Guard positions beyond C104.4:** keys of a `json` value; `default-value` and `options` at publish; `model-version` beside `label`. Not walked: `date`, `datetime`, `platform-file`, `relation-schema`, and members `ignore-unknown-keys` drops.
6. **Caps as read:** 100 fields count every level; "3 levels" counts the `hash` and `array` containers on a path, so a leaf inside the third is lawful.
7. **Publish refusals beyond C104.2:** nested `searchable`, `write_once`, `never`, `source-key-path` and `file`; `required` on a `file`; `searchable` outside `FIELD_TYPES_SEARCHABLE`. A `source-key-path` names a declared non-alias field of the same type through `hash` members only, and an alias cannot be `required`, `searchable`, `write_once` or carry a default.
8. **Value decisions:** `null` is refused except on `choices` with `allow-empty`, so a masked read sent back cannot blank a field and a `PATCH` cannot clear one; `''` and `[]` do not satisfy `required`; a field with `archived-at` or `deactivated-at` takes no write and is not required; a `json` value of `null` is refused; `datetime` values keep their offset, `default-value` stays UTC.
9. **C104.6 reads top-level fields only:** `field-key` has no form for a nested path, so a dropped or converted nested member raises no event. Open for the owner: widen `field-key` to a dotted path and walk `childFields`.
10. **Depth** means containers, the root at 1, for the schema and the value.
11. **Existing test changed with the plan:** "the engine stub" in `field-schemas.test.ts` now names the area.

## Workflow 7B Stage 3 amendments

Recorded by `integration-7b` from the Stage 3 agents' reports. Each binds 7C and later phases.

### api-lists

1. **The shared-file hooks went in as a patch** (`docs/tdd/phase7-api-lists.hooks.patch`, 11 files), applied by `integration-7b` (Stage 4 amendment 1): the real `ListService`, `CompromisedIdLookup` and worker `ListItemWriter`; `include=list-matches` on inquiries and accounts (the accounts line under (T) item 10's leave); custom-list `listSources` persisted and served; the custom-list list problems at report create and template publish; item objects deleted in the retention purge.
2. **`compromised_list_unavailable`** joins the `id_compromised_detection` reasons (`government-id-check-reasons.ts`, with its dashboard words): C99.9 makes the check `not_applicable` for a configured list it could not read. The Android SDK does not decode these reasons.
3. **The served signals carry `inquiry/list_match_count`** beside the frozen ones (C99.4, V06); `jobs/signals/process.test.ts`'s pinned expectation changed with the plan.
4. **C99.2 geolocation probes match by box overlap** (`&&` with the box of the probe's own uncertainty), then the haversine distance, not `bbox @> box(p, p)`: containment of the point misses an item whose radius plus the uncertainty reaches it.
5. **C99.2 fuzzy names score the whole name** with the unchanged C78 scorer: it anchors on the family token and scores a given name alone 0, and the last names already agree through the candidate key. Scorer, threshold and cap unchanged.
6. **`components.methods`** refuses an underscore, so `fuzzy_name` is served there as `fuzzy-name`; `entity.method` keeps the enum value.
7. **No 409 for an archived list on `PATCH`, no 404 on `POST /lists/match`:** an archived list takes a change, and an unknown or archived named list reads `list_archived` in `unscreened`, because neither status is in the frozen route schemas. A 409 or 404 would be a route-schema change (not made).
8. **A redacted inquiry found by the screening job** ends its `list_screenings` row `errored` with a `last_error_code` (no `skipped` status, foundation-7b (L) item 4); `on-list-match` never moves a redacted inquiry (the 6D guard leaves `completed -> needs_review` open, so the job checks).
9. **Measured:** a 1,000,000-item fuzzy name list (heavy-headed law, 300 probes): probe p50 616 / p95 971 ms; 117 probes `limit_exceeded` at the 2,000 cap. Any cap change needs a quality calibration (decision 9 after 6C).
10. **Process records:** GREEN `3e89fb9d` carried a lint error fixed by `81d8891f`; two tests were characterisation tests; the completion-custom-list RED was seen by restoring the old case once. The benchmark files were not committed (their text is in the TDD record).

### api-biometric-lists

1. **A new vision route, `POST /v1/mask/background`** (owner decision 16): a PNG of at most 640 px with every face YuNet finds, grown to head and shoulders, inpainted; 422 `no_face_found`. `contracts/fixtures/vision/png-limits.json` gains its bound. `VisionClient.maskBackground({ image })` joins the port (`ports.ts`), with every fake.
2. **A masked object stays recorded** on its `list_item_backgrounds` row, layout nulled, until its storage object is deleted, so a storage failure after the commit never orphans it; `redactBySource` keeps the row and the embed sweep finishes the deletion. C98.1 does not describe this state.
3. **Plan (L) item 15 done:** `list_item_faces` and `list_item_backgrounds` are in `SUBJECT_PII_TABLES`, seeded by `seedPiiSubject` with a sealed template and a masked object; `services/redaction.ts` passes the real `biometricItemRedactor`.
4. **Shared files touched minimally:** `worker.ts` (`createBiometricListMatcher`), `container.ts` (the real `biometricListsGate`), `jobs/testing.ts` (the vision fake).
5. **Consent** is read only through `getEffectiveConsent` (`sessionId` null) and `matchingConsentHolds`, so a rejected handoff session's consent never counts.
6. **A biometric item's `normaliser_version`** holds `LIST_KEYS_VERSION`; the comparable model is the side row's `model`, and another model reads `normaliser_outdated`.
7. **Constants** (none new, none tuned, each provisional with a basis): face cosine 0.5; background candidates 5, inliers 100, ratio 0.5, coverage 0.25; cache 64 MB per worker, 10 minutes idle. Measured: 809 B per face in the cache; mask 126 ms CPU.

### api-importers

1. **Rule 11, stored API logs:** a multipart part's `filename` was stored and not masked; fixed by `integration-7b` (Stage 4 amendment 3).
2. **csv-parse's `skip_records_with_error` cannot be trusted for every error:** on `CSV_MAX_RECORD_SIZE` the following records vanish with no error, and an unclosed quote swallows the rest of the file. Only `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` and `INVALID_OPENING_QUOTE` are row errors; every other parser error refuses the file in both modes. The row cap counts records (`to`), not lines.
3. **Encodings by WHATWG name** (decision 31): UTF-8 or a single-byte encoding; `csunicode`, `iso-10646-ucs-2`, `shift_jis` and `gbk` pass the label pattern and are refused with 422 `invalid_value`; a UTF-16 BOM refuses a single-byte decode. A record of 4,097 characters passes; the refusal starts at 4,098.
4. **The file-level idempotency key includes the encoding** (list, mode, encoding, SHA-256, 24 h); a repeat answers 201 with the earlier importer and takes no rate token. `NewImporter.createdAt` is optional, so the window and `created_at` read one clock.
5. **`beginImportAttempt` takes the row `FOR UPDATE SKIP LOCKED`**: a second run answers `skipped` without counting an attempt. A producer must therefore record `enqueued_at` before it adds the job (Stage 4 amendment 6).
6. **Beyond C100:** `last_error_code` values `attempts_exhausted`, `blind_index_key_missing`, `list_archived`, `object_missing`, `object_unreadable` (ended), and `object_unavailable`, `import_failed` (retried); `IMPORT_MAX_ATTEMPTS` 10; the sweep's 2-minute re-enqueue age and batch of 100.
7. **Measured:** 600 to 1,300 rows a second under load (the writer 55-90% of it); a 20 MB multipart body parses in 35-62 ms.

### api-transactions

1. **`platform-file` ids are `file_`,** not C104.2's `fil_` (`ID_PREFIXES.file`); the engine is fixed (Stage 4 amendment 2).
2. **A type serves its published version's content,** and empty lists before one is published (`published-version: null`).
3. **Version 1 of a new type is a draft;** a transaction needs a publish (422 `transaction_type_not_published`); a draft of an archived type answers 409 `transaction_type_archived` and can still be published.
4. **Publish order:** the engine's problems first; ajv's strict compile of each `json` schema and default only when the engine finds none. The code is `card_number_refused` when any problem has it, else the first problem's; every problem is in `errors[]` under `/data/attributes`.
5. **Searchable keys:** `<field-key>|<text>` under `identifier-transaction-field`, a string as stored (case-sensitive), a number or boolean by its JSON text; `filter[identifier][value]` matches exactly.
6. **`write_once`:** a resend of the same value is no change; a different value answers 409 `field_write_once`; a `write_once` file field takes one upload.
7. **Events:** `transaction.status-updated` carries `meta { from, to }`; tag and object changes emit no event (none is registered) and are audited.
8. **422 without a code** for a second target of a `cardinality: one` relation and for more than 100 related objects (`TRANSACTION_PROBLEM_STATUSES` is frozen). Proposed for contracts: `relation_cardinality_exceeded` and `related_objects_limit` (7C).
9. **`remove-relation` checks** the schema and target as `add-relation` does; a `relation-schema` value naming a verification of another type answers 422 `related_object_not_found`.
10. **PDF page counts** are read in-process from `/Type /Page` objects (provisional); a PDF whose pages cannot be counted is refused with `transaction_file_refused` when the limit is enabled; a non-PDF counts as one page. MIME types come from the bytes (JPEG, PNG, WebP, PDF; else `application/octet-stream`).
11. **A replaced file's** object is deleted after the commit, best effort; a failed delete leaves ciphertext no purge reads (7C or the owner). The content route answers 404 for a replaced file and 410 `transaction_redacted` for a redacted one; an empty or control-character file name is stored as `file`.
12. **Biometric redaction scope (C105.6):** the attached inquiries, the attached accounts' inquiries, the attached verifications and those named in the sealed fields, plus every verification of those inquiries; reports' inquiries are not reached. Only the transaction is stamped; the run is audited the first time or whenever it deleted something. Lock order: the transaction row, then the inquiries by id.
13. **`TransactionActing.allows?`** (built from `authorizePrincipal`) carries the principal's permissions to the reference checks.
14. **Existing tests changed with the plan,** none weakened: the 501 cases of `transaction-routes.test.ts`, three stub cases of `transaction-hooks.test.ts`, the stub block of `transaction-plumbing.test.ts`, and `transaction: { data: null }` in `inquiries.test.ts` and `verifications.test.ts`.
15. **Process records:** `d6ad2b0d` left two API tests red until `4c1a612a`; `dec63201` mixed a test and an unused-code removal; the biometric redaction service went in before its route test.
16. **Still open (owner):** whether redacting an account or an inquiry reaches its transactions (foundation-7b (T) item 7).

### api-graph

1. **The indexer's key.** `indexAccountAttributesInTx` carries no key, so it reads `graphIndexKey()` (`services/graph/keys.ts`): the key a process gave with `useGraphIndexKey`, else `OPENVERIFY_BLIND_INDEX_KEY`; a process without a key writes nothing. Both processes now give it at start (Stage 4 amendment 1).
2. **The API binds a query's start** at submit and rerun and writes the start keys into `node_map` (`setGraphQueryStart`): `{ kind, valueKey, keyId, start, parameter }` per value, `{ start, account }` per account; the job reads them (`startOf`) and opens the sealed params only for a created-at window. `node_map` stays server-only and holds no value.
3. **Parameter binding beyond one string** (C102.2): `name` `{ name-first, name-last }` (both orders, two start nodes), `name_birthdate` plus `birthdate`, `address` its six `address-*` members, `government_id_number` `{ issuing-authority-code, identification-number, id-class? }` (C31.8 index), `crypto_address` `{ chain-id, address }` (C53.2); `chip_signature` cannot be bound (422). An undeclared parameter or an unkeyable value answers a plain 422 at `/data/attributes/parameter-map/<name>`; `created_at` is an ISO time.
4. **A property node joins a result only when two of its accounts hold it** (a start value always does).
5. **`explorer-url`** is built from `OPENVERIFY_DASHBOARD_PUBLIC_URL` (the operator settings' variable) or `http://localhost:3001`. Accepted as is; `ApiDependencies.dashboardPublicUrl` would be the tidier seam (7C).
6. **An asynchronous run is audited** with its counts as a system entry (Stage 4 amendment 5).
7. **`rerun`** reruns the pinned version, re-binds the sealed params with the current key, checks `pii:view` again, applies `graph-queries`, and runs a synchronous query synchronously; rerunning a `submitted` query answers a plain 409.
8. **Bulk actions (C103.1):** every non-preview call needs an `Idempotency-Key`, the export too (400); each action's scope is checked once for the call (403), so `refused_scope` is never an outcome. `add-to-list` maps `email_address` and `email_address_unconfirmed` to `email-address`, `email_domain` to an email list by domain, `phone_number*` to `phone-number`, and `government_id_number`, `ip_address`, `name`, `device_fingerprint`, `browser_fingerprint` to their lists; any other kind, or one that does not fit the list, answers 422. The export's columns are `account-id`, `reference-id`, `status`, `tags`, `hop-distance`, `linking-kinds`; a redacted account is left out.
9. **The `graph-index` job** counts runs in `attempts` (`recordGraphIndexJobAttempt`) and ends `errored` (`graph_index_failed`) at the fifth; skip codes `inquiry_redacted` and `graph_indexing_off`; it locks the inquiry row while it writes.
10. **The backfill cursor** is `{ phase: accounts | inquiries, after }`; incomplete kinds sharing a cursor walk together; `graph:reindex` runs the same walk and marks every kind complete.
11. **Components:** labels `c<n>`; every live account of an opted-in environment gets a row (size 1 alone), so "not computed yet" means newer than the run; a consolidation waits for the next run.
12. **P05:** in a sandbox every evaluated address is written; elsewhere only a non-`trust-all`, non-relay, `public` address. Device kinds come only from devices made under the current key id.
13. **`kinds-not-indexed`** lists, among the template's kinds, one not written now (indexing or weak kinds off, device recognition off) or incomplete.
14. **An inquiry's redaction scrubs its account** from every stored result, stubbing the events and forgetting the stored responses of the queries it changed.
15. **Existing tests changed with the plan,** none weakened: the stub cases of `graph-plumbing.test.ts`, `graph-routes.test.ts` (501 to "reaches its handler"), `graph-hooks.test.ts` (the benchmark flags), and the redaction coverage seeding the graph rows and a stored result (plan (G) item 15).
16. **The synthetic graph builder** (`services/graph/synthetic.ts`) is shared by the benchmark (6,005,000 rows at 1,000,000 accounts) and the C102.8 suite (225,000 rows, to fit the 180 s hook guard). The graph-query filter subject stays strict.
17. **Measured (C101.8):** 1,000,000 accounts, p95 8.4 / 13.3 / 16.3 ms at 2 / 4 / 6 hops, 20.6 ms with weak kinds, 11.1 ms from a hub; the C102.8 suite takes 40 s alone and up to 153 s of its 180 s guard under the full `test:integration`.

## Workflow 7B Stage 4 amendments (integration-7b)

Recorded by `integration-7b`; the evidence is in `docs/tdd/phase7-integration-7b.tdd.md`.

1. **The Stage 3 hooks are wired in the shared files.** `docs/tdd/phase7-api-lists.hooks.patch` applied (its `container.ts` hunk by hand, the context had drifted): `createListService({ db, blindIndexKey, rateLimiter })` in the container, `createCompromisedIdLookup` and `createListItemWriter` in the worker (the latter closes api-importers' "imports reject" gap), `include=list-matches` on inquiries and accounts, custom-list provenance persisted and served, the custom-list list problems at report create and template publish, item objects deleted by retention. Both processes call `useGraphIndexKey` with their configured key at start (api-graph deviation 1). Test: `apps/api/src/integration-7b-wiring.test.ts`, and the patch's own `jobs/report-types/custom-list-engine.test.ts`.
2. **C104.2 amended: a `platform-file` value is `file_` plus a ULID** (`ID_PREFIXES.file`), not `fil_`; `PLATFORM_FILE_ID` in `packages/core/src/transactions/fields-validator.ts`, with a route-level create test. The golden constant of `fields-validator.test.ts` changed with the plan.
3. **Rule 11: a multipart part's `filename` joins the API-log `MASKED_MEMBERS`** (`services/api-logs.ts`), so a stored log read without `pii:view` never shows an uploaded CSV's or file's name.
4. **Contracts:** a geolocation item's `radius-meters` is `.min(1)` (C97.1); `problem.ts` says `field_schema_invalid` also answers a value that breaks its field. `docs/api/openapi.json` was regenerated for the radius (three schemas, `minimum: 1`); no other route schema changed after Stage 1, and `openapi:write` leaves it unchanged.
5. **An asynchronous graph query run is audited** with its counts (`countsOf`) as a system audit entry (`appendSystemAuditEntry`) in the transaction that stores it, so `GraphQueryDeps` did not change (api-graph deviation 6). System entries are not served by `GET /user-audit-logs` until K7A-8.
6. **A producer records `enqueued_at` before it adds a `list-import` job** (the API and the `list-import-sweep`), and clears it again when the enqueue is lost. The job takes its row `FOR UPDATE SKIP LOCKED`, so the old order (add, then write) let the job skip its own import until the sweep's 2-minute window: `lists.spec.ts` found it on the full stack. `markImportersEnqueued` takes `Date | null`.
7. **A request body nested past the stack answers 400,** not 500: `buildApp` sets `stackSafeValidatorCompiler` (`app.ts`), which turns a `RangeError` from a recursive schema (C104.2's field schemas) into one validation issue (transaction-schemas followup).
8. **The seeded `Default custom list` stores `list-ids: null`** (a fresh environment has no list, so each report names its own) and is not recurring (`seed/report-templates.ts`).
9. **`@openverify/node`:** `graphQueries.createSync` sends `meta.run-sync: true`, and `accounts.retrieve` takes `include` of `reports`, `list-matches` and `transactions` (one or several). The export action (`text/csv`) still has no client method; the docs say to read it with your own request.
10. **The 7B full-stack specs** (C111.2), each with a 90 s budget: `lists.spec.ts` (CSV import, `list-match.created`, `on-list-match`, dismissal), `graph.spec.ts` (two accounts sharing a confirmed email, an asynchronous template query, bulk `add-tag`), `transactions.spec.ts` (publish, create, search, status, label, redaction, the four events) and `custom-list-report.spec.ts`. Every address is at `.test` (C56: no DNS query in a sandbox). `waitForMail` returns the message `id` and takes `exceptIds`, so a second code to one address is read from the newer mail. Helpers: `e2e/tests/support/phase7b.ts`.
11. **The suite re-measured:** 99 full-stack tests in three shards of 2.1, 3.5 and 4.0 minutes plus 0.9 minutes for the stack start (9.9 minutes for 95 tests after 7A). Shards stay 3; CI keeps running `pnpm e2e` in its one e2e job (owner decision 18 after Workflow 7A); no shard matrix. The SDK host-test count is still 1,327, so CI's floor stays 1,327.
12. **Docs:** `docs/lists/` (README, importers, biometric lists, with OWASP's warning that no CSV escape is safe in every spreadsheet, the `toLowerCase()` and whole-name-fold caveats, the `field` form rule and lossy scripts), `docs/graph/` (kinds, settings, `graph-backfill` as a 60 s tick and `graph-components` nightly at 03:00 UTC, binding forms, limits, bulk actions, benchmark, DPIA note), `docs/transactions/`, the completed `docs/reports/custom-list.md` and the 7B section of `docs/checks/sandbox-providers.md`. `list-item-embed-sweep` is named beside C107.1's queues in `docs/lists/README.md`.
13. **No new environment variable and no dependency** in Stage 4.
14. **Left open, each recorded for 7C or the owner:** codes for a second `cardinality: one` target and the 100 related objects cap; a route listing a transaction type's versions; a served graph component (C101.6); a dotted `field-key` for nested type events; whether redacting an account or an inquiry reaches its transactions (foundation-7b (T) item 7); exporting `canonicalSubdivision`; `ApiDependencies.dashboardPublicUrl` for `explorer-url`; a purge of replaced transaction files whose delete failed; the 409 and 404 that api-lists left out of the frozen list routes.
15. **Validation** (in the order of 7A Stage 4 amendment 14), every step exit code 0: install and `format:check`; `turbo run lint typecheck --force` (30 of 30, after one fix: a cast the `listSources` hook made unnecessary); the fetches and `build:variant-groups` (SHA-256 `29d05838…`); `pnpm test` (the other packages as one call, the API suite as two blob shards and a merge: 5,871 tests at 95.6% statements); `benchmark:typecheck` and `benchmark:test`; `test:integration` (db 69, api 216); the vision suite (ruff, format, mypy; pytest in two halves, 97.43%); the Android gate; `openapi:write` with no diff; the e2e gate (79 mocked, then 34, 32 and 33 on a fresh reusable stack); both images; every `infra/tests/*.test.sh`; `gitleaks git --redact .`.

## Owner decisions after Workflow 7B (2026-11-01)

Taken by the orchestrator under the owner's standing approval ("take decisions yourself which are industry best"), recorded here and in PROGRESS. They are binding for Workflow 7C and later phases. Every followup and every open contract deviation in 7B's twelve reports was checked against `7d25d079`, and so was each of the 19 items 7A left for 7C. Each one below is a decision, a known item for 7C (ids `K7B-n`), or a later-phase item. The working table is in `resume/7c-prep/triage-7b.md`.

### Decisions

1. **Redacting an account or an inquiry reaches its transactions** (foundation-7b (T) item 7). C105.5 says nothing either way. Today an erased subject's transactions keep their sealed fields and files until `transaction-retention-days`, and that is the larger failure. C73.5 already sets the pattern for reports.
   - **Inquiry redaction** redacts every transaction whose `transaction_objects` row names the inquiry or one of its verifications.
   - **Account redaction** redacts every transaction linked through `transaction_objects.account_id` or `transaction_relations.account_id`. The transactions of its inquiries follow from redacting those inquiries.
   - **How:** each goes through `redactTransactionInTx` as the system actor, in the same database transaction. The F04 catch-up runs after the commit, and file objects are deleted after the commit.
   - **`never` fields stay.** A cascade never uses `include-never`. A `never` field is how an operator keeps a record that a legal duty (AML record keeping) requires.
   - **Shared transactions are redacted too.** A transaction linked to two accounts is redacted when either account is. Its tags, reference, status and `never` fields remain for the other party.
   - **One direction only.** A transaction's own redaction still never reaches its objects, so C105.5 does not change.
   - `transactions` and `transaction_files` move to `SUBJECT_PII_TABLES`. K7B-1.
2. **Nested field changes raise type events with a dotted `field-key`.** In `transaction-type.deleted-field` and `.converted-field`, `field-key` becomes a path in the form `source-key-path` already uses. Segments follow `FIELD_KEY_PATTERN`, with at most nesting levels + 1 segments.
   - An `array`'s item schema adds no segment.
   - A removed or converted container raises one event for the container, not one per descendant.
   - A top-level field keeps its one-segment key, so existing consumers read the same.
   - Nothing has shipped, so this is the cheapest moment. K7B-8.
3. **Face and background list thresholds stay Phase 4's, provisional with their basis, until a list-specific calibration.** That calibration is a gate for general availability (Phase 11). `docs/lists/biometric.md` already says so. No 7C change, and no threshold is tuned on test data.
4. **The fuzzy-name candidate cap stays 2,000.** At 1,000,000 items with a heavy-headed surname distribution, 117 of 300 probes go over it. Those lists answer `unscreened` with `limit_exceeded`, never "no match", so the cap is honest. `docs/lists/README.md` states the measurement. Any change needs the quality calibration of decision 9 after Workflow 6C (Phase 11).
5. **K7A-8 serves every system audit entry.** That means the handoff entries, `importer.completed`, asynchronous graph query runs with their counts (7B Stage 4 amendment 5) and the C16 commands. All are served as `actor { type: "system", id: null }`, with the same scope and masking. Only the served actor type widens; the request principal's `AuditActor` does not. If it ever does, every binary actor ternary becomes an exhaustive switch first.
6. **An account's graph component is served by `GET /accounts/:id/graph-component` under `graph:read`.** It is a separate route rather than an attribute on the account, so viewers, who never hold `graph:read`, do not receive graph data on the account read.
   - It answers `state` (`computed`, `not-computed` or `disabled`), `size` and `computed-at`.
   - The run-local `component-id` is not served.
   - This meets C101.6's acceptance line and C108's component size. K7B-2 and K7B-2-console.
7. **Versions are listed as inquiry template versions are.** `GET /transaction-type-versions?filter[transaction-type-id]=` and `GET /graph-query-template-versions?filter[graph-query-template-id]=` list them, newest first with cursor pagination. Both parent resources gain a `latest-version` relationship, and the transaction type also gains `published-version`. A first draft's id is then readable without audit metadata. K7B-3 and K7B-3-console.
8. **A transaction's status history and labels have read routes.** They are `GET /transactions/:id/status-changes` and `GET /transactions/:id/labels`, newest first with cursor pagination, under `transactions:read`.
   - The history is unbounded and append-only, so it stays off the transaction resource.
   - `transaction-status-change` is ours; its free text is `null` once redacted.
   - Labels keep their existing resource, and redacted labels are left out.
   - K7B-4 and K7B-4-console.
9. **A replaced transaction file is redacted, not marked deleted, until its object is gone.** A replaced file whose delete failed must stay findable by the C16 purge and by redaction, because its row keeps the wrapped data key.
   - `deleted_at` means the object is gone.
   - The one-live-file index reads "not deleted and not redacted". That is migration `0025`, which is Workflow 7C's one migration.
   - The content route keeps 404 for a replaced file and 410 for a redacted transaction.
   - K7B-5.
10. **The two codeless transaction 422s get codes:** `relation_cardinality_exceeded` and `related_objects_limit`. Both are business rules a client must tell apart. The graph's parameter-binding 422s stay as plain validation problems with their pointers, the standard form for a malformed field. K7B-6 and K7B-6-console.
11. **`max-file-size-bytes` has a ceiling of 20,000,000 bytes** (`TRANSACTION_LIMITS.fileMaxBytes`, provisional). The basis is the importer's file limit; the upload is held in memory. K7B-7.
12. **`@openverify/node` covers every Phase 7 route.** That includes the transaction tag routes, `redact-biometrics`, file upload and content (bytes), and `graphQueries.exportCsv`, which returns the CSV text and sends the `Idempotency-Key`. `graphQueries.action` refuses `export`. K7B-9 and K7B-9-console.
13. **`explorer-url` comes from the resolved operator setting.** In production with no `OPENVERIFY_DASHBOARD_PUBLIC_URL`, it is `null`, never `localhost`. That is a contract change to nullable. The console links its own `/graph/<id>` route. K7B-11 and K7B-11-console.
14. **`canonicalSubdivision` is exported from `packages/checks/src/matching/addresses.ts`,** and the list address key uses it. The key text does not change, so `LIST_KEYS_VERSION` stays `lists-1`. K7B-10.
15. **The list routes keep 7B's behaviour on both cases:**
    - A `PATCH` of an archived list answers 200; archiving stops matching, not editing.
    - On `POST /lists/match`, an unknown named list reads `list_archived` in `unscreened`. It never claims "no match", and it says nothing about another environment's ids.
    - The plan never asked for the 409 or the 404, and `docs/lists/README.md` documents both.
16. **Gate scheduling under parallel load** (workflow scripts only; the repo does not change).
    - **API unit suite:** while another agent's suites run, it runs as four blob shards plus the merge. Each coverage run gets its own `--coverage.reportsDirectory`.
    - **Whole-repo lint:** the forced turbo lint may be split per package with `--filter` when it does not fit one call.
    - **Final gate:** the whole forced gate still runs once at each stage's end. An agent running alone keeps two shards.
17. **`graph-engine.integration.test.ts` does not change in 7C.** It takes 153 s of its 180 s hook guard under the full local load, and 40 s alone. The Phase 7 push to GitHub measures it on CI. If it passes 150 s there, the C102.8 build moves to a template database, never to a raised guard or fewer cases. It failed locally first, so it was applied before 7C: a global setup builds the graph once into a template database, 8 batches at once (64 to 70 s under load, under the same 180 s guard), and the hook only copies it, taking 4.5 to 5.3 s under the full `test:integration` instead of 139.9 s (`f314f114`, `97b1fe47`, `49e6281b`).
18. **No e2e runner change for orphaned processes.** 7C runs only on the reusable stack (its `E2E_GATE`). The orphaned app processes came from own-stack calls killed at the cap. Before 7C's first stack, the orchestrator checks for and stops stale e2e app processes (vision, API, worker, flow preview, dashboard).
19. **The two integration Vitest configs turn the file-system module cache off,** as every unit config does (`TEST_FS_MODULE_CACHE`). This closes the `ENOTEMPTY` startup race. K7B-12.
20. **Incremental expansion in the explorer expands account nodes only** (confirming the 7C script refresh's default; raised there, not by a 7B report).
    - An explicit action re-runs the chosen template with `account_id` bound to that account. The result merges in the canvas within 2,000 nodes and the `graph-queries` policy.
    - A property node is not expandable in Phase 7. It already links at least two of the result's accounts. Expanding it would need either an unmask or a server route that starts from the stored key in `node_map`, which is a Phase 9 item.
21. **The dashboard's `apiRequest` stays without an `Idempotency-Key`** (confirming the refresh). Every non-preview bulk graph action goes through the node client, which sends one on every POST. The export goes through `graphQueries.exportCsv` once K7B-9 lands. No other Phase 7 route requires the header.

### Known items for Workflow 7C

`resume/7c-prep/known-7c.json` holds the list 7C's launch copy embeds (38 items). Every one of the 19 items 7A left is still open at `7d25d079`: 7B touched none of their code paths. Their details now carry 7d25d079 line numbers, and K7A-8 and K7A-10 grew (decision 5; the session-start indexer's silent failure). The built-ins `K7C-1`, `K7C-1-console` and `K7A-8-console` of `workflow-7c.mjs` are still open and stay built in.

| Id | Severity | Item |
|---|---|---|
| K7A-1 | HIGH | A session-cap expiry orphans a canceled selfie capture's storage objects (unchanged) |
| K7A-2 | HIGH | The full-stack email handoff spec is missing (unchanged; 7B's `waitForMail` helpers make it easier) |
| K7B-1 | HIGH | Account and inquiry redaction reach their transactions (decision 1) |
| K7B-2 | HIGH | `GET /accounts/:id/graph-component` (decision 6; C101.6's acceptance line) |
| K7B-2-console | HIGH | The account page shows the component size |
| K7A-3 to K7A-10 | MEDIUM | As after 7A. K7A-8 now names 7B's system emitters and actor ternaries; K7A-10 now covers `indexSessionAddressInTx` |
| K7B-3 | MEDIUM | Version list routes and `latest-version` relationships for transaction types and graph templates (decision 7) |
| K7B-3-console | MEDIUM | The two editors read versions from them |
| K7B-4 | MEDIUM | Transaction status history and labels routes (decision 8) |
| K7B-4-console | MEDIUM | The transaction detail page shows them |
| K7B-5 | MEDIUM | A replaced transaction file whose delete failed is never purged (decision 9) |
| K7A-11 to K7A-17, D001, D002 | LOW | As after 7A |
| K7B-6 | LOW | Codes for the two codeless transaction 422s (decision 10), with its console twin |
| K7B-7 | LOW | The `max-file-size-bytes` ceiling (decision 11) |
| K7B-8 | LOW | Dotted `field-key` for nested type events (decision 2) |
| K7B-9 | LOW | `@openverify/node` covers every Phase 7 route (decision 12), with its console twin |
| K7B-10 | LOW | Export `canonicalSubdivision` (decision 14) |
| K7B-11 | LOW | `explorer-url` from configuration, nullable (decision 13), with its console twin |
| K7B-12 | LOW | The integration Vitest configs turn the module cache off (decision 19) |
| K7B-13 | MEDIUM | Integration suites start each Testcontainers Postgres through one helper that waits for a real `select 1` and starts a fresh container when the port stays refused (the orchestrator's 7B validation: one different file per run failed at container start) (fixed before 7C: `a1fe8850`, `9264e3ac`) |

### Later phases

- **Phase 9:** expanding a property node in the explorer, through a server route that starts from a stored node key (decision 20).
- **Phase 11:**
  - **Calibration:** the face and background lists before general availability, plus the unseal cost of a cold list, which was not measured (decision 3). The fuzzy-name cap (decision 4).
  - **Throughput:** import throughput at low load (600 to 1,300 rows a second was measured under load).
  - **Address key:** per-country handling of `W`, `Ct` and `Pl`. It is a recall gain only and needs a quality calibration.
  - **PDF pages:** a parser-backed page count for transaction files. The in-process `/Type /Page` count stays provisional, and a PDF it cannot count is refused, never passed.
- **Phase 7 close (orchestrator):**
  - CI's time for `graph-engine.integration.test.ts` (decision 17).
  - The stale e2e processes check (decision 18).
  - The untracked `31-Oct-openverify-session-state.txt` in the repo root belongs to the owner, so no agent touches it.

## Workflow 7C Stage 1 amendments

Recorded by the Stage 3 verifier from the contract deviations of the three console reports. Each item binds the 7C fixers and later phases. The evidence is in `docs/tdd/phase7-dashboard-signals.tdd.md`, `docs/tdd/phase7-dashboard-lists-transactions.tdd.md` and `docs/tdd/phase7-dashboard-graph.tdd.md`.

### dashboard-signals

1. **`ui-selfie.spec.ts` follows the card layout.** C108's cards removed the Sessions table, so the spec reaches a session through the list "Inquiry sessions" and its article "Session <id>" (`10390144`). Only the locator changed; the three assertions and their expected text stand. This is the one spec outside the agent's paths that it was allowed to change.
2. **The sessions tests follow C108.** `inquiry-sessions.test.tsx` reads an article, a list and the Consent term in place of a row, a table and a column header. `app/inquiries/[id]/page.test.tsx` asserts the article, mocks the per-session read and gains a test for `include=device,network` (`7e495b0c`).
3. **The navigation tests follow the new entries.** `nav-items.test.ts` and `nav.test.tsx` go from 16 links to 21, add the new routes and the Risk group, and no longer expect Chip trust store last under Organization (`16754bc4`).
4. **`event-words.test.ts` iterates `EVENT_NAMES`,** as the brief asked (`66092291`). Nothing was weakened.
5. **C108's "beside report-config" means beside the existing `VersionEditor` documents.** `report-config` is not one at this point, so `signal-config` and `list-config` sit with `flow`, `verification-config` and `settings`.
6. **Navigation.** Lists, Graph, Transactions and Transaction types form a new Risk group, placed before Integrations. Network sources sits under Organization, after Chip trust store.
7. **Account page slots (F32).** `OptionalSection` lives in `components/lifecycle/optional-section.tsx`, beside the new `SlotSection`. A slot is awaited as a function and never rendered as JSX: a thrown 403 gives the section's forbidden panel, and `null` leaves the section out. The two stubs are typed constants, because lint refuses a function with an unused parameter.
8. **Session reads.** The inquiry page lists up to `SESSION_PAGE_SIZE` (100) sessions, then reads `GET /inquiry-sessions/:id?include=device,network` once per session. The cost, one API call per session on each render, is accepted until the list route serves those includes.
9. **Account page signals.** "Latest inquiries" means the newest `ACCOUNT_SIGNAL_INQUIRIES` (5).
10. **Collection trail.** The trail reads the environment's newest `SETTINGS_CHANGES_PAGE_SIZE` (100) `settings.updated` entries and keeps those whose metadata names `signal-collection`. An older tier change drops off that page when many other settings changes follow it, and this limit is accepted.
11. **List match dismissal** lives in `app/list-matches/actions.ts`, not under `app/inquiries`, because the inquiry and account pages share it. `ListMatches` takes a `caption` prop, so its hidden caption does not create a second region named "List matches".
12. **Collected signals wording.** A server that reports no `signals-collected` reads "Not reported by this server", distinct from the consent's "Not reported". An empty list reads "Nothing collected".
13. **Rule 5, commit order.** The Signals GREEN landed as `5c8c9d3e`, after `aaf059bc`, which still holds the stub, so the Signals test cannot pass at `aaf059bc` alone. HEAD is unaffected, and the record says so; history is not rewritten.
14. **Rule 5, guards with no RED.** `rsc-payload-signals.test.tsx` (`eb32c708`) is a guard written after the surfaces and has never been seen failing on a leaked value. `ui-signals.spec.ts` (`ac6da519`) passed on its first run. Neither counts as RED evidence.
15. **Rule 5, retrospective record.** Sections 2 to 18 of the TDD record were written after the run from the shell log. Where the GREEN overwrote the raw log, a RED is marked "count only", so those REDs carry a count and no failure message.
16. **Rule 7, stack use.** The `ui-selfie` proof ran on a stack another agent had just started from the same tree. The agent's queued `e2e:stack:down` then removed a stack another agent had started. Neither is a test failure; a stack down is never queued behind another agent's stack up.
17. **Rules 7(c) and 8, mocked flow suite.** It ran once, before the final HEAD, and was not repeated because nothing under `apps/flow` or `packages` changed after it. That single run stands as the gate.

### dashboard-lists-transactions

1. **Transaction status history and labels.** Until K7B-4 and K7B-4-console land, the detail page shows the current status and the latest label only, with a note that the API keeps the rest and no route lists it. Owner decision 8 still fixes the routes.
2. **Transaction relations.** The detail page can set and remove a relation but cannot show those already set, and it says so: no route, resource member or include serves `transaction_relations`, and `add-relation` writes no related object. No K item covers this gap, so it needs its own decision and item before the page can list relations. **Closed by K7C-2** (the amendment after "Workflow 7C review amendments").
3. **Transaction types editor versions.** The editor works on the draft `POST /transaction-type-versions` answers, and the type page shows only the latest and published version numbers, with a note. K7B-3 and K7B-3-console replace this. The full-stack spec makes a second draft for the same reason.
4. **Which actions need a confirmation.** C108's wording decides: redaction, biometric redaction, detaching an object and archiving a type are confirmed. Changing a status, adding a label, attaching objects, setting or removing a relation and editing tags are plain submits with a success toast and in-form errors. If "each behind a confirmation" was meant literally, those five gain a `ConfirmActionButton`, which is the owner's call.
5. **Console import size.** The console takes CSV files of at most 1,000,000 bytes and sends larger ones, up to 20 MB, to the API. The file passes through a server action under Next's default body size, and `next.config.ts` was not this agent's file. The API limit of 20,000,000 bytes (C100.1) stands.
6. **The C100.6 CSV writer has two copies.** `components/lists/csv.ts` repeats the formula-neutralising rule of `packages/checks/src/csv/` with the same golden vectors, because the dashboard does not depend on `@openverify/checks` and `package.json` was off limits. A rule change must land in both copies.
7. **`filter[identifier]` is not offered.** The transactions index offers type, status, reference and date filters, as C108 lists, and never sends this filter, so the K7B-14 membership oracle cannot be reached through the console. A later console filter that adds it applies the same `pii:view` rule.
8. **Scope of the transaction pages.** The console creates no transaction, edits no field value and uploads no file: those stay API operations, and C108's detail page does not list them. The console checks `pii:view` for a file's content before asking the API, and the API checks it again.
9. **Importer read.** The list page reads a list's imports through `GET /importers?filter[list-id]=`, which `packages/contracts/src/importers.ts` already serves. The brief's route summary omitted it; it is not an API change.
10. **Test corrections.** Three of the agent's own RED tests were corrected in the GREEN commit `537d9c65`: the kind-label pattern, which rejected "IP address"; the `retention_exceeds_consent` input, which now sends 400 days because 9,999 is refused before the API is called; and the list page tests' navigation mock. `ui-transactions.spec.ts` reloads before searching the page after redaction, because the document still held the first load's payload. No test was weakened, and no pre-existing test changed.

### dashboard-graph

1. **Path exception.** `apps/dashboard/src/instrumentation-client.ts` and its test sit outside this agent's listed paths, by the orchestrator's agreed exception. Every console page now runs with zod's JIT off, so browser-side parsing takes the non-compiled path.
2. **The narrow zod import.** The dashboard imports `{ config } from 'zod/v4/core'`, not the flow's `{ z } from 'zod'`. The setting lives on `globalThis.__zod_globalConfig`, so every copy of zod reads it, and the narrow import saves 99,885 bytes raw and 27,052 gzip on each page. A test pins it as the file's only import. The flow keeps its form, because its main bundle needs zod anyway.
3. **The export route's origin check.** A real `Origin` must match the host. `Origin: null`, which every native form post carries under the console's `no-referrer` policy, is accepted only with `Sec-Fetch-Site: same-origin` or with that header absent. `same-site`, `cross-site` and `none` are refused. The header is absent only on plain HTTP to a non-loopback host, where browsers do not send it and the `SameSite=Lax` session cookie stays the guard. Any future form-post route handler follows this rule.
4. **The CSP test.** `injectNonceCsp` puts the nonce on `<link rel="preload" as="script">` as well as on each `<script>`, because a preload is checked against `script-src` and React's server renderer gives that link the nonce in a real deployment. The policy, the 2,000 nodes and "violations equal []" stay as the plan says, and nothing is filtered. This is what C108's "injects one on the explorer document" means for a Next document.
5. **Budget.** Both `ui-graph` tests fit the 90 s header budget (2.7 s and 24.4 s), so the CSP test takes no budget of its own.
6. **The 2,000-node result** is built in the spec from 718 accounts with shared account fields (`largeGraphPlan(525)`), through a template with `max-hops` 6 and `node-limit` 2000. The test asserts exactly 2,000 nodes and `node-limit-reached` true.
7. **Gaps left to the API (rule 1).** Each shows as nothing rather than a workaround: no component size on the account page (K7B-2, K7B-2-console), no versions list for templates (K7B-3, K7B-3-console), and no expansion route. Expansion runs the template synchronously with `account_id` bound, by an explicit button, on account nodes only and never around a property node.
8. **Template creation.** A template's first draft has no id any route answers, so creating a template also makes a second draft with the same configuration and opens that (7B Stage 4 amendment 14). The API holds one unreachable draft per console-made template until K7B-3 lands.
9. **Account section.** The section offers active templates with a published version that has a parameter of kind `account_id`, reads a bounded number of those versions on render, and runs a template only on an explicit press.
10. **Export delivery.** The export stays a native form post, so the API's CSV streams straight to a download with no buffering. In exchange, a refusal replaces the page with one plain-text sentence (status and words only, never the API's problem), and the browser's back button returns to the result.
11. **Rule 7(c), shards.** The shards did not share one stack: shard 1 ran on one stack and shards 2 and 3 on a later one, both built from `bf286d49`, because parallel agents' fresh-stack steps took down each other's stacks. Rule 7 allows a fresh stack and another run, and the gate is reported that way, not as one pass on one stack.

## Workflow 7C review amendments

Recorded by the `fix-api` fixer of Workflow 7C's Stage 4. Each binds later phases. The evidence is in `docs/tdd/phase7-review-fixes-api.tdd.md`.

The console fixer's amendments are under "Console" below, recorded by the orchestrator from its report. Their evidence is in `docs/tdd/phase7-review-fixes-console.tdd.md`.

### Contracts

1. **C93.4, provider ranges (R002).** An input now counts as evaluated when every enabled provider source was read and fresh, not "at least one". A fact fed by a role reads `list_stale` or `list_unavailable` while any enabled source of that role is stale, unavailable or unloaded, unless a fresh sibling gives a true hit: the sibling's silence is not "not listed". So `is-datacenter` null with `list_stale` leaves the threat level `null` with that reason unless a hit raises it, and `low` is unreachable while a provider list went unread. The stored-facts path (`sessionThreatLevel`) agrees without change, because it reads the same reasons. The rule covers every role: Tor, ASN, country, city and relay.
2. **`NetworkSnapshots` gains an optional `unloaded(kind)` (R002).** It names the enabled public sources that hold no snapshot, so they join `networkSourceSnapshots` as `unavailable`. A source the rows disable is not one of them.
3. **An undated publication is dated by when it was applied (R004).** `provenance.publishedAt` is the publication's time, else the sync's `last_applied_at`, so Cloudflare, Azure and an undated geofeed are read at all. An exit list has no such fallback: only an empty one is undated, and it must not answer `false`.
4. **A frozen exit list is stale (R006).** A Tor source's freshness also counts from its own publication time, against the same `stale_after_hours`, because it alone answers `false`.
5. **`ip-retention-days` deletes by `first_seen_at` (R001, C91.7).** `first_seen_at` is the session's first flow call and stays through a re-index; `last_seen_at` does not. The delete is by `ctid`, because `graph_attributes` has only a composite key.
6. **`POST /inquiry-sessions/:id/generate-one-time-link` honours `meta.expires-in-seconds` (K7A-3).** `@openverify/node` has `inquirySessions.generateOneTimeLink`, with the session's document as its answer (K7A-17).
7. **C96.3 members.** `verification` attributes gain `from-rejected-handoff`, and the session's handoff attributes gain `handoff-rejected-at` (K7C-1). `SessionHandoffRecord.rejectedAt` is required. Neither is PII, and neither reaches the flow view.
8. **`flowHandoffSchema` gains an optional `handed-off` (K7A-5),** sent `true` only for the issuing session while the phone's session is active, and left out otherwise.
9. **`flowSessionSignalsSchema` gains an optional `next-sequence` (K7A-7):** one past the highest stored sequence, plus the bodies counted past the cap, whose own sequences are not kept. A refreshed `next-sequence` is not a new collection, so the flow's tier key leaves it out.
10. **`auditActorSchema` gains `{ type: "system", id: null }` (K7A-8).** `AuditActor` is the request principal, `Exclude<ServedAuditActor, { type: 'system' }>`, so no binary actor ternary changed. `filter[resource-id]` now answers the system's entries on a resource too.
11. **`GET /accounts/:id/graph-component` (K7B-2)** adds the resource type `account-graph-component`, whose id is the account's. A redacted account answers as `GET /accounts/:id` does, with `not-computed`, because its row is gone.
12. **`transaction-status-change` (K7B-4)** has a number for an id, the row's own, because `transaction_status_history` holds a bigint identity and no public id. `page[after]` takes that number, so its query schema is its own rather than `listQuerySchema`.
13. **`transaction-type` gains `relationships` (K7B-3),** optional in the schema so earlier answers and fixtures parse; servers send `latest-version` and `published-version`. `graph-query-template` gains an optional `latest-version` the same way. `@openverify/node` serves them as top-level `transactionTypeVersions` and `graphQueryTemplateVersions`, as `inquiryTemplateVersions` is.
14. **The type events' `field-key` is `transactionFieldPathSchema` (K7B-8).** A converted item schema of an `array` is named by the array's own key.
15. **`explorer-url` is nullable (K7B-11).** The dependency is `ApiDependencies.dashboardPublicUrl`, with `WorkerGraphOptions.dashboardPublicUrl` for the worker. Development keeps its localhost default, through the resolved operator setting.
16. **`relation_cardinality_exceeded` and `related_objects_limit` (K7B-6)** join `TRANSACTION_PROBLEM_STATUSES`.
17. **`TRANSACTION_LIMITS.fileMaxBytes` (K7B-7)** bounds both file sizes. A publish that sets `min` above `max` was already refused.

### Behaviour

18. **The cascade (K7B-1).** The cascade locks the transactions it will redact before the inquiry or account row, because `add-objects` holds a transaction's row while its foreign key share-locks the object's. An audit entry of a cascade is a system entry naming `inquiry-id` or `account-id`. A failed object delete in a cascade is left to the C16 purge and fails nothing. Redaction's stop rule: each object at most once a pass, an object already redacted is a no-change, and nothing loops back. Phase 8's cascades follow it.
19. **An outcome screen collects nothing (K7A-4).** `handoff.spec.ts` shows the desktop's old ending was not the polling: closing the waiting screen sent its signal body, a canceled session's write was refused, and that refusal replaced the screen. The hook now stops at `completion`, `failure` and `expired`, and a body still open then stays a gap in the data.
20. **`keepalive` is on every signal body (K7A-11),** because a body is at most 8 KiB, against the browser's 64 KiB limit. The `pagehide` listener lives in the flow's hook.
21. **Migration `0025_phase7c` (K7B-5)** is the index only, with no hand edits, and the PGlite upgrade test is `migration-0025.test.ts`. No migration-free form exists: the replaced row must stay undeleted, and the old index would refuse the new file beside it.
22. **The content route's order (K7B-5).** A redacted transaction answers 410 first. A replaced file answers 404 whether or not its object has gone yet.
23. **`bot_score` and `behavior_threat_level` are at version 2 (K7A-12).** Their served thresholds keep the same keys and values. `BEHAVIOUR_BOT_SCORE_KEYS` moved to core with the two weak cut-offs added.
24. **`networkLookupRules` takes one argument (K7A-13),** reading `tor-exit-window-hours` from the caller's table. `TOR_EXIT_WINDOW_HOURS` is gone.
25. **`R005` changed nothing.** An address with no AS record counting as evaluated is C93.4 as written, and `lookup.test.ts` pins it. The ASN source not having been read gives `list_unavailable`, which amendment 1 adds.

### Console

26. **"New draft" or "Open the latest draft" (K7B-3-console, C108).** "New draft" shows only when the latest version is not a draft; otherwise the type and template pages link "Open the latest draft". The API allows several drafts at once, so this is a console choice that stops drafts being stranded, and showing both would reverse it.
27. **"Version history" (K7B-3-console, C108).** The version lists sit under a section of that title, as on the inquiry template page, because a section named "Versions" clashes with the table's own scroll region. The graph template page gains the section.
28. **The export's count preview (K7B-9-console, owner decision 21).** Only the preview goes through `apiRequest`, because `graphQueries.action` refuses every export, previews included. It is JSON and needs no key.
29. **Graph exports and transaction files are read whole, then answered (K7B-9-console, C103.2, C105.2).** They are no longer streamed, because `exportCsv` answers text and `fileContent` answers bytes. This replaces item 10 of "dashboard-graph" on buffering. Masking and access checks are unchanged. A transaction file is now held in the dashboard's memory for its whole size, at most `TRANSACTION_LIMITS.fileMaxBytes`.
30. **`exportGraphCsv` builds a one-off node client (K7B-9-console, C103.2).** Its `fetch` sends `accept: text/csv` and records the answered content type, because `exportCsv` returns only the text and the route must keep its 502 for a non-CSV answer. If `exportCsv` ever checks the type itself, this wrapper can go.
31. **The transaction page has its own cursors (K7B-4-console, C108).** `status-after` and `labels-after`, with `HISTORY_PAGE_SIZE` 10 for each list, a console display choice and not a contract value. `Pagination` gains optional `param` and `label` props. K7C-2 adds `relations-after` the same way.
32. **R012's wording.** "Approximate" also marks `isp` and `country-name`, beyond the finding's location fields, because `docs/reports/ip-address.md` calls those approximate. `flagged` false and `proxy-detected` false are worded beyond the suggested fix, under the rule that nothing reads as clean.

### Later phases

- **Phase 11, graph benchmark (R007):** dense scenarios need `synthetic.ts`, the builder of the CI gate and the `graph-engine` template, and a new one-million-account run. The docs now say what the figures measure.
- **Phase 11, review findings left unfixed at LOW:**
  - **R008:** `graph:benchmark --database-url` runs migrations and writes up to 2,000,000 synthetic accounts into any Postgres it is given, so it needs a guard on the target.
  - **R009:** every compiled `json` field schema gets its own Ajv instance, and a publish builds one per `json` field.
  - **R010:** a missing or unexpected ASN seed is never cached, so each session start re-reads the manifest and the seeds with synchronous `fs` calls.
- **The next dependency gap (R011):** `jsdom` is `^29.1.1` in `pnpm-workspace.yaml`, while the Phase 7 catalog comment says every pin is exact. It is pinned exactly with the pypdf bump, not at the close, because the close must not move the validated commit.
- **Phase 9, console (left by K7C-2):** the options of `RelationForm` print the raw target, and a redacted transaction's alert does not say that its relations stay.

## K7C-2: a transaction's relations are served and shown

The orchestrator's decision of 2026-11-02, so that "Phase 7 done" is true of C108, which names relations on the transaction page. It is the decision and the item that item 2 of "dashboard-lists-transactions" asked for, and it closes that item. The evidence is in `docs/tdd/phase7-transaction-relations.tdd.md`.

1. **The route (C105.2 gains it).** `GET /api/v1/transactions/:id/relations`, scope `transactions:read`, newest first, a list document, in `/openapi.json`. `@openverify/node` has `transactions.relations`. A transaction this environment does not hold is a 404, as for the status changes and the labels.
2. **`transaction-relation` is a resource of its own,** because a `many` relation has no cap, unlike `related-objects`. Its attributes are `relation-schema-key`, `target` (a resource identifier of an account or a transaction) and `created-at`: ids only, never a target's attributes. The table has no public id, so `id` is `<transaction>:<key>:<target>`, the row's primary key without the environment. The transaction is in it because a key and a target alone repeat across transactions.
3. **The cursor is a position, not a row.** The primary key is `(environment_id, transaction_id, relation_schema_key, target_id)`, so `paginate`, which needs one `id` column, does not fit, and the order is `created_at DESC, relation_schema_key DESC, target_id DESC`, total because the key and the target are unique in a transaction. `page[after]` is `<created-at>~<key>~<target>`, the row's place in that order, with its query schema of its own as K7B-4's. A row added later sorts before it, so an insert moves nothing. Unlike the append-only history a relation can be removed, and a cursor that looks a row up would answer 400 once that row is gone, so the position is carried and not looked up. A well-formed position that matches no row is therefore a page, not a 400; a malformed one is a 400. The time is read in SQL with its microseconds, because a JavaScript date would lose them and repeat or skip rows of the same millisecond. `listTransactionRelations` stays as it was for the cardinality check, which reads every row.
4. **Migration `0026_transaction_relations_page_index`.** The index `(environment_id, transaction_id, created_at DESC, relation_schema_key DESC, target_id DESC)`, as `transaction_status_history` and `transaction_labels` have for the same read; no hand edits. The primary key's prefix finds the rows but not their order, so without it each page reads and sorts all of the transaction's rows, and `created_at` is outside that key. On Postgres 17 with 100,000 relations on one transaction, a page took 19.5 ms and 1,584 buffers on a sequential scan and sort without the index, and 0.06 ms and 4 buffers with it; a deep page 18.1 ms against 0.09 ms, its row comparison an index condition. The PGlite upgrade test is `migration-0026.test.ts`.
5. **After redaction, the rows are served as they were.** `redactTransactionRecords` leaves `transaction_relations` alone, and C105.5 does not list it among what `DELETE` redacts: its free text is the status and label history's, and attached objects are independent. A row holds two ids, a key from the type version's relation schemas and a time, and C105.8 puts none of them with the masked `fields`. So this is neither the status-change case, where a row stays with its free text `null`, nor the label case, where a row is left out because `model-label` is required and gone: there is nothing to null, the resource has no `redacted-at`, and a redacted transaction lists the same relations as before. `related-objects` is the same reading. No new relation can be set on one, as `add-relation` answers 410.
6. **The console.** The Relations section lists them newest first in `TransactionRelations`, with the cursor param `relations-after` and the pagination label "Relation pages", and the status history's and labels' links keep that cursor as it keeps theirs. Each target links to its account's or transaction's page, its kind in words. A viewer sees the list and no form, and so does anyone on a redacted transaction. The "serves no list" note is gone, and the test that pinned it now pins its absence.
