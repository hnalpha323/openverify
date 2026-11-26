# Phase 11, Workflow 11E: docs-catalog (C279, C280 with the switch off, C281)

Agent `docs-catalog` (claude-opus-5-5), Stage 2, beside five other document agents on disjoint paths. Start `247f6af3c` (base `aa00b57bb`), contracts-11e's checkpoint 3 `2952f2a84`. Owned paths: `docs/checks/catalog.md`, `docs/checks/limits.json`, `docs/api/README.md`, `docs/migration/`, `docs/connect/`, `packages/docs-tools/src/catalog/` with their tests. Every command ran after `source scripts/env.sh`; outputs are abbreviated, never edited.

## 0. Inputs read

- The plan's C279-C281, the 11E bullet, the orchestrator decisions before 11E (items 1-28) and contracts-11e's amendments 1-17; `docs/research/phase11-inventory.md` section 5.
- The registries through `@openverify/core` (a throwaway probe under `src/`, deleted): `CHECK_REGISTRY` 89 checks over 11 types, `REPORT_REGISTRY` 11, `SIGNAL_REGISTRY` 19; the config defaults the workers merge (`GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`, `SELFIE_CHECK_CONFIG_DEFAULTS`, `PHASE5_CHECK_CONFIG_DEFAULTS`, `REPORT_CONFIG_DEFAULTS`), `LIST_KIND_REGISTRY` (13), `GRAPH_KIND_REGISTRY` (18), `FIELD_SCHEMA_TYPES` (15) and their limits.
- The family pages' per-check "Limits" bullets and "Known limits" sections, `docs/network/README.md`'s "What it cannot see", `docs/checks/signals.md`'s catalogue and each report page's limits: the sources of `docs/checks/limits.json` (ours, in my own words).
- The ten calibration reports. Three (11D's) carried a summary block; seven did not.

## 1. Checkpoint 1 (catalog)

### 1.1 Borrowed edit: the seven summary blocks (11E decisions item 16)

`git status --porcelain docs/calibration` was empty. A scratch script (outside the repository) wrote one block per older report, appended under a new "## Summary block" heading with one sentence saying who added it and why; the report's text above is unchanged. Rows copy the report's own figures only (each later found in the report's prose by the catalog's figure test); `head` is the commit that last changed the report, `owner` names the Workflow that measured it (the reports name no agent), `machine` is given where the report states the CPU and memory (`disk-class` "not stated in the report"), else `null`. Gaps are copied where the report states them (6C, 6D); for 6B's budget rows the gap is the figure minus the budget, the 11D convention.

| Report | Workflow | Rows |
|---|---|---|
| government-id-phase3.md | 3A | 10 |
| selfie-phase4.md | 4B | 4 |
| selfie-phase4-method.md | 4B | 4 |
| watchlist-phase6.md | 6B | 7 |
| watchlist-phase6c.md | 6C | 4 |
| watchlist-phase6d.md | 6D | 7 |
| android-document-guidance.md | 10B | 7 |

```
$ (cd load && for f in <the seven>; do uv run --frozen python report.py check ../docs/calibration/$f.md; done)
rc=0
```

Commit `3aefe390f` (docs(calibration): a summary block in each of the seven older calibration reports ...).

### 1.2 Stub

`791287076` feat(docs-tools): stub the check catalog and calibration-block readers: `src/catalog/calibration.ts` and `check-catalog.ts` with their typed names, answering empty.

### 1.3 RED

`6bdcd7b81` test(docs-tools): `src/catalog/calibration.test.ts`, `check-catalog.test.ts` and `index.test.ts` (replacing contracts-11e's stub test). For the RED run `docs/checks/limits.json` was the committed stub (my draft held aside), so the limits test failed for the intended reason too.

```
$ pnpm exec tsc --noEmit -p .        # no error in src/catalog
$ pnpm exec vitest run src/catalog --coverage.enabled=false
     × prints the form the report itself writes
     × reads every report under docs/calibration with one block valid against the schema
AssertionError: expected [] to deeply equal [ …(10) ]
     × has exactly one entry per check id, report type and signal, each a sentence of its own
AssertionError: expected [] to deeply equal [ …(89) ]
     × equals a fresh render (pnpm --filter @openverify/docs-tools docs:catalog writes it)
AssertionError: expected [ { …(2) } ] to deeply equal []
     × is built and renders the area generated pages, every one fresh
AssertionError: expected 'not-built' to be 'built'
      Tests  19 failed | 5 passed (24)
```

### 1.4 GREEN

`src/catalog/calibration.ts` (the block reader with ajv against the committed schema, `figureForm`, `CALIBRATION_SOURCES`, `calibrationFindings`), `src/catalog/check-catalog.ts` (`renderCheckCatalog`, `readLimits`, `limitsFindings`, `familyPageFindings`, `FAMILY_PAGES`), `src/catalog/markdown.ts`, `src/catalog/index.ts` (`renderCatalog`, `checkCatalog` with the checks `catalog-limits`, `catalog-family-pages`, `catalog-calibration`, `catalog-fresh`); `docs/checks/limits.json` (119 entries: 89 checks, 11 report types, 19 signals) and `docs/checks/catalog.md` written by `pnpm --filter @openverify/docs-tools docs:catalog`.

- `figureForm` prints a figure in the form the report's own text writes it (the most precise form first; a whole number with no digit, `.` or `,` before it and no digit after it), so every headline figure the catalog prints is found in the cited report's prose, outside its block (H27). One RED expectation was refined in GREEN: a whole number is tried with one decimal first (`102` reads `102.0`, as the report writes it), so the test now expects `102.0` there and `616` where the text writes `616`.
- No `new RegExp` is built at run time (the C252 lint rule): the word and number searches scan with `indexOf`.

```
$ pnpm --filter @openverify/docs-tools docs:catalog
catalog: 1 files written
$ pnpm exec vitest run src/catalog --coverage.enabled=false
      Tests  24 passed (24)
```

### 1.5 Borrowed edit: the CLI's not-built test

`src/cli.test.ts` (contracts-11e's) used `render catalog` as its example of an area not built yet, so it failed once this area was built. `git status --porcelain` empty; the test now injects its own catalog stub, as docs-selfhost's `093f5d62e` did for the render-all test. Commit `4525e4a31`.

### 1.6 Gate (rule 28: what I touched)

```
$ cat /proc/loadavg   -> 3.29 3.65 3.33
$ pnpm --filter @openverify/docs-tools typecheck     # 18.6 s
rc=0
$ pnpm --filter @openverify/docs-tools lint          # 12.2 s
src/security/threat-model.ts 157:21 error Unsafe Regular Expression   (docs-security's work in flight)
rc=1; src/catalog clean (pnpm exec eslint src/catalog: rc=0)
$ pnpm exec vitest run --coverage.enabled=false      # the whole package
Tests 6 failed | 220 passed (226): src/compliance/* (4) and src/selfhost/index.test.ts (docs-compliance's and docs-selfhost's work in flight); src/cli.test.ts fixed above
$ pnpm exec vitest run src/catalog src/wording.test.ts src/vendor-name.test.ts src/docs-tree.test.ts --coverage.enabled=false
Tests 67 passed (67)
$ pnpm exec prettier --check docs/checks/limits.json packages/docs-tools/src/catalog/*.ts
All matched files use Prettier code style!
```

Checkpoint 1 commit: `66ff5f17c` (docs(checks): Workflow 11E docs-catalog checkpoint 1 (catalog)); GREEN `907a97658`.

## 2. Checkpoint 2 (API reference)

### 2.1 How the routes are read (amendment 6, tried first)

contracts-11e's amendment 6 asks to try the in-memory app build first. The area's render signature is synchronous (`(repo) => RenderResult`, frozen), and the build is asynchronous, so the build runs in a child process: `src/catalog/route-table-collector.ts` builds the app as `apps/api/src/openapi.test.ts` does (`syntheticEnv({ OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox' })`, the environment that writes `docs/api/openapi.json`, no database), records each route through an `onRoute` hook, and prints the routes with the rate-limit plugin's route constants; `src/catalog/route-table.ts` runs it with `spawnSync` once per process and root (`OPENVERIFY_*` and `NODE_OPTIONS` removed from its environment, a 50 s guard under the shared 60 s hang guard). A memory repository (a fixture) never builds the API.

```
$ (cd apps/api && node --experimental-transform-types --no-warnings --conditions=@openverify/source --import ../../packages/docs-tools/scripts/register-ts.mjs ../../packages/docs-tools/src/catalog/route-table-collector.ts <root>)
rc=0  real 0m8.372s   (690 routes; an earlier probe: 10.2 s)
```

So scopes are rendered for every documented operation (501 operations over 401 paths; no `not read` cell). Rate policies: the plugin's nine (`api`, `flow-ip`, `flow-session`, `one-time-link-redeem`, `flow-signals`, `flow-handoffs`, `flow-handoffs-ip`, `flow-integrity`, `flow-sandbox-chip`) per route, by the plugin's hooks read as a table over its exported constants; the other 32 policies with their limit and window and no route (the missing route-to-policy declaration is reported for 11F's `fix-server`). 32 operations declare no `config.scopes` and check their scope in the handler: the page says `in the handler` for them.

### 2.2 Stub, RED, GREEN

- Stub `2b6d7bbfb`: `src/catalog/route-table.ts` and `api-reference.ts`, typed, answering `null`.
- RED `4ca8d53f3`: `src/catalog/api-reference.test.ts` (fixtures: grouping by tag, scope, idempotency, pagination, plugin policies per route, every policy with limit and window, the version header, the problem shape, event samples, `not read` without a route table, the tag pages) and `index.test.ts` (the README among the fresh files; every documented operation resolved).

```
$ pnpm exec vitest run src/catalog --coverage.enabled=false
AssertionError: expected '' to contain '\n### `inquiries`'
AssertionError: expected [ 'docs/checks/catalog.md' ] to deeply equal ArrayContaining{…}
AssertionError: expected 0 to be greater than 40
      Tests  12 failed | 23 passed (35)
```

- GREEN: `route-table.ts`, `route-table-collector.ts` (run only as a child; `v8 ignore`), `api-reference.ts` (`renderApiReference`, `TAG_PAGES`, `apiReferenceFindings`), `index.ts` (the README in `renderCatalog`; the check `catalog-api-reference`); `docs/api/README.md` written by `docs:catalog`.

```
$ cat /proc/loadavg -> 4.35 4.18 3.73
$ time pnpm --filter @openverify/docs-tools docs:catalog
catalog: 2 files written      real 0m15.950s
$ pnpm exec vitest run src/catalog --coverage.enabled=false
      Tests  35 passed (35)   Duration 20.12s
$ pnpm exec vitest run src/catalog src/wording.test.ts src/vendor-name.test.ts src/docs-tree.test.ts src/metrics.test.ts --coverage.enabled=false
      Tests  81 passed (81)
$ git status --porcelain docs/api contracts packages/node
 M docs/api/README.md        (openapi.json unchanged)
```

Checkpoint 2 commit: `8fe56c01c`; GREEN `debd353f0`.

## 3. Checkpoint 3 (mapping)

- Stub `3df0d9a59` (`src/catalog/mapping.ts`, `mapping-data.ts`). The implementation had been drafted first; it was held aside in the scratchpad while the stub and the RED test were committed and run, then restored for GREEN.
- RED `dd2e6a0aa`: `src/catalog/mapping.test.ts` (the parser over the real index; every identifier of the six sections has a counterpart or a reason code; fixtures for a new identifier with neither, an entry the index no longer lists, and an entry an automatic rule now maps; the neutral page fresh, naming no vendor, with the not-affiliated line, the concerns table, the migration notes, a table per section and the Connect table; the vendor-named path only with the switch on; `docs/connect/mapping.md`'s eight paths) and `index.test.ts` (the two pages among the area's files; the check `catalog-mapping`).

```
$ pnpm exec vitest run src/catalog --coverage.enabled=false
AssertionError: expected [] to include 'id_glare_detection'
AssertionError: expected [] to include 'paths brand-new-things has no counter…'
AssertionError: expected undefined to be 'docs/migration/from-hosted-api.md'
AssertionError: expected undefined to be 'docs/connect/mapping.md'
      Tests  12 failed | 34 passed (46)
```

- GREEN: `mapping.ts` (`parseSurface`, `mappingRows`, `mappingFindings`, `renderMigration`, `renderConnectMapping`), `mapping-data.ts` (`REASON_CODES`, `MAPPING_OVERRIDES`, `MAPPING_PREFIXES`, ours), `index.ts` (both pages in `renderCatalog`; the catalog's vendor-name column fed from the check rows only when the switch is on); `docs/migration/from-hosted-api.md` and `docs/connect/mapping.md` written by `docs:catalog`. The rules: the same check id, verification type (plural forms included), report type, list kind (by plural), event name, or path (parameters normalised); then an exact entry, a prefix entry (`digital-id-`, `batch-job.`, `document.`, `importer-pipeline-run.`, `batch-jobs`, `relays`), or a reason inherited from the report type (`report/<type>.<action>`) or the verification type (`verification/<types>/{id}`). An identifier that names the vendor is written by role while the switch is off (the vendor-name test's own rule decides). The generator never takes a `--vendor-name` flag: the committed switch rules (Q8 pending, rule 20); it was never rendered with the switch on except in memory by its test.
- A first render listed the Connect events beside the eight paths in `docs/connect/mapping.md` (13 rows); the test caught it and the page keeps the paths only.

```
$ pnpm --filter @openverify/docs-tools docs:catalog
catalog: 4 files written
$ pnpm exec vitest run src/catalog src/vendor-name.test.ts src/wording.test.ts --coverage.enabled=false
      Tests  82 passed (82)
```

Checkpoint 3 commit: `7d813b436`; GREEN `3b89db1d0`.

## 4. Checkpoint 4 (sharing guide)

- Stub `0d58c3dc2` (`src/catalog/connect-guide.ts`: `CONNECT_GUIDE_PAGES`, `connectGuideFindings`).
- RED `c57587511`: `src/catalog/connect-guide.test.ts`. The nine pages were drafted first; for the RED run the committed stubs were restored (drafts held in the scratchpad) and the drafts put back after.

```
$ pnpm exec vitest run src/catalog/connect-guide.test.ts --coverage.enabled=false
AssertionError: expected [] to deeply equal [ 'docs/connect/README.md', …(8) ]
AssertionError: expected '# Events and workflows\n\nDraft: writ…' to contain '`connect/connection.created`'
AssertionError: expected [] to include 'docs/connect/README.md is still a stub'
      Tests  3 failed | 1 passed (4)
```

- GREEN `03bfdbf63`: the record check (every page written, no stub marker; every event, scope and variable it names exists in `EVENT_NAMES`, `PERMISSIONS` and `CONFIG_REGISTRY`, `connect/share-token.ready` allowed as "not emitted"; every relative link and cited repository path exists; every bold "Ours" label carries "(reason: …)"; the required statements: README's one install and what cannot be recalled, consent.md's "not legal advice" and "not been reviewed by counsel", provenance.md's and client-side.md's C235.8, limits.md's four limits, and KP11-22's two client limits in both limits.md and client-side.md), wired as `catalog-connect-guide`; and the nine pages, one per edit. The RED fixture was corrected in GREEN: it gave every page the stub marker, so the statement findings it expected could never be reached; now only README.md is a stub there. The check also caught README.md's own sentence that mentions the bold label; it now quotes the word.
- KP11-22: `docs/connect/client-side.md` ("Two client limits (KP11-22)") and `docs/connect/limits.md` ("The client limits (KP11-22)") state that the client view serves only `text.body` and `biometric.body`, so Android shows the built-in title and accept, decline and withdraw labels and an operator's override shows only on the web (`ShareConsentStep.kt`, unchanged since `87f08349c`); and that `{expires}` is worded by `Intl.NumberFormat` (ICU 78.2 on Node 22.22.1, read again on this host), so a Node upgrade between the serve and the accept answers `consent_text_mismatch`.

## 5. The end gate (rule 28: what I touched)

```
$ cat /proc/loadavg -> 2.15 3.76 4.40
$ pnpm --filter @openverify/docs-tools typecheck   rc=0  19 s
$ pnpm --filter @openverify/docs-tools lint        rc=0  17 s
$ pnpm --filter @openverify/docs-tools test        rc=0  23 s (load at the end 4.37 4.15 4.50)
 Test Files  48 passed (48)
      Tests  385 passed (385)
All files | 97.49 | 85.42 | 98.45 | 97.47      (src/catalog 95.11 statements)
$ pnpm exec prettier --check docs/checks/limits.json packages/docs-tools/src/catalog/*.ts packages/docs-tools/src/cli.test.ts
All matched files use Prettier code style!
$ git status --porcelain docs/api contracts packages/node
(empty; docs/api/README.md committed, docs/api/openapi.json unchanged)
```

The wording, vendor-name, docs-tree and metric-name tests run inside the package suite over every new page; all pass.
