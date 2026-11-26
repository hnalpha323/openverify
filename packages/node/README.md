# @openverify/node

Server-side SDK for Node.js 22 and later:

- a typed client for the OpenVerify server API;
- webhook signing and signature verification.

Use it only on servers: it holds an API key, and webhook secrets must never reach a browser.

This package is a client. The server decides every step: which steps an inquiry runs, what is
checked and what the result is. The client sends requests, parses the answers and verifies webhook
signatures; it decides nothing.

## Installing

The package is not published to a registry yet. Install it from a packed tarball of a release, or
build it from source:

```sh
# from a release's tarball (check its SHA-256 against the release's checksum file first)
npm install ./openverify-node-<version>.tgz

# from source, in a checkout of the repository
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@openverify/node
node packages/sdk-react/scripts/pack-release.ts --out ./packed packages/node
```

The tarball carries the API's schemas inside it (under `dist/vendor/`), so its only dependency is
`zod`.

## Server API client

```ts
import { createClient, OpenVerifyApiError } from '@openverify/node';

const client = createClient({
  apiKey: process.env.OPENVERIFY_API_KEY!, // ov_sbx_... or ov_prod_...
  baseUrl: 'https://openverify.example.com', // /api/v1 is added for you
});

const { data: inquiry } = await client.inquiries.create({
  'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
  'reference-id': 'customer-1234',
});
const { meta } = await client.inquiries.resume(inquiry.id); // meta['flow-url']
```

### Options

| Option       | Default           | Meaning                                                    |
| ------------ | ----------------- | ---------------------------------------------------------- |
| `apiKey`     | required          | An API key, or a dashboard user session token (`ovu_...`)  |
| `baseUrl`    | required          | Where the API is served. A path prefix (a gateway) is kept |
| `apiVersion` | the key's version | Sent as `OpenVerify-Version`, for example `'2026-10-01'`   |
| `fetch`      | global `fetch`    | Inject your own, for tests or a custom agent               |
| `maxRetries` | `2`               | Retries after the first attempt; `0` turns retries off     |
| `timeoutMs`  | `30000`           | Deadline of each attempt, including reading the answer     |

### Methods

Methods are grouped by resource and use the API's own names: attributes and `meta` members are
kebab-case, exactly as in the API reference. Each method returns the response document
(`{ data, included?, meta? }`) parsed with the `@openverify/contracts` schema of the endpoint,
so the result is fully typed.

| Group                     | Methods                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inquiries`               | `create`, `retrieve(id, { include: 'verifications' })`, `list`, `listAll`, `update`, `resume`, `approve`, `decline`, `markForReview`, `expire`, `addTag`, `removeTag`, `setTags`, `generateOneTimeLink`, `redact`, `performSimulateActions` (sandbox only) |
| `inquirySessions`         | `list`, `listAll`, `retrieve`, `expire`, `expireAll({ 'inquiry-id' })`                                                                                                                                                                                     |
| `inquiryTemplates`        | `create`, `retrieve`, `list`, `listAll`, `update`                                                                                                                                                                                                          |
| `inquiryTemplateVersions` | `create` (a draft), `update`, `publish`, `retrieve`, `list`, `listAll`                                                                                                                                                                                     |
| `verifications`           | `retrieve`                                                                                                                                                                                                                                                 |
| `accounts`                | `create`, `retrieve`, `list`, `listAll`, `update`, `addTag`, `removeTag`, `setTags`, `addRelation`, `removeRelation`, `listRelations`, `consolidate`, `addObjects`, `removeObjects`, `redact`                                                              |
| `accountTypes`            | `create`, `retrieve`, `list`, `listAll`                                                                                                                                                                                                                    |
| `webhooks`                | `create`, `retrieve`, `list`, `listAll`, `update`, `enable`, `disable`, `archive`, `clone`, `rotateSecret`, `simulate`, `replay`                                                                                                                           |
| `webhookDeliveries`       | `retrieve`, `list`, `listAll`                                                                                                                                                                                                                              |
| `events`                  | `retrieve`, `list`, `listAll`                                                                                                                                                                                                                              |
| `apiKeys`                 | `create`, `retrieve`, `list`, `listAll`, `update`, `clone`, `expire`                                                                                                                                                                                       |
| `apiLogs`                 | `retrieve`, `list`, `listAll`                                                                                                                                                                                                                              |
| `rateLimits`              | `list`                                                                                                                                                                                                                                                     |
| `sandboxSmsMessages`      | `search(phoneNumber)`: the codes the sandbox SMS sender kept for a number, newest first (a sandbox key with `sandbox:read`; the number goes in the body)                                                                                                   |
| `userAuditLogs`           | `retrieve`, `list`, `listAll`                                                                                                                                                                                                                              |

Actions take the resource id, then their `meta`, then request options:

```ts
await client.inquiries.addTag(inquiry.id, { 'tag-name': 'vip' });
await client.inquiries.approve(inquiry.id);
const rotated = await client.webhooks.rotateSecret(webhookId, {
  'previous-secret-expires-in-seconds': 3600,
});
rotated.data.attributes.secret; // shown only in this response
```

### Government ID results

A verification's `status` may be `needs_review`: a required check had no evidence, so an operator
decides. Every check carries its `stage` (`ga`, `beta` or `sunset`), a `confidence` (beta
heuristics) and its `provenance` (the implementation version, the models and provider it rests on,
and the thresholds it was judged against).

A government ID also carries its extracted fields (`name-first`, `birthdate`,
`identification-number`, ...) and `extraction-sources`, the sources that agreed per field. The
fields are PII: `null` when not read, for a key minted masked, and after redaction.

```ts
import { extractionOf, isGovernmentIdVerification } from '@openverify/node';

