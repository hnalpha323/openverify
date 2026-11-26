# TDD evidence: Workflow 2D fixes (TypeScript)

- **Slice owner:** TypeScript fixer (Workflow 2D, the review of Workflow 2C).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/` (api, dashboard, flow, demo-web)
  - `packages/`
  - `e2e/`
  - `docs/plans/phase-2.plan.md`
  - `docs/api/openapi.json`
  - this file
- **Input:** the Workflow 2D review of 2C (`70369f2..5625a96`). Blocking items K001, K002 (orchestrator decisions) and F002; then the MEDIUM items in their priority order (F004, F003, F005, F006, F007, F008, F009, F010, F011, F018, F019, F020, F021, K003, K004).

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. The output below is trimmed to the lines that matter.

## K001: verification check details reached principals without verifications:read through inquiry includes

**Confirmed.** `GET /api/v1/inquiries/:id?include=verifications` declared only `inquiries:read` and returned every verification with its checks, reasons and metadata. `GET /api/v1/dashboard/inquiries/:id` always included them. `GET /api/v1/verifications/:id` itself requires `verifications:read`. The only include parameter in the server API is `INQUIRY_INCLUDES = ['verifications']` (`packages/contracts/src/inquiries.ts`); the dashboard inquiry detail is the only dashboard route that includes verifications.

**Fix (orchestrator decision, recorded in the plan as a C12/C15 amendment marked Workflow 2D).**
- Server API: a request whose `include` names `verifications` runs `authorizePrincipal(principal, ['verifications:read'])`, so a principal without it gets the same 403 `forbidden` problem (and `insufficient_scope` challenge) as a missing route scope.
- Dashboard API: an operator without `verifications:read` gets the inquiry with its verification relationship identifiers and an empty `included` (no verification resources and no file resources, which are reached through them).
- Dashboard: the Verifications section of the inquiry page says how many verifications the inquiry has and that viewing them needs `verifications:read`, instead of "No verifications yet."

### RED

```text
$ (cd apps/api && npx vitest run src/routes/server/inquiries.test.ts --coverage.enabled=false -t "K001")
 FAIL  ... > answers 403 forbidden naming verifications:read to an API key without that scope
AssertionError: expected 200 to be 403 // Object.is equality
 FAIL  ... > answers 403 forbidden naming verifications:read to a user without that permission
AssertionError: expected 200 to be 403 // Object.is equality
      Tests  2 failed | 1 passed | 41 skipped (44)

$ (cd apps/api && npx vitest run src/routes/dashboard/inquiries-files.test.ts --coverage.enabled=false -t "K001")
 FAIL  ... > leaves the verifications and their files out of included without verifications:read (Workflow 2D K001)
AssertionError: expected [ { …(4) }, { …(4) } ] to deeply equal []
 ❯ src/routes/dashboard/inquiries-files.test.ts:162:29
      Tests  1 failed | 7 skipped (8)

$ (cd apps/dashboard && npx vitest run src/app/inquiries/ --coverage.enabled=false -t "K001")
 FAIL  src/app/inquiries/[id]/page.test.tsx > inquiry detail page > says the verifications need verifications:read when the API leaves them out (Workflow 2D K001)
Error: expect(element).not.toBeInTheDocument()
expected document not to contain element, found <p class="text-sm text-ink-muted">No verifications yet.</p> instead
      Tests  1 failed | 82 skipped (83)
```

### GREEN

```text
$ (cd apps/api && npx vitest run src/routes/dashboard/inquiries-files.test.ts src/routes/dashboard/index.test.ts src/routes/server/inquiries.test.ts --coverage.enabled=false)
      Tests  86 passed (86)
$ (cd apps/dashboard && npx vitest run src/app/inquiries/ --coverage.enabled=false)
      Tests  83 passed (83)
$ pnpm --filter @openverify/api openapi:write
      Tests  11 passed (11)
 docs/api/openapi.json | 4 ++--     (the two route descriptions)
```

Callers checked: the dashboard reads `/dashboard/inquiries/:id`, which never takes `include`, so it never asks for the include; the e2e helpers (`e2e/tests/support/server-api.ts`, `ui-flow-links.spec.ts`) use the seeded all-scopes key (`API_SCOPES`, which holds `verifications:read`); `@openverify/node` only forwards the parameter; `apps/demo-web` does not exist in this tree.

## K002: operators could remove roles and permissions they could not grant

**Confirmed.** `updateOperator` (`apps/api/src/services/users.ts`) checked only the new `role-ids` with `assertCanGrant`, never the roles it removed, and changed `status` with no permission check at all. `updateCustomRole` checked only the new permission set, so dropping a permission the operator lacks passed; `deleteCustomRole` checked nothing. Re-inviting a still-invited user replaced its roles the same way. The dashboard made the role case easy to hit: the permission checklist disables a permission the operator lacks, and a disabled checkbox is not submitted. No dashboard route revokes another user's sessions or resets their MFA (only `user:reset-mfa`, a CLI), so those parts of the decision have no route to apply to.

**Fix (orchestrator decision, recorded in the plan as a C15 amendment marked Workflow 2D).** The grant rule now applies symmetrically through one helper, `assertCanChangeAccess(held, permissions, change)` in `services/roles.ts` (`assertCanGrant` is its `grant` case):
- replacing a user's roles (PATCH or a re-invitation) needs every permission of each role it removes as well as of the new roles;
- changing a user's status (deactivating or reactivating; deactivation also revokes the sessions) needs every permission the user holds;
- changing a custom role's permissions needs each removed permission as well as the new set; renaming changes no access and needs nothing more;
- deleting a custom role needs every permission it grants.

Refusals are the same 403 `forbidden` problem as a grant beyond reach, naming the permissions. The last-admin rule (409) is unchanged.

### RED

```text
$ (cd apps/api && npx vitest run src/routes/dashboard/users.test.ts src/routes/dashboard/roles.test.ts --coverage.enabled=false -t "K002")
     × refuses to remove a permission the operator does not hold (403), and keeps it
     × refuses to delete a role with a permission the operator does not hold (403), and keeps it
     × refuses to remove a role with permissions the operator does not hold (403), and keeps it
     × refuses to deactivate or reactivate a user with permissions the operator does not hold (403)
     × refuses a re-invitation that drops a role with permissions the operator does not hold (403)
