# Phase 7, Workflow 7B Stage 3: api-transactions (family T)

C104 and C105 on the Stage 1b (T) plumbing and the `transaction-schemas` engine. Every command ran
after `source scripts/env.sh`. Abbreviated output is real.

## 1. db repositories (C104.1, C105)

Stub `c361566a` (`listTransactionsForRebuild`, the rebuild's read).

RED: `pnpm --filter @openverify/db exec vitest run src/repositories/transaction-repositories.test.ts --coverage.enabled=false`

```
 FAIL  ... > files (C105.2, C105.4) > writes a field’s file, marking the last one deleted, ...
TransactionRepositoryNotBuiltError: createTransactionType is not built yet
 Test Files  1 failed (1)
      Tests  16 failed (16)
```

GREEN: the same command, with `src/repositories/transaction-plumbing.test.ts` (whose stub block
went with the stubs):

```
 Test Files  2 passed (2)
      Tests  35 passed (35)
```

### The resource reads, the filter links, the account include and the biometric rows

Stub `48a6ee31`. RED (same command):

```
 FAIL ... > reads each object with its subtype, and the filter links of each transaction
TransactionRepositoryNotBuiltError: listTransactionRelatedObjects is not built yet
 FAIL ... > reads an account’s transactions newest first, attached or related, at most the limit
TransactionRepositoryNotBuiltError: listAccountTransactions is not built yet
      Tests  3 failed | 16 passed (19)
```

GREEN (the file fixture's wrapped DEK took the `files_wrapped_dek_format` form once the RED reached it):

```
      Tests  38 passed (38)
```

## 2. Types and versions (C104.1, C104.3, C104.6)

RED: `pnpm exec vitest run src/services/transactions/types.test.ts --coverage.enabled=false` (apps/api)

```
 FAIL ... > creates a type with a draft version 1 holding the default statuses, audited
AssertionError: expected 501 to be 201 // Object.is equality
 ...
 Failed Tests 10
```

GREEN: the same command, with `src/routes/transaction-routes.test.ts`, whose 501 cases for the
type and version routes went with the stubs (the field-schema and scope cases now read 201 and 200):

```
      Tests  10 passed (10)        # types.test.ts
      Tests  41 passed (41)        # transaction-routes.test.ts
```

## 3. Transactions (C104.2-C104.5, C105.1-C105.3, C105.8)

RED: `pnpm exec vitest run src/services/transactions/transactions.test.ts --coverage.enabled=false`

```
 FAIL ... > validates against the published version, pins it, and emits transaction.created with no value
AssertionError: expected 501 to be 201 // Object.is equality
 FAIL ... > refuses a value that breaks its field, and an undeclared key, at their pointers
AssertionError: expected 501 to be 422 // Object.is equality
 ...
 Failed Tests 17
```

The platform-file case could not go through the route: the engine reads a platform file as `fil_`
plus a ULID (`packages/core/src/transactions/fields-validator.ts:30`), while the platform's files
are `file_` (`ID_PREFIXES.file`), so every real file id is refused as `field_schema_invalid`. The
test calls `checkReference` with the reference the engine would hand over; the prefix is a
contract deviation for integration-7b.

GREEN: `pnpm exec vitest run src/routes/transaction-routes.test.ts src/services/transactions --coverage.enabled=false`
(the route test's 501 cases for the transaction routes went with the stubs; the redaction scope
cases read 404 for a transaction that does not exist):

```
      Tests  49 passed (49)
```

## 4. Files, redaction, relationship, filter subject, include and rebuild (C105.2, C105.4-C105.7, C107.4, C107.6)

RED: `pnpm exec vitest run src/services/transactions/files.test.ts src/services/transactions/hooks.test.ts --coverage.enabled=false`

```
 FAIL ... > seals the content, serves the value without a URL, and reads it back audited
AssertionError: expected 501 to be 200 // Object.is equality
 FAIL ... > keeps the never fields, emits transaction.redacted once, and takes them with include-never
AssertionError: expected 501 to be 200 // Object.is equality
 FAIL ... > serves the latest transaction an object was attached to, and null without one
AssertionError: expected Map{} to deeply equal Map{ …(2) }
 FAIL ... > resolves the attached inquiries’ templates and the related accounts’ types
AssertionError: expected [ {}, {}, {} ] to deeply equal [ { …(2) }, …(2) ]
 FAIL ... > rekeys every unredacted transaction under a new key, and changes nothing the second time
AssertionError: expected 0 to be greater than 0
      Tests  12 failed | 2 passed (14)
```

Honest note: the biometric redaction (`redactTransactionBiometrics`, C105.6) went in with the
GREEN of section 3 (`14f2f3a4`) before a test of its own, so its case here passed at once
(one of the 2 passing; the other is the 404 of a foreign redaction, which the fake-free
redaction service already answered). Its database half had its RED (`b6fa0e7a`) and GREEN
(`39095879`) in section 1.

GREEN: `pnpm exec vitest run src/routes/transaction-routes.test.ts src/routes/server/account-includes.test.ts src/services/transaction-hooks.test.ts src/services/transaction-relationship-served.test.ts src/services/transactions --coverage.enabled=false`

```
      Tests  107 passed (107)
```

Changed with the plan, none weakened: `transaction-routes.test.ts`'s file-route cases read 404 (the
transaction does not exist) where they read 501; `transaction-hooks.test.ts` lost the three cases
that held the stubs to their unbuilt answers. `listTransactionFieldKeys` (db) is new for the
rebuild's comparison, asserted in `transaction-repositories.test.ts`.

## 5. Two writers on Postgres (C104.1, C105.2, C111.3)

`pnpm exec vitest run --config vitest.integration.config.ts src/services/transactions/transactions-races.integration.test.ts`

```
      Tests  3 passed (3)
```

These cases hold behaviour the GREENs above already built (the row lock of every write, the type
lock of a publish), so they passed at their first run; no RED is claimed for them. The writer cases
were checked to bite: with `lockWritable` reading the row by `getTransaction` instead of
`lockTransaction` (a scratch edit, reverted, never committed) they fail:

```
 FAIL ... > let one write a write_once field, and answer the other 409
AssertionError: expected [ { status: 'fulfilled', …(1) }, …(1) ] to have a length of 1 but got 2
 FAIL ... > record two status moves once each, the row holding the last granted
AssertionError: expected 'created' to be 'approved' // Object.is equality
      Tests  2 failed | 1 passed (3)
```

## 6. Retention through the real hook (C105.5, C16)

`hooks.test.ts` gained the C16 case: a transaction past `transaction-retention-days` redacted by
`runRetention` through the real `RedactionService` and `redactTransactionInTx`, its `never` field
kept. It passed at its first run (`Tests 8 passed (8)`): `foundation-7b` built the C16 step with a
mocked hook, and section 4's GREEN built the hook; this case joins them with nothing mocked.

## 7. Two existing tests changed with C105.7

The first full API run after section 4 (two blob shards plus the merge) read 5 failures. Three
were `foundation-7b`'s checkpoint (G) RED in the tree (`graph-hooks.test.ts`, `container.test.ts`,
`openapi.test.ts`), green after its GREEN `e2c41177`. Two were mine: `d6ad2b0d` built
`resolveTransactionRelationships`, so every verification now serves `transaction: { data: null }`
(C105.7), and `routes/server/inquiries.test.ts` (`?include=verifications`) and
`routes/server/verifications.test.ts` (`GET /verifications/:id`) compare the relationships whole.
Each gains that one member; nothing else changed. So `d6ad2b0d` did not read green in the whole
suite; this commit fixes it.

