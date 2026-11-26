# Phase 5 plan: resolution of the three reviews

Section numbers refer to the revised `phase-5.plan.md` (contracts C50–C68; decisions 1–47). Repo facts each finding relies on were re-checked at `440d5cf` before acting; the one finding shown wrong is rejected with its evidence.

| Review | Findings | Fixed | Fixed in part (rest deferred) | Deferred | Rejected |
|---|---|---|---|---|---|
| Privacy and security (P) | 27 | 27 | 0 | 0 | 0 |
| Check honesty and coverage (H) | 37 | 35 | 1 (H31) | 0 | 1 (H27) |
| Feasibility and fit (F) | 24 | 24 | 0 | 0 | 0 |

## Privacy and security

| Id | Sev | Disposition |
|---|---|---|
| P01 | HIGH | Fixed in C62.2 (`dataGroups` gains `missing_from_upload` from the signed SOD's list), C62.5 (the submit guard requires every DG among 1, 2, 14, 15 the SOD lists) and C62.6 (DG15 listed but no AA response: `active_authentication_withheld`, review; no DG15 listed: `chip_auth_not_server_verifiable`; a well-formed response that fails: `active_authentication_failed`); tests in C65.3. |
| P02 | HIGH | Fixed in C51.1 and C62.6: chip authentication, MRZ comparison (`not_requested` when the flow has no ID step, instead of a publish rule) and selfie comparison are required by default; `seen_before` became a required repeat check (`id_nfc_repeat_detection`) whose metadata counts earlier sightings. The "advisory failure raises to review" alternative was not needed once the binding checks are required. |
| P03 | HIGH | Fixed in C53.7 and C52.8: PII marks on attribute schemas build `PII_VERIFICATION_ATTRIBUTES`, which `auth/pii.ts` and `services/api-logs.ts` consume (Stage 1b `foundation`); a schema-walking test, a collision test (no bare `name` or `domain`), and a masking test per type across the four exits. Document values sit under `fields`, which both lists already mask member-wise. |
| P04 | HIGH | Fixed in C60.2 (a sandboxed child: rlimits including `RLIMIT_NPROC`, `PR_SET_NO_NEW_PRIVS`, our own seccomp filter without network or `execve`, empty environment, 64 MiB output cap, pydantic validation; XMP by a bounded scan with no XML parser; hostile-XMP tests; a no-socket test), C60.4 (JPEG 2000 decodes through the same child, 4 MP header-first cap) and `integration-5b` (vision on an internal network, non-root, read-only, `cap_drop: [ALL]`). |
| P05 | HIGH | Fixed in C62.7 (trust-store fetches through the outbound client with fixed private-network refusal, no redirects, size and time caps; "national" checked on the parsed host; CRL signature, `thisUpdate`/`nextUpdate` and non-decreasing `cRLNumber` verified; PA never fetches, with a test) and C54.6. |
| P06 | HIGH | Fixed in C53.3 (`trust_anchor_memberships` with `last_seen_at`, `withdrawn_at`, per-source `list_signing_time`) and C62.7 (one transaction under a per-source advisory lock; withdrawal when no enabled source lists an anchor; `trust_anchor_withdrawn`; per-source rollback; tests). |
| P07 | HIGH | Fixed in C54.6 (`OutboundHttpClient`, GET and POST, `allowPrivateNetworks: false` fixed and never read from the webhook flag, no redirects, response and content-type caps, errors without URL or body, no proxy; a test per client). One deviation: `evmRpc` may reach private networks in production through its own variable, because its URLs are operator configuration, not user input (decision 22). |
| P08 | HIGH | Fixed in C61.2 (cache only non-personal fields for at most 1 hour; persons never cached and re-queried; a test scanning Valkey keys for the sandbox officer) and C53.5. |
| P09 | MEDIUM | Fixed in C55.5 (reserve-then-compare as `reserveMfaChallengeAttempt`, verified at `packages/db/src/repositories/mfa.ts:428-454`; a result object so the counted attempt commits with the 422; a 20-per-day destination guess budget, fail closed). |
| P10 | MEDIUM | Fixed in C55.7 (`otp-ip-hour` keyed on IPv4 or the IPv6 /64; a startup warning when an SMS sender is bound and `trustProxy` is false, verified default `config.ts:346`; docs). |
| P11 | MEDIUM | Fixed in C55.6 (GCRA consumed before taking the locks, then re-checked under them) and C55.7 (a per-country share of the budget, an install ceiling, an audit entry when the budget trips, shown on the settings page); decision 14. |
| P12 | MEDIUM | Fixed in C55.4 (`otp_already_confirmed`), C55.6 (the post-send conditional update under the lock order) and C55.3 (a code whose KEK left the keyring reads as expired); race tests under C53.6. |
| P13 | MEDIUM | Fixed in C55.11 (POST search with the number in the body; registered only with the sandbox sender bound outside production mode; a new `sandbox:read` scope, decision 13; the sink stores the code and destination index only; tests that the route is absent in production and no number is logged). |
| P14 | MEDIUM | Fixed in C53.8 (no generic root keys; personal data only under `pii`, an ESLint rule, specific worker keys; tests at depth 0, 1 and 2; errors carry codes only). |
| P15 | MEDIUM | Fixed in C52.1 (the precondition table, verified against `services/flow.ts:419-424`) and C54.1 (`requireFlowVerification`, called first by every new route; a contract test over the OpenAPI document). |
| P16 | MEDIUM | Fixed in C52.4 (`CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE` excludes server-written kinds; a 422 test per kind), C54.1 (`storeServerFile` deletes the earlier file on every run) and `api-document` (the dashboard file route keeps size, SHA-256 and per-kind signature checks and serves a server-generated filename). |
| P17 | MEDIUM | Fixed in C62.8 (a mandatory `environmentKind` on the anchor loader with the filter in SQL; `emrtd` receives filtered anchors; `seed:dev` refuses production; a UTO-in-production test). |
| P18 | MEDIUM | Fixed in C57.4 and C57.5 (contract wallets pass only with `allow-contract-wallets` or an equal expected address, else review; `gas` 500,000, a 32-byte exact result, a 4 KiB response cap, one call per submit; the docs say a contract wallet proves control of a contract); decision 20. |
| P19 | MEDIUM | Fixed in C62.1 (RSA, exponent, field-size bounds; explicit parameters only for allowlisted curves; a per-verification time budget) and C62.2 (DSC and CSCA profile checks); profile violations go to review (`certificate_profile_invalid`), because issuers ship defects; tests in C65.3. |
| P20 | MEDIUM | Fixed by decision 30 (an exception for security releases of hostile-input parsers proposed to the owner; until decided, the pins run inside the sandboxed child, PDFium 8076's CVE status is recorded in Stage 1 of 5B, and a fixed build is adopted the day it is 14 days old) and C55.8 (a test feeds the three nodemailer advisory payloads). |
| P21 | LOW | Fixed in C52.3: the route is `POST /verifications/:id/inputs`, so the flow CORS stays at GET and POST (verified `routes/flow/index.ts:175`). |
| P22 | LOW | Fixed in C53.4 and the Starting point: `REWRAP_TABLES` and `ID_COLUMNS` (`repositories/key-rotation.ts`) for `kek:rewrap`, `SUBJECT_PII_TABLES` in `redaction.test-support.ts` for the coverage seed. |
| P23 | LOW | Fixed in C53.3 (the AA response cleared after processing; `chip_reads` keeps DG1 fields only), C52.4 (DG11 and DG12 not taken), C53.6 (docs advise `inquiry-retention-days`, verified default null) and decision 43. |
| P24 | LOW | Fixed in C53.2 and C53.3 (every table with `environment_id`, both composite FKs and `unique(environment_id, id)`; a migration test). |
| P25 | LOW | Fixed in C63 (the compose environment split per service; the new secrets in the secret-scan list and the startup redaction test). |
| P26 | LOW | Fixed in C55.9 and C57.2 (host and URI from `OPENVERIFY_FLOW_PUBLIC_URL`, never request headers, tested; the organization name also loses URLs and runs of 4 or more digits). |
| P27 | LOW | Fixed in C52.3 (C0 and bidi characters stripped before sealing; per-registry number formats), C58.7 (input caps in the library API, `eslint-plugin-regexp`, a 100 KB timing test) and C61.2 (registration numbers `encodeURIComponent`-ed). |

## Check honesty and coverage

| Id | Sev | Disposition |
|---|---|---|
| H01 | HIGH | Fixed in C51.1 and C62.6 (the selfie comparison, the MRZ comparison and a new reuse check `id_nfc_repeat_detection` are required by default), C51.1's honesty paragraph and "What a pass means", and C65.5 (a replayed chip with another face must not pass). |
| H02 | HIGH | Fixed in C62.2 and C62.3: integrity is "broken" (so `failed`) only when an AKI-chosen anchor verifies the DSC, the SOD parsed cleanly, and the SOD signature or a DG hash fails; a DN-only match that does not verify, a malformed SOD and other gaps are "not established" (review). CSCA-rollover fixtures with and without AKI in C65.3. |
| H03 | HIGH | Fixed in C59.6 (the worker creates and submits, or skips, the silent AAMVA verification from the government ID's decision transaction; skipped only once the ID step is final), C52.2 and C52.6 (409 `verification_created_by_server` for a client create or submit) and C50.5 (open until then; tests). |
| H04 | HIGH | Fixed in C51.1 and C59.5 (`aamva_identity_comparison`, ours, required, fails `record_mismatch` on any mismatched field outside `ignored-fields`; sandbox `0002` now fails it; DLDV's birthdate coverage noted in C59.4). |
| H05 | HIGH | Fixed in C58.1 (groups are met, unmet or undecidable; an identity check fails only when every group is unmet, else `insufficient_data`), C50.4 (database groups may name only collected fields), C52.3 (an input every business group names is required) and the tests in C58.1. |
| H06 | HIGH | Fixed in C57.4 (`eth_getCode` decides; ERC-1271 for code; `signature_inconclusive` without RPC), C57.1 (Solana `on-curve`, off-curve answers `ownership_proof_unsupported`; every Bitcoin script or form outside the implemented set is inconclusive) and C57.6 (a Safe-shaped vector and an off-curve key). |
| H07 | HIGH | Fixed in C55.6 (a send after the cap, or any request after the last code expired with no sends left, submits the verification as `otp_not_confirmed`, user behaviour), C57.2 and C62.5 (the 11th challenge cancels the verification as a retryable attempt) and C64.1 ("start again"). |
| H08 | HIGH | Fixed in C51.1 (`document_expired_detection` becomes user behaviour), C51.2 (`document_expired` frozen with strings), C60.6 (`feature_absent` only from the document feature table for an established class; the cascade gates it) and C50.9. |
| H09 | HIGH | Fixed in C60.6 (`document_type_not_accepted` only for a recognised class outside the list or `other` on a positively identified identity document; every other `other` or `unknown` goes to review) and C60.5 (other languages and scripts are `unknown`; covered languages in the docs). |
| H10 | HIGH | Fixed in C60.1 (`visible` per text-layer line), C60.5 (visible lines only; OCR wins a disagreement or `input_missing`; two different labelled issue dates are `input_missing`) and C65.2 (the old bill with an invisible recent date). |
| H11 | HIGH | Fixed in C60.1 and C60.6: DocumentID ≠ InstanceID dropped; ModDate replaced by "CreationDate earlier than the printed issue date"; linearization-aware revisions; only dangerous actions counted; DSS and DocTimeStamp increments excluded; weak cues capped at 0.45 in total; genuine-variant fixtures in C65.2. |
| H12 | HIGH | Fixed in C61.2 (a status table per source: LAPSED and PENDING_ARCHIVAL go to review unless `fail-on-lapsed-lei`; RETIRED, MERGED, INACTIVE and expirations fail; ANNULLED and DUPLICATE are no record; Companies House and EDGAR rows). |
| H13 | HIGH | Fixed in C61.4 (an answer only for the host itself or `www.`; a shorter answer is `domain_age_unavailable` with `subdomain`) and C61.6 (`shop.old.example`). |
| H14 | HIGH | Fixed in C51.1 and C61.3 (a factual required core, `business_website_resolution_detection`, ours; domain age advisory) and decision 26. |
| H15 | MEDIUM | Fixed in C62.2 to C62.4 (integrity apart from revocation; data checks judged on integrity, failing on a mismatch but never passing without it), the Risks row and decision 39 (the expected share and CSCAs without distribution points), and `docs/checks/nfc.md` through `integration-5b`. |
| H16 | MEDIUM | Fixed in C62.5 and C62.6 (the submit guard requires listed DG14 and DG15; AA support derived from the SOD). A withheld response gives `active_authentication_withheld` (review) rather than a failure: a genuine read can lose the response (an unreleased JMRTD fix for AA under AES secure messaging, research §7.1). |
| H17 | MEDIUM | Fixed in C57.4 (the statement passes only when the address check verified the signature over exactly those bytes, else `input_missing`). |
| H18 | MEDIUM | Fixed in C51.1 (the address check becomes user behaviour, category `fraud`; hints frozen), C57.2 (the expected address enforced at challenge creation), C52.3 (registration-number formats per registry) and decision 21. |
| H19 | MEDIUM | Fixed in C50.4 (`chains ⊆ allowed-chains` at publish) and C57.2 (the challenge route refuses a chain outside `allowed-chains`). |
| H20 | MEDIUM | Fixed in C58.1 and C58.2 (two scripts give `missing` with `script_mismatch`, undecidable) and C61.7 (business identity takes the best level over `legalName` and every `otherNames` entry). |
| H21 | MEDIUM | Fixed in C58.4 (the four address levels and their tests). |
| H22 | MEDIUM | Fixed in C60.6 (the cascade and its contract test; specific reasons for password-protected, too large and too many pages; a killed worker is `execution_error`), C51.2 (frozen reasons; `issue_date_in_future` removed) and C60.5 (a future date beyond one day and an ambiguous numeric date are `input_missing`). |
| H23 | MEDIUM | Fixed in C60.5 (temperature, θ, margin, weights and repeat cap fixed as provisional values, not to be tuned on the generated set), C60.7 (a held-out set written by `fixtures-5b`, including blank US federal forms; a published confusion matrix) and decision 18. |
| H24 | MEDIUM | Fixed by decision 16: `document_name_comparison` is required by default (C51.1); the alternative is recorded. |
| H25 | MEDIUM | Fixed in C61.5 (per-feed refresh time and count; a feed not loaded or stale gives `execution_error`; `urls` feeds match the exact host only). |
| H26 | MEDIUM | Fixed in C59.5 and C59.6 (silent source: `skipped`, through `submitted → skipped`, C50.7; form source: `on-jurisdiction-not-participating`, default review) and C50.9. |
| H27 | MEDIUM | Rejected. The template schema already refuses a type configuration without an enabled, required check: `packages/contracts/src/inquiry-templates.ts:87-93` (`'needs at least one enabled, required check'`), applied to every present type; so a template that reaches `decideVerification` with no required check cannot be stored. The plan now cites the rule (Starting point, C50.4) and covers the new types with it. |
| H28 | MEDIUM | Fixed in C50.4 (in production, a database or AAMVA step with an unbound kind, or an NFC step without a non-sandbox anchor, needs `accept-review-without-provider`, else 422 `provider_not_configured`). |
| H29 | LOW | Fixed in C51.2 and C59.3 (`no_reference_data` without prefill; `not_requested` only for fields the step did not collect). |
| H30 | LOW | Fixed in C58.2 and C58.6 (differing suffixes or legal forms cap the level at `partial`). |
| H31 | LOW | Fixed in part. (b) the reason becomes `associated_person_not_on_register`, the PSC threshold documented (C51.2, C61.7); (c) a "What a pass means" section per type (C51.1, C66). (a) is deferred: the full `cik-lookup-data.txt` needs a local index with a daily refresh, and a miss on listed-only data is `no_registry_record` (review), never a failure; decision 47. |
| H32 | LOW | Fixed in C62.6 ((a) compare only with an ID of the same document code and issuer; (b) OCR confusables tolerated when the printed check digits failed), C62.2 ((c) the DG1 issuer agrees with the DSC and CSCA country, else not established) and C51.1 ((d) the description rewritten). |
| H33 | LOW | Fixed in C57.2 ((a) canonicalisation; (c) `require-evm-checksum` at challenge creation), C50.4 ((b) `xrpl:0` refused while the address check is required) and C57.4 ((d) unknown envelopes are inconclusive). |
| H34 | LOW | Fixed in C51.3 (a source for every default, "ours" where there is no external basis) and C60.5 (the classifier constants). |
| H35 | LOW | Fixed in C50.8 (published categories from the research tables, for example `selfie_pose_detection` `fraud`, verified at `docs/research/phase4-selfie-behaviour.md:390`; a test lists the overrides). |
| H36 | LOW | Fixed in C50.9 (a row for each dropped identifier or behaviour). |
| H37 | LOW | Fixed in C50.9: `issuing-authority`, `name-first-match`, `name-last-match`, `backlink-count`, `backlink-threshold` adopted; `spam_source` kept (reason codes are snake_case by `reasonCodeSchema`), `no_expected_address` and `no_expected_statement` not adopted and the R5 divergence recorded, each with its reason. |

## Feasibility and fit

| Id | Sev | Disposition |
|---|---|---|
| F01 | CRITICAL | Fixed in C54.1 to C54.4 (per-type job, guidance, attribute, submit and cancel hooks; `settleInquiry` moved out; wiring of providers, blind-index key, Valkey and the outbound client; `Mailer.configured` and `{ address }`; `storeServerFile`; the repeatable-job registry in 5B Stage 1) and the rule that builders never edit the listed shared files (C54, Rules). Facts verified (`process-verification.ts`, `context.ts`, `mail/index.ts`). |
| F02 | HIGH | Fixed in C54.2 (Stage 1b stubs declare final schemas; only handlers answer 501; only the integration agent regenerates the snapshot, `@openverify/node` and API fixtures). Verified `openapi.test.ts:31-36`. |
| F03 | HIGH | Fixed: 5A Stage 1a `contracts` and Stage 1b `foundation`, Stage 2 checks and clients, Stage 3 API agents with their jobs; migrations 0016 (enums), 0017 (5A), 0018 (5B). |
| F04 | HIGH | Fixed in C59.6 (the skip is written in the government ID's decision transaction, and that job's settlement settles the inquiry) and C52.2 (a `skipped` attempt blocks creation); test rows in C50.5 and the e2e case with AAMVA last. |
| F05 | HIGH | Fixed in C52.8 and C54.1 (`services/attributes/<type>.ts` assigned to each API agent in 5A and 5B, with masking, redaction and event tests) and Acceptance. |
| F06 | MEDIUM | Fixed by the staging: the API agents run in 5A Stage 3, after `checks-contact-crypto` wrote the validators. |
| F07 | MEDIUM | Fixed in C53.8 (no generic keys; `pii` or specific names; a test that `err.message` and `err.code` survive). Verified `jobs/logger.ts`. |
| F08 | MEDIUM | Fixed in C62.1 and decision 37 (`asn1js@3.1.0` used because already locked; a one-version lockfile test; the condition reworded). Verified the workspace sets no `minimumReleaseAge`. |
| F09 | MEDIUM | Fixed in C62.1 (`emrtd` depends only on core; `parseDg1` returns lines; the job calls `parseMrz`). |
| F10 | MEDIUM | Fixed in C59.4 (marked a C35 amendment; `id_aamva_database_lookup`'s answer for the new outcome; Stage 1a owns it; changed sandbox endings listed). Verified `inputs.ts:36` and the exhaustive switch. |
| F11 | MEDIUM | Fixed in C61.1 and C63 (unset or empty means the default; test and e2e environments set `none`; per-kind validity; a config test). Verified `providers/index.ts:113-115`. |
| F12 | MEDIUM | Fixed in C65.5 (≤ 90 s per spec, upload fallback for prerequisites, the tampered DG1 as a second attempt, cooldowns outside e2e, ≤ 6 sends per run, measured timeouts or shards, the CI e2e job's data and fixture steps). |
| F13 | MEDIUM | Fixed in 5B: `clients-5b` replaces the two client agents; `fixtures-5b` owns the POA generator, hostile set, held-out set, JP2 and TD3 page. |
| F14 | MEDIUM | Fixed in 5C: three dashboard agents with their own mock routes and e2e helpers; `fix-other` replaces two fixers; the verifier records 5C amendments. |
| F15 | LOW | Fixed in C56 and C67 (`.dockerignore` re-includes the data files; the image-context test extended). Verified `.dockerignore`. |
| F16 | LOW | Fixed in the Starting point (where `AamvaLookupResult` and `SUBJECT_PII_TABLES` live), C62.8 (`src/seed/dev-seed.ts`), C67 (the private helpers exported or wrapped), C52 (route files named by API type, `inputs.ts`), and Stage 1a's re-verification of the facts after 4B. |
| F17 | LOW | Fixed in C65.3 (`now` parameter), C62.8 (the seed's CRL around now) and C65.5 (the TD3 page through a one-sided ID step). |
| F18 | LOW | Fixed in C65.3 (key-size caps, memoisation, a generation-time test). |
| F19 | LOW | Fixed in C55.7 (limits against real Valkey; cooldowns and expiry on the application clock). Verified `rate-limit/index.ts:35`. |
| F20 | LOW | Fixed in C52.7 (problem fixtures under `problems/flow/`, Android's test restructured in Stage 1a; a later code is an integration amendment). Verified `ContractFixturesTest.kt:85-97`. |
| F21 | LOW | Fixed in C51.3 (check agents amend their own config), C58.3 and C58.4 (manifest entries and recorded queries), C64.1 (form inputs in `apps/flow`), Stage 1b (`e2e/package.json` signers) and C67 (bump owners by date). |
| F22 | LOW | Fixed in C62.9 and C67 (CI pinned to Node 22.22.1; `selfTest()` first). |
| F23 | LOW | Fixed in C50.1 (hand-written `RENAME VALUE` and `ADD VALUE` after `db:generate`; no same-batch use; single-batch and upgrade tests). |
| F24 | LOW | Fixed in C53.3 (`chip_reads.sod_signature` sealed, so the rebuild recomputes the index). |

## Verification round

The fourth pass (`review-verification.md`) confirmed 79 findings resolved, the H27 rejection and the H31(a) deferral, marked 8 findings partly resolved, and raised 23 new ones. Repo facts were re-checked at `402b682` before acting (account creation without a reference id in `services/accounts.ts`; the synchronous `assertPublishable`; `runInquiryExpiry`'s dependencies in `worker.ts`; the mode from `OPENVERIFY_MODE`; `code` in `API_LOG_REDACTED_KEYS`; vision's compose service needs no egress).

| Set | Items | Fixed | Unchanged (deferral sound) |
|---|---|---|---|
| Partly resolved findings | 8 | 7 | 1 (H31) |
| New findings V01–V23 (3 HIGH, 12 MEDIUM, 8 LOW) | 23 | 23 | 0 |

### Partly resolved findings

| Id | Disposition |
|---|---|
| P11 | Fixed through V08: `otp-sms-max-per-hour` and read-only `otp-sms-budget-tripped-at` in the C16 settings schemas (Stage 1a), resolved and served by Stage 1b, the settings route frozen (C54.2), the trip time read from the `environment.otp-sms-budget-tripped` audit entry (C55.7). |
| P25 | Fixed through V10: bindings validated per process; credentials only where used (C63). |
| H03 | Fixed through V02 and V06: AAMVA attempts are bound to their source ID verification; an eligible decision after a server skip creates a submitted attempt; one `aamvaEligible` predicate covers every ID decision (C59.6, C50.5). |
| H07 | Fixed through V11: errored sends do not count; a limit refusal or a store outage lets the user continue to review (`otp_delivery_unavailable`) (C55.6, C53.2, decision 52). |
| H18 | Fixed through V14: KYB types allow 3 attempts; a number the authoritative register lacks goes to review (`registration_number_not_found`) (C50.1, C61.7, decision 50). |
| H28 | Fixed through V07: async publish hooks with owners (`api-otp`, `api-database`, `api-nfc`) and 5B Stage 1's anchor read (C54.1, C50.4). |
| H31 | Unchanged: (b) and (c) done; (a) stays deferred, with the evidence the verifier confirmed (decision 47). |
| F12 | Fixed through V05: the tampered DG1 is tested in Testcontainers only; the e2e chip uses the fixed Utopia CSCA and CRL with a per-run DSC and data (C65.5). |

### New findings

| Id | Sev | Disposition |
|---|---|---|
| V01 | HIGH | Fixed per orchestrator decision 1: `id_nfc_repeat_detection` is advisory by default (C51.1); only `chip_reads` rows with `selfie_bound` true count as sightings (C53.3, set in the decision transaction once the NFC selfie comparison passed and the verification ended `passed` or `needs_review`); a sighting answers `not_applicable`/`chip_seen_on_other_account` (review-level) unless the template sets `sighting-outcome: fail` (C51.2, C51.3, C62.6); tests for the no-reference-id case and a face-mismatched earlier read; decision 35 and the e2e replay case (C65.5) updated. |
| V02 | HIGH | Fixed in C59.6 (AAMVA attempts bound to their ID verification through `verification_inputs.source_verification_id`; an eligible `passed` or `needs_review` decision creates a submitted attempt even after a server skip; server attempts do not count toward `maxAttempts`), C50.5 (judged on the attempt bound to the latest decided ID; a test row for "reviewed passport, then US licence") and C53.2. |
| V03 | HIGH | Fixed per orchestrator decision 3: C54.4 names each Stage 3 agent's repository files; Stage 1b and 5B Stage 1 create every file with its export line, implement the cross-agent reads and parse every new variable; `repositories/index.ts`, `schema.ts`, `config.ts`, `worker-config.ts`, `.env.example`, compose, `services/settings.ts` and `services/inquiry-templates.ts` join the never-edit list; every ownership list names its `packages/db` files. |
| V04 | MEDIUM | Fixed in C62.8: a UTO chip in production fails `specimen_issuer` (the specimen rule runs first); a repository test proves the production loader returns no `sandbox_only` row. |
| V05 | MEDIUM | Fixed in C65.5: the tampered DG1 is in Testcontainers only; the CSCA and CRL are the fixed Utopia ones `seed:dev` inserts, and only the DSC and document data come from the per-run seed. |
| V06 | MEDIUM | Fixed in C59.6: `aamvaEligible` (class, AAMVA inputs, barcode or visual zone); every final ID decision creates a submitted or a skipped attempt; a retryable failure creates nothing; a decision × class × source table test. |
| V07 | MEDIUM | Fixed in C54.1 (`services/publish/<api-type>.ts`; `assertPublishable` async over deps and environment), C50.4 and the ownership lists (`api-otp` phone and email, `api-database` database and AAMVA, `api-nfc` government-id-nfc; 5B Stage 1 adds the anchor read). |
| V08 | MEDIUM | Fixed in C55.7, C54.2, Stage 1a (settings schemas, defaults, update body, audit action) and Stage 1b (resolver and service lines, frozen route); `api-otp` only enforces the budget and writes the trip entry. |
| V09 | MEDIUM | Fixed in Stage 1a (per-area config modules under `packages/core/src/check-config/`, re-exported) and 5B Stage 1 (the `document`, `business`, `nfc` checks stubs with export lines and their config modules); each check agent owns its area modules. |
| V10 | MEDIUM | Fixed in C63: the API reads `sms` with credentials and `database`, `aamva` without; the worker reads every other kind with credentials; a config test per process. |
| V11 | MEDIUM | Fixed in C55.6 (errored sends do not count; a destination, inquiry, guess or environment refusal, or a store outage, is recorded in `otp_verification_states.limited_at`, after which submit is allowed and the check answers `otp_delivery_unavailable`, review; a test per limit), C53.2, C52.6, C51.2, C64.1, decision 52 and Acceptance. |
| V12 | MEDIUM | Fixed in C51.1 (user behaviour, category `fraud`), C51.2 (`document_name_mismatch`, frozen with strings), C60.6 and decision 16. |
| V13 | MEDIUM | Fixed in C60.6 (lease: term or end date covers today; tax document: issued within 18 months; other classes `max-age-days`), C51.3 and C65.2 (an old lease with a future end date, an expired lease, a January W-2 read in October). |
| V14 | MEDIUM | Fixed in C50.1 (3 attempts for both KYB types), C51.2 and C61.7 (`registration_number_not_found`, review) and decision 50. |
| V15 | MEDIUM | Fixed per orchestrator decision 2 in C60.2: no seccomp filter (no hand-written denylist, no LGPL libseccomp); the child keeps its rlimits, `PR_SET_NO_NEW_PRIVS`, empty environment and output cap, and imports only the standard library, pypdfium2, pypdf and Pillow (tested, so `RLIMIT_NPROC` 0 breaks nothing); the container is non-root, read-only, `cap_drop: [ALL]`, `no-new-privileges`, Docker's default profile on; vision moves to its own `internal: true` network shared only with the API and the worker. Each layer states what it stops and what it does not; decision 48, Risks, Acceptance. |
| V16 | LOW | Fixed in C54.1 (`services/sub-resources/<api-type>.ts`, owned per type) and C54.3 (the expiry job gains `storage`; the worker gains `dnsResolver` and `rateLimiter`; harness and fakes). |
| V17 | LOW | Fixed in C51.2 and Stage 1a: `decideVerification` returns `needs_review` when no required check `passed` (a C30.1 amendment, a test per type); decision 49. |
| V18 | LOW | Fixed in C50.4: an `nfc` step needs an earlier `selfie` step, and an earlier `government_id` step when the flow has one; decision 34. |
| V19 | LOW | Fixed in 5C (the navigation entry goes to `dashboard-people`) and 5B (`vision-document` excludes `synthetic_travel.py` and `make_synthetic_fixtures.py` and builds its hostile and benchmark inputs in its own tests). |
| V20 | LOW | Fixed: `submitted → skipped` also for the form source's `skip` option (C50.7); `chip_data_malformed` in the chip authentication row (C51.2); an EVM signature needing an absent RPC answers `provider_not_configured` (C57.4, decision 51); keys per table, trust tables exempt (C53.2); a lease without an end date is `feature_absent` (C60.6); `seed:dev` refuses the resolved `production` mode (C62.8). |
| V21 | LOW | Fixed in C55.5 (wrong entries in their own counter; a match releases its reservation), C55.7 (the per-country share only when a step allows more than one country) and C52.8. |
| V22 | LOW | Fixed in C55.11 (the sink's member is `code`, redacted in stored API logs, with a test), C56 (MX cache keyed by the domain's SHA-256) and C61.4 (RDAP cache likewise). |
| V23 | LOW | Fixed in C63 (the e2e binds `evmRpc` to `sandbox`), C65.5 and C57.4's docs line (without an RPC, a wrong-account EVM signature goes to review). |