AssertionError: expected 200 to be 403 // Object.is equality
AssertionError: expected 204 to be 403 // Object.is equality
AssertionError: expected 200 to be 403 // Object.is equality
AssertionError: expected 200 to be 403 // Object.is equality
AssertionError: expected 201 to be 403 // Object.is equality
      Tests  5 failed | 2 passed | 25 skipped (32)

$ (cd apps/api && npx vitest run src/services/roles.test.ts --coverage.enabled=false -t "K002")
     × passes when the operator holds every permission the change touches
     × refuses with 403 forbidden naming each missing permission once, in PERMISSIONS order
     × names what was refused: a grant, a removal, a status change or a role deletion
"TypeError: (0 , __vite_ssr_import_8__.assertCanChangeAccess) is not a function"
      Tests  3 failed | 5 skipped (8)
```

Dashboard (the refusals are explained where they would be offered, as the role editor and the roles dialog already did for grants):

```text
$ (cd apps/dashboard && npx vitest run src/app/users/page.test.tsx src/app/roles/page.test.tsx --coverage.enabled=false -t "K002")
     × explains why a role with permissions the operator lacks cannot be edited or deleted by them (Workflow 2D K002)
     × explains instead of offering a status change for a user with permissions the operator lacks (Workflow 2D K002)
Error: expect(element).not.toBeInTheDocument()
Error: expect(element).not.toBeInTheDocument()
      Tests  2 failed | 34 skipped (36)
```

The role page test that expected "Delete role" next to the "You cannot change this role" explanation was changed to the new rule: deleting such a role is now refused by the API, so the page explains it instead.

### GREEN

```text
$ (cd apps/api && npx vitest run src/routes/dashboard/users.test.ts src/routes/dashboard/roles.test.ts src/services/roles.test.ts src/services/users.test.ts --coverage.enabled=false)
      Tests  42 passed (42)
$ pnpm --filter @openverify/api openapi:write
 docs/api/openapi.json | 6 ++++--     (the invitation, user and role route descriptions)
$ (cd apps/dashboard && npx vitest run src/app/users/ src/app/roles/ --coverage.enabled=false)
      Tests  66 passed (66)
```

- `UsersTable` shows "You cannot deactivate or reactivate <user>: <roles> include(s) permissions you do not hold." instead of the Deactivate or Reactivate button when the user holds a role the operator could not grant (`RoleOption.grantable`). Without `roles:read` the page cannot know, so it offers the button and shows the API's refusal.
- The role page shows "You cannot delete this role: it grants permissions you do not hold (...)" instead of "Delete role" for such a role.

## F002: a form rendered for one environment saved into whichever environment the session was in by then

**Confirmed.** The session environment is server-side state shared by every tab. `SettingsForm` decided the production confirmation from the `environment` prop it was rendered with and posted no environment, and `saveSettings` read and patched the session's current environment. The same applied to every create action that names no environment resource: `createApiKey`, `createWebhook` and `createAccountType`. (Roles are organization-level, so `createRole` is not environment-scoped; every other action names an environment resource by id, which answers 404 in another environment.)

**Fix.**
- `runAction` takes `environmentForm`: the form of an environment-scoped action, which must carry the `environment-id` the page rendered (`EnvironmentField`, a hidden input). When it is missing or differs from the session's environment, the action answers "The environment changed" ("You switched environment after this page was opened, so nothing was saved. Reload the page and try again.") without calling the API.
- `SettingsForm`, `CreateApiKeyForm`, `CreateWebhookForm` and `AccountTypeForm` render the field; their pages pass `session.environment.id`; `saveSettings`, `createApiKey`, `createWebhook` and `createAccountType` pass their form as `environmentForm`.
- The production confirmation still follows the environment the form shows. A write now happens only when that environment is the session's, so the confirmation always matches the environment written; a stale Sandbox form can no longer write production.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/lib/api/action.test.ts src/app/settings src/app/api-keys src/app/webhooks src/app/account-types --coverage.enabled=false)
     × binds the form to the environment it shows, so a switch in another tab saves nothing (Workflow 2D F002)
     × binds the creation form to the session environment (Workflow 2D F002)
     × binds the form to the session environment (Workflow 2D F002)          (API key, webhook)
     × saves nothing when the session switched environment after the form was rendered (Workflow 2D F002)
     × refuses, without calling the API, a form rendered for another environment
     × refuses a form that does not say which environment it was rendered for
     × creates nothing when the session switched environment after the form was rendered (Workflow 2D F002)   (API key, webhook, account type)
AssertionError: expected null to be 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52' // Object.is equality
AssertionError: expected { ok: true, data: undefined } to deeply equal { ok: false, problem: { …(2) } }
AssertionError: expected { ok: true, data: undefined } to match object { ok: false, …(1) }
 Test Files  9 failed | 10 passed (19)
      Tests  10 failed | 130 passed (140)
$ (cd apps/dashboard && npx tsc --noEmit)
src/lib/api/action.test.ts(209,38): error TS2353: Object literal may only specify known properties, and 'environmentForm' does not exist in type 'ActionGuard'.
```

The existing create-action tests now post the `environment-id` the page renders (the `meDocument` sandbox), since the action needs it.

### GREEN

