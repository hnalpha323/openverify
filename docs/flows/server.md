# The flow server (plan C157)

`apps/flow/server.ts` serves the built flow and computes each document's headers per request, failing closed. It uses Node's `http` with erasable TypeScript and no dependency, and imports only `@openverify/contracts/origin-pattern`, so Node runs it from source:

```bash
node --conditions=@openverify/source apps/flow/server.ts [--hostname 127.0.0.1] [--port 4173] [--dist <dir>]
```

The compose `app` profile runs it as the `flow` service (`--hostname 0.0.0.0 --port 4173`), and the full-stack e2e stack runs it over its own build. Development keeps `vite` and `vite preview`.

## Entries and headers

| Entry | Path | Headers |
|---|---|---|
| hosted | `/`, `/index.html`, every extensionless route | `Content-Security-Policy`: the flow policy of `security-meta.ts` plus `frame-ancestors 'none'`; `X-Frame-Options: DENY` (for browsers that ignore CSP); `Permissions-Policy: camera=(self), geolocation=(), microphone=()`; `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`; `Cache-Control: no-store` |
| preview | `/preview`, `/preview.html` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; frame-ancestors <console origin>; base-uri 'none'; form-action 'none'`; `Permissions-Policy: camera=(), microphone=(), geolocation=()`; the console origin also in a `<meta>` the preview reads |
| embed | `/embed/<inquiry id>` | the hosted policy with `frame-ancestors` set to the inquiry's embed policy, or `'none'` when the list is empty, the inquiry is unknown, its template inactive, or the lookup fails |
| files | `dist/` | known extensions only, `nosniff`, `immutable` caching for hashed assets; a traversal is refused |

The embed path's id is checked against the inquiry id pattern before anything else: a malformed id answers 404 with `'none'` and makes no lookup; a traversal spelled into an `/embed/` path answers 400. The id travels in the path only because the header must be computed before any script runs; it is an identifier, not a credential (the session's credentials stay in the fragment). The access log is one JSON line per request with the entry kind and the status, never the path. The `<meta>` CSP stays as defence in depth.

## The lookup

The flow server reads an inquiry's policy from the API's internal route `GET /api/v1/internal/embed-policies/:inquiryId` (outside the public OpenAPI document), with `OPENVERIFY_FLOW_SERVER_TOKEN` compared in constant time (`OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` is accepted during a rotation). The answer `{ inquiry-id, template-id, environment-id, frame-ancestors[] }` is checked with `parseEmbedPolicyAnswer` and every origin re-checked against the grammar; any failure drops the whole answer to `'none'`, so a stored value can never inject a directive. Answers and refusals (404, an invalid answer) are cached by inquiry id for 60 s (at most 10,000 entries); network failures, timeouts and other statuses answer `'none'` uncached. Concurrent lookups of one id share one request. An allowlist change therefore reaches new loads within a minute.

**Abuse.** Before any lookup, a token bucket per client address on `/embed/*` (60 a minute, then one a second; the address taken through `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`, never a raw `X-Forwarded-For`) answers 429 with `Retry-After`, so no client drains the shared lookup budget. The API's `internal-embed-policy` policy (6,000 a minute per token) is a capacity ceiling. Every limit is ours and provisional, with its basis in `server.ts` (`FLOW_SERVER_LIMITS`).

**Phase 11:** the flow server becomes its own production image, and `/api/v1/internal/*` is denied at the chart's ingress or bound to a listener the ingress does not serve. Until then the route needs the token.

## Configuration

| Variable | What |
|---|---|
| `VITE_OPENVERIFY_API_URL` | the API as the browser reaches it (`connect-src`) |
| `OPENVERIFY_DASHBOARD_PUBLIC_URL` | the console origin, the preview's only frame; outside the grammar gives `'none'` |
| `OPENVERIFY_FLOW_SERVER_TOKEN` | shared with the API, at least 32 bytes; a `change-me` value is refused in production; unset, no lookup is made and every embed is `'none'` |
| `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` | the API's, accepted during a rotation |
| `OPENVERIFY_FLOW_SERVER_API_URL` | the API as the flow server reaches it (compose: `http://api:3000`), required with the token |
| `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS` | proxies in front that append `X-Forwarded-For`, 0 to 32 |

## Tests

`infra/tests/flow-server.test.sh` checks every entry against a server it starts from source with a stub of the internal route, or, with `FLOW_SERVER_URL`, a running server. `infra/tests/flow-headers.test.sh` checks that compose runs the flow server and, on the apps image, each entry's headers, then runs `flow-server.test.sh` against that container. The full-stack `e2e/tests/flow-embed.spec.ts` frames the flow from an allowed origin and is refused on another, and frames the preview from the console's origin.

Operators who serve `apps/flow/dist` themselves: see [the hosted flow's headers](../flow/README.md#response-headers-plan-c157-replacing-c1079s-fixed-set).
