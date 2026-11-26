# TDD evidence: Phase 5, Workflow 5B Stage 1 (`contracts-5b`)

Each unit follows the cycle stub (when a RED test needs a name that does not exist yet), RED (run, failing for the intended reason), GREEN, with the commits named. Every command ran from the repository root after `source scripts/env.sh`, unless it says otherwise. Output is trimmed to the lines that matter. Python runs use `COVERAGE_FILE=/tmp/openverify-cov-contracts-5b` and mypy `--cache-dir /tmp/openverify-mypy-contracts-5b`.

## 1. The PDF libraries, their notices and the PDFium CVE record (C60.3, decisions 30 and 31)

`uv add "pypdfium2==5.14.0" "pypdf==6.19.0"` (under `flock /tmp/openverify-uv.lock`) resolved 61 packages and added exactly these two to `uv.lock`; nothing else moved. For the RED run the two dependency files were set aside and the committed versions put back in the working tree, so the tests met the tree as it was.

RED (`services/vision/tests/test_dependencies.py`: the pins, the banned PDF packages, the installed PDFium build against the CVE record, the NOTICE credits, the `THIRD_PARTY_LICENSES.md` rows):

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts-5b uv run --frozen pytest tests/test_dependencies.py --no-cov -q)
E   assert 'pypdfium2==5.14.0' in ['fastapi>=0.150.0', 'numpy>=2.5.4', ...]
E   AssertionError: assert 'CVE-2026-113022' in '# Third-party licenses ...'
E   AssertionError: based in part on the work of the FreeType Team
E   AssertionError: pypdfium2
FAILED tests/test_dependencies.py::test_the_pdf_libraries_are_pinned_runtime_dependencies
FAILED tests/test_dependencies.py::test_the_installed_pdfium_is_the_build_the_cve_record_names
FAILED tests/test_dependencies.py::test_the_notice_carries_the_credits_the_bundled_licences_ask_for
FAILED tests/test_dependencies.py::test_third_party_licenses_lists_the_pdf_libraries_and_their_bundled_licences
4 failed, 5 passed in 0.19s
```

`test_no_banned_pdf_library_is_locked` passed on the old lock as well: no banned package was ever locked, and the test keeps it that way.

GREEN: the two pins back in `pyproject.toml` and `uv.lock`; `services/vision/NOTICE` gains the notices the libraries compiled into PDFium and shipped in pypdf ask for (the FreeType credit line and its "based in part on the work of the FreeType Team" disclaimer, the IJG sentence, ICU's Unicode-3.0 notice, AGG, libpng-2.0, zlib, the LLVM exception, and Adobe's AFM metrics); `THIRD_PARTY_LICENSES.md` gains §2.1.9 (pypdfium2, PDFium build 8076, its compiled-in libraries by licence, pypdf), the PDFium CVE record and six Excluded rows.

The CVE record was written from the primary sources, read 2026-10-23: NVD (`CVE-2026-113022`, "prior to 156.0.8078.47", Chromium issue 494352583), the Chrome Releases post of 2026-10-20 that promoted Chrome 156 (156.0.8078.47) and lists the CVE, the pdfium-binaries releases (`chromium/8076` 2026-09-29 as `156.0.8076.0`; later `8086`, `8100`, `8111`), the installed wheel's `pypdfium2_raw/version.json` (`major 156, build 8076, patch 0, origin pdfium-binaries`) and PyPI (5.14.0 is pypdfium2's newest release). The issue is restricted, so whether build 8076 holds the fix is recorded as not verifiable, and the build is treated as unfixed.

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts-5b uv run --frozen pytest tests/test_dependencies.py tests/test_ocr_notice.py --no-cov -q)
20 passed in 0.18s
```

## 2. The `@openverify/emrtd` package and its dependencies (C62.1, C65.3, decision 37)

Stub `bce4c4a3`: the package skeleton (its `.` and `./testing` entry points with the `@openverify/source` condition, `build`, `lint`, `typecheck` and the shared coverage-gated `test`), linked by `pnpm install` (the lockfile gains the importer only).

RED (`packages/emrtd/src/dependencies.test.ts`):

```text
$ pnpm --filter @openverify/emrtd exec vitest run src/dependencies.test.ts --coverage.enabled=false
     × pins asn1js and pkijs exactly, takes @noble/curves from the catalog and core from the workspace
     × locks pkijs 3.4.1 and the helpers it brings
     × is a workspace dependency of apps/api
     × is a workspace dependency of packages/checks
     × is a workspace dependency of e2e
AssertionError: expected undefined to deeply equal { '@noble/curves': 'catalog:', …(3) }
AssertionError: expected [] to deeply equal [ '3.4.1' ]
AssertionError: expected undefined to be 'workspace:*' // Object.is equality
      Tests  5 failed | 1 passed (6)
```

The one-version test passes before and after: `asn1js@3.1.0` is the only version locked, and pkijs 3.4.1's `^3.0.6` must keep resolving to it. (Its first run read the lockfile's first YAML document, which locks pnpm itself; the helper now reads the last one.)

