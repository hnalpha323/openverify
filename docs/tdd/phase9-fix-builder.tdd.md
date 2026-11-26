# Phase 9, Workflow 9D Stage 4a: fix-builder (the flow builder and the workflow editor)

Agent: `fix-builder`, beside `fix-flow` and `fix-console` (orchestrator decision 1 before 9D, P-A).
Paths: `apps/dashboard/src/components/{flow-builder,graph-editor,workflows/editor}/`,
`components/workflows/draft-editor*` and `definition-outline*`, `app/templates/[id]/flow/`,
`lib/copy/{flow-builder,graph-editor}.ts`, `e2e/tests/ui-flow-builder.spec.ts`,
`e2e/tests/ui-workflow-editor.spec.ts` (and `ui-a11y-builder.spec.ts`, Stage 1 amendment 9).
Run `source scripts/env.sh` first. Every RED below compiled and typechecked and failed at run time for
the reason named; every GREEN is the minimum that passes, then the folder's tests.

Re-verified against the code before the first commit (Handover to 9D, "fix-console, the builder";
9C Stage 1 amendments FB-1 to FB-10):

- `FLOW_ADAPTER.diffMarksOf` exists (`components/flow-builder/flow-adapter.ts`) and the builder passes
  `marks={{}}` to `GraphCanvas`: no diff reaches the canvas.
- `copyTemplate` and `promoteTemplate` exist in `lib/api/inquiry-templates.ts`; nothing in
  `app/templates/` calls them.
- `palette-model.ts` `STEP_TYPES` offers `wait-time`, `wait-events`, `conditional`, `parallel` only.
- `checkFlowGraph` (flow-spec) already returns the warnings `client_signal_before_screen` and
  `tipping_off_route`, which the builder's problems panel lists generically; no branch shows them
  and `waitFor` is edited only as the step JSON.
