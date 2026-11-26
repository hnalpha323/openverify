# TDD evidence: console-editor (Workflow 8D Stage 1)

Agent: `console-editor`, first call of two. Plan: `docs/plans/phase-8.plan.md` C141.1 to C141.5 and
C141.8, with 8A amendments 29, 49, 50, 51 and 102, and the "What R010 still owes" list of
`docs/tdd/phase8-review-fixes-console.tdd.md`.

Paths owned: `apps/dashboard/src/components/workflows/editor/`, the `draft-editor`,
`definition-outline`, `definition-outline-model`, `version-diff`, `run-values` and `workflow-words`
modules with their tests, `apps/dashboard/src/app/workflows/[id]/draft/`,
`apps/dashboard/src/app/workflows/runs/[id]/`, `apps/dashboard/src/testing/routes/workflow-editor.ts`,
`apps/dashboard/src/testing/workflow-editor-fixtures.ts`, `e2e/tests/ui-workflow-editor.spec.ts`,
`e2e/tests/support/ui-workflow-editor.ts` and this file.

Every command ran after `source scripts/env.sh`. Unit runs use
`pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false`.

## Slices of this call

1. The document model and the shared port rules (`editor/document-model.ts`, `editor/port-rules.ts`).
2. Undo and redo (`editor/history.ts`).
3. The palette from `GET /workflow-actions` (`editor/palette-model.ts`, `editor/palette.tsx`).
4. The outline's editing menu and the editor wiring (`definition-outline.tsx`, `editor/outline-menu.tsx`,
   `draft-editor.tsx`, the draft page).
5. The canvas (`editor/canvas-model.ts`, `editor/layout.ts`, `editor/workflow-canvas.tsx`).
6. The full-stack spec `e2e/tests/ui-workflow-editor.spec.ts`.

## Slices 1 and 2: the document model, the shared port rules, undo and redo (C141.2 to C141.4)

Stub `aff8989e` (every function threw `not built`), RED `a0efcd0a`, GREEN in the commit after it.

- `editor/document-model.ts`: `readDraft`, `emptyDefinition`, `serialise`, `setTrigger`, `insertStep`
  (`StepTemplate`: an action from the catalogue, `wait-time`, `wait-events`, `conditional`,
  `parallel` with its join), `insertionPlaceOf`, `addBranch`, `canMove` and `moveStep`,
  `connectPort`, `canDelete` and `deleteStep`, `renameStep`, `placeNode`, `replaceLayout`. Every
  command is pure and answers `{ definition, select }` or `null`.
- `editor/port-rules.ts`: `requiredPortsOf`, `portsOf`, `edgeOn`, `canConnect`, `validTargets`,
  `portWords`, the one rule set the outline's connect list and the canvas's `isValidConnection` call.
- `editor/history.ts`: `startHistory`, `record` (a repeated gesture key replaces the present),
  `endGesture`, `undo`, `redo`, `HISTORY_LIMIT` 100, `isUndoKey`, `isRedoKey`.

