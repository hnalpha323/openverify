# TDD evidence: Phase 5, Workflow 5B Stage 2 (`vision-document`)

Each unit follows the cycle stub (when a RED test needs a name that does not exist yet), RED (run, failing for the intended reason), GREEN, then refactor on green, with the commits named. Every command ran from `services/vision` after `source ../../scripts/env.sh`, unless it says otherwise, with `COVERAGE_FILE=/tmp/openverify-cov-vision-document` and mypy `--cache-dir /tmp/openverify-mypy-vision-document`. Output is trimmed to the lines that matter. Every PDF, photo and portrait in these tests is built in the tests (`tests/document_pdfs.py`, `tools/minimal_pdf.py`, V19); none is a real document.

## 1. The guarded child (C60.2)

Stub `29c8a3dd`: `guarded/__init__.py` (`GuardLimits`, `DEFAULT_LIMITS`), `protocol.py`, `runner.py` (`REFUSAL_CODES`, `GuardedWorkerError`, `GuardedRefusal`, `collect`, `parse_answer`, `run_guarded`), `probe.py`, `worker.py` (`TaskRefusal`, `harden`, `run_task`, `main`).

RED `0eb5d531` (`tests/test_guarded.py`: the framing, the planned limits read back by a real child, its empty environment, its modules, no process or thread, memory, CPU, wall-clock and output overruns, malformed answers):

```text
$ uv run --frozen pytest tests/test_guarded.py --no-cov -q
FAILED tests/test_guarded.py::test_frames_round_trip - NotImplementedError: g...
FAILED tests/test_guarded.py::test_the_child_runs_under_the_plans_rlimits_and_without_new_privileges
FAILED tests/test_guarded.py::test_a_child_over_its_address_space_is_stopped
...
39 failed, 1 passed in 0.38s
```

The one pass is `test_the_default_limits_are_the_plans` (the stub already held the planned values). The framing cases first called `pack()` inside `parametrize`, which failed at collection; the test now writes the wire format independently (`framed()`), so it fails at run time and checks `pack()` against it.

GREEN `7bf4f223`. The first GREEN run failed one case for a reason of the test's allowlist, not of the child:

```text
E       AssertionError: assert {'pypdfium2_c...itecustomize'} == set()
E         Extra items in the left set:
E         'sitecustomize'
E         'pypdfium2_cfg'
1 failed, 39 passed in 3.20s
```

`pypdfium2_cfg` is one of the three top-level modules pypdfium2's own distribution installs (`top_level.txt`), and `sitecustomize` is the Debian/Ubuntu interpreter's own start-up hook (`libpython3.12-minimal`; the `python:3.12-slim` image has none). Both joined the allowlist; NumPy, OpenCV, onnxruntime, pydantic, FastAPI and Starlette stay forbidden.

```text
$ uv run --frozen pytest tests/test_guarded.py --no-cov -q
40 passed in 3.26s
```

