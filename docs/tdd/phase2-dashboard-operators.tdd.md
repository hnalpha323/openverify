# TDD evidence: Phase 2, Workflow 2C, dashboard-operators (Stage 2)

Scope: the C23 operator pages on the C15 dashboard API: `/users`, `/roles` (with `/roles/new` and
`/roles/[id]`), `/audit-logs` (with `/audit-logs/[id]`) and `/settings`; their resource modules
`src/lib/api/{users,roles,audit-logs,settings}.ts`; the components in `src/components/operators/`;
and C24 specs 2 and 8 (`e2e/tests/ui-operators.spec.ts`).

Every command ran from the repository root after `source scripts/env.sh`, unless it says otherwise.
Output is abbreviated with `…`. While iterating, only these files' tests ran, with coverage off
(`--coverage.enabled=false`), as the shared-tree rules ask.

## Slice 1: the resource modules

`lib/api/users.ts` (list, invite, update, a bounded user directory), `roles.ts` (one page, every
page up to 20, find by id, create, update, delete), `audit-logs.ts` (list with every filter the API
supports, get) and `settings.ts` (get, patch), on the shell's `apiRequest`.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/users.test.ts src/lib/api/roles.test.ts \
    src/lib/api/audit-logs.test.ts src/lib/api/settings.test.ts --coverage.enabled=false
 FAIL  src/lib/api/audit-logs.test.ts
Error: Cannot find module '/src/lib/api/audit-logs' imported from …/src/lib/api/audit-logs.test.ts
 FAIL  src/lib/api/roles.test.ts
Error: Cannot find module '/src/lib/api/roles' imported from …/src/lib/api/roles.test.ts
 FAIL  src/lib/api/settings.test.ts
Error: Cannot find module '/src/lib/api/settings' …
 FAIL  src/lib/api/users.test.ts
Error: Cannot find module '/src/lib/api/users' …
 Test Files  4 failed (4)
      Tests  no tests
```

### GREEN

```
$ (same command, coverage on for the four modules)
 Test Files  4 passed (4)
      Tests  20 passed (20)
Statements   : 100% ( 50/50 )
Branches     : 92.85% ( 13/14 )
Functions    : 100% ( 16/16 )
Lines        : 100% ( 46/46 )
```

Lint then refused five non-null assertions in the two tests; they became optional chains.

## Slice 2: `/users`

The list (status, roles by name, added), a status filter and the cursor in the URL, the invite
dialog (email and the roles the operator may grant: a role with a permission the operator lacks is
offered disabled, with the reason), role changes in a dialog, deactivate and reactivate with
confirmations (an operator deactivating themselves is told they are signed out), and "resend the
invitation" for invited users. The API's refusals (403, the last active admin's 409, an email in
use) show as problems in the dialog.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/users src/components/operators --coverage.enabled=false
 FAIL  src/app/users/actions.test.ts
Error: Cannot find module '/src/app/users/actions' imported from …/src/app/users/actions.test.ts
 FAIL  src/app/users/layout.test.tsx
Error: Failed to resolve import "./layout" from "src/app/users/layout.test.tsx". Does the file exist?
 FAIL  src/app/users/page.test.tsx
Error: Failed to resolve import "./error" from "src/app/users/page.test.tsx". …
 FAIL  src/components/operators/invite-user-button.test.tsx
Error: Failed to resolve import "./invite-user-button" …
 FAIL  src/components/operators/role-checklist.test.tsx …
 FAIL  src/components/operators/role-options.test.ts …
 FAIL  src/components/operators/user-roles-button.test.tsx …
 Test Files  7 failed (7)
```

### GREEN

The first GREEN run showed three defects of my own, fixed before the commit:

- the page test queued `GET /dashboard/me` after the list answers (the mock API answers in order),
  so `/me` received the users list: `OpenVerifyResponseValidationError … at src/lib/api/me.ts`. The
  test helper now queues `/me` first (`signedIn(permissions).reply(...)`);
- `Field required` adds a visible " *" to the label, so `getByLabelText('Email')` found nothing;
  the input keeps `required`, the label does not;
- the hidden "of <user>" suffix of "Edit roles" lost its space in the accessible name
  ("Edit rolesof Synthetic Reviewer"); the space now sits outside the hidden span.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/users src/components/operators --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  48 passed (48)
