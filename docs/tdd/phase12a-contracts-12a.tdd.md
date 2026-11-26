# Phase 12A, Workflow 12A Stage 1: contracts-12a (TDD evidence)

Agent: `contracts-12a` (Workflow 12A Stage 1, alone, first). Base `4ea2493bf`. Host: WSL2, every command run in the foreground after `source scripts/env.sh`, except the full vision suite, which ran in the background under `flock /tmp/openverify-heavy.lock`.

Nothing was pushed or dispatched. The docker project `openverify-test` was not touched. The owner's photos and any OCR text from the live stack were never read: the shapes in the plan come from the orchestrator's masked diagnostic, and every value here is synthetic.

## Deliverables

- `docs/plans/phase-12a.plan.md`: the goal, the live failures reproduced on synthetic captures (§2.1), the root causes in the code (§2.2), the generator contract (§3), the C36 amendment (§3.1), each Stage 2 agent's exact paths, changes and acceptance tests (§4), and the decisions and open questions (§6).
- `services/vision/tools/synthetic_quebec.py`: the Quebec-format synthetic licence generator. It renders the front and back (the back with a PDF417 holding an AAMVA payload of invented values), takes phone-like captures, and builds the committed fixtures and the image command.
- `services/vision/tests/test_synthetic_quebec.py`: 17 tests.
- `contracts/fixtures/quebec-dl/ocr-lines.json` and `contracts/fixtures/quebec-dl/aamva.json`: the committed fixtures the TypeScript parsers test against, generated, then formatted with Prettier.

## RED

The test file was written first, against an API that did not exist yet:

```text
$ cd services/vision && uv run --frozen pytest tests/test_synthetic_quebec.py --no-cov -q -p no:cacheprovider
==================================== ERRORS ====================================
_______________ ERROR collecting tests/test_synthetic_quebec.py ________________
ImportError while importing test module '/home/mhnoor/persona-opensource/services/vision/tests/test_synthetic_quebec.py'.
...
tests/test_synthetic_quebec.py:24: in <module>
    from synthetic_quebec import (
E   ModuleNotFoundError: No module named 'synthetic_quebec'
=========================== short test summary info ============================
ERROR tests/test_synthetic_quebec.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.30s
```

The first implementation passed everything except the committed-fixture test, which failed for its intended reason: the files did not exist yet.

```text
$ uv run --frozen pytest tests/test_synthetic_quebec.py --no-cov -q -p no:cacheprovider -x
E       FileNotFoundError: [Errno 2] No such file or directory: '/home/mhnoor/persona-opensource/contracts/fixtures/quebec-dl/ocr-lines.json'
FAILED tests/test_synthetic_quebec.py::test_the_committed_fixtures_are_the_generated_ones
1 failed, 14 passed in 22.06s
```

## GREEN

```text
$ uv run --frozen python tools/synthetic_quebec.py fixtures
$ pnpm exec prettier --write contracts/fixtures/quebec-dl/*.json
contracts/fixtures/quebec-dl/aamva.json 58ms (unchanged)
contracts/fixtures/quebec-dl/ocr-lines.json 46ms
$ uv run --frozen pytest tests/test_synthetic_quebec.py --no-cov -q -p no:cacheprovider
17 passed in 16.16s
```

## Refactor

- **Glyph.** A look at the rendered images showed that Pillow's bundled font has no glyph for `É`, so the header now prints `QUEBEC` unaccented.
- **Silhouette.** The drawn silhouette spilled out of its photo box; it is now drawn on a tile clipped to the box.
- **Lint and types.** Ruff and mypy findings were fixed: keyword typing, a renamed kernel variable, and split assertions.

The fixtures were regenerated and re-checked:

```text
$ uv run --frozen ruff check tools/synthetic_quebec.py tests/test_synthetic_quebec.py
All checks passed!
$ uv run --frozen ruff format tools/synthetic_quebec.py
1 file left unchanged
$ uv run --frozen mypy tools/synthetic_quebec.py tests/test_synthetic_quebec.py
Success: no issues found in 2 source files
$ uv run --frozen pytest tests/test_synthetic_quebec.py -q -p no:cacheprovider -o addopts="" --cov=synthetic_quebec --cov-branch --cov-report=term-missing
Name                        Stmts   Miss Branch BrPart  Cover   Missing
-----------------------------------------------------------------------
tools/synthetic_quebec.py     360     11     42      6    96%   171, 342, 546-550, 587, 603, 646, 837
17 passed in 11.63s
$ uv run --frozen python tools/synthetic_quebec.py fixtures --check; echo "check exit $?"
check exit 0
```

