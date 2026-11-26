# TDD evidence: Phase 0, web-apps

Slice owner: web-apps agent. Date: 2026-10-20.

## Plan task

PLAN §6, Phase 0, step 4 (the web half of the scaffold). It builds on the foundation slice (`docs/tdd/phase0-ts-foundation.tdd.md`), and its work feeds Phase 1, which needs consent → capture in the flow, and login → inquiry list in the dashboard. The slice covers:

1. `packages/ui`:
   - a shared Tailwind CSS v4 entry;
   - accessible primitives: Button, Field/Input, Checkbox, Card and Alert.
2. `apps/flow`:
   - Vite + React 19 end-user shell;
   - React Router, with the choice recorded in `docs/adr/0003-web-routing.md`;
   - i18next with en and es, and an RTL-ready layout;
   - a ConsentScreen;
   - a CameraPermission helper;
   - a Playwright smoke test.
3. `apps/dashboard`:
   - Next.js App Router + Tailwind v4;
   - a login shell with client-side validation;
   - an inquiries list with a typed table.

Dependencies added, with versions checked on npm on 2026-10-20 and licenses from `npm view`:

| Package | Version | License | Note |
|---|---|---|---|
| tailwindcss, @tailwindcss/vite, @tailwindcss/postcss | 4.3.3 | MIT | |
| postcss | 8.5.31 | MIT | |
| react-router | 8.4.0 | MIT | 8.5.0 was under 24 h old; pnpm's release-age policy resolved `^8.4.0` to 8.4.0 |
| i18next | 26.5.2 | MIT | 26.5.3 was under 24 h old |
| react-i18next | 17.1.0 | MIT | |
| @testing-library/react / dom / user-event / jest-dom | 16.3.3 / 10.4.2 / 14.6.8 / 7.0.1 | MIT | |
| jsdom | 29.1.1 | MIT | 30.x requires Node `^22.22.2`; this machine runs Node 22.22.1 |
| @playwright/test | 1.64.1 | Apache-2.0 | Chromium installed with `pnpm exec playwright install chromium` (no `--with-deps`) |
| @openverify/core | workspace | Apache-2.0 | The dashboard takes `InquiryStatus` from it |

## Tests (written first)

### `packages/ui`

The primitives were stubbed to their public API, with bodies returning `null`. That way the RED run fails on behaviour, not on missing modules.

**Button** (`button.test.tsx`):
- the accessible name comes from its text;
- it defaults to `type="button"`;
- it can be a submit button;
- `onClick` fires;
- `disabled` blocks presses;
- `data-variant` is set;
- caller classes are kept;
- the ref is forwarded.

**Field/Input** (`field.test.tsx`):
- `getByLabelText` finds the input;
- several fields get unique ids;
- the description becomes the accessible description;
- an error sets `aria-invalid` and is appended to the description;
- `required` is passed through, with an `aria-hidden` marker;
- a disabled input cannot be typed into;
- a standalone Input keeps its caller-supplied id and `aria-describedby`.

**Checkbox** (`checkbox.test.tsx`):
- it is named by its label;
- clicking the label toggles it;
- `required` and a description work;
- a disabled checkbox cannot be toggled.

**Card** (`card.test.tsx`):
- with a title, it is a `region` named by its heading;
- the heading level is configurable;
- with no title, it is a plain container.

**Alert** (`alert.test.tsx`):
- `error` and `warning` render `role="alert"`;
- `info` and `success` render `role="status"`;
- the optional title is rendered.

**Shared CSS** (`styles.test.ts`, run in the node environment):
- It compiles `src/styles.css` with `@tailwindcss/postcss` from an empty temporary "app" directory.
- It checks that the Tailwind layers are present.
- It checks that each `--color-*` design token is defined.
- It checks that component utilities such as `.bg-primary` and `.focus-visible\:outline-focus` are generated.
- It checks that a class appearing only in a test file is not generated.

