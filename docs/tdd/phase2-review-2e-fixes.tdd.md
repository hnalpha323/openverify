# TDD evidence: Workflow 2E review fixes (TypeScript)

- **Slice owner:** TypeScript fixer (the review of Workflow 2E, every commit after `68f0d54`).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/` (api, dashboard, flow)
  - `packages/`
  - `contracts/fixtures/`
  - `e2e/`
  - `docs/plans/phase-2.plan.md`
  - `docs/api/openapi.json`
  - `THIRD_PARTY_LICENSES.md`
  - this file
- **Input:** no blocking findings. One MEDIUM finding: E001.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. The output below is trimmed to the lines that matter.

## E001: the verification page blamed pii:view for hidden images when inquiries:read was missing, and still linked the inquiry

**Confirmed by reading the code.** In `apps/dashboard/src/components/verification-view.tsx`:
- `media` falls to `'hidden'` whenever the inquiry document is missing. The file content route (`apps/api/src/routes/dashboard/files.ts`, scopes `['inquiries:read', 'pii:view']`) needs both permissions.
- `VerificationImage` always rendered `<HiddenValue />`. Its fixed explanation is "Your role cannot see personal data (the pii:view permission)." So a custom role with `verifications:read` and `pii:view`, but without `inquiries:read`, was told it lacked a permission it already holds.
- The breadcrumb always linked "Inquiries" and "Inquiry inq_…".
- The Details cell linked the inquiry in the `forbidden` case, not only in the `ready` case.
- A 403 on the inquiry rendered an unlabelled page-level `ForbiddenPanel` between the header and Details.
- `PageHeader` marked every unlinked breadcrumb `aria-current="page"`, so simply dropping the parents' `href` would have marked three crumbs as the current page.

No built-in role reaches this state, because each built-in role with `pii:view` also has `inquiries:read`.

**Fix (local, no contract change).**
- `HiddenValue` takes an optional `explanation`. The default is unchanged: the `pii:view` text.
- `VerificationImage` takes an optional `hiddenExplanation` and passes it on.
- When the inquiry could not be read (`hidden` or `forbidden`), the verification page explains the hidden images as follows:
  - "Your role cannot see these images (the inquiries:read permission).";
  - "… (the inquiries:read and pii:view permissions)." when `pii:view` is missing too.
- When the inquiry is readable, the `pii:view` text is kept.
- The breadcrumb's "Inquiries" and "Inquiry inq_…" items, and the Details cell, link only when the inquiry was read (`ready`).
- The page-level forbidden panel is gone. On a 403 for the inquiry, the Files section shows a level-3 `ForbiddenPanel` naming `inquiries:read`, above the files.
- `PageHeader` marks only the last breadcrumb `aria-current="page"`. An earlier crumb without `href` is plain text.
- `apps/dashboard/README.md` describes the new behaviour in its `/verifications/[id]` row.

A redacted inquiry still cannot be detected without `inquiries:read`: the redaction time comes from the inquiry. Its images are now "Hidden" with the correct explanation, which is accurate for that operator.

### RED

Tests:
- `apps/dashboard/src/app/verifications/[id]/page.test.tsx`:
  - the existing no-`inquiries:read` test now checks each image's explanation and the breadcrumb;
  - a new test for neither `inquiries:read` nor `pii:view`;
  - a new test for a 403 on the inquiry;
  - the existing no-`pii:view` test checks that the `pii:view` explanation is kept. This is a guard and passes before the fix.
- `apps/dashboard/src/components/page-parts.test.tsx`: a new `PageHeader` test, an unlinked parent breadcrumb.

```text
$ (cd apps/dashboard && npx vitest run "src/app/verifications/" src/components/page-parts.test.tsx --coverage.enabled=false)
 FAIL  src/components/page-parts.test.tsx > PageHeader > marks only the last breadcrumb as the current page when a parent has no link (Workflow 2E E001)
Error: expect(element).not.toHaveAttribute("aria-current") // element.hasAttribute("aria-current")
Expected the element not to have attribute:
  aria-current
Received:
  aria-current="page"
 ❯ src/components/page-parts.test.tsx:71:54

 FAIL  src/app/verifications/[id]/page.test.tsx > verification page (C26) > lists the files by ID without inquiries:read, and reads no inquiry
