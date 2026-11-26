# TDD evidence: Workflow 4B Stage 1, `calibration` (C49: the face-match calibration; the synthetic-signal scales)

- **Slice owner:** `calibration` (Workflow 4B, Stage 1), in parallel with `surfaces-dashboard`.
- **Date:** 2026-10-21 and 22 (UTC).
- **Input:** `docs/plans/phase-4.plan.md` C48 (the 0.363 thin-margin row), C49, the Workflow 4A Stage 2 amendments (fixtures 6-8; checks-logic 14; vision-integrity open item 5), ADR 0002.
- **Paths:**
  - the fetcher and the calibration tool: `scripts/fetch_fixtures.py`, `services/vision/tools/calibrate_selfie.py` and their tests;
  - the set and its schema: `fixtures/calibration-manifest.json`, `contracts/fixtures/calibration/selfie-calibration.schema.json` (extended as the task allows);
  - the report: `packages/checks/src/calibration/`;
  - the two constants: `FACE_MATCH_DEFAULTS` (`packages/core/src/check-config.ts`) and `SYNTHETIC_SIGNALS` (`packages/checks/src/selfie/synthetic-score.ts`), with the tests outside these paths that pinned 0.363 or its basis;
  - the docs: `docs/calibration/`, the face-match and synthetic-signal paragraphs of `docs/checks/selfie.md`, and the `id_selfie_comparison` threshold sentence of `docs/checks/government-id.md`.
- **Commits:** `8175912..3f5e834` (30 commits), then this file.

Every code change ran the same cycle:
1. A `chore` commit names what the test needs. It does nothing useful, but the RED test then imports, passes mypy and typechecks.
2. The test is run and seen failing for the intended reason (RED).
3. The smallest change makes it pass (GREEN).

All commands ran after `source scripts/env.sh`: Python in `services/vision` with `COVERAGE_FILE=/tmp/openverify-cov-calibration` and mypy's `--cache-dir /tmp/openverify-mypy-calibration`, iterating with `--no-cov`. Output is trimmed to the lines that matter.

## 1. The harvest: `--harvest-calibration` (C49.1)

Stub `8175912`, RED `ed004e7`, GREEN `fefd27c`.

The tests (`tests/test_fetch_fixtures_harvest.py`) run the script against a fake of the two APIs and the upload server (`CommonsWorld`). The fake answers the way formatversion 2 does, continuation included, and is served through the script's own `PoliteOpener` on a fake clock. The covered rules:
- the licence templates;
- the year from the date field, else the inception;
- a person as a human item, or as a category item's single main topic;
- a file's one identity, from depicts and categories that agree;
- the spread under the five-photo cap;
- the whole harvest: the manifest that `load_calibration_manifest` accepts, the pinned bytes, no Wikidata id in the manifest, each reason a file was left out;
- the walk depth;
- the etiquette: `maxlag` on every request, at least 1 s between starts, a lagged answer retried, 25 Mbps pacing;
- a second harvest reusing its downloads;
- the command line.

```text
$ uv run --frozen pytest tests/test_fetch_fixtures_harvest.py --no-cov -q
E       AssertionError: assert None == 'PD-USGov-NASA'          # licence_template_of stub
E       assert None == 2009                                     # year_of stub
E       AssertionError: assert None == 'Q1'                     # identity_of stub
E       assert [] == [2000, 2002, 2004, 2005, None]             # spread stub
E       assert 0 == 26                                          # harvest_calibration stub
E       assert 2 == 0                                           # --harvest-calibration not wired
30 failed, 17 passed in 0.88s
```

The first GREEN run had one failure: a duplicate SHA-1 kept "Alpha 2009 copy", because titles were sorted in title order. The rule became "the earliest file page keeps the SHA-1", which is what the test meant.

```text
$ uv run --frozen pytest tests/test_fetch_fixtures_harvest.py tests/test_fetch_fixtures.py tests/test_fetch_fixtures_calibration.py tests/test_fetch_fixtures_polite.py --no-cov -q
215 passed in 3.73s
$ uv run --frozen ruff check ../../scripts/fetch_fixtures.py && uv run --frozen ruff format --check ../../scripts/fetch_fixtures.py && uv run --frozen mypy ../../scripts/fetch_fixtures.py
All checks passed! / 1 file already formatted / Success: no issues found in 1 source file
```

### Live defect: HTTP 414 (stub `f61383f`, RED `2c3e020`, GREEN `52e75af`)

