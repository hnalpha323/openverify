# Phase 9, Workflow 9A Stage 3: flow-server-embed

Evidence for `flow-server-embed` (family F; plan C156.2-C156.3, C157, C158.1, C158.3-C158.5, C159).
Every command below was run after `source scripts/env.sh`; outputs are abbreviated, exit codes are
read from the command itself.

Started after foundation-9a's `CHECKPOINT (F) DONE at 4a6191114b023b0acfcd1f1ab34effb2a7868e5c` and
`CHECKPOINT (A11Y) DONE at e0923cf1909572d24751e009d2a48c82012cf007` (both in `git log`), on top of
flow-spec-logic's finished work. The preview's rendering slice waits for flow-renderer's
`CHECKPOINT screens DONE` (rule 17).

## Slice 1: the embed policy and the redirect rules on the API (C157.2, C158.2-C158.5)

Placeholders first (`449e9d9e`): `allowedEmbedOrigins`, `redirectUriRefusal`, `completionRedirectUrl`
and the types `RedirectRules`, `RedirectRefusal`, each throwing `NotImplementedError`, so the RED tests
typecheck.

### RED

```
$ cd apps/api && pnpm exec vitest run src/services/embed-origins.test.ts --coverage.enabled=false   # exit 1
     × takes the environment's list when the version names none
     ... (12 pure cases: NotImplementedError: ... is not built yet (flow-server-embed).)
       × answers the inquiry's template, environment and the version's narrowed origins
         NotImplementedError: The embed policy lookup is not built yet (flow-server-embed).
       × takes a URI on the embed origins while no redirect origins are set ...
         expected 422 to be 201 (the stub refuses every redirect-uri)
      Tests  21 failed | 1 passed (22)
$ pnpm exec vitest run src/routes/internal/embed-policies.test.ts --coverage.enabled=false   # exit 1
     × answers the inquiry's policy under the frozen schema   (expected 501 to be 200)
     × answers the same 404 for an unknown inquiry and for an inactive template   (expected [501, 501] to deeply equal [404, 404])
      Tests  2 failed (2)
```

### GREEN

`apps/api/src/services/embed-origins.ts`: `embedPolicyFor` (one join of the inquiry, its template, the
pinned version and the environment; `null` unless the template is `active`), `allowedEmbedOrigins`
(the environment's list held to the grammar for its kind; the version's list narrowed to it, each
once, at most 50), `redirectUriRefusal` (an `http(s)` origin through `matchesOriginPattern` against
entries valid for the kind, so a plain entry matches exactly and a wildcard on a dot boundary; any
other scheme only when listed and not denylisted; userinfo, a malformed or over-2,048 URI refused),
`completionRedirectUrl` (replaces any `inquiry-id` or `status` the URI carried), `checkInquiryRedirectUri`
(422 `redirect_uri_not_allowed` at `/data/attributes/redirect-uri`, never echoing the URI) and
`redirectUrlFor` (the inquiry's URI, else the version's, re-checked against the current lists).

Two cases of foundation-9a's `phase9a-embed-plumbing.test.ts` asserted the stubs (`501`, and
`embedPolicyFor` rejecting `NotImplementedError`); they now assert the built answers (404 for the
unknown synthetic inquiry, `null`), as the plan's builders replace their stub tests.

```
$ pnpm exec vitest run src/services/embed-origins.test.ts src/routes/internal/embed-policies.test.ts \
    src/phase9a-embed-plumbing.test.ts src/routes/dashboard/settings.test.ts --coverage.enabled=false   # exit 0
 Test Files  4 passed (4)
      Tests  57 passed (57)
```

## Slice 2: the flow server (C157.1-C157.3)

