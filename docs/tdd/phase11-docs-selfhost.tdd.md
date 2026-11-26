# Phase 11, Workflow 11E: docs-selfhost (C277; KP11-32, KP11-43, KP11-48)

Agent `docs-selfhost` (claude-opus-5-5), Stage 2, beside five other document agents. Start `247f6af3c`, after contracts-11e's checkpoint 3 (`2952f2a84`). Owned paths: `docs/self-hosting/` and `packages/docs-tools/src/selfhost/`. Every command below ran after `source scripts/env.sh`, from `packages/docs-tools` unless it says otherwise.

## 1. Checkpoint 1: the configuration reference (C277.2)

**Stub** (`766603fae`): `src/selfhost/configuration.ts` exports `CONFIGURATION_PAGE` and `renderConfigurationReference(registry?)` returning `''`, so the RED test compiles.

**RED** (`b55c18b74`): `src/selfhost/configuration.test.ts` (a three-entry fixture registry: one row per exact name, sorted, pipes escaped, `unset` for a null default, the `_FILE` form, the processes in the registry's order; the pattern entry rendered as a pattern with its fixed start and absent from the names table; the per-process counts; the provenance and re-render lines; the same bytes for a reversed registry; every real entry exactly once; the committed page equal to a fresh render) and `src/selfhost/index.test.ts` (`renderSelfhost` built with the page; `checkSelfhost` reports a stale page as `fresh-render`; the area holds over the repository).

```
$ pnpm exec tsc --noEmit            -> exit 0
$ pnpm exec vitest run src/selfhost --coverage.enabled=false   -> exit 1
     × renders the configuration reference
     × finds a generated page that is missing or stale
     × holds over the repository
     × renders one row per exact name, sorted, with every field the registry holds
     × renders the pattern entries as patterns, with their fixed start
     × counts each process’s names and secrets, in the registry’s process order
     × says it is generated, from where, and how to re-render it
     × renders every entry of the real registry exactly once
     × is committed as a fresh render
 FAIL ... AssertionError: Variables: expected -1 to be greater than or equal to 0
 FAIL ... index.test.ts > renders the configuration reference: expected 'not-built' to be 'built'
      Tests  9 failed | 1 passed (10)
```

Each failure is the intended one: the stub renders nothing and the area answers `not-built`.

**Borrowed edit** (`093f5d62e`, `packages/docs-tools/src/cli.test.ts`, contracts-11e's test; its 11F owner is fix-server, as for every path under `packages/`): the full suite failed once the selfhost area was built, because "renders every area for all, and answers not built while one is a stub" let the real areas run (expected 2 files written, received 3). The test now injects every other area as a not-built stub, so it holds while each Stage 2 area is built. Test-only, minimal, committed at once with the file's status empty before the edit.

```
$ pnpm test   (before the borrowed edit)
     × renders every area for all, and answers not built while one is a stub
AssertionError: expected 3 to be 2
 Test Files  1 failed | 17 passed (18)
$ pnpm exec vitest run src/cli.test.ts --coverage.enabled=false   (after)   -> Tests 10 passed (10)
```

**GREEN**: `src/selfhost/configuration.ts` renders the page from `CONFIG_REGISTRY` (relative import of `apps/api/src/config-registry.ts`, which imports nothing); `src/selfhost/index.ts` returns it from `renderSelfhost` and checks it with `staleFiles` in `checkSelfhost` (`selfhost-fresh-render`). `pnpm --filter @openverify/docs-tools docs:selfhost` wrote `docs/self-hosting/configuration.md` (125 entries: 122 names and 3 patterns, 25 secrets; per process api 68/14, worker 81/20, migrate 12/6, dashboard 13/1, flow 9/1, vision 12/1, code-runner 4/1).

```
$ pnpm -s docs:selfhost                  -> selfhost: 1 files written
$ pnpm exec vitest run src/selfhost --coverage.enabled=false   -> Tests 10 passed (10)
$ pnpm exec eslint src/selfhost          -> exit 0
$ pnpm exec tsc --noEmit                 -> exit 0
$ pnpm test                              -> exit 0; Test Files 18 passed (18); Tests 95 passed (95); All files 95.7% statements (src/selfhost 100%)
```

**Checkpoint 1 gate** (rule 28, my paths only; load 1.72 before the suite): `pnpm -s typecheck` exit 0; `pnpm exec eslint src/selfhost src/cli.test.ts` exit 0; `pnpm test` exit 0 (95 tests, 95.7%); `pnpm exec prettier --check` over the two selfhost sources exit 0. The package's whole `pnpm -s lint` exited 1 at this moment only on another agent's uncommitted files (`src/_probe.ts`, `src/security/threat-model.ts` and its test, docs-security's work in flight); none of mine. `git status --porcelain docs/api contracts packages/node` empty.

## 2. Checkpoint 2: the guide (C277.1, C277.3 to C277.10; KP11-32, KP11-43, KP11-48)

**Stubs** (`d0214b842`): `src/selfhost/blocks.ts` (`blockStart`, `blockEnd`, `spliceBlock`), `src/selfhost/figures.ts` (`readSummaryBlock`, `renderLoadFigures`, `renderMetricTable`, `renderMigrationList`) and `src/selfhost/checks.ts` (`checkVariableNames`, `checkCommands`, `checkRepositoryPaths`, `checkLinks`, `checkPublishSwitch`, `checkPages`, `checkQuotedFacts`, `PENDING_PAGES`), each answering nothing.

**RED** (`beace61d6`): `blocks.test.ts`, `figures.test.ts` and `checks.test.ts` over fixtures (a three-marker page; a synthetic summary block validated against the committed schema; a fixture registry row per metric; drizzle file names; memory trees for each rule).

```
$ pnpm exec vitest run src/selfhost --coverage.enabled=false   -> exit 1
     × replaces only what lies between the markers, keeping them
     × reads a valid block
     × renders one row a figure, every verdict as the block gives it, with its gap
     × names every registered metric and nothing else
     × lists the migrations from 0025 on, in order, leaving out the others and the snapshots
     × refuses an unregistered name and the _FILE form of a name that has none, by line
     × refuses a missing script, an unknown package and a command the image does not compile
     × refuses a verify command or a missing statement while off, and an ungated job
     × refuses a page that does not quote the records
 Test Files  3 failed | 2 passed (5)
      Tests  20 failed | 16 passed (36)
```

**GREEN, the logic** (`6527a8625`): the three modules, and `index.ts` wiring `SELFHOST_BLOCKS` (sizing.md's `selfhost-load-figures` from `docs/calibration/load-phase11.md`'s summary block, monitoring.md's `selfhost-metrics` from `METRIC_REGISTRY`, upgrades.md's `selfhost-migrations` from `packages/db/drizzle/`) into `renderSelfhost` and the record checks into `checkSelfhost`. The fixtures passed (35 of 36); "holds over the repository" failed on the stub pages, the record test's intended RED:

```
+     "message": "does not hold the selfhost-load-figures markers once each, start before end",
+     "message": "still holds its draft marker",   (README.md, backups-and-restore.md, ...)
      Tests  1 failed | 35 passed (36)
```

Two lint rules met on the way (C252's run-time `RegExp`, `security/detect-unsafe-regex`): the path root test became `startsWith`, the line suffix a split. **Fix** (`b2a8f1f53`): a cited path may carry an `#anchor` (the first full run named nine anchored citations as missing); the fixture gained one.

**GREEN, the pages** (`673aa7fa6`): sixteen pages, one Write each (rule 15): `README.md`, `requirements.md`, `install-compose.md`, `install-kubernetes.md`, `sizing.md`, `secrets-and-rotation.md`, `backups-and-restore.md`, `upgrades.md`, `database.md`, `valkey.md`, `first-run.md`, `break-glass.md`, `monitoring.md`, `sso.md`, `verify-artifacts.md`, then `pnpm -s docs:selfhost` (4 files written: configuration.md and the three blocks).

Sources re-read for database.md (decision 68, rule 24) on 2026-11-20: PostgreSQL 17's `pg_upgrade` page (https://www.postgresql.org/docs/17/pgupgrade.html: install the extension's shared objects in the new cluster before the upgrade, no `CREATE EXTENSION` there; `--check` first) and pgvector's README at v0.8.6 (https://raw.githubusercontent.com/pgvector/pgvector/v0.8.6/README.md: its "Upgrading" section covers `ALTER EXTENSION vector UPDATE` only and says nothing of `pg_upgrade`). pgAudit is not named.

```
$ pnpm exec vitest run src/selfhost src/wording.test.ts src/vendor-name.test.ts src/metrics.test.ts src/docs-tree.test.ts --coverage.enabled=false
      Tests  82 passed (82)                                              -> exit 0
$ (apps/api) pnpm exec vitest run src/metrics-documents.test.ts --coverage.enabled=false
      Tests  5 passed (5)                                                -> exit 0   (11B's test over monitoring.md)
$ pnpm exec eslint src/selfhost     -> exit 0
$ pnpm exec tsc --noEmit            -> exit 0
$ pnpm test   (load 4.58)           -> exit 1: Tests 17 failed | 238 passed (255); every failure in another agent's work in flight
                                       (src/catalog/api-reference.test.ts, src/catalog/index.test.ts, src/records/crypto-inventory.test.ts,
                                        src/records/index.test.ts, src/release/index.test.ts, and src/cli.test.ts' two release:check cases now that
                                        docs-release built its area); every selfhost test passed
```

Gate: rule 28 (Stage 2, my paths only). `git status --porcelain docs/api contracts packages/node`: empty.

## 3. Checkpoint 3: the hardening checklist (C277.1, C277.3)

Rule 18's wait: `timeout 540 sh -c 'until git log --format=%s | grep -qF "Workflow 11E docs-security checkpoint 2"; ...'` ran twice (the first ended at the cap, exit 124; the second found `3ec17b7a5`, "docs(security): Workflow 11E docs-security checkpoint 2 (ASVS)"). The generator and its fixture tests were written while waiting.

- **Stub** (`194cb80f8`): `src/selfhost/hardening.ts` (`HARDENING_PAGE`, `ASVS_CSV`, `MASVS_CSV`, `parseChecklist`, `renderHardeningChecklist`).
- **RED** (`2c2bf1a00`): `src/selfhost/hardening.test.ts` (C274.1's columns read with csv-parse; a stub CSV, a missing column and unparseable text refused; only `operator` rows, in the checklist's order, ids and our notes, evidence and threat ids, never a requirement's text; the empty case; the same bytes twice): `Tests 6 failed (6)`, the stub answering nothing.
- **GREEN, the generator** (`d5257345a`): `Tests 6 passed (6)`.
- **RED, the wiring** (`9b160d916`): `index.test.ts` "renders the hardening checklist from both checklists, and reports one it cannot read": `Tests 1 failed | 3 passed (4)`.
- **GREEN, the wiring** (`3db623dc3`): `renderSelfhost` renders the page; `checkSelfhost` reports an unreadable checklist as `generated-page`; `PENDING_PAGES` is empty again. `pnpm -s docs:selfhost` wrote the page: 9 ASVS rows and 1 MASVS row with the status `operator` at the time of the render. docs-security's CSVs were still being edited in the working tree (its MASVS work); the first full run met the page stale against an edit made after my render, and a re-render fixed it. **Whenever a checklist CSV changes, `pnpm --filter @openverify/docs-tools docs:selfhost` must run again** (the fresh-render test fails otherwise).

**The last checkpoint's gate** (rule 28's scope for a Stage 2 agent; load 6.68 before, 7.32 after):

```
$ pnpm test                      -> exit 0, 36 s: Test Files 47 passed (47); Tests 381 passed (381); All files 97.54% statements (src/selfhost 97.47%)
$ pnpm -s typecheck              -> exit 0
$ pnpm -s lint                   -> exit 0
$ pnpm exec prettier --check packages/docs-tools/src/selfhost/*.ts packages/docs-tools/src/cli.test.ts   -> exit 0
$ git status --porcelain docs/api contracts packages/node   -> empty
```

The wording, vendor-name and metric-name rules run inside that suite over every page of `docs/self-hosting/`; 11B's `apps/api/src/metrics-documents.test.ts` passed over `monitoring.md` (section 2).

## 4. Checkpoints

| Checkpoint | Commit |
|---|---|
| 1 (configuration reference) | `14043ca9f` |
| 2 (the guide) | `8a0b062b5` |
| 3 (hardening checklist) | this section's commit |