Error: expect(element).toHaveAccessibleDescription()
Expected element to have accessible description:
  Your role cannot see these images (the inquiries:read permission).
Received:
  Your role cannot see personal data (the pii:view permission).

 FAIL  src/app/verifications/[id]/page.test.tsx > verification page (C26) > names both permissions the images need without inquiries:read or pii:view (Workflow 2E E001)
Error: expect(element).toHaveAccessibleDescription()
Expected element to have accessible description:
  Your role cannot see these images (the inquiries:read and pii:view permissions).
Received:
  Your role cannot see personal data (the pii:view permission).

 FAIL  src/app/verifications/[id]/page.test.tsx > verification page (C26) > names inquiries:read in the Files section when the API refuses the inquiry, and links no inquiry (Workflow 2E E001)
TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "You do not have access"
 ❯ src/app/verifications/[id]/page.test.tsx:242:21
      Tests  4 failed | 26 passed (30)

$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully          (tsc --noEmit: exit 0; the RED tests compile)
```

Committed as `1fe4afa` (`test(dashboard): …`).

### GREEN

```text
$ (cd apps/dashboard && npx vitest run "src/app/verifications/" src/components/page-parts.test.tsx src/components/masked-value.test.tsx src/components/verification-card.test.tsx src/app/inquiries/ --coverage.enabled=false)
 Test Files  10 passed (10)
      Tests  142 passed (142)
