# TDD evidence: Phase 2, Workflow 2C, dashboard-integrations (Stage 2)

Scope: the C23 integrations pages of the operator console, on the dashboard-shell's BFF layer
(C21): webhooks and their deliveries (C14), API keys (C12), API logs (C12) and events (C5, C12),
and C24 specs 4 and 5 (`e2e/tests/ui-integrations.spec.ts`).

| Route | What it does | Permission |
|---|---|---|
| `/webhooks` | List, cursor paging, "New webhook" | `webhooks:read` (`:write` to add) |
| `/webhooks/new` | URL, events (or all), API version, filters, attribute blocklist, custom headers; the signing secret shown once | `webhooks:write` |
| `/webhooks/[id]` | Configuration; edit, enable or disable, rotate the secret with an overlap (new secret shown once), clone (secret shown once), archive; send a test event; replay by IDs or by UTC range; deliveries filtered by status and event in the URL | `webhooks:read` (`:write` for changes) |
| `/webhooks/[id]/edit` | The form, from the webhook's configuration; custom headers kept unless replaced as a whole | `webhooks:write` |
| `/webhooks/[id]/deliveries/[deliveryId]` | Delivery and every attempt (response status, duration, error) | `webhooks:read` |
| `/api-keys`, `/api-keys/new`, `/api-keys/[id]` | List; create with only the operator's own scopes, allowed IP ranges, version, expiry, token shown once; rename and change ranges, clone (token shown once), expire | `api-keys:read` / `:write` |
| `/api-logs`, `/api-logs/[id]` | Filters method, status code or class, route, API key, UTC range in the URL; query and bodies as JSON, truncated bodies as size and preview, masked values "Hidden" | `api-logs:read` |
| `/events`, `/events/[id]` | Filters name, object, real or simulated, UTC range in the URL; payload as JSON with masked values "Hidden"; the event's webhook deliveries for `webhooks:read` | `events:read` |

Every command ran from the repository root after `source scripts/env.sh`, unless it says otherwise.
Output is abbreviated with `…`. Other agents edit `apps/dashboard` at the same time, so while
iterating only my own test files ran; the whole package ran at the end.

## Slice 1: list queries and form readers (`src/lib/api/{webhooks,webhook-deliveries,api-keys,api-logs,events}.ts`)

The node client (C18) has a method for every endpoint these pages call, so the resource modules
hold what the client does not: the URL query of each list (filters checked one by one, so a bad
value is reported next to its control and the rest still apply), the page size, and how the
webhook, replay and API key forms become the attributes and metas the contract schemas validate.
`components/integrations/filter-values.ts` holds the shared, server-only-free parts
(`readFilters`, `utcTimestamp` for `datetime-local` values read as UTC, `splitList`).

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations/filter-values.test.ts \
    src/lib/api/{webhook-deliveries,events,api-logs,webhooks,api-keys}.test.ts --coverage.enabled=false
 FAIL  src/lib/api/api-keys.test.ts         Error: Cannot find module './api-keys'
 FAIL  src/lib/api/api-logs.test.ts         Error: Cannot find module './api-logs'
 FAIL  src/lib/api/events.test.ts           Error: Cannot find module './events'
 FAIL  src/lib/api/webhook-deliveries.test.ts  Error: Cannot find module './webhook-deliveries'
 FAIL  src/lib/api/webhooks.test.ts         Error: Cannot find module './webhooks'
 FAIL  src/components/integrations/filter-values.test.ts  Failed to resolve import "./filter-values"
 Test Files  6 failed (6)
```

The first RED commit was blocked by the gitleaks pre-commit hook: `const KEY = 'key_01J9…'` matched
`generic-api-key`. These are synthetic IDs, not secrets; the constants were renamed (`CALLER`,
`CURSOR`), and later fixtures use low-entropy key IDs (`key_01J9ZK3M5Q0000000000000063`), as the
API's tests do.

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run <the same files> --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  41 passed (41)
$ (cd apps/dashboard && pnpm exec eslint <slice files>)
  webhooks.test.ts 67:31, 68:27  no-unnecessary-template-expression   -> fixed, then clean
```

