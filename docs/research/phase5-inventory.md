# Phase 5 starting point: inventory (2026-10-21)

Phase 5 ("Other verifications", `docs/PLAN.md:363-370`, catalog `docs/PLAN.md:233-252`):
- phone OTP and email OTP;
- document / proof of address, with PDF forensics;
- database verification;
- server-side NFC Passive Authentication;
- crypto-wallet ownership;
- KYB / business;
- mdoc / VC as a stretch goal.

**How this was taken**
- Read-only inventory of `/home/mhnoor/persona-opensource` at `HEAD 2b56ec5`.
- Workflow 4B is still landing. Uncommitted edits sit in `apps/dashboard/src/app/verifications/[id]/page.tsx`, `components/verification-view.tsx`, `components/verification-card.tsx`, `components/lifecycle/inquiry-view.tsx`, `components/selfie-evidence.tsx`, `app/inquiries/[id]/page.test.tsx`, and `packages/checks/src/calibration/selfie-report*.ts`. Line numbers in those files are moving. Where it matters, HEAD numbers are given.
- Paths are relative to the repo root. `file:N` or `file:N-M` are line numbers.

---

## 0. One-page summary

| Phase 5 item | Already exists | Does not exist |
|---|---|---|
| **All types (plumbing)** | <ul><li>Domain enum of all 9 verification types (`packages/core/src/enums.ts:60-70`) and its Postgres enum (`packages/db/src/tables/enums.ts:34-44`, migration `0001_schema_v1.sql:15`)</li><li>All 31 §4.3 checks in the registry (`packages/core/src/check-registry.ts:688-946`)</li><li>Flow-spec step schemas for `document`, `phone_otp`, `email_otp`, `database`, `nfc`, `form` (`packages/flow-spec/src/flow.ts:170-274`)</li><li>The A-tier port and sandbox pattern (C35/C44)</li><li>The decision engine, reasons, provenance and redaction machinery</li></ul> | <ul><li>Every layer above core is closed to two types: contracts `SUPPORTED_VERIFICATION_TYPES = ['government_id','selfie']` (`packages/contracts/src/verification-types.ts:17-20`), API resources and unions, file kinds, flow API bodies, template `verification-config` keys, worker dispatch, web flow, Android, dashboard</li><li>No §4.3 check has a `configSchema`, defaults table, evaluator, reasons file or doc</li></ul> |
| **Phone OTP** | <ul><li>Registry entry `phone_number_otp_comparison` (`check-registry.ts:881-888`)</li><li>Flow-spec `phone_otp` step (`flow.ts:229-236`)</li><li>Building blocks: TOTP/HOTP, constant-time compare, MFA attempt counting, GCRA rate limiter</li><li>Account and DB-step field `phone_number`</li></ul> | <ul><li>No SMS adapter or port, no libphonenumber (only "planned" in `THIRD_PARTY_LICENSES.md:169`), no OTP table, routes, events or reasons</li><li>Rate-limit policies are a closed enum (`packages/contracts/src/rate-limits.ts:8-13`)</li></ul> |
| **Email OTP** | <ul><li>Registry: `email_address_otp_comparison`, `email_address_disposable_detection`, `email_address_mx_detection` (`check-registry.ts:889-912`)</li><li>Flow-spec `email_otp` step (`flow.ts:238-240`)</li><li>SMTP `Mailer` over nodemailer (`apps/api/src/mail/index.ts:39-66`)</li><li>Mailpit in compose (`infra/docker-compose.yml:179-194`)</li><li>e2e Mailpit reader `waitForMail` (`e2e/src/mailpit.ts:24`)</li></ul> | <ul><li>The mailer is wired only in the API container (`apps/api/src/container.ts:155`), not the worker. Compose gives SMTP only to `api` (`infra/docker-compose.yml:250-251`)</li><li>No disposable-domain data (planned `THIRD_PARTY_LICENSES.md:230`) and no MX lookup (`node:dns` `resolveMx` is never used)</li></ul> |
| **Document / POA** | <ul><li>Registry: 6 `document_*` checks (`check-registry.ts:688-736`)</li><li>`DOCUMENT_TYPES` enum (`packages/core/src/enums.ts:104-110`)</li><li>Flow-spec `document` step with `documentTypes` and `maxAgeDays` (`flow.ts:219-227`)</li><li>Vision OCR, EXIF, double-JPEG, copy-move and pHash are reusable</li><li>Name and address agreement helpers in `packages/checks`</li></ul> | <ul><li>**No PDF support anywhere:</li><li>Vision accepts JPEG, PNG and WebP only (`services/vision/src/openverify_vision/imaging.py:17`); there is no PDF library (vision report §3).</li><li>The API sniffs images only (`packages/contracts/src/files.ts:74-105`).</li><li>The dashboard file route re-sniffs images only (`apps/api/src/routes/dashboard/files.ts:81-82`).</li><li>Vision has no `/v1/analyze/document`. The document detector accepts ID-1 or TD3 aspect only (`document.py:64-75`), and ELA returns 0 without a portrait (`forensics/ela.py:128-129`)</li></ul> |
| **Database** | <ul><li>Registry: `database_{name,address,birthdate}_comparison` (R+A) and `aamva_{name,identification_number}_comparison` (A) (`check-registry.ts:738-778`)</li><li>Flow-spec `database` step with `DATABASE_FIELDS` (`flow.ts:242-264`)</li><li>Name and address matching (Jaro-Winkler, token set, address abbreviations, postal prefix)</li><li>Account fields schema with the same keys (`apps/api/src/services/accounts.ts:115-130`)</li></ul> | <ul><li>No nickname table and no partial-DOB logic</li><li>No database provider port or sandbox</li><li>No form or text-input UI in either client</li></ul> |
| **NFC Passive Auth (server)** | <ul><li>Registry: 4 `id_nfc_*` checks (`check-registry.ts:914-946`) plus `id_nfc_expired_detection` with config, defaults, reasons and logic (`packages/checks/src/id-nfc-expired-detection.ts:19-31`, not wired)</li><li>Extraction source `nfc` and consolidation precedence already coded (`packages/core/src/extraction.ts:38`, `packages/checks/src/extraction/consolidate.ts:5,66`)</li><li>MRZ parser</li><li>`@peculiar/x509` and `@peculiar/asn1-cms` are in the lockfile, as transitive dependencies of `@simplewebauthn/server` (`pnpm-lock.yaml:5364-5375`)</li></ul> | <ul><li>No SOD/DSC/CSCA code, no CSCA master-list fetch (planned `THIRD_PARTY_LICENSES.md:231`)</li><li>`android/openverify-nfc` is an empty placeholder, and its reader is Phase 10 (`docs/PLAN.md:399-408`). **No client produces chip data**, so Phase 5 needs synthetic SOD fixtures (test CSCA, DSC, DGs)</li></ul> |
| **Crypto wallet** | Registry: 4 `crypto_wallet_*` checks (`check-registry.ts:846-878`) | <ul><li>No flow-spec step type</li><li>No base58check, bech32/bech32m, keccak/EIP-55 or secp256k1 code or dependency (`@noble/hashes` appears in the lockfile only as an optional peer, `pnpm-lock.yaml:1545-1548`, and is not installed)</li><li>No challenge resource</li></ul> |
| **KYB / business** | Registry: 8 business checks (`check-registry.ts:780-844`) | <ul><li>No flow-spec step type</li><li>No GLEIF, Companies House, EDGAR, RDAP or URLhaus adapter or data</li><li>No business record table</li><li>SSRF-guarded HTTP is available for reuse (`apps/api/src/webhooks/http-sender.ts:96,187`, `ssrf.ts:144-181`)</li></ul> |

**Cross-cutting blockers** (detail in §10):
1. Step-type names differ from verification-type names. `verificationTypeForStep` is the identity (`packages/contracts/src/verification-types.ts:107-109`).
2. `requiredVerifications` silently ignores steps without a numeric `maxAttempts` (`apps/api/src/jobs/inquiry-outcome.ts:36-43`).
3. Templates must contain a `government_id` or `selfie` step (`packages/contracts/src/inquiry-templates.ts:162-166`).
4. The web flow decodes the session strictly, so any new verification type in `session.verifications` breaks it.
5. The dashboard parses strictly too: a new type breaks the inquiry and verification pages until contracts know it.

---

## 1. `packages/core`

### 1.1 Registry mechanics (`packages/core/src/check-registry.ts`)

- **`defineCheck`** (146-177) derives the following from the tier spec:
  - `stage` (162): `beta` if H is involved or `modelBased`, otherwise `ga`.
  - `defaultRequired` (166): `tier === 'R' && !OPTIONAL_BY_DEFAULT.has(id)`.
  - `defaultEnabled` (167): `tier !== 'A'`.
  - R+A is stored as `tier: 'R'` with `alternateTier: 'A'`. **So every R+A check is enabled and required by default.**
- **`OPTIONAL_BY_DEFAULT`** (116-124) contains only §4.1 and §4.2 ids:
  - `id_po_box_detection`, `id_real_id_detection`;
  - `selfie_glare_detection`, `selfie_pose_repeat_detection`, `selfie_account_comparison`, `selfie_repeat_detection`, `selfie_similar_background_detection`.

  No §4.3 id is in it.
- **Input constants** (180-184): `UPLOAD_VISION`, `VISION_EXTRACTION`, `EXTRACTION`, `UPLOAD`, `UPLOAD_PROVIDER`.
- **Type constants** (186-192): `GOV`, `NFC='government_id_nfc'`, `SELFIE`, `DOC`, `DB`, `BIZ`, `CRYPTO`. Contact checks use the literals `'phone_number'` and `'email_address'`.
- **Size:** 82 `defineCheck` entries in total (36 §4.1, 15 §4.2, 31 §4.3).
- **Lookups:** `listChecks(type)` 968-970, `getCheckDefinition` 963.
- **Tests** (`check-registry.test.ts`):
  - `SECTION_4_3` (69-107) spells the §4.3 expansion out by hand, because PLAN §4.3 groups rows and has no Type column.
  - `MODEL_BASED` (≈120-149) lists the §4.3 model-based ids: `document_type_detection`, `document_extracted_properties_detection`, `id_nfc_selfie_comparison`.
  - `OPTIONAL_REAL_CHECKS` (≈228-236).
  - Exact-set test (309-318).