```text
$ (cd apps/dashboard && npx tsc --noEmit && npx vitest run src/lib/api/action.test.ts src/app/settings src/app/api-keys src/app/webhooks src/app/account-types src/components/integrations src/components/lifecycle/account-type-form.test.tsx src/components/operators/settings-form.test.tsx --coverage.enabled=false)
 Test Files  36 passed (36)
      Tests  226 passed (226)
```

The component tests of the four forms pass the new required `environmentId` prop.

## F004: webhook and API key forms submitted before hydration were native GETs with every field in the URL

**Confirmed.** The forms built on `useSubmitAction` (`CreateApiKeyForm`, `CreateWebhookForm`, `EditWebhookForm`, `SimulateEventForm`, `ReplayEventsForm`; `FormDialogButton` too, though its dialog only renders after hydration) had only an `onSubmit` handler. Rendered on the server, such a form is a plain `<form>`, so a submit before React hydrates is a GET to the page's own URL with the custom header values, the endpoint URL and every other field in the query string. A probe of `renderToString` showed the difference: a form whose `action` is a function renders `action="javascript:throw new Error('React form unexpectedly submitted.')"` plus a script that holds the submission and replays it after hydration; an `onSubmit`-only form renders `<form>`.

**Fix.** One shared hook, `useFormAction` (`src/components/use-form-action.ts`), keeps the server action on the form (`formProps.action`, so React holds and replays an early submission) and handles the submit event (`formProps.onSubmit`, so React does not reset the form after a refusal). The `useSubmitAction` forms use it, and `use-submit-action.ts` is deleted. K003 moves the remaining forms onto the same hook.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/integrations/progressive-enhancement.test.tsx --coverage.enabled=false)
     × CreateApiKeyForm never sends its fields, custom header values included, in a GET query
     × CreateWebhookForm never sends its fields, custom header values included, in a GET query
     × EditWebhookForm never sends its fields, custom header values included, in a GET query
     × SimulateEventForm never sends its fields, custom header values included, in a GET query
     × ReplayEventsForm never sends its fields, custom header values included, in a GET query
Error: {"method":null,"action":null}: expect(received).toSatisfy()
      Tests  5 failed (5)
```

### GREEN

```text
$ (cd apps/dashboard && npx tsc --noEmit && npx vitest run src/components/integrations --coverage.enabled=false)
 Test Files  16 passed (16)
      Tests  83 passed (83)
$ (cd apps/dashboard && npx vitest run src/app/webhooks src/app/api-keys --coverage.enabled=false)
 Test Files  12 passed (12)
      Tests  87 passed (87)
```

The existing tests that a refused webhook or API key form keeps what was typed pass unchanged on the new hook.

## F003: one invalid typed filter emptied the status checkboxes (inquiries) and the status and type selects (accounts)

**Confirmed.** `parseInquiryListQuery` and `parseAccountListQuery` return empty `filters` while any typed value has an error, and the pages fill the status checkboxes (`query.filters.statuses`) and the account status and type selects (`filters={query.filters}`) from those filters. Correcting only the date then dropped the statuses silently.

**Fix.** Both parsers also return `selected`: the statuses (inquiries), or the status and account type (accounts), parsed from the URL whatever the typed values are, since a checkbox or select cannot be invalid. The forms are filled from `selected`; only the filters sent to the API stay empty while an error is shown.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/app/inquiries/page.test.tsx src/app/accounts/page.test.tsx --coverage.enabled=false -t "F003")
     × keeps the chosen status and type in the form while another filter is explained (Workflow 2D F003)
     × keeps the ticked statuses in the form while another filter is explained (Workflow 2D F003)
Error: expect(element).toHaveValue(archived)
Error: expect(element).toBeChecked()
Received element is not checked:
      Tests  2 failed | 18 skipped (20)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/app/inquiries src/app/accounts src/lib/inquiry-query.test.ts src/components/lifecycle/account-query.test.ts --coverage.enabled=false)
 Test Files  12 passed (12)
      Tests  148 passed (148)
```

The parser unit tests that compare the whole query now include `selected`, and each parser has a test that `selected` survives a refused typed value.

## F005: signing out swallowed a failed session revocation

**Confirmed.** `deleteSession` (`lib/api/sessions.ts`) caught every error of `DELETE /dashboard/sessions/current` and returned nothing; `logout` and `signInAgain` cleared the cookie and sent the operator to `/login` as if the session had ended, with no log line and no retry.

**Fix.**
- `deleteSession` answers `'ended'` or `'incomplete'` and still never throws. A 401 counts as ended (the session is gone already). A connection error or timeout is tried once more. Any other failure (a 5xx, a 429, a second connection error) logs `The dashboard could not end a session in the API` with the error kind and status only, never the token, and answers `'incomplete'`.
- `logout` and `signInAgain` still clear the cookie, then send the operator to `/login?reason=signout-incomplete` when the revocation is incomplete; the sign-in page explains that the session stops working when it expires and how to end it now.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/lib/api/sessions.test.ts src/app/actions/auth.test.ts src/app/actions/account-security.test.ts src/app/login/page.test.tsx --coverage.enabled=false)
     × still clears the cookie, and says the session could not be ended, when the API cannot revoke it (Workflow 2D F005)
     × revokes the session of the cookie
     × never throws, and calls nothing without a session: signing out locally always works
     × counts a 401 as ended: the session is gone already (Workflow 2D F005)
     × tries once more after a connection error or a timeout (Workflow 2D F005)
     × says the revocation is incomplete after a 5xx, and logs it without the token (Workflow 2D F005)
     × says the revocation is incomplete after a 429, and logs it without the token (Workflow 2D F005)
     × says the revocation is incomplete after two connection errors, and logs it without the token (Workflow 2D F005)
     × says the old session could not be ended when the API cannot revoke it (Workflow 2D F005)
     × explains why the operator is back here (signout-incomplete)
