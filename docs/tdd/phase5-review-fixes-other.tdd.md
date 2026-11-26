# TDD evidence: Workflow 5C review fixes (Python and Kotlin)

- **Slice owner:** the Python and Kotlin fixer of the Workflow 5C review (Phase 5, `7e80351..HEAD`).
- **Date:** 2026-10-24.
- **Paths owned:**
  - `services/vision/`, `models/manifest.json`, `scripts/fetch_*.py`, `data/manifest.json`, `fixtures/manifest.json`, `contracts/fixtures/vision/`;
  - `infra/docker/`, `infra/docker-compose.yml`, `.env.example`, `infra/tests/compose.test.sh`, `infra/tests/apps-image-context.test.sh`, `infra/tests/vision-container.test.sh`;
  - `THIRD_PARTY_LICENSES.md`, the NOTICE files;
  - `android/` (except `ContractFixturesTest.kt`);
  - this file.
- **Input:** two blocking findings (P009, P010), then the MEDIUM items in priority order (K10, K11, K12, P003, P012, P014, P018, P011, P013, P015, P016, P017, P022).

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

Every Python command ran in `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-fix-other` for pytest and `--cache-dir /tmp/openverify-mypy-fix-other` for mypy. The output is trimmed to the lines that matter.

## P010 (HIGH): the empty-environment test could not fail

**Confirmed.** The probe reported `sorted(os.environ)`, but `worker.main` calls `harden()` first, and `harden()` begins with `os.environ.clear()`. So the probe always reported `[]`, whatever the parent passed to `subprocess.Popen`. The production spawn (`env={}` in `guarded/runner.py`) is correct; only the test was blind.