**Other files:**
- `cx.test.ts` covers the class-name joiner.
- `index.test.ts` checks the exports, resolved through `@openverify/ui` to source.

### `apps/flow`

The locales (en, es) are real content. Everything else was stubbed.

**`lib/camera-permission.test.ts`:**
- It checks that `requestCamera` returns `{ ok: true, stream }`.
- It checks the default constraints: front camera, no audio.
- It checks that caller constraints are passed through.
- It checks the typed errors:
  - `NotAllowedError` → `permission-denied`;
  - `NotFoundError` → `no-camera`;
  - `OverconstrainedError` → `constraints-not-satisfied`, with the constraint name;
  - legacy Chrome names, `SecurityError` and `NotReadableError` map as well;
  - unknown errors → `unknown`, including an object named `constructor`.
- It checks `unsupported` versus `insecure-context` when there are no media devices.
- It checks that `stopStream` stops every track.

**`i18n/languages.test.ts`:**
- `detectLanguage` matches base languages, normalises case and `_`, skips empty candidates, and falls back to English.

**`i18n/create-i18n.test.ts`:**
- the instance is ready synchronously;
- es translations load;
- instances are independent;
- en and es have the same keys;
- no message is empty;
- every camera error code has a message.

**`i18n/document-language.test.ts`:**
- `<html lang dir>` follows the language, including `dir="rtl"` for Arabic;
- unsubscribing stops the sync.

**`components/consent-screen.test.tsx`:**
- the page has an h1 inside a named region;
- the checkbox is required and starts unchecked;
- Continue stays disabled until the box is checked;
- checking the box enables Continue and calls `onContinue`;
- unchecking disables Continue again;
- the screen is translated (es).

**`components/camera-check.test.tsx`:**
- a successful check shows a ready status and releases the stream;
- the button is disabled while the request is pending, then a retry is possible;
- each error code shows its translated message;
- by default it uses the browser camera, which jsdom does not provide.

**`app.test.tsx`:**
- `/` redirects to `/consent`;
- giving consent leads to `/camera`;
- `/camera` without consent goes back to `/consent`;
- unknown paths show a not-found page with a link back;
- the banner shows the product name;
- the language switcher works.

**`e2e/consent.spec.ts`** (Playwright, against `vite build` + `vite preview`):
- `/` redirects to `/consent`, with `lang="en"` and `dir="ltr"`;
- Continue is disabled until the box is checked, then navigates to `/camera`.

### `apps/dashboard`

**`lib/login-validation.test.ts`:**
- both fields are required;
- a whitespace-only email counts as missing;
- six malformed emails are rejected;
- three valid emails pass, including one with surrounding spaces;
- a password with surrounding spaces is accepted.

**`components/login-form.test.tsx`:**
- the fields have labels, the right types and `autocomplete` hints;
- no errors show before the first submit;
- a submit with missing fields shows the errors as accessible descriptions and focuses the first invalid field;
- a malformed email is rejected;
- the password gets focus when only the password is missing;
- an error clears as soon as the field is corrected;
- the email is submitted trimmed and the password as typed;
- with no handler, a "not available yet" status is shown.

**`components/data-table.test.tsx`:**
- the caption names the table;
- the column headers render;
- there is one row per item, with a row header;
- the empty message spans every column;
- a hidden caption still names the table;
- the scroll region is named and focusable;
- a `@ts-expect-error` line makes typecheck fail if columns stop being typed against the row type.

**`components/inquiries-table.test.tsx`** (synthetic `inq_synthetic_*` fixtures):
- the table has the expected columns;
- the inquiry ID is the row header;
- a missing reference shows "None";
- times show in UTC inside `<time dateTime>`;
- an unparseable date is shown as given;
- every `INQUIRY_STATUSES` value from `@openverify/core` has a label;
- an empty list shows the empty state.

**Page tests** (`app/page.test.tsx`, `app/login/page.test.tsx`, `app/inquiries/page.test.tsx`):
- the home page has links to the console sections;
- the layout renders `<html lang="en">` and a title template;
- the login and inquiries pages render, with their metadata titles.

