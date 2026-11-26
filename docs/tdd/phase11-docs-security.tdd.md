# Phase 11, Workflow 11E: docs-security (C273, C274, C275) — TDD evidence

Agent `docs-security` (Workflow 11E, Stage 2), beside five other document agents. Start
`247f6af3c` (11E's start), base `aa00b57bb`; Stage 1a ended at `2952f2a84` (contracts-11e
checkpoint 3). Every command ran from the repository root after `source scripts/env.sh` unless it
says otherwise; the load average (`cat /proc/loadavg`, 1-minute figure) is written beside each
timing. No CI run is counted on (rule 25); nothing was pushed.

Owned paths: `docs/security/threat-model.md`, `docs/security/asvs-5.0.0-l2.csv`,
`docs/security/asvs-summary.md`, `docs/security/masvs-2.1.0.csv`,
`packages/docs-tools/src/security/` and this file. The id lists
(`docs/security/asvs-5.0.0-l2-ids.txt`, `masvs-2.1.0-ids.txt`) are contracts-11e's inputs, read
only.

## 0. Inputs read

The plan's C273-C275 and their neighbours (C230-C272, C276-C289), "## Workflow 11E", the Rules,
"Tests, evidence and validation", the 11A-11D amendment sections, "Orchestrator decisions before
Workflow 11E" and "Workflow 11E Stage 1a amendments (contracts-11e)"; inventory section 2 (11B) and
section 5 (11E); `docs/research/phase11-hardening.md` sections 3 and 4 (the 46 first-pass rows and
ASVS by chapter); the Phase 7 plan's Risks table; `docs/flow/handoff.md`, `docs/network/README.md`,
`docs/workflows/evaluate-code.md`, `docs/cases/attachments.md` and `export.md`; and the code each row
cites. The ASVS 5.0.0 and MASVS v2.1.0 exports were fetched for reading only
(`python3 -I scripts/fetch_asvs.py`, `python3 -I scripts/fetch_masvs.py`, into the git-ignored
`data/standards/`); no requirement or control text is committed (C274.2, C275.2).

## 1. The threat model and its parsing test (checkpoint 1)

### Stub (`1da79a3b8`)

`packages/docs-tools/src/security/threat-model.ts`: the frozen shapes (`ThreatRow`, `NotApplicable`,
`AcceptedRisk`, `ThreatModel`, `STRIDE_LETTERS`, `THREAT_STATUSES`, `THREAT_MODEL_PATH`) and typed
constants that answer nothing, so the RED test compiles and typechecks.

### RED (`5f324b622`)

`packages/docs-tools/src/security/threat-model.test.ts`: a two-boundary fixture model that passes
every rule, one fixture per rule (stride coverage, a "not applicable" line beside a row, status,
letters, boundary, id prefix, unique ids, control evidence, dead paths, gap owner, accepted rows
and their monitoring, an empty document), and the committed document (every rule passes; B1-B14
and BX in the boundaries table; every one of hardening 3.2's 46 ids re-taken; B13 with at least 18
rows over all six letters).

```text
$ (cd packages/docs-tools && pnpm exec vitest run src/security/threat-model.test.ts --coverage.enabled=false)
     × reads the boundaries table
     × reads every row of every table with its line, letters split
     ...
     × designs Connect (B13) fully: at least eighteen rows over all six letters
 Test Files  1 failed (1)
      Tests  17 failed | 2 passed (19)
```

The two that passed are the two "no findings" assertions, which a stub answering `[]` meets; every
other test failed on the stub's empty answers (the intended reason). `tsc --noEmit` exit 0;
`eslint src/security` exit 0 (after the stubs were written as typed constants, which leave no
unused parameter); `prettier --check` clean.

### GREEN (`dea428ad1`)

- `threat-model.ts`: `parseThreatModel` (the boundaries table `| boundary | what crosses it |`,
  every table with C273.1's header, the `- <boundary> <letter>: not applicable because <reason>`
  lines, the accepted-risks table `| risk | rows | monitoring |`), `pathsCitedIn` (backticked
  tokens with a `/`, not starting with one, ending in a directory `/` or a known file name; a
  `:<line>` or `:<from>-<to>` suffix is dropped by `withoutLineSuffix`, written without a regular
  expression after `eslint-plugin-security` flagged the first one), `evidencePathExists` (a file,
  or a directory holding files), `threatModelFindings` (rules `boundaries`, `rows`, `boundary`,
  `id`, `unique-id`, `stride`, `status`, `control-evidence`, `evidence-path`, `gap-owner`,
  `stride-coverage`, `not-applicable-covered`, `accepted-risks`, `accepted-monitoring`).