Placeholder first: `apps/flow/server.ts` keeps `--help` and exports, each throwing "not built",
`FLOW_SERVER_LIMITS`, `PREVIEW_CONSOLE_ORIGIN_META`, `FlowEntry`, `AccessLogLine`, `FlowServerConfig`,
`FlowServerConfigError`, `parseFlowServerArgs`, `readFlowServerConfig`, `frameAncestorsDirective`,
`hostedHeaders`, `embedHeaders`, `previewHeaders`, `isInquiryId`, `clientAddress`,
`TokenBucketLimiter`, `ExpiringCache`, `createEmbedPolicyLookup`, `createFlowRequestListener` and
`startFlowServer`.

### RED

Tests in `apps/flow/src/server/` (Vitest only collects `src/**`; each file runs in the `node`
environment): `server-headers.test.ts` (each entry's headers against `FLOW_RESPONSE_HEADERS`, a test
per changed header; `frameAncestorsDirective` refusing hostile values; `isInquiryId` held to the
contracts' `isId('inq', ...)`; `clientAddress` with trusted hops; arguments; configuration),
`server-lookup.test.ts` (token bucket, expiring cache, the lookup: token, encoding, 60 s cache,
negative cache, malicious and mismatched answers, size cap, failures not cached, one request for
concurrent lookups, ids outside the grammar never asked) and `server-serving.test.ts` (a real socket
over a synthetic `dist/`: entries, traversal, extensions, caching, HEAD and 405, the 404 for a
malformed id with no lookup, the per-client 429 that leaves another client's header alone, the access
log without path, id or address).

```
$ cd apps/flow && pnpm exec vitest run src/server --coverage.enabled=false   # exit 1
 Error: createEmbedPolicyLookup(http://api.internal:3000/base) is not built yet (flow-server-embed).  (x8)
 Error: take(203.0.113.9) is not built yet ...; set(a, string) ...; startFlowServer(127.0.0.1) ...;
 hostedHeaders(https://api.example.com) is not built yet ... (collection of server-headers.test.ts)
 Test Files  3 failed (3)
      Tests  12 failed | 1 passed | 11 skipped (24)
```

### GREEN

`apps/flow/server.ts` built behind the placeholders. One case of the RED file changed while going
green: `/embed/..%2f..%2fadmin` is refused with the other traversals (400, `frame-ancestors 'none'`,
no lookup) before the entry is chosen, so the test now expects 400 for it and 404 for the malformed
ids proper. `licenses/` files (extensionless `LICENSE`) are served as text, every other file only by
its extension.

```
$ cd apps/flow && pnpm exec vitest run src/server src/phase9a-plumbing.test.ts --coverage.enabled=false   # exit 0
 Test Files  4 passed (4)
      Tests  52 passed (52)
$ VITE_OPENVERIFY_API_URL=http://127.0.0.1:3000 OPENVERIFY_DASHBOARD_PUBLIC_URL=http://localhost:3001 \
    node --conditions=@openverify/source server.ts --port 41731   # against the real dist/
OPENVERIFY_FLOW_SERVER_TOKEN is not set: every /embed/ page answers frame-ancestors none.
OpenVerify flow server listening on http://127.0.0.1:41731
{"entry":"hosted","status":200}
{"entry":"embed","status":200}
$ curl -sI http://127.0.0.1:41731/  ->  Content-Security-Policy: default-src 'self'; ...; frame-ancestors 'none'
                                        X-Frame-Options: DENY / Cache-Control: no-store
```

## Slice 3: the infra test (C157.3)

`infra/tests/flow-server.test.sh` starts `node --conditions=@openverify/source apps/flow/server.ts`
over a synthetic `dist/` against a local stub of the internal route (token checked, a known id, a
hostile answer, 404 otherwise; every request it gets is logged), and asserts every entry's headers
on the running server: hosted (the exact flow policy with `frame-ancestors 'none'`, DENY,
Permissions-Policy, Referrer-Policy, nosniff, no-store), preview (the exact preview policy with the
console origin, the denying Permissions-Policy, no X-Frame-Options, the console-origin `<meta>`),
embed (the stub's origins; `'none'` for unknown, hostile and with the API stopped; the malformed id
404 with no lookup; one lookup per inquiry, cached; 60 loads of one client at once then 429, another
client's header unchanged), `dist/` (immutable hashed asset, nosniff, traversal 400, unknown
extension 404) and the access log. `FLOW_SERVER_URL=<url>` checks a running server instead
(integration-9a's container).

The behaviour existed (slice 2), so the evidence that the script discriminates is a run against a
server without computed headers (`python3 -m http.server` over a one-file directory):

```
$ bash infra/tests/flow-server.test.sh                                         # exit 0
# 38 passed, 0 failed
$ FLOW_SERVER_URL=http://127.0.0.1:41799 bash infra/tests/flow-server.test.sh  # a plain static server: exit 1
# 5 passed, 17 failed
```

The first full run failed one check of the script itself: 61 sequential `curl` processes take over a
second, so the bucket's one-a-second refill let the 61st through. The burst now goes through one
`curl` process (70 URLs, each with its own `-o /dev/null`), which takes milliseconds.

## Slice 4: the embed client `@openverify/js` (C159)

Placeholders first in `packages/sdk-js/src/`: `messages.ts` (`EMBED_PROTOCOL_VERSION`, `FlowMessage`,
`readFlowMessage`), `frame-url.ts` (`FrameUrlInput`, `frameUrlOf`), `embed.ts` (`embed`, `EmbedOptions`,
`EmbedHandle`, `EmbedErrorCode`, `EmbedEventName`), all re-exported from `index.ts`; each function
throws until built.

### RED

`messages.test.ts` holds the hand-written guard to `flowToParentMessageSchema` over 44 vectors;
`frame-url.test.ts` (fragment-only credentials read back by the contracts' `parseFlowLinkFragment`,
`language` and `style-variant` alone in the query, http for loopback only, refusals naming the option
and never a token); `embed.test.ts` (jsdom: the fixed sandbox tokens, `allow="camera"`, no referrer,
title, height and the 768 px width cap; `invalid_config` without mounting; the hello to the flow
origin on load; each callback; messages from another origin, window or shape ignored; the events
allowlist; resize only without a fixed height; destroy). The placeholder test `index.test.ts` is
replaced by these. `size.test.ts` builds both formats through the package's `vite.config.ts` into a
fresh `/tmp` directory and gzips them (it passes on the placeholder and holds the budget from here).

```
$ cd packages/sdk-js && pnpm exec vitest run --coverage.enabled=false   # exit 1
      8 Error: embed(https://flow.example.com) is not built yet (flow-server-embed).
      5 Error: frameUrlOf(...) is not built yet ...; 2 Error: readFlowMessage(object) is not built yet ...
 Test Files  3 failed | 1 passed (4)
      Tests  17 failed | 2 passed (19)
```

### GREEN

`messages.ts` (the guard: exact keys per type, the enumerations of the schema, `step-type` at most 40,
`resize` an integer 0-100,000, an `inq_` id), `frame-url.ts` (https, or http for `localhost`,
`127.0.0.1`, `[::1]`; no query, fragment or credentials on `flowUrl`; exactly one token of its kind;
a refusal names the option, never a value) and `embed.ts`. While going green one refusal message
named the token prefixes (`ovs_...`), which the test's "never a token" check caught; it now says
"a token of its kind".

```
$ cd packages/sdk-js && pnpm exec vitest run   # exit 0 (with the 80% gate)
 Test Files  4 passed (4)
      Tests  19 passed (19)
Statements   : 100% ( 117/117 )  Branches : 100% ( 121/121 )
$ pnpm exec vite build --outDir <fresh /tmp dir>   # size, no lock needed (load 17.83 20.14 20.24)
index.js raw=5967 gzip=2470
openverify.iife.js raw=4949 gzip=2268
```

## Slice 5: the embed bridge and the embed entry (C158.3, C159.4)

Placeholders first: `src/embed/bridge.ts` widens `EmbedBridgeHost` (optional `ancestorOrigins`,
`document`; `main.tsx` passes `window`, which has both) and adds `EmbedSessionReport`,
`EmbedBridgeErrorCode`, `embedSessionReportOf` (throws), `reportEmbedSession` and `reportEmbedError`
(do nothing); `src/embed/embed-entry.tsx` adds `FlowClientObserver` and `observeFlowClient` (throws).

### RED

`src/embed/bridge.test.ts` (a fake host on an `EventTarget`, messages delivered with the browser's
`origin` and `source`; every posted message checked against `flowToParentMessageSchema` and its exact
target origin): the hello answered with `ready` and `event start` only once the session names the
origin; wildcard entries on a dot boundary; another origin, window, shape or a message over 1 MiB
ignored; the path's inquiry not the session's (C158.3); `ancestorOrigins` contradicting refused,
matching, `"null"` or empty accepted; nothing outside `/embed/`; nothing after dispose; step changes
by type only (no step id in any message); the end once; errors by public code; a repeated hello
answered again; nothing before the handshake. `src/embed/embed-entry.test.tsx`: the flow rendered and
its session reported for a matching path; the link error (`mismatch`) for another inquiry; the
not-found page for a malformed id and for a flow element it cannot observe; a 401 `session_expired`
reported as `unauthenticated`; a one-time link's `connect` observed; `observeFlowClient` passing
every call through.

```
$ cd apps/flow && pnpm exec vitest run src/embed --coverage.enabled=false   # exit 1
      7 AssertionError: expected [] to deeply equal [...]   (nothing posted: the bridge does nothing yet)
      2 Error: embedSessionReportOf(inq_...) is not built yet (flow-server-embed).
      1 Error: observeFlowClient(16, object) is not built yet.
      4 TestingLibraryElementError: Unable to find ... (the entry renders its fallback)
 Test Files  2 failed (2)
      Tests  14 failed | 7 passed (21)
```

One more RED case before the implementation: the document's height posted as `resize` once connected
(a stubbed `ResizeObserver`, which jsdom lacks; repeated heights not posted again, the height rounded
up). `pnpm exec vitest run src/embed/bridge.test.ts` (exit 1): `× tells the document's height as it
changes, once connected`, 10 failed | 5 passed (15).

### GREEN

`src/embed/bridge.ts` (one bridge per page, mounted from `main.tsx`; posts only after the handshake,
each message parsed by `flowToParentMessageSchema` first; an origin that leaves the session's list
stops the talking) and `src/embed/embed-entry.tsx` (`observeFlowClient` wraps every method of the
client, so methods `flow-renderer` adds are observed too; the observed start is memoised on the app's
start, so the flow's client is stable). One case of my RED file compared the fake's session with a
fixture that lacks the fake's extra members; it now compares with what the fake answered.
Foundation-9a's `src/phase9a-slots.test.tsx` asserted the stub ("not-found until it is built"); that
case now asserts the built entry runs the flow for a well-formed id, and a new case keeps the
not-found page for a malformed one.

```
$ cd apps/flow && pnpm exec vitest run src/phase9a-slots.test.tsx src/embed --coverage.enabled=false   # exit 0
      Tests  25 passed (25)
```

## Slice 6: the preview entry (C156.2, C156.3)

flow-renderer's `CHECKPOINT screens DONE at 8f11957197c147a7e5b2d778b4346649429a9827` is in `git log`
(read before this slice), so the protocol, the assets and the rendering are built together, rendering
through its `StaticStep` and `isPreviewable`.

Placeholders first in `src/preview/`: `console-origin.ts` (`PREVIEW_CONSOLE_ORIGIN_META`,
`consoleOriginOf`), `protocol.ts` (`PreviewMessageEvent`, `readConsoleMessage`), `assets.ts`
(`PreviewAssetType`, `PREVIEW_FONT_FAMILY`, `sniffAsset`, `PreviewAssetDeps`, `LoadedPreviewAssets`,
`loadPreviewAssets`) and `preview-app.tsx` (`PreviewHost`, `PreviewAppProps`, `PreviewApp`).

### RED

`console-origin.test.ts` (the meta named as the server names it; an exact http(s) origin, else null),
`protocol.test.ts` (each console type accepted; another origin, another window, no console origin,
a malformed message, over 1 MiB, assets over 1 MiB in all ignored), `assets.test.ts` (PNG, JPEG,
WebP, `wOF2` sniffed; SVG, GIF, WOFF 1, short and empty refused; a logo made a `blob:` URL of its
sniffed type, a font loaded from bytes; the wrong type for a kind refused before any URL or font;
a font the browser cannot load refused) and `preview-app.test.tsx` (ready to the console origin and
the honesty banner; the posted document rendered through the live components; select-step and
navigated; capture steps as still placeholders with the simulated outcome and no camera;
malformed-document keeping the last document; unknown steps and foreign messages ignored; viewport
and scheme; a posted logo shown by a screen's image and a posted font applied; asset-refused; the
locale's lang and dir; nothing after unmount).

```
$ cd apps/flow && pnpm exec vitest run src/preview --coverage.enabled=false   # exit 1
      ... Error: readConsoleMessage(...) / sniffAsset(...) / loadPreviewAssets(...) / consoleOriginOf(...) is not built yet
      ... AssertionError: expected [] to deeply equal [ { ...ready } ] (the placeholder app renders nothing)
 Test Files  4 failed (4)
      Tests  20 failed | 2 passed (22)
```

### GREEN

`console-origin.ts`, `protocol.ts` (sizes measured with the buffers counted apart from the JSON),
`assets.ts` (with `browserAssetDeps`: `URL.createObjectURL` and `new FontFace(family, bytes)`,
`load()`, `document.fonts.add`), `preview-app.tsx` (the document parsed by
`templatePreviewDocumentSchema`; `StaticStep` for `isPreviewable` steps, a still placeholder for the
rest; copy from the document, else the built-in catalogs through `translateKey`; the chrome in English
with `lang="en"`), `start.ts` (renders `PreviewApp` with `window`) and `main.tsx` (imports the flow's
stylesheet). Two fixes of my RED file while going green, both about the test realm: the fixture path
goes through `fileURLToPath` (jsdom's `URL` is not a file URL for `readFileSync`), and the SVG buffer
is built in the test's own realm (jsdom's `TextEncoder` answered a buffer of another realm, which the
schema's `instanceof ArrayBuffer` refused, as a browser's structured clone never would).

```
$ cd apps/flow && pnpm exec vitest run src/preview src/embed src/server --coverage.enabled=false   # exit 0
      Tests  90 passed (90)
```

## Slice 7: the mocked suite's preview and embed specs, and the e2e fixture page (C156.2, C159, C171.2, C178.3)

These are end-to-end tests of behaviour already built test-first in slices 1-6 (each RED there), so
they were written after it; what they found is below. `e2e/fixtures/embed-page/` (`index.html`,
`embed-page.js`) is the customer page both suites embed from: it loads `openverify.iife.js` beside
it, mounts the flow from the options in its fragment and records every callback
(`window.openverifyEvents`) and every message it receives (`window.openverifyMessages`).

Support (mine): `e2e/support/mock-flow-server.ts` (`startMockFlowServer(consoleOrigin)`: the flow
server from source over the suite's `dist/` against a stub of the internal route in the test process;
`startPageServer`: a loopback page server), `mock-embed.ts` (`startEmbedPage`, `embedClientCode`
building the IIFE into a fresh temporary directory, `installForEmbedding`, `serveEmbedOrigins`
through `registerMockFlowExtension`, `embedPageUrl`, `embedEvents`, `embedMessages`) and
`mock-preview.ts` (`startConsolePages`, `previewDocument`, `postToPreview`, `postAssets`,
`previewMessages`).

Found on the way, each fixed in the test support, none in a shared file:
1. Chromium's local network access checks refuse a page fulfilled by `page.route` (a public address
   to it) framing the loopback flow server (`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`), so
   the console and customer pages are served from loopback page servers, as an operator's would be.
2. The shared mock answers CORS with the origin of the page it was installed on; the embedded flow's
   requests come from the flow origin, so `installForEmbedding` installs it through a view of the page
   whose `url()` is the flow origin (no edit of `mock-flow-api.ts`).
3. A decodable WOFF2 cannot be had without committing a font (no permissive one is in the tree; the
   only WOFF2 files under `node_modules` are OFL-1.1) or writing a font encoder, so the font half of
   C178.3 posts a buffer that sniffs as WOFF2: the preview hands it to `FontFace` from bytes (no
   request, no CSP violation) and, since it does not decode, answers `asset-refused`. The logo half
   renders (`blob:` URL, natural width 64).

```
$ flock /tmp/openverify-e2e.lock sh -c 'cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts e2e/embed.spec.ts e2e/preview.spec.ts'
  # first run (load 21.40): 8 failed | 1 passed (items 1 and 2 above)
  # after the fixes (load 16.62 17.73 19.58): 14 passed | 1 failed (the database step's config), then
  # with the database spec's own step: 2 passed; every case:
  ✓ embeds the flow on an allowed origin: the hello answered with ready and start, and the flow runs
  ✓ is never framed by another origin: frame-ancestors refuses it, so nothing answers
  ✓ the embedded <type> step passes axe on the customer's page   (consent, government_id, email_otp,
    phone_otp, database, aamva, database_business, crypto_wallet, business_website, document)
  ✓ renders a posted document, answering ready and navigated to the console only
  ✓ ignores a message from another origin, from another window, over 1 MiB or malformed
  ✓ shows a posted logo, hands a posted font to FontFace, refuses a buffer of the wrong type, with no CSP violation
```

## Handoff

**The flow server** (`apps/flow/server.ts`): `node --conditions=@openverify/source apps/flow/server.ts
[--hostname 127.0.0.1] [--port 4173] [--dist <dir>]` (default `dist/` beside the file; compose's
`app` profile needs `--hostname 0.0.0.0`). Environment: `VITE_OPENVERIFY_API_URL` (the API origin of
the build, for `connect-src`), `OPENVERIFY_DASHBOARD_PUBLIC_URL` (the preview's only frame; an origin
outside the grammar, an IP literal or a non-loopback `http:` included, answers `'none'`),
`OPENVERIFY_FLOW_SERVER_TOKEN` (at least 32 bytes; a `change-me` value refused when
`OPENVERIFY_MODE=production`; unset: no lookup and every embed `'none'`, with a warning),
`OPENVERIFY_FLOW_SERVER_API_URL` (required with the token), `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`
(0-32, default 0; Fastify's hop count over `X-Forwarded-For`). Entries, each on Phase 7's
`FLOW_RESPONSE_HEADERS`:
- hosted (`/`, `/index.html`, every extensionless path): `Content-Security-Policy: <buildContentSecurityPolicy>; frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `Cache-Control: no-store`; Permissions-Policy, Referrer-Policy and nosniff as Phase 7;
- preview (`/preview`, `/preview.html`): `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; frame-ancestors <console origin>; base-uri 'none'; form-action 'none'`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, no-store, and the document gains
  `<meta name="openverify-console-origin" content="<console origin>">` (`PREVIEW_CONSOLE_ORIGIN_META`);
- embed (`/embed/{inq_...}`, optional trailing slash): the hosted policy with `frame-ancestors` the
  policy's origins (`frameAncestorsDirective`: every origin re-checked, else `'none'`), no
  X-Frame-Options, no-store. A malformed id (or any other `/embed/...` shape) answers 404 `'none'`
  with no lookup; then the client's token bucket (60 at once, one a second, 10,000 clients) answers
  429 with `Retry-After`; then the lookup.
- files: known extensions only (`js mjs css json wasm onnx png jpg jpeg webp ico woff2 txt`, plus
  any file under `licenses/` as text), `assets/` immutable for a year, others `no-cache`; traversal
  (`..`, `.`, encoded slashes, backslashes, NUL, malformed escapes, empty interior segments) 400;
  GET and HEAD only (405 with `Allow`).
- access log on stdout: one JSON line `{"entry","status"}` per request (`hosted`, `preview`, `embed`,
  `asset`, `not-found`, `refused`, `rate-limited`, `error`), never a path, id or address.

**Lookup and caches** (`createEmbedPolicyLookup`): `GET {OPENVERIFY_FLOW_SERVER_API_URL}/api/v1/internal/embed-policies/{encodeURIComponent(id)}`
with `Authorization: Bearer <token>`, `redirect: 'error'`, 2 s timeout, answer capped at 64 KiB, guarded
by `parseEmbedPolicyAnswer` and its inquiry id compared; answers cached 60 s by inquiry id (10,000,
least recently used; `invalidate({templateId | environmentId})` exists for later use), 404 and invalid
answers cached as refusals 60 s; network errors, timeouts and other statuses answer `'none'` uncached;
concurrent lookups of one id share one request. Limits in `FLOW_SERVER_LIMITS` (provisional, basis in
the file).

**API** (`apps/api/src/services/embed-origins.ts`): `embedPolicyFor(db, inquiryId)` (null for an
unknown inquiry and an inactive template alike; an empty list is an answer), `allowedEmbedOrigins(kind,
environmentOrigins, versionOrigins)`, `redirectUriRefusal(uri, { environmentKind, allowedOrigins, schemes })`
(`not_a_uri`, `userinfo`, `scheme`, `origin`), `completionRedirectUrl(uri, { inquiryId, status | null })`,
`checkInquiryRedirectUri` (422 `redirect_uri_not_allowed` at `/data/attributes/redirect-uri`, never
echoing the URI), `redirectUrlFor(db, { inquiry, environmentKind, status })`, and foundation-9a's
`embeddingSettingsProblems` (`embed_origin_invalid`, `embed_wildcard_unacknowledged`). The redirect
origins are `allowed-redirect-origins`, else `allowed-embed-origins`. `api-flow-engine`'s session
builder fills `embed.allowed-origins` from `embedPolicyFor(...)['frame-ancestors']` and
`completion.redirect-url` from `redirectUrlFor` (on every answer); `api-templates` checks a version's
`redirect-uri` at publish with `redirectUriRefusal`.

**The preview protocol** (`apps/flow/src/preview/`): the console posts, with the flow origin as
target, `consoleToPreviewMessageSchema`'s messages; the preview accepts them only from the meta's
console origin and `window.parent`, within 1 MiB (assets 1 MiB in all), and answers `ready`,
`navigated {step-id}` and `error {malformed-document | asset-refused}` to that origin only. A posted
document must parse as `templatePreviewDocumentSchema` (the `POST .../preview` answer as a whole,
`{ data: ... }`). `isPreviewable` steps render through `StaticStep`; the rest (capture, codes,
wallet, handoff) as an English placeholder with the simulated outcome. Logos: PNG, JPEG or WebP by
their bytes, made `blob:` URLs, shown by a screen's `image` component with that `assetId`; fonts:
`wOF2` by their bytes, loaded with `new FontFace('openverify-preview-font', bytes)` and applied to the
preview. The theme itself is not applied (9B, `api-themes`).

**The embed protocol** (`apps/flow/src/embed/`): `mountEmbedBridge(window)` (first in `main.tsx`) on
`/embed/` pages only; `EmbedEntry` observes the flow's client (`observeFlowClient`) and reports each
session (`reportEmbedSession(embedSessionReportOf(session))`) and each final failure
(`reportEmbedError`: `unauthenticated`, `application_error`); a session of another inquiry than the
path's shows `LinkError reason="mismatch"`. The bridge answers `hello` with `ready` then
`event start` (and, once over, `event complete` plus `complete {inquiry-id, status}`), then
`event step-changed {step-type}` on each position change, `resize {height}` from a `ResizeObserver`,
and `event error` plus `error {code}`; never before the handshake, only to the exact origin.

**`@openverify/js`** (`packages/sdk-js/src/`): `embed(options) -> { destroy() }`, `frameUrlOf`,
`readFlowMessage`, `EMBED_PROTOCOL_VERSION`; types `EmbedOptions`, `EmbedHandle`, `EmbedErrorCode`,
`EmbedEventName`, `FrameUrlInput`, `FlowMessage`. Options as C159.2 (`container` an element or a
selector; `frameHeight` px, else the flow's `resize`; `frameWidth` capped at 768); an invalid option
calls `onError({code: 'invalid_config'})` without mounting, or throws a `TypeError` without `onError`.
Measured: ESM 5,967 B (2,470 B gzipped), IIFE 4,949 B (2,268 B gzipped); budget 6,144 B gzipped.

**The e2e fixture page** (`e2e/fixtures/embed-page/`): `index.html` loads `./openverify.iife.js`
(serve `packages/sdk-js/dist/openverify.iife.js` beside it) and `./embed-page.js`; open it as
`<page origin>/#flow-url=<flow origin>&inquiry-id=<inq>&session-token=<ovs>[&language=<tag>]`; it
records `window.openverifyEvents` and `window.openverifyMessages`.

**What integration-9a needs**: the compose `app` profile's `flow` service runs
`node --conditions=@openverify/source apps/flow/server.ts --hostname 0.0.0.0 --port 4173` with the
variables above (`VITE_OPENVERIFY_API_URL` at run time too); the e2e stack serves the fixture page from
an origin of its own with the built IIFE, and puts that origin in the sandbox's
`allowed-embed-origins` (it must be a loopback or `https:` origin, never one fulfilled by
`page.route`: Chromium's local network access checks refuse a public page framing a loopback flow);
`FLOW_SERVER_URL=<flow container> bash infra/tests/flow-server.test.sh` checks the container.

## Final gates (each read from its exit code)

| Command | Result |
|---|---|
| `pnpm --filter @openverify/flow typecheck` | exit 0 |
| `pnpm --filter @openverify/flow lint` | exit 0 |
| `pnpm --filter @openverify/flow test` | exit 0 on the second run: 116 files, 1,468 tests, 95.15% statements, 88.38% branches; 155 s, load 18.51 before, 19.93 after. The first run (exit 1) failed two tests of flow-renderer's RED commit `dc95a72c` (`src/steps/bidi-and-locale.test.tsx`), green once its GREEN landed |
| `pnpm --filter @openverify/js typecheck`, `lint`, `test` | exit 0 each: 19 tests, 100% statements and branches, the size budget included |
| `pnpm --filter @openverify/api typecheck`, `lint` | exit 0 each (lint 417 s, load about 17) |
| API suite, four blob shards and a merge (`/tmp/claude-1000/fse-api4b`) | merge exit 0: 618 files, 8,536 tests, 94.11% statements, 84.52% branches; shards 487, 382, 289 and 355 s at loads 11 to 22. The first set (exit 1) failed 8 tests of api-templates' RED commit `c5acf5fa` (`inquiry-template-operations.test.ts`), green once its GREEN landed; `embed-origins.ts` 100% statements, 92.75% branches |
| `pnpm exec prettier --check <my files>` | exit 0 (`--ignore-path=.gitignore` for `apps/api/src/services/embed-origins*.ts`) |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --filter=@openverify/flow --filter=@openverify/js --filter=@openverify/contracts --concurrency=2` | exit 0, 6 of 6 tasks, 194 s (load 17.08) |
| `... --force --filter=@openverify/api --concurrency=2` | exit 0, 2 of 2 tasks, 427 s (load 11.75) |
| `bash infra/tests/flow-server.test.sh` | exit 0, 38 passed |
| `bash infra/tests/flow-headers.test.sh --static-only` | exit 0, 2 passed |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | exit 0 on the second run: 158 passed in 92 s with the build (load 14.87 before, 21.93 after), my 15 among them. The first run (exit 1) failed three of flow-renderer's specs (the upload's new `capture-method` and the full language tag), green once it updated them |
