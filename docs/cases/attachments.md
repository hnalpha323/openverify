# Attachments and scanning

## Uploading

- `POST /cases/:id/attachments` (`cases:write`): one multipart part named `file`, at most 10 MiB, buffered so `Idempotency-Key` is honoured. It answers 201 with the case.
- `PATCH /cases/:id` with `data.attributes.attachments[] { data (base64), filename }`: 1 to 20 items, at most 10 MiB decoded together; this route alone takes a 14 MiB body.

An attachment (`catt_`) is typed by its bytes (JPEG, PNG, WebP or PDF; anything else is `attachment_type_refused`), held to the pinned version's attachment policy and to 20 a case (`case_attachment_limit`), sealed with its own data key into storage, and its filename is sealed; a client's filename never reaches a header, a path or a storage key. Each upload writes an `attachment-added` history row, moves `lock-version`, fires `case.updated` and writes an audit entry naming the case, the type and the size. Uploads count against `case-attachments` (60 a minute per principal). An object written for a `PATCH` whose transaction rolls back stays in storage unreadable, because its wrapped key went with the row.

The case serves `attachments[] { id, filename, url, byte-size, attachment-type, scan-status, scan-provider, scanned-at, rendition-status, page-count, created-at }`. `filename` is personal data: null without `pii:view`, and null in every event. `url` is the content route, never a storage URL (stored objects are ciphertext).

## Renditions

Nothing is served as uploaded. The vision service's `POST /v1/renditions` decodes an image with the service's guards (format sniffing, the 40-megapixel check before decoding, Pillow's decompression-bomb limit), applies the EXIF orientation, copies the pixels into a fresh image and re-encodes it (a JPEG as a JPEG, a PNG or WebP as a PNG, falling back to JPEG within 16 MiB), so no EXIF, GPS, XMP, ICC profile, text chunk or comment survives; transparency is shown on white and an animation gives its first frame; at most 4,096 px a side. A PDF's first 20 pages are rendered to PNG images of at most 1,600 px a side by the service's guarded PDF child, one child per page; a longer PDF is marked `truncated`, and one of more than 50 pages is refused. Renditions run on their own lane (one running, four queued), so verification processing keeps its slots; each stops 40 seconds after the request arrived.

Renditions are made asynchronously on the `case-rendition` queue, at upload and again on any request that finds one pending; `case-export-sweep` also enqueues again, after a minute, every rendition and every scan left `pending` by a lost enqueue or a stopped worker. An attachment the scanner found `infected`, or could not scan, is never rendered: its job records the rendition `failed` with `rendition_unavailable` without reading it, so the sweep stops enqueueing it. Pages are sealed beside their source.

- `GET /cases/:id/attachments/:attachmentId/content[?page=n]` (`cases:read` and `pii:view`): 200 the rendition page as an attachment named `case-attachment-<id>.<ext>`, `nosniff`, `private, no-store`, one audit entry per view; 202 `{ meta: { rendition-status: pending, retry-after-seconds: 5 } }` with `Retry-After` while it is made; 422 `rendition_unavailable` when vision could not make it (a 4xx from vision; a 5xx is retried); 404 for a deleted or redacted source.
- `GET /cases/:id/attachments/:attachmentId/original` (`cases:redact` and `pii:view`): the sealed original, audited, under the same scanning rule.
- `GET /api/v1/dashboard/files/:id/rendition` (`inquiries:read` and `pii:view`): an inquiry file's rendition for the console, made on first view or when the verification is processed, audited as `file.viewed`. The API's own file route is unchanged.

Every path that redacts or deletes a file removes its rendition pages, and the C16 pass purges what a failed delete left.

## Scanning

The `AttachmentScanner` port has three providers, bound per environment kind by `OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_{SANDBOX,PRODUCTION}`:

- **`none`** (the default; unset reads `none`): every attachment is `not_scanned`, and it is served behind a warning in the console.
- **`clamd`**: an operator-run ClamAV daemon over a Unix socket or a private `host:port` (`OPENVERIFY_CLAMD_SOCKET`), through OpenVerify's own `INSTREAM` client. Only `stream: OK` reads `clean` and only `FOUND` reads `infected`; a size-limit refusal, an unknown answer, a closed connection and silence past 30 seconds read `error`, never `clean`. No ClamAV image or compose profile ships, because ClamAV is GPL-2.0: run it yourself, give its socket to the worker, and keep its signatures current. A scanner finds known malware; it does not make a file safe to open, which is why only renditions are served.
- **`sandbox`**: deterministic, for tests: the EICAR test string is `infected`, everything else `clean`; refused for production. See [sandbox providers](../checks/sandbox-providers.md).

The worker scans on the `case-attachment-scan` queue, up to three attempts in one run; the API reads the same binding name (never the socket) to decide what to serve. With a scanner bound, only `clean` is served: `pending` answers 409 `attachment_scan_pending`, `infected` answers 409 `attachment_infected`, and `error` answers a plain 409 and is never served (only redacted). An attachment found infected or unscannable is never rendered. Keep the API's and the worker's settings alike: an attachment recorded for a provider the worker has not bound stays `pending`.
