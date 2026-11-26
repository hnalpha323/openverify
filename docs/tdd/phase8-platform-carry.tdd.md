# Phase 8, Workflow 8D Stage 1: `platform-carry`

Owner paths: `e2e/package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` (the `@axe-core/playwright`
change only), `THIRD_PARTY_LICENSES.md` (section 5 rows), `e2e/tests/support/ui-axe.ts`, the three
console specs `ui-workflows`, `ui-cases` and `ui-reviewer` with their support files, `apps/flow/`
(K8-33) and `services/vision/` (K8-34). Base: `3e0652f1`. Every command ran after
`source scripts/env.sh`; outputs are abbreviated, never edited.

## Slice 1: the axe dependency and the helper (committed first, for the console agents)

### The dependency (`3be3197c`)

Read from the registry (`pnpm view <name> time --json`) on 2026-11-04T00:03Z, and each licence from
the installed package's own `LICENSE` file:

| Package | Version | Released | Age at install | Licence (file) | Install scripts |
|---|---|---|---|---|---|
| `@axe-core/playwright` | 4.14.0 (newest stable) | 2026-10-15T13:33Z | 19 days | MPL-2.0 (`LICENSE`: "Mozilla Public License, version 2.0") | none (`prepare` runs only in its own repo) |
| `axe-core` | 4.14.0 (`~4.14.0` from the above; newest stable) | 2026-10-05T17:43Z | 29 days | MPL-2.0 (`LICENSE`); `LICENSE-3RD-PARTY.txt` lists the MIT and ISC code it bundles | none |

`@axe-core/playwright` is MPL-2.0 itself, not only `axe-core`, so both have a section 5 row. Its peer
`playwright-core` resolves to the 1.64.1 the suite already has.

```text
$ flock /tmp/openverify-pnpm.lock pnpm install
✓ Lockfile passes supply-chain policies (verified 6h ago)
Packages: +2
Done in 1.4s using pnpm v12.14.0
$ git diff --stat
 e2e/package.json    |  1 +
 pnpm-lock.yaml      | 23 +++++++++++++++++++++++
 pnpm-workspace.yaml |  5 +++++
```

pnpm added no `minimumReleaseAgeExclude` entry and no override; neither package has a build script, so
no `allowBuilds` entry. The catalog entry is `'@axe-core/playwright': 4.14.0`, and `e2e/package.json`
names it `catalog:`.

### The helper, test-first

Stub `63741ee2` (`e2e/src/axe.ts`: `AXE_WCAG_TAGS = []`, `axeViolationLines` answering `[]`).

RED `d8a972a1` (`e2e/src/axe.test.ts`):

```text
$ (cd e2e && pnpm exec vitest run src/axe.test.ts --coverage.enabled=false)
     × are the WCAG 2.0, 2.1 and 2.2 A and AA tags axe-core 4.14 knows, and no AAA or best-practice tag
     × names each violation by rule id, impact, help and target, one line per target
     × joins a target inside a frame or a shadow root, and says when axe gave no impact
AssertionError: expected [] to deeply equal [ 'wcag21a', 'wcag21aa', …(3) ]
AssertionError: expected [] to deeply equal [ …(3) ]
AssertionError: expected [] to deeply equal [ …(2) ]
      Tests  3 failed | 2 passed (5)
```

