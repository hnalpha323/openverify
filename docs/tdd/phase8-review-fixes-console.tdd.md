# Phase 8, Workflow 8C review: the console fixer

Evidence of `fix-console` for the Workflow 8C review (range `0d27c8f5..HEAD`). Every command ran
after `source scripts/env.sh`, from `apps/dashboard` unless named; outputs are trimmed and exit codes
read from the command itself (output sent to a file, never through a pipe).

## R010 slice 1, and R011: the secrets page (C125, C141.7)

The navigation linked `/secrets` (8C Stage 1 amendment 1) with no route behind it (R011). The fix
builds the page rather than hiding the link: keys, descriptions, allowed hosts and this
environment's value as metadata only (last four, version, rotation), with create, set, rotate and
delete under `secrets:write`. A value is typed into a password control (`autocomplete="off"`), sent
once to `PUT /workflow-secrets/:key/values/<session env>` or `.../rotate`, never trimmed and never
echoed: an empty value is refused at `/data/attributes/secret-value` with "Enter a value." before the
API is called, and a value with a control character is refused by the contract's schema, whose
message does not carry the value.

Stub `21d29f04`. RED `4e4352c6`:
```
$ pnpm exec vitest run src/app/secrets --coverage.enabled=false
 × creates the key with its description and one host per line
 × refuses a key that is not snake_case, by its pointer, without calling the API
 × needs secrets:write  × sets the value in the session’s environment  × rotates the value ...
 × lists each secret by key with its hosts and only the last four of its value
   TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Secrets"
 × offers creating a secret ... Unable to find an accessible element with the role "form" and name "Create a secret"
 × sends the browser the last four only ... AssertionError: expected '{"className":"mx-auto …' to contain 'k9Zq'
 Tests  12 failed | 3 passed (15)                                          (exit 1)
$ pnpm exec tsc --noEmit -p tsconfig.json                                   (exit 0)
```
GREEN `d4635950`: `vitest run src/app/secrets` 15 passed (exit 0). The first GREEN run failed one
test (`expected [ …(2) ] to deeply equal [ '/data/attributes/secret-value' ]`: an empty value broke
both the length and the character rule); the action now says "Enter a value." once. The dialog
tests (`components/workflows/secret-forms.test.tsx`, 2 passed) were written in the GREEN commit,
after the code: no RED was seen for them. `FormDialogButton` gained `accessibleLabel` (a row action
names its row, WCAG 2.4.6), as `ConfirmActionButton` has.

## R010 slice 2: the run page's controls (C120.3 to C120.5, C120.9, C141.6)

`controlRun` (`workflow-runs:write`) resumes an errored run, reruns any finished run (opening the
new run) or cancels one in progress; `redactRun` (`workflow-runs:redact`) deletes a run's values,
offered only while `redacted-at` is null. A resume sends `meta.skip-unknown-effects: true` only when
the operator ticked "Skip the N steps whose outcome is unknown …" (shown when
`step-outcomes.unknown-effect` > 0); otherwise it sends no body and the API refuses a run blocked by
an unknown effect with `run_not_resumable`. Each control sits behind a confirmation that says what it
cannot undo.

Stub `64a28e39`. RED `20e88cfe`:
```
$ pnpm exec vitest run src/app/workflows src/components/workflows/run-actions.test.tsx --coverage.enabled=false
 × resumes without skipping an unknown effect … AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }
 × reruns and answers the new run  × cancels  × redacts the run under workflow-runs:redact
 × asks a resume to acknowledge … Unable to find an accessible element with the role "button" and name "Resume"
 × offers resume and rerun on an errored run with workflow-runs:write  AssertionError: expected null not to be null
 × offers cancel on a run in progress  × offers redaction with workflow-runs:redact …
 Tests  9 failed | 33 passed (42)                                           (exit 1)
$ pnpm exec tsc --noEmit -p tsconfig.json                                    (exit 0)
```
(A first run of the RED failed two more tests on fixture errors, an errored run without its error;
the fixtures were corrected before the RED commit.)

