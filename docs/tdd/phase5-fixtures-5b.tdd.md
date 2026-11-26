# TDD evidence: Workflow 5B Stage 2, `fixtures-5b` (Phase 5)

- **Slice owner:** the Workflow 5B Stage 2 `fixtures-5b` agent, in parallel with `vision-document`, `checks-5b`, `emrtd` and `clients-5b` (disjoint paths).
- **Date:** 2026-10-23 (local), 2026-10-24 (UTC).
- **Base:** `2d3839f5` (Workflow 5B Stage 1); this slice's commits run from `5a3d8a69` to the commit that adds this file.
- **Input:** the plan's `fixtures-5b` bullet: C65.2 (the proof-of-address fixtures, the hostile set, a JSON sidecar per file), C60.7 (the held-out set, with the blank US federal forms of decision 18), and C65.3's two inputs (person A's portrait as JP2, the synthetic TD3 page with its MRZ sidecar). Owned paths: `services/vision/tools/{synthetic_poa,synthetic_travel,make_synthetic_fixtures}.py` and their tests, `fixtures/manifest.json`, `scripts/fetch_fixtures.py`.

Each unit follows one cycle: a stub (`chore`) so the RED commit imports and passes mypy; the tests, seen failing for the intended reason (RED, `test`); the smallest change that passes them (GREEN, `feat`). All commands ran after `source scripts/env.sh`, from `services/vision` unless shown, with `COVERAGE_FILE=/tmp/openverify-cov-fixtures-5b … --no-cov` while iterating. Output is trimmed to the lines that matter.

Everything generated is synthetic (C65.1): invented people (Nora Calderwood, the synthetic ID card's holder; Inés Marlasca Ribó; the held-out set's eight others), invented issuers ("Utopia Water Board", "Banco de Utopía"…), unassigned postal codes (US ZIP 000xx, Spanish 53xxx and above, French and German 00xxx), `.example` domains, `(555) 01x-xxxx` numbers, masked or area-000 taxpayer numbers, EINs with the unassigned prefix `00`, and seeds derived from each file's path. Every generated page prints "OpenVerify synthetic test document". The only real documents are the three blank IRS forms (public domain, 17 U.S.C. 105), filled with synthetic values. Nothing generated or downloaded is committed (`fixtures/generated/` is gitignored).

**Exploration before the tests** (a scratch prototype, never committed): a hand-written PDF read by strict pypdf and PDFium; WinAnsi Spanish text extracted exactly; a ToUnicode remap honoured by PDFium's text layer; render mode 3 visible to `FPDFTextObj_GetTextRenderMode`; a shifted xref reported by `FPDF_DocumentHasValidCrossReferenceTable`; pypdf incremental writes keeping the original bytes as a prefix; RC4-128 encryption working without `cryptography`; a one-page Annex F linearized layout that `FPDFAvail_IsLinearized` calls linearized; the W-2's widgets read by their qualified names. pypdf's form flattening drew empty, zero-size appearances for the IRS forms' nested fields, so the fill draws the values itself (section 6).

## 1. The pinned federal forms (C60.7, decision 18)

Stub `5a3d8a69` (`FormFixture`, `load_forms`, `FORM_HOSTS`, `--forms-dest`). RED `7003d8a7`:
```
$ uv run --frozen pytest tests/test_fetch_fixtures_forms.py tests/test_fixture_manifest.py --no-cov -q
     23 E       NotImplementedError: not built yet
      1 E       AssertionError: assert ['https://upl.../ab/Face.jpg'] == ['https://upl...w2--2025.pdf']   # the run never fetched the form
26 failed, 8 passed, 2 errors in 1.37s
```
The passing tests are the existing manifest tests and a calibration guard. The pins were taken by downloading each prior-year URL twice into an isolated scratch folder (`curl`, equal SHA-256 both times; the 2025 1099-INT URL served an HTML page and was dropped for the 1099-NEC). GREEN `a8ee7948`:
```
$ uv run --frozen pytest tests/test_fetch_fixtures*.py tests/test_fixture_manifest.py --no-cov -q
257 passed in 4.29s
$ python3 scripts/fetch_fixtures.py          # from the repository root
irs_w2_2025: downloaded …/fixtures/generated/federal-forms/fw2--2025.pdf (17 U.S.C. 105)
irs_1099_nec_2025: downloaded …/fixtures/generated/federal-forms/f1099nec--2025.pdf (17 U.S.C. 105)
irs_1040_2025: downloaded …/fixtures/generated/federal-forms/f1040--2025.pdf (17 U.S.C. 105)
```
One RED test was corrected in the GREEN commit: its input gave two forms the same file name, which the loader rightly refuses. `main` was split (`_chosen`) to stay within ruff's branch limit.

## 2. The core: page model, our own PDF writer, rasters and photos (C65.2, C60.3)

Stub `c9502eb7`. RED `db7f3b0d`:
```
$ uv run --frozen pytest tests/test_synthetic_poa_pdf.py --no-cov -q
     25 E       NotImplementedError: not built yet
25 failed in 0.60s
```
GREEN `81071f60`:
```
25 passed in 7.04s
tools/synthetic_poa.py   447   2   94   7   98%
```
Every property is read back independently (`tests/synthetic_poa_checks.py`: PDFium's raw API for text objects, render modes, fonts, fills, trailer ends, signature byte ranges, xref validity and `FPDFAvail_IsLinearized`; pypdf in strict mode).

## 3. Accented letters in photos (found while checking a photo by eye)

Pillow's bundled font (Aileron) has no Latin-1 accented letters: a Spanish photo showed missing-glyph boxes. RED `bbcb6e0b`:
```
$ uv run --frozen pytest tests/test_synthetic_poa_pdf.py --no-cov -q
     17 E       assert np.int64(99) < (np.int64(79) + 3)     # the "mark" reaches the baseline: a box
      3 E       Failed: DID NOT RAISE ValueError             # €, ß and U+FFFF drawn as boxes
34 failed, 25 passed in 7.98s
```
GREEN `4bf5667f` (61 passed): the base letter and the font's own acute, grave or tilde placed by their measured ink (Pillow's `getbbox` reports the advance box for spacing marks), a drawn circumflex, diaeresis and cedilla, a dotless i under its mark, the inverted marks drawn upside down, and a `ValueError` for anything else. Two test corrections in that commit: an accented i is measured against its stem (the mark replaces the dot), and the core tests' sample line prints `EUR` as the documents do (the euro sign is checked in the PDF text layer only).

## 4. The main set (C65.2, C60.6, V13)

Stub `daf0721b`. RED `6c561f8e`:
```
$ uv run --frozen pytest tests/test_synthetic_poa.py --no-cov -q
     71 E       NotImplementedError: not built yet
71 errors in 2.68s
```
GREEN `f4d7e690`:
```
$ uv run --frozen pytest tests/test_synthetic_poa.py tests/test_synthetic_poa_pdf.py -q --cov=tools
132 passed in 42.60s
tools/synthetic_poa.py  1273   4  220   6   99%
```
Two test corrections, both in the GREEN commit and its message: PDFium ends some text objects with a space (the reader now drops trailing whitespace); and the signed statement extended for long-term validation keeps its weak `incremental-revisions` cue, because C60.1 leaves DSS-only increments out of the edits after a signature, not out of the revisions. Pillow's PDF driver stamps the clock unless given dates, so the scan passes its own date.

## 5. The hostile set (C65.2, C60.2)

Stub `e3125718`. RED `04d491f1`:
```
$ uv run --frozen pytest tests/test_synthetic_poa_hostile.py --no-cov -q
     18 E       NotImplementedError: not built yet
1 failed, 17 errors in 1.54s
```
GREEN `cb3e7d21` (18 passed in 3.6 s). The gibibyte flate bomb is built in milliseconds: after a full flush every 1 MiB block of zeros deflates to the same bytes, so the stream repeats one block, and its Adler-32 is computed (`(n mod 65521) << 16 | 1`). The tests count the inflated bytes 16 MiB at a time.

## 6. The held-out set (C60.7, H23)

Written before reading `packages/checks/src/document/` (first read after `693bb552`). Stub `abf16510`. RED `47c6c32d`:
```
$ uv run --frozen pytest tests/test_synthetic_poa_held_out.py --no-cov -q
     25 E       NotImplementedError: not built yet
5 failed, 20 errors in 3.18s
```
GREEN `693bb552`:
```
$ uv run --frozen pytest tests/test_synthetic_poa_held_out.py --no-cov -q -rs
25 passed in 42.46s        # test_the_real_federal_forms_fill ran on the pinned forms (not skipped)
```
The federal fill draws each synthetic value at its widget's rectangle on an overlay page merged into the form's page, and writes the kept pages to a fresh file: no widget, AcroForm, XFA, JavaScript or usage-rights signature survives (tested on stand-in forms that carry them, and on the real files). pypdf deprecates merging into a page not yet attached to a writer (warnings are errors here), so the page is attached first.

## 7. The cues named as the checks name them

After the held-out commit, `packages/checks/src/document/fabrication.ts` showed other ids for the same cues. The main set's sidecars (never the held-out set) now use `FABRICATION_SIGNALS`' ids and reasons. RED `861df490` (8 failed, each an old cue name); GREEN `19eb031a` (71 passed).

## 8. Person A's chip portrait and the TD3 page's MRZ record (C65.3)

Stub `3905ebd2`. RED `b66ff503`:
```
$ uv run --frozen pytest tests/test_synthetic_travel.py --no-cov -q
      4 E       NotImplementedError: not built yet
4 failed, 10 passed in 0.70s
```
GREEN `b64f74d3` (64 passed with `test_synthetic_variants.py`).

## 9. The generator (`make_synthetic_fixtures.py`)

Refactor `3a8d61f5` (the stand-in forms move to the test helper; 4 passed). Stub `c89f6ae5`. RED `13a67186`:
```
$ uv run --frozen pytest tests/test_make_synthetic_fixtures.py --no-cov -q
E       AssertionError: assert '6+9067ea6fbfe9' == '6+9067ea6fbfe9+2026-10-24'
E       FileNotFoundError: … generated/poa/index.json
E       assert 6 >= 7
13 failed, 20 passed in 60.48s
```
Two RED-test defects were fixed before that commit: the fetched forms sit inside the default output (as in the repository), so the reproducibility comparison leaves them out and the failed-run test creates the output folder with `exist_ok`. GREEN `6e2ef11a`:
```
33 passed in 84.41s
$ time uv run --frozen python tools/make_synthetic_fixtures.py        # real faces, models and forms
real 0m50.580s          (the Phase 4 generator alone took 32 s)
$ cat ../../fixtures/generated/.generator-version
7+9067ea6fbfe9+2026-10-24
250 files under poa/, poa-held-out/, nfc/ (17 MB, 5.0 MB, 380 KB); git status: nothing under fixtures/
```

## 10. A real-model pin (written after the code)

`e0b0692f` pins built behaviour, so it never failed first:
```
$ uv run --frozen pytest tests/test_synthetic_travel_real.py --no-cov -q -s
chip A vs selfie A 0.632, vs selfie B 0.152          # FACE_MATCH_DEFAULTS.threshold 0.394
1 passed in 5.03s
```

## 11. Cross-checks against vision's analysis (scratch scripts, not committed)

With `vision-document`'s analysis as of `05674427` and no OCR, every main-set PDF measured as its sidecar says: revisions, `linearized`, `xref_repaired`, signatures, `edits_after_signature` (the DSS increment excluded), the action counts, and the hidden lines with their reasons (`covered` for the white box, `render_mode_invisible` for the recent date); the protected bill answered 422 `pdf_encrypted`. Every hostile file was answered as its sidecar says, each within a second: the XMP attacks analysed with `xmp` null or read to its bound, the bomb, 51 pages, the 20,000 pt page, the looping tree and the truncated bill 422 with their codes, the late header 415, the JPEG 2000 and PNG bombs 413, the dangerous actions counted one each.

## 12. Final gates

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-fixtures-5b
All checks passed!
195 files already formatted
Success: no issues found in 78 source files
```
The whole suite takes about 11 minutes, more than one foreground call allows, so it ran as two foreground halves sharing one coverage file, the gate applied to the combined total:
```
$ COVERAGE_FILE=/tmp/openverify-cov-fixtures-5b uv run --frozen pytest tests/test_[a-l]*.py -q --cov-fail-under=0
1338 passed in 174.13s
$ COVERAGE_FILE=/tmp/openverify-cov-fixtures-5b uv run --frozen pytest tests/test_[m-z]*.py -q --cov-append
Required test coverage of 80% reached. Total coverage: 97.26%
1118 passed in 497.16s
tools/make_synthetic_fixtures.py 99%   tools/synthetic_poa.py 99%   tools/synthetic_travel.py 100%
$ python3 scripts/fetch_fixtures.py
irs_w2_2025: present …/fw2--2025.pdf (17 U.S.C. 105)          # and the 1099-NEC, the 1040, the three faces
```

The full e2e (`pnpm e2e`: the mocked flow suite, then the full stack) took 12 min 17 s in another agent's run on this tree just before, more than one foreground call allows. It therefore ran in three foreground parts while this agent held `/tmp/openverify-e2e.lock` from a background holder for the whole time (acquired 03:21:53 UTC, released 03:32:22 UTC), the full stack in two Playwright shards, each starting its own stack:
```
$ pnpm turbo run e2e --filter=@openverify/flow
@openverify/flow:e2e:   68 passed (19.3s)
$ pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/2
[e2e +6.9s] fetching every model weight and the public-domain faces (pinned SHA-256)    # the forms too
  31 passed (3.5m)
$ … playwright test --shard=2/2
  29 passed (6.1m)
```
The setup found the version-7 stamp of the day (`7+9067ea6fbfe9+2026-10-24`) and did not regenerate. The 60 full-stack specs are the same 60 the unsharded run passed.
