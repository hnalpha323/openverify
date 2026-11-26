# `@openverify/js`, the embed client (plan C159)

`packages/sdk-js` is a small client a customer's page uses to show the hosted flow in a frame. It has no runtime dependency; Vite's library mode builds an ES module (`dist/index.js`) and an IIFE for a plain `<script>` tag (`dist/openverify.iife.js`, global `OpenVerify`). A size test holds it under 6 KB gzipped (2.5 KB at the end of Workflow 9A). It is built and tested in Phase 9 and published to npm with the release (Phase 11); `sdk-react` and `apps/demo-web` are deferred.

```js
const handle = OpenVerify.embed({
  container: '#verify',
  flowUrl: 'https://flow.example.com',
  inquiryId: 'inq_…',
  sessionToken: 'ovs_…', // or oneTimeLink: 'ovo_…', exactly one
  language: 'ar',        // optional, a language tag
  styleVariant: 'dark',  // optional, light or dark
  onReady() {}, onComplete({ inquiryId, status }) {}, onCancel({ inquiryId }) {},
  onError({ code, message }) {}, onEvent({ name, metadata }) {},
});
// later: handle.destroy();
```

The client builds `<iframe src="{flowUrl}/embed/{inquiryId}?language=…&style-variant=…#inquiry-id=…&session-token=…" allow="camera" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups">` (title "Identity verification" unless `iframeTitle` says otherwise; width at most 768 px). The credentials go only in the fragment, which browsers never send. Invalid options call `onError` with `invalid_config`, or throw a `TypeError` when there is no `onError`.

**Not offered**, each on purpose: starting from a template id, `fields`, a reference id, an account id or an environment id (the customer's server creates the inquiry, so a page cannot choose what is verified); `frameAncestors` and a message target for nested frames (later).

## Protocol (versioned, ours)

On load the client posts `{ source: "openverify-parent", version: 1, type: "hello" }` to the frame with the flow origin as target. The flow accepts it only from `window.parent`, and only when `event.origin` matches an entry of the session's `embed.allowed-origins` through `matchesOriginPattern`, cross-checked with `location.ancestorOrigins` where the browser has it (never gated on it: `"null"` counts as absent). From then on the flow posts only to that exact origin: `ready`; `event` with `name` `start`, `step-changed` (the step's **type**, never its id), `complete`, `cancel` or `error`; `resize { height }`; `complete { inquiry-id, status }`; `cancel { inquiry-id }`; `error { code }`. No message carries a token, a step id or a field value. The client accepts a message only when `event.origin` is the flow origin and `event.source` its frame.

Error codes: `application_error`, `camera_error`, `invalid_config`, `unauthenticated`, `inactive_template`, `unknown`.

**`onComplete` is a hint**, not an outcome: it may never fire, and its status may lag. Business logic belongs on webhooks or the API.

The full-stack `e2e/tests/flow-embed.spec.ts` embeds a flow from the fixture page `e2e/fixtures/embed-page/`, served by the e2e stack from a loopback origin of its own.