```

### Refactor

The two conditional breadcrumb objects became one local helper, `parentCrumb(label, href)`, which links only when the inquiry was read. The inquiry path is computed once, as `inquiryHref`.

```text
$ (cd apps/dashboard && npx eslint src/components/verification-view.tsx src/components/verification-card.tsx src/components/hidden-value.tsx src/components/page-header.tsx)
(no output)
$ (cd apps/dashboard && npx vitest run "src/app/verifications/" src/components/page-parts.test.tsx src/components/masked-value.test.tsx src/components/verification-card.test.tsx --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  53 passed (53)
$ pnpm --filter @openverify/dashboard typecheck
typecheck exit 0
$ pnpm --filter @openverify/dashboard test
 Test Files  168 passed (168)
      Tests  1427 passed (1427)
All files          |   98.43 |    94.42 |   98.69 |   98.45 |
```

Committed as `933ae79` (`fix(dashboard): …`).

Callers checked:
- `HiddenValue` is also used by `MaskedValue` and `lifecycle/note-editor.tsx`. Both call it with no props, so they keep the `pii:view` text.
- `VerificationImage` is also used by `VerificationCard` on the inquiry page, without the new prop. Its images are read through the inquiry the page already loaded.
- No other `PageHeader` caller has an unlinked crumb before the last one, so their `aria-current` is unchanged.
- The e2e verification-page assertions (`e2e/tests/ui-console-gaps.spec.ts`) use the reviewer role, which holds every permission involved.

## Final gates

```text
$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks:    12 successful, 12 total        (typecheck)
 Tasks:    12 successful, 12 total        (lint)
All matched files use Prettier code style!
exit 0

$ pnpm test
@openverify/ui           Tests  54 passed (54)
@openverify/core         Tests  399 passed (399)
@openverify/flow-spec    Tests  81 passed (81)
@openverify/config       Tests  44 passed (44)
@openverify/node         Tests  205 passed (205)
@openverify/checks       Tests  455 passed (455)
@openverify/contracts    Tests  1224 passed (1224)
@openverify/db           Tests  573 passed (573)
@openverify/api          Tests  2065 passed (2065)
@openverify/e2e          Tests  63 passed (63)
@openverify/flow         Tests  522 passed (522)
@openverify/dashboard    Tests  1427 passed (1427)
 Tasks:    12 successful, 12 total
exit 0

$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   25 passed (7.4s)
@openverify/e2e:e2e:    39 passed (3.0m)
 Tasks:    9 successful, 9 total
exit 0
```

Not run, because nothing they cover changed:
- `pnpm test:integration`: no change under `packages/db` or `apps/api`.
- `openapi:write`: no route or schema changed.

## Orchestrator: the integration job failed on GitHub after every test passed

CI run 39527933756 (the push of `58c1487`) failed the integration job with "Vitest caught 2 unhandled errors": `error: terminating connection due to administrator command` (FATAL `57P01`), from `packages/db/src/repositories-v2.integration.test.ts`. All 39 db tests had passed.

**Cause.** The test ends its pool and then stops the container. `pool.end()` resolves once the pool has let go of its idle clients, which can be before their connections close. Postgres, stopping, then sends those clients its shutdown notice. node-postgres emits that notice on the pool (the error carries `client`, which pg-pool's idle listener adds), and none of the 11 integration-test pools listened for `error`. Workflow 2D fixed the same race for the API and the worker (`apps/api/src/pool-errors.ts`); the test pools had no listener.

**Fix.** `createIntegrationPool(connectionString, config?)` in `@openverify/db/testing` ignores `57P01` and rethrows any other idle client error. Every integration test builds its pool with it (5 db files, 5 api files).

### RED

`chore(db)` stub `8007269` (a plain `new Pool`), then the test commit `5536309`:

```
$ pnpm --filter @openverify/db typecheck
$ tsc --noEmit
$ (cd packages/db && pnpm exec vitest run src/testing.test.ts --coverage.enabled=false -t createIntegrationPool)
     × ignores the shutdown notice an idle client gets when the test container stops 10ms
AssertionError: expected [Function] to not throw an error but 'Error: terminating connection due to …' was thrown
      Tests  1 failed | 2 passed | 32 skipped (35)
```

### GREEN

`edd6db3` (the listener), then `977e9e3` (the 10 files):

```
$ (cd packages/db && pnpm exec vitest run src/testing.test.ts --coverage.enabled=false)
      Tests  35 passed (35)
$ pnpm turbo run typecheck lint --filter=@openverify/db --filter=@openverify/api
 Tasks:    4 successful, 4 total
$ pnpm test:integration
@openverify/api:test:integration:       Tests  32 passed (32)
@openverify/db:test:integration:       Tests  39 passed (39)
$ pnpm --filter @openverify/db test
      Tests  576 passed (576)
All files          |   99.07 |    92.23 |   99.37 |   99.02 |
```

The race itself is timing-dependent and did not reproduce locally; the unit test pins the behaviour that prevents it.

## Orchestrator: the note editor focus test failed on GitHub

CI run 39605837046 (the push of `4e9cdfa`) failed the dashboard unit job on one test, `note-editor.test.tsx` "returns focus to Edit note once the note is saved (WCAG 2.4.3, Workflow 2E F012)": `expect(element).toHaveFocus()` received `<body>`. It passed locally and on every earlier run.

**Cause.** `NoteEditor` moved focus back to Edit note in a passive `useEffect`. The stubbed save answers after a macrotask, outside any event, so React runs that effect in a later task. `findByRole` can see the new button before the effect runs, and on a loaded runner it did. A user meets the same gap: for a frame after a save, focus rests on the page.

**Fix.** The focus effect is a `useLayoutEffect`, so focus moves in the commit that inserts the control. The other focus moves in the clients (the custom headers editor, the capture sequence) follow clicks, where React flushes passive effects in the same commit, so they keep `useEffect`.

### RED

`4203425`: a mutation observer records where focus is when the Edit note button appears after a save. It runs right after the commit, before passive effects, so the result does not depend on timing:

```
$ (cd apps/dashboard && pnpm exec vitest run src/components/lifecycle/note-editor.test.tsx --coverage.enabled=false)
     × has focus on Edit note when the button appears after a save, never on the page (WCAG 2.4.3) 62ms
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 9 passed (10)
```

Three runs, three failures. Typecheck and lint pass on the RED commit.

### GREEN

`df2ff9c`:

```
$ (cd apps/dashboard && pnpm exec vitest run src/components/lifecycle/note-editor.test.tsx src/components/kept-values.test.tsx src/components/refusal-announcements.test.tsx src/components/lifecycle/inquiry-view.test.tsx --coverage.enabled=false)   # three times
      Tests  32 passed (32)
$ pnpm --filter @openverify/dashboard test
 Test Files  174 passed (174)
      Tests  1656 passed (1656)
All files          |   98.43 |    94.33 |   98.74 |   98.45 |
$ pnpm --filter @openverify/dashboard lint      # pass
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p .)   # pass
```
