# Redaction and retention

## Redacting a case

`DELETE /cases/:id` (`cases:redact`) redacts the case alone and fires `case.redacted`. In one transaction:

- the sealed fields are nulled and the searchable-field keys deleted; tags are cleared; resolution and statuses are kept;
- every comment's message is nulled, its id, author and times kept;
- every attachment keeps its id, type, size and scan status, and loses its filename and digest; its original and its rendition pages are deleted from storage after the commit (a failed delete is retried by the C16 purge);
- `redacted-at` is set, and a `redacted` history row names who did it, or `system` with its cause;
- stored event payloads about the case and its comments are stubbed, and stored idempotent responses forgotten;
- the history is kept (it holds no value), and the case keeps its links.

A second redaction is a no change. Redacting a case written by a workflow run also redacts the run's copies (C120.9).

## What does not cascade

- **Held objects are not redacted with the case.** Redacting an inquiry or an account does not redact the cases that hold it, either: cases redact only themselves. An operator who wants both runs both, or a workflow does (for example on `inquiry.redacted`). A held object redacted elsewhere stays linked and shows as redacted.
- **One exception:** a case a workflow run created while acting on a transaction is that transaction's child, so redacting the transaction (directly, or through its inquiry or account) redacts the case too, as a system entry naming the transaction.
- A copy a workflow made from a redacted source into a case is removed with the source: a case's fields are emptied (the case itself stays live), a comment's message is nulled.

## Retention

`case-retention-days` (environment setting, 1 to 3,650, none by default) is counted from `resolved_at` and enforced by redaction, never deletion, in the daily C16 pass; each case in its own transaction, a failure counted and retried next time. Notifications are deleted after 90 days and export files after 24 hours. An image attachment (JPEG, PNG, WebP) of a case that holds a selfie inquiry follows that inquiry's biometric data (P22): the pass redacts it alone once the inquiry is redacted or its selfie is past the environment's `face-template-retention-days`, keeping its id, type, size and scan status, deleting its original and rendition pages, with a system audit entry `case-attachment.redacted`. A PDF stays, and a decline's deletion of face data does not reach it.