## RED

### `packages/ui`

Command (in `packages/ui`):

```
pnpm exec vitest run --coverage.enabled=false
```

First run:

```
 FAIL  src/alert.test.tsx > Alert > uses the error tone with the alert live-region role
TestingLibraryElementError: Unable to find an accessible element with the role "alert"
 FAIL  src/button.test.tsx > Button > exposes its text as the accessible name of a button
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Continue"
 FAIL  src/cx.test.ts > cx > joins the truthy class names with single spaces
AssertionError: expected '' to be 'a b c' // Object.is equality
 FAIL  src/styles.test.ts > @openverify/ui/styles.css > defines the --color-primary design token
AssertionError: expected '/*! tailwindcss v4.3.3 | MIT License …' to match /--color-primary:\s*oklch\(/
 FAIL  src/index.test.ts > @openverify/ui entry point > exports the primitives, resolving the package name to its TypeScript source
AssertionError: expected { Alert: [Function Alert], …(6), …(1) } to deeply equal { Alert: [Function Alert], …(6) }

Compared values have no visual difference.
 Test Files  8 failed (8)
      Tests  47 failed | 3 passed (50)
```

The `index.test.ts` failure was a defect in the test, not the intended RED. Vitest's module namespace has an enumerable `Symbol.toStringTag`, so `toEqual` on it can never pass. A probe showed the extra key (`"Symbol(Symbol.toStringTag)"`). The test now compares the sorted string keys plus `toMatchObject`. The re-run:

```
 Test Files  7 failed | 1 passed (8)
      Tests  46 failed | 4 passed (50)
```

All 46 failures are behavioural. The 4 tests that pass are guards the stub satisfies:
- the entry wiring;
- `cx` with nothing truthy;
- the Tailwind layer order;
- "does not scan test files", which only becomes meaningful once `@source` exists (see the mutation checks below).

`tsc --noEmit` passed against the stubs. Commit: `942dec0 test(ui): ...`.

### `apps/flow`

Command (in `apps/flow`): `pnpm exec vitest run --coverage.enabled=false`

```
 FAIL  src/app.test.tsx > App > opens on the consent step
Error: You must provide a non-empty routes array to createRouter
 FAIL  src/components/consent-screen.test.tsx > ConsentScreen > keeps Continue disabled until consent is given
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Continue"
 FAIL  src/i18n/create-i18n.test.ts > createI18n > translates to Spanish
AssertionError: expected undefined to be 'Continuar' // Object.is equality
 FAIL  src/i18n/document-language.test.ts > syncDocumentLanguage > switches the layout to right-to-left for RTL languages
Error: expect(element).toHaveAttribute("lang", "ar") // element.getAttribute("lang") === "ar"
 FAIL  src/lib/camera-permission.test.ts > requestCamera > maps a denied permission to a typed error and keeps the cause
AssertionError: expected { ok: false, error: { …(2) } } to deeply equal { ok: false, error: { …(2) } }
 Test Files  7 failed (7)
      Tests  55 failed | 18 passed (73)
```

The 18 tests that pass are guards the stubs already satisfy:
- the rejection cases of `isSupportedLanguage`;
- the English fallbacks;
- locale parity;
- the error-code list;
- the `unknown` mappings.

E2E, with command `CI= pnpm e2e`. The production bundle built and served, but the stub never redirected:

```
  ✘  1 [chromium] › e2e/consent.spec.ts:3:1 › loads the consent screen and continues only after consent (5.2s)
    Error: expect(page).toHaveURL(expected) failed
    Expected pattern: /\/consent$/
    Received string:  "http://127.0.0.1:4173/"
```

Commit: `86fa58f test(flow): ...`.

### `apps/dashboard`

Command (in `apps/dashboard`): `pnpm exec vitest run --coverage.enabled=false`