AssertionError: expected undefined to be 'ended' // Object.is equality
AssertionError: expected undefined to be 'incomplete' // Object.is equality
AssertionError: expected '/login' to be '/login?reason=signout-incomplete' // Object.is equality
      Tests  10 failed | 71 passed (81)
```

The two existing `deleteSession` tests now also check the answer it returns, and the old "still redirects when the API cannot revoke" logout test now expects the explaining redirect.

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/lib/api/sessions.test.ts src/app/actions src/app/login --coverage.enabled=false)
 Test Files  7 passed (7)
      Tests  96 passed (96)
```

## F006: a submission refused with field errors only was announced nowhere (WCAG 4.1.3, 3.3.1)

**Confirmed.** `AcceptInvitationForm`, `VersionEditor`, `AccountTypeForm`, the add-tag form of `TagEditor`, the add-relation form of `AccountRelations`, the add-inquiries form of `AccountInquiries` and `NoteEditor` rendered `ProblemDisplay` (the `role="alert"` summary) only when the problem had no field errors, or none they showed next to a field. A refusal with field errors only then changed plain text next to the fields and nothing else.

**Fix.** Each of them renders `ProblemDisplay` whenever there is a problem, through `withoutFieldErrors(problem, pointers)` as the operators forms do: the title (such as "Check the values you entered") and detail are always announced, and only the errors not already shown next to a field are listed. The helper moves from `components/operators/field-errors.ts` to `components/field-errors.ts`, since every area uses it now.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/refusal-announcements.test.tsx --coverage.enabled=false)
     × on the invitation form
     × on the draft editor
     × on the account type form
     × on the add tag form
     × on the add relation form
     × on the add inquiries form
     × on the note editor
TestingLibraryElementError: Unable to find role="alert"
      Tests  7 failed (7)
```

### GREEN

```text
$ (cd apps/dashboard && npx tsc --noEmit && npx vitest run src/components src/app --coverage.enabled=false)
 Test Files  130 passed (130)
      Tests  938 passed (938)
```

## F007: focus fell to `<body>` after a confirmed action removed or disabled the button that opened the dialog (WCAG 2.4.3)

**Confirmed.** `Dialog` gave focus back to the element focused before it opened only if it was still connected, at the moment the dialog unmounted. A confirmed action closes the dialog first and the revalidated page arrives later: the opener (Approve, Deactivate, Expire, Redact, Remove, ...) was then removed after focus had been given back, and focus fell to `<body>`. When the opener was disabled while the action ran (the production settings confirmation), `focus()` was a no-op at once.

**Fix.** `Dialog` hands focus back through `returnFocus`: to the opener when it can take focus, else to the page content (`#content`, which the console layout renders with `tabIndex={-1}`). Until focus moves elsewhere (or 10 seconds pass), a `MutationObserver` follows the page: when the opener is removed while focus is lost, focus goes to the content; when a disabled opener is enabled again, focus returns to it.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/dialog.test.tsx --coverage.enabled=false)
     × moves focus to the page content, not <body>, when the opener is removed afterwards
     × gives focus back to the opener once it is enabled again
Expected element with focus: <div id="content" ...>   Received element with focus: <body>
Expected element with focus: <button>Approve</button>  Received element with focus: <body>
      Tests  2 failed | 9 passed (11)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/components/dialog.test.tsx --coverage.enabled=false)
      Tests  11 passed (11)
$ (cd apps/dashboard && npx vitest run src/components src/app --coverage.enabled=false)
 Test Files  73 passed (73)    Tests  442 passed (442)     (components)
 Test Files  57 passed (57)    Tests  498 passed (498)     (app)
```

Refactor: focus counts as lost on the content only while `returnFocus` parked it there, so an operator who clicks the page content is never pulled back to the opener.

## F008: a toast shown as a dialog closed went into a live region the dialog had made inert (WCAG 4.1.3)

**Confirmed.** `Dialog` made every child of `<body>` but its own root inert, the Notifications live region of `ToastProvider` included. The confirm buttons close their dialog and show their success toast in one update, so React inserted the toast while the region was still inert (the attribute is removed in the dialog's passive-effect cleanup, after the commit): the region re-entered the accessibility tree already holding the toast, which screen readers treat as a new region rather than an announcement.

**Fix.** `ToastProvider` marks its region `data-live-region`, and `Dialog` inerts everything outside its root and outside every `[data-live-region]`: it descends into an element that contains a live region and inerts that element's other children instead of the element itself. The backdrop (z-50) still covers the toasts (z-40), so nothing behind the dialog becomes clickable.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/dialog.test.tsx --coverage.enabled=false -t "F008")
     × leaves the notifications region out of the inert page, so a toast shown on closing is announced
AssertionError: expected <div inert>…(2)</div> to be null
      Tests  1 failed | 11 skipped (12)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/components --coverage.enabled=false)
 Test Files  73 passed (73)
      Tests  443 passed (443)
```

## F009: the "Hidden" tooltip could not be hovered nor dismissed with Escape (WCAG 1.4.13)

**Confirmed.** The tooltip of `HiddenValue` was shown by CSS only (`group-hover`, `group-focus-within`), with `pointer-events-none` and a 4px margin between it and its trigger: moving the pointer onto it hid it, and nothing dismissed it without moving focus or the pointer.

**Fix.** `HiddenValue` moves to its own client module (`hidden-value.tsx`, re-exported by `masked-value.tsx`) and shows its tooltip from state: while its wrapper is hovered or focused, unless dismissed. The tooltip takes pointer events and is joined to the trigger by padding instead of a margin, so the pointer can move onto it; Escape (while it shows) dismisses it until both hover and focus have left. A dismissed or idle tooltip has the `hidden` attribute; it stays the trigger's accessible description.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/masked-value.test.tsx --coverage.enabled=false)
     × shows on hover and stays while the pointer moves onto the tooltip to read it
     × shows on focus and is dismissed with Escape without moving focus
     × is dismissed with Escape while hovered