A GREEN-time assertion covers an impossible month (`2026-13-01T10:00`); `utcTimestamp` also
refuses a day `Date` would roll over (`2026-02-30T10:00`).

## Slice 2: shared integrations components (`src/components/integrations/`)

`JsonView` and `LoggedJson` (indented JSON without a dependency; a `null` the API masks, in a
`fields` object or as `note`, `ip-address` or `user-agent`, reads "Hidden" with one explanation;
an API log value over 64 KiB shows its byte length and preview), status badges, `EventPicker`
("All events" posts `*` alone), `CustomHeadersEditor` (rows; on edit the stored names are listed
and kept unless the operator replaces them all), `SecretActionButton` (ask, run, show the secret
once; the action state keeps nothing), `InstantActionButton`, `errorsUnder`.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations --coverage.enabled=false
 FAIL  …/badges.test.tsx                 Failed to resolve import "./badges"
 FAIL  …/custom-headers-editor.test.tsx  Failed to resolve import "./custom-headers-editor"
 FAIL  …/event-picker.test.tsx           Failed to resolve import "./event-picker"
 FAIL  …/form-errors.test.ts             Failed to resolve import "./form-errors"
 FAIL  …/instant-action-button.test.tsx  Failed to resolve import "./instant-action-button"
 FAIL  …/json-view.test.tsx              Failed to resolve import "./json-view"
 FAIL  …/secret-action-button.test.tsx   Failed to resolve import "./secret-action-button"
 Test Files  7 failed | 1 passed (8)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  44 passed (44)
$ (cd apps/dashboard && pnpm exec eslint src/components/integrations)
  custom-headers-editor.test.tsx 11:81 no-base-to-string; secret-action-button.tsx 71:21 no-unused-vars  -> fixed
$ (cd apps/dashboard && pnpm exec vitest run src/components/integrations --coverage.include='src/components/integrations/**')
      Tests  45 passed (45)        # + a test of SecretActionButton without its optional props
All files          |     100 |    97.77 |     100 |     100 |
```

## Slice 3: webhooks (pages, server actions, forms)

Server actions in `src/app/webhooks/actions.ts` (create, update then redirect, enable, disable,
archive, clone, rotate-secret, simulate, replay), each `runAction({ permissions:
['webhooks:write'] })` and validated with the contract's request schema. Two contract messages
are put in words: no event chosen (the events union says only "Invalid input"), and a replay form
is checked field by field before the union schema.

React 19 resets a `<form action={…}>` after every run that does not throw, and a refused
submission does not throw: the long webhook form would lose what the operator typed. The forms
therefore submit through `useSubmitAction` (`onSubmit` plus a transition), and `FormDialogButton`
does the same for small dialog forms.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/webhooks \
    src/components/integrations/{form-dialog-button,webhook-form,webhook-actions,simulate-event-form,replay-events-form}.test.tsx --coverage.enabled=false
 FAIL  src/app/webhooks/actions.test.ts      Cannot find module '/src/app/webhooks/actions'
 FAIL  src/app/webhooks/boundaries.test.tsx  Failed to resolve import "./[id]/loading"
 FAIL  src/app/webhooks/page.test.tsx        Failed to resolve import "./page"
 FAIL  …/new/page.test.tsx, [id]/page.test.tsx, [id]/edit/page.test.tsx,
       [id]/deliveries/[deliveryId]/page.test.tsx   Failed to resolve import "./page"
 FAIL  src/components/integrations/{form-dialog-button,replay-events-form,simulate-event-form,
       webhook-actions,webhook-form}.test.tsx        Failed to resolve import
 Test Files  12 failed (12)
```