### 1.2 Every §4.3 registry entry (all at version 1, none with a `configSchema`)

Stage and defaults are computed by `defineCheck`. "Req/En" means `defaultRequired` / `defaultEnabled`.

| Line | Id | Verif. type | Type | Tier | Stage | modelBased | Inputs | Req/En |
|---|---|---|---|---|---|---|---|---|
| 689 | `document_type_detection` | document | UB | R | beta | yes | upload, vision | Y/Y |
| 697 | `document_extracted_properties_detection` | document | UB | R | beta | yes | vision, extraction | Y/Y |
| 705 | `document_expired_detection` | document | F | R | ga | no | extraction | Y/Y |
| 713 | `document_fabrication_detection` | document | F | H | beta | no | upload, vision | N/Y |
| 721 | `document_name_comparison` | document | F | R | ga | no | extraction | Y/Y |
| 729 | `document_address_comparison` | document | F | R | ga | no | extraction | Y/Y |
| 739 | `database_name_comparison` | database | F | R+A | ga | no | upload, provider | Y/Y |
| 747 | `database_address_comparison` | database | F | R+A | ga | no | upload, provider | Y/Y |
| 755 | `database_birthdate_comparison` | database | F | R+A | ga | no | upload, provider | Y/Y |
| 763 | `aamva_name_comparison` | database | F | A | ga | no | upload, provider | N/N |
| 771 | `aamva_identification_number_comparison` | database | F | A | ga | no | upload, provider | N/N |
| 781 | `database_business_identity_comparison` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 789 | `database_business_active_business_detection` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 797 | `database_business_associated_persons_comparison` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 805 | `database_business_enabled_country_detection` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 813 | `database_business_service_available_detection` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 821 | `business_website_domain_age_detection` | business | F | R | ga | no | upload, provider | Y/Y |
| 829 | `business_website_malicious_website_detection` | business | F | R+A | ga | no | upload, provider | Y/Y |
| 837 | `business_website_backlink_detection` | business | F | A | ga | no | upload, provider | N/N |
| 847 | `crypto_wallet_validity_detection` | crypto_wallet | UB | R | ga | no | upload | Y/Y |
| 855 | `crypto_wallet_disallowed_chain_detection` | crypto_wallet | F | R | ga | no | upload | Y/Y |
| 863 | `crypto_wallet_address_comparison` | crypto_wallet | F | R | ga | no | upload | Y/Y |
| 871 | `crypto_wallet_statement_comparison` | crypto_wallet | F | R | ga | no | upload | Y/Y |
| 881 | `phone_number_otp_comparison` | phone_number | UB | R | ga | no | upload, provider | Y/Y |
| 889 | `email_address_otp_comparison` | email_address | UB | R | ga | no | upload, provider | Y/Y |
| 897 | `email_address_disposable_detection` | email_address | F | R | ga | no | upload | Y/Y |
| 905 | `email_address_mx_detection` | email_address | UB | R | ga | no | upload, provider | Y/Y |
| 915 | `id_nfc_passive_authentication_detection` | government_id_nfc | F | R | ga | no | upload | Y/Y |
| 923 | `id_nfc_chip_authentication_detection` | government_id_nfc | F | R | ga | no | upload | Y/Y |
| 931 | `id_nfc_mrz_comparison` | government_id_nfc | F | R | ga | no | upload, extraction | Y/Y |
| 939 | `id_nfc_selfie_comparison` | government_id_nfc | F | R | beta | yes | upload, vision, history | Y/Y |
| 510 | `id_nfc_expired_detection` (a §4.1 row, type NFC) | government_id_nfc | F | R | ga | no | extraction | Y/Y, with `configSchema` |

**Observations for the planner:**
- **Defaults leading to review.** Every R+A database and business check is required by default. With no provider bound they answer `provider_not_configured`, so by ADR 0002 §3b/§3e (`docs/adr/0002-check-tiers.md:58,72`) a default config sends the verification to review. Consider `OPTIONAL_BY_DEFAULT` entries.
- **Descriptions that promise more than the entries hold:**
  - `document_expired_detection` says "90 days by default" (710), but there is no config key. The flow-spec `document.maxAgeDays` (`flow.ts:225`) is a second source for the same number.
  - `crypto_wallet_disallowed_chain_detection` needs a chain allowlist, but `verificationTemplateConfigSchema` has only `allowed-countries` and `allowed-id-classes` (`packages/core/src/decision-engine.ts:31-36`).
- **NFC chip authentication** has `inputs: upload` only. Chip/Active Authentication needs a server-issued challenge (AA) or a secure-messaging session (CA), so what the server can re-verify needs a design decision.
- **Two R-tier entries depend on a provider-like source while stating `R`:** `business_website_domain_age_detection` uses RDAP, and `email_address_mx_detection` uses DNS.

### 1.3 Check config (`packages/core/src/check-config.ts`)

- **§4.3:** there is no config schema or defaults table for any §4.3 check. The only NFC-related pieces are:
  - `idNfcExpiredDetectionConfigSchema` (153-155): `grace-days`.
  - `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_nfc_expired_detection = { 'grace-days': 0 }` (266).
- **Patterns to mirror:**

| Pattern | Lines | What it is |
|---|---|---|
| `heuristic(key)` | 122 | H-tier `max-*-score` |
| `comparison()` | 209-216 | `name-threshold` (0.5-1) plus `fields` from `COMPARISON_FIELDS = ['name','birthdate','address','identification-number']` (207) |
| Government ID flat defaults | 244-287 | `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS` |
| Selfie defaults with basis | 391-499 | `SELFIE_CHECK_CONFIG_DEFAULTS`, where each default is `ConfigDefault {value, basis: 'calibrated'\|'provisional', source}` (21-31) |
| Selfie helpers | 502-521 | `selfieConfigDefaults` / `selfieThresholdBasis` feed `provenance['threshold-basis']` (C39.3) |
| Selfie config tests | `selfie-check-config.test.ts` | |

- **Template config validation:**
  - `verificationTemplateConfigSchema` (`decision-engine.ts:31-52`) validates each check's `config` against its registry `configSchema`. A check without one refuses config: `takes no config` (45-46).
  - Type-level options are only `allowed-countries` and `allowed-id-classes` (34-35).
  - `defaultTemplateConfig(type)` (246-257) applies the registry defaults.

### 1.4 Verification types and state machines

- **Enums** (`packages/core/src/enums.ts`):
  - `VERIFICATION_TYPES` (60-70): `government_id, selfie, document, database, phone_number, email_address, government_id_nfc, crypto_wallet, business`.
  - `VERIFICATION_STATUSES` (45-56).
  - `CHECK_INPUTS` (40).
  - `DOCUMENT_TYPES` (104-110): `utility_bill, bank_statement, lease, pay_stub, tax_document`.
- **Verification lifecycle** (`packages/core/src/verification-state-machine.ts`):
  - Transitions (40-53): `initiated → submitted | confirmed | canceled | skipped`; `confirmed → submitted | passed | failed | canceled`; `submitted → passed | failed | needs_review`.
  - Events by status (13-20). `confirmed` emits no event.
  - **`confirmed` is never used by the API or worker** (grep finds only the DB enum). It is a candidate for "OTP sent / wallet challenge issued".
- **Sub-resource state machine** (`packages/core/src/selfie-capture-state-machine.ts`). This is the only existing pattern for an OTP challenge or wallet challenge:
  - statuses `initiated → submitted → processed | errored` (128, 164-171);
  - error codes with per-status allow-lists (133-138, 174-177);
  - `selfie.*` events (147-162);
  - `assertSelfieCaptureTransition` (210-223).
  - Exported from `index.ts:231`.
- **Inquiry state machine:** `inquiry-state-machine.ts` (unchanged by Phase 5).
- **Decision engine** (`decision-engine.ts`):
  - `decideVerification` (185-243).
  - `NON_BLOCKING_NOT_APPLICABLE_REASONS = ['feature_absent','not_requested']` (72-75).
  - **`moreResultsExpected` (77-84) is never passed by the worker.** It is available for asynchronous providers (KYB, SMS delivery).
- **Extraction** (`extraction.ts`):
  - `EXTRACTION_FIELDS` (12-33) are government-ID fields, including `address-*`.
  - `EXTRACTION_SOURCES = ['mrz','barcode','viz','nfc']` (38): **`nfc` is already a source.**
- **Permissions** (`permissions.ts:9-29`): `API_SCOPES` has `verifications:read` only, with no per-type scope.

---

## 2. `packages/contracts` and `packages/flow-spec`

### 2.1 Verification type tables: closed to two types

`packages/contracts/src/verification-types.ts`:
- `SUPPORTED_VERIFICATION_TYPES = ['government_id','selfie']` (17-20).
- `API_VERIFICATION_TYPES = ['government-id','selfie']` (25).
- `VERIFICATION_RESOURCE_TYPES = ['verification/government-id','verification/selfie']` (30-33).
- Four mapping tables (37-55).
- `UnsupportedVerificationTypeError` (58-65).
- **`verificationTypeForStep(stepType)` (107-109) returns the step type itself if it is a supported verification type.** Step `phone_otp`, `email_otp` and `nfc` therefore need an explicit map to `phone_number`, `email_address` and `government_id_nfc`.
- `verificationStatusForDecision` (124-131).

### 2.2 Verification resources (`packages/contracts/src/verifications.ts`)

