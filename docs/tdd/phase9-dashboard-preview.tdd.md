# Phase 9, Workflow 9C, Stage 1: dashboard-preview (TDD record)

The plan's `dashboard-preview` bullet: C156.2 and C156.4 to C156.6 on the console side, with C156.7's banner.
That is the preview frame and its versioned protocol with the asset message, simulate with presets, and the
workflow canvas overlay of a sandbox test run (K4). Base `69ebd7fa`. Every command ran after
`source scripts/env.sh`, from `apps/dashboard` unless noted. Every value in the tests is synthetic.

Owned paths: `apps/dashboard/src/components/flow-preview/`, `apps/dashboard/src/components/workflows/overlay/`
(after `[9c-checkpoint:graph-editor]`), `apps/dashboard/src/app/templates/[id]/preview/`,
`apps/dashboard/src/lib/api/{simulation-presets,template-preview}.ts` with their tests,
`apps/dashboard/src/lib/copy/preview.ts`, `apps/dashboard/src/testing/routes/preview.ts`,
`e2e/tests/ui-preview.spec.ts`, `e2e/tests/support/ui-preview.ts` and this file.

## Re-verification against the code (before the first commit)

- `POST /api/v1/inquiry-template-versions/:id/preview` and `.../simulate`: bodies
  `previewInquiryTemplateVersionBodySchema` and `simulateInquiryTemplateVersionBodySchema`, answers
  `templatePreviewDocumentSchema` and `templateSimulationDocumentSchema` (`packages/contracts/src/template-routes.ts`),
  as the Handover says. The node client has no method for either, so the console calls them through `apiRequest`.
- `GET`/`POST /api/v1/dashboard/simulation-presets`, `DELETE .../:id` (`apps/api/src/routes/dashboard/simulation-presets.ts`):
  `inquiry-templates:read`; the delete takes `ssp_` ids only; `scope` is `null` without `pii:view`.
- `GET /api/v1/theme-sets/assets/:id/content` (`apps/api/src/routes/server/theme-sets.ts:281`): `theme-sets:read`,
  the bytes as `image/png`, `image/jpeg` or `font/woff2` (`services/themes/assets.ts:189`), `private, no-store`,
  `attachment`, `nosniff`.
- The messages (`packages/contracts/src/flow-messages.ts`): `consoleToPreviewMessageSchema` (`preview-document` with
  `document` the whole preview answer, which `apps/flow/src/preview/preview-app.tsx` parses with
  `templatePreviewDocumentSchema`; `select-step`, `set-outcome`, `set-viewport`, `set-scheme`, `preview-assets`),
  `previewToConsoleMessageSchema` (`ready`, `error`, `navigated`), `FLOW_MESSAGE_MAX_BYTES` and
  `PREVIEW_ASSETS_MAX_BYTES` (1 MiB each).
- The flow origin: `OPENVERIFY_FLOW_PUBLIC_URL` reaches the dashboard container (`infra/docker-compose.yml`); the
  preview's `frame-ancestors` is `OPENVERIFY_DASHBOARD_PUBLIC_URL` (the e2e stack opens the console on `localhost`
  and the flow on `127.0.0.1`, so the two origins differ).

## Commits