**RED.** Two tests in `tests/test_guarded.py`:
- `test_the_probe_sees_an_environment_the_child_was_started_with`, the control: `subprocess.Popen` is replaced by a wrapper that drops `env=` (so the child inherits the parent's environment, the token included), and the probe must report `OPENVERIFY_VISION_SERVICE_TOKEN`.
- `test_the_child_is_spawned_with_an_empty_environment`: a spy on `subprocess.Popen` asserts the spawn passes `env={}`. It passes already, as the production code is correct; it pins the spawn itself.

```text
$ uv run --frozen pytest tests/test_guarded.py -q --no-cov -k environment
>       assert "OPENVERIFY_VISION_SERVICE_TOKEN" in report["environ"]
E       AssertionError: assert 'OPENVERIFY_VISION_SERVICE_TOKEN' in []
FAILED tests/test_guarded.py::test_the_probe_sees_an_environment_the_child_was_started_with
1 failed, 2 passed, 41 deselected in 0.25s
$ uv run --frozen mypy tests/test_guarded.py --cache-dir /tmp/openverify-mypy-fix-other
Success: no issues found in 1 source file
```

Committed as `b1708bba`.

**GREEN.** The probe's `environ` is now the names in `/proc/self/environ`, the block `execve` received, which `os.environ.clear()` does not touch. Only names are reported, never values. Without `/proc` it is `None`. The existing test now asserts `environ == []` exactly: CPython's own `LC_CTYPE` (PEP 538) is set with `setenv` and never appears in the initial block, so the old allowance is gone.

```text
$ uv run --frozen pytest tests/test_guarded.py -q --no-cov
45 passed in 3.45s
```

**Mutation check.** With `env={}` commented out of `guarded/runner.py` (restored afterwards; `git diff` of the file is empty), both tests fail:

```text
E       AssertionError: assert ['AI_AGENT', ...SESSION', ...] == []
E         Left contains 57 more items, first extra item: 'AI_AGENT'
E       assert [None] == [{}]
```

## P009 (HIGH): the OCR of a born-digital PDF had no bound on its work

**Confirmed.** `document_analysis._page` passed every visible text-layer box to `OcrEngine.read_regions`, one ONNX recognition each (`batch_size=1`), in the vision parent, outside the child's rlimits. Nothing capped it below 600 lines × 4 pages, and nothing timed it. The same held for whole-page reads (`read_document`, up to 600 detected lines a page). The reviewer's probe (`perf3.py`, 4 pages, 3 columns of 3.2 pt lines, real models) on the development machine (Xeon E5-1650 v3, 12 logical CPUs):

| Lines a page | Before: wall, CPU | After: wall, CPU | Lines read a page after |
|---|---|---|---|
| 30 | 2.6 s, 13.7 s | 2.6 s, 13.6 s | 30 (all) |
| 150 | 12.3 s, 68.7 s | 5.6 s, 28.3 s | 56, 56, 57, 57 |
| 600 | 49.2 s, 278.2 s | 8.0 s, 27.4 s | 56, 56, 57, 57 |

The guarded child alone takes about 2.8 s of the 600-line case.

**What a recognition costs.** I timed the real recognizer on crops of each aspect ratio (30 crops each, `batch_size=1`):

```text
ratio 6.67: 18.7 ms wall/crop, 112 ms cpu/crop, units 6.7 -> 2.80 ms/unit
ratio 13: 24.3 ms wall/crop, 146 ms cpu/crop, units 13.0 -> 1.87 ms/unit
ratio 30: 56.3 ms wall/crop, 338 ms cpu/crop, units 30.0 -> 1.88 ms/unit
ratio 64: 133.8 ms wall/crop, 806 ms cpu/crop, units 64.0 -> 2.09 ms/unit
ratio 200: 132.8 ms wall/crop, 800 ms cpu/crop, units 64.0 -> 2.07 ms/unit
```

So the cost of one line is its width in line heights, clamped as the recognizer clamps it: at least 320/48 and at most 64. That is about 2 ms of wall time a unit on 12 threads. A cap on the number of lines alone would not bound the time: 2,400 lines 64 units wide would still cost about 5 minutes.

**The design.**
- `recognition.line_units(crop)` is that cost. `RecognitionBudget(units, deadline)` admits lines in order until the first one that does not fit. That line and every line after it stay unread, so what is read is always a prefix, and the same document is read the same way on any machine.
- `OcrEngine.read_regions(img, boxes, budget)` answers only the prefix it read (a box off the raster costs nothing). `read_document(img, budget)` reads the detected lines in reading order while the budget admits them. Both check the deadline before every recognition, and `read_document` also checks it before the detection.
- `document_analysis.OCR_UNITS_PER_DOCUMENT = 2400`. That is about 230 typical lines, or 5 s of recognition here. The synthetic 3-page benchmark bill costs about 730, so it is read whole. Each analysed page gets an equal share of what is left, and a page that needs less leaves the rest to the pages after it. A photo gets the whole budget.
- A line left unread has no reading and is left out of `text_layer_ocr_agreement`. Not measured is not the same as read as nothing, which still scores 0. The checks already treat a text-layer line with no OCR reading as not cross-checked (`ocrTextOver` is `null`), so a dense genuine statement gets no false text-layer cue.
- `ANALYSIS_DEADLINE_SECONDS = 40`, counted from the start of `analyze_document`. The API waits 45 s for a guarded route, so vision stops reading once the API no longer waits for the answer. Past the deadline the request answers 503 `guarded_worker_failed` (reason `deadline`, logged without PII). Within the unit budget the deadline only fires on a host far slower than ours.

**RED.** The tests went in with the interface only: the `budget` argument, `RecognitionBudget`, `line_units` and the two constants, none of them honoured.
- `tests/test_document_ocr.py` (fake models, which now count the rows and units they recognise):
  - a line's cost;
  - a budget reads a prefix of the boxes;
  - a box off the raster costs nothing;
  - a budget limits a whole-page read;
  - a reading past its deadline raises before any recognition.
- `tests/test_document_analysis.py`:
  - each page's share of the document's budget, with carry-over and one deadline;
  - a photo gets the whole budget;
  - lines left unread do not count in the agreement;
  - an analysis past its deadline answers 503 (real engine, fake models).
- `tests/test_hostile_documents.py::test_a_dense_pdf_is_read_within_the_ocr_budget_and_in_bounded_time`: a 4-page PDF of 600 visible 3.2 pt lines a page (under 32 KB) through a real child and the real engine. The fake recognizer sleeps 2 ms a unit, the measured cost of the real one, so the hostile set's 20 s bound is a wall-clock bound on the reading.

```text
$ uv run --frozen pytest tests/test_document_ocr.py tests/test_document_analysis.py tests/test_hostile_documents.py -q --no-cov
E       NotImplementedError
E       AssertionError: assert ['UTOPIA', 'S... '12 08 1984'] == ['UTOPIA', 'SURNAME']
E       Failed: DID NOT RAISE RecognitionDeadlineError
E       AssertionError: assert 0 == 4      (no budget was passed to the reader)
E       assert None is not None
E       ValueError: zip() argument 2 is shorter than argument 1
E       Failed: DID NOT RAISE ProblemError
E       assert 18438.5 <= 2400.0           (the dense PDF: 18,438 units, about 37 s at 2 ms a unit)
9 failed, 67 passed in 59.82s
$ uv run --frozen mypy src tools tests/test_document_analysis.py tests/test_hostile_documents.py tests/test_document_ocr.py tests/ocr_fakes.py --cache-dir /tmp/openverify-mypy-fix-other
Success: no issues found in 82 source files
```

Committed as `c21efcc6`.

**GREEN.**

```text
$ uv run --frozen pytest tests/test_document_ocr.py tests/test_document_analysis.py tests/test_hostile_documents.py tests/test_ocr_recognition.py tests/test_ocr.py -q --no-cov
110 passed in 27.76s
$ uv run --frozen pytest tests/test_hostile_documents.py -q --no-cov -k dense --durations=1
7.10s call     tests/test_hostile_documents.py::test_a_dense_pdf_is_read_within_the_ocr_budget_and_in_bounded_time
$ uv run --frozen python tools/benchmark_document.py --runs 3
- Input: the synthetic 3-page born-digital bill; the OCR read 2652 characters
- Median 1.80 s (min 1.77 s, max 1.81 s): within the 4.00 s budget
$ uv run --frozen pytest tests/test_contract_fixtures.py tests/test_benchmark_document.py tests/test_app_document.py -q --no-cov
63 passed in 7.27s
```

The benchmark bill reads the same 2,652 characters as before the budget, and no golden fixture changed.

**The benchmark's dense case.** `tools/benchmark_document.py --sample dense` times four analysed pages of 600 visible 3.2 pt lines, the most the OCR is ever asked to read. Its budget is `DENSE_BUDGET_SECONDS = 10`: the child for four such pages (about 3 s here) plus the OCR's whole unit budget (about 5 s here). The default sample and the CI step (`--runs 10`, never `--enforce`) are unchanged.

RED (`98415c89`; the sample was a stub raising `NotImplementedError`):

```text
$ uv run --frozen pytest tests/test_benchmark_document.py -q --no-cov
E       NotImplementedError
E       SystemExit: 2
E       KeyError: 'sample'
3 failed, 7 passed in 4.02s
```

GREEN:

```text
$ uv run --frozen pytest tests/test_benchmark_document.py -q --no-cov
10 passed in 8.58s
$ uv run --frozen python tools/benchmark_document.py --sample dense --runs 3
- Input: the synthetic 4-page dense PDF (600 visible lines a page); the OCR read 7180 characters
- Median 6.64 s (min 6.47 s, max 6.84 s): within the 10.00 s budget
| guarded child (PDFium, pypdf, scan, render) | 1700 |
| ocr (text-layer boxes) | 4903 |
$ uv run --frozen python tools/benchmark_document.py --runs 3
- Input: the synthetic 3-page born-digital bill; the OCR read 2652 characters
- Median 1.73 s (min 1.70 s, max 1.74 s): within the 4.00 s budget
```

## K10 (MEDIUM): the trust-store flags reached only the worker

**Confirmed.** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS` and `OPENVERIFY_TRUST_ANCHOR_REFRESH` were in `x-worker-provider-environment` only, and `infra/tests/compose.test.sh` pinned that the API received neither. The API's config already parses both (`apps/api/src/config.ts`, `allowIcaoCrls` and `trustAnchorRefresh`), so passing them is all compose owes. Owner decision 6 after Workflow 5B asks the trust-anchors route to report both. The route and the console are K13, the TypeScript fixer's.

**RED.** The compose test now expects the API to receive both flags, from the same expressions as the worker, and `migrate` still none.

```text
$ bash infra/tests/compose.test.sh --static-only
FAIL - api receives OPENVERIFY_NFC_ALLOW_ICAO_CRLS
FAIL - api and worker read OPENVERIFY_NFC_ALLOW_ICAO_CRLS the same way (expected 'false', got 'null')
FAIL - api receives OPENVERIFY_TRUST_ANCHOR_REFRESH
FAIL - api and worker read OPENVERIFY_TRUST_ANCHOR_REFRESH the same way (expected 'false', got 'null')
ok   - migrate receives no trust-store setting
# 300 passed, 4 failed
```

Committed as `75156eef`.

**GREEN.** A new compose anchor, `x-trust-store-environment`, holds the two flags with their `false` defaults and is merged into `api` and `worker`, not `migrate`. The `.env.example` comment says that compose passes both to the worker, which acts on them, and to the API, which reports them.

```text
$ bash infra/tests/compose.test.sh --static-only
# 304 passed, 0 failed
```

## K11 (MEDIUM): a later signature's own increment counted as an edit

**Confirmed.** `pdf_measure` reports `edits_after_signature = scan.edits_after(min(ends))`. `PdfScan.edits_after` excused only increments that held nothing but a DSS, or nothing but a document timestamp. A second party's signature in its own incremental update, the normal way a lease is signed by tenant and then landlord, was therefore an edit after the first signature. The advisory fabrication check then raised its strong `pdf_signature_invalidated` cue on a genuine document.

**The rule.** This is owner decision 5 after Workflow 5B, a Workflow 5C review amendment to C60.4. `_LaterSignature.check` excuses an increment when all of the following hold:
- it adds at least one new signature dictionary (`/Type /Sig`, or `/ByteRange`, `/Contents` and `/Filter`, since `/Type` is optional; not a document timestamp), and each one is the `/V` of a signature field the same increment writes;
- every new object is reached from those signature fields through objects that are new in this increment: the signature dictionary, a widget, the appearance and its fonts and images, a field lock or seed values. None of them may be another field, a non-signature annotation, a page or a catalog;
- every object that existed before is changed only as the signature needs:
  - the catalog differs from the previous one only in `/AcroForm`;
  - the AcroForm differs only in `/Fields`, which keeps every field and gains only the new signature fields (and `/SigFlags`);
  - a page differs only in `/Annots`, which keeps every annotation and gains only the new signature's widgets;
  - an indirect `/Annots` or `/Fields` array only gains them;
  - a signature field that was waiting empty is now signed.

Anything else in that increment is still an edit. That includes the document information dictionary and the XMP metadata, which some signing tools also rewrite: the decision lists only the signature's own objects. Each increment is judged against the latest version of every object before it, which one sorted walk over the objects keeps. Arrays are compared as sets, so a hostile file with many large arrays stays linear.

**RED.** `tests/document_pdfs.signed_twice()` signs the signed bill again in one increment, as a signing tool writes it: the value, a visible field and widget with an appearance and its font, the AcroForm gaining the field and the page gaining the widget. Real byte ranges are patched in, so PDFium reports two signatures. The tests in `tests/test_pdf_measure.py` go through `analyze`:
- the genuine case must not be an edit;
- six variants of the same increment must be: new page text, a replaced content stream, an added FreeText annotation, an added text field, a replaced font, and an object the signature does not need.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k second_signature
E       assert (2, True, 2) == (2, False, 2)
FAILED tests/test_pdf_measure.py::test_a_second_signature_in_a_later_increment_is_no_edit
1 failed, 6 passed, 35 deselected in 0.41s
```

The six variants pass before the fix too, because everything after a signature was an edit then. They pin that the fix excuses nothing else. Committed as `d7bdeab4`.

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_pdf_scan.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py tests/test_hostile_documents.py -q --no-cov
340 passed in 99.48s (0:01:39)
```

The golden fixtures and every proof-of-address sidecar are unchanged. No fixture is signed twice, and the single-signature, DSS and timestamp cases answer as before.

**More shapes, written with the code.** `tests/test_pdf_scan.py` covers, at the scanner level, the forms other signing tools write:
- signing an empty signature field that was waiting in the first revision;
- a new field with a separate widget (`/Parent`) in indirect `/Annots` and `/Fields` arrays and an indirect AcroForm.

It also covers five edits in that indirect form: the widget of a text field, another annotation, a changed AcroForm entry, a dropped annotation, and the first signature's value replaced. A last test checks that an increment with no new signature is judged as before. These were written after the code. Run against the scanner of `d7bdeab4` (a copy outside the repository, imported first through `PYTHONPATH`), the two genuine shapes fail as edits, and the edits pass either way:

```text
$ PYTHONPATH=<copy with the pre-fix pdf_scan.py> uv run --frozen pytest tests/test_pdf_scan.py tests/test_pdf_measure.py -q --no-cov -k "signature or signed"
FAILED tests/test_pdf_scan.py::test_signing_an_empty_signature_field_is_no_edit
FAILED tests/test_pdf_scan.py::test_a_new_signature_field_in_indirect_arrays_is_no_edit
FAILED tests/test_pdf_measure.py::test_a_second_signature_in_a_later_increment_is_no_edit
3 failed, 17 passed, 99 deselected in 0.71s
```

## K12 (MEDIUM): nothing pinned trust-anchors/manifest.json in the apps image

**Already pinned; no change.** `infra/tests/apps-image-context.test.sh` already checks it: "the apps image context has trust-anchors/manifest.json (the worker reads it)", added in Workflow 5B (integration-5b item 16). To show the check can fail, I copied the test, the apps Dockerfile, `data/manifest.json` and the guidance plugin into a scratch tree with a `.dockerignore` that also lists `trust-anchors`:

```text
$ bash infra/tests/apps-image-context.test.sh
ok   - the apps image context has trust-anchors/manifest.json (the worker reads it)
# 14 passed, 0 failed
$ bash <scratch>/infra/tests/apps-image-context.test.sh      (.dockerignore + "trust-anchors")
FAIL - the apps image context has trust-anchors/manifest.json (the worker reads it) (excluded by .dockerignore)
# 13 passed, 1 failed
```

## P003 (MEDIUM): a document that kills the child every time was retried as an outage

**Confirmed.** `document_analysis._guarded` answered every `GuardedWorkerError` 503 `guarded_worker_failed`. The API retries a 503 five times (`apps/api/src/vision/index.ts`, `apps/api/src/jobs/index.ts`), and each attempt holds one of vision's two job slots for the child's life. The reviewer's 28 KB PDF, whose content stream inflates to 18.9 MB of text operators, ends the child with SIGABRT after about 8 s, the same way on every attempt.

I first recorded how each overrun ends, through real children:

```text
cpu heavy (GuardLimits(cpu_seconds=1))           -> killed by SIGXCPU
memory heavy (address space 320 MiB, PDFium)      -> killed by SIGABRT
probe allocate (address space 256 MiB, Python)    -> exit status 1   (MemoryError)
probe spin                                        -> killed by SIGXCPU
unknown task (our own code's error)               -> exit status 1
```

Python's MemoryError and our own errors both exited with status 1, so they could not be told apart. That needed a distinct status.

**The fix.**
- `GuardedWorkerError.over_limits` is true when the child stopped on its own limits, which the same document would hit again:
  - a death by `SIGXCPU` (its CPU limit);
  - a death by `SIGABRT`, `SIGSEGV` or `SIGBUS` (native code failing an allocation under `RLIMIT_AS`, or breaking on the document);
  - its output cap;
  - the new `OVER_LIMITS_EXIT_STATUS` (3), which the worker now exits with when Python runs out of address space.
- It is false in three cases:
  - the 30 s kill timer, which counts wall time and a loaded host stretches;
  - `SIGKILL`, which the container's out-of-memory killer also sends, whatever the document;
  - an error of the child's own code (exit 1), as well as a failed spawn and malformed output.
- Only the analysis turns `over_limits` into 422 `pdf_unprocessable`, which the document job already treats as the user's to replace (`document_unreadable`). Every other failure, and every failure of the render and portrait tasks, still answers 503.

**RED.**
- `tests/test_guarded.py`: the address-space, CPU and output overruns are `over_limits`; the kill timer and an unknown task are not.
- `tests/test_document_analysis.py`:
  - the CPU, memory and output cases answer 422 `pdf_unprocessable`. This replaces `test_a_child_that_exceeds_its_limits_answers_503`, which pinned the old contract;
  - the kill timer, a failed spawn, the child's own error and malformed output still answer 503;
  - a page render past its limits still answers 503.
- `tests/test_hostile_documents.py`: `test_a_child_over_its_cpu_or_memory_answers_503` becomes `..._is_refused_as_unprocessable`.

`over_limits` existed but was always false.

```text
$ uv run --frozen pytest tests/test_guarded.py tests/test_document_analysis.py tests/test_hostile_documents.py tests/test_app_document.py -q --no-cov
FAILED tests/test_guarded.py::test_a_child_over_its_address_space_is_stopped
FAILED tests/test_guarded.py::test_a_child_over_its_cpu_time_is_stopped - Ass...
FAILED tests/test_guarded.py::test_a_child_writing_more_than_its_output_cap_is_killed
FAILED tests/test_document_analysis.py::test_a_document_that_takes_the_child_past_its_limits_is_unprocessable[cpu]
FAILED tests/test_document_analysis.py::test_a_document_that_takes_the_child_past_its_limits_is_unprocessable[memory]
FAILED tests/test_document_analysis.py::test_a_document_that_takes_the_child_past_its_limits_is_unprocessable[output]
FAILED tests/test_hostile_documents.py::test_a_child_over_its_cpu_or_memory_is_refused_as_unprocessable[cpu]
FAILED tests/test_hostile_documents.py::test_a_child_over_its_cpu_or_memory_is_refused_as_unprocessable[memory]
8 failed, 124 passed in 31.11s
```

Committed as `571f0d06`.

**GREEN.** A further in-process test covers the worker's exit with `OVER_LIMITS_EXIT_STATUS` on a MemoryError.

```text
$ uv run --frozen pytest tests/test_guarded.py tests/test_document_analysis.py tests/test_hostile_documents.py tests/test_app_document.py -q --no-cov
132 passed in 31.28s
$ uv run --frozen pytest tests/test_guarded.py -q --no-cov
46 passed in 3.39s
$ uv run --frozen python <scratch>/p003.py        (the reviewer's 28 KB PDF through analyze_document)
guarded analyze_pdf task failed: killed by SIGABRT
PDF 28152 bytes; inflated content 18900015
422 pdf_unprocessable after 8.2 s
```

This changes C60.1's error contract, recorded as a Workflow 5C review amendment in this fixer's `contractDeviations`. The API needs no change, since it already maps 422 `pdf_unprocessable` to `document_unreadable`. `docs/checks/document.md` belongs to the TypeScript fixer.

**A correction to the P003 tests (`d5421a8c`).** During P012's GREEN run, the `memory` case began to end with exit status 127 instead of SIGABRT, and so with 503. I traced it with `LD_DEBUG=libs`. At 320 MiB the child never reached the document: the loader failed while PDFium initialised ("cannot allocate memory for thread-local data: ABORT", exit 127), or PDFium aborted at start-up (SIGABRT), depending on memory layout. The same heavy page at 384 MiB to 1.5 GiB dies of SIGXCPU, so it was never a memory case:

```text
heavy page, -I -B, two runs each:   384..1536 MiB -> [(-24), (-24)]      (SIGXCPU)
2.7M "(A) Tj" operators (28 KB):     512 MiB -> [-6, -6]; 768 MiB -> [-6, -6]; 1536 MiB -> [-6, -6] (SIGABRT, 7 s)
```

The memory cases now use `document_pdfs.text_operator_bomb()`, the reviewer's 28 KB PDF. Under the production limits it exhausts the 1.5 GiB of address space while PDFium reads it, every time, and is refused 422 `pdf_unprocessable` (8 s). Exit status 127 is not counted as over the limits: the loader also exits 127 on a missing symbol or library, which would be a broken image, not the document.

## P012 (MEDIUM): what the raw scanner never read was measured as a clean document

**Confirmed.** `scan_pdf` sets `truncated` when it stops at a bound (3,000,000 tokens, 200,000 kept objects, an object stream's budget, a stream without `endstream`), but nothing read the flag. A rewritten page that carries a long array before naming an edited content stream, after a signature, shows the problem. With the token budget lowered to 1,000 for the test, the measurements came out clean while the page showed the forged amount:

```text
{'revisions': 1, 'eof_markers': 1, 'signatures': 1, 'edits_after_signature': False} Amount due: 9.20
```

**The fix.**
- `pdf_measure.analyze` refuses a document whose scan was truncated with `pdf_unprocessable`. The revisions, the `%%EOF` markers, the actions and the edits after a signature past that point are unknown, and the schema has no null for them. A made-up conservative value would break the rule that a part not measured is never a made-up value.
- The scanner also counts comments and stray single bytes (`other` tokens) against its token budget, both at the top level and inside object streams, since it steps over them one by one. A run of whitespace is one match, so it stays free.
- No genuine fixture comes near the bounds: every proof-of-address document and golden fixture is read as before.

**RED** (`d339d76b`):
- `tests/test_pdf_measure.py`: `padded_page_after_signing(2_000)` is measured whole (revisions 2, an edit after the signature). With `MAX_TOKENS` lowered to 1,000 it must be refused. A document with more objects than a lowered `MAX_OBJECTS` must be refused too.
- `tests/test_pdf_scan.py`: 1,000 stray `)`, `}` or comment lines under a budget of 100 must truncate the scan.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_pdf_scan.py -q --no-cov
E       Failed: DID NOT RAISE TaskRefusal
E       Failed: DID NOT RAISE TaskRefusal
E       AssertionError: assert False is True        (x3: PdfScan(..., objects=(), truncated=False).truncated)
5 failed, 119 passed in 3.00s
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_pdf_scan.py tests/test_hostile_documents.py tests/test_document_analysis.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py tests/test_benchmark_document.py tests/test_app_document.py -q --no-cov
427 passed in 126.86s (0:02:06)
$ (padded_page_after_signing(3_100_000) through run_guarded, production limits)
6202465 bytes -> pdf_unprocessable in 19.8 s
```

## P014 (MEDIUM): judging hidden text set every character against every drawn object

**Confirmed.** `_Judge.hidden` tested every character against every opaque object drawn after it (`covered`), and `_blends_in` against every one drawn before it. That is O(characters × objects) in Python, up to 60,000 × 20,000. The reviewer's 4.4 KB page (6,600 characters, 5,000 small grey rectangles) ran the child into SIGXCPU.

**The fix.**
- An `_Index` over the page box: a 32 × 32 grid of cells, each holding the opaque objects over it in painting order. An object over more than 32 cells (a background or a band, of which a page has few) is kept in a separate list that every character meets.
- An object covering nine tenths of an axis-aligned box contains the box's centre: the overlap is a rectangle at least 0.9 of each side, so it spans the middle. So `covered` only needs the objects over the centre's cell, walked from the top down until one drawn before the character. `behind`, for the colour test, takes the topmost object under the centre drawn before it, from both lists.
- Every character-against-object test is counted. A page past `MAX_SCENE_CHECKS` (2,000,000) is refused with `pdf_unprocessable`. Only a page whose objects lie over most characters without covering them gets near that.

**RED** (`aaddaaab`), in `tests/test_pdf_measure.py`:
- the reviewer's page (6,600 characters, 5,000 rectangles) must be judged in under 5 s, every line visible;
- one 12,000 pt line of 6,000 characters under 5,000 bars that each cover a quarter of a character must be refused in under 10 s.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k dense
E       assert 29.847444927028846 < 5.0
FAILED tests/test_pdf_measure.py::test_judging_a_dense_page_does_not_set_every_character_against_every_object
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k too_dense --durations=3
E       Failed: DID NOT RAISE TaskRefusal
34.81s call     tests/test_pdf_measure.py::test_a_page_too_dense_to_judge_is_unprocessable
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov --durations=3
1.30s call     tests/test_pdf_measure.py::test_a_page_too_dense_to_judge_is_unprocessable
0.36s call     tests/test_pdf_measure.py::test_judging_a_dense_page_does_not_set_every_character_against_every_object
46 passed in 3.27s
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_pdf_scan.py tests/test_hostile_documents.py tests/test_document_analysis.py tests/test_document_ocr.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py tests/test_benchmark_document.py tests/test_app_document.py -q --no-cov
448 passed in 197.78s (0:03:17)
$ uv run --frozen python <scratch>/perf6.py        (the reviewer's probe, through real children)
1.8 KB PDF, 4400 characters, 300 small grey rectangles: ok after 0.4s wall      (before: 1.5 s)
3.3 KB PDF, 4400 characters, 2000 small grey rectangles: ok after 0.4s wall     (before: 8.1 s)
4.4 KB PDF, 6600 characters, 5000 small grey rectangles: ok after 0.5s wall     (before: SIGXCPU at 20.1 s)
```

Every hidden reason in the existing tests and in the generated proof-of-address set is judged as before.

## P018 (MEDIUM): a hardened child could read the vision parent's /proc environ

**Confirmed.** `/proc/<pid>/environ` and `/proc/<pid>/fd` are opened under `PTRACE_MODE_READ`, which needs only the same uid. Yama's `ptrace_scope` restricts attaching, not reading. The guarded child runs as the vision user, so after `harden()` it could still read the token Docker started the parent with, and open the parent's spooled uploads through `fd`. The empty `env={}` of the spawn did not prevent this.

**The fix.** `guarded.runner.protect_parent()` calls `prctl(PR_SET_DUMPABLE, 0)`, and `create_app` calls it first. A non-dumpable process's `/proc/<pid>` entries belong to root, so a same-user child can neither open them nor attach. `execve` resets each child to dumpable, so the child still reads its own entries (the P010 probe reads `/proc/self/environ`). The function returns `False` where there is no `prctl` (not Linux), and a failing call raises. Neither needs a capability, so it works in the hardened container (`cap_drop: [ALL]`). The function is also called in the test process whenever a test builds the app. That changes nothing a test reads: each child reads its own entries, and the P018 tests start their own parent process.

**RED** (`00694e8f`; `protect_parent` existed and did nothing):
- The probe gains `read_parent`. It reports whether `/proc/<ppid>/environ` is readable, whether the token's name is in it (never its value), and whether `/proc/<ppid>/fd` can be listed.
- `tests/test_guarded.py` starts a parent as Docker would, with only `OPENVERIFY_VISION_SERVICE_TOKEN` in its environment, which runs a hardened probe child. The control (an unprotected parent) must show everything readable. A protected parent must show nothing. A third test checks that `create_app` calls `protect_parent`.

```text
$ uv run --frozen pytest tests/test_guarded.py -q --no-cov -k "parent or protects"
E       AssertionError: assert {'environ_rea...adable': True} == {'environ_rea...dable': False}
E         {'environ_readable': True} != {'environ_readable': False}
E         {'fds_readable': True} != {'fds_readable': False}
E         {'token_seen': True} != {'token_seen': False}
E       AssertionError: assert [] == ['protect']
```

The control passes before and after the fix, so the measurement can see the token.

**GREEN.** Two more tests cover a host without `prctl` and a failing call.

```text
$ uv run --frozen pytest tests/test_guarded.py tests/test_app.py tests/test_app_document.py -q --no-cov
95 passed in 8.00s
$ uv run --frozen pytest tests/test_guarded.py -q --no-cov
52 passed in 11.64s
```

The Stops row of C60.2 now holds, and the Yama advice in `docs/checks/document.md` is no longer needed for the token. That file belongs to the TypeScript fixer, so the change is recorded as a plan amendment in `contractDeviations`. The RED commit's subject shows a literal `\x27` where an apostrophe was meant; I left it, since commits are never amended.

## P011 (MEDIUM): a DSS in the same increment excused a replaced content stream

**Confirmed.** In a DSS increment, `_kind` called any stream with only `/Length` and `/Filter` "DSS data", whatever it was. The reviewer's forgery worked: a signed bill plus one increment replacing the page's content stream (object 5) with a new amount, an empty `<< /Type /DSS >>` and a catalog naming it. It measured `edits_after_signature: False` while the page rendered the new amount.

**The fix.** `_dss_only`:
- A data stream in a DSS increment must be new, not a replacement of an object the document had, and must be named by the increment's DSS or VRI dictionaries (`/Certs`, `/CRLs`, `/OCSPs`, `/Cert`, `/CRL`, `/OCSP`, and VRI maps reached through them).
- A DSS or VRI dictionary may replace only an earlier DSS or VRI, as when a DSS is updated in place. An earlier object rewritten to look like a VRI (a font, say) is an edit.

**RED** (`94569d5d`), in `tests/test_pdf_measure.py` through `analyze`:
- the reviewer's forgery is an edit (and its text layer shows the forged amount);
- a stream the DSS does not name is an edit;
- the amounts' font rewritten as a VRI-shaped dictionary is an edit;
- a DSS updated in place with a new certificate is not an edit. This one passes before and after, to guard the genuine case.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k "dss or vri"
E       assert (1, False) == (1, True)
E       assert False is True
E       assert False is True
FAILED tests/test_pdf_measure.py::test_a_dss_increment_that_replaces_the_page_content_is_an_edit
FAILED tests/test_pdf_measure.py::test_a_dss_increment_with_a_stream_it_does_not_name_is_an_edit
FAILED tests/test_pdf_measure.py::test_an_object_the_document_used_rewritten_as_a_vri_is_an_edit
3 failed, 1 passed, 46 deselected in 1.61s
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_pdf_scan.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py -q --no-cov
336 passed in 380.64s (0:06:20)
```

The long-term-validation variants, both the existing DSS-only test and the generated bank statement signed and then extended, are still no edit.

A residual I did not change: a DSS increment may still rewrite the catalog without restriction, as before. A catalog that switches its page tree to an object of an earlier revision would not count. That needs a second page tree in the signed revision, which only the signer could have written, so I kept the fix to what the finding names.

## P013 (MEDIUM): the scene walk's object cap ended the walk silently

**Confirmed.** `_Scene.walk` returned at `MAX_PAGE_OBJECTS` (20,000) without a flag, and a text object it never reached got `z = 0` from `text_z.get(address, 0)`. I reproduced both of the reviewer's cases in process:

```text
(a) bill, N small rects, then a white box over "Amount due: 48.20":  N=100 -> (False, 'covered');  N=20,500 -> (True, None)
(b) white page box, N small rects, then the bill:                     N=100 -> (True, None);       N=20,500 -> every line (False, 'covered')
walk 50,000 objects: 12.9 s; 100,000 objects: 26.8 s
```

Each object costs about 0.3 ms to walk, so raising the cap would trade this bug for SIGXCPU.

**The fix.** Past the walk's bounds, a page is refused with `pdf_unprocessable`. This covers more than `MAX_PAGE_OBJECTS` objects, or a form nested deeper than `MAX_FORM_DEPTH` that draws anything; such a form's text was never recorded either. Past those bounds neither a cover nor a text object's painting order is known, and the schema has no "not judged" for a line. Pages within the bounds are judged as before.

**RED** (`5b099e88`), in `tests/test_pdf_measure.py`, with the cap lowered to 50, or 200 for the control:
- the control within the bound: the box still covers the amount;
- the cover past the bound and the text past the bound must both be refused;
- text inside forms nested exactly `MAX_FORM_DEPTH` deep is judged (visible), and two levels deeper it must be refused.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k walk
E       Failed: DID NOT RAISE TaskRefusal      (x3)
FAILED tests/test_pdf_measure.py::test_a_page_with_more_objects_than_the_walk_records_is_unprocessable[cover-past-the-bound]
FAILED tests/test_pdf_measure.py::test_a_page_with_more_objects_than_the_walk_records_is_unprocessable[text-past-the-bound]
FAILED tests/test_pdf_measure.py::test_text_in_forms_nested_past_the_walks_depth_is_unprocessable
3 failed, 1 passed, 50 deselected in 3.01s
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_hostile_documents.py tests/test_document_analysis.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py -q --no-cov
323 passed in 91.21s (0:01:31)
```

The bound and the refusal are part of the Workflow 5C amendment recorded in `contractDeviations`. The known limits in `docs/checks/document.md` belong to the TypeScript fixer.

**Timing bounds that a loaded host cannot fail.** While the other fixer's e2e stack ran (load average 73 on 12 CPUs), the P014 refusal test took 13 s against its 10 s wall-clock bound. On its own it takes 1.3 s. My new timing assertions now measure what they bound:
- the two P014 tests take the CPU time of the in-process analysis (`time.process_time()`);
- the P009 dense test times only the reading (`read_regions`, where the fake recognizer sleeps 2 ms a unit) against the hostile set's 20 s. Before the budget the reading slept 37 s.

The bounds are the same, measured more narrowly.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_hostile_documents.py -q --no-cov -k dense
3 passed, 66 deselected
```

## P015 (MEDIUM): an image with its own mask counted as an opaque cover

**Confirmed.** `_drawn_kind` treated every image without graphics-state transparency as opaque over its whole bounding box. `FPDFPageObj_HasTransparency` reads only the graphics state, not the image's own `/SMask`, `/Mask` or `/ImageMask`. A translucent watermark drawn after a genuine bill marked every line `covered`.

PDFium exposes no mask flag. `FPDFImageObj_GetImageMetadata` reports the same bits and colour space for a soft-masked image as for a plain one, and `FPDFImageObj_GetBitmap` drops the mask. But `FPDFImageObj_GetRenderedBitmap` renders the image with its mask, as BGRA, and its alpha channel says where it paints (full-page images on a letter page, 612 × 792):

```text
smask 612 792 min alpha 32 max 32 161.8 ms
stencil 612 792 min alpha 0 max 0 107.0 ms
plain 612 792 min alpha 255 max 255 120.8 ms
colorkey 612 792 min alpha 0 max 0 122.3 ms
jpeg 612 792 min alpha 255 max 255 141.9 ms
```

**The fix.**
- An image is rendered with its own mask once, and only when a character first meets it as a candidate cover. Its alpha plane is kept for the page.
- A pixel paints from alpha 248 up, within 8 levels of opaque, as colours are compared. A character is `covered` when nine tenths of its box lie under painting pixels.
- An image whose render is opaque everywhere is judged by its box, as before.
- An image larger on the page than 4,000,000 pt² (pixels at 72 dpi) is not rendered and covers by its box, as before. It would need a page larger than 2,000 pt a side.
- `page_lines` takes the document handle for the render, which `pdf_measure.analyze` passes.

**RED** (`6c684351`), in `tests/test_pdf_measure.py`:
- a soft-masked watermark (about 12% opaque) over the whole bill, a stencil that paints nothing, and a colour-key mask that masks its only colour must each leave every line visible;
- a plain opaque image must still cover every line;
- an image whose top row is opaque and bottom row transparent must cover only the line under its top half.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k image
FAILED tests/test_pdf_measure.py::test_text_under_an_image_that_paints_little_or_nothing_is_visible[soft-mask]
FAILED tests/test_pdf_measure.py::test_text_under_an_image_that_paints_little_or_nothing_is_visible[stencil]
FAILED tests/test_pdf_measure.py::test_text_under_an_image_that_paints_little_or_nothing_is_visible[colour-key]
FAILED tests/test_pdf_measure.py::test_an_image_covers_only_the_text_under_its_opaque_part
4 failed, 1 passed, 54 deselected in 0.49s
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov
59 passed in 3.97s
$ uv run --frozen pytest tests/test_pdf_measure.py tests/test_hostile_documents.py tests/test_document_analysis.py tests/test_document_ocr.py tests/test_synthetic_poa*.py tests/test_contract_fixtures.py tests/test_benchmark_document.py -q --no-cov
357 passed in 370.78s (0:06:10)
$ uv run --frozen python <scratch>/poc7.py; uv run --frozen python <scratch>/poc16.py      (the reviewer's probes)
watermark with /SMask drawn after text:  every line True None
[('UTOPIA WATER BOARD', True, None), ('Statement date: 30 S', True, None), ('Account number: 4471', True, None)]
```

## P016 (MEDIUM): a clip on a form's invocation never reached the form's text

**Confirmed.** `_Scene.walk` composed only a form's matrix and read clips from the text objects themselves. A form's own clip path (`q 0 0 1 1 re W n /Fm1 Do Q`) was never applied to what the form draws, so fully clipped text read visible.

**The fix.** When the walk enters a form, it reads the form object's clip boxes, transforms them into page space by the matrix the form is drawn under, and hands them down. Every text object inside then carries them with its own clip boxes, and they accumulate through nested forms. A clip that holds the text leaves it visible.

**RED** (`13f2d589`), in `tests/test_pdf_measure.py`:
- a form drawn plainly: visible, a control;
- a form under a 1 × 1 pt clip, on its own and three forms deep: must be `clipped`;
- a clip that holds the form's text: visible, a control.

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov -k form
E       AssertionError: assert (True, None) == (False, 'clipped')      (x2)
FAILED tests/test_pdf_measure.py::test_text_drawn_by_a_form_under_a_clip_is_clipped[form]
FAILED tests/test_pdf_measure.py::test_text_drawn_by_a_form_under_a_clip_is_clipped[nested-forms]
2 failed, 4 passed, 57 deselected in 0.55s
```

**GREEN.**

```text
$ uv run --frozen pytest tests/test_pdf_measure.py -q --no-cov
63 passed in 4.88s
$ uv run --frozen pytest tests/test_synthetic_poa.py tests/test_synthetic_poa_pdf.py tests/test_contract_fixtures.py tests/test_hostile_documents.py -q --no-cov
178 passed in 50.79s
$ uv run --frozen python <scratch>/poc14.py        (the reviewer's probe)
form drawn plainly              : [('UTOPIA WATER BOARD', True, None), ('Statement date: 30 September 2', True, None)]
form drawn under a 1x1 pt clip  : [('UTOPIA WATER BOARD', True, None), ('Statement date: 30 September 2', False, 'clipped')]
direct text under a 1x1 pt clip : [('UTOPIA WATER BOARD', True, None), ('Statement date: 30 September 2', False, 'clipped')]
```

## P017 (MEDIUM): huge numbers raised in the scanner and crashed the child

**Confirmed.** Three sites raised:
- `int(token)` on a numeric token past CPython's 4,300-digit limit raised ValueError;
- a stream `/Length` of 2**63 or more overflowed the regex position (`OverflowError` in `_stream_span`);
- the object-stream header's integers went through `int()` as well.

Nothing caught any of them, so the child exited 1 and the API retried a 503.

**The fix.**
- An integer token of more than `MAX_NUMBER_DIGITS` (18) digits is kept as no value (`None`). No offset, length or object number needs more, and 18 digits stay under a C `ssize_t`.
- A `/Length` that runs past the data falls back to the `endstream` search.
- An object-stream header holding such a number is not read, and the scan is marked truncated, so P012 refuses the document.
- `pdf_measure.analyze` turns any ValueError or OverflowError still escaping the scanner into `pdf_unprocessable`.

**RED** (`ddd48090`):
- `tests/test_pdf_scan.py`: a 4,400-digit integer, a `/Length` of 2**63, a `/Length` of 30 digits and an object-stream header with a 4,400-digit number must all scan; the huge number is kept as `None`.
- `tests/test_hostile_documents.py`: the reviewer's two files (the bill with `/Length 9223372036854775808`, and with a 4,400-digit integer in its Info dictionary) must be analysed through a real child.

```text
$ uv run --frozen pytest tests/test_pdf_scan.py tests/test_hostile_documents.py -q --no-cov -k "number or huge"
E           ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has 4400 digits
src/openverify_vision/guarded/pdf_scan.py:576: ValueError
E           OverflowError: Python int too large to convert to C ssize_t
src/openverify_vision/guarded/pdf_scan.py:641: OverflowError
E           openverify_vision.guarded.runner.GuardedWorkerError: guarded worker failed: exit_status
7 failed, 1 passed, 94 deselected in 1.60s
```

**GREEN.** One more test covers the refusal of a scanner failure.

```text
$ uv run --frozen pytest tests/test_pdf_scan.py tests/test_hostile_documents.py tests/test_pdf_measure.py -q --no-cov
165 passed in 22.31s
$ (the reviewer's fuzz1.py, seeds 1-4, 475 mutated PDFs each, in process)
seed 1: 343 ok, 132 refusal:pdf_unprocessable
seed 2: 336 ok, 139 refusal:pdf_unprocessable
seed 3: 317 ok, 158 refusal:pdf_unprocessable
seed 4: 342 ok, 133 refusal:pdf_unprocessable
```

No exception and no timeout in 1,900 files, where the reviewer's run had 61 ValueErrors and 3 OverflowErrors.

## P022 (MEDIUM): Android kept the old signature when the user asked for a new message

**Confirmed.** `MessageToSign` read the signature and the signed message from `InputDrafts` under keys made of the step id alone. The view model clears drafts only when the step changes, and `changeCryptoWallet` and `createCryptoChallenge` never touch them. So after "use another wallet" and a new message, the old message's paste was still in the field and Submit was already enabled. One tap would have spent the new challenge on a signature over the wrong message.

**The fix.** The two drafts are keyed on the challenge too (`<step>:<challenge id>:signature`, `...:signed-message`). A new message starts empty, while the same message shown again, after a retry or a rotation, keeps what was pasted. This matches the web step, which clears both fields in `getMessage()`. The chain and the address keep their keys, so "use another wallet" still shows what the user typed there.

**RED** (`c63e22c2`), in `CryptoWalletStepScreenTest` (host test):
- a Solana message is given a signature and a signed message; then come the entry, and a new message. Submit must be off, and what is typed next must be exactly what is sent;
- a control: the same message, busy and back again, keeps its paste.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.steps.CryptoWalletStepScreenTest"
java.lang.AssertionError: Failed to assert the following: (is not enabled)
  ... Role = 'Button' ... Text = '[Submit signature]'
11 tests completed, 1 failed
```

**GREEN.** The existing busy test wrote the old key directly into the drafts. It now writes the new key, so it still checks that a pasted signature cannot be sent while the last one is on its way.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.steps.CryptoWalletStepScreenTest" --tests "dev.openverify.sdk.InquiryViewModelTest"
(no failures; CryptoWalletStepScreenTest: 11 test cases)
```

## Not changed

- **K12:** already pinned by `infra/tests/apps-image-context.test.sh`; the mutation above shows that check can fail.
- **The contract fixtures:** `contracts/fixtures/vision/` is byte-identical. No fix changes what the golden files cover (`tests/test_contract_fixtures.py` passes), so no TypeScript test that reads them is affected.

## Final gates

Each gate ran in the foreground, except where a run outlived a 10-minute call and continued in the background until it finished.

```text
$ cd services/vision && uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-fix-other
All checks passed!
195 files already formatted
Success: no issues found in 78 source files
$ COVERAGE_FILE=/tmp/openverify-cov-fix-other uv run --frozen pytest
Required test coverage of 80% reached. Total coverage: 97.42%
2531 passed in 852.28s (0:14:12)
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 3m 7s
191 actionable tasks: 41 executed, 150 up-to-date
(openverify-sdk host tests: 1,258, two more than the CI floor of 1,256)
$ flock /tmp/openverify-e2e.lock bash infra/tests/compose.test.sh          (static and live)
# 329 passed, 0 failed
$ bash infra/tests/apps-image-context.test.sh
# 14 passed, 0 failed
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   69 passed (26.0s)
@openverify/e2e:e2e:   82 passed (8.8m)
 Tasks:    10 successful, 10 total
```

No file under `infra/docker/` changed, so the image builds were not required. The e2e stack starts vision from the working tree through `create_app`, so it ran every vision change, `protect_parent` included.
