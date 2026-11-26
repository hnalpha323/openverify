# Phase 11, Workflow 11E: docs-release (C284; reviews F16, H21; verification V01)

Agent: `docs-release` (Stage 2, beside five other document agents). Owned paths: `docs/release/`, `packages/docs-tools/src/release/` and their tests and fixtures. Named borrowed edit: the root `package.json`'s `release:check` script. Every command below ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Load averages are `cat /proc/loadavg` beside the call.

## 0. Start

- Start `247f6af3c`; contracts-11e's checkpoint 3 `2952f2a84`; this agent's first commit `041a46e66`.
- The frozen entry points (`src/release/index.ts`): `renderRelease`, `checkRelease`, `releaseCheck(repo, {tag})`, `ReleaseCheckOptions`, `ReleaseCheckResult`.

### Borrowed edit: the root `release:check` script (`041a46e66`)

`git status --porcelain package.json` was empty; one line added: `"release:check": "pnpm --filter @openverify/docs-tools release:check"`. `pnpm exec prettier --check package.json`: clean. `pnpm release:check --tag` passes `--tag` through:

```
$ pnpm --filter @openverify/docs-tools release:check --tag
$ node --experimental-transform-types ... src/cli.ts release-check --tag
release:check: not built yet (docs-release)
[ELIFECYCLE] Command failed with exit code 3.
```

## 1. Checkpoint 1: the checklist and its parser (C284.1, KP11-50)

### Stub (`a2483b23f`)

`src/release/markdown.ts` (`splitRow`, `tablesOf`, `sectionOf`, `backticked`), `src/release/checklist.ts` (`parseChecklist`, `planChecklistLines`, `planLineId`, `checklistFindings`, `checkChecklist`, `evidencePathsOf` later) and `src/release/known-items.ts` (`REQUIRED_KNOWN_ITEMS`), typed and answering nothing. `tsc --noEmit` and `eslint src/release` clean.

### RED (`1f8471329`), load 5.13 4.74 3.23

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release --coverage.enabled=false)
 ❯ src/release/markdown.test.ts (8 tests | 5 failed)
     × splits a table row into trimmed cells
     × keeps an escaped pipe and a pipe inside backticks in its cell
     × reads each table with its heading, header and rows
     × returns the lines under a heading down to the next heading of its level
     × returns every backticked span
 ❯ src/release/checklist.test.ts (15 tests | 13 failed)
     × reads both lists of the plan’s Release checklist, and nothing after it
     × reads the real plan: sixteen built lines and nine owner lines
     × reads the facts and every row with its state, evidence paths and date
     × fails a plan line that is missing or worded differently
     × fails a required known item that has no line
     × names every deferred known item of the 11E launch by id
     × marks no line done in 11E that waits on the owner, CI or a later Workflow
     ... (13 of 15)
 Test Files  2 failed | 1 passed (3)
```

Each failed for the intended reason: the stubs read nothing, so no table, no plan line and no checklist line was found; the record test's "committed checklist" cases failed because the committed `docs/release/checklist.md` was contracts-11e's stub and `REQUIRED_KNOWN_ITEMS` was empty.

### GREEN (`9bf45a226`), load 4.61 4.23 3.43

- `docs/release/checklist.md`: the no-iOS preamble; three facts (`As of`, `Release version`, `Shipped flow image`); the plan's 16 built lines (`B01`-`B16`) and 9 owner lines (`O01`-`O09`) word for word; one line per owner decision (`Q1`-`Q12`, `P10-P1`-`P10-P5`); the Phase 7-10 lines (the notice texts `N7A-8`, the web manual pass `A11Y-WEB`, `ESLINT-LOGICAL`, `CLAUDE-WORDING`, `EIGEN-VISION`, `DEVICE-PROOFS`, and contracts-11e's amendment-10 open rows `7C-R010`, `8-R006`, `K8-25`, `K8-32`, `8D-R007`, `EF-CARDSECURITY`, `YUNET-HOST-TEST`); the licence rows (`LIC-TSLIB`, `LIC-NODEMAILER`, `LIC-JUNIT4`, `LIC-LOCUST`); one line per 11D summary-block row that is missed, not measured, invalid or not calibrated, plus the fuzzy-name cap (`11D/<row id>`, 26 lines); and the 63 known items by id (KP11-50).
- States at 2026-11-20: `B02`, `P10-P1`, `P10-P2`, `P10-P3`, `P10-P5`, `11D/fuzzy-name-cap` and `11D/jit-comparison` are `done`; `B10`, `B11`, `O08` and `KP10-59` are `ci-pending`; every other line is `open` or `owner`.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release --coverage.enabled=false)
 Test Files  3 passed (3)
      Tests  25 passed (25)
$ pnpm exec prettier --check src/release/*.ts ../../package.json
All matched files use Prettier code style!
```

