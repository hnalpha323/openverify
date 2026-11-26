# TDD evidence: Phase 9, Workflow 9C Stage 1, `dashboard-themes-copy`

C160 in the console (theme sets, revisions and restore, the editor with live contrast from
`@openverify/core`'s gate, assets with the licence attestation, the default set, archiving), C162
(the translations editor per locale and key, CSV import and export with row and column problems, the
consent-copy rule), C161.5's review status wherever a locale is enabled, and the template's theme
and translations tabs. Run `source scripts/env.sh` first. Every RED below was seen failing for the
reason named, then GREEN; the commands are the real ones, the output abbreviated.

## Requests

### To `dashboard-flow-builder` (`[9c-request:dashboard-flow-builder]`)

1. **`apps/dashboard/package.json`: add `"@openverify/flow-spec": "workspace:*"` to
   `dependencies`** (a workspace package: no licence row, no release age, no build script; the
   lockfile gains only the importer link). Why: C161.5 and C162.2 are defined there and nowhere else
   the dashboard can read them: `LOCALE_REVIEW_STATUS` and `BUILT_IN_LOCALES` (the review status the
   console must show wherever a locale is enabled), `COPY_KEYS`, `COMPONENT_COPY_ATTRIBUTES`,
   `COMPONENT_COPY_MAX_LENGTH`, `BIOMETRIC_CONSENT_COPY_KEYS` and `COPY_LEGAL_KINDS` (each key's
   maximum length, placeholders and legal mark in the translations editor). C155.6 needs the same
   package for the builder's validation in place, so one change serves both. The server page reads
   them and passes plain data to client components, so the client bundle does not grow by the
   package. Test that needs it: `src/components/translations/copy-key-catalog.test.ts` (it compares
   the editor's key list with `COPY_KEYS`). Until it lands those modules are not written; the theme
   slices go first.
2. **Navigation (`apps/dashboard/src/components/nav-items.ts`):** in the "Verifications" group,
   after `Templates`, `{ href: '/theme-sets', label: 'Theme sets', permission: 'theme-sets:read' }`.
   Why: C160's console page (`GET /theme-sets`, `theme-sets:read`, which viewers and developers
   hold). Test that needs it: `e2e/tests/ui-themes-copy.spec.ts` reaches the page from the
   navigation; until then it opens `/theme-sets` by URL.
3. **The template page's tabs (`[9c-shared]`):** `Theme` at `/templates/<id>/theme` (shown with
   `inquiry-templates:read` and `theme-sets:read`) and `Translations` at
   `/templates/<id>/translations` (shown with `inquiry-templates:read`). Both pages exist from
   `[9c-checkpoint:dashboard-themes-copy:1]`.
4. **The version client (`lib/api/inquiry-template-versions.ts`, import only):** the theme tab and
   the translations tab change a draft's `theme-set-id`, `enabled-locales` and `default-locale`
   through it, with `If-Match` (C154.3). I need, exported from it: a read of a version that answers
   its resource with its strong ETag, and a `PATCH` of a draft that sends `If-Match` and answers the
   resource with its new ETag, a 412 `precondition_failed` raised as an error I can tell apart. Name
   them in your TDD file's handoff; I import them after your checkpoint and never edit the file.

Requests 2, 3 and 4 were met by `dashboard-flow-builder` before they were read: the navigation
entry and the template tabs (`68a65629`, `[9c-shared]`: `components/template-tabs.tsx` with the
`translations` and `theme` keys) and the version client (`lib/api/inquiry-template-versions.ts`:
`retrieveTemplateVersion`, `updateTemplateVersion(versionId, attributes, etag)` with
`meta.allow-invalid`, `isPreconditionFailed`). Request 1 (`@openverify/flow-spec`) is open.

## Re-verification against 9A and 9B as built (base `69ebd7fa`)

- Theme set routes, revisions (`page[before]`), restore (`meta.revision`), the asset upload and
  the content route: as the Handover says (`apps/api/src/routes/server/theme-sets.ts`); the node
  client has `themeSets.{list,create,retrieve,update,archive,revisions,restore,uploadAsset,
  assetContent}`. There is **no route that lists assets**: the editor knows an asset only from its
  upload answer or from the styles that name it (amendment TS-1 below).
- `theme_contrast_insufficient` carries `pairs[] {pointer, foreground, background, ratio,
  required}` (token names, never colours); `themeContrastProblemSchema` parses it. The console's
  `displayProblemOf` keeps no `pairs` and no per-error `code`, so this area reads both from the
  `OpenVerifyApiError` itself.
- The server's palette resolution (`apps/api/src/services/themes/styles.ts`, `paletteOf`): an
  absent cell takes `BUILTIN_PALETTES[variant]`, and **both** palettes are checked whether or not
  `use-dark-theme` is on. The console's live check does the same with `checkPaletteContrast`.