Before GREEN, one test was corrected: the read-only check of `[id]/page.test.tsx` asserted that
the page had no button at all, but the deliveries filter form has an "Apply filters" button; it
now names the action buttons that must be absent.

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/webhooks src/components/integrations --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  120 passed (120)
$ (cd apps/dashboard && pnpm exec eslint src/app/webhooks src/components/integrations)
  4 findings: FormEvent is deprecated (-> SubmitEvent), two `as HTMLElement` (-> an nth() helper),
  one type argument  -> fixed
$ (cd apps/dashboard && pnpm exec tsc --noEmit | grep <my paths>)
  [id]/page.tsx TS2345 (the '*' check against the enabled-events union),
  webhook-actions.test.tsx TS2322 (literal-typed mocks)  -> fixed
All files          |   98.39 |     93.7 |   97.12 |   98.34 |      # my files only
```

## Slice 4: API keys

`createApiKey` offers only `grantableScopes(session.permissions)`; if the API still refuses a
scope (403 `forbidden`, for example after a role change) the action shows the API's own title
and detail, which name the missing scopes, instead of the generic "You do not have access".
`POST /api-keys` takes no expiry, so a key created with one is created, then expired with
`expires-in-seconds`; when that second call fails the token is still shown, with a warning, since
the key exists. A key made by a role without `pii:view` is masked (Workflow 2B F001): the form
says so before the key is made.

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/api-keys \
    src/components/integrations/{api-key-form,api-key-actions}.test.tsx --coverage.enabled=false
 FAIL  src/app/api-keys/actions.test.ts      Cannot find module '/src/app/api-keys/actions'
 FAIL  src/app/api-keys/boundaries.test.tsx  Failed to resolve import "./error"
 FAIL  src/app/api-keys/page.test.tsx, new/page.test.tsx, [id]/page.test.tsx  Failed to resolve import "./page"
 FAIL  src/components/integrations/api-key-actions.test.tsx, api-key-form.test.tsx  Failed to resolve import
 Test Files  7 failed (7)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run <the same files> --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  40 passed (40)
$ (cd apps/dashboard && pnpm exec eslint src/app/api-keys src/components/integrations)
  actions.ts 122:36 no-unnecessary-condition (the request id is never null after ??)  -> fixed
All files          |   98.68 |    93.56 |   98.37 |   98.63 |      # webhooks + API keys files
```

## Slice 5: API logs and events

The deliveries table now links each delivery through its own `webhook-id`, so the event page
lists one event's deliveries across webhooks (a Webhook column replaces the Event column).

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/api-logs src/app/events --coverage.enabled=false
 FAIL  src/app/api-logs/boundaries.test.tsx  Failed to resolve import "../events/error"
 FAIL  src/app/api-logs/page.test.tsx, [id]/page.test.tsx  Failed to resolve import "./page"
 FAIL  src/app/events/page.test.tsx, [id]/page.test.tsx    Failed to resolve import "./page"
 Test Files  5 failed (5)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/{api-logs,events,webhooks,api-keys} \
    src/components/integrations src/lib/api/{webhook-deliveries,events,api-logs,webhooks,api-keys}.test.ts --coverage.enabled=false
 Test Files  37 passed (37)
      Tests  222 passed (222)