GREEN (next commit): 89 passed in `src/app/workflows src/components/workflows` (exit 0). The page
test gained a `next/navigation` mock (the rerun pushes the new run's route) and the
`getByRole` form lint asks for; no assertion changed.

## R010 slice 3: the draft editor and its outline (C141.2, C141.4)

`/workflows/[id]/draft` shows the draft's outline beside its raw definition (the `JsonEditor`
fallback C141.4 keeps). The outline (`definition-outline-model.ts`, pure) roots the steps at the
trigger, puts each route, the else, branches, loop bodies and error paths in child groups, names a
step reached twice ("Goes on at <id>") instead of repeating it, lists steps no edge reaches under
"Not connected", and counts each step's problems by their pointer under `/steps/<i>`. The view
(`definition-outline.tsx`) is an APG tree with one tab stop: Up, Down, Home, End, Right (expand or
enter), Left (collapse or go to the parent), Enter or a click selects; each item is named by its
own label (`aria-labelledby`), so a group's children are not part of its name. The outline follows
the text as it is typed. "Check" asks `POST /workflows/:id/draft/validate` and saves nothing; "Save
draft" checks, then `PUT`s at the page's lock version only when there is no error, and keeps the new
lock version. Problems are listed by place with "Go to step", which expands the path and moves focus
to the step, and the outcome is said in a polite live region. Without a draft, the editor starts
from the live version (or an empty definition) at lock version 0, which makes the draft on the first
save (C116.1). Without `workflows:write` the definition is read-only. `createWorkflow` is the
workflows page's create form, which opens the new draft.

Stub `65c24232`. RED `a69e017f`:
```
$ pnpm exec vitest run src/app/workflows src/components/workflows --coverage.enabled=false
 × roots the steps at the trigger … AssertionError: expected [] to deeply equal [ …(2) ]
 × counts each step’s problems by its pointer … expected undefined to be 1
 × is a tree named for the definition … Unable to find an accessible element with the role "tree" and name "Outline of the definition"
 × moves with the arrow keys, Home and End … Unable to find … role "treeitem" and name "Trigger: An event"
 × creates the workflow with its empty draft … expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }
 × checks the definition without saving it  × saves a definition that passes its check …
 × refuses text that is not JSON at /definition … expected undefined to deeply equal [ '/definition' ]
 × outlines the draft and offers its definition …  × starts a new draft from the live version …
 Tests  14 failed | 91 passed (105)                                         (exit 1)
$ pnpm exec tsc --noEmit -p tsconfig.json                                    (exit 0)
```
(A first RED run had a fixture with an invalid paused reason, `never_activated`, which tsc caught;
it became `operator` before the commit.)

GREEN `5590fba9`: 105 passed, then 108 with `draft-editor.test.tsx` (the live region's words, the
error count on the step, "Go to step" moving focus, the kept lock version), written in the GREEN
commit after the code: no RED was seen for those three. Lint asked for the focus request to be an
imperative handle (`react-hooks/set-state-in-effect`), not an effect.

## R010 slice 4: create, publish with acknowledgements, rollout, deliveries (C141.5, C118.1)

The workflows page has a create form (`workflows:write`). The workflow page links "Open the draft"
or "New draft" (`workflows:write`) and, with a draft and `workflows:publish`, "Publish the draft": a
dialog with the rollout percentage and the change note. When the API answers
`publish_acknowledgement_missing`, the dialog lists each key it names (`errors[].detail` at
`/meta/acknowledgements`) as an unticked checkbox with its reason from
`WORKFLOW_ACKNOWLEDGEMENT_WORDS` and its step, and the next publish sends only what was ticked;
nothing is acknowledged on the operator's behalf. A rollout in progress (`active-deployment`) shows
its percentage with "Finish the rollout" (100) and "Undo the rollout" (0), each confirmed. The trigger
deliveries (`workflow-runs:read`, `filter[workflow-id]`) list each event with its outcome in words,
its reason code and the run it started.

