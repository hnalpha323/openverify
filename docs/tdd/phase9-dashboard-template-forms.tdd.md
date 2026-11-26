# Phase 9, Workflow 9C Stage 1: `dashboard-template-forms` (TDD record)

Owner decision for this run: "Launch 9C right now and make decisions yourself" (owner, 2026-11-07).
Base: `69ebd7fab17aa13ff13dbf5cf673be08678f2fff`. Deliverables: C153.1, C153.3, C153.4 (plan
bullet `dashboard-template-forms`), and the Handover's "the version's `help-url`, `privacy-url`,
embed and redirect members with their publish problems".

Every command was run after `source scripts/env.sh`. Output is abbreviated.

## Precondition and re-verification (before any edit)

- `docs/PROGRESS.md` records "2026-11-06: Phase 9, Workflow 9B done" (line 20) and "2026-11-05:
  Phase 9, Workflow 9A done" (line 116); the base is `69ebd7fa`.
- `git log 69ebd7fa..HEAD`: empty at the start (no 9C marker, no request).
- Re-verified against the code (drift is recorded as Workflow 9C Stage 1 amendments in the final
  report):
  - `inquiryTemplateVersionAttributesSchema` (packages/contracts/src/inquiry-template-versions.ts)
    serves `settings` resolved, `report-config`, `signal-config`, `list-config` and the 9A members
    `field-schemas`, `copy`, `enabled-locales`, `default-locale`, `theme-set-id`, `embed-origins`,
    `redirect-uri`, `redirect-uri-schemes`, `redirect-include-status`, `help-url`, `privacy-url`,
    `description`, `validation`; `updateInquiryTemplateVersionAttributesSchema` takes each of them
    and `meta.allow-invalid`.
  - `templateSettingsSchema` (template-settings.ts): the four C11 windows, `retention-days`,
    `max-sessions`, `expire-inquiry-on-session-limit` and C151.10's two windows.
  - The ETag is served only as a response header (`apps/api/src/routes/server/inquiry-template-versions.ts`)
    over the stored content (`services/templates/versions.ts` `storedContent`), so a client cannot
    compute it; `@openverify/node`'s `RequestOptions` carries no header and its answers no
    header, and `apps/dashboard/src/lib/api/inquiry-template-versions.ts` does not exist at the base.
  - Workflow 7C's "list picker in `VersionEditor`" does not exist: `components/lifecycle/version-editor.tsx`
    edits `list-config` as JSON, and the words of `list_kind_mismatch` and `kind_not_collected`
    are in `lib/version-problem-words.ts`.
  - `lib/api/report-templates.ts` is imported only by `app/reports/` (`dashboard-cases-reports`'
    pages), so it is a shared file, not this agent's; `components/report-config/` files imported only
    by `app/report-templates/` are this agent's: `config-editor`, `config-words`,
    `new-draft-button`, `report-template-filters`, `resolved-config` (`source-words` and
    `watchlist-sources-view` are imported elsewhere and stay untouched).
  - `lib/copy/` does not exist at the base (`dashboard-flow-builder` creates its shared type).

## Requests

### R1 to `dashboard-flow-builder`: the template page's "Settings" tab

- **File:** the template page's tab list (`app/templates/[id]/`, created in `[9c-shared]`).
- **Change:** a tab "Settings" pointing at `/templates/<id>/settings`, shown with
  `inquiry-templates:read`.
- **Why:** C153.3's settings forms live at `app/templates/[id]/settings/` (this agent's path).
- **Test that needs it:** `e2e/tests/ui-template-forms.spec.ts` opens the page by URL until it
  lands.

### R2 to `dashboard-flow-builder`: the version client with `If-Match`

- **File:** `apps/dashboard/src/lib/api/inquiry-template-versions.ts` (yours, C153.3 "import only").
- **Change:** two server-only calls through `getBffFetch()` (the node client sends and reads no
  header):
  - `retrieveTemplateVersion(versionId: string): Promise<{ version: InquiryTemplateVersionResource; etag: string }>`,
    `GET /inquiry-template-versions/:id`, the `ETag` response header read as served;
  - `updateTemplateVersion(versionId: string, attributes: UpdateInquiryTemplateVersionBody['data']['attributes'], etag: string): Promise<{ version: InquiryTemplateVersionResource; etag: string }>`,
    `PATCH` with `If-Match: <etag>` and `meta: { 'allow-invalid': true }` (C154.2: the console
    always sends it), throwing the dashboard's usual API error so `runAction` answers the problem;
    a 412 `precondition_failed` stays a problem the form shows ("reload the latest draft").
  - In `testing/api-routes.ts`, `RouteAnswer` gains an optional `headers` member so a route test
    can serve an `ETag`.