Error: expect(element).not.toBeVisible()
      Tests  3 failed | 11 passed (14)
```

jsdom applies no Tailwind CSS, so the CSS-only tooltip counts as always visible there: the first test fails before hovering, the other two after Escape, which nothing handled.

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/components/masked-value.test.tsx --coverage.enabled=false)
      Tests  14 passed (14)
$ (cd apps/dashboard && npx vitest run src --coverage.enabled=false)
 Test Files  162 passed (162)
      Tests  1293 passed (1293)
```

## F010: text inputs, selects and textareas were outlined at 1.47:1 (WCAG 1.4.11)

**Confirmed.** The only edge of every dashboard control (`controlClassName`, the `@openverify/ui` `Input`, the JSON editor) was `border-line`, `oklch(87.2% 0.01 258.338)`: 1.47:1 against the white surface and 1.41:1 against the canvas, computed from the tokens (the new test computes it the same way).

**Fix.** A `--color-control` token, `oklch(55.1% 0.027 264.364)` (4.84:1 on surface, 4.63:1 on canvas), outlines the controls: the ui `Input`, `controlClassName` and the JSON editor. `--color-line` stays for decorative separators.

### RED

```text
$ (cd packages/ui && npx vitest run --coverage.enabled=false)
     × defines the --color-control design token
     × generates .border-control for the shared components without the app scanning them
     × gives form controls a border of at least 3:1 against surface and canvas (Workflow 2D F010, WCAG 1.4.11)
     × outlines the input with the control border, 3:1 or more, not the decorative line (Workflow 2D F010)
      Tests  4 failed | 50 passed (54)
$ (cd apps/dashboard && npx vitest run src/components/form-field.test.tsx src/components/json-editor.test.tsx --coverage.enabled=false)
     × styles invalid controls with the danger border
     × is outlined with the control border, 3:1 or more (Workflow 2D F010)
      Tests  2 failed | 12 passed (14)
```

The existing `controlClassName` test expected `border-line`; it now expects the control border.

### GREEN

```text
$ (cd packages/ui && npx vitest run --coverage.enabled=false)
      Tests  54 passed (54)
$ (cd apps/dashboard && npx vitest run src --coverage.enabled=false)
 Test Files  162 passed (162)
      Tests  1294 passed (1294)
```

## F011: some action failures were reported only in an error toast that went away after 6 seconds (WCAG 2.2.1)

**Confirmed.** `ToastItem` dismissed every toast after `TOAST_DURATION_MS` (6 s) unless hovered or focused, errors included. `NewDraftButton` and `RemoveTagButton` report their refusal only in an error toast, so the reason vanished before a screen-magnifier or keyboard user could reach it.

**Fix.** Error toasts are not timed: they stay until dismissed. Success and info toasts still go after 6 s (pausing while hovered or focused). The two buttons keep reporting through the toast, which now persists; an inline placement would need a layout change in their parents for no further gain.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/toasts.test.tsx --coverage.enabled=false)
     × keeps an error until it is dismissed: its reason may be shown nowhere else (Workflow 2D F011, WCAG 2.2.1)
TestingLibraryElementError: Unable to find an accessible element with the role "alert"
      Tests  1 failed | 5 passed (6)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src --coverage.enabled=false)
 Test Files  162 passed (162)
      Tests  1295 passed (1295)
```

## F018: a timed-out createVerification was retried as a fresh POST, which could use up an attempt (web flow)

**Confirmed (web flow).** `submitVerification` (`apps/flow/src/flow/submit-verification.ts`) kept `progress.verificationId` null when `POST /flow/verifications` failed with a timeout or a network error. When the server had created the verification but the answer was lost, "Try again" created a second one, and the server counts each verification of a type as an attempt. The Android coordinator has the same shape (`FlowCoordinator.kt`); `android/` belongs to the Android fixer, so it is reported there, not changed here.

**Fix (client only, no contract change).** After a `timeout` or `network` error on the create, `submitVerification` reloads the session and, when the newest verification of the type is `initiated`, reuses it: that is the one the lost request created (an `initiated` verification that existed before would have been reused from the start). Otherwise it rethrows the original error, so a retry creates one as before. An answered refusal (any HTTP status) does not reload.

### RED

```text
$ (cd apps/flow && npx vitest run src/flow/submit-verification.test.ts --coverage.enabled=false)
     × reuses the initiated verification the server created when the answer to the create was lost (timeout)
     × reuses the initiated verification the server created when the answer to the create was lost (network)
FlowApiError: POST /api/v1/flow/verifications: no answer
      Tests  2 failed | 6 passed (8)
```

A first version that reloaded the session only right after the lost answer passed those tests, but when that reload failed too (still offline), the next attempt created again. A further test (committed RED against that version):

```text
$ (cd apps/flow && npx vitest run src/flow/submit-verification.test.ts --coverage.enabled=false)
     × asks the session first on the next attempt, so it never creates a second verification
AssertionError: expected FlowApiError: GET /api/v1/flow/session: n… to be FlowApiError: POST /api/v1/flow/verificat… // Object.is equality
      Tests  1 failed | 8 passed (9)
```

So a create whose answer was lost is remembered for its progress record (a `WeakSet`, which leaves the record's shape unchanged), and the next attempt reads the session before creating.

### GREEN

```text
$ (cd apps/flow && npx tsc --noEmit && npx vitest run --coverage.enabled=false)
 Test Files  39 passed (39)
      Tests  495 passed (495)