RED (the stubs compile; every test fails on the stub's own error):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor --coverage.enabled=false
     × undoes and redoes each record in turn 8ms
     × names the ports each node type must connect, and the error port where it has one 11ms
     × reads a definition with its members, and keeps the ones it does not edit 13ms
     ...
     42 Error: not built
 Test Files  3 failed (3)
      Tests  42 failed (42)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # rc=0
```

The RED commit carried one lint error in `document-model.test.ts` (an unused destructured
`_layout`); the GREEN commit replaces that line with an `Object.fromEntries` filter, with the same
assertion.

GREEN: the first run failed one test for a real defect, which the fix then closed: deleting a
parallel led a branch step's edge into the deleted join on to the join's next step, so a step that
should have been left unconnected stayed in the chain. Only what led into the deleted step itself
now leads on.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor --coverage.enabled=false
     × deletes a parallel with its join, leaving its branch steps unconnected 20ms
      Tests  1 failed | 41 passed (42)
(fix in deleteStep)
 Test Files  3 passed (3)
      Tests  42 passed (42)
coverage of editor/ alone: 98% statements, 92.85% branches, 100% functions
$ (cd apps/dashboard && pnpm exec eslint src/components/workflows/editor)   # rc=0
```

## Slices 3 and 4: the palette, the outline's edit menu and keyboard authoring (C141.2, C141.4)

Stub `f59323a0` (the palette, the menu and its dialogs rendered nothing, `paletteOf` threw), RED
`0bfcbf99`, GREEN in the commit after it. The stub commit also fixed a tsc error the slice 1 GREEN
commit carried (`insertionPlaceOf` switched on `step?.type`, which does not narrow `step`); the
slice 1 tests had passed, because Vitest does not typecheck.

- `editor/palette-model.ts`: `paletteOf(actions, triggerType)`: the four step types of C113.2, then
  every catalogue row in the order served, each with its kind, delivery and adverse flag in words,
  "Not configured: ..." for `available: false` with its reason, a refusal for an action whose
  `triggers` do not include the trigger, `beta` for a beta stage, and the version named when a key
  has more than one.
- `editor/palette.tsx`: `PaletteDialog`, radio groups "Steps" and "Actions", a filter, "Add step".
- `editor/edit-menu.tsx`: `EditMenu`, the APG menu (focus in, arrows wrap, Home, End, Enter, Escape
  and Tab close), disabled items kept with `aria-disabled` and their reason as the description.
- `editor/editor-dialogs.tsx`: `TriggerDialog`, `ConnectDialog` (the targets of `validTargets`
  only), `DeleteDialog`.
- `definition-outline.tsx`: Enter calls `onActivate` after `onSelect` (Space only selects); the
  handle gains `revealItem`. `definition-outline-model.ts`: a route's group reads its label when it
  has one ("Route 1"), and `portWords` comes from `editor/port-rules.ts`.
- `draft-editor.tsx`: the menu per item, the dialogs, undo and redo (keys inside the editor but not
  in a text field, and the buttons), the step settings with a rename coalesced into one undo
  entry, the polite "Editor status" region, the unsaved notice, and the raw JSON recorded as one
  gesture while typed.
- `app/workflows/[id]/draft/page.tsx`: reads `GET /workflow-actions` with `workflows:write`; the
  empty definition is `emptyDefinition()`, with the output node.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor src/components/workflows/draft-editor-authoring.test.tsx 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  6 failed | 3 passed (9)
      Tests  23 failed | 48 passed (71)
      6 Error: not built
      Unable to find an accessible element with the role "menu" and name "Actions for Trigger: No trigger yet"
      Unable to find an accessible element with the role "dialog" and name "Set the trigger"
      Unable to find an accessible element with the role "button" and name "Undo"
      ...
```

GREEN: the first run failed three authoring tests on a race in the test, not the code: after an
edit the editor moves focus to the selected item in an animation frame, and a test that focused
another item at once lost its focus to that frame under userEvent's delays. The test now waits for
the frame (`afterFrame`) before it moves focus itself; no assertion changed.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/draft-editor src/components/workflows/editor src/components/workflows/definition-outline 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  83 passed (83)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # rc=0 for every file of this slice
```

The draft page test serves the catalogue in its `beforeEach` (one line), because the page now reads
it; no assertion of the existing tests changed.

## Slice 5: the canvas (C141.1, C141.3, C141.5)

Stub `6e8a87dd`, RED `54c0fc44`, GREEN in the commit after it.

- `editor/layout.ts`: `tidyLayout(definition)`, `@dagrejs/dagre` top to bottom at `NODE_WIDTH` 240 by
  `NODE_HEIGHT` 80, back-edges and dangling edges left out, whole pixels.
- `editor/canvas-model.ts`: `canvasOf(definition, issues, marks)` (a node per step and the trigger,
  named with the outline's `stepLabelOf` and `triggerLabelOf`, positions from `layout` or else where
  tidy-up would put them, ports in words, problems by pointer, diff marks), `canvasSummary`
  ("3 steps, 2 branches, 1 error."), `diffMarksOf(diff)`, `connectionOf(definition, connection)`
  (the canvas's `isValidConnection` and `onConnect`, through `connectPort` and so `canConnect`).
- `editor/canvas-words.ts`: `CANVAS_ARIA_LABELS`, every key of the library's `AriaLabelConfig`.
- `editor/workflow-canvas.tsx` with `workflow-canvas.css`: `WorkflowCanvas`, client-only through
  `useSyncExternalStore` (false on the server, and false where `ResizeObserver` is missing), base.css
  and the canvas stylesheet imported through the bundler; the memoised `StepNode` with a 3 px focus
  ring in the focus colour, badges as an icon and a word, a 24 px hit area on each handle, each
  handle named; `deleteKeyCode` null (deletes go through the outline's confirmation); the
  "React Flow" attribution kept; `Controls` without the lock button.
- `draft-editor.tsx`: the "Canvas" region with the summary pointing to the outline, "Tidy up" (one
  undoable command), selection followed both ways (`revealItem` puts the outline's tab stop on a node
  selected on the canvas), a node moved or connected on the canvas recorded through `apply` without
  moving focus. The draft page passes `diffMarksOf(diff.attributes)` as `marks`.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor/canvas src/components/workflows/editor/layout src/components/workflows/editor/workflow-canvas src/components/workflows/draft-editor-canvas --coverage.enabled=false
 Test Files  5 failed (5)
      Tests  22 failed (22)
     11 Error: not built
      1 TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Tidy up"
      1 TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Canvas"
      1 AssertionError: expected [] to deeply equal [ 'controls.ariaLabel', …(10) ]
      ...
```

The RED commit carried two lint errors in the canvas tests (`!` and `as HTMLElement` are each
refused by one rule); GREEN replaces them with a `found()` helper that fails naming what is missing.

GREEN: the first run showed three things the tests then had to say exactly, none a weakened
assertion:
1. Every existing `DraftEditor` test failed with `ReferenceError: ResizeObserver is not defined`
   once the canvas rendered. The canvas now renders only where `ResizeObserver` exists, and says
   otherwise that the outline lists every step; the canvas tests stub it.
2. The attribution link's `href` is `https://reactflow.dev/attribution` outside production builds and
   `?utm_source=attribution` in them, so the test matches the prefix `https://reactflow.dev`.
3. At 12.12.0 the library shows `node.a11yDescription.keyboardDisabled` while its keyboard access is
   on (the key's default text is the one naming the arrow keys), so the console's words follow what
   is shown and the test reads that key.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor src/components/workflows/draft-editor src/components/workflows/definition-outline 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  105 passed (105)
coverage of the editor files: canvas-model 100%, layout 100%, document-model 97.3%, history 100%,
palette 100%, draft-editor 91.4%, workflow-canvas 74.5% statements (its drag path is the e2e's)
$ (cd apps/dashboard && pnpm exec eslint <the slice's files>)   # rc=0
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)            # rc=0 for every file of this slice
```

## Slice 6: the full-stack spec, and what axe found (C141.8)

`e2e/tests/ui-workflow-editor.spec.ts` with `e2e/tests/support/ui-workflow-editor.ts`, committed as
`ec0d9206`, written after the unit slices: it runs only on the full stack. Axe runs through
platform-carry's `expectNoAxeViolations` (`17526b3b`), which had landed. Its first runs failed for
real defects, each then fixed test-first:

1. Run 1 (01:07Z, load 16.4): `color-contrast (serious) at a[target="_blank"]`: the library's
   attribution link is `#999` on a translucent background. Fixed in `6e0620bd`
   (`workflow-canvas.css`: the console's text colour on the surface; the link stays, decision 73).
2. Run 2 (01:13Z) did not start its specs: `next build` failed on another agent's uncommitted
   test (`webhook-form-phase8.test.tsx`, console-ops). Run again once it compiled.
3. Run 3 (01:19Z, load 18.1): the whole authoring flow passed (trigger, conditional, second route,
   wait, canvas sync, undo and redo, tidy-up, save), and axe on the authored page found:
   - `aria-prohibited-attr (serious)` on 8 handles: an `aria-label` on the library's generic
     `div`. RED `09378dec` (`workflow-canvas.test.tsx`: a handle has a title and no `aria-*`);
     GREEN: handles carry `title`, and the keyboard connects through the outline.
   - `label-content-name-mismatch (serious)` on 5 outline items with children (8C's tree nested
     each group inside its parent item, so a parent's visible text held its children's). RED
     `09378dec` (`definition-outline.test.tsx`: each item's text content is its label alone);
     GREEN: the outline renders the visible items as a flat APG tree with `aria-level`,
     `aria-posinset` and `aria-setsize` (already stated), indented by class, so the keyboard model
     and every name stay as they were.

RED of the two findings:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/definition-outline.test.tsx src/components/workflows/editor/workflow-canvas.test.tsx --coverage.enabled=false
     × gives each item its own visible text as its whole name, holding no other item’s text (...)
       AssertionError: expected 'Trigger: An eventConditional: check r…' to be 'Trigger: An event'
     × gives every port a titled handle with a 24 px hit area and no ARIA attribute, (...)
       AssertionError: expected [ [ 'in', true, null, true ], …(2) ] to deeply equal [ [ 'in', true, …(2) ], …(2) ]
      Tests  2 failed | 6 passed (8)
```

GREEN (the row render moved inline into the JSX, because the React compiler's `react-hooks/refs`
rule refused a ref callback built in a helper function):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  28 passed (28)
      Tests  181 passed (181)
$ (cd apps/dashboard && pnpm exec eslint src/components/workflows/editor src/components/workflows/definition-outline.tsx src/components/workflows/draft-editor.tsx)   # rc=0
```

## Final gates of this call (each exit code read from a file, never through a pipe)

| Gate | Started (UTC) | Load | Exit | Result |
|---|---|---|---|---|
| The full-stack spec, one call holding the e2e lock: stack down, turbo build, stack up, `playwright test tests/ui-workflow-editor.spec.ts`, stack down | 01:33:29 | 17.3 to 28.8 | 0 | 3 passed in 54.0 s (27.6, 16.0 and 5.3 s); the whole call 3 min 49 s |
| `pnpm --filter @openverify/dashboard typecheck` (`next typegen && tsc --noEmit`) | 01:37:33 | 29.0 | 0 | |
| `pnpm --filter @openverify/dashboard lint` | | | 0 | |
| `vitest run --coverage` in `apps/dashboard` (its test script, coverage to a directory of its own) | 01:42:22 | 8.1 to 28.9 | 0 | 5,479 tests in 410 files; 96.75% statements, 89.72% branches, 96.7% functions, 96.77% lines; 8 min 20 s |
| `pnpm format:check` | 01:50:47 | | 0 | |
| `pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 01:50:50 | 13.3 | 0 | 4 of 4 tasks |

No request addressed to console-editor was committed (`git log --grep='REQUEST for console-editor'`
is empty at the end of this call).

## For the second call: the names this call built

- The document model, `components/workflows/editor/document-model.ts`: types `DraftDefinition`,
  `DraftStep`, `DraftEdge`, `DraftTrigger`, `Position`, `StepTemplate`, `Place`, `Edited`,
  `Direction`; `readDraft`, `emptyDefinition`, `serialise`, `setTrigger`, `insertStep`,
  `insertionPlaceOf`, `addBranch`, `canMove`, `moveStep`, `connectPort`, `canDelete`,
  `deleteStep`, `renameStep`, `placeNode`, `replaceLayout`. A step form or panel edits by building
  the next `DraftDefinition` and handing `{ definition, select }` to the editor's `apply`.
- The port rules, `editor/port-rules.ts`: `TRIGGER_NODE`, `OUTPUT_NODE`, `CONTINUE_PORT`,
  `requiredPortsOf`, `portsOf`, `edgeOn`, `canConnect`, `validTargets`, `portWords`.
- History, `editor/history.ts`: `History`, `HISTORY_LIMIT`, `startHistory`, `record(history,
  next, gesture?)`, `endGesture`, `undo`, `redo`, `isUndoKey`, `isRedoKey`.
- Palette, `editor/palette-model.ts` (`CatalogueAction`, `PaletteEntry`, `paletteOf`) and
  `editor/palette.tsx` (`PaletteDialog`). The page maps the catalogue rows to `CatalogueAction`;
  a step form needs `config-schema` added to that mapping.
- Menu and dialogs: `editor/edit-menu.tsx` (`EditMenu`, `EditMenuItem`),
  `editor/editor-dialogs.tsx` (`TriggerDialog`, `ConnectDialog`, `ConnectTarget`, `DeleteDialog`).
- Canvas: `editor/canvas-model.ts` (`canvasOf`, `canvasSummary`, `diffMarksOf`, `connectionOf`,
  `DiffMark`, `CanvasIssue`, `StepNodeData`, `CanvasNode`, `CanvasEdge`, `CanvasConnection`),
  `editor/layout.ts` (`tidyLayout`, `NODE_WIDTH`, `NODE_HEIGHT`), `editor/canvas-words.ts`
  (`CANVAS_ARIA_LABELS`), `editor/workflow-canvas.tsx` (`WorkflowCanvas` with `definition`,
  `issues`, `marks`, `selectedId`, `onSelect`, and `onEdit` left out for a read-only canvas, which
  the run page's path can take), `editor/workflow-canvas.css`.
- The outline: `definition-outline-model.ts` (`outlineOf`, `stepLabelOf`, `triggerLabelOf`),
  `definition-outline.tsx` (`DefinitionOutline` with `onSelect` and `onActivate`;
  `OutlineHandle.focusItem` and `.revealItem`), rendered as a flat APG tree.
- The editor: `draft-editor.tsx` (`DraftEditor` with `actions` and `marks`; `apply(edited, message,
  { gesture, focus })` inside it; the step settings panel `StepSettings` holds the name today and is
  where the step forms go).
- Test support: `testing/routes/workflow-editor.ts` (`serveWorkflowActions`,
  `WORKFLOW_ACTIONS_PATH`), `testing/workflow-editor-fixtures.ts` (`workflowAction`),
  `e2e/tests/support/ui-workflow-editor.ts` (`editorWorkflowName`, `outlineOf`, `outlineItem`,
  `canvasNode`, `pickFromMenu`, `addFromPalette`, `definitionOf`).

# Second call (Workflow 8D Stage 1, console-editor, call 2 of 2)

Plan: C114 (C114.5, C114.6), C115.3, C115.6, C120.6, C121.4, C128.5, C141.4, C141.6, C141.9.
`git log --grep='REQUEST for console-editor'` was empty at the start of the last slice and at the
end of this call. console-ops' test-run page (`/workflows/<wfl_>/test-runs?start-step=<id>&end-step=<id>`,
`app/workflows/[id]/test-runs/page.tsx`) and its decision templates
(`components/workflows/decision-templates.ts`, `DECISION_TEMPLATES`, `decisionTemplateDefinition`)
had both landed, so slice 3 links and offers them.

## Slice 7: problem and step-error words (C112.8, C113.6, C120.2)

Stub `00a31948`, RED `50a61a1c`, GREEN `881edc03`.

The step error codes live in `@openverify/workflow-engine` (`WORKFLOW_ACTION_ERROR_TYPES`,
`ENGINE_ERROR_TYPES`), which the console does not depend on and whose `package.json` nobody may
change in 8D. The words test therefore reads the source lists through `docs/workflows/errors.md`,
which `workflow-docs:write` generates from them and `reference-docs.test.ts` keeps current: its
Engine and Actions tables (step error codes) and its Definitions bullets (every `definition_invalid`
code and warning), plus `WORKFLOW_PROBLEM_CODES` from `@openverify/contracts`. The test first checks
it read the lists (over 90 codes each), then that every code has words.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/workflow-words.test.ts src/components/workflows/draft-editor.test.tsx 'src/app/workflows/runs/[id]/page.test.tsx' --coverage.enabled=false
     × says every one of the step error codes
     × says every one of the definition problem codes
     × says every one of the workflow problem codes
     × says a code it knows in words, and keeps one it does not rather than hiding it
     × never words an unknown as false, or a recorded message as sent (ADR 0002, ADR 0007)
     × says each problem in words beside its code and the API’s detail, and says when the list is stale (C113.6)
     × says each step error code in words beside its code (C120.2)
AssertionError: expected [ 'condition_input_null', …(98) ] to deeply equal []
AssertionError: expected [ 'trigger_missing', …(95) ] to deeply equal []
AssertionError: expected [ 'definition_invalid', …(17) ] to deeply equal []
      Tests  7 failed | 32 passed (39)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # rc=0
```

The RED commit carried three `restrict-template-expressions` lint errors in its tests; the GREEN
commit wraps those values in `String()` with the same assertions.

GREEN: `workflow-words.ts` gains `WORKFLOW_STEP_ERROR_WORDS` (99 codes), `WORKFLOW_DEFINITION_PROBLEM_WORDS`
(96 codes), `WORKFLOW_PROBLEM_WORDS` (18 codes), `stepErrorWords` (a `slack_<code>` reads "Slack
refused the message (<code>)") and `definitionProblemWords`. The errors panel says each problem as
"<words> <the API's detail> (<code>)", keeps "Go to step" and the polite region, and says when the
definition changed after the last check (the first call's last followup). The run page's step error
column reads "<type> (<code>): <words>".

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows 'src/app/workflows/runs/[id]' 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  29 passed (29)
      Tests  201 passed (201)
```

## Slice 8: the pure models (C114, C115.3, C121.4, C128.5, C141.4, C141.9)

Stub `71257cf4`, RED `e69b1a7b`, GREEN `f29fb959`.

- `editor/schema-form-model.ts`: `fieldsOf(configSchema)` (one `FormField` per member: `text`,
  `number`, `integer`, `boolean`, `enum` or `json`, with its hint, required flag and a secret mark),
  `fieldText`, `parseFieldText` (an empty control leaves the member out; a number takes a number or
  exactly one `{{ path }}`; a fraction refused for a whole number).
- `editor/variable-scope.ts`: `ScopePath` (`path`, `type`, `options`, `nullable`, `pii`, `source`),
  `pathsOfSchema(outputSchema, prefix, source, marks)`, `declaredPath(path, dsl, source, marks)` (the
  C115.3 DSL with its ` pii` suffix), `scopeAt(definition, nodeId, actions, triggerPaths)` (the
  trigger view, inputs (nullable when not required), variables, `current_run`, and the outputs of
  every step that dominates the node; a step that continues on error has every output nullable),
  `referencesOf`, `egressOf(step, action, scope)` (an egress action whose settings read a PII path).
- `editor/trigger-paths.ts`: `triggerPathsOf(trigger)`: the flattened view of the event's resource
  from `eventPayloadSchema` through `z.toJSONSchema()`, PII by each member's mark and by
  `PII_MASKED_ATTRIBUTES`; an inquiry's signals one member each, nullable; a union of views marks a
  path nullable when one view lacks it.
- `editor/condition-model.ts`: `readCondition`, `writeCondition` (OR between groups, AND inside),
  `operatorsFor` (no `is-not` on a nullable path, `is unknown (null)` there; no comparison of a PII
  string with typed text), `clauseProblem`, `readsNullable`, `onNullChoicesOf('route' | 'trigger' | 'wait')`.
- `editor/document-model.ts`: `updateStep`, `updateRoute`, `moveRoute`, `removeRoute`,
  `updateTrigger`, `setDeclarations`, and `insertStep` with `{ kind: 'decision-template', key }`
  (the template's steps placed where the step goes, a taken id renamed with every `steps.<id>` path
  that reads it).

RED (every failure the stubs' own error):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor/schema-form-model.test.ts src/components/workflows/editor/variable-scope.test.ts src/components/workflows/editor/condition-model.test.ts src/components/workflows/editor/trigger-paths.test.ts src/components/workflows/editor/document-settings.test.ts --coverage.enabled=false
 Test Files  5 failed (5)
      Tests  45 failed (45)
     44 Error: not built
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # rc=0
```

GREEN, first run, then five lint findings fixed with no assertion changed:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/editor --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  122 passed (122)
$ (cd apps/dashboard && pnpm exec eslint src/components/workflows/editor)   # rc=0
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)                        # rc=0
```

## Slice 9: step forms, the picker, the condition builder and the panels (C141.4, C141.9)

Stub `bf77e5be`, RED `0737aff7`, GREEN `b112b741`.

- `editor/step-form.tsx`: `StepForm` (an action's config fields from its `config-schema`, each text,
  number and JSON field with "Insert a variable into <field>"; "Continue on error"; a wait's time or
  events with its filter; a conditional's routes, each with its label, its condition, "Try <route>
  earlier/later" and "Remove the route"), the egress mark ("Egress: personal data leaves OpenVerify
  in this step (<paths>) … egress:<step id>"), and for `evaluate_code` the link "Test this step" to
  `/workflows/<wfl_>/test-runs?start-step=<id>&end-step=<id>`. `ApplyEdit` is its edit callback.
- `editor/variable-picker.tsx`: `VariablePicker` (dialog "Insert a variable", list "Paths in scope",
  each "<source>: <type> · can be unknown (null) · personal data"), `pathMarks`, `PathList`.
- `editor/condition-builder.tsx`: `ConditionBuilder` (region "Condition of the route <label>",
  "Filter of <step>", "Criteria of the trigger" or "Filter of the trigger"; comparisons with
  "Path of comparison i of group j", "Comparison of …", "Value of …"; "Add a comparison" and "Add an
  “or” group"; once a nullable path is read, the select "When a value it reads is unknown (null)"
  with "Choose what happens" and no default).
- `editor/workflow-panels.tsx`: `TriggerPanel` (change the trigger, events one per line checked
  against the triggerable events, a recurring trigger's interval, cron, zone and object type,
  criteria or filter with its on-null, the two options, and "Paths of the trigger"),
  `DeclarationsPanel` (inputs, variables and outputs: type, required, PII, an output's value on the
  output node, remove, add, and "Paths of the <member>"), `declarationPaths`.
- `editor/palette-model.ts`: `CatalogueAction` gains `configSchema` and `outputSchema`;
  `TEMPLATE_ENTRIES` (group "Decision templates", from console-ops' `DECISION_TEMPLATES`).
- `draft-editor.tsx`: the step form inside "Step settings", the panels in the region "Trigger,
  inputs, variables and outputs" (regions "Trigger", "Inputs", "Variables", "Outputs"; path lists
  only without `workflows:write`), a form's edit keeps the step selected and its focus, one undo
  entry per field while it is typed; the draft page maps `config-schema` and `output-schema`.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows/draft-editor-forms.test.tsx --coverage.enabled=false
      Tests  11 failed (11)
      TestingLibraryElementError: Unable to find an accessible element with the role "textbox" and name "subject (required)"
      TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Insert a variable into subject"
      TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Condition of the route Hit" (2)
      TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "Test this step"
      TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Inputs"
      TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Decision templates"
      ...
```

GREEN: the first run failed two builder tests for a real defect: a route edit selected the route's
outline group, which closed the step's settings under the builder. A form's edit now keeps the
step selected.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/workflows 'src/app/workflows/[id]/draft' --coverage.enabled=false
 Test Files  34 passed (34)
      Tests  244 passed (244)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # rc=0 after two exactOptionalPropertyTypes fixes in the panels
```

## Slice 10: the run page's path, beta badges and tiers, RSC payloads (C120.6, C141.6, C141.9)

Stub `43c49432`, RED `02dad707`, GREEN `ab2dea01`.

- `editor/canvas-model.ts`: `RunStepRow`, `RunPath`, `StatusBadge`, `statusBadgeOf` (each step
  status an icon and a word; "Not reached" for none), `runPathOf` (each node's top-level row, the
  trigger "Started", each edge between two nodes that ran from one that led on), `pathListOf`,
  `structureOf` (the graph without any step configuration, condition or mapping), and `canvasOf`'s
  optional `path` (node `status`, edge `taken`).
- `editor/workflow-canvas.tsx`: a `path` prop: each node's status badge and name, each edge
  "taken by this run" or "not taken" and taken edges drawn heavier; `editor/run-path-canvas.tsx`:
  `RunPathCanvas`, the read-only canvas the run page mounts.
- `app/workflows/runs/[id]/page.tsx`: with `workflows:read` it reads the version and the catalogue
  (`loadSection`), sends only `structureOf` the definition, and adds the region "Path taken" ("The
  run reached N of M steps.", the list "Path taken as a list", the canvas); each step's status as an
  icon and a word; a beta action's `StageBadge` and each match's method, tier, stage and confidence
  through `EvidenceMeta`. Without `workflows:read` it says the path needs it and reads nothing more.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run 'src/app/workflows/runs/[id]' src/components/workflows/editor/run-path.test.ts src/components/workflows/editor/canvas-model.test.ts src/components/workflows/editor/workflow-canvas.test.tsx --coverage.enabled=false
      Tests  7 failed | 27 passed (34)
      4 Error: not built
      2 TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Path taken"
      1 TestingLibraryElementError: Unable to find an element with the text: Beta.
```

The RSC payload test of the run page through the path ("carries no masked value into the page
through the path either") passed at once in RED, as a guard: it fails if the full definition, with
its `Synthetic message` config, reaches the browser. The run page tests serve the version and the
catalogue through one `serveGraph` helper, in `beforeEach` and in the two tests that make a second
`routeApi()`; no assertion changed. The draft page's RSC payload test ("asks for nothing else") was
written after GREEN and passed at once, as a guard: the page asks only for the workflow, the draft,
the diff and the catalogue.

```
$ pnpm --filter @openverify/dashboard exec vitest run 'src/app/workflows' src/components/workflows --coverage.enabled=false
 Test Files  41 passed (41)
      Tests  367 passed (367)
```

## Slice 11: the full-stack spec

`cd83d75a` adds a fourth test to `e2e/tests/ui-workflow-editor.spec.ts`: a developer sets the API
trigger, adds Calculate and fills its form (operator `add`, operands `[1, 2]`), adds a conditional,
gives Route 1 the comparison `steps.calculate.output.value is more than 0`, sees "When a value it
reads is unknown (null)" empty and chooses "Try the next route", saves with no error and runs axe;
the workflow is published, activated and triggered through the API, and the run page's "Path taken"
lists "Action calculate: Calculate: ✓ Succeeded", with the canvas node named
"Action calculate: Calculate, Succeeded"; axe runs on the run page. It passed on its first run.

## Final gates of the second call (each exit code read from a file, never through a pipe)

| Gate | Started (UTC) | Load | Exit | Result |
|---|---|---|---|---|
| The full-stack spec, one call holding the e2e lock (down, turbo build, up, `playwright test tests/ui-workflow-editor.spec.ts`, down), first run | 02:50:15 | 13.0 to 15.1 | 0 | 4 passed in 42.7 s (15.2, 8.1, 2.8, 10.4 s); 5 min 28 s in all |
| `pnpm --filter @openverify/dashboard typecheck` | 02:55:59 | 13.2 | 0 | |
| `pnpm --filter @openverify/dashboard lint` | | | 0 | |
| `vitest run --coverage` in `apps/dashboard` (coverage to a directory of its own) | 03:01:48 | 13.8 to 21.8 | 0 | 5,552 tests in 417 files; 96.37% statements, 88.89% branches, 95.91% functions, 96.36% lines; 9 min 15 s |
| `pnpm format:check` | 03:11:11 | | 0 | |
| `pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 03:12:56 | 6.5 | 1 | the e2e lint refused one unneeded `as never` in the new test; dropped in `79e40b99` |
| the same, again | 03:13:42 | 2.7 to 10.0 | 0 | 4 of 4 tasks |
| The full-stack spec again, on the final files, one locked call | 03:17:10 | 1.8 to 8.4 | 0 | 4 passed in 20.6 s (7.4, 3.8, 1.5, 5.3 s); 1 min 50 s in all |

Coverage of the editor folder: 91.86% statements, 80.98% branches; `step-form.tsx` 77.9% statements
(its wait-event form and route label are covered only by the e2e), `trigger-paths.ts` 92.9%.