```
 FAIL  src/app/page.test.tsx > root layout > titles every page after the console
AssertionError: expected 'OpenVerify Dashboard' to deeply equal { …(2) }
 FAIL  src/components/data-table.test.tsx > DataTable > is a table named by its caption
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Fruit"
 FAIL  src/components/inquiries-table.test.tsx > InquiriesTable > lists inquiries in a named table with the expected columns
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Inquiries"
 FAIL  src/components/login-form.test.tsx > LoginForm > requires both fields, announces why and focuses the first invalid field
TestingLibraryElementError: Unable to find a label with the text of: Email
 FAIL  src/lib/login-validation.test.ts > validateLogin > requires both fields
AssertionError: expected {} to deeply equal { email: 'required', …(1) }
 Test Files  7 failed (7)
      Tests  43 failed | 6 passed (49)
```

The 6 tests that pass are guards the stubs already satisfy:
- valid inputs return `{}`;
- the `@ts-expect-error` type test;
- the layout's `<html lang="en">` wrapper.

Lint on the tests caught two problems:
- a destructured row needed a non-null-safe helper;
- `no-unsafe-return` fired in the type test.

Both were fixed before the commit: `79760d2 test(dashboard): ...`.

## GREEN

### `packages/ui`

The first implementation run had one failure:

```
 FAIL  src/styles.test.ts > @openverify/ui/styles.css > generates .focus-visible\:outline-focus for the shared components without the app scanning them
AssertionError: expected '/*! tailwindcss v4.3.3 | MIT License …' to contain '.focus-visible\:outline-focus {'
```

The utility was generated. Compiling the CSS directly showed `.focus-visible\:outline-focus:focus-visible {`, because variant selectors carry the pseudo-class. The assertion was wrong, so it now matches the selector followed by whitespace, `:` or `{`. This also stops `.bg-primary` from matching `.bg-primary-hover`. Then `pnpm test` passed:

```
 Test Files  8 passed (8)
      Tests  50 passed (50)
```

**Mutation checks.** `styles.css` was edited temporarily and restored afterwards, verified with `diff`.

Removing `@source not './**/*.test.{ts,tsx}'`:

```
     × does not scan test files for class names 19ms
AssertionError: expected '/*! tailwindcss v4.3.3 | MIT License …' not to contain '.tracking-\[0\.123em\]'
      Tests  1 failed | 17 passed (18)
```

Pointing `@source` at a missing folder (`'./nowhere'`):

```
     × generates .bg-primary for the shared components without the app scanning them 7ms
     ...
      Tests  6 failed | 12 passed (18)
```

`tsc -p tsconfig.build.json` keeps the directive at the top of `dist/field.js` (`'use client';`). Commit: `1202a43 feat(ui): ...`.

### `apps/flow`

The first implementation run caught a bug in the code:

```
 FAIL  src/lib/camera-permission.test.ts > requestCamera > falls back to the browser media devices, which jsdom does not provide
-     "code": "unsupported",
+     "code": "insecure-context",
```

jsdom leaves `globalThis.isSecureContext` undefined, and the default treated that as insecure. Now only an explicit `false` reports `insecure-context`.

A further test was added for submitting the form without consent (`fireEvent.submit`). It covers the defensive guard that a disabled default button cannot reach.

`pnpm e2e`:

```
  ✓  1 [chromium] › e2e/consent.spec.ts:3:1 › loads the consent screen and continues only after consent (346ms)
  1 passed (3.1s)
```

Commit: `81583aa feat(flow): ...`.

**Refactor** (`347888e refactor(flow): ...`). Measurements for ADR 0003 showed that React Router's data mode costs 18 KB gzipped more than declarative mode, and the flow uses none of what data mode adds. Routing moved to `<BrowserRouter>`/`<MemoryRouter>` + `<Routes>`.
- `routes.tsx` now exports a `FlowRoutes` component instead of a route array, so the routing tests changed their harness: `MemoryRouter`, plus an `<output>` that shows the current path, in place of `router.state`.
- The scenarios are unchanged, and one test of `App` on jsdom browser history was added.
- The production JS went from 117,048 to 100,470 bytes gzipped.
- The tests (75) and the e2e smoke test stayed green.