The first live dry run failed on a real Commons answer: `fetch_fixtures.FetchError: https://commons.wikimedia.org/w/api.php: HTTP 414 URI Too Long`. A batch of 50 long, percent-encoded titles had exceeded the URL limit. A probe found the limit: a 6,888-character URL got 200, 7,988 got 200, and 8,888 got 414. The fake world now refuses URLs over 8,000 characters, and 60 long non-ASCII titles reproduce the failure.

```text
E           fetch_fixtures.FetchError: https://commons.wikimedia.org/w/api.php: HTTP 414 URI Too Long
1 failed, 47 passed in 1.18s
```

GREEN batches titles so each URL stays within 7,000 characters (`_url_batches`): 216 passed.

## 2. The measurement: `calibrate_selfie.py` (C49.1, C49.2)

Stub `9d16845`, RED `0532881`, GREEN `e4b28f6`.

**What the tests cover:**
- `review.genuine_pairs_before`: the genuine pairs of the same rules without the pinned review exclusions;
- `genuine_cues.portraits`: every kept portrait scaled to a 2,000-px long side (`portrait_upload`, re-encoded as JPEG q95 when scaled);
- `genuine_cues.re_encodings`: the 45 re-encodings of vision-integrity's 4A stability test (`re_encodings`: three sizes, five encodings);
- no ITA angle for grey cheeks (`ACHROMATIC_CHROMA`).

The stub analyser now also answers centre-only analyses: a portrait by its digest, a re-encoding with one fixed answer. `run()` passes a faces set of seeded noise JPEGs.

**No embedding on disk.** `test_no_embedding_is_written_anywhere` and `test_the_run_writes_nothing_beside_its_output` assert that the tool writes no embedding and nothing beside its output. The new cue path runs inside them too.

```text
$ uv run --frozen pytest tests/test_calibrate_selfie.py --no-cov -q
E       AssertionError: assert 'review' in {'schema_version': 1, ...}
E       AssertionError: assert 'genuine_cues' in {'schema_version': 1, ...}
E       AssertionError: assert [] == ['1280 px, q9...q75 then q90']
E       AssertionError: assert b'\x89P' == b'\xff\xd8'
E       assert 90.0 is None
6 failed, 20 passed in 5.95s
```

The first GREEN run failed the schema check (`$: unexpected 'review'`, `unexpected 'genuine_cues'`). The schema gained both sections as optional, because older documents and the sample stay valid:

```text
$ uv run --frozen pytest tests/test_calibrate_selfie.py tests/test_calibrate_selfie_real.py tests/test_selfie_fixtures_real.py --no-cov -q
38 passed in 91.70s
```

## 3. The report: the selfie mode (C49.2)

Stub `bb7a336`, RED `d23f14d`, GREEN `fd4b07a`. Then RED `f35f24a` and GREEN `74b9e6b` for the SFace row.

**What the report gains:**
- FRR before and after the review, at fixed thresholds, each bootstrapped over the same identities;
- the FAR 1e-3 threshold's own 95% bootstrap interval, and where the shared default lies against it (the C49.3 section);
- the 1:N floor sentence;
- the genuine cues with p1 and p99, labelled "studio portraits, scaled to a 2,000-px long side: a false-positive proxy, not a selfie measurement";
- each synthetic scale against the genuine tail (p99, max under 100 values; p1 or min for the landmark distance), labelled "genuine-only distribution; detection rate unmeasured";
- SFace's published 0.363 in its own row (basis `upstream`), outside the 1:N table: the C48 thin-margin row.

The first RED attempt did not typecheck (`Property 'review' does not exist on type 'SelfieCalibrationReport'`). That is why the stub came first.

```text
$ pnpm --filter @openverify/checks exec vitest run src/calibration/selfie-report.test.ts --coverage.enabled=false
AssertionError: expected null to match object { excludedImages: 1, …(3) }
AssertionError: expected '# Face-match calibration (Phase 4, C4…' to match /FRR before the review cannot be compu…/
AssertionError: expected '# Face-match calibration (Phase 4, C4…' to match /\| 1e-3 \| 0\.4101 \([-0-9.]+ to [-0-…/
AssertionError: expected '# Face-match calibration (Phase 4, C4…' to match /## The shared 1:1 threshold \(C49\.3\)/
AssertionError: expected undefined to match object { n: 150, min: +0, max: 2.98 }
AssertionError: expected [] to deeply equal [ 'spectral_tail_deviation', …(4) ]
AssertionError: expected '# Face-match calibration (Phase 4, C4…' to contain 'Domain: studio portraits, scaled to a…'
Tests  7 failed | 12 passed (19)
--- GREEN
Tests  39 passed (39)
--- the SFace row, RED then GREEN
AssertionError: expected [ [ …(2) ], [ …(2) ], [ …(2) ] ] to deeply equal [ [ …(2) ], [ …(2) ], [ …(2) ], …(1) ]
AssertionError: expected { …(4) } to match object { threshold: 0.363 }
Tests  2 failed | 18 passed (20)
Tests  40 passed (40)
```

