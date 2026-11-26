# Phase 9, Workflow 9C Stage 1: dashboard-settings (TDD record)

Agent `dashboard-settings` (Workflow 9C base `69ebd7fa`). Owned paths, deliverables and order are the
plan's "Workflow 9C" bullet: C170 first, then C167.4, C168, C169 and the settings form (C174.6).
Every command below was run after `source scripts/env.sh`; iterating runs use
`pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false`.

## Precondition

`docs/PROGRESS.md` records Workflow 9A done (2026-11-05) and Workflow 9B done (2026-11-06);
`69ebd7fa` holds both. No 9C commit existed at the start.

## Slice 1: C170, the console's script CSP

Stub commit: `lib/csp/policy.ts`, `lib/csp/reports.ts`, `components/csp/csp-mode-banner.tsx` and
`app/csp-reports/route.ts`, each exporting its names with no behaviour, so the RED tests compile.

### RED (C170)

Tests: `lib/csp/policy.test.ts` (the exact policy, `'unsafe-eval'` in development only,
`frame-src 'none'` without a flow origin, the 128-bit nonce in Next.js's nonce grammar, the mode
and its fail-closed default, the origin readers), `lib/csp/reports.test.ts` (each rule of C170.2:
the two media types, 16 KiB declared and streamed, malformed bodies, the logged members only, 60
reports a minute per address with a batch counted per report), `proxy.test.ts` (the header byte for
byte with the nonce handed to the render, a fresh nonce per request, report-only, the redirect,
client-sent nonce headers replaced, `/csp-reports` public), `components/csp/csp-mode-banner.test.tsx`,
`app/csp-reports/route.test.ts` (a violation reaches the warn line; the limit keys on the console's
client address, never `X-Forwarded-For`), and the borrowed root layout test in `app/page.test.tsx`
(`connection()` awaited).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/csp src/components/csp src/app/csp-reports src/proxy.test.ts src/app/page.test.tsx --coverage.enabled=false
 Test Files  6 failed (6)
      Tests  58 failed | 51 passed (109)
```
Every failure is a stub's answer (empty policy, `501`, no banner, `connection` never called).
`tsc --noEmit` reports no error in these files (one in another agent's in-flight
`template-tabs.test.tsx`); eslint is clean.

### GREEN (C170)

`lib/csp/policy.ts` (the policy builder `consoleCsp`, `createNonce`, `cspMode`, `cspHeaderName`,
`flowPublicOrigin`, `consolePublicOrigin`, `CSP_NONCE_HEADER = 'x-nonce'`, `REPORTING_ENDPOINTS`),
`lib/csp/reports.ts` (`createCspReportHandler`), `app/csp-reports/route.ts`, `proxy.ts` (the policy
on every matched response, the redirect included; the nonce and policy handed to the render; both
client-sent policy headers dropped first; `/csp-reports` public), `components/csp/csp-mode-banner.tsx`
with `lib/copy/settings.ts`, and two borrowed edits: `app/layout.tsx` awaits `connection()`, and
`components/console-layout.tsx` mounts `<CspModeBanner />` under the environment banner (its test
`console-layout.test.tsx` gains two cases; with the mount line removed, the report-only case fails:
`Tests 1 failed | 12 passed`).

Two test corrections while going GREEN: the 70-report batch was built with the full report members,
so it passed 16 KiB and met the size cap first (413); it is now built of minimal reports, asserted
under the cap. The banner's title and note needed a text space between them.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/csp src/components/csp src/app/csp-reports src/proxy.test.ts src/app/page.test.tsx src/next-config.test.ts --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  121 passed (121)
$ pnpm --filter @openverify/dashboard exec vitest run src/components/console-layout.test.tsx --coverage.enabled=false
      Tests  13 passed (13)
```
eslint and prettier clean on every file of the slice; `tsc --noEmit` reports nothing in them.

### Real-header spec (C170.3) and the checkpoint

`e2e/tests/ui-csp.spec.ts` with helpers in `e2e/tests/support/ui-settings.ts`: every page of the
e2e build's route manifest without a dynamic segment (derived at run time, never listed by hand),
the policy checked byte for byte against an independent copy of C170.1's text with the nonce it
carries, every script carrying that nonce, the nonce new on every request, zero
`securitypolicyviolation` events; `/login`, the 404 page; `prerender-manifest.json` holding no
route; `/csp-reports` without a session.