Stub `7e12933c`. RED `460a89f2`:
```
$ pnpm exec vitest run src/app/workflows src/components/workflows --coverage.enabled=false
 × asks for each acknowledgement the API names … (component)
 × publishes with the rollout, the change note and each ticked acknowledgement
   AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, data: undefined }
 × sends no rollout or note left empty … expected undefined to deeply equal { meta: {} }
 × passes on which acknowledgements the publish still needs, by key
 × sends 100 / 0 and refreshes the workflow page
 × offers the create form with workflows:write only … role "form" and name "Create a workflow"
 × opens the draft, or starts one … role "link" and name "Open the draft"
 × offers publishing the draft only with workflows:publish … role "button" and name "Publish the draft"
 × offers finishing and undoing a rollout in progress … role "group" and name "Rollout"
 × lists the trigger deliveries … role "table" and name "Trigger deliveries"
 Tests  11 failed | 113 passed (124)                                        (exit 1)
```
GREEN `34bca3b6`: 124 passed. Two corrections to the RED, named in the commit, no assertion
weakened: the problem fixture of the acknowledgement test had a JSON:API `source` object where the
API's errors carry `{ location, pointer, detail }` (`problemValidationErrorSchema`), and the
workflows page test gained the `next/navigation` mock the create form needs. The workflow page suite
serves an empty delivery list in its `beforeEach` (in the RED commit), as amendment 4 did for the
decision list.

## K8-5: the network sources RSC payload test's positive control

"holds no address on the network sources page" asserted only `expectNoPersonalValue`, so it passed on
an empty payload. It now also asserts the payload holds `openverify-sandbox-network`. Test-only. The
RED is the same test run against an empty render: the page's payload replaced by an empty
`<main>` (a local change that was not committed). A first attempt served an empty source list
instead; that failed on the client's response validation (the list answer needs its sources), not on
the assertion, so it is not counted as the RED.
```
$ pnpm exec vitest run src/testing/rsc-payload-signals.test.tsx -t "network sources" --coverage.enabled=false
 × holds no address on the network sources page
   AssertionError: expected '{"children":null}' to contain 'openverify-sandbox-network'
 Tests  1 failed | 3 skipped (4)                                             (exit 1)
```
With the page rendered (`f4af18e9`): 4 passed (exit 0).

## R012: case action parameters typed by the C115.3 DSL (MEDIUM, confirmed)

Confirmed by reading `app/cases/[id]/actions.ts` (`parameterValue` switched on `object`, `array`,
`json`, `number`, `integer`, `boolean`) and `case-action-form.tsx` (`STRUCTURED` = `object`,
`array`, `json`): a `list<…>`, `object{…}` or `datetime` input fell to the text default, a fraction
for an integer and a word for a number were passed through. The fix is local: the case form renders
the shared `ParameterFields` and the action reads `parametersOf` (8C Stage 1 amendment 9), refusing
a value that does not hold its type at `/data/parameters/<name>` without calling the API.

RED `5891f402`:
```
$ pnpm exec vitest run src/app/cases/ src/components/cases/reviewer/forms.test.tsx -t "R012" --coverage.enabled=false
 × enters a list or an object input as JSON in a text area … AssertionError: expected 'INPUT' to be 'TEXTAREA'
 × sends a list and an object input as JSON values of their C115.3 types (R012)
   TypeError: Cannot read properties of undefined (reading 'inquiries')   (no parameters sent at all)
 × refuses a fraction for an integer and text for a number … AssertionError: expected [] to deeply equal [ '/data/parameters/priority', …(1) ]
 Tests  3 failed | 124 skipped (127)                                        (exit 1)
```
GREEN (next commit): `vitest run src/app/cases src/components/cases` 163 passed, tsc and eslint exit 0.
The form's field names changed with the shared module (`parameter.<name>`,
`parameter-type.<name>`), so two older tests that asserted the old `parameter-names` /
`parameter-types` encoding were rewritten to the shared one, and the case page tests read a control
by a name that now carries its type (`/reference/`); no assertion was dropped.
`e2e/tests/ui-reviewer.spec.ts` fills `{ name: 'reference' }`, a substring match in Playwright, so
it needs no change.