$ (cd apps/dashboard && pnpm exec vitest run <same> --coverage.reportsDirectory=<scratch> --coverage.include=<my paths>)
All files          |   99.32 |    95.59 |   99.65 |   99.29 |
```

A first coverage run failed with "The coverage report directory … is already in use by another
Vitest process": another agent was running coverage in `apps/dashboard/coverage`. My coverage runs
write their reports to a directory of their own.

## Slice 6: C24 specs 4 and 5 (full stack)

`e2e/tests/ui-integrations.spec.ts`, as the seeded developer:

- spec 4: create a webhook on the e2e receiver; the secret is shown once and is not in the page
  afterwards; edit it (a second event; saving opens the webhook again); rotate the secret with a
  one-hour overlap; send a test `inquiry.approved`; the receiver gets it, flagged `simulated`, and
  both secrets verify its signature; after reloads the deliveries list shows it "Succeeded", and its
  delivery page shows the 200 attempt and links the event;
- spec 5: the create form offers only the developer's scopes and says the key will not see
  personal data; the token is shown once (only its prefix afterwards); it lists inquiries (200)
  and is refused webhooks (403); expired "Now" in the UI, it answers 401.

The spec checks pages built test-first in slices 3 and 4 against the real stack, so it passed on
its first run.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e exec playwright test tests/ui-integrations.spec.ts'
[e2e +56.2s] stack ready; logs in e2e/.artifacts/logs
Running 2 tests using 1 worker
  ✓  1 [chromium] › tests/ui-integrations.spec.ts:41:1 › a developer creates a webhook, rotates its secret and sends it a test event it receives (7.3s)
  ✓  2 [chromium] › tests/ui-integrations.spec.ts:138:1 › a developer creates an API key whose token is shown once and works, then expires it (3.9s)
  2 passed (1.2m)
```

The whole dashboard package, typecheck and lint at that point:

```
$ (cd apps/dashboard && pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>)
 Test Files  161 passed (161)
      Tests  1269 passed (1269)
All files          |   98.42 |    94.27 |   98.76 |   98.44 |
$ pnpm --filter @openverify/dashboard typecheck   # next typegen && tsc --noEmit: no errors
$ pnpm --filter @openverify/dashboard lint        # no findings
$ pnpm --filter @openverify/e2e typecheck && pnpm --filter @openverify/e2e lint   # clean
```

## Slice 7: F001 in the token dialog and the clone question; the webhook edit in spec 4

The requirement asks the create dialog to say a key made without `pii:view` is masked. The create
flow is a page form, which said it already; the token dialog and the clone question now say it
too. Spec 4 gained the edit step (it also proves the edit action's server-side redirect works when
the action is called from `onSubmit`).

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations/{api-key-form,api-key-actions}.test.tsx --coverage.enabled=false
     × says a copy made by a role without pii:view does not see personal data
     × explains that a key made by a role without pii:view does not see personal data
 FAIL … expect(element).toHaveTextContent() … Expected element to have text content … Received …
 Tests  2 failed | 9 passed (11)
```

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations src/app/api-keys --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  108 passed (108)
```

After slice 7, the full-stack spec again (with the edit step), and the whole package:

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e exec playwright test tests/ui-integrations.spec.ts'
Running 2 tests using 1 worker
  ✓  1 [chromium] › tests/ui-integrations.spec.ts:41:1 › a developer creates a webhook, rotates its secret and sends it a test event it receives (6.0s)
  ✓  2 [chromium] › tests/ui-integrations.spec.ts:146:1 › a developer creates an API key whose token is shown once and works, then expires it (2.6s)
  2 passed (52.8s)
$ (cd apps/dashboard && pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>)
 Test Files  161 passed (161)
      Tests  1270 passed (1270)
All files          |   98.42 |    94.28 |   98.76 |   98.44 |
```

## API gaps found (for Stage 3; the API was not changed)

- `POST /api/v1/api-keys` takes no expiry: the strict body has `name`, `scopes`, `allowed-ips`
  and `api-version` only. The console creates the key, then calls
  `POST /api-keys/:id/expire`; between the two calls the key has no expiry, and when the second
  fails it keeps none (the console still shows the token, with a warning). Expected: an optional
  `expires-in-seconds` (0 to 2,592,000) on creation.
- The `api-key` resource does not say whether the key sees personal data masked (2B F001
  `api_keys.pii_masked`). The console can warn only when the current operator creates or clones
  a key; a key's page cannot show it, and a clone of a masked key made by an admin is masked
  without the console knowing. Expected: an attribute such as `pii-masked: boolean`.