```

## F019: tests found an element that is always present, then asserted once on what the action renders later

**Confirmed.** `tag-editor.test.tsx`, `note-editor.test.tsx` and `account-inquiries.test.tsx` stubbed the refused action with `mockResolvedValueOnce` and then did `expect(await screen.findByRole('textbox', ...)).toHaveAccessibleDescription(...)`. The textbox exists before the click, so `findByRole` resolved at once and the description was checked a single time, before the answer could render: the tests passed only while microtasks happened to flush first.

**Fix (tests only).** The stubs answer through `later()` (after a macrotask, as a server action does), and the assertions wait for what the answer changes: `findByRole('textbox', { name, description })`, which retries until the field has that description, and `findByText` for the second problem of `account-inquiries`.

### RED (the stubs answer later; the assertions are unchanged)

```text
$ (cd apps/dashboard && npx vitest run src/components/lifecycle/tag-editor.test.tsx src/components/lifecycle/note-editor.test.tsx src/components/lifecycle/account-inquiries.test.tsx --coverage.enabled=false)
     × shows why a tag was refused next to the field
     × shows why typed inquiries were refused, at the field or below it
Error: expect(element).toHaveAccessibleDescription()
      Tests  2 failed | 21 passed (23)
```

The note editor test still passed with the later answer (its textbox is re-rendered while the action runs), but it has the same one-shot shape, so it waits on the description as well.

### GREEN (three runs)

```text
$ for i in 1 2 3; do (cd apps/dashboard && npx vitest run src/components/lifecycle/tag-editor.test.tsx src/components/lifecycle/note-editor.test.tsx src/components/lifecycle/account-inquiries.test.tsx --coverage.enabled=false); done
      Tests  23 passed (23)
      Tests  23 passed (23)
      Tests  23 passed (23)
```

## F020: no test exercised the client-address chain end to end

**Confirmed.** The property "a forged `X-Forwarded-For` or `x-openverify-peer-ip` never reaches the API" was checked only by unit tests (`server.test.ts` against a fake Next handler, `client-address.test.ts` on a `Headers` object).

**Fix (a test, no product change).** `e2e/tests/ui-client-address.spec.ts` uploads an image through the flow API, signs the reviewer in, and fetches the image through the dashboard's file proxy with a raw Node request from `127.0.0.2` (another loopback address, so the operator's socket differs from the dashboard's own 127.0.0.1) carrying a forged `X-Forwarded-For`, `x-openverify-peer-ip` and `x-openverify-client-ip`. It then reads the `file.viewed` audit entry through the server API and expects exactly `127.0.0.2`. A lost BFF header would record 127.0.0.1, a trusted client header the forged value. The hops > 0 mode stays covered by unit tests only: the e2e stack has no proxy in front of the dashboard.

### RED (the stack run with `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: '1'` in `e2e/src/env.ts`, a temporary edit that was reverted and never committed: the chain then trusts a client header)

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-client-address.spec.ts'
  ✘  1 [chromium] › tests/ui-client-address.spec.ts:42:1 › the API records the operator socket address behind the dashboard, never a forged header
    Error: expect(received).toEqual(expected) // deep equality
    -   "127.0.0.2",
    +   "203.0.113.66",
  1 failed
```

### GREEN (the stack as committed, hops 0)

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-client-address.spec.ts'
  ✓  1 [chromium] › tests/ui-client-address.spec.ts:42:1 › the API records the operator socket address behind the dashboard, never a forged header (571ms)
  1 passed (33.5s)
```

## F021: mockApi answered from a FIFO queue whatever the request, and ignored answers never used

**Confirmed.** `mockApi` (`src/testing/api-mock.ts`) handed the next queued answer to whatever request came, and `restore()` dropped answers still queued. A test that did not assert `api.requests` passed with a wrong or missing call, and an unexpected request only rejected the fetch, which the code under test often swallows as a connection error.

**Fix.**
- `replyTo('METHOD /path', ...)` and `replyProblemTo(...)` queue an answer for that request only; another request gets a rejection naming both.
- `restore()`, which every test calls in `afterEach`, throws when an answer was never used, when a route-checked answer met another request, or when a request found nothing queued, so these fail the test even when the code under test swallowed the rejection.
- The tests the review named name their routes: `lib/api/page.test.tsx` and `app/actions/environment.test.ts` (the auth action tests mock `lib/api/sessions` and do not use `mockApi`). The other 43 files keep FIFO replies, now checked by `restore()`.
- With the stricter `restore()`, one test of the whole suite failed: `lib/api/client.test.ts` queued a second answer as a trap for a retry and left it unused. It now queues one answer only: a retry would find nothing queued and fail the test, which checks the same property more strictly.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/testing/api-mock.test.ts --coverage.enabled=false)
     × fails the test at restore() when a queued answer was never used
     × answers a route-checked reply only to that method and path
     × fails the test at restore() on a request nothing answered, even when the code swallowed it
     × restores quietly when every answer was used as queued
AssertionError: expected [Function] to throw an error
TypeError: api.replyTo is not a function
      Tests  4 failed (4)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/testing/api-mock.test.ts --coverage.enabled=false)
      Tests  4 passed (4)
$ (cd apps/dashboard && npx tsc --noEmit && npx vitest run src --coverage.enabled=false)
 Test Files  163 passed (163)
      Tests  1299 passed (1299)
```

## K003: React 19 reset forms after a refused submit; three workarounds, and several forms still lost input

**Confirmed.** `useKeptFormAction` (operators), `useSubmitAction` (integrations) and `FormDialogButton` each worked around React 19 resetting a `<form action>` after every run. F004 already replaced `useSubmitAction` (and the form inside `FormDialogButton`) with the shared `useFormAction`. The forms on plain `useActionState` still lost what was typed after a refusal; a test per form shows which:

### RED