GREEN: `packages/emrtd` depends on `asn1js` 3.1.0, `pkijs` 3.4.1, `@noble/curves` (catalog, 2.4.0) and `@openverify/core`; `apps/api` and `packages/checks` depend on `@openverify/emrtd` (`workspace:*`), and `e2e` as a dev dependency. `pnpm install` (under `flock /tmp/openverify-pnpm.lock`) added three packages, `pkijs@3.4.1`, `bytestreamjs@2.0.1` and the nested `@noble/hashes@1.8.0` that pkijs pins, and reused `asn1js@3.1.0`, `pvutils@1.2.0`, `pvtsutils@1.3.6` and `tslib@2.8.1`. It wrote no `minimumReleaseAgeExclude` entry and no `allowBuilds` entry was needed (no install script). `THIRD_PARTY_LICENSES.md` §2.1.9 gains their rows.

```text
$ pnpm --filter @openverify/emrtd exec vitest run src/dependencies.test.ts --coverage.enabled=false
      Tests  6 passed (6)
```

### The report types, the bounds and the stubs (C62.1-C62.9, C65.3)

Stub `337cdb66`: the report types (`types.ts`), `EmrtdNotImplementedError` and `EmrtdError`, the ICAO object identifiers, the bounds module with zeroed values, and every Stage 2 function (`prescanTlv`, `parseSod`, `parseDg1`, `parseDg2`, `parseDg15`, `parseCertificate`, `verifyCertificateSignature`, `parseCrl`, `verifyCrlSignature`, `parseMasterList`, `verifyMasterList`, `verifyPassiveAuthentication`, `verifyActiveAuthentication`, `selfTest`) and test-chip builder (`testKeyPair`, `buildCsca`, `buildDsc`, `buildLinkCertificate`, `buildCrl`, `buildMasterList`, `buildChip`, `signActiveAuthentication`) as a stub that refuses.

RED (`limits.test.ts`, `stubs.test.ts`):

```text
$ pnpm --filter @openverify/emrtd exec vitest run --coverage.enabled=false
     × bounds the TLV pre-scan at depth 32 and 20,000 nodes
     × takes RSA moduli of 1,024 to 8,192 bits with a public exponent below 2^32
     × takes EC fields of at most 521 bits
     × gives each verification a positive time budget
     × lists the brainpool r1 curves from P-192 to P-512 and the NIST curves from P-192 to P-521
AssertionError: expected +0 to be 32 // Object.is equality
AssertionError: expected [] to deeply equal [ [ 'brainpoolP192r1', …(2) ], …(10) ]
      Tests  5 failed | 34 passed (39)
```

The 22 stub cases pass at RED: they pin the stub contract itself (each function refuses with `EmrtdNotImplementedError` naming itself, so no stub can return a report), and `emrtd` replaces them as it builds each function.

GREEN: the bounds take the plan's values, the time budget is 5,000 ms (ours, provisional: it only stops a pathological input) and the allowlist holds the six brainpool r1 curves and the five NIST prime curves with their OIDs.

```text
$ pnpm --filter @openverify/emrtd test
 Test Files  3 passed (3)
      Tests  39 passed (39)
Statements   : 100% ( 48/48 )   Branches : 100% ( 1/1 )   Functions : 100% ( 25/25 )   Lines : 100% ( 48/48 )
```

## 3. The Workflow 5B check folders (C54.4, V09)

Stub `6fc95da9`: `packages/checks/src/{document,business,nfc}/index.ts`, each naming its contracts and owner (`checks-5b` for document and business, `emrtd` for nfc). The 5B per-area config modules already exist (`packages/core/src/check-config/{document,business,nfc}.ts`, Stage 1a of 5A), as do the reasons files (`packages/contracts/src/{document,business,nfc}-check-reasons.ts`); they need no change here.

RED (`packages/checks/src/index.test.ts`, which already holds the 5A folders):

```text
$ pnpm --filter @openverify/checks exec vitest run src/index.test.ts --coverage.enabled=false
     × re-exports everything the document folder exports
     × re-exports everything the business folder exports
     × re-exports everything the nfc folder exports
      Tests  3 failed | 6 passed (9)
```

GREEN: three export lines in `packages/checks/src/index.ts`.

```text
$ pnpm --filter @openverify/checks exec vitest run src/index.test.ts --coverage.enabled=false
      Tests  9 passed (9)
```

## 4. The vision document contract (C60.1, C60.2, C60.4, `subject=chip`)

Stub `4fa8b92b`: the contract's names in `schemas.py` (the limits, the problem codes, `analysed_page_numbers`, empty `DocumentAnalysis` and `VisionPngLimits` models), `document_analysis.py` (`analyze_document`, `render_document_page`, `convert_portrait`, `decode_chip_portrait`, each raising `NotImplementedError`) and the guarded child's package (`openverify_vision.guarded`, `WORKER_MODULE`, a `worker.main` stub).