## 4. The set, the fetch, the first review and the rule fix (C49.1)

**The pre-registered rules.** These were recorded in this slice's notes before any calibration score existed:
- the C49.3 decision rule: inside the FAR 1e-3 interval, stay; above it, stay, because no margin covers the selfie-against-ID domain; below it, move up to its upper end rounded up to three decimals, `calibrated`;
- the review counts: the 30 lowest genuine and 30 highest impostor pairs, shuffled (seed 49), without scores;
- the `SYNTHETIC_SIGNALS` rule of item 7.

**Etiquette.** The harvest ran the same `harvest_calibration` code as the command line, through a scratch driver that cached the same day's API answers outside the repository, so the Commons and Wikidata APIs were queried once per distinct request. The downloads were live, through the fetcher's polite opener.

**The first harvest:**
- 11,240 files in the categories (three levels down), 707 identities and 1,843 originals (3.98 GB); every download was verified, with 0 failures;
- committed as `440d5cf`;
- `fetch_fixtures.py --calibration` with three files removed: `p0007-2`, `p0350-1` and `p0700-2` downloaded, the other 1,840 present, `calibration: used 1843 of 1843 images (0 missing, deleted on Commons; 0 failed)`, exit 0.

**The first pass** (`--skip-provisional`): 707 identities, 1,756 images, 1,611 genuine and 249,571 impostor pairs, 87 excluded, in 5 min 43 s.

**The first review** found systematic grouping errors, from metadata alone:
- one "identity" was five officials, because a category for an administration's personnel had been read as naming its president;
- group photos whose depicts lists one person ("Group portrait photographs with 6 persons", "5 men and 1 woman", "2 men in ...");
- two-person portraits whose second person sits three category levels down;
- a title naming three people.

The rules were tightened test-first: stub `e9bb056`, RED `d44686a`, GREEN `9ddc7e8`. In the same commits one fake file was renamed from "Alpha and Echo" to "Alpha meets Echo", so that it still tests two depicted people rather than the new title rule.

```text
E       AssertionError: assert frozenset() == {'Q2'}            # "<Name> in June 1990", three levels up
E       KeyError: 'several_people'
2 failed, 47 passed in 0.53s
--- GREEN
217 passed in 3.72s
```

**The four-level walk.** It climbed the whole generic category tree: a dry run made 1,675 live requests in 30 minutes, before my own timeout stopped it. RED `b9e398c`, GREEN `402b682`: the walk follows only ancestors that may name the person (named in the category, or the same first word unless that is a year or a generic word). The prune affects only which ancestors are fetched; whom a category names is decided as before.

```text
E       AssertionError: assert 'Category:1990 portraits' not in {'', 'Category:1990 portraits', ...}
1 failed, 49 passed in 0.55s
--- GREEN
218 passed in 3.65s
```

**The re-harvest** (`1e6e99c`): 229 live API requests for the new batches, and 43 new downloads.
- Result: 707 identities and 1,832 originals, `calibration: used 1832 of 1832 images`.
- Every grouping error the first review found is gone; the depicts misattribution is left for the review.
- My first-harvest image links and previews were moved, not deleted, to `fixtures/faces/calibration/.previous/` (gitignored).

**The second pass:** 707 identities, 1,744 images, 1,575 genuine and 249,571 impostor pairs, 88 excluded.

**The second review** (`9fb5842`) covered 60 pairs and 107 photos: 106 kept and 1 excluded as `misattribution`. That photo's depicts names one general, while its title and caption name another, pictured with two other people. The identical twins stay as two identities.

## 5. The final measurement and the report

```text
$ uv run --frozen python tools/calibrate_selfie.py
wrote fixtures/generated/calibration/selfie-measurements.json: 707 identities, 1743 images, 1574 genuine and 249571 impostor pairs, 89 excluded
real 16m6.9s
$ pnpm --filter @openverify/checks calibration:report --selfie
wrote docs/calibration/selfie-phase4.md: 251145 pairs, 707 identities      (61 s; seed 49, 1,000 replicates)
```

Measured on studio portrait pairs, with two-sided 95% bootstrap intervals over identities:

| Threshold | FAR | FRR |
|---|---|---|
| FAR 1e-3 point: 0.3862 (0.3796-0.3937) | 9.94e-4 (7.70e-4-1.24e-3) | 0 (0-0) |
| FAR 1e-4 point: 0.4364 (0.4248-0.4478) | 9.62e-5 (3.61e-5-1.73e-4), resolvable | 1.27e-3 (0-4.26e-3) |
| SFace's published 0.363 | 2.40e-3 (1.99e-3-2.87e-3) | 0 (0-0) |
| the calibrated 0.394 | 7.57e-4 (5.62e-4-9.87e-4) | 0 (0-0) |
| `selfie_repeat_detection` 0.5 | 4.01e-6 (0-2.41e-5) | 9.53e-3 (3.87e-3-0.0163) |

The rule-of-three FRR floor is 1.91e-3 (3 / 1,574), and the FAR floor 1.20e-5. FRR before and after the review: 6.35e-4 against 0, with one genuine pair removed.

## 6. `FACE_MATCH_DEFAULTS` 0.363 to 0.394, calibrated (C49.3)

RED `a31ab3e`, GREEN `4ca1537`.

0.363 lies below the FAR 1e-3 interval, so the pre-registered rule moves the default to 0.394. Every test that pinned the old default or its `provisional` basis moved with it, in the RED commit:
- the core tests;
- `face-match`, `history`, `selfie-id-comparison` and `selfie-similar-background-detection` in checks;
- `selfie-contract` and `process-verification` in the API;
- the two real-model vision constants that mirror `FACE_MATCH_DEFAULTS`.

```text
core:   Tests 3 failed | 90 passed (93)   expected 0.363 to be 0.394; threshold 0.393: expected true to be false
checks: 6 failed                          expected 0.363 to be 0.394 (x2); history (x2); basis 'calibrated' (x2)
api:    Tests 2 failed | 80 passed (82)   expected 0.363 to be 0.394
--- GREEN
core 93 passed, checks 59 passed, api 82 passed
```

## 7. `SYNTHETIC_SIGNALS` against genuine photos (item 7; 4A vision-integrity open item 5)

RED `618e55a`, GREEN `075a7f6`, refactor `a50ac84` (wording of one basis).

The genuine tails are the 99th percentile of the portraits and the re-encodings together: spectral tail 3.7036, residual peak 1.9774, noise 0.6889, JPEG grid 0.2638, and a 1st percentile of 0.22 for the landmark distance. The tests hold these as constants, never images. Three clear levels flagged genuine photos; each moved to its tail, rounded outward, keeping its ramp width and weight:
- spectral tail: 0.25/1 becomes 3.71/4.46;
- noise inconsistency: 0.25/0.75 becomes 0.69/1.19;
- JPEG grid: 0.25/1 becomes 0.27/1.02.

Two existing cases in `synthetic-score.test.ts` used noise values on the old scale. Their inputs moved, 0.75 to 1 and 0.5 to 0.94, so they still test the strongest cue and the coverage.

```text
AssertionError: spectral_tail_deviation: expected 0.25 to be greater than or equal to 3.7036
AssertionError: expected [ [ …(4) ], …(4) ] to deeply equal [ [ …(4) ], …(4) ]
Tests  4 failed | 9 passed (13)
--- GREEN
$ pnpm --filter @openverify/checks exec vitest run src/selfie --coverage.enabled=false
Tests  202 passed (202)
```

## 8. Final gates

```text
$ pnpm --filter @openverify/checks test     Tests 1328 passed; All files 98.96 / 89.69 / 99.65 / 98.89
$ pnpm --filter @openverify/core test       Tests 569 passed;  All files 100 / 98.82 / 100 / 100
$ (cd services/vision && uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-calibration && COVERAGE_FILE=/tmp/openverify-cov-calibration uv run --frozen pytest)
All checks passed! / 156 files already formatted / Success: no issues found in 59 source files
TOTAL 7242 9 1130 7 99%; Required test coverage of 80% reached. Total coverage: 99.81%; 1862 passed in 314.05s
(and ruff, ruff format --check and mypy on scripts/fetch_fixtures.py: clean)
$ pnpm typecheck && pnpm lint && pnpm format:check
Tasks: 12 successful, 12 total / Tasks: 12 successful, 12 total / All matched files use Prettier code style!
$ pnpm test                                  12 packages, 9,424 tests, every package at or above 80% (4 min 44 s):
  api 2449, dashboard 1805, contracts 1405, checks 1328, flow 712, db 678, core 569, node 212,
  flow-spec 88, e2e harness 79, ui 54, config 45
$ flock /tmp/openverify-e2e.lock pnpm e2e    mocked flow 38 passed; full stack 50 passed (6.8 min); exit 0
  person A document similarity 0.679-0.680, person B 0.147 (against 0.394)
$ git status --porcelain                     (empty)
```
