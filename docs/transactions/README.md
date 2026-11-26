# Transactions

A transaction records something that happened in the operator's product (a payout, an order, a login) with typed fields, a status, labels, tags, the accounts, inquiries, reports and verifications it relates to, and files. Its type says which fields it takes; the type's versions are immutable once published.

## Types and versions

- `POST /api/v1/transaction-types` (`transaction-types:write`) creates a type with a **draft** version 1: its content, or four default statuses. A transaction needs a published version (422 `transaction_type_not_published` until then).
- `POST /api/v1/transaction-type-versions` creates the next draft, its content copied from the latest and replaced member by member from the body; `PATCH` changes a draft only (409 `transaction_type_version_not_draft`); `POST /:id/publish` publishes it and supersedes the previous one.
- `GET /api/v1/transaction-type-versions?filter[transaction-type-id]=` (`transactions:read`) lists a type's versions, newest first with a cursor. A type's `latest-version` and `published-version` relationships name them by id, so a first draft is reachable.
- A type serves the published version's `field-schemas`, `statuses` and `relation-schemas`, and empty lists before one is published (`published-version: null` says why).
- Publishing a version that drops or converts a field emits `transaction-type.deleted-field` or `.converted-field`. `field-key` is a dotted path through `hash` members (`beneficiary.iban`), at most four segments; an `array`'s item schema adds no segment, so its members follow the array's own key; a top-level field keeps its one-segment key. A removed or converted container raises one event for the container, not one per descendant.

## Field types

Fifteen: `string`, `integer`, `number`, `boolean`, `datetime`, `email-address`, `date`, `choices`, `multi-choices`, `array`, `hash`, `file`, `platform-file`, `json`, `relation-schema`. A version holds at most 100 fields counting every level, and at most three `hash` or `array` containers on a path. Each field's `config` takes, besides its type's own members:

- `required`; `default-value` (validated like a request value);
- `searchable` (at most 20, top-level, and only `string`, `integer`, `number`, `boolean`, `datetime`, `email-address`, `date` and `choices`);
- `redaction-policy`: `none` or `never`. `never` is refused on the types that can hold personal data in structure (`email-address`, `file`, `platform-file`, `relation-schema`, `hash`, `json`, `array`); on a `string` it needs `never-redact-acknowledged` and cannot be `searchable`;
- `write-policy`: `none` or `write_once`;
- `source-key-path`: an alias of another declared field of the same type, through `hash` members only.

Nested fields cannot be `searchable`, `write_once`, `never`, an alias or a `file`, and a `file` cannot be `required`. A `json` field's `json-schema` takes a fixed keyword allowlist and is compiled with ajv in strict mode at publish; a schema ajv refuses answers `field_schema_invalid` at its pointer.

**Values.** `null` is refused except on `choices` with `allow-empty`, so a masked read sent back cannot blank a field; a `PATCH` cannot clear a field. `''` and `[]` do not satisfy `required`. A field with `archived-at` or `deactivated-at` set takes no write. `datetime` values keep the offset they were sent with. A `platform-file` value is the id of a file the platform already holds (`file_` plus a ULID) in the environment; writing one needs `verifications:read`, and `pii:view` for a selfie or portrait file. A `relation-schema` value is a verification id of the target type.

A value that breaks its field answers 422 `field_schema_invalid` with each problem's pointer under `/data/attributes/fields` (at most 100 problems); a problem inside a `json` value names the field only, because a key the request made up can hold a value.

## Card numbers

Every string, number and `json` key or value is checked for a card-like number: a run of 13 to 19 digits, optionally separated by single spaces or hyphens, that passes Luhn, found anywhere in a text but not touching a letter or another digit. A match answers 422 `card_number_refused`. A version with `allow-card-like-strings` lifts the check for field values only; the reference id, tags, labels and model versions are always checked.

Two consequences to plan for:

- an `integer` or `number` of 16 to 19 digits beyond JavaScript's safe range is refused without Luhn, because parsing has already changed its digits;
- a 13-digit epoch-milliseconds timestamp in an `integer` or `number` field passes Luhn about one time in ten and is refused. Store times in a `datetime` field, or opt out with `allow-card-like-strings`.

## Transactions