## Baseline of today's vision code on the synthetic captures (plan §2.1)

The script is in the scratchpad, not committed. It calls `detect_document`, `measure_document_quality`, `quality.blur_score`, `decode_barcodes` and `decode_side_barcodes` on each `photograph(...)`, and prints no OCR text.

```text
$ cd services/vision && PYTHONPATH=tools uv run --frozen python <scratchpad>/scripts/baseline.py
DEFAULT_BLUR_MIN=100.0
capture | side | back | doc found | whole blur | doc blur | doc width | pdf417 upload | pdf417 side | module px
flat | front | standard | True | 473.8 | 473.8 | 1100 | - | - | -
flat | back | standard | True | 1022.0 | 1022.0 | 1100 | 1 | 1 | 3.04
phone-1080 | front | standard | False | 75.1 | - | - | - | - | -
phone-1080 | back | standard | False | 188.0 | - | - | 1 | 1 | 2.76
phone-1080-soft | front | standard | False | 17.9 | - | - | - | - | -
phone-1080-soft | back | standard | False | 51.4 | - | - | 1 | 1 | 2.76
phone-1080-blur | front | standard | False | 6.4 | - | - | - | - | -
phone-1080-blur | back | standard | False | 13.6 | - | - | 0 | 0 | 2.76
phone-1080-motion | front | standard | False | 12.8 | - | - | - | - | -
phone-1080-motion | back | standard | False | 24.7 | - | - | 0 | 0 | 2.76
phone-1080-tilt | front | standard | False | 76.4 | - | - | - | - | -
phone-1080-tilt | back | standard | False | 195.6 | - | - | 0 | 0 | 2.76
phone-1080-glare | front | standard | False | 67.8 | - | - | - | - | -
phone-1080-glare | back | standard | False | 148.3 | - | - | 0 | 0 | 2.76
phone-1080-q75 | front | standard | False | 74.2 | - | - | - | - | -
phone-1080-q75 | back | standard | False | 191.3 | - | - | 1 | 1 | 2.76
phone-full | front | standard | True | 16.7 | 251.0 | 2600 | - | - | -
phone-full | back | standard | True | 33.8 | 595.7 | 2600 | 1 | 1 | 7.72
flat | back | dense | True | 905.7 | 905.7 | 1100 | 1 | 1 | 2.27
phone-1080 | back | dense | False | 148.6 | - | - | 1 | 1 | 2.06
phone-1080-soft | back | dense | False | 34.5 | - | - | 0 | 0 | 2.06
phone-1080-blur | back | dense | False | 9.7 | - | - | 0 | 0 | 2.06
phone-1080-motion | back | dense | False | 18.7 | - | - | 0 | 0 | 2.06
phone-1080-tilt | back | dense | False | 152.4 | - | - | 0 | 0 | 2.06
phone-1080-glare | back | dense | False | 111.8 | - | - | 0 | 0 | 2.06
phone-1080-q75 | back | dense | False | 149.5 | - | - | 1 | 1 | 2.06
phone-full | back | dense | True | 28.3 | 517.5 | 2600 | 1 | 1 | 5.77
```

The phone-1080 JPEGs are 200-240 KB, close to the live frames' roughly 180 KB.

## The handwriting finding (plan §2.2)

`handwritingScore` is `0.6·stroke + 0.4·drop`. The live score was 0.39 with a confidence drop of 0.97, so `0.4 × 0.97 = 0.388`, which leaves `stroke ≈ 0.003`. The confidence drop alone crossed `max-handwriting-score` 0.383. The fix is therefore checks-12a's (C10), not vision's; vision-12a only confirms the stroke measure (V4).

## Full vision suite (coverage gate)

```text
$ cd services/vision && flock -w 3000 /tmp/openverify-heavy.lock uv run --frozen pytest -q -p no:cacheprovider -x
...
tools/synthetic_quebec.py                        360     11     42      6    96%   171, 342, 546-550, 587, 603, 646, 837
...
TOTAL                                          13196    244   2512    146    97%
Required test coverage of 80% reached. Total coverage: 97.40%
2742 passed in 629.58s (0:10:29)
```

Prettier checks the committed JSON fixtures:

```text
$ pnpm exec prettier --check contracts/fixtures/quebec-dl/*.json docs/plans/phase-12a.plan.md
All matched files use Prettier code style!
$ git check-ignore -v fixtures/generated/quebec-dl/x.jpg
.gitignore:48:fixtures/generated/	fixtures/generated/quebec-dl/x.jpg
```