| What | Lines |
|---|---|
| `checksSchema(type)`: checks must belong to the type | 79-101 |
| Government ID attributes (country, `id-class`, C31.5 extraction, `extraction-sources`) | 123-136 |
| Selfie attributes (C40.10) | 143-168 |
| `verificationRelationshipsSchema` (inquiry, files, optional selfies) | 170-175 |
| `verificationResourceSchema` discriminated union of 2 | 177-194 |
| `VERIFICATION_INCLUDES = ['selfies']` | 208 |
| `retryHintSchema`: user-behaviour checks only | 216-221 |
| Flow view: `flowVerificationResourceSchema` union of 2 | 248-270 |
| `VerificationRecord` (per-type optional fields) | 290-314 |
| `buildVerificationResource`: binary government-ID-or-else branch | 358-391, branch at 370 |

Sibling unions that list the two resource types and must grow:
- `inquiries.ts:118, 133-134` (`include=verifications`);
- `dashboard-api.ts:199-210` (`dashboardInquiryDocumentSchema.included`);
- `events.ts:28-35` (`PREFIX_BY_SUBJECT_TYPE`), 41-57 (`redactedResourceStubSchema` type enum), 67-91 (`eventPayloadSchema` data and included);
- `resource-types.ts:4-26`;
- `identifiers.ts:46-49` (via `verificationResourceTypeSchema`);
- `packages/node/src/types.ts:26, 43-46, 67-69` (SDK type guards).

### 2.3 Flow API bodies (`packages/contracts/src/flow-api.ts`)

- `flowSessionResponseSchema` (37-48): a strict object that embeds `flowSchema` and `verifications: flowVerificationResourceSchema[]`.
- `flowConsentBodySchema` (61-71).
- `createFlowVerificationBodySchema` (77-84): `government-id` (with `country` and `id-class`) or `selfie`.
- `flowFileUploadFieldsSchema` (91-97): `kind` plus the selfie capture fields.
- `FlowConditionContext` (100-107): `{ inquiry: { status } }` only.
- One-time link redeem (113-124).
- Submit body: `flowSubmitVerificationBodySchema` (`selfie-captures.ts:306-308`), with an optional `capture`.
- **The sub-resource precedent is the selfie capture** (`selfie-captures.ts`):
  - TTL 180 s (40), cap 10 (43), nonce 22 base64url (46-47);
  - resource (79-115), create body (173), flow resource (210-224), multipart field names (226-238);
  - problem codes `SELFIE_CAPTURE_PROBLEM_CODES` (312-321).

### 2.4 Files (`packages/contracts/src/files.ts`)

| What | Lines |
|---|---|
| `FILE_KINDS` (front, back, portrait, selfie-center/left/right) | 22-29 |
| `FILE_KINDS_BY_VERIFICATION_TYPE` (government_id, selfie) | 34-37 |
| `requiredFileKinds(step)` (government ID or selfie step only) | 68-72 |
| `ACCEPTED_IMAGE_MIME_TYPES` (jpeg, png, webp) | 74 |
| `MAX_UPLOAD_BYTES` (10 MiB) | 79 |
| `detectImageMimeType` (magic bytes, images only) | 94-105 |
| `fileAttributesSchema['mime-type']` (images only) | 107-112 |
| `fileResourceSchema` (kind must belong to the verification type) | 121-132 |

### 2.5 Reasons files (one per verification type; nothing exists for §4.3 types)

**Government ID** (`government-id-check-reasons.ts`):
- Shared reasons (24-41): `feature_absent`, `not_requested`, `input_missing`, `no_reference_data`, `execution_error`, `provider_not_configured`, `image_unreadable`.
- `NON_BLOCKING_REASONS` (46).
- `GOVERNMENT_ID_CHECK_IDS` (49-86) includes `id_nfc_expired_detection` (85), with the comment at 48: "runs on chip data, Phase 5".
- Building blocks `ANY`/`VISION`/`PROVIDER`/`FEATURE` (92-99), `COMPARISON` (134-139), `EXPIRY` (140).
- Map (148-259); the NFC entry is at 258.

**Selfie** (`selfie-check-reasons.ts`):
- `NOT_CONSENTED_REASON` (36), `SELFIE_CHECK_IDS` (39), `SHARED_SELFIE_REASONS` (60), `LEGACY_SELFIE_REASONS` (71), `SELFIE_CHECK_REASONS` (89).

**Phase 1** (`phase1-checks.ts`):
- `PHASE1_CHECKS` (10-22), `PHASE1_CHECK_REASONS` (35-49), `NOT_IMPLEMENTED_REASON` (56).

**Enforced by:**
- `apps/api/src/jobs/government-id-contract.test.ts` and `selfie-contract.test.ts`: every evaluator emits only listed reasons.
- The dashboard's reverse check, `apps/dashboard/src/lib/check-reasons.test.ts:59-63`: words for an unlisted code fail.
- **The retry-hint fixture** `contracts/fixtures/flow/retry-hint-reasons.json`:
  - It now holds **27** user-behaviour reasons.
  - It is read by `apps/flow/src/i18n/retry-reasons.test.ts:32-48` and by Android `ui/Messages.kt:48-82` / `MessagesTest`.
  - New UB checks (phone and email OTP, MX, crypto validity, document type and properties) add reasons that both clients must translate in English and Spanish.

### 2.6 Flow-spec step kinds (`packages/flow-spec/src/flow.ts`, `FLOW_SPEC_VERSION = 1` at 14)

| Step type | Fields | Lines | Contracts accept it? | Clients render it? |
|---|---|---|---|---|
| `consent` | `textKeys`, `optionalTextKeys?`, `required` | 148-168 | yes | yes |
| `form` | `fields[]`: text, date, email, phone (allowedCountries), select, country (73-144) | 170-189 | **no** | no (unsupported) |
| `government_id` | `sides`, `allowedCountries?`, `allowedIdClasses?`, `maxAttempts`, `captureMethods` | 191-203 | yes | yes |
| `selfie` | `poses`, `liveness`, `maxAttempts` | 205-217 | yes | yes |
| `document` | `documentTypes` (core `DOCUMENT_TYPES`), `maxAgeDays` 1-3650. **No `maxAttempts`, no capture methods, no file-type option** | 219-227 | no | no |
| `phone_otp` | `codeLength?` 4-10, `maxAttempts?` | 229-236 | no | no |
| `email_otp` | same as `phone_otp` | 238-240 | no | no |
| `database` | `fields` from `DATABASE_FIELDS` (242-256: name_first/middle/last, birthdate, address_*, identification_number, phone_number, email_address). **No `maxAttempts`, no country** | 258-264 | no | no |
| `nfc` | `androidOnly: true`, `maxAttempts?` | 266-274 | no | no |
| `completion`, `failure` | `messageKey?` | 276-290 | yes | yes |

- **Absent:** no `crypto_wallet` step and no `business` step.
- `STEP_TYPES` (306-318); `stepSchema` (292-304).
- JSON Schema `packages/flow-spec/schema/flow.schema.json` is generated by `scripts/export-json-schema.ts`; `FLOW_SCHEMA_ID` is in `json-schema.ts:4`.
- `DATABASE_FIELDS` keys equal the default account fields (`apps/api/src/services/accounts.ts:115-130`) and the inquiry `fields` naming (`INQUIRY_FIELD_NAME_PATTERN`, `packages/contracts/src/inquiries.ts:44`).

### 2.7 Inquiry template `verification-config` (`packages/contracts/src/inquiry-templates.ts`)

- **`verificationConfigSchema`** (42-97):
  - A strict object with keys `'government-id'` and `selfie` only.
  - Per type: `verificationTemplateConfigSchema` from core.
  - Selfie may not set `allowed-countries` or `allowed-id-classes` (48-62).
  - Every present type needs at least one enabled, required check (87-93).
  - A check must belong to its type (70-83).
- **`SUPPORTED_FLOW_STEP_TYPES`** (101-107): consent, government_id, selfie, completion, failure.
- **`checkFlowMatchesConfig`** (119-166):
  - refuses unsupported step types (125-131);
  - allows one step per type (136-139);
  - requires config for each step type and a step for each config key (142-161);
  - **requires a `government_id` or `selfie` step (162-166).**
- `checkFlowPublishable` (172-183): publish-time-only rules (selfie `center`).
- Default template:
  - `DEFAULT_GOVERNMENT_ID_CHECKS` (320), `DEFAULT_SELFIE_CHECKS` (377-396), `DEFAULT_TEMPLATE` (428-475);
  - fixture `contracts/fixtures/flows/default-gov-id-selfie.json`;
  - `seed:dev` publishes changes as a new version.
- Template settings (`template-settings.ts:13-55`): expirations and retention only; no per-type settings.

### 2.8 Event names (`packages/contracts/src/event-names.ts`)

- `INQUIRY_EVENT_NAMES` (16-29), `INQUIRY_SESSION_EVENT_NAMES` (32-36).
- `VERIFICATION_EVENT_NAMES` (39-46): `verification.{created,submitted,passed,failed,canceled,skipped}`. These cover every `verification/*` type through the subject prefix (`events.ts:105-110`).
- `SELFIE_EVENT_NAMES` (49-54), `ACCOUNT_EVENT_NAMES` (57-71), `EVENT_NAMES` (74-95).
- `EventSubject` (108) and `SUBJECTS` (110-116): inquiry, inquiry-session, verification, account, selfie.
- **A new sub-resource (OTP challenge, wallet challenge, document) needs a new subject and events,** as `selfie.*` did.
  - Persona has `document.{created,errored,extracted,pending,processed,submitted}` (`docs/research/persona-surface.md:250-255`). It has no OTP events.
- Webhook simulation samples (`apps/api/src/webhooks/samples.ts:43-67`) use `verification-government-id.json` for every verification event, and a fixture per subject.

### 2.9 ID prefixes (`packages/contracts/src/ids.ts:11-35`)

`org env key usr uss itmpl itmplv inq iqse ver file evt wbh whd acc acctp role aud alog mfa self`.
- Token prefixes (`tokens.ts:10-18`): `ovs_ ovu_ wbhsec_ ovo_ ovm_ ovi_`.
- **Nothing exists for OTP, wallet challenge, document or business records.**