- Two fixture expectations were corrected while going GREEN, each because the rule found a second,
  real consequence of the same edit: replacing `T, I` by `T, X` also leaves B1 without `I`
  (`stride-coverage`), and listing `B1-D1` instead of `B1-S1` as an accepted risk both omits an
  accepted row and lists a row that is not accepted (two `accepted-risks` findings).
- `docs/security/threat-model.md`: written one boundary group per edit (rule 15): end-user clients
  (B1, B2, B11), customers and operators (B3, B4), processing (B5, B6, B12), data stores (B7, B8,
  B9), outbound (B10), Connect (B13), supply chain and cross-cutting (B14, BX), then the accepted
  risks and what the model does not cover. Every evidence path was checked by the test itself; the
  metric names by the API suite's `metrics-documents.test.ts`.

```text
$ (cd packages/docs-tools && pnpm exec vitest run src/security --coverage.enabled=false)    # load 2.85 -> 2.79, 2 s
 Test Files  2 passed (2)
      Tests  21 passed (21)
$ (cd apps/api && pnpm exec vitest run src/metrics-documents.test.ts --coverage.enabled=false)
      Tests  5 passed (5)
```

### checkSecurity (`c48cc3629` RED, `0bf43c9f1` GREEN)

`src/security/index.test.ts` replaced contracts-11e's stub test: `checkSecurity` returns a built
`threat-model` check that reports a missing file as `missing` and finds nothing in the committed
model. RED: 2 failed (the stub answered one `not-built` result named `security`). GREEN:
`checkThreatModel` and `checkSecurity` in `index.ts`; `renderSecurity` stays `not-built` until
checkpoint 2 brings the summary.

### The model's counts at checkpoint 1

172 rows over B1-B14 and BX (control 122, operator 22, accepted 16, gap 12, before the review of
checkpoint 3), and nine "not applicable because" lines (B2 R, B6 R, B8 R, B9 R, B12 R; BX S, T,
R, E).

### Gate (rule 28, parallel gates: what docs-security touched)

- `pnpm exec tsc --noEmit` (packages/docs-tools): exit 0. `pnpm exec eslint src/security`: exit 0.
  `pnpm exec prettier --check packages/docs-tools/src/security/`: clean.
- The whole docs-tools suite without coverage (load 3.01): 241 passed, 3 failed, every failure in
  another agent's work in flight (`src/records/crypto-inventory.test.ts` and
  `src/records/index.test.ts`, docs-records; `src/selfhost/index.test.ts`, docs-selfhost); the
  wording, vendor-name and metric-name tests pass over the threat model.

Checkpoint 1 is `7f8ece65a` ("docs(security): Workflow 11E docs-security checkpoint 1 (threat
model)").

## 2. The ASVS and MASVS checklists, their evidence test and the summary (checkpoint 2)

### Stubs

`src/security/checklist.ts`, `summary.ts`, `staleness.ts` and `checkSecurityWith` in `index.ts`,
typed constants answering nothing, so the RED tests compile. The exports carry security-specific
names (`parseSecurityChecklist`, `securityChecklistFindings`, `SecurityChecklistRow`,
`staleChecklistRows`, `parseStandardIdList`, ...) because `src/index.ts` re-exports every area with
`export *`, and a generic name could collide with another area's.

### RED

`checklist.test.ts` (the id-list parser; the CSV parser and its header rule; `isTestEvidence`; one
fixture per rule: `missing-id`, `extra-id`, `order`, `duplicate-id`, `level`, `status`,
`evidence-path`, `met-evidence`, `reason`, `gap-owner`, `threat-id`, `reviewed-at`,
`reviewed-commit`, `metric-name`; the skeleton; and the committed CSVs: exactly 253 and 24 ids,
every rule passing, V17, V4.3 and V4.4 not applicable, V9, V10.2, V10.5 and V6.8 applied to the
console's OIDC client), `summary.test.ts` (counts per chapter and group, the operator, gap and review
lists, determinism, the wording rule), `staleness.test.ts` (a fake history; a fixture git repository
made with `git init` in a temporary directory, never the working tree) and `index.test.ts`
(`checkSecurity` adds `asvs` and `masvs`; `renderSecurity` renders the summary and the committed one
equals a fresh render; `checkSecurityWith` adds two staleness checks with owner findings only).