What the child does, in order: read the magic and the request header (at most 64 KiB, the parent's own JSON), clear the environment, `prctl(PR_SET_NO_NEW_PRIVS)` through `ctypes`, set `RLIMIT_AS` 1.5 GiB, `RLIMIT_CPU` 20 s (hard 21 s), `RLIMIT_FSIZE`, `RLIMIT_CORE` and `RLIMIT_NPROC` 0, `RLIMIT_NOFILE` 64, then read the document frame and run the task. The parent starts `sys.executable -I -B -m openverify_vision.guarded.worker` with `env={}`, `cwd="/"`, stderr discarded, writes and reads through one `selectors` loop, kills the child at 30 s or past 64 MiB of stdout, and refuses any answer that is not a well-framed JSON object with a known refusal code.

## 2. The raw-byte scanner, the XMP scan and the text and date helpers (C60.1, C60.2)

Stub `02182b96`: `guarded/pdf_scan.py` (`PdfScan`, `PdfObject`, `Ref`, `scan_pdf`, `INTERESTING_NAMES`), `guarded/xmp_scan.py` (`scan_xmp`, `MAX_XMP_SCAN_BYTES`), `guarded/text.py` (`clip_text`, `pdf_date`, `xmp_date`).

RED `017ec8c5` (`tests/test_pdf_scan.py` and the writer `tools/minimal_pdf.py`):

```text
$ uv run --frozen pytest tests/test_pdf_scan.py --no-cov -q
     6 E       NotImplementedError: clip_text
    15 E       NotImplementedError: pdf_date
    28 E       NotImplementedError: scan_pdf
    10 E       NotImplementedError: scan_xmp
     9 E       NotImplementedError: xmp_date
68 failed, 1 passed in 1.13s
```

The pass is the writer's own `pdf_string` escape.

GREEN `674a379e`:

```text
$ uv run --frozen pytest tests/test_pdf_scan.py --no-cov -q
69 passed in 0.90s
$ uv run --frozen pytest tests/test_pdf_scan.py tests/test_guarded.py -q --cov=openverify_vision.guarded --cov-fail-under=0
src/openverify_vision/guarded/pdf_scan.py        421     48    180     30    84%
src/openverify_vision/guarded/text.py             85      8     34      5    89%
src/openverify_vision/guarded/xmp_scan.py         61      3     20      4    91%
109 passed in 8.41s
```

The scanner is a bounded lexer (3,000,000 tokens, depth 32, 512 kept items per container, 200,000 objects, 20 MiB per object stream and 64 MiB in all decoded): it skips comments, literal and hex strings and stream data (by `/Length`, else to `endstream`), decodes `#xx` escapes in names, reads FlateDecode object streams without a predictor, counts `%%EOF` markers (comments outside stream data), `startxref` sections and the names of interest, and keeps each object's top-level dictionary. The XMP scan reads at most 64 KiB, refuses a packet holding `<!DOCTYPE` or `<!ENTITY` (any case), decodes only the five predefined entities and character references, and reads each field as an attribute or a simple element with bounded, unnested patterns.

## 3. The child's tasks: `analyze_pdf`, `render_pdf_page`, `decode_portrait` (C60.1, C60.2, C60.4)

Stub `cb63e109`: `guarded/pdf_measure.py` (`analyze`, `render_page`), `guarded/text_layer.py` (`FontRegistry`, `page_lines`, `HIDDEN_REASONS`), `guarded/images.py` (`decode_portrait`).

RED `c22b97e2` (`tests/test_pdf_measure.py`, `tests/test_guarded_images.py`, `tests/document_pdfs.py`):

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_guarded_images.py --no-cov -q
     5 E           openverify_vision.guarded.runner.GuardedWorkerError: guarded worker failed: exit_status
    14 E       NotImplementedError: images.decode_portrait
    25 E       NotImplementedError: pdf_measure.analyze
     6 E       NotImplementedError: pdf_measure.render_page
50 failed in 1.28s
```

The five worker failures are the cases run through a real child: the worker did not know the tasks yet.

GREEN `0359488a`. Two things went wrong on the way:
- `test_a_truncated_portrait_is_corrupt` cut a JP2 at a third of its length, which cut its header, so Pillow could not identify it (`unsupported_format`). The case became `test_a_portrait_cut_after_its_header_is_corrupt`, JPEG and JPEG 2000 cut at half.
- Both refusals run through a real child exited with status 1: `TaskRefusal` lived in `worker.py`, which runs as `__main__`, so the tasks raised a different class than the one the worker caught. It moved to `protocol.py`; `worker.py` re-exports it.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_guarded_images.py tests/test_guarded.py tests/test_pdf_scan.py --no-cov -q
160 passed in 5.74s
```

The hidden-text page through a real child took 0.196 s, a 50-page document 0.253 s.

## 4. The document OCR and the agreement (C60.1)

Stub `3332e749`: `OcrEngine.read_document`, `OcrEngine.read_regions`, `document_text.text_layer_ocr_agreement`.

RED `358ee785` (`tests/test_document_ocr.py`, fake models and one case with the real PP-OCRv6 models):

```text
$ uv run --frozen pytest tests/test_document_ocr.py --no-cov -q
     3 E       NotImplementedError: OcrEngine.read_document
     5 E       NotImplementedError: OcrEngine.read_regions
     5 E       NotImplementedError: text_layer_ocr_agreement
13 failed in 0.86s
```

GREEN `ca5033d8`. `test_a_page_is_read_as_document_lines` first expected the fake region's own corner (100 ± 25 px) but the detector's box is the region grown by DB's unclip margin, about 28 px for 300 x 40; the expectation became 100 - 28 ± 4, and the size 300 + 56.

```text
$ uv run --frozen pytest tests/test_document_ocr.py --no-cov -q
13 passed in 2.20s
$ uv run --frozen pytest tests/test_ocr*.py tests/test_mrz*.py tests/test_analysis*.py tests/test_barcode.py --no-cov -q
274 passed in 17.95s
```

Why the boxes and one line at a time: on this CPU (Xeon E5-1650 v3, 12 logical CPUs) PP-OCRv6's recognizer costs about 0.5 ms a character whatever the threading (40 dense lines: 1.98 s at batch 1, 3.08 s at batch 6 padded to the widest, 1.60-1.90 s with 3 to 12 threads), and whole-page detection 0.7 s a page at 2,000 px. Reading the 40 text-layer boxes of the same page took 1.48 s and read every line exactly. The government ID's batching is unchanged (`recognize(..., batch_size=REC_BATCH)` by default).

## 5. The photo forensics (C60.1)

Stub `d99047e5`: `document_forensics.exif_dates`, `measure_image`; `forensics/text_ela.text_cell_ela_score`.

RED `d5c975f1` (`tests/test_document_forensics.py`):

```text
     4 E       NotImplementedError: exif_dates
     4 E       NotImplementedError: measure_image
     2 E       NotImplementedError: text_cell_ela_score
10 failed
```

GREEN `46d88540`. The pasted-line case first scored 0.0649 against 0.0581 for the genuine photo: the RED fixture pasted the quality-30 line 4 px off the photo's 8 x 8 grid, which a JPEG ghost cannot see. On the grid the same paste scores 0.9742 (0.5648 from quality 50); the fixture pastes on the grid and the module and README say a misaligned paste shows as double compression instead.

```text
$ uv run --frozen pytest tests/test_document_forensics.py tests/test_forensics*.py --no-cov -q
216 passed in 29.09s
```

## 6. The analysis, the preview and the portraits in the parent, and the routes (C60.1, C60.2, C60.4)

Stubs `ac18bbbb` (`guarded/results.py`, the pydantic models of the child's answers; `document_analysis.GUARD_LIMITS`, `DocumentReader`, `sniff_document`) and `614d2f11` (`ProblemError(..., code=)`; `run_guarded` imported where the tests can replace it).

RED `dcd698ad` (`tests/test_document_analysis.py` new; `tests/test_app_document.py` rewritten). The old `test_app_document.py` pinned the 501 stubs; its `test_the_stubs_refuse_rather_than_measure` had been failing since `7bf4f223`, because `worker.main()` was built in unit 1, and the rewrite replaced it with the built behaviour:

```text
$ uv run --frozen pytest tests/test_app_document.py tests/test_document_analysis.py --no-cov -q
     20 E       NotImplementedError: analyze_document
     15 E       AssertionError: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"this analysis is not built yet","code":"not_implemented"}
      7 E       NotImplementedError: sniff_document
      5 E       NotImplementedError: render_document_page
      5 E       NotImplementedError: convert_portrait
53 failed, 9 passed in 3.73s
```

The nine passes are the token, page-validation and body-limit cases, which the stubs already met.

GREEN `05674427`:

```text
$ uv run --frozen pytest tests/test_app_document.py tests/test_document_analysis.py --no-cov -q
62 passed in 11.47s
$ uv run --frozen pytest tests/test_app*.py tests/test_selfie_face_route.py tests/test_contract_fixtures.py tests/test_schemas_document.py tests/test_limits.py tests/test_service_token.py tests/test_inference.py --no-cov -q
217 passed in 16.52s
```

The CPU and memory overruns run a real child on a page of a million line segments with `GUARD_LIMITS` lowered (1 s of CPU; 320 MiB of address space) and answer 503 `guarded_worker_failed`.

## 7. The hostile set end to end (C60.2)

RED `0be41ffb` (`tests/test_hostile_documents.py`): fourteen cases through `analyze_document` and a real child. Thirteen passed on the built code (they pin it); one failed:

```text
WARNING  openverify_vision.guarded.runner:runner.py:204 guarded analyze_pdf task failed: exit status 1
FAILED tests/test_hostile_documents.py::test_a_page_tree_that_loops_is_refused_as_unprocessable
1 failed, 13 passed in 6.69s
```

PDFium trusts the tree's `/Count 2`, then cannot load the second page (the tree itself): `PdfiumError("Failed to load page.")` ended the child. GREEN `d99bb26b`: a page PDFium cannot load makes the document `pdf_unprocessable`, in the analysis and the preview.

```text
$ uv run --frozen pytest tests/test_hostile_documents.py tests/test_pdf_measure.py --no-cov -q
49 passed in 12.80s
```

A fuzz run (not committed) corrupted six of the test documents 1,500 times each way (bytes changed, cut and inserted) and ran both PDF tasks in process: 2,132 analysed, 868 refused `pdf_unprocessable`, no other exception.

`f6144158` (refactor): three guards no input built here reaches (`page.get_bbox()` and `page.get_rotation()` raising `PdfiumError`, a ToUnicode code past `sys.maxunicode`), and in-process pins of `worker.main()` (the request, then `harden`, then the answer) and of the probe's overruns.

`5b9c956c` (pin): the hidden-text fixture had left its clip-only (mode 7) line's text clip open, so everything after it was clipped from the render while the text layer still called it visible; PDFium does not expose a clip made of text. The box OCR read nothing there (agreement 0.36). The fixture now closes that line in `q`/`Q`, and `test_a_line_a_text_clip_hides_reads_as_nothing_so_the_agreement_falls` pins the case with the real models (agreement under 0.75).

Cross-check with `fixtures-5b`'s committed hostile set (`cb3e7d21`, `tools/synthetic_poa.hostile_set()`, run in process, not committed): all fifteen inputs answered within their sidecars' expected statuses and codes. `jpeg2000-bomb.jp2` (50,000 px a side) answered 422 where 413 or 422 was allowed: Pillow's own bomb check fires while opening, and it was read as `corrupt`. RED `ef8810cc`:

```text
E       AssertionError: assert 'corrupt' == 'too_large'
1 failed, 17 passed in 0.54s
```

GREEN `58fd07d0`: Pillow's `DecompressionBombError` at open is `too_large` (413).

```text
$ uv run --frozen pytest tests/test_guarded_images.py tests/test_document_analysis.py tests/test_hostile_documents.py --no-cov -q
70 passed in 18.68s
```

## 8. The benchmark (Workflow 5B: median at most 4 s for a 3-page born-digital PDF)

`2d3f2b6c`: `tools/benchmark_document.py` and `tests/test_benchmark_document.py`. The script was written before its unit tests, as the government ID benchmark was (a measurement script); its tests pin it (8 passed; the first run of `test_timed_stages_times_each_call_and_restores_the_stage` expected a `ValueError` for an unknown task, but `run_guarded` answers a `GuardedWorkerError`: the test was wrong).

```text
$ uv run --frozen python tools/benchmark_document.py --runs 10
## Document analysis benchmark (C60, Workflow 5B)

- CPU: Intel(R) Xeon(R) CPU E5-1650 v3 @ 3.50GHz, 12 logical CPUs
- Input: the synthetic 3-page born-digital bill; the OCR read 2652 characters
- Runs: 10, after one warm-up request that loads the models
- Median 2.23 s (min 1.92 s, max 2.78 s): within the 4.00 s budget

| Stage | Median (ms) |
|---|---|
| guarded child (PDFium, pypdf, scan, render) | 416 |
| ocr (text-layer boxes) | 1745 |
| other (upload, validation, response) | 14 |
```

The machine was shared with other agents' test runs. The OCR's cost grows with the characters the visible text layer holds (about 0.66 ms each here, box padding included).

## 9. Cross-checks and final gates

The API's zod schema (`apps/api/src/vision/schemas.ts`, `documentAnalysisSchema`) parsed nine real analyses made with the real text models (the bill, the hidden-text page, a scan, an edit after a signature, a DSS increment, the benchmark bill, an edited photo, fifty pages, form fields), through a throwaway vitest file outside the repository:

```text
$ (cd apps/api && ./node_modules/.bin/vitest run --root <scratch> zod-check.test.ts --coverage.enabled=false)
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

```text
$ uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
194 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-document
Success: no issues found in 78 source files
$ COVERAGE_FILE=/tmp/openverify-cov-vision-document uv run --frozen pytest
Required test coverage of 80% reached. Total coverage: 96.39%
2441 passed in 489.51s (0:08:09)
```

Coverage of this area's modules in that run (in process; the child's own code runs where coverage is not collected, so `worker.py` and `probe.py` show only their in-process parts): `document_analysis.py` 91%, `document_forensics.py` 96%, `document_text.py` 100%, `forensics/text_ela.py` 88%, `guarded/images.py` 95%, `pdf_measure.py` 90%, `pdf_scan.py` 85%, `protocol.py` 95%, `results.py` 100%, `runner.py` 94%, `text.py` 89%, `text_layer.py` 82%, `xmp_scan.py` 91%, `worker.py` 59%, `probe.py` 64%, `ocr/__init__.py` 99%, `tools/benchmark_document.py` 100%, `tools/minimal_pdf.py` 97%.

```text
$ (repository root) pnpm --filter @openverify/api exec vitest run src/vision --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  126 passed (126)
```

The full-stack suite (`flock /tmp/openverify-e2e.lock pnpm e2e`, 547 s with the lock) passed 59 of 60 specs; `selfie-static-replay.spec.ts` stopped at the web flow's camera start (`Starting your camera…`, then an empty status for 60 s) before any vision call, in `apps/flow`, which `clients-5b` was changing at the time. Re-run alone a few minutes later it passed:

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/selfie-static-replay.spec.ts'
  ✓  1 [chromium] › tests/selfie-static-replay.spec.ts:26:1 › a static replay that never turns gets the pose retry hint, and nothing else fails (C43, C45.3) (31.8s)
  1 passed (1.4m)
```

The whole suite once more, with every 5B commit in the tree at the time (1,010 s with the lock wait):

```text
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   68 passed (23.1s)
@openverify/e2e:e2e:   60 passed (8.0m)
 Tasks:    10 successful, 10 total
```