### 2.10 Problem codes and rate limits

- Problem codes:
  - `problem.ts:14` (`PROBLEM_TYPES`), 64 (`FLOW_SESSION_INACTIVE_CODES`), 78 (`MFA_SIGN_IN_PROBLEM_CODES`);
  - `selfie-captures.ts:312-321`.
- `rate-limits.ts:8-13`: `RATE_LIMIT_POLICIES = ['api','flow-session','flow-ip','one-time-link-redeem']`; defaults at 22-27.
- `RateLimitRule.name` is typed `RateLimitPolicy` (`apps/api/src/ports.ts:788-790`).
- A per-phone or per-email "send" limit needs a new policy, or a rule type outside the enum. Note that `GET /api/v1/rate-limits` lists the policies.

---

## 3. `packages/db`

- **Migrations:** 16 files, `packages/db/drizzle/0000_schema_v0.sql` … **`0015_selfie_captures_face_templates.sql`** (newest; journal `drizzle/meta/_journal.json:114`). **The next is `0016`.**
- **Enums** (`src/tables/enums.ts`):
  - `verification_status` (22-32) includes `confirmed` and `needs_review`.
  - **`verification_type` (34-44) already has all 9 values,** created in `0001_schema_v1.sql:15`.
  - **`file_kind` (72-79): front, back, portrait, selfie-center/left/right only.** A new kind needs `ALTER TYPE … ADD VALUE`; precedents are `0011_verification_needs_review.sql:1` and `0003_schema_v2.sql:52`.
  - `schema.test.ts` fails if enums drift from core.
- **`verifications`** (`src/tables/verifications.ts:33-70`): generic. It carries government-ID columns `country` (42, ISO-2 check 67) and `id_class` (43), plus `selfie_capture_required` (51). There are no per-type columns for §4.3 types.
- **`verification_checks`** (77-123): generic, with stage, confidence and provenance.
- **`files`** (130-193):
  - `mime_type` is `text` with the regex `^[a-z]+/[a-z0-9.+-]+$` (185), so `application/pdf` already fits the column;
  - one file per kind per verification (173-177);
  - SHA-256 index (180).
- **Per-type tables that exist (the patterns):**
  - `government_id_extractions` (`src/tables/government-id-extractions.ts:35-120`): sealed `fields`, blind index, pHash bands, `redacted_at`.
  - `selfie_captures` (`src/tables/selfie.ts:45-116`): status text with checks, `nonce_sha256 bytea` (32 bytes), sealed `device`, expiry, one-initiated-per-verification partial unique index.
  - `face_templates` (≈117), `selfie_backgrounds` (161).
- **Closest analogue for OTP attempt limits:** `mfa_challenges` (`src/tables/mfa.ts:101-129`) has `token_hash`, `expires_at`, `failed_attempts`, `consumed_at`, `revoked_at`. Its repository functions are `recordMfaChallengeFailure` (`src/repositories/mfa.ts:403`), `reserveMfaChallengeAttempt` (435) and `revokeExhaustedMfaChallenge` (460).
- **PII at rest:**
  - `sealed.ts` (`sealValue` / `openValue`, row-bound AAD `<table>.<column>#<row id>`);
  - `crypto.ts` (`encrypted` / `encryptedJson` 402-416, `encryptBytes` 310);
  - `encrypted-columns.ts` `ENCRYPTED_COLUMNS` (22-46) and `SEALED` (49-67), which must stay in step with `schema-v2.test.ts:535`.
- **Blind index** (`src/blind-index.ts`):
  - `OPENVERIFY_BLIND_INDEX_KEY` (24);
  - per-environment subkey `HMAC(key, "openverify/blind-index/v1|<env>")` (120-131);
  - `identificationNumberIndex` (139); `normalizeIdentificationNumber` (68-70);
  - `blind-index:rebuild` script.
  - It is reusable for any searchable identifier (phone, email, wallet address, LEI) with a new label or class group.
- **Redaction** (`src/repositories/redaction.ts:1-22`, table of what each table loses) and **retention** (`src/repositories/retention.ts`): every new PII table must be added to both.
- **Phase 5 terms in `packages/db/src`:** nothing outside the enum (grep for otp, phone, wallet, business, nfc, pdf).

---

## 4. `apps/api`

### 4.1 Routes and services for other verification types

**None exist.** Every path assumes government ID or selfie.

- **Flow routes** (`src/routes/flow/index.ts`, prefix `/api/v1/flow`, registered at `src/app.ts:187`):

  | Route | Line |
  |---|---|
  | `/one-time-links/redeem` | 187 |
  | `/session` | 209 |
  | `/consent` | 225 |
  | `/verifications` | 249 |
  | `/verifications/:id/files` | 274 |
  | `/verifications/:id/submit` | 319 |
  | `/verifications/:id/selfies` | 356 |
  | `/verifications/:id` | 392 |

  `UPLOAD_LIMITS` (54-61): 1 file, 5 fields, 6 parts.
- **Flow service** (`src/services/flow.ts`):
  - `stepFor(flow, type)` (128-130) matches `step.type === type`.
  - `createFlowVerification` (290-357): government-ID allow-lists (301-310); `step.maxAttempts` required (331).
  - `uploadFile` (407-…): `isFileKindAllowed`, then `detectImageMimeType` → 415 "must be a JPEG, PNG or WebP image" (456-459).
  - `submitVerification` (588-…): `requiredFileKinds(step)` (633); selfie capture rules (601-609).
  - `createFlowSelfieCapture` (783-…).
- **Resource helpers:**
  - `src/services/resources.ts:56-61` `supportedType()` throws `Verification type X is not supported in this version`.
  - `src/routes/dashboard/resources.ts:37-41, 142` filter unsupported types out of inquiries.
- **Verification services** (`src/services/verifications.ts`):
  - `getVerificationDocument` (64-86) has selfie and government-ID branches.
  - `stageVerificationEvent` (117-145) loads the government-ID extraction and selfie details.
  - `cancelInitiatedVerifications` (153-203) handles the selfie capture cleanup.
- **Server routes:** `src/routes/server/verifications.ts:19` (`/verifications/:id`), 51 (`/selfies/:id`).
- **Dashboard routes:**
  - `src/routes/dashboard/inquiries.ts:147, 195-215` (the selfie branch at 208);
  - `src/routes/dashboard/files.ts:72-85`: content re-sniffed with `detectImageMimeType`, so a non-image is refused; headers at 159-160.

### 4.2 Worker dispatch by type (`src/jobs/process-verification.ts`)

- The header (1-43) describes the 6-step pipeline: load, decrypt, vision, evaluate and decide, store, settle.
- `isSupportedVerificationType` guard → `PermanentJobError('unsupported_verification')` (505-507).
- **`evaluate()` (444-464) is a binary ternary:** `type === 'government_id' ? evaluateGovernmentId : evaluateSelfie` (454-457). `decideVerification` follows at 458.
- `storeExtraction` (637-652) is government-ID only. Face data is selfie only (480-484, 594-605).
- `failVerificationAfterError` (687-749) errors submitted selfie captures (723-733).
- **Per-type job modules** (the pattern for `jobs/<type>.ts`):
  - `src/jobs/government-id.ts`: header 1-18, `evaluateGovernmentIdVerification` 409;
  - `src/jobs/selfie.ts`: `evaluateSelfieVerification` 611.
- **Helpers:**
  - `jobs/attempts.ts` (`attemptVision` 30, `attemptProvider` 62; the C30.3 last-attempt rule);
  - `jobs/execution-errors.ts`; `jobs/images.ts` (`decryptImage` 29);
  - `jobs/models.ts` (`MODEL_DIGESTS` 17-44); `jobs/records.ts:45, 82`.
- **Inquiry settling** (`src/jobs/inquiry-outcome.ts`):
  - **`requiredVerifications` (36-43) keeps only steps whose type maps to a supported verification *and* that have a numeric `maxAttempts`.** `document` and `database` steps have no `maxAttempts`, so they would never count towards completion. `phone_otp`, `email_otp` and `nfc` count only when the template happens to set the optional field. Today all five are excluded anyway, because `verificationTypeForStep` maps none of them.
  - `decideInquiryOutcome` (77-92), `isRetryableFailure` (106-111).
- **Race tests to mirror:** `src/jobs/redaction-race.integration.test.ts`, `selfie-race.integration.test.ts`.

### 4.3 Providers and ports (C35 / C44)

- **`src/ports.ts`:**

  | What | Lines |
  |---|---|
  | `VisionClient` | 419 |
  | Provider section comment | 453-463 |
  | `GOVERNMENT_ID_PROVIDER_KINDS = ['aamva','publicFigure','ageEstimate']` | 465 |
  | `ProviderIdentity {id, sandbox}` | 469-474 |
  | Government ID request/provider interfaces | 476-512 |
  | `SELFIE_PROVIDER_KINDS` | 520-524 |
  | Real vs sandbox interfaces (`sandbox: false` / `sandbox: true`, sandbox gets extra context) | 556-594 |
  | `SelfieProviders` | 596 |
  | `BoundProviders` | 605 |
  | `ProviderBindings` per environment kind | 608 |

- **`src/providers/index.ts`:**
  - variable table in the header (1-17);
  - `PROVIDER_KINDS` (38-41), `PROVIDER_ENV_PREFIXES` (45-52), `PROVIDER_NAMES = ['sandbox']` (55);
  - `providerVariable` (77-79), `ProviderError {retryable}` (82-90);
  - `readProviderSettings`: refuses sandbox in production and never echoes values (104-131);
  - `createProviderBindings` (137-165).