```

## Slice 3: `/roles`, `/roles/new`, `/roles/[id]`

The list (name linked to the role, built-in or custom, "n of 27" permissions, cursor pagination), a
new-role page, and a role page: built-in roles read-only with their permissions by area; custom
roles with a name and a permission checklist grouped by area (`PERMISSIONS` from
`@openverify/core`, with plain labels; both maps are keyed by `Permission`, so a new permission
fails the typecheck until it has a label and an area), and deletion. Permissions the operator does
not hold are disabled. A custom role that grants a permission the operator lacks is shown
read-only with the reason, since a change would either drop that permission silently or be
refused. The dashboard API has no `GET /roles/:id`, so the page finds the role in the list.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/roles src/components/operators/permissions.test.ts \
    src/components/operators/permission-checklist.test.tsx src/components/operators/role-form.test.tsx --coverage.enabled=false
 FAIL  src/app/roles/actions.test.ts
Error: Cannot find module '/src/app/roles/actions' …
 FAIL  src/app/roles/layout.test.tsx …
 FAIL  src/app/roles/page.test.tsx
Error: Failed to resolve import "./[id]/error" from "src/app/roles/page.test.tsx". …
 FAIL  src/components/operators/permission-checklist.test.tsx …
 FAIL  src/components/operators/permissions.test.ts …
 FAIL  src/components/operators/role-form.test.tsx …
 Test Files  6 failed (6)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/roles src/components/operators --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  62 passed (62)
```

## Slice 4 (fix): the forms lost what the operator entered after a refusal

React 19 resets a form's uncontrolled fields after every `<form action>` submission, whatever the
action answered. A refused invitation therefore cleared the email and the roles, a refused role
change reset the checkboxes, and a refused role cleared its name and permissions.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/operators/invite-user-button.test.tsx \
    src/components/operators/user-roles-button.test.tsx src/components/operators/role-form.test.tsx --coverage.enabled=false
     × shows the refusal to demote the last active admin (409)
     × keeps what was typed and checked after a refusal, so it can be corrected
     × shows the API's refusal, such as a name already taken
Error: expect(element).toHaveValue(someone@example.test)
Expected the element to have value: someone@example.test
Received:
Error: expect(element).not.toBeChecked()
Received element is checked:
 Test Files  3 failed (3)
      Tests  3 failed | 12 passed (15)
```

(One earlier run of the same files passed the role form's new assertion: the reset raced the
assertion. The fix removes the reset, so the result no longer depends on timing.)

### GREEN

`components/operators/use-kept-form-action.ts`: the form's submit event is handled; React neither
runs nor resets a form action whose submit event was prevented, and the action is dispatched in a
transition with the form's data. The server action stays on the form, so a submission before
hydration still posts to it. The three forms use it; their submit buttons take `pending` from the
hook.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/operators src/app/users src/app/roles --coverage.enabled=false
 Test Files  13 passed (13)
      Tests  95 passed (95)
$ for i in 1 2 3; do (cd apps/dashboard && pnpm exec vitest run <the three files> --coverage.enabled=false | grep Tests); done
      Tests  15 passed (15)
      Tests  15 passed (15)
      Tests  15 passed (15)
```

## Slice 5: `/audit-logs`, `/audit-logs/[id]`

Filters in the URL (`action`, `actor`, `resource-type`, `resource-id`, `from`, `to`, `after`),
checked with the contract's own schemas (`filterListSchema`, `auditActionSchema`, `anyIdSchema`)
before the API is asked; a filter it cannot use is explained beside its field and the list is not
requested. Dates are whole UTC days, both inclusive: the API's exclusive end gets the next
midnight. Users are named (with `users:read`) through a bounded directory; addresses masked without
`pii:view` show as "Hidden". The entry page shows every member, links the resource to its page
when it has one, and links to the actor's and the resource's other entries.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/audit-logs src/components/operators/audit-log-query.test.ts --coverage.enabled=false
 FAIL  src/app/audit-logs/layout.test.tsx
Error: Failed to resolve import "./layout" …
 FAIL  src/app/audit-logs/page.test.tsx
Error: Failed to resolve import "./loading" …
 FAIL  src/components/operators/audit-log-query.test.ts
Error: Failed to resolve import "./audit-log-query" …
 FAIL  src/app/audit-logs/[id]/page.test.tsx
Error: Failed to resolve import "./page" …
 Test Files  4 failed (4)
```

### GREEN

Two test defects of my own were fixed on the way: two fixture entries shared a timestamp, so the
row link was ambiguous (the second entry got its own time), and the filtered-list test answered one
entry, then expected the empty message (it now answers an empty page).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/audit-logs src/components/operators/audit-log-query.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  24 passed (24)
```

## Slice 6: `/settings`

`require-mfa` (organization-wide, said so) and the retention of the session's environment, named as
the banner names it ("Retention in Sandbox" or "Retention in Production"). Only the settings that
changed are sent, so the audit entry names exactly those; nothing changed says so. Days are checked
on the server (1 to 3650; the inquiry retention may be empty: kept until redacted). In production
the form says that live data is affected, and saving asks for a confirmation first. With
`settings:read` alone the page is read-only.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/settings src/components/operators/settings-form.test.tsx --coverage.enabled=false
 FAIL  src/app/settings/actions.test.ts