```
      Tests  58 passed (58)     # the two files
```

## Report (api-transactions)

### Summary

C104 and C105 are built test-first on the Stage 1b (T) plumbing and the `transaction-schemas` engine, in 15 path-scoped commits (`c361566a..4c1a612a`) and the report commit, on top of `603f917f`. Nothing was pushed and no dependency was added.

**What landed**
- **Repositories (packages/db):** every Stage 1b stub built with its frozen signature: types and versions (C71 publishing under the type lock), transactions with sealed fields and every list filter (the identifier through `transaction_field_keys`), append-only history and labels, objects and relations, field keys, files, plus the reads the resource, filters, include, rebuild and biometric redaction need.
- **Types and versions:** a type comes with a draft version 1; drafts change; publishing runs the engine's rules, then ajv 8 strict compilation of each `json` schema, answering every refusal at its pointer, never a 500; a publish that drops or retypes a field emits `transaction-type.deleted-field` / `.converted-field`.
- **Transactions:** validated against the pinned published version under the row lock; the card guard on fields, reference, tags and labels; searchable keys; `write_once` (409); statuses with history; tags; labels; objects (with the account a reference names); relations with their `meta.context`; events with `fields: null`; masking member-wise without `pii:view`.
- **Files:** the multipart upload capped at the field's size, typed by signature, page-counted, sealed, replacing the field's last object; the audited content route.
- **Hooks:** `redactTransactionInTx` with the `never` override, the biometric redaction through `BiometricItemRedactor`, the `transaction` relationship on inquiries, verifications and reports, the strict filter subject, `include=transactions` on accounts, the searchable-key rebuild, and the C16 pass end to end.