- **`src/providers/sandbox.ts`:** `SANDBOX_MAGIC` (27) uses the last 4 characters of the ID number; `SANDBOX_SELFIE_MAGIC` (110) uses `reference-id` tokens.
- **Results** use `providerResult` (`packages/checks/src/government-id/provider.ts:11`) and `provenance.provider {id, sandbox}` (`packages/core/src/check-result.ts:36-39`).
- **Environment:** `.env.example:78-105` holds 12 `OPENVERIFY_PROVIDER_*` variables.
- **Wiring:** `src/worker.ts:420` (vision), `src/worker.ts:429` (providers).
- **What Phase 5 would add here:** ports and kinds for SMS, email delivery (or the `Mailer`), database records, AAMVA name and number, business registries, RDAP, malicious-URL and backlink feeds, and the CSCA store if treated as a provider.

### 4.4 Mail (Mailpit / SMTP)

- `src/mail/index.ts`:
  - `createMailer({smtpUrl, from})` (39-66): nodemailer; `smtp://` or `smtps://` only (32, 45-47); 10 s timeouts.
  - `MailerNotConfiguredError` (23-29).
  - Invitation template in `src/mail/invitation.ts`.
- **Port:** `MailMessage {to, subject, text, html?}` (`src/ports.ts:815`), `Mailer.send` (823). The test fake is in `src/test-support/fakes.ts`.
- **Configuration:**
  - `OPENVERIFY_SMTP_URL` / `OPENVERIFY_MAIL_FROM`: `src/config.ts:365-366`, `.env.example:125-128` (`smtp://127.0.0.1:1025`).
  - Mailpit: `.env.example:30-32` (ports 1025/8025); compose service `mailpit` (`infra/docker-compose.yml:179-194`, image `axllent/mailpit:v1.31`).
  - The `api` service sets `OPENVERIFY_SMTP_URL: smtp://mailpit:1025` (250-251). **The `worker` service does not.**
  - The mailer is built in `src/container.ts:155` and passed to API services (`src/services/context.ts:51`). **The worker has no mailer.**
- **SMS:** nothing (no port, no adapter, no Twilio).

### 4.5 Rate limiting

- `src/rate-limit/index.ts`:
  - GCRA in Valkey via a Lua script (`GCRA_SCRIPT` 31-…);
  - `createRateLimiter` (109) gives `RateLimiter.consume(key, rule)` (`src/ports.ts:805`).
  - It is generic over the key, so it can be reused per phone number, email address or session.
- `src/plugins/rate-limit.ts`: `FLOW_ROUTE_PREFIX` (41), `rateLimitRules` (51), applied per route class.
- `src/operator-auth/login-rate-limiter.ts:17-72` is a separate in-memory login limiter.

### 4.6 OTP and hashing helpers already present

| Helper | Where | Reuse for Phase 5 |
|---|---|---|
| HOTP/TOTP (RFC 4226/6238), `timingSafeEqual` | `src/operator-auth/totp.ts`: `hotp` 74, `verifyTotp` 103-…, compare at 124, `base32*` 24-67 | Code generation and comparison (an OTP is random, not time-based) |
| Selfie nonce: 128-bit CSPRNG, SHA-256 digest stored, constant-time compare that also runs with no row | `src/services/selfie-captures.ts:12, 100-120` (`newSelfieCaptureNonce`, `nonceMatches`) | Challenge nonce for crypto or NFC AA; the "compare even when absent" pattern |
| MFA challenge: 5 minutes, 5 failures then revoked, single use | `packages/contracts/src/tokens.ts:32-34`; `packages/db/src/repositories/mfa.ts:403-481` | OTP attempts and expiry |
| Token hashing (SHA-256 hex) | `packages/db/src/tokens.ts:7-9` | Not enough alone for a 6-digit OTP: it can be brute-forced offline. Prefer a keyed HMAC (the blind-index pattern, `packages/db/src/blind-index.ts:120-131`) or Argon2id |
| Argon2id | `src/operator-auth/password-hasher.ts:9-51` (`@node-rs/argon2` 2.2.2) | Possible OTP hash |
| Constant-time compares elsewhere | `operator-auth.ts:444`, `client-address.ts:44` | |

### 4.7 Other reusable API pieces

- **SSRF-guarded HTTP** (for GLEIF, Companies House, EDGAR, RDAP and URL feeds):
  - `src/webhooks/ssrf.ts` (`classifyAddress` 144, `isAddressAllowed` 159);
  - `src/webhooks/http-sender.ts` (`systemResolver` 52, `createVettedLookup` 96, `createGuardedWebhookSender` 187);
  - `undici` 7.30.1 is already a dependency.
- **OpenAPI:** generated by `pnpm --filter @openverify/api openapi:write` (`apps/api/package.json:23`) into `docs/api/openapi.json`. Only plugin-registered routes appear.
- **API dependencies** (`apps/api/package.json`): no libphonenumber, no PDF, no ASN.1 (only transitively via `@simplewebauthn/server` 14.0.3: `@peculiar/x509` 2.2.0 and `@peculiar/asn1-cms` 2.11.0, `pnpm-lock.yaml:5364-5375`), and no crypto-wallet libraries.

---

## 5. `services/vision`

### 5.1 Endpoints

All in `services/vision/src/openverify_vision/app.py`. `/v1/*` routes sit behind the `x-service-token` header, checked by the router dependency `auth.py:23` and by `ServiceTokenMiddleware` `service_token.py:50`.

| Method and path | Line | Notes |
|---|---|---|
| `GET /health` | 107 | |
| `POST /v1/quality` | 158 | Not called by the API |
| `POST /v1/analyze/government-id` | 289 | `front`, optional `back` |
| `POST /v1/analyze/selfie` | 305 | |
| `POST /v1/compare/background` | 349 | |
| `POST /v1/embed/face` | 385 | `subject` is `selfie` or `document` |

**There is no `/v1/analyze/document`.** It was named in the Phase 1 plan (`docs/PLAN.md:321`) but never built.

### 5.2 What a document or POA analysis could reuse

**OCR** (`ocr/__init__.py`):
- `OcrEngine.read_text` (141): RapidOCR PP-OCRv6 small, vendored, Apache-2.0.
- **Caps:** `MAX_TEXT_LINES = 200` and `MAX_TEXT_LENGTH = 200` (`schemas.py:88, 91`), also enforced in `SideAnalysis.text` (320). The detector's longer side is capped at 2,000 px (`ocr/detection.py:61`). A full A4 bill can exceed 200 lines.
- Also: `recognize` (172), and stroke-width statistics (`ocr/strokes.py:35`, the nearest thing to a font cue). There is no font or typeface analysis.

**Document detection** (`document.py`):
- `detect_document` (677) and rectification (646).
- **It accepts only ID-1 or TD3 aspects:** `ID1_ASPECT` 64, `TD3_ASPECT` 67, `ASPECT_TOLERANCE = 0.12` 72, `MIN_AREA_RATIO = 0.3` 75, landscape only. An A4 or Letter page is never found.
- `perceptual_hash` (845) needs a rectified document.

**Forensics** (`forensics/`):

| Function | File:line | Usable as is for a POA? |
|---|---|---|
| `summarize_exif` (Software tag, PNG Software chunk fallback) | `exif.py:45` | yes |
| `read_upload` (format, quantization tables) | `upload.py:97` | yes |
| `jpeg_forensics` / `double_compression_score` | `jpeg.py:206` / `181` | yes |
| `copy_move_score` | `copy_move.py:123` | yes |
| `screen_grid_score` / `moire_score` | `spectral.py:114` / `131` | yes |
| `chroma_stats` / `color_cast_score` | `chroma.py:64` / `81` | yes |
| `ela_score` | `ela.py:116` | **No:** returns 0.0 when `portrait_box is None` (128-129) |
| `analyze_forensics` (the entry point) | `forensics/__init__.py:77` | **No:** tied to the government-ID layout (portrait, REAL ID star) |
| `read_digital_source_type` (XMP) | `synthetic_face.py:231` | yes |

The composition example to follow is `analyze_government_id_side`, `analysis.py:237`.

### 5.3 File types and limits

- **Decoding:** `decode_image` (`imaging.py:54`) uses Pillow with `ALLOWED_FORMATS = ("JPEG","PNG","WEBP")` (17). Errors map to 415, 413 and 422 (21-34). Pixels are checked from the header before decoding (67-72).
- **Settings** (`settings.py`): `max_upload_bytes` 10 MiB (30), `max_image_pixels` 40 M (31), concurrency 2 and queue 8 (39-42).
- **Body limit:** `BodySizeLimitMiddleware` (`limits.py:22`) allows 3 × upload + 64 KiB (`app.py:62-66, 448-455`).
- **PDF:** there is no PDF library and no handling. A test asserts that `%PDF-1.7` is rejected (`tests/test_imaging.py:94`).
- **Dependencies** (`services/vision/pyproject.toml`):
  - runtime 8-19: fastapi, numpy, onnxruntime, opencv-headless, pillow, pydantic, python-multipart, uvicorn, zxing-cpp;
  - dev 26-38;
  - licence pins and bans in `tests/test_dependencies.py` (pyclipper and shapely are banned, scikit-image is dev-only);
  - `services/vision/NOTICE`.
- **Adding PDF** means a new runtime dependency plus `test_dependencies.py`, NOTICE and `THIRD_PARTY_LICENSES.md` entries. Licences: PyMuPDF is AGPL and excluded. pypdf is BSD-3. pypdfium2 is Apache-2.0 or BSD-3 (verify on adoption).

### 5.4 API-side vision client

- `apps/api/src/vision/index.ts`:
  - `createVisionClient` (151), generic `post` (165), methods (213-237);
  - `EXTENSIONS` covers images only (119-123);
  - errors (48-98), with `isUnreadableImageError` for 413, 415 and 422 (93).
- zod schemas: `apps/api/src/vision/schemas.ts` (e.g. `governmentIdAnalysisSchema` 312). **They are not in `packages/contracts`.**
- pydantic models: `services/vision/src/openverify_vision/schemas.py` (`_Contract` with frozen and `extra="forbid"` at 28).
- Golden fixtures: `contracts/fixtures/vision/*.json`, written by `services/vision/tools/make_contract_fixtures.py`.
- There is no `analysis_version` field. Versions are carried per response in `model_versions`, mapped to digests in `apps/api/src/jobs/models.ts:17-44`.
- **ASN.1, X.509 and CMS:** none in vision. Passive Authentication fits better in TypeScript (API or worker) or in `packages/checks`.