RED (`tests/test_schemas_document.py`, `tests/test_app_document.py`, and `tests/test_contract_fixtures.py` with the four new fixtures and their semantics):

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts-5b uv run --frozen pytest tests/test_schemas_document.py tests/test_app_document.py tests/test_contract_fixtures.py --no-cov -q)
FAILED tests/test_schemas_document.py::test_the_analysed_pages_are_the_first_three_and_the_last[2-pages1]   (NotImplementedError)
FAILED tests/test_schemas_document.py::test_the_golden_documents_round_trip[analyze-document-pdf.json]       (FileNotFoundError)
FAILED tests/test_schemas_document.py::test_a_hidden_line_names_why_and_a_visible_one_does_not
FAILED tests/test_app_document.py::test_each_route_answers_501_until_built[/v1/analyze/document-files0-data0]   (404)
FAILED tests/test_app_document.py::test_each_route_answers_501_until_built[/v1/embed/face-files3-data3]          (422: subject chip refused)
FAILED tests/test_app_document.py::test_the_document_route_takes_a_route_limit_of_one_upload
FAILED tests/test_contract_fixtures.py::test_fixture_dir_is_the_shared_contracts_location
FAILED tests/test_contract_fixtures.py::test_committed_fixture_equals_the_generator_output[analyze-document-pdf.json]   (KeyError)
FAILED tests/test_contract_fixtures.py::test_the_chip_portrait_embedding_is_the_id_holders
45 failed, 24 passed in 2.36s
```

The token cases pass at RED: `/v1` refuses a request without the service token before routing, whatever the path.

GREEN: the full models in `schemas.py` (`DocumentAnalysis`, `DocumentPage`, `TextLayerLine` with `visible` and `hidden_reason`, `DocumentOcrLine`, `PdfMeasurements`, `XmpFields`, `PdfFont`, `PdfActions`, `DocumentImageMeasurements`, `DocumentModelVersions`, `VisionPngLimits`, `analysed_page_numbers`), `EmbedSubject` gains `chip`; `app.py` registers `/v1/analyze/document`, `/v1/render/document-page` (form `page`, at least 1) and `/v1/convert/portrait` in a `vision-document` block, with a route limit of one upload plus 64 KiB each, and `/v1/embed/face` decodes a `chip` subject through `document_analysis.decode_chip_portrait`; `problems.py` answers a `NotImplementedError` as a 501 problem with `code: not_implemented`; `tools/make_contract_fixtures.py` writes the four new fixtures (`build_document_fixtures`), and every existing fixture regenerated byte-identical.

```text
$ (cd services/vision && uv run python tools/make_contract_fixtures.py) && pnpm exec prettier --write contracts/fixtures/vision/*.json
wrote .../analyze-document-pdf.json, analyze-document-image.json, png-limits.json, embed-face-chip.json
$ git status --short contracts/      # only the four new files
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts-5b uv run --frozen pytest -q)
TOTAL 7523 12 1156 8 99%   Required test coverage of 80% reached. Total coverage: 99.77%
1980 passed in 335.09s
```

### The API side: zod, the ports and the vision client

Stub `749ab4de`: the C60.1 types in `apps/api/src/ports.ts` (`DocumentAnalysis` and its parts, `VisionDocument`, `VisionPortrait`), `FaceEmbeddingSubject` gains `chip`, `VisionClient` gains `analyzeDocument`, `renderDocumentPage` and `convertPortrait` (rejecting), `documentAnalysisSchema` is `z.never()`, and the fake vision (`jobs/testing.ts`) answers the golden PDF analysis and a PNG header.

RED (`apps/api/src/vision/document-schemas.test.ts`, and the C60 cases of `vision/index.test.ts`):

```text
$ pnpm --filter @openverify/api exec vitest run src/vision --coverage.enabled=false
     × parse analyze-document-pdf unchanged
     × parse analyze-document-image unchanged
     × analysed pages other than the first three and the last
     × a visible line with a hidden reason, or a hidden one without
     × posts a PDF as the document field and returns the analysis
     × asks for a page as a PNG and returns its bytes
     × refuses a page number below 1 or not whole, without calling vision
     × refuses a preview over 1,600 px
     × embeds a chip portrait with subject chip (C60.4)
     × carries the code pdf_encrypted of a 422
     × keeps the code null for a body over 4 KiB
      Tests  29 failed | 97 passed (126)
```

The refusal cases that pass at RED pass only because the stub schema refuses everything.

GREEN: `documentAnalysisSchema` mirrors the pydantic models (the same refinements and messages), with `analysedPageNumbers`, the C60.1 limits and the PNG bounds exported; the client sends any vision file through one `send` (the extensions now include `pdf` and `jp2`), reads a problem body's `code` (at most 4 KiB of `application/problem+json`, kept only when it looks like a code) into `VisionServiceError.code`, and checks each PNG answer (`image/png`, a PNG signature and IHDR, each side from 1 to 1,600 or 640 px) before returning its bytes (`pngSize`).

```text
$ pnpm --filter @openverify/api exec vitest run src/vision src/ports.test.ts src/jobs/process-government-id.test.ts src/jobs/process-selfie.test.ts src/worker.test.ts --coverage.enabled=false
      Tests  243 passed (243)
```

## 5. Migration 0018 and the Workflow 5B repositories (C53.3-C53.6, C54.4, C62.8)

Stub `f0518285`: the five repository files (`document-extractions.ts`, `chip-challenges.ts`, `chip-reads.ts`, `business-registry-records.ts`, `trust-anchors.ts`) with their types and every read as a stub that throws, their export lines in `repositories/index.ts`, the `chc` id prefix, and `chipSodIndex` and `chipDocumentNumberIndex` stubs (labels `openverify/chip-sod/v1`, `openverify/chip-document-number/v1`).

RED, with the seeders in `@openverify/db/testing` (`seedDocumentExtraction`, `seedChipChallenge`, `seedChipRead`, `seedBusinessRegistryRecord`, `seedTrustAnchorSource`, `seedTrustAnchor`, `seedTrustAnchorMembership`, `seedTrustCrl`) inserting into tables that do not exist yet: the table shapes and rules (`phase5-tables.test.ts`), the reads, redaction, the index rebuild, the loader's SQL filter and withdrawal, and the publish rule's read (`repositories/phase5b-repositories.test.ts`), the index vectors (`blind-index.test.ts`, computed with OpenSSL 3.0.13), the sealed column list (`schema-v2.test.ts`), the migration's statements (`migrate.test.ts`), the table list (`testing.test.ts`), KEK rewrap (`key-rotation.test.ts`), redaction (`repositories/redaction.test.ts`), the Testcontainers test (`migration-0018.integration.test.ts`), and on the API side the rebuild script (`blind-index-rebuild.test.ts`) and the redaction coverage (`services/redaction.test-support.ts`, `redaction.test.ts`).

```text
$ pnpm --filter @openverify/db exec vitest run src/phase5-tables.test.ts src/repositories/phase5b-repositories.test.ts src/blind-index.test.ts src/repositories/redaction.test.ts src/repositories/key-rotation.test.ts src/schema-v2.test.ts src/migrate.test.ts src/testing.test.ts --coverage.enabled=false
     × lists every encrypted column for the KEK rewrap
     × matches the HMAC-SHA-256 vectors                              (chipSodIndex is not implemented yet)
     × creates the nine Workflow 5B tables in 0018 and changes nothing else (C53.3)
     × document_extractions / chip_challenges / chip_reads / business_registry_records      (no constraints: no table)
     × trust_anchor_sources has no environment and its own key   (and the four other trust tables)
     × holds one initiated chip challenge per verification, with a hex nonce digest and a chc id
     × reads the class, confidence, pages and media type apart from the sealed values      (relation "document_extractions" does not exist)
     × gives a production environment no sandbox-only anchor, filtered in SQL, and a sandbox one every anchor
     × rewraps every encrypted column, resumably, leaving updated_at and plaintext alone
     × clears the Workflow 5B extractions, chip evidence and registry records of its verifications (C53.6)
     × applies every migration, including the pgvector extension                          (the table list)
 Test Files  8 failed (8)
      Tests  36 failed | 172 passed (208)
$ pnpm --filter @openverify/api exec vitest run src/blind-index-rebuild.test.ts src/services/redaction.test.ts --coverage.enabled=false
     × re-indexes every unredacted extraction under the new key and prints counts only   (no chip reads line)
     × re-indexes every unredacted chip read under the new key, printing counts only
     × seeds every encrypted table except operator data
     × leaves nothing of the subject in any table or in storage      (and every case that seeds the subject: the 5B seeders fail)
```

Existing tests changed because the plan adds what they check: `testing.test.ts` (the table list), `schema-v2.test.ts` (the sealed columns), `phase5-tables.test.ts` (the keyed tables and its title), `blind-index-rebuild.test.ts` (the exact three lines became the first three, and a fourth line for chip reads), `services/redaction.test-support.ts` (`SUBJECT_PII_TABLES` and the seeded subject).

GREEN: the tables (`tables/document-extractions.ts`, `tables/chip.ts` with `chip_challenges` and `chip_reads`, `tables/business-registry-records.ts`, `tables/trust-anchors.ts` with the five install-wide tables), exported from `schema.ts`; `pnpm --filter @openverify/db exec drizzle-kit generate --name phase5_documents_chips_kyb` wrote `0018_phase5_documents_chips_kyb.sql` and its snapshot (CREATE TABLE, ADD CONSTRAINT and CREATE INDEX only; no enum change, so F23 holds); the five repositories' reads, redaction and `rebuildChipReadIndexes`; `loadTrustStore` (the `sandbox_only = false` filter in SQL for production; `withdrawn` when no current membership in an enabled source remains) and `hasNonSandboxTrustAnchor`; `chipSodIndex` and `chipDocumentNumberIndex`; the six sealed columns in `ENCRYPTED_COLUMNS` and `SEALED`, the four tables in `REWRAP_TABLES` and the three verification-keyed ones in `ID_COLUMNS`; `redactInquiryRecords` redacts the four tables; `blind-index:rebuild` rebuilds the chip read indexes and prints their counts. The stub helper `repositories/stub.ts` was removed.

```text
$ pnpm --filter @openverify/db exec vitest run src/phase5-tables.test.ts src/repositories/phase5b-repositories.test.ts src/blind-index.test.ts src/repositories/redaction.test.ts src/repositories/key-rotation.test.ts src/schema-v2.test.ts src/migrate.test.ts src/testing.test.ts --coverage.enabled=false
      Tests  208 passed (208)
$ (cd packages/db && pnpm exec vitest run --coverage)
 Test Files  61 passed (61)   Tests  805 passed (805)
Statements 98.76% | Branches 92.39% | Functions 99.42% | Lines 98.71%
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0018.integration.test.ts)
      Tests  5 passed (5)
$ pnpm --filter @openverify/api exec vitest run src/blind-index-rebuild.test.ts src/services/redaction.test.ts src/kek-rewrap.test.ts --coverage.enabled=false
      Tests  51 passed (51)
```

## 6. The Workflow 5B provider kinds and variables (C61.1, C62.7, C63)

Stubs `cc1de109` and the next commit: the 5B provider ports in `ports.ts` (`BusinessRegistryProvider`, `SandboxBusinessRegistryProvider`, `BusinessRegistryRequest`, `BusinessRecord`, `BusinessPerson`, `BusinessRegistryLookupResult`, `DomainAgeProvider`, `DomainAgeResult`, `MaliciousWebsiteProvider`, `MaliciousWebsiteResult`, `BacklinkProvider`, `Phase5BProviders` in `BoundProviders`), the four factories (`createBusinessRegistryProviders`, `createSandboxBusinessRegistryProvider`, `createDomainAgeProvider`, `createMaliciousWebsiteProvider`, `createBacklinkProvider`) rejecting every call with a `ProviderError`, the feed list's schema stub, `PHASE5B_PROVIDER_KINDS`, the settings types (`BusinessRegistryBinding`), the binding options (`companiesHouse`, `secEdgar`, `maliciousFeeds`) and the configuration's `companiesHouse`, `secEdgar` and `nfc` (fixed `null` and `false`).

RED (`providers/phase5b-providers.test.ts`; the 5B cases of `config.test.ts`; `providers/index.test.ts` and `config.test.ts` changed where the plan changes what an empty environment binds: GLEIF and RDAP are on by default, C61.1):

```text
$ pnpm --filter @openverify/api exec vitest run src/providers src/config.test.ts --coverage.enabled=false
     × names one variable per check and environment kind
     × reads nothing bound from an empty environment, but the two kinds on by default (C61.1)
     × binds GLEIF and RDAP when unset or empty, and no feed or backlink source (C61.1, F11)
     × adds Companies House with its key for that environment kind, and EDGAR with its contact
     × takes none to unbind the two kinds that are on by default, case-insensitively
     × refuses OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX=gleif,sandbox, naming the variable without echoing its value
     × binds the registers in order, the domain age, feed and backlink providers per environment kind
     × refuses Companies House or EDGAR without its credential, and a sandbox register in production
     × binds no provider by default but GLEIF and RDAP, so the A-tier checks are not configured
     × stops the worker naming the missing credential of a register named explicitly
     × turn on with their variables, and refuse anything but a boolean
      Tests  25 failed | 273 passed (298)
```

The stub-refusal cases pass at RED: they pin that every factory refuses until `api-kyb` builds it.

GREEN: `PROVIDER_KINDS`, `PROVIDER_ENV_PREFIXES` and `PROVIDER_NAMES_BY_KIND` gain the four kinds (`BUSINESS_REGISTRY_SOURCES`, `NONE_PROVIDER`, `COMPANIES_HOUSE_KEY_ENV`, `SEC_EDGAR_USER_AGENT_ENV`); `readProviderSettings` reads a register list (canonical order, de-duplicated), `sandbox` alone or `none`, defaults the registers and RDAP when unset or empty, and refuses the rest without echoing; `createProviderBindings` binds the registers with their credential for each environment kind, the domain age, feed and backlink providers, and refuses a register without its credential and a sandbox register in production; `loadConfig` reads `OPENVERIFY_COMPANIES_HOUSE_API_KEY`, `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY` (both secrets: a placeholder is refused in production) and `OPENVERIFY_SEC_EDGAR_USER_AGENT` in the worker while a binding names their register, and `OPENVERIFY_NFC_ALLOW_ICAO_CRLS` and `OPENVERIFY_TRUST_ANCHOR_REFRESH` in both processes.

```text
$ pnpm --filter @openverify/api exec vitest run src/providers src/config.test.ts --coverage.enabled=false
      Tests  298 passed (298)
```

## 7. The feed list and the trust-anchor manifest (C61.5, C62.7)

Stubs (the previous commit and `providers/malicious-website/feed-list.ts`'s loader, `trust-anchors/manifest.ts`): typed schemas that refuse everything, `defaultMaliciousFeedListPath` and `loadMaliciousFeedList` throwing.

RED (`providers/malicious-website/feed-list.test.ts`, `trust-anchors/manifest.test.ts`):

```text
$ pnpm --filter @openverify/api exec vitest run src/providers/malicious-website src/trust-anchors --coverage.enabled=false
     × takes sources that pin their root and name what they verify
     × ships with no feed
     × takes an operator feed with its format, category, interval and terms
     × reads a missing file as no feed, and refuses a malformed one without echoing it
      Tests  4 failed | 17 passed (21)
```

The refusal cases pass at RED only because the stub schemas refuse everything.

GREEN: `data/malicious-feeds.json` (`schema_version` 1, a description of what a feed needs, `feeds: []`); `maliciousFeedListSchema` (https URLs without credentials, `domains` or `urls`, `malware`, `phishing` or `spam_source`, a refresh every 300 s to weekly, the operator's terms, unique ids, at most 32 feeds), `defaultMaliciousFeedListPath`, `loadMaliciousFeedList` (a missing file is no feed; a malformed one throws `MaliciousFeedListError` naming the paths only); `trustAnchorManifestSchema` (`MASTER_LIST_CONTENT_TYPE`, `MASTER_LIST_SIGNER_EKU`, https list and root URLs, the root's SHA-256, where its fingerprint was checked, the terms, unique ids).

```text
$ pnpm --filter @openverify/api exec vitest run src/providers src/trust-anchors --coverage.enabled=false
      Tests  233 passed (233)
```

## 8. The registry of the Phase 5 repeatable jobs (C54.1, C61.5, C62.7)

Stub `6415cc6d`: `apps/api/src/jobs/repeatable/{index,feeds,trust-anchors,stub}.ts` (`phase5RepeatableJobs`, `RepeatableJobDeps`, `maliciousFeedRefreshJob`, `trustAnchorRefreshJob`, `unbuiltRepeatableJob`, the queue names and intervals), `StartWorkersOptions.maliciousFeeds` and `.nfc`, and `bindsMaliciousFeedList` in `providers/index.ts`, each answering nothing.

RED `41cb9a8c` (`jobs/repeatable/{index,stub}.test.ts`, `worker.test.ts`, `providers/phase5b-providers.test.ts`):

```text
$ cd apps/api && pnpm exec vitest run src/jobs/repeatable src/worker.test.ts src/providers/phase5b-providers.test.ts
     × is true when either kind binds feed-list, so the worker loads the list
     × refreshes the feeds every five minutes once the list holds one (C61.5)
     × refreshes the trust store only with OPENVERIFY_TRUST_ANCHOR_REFRESH=true (C62.7)
     × lists the feed refresh before the trust refresh, on queues of their own
     × logs nothing when it schedules nothing
     × schedules the feed and trust refreshes after inquiry-expiry once they are turned on
AssertionError: expected [ [ 'inquiry-expiry', [ { …(3) } ] ] ] to deeply equal [ …(3) ]
AssertionError: expected false to be true // Object.is equality
AssertionError: expected [] to deeply equal [ { …(2) } ]
      Tests  6 failed | 58 passed (64)
```

`stub.test.ts` (an unbuilt job logs `repeatable job not built yet` and fails with `PermanentJobError('repeatable_job_not_built')`) passed at RED: the stub helper is the behaviour it pins.

GREEN `95da818d`: `phase5RepeatableJobs` returns the feed refresh when the loaded list holds a feed and the trust refresh when `nfc.trustAnchorRefresh` is true; `startWorkers` spreads them after its own jobs (`inquiry-expiry`, the `api-lifecycle` block); `main()` loads `data/malicious-feeds.json` only when `bindsMaliciousFeedList(config.providers)`, and passes `companiesHouse`, `secEdgar` and `maliciousFeeds` to `createProviderBindings` and `maliciousFeeds`, `nfc` to `startWorkers`.

```text
$ cd apps/api && pnpm exec vitest run src/jobs/repeatable src/worker.test.ts src/providers
 Test Files  17 passed (17)
      Tests  267 passed (267)
```

## 9. Neither test environment binds a network provider (C63, V23)

RED `3b81d568` (`apps/api/src/config.test.ts`, `e2e/src/env.test.ts`):

```text
$ cd apps/api && pnpm exec vitest run src/config.test.ts
     × binds no network provider in the worker process
     × sets none for businessRegistry and domainAge, which are on by default
AssertionError: sandbox businessRegistry: expected [ null, 'sandbox' ] to deep equally contain [ 'gleif' ]
      Tests  2 failed | 87 passed (89)
$ cd e2e && pnpm exec vitest run src/env.test.ts
     × binds the 5B providers to their sandbox for sandbox environments, and none to production (C63, V23)
     × binds no network provider and carries no provider credential, whatever the shell says (C63)
AssertionError: BUSINESS_REGISTRY: expected undefined to be 'sandbox' // Object.is equality
AssertionError: OPENVERIFY_COMPANIES_HOUSE_API_KEY: expected undefined to be '' // Object.is equality
      Tests  2 failed | 15 passed (17)
```

GREEN `2b3f5b7c`: `syntheticEnv` sets `none` for `businessRegistry` and `domainAge` in both kinds; the e2e binds the four 5B kinds to `sandbox` for sandbox environments, `none` (registry, domain age) or nothing (malicious website, backlink) for production, empty Companies House keys and EDGAR contact, and both trust-store flags `false`, whatever the shell exports.

```text
$ cd apps/api && pnpm exec vitest run src/config.test.ts src/worker.test.ts src/container.test.ts src/server.test.ts src/openapi.test.ts src/operator-auth/settings.test.ts
 Test Files  6 passed (6)
      Tests  186 passed (186)
$ cd e2e && pnpm exec vitest run
 Test Files  11 passed (11)
      Tests  83 passed (83)
```

## 10. `.env.example` and the compose split (C61.1, C62.7, C63, P25)

RED `f1206b66` (`infra/tests/compose.test.sh`): the 5B variables declared, the four 5B kinds `sandbox` for sandbox environments, the Companies House keys and EDGAR contact empty, the trust-store flags `false`, all of them given to the worker and none to `api` or `migrate`.

```text
$ bash infra/tests/compose.test.sh --static-only
FAIL - .env.example declares OPENVERIFY_COMPANIES_HOUSE_API_KEY
FAIL - .env.example binds the BUSINESS_REGISTRY sandbox provider in sandbox environments (expected 'sandbox', got '')
FAIL - .env.example sets OPENVERIFY_TRUST_ANCHOR_REFRESH to false (expected 'false', got '')
FAIL - worker receives OPENVERIFY_COMPANIES_HOUSE_API_KEY
FAIL - worker receives OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION
# 268 passed, 32 failed
```

GREEN `67d03bac`: the KYB and trust-store blocks of `.env.example` (production variables empty, so `businessRegistry` and `domainAge` keep their GLEIF and RDAP defaults there); `x-worker-provider-environment` gains the four kinds, the two keys, the contact and the two flags. A parse of `.env.example` through `loadConfig` (synthetic keys substituted for the three placeholders it refuses) binds `sandbox` for every worker kind in sandbox environments and `businessRegistry: ['gleif']`, `domainAge: 'rdap'` for production.

```text
$ bash infra/tests/compose.test.sh --static-only
# 300 passed, 0 failed
```

## 11. `GET /dashboard/trust-anchors` (C62.10, C54.2)

Stub `94d2600e`: `packages/contracts/src/trust-anchors.ts` (`TRUST_ANCHOR_SYNC_OUTCOMES`, `TRUST_CRL_FRESHNESS`, `dashboardTrustAnchorsSchema` as an empty strict object) and its export line.

RED `f8759054`: the synthetic golden answer `contracts/fixtures/api/dashboard-trust-anchors.json`, `trust-anchors.test.ts`, its entry in `fixtures.test.ts`, and `routes/dashboard/trust-anchors.test.ts`.

```text
$ cd packages/contracts && pnpm exec vitest run src/trust-anchors.test.ts src/fixtures.test.ts
     × parses the golden answer unchanged
     × takes a store with no source synced and no anchor
     × dashboard-trust-anchors.json parses and re-serializes unchanged
      Tests  3 failed | 158 passed (161)
$ cd apps/api && pnpm exec vitest run src/routes/dashboard/trust-anchors.test.ts
     × answers 501 until the trust-store view is built, with settings:read
     × needs settings:read
     × needs a signed-in operator
AssertionError: expected 404 to be 501 // Object.is equality
      Tests  3 failed | 1 passed (4)
```

The refusal cases pass at RED only because the stub schema refuses everything.

GREEN `67495fcc`: the schema (sources with their last sync, countries, withdrawn anchors, CRLs with their freshness, sandbox anchors, `has-production-anchor`), `routes/dashboard/trust-anchors.ts` (`settings:read`, 200 schema and 401, 403, 404 problems, a 501 handler) registered behind operator authentication, the Android `ContractFixturesTest` listing the fixture as server-only, and the OpenAPI snapshot.

```text
$ cd packages/contracts && pnpm exec vitest run
 Test Files  53 passed (53)
      Tests  1804 passed (1804)
$ cd apps/api && pnpm exec vitest run src/routes/dashboard src/openapi.test.ts
     × matches the committed snapshot (pnpm --filter @openverify/api openapi:write)
$ pnpm --filter @openverify/api openapi:write
  Snapshots  1 updated
      Tests  13 passed (13)
$ pnpm --filter @openverify/api openapi:write      # the second run changes nothing
      Tests  13 passed (13)
$ git diff -- docs/api/openapi.json | grep '^+' | grep -E '"/api|"summary"'
+    "/api/v1/dashboard/trust-anchors": {
+        "summary": "Get the trust store",
```

The snapshot's SHA-256 was `382a8676…3ce9` (as Stage 4 of 5A recorded) and is now `e4d28491…7667`.

## 12. `trust-anchors:sync` and `scripts/fetch_trust_anchors.sh` (C62.7)

Stub `10d072e0`: `apps/api/scripts/trust-anchors-sync.ts` (`TrustAnchorSyncArgs`, `TrustAnchorSyncUsageError`, `TrustAnchorSyncNotBuiltError`, `parseTrustAnchorSyncArgs` throwing, `runTrustAnchorSync` rejecting).

RED `0935abfb` (`apps/api/src/trust-anchors-sync.test.ts`):

```text
$ cd apps/api && pnpm exec vitest run src/trust-anchors-sync.test.ts
     × syncs every enabled source by default
     × reads --source, and --import with its --root, with = or a separate value
     × refuses ["--source=BSI DE"]
     × refuses ["--import=list.ml"]
     × runs scripts/trust-anchors-sync.ts as trust-anchors:sync, with the .env if present
     × wraps it in an executable scripts/fetch_trust_anchors.sh that passes its arguments on
TrustAnchorSyncUsageError: not parsed yet (0 arguments)
AssertionError: expected [Function] to throw error including '--import needs --root, the PEM root c…' but got 'not parsed yet (1 arguments)'
AssertionError: expected undefined to be 'tsx --conditions=@openverify/source -…' // Object.is equality
```

GREEN `6b246d71`: the parser (`--source <id>` a manifest slug, `--import <file>` only with `--root <pem>`), the `trust-anchors:sync` package script, and the executable wrapper (`exec pnpm --filter @openverify/api trust-anchors:sync "$@"` from the repository root). `runTrustAnchorSync` still rejects with `TrustAnchorSyncNotBuiltError`: `api-nfc` builds the sync.

```text
$ cd apps/api && pnpm exec vitest run src/trust-anchors-sync.test.ts
      Tests  10 passed (10)
$ bash -n scripts/fetch_trust_anchors.sh && echo syntax-ok
syntax-ok
```

## 13. The emrtd report and the frozen NFC reasons (C51.2, C62.2, C62.3)

`4c8754f2` (`apps/api/src/emrtd-contract.test.ts`): `INTEGRITY_BREAKS` are passive authentication failures, every `INTEGRITY_GAPS` entry is a review reason and never a failure, and an undetermined revocation (`REVOCATION_GAPS`) answers `crl_unavailable`. It pins two vocabularies that already agreed, so it passed on its first run (disclosed: it never failed first); it fails as soon as either side drifts.

```text
$ cd apps/api && pnpm exec vitest run src/emrtd-contract.test.ts
      Tests  3 passed (3)
```

The data-source rows (GLEIF, Companies House, SEC EDGAR, the IANA RDAP bootstrap, the registry RDAP services, the CSCA master lists) are documentation (`cf8f661b`), from the terms read on 2026-10-21 (`docs/research/phase5-libraries.md` §5, `phase5-nfc.md` §3.1).

## 14. Final gates (2026-10-23, at `cf8f661b` plus this evidence and the plan amendments)

```text
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks:    13 successful, 13 total          # typecheck
 Tasks:    13 successful, 13 total          # lint
All matched files use Prettier code style!
$ pnpm test                                  # 10 min 15 s
@openverify/flow-spec  113   @openverify/core 711    @openverify/ui 54        @openverify/flow 924
@openverify/node       226   @openverify/dashboard 1946   @openverify/emrtd 39 (100% lines)
@openverify/e2e         83   @openverify/config 71   @openverify/contracts 1804
@openverify/checks    2226   @openverify/db 805      @openverify/api 3444 (97.42% lines)
 Tasks:    13 successful, 13 total
$ pnpm test:integration
@openverify/api:test:integration:  Test Files  20 passed (20)   Tests  102 passed (102)
@openverify/db:test:integration:   Test Files  11 passed (11)   Tests  57 passed (57)
$ (cd services/vision && uv run ruff check && uv run ruff format --check \
    && uv run mypy --cache-dir /tmp/openverify-mypy-contracts-5b src tools \
    && COVERAGE_FILE=/tmp/openverify-cov-contracts-5b uv run pytest -q)
All checks passed!
162 files already formatted
Success: no issues found in 62 source files
Required test coverage of 80% reached. Total coverage: 99.77%
1980 passed in 398.38s (0:06:38)
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 2m 28s                   # SDK host tests 1177, SDK unit 631, demo app 18
$ pnpm --filter @openverify/api openapi:write   # a third run after the GREEN's two
      Tests  13 passed (13)                  # no snapshot written; docs/api/openapi.json unchanged
$ bash infra/tests/ci-workflow.test.sh
# 158 passed, 0 failed, 0 skipped
$ bash infra/tests/compose.test.sh --static-only
# 300 passed, 0 failed
$ bash infra/tests/apps-image-context.test.sh
# 12 passed, 0 failed
$ flock /tmp/openverify-e2e.lock pnpm e2e
  60 passed (8.9m)
```