- `OutlineTree` has `revealItem`; the flow builder's canvas `onSelect` was `setSelectedId` only.
- The flow-spec v2 component schema (`packages/flow-spec/src/v2/schemas/components.ts`) is strict
  and carries no style member (`id`, `visibleWhen`, `enabledWhen` and the kind's own members only).

## Slices

| Item | Stub | RED | GREEN | Notes |
|---|---|---|---|---|
| R010 outline follows the canvas | | `b0683c04` | `f2d9b775` | |
| K9-3 modules, model | `07374938` | `3202c75d` | `7ac34b7e` | `flow-modules.ts` |
| K9-3 modules, outline menu and dialog | | `77889300` | `6bc7fcc2` | |
| K9-6 branch warnings and waitFor | `6677d528` | `ef0e669c` | `53b09af5` | `branch-routes.tsx` |
| K9-6 warnings handed to the branch | | `bd160c08` | `4515a254` | |
| K9-5 diff badges in the builder | `87636856` | `9c39ecde` | `495c1379` | |
| K9-5 flow page reads the diff | | `b6f4959c` | `decba49b` | existing page tests serve the diff |
| K9-5 copy and promote dialogs | `df8735af` | `eef7c3ef` | `41ca8485`, fix `0bcdd978` | |
| K9-5 mounted on the template page | | `eff89c8a` | `c095c521` | borrowed edit (fix-console's page and test) |
| K9-7 R005 model | `dbeaa756` | `4914cb38` | `a02b9952`, fix `513895b3` | 4 existing tests follow (rule 11) |
| K9-7 R005 in the editor UI | `c1b40b84` | `1cf8db79` | `f5903a0b` | |
| K9-4 screen model | `eda87271` | `7f911698` | `75f4943b` | |
| K9-4 screen editor | `b0136a90` | `6593445d` | `f7e3898f` | |
| K9-4 mounted in the builder | `ddde20d6` | `aa09aa72` | `3cf90b81`, `c90b0266` | field schemas from the page |
| K9-4 a new branch's empty route | | `5aa5dcf3` | `0d9f83c6` | |
| K9-4 full-stack item (C155.10) | | | `b406b47a` | e2e |
| lint | | | `03903f59` | refactor |

### R010: the outline follows a step selected on the canvas

RED (`b0683c04`), `pnpm exec vitest run src/components/flow-builder/flow-builder-canvas-sync.test.tsx --coverage.enabled=false`:

```
× marks the outline item of a step selected on the canvas, and only that one
Error: expect(element).toHaveAttribute("aria-selected", "true")
❯ src/components/flow-builder/flow-builder-canvas-sync.test.tsx:56:35   (the Government ID item)
Tests  1 failed (1)
```

GREEN: the canvas `onSelect` sets the selection and calls `outline.current?.revealItem(id)`, so the
outline's `aria-selected` and tab stop follow. The test's last assertion read the panel heading
wrongly (the panel names a step by id, `Step: s_govid000`) and was corrected in the GREEN commit;
the assertion that failed for the intended reason is unchanged.

```
pnpm exec vitest run src/components/flow-builder/ --coverage.enabled=false
Test Files  8 passed (8)
     Tests  60 passed (60)
```

### K9-3: modules (C155.4)

RED `3202c75d` (stub `07374938` answered `[]` and `null`): `pnpm exec vitest run src/components/flow-builder/flow-modules.test.ts --coverage.enabled=false`

```
× offers every module, each saying what it inserts before it is inserted (C155.11)
× inserts a verification module as its step, an explanation screen and an exhausted fallback, wired through the port rules
× leaves the explanation screen out when it is not asked for
× inserts the email module as an email code step
× refuses a second verification of a type, with the reason, and inserts nothing
× refuses where the format’s graph rules would refuse it: an upload before any consent
× ends the flow with a success or failed screen only where nothing follows yet
× inserts country select with branching: a screen with a country_select and a branch on it
Tests  8 failed (8)
```

GREEN `7ac34b7e`: `Tests  8 passed (8)`. A placement refusal is the first error `checkFlowGraph` reports inside
the inserted steps among `consent_not_dominating`, `step_order_invalid` and `verification_type_repeated`,
worded "The format’s rules refuse it here: <detail>" (no second copy of a rule).

UI RED `77889300`: `Unable to find an accessible element with the role "menuitem" and name "Add a module after"`
(and "Add a module here"); `Tests  3 failed (3)`. GREEN `6bc7fcc2`: folder `Test Files 10 passed (10), Tests 71 passed (71)`.

### K9-6: warnings and waitFor (C150.5, C150.9, C150.11)

RED `ef0e669c`: `Unable to find ... "list" and name "Warnings at this branch"`, `... "group" and name
"Wait for facts (waitFor)"` (twice), `... "After the wait, an unknown value follows"`; `Tests 4 failed | 1 passed (5)`
(the passing one is "no warning list without warnings"). GREEN `53b09af5`: `Tests 5 passed (5)`.
Builder RED `bd160c08`: `Unable to find ... "Warnings at this branch"`, `1 failed`; GREEN `4515a254`: `Tests 77 passed (77)`.
A new wait starts at 5 s (provisional, ours: two of the session's 2-second polls, C150.5, and a margin); the
bound is `FLOW_V2_CAPS.waitMaxSeconds` (30).

### K9-5: diff badges, copy and promote (C155.7)

Diff RED `9c39ecde`: `Expected element to have text content ... flow-builder-diff.test.tsx:71` (no badge), `1 failed | 1 passed`;
GREEN `495c1379`: `Tests 79 passed (79)`. Page RED `b6f4959c`: `page.test.tsx:104` (no diff read), GREEN `decba49b`: `7 passed`.
Dialogs RED `eef7c3ef`: dialogs `7 failed` (no "Copy template…" or "Promote…" button), actions `3 failed | 2 passed`
(`expected { ok: false … } to deeply equal { ok: true … }`). GREEN `41ca8485`: `Tests 12 passed (12)`; the action test
first expected a `templateId` the promote answer does not carry (the version resource has no
`inquiry-template-id`), so the member was dropped from the action and both tests. `41ca8485` put a list in
the typed catalog, which `defineCopy` does not type, and broke the dashboard typecheck until `0bcdd978`
(about 20 minutes): the group is keyed now.
Page RED `eff89c8a`: `Unable to find ... "group" and name "Copy and promote"`; GREEN `c095c521`: `Test Files 20 passed, Tests 132 passed`.

### K9-7: R005 (loops, modules, back-edge, while and list predicates)

RED `4914cb38`: `Tests 8 failed (8)` (`expected [ 'step:wait-time', …(3) ] to deeply equal [ …(7) ]`,
`expected undefined to match object { type: 'loop' … }`, `expected [] to deeply equal [ 'each' ]`,
`expected { '===': … } to deeply equal { some: … }`). GREEN `a02b9952`: `Test Files 36 passed (36), Tests 269 passed (269)`
after four existing tests followed the larger palette (positions 4 to 8, 4 to 8 step radios, the four new
labels) and the now readable `some` predicate (the hand-written example became `>` inside the predicate).
`a02b9952` left a `Map` key type error (dashboard typecheck red until `513895b3`).
UI RED `1cf8db79`: `Unable to find ... "menuitem" and name "Lead next back to Loop: Each item"`, `... "radio" ... Module:
Synthetic screening`, `... "textbox" ... "List to loop over"`, `... "When an element of comparison 1 of group 1 cannot be
read"`; `Tests 4 failed (4)`. GREEN `f5903a0b`: `Test Files 37 passed (37), Tests 273 passed (273)`.

### K9-4: the screen editor (C155.5, C155.10)

Model RED `7f911698`: `Tests 7 failed (7)`; GREEN `75f4943b`: `Tests 7 passed (7)`. Editor RED `6593445d`:
`Unable to find ... "list" and name "Components of the screen"`, `... "combobox" and name "Kind"`, `... "group" and name
"Actions for middle"` (3); `Tests 5 failed (5)`. GREEN `f7e3898f`: `Tests 5 passed (5)`. Builder RED `aa09aa72`:
`Unable to find ... "region" and name "Components of the screen"`; GREEN `3cf90b81`: `Test Files 18 passed, Tests 104 passed`.
Empty-route RED `5aa5dcf3`: `Unable to find ... "button" and name "Add a comparison"`; GREEN `0d9f83c6`: `Tests 105 passed`.

Full stack (`b406b47a`): the first run of the new test failed on the spec's own locator
(`strict mode violation: ... treeitem /^Screen s_[a-z2-7]{8}/ resolved to 2 elements`: the published flow already held
the fallback screen of test 1); the spec now reads the new screen's id from the selected step. Second run: `4 passed (32.4s)`.

Not built (reported as blockers): the drag-and-drop screen canvas (the editor offers every move as a button,
2.5.7, but no canvas of components); per-component style overrides in Design (the flow-spec 2 component
schema is strict and has no style member, so the tab says where the look comes from); the workflow draft page
passing its workflows as `modules` (the palette offers a module only when given one).

## Final gates (fix-builder's, beside fix-flow and fix-console)

| Gate | Command | Exit | Time | Load |
|---|---|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit -p tsconfig.json` (apps/dashboard) | 0 | ~170 s | 3 to 7 |
| ESLint, my paths | `NODE_OPTIONS=--max-old-space-size=4096 pnpm exec eslint src/components/flow-builder src/components/workflows src/components/graph-editor src/app/templates/[id]/flow src/app/templates/[id]/page.tsx src/lib/copy/flow-builder.ts src/lib/copy/graph-editor.ts` | 0 | | |
| Forced lint and typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 0 (`4 successful, 4 total`) | 178 s (03:08:46 to 03:11:44) | 6.17 to 3.51 |
| Dashboard unit shard 1/2 | `bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-1 --shard=1/2 --reporter=blob --outputFile=<dir>/blobs/blob-1-2.json` | 1 (partial coverage, as a lone shard does) | 225 s | 11.81 to 9.49 |
| Dashboard unit shard 2/2 | same with `2/2` | 1 (partial coverage) | 212 s | 7.08 to 8.46 |
| Dashboard merge (the gate) | `bash /tmp/openverify-heavy.sh pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged` | **0**: `Test Files 579 passed (579)`, `Tests 6707 passed (6707)`, all files 95.58 / 88.43 / 94.94 / 95.63 | 7 s | 7.55 |
| Prettier | `pnpm exec prettier --check <my 37 files>` | 0 | | |
| Full stack, one call | `flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "... e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && ... e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 ... playwright test --project=chromium tests/ui-flow-builder.spec.ts tests/ui-workflow-editor.spec.ts tests/ui-a11y-builder.spec.ts; ... e2e:stack:down"` | 0: `9 passed (55.2s)` | 152 s in all (03:12:09 to 03:14:41) | 2.72 to 2.52 |

The specs' times: ui-a11y-builder 6.9 s; ui-flow-builder 9.5, 2.6, 4.3 and 10.2 s (the new keyboard-only test);
ui-workflow-editor 6.9, 4.0, 1.7 and 5.9 s. No OTP is sent by the new test.