```text
$ (cd apps/dashboard && npx vitest run src/components/kept-values.test.tsx --coverage.enabled=false)
     × on the invitation form: the name
     × on the authenticator app form: the name
     × on the account type form: the name and the schema
     × on the tag forms: the new tag, and the list of all tags
     × on the add relation form: the account and the relation type
     × on the add inquiries form: the inquiry IDs
     × on the note editor: the note
     × on a confirmation with controls: what was entered in the dialog
     × on a secret action with controls: what was entered in the dialog
     × on the one-time link form: the chosen lifetime
     × on the sandbox simulation form: the chosen action
Error: expect(element).toHaveValue(Invited Operator)   (and the same for each form)
      Tests  11 failed | 2 passed (13)
```

The draft editor and the fields editor already kept their text (the JSON editor holds it in state); their tests stay as guards.

**Fix.**
- One hook, `useFormAction` (`src/components/use-form-action.ts`): the server action stays on the form (`formProps.action`, for submissions before hydration), the submit event is handled (`formProps.onSubmit`, so React never resets the form) with the submitter's name and value, `resetOnSuccess` empties the form after a success as React did (with `requestFormReset`), and the action state keeps nothing, so data an action answers lives only where `onSuccess` puts it. `SubmitButton` takes `pending` from it (React's form status does not see an action dispatched this way); `ConfirmDialog` takes its `onSubmit`.
- Every form that posts through a server action uses it: `AcceptInvitationForm`, `TotpEnrolment` (both steps), `AccountTypeForm`, `TagEditor` (add, remove, edit all), `AccountRelations`, `AccountInquiries`, `NoteEditor`, `VersionEditor`, `FieldsEditor`, `OneTimeLinkButton`, `SimulateForm`, `NewDraftButton`, `TypedConfirmButton`, `InstantActionButton`, `EnvironmentSwitcher`, `RecoveryCodesButton`, `ConfirmActionButton`, `SecretActionButton`, and the operators forms (`InviteUserButton`, `RoleForm`, `UserRolesButton`, `SettingsForm`). The forms that add an item and stay (tag, relation, inquiries) reset on success.
- `use-kept-form-action.ts` is deleted (F004 deleted `use-submit-action.ts`). Only the two sign-in forms keep `useActionState`: the login form's state keeps the email, and the MFA code is meant to be typed again.
- Keeping no action state also fixes two secrets that `useActionState` held after their dialog closed: the recovery codes of `RecoveryCodesButton`, and (between the F004 commit and this one) the API key token and webhook secret of the create forms.
- `apps/dashboard/README.md` ("How to add a page") documents the pattern, the environment field (F002) and the test helpers (F019, F021).

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/components/kept-values.test.tsx --coverage.enabled=false)
      Tests  15 passed (15)      (the 13 refusal tests, plus: the add forms are emptied after a success; the busy button)
$ (cd apps/dashboard && npx tsc --noEmit && npx eslint src && npx vitest run src --coverage.enabled=false)
 Test Files  164 passed (164)
      Tests  1314 passed (1314)
```

## K004: shell polish carried from 2C

**Confirmed.**
- `displayProblemOf` mapped every 403 to "You do not have access", so a refused invitation said nothing about the role beyond the operator's reach; `createApiKey` worked around it with its own `grantRefusal`.
- `components/status-badge.tsx` kept `Badge` private, and `operators/user-status-badge.tsx`, `lifecycle/badges.tsx` and `integrations/badges.tsx` each copied its tone classes.
- `lib/api/errors.ts` lacked `import 'server-only'`; every importer is server code (the lib/api modules, two server-action files, `lifecycle/section-data.ts`, itself server-only). `lib/api/peer-address.ts` is imported by the custom Node server, so it stays without it.
- The route-matching test API and the lifecycle fixtures lived in `components/lifecycle/testing/`.

**Fix.**
- `runAction` keeps the API's own title and detail for a 403 answered to an action (`displayProblemOf(error, { apiForbidden: 'detail' })`); pages keep the forbidden panel, and a permission the dashboard checks itself still answers "You do not have access" without calling the API. `grantRefusal` is removed: the general rule covers it, and its test passes unchanged. The environment switch test now expects the API's words.
- `errors.ts` imports `server-only`; a test checks every `lib/api` module but `peer-address.ts` does.
- `Badge` is exported (with `data-tone`) and the three copies render it (a refactor; their tests pass unchanged).
- `components/lifecycle/testing/` moves to `src/testing/` (`api-routes.ts`, `lifecycle-fixtures.ts`), a mechanical move of the imports.

### RED

```text
$ (cd apps/dashboard && npx vitest run src/lib/api/action.test.ts src/app/users/actions.test.ts --coverage.enabled=false)
     × keeps the API's own title and detail for a 403 answered to an action (Workflow 2D K004)
     × shows the API's refusal of a role the operator may not grant (403), in its words (Workflow 2D K004)
AssertionError: expected { ok: false, problem: { …(2) } } to deeply equal { ok: false, problem: { …(4) } }
      Tests  2 failed | 32 passed (34)
$ (cd apps/dashboard && npx vitest run src/lib/api/server-only.test.ts --coverage.enabled=false)
     × errors.ts imports server-only, so a client component importing it fails the build
      Tests  1 failed | 19 passed (20)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run src/app/actions src/lib/api src/app/api-keys src/app/users --coverage.enabled=false)
 Test Files  33 passed (33)
      Tests  365 passed (365)
```

Refactors (behaviour unchanged, the suite green before and after):

```text
$ (cd apps/dashboard && npx vitest run src/components src/app/users src/app/webhooks src/app/inquiries src/app/accounts src/app/templates --coverage.enabled=false)   (Badge)
 Test Files  99 passed (99)
      Tests  716 passed (716)
$ (cd apps/dashboard && npx tsc --noEmit && npx eslint src && npx vitest run src --coverage.enabled=false)   (testing helpers moved; 22 importers rewritten)
 Test Files  165 passed (165)
      Tests  1334 passed (1334)