---

## 6. `apps/flow` and Android

### 6.1 Web flow (`apps/flow`)

- **Step dispatch** is two hard-coded switches; there is no registry:
  - `src/flow/flow-position.ts`: the `FlowPosition` union (36-64); `stepPosition` (148-167) sends `form`, `document`, `phone_otp`, `email_otp`, `database` and `nfc` to `{kind:'unsupported', reason:'step'}` (159-165); `verificationPosition` (103-145).
  - `src/flow/flow-renderer.tsx`: the `Position` switch (196-248).
  - Step components live in `src/steps/` (consent, verification capture, selfie capture, processing, finalizing, outcome screens, unsupported). `unsupported-step.tsx:11-18` maps the unsupported types to `unsupported.steps.*` keys.
- **API client** (`src/api/flow-api-client.ts`): interface 39-74, implementation 119-203, the seven endpoints 126-201.
- **Transport** (`src/api/flow-transport.ts`): strict zod decode (241), 30 s and 120 s timeouts (20-23). **A session listing a verification of a new type fails decode** (`flowVerificationResourceSchema` has only 2 members).
- **Uploads:** `src/lib/image-file.ts:26` `IMAGE_INPUT_ACCEPT = 'image/jpeg,image/png,image/webp'`; magic-byte check at 31-46. There is no PDF.
- **No text, date, phone or email inputs exist.** `packages/ui/src/field.tsx` has `Field` and `Input` (exported at `packages/ui/src/index.ts:6`), but the flow does not use them. The CSP has `form-action 'none'` (`src/security/security-meta.ts:32`).
- **i18n:**
  - `src/i18n/locales/en.ts` (nested `as const`; `Messages` type at 301) and `es.ts`;
  - `languages.ts` holds `['en','es']`;
  - `translate-key.ts:64-77` resolves server-supplied keys;
  - retry reasons at `en.ts:155-213`.
- **CSP** (`src/security/security-meta.ts:19-34`): `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' <api>`, `img-src 'self' blob: data:`, `object-src 'none'`, no `frame-src`. A PDF preview or a wallet relay needs CSP changes.

### 6.2 Android (`android/`)

- **`openverify-sdk`:**
  - Kotlin mirror of flow-spec: `model/Flow.kt` with 5 step classes (64-138) and `UnsupportedStep` (141-144).
  - `FlowStepSerializer.known` holds 5 types (190-196). Anything else becomes `UnsupportedStep`. Decoding is lenient (`model/OpenVerifyJson.kt:10-13`, `ignoreUnknownKeys`).
  - Dispatch: `flow/FlowCoordinator.kt` `resolve()` `when` (237-251) → `flow/FlowState.kt` (14-96) → `ui/InquiryFlowScreen.kt` `when` (42-67).
  - API: `api/FlowApi.kt:22-95`, `api/FlowApiClient.kt` (base `api/v1/flow` 52-53).
  - `model/WireEnums.kt`: `VerificationType` is GOVERNMENT_ID, SELFIE or UNKNOWN (165-182). **`FileKind` has no unknown fallback** (124-133).
  - Uploads: JPEG, PNG and WebP up to 10 MiB (`camera/CapturedImage.kt:16-32`); picker `ImageOnly` (`ui/PhotoPicker.kt:51`).
  - Retry reasons: `ui/Messages.kt:48-82`.
- **`openverify-nfc`: an empty placeholder.** It holds only `NOTICE`, `README.md` and `build.gradle.kts` (1-22: android.library, namespace `dev.openverify.nfc`, **no dependencies, no `src/`**). The README says it is built in Phase 10, with JMRTD and SCUBA (LGPL) (5, 9-26). It is included in `android/settings.gradle.kts:31`. `gradle/libs.versions.toml` has no JMRTD, SCUBA or BouncyCastle entry. The SDK manifest declares INTERNET and CAMERA only, not NFC.
- **NFC-adjacent code in the SDK:**
  - `mrz/BacKeySeed.kt:3-33` (`mrzInformation(...)`, the BAC key seed string; used only by its test);
  - `mrz/Mrz.kt` (`checkDigit`).
- **demo-app:** an inquiry or one-time-link launcher (`MainActivity.kt:59-123`). It depends only on `:openverify-sdk`.
- **A new step type plugs in** through:
  1. a data class in `Flow.kt`;
  2. the `known` map and serialize `when` (`Flow.kt:190-227`);
  3. `FlowCoordinator.resolve`;
  4. a `FlowState` subtype;
  5. `InquiryFlowScreen`;
  6. `ui/FlowActions.kt:7-27` plus `InquiryViewModel`;
  7. `FlowApi` and `FlowApiClient`;
  8. `WireEnums`;
  9. `res/values{,-es}/strings.xml`.

---

## 7. `apps/dashboard`

- **There is no switch or registry by verification type.** Branches are inline `verification.type === …`:
  - `src/components/verification-view.tsx` (HEAD: label 54; government-ID country and class 113-120; extraction 130-141; generic Details 98, Checks 143-154, Files 156-188);
  - `src/components/verification-card.tsx` (HEAD: government-ID branch 95-104);
  - `src/components/extraction-table.tsx:11-14` is typed to government ID.
  - The working tree (Workflow 4B) is adding selfie branches to these files.
- **Labels** (`src/lib/labels.ts`):
  - `VERIFICATION_TYPE_LABELS` (43-47) is a `Record<VerificationResourceType>`, so typecheck forces a label for each new type;
  - `EXTRACTION_SOURCE_LABELS` already has `nfc: 'NFC chip'` (78);
  - `FILE_KIND_LABELS` (81-88).
- **Reason words:**
  - one flat map, `src/lib/check-reasons.ts` (`REASON_WORDS` 20-166, `EXPLANATIONS` 172-187, `reasonText` 190-197);
  - test `src/lib/check-reasons.test.ts`: `CONTRACT_REASONS` is the union of the contract lists (27-35); every listed reason must have words (53-57); the reverse check (59-63) fails words for a code that is not listed.
  - So each new type's `<TYPE>_CHECK_REASONS` must be exported and added to `CONTRACT_REASONS`.
- **An unknown type has no graceful fallback.** Responses are parsed strictly:
  - `verificationResourceSchema` union (`packages/contracts/src/verifications.ts:191-194`);
  - `dashboardInquiryDocumentSchema` (`dashboard-api.ts:199-210`);
  - failures throw `OpenVerifyResponseValidationError` (`src/lib/api/http.ts:85`);
  - the page then shows its error boundary (`src/app/verifications/[id]/error.tsx:12-13`, `src/app/inquiries/error.tsx:13`).
- **Timeline:** `src/components/lifecycle/inquiry-timeline.tsx:39-45` hard-codes the two verification resource types.
- **Inquiry page:** `src/components/lifecycle/inquiry-view.tsx` (HEAD: `isVerification` 92-95, which guards non-verification includes; `c7cfa40`); one `VerificationCard` per verification (312-333).
- **Template editor** (raw JSON per document; no per-type UI):
  - `src/components/lifecycle/version-editor.tsx:30-130`;
  - error pointer labels in `verification-config-pointers.ts`: `TYPE_LABELS` 11-14 (two types), `LIST_LABELS` 17-20 (`allowed-countries`, `allowed-id-classes`); an unknown type returns `undefined` (66-68).
- **Events:** event groups in `src/lib/api/events.ts:75-84`; environment settings fields in `src/components/operators/settings-fields.ts:10`.
- **Phase 5 terms:** no dashboard matches for `verification/document|database|phone|email`, crypto, KYB or proof of address. "phone" and "otp" appear only in MFA code.
- **Selfie precedent, in commit order** (for mirroring; each step is chore stub → RED → GREEN):

  | Step | Commits |
  |---|---|
  | Event groups and settings | `29bf304`→`7bfee47` |
  | Inquiry-view guard | `941326b`→`c7cfa40` |
  | Reason words | `060d289`→`41311b8` |
  | `selfie-words.ts` | `f406b3f`→`8efb16b`→`a423118` |
  | `selfie-evidence.ts` readers | `d0264c4`→`b97a49d`→`27aaec3` |
  | Shared image refactor | `e564381` |
  | `selfie-evidence.tsx` | `3d9b2ab`→`55c5141`→`ab02072` |
  | Card, pages and inquiry section | `ee7af1e`→`0faad96`, GREEN uncommitted |

  For government ID: config pointers `4370aeb`→`bb39a6c`→`3f7feb7`; extraction table `8fbfbac`→`82130bc`→`73458a0`; README `d9e7af0`; e2e `bb657fc`.

---

## 8. Existing docs

- **`docs/checks/`** holds only `government-id.md` (603 lines), `selfie.md` (439) and `sandbox-providers.md` (96). **There are no docs for document, database, phone, email, NFC, crypto or business.**
  - Entry format (`government-id.md:111`, example at 115-125): `#### \`check_id\``, then a table `| Tier | Type | Stage | Inputs | Default template |`, then a description, then **Reasons**, **Settings** and **Limits** bullets.
  - `selfie.md:90` adds a Version column.
  - `id_nfc_expired_detection` is documented at `government-id.md:546-556`, with "(NFC verifications, Phase 5)" and "logic only … arrives in Phase 5". See also 550, 556, 602.
  - `sandbox-providers.md`: the 12 variables (9-16); magic values (25-74); "Adding a real provider" (94-96). It documents no SMS, SMTP, database, KYB or crypto provider.