### `apps/dashboard`

Before the tests were written, a probe build (`next build` with `packages/ui/dist` moved away) showed three things:
- `transpilePackages` plus a Turbopack `resolveAlias` compile `@openverify/ui` from source;
- a Server Component page can render `Card` together with the client `Field`;
- the ui tokens and utilities end up in the CSS.

The probe files were then restored. After the implementation, the first run was green:

```
 Test Files  7 passed (7)
      Tests  49 passed (49)
No files with missing coverage.
8 files fully covered.
```

Commit: `9c2d0e7 feat(dashboard): ...`.

### Final verification

Each command was run per package. All exited 0:
- `pnpm --filter <pkg> lint|typecheck|test|build` for ui, flow and dashboard;
- `pnpm --filter @openverify/config test` (the workspace-conventions contract over every manifest: `Tests  33 passed (33)`);
- `pnpm e2e` in `apps/flow`;
- `prettier --check apps/flow apps/dashboard packages/ui`.

`next build`:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /inquiries
└ ○ /login
```

`vite build`:

```
dist/assets/index-qaAT5B0_.css   12.97 kB │ gzip:   3.60 kB
dist/assets/index-DirRUify.js   318.81 kB │ gzip: 101.65 kB
```

Checks on the build output:
- The flow CSS contains utilities from ui (`.bg-primary`, `.accent-primary`, `.border-s-4`) and from the app (`.ps-5`, `.min-h-dvh`). Logical properties compile to `padding-inline-start`.
- The dashboard's prerendered HTML has the expected titles: `Sign in · OpenVerify Dashboard` and `Inquiries · OpenVerify Dashboard`.
- The inquiries caption is `class="sr-only"`.

## Coverage

From `vitest run --coverage` (v8). Each package passes the 80% gate.

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| packages/ui | 100% (31/31) | 97.72% (43/44) | 100% (9/9) | 100% (31/31) |
| apps/flow | 100% (85/85) | 98% (49/50) | 100% (30/30) | 100% (85/85) |
| apps/dashboard | 100% (63/63) | 100% (31/31) | 100% (24/24) | 100% (61/61) |

Uncovered branches and exclusions:
- **ui** `field.tsx`: the `?? false` fallback in `Input` is uncovered.
- **flow** `language-select.tsx`: the `?? DEFAULT_LANGUAGE` fallback is uncovered. `resolvedLanguage` is always set once the instance is initialised.
- **flow** `src/main.tsx` (DOM bootstrap) is excluded from unit coverage, as in the foundation slice. The e2e smoke test exercises it.
- **dashboard**: no exclusions. Route files (`layout`, `page`) are covered by tests.

## Licenses of the resolved trees

`pnpm --filter <pkg> licenses list --json` for ui, flow and dashboard, including dev dependencies, found:

- **Within the allowed set:** MIT (148 packages), Apache-2.0 (12), ISC (8), BSD-2/3-Clause (4), CC0-1.0 (1), CC-BY-4.0 (`caniuse-lite`, data; CLAUDE.md allows CC-BY), and MIT-0/0BSD (public-domain-equivalent).
- **Needing a policy decision.** None is non-commercial or BSL:
  - **MPL-2.0 `lightningcss`.** It comes from Tailwind v4 (`@tailwindcss/node`) and from Vite 8, which was already in the workspace. It is a build tool only, unmodified, and not shipped in bundles.
  - **LGPL-3.0-or-later `@img/sharp-libvips-linux-x64`.** It comes from `next@16.4.2` → `sharp`, an optional dependency that was in the workspace before this slice. It is used only by `next/image` optimisation, which the dashboard does not use.
  - **BlueOak-1.0.0 `lru-cache@11`** (permissive). It comes from jsdom and is a dev dependency only.
