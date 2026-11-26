# Workflow secrets

A secret belongs to the organisation and holds a value per environment, sealed, with its last four kept (`****` for a value under 8 characters, so a short value never shows). `key` is immutable and snake_case. `allowed-hosts` lists normalised hosts, and `allowed-placements` lists header names (default `authorization` alone) and optional JSON Pointers into a body (default none). Neither table is personal data, so redaction and exports skip them.

```text
GET, POST     /api/v1/workflow-secrets
GET, PATCH, DELETE /api/v1/workflow-secrets/:key
PUT           /api/v1/workflow-secrets/:key/values/:environment-id
POST          /api/v1/workflow-secrets/:key/values/:environment-id/rotate
```

- `GET` serves metadata, and only your environment's value metadata (`secrets:read`, which viewers do not hold).
- A value route acts only on the caller's own environment: another id answers 404. A production value needs a user session in production, as does changing hosts or placements, or deleting a secret, while one exists. API keys set values only in their own environment.
- `DELETE` answers 409 `secret_in_use` while a published version references the key.
- Rotation keeps the previous value up to 24 hours for a signing secret.
- `secret-value` never reaches a stored log, and a key's fingerprint leaves it out too, so two calls with one `Idempotency-Key` that differ only in the value are one request.

## References

`{{secrets.<key>}}`, or the public `current_run.environment.secrets.<key>`, is allowed in an HTTPS header value, the signing secret, the HTTPS JSON body and the Slack webhook URL alone, narrowed further by the secret's placements. A secret may appear once per request. Never in a URL, a condition, an Evaluate Code property, a message, a tag, a comment or a field. The host must be on `allowed-hosts`. Publish refuses each of these, and a key with no value here (`secret_reference_invalid`, `secret_value_missing`, `secret_placement_refused`); the executor refuses them again at run time, where a key or value gone since reads `secret_placement_refused`.

## Out of everything stored

A secret is resolved last, inside the action, after every other check, and the step's recorded input is the unresolved template. Before an output, an error or a test-run line is stored, each value resolved in that step, and its base64, base64url and percent-encoded forms, becomes `[REDACTED]`. Rate-limit and sink keys use secret ids. A canary test runs one step of each egress kind and looks for the value in every table, Valkey key and value, S3 object and log line.

**A value inside an encoded compound is not scrubbed**: a Basic header's `user:secret` is the base64 of the pair, not of the secret. Resolve such a value in full, as one secret.

The residual risk: an allowed host whose own API stores or reflects a header.

Install credentials (Twilio, SMTP, providers) stay environment variables.