const { data } = await client.verifications.retrieve('ver_...');
if (isGovernmentIdVerification(data)) {
  const { fields, sources } = extractionOf(data);
  console.log(data.attributes.status, fields['expiration-date'], sources['birthdate']);
}
```

The types `VerificationStatus`, `InquiryStatus`, `CheckStage`, `CheckProvenance`,
`ExtractionField`, `ExtractionSource` and `GovernmentIdVerification` are exported.

### Lists

`list()` returns one page (`{ data, links: { next } }`). `listAll()` is an async iterator over
every item of every page. Filters take one value, a list of values (meaning OR), a `Date` (sent as
ISO-8601) or a boolean. `created-at-start` is inclusive and `created-at-end` exclusive; every
list takes them except `inquiryTemplates` and `webhooks`, which take no filter at all (their types
say so, and the client refuses them with a `TypeError` before sending). `reference-id`, `route`,
`resource-type` and `object-id` take exactly one value.

```ts
const page = await client.inquiries.list({
  filter: { status: ['approved', 'declined'], 'created-at-start': new Date('2026-10-01') },
  page: { size: 50 },
});

for await (const delivery of client.webhookDeliveries.listAll({ filter: { status: 'failed' } })) {
  console.log(delivery.id, delivery.attributes.attempts.length);
}
```

### Idempotency, retries and timeouts

- Every `POST` and `PATCH` sends an `Idempotency-Key`: a new ULID, or the key you pass in the
  request options. Retries reuse it, so a retried write takes effect at most once.
- Network errors, timeouts, `429` and `5xx` answers are retried up to `maxRetries` times, after an
  exponential backoff with jitter (0.5 s, then 1 s, ...). When the API sends `Retry-After`, the
  client waits that long instead, and gives up at once when it asks for more than a minute. A `409`
  `idempotency-key-in-use` is retried too: the first request with the key is still running, and the
  retry receives its stored response.
- Each attempt has its own `timeoutMs` deadline. A `signal` in the request options cancels the
  request and any wait between retries.

```ts
const controller = new AbortController();
await client.webhooks.replay(
  webhookId,
  { 'created-at-start': '2026-10-01T00:00:00Z', 'created-at-end': '2026-10-02T00:00:00Z' },
  { idempotencyKey: 'replay-2026-10-01', signal: controller.signal },
);
```

### Errors

Every error the client throws on purpose extends `OpenVerifyError`:

| Error                               | When                                                          | Members                                             |
| ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `OpenVerifyApiError`                | The API answered `4xx` or `5xx` (after any retries)           | `status`, `problem` (RFC 9457), `type`, `requestId` |
| `OpenVerifyConnectionError`         | No answer arrived                                             | `cause`                                             |
| `OpenVerifyTimeoutError`            | An attempt passed `timeoutMs` (a `OpenVerifyConnectionError`) | `cause`                                             |
| `OpenVerifyResponseValidationError` | A success did not match this client's contract                | `status`, `issues`                                  |

```ts
try {
  await client.inquiries.approve(inquiryId);
} catch (error) {
  if (error instanceof OpenVerifyApiError && error.status === 409) {
    console.log(error.type, error.problem.detail); // .../problems/invalid-transition
  }
}
```

Invalid arguments, such as an `Idempotency-Key` the API would refuse, reject with a `TypeError`
before anything is sent.

### Endpoints without a method

For an endpoint the client has no method for, `parseApiAnswer(schema, status, text)` parses a
success the way every method does (the contract schema, members a newer server adds dropped), and
`apiErrorOf(response, text)` builds the `OpenVerifyApiError` of an error answer. The dashboard uses
them for the dashboard API.

### Connect

Organisations on one install share a verified person's data through three groups:
`connectConnections` (create, list, retrieve, deactivate, reactivate, `changeSharePolicy`),
`connectShareTokens` (create, list, retrieve, `peek`, expire, `redeem`) and
`connectConsentRecords` (`attest`, list, retrieve, withdraw). Connect is off unless the install
sets `OPENVERIFY_CONNECT_ENABLED` and the receiving organisation turns on `connect-inbound`; while
it is off every Connect route answers 404. A share token id is a handle, not a secret. The
destination activates a connection in the console only, after a second factor. `peek` counts
against the token's limit of ten. `redeem` answers 202: a job makes the copy, and its outcome
arrives as `connect/share-token.inbound-redeemed` or `connect/share-token.failed`.
`isConnectEventName(name)` tells those events apart.

```ts
const consent = (await client.connectConsentRecords.list({ filter: { 'subject-id': inquiryId } }))
  .data[0];