- **`docs/research/persona-surface.md`** is an identifier index with **no status column** (3-5). Phase 5 rows:
  - **Checks:** 11-31 (`aamva_identification_number_comparison`, `business_website_*` 12-14, `crypto_wallet_*` 15-18, `database_*` 19-26, `document_*` 27-30, `id_aamva_database_lookup` 31) and `id_nfc_expired_detection` 55. Persona lists **no** OTP checks.
  - **Verification types (82-143):**
    - aamva / aamvas 84-85, bank-pennydrop 86, business-website 88, crypto-wallet 91;
    - database 92 and database-* 93-108 (aadhaar, business, business-footprint, ecbsv, phone-carrier, serpro, standard, tin, uk-dvla, vat-number);
    - digital-id-* 109-125;
    - document / documents 126-127, email-address 128-129, government-id-nfc 131-132, jp-my-number-nfc-scan 134, mdoc 135;
    - phone-number 137, phone-number-silent-network-authentication 138, phone-numbers 139, verifiable-credential 143.
  - **Reports:** these belong to **Phase 6**, not Phase 5 (`docs/PLAN.md:372-376`): address-lookup 148, business-* 152-168, crypto-address-watchlist 175, email-address 177, phone-number 188.
  - **List items:** email-addresses 207, phone-numbers 213.
  - **Webhooks:** `document.*` 250-255, `verification.*` 346-356 (including tentatively-passed/failed and requires-retry).
  - **API paths:** `verification/{documents, email-addresses, government-id-nfcs, phone-numbers, databases, database-*, aamvas}` 519-531, `document/*` 412-414. There is no crypto-wallet or business verification path.
- **Plans:**
  - `docs/plans/phase-{1..4}.plan.md`. Phase 4 structure: Summary 22, **Starting point (inventory) 36**, Patterns to mirror 50, Locked contracts 65 (C39-C49), Workflow 4A 381, 4B 423, Validation 430, Risks 446, Acceptance 461, Decisions 473, stage amendments 497-660.
  - **The highest contract id is C49, so Phase 5 starts at C50.** Phase 1 used C1-C8, Phase 2 C9-C28, Phase 3 C29-C38, Phase 4 C39-C49.
  - Review-finding ids: E001-E003, F001-F035, G001-G012, K001-K003 and K101-K103.
  - Each phase carries a "Carry-over" contract (C38, C48).
  - Explicit "Phase 5" mentions: `docs/plans/phase-3.plan.md:173, 470, 892`, plus the code comments listed in §9.
  - **Phase 4 Workflow 4B is still open** (`docs/PROGRESS.md:10, 79-83`). There is no Phase 5 entry.
- **ADRs:**
  - `0001` (stack): SMTP and Mailpit at 44 and 53; JMRTD at 19, 26 and 93.
  - **`0002` (check tiers and honesty):** rules 3a-3g at 51-84 (sandbox-only providers 3d at 67; `provider_not_configured` 3e at 72; provenance and promotion to ga 3f at 74); enforcement at 86-93.
  - `0003` is not relevant.
- **Research for Phase 5:** none. Nothing covers PDF forensics, OTP, Passive Authentication, GLEIF, Companies House, EDGAR, RDAP or crypto. Tangential: `docs/research/phase4-selfie-behaviour.md:303` (NFC portrait), 321 (Persona accepts PDF uploads), 342 (handoff by SMS or email).
- **`THIRD_PARTY_LICENSES.md`:**
  - §2.2 "Planned" lists libphonenumber (169) and JMRTD + SCUBA (177).
  - §4.2 "Planned data sources" lists GLEIF (223), Companies House (224), EDGAR (225), disposable-email-domains (230) and the ICAO/BSI CSCA master list (231), all "to verify on adoption".
  - No KYB, RDAP, URLhaus or wallet library is listed yet.

---

## 9. What PLAN §4.3 needs that the code already partly implements

| PLAN §4.3 need | Existing piece | Gap |
|---|---|---|
| Name matching, "Jaro-Winkler + nickname table" | `packages/checks/src/name-matching.ts`: `normalizeName` 26 (NFKD, ß→ss and the like), `jaroWinkler` 105, `tokenSetSimilarity` 133, `compareNames` 171. `extraction/agreement.ts`: `NAME_TOKEN_THRESHOLD = 0.92` 15, `confusableEqual` 31, `namesAgree(a,b,{threshold, allowMissingTokens})` 142 | **No nickname table** |
| Address, "libpostal-style normalisation" | `extraction/agreement.ts`: `ADDRESS_WORDS` abbreviation map 161-174, `addressTokens` 176, `addressesAgree` 187 (same tokens in order; digits exact), `postalCodesAgree` 202 (prefix ≥5), `fieldsAgree(field, a, b)` 255 (keyed by `ExtractionField` kebab names). `id-po-box-detection.ts` (PO Box / APO / CMRA patterns, `normalizeAddress` 43, `idPoBoxDetection` 66) | No parser or libpostal; abbreviation map only |
| "Partial DOB" | `dates.ts`: `parseIsoDate` 22 (strict `YYYY-MM-DD`), `daysBetween` 42, `utcToday` 47, `ageOn` 55 | **No partial-date type** (year only, year and month) |
| Inquiry/account comparison (for `document_name/address_comparison` and the database comparisons) | `government-id/comparison.ts`: snake_case reference keys mapped to extraction fields (`ADDRESS` 15-22), `compareWithReference` 104, giving `<field>_mismatch`, `no_reference_data` or `input_missing`. Config: `comparison()` in core (`check-config.ts:209-216`) | Operates on government-ID `ExtractedFields`; database fields would need the same mapping |
| Document "issue date within N days" | `daysBetween`, `utcToday`; `judgeExpiry` (`id-expired-detection.ts:40`) | Not wired to `document_expired_detection` |
| Country codes | `country-codes.ts`: `ISO_ALPHA2_TO_ALPHA3` 10, `normalizeCountryCode` 39, `alpha3ToAlpha2` 59, `isIcaoIssuerCode` 68. `data/iso3166.ts` (`ISO3166_COUNTRIES` 16), `data/icao-codes.ts` | — |
| NFC DG1 to MRZ | `mrz.ts`: `parseMrz` 499 and `computeMrzCheckDigit` 151 (DG1 *is* an MRZ). `id-mrz-inconsistency-detection.ts`. Android `mrz/BacKeySeed.kt` | No DG/SOD (ASN.1) parsing |
| NFC expiry | `id-nfc-expired-detection.ts:19-31` (logic, tested); config and defaults in core; reasons in contracts (258); doc in `government-id.md:546` | Not wired; no NFC verification exists |
| Extraction precedence including chip | `extraction/consolidate.ts:5` (NFC first), `case 'nfc'` 66; `EXTRACTION_SOURCES` contains `nfc` | No NFC reading feeds it |
| Chip portrait (DG2) to selfie | `face-match.ts`, `FACE_MATCH_DEFAULTS` (`check-config.ts:38-47`), `/v1/embed/face` with `subject=document` | DG2 is JPEG2000 or JPEG; vision decodes no JPEG2000 |
| H-tier scoring | `government-id/scores.ts` (`HeuristicScore` 20, `tamperScore` 133, `fabricationScore` 217), `h-tier.ts` (`judgeHeuristic` 27) | Tied to the government-ID context |
| Result building and config | `result.ts`: `checkResult` 40, `parseCheckConfig` 96, `presentText` 115. `government-id/values.ts`: `numberOf`, `listOf`, `thresholdsOf` | — |
| Crypto checksums | Nothing (no base58, bech32 or keccak) | Everything |
| Phone parsing | Nothing | Everything |
| ID-number formats (database `identification_number`) | `data/us-dl-formats.ts`, `data/national-id-checksums.ts`, `data/icao-document-number.ts` | — |

---

## 10. Cross-cutting gaps the plan must resolve (all verified in code)

1. **Step type and verification type mapping.**
   - Step names `phone_otp`, `email_otp` and `nfc` differ from the verification types `phone_number`, `email_address` and `government_id_nfc`.
   - `verificationTypeForStep` (`verification-types.ts:107-109`) and `stepFor` (`apps/api/src/services/flow.ts:128-130`) both assume identity.
   - Crypto wallet and business have **no step type** at all.
2. **Completion counting.** `requiredVerifications` (`apps/api/src/jobs/inquiry-outcome.ts:36-43`) skips steps without a numeric `maxAttempts`. That covers `document` and `database` (no field) and `phone_otp`, `email_otp` and `nfc` (optional field). `createFlowVerification` also reads `step.maxAttempts` (`flow.ts:331`).
3. **Template rules.**
   - `checkFlowMatchesConfig` refuses every step outside the 5 supported types (`inquiry-templates.ts:125-131`) and requires a government ID or selfie step (162-166).
   - `verificationConfigSchema` is strict over two keys (42-46).
   - There is no type-level option for allowed chains, document types or phone countries (`decision-engine.ts:31-36`).
4. **Strict decoders everywhere.** A server that adds a verification type breaks the web flow session decode, the dashboard inquiry and verification pages, and `packages/node` consumers until each parses the type. Android tolerates it (lenient JSON, `UNKNOWN`), but **`FileKind` has no fallback**.
5. **Files are images-only.** Contracts `detectImageMimeType` and `fileAttributesSchema` (`files.ts:74-112`), the DB `file_kind` enum, the flow `uploadFile` 415 (`flow.ts:456-459`), the dashboard content route (`routes/dashboard/files.ts:81-82`), the vision client `EXTENSIONS`, vision `ALLOWED_FORMATS`, the web `IMAGE_INPUT_ACCEPT` and Android `ImageOnly` all need extending for PDF. `files.mime_type` already allows `application/pdf`.
6. **No user-entered data path.** The flow API has no endpoint for entered values (phone, email, database fields, wallet address, business identity). Clients have no form inputs. Inquiry `fields` (`inquiries.ts:56-64`) are set only by the server API (`POST`/`PATCH /inquiries`). The flow-spec `form` step exists but is unsupported.
7. **Sending infrastructure.**
   - The mailer exists only in the API process.
   - There is no SMS port.
   - Rate-limit policies are a closed enum.
   - The worker and the `worker` compose service have no SMTP settings.