`POST /api/v1/transactions` (`transactions:write`) takes the type, `fields`, an optional `reference-id` and `tags`. `PATCH` takes a partial `fields` (absent fields keep their value), `status` (one of the version's, 422 `status_does_not_exist`), `reference-id`, `label` and `tags`.

- **History.** `GET /api/v1/transactions/:id/status-changes` and `GET /api/v1/transactions/:id/labels` (`transactions:read`) list a transaction's status changes and labels, newest first with a cursor. A status change serves `from-status`, `to-status`, `actor-type`, `created-at` and `redacted-at`; both statuses are `null` once the transaction is redacted, and a redacted label is left out.
- **Relations.** `GET /api/v1/transactions/:id/relations` (`transactions:read`) lists the relations set by `add-relation` and not removed, newest first with a cursor. Each `transaction-relation` serves `relation-schema-key`, `target` (an account or a transaction, by its resource identifier, never its attributes) and `created-at`. Take `page[after]` from `links.next`: it is a position in the list, so a relation added or removed between two pages does not move your place. A redaction leaves relations as they are, because they hold only ids.
- **Search.** `filter[identifier][key]` and `filter[identifier][value]` find transactions by a `searchable` field's exact value: a string as stored (case-sensitive; an email address is not lower-cased), a number or boolean by its JSON text. It needs `pii:view`, because the answer says whether a value exists: a masked key or a viewer gets 403. Also `filter[reference-id]`, `filter[transaction-type-id]`, `filter[status]` and the creation range.
- **`write_once`.** A second write of the same value is no change; a different value answers 409 `field_write_once`. A `write_once` file field takes one upload.
- **Labels.** `POST /:id/label` with `label`, `score` and `model-version`; the latest is served as `transaction-label`.
- **Objects and relations.** `add-objects` and `remove-objects` relate accounts, inquiries, reports and verifications (at most 100, else 422 `related_objects_limit`); `add-relation` and `remove-relation` link an account or another transaction under a relation schema (`cardinality: one` allows one target). Past either limit the answer is 422 without a code.
- **Tags** through `add-tag`, `remove-tag` and `set-tags` (at most 50).

`fields` is personal data: without `pii:view` each field keeps its key and type and its value is `null`. An inquiry, a verification and a report serve their `transaction` relationship.

## Files

`PUT /api/v1/transactions/:id/files/:fieldKey` (multipart, one part named `file`) fills a top-level `file` field; `GET /api/v1/transactions/:id/files/:fileId/content` (`transactions:read` and `pii:view`) serves it with `cache-control: private, no-store` and is audited.

- Size: `min-file-size-bytes` (default 1) to `max-file-size-bytes` (default 10,000,000; 413 above). Both stop at 20,000,000 bytes, a provisional ceiling at the importer's file limit, because an upload is held in memory.
- Type: read from the bytes (JPEG, PNG, WebP, PDF; anything else is `application/octet-stream`) and checked against `supported-mime-types`.
- Pages: a PDF's pages are counted in the process from its `/Type /Page` objects (provisional); with `page-count-limit-enabled`, a PDF whose pages cannot be counted that way (compressed object streams) is refused, never passed. Anything else counts as one page.
- A replaced file's object is deleted after the commit, and its name goes at once. Its row stays until the object is gone, because it holds the wrapped key: a delete that fails is finished by the daily pass, and a redaction of the transaction reaches it. Its content answers 404 from the moment it is replaced. A refused upload answers 422 `transaction_file_refused`.

## Events

`transaction.created`, `transaction.updated-fields`, `transaction.status-updated` (with `meta { from, to }`), `transaction.labeled`, `transaction.redacted`, `transaction.added-relation` and `.removed-relation` (with `meta.context`). An event's transaction carries `fields: null`: no field value is ever in an event. Tag and object changes emit no event; they are audited.

## Redaction

`DELETE /api/v1/transactions/:id` (`transactions:redact`) redacts now: every field but the `never` ones, the field search keys, file names and objects, and the free text of the status history and labels. `meta.include-never` takes the `never` fields too, also on a transaction already redacted, and is audited. The status, the reference id and the tags stay. `transaction-retention-days` (1 to 3,650) redacts transactions past it in the daily pass.

`POST /:id/redact-biometrics` (`transactions:redact` and `inquiries:redact`) redacts the biometric data of the attached inquiries, the attached accounts' inquiries and the verifications attached or named in its fields, and stamps `biometrics-redacted-at`.

**Redacting a subject reaches its transactions.** Redacting an inquiry redacts every transaction whose objects name the inquiry or one of its verifications. Redacting an account redacts every transaction attached to it or related to it, and the transactions of its inquiries follow from redacting those inquiries. Each is redacted as a `DELETE` would, in the same database transaction, by the system (a `transaction.redacted` audit entry with the `inquiry-id` or `account-id` that reached it), with `transaction.redacted` emitted once:

- **`never` fields stay.** A cascade never uses `include-never`: a `never` field is how an operator keeps what a legal duty such as AML record keeping requires.
- **A shared transaction is redacted too.** A transaction linked to two accounts is redacted when either is. Its tags, reference, status and `never` fields remain for the other party.
- **Files.** Objects go after the commit. A delete that fails does not fail the redaction: the daily pass finishes it.
- **One direction only.** A transaction's own redaction never reaches its objects.
- **Once per pass.** Each object is redacted at most once, and an object already redacted is a no-change, with no second audit entry and no event. A catch-up after the commit reaches a transaction linked while the redaction ran.