## R013: the rendition image's unbounded re-request (MEDIUM, confirmed)

Confirmed by reading `components/rendition-image.tsx`: the `RENDITION_ATTEMPTS` cap applied only to
202 answers; a 200 that the browser could not decode made `onError` → check → 200 → remount → error,
without end, and each request is an audited view. The fix counts checks that found the image
ready: one remount after a 200 is allowed (the "ready after all" case the suite already tests), a
second error after a 200 shows "The image could not be loaded." with "Try again", which resets both
counters.

RED (`test(dashboard): a rendition the browser cannot decode …`):
```
$ pnpm exec vitest run src/components/rendition-image.test.tsx --coverage.enabled=false
 × stops when the route answers an image the browser cannot show, instead of asking again without end (R013)
   TestingLibraryElementError: Unable to find an accessible element with the role "status"
 Tests  1 failed | 11 passed (12)                                            (exit 1)
```
GREEN (`fix(dashboard): a rendition that errors again …`): 12 passed; the test asserts the route
was asked exactly twice.

## R014: the compare panel's shortcut target hid its focus (MEDIUM, confirmed)

Confirmed in `components/cases/reviewer/case-view.tsx`: the `tabIndex={-1}` wrapper that
Alt+Shift+V focuses had `focus-visible:outline-none`, while the timeline target has the console
ring. The fix gives it the same ring (`focus-visible:outline-2 outline-offset-2 outline-focus`).
jsdom computes no `:focus-visible` style, so the unit test reads the classes; the full-stack
reviewer spec now asserts, after the chord, that the focused target's computed `outline-style` is
not `none` (run in the e2e gate below).

RED (`test(dashboard): the compare panel shortcut target keeps the console focus ring …`):
```
$ pnpm exec vitest run src/app/cases/ -t "R014" --coverage.enabled=false
 × gives the compare panel’s shortcut target the console focus ring, as the timeline has (R014, WCAG 2.4.7)
   AssertionError: expected [ 'focus-visible:outline-none' ] to not include 'focus-visible:outline-none'
 Tests  1 failed | 112 skipped (113)                                         (exit 1)
```
GREEN (`fix(dashboard): the compare panel shortcut target shows the console focus ring …`):
`vitest run src/app/cases/ src/components/cases` 164 passed.

## R010 slice 5: the diff and restore (C116.5, C116.6, C141.5)