const { data: token } = await client.connectShareTokens.create({
  'connection-id': connectionId,
  'source-id': inquiryId,
  'consent-record-id': consent.id,
});
```

### Account exports

`accountExports` makes the per-account access export (C253): `create(accountId)` answers the
export `pending` (202), a job assembles it, `retrieve(id)` reads its status, `manifest(id)` returns
the `openverify.account-export.v1` manifest once it is `ready`, and `fileContent(id, fileId)` returns
a file the manifest lists, as bytes with their type. It needs the scope `account-access:export` and
`pii:view`, allows 10 exports an hour per environment (failing closed with 503 when the limit's store
is unavailable), and the manifest names what the export does not cover. The manifest holds what this
install holds through the account's links at that moment; review it before disclosure. An export
expires after the environment's `account-export-ttl-days`, and is deleted when a subject it lists is
redacted.

```ts
const { data: pending } = await client.accountExports.create(accountId);
// ... poll until ready
const manifest = await client.accountExports.manifest(pending.id);
const first = manifest.files[0];
if (first !== undefined) {
  const { bytes, mimeType } = await client.accountExports.fileContent(pending.id, first.id);
}
```

## Webhook signatures

Deliveries carry `OpenVerify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`. While a rotated
secret overlaps the new one, a second `v1=` follows, the new secret's first. Verify the raw body,
exactly as received, against every secret you hold:

```ts
import { verifyWebhookSignature, WebhookSignatureError } from '@openverify/node';

app.post('/hooks/openverify', express.raw({ type: 'application/json' }), (request, response) => {
  try {
    verifyWebhookSignature({
      body: request.body, // a Buffer: the raw bytes
      header: request.headers['openverify-signature'],
      secrets: [currentSecret, previousSecret].filter(Boolean),
    });
  } catch (error) {
    if (error instanceof WebhookSignatureError) return response.sendStatus(400);
    throw error;
  }
  // ...handle JSON.parse(request.body)
  response.sendStatus(204);
});
```

`verifyWebhookSignature` throws on any mismatch, compares in constant time and refuses timestamps
more than 300 seconds from your clock (`toleranceSeconds`). `signWebhookPayload(body, secrets,
timestamp)` builds the header; the API uses it to sign deliveries.