First locked run (load 6.06 before, 6.42 after; 112 s): the stack did not start, because
`next build` failed type-checking another agent's in-flight
`src/components/schema-form/template-members.test.ts:37` (TS2339). Not this slice's paths; re-run
after it settles.

`[9c-checkpoint:csp]` is committed with this record: C170 has landed with the unit suites green
(121 tests of the slice, the console layout's 13).

## Slice 2: the area's clients and mock routes (checkpoint 1)

Stub commit `ebf3a8ab` (the new names, and `testing/routes/settings.ts`), RED `9aa46c38`:
`lib/api/settings-clients.test.ts` (the fixtures pass their answer schemas; each route's method,
path, body and parsed answer) and `lib/api/sessions.test.ts` (the browser's `User-Agent` forwarded on
sign-in, the second factor and an accepted invitation, capped at 1,024 characters).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/settings-clients.test.ts src/lib/api/sessions.test.ts --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  19 failed | 35 passed (54)
```
GREEN: `getGrantable` (roles.ts); `setUserRoles`, `reactivateUser`, `resetUserMfa`,
`resendInvitation` (users.ts); `listMySessions`, `revokeMySession`, `revokeOtherSessions`,
`stepUpSession` and the sign-in calls through `signInRequest`, which forwards the browser's
`User-Agent` (sessions.ts, Handover to 9C: "the BFF must forward the browser's User-Agent");
`getNotificationPreferences`, `updateNotificationPreferences` (notifications.ts); `rotateApiKey`
(api-keys.ts); `searchWebhookDeliveries` (webhook-deliveries.ts, `next` read back as a `whd_` id);
`filter[action-prefix]` and `filter[ip]` in `listAuditLogs`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api --coverage.enabled=false
 Test Files  39 passed (39)
      Tests  392 passed (392)
```

## Slice 3: notification settings at /notifications (C169.7)

Stub `0fc2e863`, RED `4570f460` (`app/notifications/page.test.tsx`, `actions.test.ts`,
`components/operators/notification-preferences-form.test.tsx`: 5 failed for the stubs' empty page,
refused action and empty form). GREEN: the page (a session, no permission) with a table of every
`USER_NOTIFICATION_KINDS` kind and its console and email boxes, the action sending every kind with
both channels, and the words of what the choices apply to today (only the webhook-failure alert
reads them, S4B-14) and of what an email holds.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/notifications src/components/operators/notification-preferences-form.test.tsx --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  5 passed (5)
```

## Checkpoint 1

`[9c-checkpoint:dashboard-settings:1]`: the area's clients with tests (slice 2), `testing/routes/settings.ts`,
`lib/copy/settings.ts` (`SETTINGS_COPY`, through `defineCopy`), and a page at the one route a 9C
navigation entry points at for this area (`/notifications`, the header's "Notification settings",
which `[9c-shared]` added). No navigation request: "my sessions" is reached from `/account/security`
(this area's page) and every other page of the area already has its entry.

## Slice 4: the users page (C168.1, C168.3, C168.5; AC2)

Actions: stub `65982a15`, RED `db3bf3d4` (24 fail: reactivation and the reset through their routes,
a code verified first through the step-up, a malformed code refused at `/totp-code`, a refused code
said at the field with nothing else called, `step_up_required` and `user_more_privileged` in words,
reactivate's 409, 502 and 503 in words, the reset never on oneself, the resend through
`POST /invitations/:id/resend`, and `setUserStatus` refusing `active`). Changed existing tests (the
plan changes the behaviour, AC2 and C168.1): `actions.test.ts`' "reactivates a user" now expects the
refusal, and `resendInvitation`'s tests post the user id to the resend route instead of a new
invitation. GREEN: `reactivateUser`, `resetUserMfa`, `resendInvitation` and `setUserStatus`
(deactivation only).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/users/actions.test.ts --coverage.enabled=false
      Tests  37 passed (37)
```

Page: RED `59a10057` (4 fail: factor kinds and last sign-in to `users:write` only, the reactivation
dialog's words and its code field, the reset offered for another user with a factor and never for
oneself). GREEN: `UsersTable` gains the MFA cell with factor kinds, the last sign-in column, the
reactivate and reset dialogs with `StepUpCodeField` (`autocomplete="one-time-code"`, paste allowed),
and the resend posting the user id.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/users src/components/operators --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  152 passed (152)
```

## Slice 5: my sessions at /account/sessions (C168.4)

Stub `ee390824`, RED `41e9b02d` (6 fail). GREEN: the page (a session, no permission), `SessionsTable`
(device summary or "Unknown device", signed in and last seen, the current session marked in words and
never offered for sign-out, one session or every other signed out after a confirmation) and the two
actions; the Security page links to it and says that adding a factor signs out the other sessions
(its test, written first, failed with the link absent: `Tests 1 failed | 6 passed`).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/account --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  118 passed (118)
```

## Slice 6: the audit explorer (C168.6)

Stub `88146834`, RED `ad2f6131` (16 fail): the action prefix read from the URL and checked with the
contract's own `filter[action-prefix]` schema; an IP address never read from the URL; the address
search posted to `searchAuditLogsByIp` (`audit-logs:read` and `pii:view`, one exact IPv4 or IPv6
address checked with `node:net`'s `isIP` before the API, the 503 of an installation without a
blind-index key in words, "more exist" when the API has a next page); `AuditIpSearch` listing the
entries with their count in a polite status, the URL unchanged. GREEN `56b761c8`. The changed test
`auditLogFilterQuery` expects the new `action-prefix` parameter.

Page: RED `3759928d` (3 fail), GREEN: the prefix field in the GET filter form, the address search
for `pii:view` readers, and for others the sentence that it needs `pii:view`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/audit-logs src/components/operators --coverage.enabled=false
 Test Files  18 passed (18)
      Tests  135 passed (135)
```
The date filters stay `filter[created-at-start]`/`filter[created-at-end]` (the existing form's UTC
days); `filter[from]`/`filter[to]` have the same meaning and are not sent twice.

## Slice 7: API keys (C169.1 to C169.3)

Stub `a58ed82b`, RED `3d1daca2` (10 fail): `rotateApiKey` (the old token's window from the offered
choices, the name only when typed, a time not offered refused at `/previous-expires-in-seconds`, the
API's 403 words kept), `updateApiKey` sending the note (emptied: `null`) and the blocklist one per
line, the rotate dialog (choices, then the new token once with the old token's end), the edit
dialog's note and blocklist, no rotation for an expired key, and the key page's note, blocklist and
age warning in words. While going GREEN the dialog's expected time was corrected to the console's
own UTC format (`formatUtc`, "Oct 21, 2026, 4:40 AM (UTC)"); the page tests' `vi.mock('../actions')`
gained `rotateApiKey`.

GREEN: `rotateApiKey` (the choices are `ROTATION_CHOICES` in `components/integrations/expiry-choices.ts`:
now, 1 hour, 1 day, 7 days, 30 days), the edit dialog's note and blocklist, the rotate
`SecretActionButton` that opens the new key after the token is closed, and the key page's age (whole
days since creation), note, blocklist and the `age-warning` alert.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/api-keys src/components/integrations --coverage.enabled=false
 Test Files  22 passed (22)
      Tests  146 passed (146)
```

## Slice 8: webhooks (C169.5, C169.6)

Stub `77f69235` (the form defaults' `name`, `description`, `failureAlert`), RED `0693b337` (12 fail):
`webhookAttributesFromForm` reading the name, the description (trimmed, emptied: `null`) and the
failure alert (`null` when unticked and empty; the numbers kept, off, when unticked; the threshold
1 to 10,000 and the window 5 to 1,440 refused at their fields in words), and none of the three when
the form does not show them; `createWebhook` refusing a new webhook without a name before the API;
the create and edit forms' fields; the detail page's name as title, description, the alert in words
and the previous secret's end with "receivers must accept either". The changed fixture: the existing
`NEW_WEBHOOK` of `app/webhooks/actions.test.ts` now carries a name (the console requires one).

GREEN: the mapping in `lib/api/webhooks.ts`, the name rule joined to the other fields' errors in
`createWebhook` (an existing test of several field errors showed that a separate early refusal hid
them), the fields in `WebhookFields` (name required on create only), the edit page's defaults, and on
the detail page `FailureAlertValue` and the previous-secret alert while that secret still signs.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/integrations src/lib/api/webhooks.test.ts src/app/webhooks --coverage.enabled=false
 Test Files  25 passed (25)
      Tests  174 passed (174)
```

## Slice 9: the settings form (C174.6, C158.1, C158.4, C167.2, C168.8)

RED `3b003d69` (17 fail; `app/settings/actions-platform.test.ts`,
`components/operators/settings-form-platform.test.tsx`). GREEN: `PlatformSettingsFields` (client;
each group shown only where the server reports it): the embed origins one per line with what an
allowlist does and does not stop, the redirect origins of their own behind a box (unticked: `null`,
the embed origins), the production wildcard acknowledgement; the reporting zone chosen from the
server's `Intl.supportedValuesOf('timeZone')` (passed by the page, so the server and the browser
render the same options), the suppression threshold (floor 11), the analytics retention, settle and
per-reviewer windows; the key age warning, the audit retention (empty: kept) and the sender name.
`saveSettings` checks each number against its contract bounds, the zone with
`analyticsTimeZoneSchema` and the name with `mailSenderNameSchema` before the API, sends only what
changed, adds `meta.acknowledge-wildcards` only with a change of the origins and the box ticked, and
says `embed_wildcard_unacknowledged` and `embed_origin_invalid` in words with each entry's pointer
kept. The Organization group says that `require-mfa` is an organisation setting (SETTING_LEVEL) and,
when off, that operators can sign in with a password alone. `PLATFORM_NUMBER_FIELDS` lives in
`settings-fields.ts`, a plain module the server action can import (a value imported from a
`'use client'` module is a client reference on the server).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/settings src/components/operators --coverage.enabled=false
 Test Files  23 passed (23)
      Tests  197 passed (197)
```

## Slice 10: the role editor (C167.4) and its model of what may be granted (C167.2)

Model: stub `141ee356`, RED `70e1a049` (10 fail), GREEN `1628768d`: `components/operators/grantable.ts`
(`roleEditorRefusals`: an environment-level permission must be grantable in every environment, named
where the editor lacks it; an organisation-level one is judged by the organisation-wide scope;
`isSensitivePermission`; `assignmentScopes` with the API's three refusal reasons in words).
Checklist and form: stub `709e2dd1`, RED `e0bb0194` (3 fail), GREEN in `1628768d`: refused grants
disabled with their reasons, "Sensitive." in words and an icon, the organisation-level sentence, and
the confirmation listing what an edit removes and from how many users (or "every user with this
role" when the count is unknown). Changed existing test (the plan adds the sensitive mark):
`permission-checklist.test.tsx`' "offers only the permissions the operator holds" expects
"pii:view. You do not hold it, so you cannot grant it. Sensitive.".
Pages: RED `96b4d1ae` (2 fail), GREEN: the new and edit pages read `GET /dashboard/roles/grantable`
and the edit page counts the holders with `roleHolderCount` (`lib/api/users.ts`, five pages of 100
at most, `null` beyond, so the confirmation never states a count it did not read). The existing
role page tests answer the new reads (`app/roles/page.test.tsx`).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/roles src/lib/api/users.test.ts src/components/operators --coverage.enabled=false
 Test Files  5 passed (5)   Tests  41 passed (41)        (roles and users clients)
 Test Files  22 passed (22) Tests  214 passed (214)      (operators, roles, users)
```

## The real-header spec on the full stack (C170.3)

Locked runs of `tests/ui-csp.spec.ts` (each: stack down, turbo build, stack up, the spec, stack
down, under `flock -w ... /tmp/openverify-e2e.lock timeout 520`):
- runs 1 to 3 and 5 did not reach the spec or met another agent's in-flight type error in
  `next build` (template forms, themes copy); run 4 never got the lock within 60 s;
- run 5 (load 17.8 before, 29.0 after; 590 s): the policy matched C170.1 byte for byte; three test
  defects, not console ones: a response carries one policy header (the proxy's replaces
  `next.config.ts`' static `frame-ancestors 'none'` on the routes it runs on, and holds
  `frame-ancestors 'none'` itself; the static header still covers the routes the proxy skips and
  stays enforced in report-only mode), and `/_global-error`, Next.js's own fallback for a failing root
  layout, is the one route the framework prerenders;
- run 6 (447 s): scripts that Next.js's runtime adds after load carry no nonce, as
  `'strict-dynamic'` intends; the nonce check now reads the server's HTML;
- **run 7: exit 0, 510 s, load 25.55 before and 31.25 after: 4 passed (1.4 min)**; the page sweep
  over every static page of the build took 66 s.

## Slice 11: assignments per environment (C167.2's console part)

Stub `d59a7d3d`, RED `24799aa2` (4 fail). GREEN: `updateUserRoles` sends
`PUT /dashboard/users/:id/roles` with one assignment per checked role, everywhere (`null`) or in the
environment chosen, asks for the scope of each checked role before the API, and says
`role_scope_invalid` in words; `UserRolesButton` asks "Where <role> applies" for each grantable role
with the scopes of `assignmentScopes` (refused ones disabled with their reason) and says that the
current assignments' environments are not shown yet (no route reads them: contract deviation); the
users page reads `grantable` for a writer with `roles:read`. Changed existing tests (the plan
changes the call, C167.2): `app/users/actions.test.ts`' `updateUserRoles` describe now expects the
`PUT` with scopes, and the users page tests answer the `grantable` read.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/users src/components/operators --coverage.enabled=false
 Test Files  19 passed (19)
      Tests  185 passed (185)
```

## Slice 12: the delivery search (C165.4)

Model and action: stub `bdcf09b1`, RED `45cfe6c5` (6 fail), GREEN `e2cc18dd`:
`deliverySearchBodyOf` (`components/integrations/delivery-search-query.ts`) turns the builder's rows
into the API grammar (all of: `and`, any of: `or`, "is not": `not`; a comma list with "is one of":
`in`; a `datetime-local` value read as UTC), at most 20 conditions and two levels, refusing a search
without a condition and each row whose value does not fit its attribute, named by its position;
`searchDeliveries` (`webhooks:read`). Builder: stub `2060959e`, RED `78daa8b5` (2 fail), GREEN:
`DeliverySearch` (native fields only, so it works by keyboard; add and remove conditions up to 20;
the count announced politely; "Next page" posts the last delivery's id), the page
`/webhooks/deliveries` and its link from `/webhooks` (test written first).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/webhooks src/components/integrations --coverage.enabled=false
 Test Files  28 passed (28)
      Tests  165 passed (165)
```

## Slice 13: the console settings spec and the borrowed real-header conversions

`e2e/tests/ui-settings.spec.ts` (budget 90 s; data made through the API in the spec; operators made
with `operatorWithRole`, the seeded admin through `signInAs`): a sandbox-only role is refused
production (`PUT /sessions/current/environment` 403 `no_environment_role`); an operator without
`pii:view` sees "View personal data" disabled with "You do not hold it in Sandbox or Production";
the admin rotates a key in one dialog and is told when the old token stops, sets a webhook's failure
alert (disabled at once so it receives nothing), opens "my sessions", and is refused
`https://*.vercel.app` at the field; the address search is offered with `pii:view` only, and the
audit explorer and the users list send an auditor without `pii:view` no address and no factor
details (server HTML read with the auditor's cookie); axe on every page and state; no CSP violation.
First locked run (655 s with the lock wait; load 13.6 before, 20.9 after): 2 passed, 1 failed (the
seeded viewer has no `audit-logs:read`, so it saw the forbidden panel); the spec now uses an
auditor operator (`4c77fcd1`).

Borrowed (`2df3d4b3`): `ui-graph.spec.ts` and `ui-reviewer.spec.ts` no longer inject a policy with
`injectNonceCsp`; their CSP tests run under the console's real header and keep their assertions
(`'strict-dynamic'`, `style-src`). `ui-workflows.spec.ts` and `ui-workflow-editor.spec.ts` already
read the real header (dashboard-flow-builder's change). `injectNonceCsp` and `nonceCsp` stay exported
from `e2e/tests/support/ui-graph.ts`, unused.

## Final gates (dashboard-settings)

| Gate | Command | Exit | Time | Load before / after |
|---|---|---|---|---|
| Dashboard tests and coverage | `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard test` | 0 | 786 s | 13.15 / (backgrounded at the 600 s call cap; exit read from its output) |
| | 559 files, 6,529 tests; statements 95.57%, branches 88.53%, functions 94.87%, lines 95.6% | | | |
| Forced lint and typecheck | `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 0 (first try 75: no slot in 150 s) | 459 s | 21.24 / 12.08 |
| Prettier | `pnpm exec prettier --check` on the 105 files of this area changed since the base | 0 after `ee3f7b53` | | |
| `ui-settings.spec.ts`, one locked call (stack down, build, up, spec, down) | `flock -w 450 /tmp/openverify-e2e.lock timeout 520 sh -c "... playwright test tests/ui-settings.spec.ts ..."` | 0 | 357 s (3 passed in 30.9 s) | 11.12 / 5.69 |
| `ui-csp.spec.ts`, one locked call | the same with `tests/ui-csp.spec.ts` | 0 | 380 s (4 passed in 35.1 s; the page sweep 29.4 s) | 3.90 / 14.15 |

`git status --porcelain` is empty for this area's paths. No request was addressed to
`dashboard-settings` (`git log ... | grep -F '[9c-request:dashboard-settings]'`: none).
