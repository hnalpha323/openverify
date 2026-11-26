# Phase 11, Workflow 11E: docs-compliance (C278)

Owner: `docs-compliance` (claude-opus-5-5), Stage 2 of Workflow 11E, started 2026-11-20 at `2952f2a84` (11E start `247f6af3c`, base `aa00b57bb`). Owned paths: `docs/compliance/` (except Phase 8's `automated-decisions.md` and Phase 10's `session-integrity.md`, each given one borrowed line) and `packages/docs-tools/src/compliance/`.

Sections are filled as the work goes; the sections below are the evidence (real commands, abbreviated real output).

## 1. The re-read of the legal sources (C278.3, decision 45, rule 24)

Date from `date +%F`: 2026-11-20. Each official page was fetched read-only with the session's web fetch tool (no bypass of a challenge, a TLS failure or a script-only page); the summaries on the guide's pages are ours. Two PDFs (WP 224 and the CNIL's guidelines) could not be read by the fetch tool's converter; their bytes were saved to the session's scratch directory and their text streams decompressed locally with a short standard-library script (`python3 -I`), nothing executed from them, nothing committed.

| Id | URL | Result |
|---|---|---|
| S1 | `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679`, then `https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng` | empty body, twice: not re-read |
| S2 | `https://www.legislation.gov.uk/eur/2016/679/article/{7,9,12,14,15,19,28,33,35}`, `/chapter/V` | read (latest revised text; Art. 12(3) refers to Art. 12A and Arts. 15 to 22D; Art. 15(1A) present; Chapter V's Art. 44A routes) |
| S3 | `https://www.legislation.gov.uk/eur/2016/679/article/12A` | HTTP 404; Article 12A read through S4 (s. 76 inserts it) |
| S4 | `https://www.legislation.gov.uk/ukpga/2025/18/section/{76,78,80}` | read (s. 76 in force 2026-02-05 under S.I. 2026/82; s. 78 from Royal Assent, treated as in force 2024-01-01; s. 80 inserts Arts. 22A-22D, remaining purposes 2026-02-05) |
| S5 | `https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3004&ChapterID=57`, then `https://ilga.gov/...` | "unable to verify the first certificate" on both: not re-read, not bypassed |
| S6 | `https://app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true` | read (.020(1) alternatives; .030 attorney general only; .040 GLBA Title V; .010 photograph exclusion) |
| S7 | `https://statutes.capitol.texas.gov/Docs/BC/htm/BC.503.htm` | navigation only, no statute text without script: not re-read |
| S8 | `https://leg.colorado.gov/bills/hb24-1130` | read (bill page: approved 2024-05-31, effective 2025-07-01); codified section not read |
| S9 | `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140` and `...1798.121` | HTTP 403: not re-read |
| S10 | `https://cppa.ca.gov/announcements/2025/20250923.html` | read (effective 2026-01-01; attestations 2028-04-01; ADMT 2027-01-01; audits 2028/2029/2030-04-01 by revenue) |
| S11 | `https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3` | read (1(a) excludes verification whose sole purpose is to confirm a claimed identity) |
| S12 | `https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp224_en.pdf` | read (section 7.5, "Use case: User centric security") |
| S13 | `https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042388179` (HTTP 403), then `https://www.cnil.fr/sites/cnil/files/atoms/files/lignes_directrices_de_la_cnil_sur_les_cookies_et_autres_traceurs.pdf` | read in part: paragraph 49 found, its authentication item not legible in our extraction |
| S14 | `https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1` | read (para 4; inserted 2026-02-05) |
| S15 | `https://www.legislation.gov.uk/ukpga/2002/29/section/333A` | read (two offences; ss. 333B-333D exceptions; up to date to 2026-11-20 per the page) |

## 2. Checkpoint 1 (guide): the record checks, RED then GREEN

Stub commit `f3845e5a4` (typed signatures only; `pnpm exec tsc --noEmit` and `eslint src/compliance` clean).

RED `7ba489883` (tests over fixtures and the committed guide):

```
$ pnpm exec vitest run src/compliance --coverage.enabled=false
     × knows exact entries, pattern prefixes and a secret file form
     × fails a page without "not legal advice" in its opening
     × reads repository paths in backticks, dropping a line suffix and skipping patterns
     × reports a missing page, then each missing phrase
     × reads every retention setting and its default from the contracts
     ... (16 failed)
      Tests  16 failed | 7 passed (23)
```

The checks implemented `a6ee75d86`: the fixture tests pass and the committed guide fails the record tests for the intended reasons (stubs without the two lines, pages missing):

```
$ pnpm exec vitest run src/compliance --coverage.enabled=false
     × holds every page of the committed guide, the Phase 8 and Phase 10 pages among them
     × holds the committed page            (access-requests: "is missing (C278.4)")
     × holds the committed page            (retention: "is missing (C278.2)")
     × finds no error in the committed guide
+     "message": "must say \"not legal advice\" before its first section (C278.1)",
+     "message": "must carry the line \"Not reviewed by counsel.\" before its first section (Q7, C278.1)",
      Tests  4 failed | 19 passed (23)
```

Borrowed edit `bc92106d0` (rule 1; 11E decisions item 9): one line "Not reviewed by counsel." under line 3 of `docs/compliance/automated-decisions.md` and of `docs/compliance/session-integrity.md`, nothing else; `git status --porcelain` was empty for both before the edit.

GREEN `7bb310bac` (the pages):

```
$ pnpm exec vitest run src/compliance --coverage.enabled=false
      Tests  23 passed (23)
```

Checks: `compliance-opening` (both lines before the first `## `), `compliance-references` (every backticked repository path and every relative link exists), `compliance-variables` (every `OPENVERIFY_` name is in `apps/api/src/config-registry.ts`), `compliance-access-requests` (C278.4, KP11-46: phrases computed from `ACCOUNT_EXPORT_NOT_COVERED`, `ACCOUNT_EXPORT_TTL_DAYS`, `RATE_LIMIT_DEFAULTS` and `RATE_LIMIT_POLICY_WINDOWS`), `compliance-retention` (every `-retention-days`/`-ttl-days` key of `DASHBOARD_SETTINGS_DEFAULTS` with its default, and no other).

### Gate: affected scope (rule 28, a Stage 2 agent)

Load 3.11 to 4.50 (`cat /proc/loadavg`).

- `pnpm --filter @openverify/docs-tools typecheck`: exit 0 (24.5 s).
- `pnpm --filter @openverify/docs-tools lint`: exit 1, four errors, all in docs-release's files in flight (`src/release/gaps.ts:45`, `src/release/licences.ts:33`, `src/release/progress.ts:52`, `:62`); `src/compliance/` clean.
- `pnpm --filter @openverify/docs-tools test`: exit 1, 241 of 244 passed; the three failures are docs-records' (`src/records/crypto-inventory.test.ts`, `src/records/index.test.ts`) and docs-selfhost's (`src/selfhost/index.test.ts`) RED or in-flight steps; every compliance test, the wording test and the vendor-name test pass.
- `pnpm exec prettier --check src/compliance`: exit 0.

## 3. Checkpoint 2 (recipients): the list generated from the provider registry

Stub `dca32b594`: `src/compliance/provider-facts.ts` loads `apps/api/src/providers/index.ts` once with a dynamic `import()` of a computed path (top-level await) and reads it through a local `ProvidersModule` shape. A static import was measured first and refused: with one static import of the registry, `pnpm exec tsc --noEmit` in docs-tools took 122 s (real 2m2.2s) because it type-checks most of the API; the dynamic import keeps the package's typecheck at about 25 s. Loading the registry under Vitest costs about 3 s per test file that imports the area.

RED `86cb26f45`:

```
$ pnpm exec vitest run src/compliance/recipients.test.ts --coverage.enabled=false
     × describes exactly the real provider names the registry holds
     × renders a kind row with its variable, its readers and what unset binds
     × renders a row for each real adapter and refuses a name it cannot describe
     × is committed exactly as a fresh render
      Tests  4 failed | 2 passed (6)
```

GREEN `95072efeb`: `RECIPIENT_DETAILS` (one entry per real provider name, 15, read from each adapter's module), `renderRecipientsPage(facts)`, and `renderCompliance` built with `docs/compliance/recipients.md`. One expectation of the RED test changed before GREEN, recorded here: the first render wrote the `businessRegistry` default as "with A or B set, gleif, companies-house, sec-edgar", which is wrong (each credential adds its own register), so the facts now carry `widenedDefaults` per variable (`readProviderSettings` called with only that variable set) and the row reads "`gleif`; plus `companies-house` with `OPENVERIFY_COMPANIES_HOUSE_API_KEY` set; plus `sec-edgar` with `OPENVERIFY_SEC_EDGAR_USER_AGENT` set".

```
$ pnpm --filter @openverify/docs-tools docs:compliance
compliance: 1 files written
$ pnpm exec vitest run src/compliance --coverage.enabled=false
      Tests  29 passed (29)
```

The registry at this commit: 22 kinds; 15 real provider names; two kinds bound when unset (`businessRegistry` to `gleif`, `domainAge` to `rdap`, from `readProviderSettings({})`); nine kinds with only the sandbox provider. The guide's pages now link [recipients](../compliance/recipients.md) wherever they name a provider.

### Gate: affected scope (rule 28)

Load 4.15 to 5.60.

- `pnpm --filter @openverify/docs-tools typecheck`: exit 0.
- `lint`: exit 1, two errors, both in other areas in flight: docs-records' `src/records/security-index.ts:31` and docs-release's `src/release/release-check.test.ts:350`; `src/compliance/` clean.
- `test`: exit 1, 312 of 321 passed; the nine failures are docs-records' RED steps (`src/records/index.test.ts`, `logging.test.ts` four, `security-index.test.ts`, `vulnerability-policy.test.ts` two) and `src/cli.test.ts`'s release:check not-built case, which docs-release's work in flight changes; every compliance test, the wording and the vendor-name tests pass.
- `pnpm exec prettier --check src/compliance`: exit 0.

## 4. Checkpoint 3 (record of processing): the template from the classification and the recipients

Waited for docs-records' "Workflow 11E docs-records checkpoint 1 (classification)" (`855f5262f`): it had landed when checkpoint 2 ended, so no wait call was needed. The input is `dataClassification(repo)` of `packages/docs-tools/src/records/classification.ts` (its `DataClassification`: 9 classes, each with its profile, share categories, retention defaults, sealed columns and plaintext records), with the provider facts and `RECIPIENT_DETAILS` of checkpoint 2.

One more source was re-read for this page on 2026-11-20: `https://www.legislation.gov.uk/eur/2016/679/article/30` (the controller's record, 30(1)'s items; the processor's, 30(2); in writing; the under-250 exemption of 30(5) not applying where special-category data is processed). It joins S2 on [sources](../compliance/sources.md); the EU's Article 30 is under S1 (not re-read).

Stub `c21d6d773`. RED `fa130bff4`:

```
$ pnpm exec vitest run src/compliance/record-of-processing.test.ts --coverage.enabled=false
     × opens with both lines and carries no draft marker
     × has one section per data class of the classification, in its order
     × states each class's sealed-column count and its retention settings with their defaults
     × lists every real provider as a possible recipient, with what it receives
     × leaves the controller's own answers to fill, item by item of Article 30(1)
     × is committed exactly as a fresh render
      Tests  6 failed | 1 passed (7)
```

GREEN `672aea228` (`renderRecordOfProcessing`, `renderCompliance` now renders two files; the page replaces the stub, so no draft marker of docs-compliance remains):

```
$ pnpm --filter @openverify/docs-tools docs:compliance
compliance: 2 files written
$ pnpm exec vitest run src/compliance --coverage.enabled=false
      Tests  36 passed (36)
$ pnpm exec vitest run src/compliance --coverage.reportsDirectory=<scratch>/cov-compliance '--coverage.include=src/compliance/**'
All files          |      98 |    83.78 |     100 |   98.32 |
```

The record of processing is generated from docs-records' classification, so a later change of `src/records/classification.ts` (a profile's text, a column) makes it stale: re-run `pnpm --filter @openverify/docs-tools docs:compliance` after `docs:records` (the fresh-render test names the file).

## 5. The end gate (rule 28; the last checkpoint's full gate for this area)

Each rerun below followed another area's in-flight RED (rule 28: re-run, never edit their files).

| Time (UTC) | Call | Result | Load |
|---|---|---|---|
| 19:40 | `pnpm --filter @openverify/docs-tools test` | exit 1: 329 of 350, the 21 failures docs-security's RED `src/security/checklist.test.ts` | 4.12 to 5.20 |
| 19:47 | the same | exit 1 before any test: another agent's Vitest held `packages/docs-tools/coverage` ("already in use by another Vitest process"); from then on with `--coverage.reportsDirectory=<scratch>/cov-all<n>` | 6.67 to 7.05 |
| 19:47 | the same with its own directory | exit 1: 377 of 381, docs-catalog's mapping RED and docs-selfhost's hardening checklist | 7.02 to 8.27 |
| 19:49 | the same | exit 1: 380 of 381, docs-selfhost's `docs/self-hosting/hardening-checklist.md` stale after docs-security's GREEN | 5.44 to 8.67 |
| 19:52 | `pnpm --filter @openverify/docs-tools typecheck` | exit 0 (32.0 s) | 7.90 to 6.78 |
| 19:52 | `pnpm --filter @openverify/docs-tools lint` | exit 0 (17.9 s) | |
| 19:52 | `pnpm --filter @openverify/docs-tools test --coverage.reportsDirectory=<scratch>/cov-all7` | exit 0: 47 files, 381 tests, all files 97.54% statements, 85.4% branches (23.4 s) | |
| 19:52 | `pnpm exec prettier --check src/compliance` | exit 0 | |
| 19:52 | `git status --porcelain docs/api contracts packages/node` | empty | |

The wording test (C274.5) and the vendor-name test run inside that suite over every page of `docs/compliance/`; both pass. No docs-compliance draft marker remains (`grep -rl "Draft: written in Workflow 11E by docs-compliance" docs` finds nothing).