**One defect outside my paths:** the engine reads a `platform-file` as `fil_` while the platform's files are `file_`, so no platform-file value can be written until integration-7b changes one regex (contractDeviations 1).

**Gates, all rc 0 in the foreground:** API typecheck, lint and suite (5,813 tests, 96.05%), db test (1,490), `pnpm test:integration` (69 and 204), forced turbo lint and typecheck (30/30), format check, `benchmark:typecheck`, and the e2e gate (79, then 32, 34 and 29). Two commits did not read green alone, and four test commits held behaviour already built; all are recorded in the TDD file.

### Handoff

## How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-api-transactions.tdd.md`.
- db: `pnpm --filter @openverify/db exec vitest run src/repositories/transaction-repositories.test.ts src/repositories/transaction-plumbing.test.ts --coverage.enabled=false` (38 tests).
- API, from `apps/api`: `pnpm exec vitest run src/services/transactions src/routes/transaction-routes.test.ts src/services/transaction-hooks.test.ts src/services/transaction-relationship-served.test.ts src/routes/server/account-includes.test.ts --coverage.enabled=false`.
- Races on Postgres: `(cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/transactions/transactions-races.integration.test.ts)` (3 tests).

## Routes (schemas frozen by foundation-7b, unchanged; services in `apps/api/src/services/transactions/`)
| Route | Scope | Answer | Problems |
|---|---|---|---|
| `POST /transaction-types` | `transaction-types:write` | 201; the type with a draft version 1 (body content, or `DEFAULT_TRANSACTION_STATUSES`) | 400 |
| `GET /transaction-types` (`filter[status]`) | `transactions:read` | newest first | 400 bad cursor |
| `GET /transaction-types/:id` | `transactions:read` | the type | 404 |
| `PATCH /transaction-types/:id` | `transaction-types:write` | renamed | 404 |
| `DELETE /transaction-types/:id` | `transaction-types:write` | archived (idempotent) | 404 |
| `POST /transaction-type-versions` | `transaction-types:write` | 201; draft numbered max + 1, content from the latest, body members replace | 404; 409 `transaction_type_archived` |
| `GET /transaction-type-versions/:id` | `transactions:read` | the version | 404 |
| `PATCH /transaction-type-versions/:id` | `transaction-types:write` | the draft | 404; 409 `transaction_type_version_not_draft` |
| `POST /transaction-type-versions/:id/publish` | `transaction-types:write` | published; the previous published superseded | 404; 409 `transaction_type_version_not_draft`; 422 `field_schema_invalid`, `relation_target_unsupported`, `card_number_refused` (engine, then ajv strict compile), each `errors[].pointer` under `/data/attributes` |
| `POST /transactions` | `transactions:write` | 201 | 404 type; 409 `transaction_type_archived`; 422 `transaction_type_not_published`, `field_schema_invalid`, `card_number_refused` (fields, `reference-id`, tags), `related_object_not_found`; 403 `platform_file_not_allowed` |
| `GET /transactions` (`filter[reference-id]`, `[transaction-type-id]`, `[status]`, `[identifier][key]`+`[value]`, created-at range) | `transactions:read` | newest first, `links.next` keeps every filter | 400 |
| `GET /transactions/:id?include=transaction-type,transaction-label` | `transactions:read` | `transactionIncludeDocumentSchema` | 404 |
| `PATCH /transactions/:id` (`fields` partial, `status`, `reference-id`, `label`, `tags`) | `transactions:write` | the transaction | 404; 409 `field_write_once`; 410 `transaction_redacted`; 422 `status_does_not_exist`, `field_schema_invalid`, `card_number_refused`, `related_object_not_found`; 403 `platform_file_not_allowed` |
| `DELETE /transactions/:id` (`meta.include-never`) | `transactions:redact` | the redacted transaction (through `deps.redaction.redactTransaction`) | 404 |
| `POST /transactions/:id/redact-biometrics` | `transactions:redact` + `inquiries:redact` | the transaction, `biometrics-redacted-at` set | 404 |
| `POST /transactions/:id/add-objects`, `/remove-objects` | `transactions:write` | the transaction | 404; 410; 422 `related_object_not_found` (per index, `/meta/object-ids/<i>`), 422 (no code) past 100 related objects |
| `POST /transactions/:id/add-relation`, `/remove-relation` | `transactions:write` | the transaction; idempotent | 404; 410; 422 `relation_schema_unknown` (key or target kind), `related_object_not_found`, 422 (no code) a second target of a `one` relation |
| `POST /transactions/:id/add-tag`, `/remove-tag`, `/set-tags` | `transactions:write` | the transaction | 404; 410; 422 `card_number_refused`, 422 past 50 tags |
| `POST /transactions/:id/label` | `transactions:write` | the transaction | 404; 410; 422 `card_number_refused` (`/meta/label`, `/meta/model-version`) |