| Step | Commit | What |
|---|---|---|
| stub | `554d5b8e` | the four calls and the three preset calls throwing, the preview copy, `testing/routes/preview.ts` with its schema test, the page stub |
| RED | `d71205cf` | `lib/api/template-preview.test.ts` (14), `lib/api/simulation-presets.test.ts` (4), `app/templates/[id]/preview/page.test.tsx` (6) |
| GREEN | `f5754720` | the calls, `components/flow-preview/preview-banner.tsx`, the preview page |
| checkpoint | `736df957` | this record's checkpoint 1 and the requests `[9c-request:dashboard-flow-builder] [9c-checkpoint:dashboard-preview:1]` |
| stub | `b4a26816` | the protocol, frame, flow origin reader, asset URL and asset route, throwing |
| RED | `d9a8c07c` | `preview-protocol.test.ts` (13), `flow-preview-frame.test.tsx` (10), `flow-origin.test.ts` (2), the asset route (5) |
| GREEN | `3dee26a3` | the protocol, the frame, `previewFlowOrigin`, `previewAssetUrl`, `app/templates/[id]/preview/assets/[assetId]/route.ts` |
| stub | `bf5c1dd9` | the preview actions, `placeProblem`, the workbench; the copy made with `defineCopy` (the banner lines keyed) |
| RED | `40237128` | `actions.test.ts` (12), `preview-problems.test.ts` (4), `preview-workbench.test.tsx` (9) |
| GREEN | `636fcfb6` | the actions, `placeProblem`, `PreviewWorkbench` (and prettier on its test, which the RED commit missed) |
| RED | `7097abca` | the page is the template's preview section with the frame, and the configuration error without a flow origin |
| GREEN | `67717436` | the page renders `TemplateTabs`, the workbench and the resolve action |
| stub | `eb79ba85` | the scope form model, the simulation subjects, the simulated path, the simulate panel |
| RED | `f809ede7` | `scope-form-model.test.ts` (6), `simulation-subjects.test.ts` (3), `simulated-path.test.tsx` (6), `simulate-panel.test.tsx` (9) |
| GREEN | `68884f38` | the four modules |
| RED | `a080a72e` | the page offers simulate; its RSC payload holds no preset value or step configuration without `pii:view` |
| GREEN | `6624d2f9` | the page renders `SimulatePanel` with the presets and subjects |
| RED | `365e7270` | `components/workflows/overlay/run-overlay.test.tsx` (4), after `[9c-checkpoint:graph-editor]` (`34036fe9`) |
| GREEN | `d0ee7b05` | `RunOverlay` fills the slot |
| e2e | `4ae44f81` | `e2e/tests/ui-preview.spec.ts` (3 tests) and `e2e/tests/support/ui-preview.ts` |
| docs | `0712fdfb` | slices 2 to 5 and request 4 `[9c-request:dashboard-flow-builder]` |
| test | (after `0712fdfb`) | `simulate-panel.test.tsx` +2: every kind of simulated fact sent, a refused save and delete |
| e2e | (after) | the spec picks the preset menu by its exact label (the first run's one failure) |
| refactor | `5200c842` | `previewFlowOrigin` delegates to `lib/csp/policy.ts`' `flowPublicOrigin`, so the frame's `src` and `frame-src` name one origin |

## RED and GREEN, slice 1 (the calls and the page)

```text
$ pnpm exec vitest run src/lib/api/template-preview.test.ts src/lib/api/simulation-presets.test.ts 'src/app/templates/[id]/preview/page.test.tsx' --coverage.enabled=false
 × posts the unsaved members and the locale, and answers the preview document
   … (23 of 24 failed; the one passing is the page's metadata title, which the stub carries)
AssertionError: promise rejected "Error: previewTemplateVersion is not buil…" instead of resolving
AssertionError: expected Error: deleteSimulationPreset is not buil… to be an instance of TypeError
Error: The template preview page is not built yet (dashboard-preview)
 Test Files  3 failed (3)
      Tests  23 failed | 1 passed (24)
```

The first RED run also failed `testing/routes/preview.test.ts` on a fixture of mine (`on-null: 'fallback'`, which the
schema refuses: it must be `route:<key>`). The fixture was corrected before the stub commit; that test is not a RED test.

GREEN, same command plus the fixture test: `Tests  26 passed (26)`, exit 0. `bash /tmp/openverify-heavy.sh pnpm exec tsc
--noEmit` reported 2 errors, both in `src/lib/api/inquiry-template-versions.test.ts` (dashboard-flow-builder's
in-flight RED file, problem slugs it has not added yet), none in my files; `pnpm exec eslint` on my paths exit 0.

## Checkpoint 1 (`[9c-checkpoint:dashboard-preview:1]`)

What it lands:

- `apps/dashboard/src/lib/api/template-preview.ts` (server-only):
  - `previewTemplateVersion(versionId, body: PreviewInquiryTemplateVersionBody): Promise<TemplatePreviewDocument>`;
  - `simulateTemplateVersion(versionId, body: SimulateInquiryTemplateVersionBody): Promise<TemplateSimulationDocument>`;
  - `fetchThemeAssetContent(assetId): Promise<Response | null>` and `themeAssetAnswer(upstream): Promise<Response>`
    (PNG, JPEG or WOFF2 of at most 1 MiB passed on `private, no-store`, `nosniff`, no filename; 401, 403, 404 bare;
    anything else 502);
  - types `TemplatePreviewDocument`, `TemplateSimulationDocument`.
- `apps/dashboard/src/lib/api/simulation-presets.ts` (server-only): `listSimulationPresets()`,
  `createSimulationPreset(name, scope)`, `deleteSimulationPreset(id)` (an `ssp_` id only; a built-in is refused
  before anything is sent).
- `apps/dashboard/src/lib/copy/preview.ts`: `PREVIEW_COPY` (`as const`; it conforms to the catalog's shared type once
  `[9c-shared]` lands) and `PreviewCopy`.
- `apps/dashboard/src/testing/routes/preview.ts`: `PREVIEW_IDS`, `previewPath`, `simulatePath`, `PRESETS_PATH`,
  `assetContentPath`, `PREVIEW_LIGHT_PALETTE`, `previewDocument`, `previewDocumentWithAssets`, `simulationDocument`,
  `builtinPreset`, `ownPreset`, `presetList` and `previewRoutes(api, versionId?)` for `routeApi()`.
- The page `/templates/[id]/preview` (`?version=<itmplv_>`; default the newest draft, else the newest version; a
  version of another template is 404), with `PreviewBanner` (C156.7) from `components/flow-preview/preview-banner.tsx`.

### The frame component, for `dashboard-themes-copy` (rule 19)

`dashboard-themes-copy` may show unsaved styles through the frame after this checkpoint, by import only. The frame
lands in the next slice under these names (no props change without a note here):

```ts
// apps/dashboard/src/components/flow-preview/flow-preview-frame.tsx ('use client')
export type PreviewViewport = 320 | 375 | 768;
export type PreviewScheme = 'light' | 'dark' | 'auto';
export type PreviewOutcome = 'passed' | 'failed' | 'needs_review';
export interface FlowPreviewFrameProps {
  /** The flow origin (`previewFlowOrigin()` from `components/flow-preview/flow-origin.ts`, server-only), or null. */
  readonly flowOrigin: string | null;
  /** The answer of POST /inquiry-template-versions/:id/preview to show, or null while there is none. */
  readonly document: TemplatePreviewDocument | null;
  /** The console URL a theme asset's bytes are read from; the default is this template's preview asset route. */
  readonly assetUrl: (assetId: string) => string;
  readonly viewport?: PreviewViewport; // default 375
  readonly scheme?: PreviewScheme; // default 'auto'
  readonly stepId?: string | null;
  readonly outcomes?: Readonly<Record<string, PreviewOutcome>>;
  readonly onNavigated?: (stepId: string) => void;
}
export function FlowPreviewFrame(props: FlowPreviewFrameProps): ReactNode;
// apps/dashboard/src/app/templates/[id]/preview/assets/[assetId]/route.ts: GET, the asset's bytes for the frame
export const previewAssetUrl: (templateId: string) => (assetId: string) => string;
```

To preview unsaved styles, call `previewTemplateVersion(versionId, { data: { attributes: { styles } }, meta: { locale } })`
on the server (an import of `lib/api/template-preview.ts`) and pass its answer as `document`.

## Slice 2: the frame and its protocol (C156.2)

RED (`d9a8c07c`), each failing for its intended reason: `Error: readPreviewMessage is not built yet` (6),
`previewAssetUrl is not built yet` (5), `framePlanOf ...` (3), `previewFlowOrigin ...` (2), `consoleMessages ...` (2),
`themeAssetsOf`, `assetsMessageOf`, and `Unable to find an element with the title: Flow preview` (8, the frame stub
renders nothing): `Tests 30 failed (30)`. The first typecheck of the RED tests failed on my own test
(`flow-preview-frame.test.tsx(135,19) TS2493`, the spy's `postMessage` overload has no third element); fixed before
the RED commit. GREEN: `Tests 30 passed (30)`; three lint findings fixed before the commit (two `setState` calls in
an effect, rewritten as state derived during render; an unnecessary condition).

The refusals tested: a message from another origin (`http://localhost:3001`, another port, another scheme, `null`), from
another window or with no frame, over 1 MiB, malformed (another source, version, type, an extra member, a bad step id,
an unknown error code, a string, `null`, an array), unmeasurable (a cycle), and the equal and missing flow origins
(the frame is not rendered; a configuration error says why). The frame posts nothing before `ready`, always with the
flow origin as `targetOrigin`, never a document over 1 MiB, and the assets as transferred buffers of at most 1 MiB in
all, read through the console's asset route; an asset it cannot read is said, and the preview still shows.

## Slice 3: the workbench, the actions and the problems (C156.1, C156.2)

RED (`40237128`): `resolvePreview(object) is not built yet` and the like, `placeProblem is not built yet`, and the
workbench stub rendering nothing (`expected "vi.fn()" to be called 1 times, but got 0 times`): `23 failed | 7 passed`
(the 6 passing are the existing page tests run beside it, and the copy label check). GREEN: `Tests 60 passed (60)`.
The page RED (`7097abca`): `Unable to find ... "navigation" and name "Template sections"` and `... role "alert"`;
GREEN `Tests 62 passed (62)`.

`PREVIEW_MIN_INTERVAL_MS` = 600 (provisional; basis: `template-preview` allows 120 calls a minute per operator,
shared with validate and simulate; one call per 0.6 s is 100 a minute). The 422 pointers are placed: `/meta/locale`
beside the language menu, `/data/attributes/theme-set-id`, `/data/attributes/styles/...`, `/data/attributes/flow`,
`/meta/scope/...`, `/meta/preset-id` and anything else in the problems list with their labels; a 429 says the
preview waits and tries again.

## Slice 4: simulate with presets (C156.4, C156.7)

RED (`f809ede7`): `emptyScopeForm is not built yet` (5), `formOfScope ...`, `simulationSubjectsOf ...` (3), and the
path and panel stubs rendering nothing (`Unable to find a label with the text of: Preset`, `... "region" and name
"Simulated path"`): `Tests 24 failed (24)`. GREEN: `Tests 24 passed`, with three lint fixes before the commit.
The page RED (`a080a72e`): `Unable to find ... "region" and name "Simulate a path"`; the RSC payload test passed at
RED (a guard). At GREEN the RSC test failed on my own assertion (`not.toContain('"scope"')`: the presets prop holds
`"scope":null`, which is what the API served); it now asserts `"scope":null` present and `"scope":{` absent, the
claim it meant. `Tests 10 passed (10)`.

What the form sends: only what the operator set; "Unknown (null)" sends `null`; a verification's status, check
overrides (`name, status` lines) and extracted values (JSON); every flow-provisional signal of `SIGNAL_REGISTRY`
(no other: C150.9), parsed by its value type; the lists a route reads (`lists.<id>.matched`); the device kind and
platform; each `run_workflow` step's status, error type and outputs; the inquiry's tags; the fields (JSON). A
built-in preset and a preset whose scope the API hides (no `pii:view`) are simulated by id and never shown or offered
for editing; my own presets load into the form, save (named) and delete after a confirmation; every preset reads
"synthetic values only". The path is a list labelled "Simulated": each step's port, a route's key with its
condition's result (true, false, unknown), the `onNull` used, the unknown facts, waits, the notes, and each fact with
its tier, stage and source ("self-asserted", "client-reported") and a "Beta heuristic" badge; the outcome with the
verification types on the path, the fallbacks and flags; a halt and a path that stops before a completion are said.

## Slice 5: the test run overlay (C156.6, K4)

After `[9c-checkpoint:graph-editor]` (`34036fe9`). RED (`365e7270`): `Unable to find ... "region" and name "Test run
over the draft"` and the like, `Tests 4 failed`. GREEN (`d0ee7b05`): `Tests 4 passed`, beside the test-runs page's
own tests (`15 passed`). The first GREEN run failed on my test's expectation of the list labels (Phase 8's
`pathListOf` names an action step `Action <key>: <name>`); the test now reads those labels, which the overlay reuses
unchanged. `RunOverlay` reuses `runPathOf`, `pathListOf` and `RunPathCanvas` and adds the overridden state: a step the
test overrode reads "✎ Overridden" on the list and has the status `overridden` on the canvas, whose taken edges are
computed from the recorded statuses (so an overridden step that led on keeps its edges).

## Final gates

Every call after `source scripts/env.sh`, in the foreground; each exit code read from the command, never a pipe.

| Gate | Call | Exit | Time | Load (1 min) |
|---|---|---|---|---|
| prettier | `pnpm exec prettier --check` on my 39 files | 0 | | |
| lint and typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` (4 tasks) | 0 | 372 s | 8.3 |
| dashboard typecheck | `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard typecheck` (after the refactor) | 0 | 69 s | 8.2 |
| dashboard tests | the whole script no longer fits one call at this load (862 s once, at load 27; a second try ended at its 580 s timeout), so as the API suite: `vitest run --coverage --shard=i/3 --reporter=blob` (330, 293, 172 s at load 25, 21, 15) and `vitest run --merge-reports=<dir>/blobs --coverage` | merge 0 | 10 s | 12.1 |
| full-stack spec | `flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "<down> && <turbo build> && <up> && OPENVERIFY_E2E_REUSE_STACK=1 ... playwright test tests/ui-preview.spec.ts; rc=$?; <down>; exit $rc"` | 0 | 353 s (3 passed in 52.2 s: 20.8, 12.9, 10.2 s) | 21.0 |

The merged dashboard run: 555 files, 6,517 tests, all passed; statements 95.49%, branches 88.5%, functions 94.62%,
lines 95.55%. My own files (`--coverage.include` on them): statements 92.37%, branches 88.47%, before the two panel
tests that raise `simulate-panel.tsx` (77.55% then). An earlier merged run failed one test,
`components/operators/permission-checklist.test.tsx` (dashboard-settings' role editor between its RED `e0bb0194` and
GREEN `1628768d`); it passed on the rerun above, never edited by me.

Earlier full-stack attempts: the first `next build` failed on other agents' in-flight type errors
(`app/theme-sets/actions.ts`, `components/saved-views/actions.ts`, `components/themes/theme-model.ts`), not a test
result; one `flock -w 60` gave up (another agent's stack held the lock); one run passed 2 of 3, the third failing on my
locator (`getByLabel('Preset')` matched the preset menu and the "Preset name" field), fixed to an exact label.

## Requests

To `dashboard-flow-builder` (the template page's tabs and the version editor; `[9c-request:dashboard-flow-builder]`):

1. **The template page's tabs** (`app/templates/[id]/` layout or tab list): a tab "Preview" pointing at
   `/templates/{id}/preview`, shown with `inquiry-templates:read`. My page test opens the page by URL until it lands.
2. **The version page** (`app/templates/[id]/versions/[versionId]/page.tsx`) and the builder's draft view: a link
   "Preview this version" to `/templates/{id}/preview?version={versionId}`, so a draft is previewed from its editor.
   Its test: the link's `href`. My e2e spec opens the URL directly until it lands.
3. **The builder's read-only workflow canvas and outline** render `RunOverlay` (rule 19) with the selected test run;
   already the slot of `[9c-checkpoint:graph-editor]`, listed here so it is not missed.

Requests 1 and 2 were answered in `68a65629` (the template sections hold "Preview") and `fb7d253d` (the version page
links its preview) with `[9c-done:dashboard-preview]`; 3 is the test-runs page's mount of `34036fe9`.

To `dashboard-flow-builder` (`[9c-request:dashboard-flow-builder]`, second request):

4. **`components/workflows/editor/canvas-model.ts`, `STATUS_BADGES`**: add `overridden: { icon: '✎', word: 'Overridden' }`,
   so a canvas node of a test run's overridden step reads "✎ Overridden" as the overlay's list does (C156.6 names the
   overridden state). Until then the canvas node reads "• overridden" (the fallback for a status the map does not
   know: an icon and the word, lower case). My test: `run-overlay.test.tsx` "draws the same path over the read-only
   canvas, overridden included" holds the status `overridden`; a test of `statusBadgeOf('overridden')` is the owner's.
