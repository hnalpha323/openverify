# Phase 9, Workflow 9C Stage 1: dashboard-flow-builder

Evidence of the TDD cycle (CLAUDE.md rule 1), on base `69ebd7fab17aa13ff13dbf5cf673be08678f2fff`. Every command
was run after `source scripts/env.sh`, from `apps/dashboard` unless it says otherwise.

## Precondition and re-verification

- `docs/PROGRESS.md` records "2026-11-05: Phase 9, Workflow 9A done" and "2026-11-06: Phase 9, Workflow 9B done";
  `git log 69ebd7fa` holds both (`079cdba0` is 9B's PROGRESS entry).
- Re-verified against the code (the Handover to 9C and the routes as built):
  - `GET /exports` (`apps/api/src/routes/server/exports.ts:80`) has no static scope; it serves the caller's exports of
    the types it still holds `:export` for (`EXPORT_PERMISSIONS`, `packages/core/src/exports.ts:40`, six scopes;
    `cases:export` is Phase 8's case export, not one of them).
  - `GET /theme-sets` needs `theme-sets:read`; `GET /analytics/*` `analytics:read`; `POST /reports/bulk`
    `reports:write`; `GET`/`PUT /dashboard/notification-preferences` a session and no permission.
  - The template routes of C154.4 are served (`routes/server/inquiry-templates.ts`: restore, copy, used-by,
    promote; `inquiry-template-versions.ts`: validate, diff, preview, simulate); `PATCH` and `publish` answer an
    `etag` header and honour `If-Match` (`ifMatchHeadersSchema`); `GET /deployments` needs `deployments:read`.
  - `@openverify/node` has no method for validate, diff, restore, copy, used-by or promote, and none of its
    methods sends `If-Match` or returns the `etag` header, so the console's clients call them through
    `apiRequest` (amendment FB-3).
  - `apps/dashboard/package.json` does not depend on `@openverify/flow-spec`, whose v2 rules C155.6 runs in the
    browser (amendment FB-2).

## Slice 0: the shared slice ([9c-shared])

RED (tests first, stubs so they compile):

```
$ pnpm exec vitest run src/components/nav-items.test.ts src/components/nav.test.tsx \
    src/components/console-layout.test.tsx src/components/template-tabs.test.tsx src/lib/copy/catalog.test.ts \
    --coverage.enabled=false
 ❯ src/lib/copy/catalog.test.ts (2 tests | 2 failed)        frozen catalog expected
 ❯ src/components/template-tabs.test.tsx (8 tests | 8 failed)   not built yet
 ❯ src/components/nav-items.test.ts (53 tests | 19 failed)  the 9C entries, currentNavHref
 ❯ src/components/nav.test.tsx (3 tests | 2 failed)          31 links; most specific item current
 ❯ src/components/console-layout.test.tsx (11 tests | 1 failed)   "Notification settings" link
$ pnpm exec tsc --noEmit      # rc=2 only on dashboard-preview's in-flight src/lib/api/template-preview.test.ts
```
- `fe03b61f` RED (above). Then the template page's own test (RED `test(dashboard): the template page links its
  sections`): `vitest run 'src/app/templates/[id]/page.test.tsx'` → 1 failed (no "Template sections"
  navigation), 9 passed.

GREEN:

```
$ pnpm exec vitest run src/components/nav-items.test.ts src/components/nav.test.tsx \
    src/components/console-layout.test.tsx src/components/template-tabs.test.tsx src/lib/copy/catalog.test.ts \
    'src/app/templates/[id]/page.test.tsx' --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  87 passed (87)
```

### What the shared slice gives the other 9C agents

- **Navigation** (`components/nav-items.ts`): `/theme-sets` "Theme sets" (`theme-sets:read`) under Verifications;
  a new group "Insights" with `/analytics` (`analytics:read`) and `/exports` (any of the six `EXPORT_PERMISSIONS`,
  through the new optional `NavItem.anyOf`); `/exports/bulk-reports` "Bulk reports" (`reports:write`) under
  Reports. 31 links in 8 groups for an admin (was 27 in 7). `currentNavHref(pathname, groups)` marks only the most
  specific item, so the bulk report page does not also mark Exports.
- **Header** (`components/console-header.tsx`): "Notification settings" links `NOTIFICATION_PREFERENCES_PATH`
  (`/notifications`, `dashboard-settings`' `app/notifications/page.tsx`): the route needs a session only, so it is
  beside "Security", not in the permission-gated navigation.
- **Template sections** (`components/template-tabs.tsx`): `TemplateTabs({ templateId, current })` with
  `current` one of `TEMPLATE_TAB_KEYS` (`overview`, `flow`, `settings`, `translations`, `theme`, `preview`) and
  `templateTabHref(templateId, key)`: `/templates/[id]`, `/templates/[id]/flow`, `/templates/[id]/settings`,
  `/templates/[id]/translations`, `/templates/[id]/theme`, `/templates/[id]/preview`. Each owner renders it under
  its page header with its own key.
- **Copy catalog** (`lib/copy/catalog.ts`): `defineCopy(catalog)` (deep-frozen, typed exactly), `CopyCatalog`,
  `CopyMessage` (a string, or a function of values returning a string). Each area keeps
  `lib/copy/<area>.ts` with `export const <AREA>_COPY = defineCopy({...})`. `lib/copy/console.ts`
  (`CONSOLE_COPY`) holds the shared navigation and section words.
- **Mock routes:** no registration point is needed; each `testing/routes/<area>.ts` registers its routes on a
  `routeApi()` the test made (Phase 6's pattern, as `testing/routes/workflow-editor.ts`).

## Slice 1a: the console's template clients (part of `[9c-checkpoint:dashboard-flow-builder:1]`)

RED (stubs that throw "not built yet", so the tests compile and typecheck):

```
$ pnpm exec vitest run src/lib/api/inquiry-template-versions.test.ts src/lib/api/inquiry-templates.test.ts \
    src/lib/api/deployments.test.ts src/lib/api/http.test.ts --coverage.enabled=false
     × reads a version with the strong ETag it is served with
     × refuses a version served without an ETag, so no save can skip If-Match
     × saves a draft with If-Match and allow-invalid, answering its new ETag (C154.2, C154.3)
     × tells a 412 precondition_failed apart from every other problem
     × publishes with If-Match, the acknowledgements and the note (C154.9)
     ... 16 failed: Error: not built yet ...
$ pnpm exec tsc --noEmit    # tsc=0
```

GREEN:

```
$ pnpm exec vitest run src/lib/api/inquiry-template-versions.test.ts src/lib/api/inquiry-templates.test.ts \
    src/lib/api/deployments.test.ts src/lib/api/http.test.ts src/lib/api/client.test.ts \
    src/testing/api-routes.test.ts --coverage.enabled=false
      Tests  41 passed (41)
$ pnpm exec tsc --noEmit    # tsc=2, only dashboard-preview's in-flight flow-preview-frame.test.tsx
```

One RED test was corrected before GREEN: "encodes the version id it is given" expected a refusal, but
`encodeURIComponent` makes `itmplv_a/b` a valid single path segment; the test now checks the encoded path
(`itmplv_a%2Fb`).

### The clients (for the other agents, import only)

`lib/api/inquiry-template-versions.ts` (server-only):
- `retrieveTemplateVersion(versionId): Promise<VersionWithEtag>`: `{ version, etag }`; refuses an answer without an
  `ETag`.
- `updateTemplateVersion(versionId, attributes: VersionAttributesUpdate, etag): Promise<VersionWithEtag>`: `PATCH`
  with `If-Match: etag` and `meta: { 'allow-invalid': true }`.
- `publishTemplateVersion(versionId, { acknowledgements, publishNote? }, etag): Promise<VersionWithEtag>`.
- `validateTemplateVersion(versionId, { attributes?, mode? }): Promise<TemplateVersionValidation>`.
- `diffTemplateVersions(versionId, againstId): Promise<TemplateVersionDiff>`.
- `isPreconditionFailed(error): boolean`: the 412 (`OpenVerifyApiError`, status 412, code `precondition_failed`).

`lib/api/inquiry-templates.ts`: `restoreTemplateVersion(templateId, versionId)`, `copyTemplate(templateId, { name,
versionId? })`, `promoteTemplate(templateId, { environmentId, versionId? }): { version, copied }`,
`templateUsedBy(templateId): TemplateUsage`.

`lib/api/deployments.ts`: `listTemplateDeployments(templateId, { after? })`, `DEPLOYMENT_PAGE_SIZE` (25).

`lib/api/http.ts` and `client.ts`: `ApiCall.headers` (the call's own request headers; the session, BFF token,
client address, `accept` and `content-type` stay the BFF's), `sendApiRequestWithHeaders` and
`apiRequestWithHeaders` answering `{ data, headers }`.

`testing/api-routes.ts`: `RouteAnswer.headers` and `on(method, path, status, body, headers?)`.
`testing/routes/flow-builder.ts`: `syntheticEtag`, `serveTemplateVersion`, `serveDraftSaves` (412 on a stale
`If-Match`), `serveValidation`, `serveDiff`/`diffAttributes`, `serveNoDeployments`, `serveUsage`.

## Slice 1b: the GraphAdapter refactor and the two slots (`[9c-checkpoint:graph-editor]`)

RED (stubs throwing "not built yet"; the two slot files are their final stubs, rendering nothing):

```
$ pnpm exec vitest run src/components/graph-editor/ src/components/flow-builder/ \
    src/components/workflows/editor/workflow-adapter.test.ts \
    'src/app/workflows/[id]/test-runs/overlay-slot.test.tsx' --coverage.enabled=false
     × lays a graph out top to bottom, at whole pixels, ignoring edges to unknown nodes
     × keeps the problems at a pointer or inside it, never a sibling that shares a prefix
     × nests each path under its roots, typed, nullable where the fact can be unknown
     × selects, keeps a drag, and places a released node at whole pixels as one gesture
     × connects through the adapter's rules, and refuses what the format cannot express
     × draws what the adapter describes, named as the outline names it, in its words
     × renders the step-panel slot for the selected step, with the draft's flow and config
     × renders the slot with the chosen version's structure and the selected run's steps
     × draws exactly what the workflow canvas drew, in the workflow's words   (4 workflow adapter tests)
$ pnpm exec tsc --noEmit   # tsc=2 only in dashboard-preview's in-flight preview files
```

GREEN, then the refactor with the suites green (one commit: the move is the refactor the plan names):

```
$ pnpm exec vitest run src/components/workflows src/components/graph-editor src/components/flow-builder \
    src/app/workflows src/lib/copy --coverage.enabled=false
 Test Files  50 passed (50)
      Tests  404 passed (404)
$ pnpm exec eslint src/components/workflows src/components/graph-editor src/components/flow-builder ...   # clean
$ pnpm exec tsc --noEmit   # no error in these files
```

One RED test was corrected: the overlay slot's "structure only" check looked for the text `"config"`, but
Phase 8's `structureOf` keeps the trigger's `config: {}`; it now checks that no step carries `config` and the
trigger's is empty.

### The GraphAdapter (`components/graph-editor/graph-adapter.ts`)

`GraphAdapter<T extends GraphAdapterTypes>`, where `GraphAdapterTypes` is `{ document, edit, context, diff,
palette }`:
- `noun`, `ariaLabels` (`@xyflow/react`'s strings from `lib/copy/graph-editor.ts`, one set per document type);
- `viewOf(document, issues, marks, path?) → GraphView { nodes: GraphNodeView[], edges: GraphEdgeView[] }` (node
  kinds and ports, labels, problem badges, diff marks, run statuses);
- `portsOf(document, nodeId)`, `portWords(port)`;
- `isValidConnection(document, connection)`, `validTargets(document, from, port)`, `connect(document, connection)
  → edit | null` (one rule for the canvas and the outline's "Connect to");
- `place(document, nodeId, position) → edit` (the layout member only);
- `problemNode(document, pointer) → nodeId | null` (the problem mapper);
- `conditionScope(document, nodeId, context) → ScopePath[]` and `conditionScopeSchema(...)` (its JSON Schema, from
  `scopePathsSchema`, with `x-pii`, `x-tier`, `x-stage`);
- `paletteOf(document, nodeId | null, context) → palette[]`;
- `diffMarksOf(diff) → Record<nodeId, 'added' | 'changed'>` (the diff renderer).

Shared modules: `graph-canvas.tsx` (`GraphCanvas<T>({ adapter, document, issues, marks, selectedId, onSelect,
onEdit?, path? })`, client-only, with `graph-canvas.css`, moved from `workflows/editor/workflow-canvas.css`),
`graph-changes.ts` (`graphChangesOf`, `graphConnectionOf`), `layout.ts` (`tidyGraph(nodeIds, edges)`,
`NODE_WIDTH`, `NODE_HEIGHT`), `history.ts` and `edit-menu.tsx` (moved from `workflows/editor/` with their tests),
`issuesUnder`, `scopePathsSchema`, and the shared `ScopePath`, `DiffMark`, `StatusBadge`, `GraphPath` types.
`components/workflows/editor/workflow-adapter.ts` holds `WORKFLOW_ADAPTER` (Phase 8's `canvasOf`, `port-rules`,
`placeNode`, `scopeAt`, `paletteOf`, `diffMarksOf`, held equal by `workflow-adapter.test.ts`);
`workflow-canvas.tsx`, `canvas-changes.ts`, `layout.ts` and `canvas-words.ts` now delegate to the shared modules
with their names and signatures kept, so every Phase 8 importer and test is unchanged.

### The two slots (rule 19; their props)

`components/check-panels/step-panel.tsx` (now `dashboard-template-forms`'): `StepPanel(props: StepPanelProps)`,
rendering nothing until filled, with
- `flow: FlowV2` (the draft's flow, v1 drafts migrated with `migrateFlow`),
- `step: FlowV2Step` (the selected step, one of `flow.steps`),
- `verificationConfig: VerificationConfig`,
- `editable: boolean` (a draft and `inquiry-templates:write`),
- `onVerificationConfigChange(next: VerificationConfig, message: string)`: the builder records it as one undoable
  edit announced with `message` and autosaves with `If-Match`.
Mounted by `components/flow-builder/flow-step-panel.tsx` (`FlowStepPanel`), the builder's panel for the selected
step, below the step's own form.

`components/workflows/overlay/run-overlay.tsx` (now `dashboard-preview`'s): `RunOverlay(props: RunOverlayProps)`,
rendering nothing until filled, with
- `definition: DraftDefinition`: the version's structure only (`structureOf(readDraft(definition))`);
- `run: { id, status, steps: OverlayStepRow[] } | null`, each row `{ nodeId, iterationPath, status, overridden,
  simulated }` in the API's order.
Mounted by `app/workflows/[id]/test-runs/page.tsx` in the "Test run result" section, with the chosen version and the
selected run (`?run=wfr_…`), when `workflow-runs:read` lets the page read the run.

## Slice 1c: the flow page (`[9c-checkpoint:dashboard-flow-builder:1]`)

The one route my navigation and tabs point at that is mine: `/templates/[id]/flow`. RED
`vitest run 'src/app/templates/[id]/flow'` → 4 failed (not built yet), 1 passed (the title); GREEN → 5 passed.
It opens the template's draft under the sections (Flow marked), says "no draft" with a link to the overview where
"New draft" is, 404s a malformed id without calling the API, and needs `inquiry-templates:read`.

The first checkpoint is complete with it: the clients (slice 1a), `testing/routes/flow-builder.ts`,
`lib/copy/flow-builder.ts` (`FLOW_BUILDER_COPY`) and `lib/copy/graph-editor.ts` (`GRAPH_EDITOR_COPY`), the graph
editor and the slots (slice 1b), the shared slice's navigation and tabs. No navigation request of mine is open (I own
the navigation). Full-stack runs of Phase 8's three workflow specs wait for the final gate (they need no change: the
canvas keeps its markup and class names, the outline is unchanged).

## Request R3 of dashboard-template-forms: the form model outside a workflow

`components/workflows/editor/schema-form-model.ts` gains `SchemaFormOptions { references?: boolean }` (default
`true`, Phase 8's behaviour) on `fieldsOf(schema, options?)` and `parseFieldText(field, text, options?)`: with
`references: false` no hint mentions `{{ path }}`, no field is a secret reference, and a number refuses a
reference ("Enter a whole number."). RED `vitest run .../schema-form-model.test.ts` → 2 failed, 10 passed; GREEN
(after one correction: a secret-pattern field is a plain text field outside a workflow) → the workflows folder
passes whole.

## Requests of dashboard-analytics (1, 2) and dashboard-preview (2)

RED `610b0223`: `vitest run src/lib/api/inquiries.test.ts src/lib/api/transactions.test.ts
'src/app/templates/[id]/versions'` → 2 failed (the list still read `/dashboard/inquiries`), 1 failed (no
`filter[fields.*]`), 1 failed (no "Preview this version" link).

GREEN: `listInquiries` reads the server API's `GET /inquiries` (same `inquiryListDocumentSchema`, masked for the
session principal; the dashboard route ignores C165.3's new filters); `TransactionFilters.fields` is sent as
`filter[fields.<key>]`; the version page links `/templates/<id>/preview?version=<itmplv>`. The five tests that
mocked the list at `/dashboard/inquiries` now mock `/inquiries` (a plan change of the route the console reads; one
line each, `app/reports/rsc-payload.test.tsx` a borrowed edit of `dashboard-cases-reports`' file):
`vitest run ... src/app/inquiries/page.test.tsx src/app/reports/rsc-payload.test.tsx
src/testing/rsc-payload-signals.test.tsx 'src/app/accounts/[id]'` → 12 files, 90 tests passed.

## Slice 2: the flow adapter, its document model and the outline model (C155.1-C155.3)

RED (stubs throwing "not built yet"; tsc clean for these files):

```
$ pnpm exec vitest run src/components/flow-builder/ --coverage.enabled=false
 flow-model.test.ts: beforeAll fails (Error: not built yet: consent s_consent0), 30 skipped
 flow-outline-model.test.ts, flow-adapter.test.ts: fail at load (stepTemplate not built yet)
```

GREEN: `vitest run src/components/flow-builder/` → 41 passed. Two RED tests were corrected: a screen button's `port`
member is the key (`back`), its step port `button:back` (C148.1 as `rules/components-walk.ts` builds it); and an
unwired `exhausted` port is not shown as a "Not connected" gap (the fallback is optional, C150.6), so the outline
lists it only once wired.

- `flow-model.ts`: `opaqueId('s' | 'e', random, taken)` (C151.8), `BUILDER_STEP_TYPES` (every v2 type; `form` is
  v1 only), `stepTemplate(type, id)` (each parses with `stepV2Schema`), `stepPorts`, `requiredStepPorts`,
  `connectionProblem` (`source_unknown`, `port_unknown`, `target_unknown`, `self`, `cycle_not_allowed`: a cycle only
  through screens and branches, C147.6), `canConnectFlow`, `validFlowTargets`, `connectFlowPort` (one edge per port),
  `insertStepAfter`, `deleteFlowStep` (what led in now leads to its `next`; the entry moves on), `addBranchRoute`,
  `moveBranchRoute`, `setStepName`, `updateFlowStep`, `placeFlowStep`.
- `flow-outline-model.ts`: `flowOutlineOf(flow, issues)` (the APG tree from the entry along `next`; ports as groups;
  "Go to" for a step met again; "Not connected" for an unwired required port or route; "Not reachable from the
  start" last), `flowStepLabel`, `flowPortLabel`, `flowProblemStep` (pointers under `/steps`, `/flow/steps` or
  `/data/attributes/flow/steps`).
- `flow-adapter.ts`: `FLOW_ADAPTER` (`noun: 'flow'`, `GRAPH_EDITOR_COPY.ariaLabels.flow`), its scope from
  `flowScopeAt` without any path `availableInFlow: false` (so no `lists.*`), each fact's source in words
  ("Self-asserted" for person facts, "Client-reported" for client facts, C150.10) with its tier and stage.

## Slice 3: the builder (C155.2, C155.6, C155.7 publish; the outline first, by keyboard)

The APG tree moved into the shared editor first (`fa10f05d`, refactor: `graph-editor/outline-tree.tsx`,
`OutlineTree({ label, items, onSelect, onActivate, ref })`; the workflow outline a wrapper; 259 workflow tests green).

RED (the component stub throws; tsc clean for it):

```
$ pnpm exec vitest run src/components/flow-builder/flow-builder.test.tsx --coverage.enabled=false
     × shows the flow as a tree from the entry, the first step the tree's one tab stop
     × adds a step after another from its menu, saves it with If-Match, and announces it
     × offers a second verification of a type with its reason, never silently
     × connects a port only to the targets the format allows
     × undoes and redoes an edit
     × lists the format's problems in place, by step, as they change
     × opens "reload the latest draft" on a 412, with what changed on the server
     × publishes only once every acknowledgement is given, each with its reason
     × says a version 1 draft was migrated and will be saved as version 2
     × is read-only without the right to edit: no menu edits, no save
      Tests  10 failed (10)
```

GREEN: `vitest run src/components/flow-builder/` → 51 passed (tsc 0). Two corrections while going green: problems of
severity `warning` no longer count as a step's errors (the outline's ", N errors" and the canvas badge count errors;
warnings are listed in the Problems panel only), and the publish dialog saves first only when the draft has unsaved
edits (it publishes with the ETag of the saved draft).

What the builder does (`components/flow-builder/flow-builder.tsx`, `flow-dialogs.tsx`): `FlowBuilder({ versionId, flow,
etag, migrated, verificationConfig, canEdit, canPublish, autosaveMs?, actions: { save, check, publish } })`:
- the outline (`OutlineTree` labelled "Outline of the flow"): Enter on an item opens its menu (Add a step after,
  Connect <port> to, Add a fallback when attempts run out, Add a route, Move route up/down, Open settings, Delete, Go to
  the step), every disabled entry with its reason;
- the palette dialog lists every v2 type, a refused one `aria-disabled` and described by its reason;
- the connect dialog lists only `validFlowTargets`; delete asks for confirmation;
- undo and redo (`graph-editor/history.ts`), each edit announced in the "Draft status" live region;
- `checkFlowGraph(flow, { mode: 'save' })` on every edit: errors on the step (outline count, canvas badge), every
  problem in the "Problems" region (`aria-live="polite"`), icon and word;
- autosave after `autosaveMs` (1,500 by default) with the ETag; a conflict answer opens "The draft changed since you
  opened it" with what changed (added, removed, changed steps; connections) and "Reload the latest draft";
- publish: saves unsaved edits, asks the API's validate in `publish` mode, lists its errors, and needs every
  acknowledgement checked (each with its kind's reason, `FLOW_BUILDER_COPY.acknowledgements`) and an optional note;
- the selected step's panel: `FlowStepPanel` (the step-panel slot) with the step's name (screens, branches,
  actions) and its JSON (the editor's fallback, parsed with `stepV2Schema`, its id kept).

The page and its actions: RED `c12c97e6` (`vitest run 'src/app/templates/[id]/flow'` → 6 failed), GREEN → 10 passed.
`app/templates/[id]/flow/actions.ts`: `saveFlowDraft({ versionId, flow, etag })` (`inquiry-templates:write`; the flow
parsed with `flowV2Schema`; a 412 answers `{ kind: 'conflict', latest: { flow (migrated), etag } }`),
`checkFlowPublish({ versionId })` (`inquiry-templates:read`; validate in `publish` mode), `publishFlowDraft({
versionId, etag, acknowledgements, note })` (`inquiry-templates:publish`). The page reads the draft with its ETag
(`retrieveTemplateVersion`), opens a v1 draft migrated (`migrateFlow`, with the notice) and renders `FlowBuilder`.

## Slice 4: the theme picker and the languages panel in the builder (C155.8, after `[9c-checkpoint:dashboard-themes-copy:1]`)

RED: `vitest run src/components/flow-builder/flow-builder.test.tsx` → 2 failed (no theme region, no copy panel);
`vitest run 'src/app/templates/[id]/flow'` → 2 failed (no `theme-set-id` in the PATCH; no `GET /theme-sets`).
GREEN: 53 and 12 passed, tsc 0. `FlowBuilder` takes `theme: { sets: ThemeSetChoice[], value } | null` and
`copyPanel: ReactNode`; it mounts `BuilderThemePanel` (`components/themes/builder-theme-panel.tsx`, import only; its
`onChange` saves the choice with the draft through `saveFlowDraft({ ..., themeSetId })`, read-only without
`inquiry-templates:write`), and the page renders `BuilderCopyPanel` (`components/translations/builder-copy-panel.tsx`,
import only) with the draft's `enabled-locales`, `default-locale`, `copy` and flow-spec's `LOCALE_REVIEW_STATUS`. The
sets are read only with `theme-sets:read` (`filter[status]=active`).

## Slice 5: versions (C155.7): the diff list, used by, deployments, restore

RED `1a1f5471` (`version-diff-list.test.tsx` → 2 failed) and the template page's versions tests (4 failed: no
"Compare versions", "Used by", "Deployments" region, no restore button). GREEN: 2 and 14 passed; tsc 0.
- `components/flow-builder/version-diff-list.tsx` (`VersionDiffList({ diff })`): consequences first, in words
  (`FLOW_BUILDER_COPY.diff.consequenceWords`, one per `TEMPLATE_DIFF_CONSEQUENCES` code), then every change (steps,
  connections, route order, each member at its pointer, the theme set); "Only the layout changed" only when the API
  says `layout-only` and no consequence is flagged.
- The template page (overview): a GET form "Compare versions" (`?compare=<itmplv>&against=<itmplv>`, both checked
  with `idSchema('itmplv')`) with the server diff; "Used by" (`GET /inquiry-templates/:id/used-by`; each kind's
  hidden objects counted, "2 workflows you cannot see"); "Deployments" with `deployments:read` (`GET /deployments`
  filtered by the template); "Restore version N as a draft" per published or superseded version with
  `inquiry-templates:write` (`restoreVersion` in `app/templates/actions.ts`, `POST /inquiry-templates/:id/restore`,
  `draft_exists` shown as the API's problem).
- One existing test changed with the plan: "is read-only for a viewer" now expects the read-only "Compare" button
  only (it asserted no button at all).
- Not built in this slice: copy and promote (the clients `copyTemplate` and `promoteTemplate` exist and are tested);
  the canvas diff badges (the adapter's `diffMarksOf` is built and tested, the builder passes no diff yet).

## Slice 6: branch routes on the shared condition builder (C150, C150.8-C150.10)

RED `b8f94715`: `vitest run .../condition-model.test.ts .../flow-builder.test.tsx` → 2 failed (no `flow-route`
choices; no route condition region). GREEN: the workflows and flow-builder folders, 316 passed; lint and tsc 0.
- `condition-model.ts`: the position `flow-route` with the flow's on-null values (`skip-route`, `route:<key>` of the
  other routes, `else`, `review`), no `error`, no default.
- `variable-scope.ts` takes the shared `ScopePath` (optional `tier`, `stage`); `variable-picker.tsx`'s `pathMarks`
  adds a flow fact's source in words ("Self-asserted", "Client-reported", ...), its tier and the beta stage.
- `components/flow-builder/branch-routes.tsx` (`BranchRoutes`): each route's `ConditionBuilder` over
  `FLOW_ADAPTER.conditionScope` (no path `availableInFlow: false`, so no `lists.*`), the facts the routes read with
  their marks ("Facts the branch reads"), and why no `lists.` path or non-flow-provisional signal is offered.

## Slice 7: the full-stack spec (C155.10, C178.4)

`e2e/tests/ui-flow-builder.spec.ts` with `e2e/tests/support/ui-flow-builder.ts` (`builderDraft`, `changeDraftElsewhere`,
`archiveBuilderDraft`): three tests, each budgeted at 90 s, after `[9c-checkpoint:csp]`:
1. keyboard-only through the outline: an `exhausted` fallback screen added from the Government ID's menu, connected on
   to Completion through "Connect Next to", the outline's ARIA snapshot, the canvas drawing the same 7 steps, undo and
   redo, autosave ("Saved"), axe at each state;
2. the draft saved elsewhere (the API key, no `If-Match`), so the console's save meets the 412: the dialog, axe,
   "Reload the latest draft", then a save that passes;
3. the admin publishes through the dialog, giving every acknowledgement the API asks for (`adverse-path:s_minor000`
   among them) with a note, then compares the new version with the first on the template page.
Every test records `securitypolicyviolation` events and console CSP refusals under the real header and expects none.

The first run failed on the ARIA snapshot's regexes (`/^Screen: Introduction/` reads as a YAML mapping); they became
`/^Screen. Introduction/`. The one locked call (stack down, build, stack up, the spec, stack down):

```
$ flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "... playwright test tests/ui-flow-builder.spec.ts ..."
  ✓  1 keyboard-only authoring through the outline ... (24.6s)
  ✓  2 a draft saved elsewhere meets the 412 ... (8.3s)
  ✓  3 publish with every acknowledgement the API asks for ... (12.8s)
  3 passed (54.0s)
rc=0, 412 s for the whole call (three earlier attempts gave up waiting for the lock), load 30.2 -> 24.4
```

## Phase 8's workflow specs on the refactored editor

One locked call with `tests/ui-workflow-editor.spec.ts tests/ui-workflows.spec.ts`: 4 passed, 2 failed, both the
Phase 8 tests that inject their own nonce policy (`injectNonceCsp`): since `[9c-checkpoint:csp]` the console sends a
real nonce policy whose nonce Next.js gives its later scripts, so the injected one leaves the page unhydrated. The
canvas and outline themselves pass (my spec draws them under the real header). C170.3 makes these real-header tests,
and the files are mine for the editor refactor, so both tests now read the real header (`'strict-dynamic'`,
`style-src 'self' 'nonce-…'`) and keep their violation check and their editor steps; the `injectNonceCsp` import
leaves both files (the helper stays in `ui-graph.ts` for its other callers).

```
$ flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "... playwright test tests/ui-workflow-editor.spec.ts \
    tests/ui-workflows.spec.ts tests/ui-workflow-ops.spec.ts ..."
  13 passed (2.8m)
rc=0, 393 s for the whole call (one earlier attempt gave up waiting for the lock), load 8.6 -> 21.1
```

## Requests R4 of dashboard-template-forms and 4 of dashboard-preview

RED: `vitest run .../run-path.test.ts .../flow-builder-step-form.test.tsx` → 2 failed (no `overridden` badge; no
generated form in the step panel). GREEN: the flow-builder and workflows folders, 318 passed; tsc 0.
- `FlowBuilder`'s step panel renders `StepSchemaForm` (`components/schema-form/step-schema-form.tsx`, import only)
  above the step JSON; its `onStepChange(next, message)` is one undoable edit, announced.
- `canvas-model.ts`' `STATUS_BADGES` gains `overridden: ✎ Overridden` (C156.6).

## Final gates (rules 7, 8 and 23)

| Gate | Call | Result |
|---|---|---|
| Dashboard unit suite with coverage | the whole script took 861 s in one background run at a load of about 28 (over the 600 s cap; 2 failures, both in `dashboard-settings`' in-flight `app/roles/role-editor-pages.test.tsx`), so it ran as 3 blob shards and a merge through `/tmp/openverify-heavy.sh`: shards 303, 289 and 276 s (load 21 to 23, each exit 1 on its partial coverage, as expected), the merge 17 s | merge exit 0: 559 files, 6,529 tests passed; statements 95.57%, branches 88.53%, functions 94.87%, lines 95.6% (`components/flow-builder` 83.18% statements, `components/graph-editor` 89.93%) |
| Forced lint and typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | exit 0, 4 tasks, 337 s, load 11 to 20 |
| Prettier | `pnpm exec prettier --check` over the 119 files my commits touched | exit 0 |
| My full-stack specs | one locked call each (stack down, build, stack up, specs, stack down): `ui-flow-builder.spec.ts` on the final tree (`537c1783`); Phase 8's `ui-workflow-editor.spec.ts`, `ui-workflows.spec.ts` and `ui-workflow-ops.spec.ts` on the refactor (`1b8376c5`) | exit 0: 3 passed in 31.8 s (the call 178 s, load 10.7 to 13.0, six earlier attempts gave up waiting for the lock); exit 0: 13 passed in 2.8 min (the call 393 s) |

The unit suite, lint and typecheck ran at `a6a2c50b`; the two commits after it (`b8f94715`'s GREEN and `537c1783`, the step
form mount and the overridden badge) were checked with their folders' tests (318 passed), eslint and `tsc --noEmit` (0).

## Not built (reported partial; for integration-9c and 9D)

- C155.4 modules (the macros), C155.5 the screen editor (component library, drag with keyboard and single-pointer
  alternatives, Design/Data/Logic tabs): a screen's components are edited through the step's generated form and its
  JSON only.
- C155.7 copy and promote in the console (the clients are built and tested), the canvas diff badges (the adapter's
  `diffMarksOf` is built, the builder passes no diff), "used by" counts per type are shown.
- C150.9-C150.11's builder warnings (client-collected signal branch without a screen after consent; tipping-off routes
  on lists or screening signals) and `waitFor` editing: only through the step JSON; the publish check's own warnings
  are listed.
- The carried Phase 8 item (8D review R005): loop and module steps in the workflow palette, the loop body's back-edge
  into `CONTINUE_PORT` from the outline, and the while-condition and list-predicate positions in the condition builder:
  not built; still authorable through the raw JSON only.
