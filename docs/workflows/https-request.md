# HTTPS request

`make_https_request` calls an endpoint the operator names. It is at least once, so a receiver must drop a repeat of its `Idempotency-Key`.

```json
{
  "method": "POST",
  "url": "https://api.example.com/cases/{{ inputs.reference }}",
  "headers": [{ "name": "Authorization", "value": "Bearer {{secrets.partner_token}}" }],
  "body": { "reference": "{{ inputs.reference }}" },
  "timeout-seconds": 10,
  "signing": { "secret": "{{secrets.partner_signing}}" }
}
```

Methods are `GET`, `POST`, `PUT`, `PATCH` and `DELETE`; a JSON body goes with `POST`, `PUT` and `PATCH`. The output is `{ status, headers, body }`. Only `content-type`, `location` on a 3xx, `retry-after` and `etag` come back.

## Destinations

- The scheme, host and port are literal in the published definition, and templates fill percent-encoded path segments and query values, so end-user data never becomes a DNS label. A PII-tainted value in a URL is refused at publish: put it in the body or a header.
- `https:` only, with no credentials in the URL. No redirect is followed: a 3xx returns its status and `location`.
- Port 443, plus `workflow-http-ports`, which can never hold a Fetch "bad port".
- `workflow-http-hosts` is an optional per-environment allowlist.
- Every resolved address is vetted, a mixed answer is refused, and the socket connects to the vetted address. SNI and the certificate stay on the URL's host.
- Private, loopback, link-local, CGNAT, documentation, reserved and multicast ranges are refused in production, and cloud metadata addresses before anything else, the EKS Pod Identity Agent's among them. `workflow-http-private-cidrs` (`settings:privacy`, audited, off by default) admits internal endpoints inside a private or CGNAT block only.
- `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK=true` admits loopback in sandbox environments of a non-production install, for local test receivers. It is a startup error in production.
- `OPENVERIFY_NAT64_PREFIXES` adds network-specific prefixes whose embedded IPv4 is checked.
- One normaliser compares every host, on the parsed URL. A suffix-extended host, a trailing dot, a percent-encoded host and an IDN each compare as what they are.
- A kept-alive socket is never shared across environments or network policies, and a settings change closes the old agent.

`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `Expect`, `TE`, `Trailer`, `Proxy-*` and the names OpenVerify sets are refused in `headers`.

## Answers

A 2xx body is read as `application/json` (with a depth limit) or `text/plain`, at most 1 MiB; anything else is `response_unsupported`. A non-2xx is the output's `status` with no body unless `capture-error-body` is set (at most 16 KiB). That includes a 429 or a 5xx with no retry left: read `status`. A body is sealed and scrubbed of resolved secrets. It reaches conditions only through a declared `response-schema`, a list of `{ name, type, pii }`; with none it is tainted and always masked.

Only timeouts, network and DNS errors, 429 and 5xx retry. Requests are budgeted at 600 a minute per environment, and at most 5 run at once per environment and host, both failing closed with `rate_limited`, which retries after the window. The concurrency of 5 holds across every worker of the install: each request holds a lease in Valkey that lapses on its own if its worker dies, and a step whose lease Valkey cannot grant, Valkey being down included, fails closed with `rate_limited` and retries.

## Verifying a request

Every request carries `Idempotency-Key` and `OpenVerify-Workflow-Run`. With `signing`, it also carries `OpenVerify-Request-Signature: t=<unix>,w1=<hex>`: an HMAC-SHA-256 of `workflow.<t>.<METHOD>.<target>.<raw body>`, where target is the path and query as sent, with one `w1` per active secret during a rotation, including on `GET` and `DELETE` over an empty body.

```ts
import { verifyWorkflowRequestSignature } from '@openverify/node';

verifyWorkflowRequestSignature({ secrets, header, method, target, body });
```

**Use this, never webhook code.** A workflow signature is a format of its own, so a workflow can never forge an OpenVerify webhook, and `verifyWebhookSignature` refuses it even when one secret value sits in both places. RFC 9421 is a possible v2.

## What the guard does not cover

A public endpoint that trusts your egress address; a response, which is untrusted data; a secret that leaves in a header, which the receiver can store or reflect; an egress proxy, which is a later explicit setting (`HTTP_PROXY` stays ignored).

## Personal data leaving OpenVerify

A step that carries PII-tainted values off the platform is marked in the version, and needs its publisher's `pii:view` and the acknowledgement `egress:<step id>`. The console shows the mark, and each send writes an audit entry with the step and the destination. The operator is the controller:

- **Recipients.** The destination is a recipient of personal data, so record it in your processing register.
- **Processor terms.** A vendor that processes on your behalf needs terms that say so.
- **Transfers.** A destination outside the person's jurisdiction may need a transfer basis.
- **Redaction cannot reach what left.** Redacting a subject nulls OpenVerify's copies. It cannot reach a copy sent elsewhere, so send ids and links where you can: the default templates carry nothing else.