The two that pass are "names nothing when axe found nothing" and the licence guard (axe in the
lockfile's `e2e` importer alone), which is a rule, not this slice's behaviour. A first run of the
guard failed for a reason in the test, not the code: `pnpm-lock.yaml` holds pnpm 12's own
environment as a first YAML document with an `importers:` key of its own, so the guard reads the
last `importers:`. The RED commit compiled under Vitest but not under `tsc` with
`exactOptionalPropertyTypes` (the test passes `impact: undefined`); `ec5a5aff` widens the stub's type
to `string | null | undefined` so the RED commit's tree typechecks, without changing what it asserts.

GREEN `17526b3b`: `AXE_WCAG_TAGS` is `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. axe-core
4.14 tags no rule `wcag22a` (listed from `axe.getRules()`: `wcag21a wcag21aa wcag22aa wcag2a wcag2aa
wcag2aaa`), so that tag would select nothing. `e2e/tests/support/ui-axe.ts` exports
`expectNoAxeViolations(page, where)`: `new AxeBuilder({ page }).withTags(...)`, then
`expect(axeViolationLines(violations), 'axe violations on <where>').toEqual([])`, one line per
violation and target, `rule (impact) at target: help`. No rule is disabled and no element excluded.

```text
$ (cd e2e && pnpm exec vitest run src/axe.test.ts --coverage.enabled=false)
      Tests  5 passed (5)
$ (cd e2e && pnpm exec tsc --noEmit -p .)          exit 0
$ (cd e2e && pnpm exec eslint src/axe.ts src/axe.test.ts tests/support/ui-axe.ts)   exit 0
```

## K8-33: the load-sensitive selfie flow test (`apps/flow`)

`apps/flow/src/steps/selfie-capture-step.test.tsx`, "takes each side pose once the head turned from
the user's own centre frame": `waitFor(onSubmitted)` ran out at 10 s once at a load of 13.5 (8B
Stage 1a amendment 31). Six parallel runs at a load of 17 passed in 0.3 to 0.6 s each, so it is no
slow test: a 10 s time-out means a stall.

### The cause

The fake flow API answers in microtasks, so the photo's upload and the next prompt's state land in
one React render: the "uploading" render, which empties the guidance, never commits. The step
commits "Photo 3 of 3: Turn your head to the right" while `useGuidance` still returns the left
prompt's last state ("Hold still", auto-capture done). The right prompt's guidance starts in a
passive effect. When the render takes longer than React's 5 ms scheduler slice, as under load,
the scheduler yields between the commit and that effect, and the test's `waitFor`, woken by the
DOM change, runs in between: it reads the stale "Hold still", moves the fake clock from 2000 to
2500, and only then does the right guidance start, at 2500, so its hold never reaches 500 ms and
nothing is ever taken. (8B's probe that ruled out a left-over "hold still" ran without the yield.)

Reproduced deterministically with a probe (not committed): the same test with `performance.now`
advancing 10 ms a call, so React's scheduler yields after every task:

```text
$ (cd apps/flow && pnpm exec vitest run src/steps/zz-k833-probe.test.tsx --coverage.enabled=false)
 × PROBE slow scheduler: takes each side pose ... 10421ms
   → expected "vi.fn()" to be called 1 times, but got 0 times
PROBE at Photo 3 the overlay reads: Hold still… clock 2000
PROBE after the right advance: clock 2500
PROBE uploaded selfie-center,selfie-left overlay Hold still…
```

The same stale state is a product glitch too: for a frame the new prompt shows the old prompt's
message, and a stale `manualShutter: true` would enable the shutter with the old prompt's yaw.

### RED `e687f67b` (`use-guidance.test.tsx`, new)

Two tests record every render of `useGuidance` through a probe component (one provider value, so a
rerender keeps the tree):

```text
$ (cd apps/flow && pnpm exec vitest run src/selfie/use-guidance.test.tsx --coverage.enabled=false)
 × never returns the previous prompt’s state for the next prompt
   → expected [ 'center', 'left' ] to not include 'center'
 × starts a retaken photo of the same pose from nothing, never from the last shot’s hold
   → expected [ true, false, false, false, …(40) ] to not include true
      Tests  2 failed (2)
```

(A first draft rerendered through `renderWithFlow`'s result, which drops the provider and so
remounted the hook: the first test passed for the wrong reason and the second waited on a real
`sampleFrame`. The committed RED keeps the tree.)

### GREEN `e48a3053`

`useGuidance` keeps its state with the prompt key it belongs to and returns it only for that key,
`null` otherwise (no message, no manual shutter until the prompt's own guidance starts, as on the
first prompt).

```text
$ (cd apps/flow && pnpm exec vitest run src/selfie/use-guidance.test.tsx src/steps/selfie-capture-step.test.tsx --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  36 passed (36)
$ # the slow-scheduler probe again, three times, then deleted
 ✓ PROBE slow scheduler: takes each side pose ... 488ms   (and 488ms, 420ms)
```

The K8-33 test itself is unchanged: with the stale state gone, its `waitFor('Hold still')` can only
be met by the right prompt's own guidance, which started at 2000.

## K8-34: the load-sensitive PDF test (`services/vision`)

`tests/test_pdf_measure.py::test_a_page_too_dense_to_judge_is_unprocessable` asserted
`time.process_time()` under 10 s and measured 12.1 s once beside another suite.

### What burns the CPU

A probe pytest plugin (not committed) read every thread's CPU from `/proc/self/task/*/stat` before
and after the test:

| Run | Load | Process CPU | Test thread | Other threads |
|---|---|---|---|---|
| alone, `--no-cov` | 17.0 | 2.35 s | 2.35 s | 0 (23 threads, none ran) |
| after second-half files 59 to 71, `--no-cov` | 17.2 | 1.50 s | 1.50 s | 0 (35 threads, none ran) |
| alone, with the suite's coverage (`branch = true`) | 16.6 | 8.27 s | 8.28 s | 0 |
| alone, `COVERAGE_CORE=pytrace` | 15.0 | 60.67 s | 60.66 s | 0 |

No thread spins: the CPU is the test thread's own, and the coverage tracer on its 2,000,001-check
Python loop multiplies it (with load adding the rest). The pure-Python tracer reproduces the
failure every time:

```text
$ COVERAGE_CORE=pytrace uv run pytest -q -p no:cacheprovider --cov-fail-under=0 tests/test_pdf_measure.py -k too_dense
>       assert time.process_time() - started < 10.0
E       assert (76.9594481 - 16.6938721) < 10.0
1 failed, 63 deselected in 81.73s
```

### The deterministic test (`229844e1`)

The bound is now the work: the test keeps the page's `_Index` and asserts the refusal came at the
first check past the budget, `[index.checks] == [MAX_SCENE_CHECKS + 1]` (the page alone would cost
30 million). No product code changed. Mutation check, with `text_layer._Index._check` refusing only
past `2 * MAX_SCENE_CHECKS` (restored afterwards):

```text
$ uv run pytest -q --no-cov tests/test_pdf_measure.py -k too_dense          # new test, mutated budget
E       assert [4000001] == [2000001]
1 failed, 63 deselected in 3.93s
$ uv run pytest -q --no-cov tests/test_zz_k834_old.py -k too_dense           # the old test (HEAD), same mutation
1 passed, 63 deselected in 4.47s
$ uv run pytest -q --no-cov tests/test_pdf_measure.py -k too_dense          # new test, real code
1 passed, 63 deselected in 2.17s
$ COVERAGE_CORE=pytrace uv run pytest -q --cov-fail-under=0 tests/test_pdf_measure.py -k too_dense
1 passed, 63 deselected in 72.54s
$ uv run ruff check tests/test_pdf_measure.py && uv run ruff format --check tests/test_pdf_measure.py   exit 0
$ uv run mypy src tools tests/test_pdf_measure.py          Success: no issues found in 80 source files
```

So the old CPU bound could not see a doubled budget, and the count can.

### The sibling bound (`0c1a60c7`)

`test_judging_a_dense_page_does_not_set_every_character_against_every_object` had the same proxy,
`process_time() < 5.0` (2.77 s under coverage at a load of 16.9 in the probe), and it failed this
agent's own vision gate, part 2 of 3 at a load of about 18:

```text
>       assert elapsed < 5.0
E       assert 5.260528699999952 < 5.0
1 failed, 918 passed in 516.85s
$ COVERAGE_CORE=pytrace uv run pytest -q --cov-fail-under=0 tests/test_pdf_measure.py -k dense_page
E       assert 25.852978100000005 < 5.0
1 failed, 63 deselected in 60.90s
```

Its claim is that each character meets only the objects over its own part of the page. A count of
the page's index (a scratch script) gives 0 checks for its 6,600 characters: no rectangle lies over
any character's cell. The test now asserts `[index.checks for index in indexes] == [0]`; both tests
take their index through one helper, `kept_indexes(monkeypatch)`. Grid mutations (`INDEX_GRID = 2`)
refuse the page in the old and the new test alike; any grid of 3 or more still gives 0, which is
the claim.

```text
$ uv run pytest -q --no-cov tests/test_pdf_measure.py
64 passed in 7.96s
```

The file still holds one wall-clock bound, `test_a_content_stream_bomb_is_refused_quickly`
(`time.monotonic() < 5`); it has not failed and is left as it is (a followup).

## Item 1: axe on every Phase 8 console page (R015's axe half; C141.8, C142.6)

`165ff64b` adds `expectNoAxeViolations(page, where)` after each page has loaded (a heading, form,
table or region the test already waits for):

| Spec | Page (axe's `where`) | Result |
|---|---|---|
| `ui-workflows.spec.ts` | `/workflows`, `/workflows/[id]/draft`, `/workflows/[id]`, `/workflows/runs/[id]` (test 1), `/secrets` (test 2) | no violation |
| `ui-workflows.spec.ts`, new test 4 | `/inquiries/[id]` with its "Decision records" region (an inquiry of the spec's own, completed through simulate actions); `/accounts/[id]` with its "Workflow actions" region (a new account type, a running `trigger-account` workflow, an account action and an account, all of the spec's own; the action and the workflow are archived in `finally`) | no violation |
| `ui-cases.spec.ts` | `/case-templates/[id]/versions/[id]`, `/case-queues/[id]`, `/cases` (the queue's filtered list), `/cases/exports`, `/case-settings` | no violation |
| `ui-reviewer.spec.ts` | `/cases/[id]` after load, with the compare panel in use, and once resolved | **violations in apps/dashboard: left out of the committed spec** |

Runs on one fresh reusable stack (started 00:36Z after the stack down and the build line), each
under `flock /tmp/openverify-e2e.lock` with `OPENVERIFY_E2E_REUSE_STACK=1`:

```text
$ playwright test tests/ui-workflows.spec.ts     (load 8.1)
  ✓ 1 a developer creates, outlines by keyboard, checks, saves, publishes ... (15.4s)
  ✓ 2 the secrets page creates a key ... (3.4s)
  ✓ 3 the draft editor loads under an injected nonce script and style CSP ... (1.3s)
  ✓ 4 an inquiry’s decision records and an account’s workflow actions pass axe ... (4.8s)
  4 passed (28.6s)
$ playwright test tests/ui-cases.spec.ts         (load 9.3)
  4 passed (38.5s)
$ playwright test tests/ui-reviewer.spec.ts      (load 10.3; with the three case-page checks)
  ✘ 1 a reviewer compares, comments, runs a case action ... (7.4s)
    Error: axe violations on /cases/[id]
    + "dlitem (serious) at .lg\\:grid-cols-4 > .gap-0\\.5:nth-child(1) > dt: <dt> and <dd> elements must be contained by a <dl>",
    ... (16 dlitem lines: the dt and dd of each of the 8 details)
    + "label-content-name-mismatch (serious) at div[aria-label=\"Government ID front viewer\"] > .print\\:hidden.flex-wrap.gap-1 > .min-h-6.min-w-6[aria-label=\"Reset\"]: Elements must have their visible text as part of their accessible name",
    + "label-content-name-mismatch (serious) at div[aria-label=\"Selfie, centre pose viewer\"] > ... [aria-label=\"Reset\"]: ..."
  1 failed
```

That failure is the helper's RED in practice: it fails on real violations, naming rule, impact and
target. A probe copy of the reviewer spec (deleted) logged instead of failing, to read every state:
after load, with the compare panel in use and once resolved, each has the same 18 lines and 33
passing rules, and nothing else.

### The case page's violations, for the console reviewer and the console fixer

1. **`dlitem` (serious), 16 nodes**: every `dt` and `dd` of the "Case details" list.
   `apps/dashboard/src/components/cases/reviewer/case-sections.tsx`, `CaseDetails` (the `<dl
   role="group" aria-label="Case details">` at about line 94): the `group` role takes the list
   semantics away from the `dl`, so its `div`-wrapped `dt` and `dd` have no list. A fix keeps a
   plain `dl` inside a labelled group (for example a `div role="group"` around it), or names the
   section another way; `ui-reviewer.spec.ts` reads `getByRole('group', { name: 'Case details' })`.
2. **`label-content-name-mismatch` (serious, WCAG 2.5.3), 2 nodes**: the Reset button of each
   viewer. `apps/dashboard/src/components/cases/reviewer/compare-viewer.tsx`, `button('Reset', {
   kind: 'reset' }, '0')` (about line 233) with `button` at about line 182: the visible symbol "0" is
   not part of the accessible name "Reset" (the other symbols are not letters or digits, so axe
   skips them). A fix names it so the visible text is inside the name (for example "Reset (0)") or
   shows the word.

Once both are fixed test-first, the console fixer adds `await expectNoAxeViolations(page,
'/cases/[id]')` after the case details load, after the compare panel is used, and once resolved
(the three places the probe used); the spec's header says so.

## Requests

`git log --grep='REQUEST for platform-carry'` found none. This agent sent none.

## Final gates (each exit code read from its own log file)

| Command | Result | Time, load |
|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | exit 0, "Lockfile is up to date" | 00:45Z |
| `pnpm format:check` | exit 0 | |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --filter=@openverify/e2e --filter=@openverify/flow` | exit 0, 4 of 4 tasks | 61 s, load 8.4 |
| `pnpm --filter @openverify/flow test` | exit 0, 81 files, 1,105 tests, 95.48% statements, 89.46% branches | 82 s, load 9.9 |
| `pnpm --filter @openverify/e2e test` (`e2e/src/axe.ts` is new) | exit 0, 16 files, 118 tests, 97.3% statements, 90.96% branches | |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | exit 0, 79 passed | 28 s, load 11.6 |
| vision (1): `uv run ruff check && uv run ruff format --check && uv run mypy src tools` | exit 0, 79 source files | |
| vision, two halves at 58 (first try) | first half exit 0, 1,470 passed (354 s, load 10.4 to 7.7); second half exit 124 at the 590 s cap (load 7.7 rising to 32) | not a pass |
| vision, three parts at 40 and 75 (second try) | part 2 exit 1: the sibling bound above, 918 passed | not a pass; fixed test-first (`0c1a60c7`) |
| vision, three parts at 40 and 75 (third try, back to back, parts 2 and 3 with `--cov-append`, only part 3 gating) | exit 0, 992 passed (249 s, load 15.7 to 19.9); exit 0, 919 passed (400 s, load 19 to 19.8); exit 0, 689 passed (447 s, load 19.9 to 12.3), total coverage 97.50% | 2,600 tests |
| own specs, one locked call: stack down, the build line, stack up, `ui-workflows`, `ui-cases` and `ui-reviewer`, stack down | exit 0, 11 passed (1.4 min) | 188 s in all, load 11.1 to 13.8 |

The vision split moved from two halves to three parts because the second half met the 10-minute
cap at a load of 32; no file was dropped. In the final run: ui-cases 5.6, 11.0, 6.9 and 6.2 s;
ui-reviewer 11.7, 2.8 and 2.3 s; ui-workflows 13.9, 4.3, 2.4 and 7.4 s. The full-stack suite grows by
one test (ui-workflows' fourth), to 128 tests in 64 files.