## File routes (C105.2, P12, P22)
- `PUT /transactions/:id/files/:fieldKey` (`transactions:write`, multipart, one file part named `file`): reads the transaction and its pinned version first (404; 410 `transaction_redacted`; 422 `field_schema_invalid` at `params /fieldKey` when the key is not a top-level `file` field; 409 `field_write_once` when a `write_once` field already holds a file), then reads the body capped at `max-file-size-bytes` (default 10,000,000; 413 `transaction_file_too_large`; 415 when not multipart; 400 for another part). Refuses 422 `transaction_file_refused` below `min-file-size-bytes` (default 1), for a type outside `supported-mime-types` (read from the bytes: JPEG, PNG, WebP or PDF; anything else is `application/octet-stream`), or past the page count (`page-count-limit-enabled`; PDF pages counted by `/Type /Page` objects, an uncountable PDF refused, a non-PDF counts 1). The object is sealed with `encryptBytes` (context: the `txnf_` id) under `newStorageKey`; a replaced file's row is marked deleted and its object deleted after the commit. The field's value becomes `{ type: 'file', value: { file-id, filename, byte-size, mime-type } }`; emits `transaction.updated-fields`; audits `transaction-file.uploaded`.
- `GET /transactions/:id/files/:fileId/content` (`transactions:read` + `pii:view` by `requirePiiView`): 404 for a file not of this transaction or replaced; 410 `transaction_redacted` once the transaction or file is redacted; audits `transaction-file.viewed` before sending; `cache-control: private, no-store`, `x-content-type-options: nosniff`, the stored MIME type.