8. **The NFC client is Phase 10.** Server Passive Authentication must be developed and tested against synthetic SOD/DSC/CSCA fixtures (a test CSCA generated by a fetch or fixtures script). The real BSI master list is listed as a planned data source with terms to verify.
9. **Vision document path.** It needs a new `/v1/analyze/document` (A4 pages, no ID aspect gate, no 200-line cap or a higher one, ELA without a portrait, and a PDF render or parse decision).
10. **Licence reviews before adoption:**
    - libphonenumber-js;
    - a PDF library (pypdf, pypdfium2 or pdf.js);
    - crypto (`@noble/*`, `@scure/base`);
    - ASN.1 (`@peculiar/*`, MIT, already transitively present);
    - data: disposable-email-domains, the CSCA master list, GLEIF, Companies House, EDGAR, URLhaus.

    Each gets a `THIRD_PARTY_LICENSES.md` row and SHA-256-pinned fetch scripts. The existing fetchers are Python: `scripts/fetch_models.py` and `scripts/fetch_fixtures.py`.
11. **Defaults leading to review.** R+A checks default to required (see §1.2), so with no provider the default outcome is `needs_review`.
12. **Stale `CLAUDE.md` layout.** It lists `apps/demo-web` and `packages/{workflow-engine,watchlist,signals,sdk-js,sdk-react}`, which do not exist. The actual packages are `checks config contracts core db flow-spec node ui`.

---

## 11. Conventions a new verification type must follow (end to end, in order)

This order is derived from how government ID and selfie run through the code and from the Phase 4 commit order (`git log cbe3d5c..62fc9fa`).

**Every unit:**
- lands as a `chore(...)` stub, then `test(...)` RED, then `feat(...)` GREEN, then optional `refactor`;
- uses conventional commits naming the contract ids (for example `C40.1`) and ending with the `Claude-Session` line;
- records its evidence in `docs/tdd/phase5-<agent>.tdd.md`;
- keeps each package at ≥80% coverage.

**0. Plan**
- `docs/plans/phase-5.plan.md` with a Starting point (this file), Patterns to mirror, Locked contracts C50 and up, Workflows, Validation, Risks, Acceptance and Decisions.
- Amendments to the PLAN §4.3 rows when registry facts change. Keep `check-registry.test.ts` `SECTION_4_3` in step.

**1. `packages/core`**
1. `check-registry.ts`: `inputs`, `modelBased`, `version` bump, `configSchema`, and the `OPTIONAL_BY_DEFAULT` choice. Update the `check-registry.test.ts` tables (`SECTION_4_3`, `MODEL_BASED`, inputs, `OPTIONAL_REAL_CHECKS`).
2. `check-config.ts`: kebab-case config schemas with ranges, plus `<TYPE>_CHECK_CONFIG_DEFAULTS` as `ConfigDefault {value, basis, source}` (the selfie model, 370-521). Test in the style of `selfie-check-config.test.ts`.
3. Type-level template options (like `allowed-countries`): `decision-engine.ts:31-36`.
4. A sub-resource state machine, if any (`selfie-capture-state-machine.ts`), exported from `index.ts`.
5. Extraction field types, if the type extracts (`extraction.ts`).

**2. `packages/flow-spec`**
- Step schema in `flow.ts` (with `maxAttempts` if it is a verification step).
- Regenerate `schema/flow.schema.json` (`scripts/export-json-schema.ts`).
- Tests in `flow.test.ts`.

**3. `packages/contracts`**
1. `verification-types.ts`: the four tables and the step→type mapping.
2. `verifications.ts`: an attributes schema with `checksSchema('<type>')`; full and flow resource schemas added to both unions; `VerificationRecord` fields; the `buildVerificationResource` branch.
3. `files.ts`: kinds, `FILE_KINDS_BY_VERIFICATION_TYPE`, `requiredFileKinds`, accepted MIME types and detection.
4. `flow-api.ts`: a `createFlowVerificationBodySchema` variant. New flow bodies and sub-resources go in `<type>.ts`, in the model of `selfie-captures.ts` (TTL, caps, nonces, problem codes).
5. `<type>-check-reasons.ts`: `<TYPE>_CHECK_IDS`, shared reasons, the per-check map; export from `index.ts`; add user-behaviour reasons to `contracts/fixtures/flow/retry-hint-reasons.json`.
6. `ids.ts` prefixes, `resource-types.ts`, `identifiers.ts`, `tokens.ts` (secret prefixes).
7. `event-names.ts` (new subject events) and `events.ts` (`PREFIX_BY_SUBJECT_TYPE`, the redacted-stub enum, payload unions).
8. `inquiries.ts` include union and `dashboard-api.ts` included union.
9. `inquiry-templates.ts`: `verificationConfigSchema` keys and per-type option guards, `SUPPORTED_FLOW_STEP_TYPES`, `checkFlowMatchesConfig`, and the default template plus its fixture if it changes.
10. `rate-limits.ts` policies; `problem.ts` codes.
11. Golden fixtures `contracts/fixtures/api/verification-<type>.json` (and sub-resources), a `contracts/README.md` table row, and validation in `fixtures.test.ts`.
12. `packages/node/src/types.ts` type guards.

**4. `packages/db`**
1. `src/tables/<type>.ts`: sealed PII columns, status checks and `idFormat`; export via `schema.ts`; enums (`file_kind`) with `ALTER TYPE … ADD VALUE`.
2. Migration `0016_*` via drizzle-kit (SQL, `meta/` snapshot, journal). It runs `CREATE EXTENSION IF NOT EXISTS vector` itself if it needs pgvector. Add a migration integration test.
3. `encrypted-columns.ts` (`ENCRYPTED_COLUMNS`, `SEALED`), checked by `schema-v2.test.ts:535`.
4. `src/repositories/<type>.ts`, plus `redaction.ts` (and its header table) and `retention.ts`.
5. Blind index for searchable identifiers (the `blind-index.ts` pattern, plus a rebuild script).

**5. `services/vision`** (only if the type needs images or PDF)
1. pydantic models in `schemas.py` (`_Contract`).
2. The endpoint in `app.py` (`v1_router`; body limits in `limits.py`).
3. An analysis module and tests.
4. Golden fixture via `tools/make_contract_fixtures.py` into `contracts/fixtures/vision/`.
5. `tests/test_dependencies.py` pins, `NOTICE`, `THIRD_PARTY_LICENSES.md`.
6. On the API side: `apps/api/src/vision/schemas.ts` (zod), the `ports.ts` `VisionClient` method, and `vision/index.ts`.

**6. `packages/checks`**
- `src/<type>/` with one file and test per check (pure functions returning `CheckResult` with stage, confidence and provenance, including `threshold-basis`).
- `context.ts`, `inputs.ts`, `reasons.ts` (`<TYPE>_EVALUATOR_REASONS`), `evaluators.ts` (`<TYPE>_EVALUATORS` map, the selfie model at `selfie/evaluators.ts:23-43`), an `index.ts` export, and `testing/` fixtures.

**7. `apps/api`**
1. `ports.ts` provider kinds and real/sandbox interfaces. Then `providers/index.ts` (`PROVIDER_ENV_PREFIXES`, bindings), `providers/sandbox.ts` (documented magic values), `.env.example`, and `docs/checks/sandbox-providers.md`.
2. `services/flow.ts` (create, upload or entry, submit) and a `services/<sub-resource>.ts` (the selfie-capture model); `routes/flow/index.ts` (plugin-registered, rate-limited); `pnpm --filter @openverify/api openapi:write`.
3. `services/resources.ts` (`supportedType`), `services/verifications.ts` (document, event and cancel branches), `routes/server/verifications.ts` (includes, sub-resource GET), `routes/dashboard/inquiries.ts` and `resources.ts`.
4. `jobs/<type>.ts` (evaluation), the `jobs/process-verification.ts` `evaluate()` dispatch, `failVerificationAfterError` cleanup, `jobs/inquiry-outcome.ts`, `jobs/<type>-contract.test.ts` (reasons), and `*-race.integration.test.ts` (lock order: inquiry, then verification, then sub-resource).
5. `webhooks/samples.ts` subject fixture; `services/redaction.ts`; retention; `seed/dev-seed.ts` if the default template changes.

**8. Clients**
- **`apps/flow`:** `flow/flow-position.ts` (position and `stepPosition`), `flow/flow-renderer.tsx` (switch), `steps/<type>-step.tsx`, `api/flow-api-client.ts`, `i18n/locales/{en,es}.ts`, `unsupported-step.tsx` map, retry reasons, CSP if needed, and mocked Playwright `apps/flow/e2e/*.spec.ts`.
- **Android:** `model/Flow.kt` and the serializer, `FlowCoordinator.resolve`, `FlowState`, `InquiryFlowScreen`, `FlowActions` and `InquiryViewModel`, `FlowApi` and `FlowApiClient`, `WireEnums`, `strings.xml` (en, es), `Messages.kt`, and `ContractFixturesTest`.

**9. `apps/dashboard`**
1. `lib/labels.ts`
2. Event groups and settings
3. The `inquiry-view.tsx` include guard
4. `lib/check-reasons.ts` and its test (`CONTRACT_REASONS`)
5. `lib/<type>-words.ts`
6. `lib/<type>-evidence.ts` and `testing/<type>-fixtures.ts`
7. `components/<type>-evidence.tsx`
8. Card, verification view and page (includes)
9. `inquiry-timeline.tsx:39-45`
10. `verification-config-pointers.ts:11-20`
11. `testing/api-fixtures.ts`
12. `apps/dashboard/README.md`

**10. Docs, e2e and progress**
- `docs/checks/<type>.md` in the entry format.
- Full-stack `e2e/tests/<type>*.spec.ts`. Email OTP can read Mailpit through `e2e/src/mailpit.ts:24`.
- `docs/PROGRESS.md` entry; `THIRD_PARTY_LICENSES.md` rows.
- Calibration report if model-based checks want `ga`.
