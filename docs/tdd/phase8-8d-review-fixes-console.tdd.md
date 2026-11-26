# Phase 8, Workflow 8D review: the console fixer

Evidence of `fix-console` for the Workflow 8D review (range `3e0652f1..HEAD`, plus C141 as a whole).
Every command ran after `source scripts/env.sh`, from `apps/dashboard` unless named; outputs are
trimmed, and exit codes were read from the command itself (output sent to a file, never through a
pipe). Each RED test typechecked (`pnpm exec tsc --noEmit -p tsconfig.json`, exit 0) before its
commit.

## K8-36: a key typed on a compare viewer before its keys act (WCAG 2.1.1)

Cause. The viewer was rendered on the server with `tabIndex={0}`, so it took focus, and announced
"Zoom 100%", before hydration attached its `onKeyDown` and before its effect attached panzoom and
registered the controller; `commandFor` then found no controller and returned. The spec waited for
`toBeVisible()` (true for the server's HTML), focused the viewer and typed `+`: under load the key
reached no handler and was lost, which is what shard 3/3 of the 8C API fixer's gate saw
(`Zoom 100%` after the key) and why a re-run alone passed.

Fix. The viewer is focusable (`tabIndex=0`) only once its controller is attached, and says
`aria-busy="true"` until then (an `Attachment` store read through `useSyncExternalStore`, whose
server snapshot is "not attached"; a `setState` in the effect is refused by the forced lint's
`react-hooks/set-state-in-effect`). A keyboard user cannot reach a viewer that would drop the key.
The spec waits for that state (`expectViewerReady`: `tabindex="0"` and no `aria-busy`), never a
sleep, a retry or a longer timeout, and checks focus before typing.

RED `74000459`:
```
$ pnpm exec vitest run src/components/cases/reviewer/compare-viewer.test.tsx --coverage.enabled=false
 × takes focus, and says it is ready, only once its keys act, so no key pressed before is lost (2.1.1, K8-36)
   Error: expect(element).not.toHaveAttribute("tabindex") // element.hasAttribute("tabindex")
 Tests  1 failed | 7 passed (8)                                              (exit 1)
```
GREEN `c20a68f6`: the same run, 8 passed (exit 0); `eslint` on the file exit 0.

## R001 and R002: the case page's axe violations

R001 (`dlitem`, 16 nodes): the "Case details" `<dl>` carried `role="group"`, which takes the list
semantics from every `<dt>` and `<dd>`. It is now a plain `<dl>` inside `<div role="group"
aria-label="Case details">` (the specs read the group by name). R002 (`label-content-name-mismatch`,
WCAG 2.5.3, 2 nodes): each viewer's Reset button showed `0` under the name "Reset"; it now shows its
name ("Reset") and has no `aria-label`. The other buttons show a symbol that is no word (`+`, `−`,
arrows, `⟳`), which axe does not compare.

RED `005893ac`:
```
$ pnpm exec vitest run src/components/cases/reviewer/compare-viewer.test.tsx 'src/app/cases/[id]/page.test.tsx' --coverage.enabled=false
 × names each button by its visible text, or by a symbol that is no word (… R002)
   AssertionError: expected 'Reset' to contain '0'
 × keeps its details a plain description list inside the named group, … (axe dlitem, … R001)
   AssertionError: expected 'DL' not to be 'DL' // Object.is equality
 Tests  2 failed | 31 passed (33)                                            (exit 1)
```
GREEN `d9b32cb6`: `vitest run src/components/cases/reviewer 'src/app/cases/[id]'` 120 passed
(exit 0). `e5e88bbd` drops a `?? ''` the forced lint refused in the R002 test
(`no-unnecessary-condition`).

`ui-reviewer.spec.ts` (`bcde140d`) now runs `expectNoAxeViolations` at the three points its header
named: after load, with the compare panel in use (zoomed and rotated), and once the case is resolved
and its inquiry decided. On a fresh reusable stack (load 2.85, then 2.78):
```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-reviewer.spec.ts'
  ✓ 1 … a reviewer compares, comments, runs a case action, uploads 10 MiB, prints, resolves and decides (12.1s)
  ✓ 2 … the case page loads under an injected nonce script CSP with no violation (1.4s)
  ✓ 3 … the case page and its compare panel load under an injected nonce style CSP as well … (1.5s)
  3 passed (19.0s)                                                            (exit 0)
```

## K8-39: a list-match dismissal on the case page refreshes the case page

The case page's list-match module (`CaseModules`) passes its case id beside the inquiry id as a
hidden field of the dismissal; `dismissListMatch` checks it with `idSchema('case')` (never a path
from the form: `../settings`, `/settings` or an inquiry id is refused before the API is called and
nothing is revalidated) and revalidates `/cases/<id>` as well as the inquiry or account page.

RED `8fe600d7`:
```
$ pnpm exec vitest run src/app/list-matches 'src/app/cases/[id]/page.test.tsx' --coverage.enabled=false
 × refreshes the case page for a dismissal made there, as well as the inquiry page (K8-39)
   AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]
 × refuses a case id ../settings | /settings | inq_… that is not a case’s, … (K8-39)
   AssertionError: expected true to be false // Object.is equality
 × sends the case with a list-match dismissal, so the case page is refreshed as well (K8-39)
   AssertionError: expected { …(2) } to match object { …(2) }
 Tests  5 failed | 29 passed (34)                                            (exit 1)
```
GREEN `1fbfd64e`: the same run, 34 passed (exit 0).

## K8-41: the upload route's size gate for a chunked body

The route keeps its declared-length check (413 before reading anything), and now counts the body as
it streams (a `TransformStream`): past `UPLOAD_LIMIT_BYTES` the stream errors and the route's
`AbortController` aborts the upstream request (`streamCaseAttachmentUpload` takes the signal beside
its 120 s timeout, through `AbortSignal.any`), and the route answers 413 with its own sentence.

RED `c989d971`: a chunked request (a stream body, `duplex: 'half'`, no `Content-Length`) from a
sender that would send 4 MiB past the limit, against an API mock that reads the body as fetch does:
```
$ pnpm exec vitest run 'src/app/cases/[id]/attachments/route.test.ts' --coverage.enabled=false
 × counts a chunked body with no Content-Length, and answers 413 past 10 MiB and its framing, aborting the upload (K8-41)
   AssertionError: expected 201 to be 413 // Object.is equality
 Tests  1 failed | 15 passed (16)                                            (exit 1)
```
GREEN `0ab44345`: `vitest run 'src/app/cases/[id]/attachments' src/lib/api/case-attachments.test.ts`
32 passed (exit 0): 413, the mock read at most `UPLOAD_LIMIT_BYTES`, the signal it was given is
aborted. The lib test that the route's signal aborts the fetch was written with the code, after it:
no RED was seen for it.

## R004: manual-run refusals in words

`refusalWords` had no words for `object_id_invalid`, `object_repeated` or `payload_too_large`. The
test reads the codes from the "A manual run, by object" line of `docs/workflows/errors.md` (generated
from the API's list; `reference-docs.test.ts` fails it when stale), as `workflow-words.test.ts`
does, so the list is never written by hand.

RED `c5e72473`:
```
$ pnpm exec vitest run src/components/workflows/manual-runs.test.tsx --coverage.enabled=false
 × says object_id_invalid in words, with its code   AssertionError: expected 'refused (object_id_invalid)' not to match /^refused \(/
 × says object_repeated in words, with its code     × says payload_too_large in words, with its code
 Tests  3 failed | 6 passed (9)                                              (exit 1)
```
GREEN `98d4fcab`: 9 passed (exit 0). `object_repeated` reads "only its first appearance counts",
never that it started a run (the first appearance may itself have been refused).

## R003: the workflow settings, read-only (C143.7)

`SettingsView` (an operator with `settings:read` alone) now shows "Workflows in <environment>": the
run windows, the in-flight cap, the case retention, and each list (ports, HTTPS hosts or "Off: any
public host", recipients, SMS countries or the template's, link hosts; "None" for an empty list). The
private networks show only with `settings:privacy`; without it the view says "Shown with the
settings:privacy permission", never "none". A setting the server does not report is left out.

RED `7505439a` (`src/app/settings/page-workflow.test.tsx`, through the page so the RED typechecks):
```
$ pnpm exec vitest run src/app/settings/page-workflow.test.tsx --coverage.enabled=false
 × shows each workflow setting to a reader with settings:read alone, and no control
 × withholds the private networks without settings:privacy, saying so rather than "none"
 × shows the private networks with settings:privacy
   TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Workflows in Sandbox"
 Tests  3 failed | 1 passed (4)                                              (exit 1)
```
GREEN `5063aca8`: `vitest run src/app/settings src/components/operators` 158 passed (exit 0).

## R005 (part): the canvas's pointer gestures, tested

`onNodesChange` and `onConnect` were the only pointer path that moves or connects a node, and had no
unit test. Their logic is now `canvasChangesOf` and `canvasConnectionOf` (`canvas-changes.ts`), pure
functions the canvas applies: a selection selects, a drag keeps its place until released, a release
writes only the layout member at whole pixels as one `move:<id>` gesture, a read-only canvas only
selects, and a connection goes through `connectionOf` (the outline's port rules) with its message.

Stub `9d4ac399`. RED `f13bb35d`:
```
$ pnpm exec vitest run src/components/workflows/editor/canvas-changes.test.ts --coverage.enabled=false
 × selects a node the pointer selects, and nothing for a deselection   AssertionError: expected [] to deeply equal [ 'wait' ]
 × keeps a node where it is dragged, …   × places a released node in the layout alone, …
 × only selects on a read-only canvas, …   × connects through the outline’s port rules, …
 × names a node it has no label for by its id
 Tests  6 failed | 1 passed (7)                                              (exit 1)
```
GREEN `28807184`: `vitest run src/components/workflows` 255 passed (exit 0).

Not built (skipped, a C141 deferral): loop and module steps in the palette, loop back-edges in the
connect rules (a command that makes an edge into a loop's `continue` port), and the condition
builder's while-condition and list-predicate on-null positions.

## Not built: R006

Trust Device on the full stack needs device recognition turned on for the stack's sandbox
environment (an environment-wide privacy setting, with a basis), a template whose consent step shows
the recognition notice, a browser flow session through consent whose collector posts a recognition
component, and the signals job's device, before the inquiry page shows a device to trust. No spec
does any of that yet, and turning the setting on in a shared environment changes what every other
spec's flow session collects, so it is not a local, low-risk fix.

## Gates

Each from the repository root, exit code read from the command (output to a file).

| Command | Result | Time, load |
|---|---|---|
| `pnpm --filter @openverify/dashboard typecheck && … lint && … test` (coverage gate) | exit 0: 419 files, 5,580 tests; all files 96.39 % statements, 89 % branches | 05:22 to 05:35 UTC, load 2.9 to 18.5 |
| `pnpm format:check` | exit 0 | |
| `pnpm turbo run lint typecheck --force` | exit 0, 32 of 32 tasks | 05:37 to 05:45, load 10.8 to 6.3 |
| `flock … pnpm --filter @openverify/flow e2e` | exit 0, 79 passed (25.5 s) | 05:45, load 5.9 to 9.5 |

The first `pnpm --filter @openverify/dashboard lint` of the gate failed on the R002 test's `?? ''`
(`no-unnecessary-condition`); `e5e88bbd` removed it and the gate was run again from the start.

### The e2e gate (three shards, `e2e/README.md`)

- Attempt 1 (05:46 to 05:52): a fresh stack, shard 1/3 exit 0 (46 passed, 4.4 min, load 5.2 to
  1.4). Shard 2/3 stopped at once: the API fixer's gate had taken the stack down and started its
  own (`no reusable e2e stack is running`), not a test failure.
- Attempt 2, a fresh stack at 06:09 (stack start 1.3 min): shard 1/3 exit 0 (46 passed, 5.7 min,
  load 3.6 to 7.6). Shard 2/3 exit 1 (45 passed, 1 failed, 10.2 min, load 7.2 to 19.8):
  `selfie-repeat.spec.ts:53` read the inquiry `pending` right after "Verification submitted"
  under the API fixer's test load. Shard 3/3 exit 1 (43 passed, 2 failed, 10.5 min, load 7.9 to
  20.8): `flow-bundle.spec.ts:31` (no selfie announcement in 45 s) and
  `government-id-review.spec.ts:28` (no "Verification submitted" in 90 s). All three are flow and
  vision specs outside the console's paths, none touched by this fixer; stack taken down.
- Attempt 3, a fresh stack at 06:39: shard 2/3 exit 1 (45 passed, 1 failed, 10.4 min, load 4.3 to
  21.1): `ui-cases.spec.ts:236` crossed its 20 s test budget (calendar import; the page, axe and
  each step answered, nothing refused) at load 21; it passed in attempt 2. Shard 3/3 exit 0
  (45 passed, 6.6 min, load 13.5 to 14.3). Stack taken down.
- Attempt 4, the gate of record, alone on the machine once the API fixer's gates had ended (HEAD
  `76c426c8`, whose commits after `e5e88bbd` touch only API tests and docs): a fresh stack at
  07:14 (start 1.4 min, load 4.5), then
  - shard 1/3: exit 0, 46 passed (4.1 min), load 3.9 to 2.5;
  - shard 2/3: exit 0, 46 passed (4.7 min), load 2.3 to 1.9 (`ui-cases.spec.ts:236` and
    `selfie-repeat.spec.ts:53` among them);
  - shard 3/3: exit 0, 45 passed (4.8 min), load 1.7 to 3.0 (`flow-bundle.spec.ts`,
    `government-id-review.spec.ts` and `ui-reviewer.spec.ts` with its three axe checks among them);
  - `e2e:stack:down` of that stack (the holder `stack.json` named): exit 0.

  137 tests in all, the README's count.