```

## Whole-suite run: an unhandled error after the invitation form test (found by the final validation)

`pnpm test` (the whole workspace, under load) failed `@openverify/dashboard` with one unhandled error, while all 1,347 tests passed:

```text
@openverify/dashboard:test: TypeError: Cannot read properties of undefined (reading 'ok')
@openverify/dashboard:test:  ❯ src/components/use-form-action.ts:73:16
@openverify/dashboard:test: This error originated in "src/components/accept-invitation-form.test.tsx" test file.
@openverify/dashboard:test: The last test to run before this error was "posts the token with the name and password".
```

**Cause.** The test's default action stub was `vi.fn<Action>()`, which answers `undefined` instead of an `ActionResult`; since K003 the form reads the answer in `useFormAction`. The test ended right after the click, so whether React handled the answer inside the test or after it depended on timing. Made deterministic first: the test now waits until the form has handled the answer (its button is enabled again), which fails every time with the off-contract stub:

```text
$ (cd apps/dashboard && npx vitest run src/components/accept-invitation-form.test.tsx --coverage.enabled=false)   (twice)
     × posts the token with the name and password
TypeError: Cannot read properties of undefined (reading 'ok')
      Tests  1 failed | 9 passed (10)
     Errors  1 error
```

Then the stub answers as the contract says (`{ ok: true, data: undefined }`):

```text
$ (cd apps/dashboard && npx vitest run src/components/accept-invitation-form.test.tsx --coverage.enabled=false)   (three times)
      Tests  10 passed (10)
```

No other submitted stub answers `undefined` (the other `vi.fn<Action>()` stubs are never called).

## Final validation

```text
$ pnpm typecheck && pnpm lint && pnpm format:check
(all three exit 0)

$ pnpm test
 Tasks:    12 successful, 12 total
@openverify/api        Tests 2020 passed   All files 97.56 % stmts | 90.34 % branch | 98.36 % funcs | 97.62 % lines
@openverify/dashboard  Tests 1347 passed   All files 98.42 % | 94.38 % | 98.71 % | 98.43 %
@openverify/flow       Tests  495 passed   All files 98.76 % | 95.54 % | 99.24 % | 98.83 %
@openverify/ui         Tests   54 passed   All files 100 % | 97.72 % | 100 % | 100 %
@openverify/node 199, contracts 1186, core 399, db 563, checks 455, flow-spec 81, config 44, e2e 63: all passed, every package at 80 % or more

$ pnpm test:integration
@openverify/db   Test Files 4 passed (4)   Tests 37 passed (37)
@openverify/api  Test Files 10 passed (10) Tests 32 passed (32)

$ pnpm --filter @openverify/api openapi:write   (twice)
      Tests  11 passed (11)
git status --porcelain docs/api/openapi.json: empty after each run (the committed snapshot is current)

$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   19 passed (10.1s)
@openverify/e2e:e2e:    34 passed (2.8m)      (the 33 of Workflow 2C plus ui-client-address.spec.ts)
 Tasks:    9 successful, 9 total
```

The first `pnpm test` run failed on the unhandled error recorded above ("Whole-suite run"); the run above is after its fix.

Not changed here, by path ownership: the Android `FlowCoordinator` retry of `createVerification` (F018) belongs to the Android fixer. Noticed but out of the findings' scope: the flow's language select (`apps/flow/src/components/language-select.tsx`) is also outlined with `border-line` (F010 covered the dashboard and `@openverify/ui`).

## Orchestrator re-validation: two dashboard tests that failed under turbo's load

The orchestrator re-ran the whole list on `main` after the fix stage (`263f67f`). `pnpm test --force` failed in the dashboard with 2 of 1,347 tests. Both pass when run alone. Under turbo, every package runs at once with Vitest on half the CPUs each (about 60 workers on 12 CPUs), and the dashboard's tests ran 10 to 15 times slower than alone.

```text
$ pnpm test --force
 FAIL  src/components/kept-values.test.tsx > a successful submission behaves as before (Workflow 2D K003) > shows the button as busy while the action runs
TestingLibraryElementError: Unable to find role="button" and name "Creating…"
 FAIL  src/components/operators/role-form.test.tsx > RoleForm > creates a role from a name and the checked permissions
Error: Test timed out in 20000ms.
      Tests  2 failed | 1345 passed (1347)
```

**`kept-values.test.tsx`, "shows the button as busy".** The test asserted the transient `Creating…` button while its stub answered on a 10 ms timer, so it passed only when the machine reached the assertion before the answer.

RED, made deterministic. With a stub that answers at once, the original assertions fail every time with the error seen under load:

```text
$ (cd apps/dashboard && npx vitest run src/components/kept-values.test.tsx --coverage.enabled=false -t 'busy while the action runs')   (3 runs)
TestingLibraryElementError: Unable to find role="button" and name "Creating…"
      Tests  1 failed | 14 skipped (15)
```

GREEN. The stub's promise is answered by the test itself, after it has seen the busy button. The emptied name is then awaited with `waitFor`, like the test above it.

**`role-form.test.tsx`, "creates a role".** It took 1.3 s alone and over 20 s under load. Most of that time went to `getByRole('checkbox', { name })`, which computes the accessible name and visibility of every one of the 31 permission checkboxes on each query. The tests now find the checkboxes by their label (`getByLabelText`). `permission-checklist.test.tsx` still checks the checklist by role.

```text
before: creates a role 1202 ms, edits a role 457 ms, shows the API's refusal 777 ms
after:  creates a role  667 ms, edits a role 245 ms, shows the API's refusal 325 ms

$ (cd apps/dashboard && npx vitest run src/components/kept-values.test.tsx src/components/operators/role-form.test.tsx --coverage.enabled=false)   (3 runs)
      Tests  19 passed (19)
```

The whole-list results after these fixes are in `docs/PROGRESS.md` (the Workflow 2D entry).
