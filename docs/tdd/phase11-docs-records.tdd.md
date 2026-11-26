# Phase 11, Workflow 11E: docs-records (C276) TDD evidence

Agent `docs-records` (Stage 2, beside five other document agents). Owned paths: `docs/security/{crypto-inventory,data-classification,logging,vulnerability-policy,README}.md`, `SECURITY.md`, `packages/docs-tools/src/records/`. Start `247f6af3c`, after contracts-11e's checkpoint 3 (`2952f2a84`). Every command ran after `source scripts/env.sh`; outputs are abbreviated, never edited.

## 0. Start

- Stubs owned (contracts-11e's docs tree, marker "Draft: written in Workflow 11E by docs-records"): `SECURITY.md`, `docs/security/README.md`, `crypto-inventory.md`, `data-classification.md` (generated), `logging.md`, `vulnerability-policy.md`.
- The area's frozen entry points: `renderRecords` and `checkRecords` in `packages/docs-tools/src/records/index.ts`.

## 1. Checkpoint 1: the data classification (C276.2)

### Design

- `packages/docs-tools/src/records/classification.ts` reads: `DATA_CLASSES`, `SHARE_CATEGORIES`, `SHARE_CATEGORY_DATA_CLASS`, `SHARE_FIELD_TYPES`, `FIELD_TYPE_CLASS` and `WELL_KNOWN_FIELD_CATEGORY` (`@openverify/core`, `packages/core/src/connect/categories.ts`); `ENCRYPTED_COLUMNS` (relative import of `packages/db/src/encrypted-columns.ts`); `DASHBOARD_SETTINGS_DEFAULTS` and `accountExportManifestSchema` (`@openverify/contracts`); the sixteen `*_TABLES` redaction categories, parsed as text from `apps/api/src/services/redaction.test-support.ts` (it imports `@openverify/db/testing`, so it is never imported); the `pgTable('<name>'` declarations of `packages/db/src/tables/`, parsed as text.
- `categories.ts` holds no column-to-class map (Stage 1a amendment 2(f)), so `COLUMN_CLASSES` (95 entries) is the generator's table, held by a test to equal the `ENCRYPTED_COLUMNS` set.
- `DATA_CLASSES` has nine classes and no class for third-party list data. The page places it as the `public-and-list-data` class inside the `THIRD_PARTY_LIST_PII_TABLES` redaction category (the code's own distinction), and says so; a tenth class would be a `categories.ts` change (a contractDeviation, not made).
- Exported for docs-compliance (C278.5): `dataClassification(repo): DataClassification` (`classes`, `columns`, `plaintext`, `fieldTypes`, `wellKnownKeys`, `handlingGroups`), `CLASS_PROFILES`, `COLUMN_CLASSES`, `PLAINTEXT_RECORDS`, `HANDLING_GROUPS`, `readHandlingGroups`, `readTableNames`, `DATA_CLASSIFICATION_PATH`, re-exported by `src/index.ts` through `src/records/index.ts`.

### Commits

- `8643a35b4` feat(docs-tools): stub the data classification generator.
- `9c4b6a1f8` feat(docs-tools): stub the table and redaction-category readers.
- `09cb9439c` test(docs-tools): RED.
- `54697e649` feat(docs-tools): GREEN, with the rendered `docs/security/data-classification.md`.

### RED (`09cb9439c`)

```
$ pnpm -s typecheck && pnpm -s exec eslint src/records && pnpm exec vitest run src/records --coverage.enabled=false
$ tsc --noEmit
     × names every ENCRYPTED_COLUMNS entry, and nothing else
     × maps each of the template, account and transaction field types
     × profiles every class of DATA_CLASSES, in its order
     × describes every category redaction.test-support.ts declares, and no other
     × reads a list, skipping its comments
     × reads the declared tables
     × equals a fresh render
     × renders the data classification, the one generated page it owns
 Test Files  2 failed (2)
      Tests  16 failed | 6 passed (22)
exit=1
```

Each failed for the intended reason: the stub's empty tables, readers and render (`expected [] to deeply equal [ 'account_exports.wrapped_dek', … ]`; the fresh render `[ { path: 'docs/security/data-classification.md', reason: 'differs' } ]`). Typecheck and lint passed (the RED compiles).

### GREEN (`54697e649`)

```
$ pnpm exec vitest run src/records --coverage.enabled=false      # before the page was rendered
     × renders what is committed
     × finds nothing to fix in the committed records
     × equals a fresh render
      Tests  3 failed | 19 passed (22)
$ pnpm --filter @openverify/docs-tools docs:records
records: 1 files written
$ pnpm exec vitest run src/records src/wording.test.ts src/vendor-name.test.ts src/metrics.test.ts src/docs-tree.test.ts --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  68 passed (68)
exit=0
$ pnpm exec eslint src/records
lint=0
```

### Measurements

- The page: 9 classes; 95 sealed columns (biometric 4, identity-documents 7, identity-fields 41, contact 1, device-and-network 16, financial-and-crypto 7, operator-and-audit 6, secrets 9, public-and-list-data 4); 16 plaintext-by-decision rows; 15 field types (identity-fields 12, identity-documents 2, contact 1); 13 well-known keys; 6 share categories; 16 redaction categories.

### Checkpoint gate (rule 28: what I touched)

- `pnpm -s typecheck` (docs-tools): exit 0, 15.6 s (load 3.82).
- `pnpm -s lint` (docs-tools): exit 1, only in other areas' work in flight: `src/release/checklist.ts:60,71` and `src/security/threat-model.ts:157` (`security/detect-unsafe-regex`), `src/release/markdown.ts:47,78`; `src/records/` lints clean (`pnpm exec eslint src/records`: exit 0).
- `pnpm test` (docs-tools): exit 1, 48 failed of 226, all in other areas' RED commits (catalog 19, compliance 4, release 4, security 3, selfhost 18); `src/records/` 22 of 22 green, and the wording, vendor-name, metric and docs-tree tests pass over the new page.
- The whole package gate is re-run at my last checkpoint.

## 2. Checkpoint 2: the cryptographic inventory (C276.1)

### Design

- `docs/security/crypto-inventory.md` is hand-written (the docs tree marks it not generated) and held by a record test (rule 21): `packages/docs-tools/src/records/crypto-inventory.ts` (`checkCryptoInventory`, `cryptoInventoryRequirements`, `CRYPTO_INVENTORY_PATH`, `CRYPTO_SOURCES`) over the shared rules of `src/records/checks.ts` (`codeSpans`, `draftFindings`, `pathFindings`, `commandFindings`, `variableFindings`, `requiredSpanFindings`; internal, not re-exported, because `variableFindings` is also another area's export name).
- The page must name, as code spans: every `secret: true` entry of `apps/api/src/config-registry.ts` (25, the pattern entry `OPENVERIFY_SEED_{ROLE}_PASSWORD` by its pattern); every `'openverify/<name>/v1` label of `packages/db/src/blind-index.ts` (35); every `_PREFIX = '...'` of `packages/contracts/src/tokens.ts` (7), the API key prefixes of `packages/db/src/api-keys.ts` (2) and the SSO binding prefix of `packages/contracts/src/sso.ts` (1); every `file` column of `ENCRYPTED_COLUMNS` (12) and every `secrets`-class sealed column (9).
- Every cited repository path must exist (file or directory; a `:line` suffix or a glob tail is cut), every `pnpm --filter @openverify/<package> <script>` and `pnpm <script>` must name an existing script, and every variable-shaped span must be registered (exactly, as a `_FILE` form of a `fileForm` entry, or as a pattern entry's composed name, matched by fixed parts with no run-time regular expression, rule C252). `OPENVERIFY_PUBLISH` is the release workflow's repository variable (`PUBLISH_VARIABLE`, `src/switches.ts`), not a process variable, and is accepted as such.

### Commits

- `5dfe7e0fd` feat(docs-tools): stub the shared record rules and the crypto inventory record test.
- `0aaf03aa4` test(docs-tools): RED.
- `3bce69dfc` feat(docs-tools): GREEN (the rules; the page's own test still failing until the next commit).
- `1b10df4b1` docs(security): the inventory.

### RED (`0aaf03aa4`)

```
$ pnpm -s typecheck; pnpm exec eslint src/records; pnpm exec vitest run src/records/checks.test.ts src/records/crypto-inventory.test.ts --coverage.enabled=false
tc=0
lint=0
     × reads each inline span, never a fenced block
     × fail when it does not, naming the path
     × fail on a missing script or package
     × fail an unregistered name
     × includes every secret config-registry.ts marks, pattern entries by their pattern
     × includes every blind-index label of packages/db/src/blind-index.ts
     × includes every token prefix
     × passes its record test
 Test Files  2 failed (2)
      Tests  13 failed | 5 passed (18)
exit=1
```

The stubs return no spans, no findings and no requirements, and `status: 'not-built'`; the passing five are the "nothing to find" cases.

### GREEN

```
$ pnpm exec vitest run src/records --coverage.enabled=false        # rules built, page not yet written
     × passes its record test
     × finds nothing to fix in the committed records
      Tests  2 failed | 38 passed (40)
+     "message": "names OPENVERIFY_PUBLISH, which apps/api/src/config-registry.ts does not hold (or holds without a _FILE form)"
$ pnpm exec vitest run src/records src/wording.test.ts src/vendor-name.test.ts src/metrics.test.ts --coverage.enabled=false
      Tests  79 passed (79)
```

Two lint findings were fixed on the way, test-first: a path regular expression `security/detect-unsafe-regex` flagged (replaced by one character class), and a run-time `RegExp` built from the registry's pattern names (the C252 rule; replaced by a fixed-part matcher).

### Measurements

- Required names: 91 distinct spans: 25 secrets, 35 labels, 10 prefixes (7 token, 2 API key, 1 SSO binding), 12 data-key columns, 9 sealed secret columns.

### Checkpoint gate (rule 28)

- `pnpm exec eslint src/records`: exit 0. `src/records` tests and the wording, vendor-name and metric rules: 79 of 79.
- The package's whole typecheck, lint and test run at checkpoint 3, my last.

## 3. Checkpoint 3: the logging inventory, the vulnerability policy, SECURITY.md and the index (C276.3-C276.5)

### Design

- `src/records/logging.ts` (`checkLogging`, `documentedRedactionPaths`, `LOGGING_TABLE_HEADINGS`, `LOGGING_PATH`): the page documents each logger's paths as table rows of keys and prefixes ("top level" is no prefix) under two fixed headings; the test expands the rows and compares the sets, exactly and without duplicates, with `REDACT_PATHS` (64 paths, `apps/api/src/logger.ts`, relative import) and `WORKER_REDACT_PATHS` (96, `apps/api/src/jobs/logger.ts`). It also requires every `PERSONAL_LOG_KEYS` key (13), every `API_LOG_REDACTED_KEYS` key (13) and `custom-headers` (`API_LOG_REDACTED_VALUE_MAPS`), and every `CONFIG_PROCESSES` process (7) as a code span. The console, the flow server, vision, the code runner and the migrate commands have no redaction list (Stage 1a amendment 8): the page states what each writes, from the code.
- `src/records/vulnerability-policy.ts` (`checkVulnerabilityPolicy`, `checkSecurityPolicy`, `documentedTimeFrames`, `REMEDIATION_TIME_FRAMES`, `VULNERABILITY_POLICY_PATH`, `SECURITY_POLICY_PATH`, `ALLOWLIST_SCHEMA_PATH`, `SUPPLY_CHAIN_GATE_PATH`): the time-frame table equals decision 6 (critical 7 days, high 30 days, medium 90 days, low the next release); every field `security/allowlist.schema.json` requires or offers (`id`, `reason`, `expires`, `added-by`, `package`, `path`) is named; the page says "at most N days" with N the gate's `MAX_DAYS_AHEAD` (90, `infra/scripts/lib/supply-chain-gate.py`). `SECURITY.md` must name GitHub's private vulnerability reporting, the public release and Q1, and link the policy.
- `src/records/security-index.ts` (`checkSecurityIndex`, `securityDocuments`, `SECURITY_INDEX_PATH`): every file of `docs/security/` but the index is linked from it by file name, and the index states the wording rule of C274.5.
- `checkRecords` runs all six record checks (`data-classification`, `crypto-inventory`, `logging`, `vulnerability-policy`, `security-policy`, `security-index`).

### Commits

- `1786d71ac` feat(docs-tools): stubs.
- `ddb623607` test(docs-tools): RED.
- `6f24e7bb2` feat(docs-tools): GREEN (the pages' own tests failing until the next commit).
- `094712783` docs(security): `logging.md`, `vulnerability-policy.md`, `README.md` and the root `SECURITY.md`.

### RED (`ddb623607`)

```
$ pnpm -s typecheck; pnpm exec eslint src/records; pnpm exec vitest run src/records/logging.test.ts src/records/vulnerability-policy.test.ts src/records/security-index.test.ts --coverage.enabled=false
tc=0
lint=0
     × knows every document beside it
     × fails an index that misses a document or the wording rule
     × are the plan decision, one per severity
     × expands each row to its prefixes, the top level being no prefix
     × documents exactly the API's configured redaction paths
     × documents exactly the worker's own redaction paths
     × passes its record test
 Test Files  3 failed (3)
      Tests  15 failed | 1 passed (16)
exit=1
```

### GREEN

```
$ pnpm exec vitest run src/records --coverage.enabled=false        # tests built, pages still stubs
     × passes its record test            (four times: logging, policy, SECURITY.md, index)
     × documents exactly the API's configured redaction paths
     × documents exactly the worker's own redaction paths
      Tests  8 failed | 48 passed (56)
$ pnpm exec vitest run src/records src/wording.test.ts src/vendor-name.test.ts src/metrics.test.ts src/docs-tree.test.ts --coverage.enabled=false
      Tests  102 passed (102)
exit=0
```

A lint finding on the way (`security/detect-unsafe-regex` on the index's link pattern) was fixed by a simpler pattern before the GREEN commit.

## 4. The end gate (rule 28: what I touched)

Every call from `packages/docs-tools`, in the foreground.

| Call | Result | Seconds | Load (1, 5, 15 min) |
|---|---|---|---|
| `pnpm -s typecheck` (first run) | exit 2, only in another agent's untracked scratch file `src/_probe.ts` (since removed by its owner) | 19 | 4.20 4.36 3.94 |
| `pnpm -s lint` (first run) | exit 1, only in `src/_probe.ts` | 17 | 4.46 4.42 3.97 |
| `pnpm test` (first run) | exit 0: 328 tests in 42 files; statements 94.44%, branches 85.17%, functions 94.93%, lines 95.45%; `src/records` 96.62% statements | 30 | 4.38 4.41 3.97 |
| `pnpm -s typecheck` (re-run) | exit 0 | 21 | 4.14 4.37 4.00 |
| `pnpm -s lint` (re-run) | exit 0 | 24 | 4.00 4.33 3.99 |
| `pnpm test` (re-run) | exit 1: 30 failed of 357, all in docs-security's RED commit `a10b753a6` (`src/security/checklist.test.ts` 17, `staleness.test.ts` 5, `summary.test.ts` 4, `index.test.ts` 4); every other file green | 32 | 4.38 4.41 3.97 |
| `pnpm exec vitest run src/records --coverage.enabled=false` | exit 0: 56 tests in 7 files | 6 | 3.87 4.33 3.98 |
| `pnpm exec prettier --check packages/docs-tools/src/records/*.ts` (root) | exit 0 | | |
| `git status --porcelain docs/api contracts packages/node` | empty | | |
| `pnpm --filter @openverify/docs-tools docs:records`, then `git status --porcelain docs/security/data-classification.md` | empty: the committed page is the fresh render | | |
| After docs-security's GREEN `1b5d9cc2f` (rule 28's re-run, about 20 minutes later): `pnpm -s typecheck` | exit 0 | 18 | 5.59 4.77 4.26 |
| `pnpm -s lint` | exit 0 | 18 | 6.70 5.06 4.37 |
| `pnpm test` (the 80% gate, every area) | exit 0: 380 tests in 47 files; statements 97.53%, branches 85.39%, functions 98.52%, lines 97.48%; `src/records` 96.62% statements, 74.42% branches, 98.24% functions, 96.39% lines | 31 | 6.77 5.17 4.42 |

The wording, vendor-name, metric-name and docs-tree tests run inside `pnpm test` and pass over every page this area wrote; `draftsRemaining` holds no path of mine.
