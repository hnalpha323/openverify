# The hosted flow

The end-user verification flow (`apps/flow`) is a single-page application. `pnpm --filter @openverify/flow build` writes it to `apps/flow/dist`. Since Workflow 9A the compose `app` profile serves that build with the **flow server** (`node --conditions=@openverify/source apps/flow/server.ts`, plan C157), which computes each document's headers per request; development keeps `vite` and `vite preview`.

- [Device handoff](handoff.md): moving a desktop flow to a phone by QR, email or SMS.
- [Flows (flow-spec 2)](../flows/README.md): the format, the server engine, branching, actions, preview and simulate, embedding, the flow server and `@openverify/js` (Phase 9).

## Response headers (plan C157, replacing C107.9's fixed set)

A production build carries its Content-Security-Policy in a `<meta>` element, with the API origin chosen at build time (`apps/flow/src/security/security-meta.ts`). Some protections cannot travel in a `<meta>`: browsers ignore `frame-ancestors` there, and Permissions-Policy has no `<meta>` form. The flow server therefore sends them as headers, computed for each request and failing closed. The full table, per entry (hosted, preview, embed), is in [the flow server's page](../flows/server.md); in short:

| Entry | `frame-ancestors` | Other headers |
|---|---|---|
| hosted (`/` and its routes) | `'none'` | `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), geolocation=(), microphone=()`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` |
| preview (`/preview`) | the console origin (`OPENVERIFY_DASHBOARD_PUBLIC_URL`) | `connect-src 'none'`, no camera |
| embed (`/embed/<inquiry id>`) | the inquiry's allowed origins, `'none'` when there are none or the lookup fails | as hosted, without `X-Frame-Options` |

`infra/tests/flow-headers.test.sh` checks that compose runs the flow server and, in its live half, each entry's headers on the apps image; it then runs `infra/tests/flow-server.test.sh` against that container.

**In development** `vite preview` still sends Phase 7's four fixed headers from `apps/flow/vite.config.ts` (`preview.headers`, `FLOW_RESPONSE_HEADERS` in `apps/flow/src/security/response-headers.ts`): `frame-ancestors 'none'`, the Permissions-Policy above, `Referrer-Policy: no-referrer` and `nosniff`.

**Serving the build yourself.** A static host or CDN cannot compute a header per request, so it cannot embed the flow or serve the preview: run the flow server, or send the hosted headers on every response and use the hosted mode only. For example, with nginx:

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(self), geolocation=(), microphone=()" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
```

A second `Content-Security-Policy` header is combined with the `<meta>` policy: each must allow a request for it to proceed, so the header above restricts framing only and leaves the `<meta>` policy in charge of everything else.