- **Why:** C153.3 says the settings forms save "with If-Match through the version client of
  `lib/api/inquiry-template-versions.ts` (import only)"; the builder needs the same calls.
- **Test that needs it:** `app/templates/[id]/settings/actions.test.ts` (the save sends
  `If-Match` and `allow-invalid`). Until it lands the settings action saves through the node
  client without `If-Match`, and says so in this file.

### R3 to `dashboard-flow-builder`: the JSON-Schema form model outside workflows

- **File:** `apps/dashboard/src/components/workflows/editor/schema-form-model.ts` (yours; or
  wherever the `GraphAdapter` refactor moves it).
- **Change:** an optional second parameter `{ references?: boolean }` (default `true`, today's
  behaviour) on `fieldsOf` and `parseFieldText`: with `references: false`, no hint mentions
  `{{ path }}` and a number or integer field refuses a `{{ path }}` text. Or, as C153.1 allows,
  move the model with its test into `components/schema-form/schema-form-model.ts` (then it is
  this agent's and the editor imports it from there), and this agent adds the option test-first.
- **Why:** C153.1 has one form engine on 8D's model (Phase 7 and 8 outcome 16), and a template
  member is never a C115 template: a form never offers a value the contract refuses (C153.5).
- **Test that needs it:** `components/schema-form/schema-form.test.tsx` ("no field of a template
  form mentions a variable"). Until it lands, `components/schema-form/model.ts` is the only
  importer of the model and adapts its hints; its test pins that.

### R4 to `dashboard-flow-builder`: mount the generated step form in the step panel

- **File:** `apps/dashboard/src/components/flow-builder/flow-builder.tsx` (yours), where
  `FlowStepPanel` gets `StepJson` as its `children`.
- **Change:** render `StepSchemaForm` from `components/schema-form/step-schema-form.tsx` (this
  agent's; props `{ step: FlowV2Step; editable: boolean; onStepChange: (next: FlowV2Step,
  message: string) => void }`) as the step's own form above `StepJson`, which stays as the raw JSON
  one click away (C153.1); `onStepChange` records the new step as one undoable edit with `message`
  announced, as `StepJson`'s change does.
- **Why:** C155.3 and C153.1: "each step's form generated from its zod schema", with
  `captureMethodsByDevice` (C153.2) where a step has `captureMethods`.
- **Test that needs it:** `e2e/tests/ui-template-forms.spec.ts` checks the generated form on the
  settings tab and the check panels in the builder; until this lands, the builder shows the step as
  JSON and the step form is tested in `step-schema-form.test.tsx` only.

## Slice 1: the first checkpoint (`[9c-checkpoint:dashboard-template-forms:1]`)

What it lands: `lib/copy/template-forms.ts` (`TEMPLATE_FORMS_COPY`, `as const` until the shared
type lands), `testing/routes/template-forms.ts` (`serveTemplateVersions`, `serveLists`,
`TEMPLATE_READER`, `TEMPLATE_EDITOR`), and a minimal page at the one route this agent's tab
points at, `app/templates/[id]/settings/` (the draft, else the current version read-only, else the
version `?version=` names). No `lib/api` client is this agent's: every call of its pages is the
node client's (`inquiryTemplates`, `inquiryTemplateVersions`, `reportTemplates`,
`reportTemplateVersions`, `lists`), and the `If-Match` save is `dashboard-flow-builder`'s
`lib/api/inquiry-template-versions.ts` (request R2). Navigation: none (Report templates is in the
navigation since Phase 6); the tab is request R1.

- Stub: `dbe8ad67` (the page renders nothing; the copy and routes it needs).
- RED: `48fd3e69`.

```
$ pnpm exec vitest run "src/app/templates/[id]/settings/page.test.tsx" --coverage.enabled=false
     × edits the template’s draft when one exists, under its breadcrumbs
     × shows the current version read-only when the template has no draft
     × opens the version the query names, when it is the template’s
     × says a reader cannot change a draft
     × is not found for a malformed id, without calling the API
TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Template settings"
Error: Expected notFound(), but the call completed
exit 1
```

`pnpm typecheck` (apps/dashboard) at the RED commit: exit 2 on two errors, both in
`src/lib/api/template-preview.test.ts` (`dashboard-preview`'s in-flight file); none in this
agent's files.

- GREEN: the commit with `[9c-checkpoint:dashboard-template-forms:1]`.

```
$ pnpm exec vitest run "src/app/templates/[id]/settings/page.test.tsx" --coverage.enabled=false
      Tests  6 passed (6)
exit 0
$ pnpm exec eslint "src/app/templates/[id]/settings/" src/lib/copy/template-forms.ts src/testing/routes/template-forms.ts
exit 0
$ pnpm exec prettier --check <the same files>
All matched files use Prettier code style!
```

## Slices after the checkpoint

Each slice: a stub commit (so the RED test compiles and typechecks), a RED commit run and seen
failing for the intended reason, then GREEN. The commands are
`pnpm exec vitest run <files> --coverage.enabled=false` from `apps/dashboard`, `pnpm exec eslint
<files>`, and `pnpm exec tsc --noEmit` filtered to this agent's paths (the other agents' in-flight
files had errors of their own at times; none was this agent's).

| Slice | Stub | RED (failed / passed) | GREEN (passed) |
|---|---|---|---|
| Form model (`components/schema-form/model.ts`): the editor model per member, nullable unwrapped, no variable, contract refusals by pointer | `f7a5a43c` | `a6c56deb`: 8 failed, 2 passed (`templateFieldsOf` answered `[]`) | `e6c77739`: 10 passed; lint fixed in refactor `529a3ffd` |
| `SchemaForm` | `653807c2` | `45841a80`: 9 failed ("Unable to find ... role group") | `1ae7ba07`: 19 passed |
| Member registry from the draft PATCH contract, the 2.2.1 notes | `400ef511` | `4d47028c`: 7 failed | `8c0da15a`: 7 passed |
| `MemberForm` with the list-config screen picker | `462eaf2b` | `b8aa1ffc`: 9 failed | `6d941ab7`: 35 passed (schema-form folder) |
| Settings save action (`If-Match`, `allow-invalid`, 412 in words) | `1eb9eff8` | `35216d8d`: 6 failed | `42ed4412`: 6 passed |
| Check panel model | `ba24b467` | `bcbb4b45`: 8 failed, 2 passed | `7731ec3c`: 10 passed |
| Check panels and the step-panel slot | `8a31b6c7` | `3ed488b7`: 7 failed, 2 passed | `870ceafc`: 19 passed; `flow-step-panel.test.tsx` (flow-builder's) passes with the filled slot |
| R3 adopted: the model with `references: false` | | | refactor `8a869841`: 54 passed |
| Settings tab page with every form, the ETag, saved problems, RSC payload | `a3ed3445` | `075bed3b`: 9 failed, 11 passed | `f9baba65`: 74 passed |
| Report template forms, create action, new page | `2d5766ea` | `497ba176`: 6 + 6 failed | `902fc61a`: 231 passed (report-templates, report-config, schema-form, check-panels, settings) |
| Report list link and the generated draft form | | `ce9df947`: 2 failed, 58 passed | `80014460`: 60 passed |
| Generated step form with capture methods per device (C153.2) | `179a556c` | `69b58bb1`: 4 failed, 1 passed | `2f1f6195`: 40 passed (schema-form folder) |
| Full-stack spec `e2e/tests/ui-template-forms.spec.ts` | | committed `0afbde76` | see Final gates |

RED evidence, abbreviated (each from the run before its RED commit):

```
$ pnpm exec vitest run src/components/schema-form/schema-form.test.tsx --coverage.enabled=false
     × renders a labelled control for every member of the schema, none written by hand
     ...
      Tests  9 failed (9)
$ pnpm exec vitest run src/components/check-panels/check-panels.test.tsx --coverage.enabled=false
     × shows every check of the type with its tier, type, stage and default requirement
     × says an enabled check that is not required runs but does not decide, unless a branch reads it
     ...
      Tests  7 failed | 2 passed (9)
$ pnpm exec vitest run "src/app/templates/[id]/settings/actions.test.ts" --coverage.enabled=false
     × saves the member to the draft with If-Match and allow-invalid, then refreshes the tab
     × says the draft changed when the API answers 412, and saves nothing
      Tests  6 failed (6)
$ pnpm exec vitest run src/app/report-templates/ --coverage.enabled=false
     × offers the create form to a writer
     × creates the template with its type, name and configuration, then opens it
      Tests  6 failed | 50 passed (56)
```

Corrections to RED tests made before GREEN, each a fault in the test, not a weakening: a widget is
named by its field's label ("mode", not its own text); the JSON editor has a status region of its
own (the message is found by its words); the default government ID config already runs
`id_glare_detection` (the toggle is checked against the default); a check id probe value `XX` is a
value-level refusal one level deeper (only issues at the option itself count); a required member is
labelled "<name> (required)"; "(null)" escaped in a regular expression.

## Slice: list pickers read every active list (a defect found before finishing)

The settings page read one page of 100 lists while C97.5 allows 1,000 active lists per
environment, so a picker could leave lists out without saying so, and a chosen list it did not
hold could not be unticked. Stub `abceb7f7`; RED `b7b6ae2e` (its subject says `fix(dashboard): RED:`
where `test(dashboard):` was meant; the content is the RED test): `list-choices.test.ts` and
`member-form.test.tsx` 3 failed, 9 passed. GREEN `3daa8d05`: `readListChoices` reads the active
lists page after page up to `LIST_LIMITS.activeListsPerEnvironment`; both pickers show a chosen id
the lists do not hold as "<id> (not an active list of this environment)". One mock correction: the
API's next link keeps the filters, so the mock's does too.

## Requests, answered

- R1 (the Settings tab): `TemplateTabs` of `[9c-shared]` `68a65629` has the `settings` key.
- R2 (the version client with `If-Match`): `d0a0ee6c` `[9c-done:dashboard-template-forms]`.
- R3 (the form model with `references: false`): `51755671` `[9c-done:dashboard-template-forms]`,
  adopted in refactor `8a869841`.
- R4 (mount `StepSchemaForm` in the builder): `537c1783`.
- Requests addressed to this agent: none.

## Final gates (on the final tree of this agent's paths)

| Gate | Command | Exit | Time and load |
|---|---|---|---|
| Dashboard typecheck | `pnpm --filter @openverify/dashboard typecheck` | 0 | |
| Dashboard lint | `pnpm --filter @openverify/dashboard lint` | 0 | |
| Forced lint and typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 0 (4 of 4 tasks) | 309 s, load 14.8 to 10.0 (first run 505 s at 20 to 23) |
| Dashboard unit suite with the 80% gate | two blob shards and a merge from `apps/dashboard`, each through `/tmp/openverify-heavy.sh`: `pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-i --shard=i/2 --reporter=blob --outputFile=<dir>/blobs/blob-i-2.json`, then `pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged` | merge 0 (each lone shard 1 on its partial coverage, as expected) | shards 202 s and 201 s, merge 7 s, load 9.8 to 7.1; 561 files, 6,535 tests; all files 95.58% statements, 88.53% branches, 94.92% functions, 95.61% lines; `schema-form` 95.5 / 92.09, `check-panels` 96.39 / 90.56, `report-config` 94.83 / 86.5 |
| Format | `pnpm exec prettier --check <the 41 files of this agent's paths>` | 0 | |
| Full-stack spec | `flock -w 200 /tmp/openverify-e2e.lock sh -c '<budget 590 s less the wait, at most 520> timeout <budget> sh -c "e2e:stack:down && turbo build && e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 playwright test tests/ui-template-forms.spec.ts; rc=$?; e2e:stack:down; exit $rc"'` | 0 (3 passed) | 123 s in all, no lock wait, tests 26.6 s (9.9, 9.1, 4.9 s), load 6.6 to 3.1 |

Why the unit suite ran as shards: the whole script ran 903 s at a load of 18 to 25 (past the
10-minute cap), with one failure in `dashboard-flow-builder`'s then in-flight
`components/workflows/editor/condition-model.test.ts`; the shared `apps/dashboard/coverage`
directory was held by another agent's run, so every run here wrote its own reports directory.
Why the e2e call waited up to 200 s: the lock was taken in turn by four other builders with long
waits; a wait of 60 to 78 s lost every time, so the run's own timeout was the call's remaining
budget, never above 520 s.
