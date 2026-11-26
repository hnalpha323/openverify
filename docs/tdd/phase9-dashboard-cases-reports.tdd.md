# Phase 9, Workflow 9C Stage 1: dashboard-cases-reports

The case completions of C172 and the report, verification, print and trust-store completions of
C173 in the console, with the graph explorer's property-node expansion (owner decision 20 after
Workflow 7B). Base `69ebd7fa`. Every command below was run after `source scripts/env.sh`.

## Precondition and re-verification (the plan's Stage 1a rule for 9C)

- `docs/PROGRESS.md` records "Workflow 9A done" (line 116) and "Workflow 9B done" (line 20);
  `079cdba0` (9B's PROGRESS entry) is an ancestor of the base.
- The Handover to 9C's lines for this area, checked against the code at the base:
  - `GET` and `POST /cases/:id/checklist`: `apps/api/src/routes/server/case-checklists.ts:27`;
    body `setCaseChecklistItemBodySchema`, answer `caseChecklistStateDocumentSchema`
    (`packages/contracts/src/cases.ts:934-968`). Matches.
  - `POST /dashboard/print-audits`: `printAuditDocumentSchema`, body `{ object-id }` of `inq_`,
    `rep_` or `ver_` (`packages/contracts/src/print-audits.ts`). Matches.
  - Case template version members `layout`, `checklists`, `preset-comments` and a status's
    `requires-fields` (`packages/contracts/src/case-templates.ts:100-226`). Matches B35.
  - Case actions: `placement` (`header`, `status-switcher`, `module:<key>`) on the available
    action, `visible-when` on the action resource only (`packages/contracts/src/case-actions.ts`).
    The available-actions answer is already filtered by `visible-when`; it does not serve the
    member itself. Matches.
  - `latest-run-notes` on the report (`packages/contracts/src/reports.ts:329`), optional; served
    once a run has finished. Matches.
  - `GET /verifications/:id?include=files` and `redacted-at` (`VERIFICATION_INCLUDES`,
    `packages/contracts/src/verifications.ts:348`; `redacted-at` optional and nullable). Matches.
  - Trust store: `settings { refresh-enabled, icao-crls-allowed }`
    (`packages/contracts/src/trust-anchors.ts:104-106`), no `meta.flags`. Matches orchestrator
    decision 8.
  - Graph expansion: `@openverify/node`'s `graphQueries.expandNode(id, nodeId, { runSync })`
    (`packages/node/src/client.ts:867`, `:2810`). Matches B42.
  - K19: the sandbox list fixture still has no OFAC Consolidated entry (S4B-18).
- No drift found for this area's routes at the base.

## Slice 0: the first checkpoint (clients, mock routes, copy)

Stub commit `cfa0a5d0` (the clients rejecting "not built yet", the copy catalog
`lib/copy/cases-reports.ts` as `as const`, the mock routes `testing/routes/cases-reports.ts`).

RED (`54c4df14`):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/case-checklists.test.ts src/lib/api/print-audits.test.ts --coverage.enabled=false
 FAIL  src/lib/api/print-audits.test.ts > recordPrintAudit > posts the object id alone with the session and answers the audit entry written
Error: not built yet: inq_01JB0000000000000000000001
 Test Files  2 failed (2)
      Tests  4 failed (4)
```

GREEN (`56113669`):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/case-checklists.test.ts src/lib/api/print-audits.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  4 passed (4)
$ pnpm exec eslint <the six files>          # rc=0
$ pnpm exec prettier --check <the six files> # All matched files use Prettier code style!
$ pnpm --filter @openverify/dashboard typecheck
src/lib/api/template-preview.test.ts(44,50): error TS2345 ...   # dashboard-preview's in-flight file only; none of mine
```

This area adds no route, so it needs no navigation entry and no template tab: its pages
(`/cases/[id]`, `/case-templates/[id]/versions/[versionId]`, `/inquiries/[id]`, `/reports`,
`/reports/[id]`, `/verifications/[id]`, `/trust-anchors`, `/graph/[id]`) all exist.

Checkpoint `[9c-checkpoint:dashboard-cases-reports:1]`: this file's commit.

## Slice 1: checklists on the case page (C172.2, C172.7)

Stub `710b843a`; RED `b194c001` (the checklist model pairing each item with its state, the
`CaseChecklists` component, the `checkCaseChecklistItem` server action):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/cases/checklists src/app/cases/[id]/checklist-actions.test.ts --coverage.enabled=false
     × pairs each item of the version with its state, and names the unchecked items a status needs
     × says who checked each item and when, and what an unchecked item is needed before
     × checks an item only through its own button, sending the item, its new state and the lock version
     ... 10 failed (the two "calls nothing" guards passed already)
```

GREEN `8347dfad`: `Tests 12 passed (12)`; dashboard typecheck rc=0; eslint rc=0 (the test reads the
sent fields through one helper, for `non-nullable-type-assertion-style`).

## Slice 2: the case page's completions (C172.1-C172.5)

Stub `e274560c`; RED `20929652`, plus the status words RED `1f6f2c7d` (the commit
"a status change refused by an unchecked item or an empty required field is titled in the console
words"):

```
$ pnpm --filter @openverify/dashboard exec vitest run completions.test --coverage.enabled=false
     × names the fields and the unchecked items the chosen status needs first
     × inserts a preset into the box to be edited, and posts nothing until the comment is added
     × reads the checklist for a version with one and shows who checked each item
     × arranges the modules in the version’s columns, a collapsed one closed, and leaves out what the layout does not place
     × shows each case action in its placement only, and a preset comment beside the box
$ ... vitest run checklist-actions
     × titles case_checklist_incomplete in the console’s words, keeping the pointer
     AssertionError: expected 'Synthetic Problem' to be 'Check every item that status requires…'
```

GREEN `4b8bf49b`: `Tests 192 passed (192)` over `src/components/cases` and `src/app/cases`, then 127
with the status words; typecheck rc=0; eslint rc=0.

## Slice 3: the layout editor and the checklist editor in the version (C172.1-C172.4)

Stub `4c475986`; RED `a25347b7` (19 failed of 28: the model, the editor by keyboard, single pointer
and drag, the two save actions, the checklists editor, the version page). GREEN `bd203cd3`:
`Tests 235 passed (235)` over `src/components/cases`, `src/app/case-templates`, `src/app/cases`;
typecheck rc=0 on my files (others' in-flight files only); eslint rc=0 (the focus after a column move
is held in a ref, not state, for `react-hooks/set-state-in-effect`). Three RED matchers were
corrected in GREEN to the DOM as rendered (`toHaveDisplayValue`, a JSON editor's error `li`, a
default-layout sentence that was also announced).

## Slice 4: reports (C173.1, K15, K20)

Stub `815d0ce9`; RED `2e9bf98e` (8 failed: the coverage words, the index and history sentence, the
latest run notes, the ten detail reads). GREEN `61197466`: `Tests 398 passed (398)` over
`src/components/reports`, `src/app/reports`, `src/app/inquiries`, `src/lib/api/reports`,
`src/app/accounts`.

## Slice 5: print views and verification files (C173.2, C173.3)

Stub `7993d787`; RED `598771bc` (19 failed: the button, the footer, the action, each page's
`print.css`, the three pages, the `include=files` read). GREEN `9a40ba07`: `Tests 812 passed (813)`
then 813 after the test read the Redacted `status` as the page renders it.

## Slice 6: the property-node expansion (owner decision 20 after Workflow 7B)

Stub `d31159c9`; RED `a2f6921b` (8 failed). GREEN `c53d6898`: `Tests 177 passed (177)` over
`src/components/graph` and `src/app/graph` (7C's explorer tests green).

## Slice 7: the inquiry's expiry windows (C151.10, the Handover to 9C)

RED `b56e25b4` (`Unable to find ... Expires after start`). GREEN `9f525b62`: `Tests 298 passed`;
dashboard typecheck rc=0 (whole package clean at that moment); eslint rc=0.

## The full-stack spec

`2a1fdb4d`: `e2e/tests/ui-cases-reports.spec.ts` with `e2e/tests/support/ui-cases-reports.ts`
(`pnpm --filter @openverify/e2e typecheck` rc=0; eslint rc=0). Its run is in "Final gates".

## Defects the full-stack spec found, fixed test-first

- WCAG 2.5.3 (axe `label-content-name-mismatch`): the layout editor's buttons showed "Move up"
  under the name "Move Comments up". RED `layout-editor.test.tsx` "shows each control's whole name"
  (`expected 'Move Timeline up' to be null`); GREEN `e6f79e96`: each control's visible text is its
  whole name.
- WCAG 2.5.8 (axe `target-size`): 7C's graph "Held by" lists stacked two small account links. RED
  then GREEN `73f51b7b` (each link `inline-flex min-h-6`), a borrowed edit of
  `components/graph/graph-table.tsx`.
- WCAG 2.5.3: 7C's expansion link showed "Open in the explorer" under the name "Open <id> in the
  explorer". RED then GREEN `44c9bda3`, a borrowed edit of `components/graph/graph-explorer.tsx`.
- Spec corrections: the print note read beside the button (`c0298e16`); the no-`pii:view` check
  reads each page's document with its inlined server components payload through a normal
  navigation (`1c121878`, `58ea03d4`; a bare `RSC: 1` request answered 307).

## Final gates

| Gate | Result | Time and load |
|---|---|---|
| `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard test` | rc=0: 561 files, 6,535 tests; statements 95.58%, branches 88.53%, functions 94.92%, lines 95.61% | 346 s, load 3.2 to 7.1 |
| `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | rc=0, 4 of 4 tasks | 180 s, load 2.3 to 3.8 |
| `pnpm exec prettier --check <my files>` | All matched files use Prettier code style | |
| The locked sequence: stack down, `turbo run build --filter=@openverify/e2e^...`, stack up, `playwright test tests/ui-cases-reports.spec.ts`, stack down | rc=0: 4 passed (40.4 s for the spec) | 147 s for the whole call, load 1.9 to 5.5 |

Earlier attempts, for the record: the whole dashboard script took 811 s at a load of 23 (over the
call cap; run in the background, then as two blob shards of 357 s and 315 s and an 8 s merge, rc=0,
559 files, 6,529 tests); the first merge exited 1 only on other agents' in-flight tests
(`components/operators/grantable.test.ts`, `components/workflows/editor/condition-model.test.ts`),
which passed when re-run. The forced lint once failed only on `components/themes/asset-upload-form.tsx`
(dashboard-themes-copy's), then passed. Several e2e attempts waited for the lock (others used
`flock -w 1800`); one build failed on `app/settings/actions.ts` (dashboard-settings') until its fix.

## Decisions taken here (each a contractDeviation in the report)

- The case page shows a module only where the version's layout places it; a version without a
  layout keeps Phase 8's default arrangement. Header-placed actions stay in the "Case actions"
  section (Phase 8's home of the header placement), shown at the top of the page when the layout
  leaves that module out; available actions are read whenever the reader holds that module's
  permissions.
- An action placed in a module the page does not show, and a status-switcher action for a reader
  who sees no switcher, are shown with the header's actions.
- The layout, checklists and preset comments are each saved alone (`PATCH` naming only those
  members) by server actions in `components/cases/layout/layout-actions.ts`, so Phase 8's draft
  form (`app/case-templates/actions.ts`, not this area's) is unchanged. `requires-fields` stays in
  the statuses JSON document.
- The inquiry reports section reads the newest ten completion reports in full and judges the rest by
  `latest-run-notes` from the masked list, saying so.
- `GET /verifications/:id` takes one include, so the page reads `include=files` and, for a selfie,
  `include=selfies` in a second call.
- The trust-store flags were already shown read-only since Phase 5 (`trust-store-view.tsx:261-272`),
  so nothing changed there but the spec's check.

## Requests

None addressed to others; none addressed to this area (checked with
`git log ... | grep -F '[9c-request:dashboard-cases-reports]'`: no line).