```text
$ (cd packages/docs-tools && pnpm exec vitest run src/security --coverage.enabled=false)
 Test Files  4 failed | 1 passed (5)
      Tests  30 failed | 20 passed (50)
```

Every failure was a stub's empty answer (the intended reason); the 20 that passed are the threat
model's 19 and one index case. `tsc --noEmit` and `eslint src/security` exit 0.

### How the CSVs were made

Generated by code from the committed id lists, then annotated (C274.1): a scratch script outside the
repository read `docs/security/asvs-5.0.0-l2-ids.txt` and `masvs-2.1.0-ids.txt`, joined each id with
our status, evidence, notes and threat ids, and wrote the two CSVs with Python's `csv` module (it
refused to write while any committed id lacked an annotation or an annotation named an id the list
does not hold). Each status was set from the code and tests read at `7f8ece65a`
(`reviewed_commit`), never from C274.4's targets (review H15). No requirement or control text is in
either file; the notes are our words. `securityChecklistSkeleton(ids, date)` in `checklist.ts` is the
committed way to start a checklist for a new version (every id at `gap`).

### GREEN (`1b5d9cc2f`)

- `checklist.ts`: `parseStandardIdList`, `parseSecurityChecklist` (`csv-parse`, C274.1's header),
  `isTestEvidence` (a test file of any suite: `*.test.ts(x)`, `*.spec.ts`, `test_*.py`, `*Test.kt`,
  `*.test.sh`, helm-unittest's `*_test.yaml`), `securityChecklistSkeleton` (`csv-stringify`) and
  `securityChecklistFindings`.
- `summary.ts`: `renderAsvsSummary`, the page from the two CSVs only (no clock, no git).
- `staleness.ts`: `staleChecklistRows`, `createGitEvidenceHistory` (`git diff --name-only
  <commit>..HEAD -- <paths>`; a commit the repository does not hold makes every cited file count as
  changed) and `stalenessCheck` (rule `stale-evidence`, severity `owner`).
- `index.ts`: `renderSecurity` is built (the summary); `checkSecurity` adds the `asvs` and `masvs`
  checks; `checkSecurityWith(repo, {history})` adds `asvs-staleness` and `masvs-staleness`.
- `pnpm --filter @openverify/docs-tools docs:security` wrote `docs/security/asvs-summary.md`
  ("security: 1 files written").

```text
$ (cd packages/docs-tools && pnpm exec vitest run src/security --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  50 passed (50)
$ (cd packages/docs-tools && pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>/coverage-sec2)   # load 5.62 -> 7.14, 24 s
 Test Files  47 passed (47)
      Tests  380 passed (380)
All files          |   97.53 |    85.35 |   98.52 |   97.48 |
 src/security      |   99.69 |    90.04 |     100 |   99.66 |
```

The package script's own `pnpm test` refused to start once because another agent's Vitest held
`packages/docs-tools/coverage/` (Vitest's reports-directory lock), so the gate ran with its own
`--coverage.reportsDirectory` (owner decision 16 after 7B).

### The counts at checkpoint 2

| ASVS chapter | met | partial | gap | not_applicable | operator | total |
|---|---:|---:|---:|---:|---:|---:|
| All (V1-V17) | 141 | 45 | 7 | 51 | 9 | 253 |

| MASVS | met | partial | gap | not_applicable | operator | total |
|---|---:|---:|---:|---:|---:|---:|
| All (8 groups) | 12 | 8 | 0 | 3 | 1 | 24 |

The per-chapter and per-group tables are `docs/security/asvs-summary.md`.

### Gate (rule 28)

`tsc --noEmit` exit 0 for the package (one error in another agent's uncommitted
`src/_probe.ts` was seen while it was in flight and is not in this area); `eslint src/security`
exit 0; `prettier --check packages/docs-tools/src/security/` clean; the whole docs-tools suite above
(380 passed, 97.53% statements).

Checkpoint 2 is `3ec17b7a5` ("docs(security): Workflow 11E docs-security checkpoint 2 (ASVS)");
docs-selfhost's hardening checklist reads the operator rows from it.

## 3. The review (checkpoint 3)

A full read of both checklists against the threat model and the code at `7d813b436` (the HEAD when
the review ended; `date +%F` 2026-11-20), with every row's `reviewed_at` and `reviewed_commit` set
to it and the summary re-rendered. What the review changed:

- **Status from evidence that now exists** (docs-records' checkpoints 2 and 3, `ca2f3cf52` and
  `b676b3cc4`, with their record tests passing): `v5.0.0-11.1.1`, `11.1.2` (the crypto inventory),
  `14.1.1`, `14.1.2` (the data classification), `15.1.1` (the vulnerability policy), `16.1.1`,
  `16.2.3` (the logging inventory), each `partial` to `met`; `13.1.1` `partial` to `met` (the
  self-hosting requirements and the compliance guide's recipients, `recipients.test.ts`).
- **Status from a missing test:** `v5.0.0-15.3.5` `met` to `partial` (no test asserts TypeScript's
  strict mode; the forced typecheck is a check, not a test file).
- **Evidence corrected:** `3.4.2` cites the flow CORS test (`routes/flow/one-time-links.test.ts`),
  `3.3.2` the MFA challenge cookie's test, `6.5.4` the recovery codes' 60 random bits.
- **KP11-45's ASVS facts:** `7.3.1` names the idle timeout's per-instance clock (B4-S8), `7.1.3` the
  deprovisioning lag (B4-S7), `6.8.2` the forced token-endpoint signature check, `16.4.2` the audit
  retention function's caller-stated time (B3-R4), and `2.4.1` and `16.3.4` name
  `metric: rate_limiter_store_unavailable` (registered; the API suite's `metrics-documents.test.ts`
  passed over the CSV).
- **Threat model:** B10-I5 restated from `docs/workflows/messaging.md` (email only to confirmed
  addresses or an allowlist, SMS to a confirmed number, Slack to a `hooks.slack.com` secret, links to
  allowlisted hosts; the first draft said messages never carry data, which the workflow messaging
  actions do not promise); B11-D1 names the chip exchange's 5 s timeout; the header records the
  review. No row changed status, so the accepted-risks table is unchanged.
- **Operator rows:** no status changed to or from `operator`. One operator row's note changed
  (`v5.0.0-16.4.2`), which docs-selfhost's generated hardening checklist quotes; its committed page
  already matched the reviewed CSV when this checkpoint's suite ran (43 selfhost tests passed).

### C274.6's staleness in the real tree

`checkSecurityWith(repo, {history: createGitEvidenceHistory(repo.root)})`, run once by a scratch
script outside the repository right after the review: `asvs-staleness` 0 findings,
`masvs-staleness` 0 findings. From now on a commit that changes a cited file makes the rows citing
it `stale-evidence` owner findings; the docs-tools suite never reads the moving HEAD (the summary
holds no staleness, and the tests use a fake history and a fixture repository).

### Final counts

- Threat model: 172 rows (control 122, operator 22, accepted 16, gap 12) and 9 "not applicable
  because" lines.
- ASVS 5.0.0 L2 (253): met 148, partial 38, gap 7, not_applicable 51, operator 9 (per chapter in
  `docs/security/asvs-summary.md`).
- MASVS v2.1.0 (24): met 12, partial 8, gap 0, not_applicable 3, operator 1.

### Final gate (the last checkpoint: what docs-security touched, rule 28)

| Call | Result | Seconds | Load (1 min) |
|---|---|---:|---|
| `pnpm --filter @openverify/docs-tools typecheck` | exit 0 | 30 | 7.35 -> 8.29 (with lint) |
| `pnpm --filter @openverify/docs-tools lint` | exit 0 | 20 | (as above) |
| `(cd packages/docs-tools && pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>/coverage-sec4)` | exit 0: 47 files, 381 tests, 97.54% statements (src/security 99.69%) | 38 | 7.90 -> 8.85 |
| `pnpm exec prettier --check packages/docs-tools/src/security/` | clean | 1 | 8.30 |
| `git status --porcelain docs/api contracts packages/node` | empty | 0 | 8.30 |
| `python3 -I scripts/fetch_asvs.py --verify-ids && python3 -I scripts/fetch_masvs.py --verify-ids` | exit 0: 253 and 24 ids match the exports | 1 | 8.30 |
| `(cd apps/api && pnpm exec vitest run src/metrics-documents.test.ts --coverage.enabled=false)` | 5 passed (the threat model and the ASVS CSV name only registered metrics) | 1 | 8.30 |

The package's own `pnpm test` (the same Vitest call with the default `coverage/` directory) collides
with any other agent's coverage run in that directory, so the gate gives the run its own reports
directory, as owner decision 16 after 7B asks. One earlier full run in this checkpoint (load 7.79)
failed one test in docs-selfhost's area (`src/selfhost/index.test.ts`, the hardening checklist's
fresh render) while that agent's render was in flight; re-run after its commit, the selfhost tests
(43) and the whole suite passed.