## Events (every resource with `fields: null`)
`transaction.created` (create), `transaction.updated-fields` (PATCH fields, file upload), `transaction.status-updated` (`meta { from, to }`), `transaction.labeled` (PATCH `label`, `POST /label`), `transaction.redacted` (first redaction only, staged by `redactTransactionInTx`), `transaction.added-relation` / `.removed-relation` (`meta.context { relation-schema-key, related-account-id | related-txn-id }`, only when a row changed), `transaction-type.deleted-field` / `.converted-field` (at publish when a previous published version existed; `meta { field-key, version-number[, from, to] }`, the type resource). Tags and objects emit nothing (no event is registered); they are audited.

## Audit actions
`transaction-type.created`, `.updated`, `.archived`; `transaction-type-version.created`, `.updated`, `.published`; `transaction.created`, `.updated` (metadata: attribute names and changed field keys), `.labeled`, `.added-relation`, `.removed-relation`, `.tag-added`, `.tag-removed`, `.updated-tags`, `.objects-added`, `.objects-removed`, `.biometrics-redacted`, `.redacted` (RedactionService); `transaction-file.uploaded`, `.viewed`. Never a value.

## New names
- db (`@openverify/db`, all through `export *`): `lockTransactionType`, `latestTransactionTypeVersionNumber`, `listTransactionsForRebuild` + `TransactionForRebuild`, `listTransactionRelatedObjects` + `TransactionRelatedObject`, `listTransactionFilterLinks` + `TransactionFilterLinks`, `listAccountTransactions`, `listTransactionFieldKeys`, `listTransactionBiometricScope` + `TransactionBiometricScope`, `redactTransactionBiometricRows` + `TransactionBiometricRedaction` (in `transaction-redaction.ts`). Every Stage 1b stub is built with its frozen signature; `TransactionRepositoryNotBuiltError` is no longer thrown by anything.
- API: `TransactionActing.allows?: (permission) => boolean` (`services/transactions/acting.ts`; the routes pass it, built on `authorizePrincipal`; absent means no extra permission). `shared.ts` (`change`, `requireTransactionType`, `requireTransactionTypeVersion`, `versionContent`, `throwFieldProblems`, `TRANSACTIONS_PATH`, `TRANSACTION_TYPES_PATH`), `resources.ts` (`transactionTypeResource(s)`, `transactionTypeVersionResource`, `transactionLabelResource`, `transactionResource(s)` with `{ mask, forEvent }`, `servedFields` adding `source-key-path` aliases), `json-schemas.ts` (`jsonSchemaCompileProblems`, `jsonValueProblems`; ajv 8 `strict: true`, `allErrors: false`, validators cached by `<version id>|<pointer>`, at most 512), `write-checks.ts` (`assertTexts`, `checkReference`, `validatedFields`, `typedFields`, `searchableKeysOf`, `fieldValueKey`, `searchableFieldKeys`), `redaction.ts` (`neverFieldKeys`, `redactTransactionInTx`), `files.ts` (`countPdfPages`, `putTransactionFile`, `readTransactionFile`).
- Searchable keys: `identifierKey(blindIndexKey, { environmentId, kind: 'identifier-transaction-field', input: '<field-key>|<text>' })`, text = the string as stored, or the JSON text of a number or boolean; `filter[identifier][value]` matches exactly.