- Translations: `GET` answers only the keys the copy holds (no row for a key never reworded); the
  JSON import's 422 has `errors[] {pointer: /data/attributes/translations/<i>/locale-values/<j>/
  value, code, detail}`; the CSV import's 422 has `errors[] {pointer: /rows/<n|header>[/<column>],
  code}`. The copy rules live in `apps/api/src/services/templates/copy-rules.ts` (not in
  `@openverify/flow-spec`), so the console says each code in words and never re-implements them.
- The client fallback (`apps/flow/src/session/session-copy.ts`, `copyText`) is C162.5's chain: the
  person's language's custom text, its built-in text, the default locale's custom text, its
  built-in text, else `null`. `docs/i18n/README.md`'s "Fallbacks" paragraph orders it differently
  (default locale before the built-in text of the person's language): amendment TS-2.
- `dashboard-flow-builder`'s typed catalog (`lib/copy/catalog.ts`, `defineCopy`) is used by
  `lib/copy/themes-copy.ts` (`THEMES_COPY`, `COPY_COPY`).

## Slice 1: the clients, mock routes, copy catalog, panels and minimal pages (checkpoint 1)

All runs: `(cd apps/dashboard && pnpm exec vitest run <files> --coverage.enabled=false)`.

- `lib/api/theme-sets.ts`: stub `9115179a` (with `testing/routes/themes-copy.ts`), RED `49bd15a8`
  (`Error: not built yet (dashboard-themes-copy, 3 inputs)`; `Tests 14 failed (14)`), GREEN
  `513af9e0` (`Tests 14 passed (14)`).
- `lib/api/translations.ts`: stub `701ccd5d`, RED `8351c92b` (`Tests 9 failed (9)`, each `not built
  yet`), GREEN `1d5a28dc` (`Tests 9 passed (9)`).
- The builder panels and the locale list: stubs and the copy catalog `969fe29f`, RED `0fe6917e`
  (`Unable to find an accessible element with the role "combobox" and name "Theme set"`; `Tests 5
  failed (5)`), GREEN `4d091bd7` (`Tests 5 passed (5)`).
- `/theme-sets`: stubs `7570ce80`, RED `963b7fe8` (`Tests 6 failed | 2 passed (8)`; the two that
  passed are the metadata title and the forbidden create without a write scope, which the stub met
  by doing nothing), GREEN `8ee4fbe4` (`Tests 8 passed (8)`).
- The theme and translations tabs: stubs `f82b124d`, RED `180c72bb` (`Tests 4 failed (4)`), GREEN
  `d5d58ffb` (`Tests 4 passed (4)`).
- `pnpm exec tsc --noEmit -p tsconfig.json`: exit 0 (63 s); eslint and prettier clean on every file.

### The builder panels (rule 19), for `dashboard-flow-builder` to mount

- `apps/dashboard/src/components/themes/builder-theme-panel.tsx`, `'use client'`:
  `BuilderThemePanel({ themeSets, value, onChange? })`.
  - `themeSets: readonly ThemeSetChoice[]`, `ThemeSetChoice = { id, name, revision, isDefault }`:
    the environment's active sets (`GET /theme-sets?filter[status]=active`).
  - `value: string | null`: the version's `theme-set-id`; `null` is "the environment's default
    set, else the built-in look". A value not among the sets stays shown, marked archived.
  - `onChange?: (themeSetId: string | null) => void`: without it the picker is disabled
    (read-only). The builder saves the choice with its draft (`If-Match`).
- `apps/dashboard/src/components/translations/builder-copy-panel.tsx`, a server-safe component
  (no hooks): `BuilderCopyPanel({ templateId, enabledLocales, defaultLocale, copy?, reviewStatus })`.
  - `enabledLocales: readonly TemplateLocale[]`, `defaultLocale: TemplateLocale`, `copy?:
    TemplateCopy` (the version's members).
  - `reviewStatus: LocaleReviewStatuses` (`components/translations/locale-review.ts`): pass
    `LOCALE_REVIEW_STATUS` of `@openverify/flow-spec` as it is (the type is its structural
    supertype); a locale left out is shown machine-drafted, never reviewed.

Checkpoint: `1c4a6ac2` `[9c-checkpoint:dashboard-themes-copy:1]`. Request 1 was met by
`dashboard-flow-builder` in `a6fe4ffb` (`@openverify/flow-spec` in `apps/dashboard/package.json`).

## Slice 2: the theme editor model (C160.3, C160.4)

- Stub `28a497bf`; RED `6ca5bb97`: `Error: not built yet (2 inputs)`, `Tests 6 failed (6)`; GREEN
  `8b9c49de`: `Tests 6 passed (6)`. `contrastRows` runs `contrastRatio` of `@openverify/core` over
  `CONTRAST_PAIRS` (the gate's own pairs), so the console's ratios are the API's, unrounded.

## Slice 3: the theme set actions and page (C160.1-C160.7)

- Actions: stub `5c98af71`; RED `9ea42e58` (`Tests 9 failed | 5 passed (14)`: the five that
  passed were the create tests of slice 1 and two refusals the stub met by refusing everything);
  GREEN `bfe27549` (`Tests 14 passed (14)`).
- The page, the editor and the upload form: stubs `18f59779`; RED `e1b93de7` (`Tests 11 failed
  (11)`); GREEN `c09ca955` (`Tests 38 passed (38)` over `components/themes` and `app/theme-sets`).
  The implementation was written before its tests and set aside in the scratchpad for the RED run,
  then restored. Three test corrections in the GREEN commit: the page test serves the flat settings
  document (`DASHBOARD_SETTINGS_DEFAULTS`), the upload test submits the form (jsdom's constraint
  validation stopped a click on a form with an empty required file input), and the editor test
  finds the button again after a save. `5acb0aea` later split that save test in two: under a load
  of 20 and coverage, the pending state outlived the find timeout once; no test waits on it now.
- `6a5bb7d9` (fix): `tsc` found two `exactOptionalPropertyTypes` errors my per-file lint missed
  (committed in `8b9c49de` and `bfe27549`); fixed, `tsc --noEmit` exit 0.
- Guards (pass on the built code, not RED): `304e0a6a`, the logo content route and the translations
  tab's RSC payload (a template field's initial value never reaches it).

## Slice 4: translations (C161.5, C162)

- The copy key catalog: stub `38d971ff`; RED `2163f9fa` (`Tests 5 failed (5)`); GREEN `54c57210`.
- The translations tab, editor, CSV panel, locale form, actions and CSV route: stubs `b909fccc`; RED
  `db5fd555` (`Tests 20 failed | 11 passed (31)`; the 11 are slice 1's tests and the refusals the
  stubs met); GREEN `de008610` (`Tests 31 passed (31)`). As in slice 3, the implementation was set
  aside for the RED run. Before the RED commit two of its own expectations were corrected against the
  running code (a file read in the CSV panel through the input's `files`, and a text the page shows
  twice matched by its problem wording).

## Slice 5: the template theme tab (C160.7, C154.3)

- Stub `c2439b2c`; RED `b1b5f654` (`Tests 3 failed | 4 passed (7)`); GREEN `fd0236d1` (`Tests 7
  passed (7)`; the page test wraps the toast provider the form needs).

## Slice 6: unsaved styles on real screens (C156.1 through `dashboard-preview`'s frame)

- Stubs `27473550`; RED `a466579f` (`Tests 3 failed | 15 passed (18)`); GREEN `67d12204` (`Tests 18
  passed (18)`; the page test gains the template reader's case). `FlowPreviewFrame` and
  `previewAssetUrl` are imported, never edited.

## The UI spec

- `191371a6`: `e2e/tests/ui-themes-copy.spec.ts` with `e2e/tests/support/ui-themes-copy.ts`.
- `b730e6b3`, `18aa52e9`: the logo upload's file input found by its type (its label matched the
  form's name and the kind select). The first full-stack run found the upload message capitalised
  ("The Logo was stored"): RED `cf6a6ee3` (`Unable to find an element with the text: /^The logo was
  stored as tsa_…/`), GREEN `18aa52e9` (`kindWords` in the catalog).

## Final gates (2026-11-07)

| Gate | Exit | Time | Load (start, end) | Note |
| --- | --- | --- | --- | --- |
| `pnpm exec tsc --noEmit -p tsconfig.json` (dashboard) | 0 | 63 s | 19 | after `6a5bb7d9` |
| my files' tests with coverage scoped to my sources | 0 | 55 s | 20 | 108 tests in 22 files; 90.09 % statements, 85.78 % branches, 86 % functions, 91.09 % lines |
| `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard test` (own reports directory) | 1 | 806 s | 20, 24 | 12 failures, all in `dashboard-settings`' in-flight webhook files (`app/webhooks/`, `lib/api/webhooks.test.ts`, `components/integrations/webhook-form.test.tsx`); none in mine; past the 600 s call |
| the same, again | 1 | 498 s | 3.4, 13 | 3 failures, all in `dashboard-template-forms`' `components/schema-form/` (in flight); none in mine |
| `pnpm exec prettier --check <my 66 files>` | 0 | | | |
| `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 1 | 736 s | 29, 21 | typecheck of both and the e2e lint pass; the dashboard lint fails on one error in `dashboard-flow-builder`'s `components/workflows/editor/variable-picker.tsx:24` (`restrict-template-expressions`); none in mine |
| the locked UI spec sequence (stack down, build, up, `tests/ui-themes-copy.spec.ts`, down) | 0 | 121 s in the lock (359 s waiting) | 3.06, 3.88 | 2 passed in 20.0 s (11.4 s, 5.9 s) |

The locked sequence ran as `flock -w 1800 … timeout 520 sh -c "<the sequence>"` in the background,
waited for in the foreground: twelve calls with `-w 60` lost the lock to agents waiting longer
(amendment TS-13 in the report). The two earlier full-stack runs failed only on the upload step
(the file input's locator, then the message's case); the translations test passed in all three.