Error: Cannot find module '/src/app/settings/actions' …
 FAIL  src/app/settings/layout.test.tsx …
 FAIL  src/app/settings/page.test.tsx
Error: Failed to resolve import "./error" …
 FAIL  src/components/operators/settings-form.test.tsx
Error: Failed to resolve import "./settings-form" …
 Test Files  4 failed (4)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/settings src/components/operators/settings-form.test.tsx --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  20 passed (20)
```

## My files together

```
$ (cd apps/dashboard && pnpm exec vitest run src/app/users src/app/roles src/app/audit-logs src/app/settings \
    src/components/operators src/lib/api/{users,roles,audit-logs,settings}.test.ts \
    --coverage.include=<the same paths>)
      Tests  159 passed (159)
All files          |     100 |    95.13 |     100 |     100 |
$ (cd apps/dashboard && pnpm exec eslint <the same paths>)          # no findings
$ (cd apps/dashboard && pnpm exec tsc --noEmit | grep <the same paths>)   # none
```

## Slice 7: C24 specs 2 and 8 (full stack, `e2e/tests/ui-operators.spec.ts`)

- **Spec 2.** The seeded admin opens Users from the console navigation, invites a new address with
  the Reviewer role, sees the toast and the "Invited" row; the email arrives in Mailpit with a
  `${dashboardUrl}/accept-invitation#token=ovi_…` link; the invitee opens it in a browser context of
  their own (the token leaves the address bar at once), chooses a name and a password, lands in the
  console, signs out, signs in again with the password, and has the reviewer's console: Inquiries
  but no Users, and `/users` answers "You do not have access". The admin's list then shows them
  Active with the Reviewer role.
- **Spec 8.** A developer switches to production in the header and the banner changes; a reviewer
  is offered no production, and the API refuses a reviewer session's
  `PUT /dashboard/sessions/current/environment` to production with 403.

These specs were written after the pages, which were built test-first at unit level above, so
spec 2 and the reviewer half of spec 8 passed at their first run: they are acceptance evidence,
not a RED step. The developer half of spec 8 fails, for the reason the shell recorded as an API
gap: `GET /api/v1/dashboard/me` names only the session's environment and no route lists the
organization's environments, so the header has nothing to switch to.

### First run (no annotation)

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... --output-logs=errors-only \
    && pnpm --filter @openverify/e2e exec playwright test tests/ui-operators.spec.ts'
[e2e +66.8s] stack ready; logs in e2e/.artifacts/logs
Running 3 tests using 1 worker
  ✓  1 … an admin invites a user, who accepts by email and signs in with the given role (8.2s)
  ✘  2 … a developer switches to production in the header, and the banner changes (5.0m)
  ✓  3 … a reviewer is offered no production, and the API refuses a switch to it (2.8s)
    Error: locator.click: Test timeout of 300000ms exceeded.
  - waiting for getByRole('banner').getByRole('button', { name: 'Switch to production' })
    (page snapshot: banner > paragraph "Environment: Sandbox", button "Sign out"; no switch)
  1 failed
  2 passed (6.5m)
```

### With the gap recorded

The developer test now waits for the switch with an `expect` (30 s instead of the 5-minute test
timeout) and carries `test.fail(true, 'API gap: GET /api/v1/dashboard/me sends no
meta.environments')`. It still runs and must fail at the switch; once the API sends
`meta.environments`, it passes and Playwright reports the unexpected pass, so the annotation is
removed then. **Playwright counts an expected failure as passed in its summary: the line below is
two real passes and one expected failure, which is a blocker, not a pass.**

```
$ (same command)
  ✓  1 … an admin invites a user, who accepts by email and signs in with the given role (6.3s)
  ✘  2 … a developer switches to production in the header, and the banner changes (30.6s)
  ✓  3 … a reviewer is offered no production, and the API refuses a switch to it (1.2s)
  3 passed (1.5m)
```

## Package-wide checks before finishing

```
$ pnpm --filter @openverify/dashboard test
 Test Files  147 passed (147)
      Tests  1183 passed (1183)
Statements   : 97.78% ( 2958/3025 )
Branches     : 93.29% ( 1991/2134 )
Functions    : 97.61% ( 1025/1050 )
Lines        : 97.78% ( 2873/2938 )
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully                       (tsc: no errors)
$ pnpm --filter @openverify/dashboard lint            # no findings
$ (cd e2e && pnpm exec tsc --noEmit && pnpm exec eslint tests/ui-operators.spec.ts)   # no findings
```
