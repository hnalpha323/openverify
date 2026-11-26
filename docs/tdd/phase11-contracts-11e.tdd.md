# Phase 11, Workflow 11E Stage 1a: contracts-11e

Evidence for `contracts-11e` (Workflow 11E Stage 1a, alone on the machine): the base, the read and record (inventory section 5, the plan's "Workflow 11E Stage 1a amendments (contracts-11e)"), `packages/docs-tools`, the fetch scripts and id lists, and the wording, vendor-name, switch and docs-tree tests. Each section names its commands and their real, abbreviated output. Checkpoint commits are listed at the end. Machine: the 11D calibration host (Intel Xeon E5-1650 v3, 12 logical CPUs, WSL2), Node v22.22.1, pnpm 12.14.0.

## 0. The base, from the records (rule 25)

Run 2026-11-20, read-only:

```text
$ git merge-base --is-ancestor aa00b57bb382ed20d6797305e080acdf6ae35f55 HEAD; echo a=$?
a=0
$ git merge-base --is-ancestor 247f6af3c3850093a7a0856e766e2aa874666697 HEAD; echo b=$?
b=0
$ git show aa00b57bb:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11D done'
20:## 2026-11-20: Phase 11, Workflow 11D done (performance: the load harness, ...)
$ git show 247f6af3c:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11D done'
20:## 2026-11-20: Phase 11, Workflow 11D done (performance: the load harness, ...)
$ grep -n '^## Orchestrator decisions before Workflow 11E' docs/plans/phase-11.plan.md
2643:## Orchestrator decisions before Workflow 11E (2026-11-20)
$ git merge-base --is-ancestor 247f6af3c origin/main; echo origin=$?   # recorded, not required
origin=1
```

- `origin/main` is `aa00b57bb` (the 11D push); it does not hold `247f6af3c`. The push is the orchestrator's.
- **CI, read once, never waited on:** `gh run list --branch main --limit 5` shows the 11D push's run 44785912432 (2026-11-20T17:42Z) and the 11C, 11B, 11A and Phase 10 pushes' runs, each `completed / failure` in 5 s. `gh run view 44785912432 --json jobs`: 19 jobs, 0 steps each (16 `failure`, 3 `skipped`). No step started, so no CI failure is passed in and no CI fix was made (no code outside `packages/docs-tools` changed for one).
- Read: the Phase 10 close's "Unproved on a device or an emulator" (`docs/PROGRESS.md:408-418`) and "The release gate" (`:420`), and 11A-11D's deferred items and device-proof lines. The documents state them as open; none is contracts-11e's.

## 1. Read and record

- `docs/research/phase11-inventory.md` section 5 (5.1 the base and CI; 5.2 the registries; 5.3 the records; 5.4 the documents Phases 7-11 wrote; 5.5 the wording and vendor-name baselines; 5.6 the standards).
- Counts read by importing the modules through `@openverify/source` in throwaway scripts (removed): `CHECK_REGISTRY` 89 (per type 35, 6, 15, 7, 6, 3, 5, 4, 4, 1, 3), `REPORT_REGISTRY` 11, `SIGNAL_REGISTRY` 19, `VERIFICATION_TYPES` 11, `ENCRYPTED_COLUMNS` 95, `EVENT_NAMES` 151, `RATE_LIMIT_POLICIES` 41. Every check id appears in its family page (the type-to-page map, amendment 7).
- **The route scopes spike** (one throwaway test under `apps/api/src`, removed; `git status --porcelain apps/api` empty afterwards): an in-memory app build with an `onRoute` hook added before `ready()`:

```text
$ pnpm exec vitest run src/zz-scopes.test.ts --coverage.enabled=false   # apps/api; rc=0, 17.4 s
routes 690
withScopes 596
v1 684
public 12
```

- The standards, fetched into the scratch directory only (nothing committed): the ASVS export, 162,870 bytes, `sha256sum` `8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311`, 345 requirements (`L`: 70 "1", 183 "2", 92 "3"), 253 at Level 2 or below; the MASVS `OWASP_MASVS.cdx.json`, 28,264 bytes, `abedfcdf6cbd38ffa30a2ae6fc9f98ad7cddff59f0ad35932117559a2a27e0ae`, 8 groups and 24 controls; MASVS's `License.md` at `v2.1.0`: CC-BY-SA-4.0.
- The plan's "## Workflow 11E Stage 1a amendments (contracts-11e)", items 1-10 (with the "Carried (Phases 7-10, after the plan)" table) at checkpoint 1.

## 2. `packages/docs-tools` (checkpoint 1)

Scaffold first (`ad1f9aaf6`): the package, its configuration, the six area stubs and the shared modules, each body throwing "not implemented", so the tests compile. `pnpm install` (under the pnpm lock) added one importer to `pnpm-lock.yaml` and no package; `pnpm-workspace.yaml` unchanged (no `minimumReleaseAgeExclude`).

**RED** (`cb0608dc8`): `pnpm exec vitest run --coverage.enabled=false` in `packages/docs-tools` (load 0.37), `tsc --noEmit` and `eslint .` clean first:

```text
 FAIL  src/fresh-render.test.ts / src/repository.test.ts / src/{catalog,compliance,records,release,security,selfhost}/index.test.ts
 FAIL  src/cli.test.ts > the docs-tools CLI > refuses an unknown command, a missing area and an unknown area with usage
 ... (9 CLI cases)
Error: not implemented: {}            (14 times)
Error: not implemented: [["--help"],["err"]]
 Test Files  9 failed | 2 passed (11)
      Tests  9 failed | 2 passed (11)
```

**GREEN** (`01b0db5ad`): `pnpm test` (the 80% gate) in `packages/docs-tools`:

```text
 Test Files  11 passed (11)
      Tests  32 passed (32)
All files         |    96.5 |    91.95 |   93.87 |   95.86 |
  cli.ts          |   92.06 |    89.58 |   84.21 |   91.07 | 130-135
  repository.ts   |     100 |    93.93 |     100 |     100 | 75,80
```

The scripts, smoke-run: `pnpm --filter @openverify/docs-tools docs:security` prints "security: not built yet (docs-security)" (exit 3 from the CLI); `release:check --tag` passes `--tag` through and prints "release:check: not built yet (docs-release)"; an unknown command prints the usage (exit 2). `git status` unchanged by them.

**The config suite's reviewed file-system importers** (met in the checkpoint gate): `packages/config/src/eslint-security.test.ts` lists every production module that imports the file system with its source of paths. RED, `pnpm --filter @openverify/config test`:

```text
 FAIL  src/eslint-security.test.ts > the services take no file path from a request (detect-non-literal-fs-filename off) > lists every production module that imports the file system, each with its source of paths
+   "packages/docs-tools/src/cli.ts",
+   "packages/docs-tools/src/repository.ts",
      Tests  1 failed | 450 passed (451)
```

GREEN after the two reviewed entries (the repository root from the module's place; repository-relative paths refused when they leave the tree): `Tests  451 passed (451)`, lint clean.

## 3. Checkpoint 1 gate (rule 29: the lockfile changed, so the area's full gate)

| Call | Result | Seconds | Load (start -> end) |
|---|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | pass | 0 | 0.27 -> 0.27 |
| `pnpm format:check` | pass | 120 | 0.27 -> 1.23 |
| `pnpm turbo run typecheck --force` (heavy slot 0) | pass, 20 tasks | 186 | 1.13 -> 5.44 |
| lint `--force --concurrency=1 --filter=@openverify/api`, 4 GB heap | pass | 264 | 5.00 -> 1.43 |
| lint `--filter=@openverify/dashboard --filter=@openverify/contracts` | pass, 2 tasks | 244 | 1.32 -> 1.27 |
| lint, the other 17 packages (docs-tools among them) | pass, 17 tasks | 353 | 1.17 -> 2.04 |
| `pnpm --filter @openverify/docs-tools test` | pass, 32 tests, 96.5% | 1 | 1.73 |
| `pnpm --filter @openverify/config test` | first FAIL (section 2), then pass, 451 | 8 | 1.76 |
| `git status --porcelain docs/api contracts packages/node` | empty | | |

Checkpoint 1: `d4e66746a` ("docs(plan): Workflow 11E contracts-11e checkpoint 1 (inventory and docs-tools)"), after `5166e4598` (the config suite's reviewed importers).

## 4. The fetch scripts and the id lists (checkpoint 2)

The pins were read on 2026-11-20 from the GitHub release metadata and the tags (section 1): ASVS `v5.0.0_release` (2025-05-30, tag commit `5cf9b032…`), MASVS `v2.1.0` (2024-01-18, commit `8e133d09…`), both CC-BY-SA-4.0. The scripts follow `scripts/fetch_bundletool.py`'s pattern (standard library only, `python3 -I`, the file written only after its size and digest match, a 5xx retried and a 4xx not, an injected opener for the tests) and write into `data/standards/` (git-ignored by `data/*`; the PII scan skips `data/`).

Stubs first (`a79810fbb`): the pins and signatures, each body raising `NotImplementedError`.

**RED** (`0e6fec24e`): `(cd services/vision && uv run pytest tests/test_fetch_asvs.py tests/test_fetch_masvs.py --no-cov)`, ruff clean first (load 0.34):

```text
FAILED tests/test_fetch_asvs.py::test_it_writes_the_export_only_after_its_hash_matches
FAILED tests/test_fetch_asvs.py::test_it_refuses_an_export_of_another_shape[not-json] ... [repeated]
FAILED tests/test_fetch_asvs.py::test_the_committed_list_holds_the_253_level_2_ids_with_no_text
FAILED tests/test_fetch_masvs.py::test_it_refuses_an_export_of_another_shape[not-json] ... [eight]
FAILED tests/test_fetch_masvs.py::test_the_committed_list_holds_the_24_controls_of_the_eight_groups_with_no_text
E       NotImplementedError: contracts-11e: the body lands in the GREEN commit
E       FileNotFoundError: [Errno 2] No such file or directory: '.../docs/security/masvs-2.1.0-ids.txt'
29 failed, 5 passed in 0.56s
```

**GREEN** (`927a825cd`): the bodies, then the lists written by the scripts from the real exports (never by hand):

```text
$ python3 -I scripts/fetch_asvs.py --write-ids
ASVS 5.0.0: downloaded .../data/standards/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json (CC-BY-SA-4.0, never committed)
ASVS 5.0.0: wrote 253 ids to .../docs/security/asvs-5.0.0-l2-ids.txt
$ python3 -I scripts/fetch_masvs.py --write-ids
MASVS 2.1.0: downloaded .../data/standards/OWASP_MASVS-2.1.0.cdx.json (CC-BY-SA-4.0, never committed)
MASVS 2.1.0: wrote 24 ids to .../docs/security/masvs-2.1.0-ids.txt
$ python3 -I scripts/fetch_asvs.py --verify-ids     # rc=0
ASVS 5.0.0: the committed list matches the export (253 ids)
$ python3 -I scripts/fetch_masvs.py --verify-ids    # rc=0
MASVS 2.1.0: the committed list matches the export (24 ids)
$ (cd services/vision && uv run pytest tests/test_fetch_asvs.py tests/test_fetch_masvs.py --no-cov)   # rc=0, 1 s, load 0.57
34 passed in 0.16s
$ uv run ruff check / ruff format --check (the four files, services/vision's configuration)
All checks passed! / 4 files already formatted
```

Coverage of the scripts under these tests (`-o addopts="" --cov=../../scripts`): `fetch_asvs.py` 98%, `fetch_masvs.py` 93%. Without `--no-cov` the same two files exit 1 on vision's own gate (`--cov` over `src`, "Total coverage: 0.00%"), as any lone vision test file does; the vision suite's halves in the Validation hold that gate.

**Checkpoint 2 gate** (rule 29, affected scope; the filter's commit `d4e66746a`):

| Call | Result | Seconds | Load |
|---|---|---|---|
| `pnpm format:check` | pass | 122 | 1.28 |
| `pnpm turbo run lint typecheck --filter="...[d4e66746a]"` | pass: no package in scope (only `scripts/`, `services/vision/tests/` and `docs/` changed) | 0 | |
| the two fetch tests, `--no-cov` | pass, 34 | 1 | 0.57 |
| ruff check and format over the four files | pass | | |
| both `--verify-ids` | pass, 253 and 24 | | |

Checkpoint 2: `f088c4bcb` ("docs(plan): Workflow 11E contracts-11e checkpoint 2 (fetch scripts and id lists)").

## 5. Wording, vendor name, switch, docs tree and metric names (checkpoint 3)

Measured first (inventory 5.5): the vendor's name as a word in `docs/` outside the plan's exempt paths appears once, in `docs/tdd/phase0-verify.tdd.md:163`, beside 47 uses of `persona-opensource` and 3 of `persona-surface.md`, all in `docs/tdd/`; "certified" or "compliant" next to ASVS or MASVS appears outside the plans and research only in ADR 0010's denial (`:86`); `docs/compliance/` holds neither word. No earlier Workflow built a vendor-name test over `docs/` (`grep` over every test file: five product-string assertions, none reading `docs/`).

Stubs first (`509ca1387`): `src/text.ts`, `wording.ts`, `vendor-name.ts`, `switches.ts`, `docs-tree.ts`, `metrics.ts`, each body throwing and each constant empty (the switches stubbed on), exported from `src/index.ts`; typecheck and lint clean.

**RED** (`f47765670`): `pnpm exec vitest run --coverage.enabled=false` in `packages/docs-tools` (load 0.25):

```text
 FAIL  src/cli.test.ts > the docs-tools CLI > writes a stub for each missing docs-tree path, never over an existing file
 FAIL  src/docs-tree.test.ts > the repository > holds every manifest path
 FAIL  src/metrics.test.ts > ... > holds over the repository
 FAIL  src/switches.test.ts > the switches (Q8, Q2 and Q3 pending) > are both off
 FAIL  src/switches.test.ts > release.yml's publish job > still names OPENVERIFY_PUBLISH in the release environment, so publishWired stays off
 FAIL  src/text.test.ts > the units the wording rules read > joins a wrapped paragraph and cuts it into sentences, each with its first line
 FAIL  src/vendor-name.test.ts > the vendor-name rule > finds the name as a word or the host: Send the Persona-Version header.
 FAIL  src/vendor-name.test.ts > the vendor-name rule > holds over docs/ today, with the one Phase 0 use left in the exempt evidence
 FAIL  src/wording.test.ts > C274.5: ASVS and MASVS are never "certified" or "compliant" > refuses: The SDK is MASVS compliant.
 FAIL  src/wording.test.ts > C274.5: the compliance guide says "compliant" and "complies" only to deny them > refuses a claim anywhere under docs/compliance/
 ... (51 in all; the stubs' "not implemented" throws and empty constants)
 Test Files  7 failed | 10 passed (17)
      Tests  51 failed | 34 passed (85)
```

**GREEN** (`29048e89c`): the bodies, the CLI's `stubs` command and the `docs:stubs` script, then `pnpm --filter @openverify/docs-tools docs:stubs` ("stubs: 46 written"; the two id lists already existed). The first GREEN run failed two cases, both fixed before the commit:

```text
 FAIL  src/text.test.ts > ... > keeps a list item, a table row, a quote and a fenced line as units of their own
AssertionError: expected [ 1, 2, 3, 4, 6, 7, 9, 9 ] to deeply equal [ 1, 2, 3, 4, 6, 7, 9 ]
 FAIL  src/wording.test.ts > the scope > holds over the repository: ...
+       "line": 679, "path": "docs/plans/phase-11.plan.md", "rule": "asvs-masvs-claim",
```

The first: "1. numbered" was cut after its list marker, so a list item's marker is now left out before the cut. The second: C274.5's own text quotes the words ("refuses "compliant" and "complies" anywhere in docs/compliance/"), so a claim word quoted on its own is a mention, not a claim (a fixture each way: `'A test refuses "compliant" and \`certified\` next to ASVS'` passes, `'The "ASVS certified" badge is ours.'` fails). Then:

```text
 Test Files  17 passed (17)
      Tests  87 passed (87)
All files         |   98.25 |    95.73 |      97 |   98.02 |
  cli.ts          |   92.85 |    90.38 |      85 |   92.06 | 147-152
  docs-tree.ts    |     100 |    94.11 |     100 |     100 | 138
```

The API's own C250.7 test still passes with the stubs in place: `(cd apps/api && pnpm exec vitest run src/metrics-documents.test.ts --coverage.enabled=false)`: 5 passed.

## 6. Checkpoint 3 gate (the last checkpoint: the area's full gate, rule 29)

| Call | Result | Seconds | Load (start -> end) |
|---|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | pass | 1 | 0.61 |
| `pnpm format:check` | pass | 125 | 0.61 -> 1.30 |
| `pnpm turbo run typecheck --force` (heavy slot 0) | pass, 20 tasks | 217 | 1.30 -> 3.56 |
| lint `--force --concurrency=1 --filter=@openverify/api`, 4 GB heap | pass | 278 | 3.27 -> 1.94 |
| lint `--filter=@openverify/dashboard --filter=@openverify/contracts` | pass, 2 tasks | 256 | 1.94 -> 1.23 |
| lint, the other 17 packages | pass, 17 tasks | 399 | 1.53 -> 2.21 |
| `pnpm --filter @openverify/docs-tools test` | pass, 87 tests, 98.25% | 2 | 1.87 |
| `pnpm --filter @openverify/config test` | pass, 451 | 8 | 2.58 |
| `(cd services/vision && uv run pytest tests/test_fetch_asvs.py tests/test_fetch_masvs.py --no-cov)` | pass, 34 | 1 | |
| `uv run ruff check` and `ruff format --check` over the four Python files | pass | | |
| `python3 -I scripts/fetch_asvs.py --verify-ids && python3 -I scripts/fetch_masvs.py --verify-ids` | pass (253, 24); again into a fresh scratch `--dest`, downloading both: pass | 0 | 2.22 |
| `git status --porcelain docs/api contracts packages/node` | empty | | |

No CI fix was made (section 0), so no other suite, integration call, Android call or e2e step is in this gate. Every `docs/` page 11E adds is held by the wording and vendor-name rules from this commit on.

## Checkpoints

- Checkpoint 1 (inventory and docs-tools): `d4e66746a`.
- Checkpoint 2 (fetch scripts and id lists): `f088c4bcb`.
- Checkpoint 3 (wording, vendor name, switch and docs tree): the commit whose subject is "docs(plan): Workflow 11E contracts-11e checkpoint 3 (wording, vendor name, switch and docs tree)".