With a draft beside a live version, the draft page reads `GET /workflow-versions/<draft>/diff?
against=<live>` and lists the changes as sentences ("Added step …", "Removed step …", "Changed step
<id>: <pointers>", edges, the trigger, inputs, outputs, variables, "Moved only: …"), so nothing rests
on colour (1.4.1). The version history offers "Restore version N" on each published version that is
not live, under `workflows:publish`, behind a confirmation that says the draft is replaced and that
the restored draft goes live only through a publish; it then opens the draft.

Stub `5ab84480`. RED `d6720467`:
```
$ pnpm exec vitest run src/app/workflows --coverage.enabled=false
 × makes a draft from the version and answers the workflow to open
   AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }
 × lists what the draft adds, removes and changes, in words, never by colour alone
   Unable to find an accessible element with the role "region" and name "Changes against the live version"
 × offers each published version that is not live to restore … role "button" and name `/^Restore version/`
 Tests  3 failed | 69 passed (72)                                            (exit 1)
```
GREEN `8366b3f5`: 130 passed in `src/app/workflows src/components/workflows`; tsc and eslint exit
0. The draft page suite serves an empty diff in its `beforeEach`, since the page now reads it; no
assertion changed.

## R010 and R015 on the full stack: `ui-workflows.spec.ts` and the style CSP

`e2e/tests/ui-workflows.spec.ts` (with `support/ui-workflows.ts`): a developer creates a workflow,
moves through the outline by keyboard alone (Down, Left to the parent, Left to collapse, Right to
expand), types a definition the outline follows before any save, checks it ("No problems found."),
saves it, publishes it through the dialog with a change note, activates it, and reruns a run the API
started from the run page (the new run opens). The secrets page creates a key, sets a canary value
(only its last four come back, the value itself appears nowhere on the page) and deletes it. The
draft editor loads under an injected nonce script and style CSP with no violation.

`support/ui-graph.ts`'s `nonceCsp` and `injectNonceCsp` take `{ styles: true }`, which adds
`style-src 'self' 'nonce-…'` and gives a server-rendered `<style>` the nonce, as a deployment would;
an inline `style` attribute cannot carry one and stays refused. `ui-reviewer.spec.ts` gains the case
page and its compare panel under that policy (R015). Both specs were written after the console code
they test, so no RED was seen for them on the stack; a mutation check shows the style test can fail:
with a `<span style="color: red">` appended in the page, the reviewer style test failed with
`style-src-attr inline` ("Applying inline style violates the following Content Security Policy
directive 'style-src 'self' 'nonce-…''"), exit 1; restored, it passes.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...'   (exit 0)
$ cat /proc/loadavg → 2.20 3.23 3.29;  flock -w 120 /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up   (exit 0)
$ cat /proc/loadavg → 8.17 4.83 3.84
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-workflows.spec.ts'
  ✓ a developer creates, outlines by keyboard, checks, saves, publishes and activates … (3.6s)
  ✓ the secrets page creates a key, sets its value showing only the last four, and deletes it (1.6s)
  ✓ the draft editor loads under an injected nonce script and style CSP with no violation (847ms)
  3 passed (8.6s)                                                            (exit 0)
$ cat /proc/loadavg → 6.93 4.72 3.82
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-reviewer.spec.ts'
  ✓ a reviewer compares, comments, runs a case action … (6.5s)   (with R014's computed-outline check)
  ✓ the case page loads under an injected nonce script CSP with no violation (1.3s)
  ✓ the case page and its compare panel load under an injected nonce style CSP as well … (R015) (1.3s)
  3 passed (12.4s)                                                           (exit 0)
```
(The mutation check's first attempt targeted the third workflows test alone, which depends on the
first test's workflow in the serial file; it failed for that reason, not the mutation, and is not
counted.)

R015's second half, axe on every page, is not done: no axe package is in the repository, and adding
`@axe-core/playwright` (with `axe-core`, MPL-2.0, test tooling under rule 4's exception) changes
`e2e/package.json`, the catalog and the lockfile, which are outside the console fixer's paths and
are a dependency addition the fixer prompt forbids without a blocker (8C Stage 1 amendments 25 and
35 already record it).

## Found by the e2e gate: three ui specs and the rendition image before hydration (amendment 26)

The first e2e gate attempt (fresh stack, flow e2e 79 passed; shard 1/3 44 passed in 4.0 m at a load
of 5.63) failed two tests in shard 2/3 (39 passed, 2 failed, 6.4 m, load 3.06), both in this fixer's
paths, both from 8C Stage 1 changes that amendment 26 left to `fix-console` to confirm:

- `ui-graph.spec.ts:65`: `Expected: "export"  Received: "create-case"`. The bulk action select now
  ends with Create case (C140.6) for a reviewer who may open cases; the spec presses End, checks
  `create-case`, then ArrowUp to `export`, still by keyboard alone.
- `ui-lifecycle.spec.ts:311`: the ID front's `naturalWidth` stayed 0 for 30 s. Scrolling the lazy
  image into view (as `ui-selfie.spec.ts` does) was not enough: the trace showed one request per
  image, `GET /files/<id>/rendition 202 Accepted` with `retry-after: 5`, and no check after it. The
  server-rendered `<img>` got its 202 before hydration, so React never saw the error event and the
  image stayed broken without asking again. A defect of `components/rendition-image.tsx`, fixed
  test-first: a ref callback checks an image that is `complete` with `naturalWidth` 0 at mount (a
  lazy image not loaded yet is not complete, so it is left alone).

RED `48ef23d3`:
```
$ pnpm exec vitest run src/components/rendition-image.test.tsx --coverage.enabled=false
 × asks the route when the image already failed before the page was hydrated, whose error React never saw
   AssertionError: expected "vi.fn()" to be called once with arguments: [ …(2) ]
 Tests  1 failed | 12 passed (13)                                            (exit 1)
```
GREEN `5ceb01ce`: 13 passed (and 38 with the verification image and selfie evidence suites);
eslint asked to drop a condition that was always true. The spec changes are `8b1d260e`
(`ui-console-gaps.spec.ts` gets the same scroll, preemptively, since it waits on the same image).

## Final gates (foreground, exit codes read from the command, outputs in files)

```
$ pnpm --filter @openverify/dashboard typecheck && pnpm --filter @openverify/dashboard lint && pnpm --filter @openverify/dashboard test
  (first run, before the rendition fix; load 3.42)
 Test Files  383 passed (383)   Tests  5269 passed (5269)
 All files | 96.89 | 89.99 | 97.03 | 96.91                                  (exit 0)
$ pnpm format:check   → All matched files use Prettier code style!         (exit 0)
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force   (load 3.75)
 Failed: @openverify/api#typecheck: src/workflows/engine/sweep.test.ts(159,38) … 'runId' does not exist
 Tasks: 28 successful, 32 total                                             (exit 2)
   an uncommitted edit of the API fixer's (R002, in progress at the time), not this fixer's paths
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force   (re-run; load 15.28)
 Tasks: 32 successful, 32 total                                             (exit 0)
```

The e2e gate (second attempt, after `8b1d260e`; the README's 3 shards):
```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...'   (exit 0)
$ flock -w 120 /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up   (load 2.63; exit 0)
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e        79 passed (27.6s)   (load 3.90; exit 0)
$ … playwright test --shard=1/3   44 passed (4.1m)   20:49:23 to 20:53:29, load 11.49   (exit 0)
$ … playwright test --shard=2/3   41 passed (5.7m)   20:53:33 to 20:59:20, load 3.64    (exit 0)
$ … playwright test --shard=3/3   42 passed (7.0m)   20:59:24 to 21:06:26, load 7.60    (exit 0)
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:down   (holder 1057292, this fixer's; exit 0)
```
After the rendition fix the dashboard gate ran again (load 4.65): 383 files, 5270 tests passed,
All files 96.89 / 90 / 97.03 / 96.91 (exit 0); `pnpm format:check` exit 0.

127 full-stack tests in 64 files (Workflow 8B's 117 in 61, plus `ui-workflows.spec.ts`'s 3, the
reviewer's style CSP test, and 8C Stage 1's specs).

## What R010 still owes (not built by this fixer)

Built here: the secrets page (C141.7), create, the draft editor with the APG outline view and the
raw definition, check and save (C141.2, C141.4 in part), publish with acknowledgements, rollout
finish and undo, restore, the diff as a list (C141.5 in part), run resume, rerun, cancel and
redaction (C141.6, C141.9 in part), trigger deliveries (C141.9), `ui-workflows.spec.ts` with the
nonce style CSP on the editor (C141.8 in part).

Still owed to C141, each an owner-visible gap: the outline's editing menu (add a step after, add a
branch, move up and down, connect to, delete, open settings) and therefore keyboard authoring
without the raw JSON; the `@xyflow/react` canvas with its handles, `isValidConnection`, text
summary, dagre "tidy up" and canvas badges; undo and redo; the palette from `GET /workflow-actions`;
step forms from JSON Schema with the variable picker; the condition builder; promote; cancel-runs of
older versions; the runs filters beyond step errors and the path drawn over a read-only canvas; the
sandbox test-run panel (C120.7, C126.4) and the per-step Evaluate Code test; manual runs from ids or
a CSV; the secret's host and placement edits (PATCH); the C143.7 settings; decision templates
(C128.5); the trigger, inputs, variables and outputs panels with nullable and PII marks; Trust
Device; the webhook form's new filter keys; problem and step-error words; the README section; axe on
every page (no axe package, R015).
