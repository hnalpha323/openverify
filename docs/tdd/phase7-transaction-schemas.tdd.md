# TDD evidence: Workflow 7B Stage 2, `transaction-schemas` (Phase 7)

- **Slice owner:** the Workflow 7B Stage 2 `transaction-schemas` agent. It owns `packages/core/src/transactions/` only.
- **Date:** 2026-10-31.
- **Base:** `1396ad20` (Stage 1a's last commit). This agent's commits run from `e8870f6c` to the commit that adds this file.
- **Input:** the plan's `transaction-schemas` bullet (C104.2-C104.5, and the version diff of C104.6) with Stage 1a amendment 22.

Every command ran after `source scripts/env.sh`, from `packages/core` unless stated. Output is trimmed to the lines that matter. Every value in these tests is synthetic. The card-like strings are public processor test numbers and digit strings whose Luhn result was worked out outside this code, in a separate Python one-liner; they appear only in the guard's own refusal tests (rule 9).

## Two findings that shaped the design

**zod 4 compiles `z.object` keys into a `new Function`.** `$ZodObjectJIT` in zod 4.6.7 (`v4/core/schemas.js:1194-1214`) generates a fastpass from the shape. A scratch test counted the calls:

```
$ pnpm exec vitest run src/__probe.test.ts --coverage.enabled=false --silent=false
Function calls 2
```

A validator made of `z.object`s over stored field keys would generate code from a field schema, which C104.3 and the Stage 2 prompt forbid. So the validator is a tree of plain closures, and zod is used only on the leaves it knows best (`z.email()`, `z.iso.date()`, `z.iso.datetime()`). `fields-validator.test.ts` "generates no code" spies on `globalThis.Function` to hold that.

**`fieldSchemaSchema.safeParse` throws at depth.** A scratch test over nested `array` fields:

```
50 true 7 ms
200 true 2 ms
1000 THROW RangeError 12 ms
5000 THROW RangeError 10 ms
```

So `transactionTypeVersionProblems` checks the shape caps first, with a walk that stops at the fourth level, and never hands a field that is too deep to zod.

## 0. Stubs (`e8870f6c`)

The names the tests need beyond Stage 1a's, as throwing stubs, plus the additive types (`FieldReference`, `JsonFieldValue`, `JsonFieldSchema`, `FieldsValidatorOptions`, `TransactionTexts`, the `references` and `jsonValues` members). `tsc`, `eslint` and `prettier --check` were clean.

## A. The card-number guard (C104.4)

RED `927fd284`; GREEN `d07e6299`.

```
$ pnpm exec vitest run src/transactions/card-guard.test.ts --coverage.enabled=false
   139|   throw new TransactionEngineNotBuiltError();
 Test Files  1 failed (1)
      Tests  47 failed (47)
```

GREEN:

```
 Test Files  1 passed (1)
      Tests  47 passed (47)
```

## B. The keyword allowlist of a `json` schema (C104.3)

RED `cfdc2d41`; GREEN `8e8e1c36`.

```
$ pnpm exec vitest run src/transactions/json-schema-allowlist.test.ts --coverage.enabled=false
     14   name: 'TransactionEngineNotBuiltError',
 Test Files  1 failed (1)
 Failed Tests 66
```

GREEN:

```
 Test Files  1 passed (1)
      Tests  66 passed (66)
```

## C. The version diff, the status and relation checks, the alias read, the json schemas (C104.2, C104.3, C104.5, C104.6)

RED `71ca9276`; GREEN `43a511e2`.

```
$ pnpm exec vitest run src/transactions/version-reads.test.ts --coverage.enabled=false
 Test Files  1 failed (1)
      Tests  23 failed (23)
```

The first GREEN passed all 23, but a read of the code showed that a bad path fell through to the segment `''`, so `{ '': 1 }` answered a value. The GREEN commit carries the fix and the test for it.

## D. The walk of a request (C104.2-C104.4)

RED `8f3fa348`; GREEN `b95287f2`.

```
$ pnpm exec vitest run src/transactions/fields-validator.test.ts --coverage.enabled=false --reporter=json
Counter({('failed', 'TransactionEngineNotBuiltError: '): 73})
```

GREEN:

```
 Test Files  1 passed (1)
      Tests  73 passed (73)
```

The first run of the whole folder failed on one test: Stage 1a's "the engine stub" in `field-schemas.test.ts`, which asserted that `fieldsValidatorOf` throws. It changed with the plan (it now names the area), in the GREEN commit.

## E. The rules across a version (C104.2-C104.5)

RED `1a4529a9`; GREEN `598c1f26`.

```
$ pnpm exec vitest run src/transactions/version-rules.test.ts --coverage.enabled=false --reporter=json
Counter({('failed', 'TransactionEngineNotBuiltError: '): 100})
```

The first GREEN passed all 100 and lint found two errors. A read of the code then found what the tests had not: a `max-date` with no `min-date` compared `'undefined' > '2026-…'`, which refused a lawful field, and a `null` in stored content would have thrown. Both got tests and fixes in the same GREEN commit (`isAbove`, the `isRecord` checks; "stored content it cannot read"). The stub class `TransactionEngineNotBuiltError` went with the last stub.

```
 Test Files  6 passed (6)
      Tests  352 passed (352)
```

## F. Refactor and the last tests

`cc7d4c67` reads the windows of a digit run by index. The worst case, 65,536 characters of `1 1 1 …`, went from 43.4 ms to 27.2 ms of CPU per call in this environment (`cat /proc/loadavg`: `2.75 3.44 3.64`). A `string` field holds at most 1,024 characters, so the worst case needs a `json` value. The test's CPU budget is measured in CPU time and is now 500 ms: under coverage instrumentation the first run failed the old 250 ms budget, in a test file that took 397 ms in all.

`cc7d4c67` also adds the test that ties the walk's `schemaPointer` to `jsonFieldSchemasOf`'s `pointer`. The next commit covers the walker a `file` item reaches.

## What ajv does with what the allowlist passes

A scratch script compiled shapes the allowlist accepts, with the API's ajv 8.20.0 and `new Ajv({ strict: true, allErrors: false })`:

```
ok    type:object
ok    empty
THROW properties no type :: strict mode: missing type "object" for keyword "properties" at "#" (strictTypes)
THROW required no properties :: strict mode: required property "a" is not defined at "#" (strictRequired)
ok    required declared
THROW minimum no type :: strict mode: missing type "number" for keyword "minimum" at "#" (strictTypes)
THROW minLength no type :: strict mode: missing type "string" for keyword "minLength" at "#" (strictTypes)
THROW minLength wrong type :: strict mode: missing type "string" for keyword "minLength" at "#" (strictTypes)
THROW maxItems no type :: strict mode: missing type "array" for keyword "maxItems" at "#" (strictTypes)
THROW items no type :: strict mode: missing type "array" for keyword "maxItems" at "#" (strictTypes)
ok    array ok
THROW additionalProperties false no type :: strict mode: missing type "object" for keyword "additionalProperties" at "#" (strictTypes)
ok    additionalProperties false
ok    enum
THROW enum dup :: schema is invalid: data/enum must NOT have duplicate items (items ## 0 and 1 are identical
ok    const
ok    integer
ok    exclusive
ok    title
ok    min over max
```

So `api-transactions` must compile inside a `try` at publish and answer `field_schema_invalid` at that schema's pointer for a throw.

## Final gates

Run in the foreground, each read by its exit code, while `foundation-7b` was still working in the shared tree:

```
$ pnpm --filter @openverify/core typecheck      rc=0
$ pnpm --filter @openverify/core lint           rc=0
$ pnpm --filter @openverify/core test           rc=0
 Test Files  32 passed (32)
      Tests  1174 passed (1174)
All files          |   99.92 |    98.45 |     100 |   99.92 |
 src/transactions  |     100 |    99.26 |     100 |     100 |
$ pnpm format:check                             rc=0
$ pnpm turbo run lint typecheck --force --continue    rc=2
 Tasks:    27 successful, 30 total
Failed:    @openverify/api#lint, @openverify/api#typecheck, @openverify/db#lint
```

`pnpm turbo run lint typecheck --force` is **not passed**. Five runs read red, each only in another agent's paths, and no `@openverify/core` task failed in any of them: `packages/db/src/identifier-key.test.ts:89` (committed, `10df6b79`), `apps/api/src/jobs/list-queues.test.ts`, `apps/api/src/services/retention.test.ts`, `apps/api/src/worker.ts` and `apps/api/src/jobs/repeatable/index.ts` (work in progress in the tree). The second-to-last run read 28 of 30, with `pnpm format:check` red on `apps/api/src/routes/dashboard/settings-lists.test.ts`; the last read rc 0 on format.

## Report (transaction-schemas)

### handoff

How to run: `source scripts/env.sh`, then `pnpm --filter @openverify/core exec vitest run src/transactions --coverage.enabled=false` (354 tests in 6 files, under a second).

Everything below is exported from `@openverify/core` (`packages/core/src/transactions/engine.ts`, one file per concern). Contracts re-exports the Stage 1a names only, so import these from core.

Functions:
- `transactionTypeVersionProblems(content: Omit<TransactionTypeVersionContent, 'id'>): FieldProblem[]`: everything at publish. Pointers are relative to the version's attributes.
- `fieldsValidatorOf(content: TransactionTypeVersionContent): FieldsValidator`: cached by `content.id`, at most 256 versions, least recently used first; a read holding other content under the same id gets a validator of what it holds.
- `FieldsValidator`: `(fields, options?: { partial?: boolean }) => FieldsValidation`. `partial: true` is a `PATCH`: an absent top-level field keeps its value, so `required` and defaults do not apply; a given `hash` is still held whole.
- `jsonSchemaKeywordProblems(schema: unknown): FieldProblem[]`: the pure allowlist; pointers relative to the schema, `''` for its root.
- `jsonFieldSchemasOf(fieldSchemas: readonly FieldSchema[]): JsonFieldSchema[]`: `{ pointer, schema, defaultValue }` for every `json` field at any depth; `pointer` is `/field-schemas/1/config/item-schema/config/json-schema`.
- `isCardLike(value: string | number): boolean`.
- `transactionTextProblems(texts: TransactionTexts): FieldProblem[]`: `{ 'reference-id'?, tags?, label?, 'model-version'? }`; pointers `/reference-id`, `/tags/<i>`, `/label`, `/model-version`. It takes no opt-out on purpose.
- `transactionStatusProblems(statuses: readonly string[], status: string): FieldProblem[]`: `status_does_not_exist` at `/status`.
- `transactionRelationProblems(relationSchemas: readonly RelationSchema[], relationSchemaKey: string, targetObjectId: string): FieldProblem[]`: `relation_schema_unknown` at `/relation-schema-key` or `/target-object-id`. Cardinality `one` needs the stored rows, so it is the API's.
- `transactionTypeVersionDiff(previous: readonly FieldSchema[], next: readonly FieldSchema[]): TransactionTypeVersionDiff`: `{ deletedFields: string[], convertedFields: { key, from, to }[] }`, top-level fields, in the previous version's order.
- `readSourceKeyPath(values, path: string): unknown`: an alias's value, own properties of plain objects only, `undefined` otherwise.
- `FIELD_TYPES_SEARCHABLE`: `string`, `integer`, `number`, `boolean`, `datetime`, `email-address`, `date`, `choices`.

The meta-schema: `fieldSchemaSchema` and `relationSchemaSchema` (Stage 1a, unchanged) run per field inside `transactionTypeVersionProblems`, after a shape walk that stops at the fourth level, because `fieldSchemaSchema` overflows the stack at about 1,000 levels. On top of them, all `field_schema_invalid` unless stated:
- caps: 100 fields counting every level (`/field-schemas`); at most 3 `hash` or `array` containers on a path, a leaf inside the third being fine; 20 `searchable`; repeated keys per level;
- `never`: refused on `FIELD_TYPES_NEVER_REFUSED`; on `string` it needs `never-redact-acknowledged` and cannot be `searchable`;
- `searchable`: only `FIELD_TYPES_SEARCHABLE`;
- nested fields cannot be `searchable`, `write_once`, `never`, an alias or a `file`;
- `required` is refused on `file`;
- `source-key-path`: at most 3 segments of the key pattern, naming a declared non-alias field of the same type, through `hash` members only; an alias cannot be `required`, `searchable`, `write_once` or carry a `default-value`;
- each type: `min` over `max`, `min-date` over `max-date`, file bytes (with the defaults) and page counts, repeated options, labels of no option, `type/subtype` mime types;
- `relation_target_unsupported` at `.../config/target`, at any depth;
- `json-schema` through the allowlist, at any depth;
- every `default-value` through the same walk as a request, its problems under `.../default-value`;
- `card_number_refused` on defaults and options, lifted by `allowCardLikeStrings`;
- statuses: 1 to 50, the pattern, at most 64 characters, distinct, `created` first;
- relation schemas: at most 20, the shape, distinct keys.

The validator's error shape: `FieldProblem` is `{ code, pointer }` and nothing else. `FieldsValidation` is `{ values, problems, references, jsonValues }`. With any problem, `values` is `{}` and `references` and `jsonValues` are `[]`. At most 100 problems, in schema order. `pointer` is relative to `fields` (`/lines/1/sku`); prefix `/data/attributes/fields`. It names declared keys and indexes only: an unknown key answers its parent (`''` at the top), and a problem inside a `json` value answers the field, because a key a request made up can hold a value. Codes: `card_number_refused` for the guard, `field_schema_invalid` for everything else, a value that breaks its field included.

The walk: `string` (characters are code points; `sanitize: ['html']` removes `\p{Cc}` and trims, before the length and the guard), `integer`, `number`, `boolean`, `datetime` (with an offset; stored as sent), `email-address`, `date`, `choices` (`null` only with `allow-empty`), `multi-choices` (distinct; `[]` only with `allow-empty`), `array`, `hash` (strict unless `ignore-unknown-keys`, which drops the rest unwalked), `json` (any JSON but `null`, 64 KiB, depth 10), `platform-file` (`fil_` plus a ULID, goes in `references`), `relation-schema` (`ver_` plus a ULID, in `references` with its `target`). Refused from a JSON body: unknown keys, `file`, aliases, a field with `archived-at` or `deactivated-at` set. `null` is refused everywhere else, so a masked read sent back cannot blank a field. `''` and `[]` do not satisfy `required`, except `multi-choices` with `allow-empty`.

The guard's rule: a card-like value is a run of 13-19 digits, optionally separated by single spaces or hyphens, that passes Luhn. Text: a run is found anywhere in the text (after NFKC) and must not touch a letter or another digit; neighbouring groups of a longer run are tried too, so a date beside a card hides nothing. Numbers: integers of 13-19 digits by Luhn; 16-19 digits past `MAX_SAFE_INTEGER` are refused without Luhn, because `JSON.parse` has already changed their digits. It covers `string`, `email-address`, `choices`, `multi-choices`, `integer`, `number`, every string, number and key of a `json` value, at any depth, and defaults as they are applied. `allowCardLikeStrings` lifts it for field values only; `transactionTextProblems` has no opt-out.

What `api-transactions` must call:
1. **Publish:** `transactionTypeVersionProblems`, answering each problem's code at `/data/attributes` plus its pointer. Then, for each of `jsonFieldSchemasOf(fieldSchemas)`, `new Ajv({ strict: true, allErrors: false }).compile(schema)` **inside a `try`**, answering `field_schema_invalid` at that pointer for a throw: ajv refuses shapes the allowlist passes (`properties`, `required`, `additionalProperties`, a number, length or array keyword without the matching `type`; a `required` name not in `properties`; a repeated `enum` member), and a throw must never be a 500. Validate `defaultValue` with the compiled validator too. Then `transactionTypeVersionDiff(previousPublished, next)` for the two type events.
2. **A write:** `fieldsValidatorOf(version)(fields, { partial })`, with the pinned published version. Answer `card_number_refused` when any problem has it, else `field_schema_invalid`, with the problems as `errors[]`. Then run `jsonValues` through the ajv validator kept by `(version id, schemaPointer)`, and check each of `references`: the environment, the scope (`verifications:read`, `pii:view` for a selfie or portrait file), and `RELATION_TARGET_VERIFICATION_TYPES[target]`. Store `values`. `write_once` needs the stored row: compare the top-level keys of `values` with the fields whose `write-policy` is `write_once`, which `transactionTypeVersionProblems` keeps at the top level.
3. **Every write's texts:** `transactionTextProblems` on `reference-id`, tags (`add-tag`, `set-tags`, create, patch) and `label` and `model-version`.
4. **A status change:** `transactionStatusProblems(version.statuses, status)`.
5. **`add-relation` and `remove-relation`:** `transactionRelationProblems(version.relationSchemas, key, targetId)`.
6. **Serving an alias:** `readSourceKeyPath(values, path)`; it has no stored value of its own.

`searchable` fields are top-level and of `FIELD_TYPES_SEARCHABLE`, so `transaction_field_keys` has one value per field.

### contractDeviations

1. C104.3's "request validator built by walking them with zod": the validator is a tree of plain closures, and zod is used only on leaves (`z.email()`, `z.iso.date()`, `z.iso.datetime()`). zod 4.6.7 compiles a `z.object`'s keys into a `new Function` (`v4/core/schemas.js:1194-1214`, measured: 2 calls for one object), so an object built from a stored schema would generate code from it, which C104.3 forbids. A test spies on `globalThis.Function`.
2. Additions to the frozen engine surface, none breaking: `FieldsValidation` gains `references` and `jsonValues`; `FieldsValidator` gains the optional `{ partial }`; `FieldProblemCode` gains `relation_schema_unknown`, a contract code; new functions `transactionTextProblems`, `transactionStatusProblems`, `transactionRelationProblems`, `jsonFieldSchemasOf`, `readSourceKeyPath`; new constant `FIELD_TYPES_SEARCHABLE`. `TransactionEngineNotBuiltError` is gone.
3. `field_schema_invalid` also answers a request value that breaks its field. `FieldProblemCode` has no other fit, and `TRANSACTION_PROBLEM_STATUSES` is frozen. Exact change for `integration-7b`: `packages/contracts/src/problem.ts` says "(422, publish)"; it should read "(422): a rule of C104.2 or C104.3 broken across a version, or a value that breaks its field". The API must not reuse the golden problem's publish wording for a value.
4. C104.4's reading of "a run" and "every string leaf": a run inside text counts, so `card 4242 4242 4242 4242 exp` is refused; a run touching a letter or a digit does not, because a SHA-256 hex digest in a `reference-id`, which has no opt-out, would be refused about once in 230 (measured over 2,000,000 digests: 8,762 refusals, 0.44%); NFKC folds full-width digits; neighbouring groups of a longer run are tried, so a date beside a card hides nothing.
5. C104.4 on numbers: a number of 16-19 digits past `MAX_SAFE_INTEGER` is refused without Luhn, because `JSON.parse` has already changed its digits. A legitimate number that size in a `number` or `json` field is refused until the version opts out.
6. Guard positions beyond C104.4: keys of a `json` value; `default-value` and `options` at publish, because a version is stored in the clear and a default is copied into every transaction; `model-version` beside `label`. Not walked: `date`, `datetime`, `platform-file` and `relation-schema`, whose formats hold no free text, and the members `ignore-unknown-keys` drops, which are never stored.
7. C104.2 caps as read: "100 fields" counts every level; "3 levels" counts the `hash` and `array` containers on a path, so a leaf inside the third is lawful and a fourth container is refused.
8. Publish refusals beyond C104.2, narrowing the shared config: nested `searchable` (`filter[identifier][key]` cannot name a nested field), nested `write_once` (only top-level writes are compared), nested `never` (a `hash` or `array` cannot be `never`, so neither can part of one), nested `source-key-path`, a nested `file` (`PUT .../files/:field-key` cannot address one), `required` on a `file` (no JSON body can hold one, so every create would fail), `searchable` outside `FIELD_TYPES_SEARCHABLE` (C105.4 keys one value; public filterable fields exclude files, hashes and relations).
9. `source-key-path` beyond its syntax: it must name a declared, non-alias field of the same type, through `hash` members only; an alias cannot be `required`, `searchable`, `write_once` or carry a default. A dangling alias would read nothing forever, and a typed alias of another type would serve a wrong `type`.
10. Decisions C104 leaves open, for the docs: `null` is refused except on `choices` with `allow-empty`, so a masked read sent back cannot blank a field, and `PATCH` has no way to clear a field; `''` and `[]` do not satisfy `required`; a field with `archived-at` or `deactivated-at` set takes no write and is not required, whatever the timestamp says, since the engine holds no clock; a `json` value of `null` is refused; `datetime` values accept an offset and are stored as sent, while `default-value` stays UTC, as Stage 1a's union says.
11. C104.6 reads top-level fields only: `transactionTypeDeletedFieldMetaSchema['field-key']` and the converted schema use the key pattern, which has no form for a nested path, so a dropped or converted `hash` member or `array` item raises no event. To report them, contracts must widen `field-key` to a dotted path, and the diff must walk `childFields`.
12. Depth means containers, with the root at 1, for both the schema and the value. A schema's `properties` counts, so depth 10 is about 5 nested subschemas.
13. One existing test changed with the plan: "the engine stub" in `packages/core/src/transactions/field-schemas.test.ts`, which asserted the stub throws, now names the area.

### followups

- `api-transactions`: compile each `json` schema inside a `try` at publish and answer `field_schema_invalid` at its pointer; ajv with `strict: true` refuses shapes the allowlist passes (listed in the handoff, with the scratch run in this file).
- `api-transactions` or `integration-7b`: a body nested about 1,000 levels deep throws `RangeError` inside `fieldSchemaSchema`, so `createTransactionTypeBodySchema`, `createTransactionTypeVersionBodySchema` and `updateTransactionTypeVersionBodySchema` would raise it at the route. The body stays under the default limit at about 70 KB. It needs a nesting check before zod reads the body, as `shapeProblems` in `packages/core/src/transactions/version-rules.ts` does. The engine itself never throws on it.
- `integration-7b`, `docs/transactions/README.md`: an `integer` or `number` of 13 digits holding epoch milliseconds passes Luhn one time in ten and is refused. The docs should point such fields at `datetime` or at `allow-card-like-strings`. Also document the decisions of contractDeviations 8 to 10.
- `integration-7b`: the `problem.ts` comment of contractDeviations 3.
- Owner or `api-transactions`: `max-file-size-bytes` has no ceiling in `fieldSchemaSchema` or `TRANSACTION_LIMITS`. C105.2's byte counter stops at the field's own value, so an operator can allow any size. A ceiling is a constant to choose, so it is not invented here.
- Owner: whether a nested member's deletion or conversion should raise a type event (contractDeviations 11).
- `foundation-7b`: at this agent's last run `pnpm turbo run lint typecheck --force --continue` read rc 2 only in its paths: `packages/db/src/identifier-key.test.ts:89` (`no-unnecessary-type-assertion`, committed in `10df6b79`), and, in progress in the tree, `apps/api/src/jobs/list-queues.test.ts`, `apps/api/src/services/retention.test.ts`, `apps/api/src/worker.ts` and `apps/api/src/jobs/repeatable/index.ts`. That gate is not passed by this agent.

### measurements

- `@openverify/core`: 1,174 tests in 32 files, 3.80 s, load 17.9. Statements 99.92%, branches 98.45%, functions 100%, lines 99.92%.
- `src/transactions`: 354 tests in 6 files. Statements 100%, branches 99.26%, functions 100%, lines 100%.
- `isCardLike`, worst case, 65,536 characters of `1 1 1 …`: 27.2 ms of CPU per call (43.4 ms before the refactor); 65,535 digits followed by a letter: 0.7 ms; load 2.75. Not taken under the e2e lock: this is a shape check for the code, not a budget.
- `fieldSchemaSchema.safeParse`: passes at 200 levels, throws `RangeError` at 1,000.
- A SHA-256 hex digest holds a Luhn-passing run of 13-19 digits in 0.44% of 2,000,000 digests, which the letter boundary leaves alone.