## What the e2e and the console need
- e2e (integration-7b): create a type with fields, publish its version 1 (find it through `latest-version`/the version create answer: a type's first draft id is not in the type resource; `POST /transaction-type-versions` returns the next draft), create a transaction, PATCH status, upload a file with multipart part `file`, read `content` with a `pii:view` key, `DELETE` with and without `meta.include-never`. A `platform-file` value cannot pass until the `fil_` prefix is fixed (contractDeviations).
- Console (7C): the type resource does not carry its versions' ids; the editor needs a list of a type's versions (no `GET /transaction-type-versions?filter[transaction-type-id]` route exists) or the id of version 1, so a route or a member is needed (followup). History and labels have db reads (`listTransactionStatusHistory`, `listTransactionLabels`) but no route serves them yet.

### contractDeviations

1. The transaction engine reads a `platform-file` value as `fil_` plus a ULID (`packages/core/src/transactions/fields-validator.ts:30`, owner `transaction-schemas`, not this agent's path), while the platform's files are `file_` (`ID_PREFIXES.file`), so every real file id is refused as `field_schema_invalid` and no `platform-file` value can be written. Exact change for integration-7b: `const PLATFORM_FILE_ID = new RegExp(`^file_${ULID_BODY}$`)` with its golden tests in `fields-validator.test.ts`. `checkReference` (environment, `verifications:read`, `pii:view` for selfie and portrait kinds) is built and tested directly.
2. A type serves the published version's `field-schemas`, `statuses` and `relation-schemas`, and empty lists until a version is published (`published-version: null` says why); C104.1 names the published version for `field-schemas` only.
3. A new type's version 1 is a draft (C104.1 'a draft version comes with it'), so a transaction needs a publish first: 422 `transaction_type_not_published`. A draft of an archived type answers 409 `transaction_type_archived`; publishing a draft of an archived type is allowed.
4. Publishing answers the engine's problems first; ajv's strict compilation of each `json` schema (and its default) runs only when the engine finds none, so one answer never mixes the two. The problem code is `card_number_refused` when any problem has it, else the first problem's code; every problem is in `errors[]` under `/data/attributes`.
5. Searchable key input is `<field-key>|<text>` under `identifier-transaction-field`: a string as stored (case-sensitive, an email not lowercased), a number or boolean by its JSON text; `filter[identifier][value]` matches the stored value exactly. Docs (integration-7b) should say so.
6. `write_once` (C105.2): a resend of the same value is no change and no 409; a different value answers 409 `field_write_once`. A `write_once` file field takes one upload: any second answers 409.
7. `transaction.status-updated` carries `meta { from, to }`, as `account.status-updated` does; the contract does not require it.
8. Tag changes and object changes emit no event (no event name is registered for them); they are audited (`transaction.tag-added`, `.tag-removed`, `.updated-tags`, `.objects-added`, `.objects-removed`).
9. A second, different target of a `cardinality: one` relation and an `add-objects` past 100 related objects answer 422 without a code (`UnprocessableContentError`), because `TRANSACTION_PROBLEM_STATUSES` is frozen and has no code for either. Proposal for contracts: `relation_cardinality_exceeded` (422) and `related_objects_limit` (422).
10. `remove-relation` checks the relation schema and the target as `add-relation` does (422 `relation_schema_unknown`, `related_object_not_found`), so a removal of something that could never exist is refused rather than answered as a no-op.
11. A `relation-schema` field value naming a verification of another type answers 422 `related_object_not_found` (no dedicated code).
12. PDF page counts (C104.2's 'the Phase 5 PDF parser'): the Phase 5 page count comes from the vision service's document analysis, too heavy for an upload path, so pages are counted in-process by `/Type /Page` objects (provisional, basis: the PDF object syntax; not measured). A PDF whose page tree cannot be read that way (compressed object streams) is refused with `transaction_file_refused` when `page-count-limit-enabled`, never passed; a non-PDF counts as one page. A parser-backed count is a 7C or Phase 11 proposal.
13. MIME types come from `detectUploadMimeType('document', bytes)`: JPEG, PNG, WebP and PDF are recognised; anything else is stored as `application/octet-stream` and is refused when `supported-mime-types` is set.
14. A replaced file's row is marked deleted in the upload's transaction and its object deleted after the commit, best effort: a failed delete leaves ciphertext that no purge reads (the C16 purge reads redacted files only). The content route answers 404 for a replaced file and 410 `transaction_redacted` for a redacted one. An empty or control-character filename is stored as `file`.
15. Biometric redaction scope (C105.6): the attached inquiries, the attached accounts' inquiries, the attached verifications and those named by stored field values (any `ver_` id in the sealed fields), plus every verification of those inquiries; `BiometricItemRedactor.redactBySource` runs for each of those inquiries. Reports' inquiries are not reached. Only the transaction has a `biometrics_redacted_at` column, so only it is stamped (the first time stays); the run is audited the first time or whenever it deleted something. Lock order: the transaction row, then the inquiries by id.
16. `TransactionActing` gains the optional `allows` (`services/transactions/acting.ts`), which the transaction routes build from `authorizePrincipal`; absent means no permission beyond the route's.
17. Existing tests changed with the plan, none weakened: `apps/api/src/routes/transaction-routes.test.ts` (the 501 cases went with the stubs; the field-schema and scope cases read 201 and 200; the redaction scope and file-route cases read 404 for a transaction that does not exist); `apps/api/src/services/transaction-hooks.test.ts` (three cases that held the stubs to their unbuilt answers removed); `packages/db/src/repositories/transaction-plumbing.test.ts` (the stub block removed); `apps/api/src/routes/server/inquiries.test.ts` and `routes/server/verifications.test.ts` (each gains `transaction: { data: null }`, C105.7).
18. Commits that did not read green or mixed kinds: `d6ad2b0d` (GREEN) left `inquiries.test.ts` and `verifications.test.ts` red in the whole API suite until `4c1a612a`; `dec63201` (a test commit) also removed the unused `notBuilt` from `acting.ts`. The biometric redaction service went in with `14f2f3a4` before its route test (`1c2605b3`, which then passed at once); its database half had RED `b6fa0e7a` and GREEN `39095879`. The race tests (`dec63201`) and the C16 test (`61adada5`) hold behaviour already built and passed at their first run; the writer races were shown to bite with a reverted scratch edit (TDD record section 5).
19. Owner question (T) item 7 (does redacting an account or inquiry reach its transactions?) is untouched: `transactions` and `transaction_files` stay in `TRANSACTION_PII_TABLES`.

### followups

- integration-7b: change `PLATFORM_FILE_ID` in `packages/core/src/transactions/fields-validator.ts:30` to `file_` and adjust its golden tests (contractDeviations 1); then add a route-level platform-file case to `apps/api/src/services/transactions/transactions.test.ts`.
- integration-7b, `docs/transactions/`: exact searchable match, `write_once` semantics, the in-process PDF page count and its refusal, the recognised MIME types, a type serving only its published content, the first draft that needs a publish, and the 422s without a code.
- contracts (integration-7b or the owner): codes for a second target of a `one` relation and for the 100 related objects cap (contractDeviations 9).
- 7C console / integration-7b: there is no route listing a type's versions or naming version 1's id, so the console's types editor (and the e2e) must create a draft to find version numbers; a `GET /transaction-type-versions?filter[transaction-type-id]=` route (route schema change, integration-7b) or a member on the type resource is needed. History and labels have db reads but no route.
- Owner or 7C: a replaced transaction file whose object delete fails after the commit leaves an orphan object no purge reads; a purge of `deleted_at`-set, unredacted rows' objects would close it.
- Owner: plan (T) item 7 (account or inquiry redaction reaching transactions) is still open.

### measurements

- API unit suite (two blob shards plus the merge, rc 0): 5,813 tests in 426 files at 96.05 / 88.12 / 97.69 / 96.12 (statements, branches, functions, lines); `src/services/transactions` 92.02% statements, 78.34% branches. Shard loads 3.24 and 8.19.
- db: 1,490 tests in 98 files at 94.64 / 87.65 / 94.6 / 94.82.
- Integration (`pnpm test:integration`, rc 0, load 2.14): db 69 tests in 15 files, api 204 in 35. An earlier combined run at load 15-31 failed on container start (`Port ... not bound after 120000ms`) in three db files; api and db then passed alone (204 and 69) before the combined pass.
- `pnpm turbo run lint typecheck --force`: 30 of 30 at load 21; `pnpm format:check` rc 0.
- e2e gate (own stack per shard): mocked flow 79 in 20.5 s (load 8.0); full stack 32 (2.5 min, load 4.6), 34 (5.4 min, load 1.3) and 29 (4.5 min, load 1.1).
- Transactions tests: db 38 (transaction repositories and plumbing); API 49 in `src/services/transactions` (types 10, transactions 17, files 7, hooks 8, plus the route test), 3 races on Postgres.
- `benchmark:typecheck` rc 0.
