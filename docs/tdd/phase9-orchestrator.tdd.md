# Phase 9: the orchestrator's slices between Workflows

## The C58.7 classifier bound under load (after Workflow 9A, 2026-11-05)

The full validation of the 9A tree (`28b0a269`, `validate-full.sh`, every package's tests at once under turbo) failed one test, and only that
one:

```
@openverify/checks:test:  FAIL  src/document/classify.test.ts > classifyDocument > classifies four pages of 600 long near-matching lines within two seconds (C58.7)
@openverify/checks:test: AssertionError: expected 2688.005 to be less than 2000
@openverify/checks:test:       Tests  1 failed | 3814 passed (3815)
```

The test already measured CPU time, not the wall clock (`72937dda`). Alone, it takes about 300 ms. It also passed when run alone under 14
busy loops, under 12 memory-thrashing loops, and in the whole `checks` suite under 10 such loops (3,815 passed). CPU time itself grows during
the 25-minute all-package run: the likely causes are frequency throttling and garbage collection counted in the process. Rule 6: make it
deterministic, never retry.

**RED** (`031eaa36`): the case bounds `cpuTimesReference(work)` below 16. That function is the CPU time of the work as a multiple of a fixed
reference workload, measured beside it. `testing.ts` holds a placeholder that throws.

```
$ pnpm exec vitest run src/document/classify.test.ts --coverage.enabled=false -t 'four pages of 600'
× classifies four pages of 600 long near-matching lines within 16 reference workloads, about two seconds (C58.7) 11ms
Error: cpuTimesReference is not built yet
Tests  1 failed | 33 skipped (34)
```

**GREEN** (`28015021`): `cpuTimesReference(run, rounds = 3)` interleaves the reference workload (300,000 string builds and map updates,
about 120 ms) with the run. It keeps the least of each and answers the ratio, so both grow together, and a collection landing in one round
drops out. Ratios, measured by a throwaway probe test that was not committed:

| Run | Ratio |
|---|---|
| alone, no coverage | 2.69, 2.25 |
| alone, coverage on (as the gate runs) | 4.31, 4.52 |
| the work done 8 times (a classifier 8x slower), no coverage | 16.48, 15.17 |
| the same, coverage on | 35.02, 32.47 |

The bound of 16 is about two seconds on this machine and still fails a real slowdown under the gate.

```
$ pnpm test            # packages/checks
Tests  3815 passed (3815)
All files |   98.77 |    91.63 |   99.37 |   98.76 |
$ pnpm typecheck; pnpm exec eslint src/document/testing.ts src/document/classify.test.ts; pnpm exec prettier --check ...
rc=0, rc=0, All matched files use Prettier code style!
```

The other `cpuMilliseconds` bounds in `packages/checks` did not fail. They keep their absolute bounds until one does.

## pypdf 6.21.2 and jsdom's exact pin (C67 date item, R011; after Workflow 9A, 2026-11-05)

pypdf 6.21.2 (uploaded 2026-10-21T16:44:55Z) cleared the 14-day rule at 2026-11-04T16:45Z. R011 (Phase 7 plan): `jsdom` was `^29.1.1` under
catalog comments that promise exact pins. It was to be pinned with the pypdf bump, not at a close.

**RED** (`35d1f788`):

- `packages/config/src/workspace-conventions.test.ts`, "pins every catalog entry exactly from the first "exact pins" comment on". It reads
  the catalog block of `pnpm-workspace.yaml` to the next top-level key.
- `PDF_PINS` in `services/vision/tests/test_dependencies.py`, `test_pdf_measure.py`, `test_document_analysis.py`, and
  `infra/tests/vision-container.test.sh` all expect 6.21.2.

```
$ pnpm exec vitest run src/workspace-conventions.test.ts --coverage.enabled=false -t 'exact pins'
× pins every catalog entry exactly from the first "exact pins" comment on
+   { "name": "jsdom", "spec": "^29.1.1" },
Tests  1 failed | 55 skipped (56)
$ uv run pytest -q --no-cov tests/test_dependencies.py tests/test_pdf_measure.py tests/test_document_analysis.py
E  assert 'pypdf==6.21.2' in ['fastapi>=0.150.0', ...]
E  AssertionError: pypdf 6.21.2            (the NOTICE credit)
E  {'pdf_parser': 'pypdf-6.19.0'} != {'pdf_parser': 'pypdf-6.21.2'}
4 failed, 118 passed
```

**GREEN** (`1044ec0a`):

- `pypdf==6.21.2` in `pyproject.toml`. `uv lock` (14-day `exclude-newer`) resolved 61 packages, with only pypdf updated, 6.19.0 to 6.21.2.
- `jsdom: 29.1.1`. `pnpm install` changed only the catalog specifier in `pnpm-lock.yaml`; the locked version was already 29.1.1.
- The licence is unchanged. `git hash-object` of the installed wheel's `LICENSE` is `ab327d0`, the same blob as `LICENSE` at tags 6.19.0 and
  6.21.2 (tag 6.21.2 is `37761bd`), and the `License-Expression` is BSD-3-Clause.
- The NOTICE, the `THIRD_PARTY_LICENSES.md` row, `docs/checks/document.md`, `contracts/fixtures/vision/analyze-document-pdf.json` and its
  generator now name 6.21.2.

```
$ pnpm exec vitest run src/workspace-conventions.test.ts --coverage.enabled=false        # Tests  56 passed (56)
$ uv run pytest -q --no-cov tests/test_dependencies.py tests/test_pdf_measure.py tests/test_document_analysis.py   # 122 passed
$ uv run pytest -q --no-cov tests/test_schemas_document.py tests/test_contract_fixtures.py                          # 58 passed
$ pnpm exec vitest run src/jobs/phase5b-golden-fixtures.test.ts    # apps/api, Tests  7 passed (7)
$ uv lock --check; pnpm install --frozen-lockfile; prettier --check; eslint; ruff check     # all rc=0
```

The vision image test (`infra/tests/vision-container.test.sh`) and the whole vision suite run in the full validation before the push.

## The OpenAPI test's hook under load (after Workflow 9C, 2026-11-07)

The orchestrator's full validation of the 9C tree (`017d8e36`, `validate-full.sh`, every package's tests at once under turbo, load about 20 on
12 CPUs) passed 21 of its 22 rows and failed one file in `test`:

```
@openverify/api:test:  FAIL  src/openapi.test.ts [ src/openapi.test.ts ]
@openverify/api:test: Error: Hook timed out in 120000ms.
@openverify/api:test:  ❯ src/openapi.test.ts:46:1
@openverify/api:test:  Test Files  1 failed | 686 passed (687)
@openverify/api:test:       Tests  9361 passed | 15 skipped (9376)
```

Alone at a load of 3 the file passed (15 tests, 18.5 s; tests 30% of it). The hook built the app, then formatted the served document with
Prettier to compare it byte for byte with `docs/api/openapi.json` through `toMatchFileSnapshot`. That document is now 8.0 MB (2.9 MB when
`08772f87` gave the file one app for the same reason). Formatting it alone, measured with a throwaway script: 3,071 ms wall, 4,564 ms CPU,
output identical to the committed file. Rule 6: make it cheaper, never raise the guard and never retry.

The fix compares compact texts, `JSON.stringify(JSON.parse(text))`, of the served body and the committed file: the same content and the same key
order (a plain deep comparison would miss a reordered key, which CI has no `openapi:write` diff step to catch). The file's layout stays
`format:check`'s; `openapi:write` (now `OPENVERIFY_OPENAPI_WRITE=1 vitest run src/openapi.test.ts`) formats with Prettier only when it writes.

**Stub** (`46ab6df4`): `compactOpenApi` in `src/test-support/openapi.ts` throws.

**RED** (`974aaa0f`): `src/test-support/openapi.test.ts`.

```
$ pnpm exec vitest run src/test-support/openapi.test.ts --coverage.enabled=false      # apps/api
     × gives the served body and its formatted file one text 55ms
     × tells a changed value apart 1ms
     × tells a changed key order apart, which a plain deep comparison would miss 1ms
Error: compactOpenApi is not built yet
      Tests  3 failed | 1 passed (4)
```

**GREEN** (`a7920d11`): `compactOpenApi` built; `openapi.test.ts`'s hook serves the document once and formats nothing; the snapshot test
compares compact texts, or writes the formatted file first under `OPENVERIFY_OPENAPI_WRITE=1`.

```
$ pnpm exec vitest run src/openapi.test.ts src/test-support/openapi.test.ts --coverage.enabled=false   # load 0.96
      Tests  19 passed (19)
   Duration  15.49s (transform 61%, import 23%, tests 16%)
$ pnpm openapi:write; git diff --exit-code docs/api/openapi.json        # rc=0, rc=0: the writer reproduces the file byte for byte
$ prettier --check (the four files)                                     # rc=0
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --concurrency=1 --filter=@openverify/api   # rc=0, 259 s
```

The file's test time fell from about 5.5 s to about 2.5 s at a quiet load. The `test` row was then run again in the same all-at-once form:

```
$ pnpm turbo run test --force --continue        # 14:08Z, load 1.5 at the start, up to about 14 in the run; 1,740 s
 Tasks:    17 successful, 17 total
@openverify/api:test:  ✓ src/openapi.test.ts (15 tests) 6629ms
@openverify/api:test:  Test Files  688 passed (688)
@openverify/api:test:       Tests  9380 passed (9380)          # statements 94.37%
```
