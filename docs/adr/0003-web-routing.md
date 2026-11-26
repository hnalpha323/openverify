# ADR 0003: Client-side routing for the end-user flow

- **Status:** accepted, amended in Phase 1 (see the amendment at the end)
- **Date:** 2026-10-20
- **Scope:** `apps/flow` only. `apps/dashboard` routes with the Next.js App Router.

## Context

`apps/flow` is the end-user verification flow. It runs as a hosted page, in an embedded iframe, and inline through the SDK (PLAN §3). People open it on phones, often on mobile data, so every kilobyte of JavaScript delays the first screen.

What the flow needs from a router:

- **Few, coarse routes.** The order of steps comes from the server (the `flow-spec` definition, Phase 1). The URL only names the current step (consent, camera, capture, done) and carries a few query values such as `?lang=`.
- **No route data loading.** Step data comes from the flow API through the flow's own state, not from per-route loaders.
- **Browser history and memory history.** Browser history serves the hosted page, so the back button and resume links work. Memory history serves tests, and later the embedded and inline modes, which must not rewrite the customer page's URL.
- **A permissive license.** Both candidates are MIT.

The task named two candidates: React Router and TanStack Router. React Router has two client modes: declarative (`<BrowserRouter>` and `<Routes>`) and data (`createBrowserRouter` and `<RouterProvider>`, which add loaders, actions and fetchers). The first implementation used data mode.

## Measurement

The test was the same four-route app built three ways, plus a baseline with no router. The app has an index redirect to `/consent`, a navigation with state, a not-found route with a link back, and a layout outlet.

Setup:
- React 19.3.1, bundled with `esbuild --bundle --minify --format=esm`, using esbuild 0.28.2, with `NODE_ENV=production`;
- sizes are after `gzip -9`;
- the packages were installed in a scratch directory, outside the repo.

| Bundle | Version | min | min + gzip | Router cost (gzip) |
|---|---|---|---|---|
| React + ReactDOM only | 19.3.1 | 223,508 B | 69,038 B | n/a |
| React Router, declarative mode | 8.4.0 | 265,868 B | 83,448 B | +14.4 KB |
| TanStack Router | 1.170.45 | 301,640 B | 96,503 B | +27.5 KB |
| React Router, data mode | 8.4.0 | 322,039 B | 101,306 B | +32.3 KB |

In the real `apps/flow` production build, moving from data mode to declarative mode reduced the JavaScript bundle as follows:

| Build | Raw | gzip |
|---|---|---|
| Data mode | 373,550 B | 117,048 B |
| Declarative mode | 318,811 B | 100,470 B (−14%) |

Release history, from the npm registry on 2026-10-20:
- React Router majors shipped 6.0.0 on 2021-11-03, 7.0.0 on 2024-11-22 and 8.0.0 on 2026-06-17.
- TanStack Router 1.0.0 shipped on 2023-12-23. About 950 1.x versions had been published since then.

## Decision

The flow uses **React Router 8 in declarative mode** (`react-router` 8.4.0):
- `<BrowserRouter>` for the hosted page;
- `<MemoryRouter>` in tests, and later for the embedded and inline modes;
- `<Routes>`, `<Route>`, `<Navigate>`, `<Link>`, `useNavigate` and `useLocation`.

The route tree is the `FlowRoutes` component in `apps/flow/src/routes.tsx`. `App` wraps it in providers and `BrowserRouter`.

Reasons:

1. **It is the smallest option.** It costs 14.4 KB gzipped, against 27.5 KB for TanStack Router and 32.3 KB for React Router data mode, with the same behaviour for this flow.
2. **It fits the problem.** TanStack Router's main strengths pay off in apps with many URL-addressable screens:
   - type-checked paths and links;
   - search-parameter schemas;
   - a loader cache.

   The flow has four routes and server-driven steps. Its few query values are parsed once at start-up (`detectLanguage` already does this for `?lang=`, and Phase 1 adds a zod parse for the rest).
3. **It has an upgrade path inside the same package.** If the flow later needs route loaders, per-route error elements or lazy route modules, data mode uses the same `react-router` package. The tree in `FlowRoutes` can move to `createBrowserRouter` without a new dependency.
4. **The API is stable.** `BrowserRouter`, `Routes`, `Route`, `Navigate`, `Link` and `useNavigate` work the same way in v6, v7 and v8. That has been the least disrupted part of React Router across its major versions.

## Consequences

- **Paths are not type-checked.** They are constants in `routes.tsx` (`CONSENT_PATH`, `CAMERA_PATH`), and `src/app.test.tsx` covers every route, including redirects and the not-found page.
- **Search parameters are untyped strings.** Each one is parsed once, at the entry point.
- **No per-route `errorElement`.** When steps start calling the API (Phase 1), a React error boundary goes around `FlowRoutes`.
- **The consent guard is client-side only.** `/camera` requires `consentGiven` in the navigation state. The server records consent and enforces step order.
- **Expect a React Router major version every few years.** Staying on the declarative API keeps those upgrades small.

## Alternatives considered

- **TanStack Router 1.170.45 (MIT).**
  - Strengths: typed routes, links and search parameters, built-in search validation, a loader cache, and devtools.
  - Not chosen: it costs 13 KB gzipped more than the chosen option, for features this flow does not use yet. Its release cadence is also very fast, which means frequent lockfile churn.
  - Revisit if the flow grows many URL-addressable screens with typed parameters.
- **React Router data mode.** This was the first implementation. It costs 18 KB gzipped more than declarative mode, and the flow used none of its extra features.
- **No router, only a step state machine.** This is the smallest option, but it loses the back button, deep links for resuming a step, and a real not-found page. Rebuilding history handling by hand is not worth saving about 14 KB.

## Amendment (Phase 1): one server-driven route

The router choice stands. The route tree changed when the flow started rendering the server's `flow-spec`.

- **What changed.** The flow has a single index route (`/`) and a not-found route. `FlowRenderer` shows the step that `GET /api/v1/flow/session` reports as current. The `/consent` and `/camera` routes, `CONSENT_PATH`, `CAMERA_PATH` and the client-side consent guard are gone.
- **Why.** Step order belongs to the server (contract C3 in `docs/plans/phase-1.plan.md`). If the URL named the step, a reload, the back button or a stale link could show a step the server has already left, and the server would answer `409`. With one route, a reload always lands on the step the user is really on.
- **Consequences.**
  - The session token reaches the flow in the URL fragment (`#inquiry-id=…&session-token=…`), not in a path or query, so it is never sent to the server that hosts the flow.
  - Consent is enforced by the API: uploads before consent answer `409`.
  - The back button leaves the flow instead of stepping back through it. Going back to an earlier step is a server decision (Phase 2 state machines).
  - `?lang=` is still parsed once at start-up.
- **Unchanged.** Declarative mode, `BrowserRouter` for the hosted page and `MemoryRouter` in tests and in the later embedded and inline modes.