### Checkpoint 1 gate (rule 28: the package's typecheck, lint and suite)

- `pnpm --filter @openverify/docs-tools typecheck` (15 s): exit 2, only in another agent's work in flight: `src/catalog/check-catalog.ts(447,27): error TS2339` (docs-catalog). `src/release/` typechecks (`tsc --noEmit` clean before the other agent's change landed).
- `pnpm --filter @openverify/docs-tools lint` (12 s): exit 1, two errors, both outside `src/release/`: `src/catalog/check-catalog.ts:228` and `src/security/threat-model.ts:157` (docs-catalog's and docs-security's work in flight). `eslint src/release`: clean.
- The whole suite, without coverage: every failure is in `src/catalog/`, `src/compliance/`, `src/selfhost/` or `src/security/` (other agents' RED commits), and `src/cli.test.ts`'s "writes nothing for an area its owner has not built" (docs-catalog's area is now built). The wording, vendor-name, metric and docs-tree tests pass over `docs/release/checklist.md`.
- The final gate (section 4) re-runs all of it.

## 2. Checkpoint 2: `pnpm release:check` (C284.2, V01; KP11-47)

### The rules, their modes and their fixtures

Every rule runs in `runReleaseCheck(repo, {tag}, deps)` (`src/release/release-check.ts`); `releaseCheck` is it with the real dependencies (docs-security's `checkSecurity`). An `error` fails both modes; an `owner` finding is an item only the owner, the orchestrator or a later Workflow closes, reported with its state: the default mode exits 0 on it and `--tag` refuses it (the CLI's rule, `src/cli.ts`). The fixture tree is `src/release/release-check.fixtures.ts` (every rule passes in both modes); each test in `src/release/release-check.test.ts` changes one file of it.

| Rule | Reads | Severity | Failing fixture |
|---|---|---|---|
| `checklist-*` (done lines cite evidence that exists; every plan line; every KP11-50 id) | `docs/release/checklist.md`, the plan's "Release checklist" | error | a done line citing `docs/missing.md` |
| `security` | docs-security's `checkSecurity` (threat model, ASVS, MASVS) | error when not built or failing; its owner findings pass through | `not-built`; an injected `evidence` error |
| `gap-row` | `docs/security/asvs-5.0.0-l2.csv`, `masvs-2.1.0.csv` (`status`, `notes`), `threat-model.md` (`status`, `mitigation or owner`) | error | a gap naming no phase, Workflow, next release or finding, in each file |
| `owner-state` | PROGRESS's phase table (Phase 10's row for P1-P5, in prose; Phase 11's row for Q1-Q12; never Phase 9's P1-P9) and `**Qn:**` lines | owner (pending, or missing with the exact line to add) | Q1-Q11 pending, Q12 missing, P4 pending; a `**Q12:**` line; Phase 10's row without its clauses |
| `flow-image`, `p2-dependency` (H20) | P2's state, the checklist's `Shipped flow image` fact, lines saying "depends on Phase 10 P2" | owner; error for a done dependent line | P2 pending with the guidance image; passes with `noguidance` |
| `version` | the root, `@openverify/node`, `@openverify/js`, `@openverify/react` `package.json`, `CLIENT_USER_AGENT`, `Chart.yaml` `version` and `appVersion`, `openverifyVersion`, `android/CHANGELOG.md`'s newest entry, against the checklist's `Release version` | owner with the exact change; error for a missing file, an unreadable version or a changelog entry without its minimum server, minSdk or compileSdk | 0.0.0 against 1.0.0; an undated entry; missing facts |
| `deferral` | the six Deferred sections, C288's carried table, contracts-11e's amendment-10 table, `docs/release/deferrals.md`, PROGRESS's carry forms, PLAN's "Next release" sections | error for a missing or stale placement row, a missing plan or checklist id; owner (orchestrator, the exact line) for a carried or built text PROGRESS does not hold | each case |
| `licence-row` (H19) | `THIRD_PARTY_LICENSES.md` rows reading "owner to confirm" or "pending" | error when not listed on the checklist; owner when listed | an unlisted row; a listed one |
| `verifier-table` (H17) | `docs/release/verified-findings.md` (`| Finding | Severity | Verdict | Fixed | Commits | Summary |`) | owner "pending (11F)" while absent; error (both modes) for a CRITICAL or HIGH neither refuted nor fixed, or a missing header | a plausible HIGH not fixed |
| `medium-advisory` (H14) | the checklist's "Open medium advisories (H14)" table against its `As of` date | owner past 90 days; error for a bad date | a medium 120 days old |
| `staged-run` | `docs/release/staged-run.json` (`openverify/staged-run@1`) with each `openverify/sbom-licence-report@1` result | owner while absent ("staged run pending") or for a report that is not a pass; error when malformed | absent; `image:vision` failing; four malformed records |
| `models-manifest` (KP11-47 (c)) | `models/manifest.json` and `deploy/helm/openverify/files/models-manifest.json` | error when they differ | a changed copy |
| `calibration` (KP11-49) | the three 11D summary blocks (ajv against `contracts/fixtures/calibration/summary.schema.json`) | error when a missed, not-measured, invalid or not-calibrated row has no `11D/<id>` line, or a block is missing | both |
| `checklist-state` | the checklist's states | owner: `owner` and `ci-pending` lines in the default mode; with `--tag` every line not `done` | three lines, both modes |
| notes (checkpoint 3) | `docs/release/notes.md` | error | section 3 |

### Stub and RED (`3d32031de`), load 4.06 4.25 3.81

`release-check.ts` as a stub answering `not-built` with no finding (so contracts-11e's CLI test held), `index.ts` without the rules.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release/release-check.test.ts src/release/index.test.ts src/cli.test.ts --coverage.enabled=false)
     × exits 0 in the default mode and 1 with --tag on an owner item, through the CLI
     × fails a done line whose evidence does not exist
     × fails while docs-security has not built them, and passes its findings through
     × fails a gap that names none, in each of the three documents
     × reports a pending item as owner and a missing one with the line to add
     ... (34 failed)
 Test Files  2 failed | 1 passed (3)
      Tests  34 failed | 16 passed (50)
```

Each failed because the stub found nothing (and answered `not-built` where a test asked for `built`); the base fixture's "passes every rule" cases passed, as they must against a check that finds nothing.

### GREEN (`9838f2b99`), load 4.68 4.44 3.91

The modules `progress.ts`, `deferrals.ts`, `versions.ts`, `licences.ts`, `gaps.ts`, `review.ts`, `staged.ts`, `calibration.ts` and `release-check.ts`; `docs/release/deferrals.md` (89 rows: 35 Deferred items, 26 C288 rows, 28 amendment-10 rows); the checklist gained `LIC-PDFIUM` (the libpdfium row's "owner confirmation pending", which the licence rule found at `THIRD_PARTY_LICENSES.md:251`) and the "Open medium advisories (H14)" table.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release src/cli.test.ts --coverage.enabled=false)
     × answers not built for release:check while docs-release has not filled it
      Tests  1 failed | 72 passed (73)
```

The one failure is contracts-11e's stub-era CLI expectation. Borrowed edit `90d27c8b0` (`packages/docs-tools/src/cli.test.ts`, `git status --porcelain` empty first): the real check now runs over the empty tree and fails with `checklist-missing`. Then 73 of 73.

### `pnpm release:check` on the tree (load 4.21 4.41 3.94)

```
$ pnpm release:check          # 6.6 s
release:check (default): 0 errors, 86 owner items        (exit 0)
$ pnpm release:check --tag
release:check (tag): 0 errors, 176 owner items           (exit 1)
```

The 86 owner items: Q1-Q12 and Phase 10 P4 pending; six version changes (0.0.0 against 0.1.0 in four `package.json` files and `CLIENT_USER_AGENT`; the changelog's undated entry); six PROGRESS lines for the orchestrator (C88's, C110's, C145's, C223's and C286's deferrals, the address key's per-country handling); six licence rows; the verifier's table pending (11F); the staged run pending (KP10-59); and the checklist's owner and CI-pending lines.

## 3. Checkpoint 3: the generated release notes (C284.4; KP11-49)

### What the notes are rendered from

`src/release/notes.ts` (`renderNotes`, `readNotesInputs`, `requiredDisclosures`, `notesFindings`); written only by `pnpm --filter @openverify/docs-tools docs:release` (`renderRelease`). Inputs: the checklist (its facts and states), PROGRESS (Q1-Q12 and P1-P5 states, the "Owner items (defaults taken; nothing blocks)" lists, bulleted or numbered, and the Phase 10 close's "device proof open" lines), the plan's C289 table, the three 11D summary blocks (ajv-validated), `THIRD_PARTY_LICENSES.md`'s pending rows, the five Dockerfiles' runtime bases (`ARG NODE_IMAGE=`, `ARG PYTHON_IMAGE=`, as `release.yml`'s stage job lists them), `docs/release/staged-run.json` (absent: "Staged run pending"), `network/sources.json`'s DB-IP attribution, and `DOCS_SWITCHES.publishWired` (off: "No artifact of this release is signed or attested"). No clock: the date is the checklist's `As of`. Sections: Status (every line not done), Artifacts, signatures and sources, Owner decisions and their outcomes (C289), Licences pending the owner (with KP11-39), Performance and calibration (missed with gaps, not measured, invalid, not calibrated, reverted, and C272's and the list decisions' reported figures, per report with its machine), Lists, Network data, Consent texts, Device proofs open, earlier phases' defaults taken.

The required disclosures (`requiredDisclosures`): `unsigned` (while the publish switch is off), `staged-run` (while no record), `base-sources` and one per runtime base, one per owner item (Q1-Q12, Phase 10 P1-P5), one per 11D row that is missed, not measured, invalid or not calibrated (its whole sentence with the figure, budget and gap), `sface` (Q6), `consent-texts` (C238.10), `list-cap` (`unscreened` with `limit_exceeded`, read from `apps/api/src/services/lists/match.ts:398-410`), `network-data` and `db-ip` (Workflow 7A), one per pending licence row, `KP11-39`, each defaults-taken item and each device proof.

### Stub and RED (`82b845151`), load 6.00 5.01 4.26

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release/notes.test.ts src/release/index.test.ts --coverage.enabled=false)
     × reads C289 from the plan, the runtime bases and the device proofs
     × prints figures the same way every time
     × holds every required disclosure
     × fails a missing file and a stale one
     × fails a notes file that lost a required disclosure
     × are what the area renders, and the area check finds nothing
     × renders the release notes, and nothing else
     ... (12 failed)
 Test Files  2 failed (2)
      Tests  12 failed | 3 passed (15)
```

Each failed because the stub rendered nothing, read no input and found nothing (the committed notes were still contracts-11e's stub).

### GREEN (`46fc33937`)

`pnpm --filter @openverify/docs-tools docs:release` wrote `docs/release/notes.md` (`release: 1 files written`); a second run wrote the same bytes. The first render showed the defaults-taken list empty: PROGRESS numbers those lists (`1. **Case emails** ...`), so `defaultsTaken` reads numbered items too (test-first in the same GREEN, the fixture keeps a bulleted one).

```
$ (cd packages/docs-tools && pnpm exec vitest run src/release src/cli.test.ts src/wording.test.ts src/vendor-name.test.ts src/metrics.test.ts src/docs-tree.test.ts --coverage.enabled=false)
      Tests  131 passed (131)
```

The wording, vendor-name, metric-name and docs-tree tests pass over `docs/release/checklist.md`, `deferrals.md` and `notes.md`; no "Draft: written in Workflow 11E" marker of docs-release's remains.

## 4. The final gate (checkpoint 3, docs-release's last; rule 28's scope)

| Call | Result | Time | Load before -> after |
|---|---|---|---|
| `pnpm --filter @openverify/docs-tools typecheck` | first run exit 2, only `src/security/checklist.ts(99,41)` (docs-security's work in flight); re-run after waiting: exit 0 | 16 s; 13 s | 3.95 -> ; 1.60 -> |
| `pnpm --filter @openverify/docs-tools lint` | exit 0 | 17 s; 15 s | |
| `pnpm --filter @openverify/docs-tools test` (80% gate) | first run exit 1, 3 failures all in `src/catalog/` (docs-catalog's mapping in flight); re-run: exit 0, 385 tests in 48 files, 97.49% statements, 85.42% branches | 27 s; 25 s | 1.60 -> 4.17 |
| `src/release/**` alone with coverage | 97.85% statements, 85.12% branches, 100% functions | 21 s | |
| `pnpm exec prettier --check package.json packages/docs-tools/src/release/*.ts packages/docs-tools/src/cli.test.ts` | clean | | |
| `git status --porcelain docs/api contracts packages/node` | empty | | |
| `pnpm release:check` (default) | exit 0, `release:check (default): 0 errors, 86 owner items` | 7 s | 4.08 -> |
| `pnpm release:check --tag` | exit 1, `release:check (tag): 0 errors, 176 owner items` (as it must be until the owner's items close) | | |

The 86 items `pnpm release:check` reports, by rule (every one the owner's, the orchestrator's or 11F's):

- `owner-state` (13): Q1-Q12 pending (PROGRESS `:18`, Q12 also `:120`), Phase 10 P4 pending (`:17`).
- `version` (6, orchestrator): `package.json:3`, `packages/node/package.json:3`, `packages/sdk-js/package.json:3`, `packages/sdk-react/package.json:3` and `packages/node/src/transport.ts:38` from 0.0.0 to 0.1.0; `android/CHANGELOG.md:5` "## Unreleased" to "## 0.1.0 (<the tag's date>)" at the tag.
- `deferral` (6, orchestrator): add under the next entry's "**Carried forward:**" the lines "- C88's deferrals (phase-6.plan.md), each with its reason", the same for C110 (phase-7), C145 (phase-8), C223 (phase-10) and C286 (phase-11), and "- the address key's per-country handling (lists; LIST_KEYS_VERSION): next release".
- `licence-row` (6, owner): tslib (`THIRD_PARTY_LICENSES.md:118`), nodemailer (`:119`), the libraries compiled into libpdfium.so (`:251`), pvutils, pvtsutils, tslib (`:262`), JUnit 4 (`:682`), Locust (`:766`).
- `verifier-table` (1, 11F): pending (11F).
- `staged-run` (1, orchestrator): staged run pending (KP10-59).
- `checklist-state` (53): every `owner` and `ci-pending` line of the checklist.

Full output: the run above, reproducible with `pnpm release:check`.
