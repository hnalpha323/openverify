# TDD evidence: Workflow 7B Stage 1a, `contracts-7b` (Phase 7)

- **Slice owner:** the Workflow 7B Stage 1a `contracts-7b` agent, running alone (it may touch any path its deliverables need).
- **Date:** 2026-10-31.
- **Base:** `919c95b3`.
- **Input:** the "Stage 1a: contracts-7b" bullet of `docs/plans/phase-7.plan.md`, committed in its order: common, then (L), then (T), then (G). The drift and the decisions are in the plan's "Workflow 7B Stage 1a amendments (contracts-7b)".

Each change follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles and type-checks; the test, run to see it fail for the intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`), then a refactor with the suite green where one was worth making.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every value in these tests and fixtures is synthetic: addresses from the documentation ranges, emails at `example.test` and `example.org`, phone numbers from the fictional range, fictional names and points.

## 0. Starting point, re-verified (`33e1e6f9`)

Amendments 1 to 8. In short: 7A's amendments hold; `identifierKey` is `identifierKey(key, { environmentId, kind, input })`, so 7B's labels are new kinds; list and graph keys take the stored 64-hex device HMAC as their key input; the name kinds live in `packages/watchlist/src/list-keys/`; `normalizeIdentificationNumber` moves to core; `report_matches.source_id` is plain text, so only the contract refuses a list id; `transaction` is `{ data: null }` on reports and absent on inquiries and verifications.

## 1. Common: scopes, policies, the list count, dependencies, the log rule (C90.2, C90.3, C97.3, C102.1, C105.6, C107.3)

Stub `7e3953b9`; RED `f92c44f7`; GREEN `5902f612`.

RED:
```
$ (cd packages/core && pnpm exec vitest run src/permissions.test.ts src/signal-registry.test.ts src/identification-number.test.ts --coverage.enabled=false)
     × reads "l898 902-c3" as "L898902C3": upper case, only A-Z and 0-9 kept      (and 3 more)
     × keeps the Phase 1 scopes first, then adds the C12 scopes, and those of Phases 5, 6 and 7
     × keeps graph results from viewers, because they are profiling (P11, F29)
     × gives developers every list, graph and transaction scope but redaction
     × holds the thirteen 7A signals and the 7B list count in the catalogue order
     × pins every entry and the collector by version (golden)      (14 failed in all)
$ (cd packages/contracts && pnpm exec vitest run src/rate-limits.test.ts src/signals.test.ts --coverage.enabled=false)
     × have their policies with their default limits per window (C72.5, C107.3)
     × give each policy its window: 60 s by default, an hour for the handoff issues (F09)
     × holds the list reasons, which only inquiry/list_match_count carries (H02, H11)
      Tests  4 failed | 22 passed (26)
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)      Tests  35 failed | 97 passed (132)
$ (cd packages/checks && pnpm exec vitest run src/lists-dependencies.test.ts --coverage.enabled=false)      Tests  3 failed (3)
$ (cd apps/api && pnpm exec vitest run src/plugins/rate-limit.test.ts src/services/publish/signal-config.test.ts --coverage.enabled=false)
     × uses the C12 defaults, each in its policy window
     × refuses a rule on the real inquiry/list_match_count entry: on-list-match covers it (F31)
      Tests  2 failed | 28 passed (30)
```

**A defect of the RED commit, recorded.** `signals.test.ts` indexed `ON_NULL_DEFAULTS` by the three new reasons, which the RED tree's type did not hold, so `f92c44f7` failed `tsc` in `packages/contracts` (the output of the check was hidden by a pipe). GREEN `5902f612` added the reasons. Every later RED ran `pnpm turbo run typecheck` and read its answer first.

GREEN: core 45 passed, then the whole package 797; contracts 26, then 2,282 + the two tests below; config 187; checks `src/signals` and the dependencies 157; API 37 + dashboard routes, `openapi.test`, seed and auth 310; db `blind-index` 41; `pnpm turbo run lint typecheck --force`: 30 of 30, so the new refused log keys touch no existing call. Four pinned lists changed with the plan: `API_SCOPES` in `vocabulary.test.ts`, the role fixture `contracts/fixtures/api/role.json` (and `role-options.test.ts`'s reviewer list), the developer, reviewer and viewer lists in `permissions.test.ts`, and `compute.test.ts`'s default set, which now leaves the list count out as `COMPUTED_SIGNAL_NAMES` does. `pnpm install` wrote `csv-parse`, `csv-stringify` and a direct `ajv`; no `minimumReleaseAgeExclude`, no build script, `allowBuilds` unchanged.

## 2. (L) lists and importers: the kinds, the resources, list-config, the importer shapes, the graph kinds, `custom-list` (C97-C100, C101.2, C106.2)

Stub (the commit before `0ef38629`); RED `0ef38629`; GREEN `347c536b`; fix (the next commit).

RED:
```
$ (cd packages/core && pnpm exec vitest run src/lists.test.ts src/report-registry.test.ts --coverage.enabled=false)      Tests  13 failed | 10 passed (23)
$ (cd packages/contracts && pnpm exec vitest run src/lists.test.ts src/report-custom-list.test.ts src/fixtures.test.ts src/vocabulary.test.ts src/inquiry-template-versions.test.ts --coverage.enabled=false)
      Tests  84 failed | 247 passed (331)
$ (cd packages/db && pnpm exec vitest run src/phase7-report-types.test.ts src/migrate.test.ts --coverage.enabled=false)
     × recreates the two report_type CHECK constraints in 0024 with the custom-list type (C106.2)
     × accepts a template and a report of the custom-list type (C106.2)
      Tests  2 failed | 28 passed (30)
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
     Error: ENOENT: no such file or directory, open '.../contracts/fixtures/api/list.json'
$ (cd apps/api && pnpm exec vitest run src/seed/report-templates.test.ts --coverage.enabled=false)      Tests  3 failed | 1 passed (4)
```
`pnpm turbo run typecheck` read 6 of 6 before the commit. The stubs are names only (`z.any()`, typed empty lists), so a RED test that uses a report type before it exists reads its tables by a wide key; the casts left at GREEN, and lint proves it (`no-unnecessary-type-assertion`).

GREEN: core 816 + `graph-kinds` 8; contracts 2,436 + the event and screening-detail tests; db 70; node 270; checks entry 14; watchlist 9 of those touched; API `src/seed src/routes src/services/reports src/jobs/report-types src/jobs/reports src/webhooks src/events src/openapi.test.ts src/report-docs.test.ts`: 1,953; dashboard `src/lib src/components/reports src/components/report-config src/app/reports`: 2,248; Android `ContractFixturesTest` clean; `pnpm turbo run lint typecheck --force` 30 of 30. `drizzle-kit generate --name phase7b` after `pnpm --filter @openverify/core build` wrote `0024_phase7b.sql` (two drops, two adds).

Tests corrected at GREEN, none weakened: the fixtures use `example.test`, as the golden fixtures' rule says (`fixtures.test.ts`), not `example.org`; `id-class` takes the C31 class (`passport`), not the public `pp`; the on-demand answer's `matches` is marked PII, because the name is PII on reports and the collision test holds a name PII everywhere (it names items, never a value); `rsc-payload.test.tsx` built ids by appending an index, which broke at the eleventh report type.

**A defect of the GREEN commit, recorded.** `347c536b` went in with a type error in the new `completion-custom-list.test.ts`: the turbo line's answer was piped to `grep` and the commit followed it in the same call. The next commit fixed it. Every later commit reads `PIPESTATUS` first.

## 3. (T) transactions: the field types, the union, the resources, the relationship (C104, C105, C105.7)

Stub (the commit before the RED); RED (`test(core,contracts,node): the fifteen field types`); GREEN `24f3af61`.

RED:
```
$ pnpm turbo run typecheck --filter=@openverify/core --filter=@openverify/contracts --filter=@openverify/node      Tasks: 3 successful, 3 total (rc=0)
$ (cd packages/core && pnpm exec vitest run src/transactions --coverage.enabled=false)      Tests  19 failed | 17 passed (36)
$ (cd packages/contracts && pnpm exec vitest run src/transactions.test.ts src/fixtures.test.ts src/vocabulary.test.ts --coverage.enabled=false)      Tests  49 failed | 263 passed (312)
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
     Error: ENOENT: no such file or directory, open '.../contracts/fixtures/api/transaction.json'
```
GREEN: core 852; contracts 2,531; node 289; API `src/webhooks src/events src/openapi.test.ts`: 441; dashboard `src/lib`: 1,972, `src/components/reports src/components/integrations`: 156; Android `ContractFixturesTest` clean; `pnpm turbo run lint typecheck --force`: 30 of 30, `rc=0`.

Corrected at GREEN: `.meta({ pii: true })` on the `fields` body sat under `.optional()`, so the collision test saw a non-PII member (`createTransactionBodySchema.fields`): the mark moved outermost, as the inquiry bodies have it. The existing report test that refused a transaction id was the one C105.7 amends: it now accepts one.

## 4. (G) graph: the template config, the resources, the bulk bodies (C102, C103)

Stub (the commit before `f3fb875e`); RED `f3fb875e`; GREEN `f881d796`.

RED:
```
$ pnpm turbo run typecheck --filter=@openverify/core --filter=@openverify/contracts --filter=@openverify/node      Tasks: 3 successful, 3 total (rc=0)
$ (cd packages/core && pnpm exec vitest run src/graph-queries.test.ts --coverage.enabled=false)      Tests  4 failed (4)
$ (cd packages/contracts && pnpm exec vitest run src/graph-queries.test.ts src/fixtures.test.ts src/vocabulary.test.ts --coverage.enabled=false)      Tests  48 failed | 290 passed (338)
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
     Error: ENOENT: no such file or directory, open '.../contracts/fixtures/api/graph-query.json'
```
GREEN: core 856; contracts 2,612; node 303; API `src/webhooks src/events src/openapi.test.ts`: 390; dashboard `src/lib`: 1,972; Android `ContractFixturesTest` clean; lint and typecheck 30 of 30, `rc=0`.

## 5. Records (C109)

`e43a7131`: the PLAN's Lists, Transactions, graph UI and Phase 7 rows; the surface index's face importer path, the `field` importer type, list kinds 12 and 13, `graph-query.submitted` and `transaction-type.converted-field`. `THIRD_PARTY_LICENSES.md` §2.1.12 landed with the dependencies (`5902f612`).

## 6. Final gates (foreground, on `b9b7ec4e`, the code unchanged since `f881d796`)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date, rc 0 |
| `pnpm turbo run lint typecheck --force`, `pnpm format:check` | 30 of 30, rc 0; Prettier clean, rc 0 |
| `pnpm turbo run test --force --filter='!@openverify/api'` | rc 0, every package above its 80% gate: core 856 (99.4 / 97.36 / 97.76 / 99.39), contracts 2,612 (99.12 / 93.67 / 98.52 / 99.11), checks 3,469 (98.61 / 91.51 / 99.01 / 98.58), db 1,220 (95.39 / 88.75 / 96.59 / 95.65), dashboard 3,970 (98.71 / 93.48 / 99.15 / 98.72), flow 1,088 (95.27 / 89.27 / 95.74 / 95.28), watchlist 724 (98.54 / 90.18 / 98.86 / 98.51), node 303 (98.7 / 93.69 / 100 / 98.93), emrtd 318, signals 186, config 187, flow-spec 117, e2e helpers 109, ui 54; load 1.56 at the start, about 8 minutes |
| API suite (two blob shards and a merge) | the merge rc 0: 372 files, 4,989 passed; 96.16 / 88.35 / 97.9 / 96.2. Each shard exits 1 on its own part of the coverage (77% and 75%), with no failed test; the merge applies the 80% gate to the whole, as rule 8 says. Shards about 3 minutes each at loads 3 and 9 |
| `pnpm test:integration` | rc 0: db 65 in 14 files (121 s), API 172 in 31 files (243 s), load 4.6. The first call failed before any test: `ENOTEMPTY ... rmdir node_modules/.vitest-cache`, two vitest processes clearing one cache directory at startup, right after the API merge wrote it. No test ran; see followups |
| Android gate | BUILD SUCCESSFUL in 1 min 31 s, rc 0 |
| `benchmark:typecheck`, `benchmark:test` | rc 0 |
| `openapi:write` twice | the second changed nothing |
| `bash infra/tests/ci-workflow.test.sh` | 209 passed, 0 failed |
| e2e gate | mocked flow 79 passed (23.1 s, load 11.3); `build` rc 0; fresh stack up (rc 0); full stack shard 1/3: 32 passed (1.6 min, load 4.1), 2/3: 34 passed (4.2 min, load 3.4), 3/3: 29 passed (3.5 min, load 1.3); 95 in all; stack down, no container left |

## Report (contracts-7b)

### Handoff

#### How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-contracts-7b.tdd.md`. Decisions: `docs/plans/phase-7.plan.md`, "Workflow 7B Stage 1a amendments (contracts-7b)", items 1-8 (re-verification), 9-26 (decisions).
- `drizzle-kit` reads `@openverify/core` from its `dist`: run `pnpm --filter @openverify/core build` before generating.

#### Checkpoint commits
- **Re-verification:** `33e1e6f9`.
- **Common:** stub `7e3953b9`; RED `f92c44f7`; GREEN `5902f612`.
- **(L):** stub `42bf49b8`; RED `0ef38629`; GREEN `347c536b`; fix `6408cacf`; record `3a8e2c94`.
- **(T):** stub `2d599375`; RED `f65a965d`; GREEN `24f3af61`.
- **(G):** stub `55731592`; RED `f3fb875e`; GREEN `f881d796`.
- **Records:** `e43a7131`; amendments `b9b7ec4e`.

#### Scopes and roles (`packages/core/src/permissions.ts`)
New `API_SCOPES`: `lists:read`, `lists:write`, `importers:read`, `importers:write`, `graph:read`, `graph:write`, `transactions:read`, `transactions:write`, `transactions:redact`, `transaction-types:write`. `NOT_FOR_VIEWERS` gains `graph:read`. Developer: all but `transactions:redact`. Reviewer: all but `importers:write` and `transaction-types:write`. Viewer: `lists:read`, `importers:read`, `transactions:read`. Admin: all. Dashboard: areas `lists`, `graph`, `transactions` in `PERMISSION_INFO`.

#### Rate limits (`packages/contracts/src/rate-limits.ts`)
`lists-write` 600/60 s, `lists-match` 60/60 s, `importers` 10/3,600 s, `graph-queries` 30/60 s (with the existing `graph-unmask` 60/60 s). Labelled in the rate-limit panel. None enforced: each route owner enforces its policy as `consumeReportRate` does.

#### Migration and links
`packages/db/drizzle/0024_phase7b.sql` (`pnpm --filter @openverify/core build`, then `pnpm exec drizzle-kit generate --name phase7b` in `packages/db`), dropping and recreating `reports_report_type_valid` and `report_templates_report_type_valid` with `custom-list`. `foundation-7b` extends this one file and never adds a 0025. Links: `@openverify/signals` (`workspace:*`) on `packages/checks`, through the narrow `@openverify/signals/address` export (`parseAddress`, `parseNetwork`); never `@openverify/signals/network`. Dependencies through the catalog: `csv-parse` 7.0.3 and `ajv` 8.20.0 on `apps/api`, `csv-stringify` 6.9.0 on `packages/checks`. `normalizeIdentificationNumber` moved to `@openverify/core` (`identification-number.ts`), re-exported by `packages/db/src/blind-index.ts`.

#### Signals
`inquiry/list_match_count` (R, `ga`, server, `default: true`, `reviewRule: false`, `inputs: ['lists']`, version 1), last in `SIGNAL_REGISTRY`, never in `COMPUTED_SIGNAL_NAMES`. `SIGNAL_NULL_REASONS` gains `list_screening_pending`, `list_unscreened`, `no_lists_selected` (`ON_NULL_DEFAULTS` `ignore`; mirrored in `packages/checks/src/signals/vocabulary.ts`). `signalDetailSchema` gains `list-screening` (`signalListScreeningSchema`: `status`, `unscreened[]`, `not-applicable[]`, `review-cause`).

#### Ids
Both tables: `lst`; `libf`, `lidf`, `lic`, `liea`, `lifc`, `ligl`, `ligin`, `liif`, `liip`, `lin`, `lipn`, `lisb`, `lis`; `lmt`; `mprt`; `txn`, `txntp`, `txntpv`, `txnl`, `txnf`; `grphq`, `grqt`, `grqtv`. `REDACTION_SUBJECT_ID_PREFIXES` is `foundation-7b`'s to extend.

#### Core (`packages/core/src/`, re-exported by contracts)
- **`lists.ts`:** `LIST_KINDS` (thirteen, singular: `browser-fingerprint`, `device-fingerprint`, `country`, `email-address`, `face`, `geolocation`, `government-id-number`, `field`, `ip-address`, `name`, `phone-number`, `selfie-background`, `string`), `listKindSchema`, `ListKind`; `LIST_KIND_REGISTRY[kind]` `{ kind, plural, itemPrefix, importer, biometric, screenedByAll, keyed }`; `IMPORTER_LIST_KINDS` (eleven); `toListResourceType`, `toListItemResourceType`, `toImporterResourceType`; `LIST_STATUSES`, `LIST_ITEM_STATUSES`, `LIST_EMAIL_MATCH_TYPES`, `LIST_ITEM_ARCHIVE_REASONS`; `LIST_LIMITS` (`activeListsPerEnvironment` 1,000, `itemsPerList` 1,000,000, `itemsPerBiometricList` 10,000, `radiusMeters` 500,000, `nameLength` 255, `stringValueLength` 255, `itemRetentionDays` 3,650, `dismissReasonLength` 500, `matchProbes` 20, `screenedLists` 50, `reportLists` 20); `IMPORT_LIMITS` (`fileBytes` 20,000,000, `rows` 100,000, `recordCharacters` 4,096, `errorsPerImport` 1,000, `objectRetentionDays` 7, `fileIdempotencyHours` 24); `IMPORTER_STATUSES`, `IMPORTER_MODES`, `IMPORT_ERROR_CODES` (the twelve of C100.4); `LIST_MATCH_METHODS`, `LIST_MATCH_STATUSES`, `LIST_MATCH_TIERS`, `LIST_UNSCREENED_REASONS` (eleven), `LIST_NOT_APPLICABLE_REASONS`, `LIST_SCREENING_STATUSES`, `LIST_REVIEW_CAUSES`, `LIST_PROBE_SOURCES` (sixteen), `LIST_KEY_KINDS` (fourteen `identifier-*`), `LIST_MATCH_CONSTANTS` (`fuzzy-name-candidate-cap` 2,000, `face-list-threshold` 0.5, `background-candidates` 5, `biometric-cache-bytes`, `biometric-cache-idle-minutes`).
- **`graph-kinds.ts`:** `GRAPH_KINDS` with `GRAPH_KIND_REGISTRY[kind]` `{ kind, code, strength, key, identifiesPerson, needsDeviceRecognition }`. Strong: `government_id_number` 1, `chip_signature` 2, `crypto_address` 3, `email_address` 4, `phone_number` 5, `reference_id` 8. Medium: `email_address_unconfirmed` 6, `phone_number_unconfirmed` 7, `name_birthdate` 9, `address` 10, `device_fingerprint` 11. Weak: `device_class` 12, `browser_fingerprint` 13, `ip_address` 14, `name` 15, `birthdate` 16, `postal_code` 17, `email_domain` 18. Also `GRAPH_STRENGTHS`, `GRAPH_WEAK_KINDS`, `GRAPH_STRONG_KINDS`, `GRAPH_PERSON_KINDS`, `graphKindCode`, `graphKindOfCode`.
- **`graph-queries.ts`:** `GRAPH_QUERY_STATUSES`, `GRAPH_TEMPLATE_STATUSES`, `GRAPH_TEMPLATE_VERSION_STATUSES`, `GRAPH_MAX_HOPS` (2, 4, 6), `GRAPH_LIMITS` (`parameters` 10, `startClauses` 5, `defaultMaxHops` 4, `weakMaxHops` 4, `defaultNodeLimit` 100, `nodeLimit` 2,000, `defaultFanOut` 50, `fanOut` 500, `defaultTimeoutSeconds` 30, `timeoutSeconds` 59, `syncTimeoutSeconds` 10, `syncPerEnvironment` 2, `bulkAccounts` 500, `exportRows` 2,000, `defaultRetentionDays` 30, `retentionDays` 365), `GRAPH_BULK_ACTIONS`, `GRAPH_BULK_OUTCOMES`.
- **`transactions/field-types.ts`:** `FIELD_SCHEMA_TYPES` (fifteen), `FIELD_KEY_PATTERN`, `FIELD_REDACTION_POLICIES`, `FIELD_WRITE_POLICIES`, `FIELD_TYPES_NEVER_REFUSED`, `FIELD_SANITIZERS`, `RELATION_SCHEMA_TARGETS`, `RELATION_TARGET_VERIFICATION_TYPES`, `RELATION_TARGETS_UNSUPPORTED`, `RELATION_SCHEMA_OBJECTS`, `RELATION_SCHEMA_CARDINALITIES`, `JSON_SCHEMA_ALLOWED_KEYWORDS` (seventeen), `TRANSACTION_LIMITS` (`fieldsPerVersion` 100, `nestingLevels` 3, `searchableFields` 20, `stringDefaultLength` 255, `stringMaxLength` 1,024, `options` 200, `arrayItems` 1,000, `fileDefaultMaxBytes` 10,000,000, `fileDefaultMinBytes` 1, `jsonSchemaBytes` 16,384, `jsonSchemaDepth` 10, `jsonValueBytes` 65,536, `jsonValueDepth` 10, `sourceKeyPathSegments` 3, `statuses` 50, `statusLength` 64, `relationSchemas` 20, `relatedObjects` 100, `objectIds` 100, `labelLength` 64, `modelVersionLength` 64, `referenceIdLength` 255, `retentionDays` 3,650), `TRANSACTION_STATUS_PATTERN`, `TRANSACTION_RESERVED_STATUS`, `DEFAULT_TRANSACTION_STATUSES`, `TRANSACTION_TYPE_VERSION_STATUSES`, `TRANSACTION_TYPE_STATUSES`.
- **`transactions/field-schemas.ts`:** `fieldSchemaSchema` (a `z.ZodType<FieldSchema>`, recursive through `array`'s `item-schema` and `hash`'s `item-schemas`), `FieldSchema`, `FieldSchemaConfig`, `relationSchemaSchema`, `RelationSchema`.
- **`transactions/engine.ts` (stubs, owner `transaction-schemas`):** `TRANSACTIONS_AREA`, `TransactionEngineNotBuiltError`, `FieldProblemCode`, `FieldProblem`, `TransactionTypeVersionContent`, `FieldsValidation`, `FieldsValidator`, `TransactionTypeVersionDiff`, `transactionTypeVersionProblems`, `fieldsValidatorOf`, `jsonSchemaKeywordProblems`, `isCardLike`, `transactionTypeVersionDiff`.
- **`report-registry.ts`, `report-config.ts`:** `custom-list` (`R`, `H`, `beta`, `review: matches`, `sourceKind: null`, `recurrable: true`, the six events; keys `recurrence-interval-days`, `pause-on-match`, `resume-delay-minutes`, `list-ids` default `null`).

#### Stubs left to `list-logic`
- `packages/checks/src/lists/index.ts`: `LISTS_AREA`, `LIST_KEYS_VERSION` (`lists-1`), `ListKeyInput`, `ListKeyInputError(code)`, `ListLogicNotBuiltError`, `KeyedListKind`, `ListValue`, `ListKeyOptions`, `listKeyInputs`, `listProbeKeyInputs`, `graphKeyInput`, `importColumns`.
- `packages/checks/src/csv/index.ts`: `CSV_AREA`, `CsvWriterNotBuiltError`, `writeCsv`, `neutraliseCell`, `stripNeutraliser`.
- `packages/watchlist/src/list-keys/index.ts`: `WATCHLIST_LIST_KEYS_AREA`, `ListNameKeysNotBuiltError`, `ListName`, `listNameKeyInputs`, `listLastNameKeyInputs`, `graphNameBirthdateKeyInputs`, `graphNameKeyInputs`; `list-keys-version.test.ts` pins `lists-1` beside `names-2` and the C78 forms.

#### Contracts: lists (`packages/contracts/src/lists.ts`)
- **Resources:** `LIST_RESOURCE_SCHEMAS`, `listResourceSchema` (`list/<kind>`, `lst`), `listResourceDocumentSchema` (with `meta`, `listLimitsMeta(kind)`, `listLimitsMetaSchema`), `listResourceListDocumentSchema`; `LIST_ITEM_RESOURCE_SCHEMAS`, `listItemResourceSchema` (`list-item/<kind>`), `listItemDocumentSchema`, `listItemListDocumentSchema`, `listItemRelationshipsSchema` (`list`, `creator`); `listMatchResourceSchema`, `listMatchAttributesSchema`, `listMatchRelationshipsSchema` (`list`, `list-item`, `inquiry`, `account`), `listMatchDocumentSchema`, `listMatchListDocumentSchema`.
- **Bodies:** `LIST_CREATE_BODY_SCHEMAS[kind]`, `updateListBodySchema`, `LIST_ITEM_CREATE_BODY_SCHEMAS[kind]`, `matchListsBodySchema`, `listProbeSchema`, `dismissListMatchBodySchema`. **Queries:** `listListsQuerySchema`, `listListItemsQuerySchema`, `listListMatchesQuerySchema`.
- **Answers:** `matchListsResponseSchema` (`list-match-result`), `listMatchResultSchema`, `listUnscreenedSchema`, `listNotApplicableSchema`.
- **`listConfigSchema`**, `resolvedListConfigSchema`, `listConfigScreenSchema`, `resolveListConfig`; `list-config` on the version resource and bodies; `InquiryTemplateVersionRecord.listConfig`.
- **`reportListProvenanceSchema`**, `ReportListProvenance`. **PII:** `PII_LIST_ATTRIBUTES` = `value`, `latitude`, `longitude`, `radius-meters`, `id-number`, `field-value`, `name-first`, `name-last`, `probes`, `matched-value`, `reason`, `matches`. **Builders:** `buildListResource`, `buildListItemResource`, `buildListMatchResource`.
- **Identifiers (`identifiers.ts`):** `LIST_RESOURCE_TYPES`, `LIST_ITEM_RESOURCE_TYPES`, `IMPORTER_RESOURCE_TYPES`, `listResourceTypeSchema`, `listItemResourceTypeSchema`, `importerResourceTypeSchema`, `listIdentifierSchema`, `listItemIdentifierSchema`, `importerIdentifierSchema`, `listItemCreatorIdentifierSchema`, `ListItemCreator`, `transactionIdentifierSchema`.

#### Contracts: importers (`packages/contracts/src/importers.ts`)
`IMPORTER_RESOURCE_SCHEMAS`, `importerResourceSchema` (`importer/list-item/<kind>`, `mprt`), `importerAttributesSchema`, `importerRelationshipsSchema`, `importerDocumentSchema`, `importerListDocumentSchema`, `listImportersQuerySchema`, `createImporterBodySchema` (JSON, `file` base64 PII), `importerEncodingSchema`, `importerErrorSchema` (`{ row, column, code }`), `importerErrorListDocumentSchema`, `listImporterErrorsQuerySchema` (`page[after]` is a row), `PII_IMPORTER_ATTRIBUTES` (`file`), `buildImporterResource`.

#### Contracts: transactions (`packages/contracts/src/transactions.ts`)
`transactionTypeResourceSchema`, `transactionTypeDocumentSchema`, `transactionTypeListDocumentSchema`, `listTransactionTypesQuerySchema`, `createTransactionTypeBodySchema`, `updateTransactionTypeBodySchema`; `transactionTypeVersionResourceSchema`, `transactionTypeVersionDocumentSchema`, `createTransactionTypeVersionBodySchema`, `updateTransactionTypeVersionBodySchema`, `publishTransactionTypeVersionBodySchema`; `transactionResourceSchema`, `transactionAttributesSchema`, `transactionRelationshipsSchema`, `transactionRelatedObjectSchema`, `transactionDocumentSchema`, `transactionListDocumentSchema`, `TRANSACTION_INCLUDES`, `getTransactionQuerySchema`, `listTransactionsQuerySchema`, `transactionFieldValueSchema`, `transactionFileValueSchema`, `transactionFieldKeySchema`, `transactionStatusSchema`; `createTransactionBodySchema`, `updateTransactionBodySchema`, `redactTransactionBodySchema`, `redactTransactionBiometricsBodySchema`, `transactionObjectsBodySchema`, `transactionRelationBodySchema`, `labelTransactionBodySchema`; `transactionLabelResourceSchema`, `transactionLabelDocumentSchema`, `transactionLabelIdentifierSchema`; `transactionRelationMetaSchema`, `transactionTypeDeletedFieldMetaSchema`, `transactionTypeConvertedFieldMetaSchema`; `PII_TRANSACTION_ATTRIBUTES` = `fields`, `content`, `filter[identifier][value]`; builders `buildTransactionTypeResource`, `buildTransactionTypeVersionResource`, `buildTransactionResource`, `buildTransactionLabelResource`. `transaction` relationship: required on reports (`ReportRecord.transactionId`), optional on inquiries (`InquiryRecord.transactionId`, `transactionRelationship`) and verifications (`VerificationRecord.transactionId`).

#### Contracts: graph (`packages/contracts/src/graph-queries.ts`)
`graphQueryTemplateConfigSchema`, `graphQueryTemplateFiltersSchema`, `GRAPH_PARAMETER_KINDS`, `graphParameterKindSchema`, `graphParameterNameSchema`, `resolveGraphQueryTemplateConfig`, `graphTemplateConfigProblems` (`weak_kind_not_allowed`, `graph_parameter_unbound`, with pointers); `graphQueryTemplateResourceSchema`, `graphQueryTemplateDocumentSchema`, `graphQueryTemplateListDocumentSchema`, `listGraphQueryTemplatesQuerySchema`, `createGraphQueryTemplateBodySchema`, `updateGraphQueryTemplateBodySchema`; `graphQueryTemplateVersionResourceSchema`, `graphQueryTemplateVersionDocumentSchema`, `createGraphQueryTemplateVersionBodySchema`, `updateGraphQueryTemplateVersionBodySchema`, `publishGraphQueryTemplateVersionBodySchema`; `graphQueryResourceSchema`, `graphQueryAttributesSchema`, `graphQueryRelationshipsSchema`, `graphQueryDocumentSchema`, `graphQueryListDocumentSchema`, `listGraphQueriesQuerySchema`, `createGraphQueryBodySchema`, `rerunGraphQueryBodySchema`, `cancelGraphQueryBodySchema`; `graphNodeIdSchema` (`gn_` + 22 base64url), `graphNodeSchema`, `graphLinkSchema`, `graphNodeValueDocumentSchema` (`graph-node-value`); `graphQueryActionAttributesSchema`, `graphQueryActionBodySchema`, `graphQueryActionResultDocumentSchema` (`graph-query-action`); `PII_GRAPH_ATTRIBUTES` = `params`, `parameter-map`, `variable-map`, `value`; builders `buildGraphQueryTemplateResource`, `buildGraphQueryTemplateVersionResource`, `buildGraphQueryResource`.

#### Custom list report
`customListQuerySchema`, `customListReportResourceSchema` (`matched-lists` PII, `lists-searched`, `unscreened`, `not-applicable`, `ignore-list`, `matches`; `sources` is `reportListProvenanceSchema[]`), `reportSourceIdSchema`, `ReportRecord.listSources`, `government_id_country`. Job stub `apps/api/src/jobs/report-types/custom-list.ts` (`customListReportJob`, `REPORT_TYPE_JOBS`); the completion case returns an empty query; `services/reports/resources.ts` reads provenance through the schema; seed name `Default custom list` (22 and 16 templates); `docs/reports/custom-list.md` and its README row.

#### Events
`LIST_MATCH_EVENT_NAMES` (`list-match.created`); `TRANSACTION_EVENT_NAMES` (`transaction.created`, `.status-updated`, `.updated-fields`, `.labeled`, `.redacted`, `.added-relation`, `.removed-relation`); `TRANSACTION_TYPE_EVENT_NAMES` (`transaction-type.deleted-field`, `.converted-field`); `GRAPH_QUERY_EVENT_NAMES` (`graph-query.submitted`, `.completed`, `.errored`, `.cancelled`, `.timed-out`, `.reran`); `report/custom-list.*` (six). `EventSubject` gains `list-match`, `transaction`, `transaction-type`, `graph-query`. Payloads: the resource, with `matched-value` and `reason` null; `fields` null; `params` null and `nodes` and `links` empty; refused otherwise by `eventAttributesSchema`. Relation events carry `meta.context` `{ relation-schema-key, related-account-id | related-txn-id }`; type events `meta` `{ field-key, version-number }` (and `from`, `to`). Redacted stubs accept `list-match` (`lmt`), `transaction` (`txn`), `graph-query` (`grphq`).

#### Problems
`LIST_PROBLEM_STATUSES` (16), `contracts/fixtures/problems/lists/`; `TRANSACTION_PROBLEM_STATUSES` (14), `problems/transactions/`; `GRAPH_PROBLEM_STATUSES` (13), `problems/graph/`; each with `*_PROBLEM_CODES`, `*ProblemCodeSchema`, `*ProblemCode`, and their statuses documented in `problem.ts`. The API's error classes for them are Stage 1b's.

#### Fixtures, OpenAPI, node, dashboard
- **Fixtures (`contracts/fixtures/api/`):** `list.json`, `list-items.json` (one of each kind), `list-match.json`, `list-match-result.json`, `importer.json`, `importer-errors.json`, `report-custom-list.json`, `transaction.json`, `transaction-label.json`, `transaction-type.json`, `transaction-type-version.json`, `graph-query.json`, `graph-query-template.json`, `graph-query-template-version.json`, `graph-node-value.json`, `graph-query-action-result.json`; every one `serverOnly` in Android's `ContractFixturesTest`.
- **OpenAPI components:** `List`, `ListItem`, `ListMatch`, `Importer`, `CustomListReport`, `FieldSchema`, `TransactionType`, `TransactionTypeVersion`, `Transaction`, `TransactionLabel`, `GraphQuery`, `GraphQueryTemplate`, `GraphQueryTemplateVersion`.
- **`@openverify/node`:** `lists` (`create(plural, attributes)`, `retrieve`, `list`, `listAll`, `update`, `archive`, `match`), `listItems` (`create`, `retrieve`, `archive`, by plural; `list`), `listMatches` (`list`, `retrieve`, `dismiss`), `importers` (`create`, `retrieve`, `list`, `errors`), `transactions` (`create`, `retrieve`, `list`, `update`, `redact`, `label`, `addObjects`, `removeObjects`, `addRelation`, `removeRelation`), `transactionTypes` (`create`, `retrieve`, `list`, `update`, `archive`, `versions`), `graphQueries` (`create`, `retrieve`, `list`, `rerun`, `cancel`, `nodeValue`, `action`), `graphQueryTemplates` (`create`, `retrieve`, `list`, `update`, `archive`, `versions`); `ListKindPlural`.
- **Includes:** `INQUIRY_INCLUDES` gains `list-matches` (`lists:read`); `ACCOUNT_INCLUDES` gains `list-matches` and `transactions` (`transactions:read`), authorized in the routes, served by nobody yet.
- **Dashboard minimum:** `labels.ts`, `report-query-words.ts`, `report-type-words.ts`, `report-words.ts`, `config-words.ts`, `CustomListResults` in `report-results.tsx`, `report-sources.tsx` (list provenance), the rate-limit panel, the permission areas, `event-words.ts` (every new event) and `eventNameGroups()` ("List matches", "Transactions", "Transaction types", "Graph queries").
- **Lint:** `PHASE5_FOLDERS` holds every 7B folder and route; `REFUSED_LOG_KEY_PATTERN` refuses `parameter-map`, `variable-map`, `params`, `filename`, `row`, `rows`, `csv-row`, `record`, `records`, `matched-value`, `dismissal-reason`.

### contractDeviations

- C98.2 reads identifierKey(key, { environmentId, kind, input }) as 7A built it; 7B's labels are new kinds under the names of LIST_KEY_KINDS, added to IDENTIFIER_KEY_LABELS by foundation-7b (amendment 2).
- List and graph kinds never reuse a stored device HMAC as a key: the key input is the 64-hex HMAC, keyed again under identifier-browser-fingerprint or identifier-device-fingerprint; a rotated item stays unmatched and answers key_rotated (amendment 3, owner decision 17).
- C101.2's "frozen enum in contracts" is void: list, graph and field vocabularies live in core, re-exported by contracts (amendment 9, owner decision 14). Graph kinds carry a frozen smallint code (amendment 10).
- LIST_KEYS_VERSION is the text lists-1, so normaliser_version is text and outdated means not equal (amendment 11). Golden key vectors remain list-logic's; Stage 1a pins the version pair and the C78 forms.
- JSON:API forbids an attribute named type: C97.2's list type is the resource type list/<kind>; the public list-items relationship is left out, because a list holds up to 1,000,000 items; limits go in the document meta (amendment 12).
- id-class is not marked PII on an item, against C97.6's letter, because the collision test holds the name to one form and verifications serve it unmasked; id-class takes the C31 classes, not the public short codes (amendment 13).
- Ours beyond the plan: distance-meters on a match, the closed LIST_PROBE_SOURCES, list-ids on POST /lists/match, the list-match-result type, redacted-at on a list match, TRANSACTION_INCLUDES, gn_ node ids, GRAPH_PARAMETER_KINDS, the problem codes marked ours in problem.ts (amendments 15, 22, 23).
- ON_NULL_DEFAULTS classifies the three list reasons as ignore; the value is never read, because no review rule may test the list count (amendment 17).
- Rule 11 is enforced in eventAttributesSchema: list-match, transaction and graph-query payloads carry no value, so every emitter must build the event's resource with those members null or empty (amendment 18).
- report/custom-list overrides the shared sources member with list provenance for its own type; ReportRecord.listSources feeds it; errors and matches take reportSourceIdSchema (amendment 19).
- Existing tests changed with the plan, none weakened: amendment 25 lists them, including the report test that refused a transaction id (C105.7) and compute.test.ts's default set.
- Two commits broke the rule that a commit's gate reads green, both recorded in the TDD file: RED f92c44f7 did not typecheck in packages/contracts until GREEN, and GREEN 347c536b carried a test type error fixed by 6408cacf. Later commits read the exit code first.

### Followups

- foundation-7b: add 7B's labels to IDENTIFIER_KEY_LABELS from LIST_KEY_KINDS and the graph key names (identifier-reference-id, identifier-name-birthdate, identifier-address, identifier-postal-code, identifier-birthdate, and identifier-transaction-field of C105.4), each with a golden test.
- foundation-7b: join PII_LIST_ATTRIBUTES, PII_IMPORTER_ATTRIBUTES, PII_GRAPH_ATTRIBUTES and PII_TRANSACTION_ATTRIBUTES to MASKED_ATTRIBUTES and the API-log masked set. value is PII by name while signals[].value and a graph node's value are nested members with the same name: keep masking at the attribute level there, or those read as masked.
- foundation-7b: add the error classes for LIST_PROBLEM_STATUSES, TRANSACTION_PROBLEM_STATUSES and GRAPH_PROBLEM_STATUSES, as SignalProblemError does, and extend REDACTION_SUBJECT_ID_PREFIXES and 0024_phase7b.
- foundation-7b: add the strict webhook filter resolvers for the list-match, transaction, transaction-type and graph-query subjects; until then eventFilterSubjects treats them as C14 does (an absent attribute is not filtered), and no emitter exists yet.
- api-lists: serve include=list-matches on inquiries and accounts, merge inquiry/list_match_count in services/signals/served.ts with list-screening, build customListReportJob and the completion case, and store provenance in reports.sources in reportListProvenanceSchema's shape.
- api-transactions: serve include=transactions on accounts, and pass transactionId to the report, inquiry and verification builders.
- list-logic: add the golden key vectors for the name kinds beside list-keys-version.test.ts, and bump LIST_KEYS_VERSION if any stored form changes before the first release.
- integration-7b: complete docs/reports/custom-list.md and the seeded template's settings; the node client's graphQueries.action parses the JSON answer only, so the export action (text/csv) needs its own method if a client wants it.
- Owner or 7C: pnpm test:integration failed once before any test with ENOTEMPTY on rmdir node_modules/.vitest-cache, right after a merge of the API blob reports, when two vitest processes started together. It is a startup race on one cache directory shared by the two packages, not a test failure; the next run passed. A cacheDir per package would close it.

### Measurements

- contracts-7b TypeScript unit suite: 15 packages green; api 4,989 tests in 372 files at 96.16 / 88.35 / 97.9 / 96.2 (statements, branches, functions, lines).
- Other packages: core 856, contracts 2,612, checks 3,469, db 1,220, dashboard 3,970, flow 1,088, watchlist 724, node 303, emrtd 318, signals 186, config 187, flow-spec 117, e2e helpers 109, ui 54; about 8 minutes at load 1.6 to 8.
- Integration: db 65 in 14 files (121 s), api 172 in 31 files (243 s), load 4.6.
- Android gate: BUILD SUCCESSFUL in 1 min 31 s.
- e2e: mocked flow 79 in 23.1 s (load 11.3); full stack 95 tests in three shards: 1.6, 4.2 and 3.5 minutes (loads 4.1, 3.4 and 1.3).
- infra/tests/ci-workflow.test.sh: 209 passed. benchmark:test passes.
- LIST_PROBLEM_STATUSES 16 codes, TRANSACTION_PROBLEM_STATUSES 14, GRAPH_PROBLEM_STATUSES 13; 16 new API fixtures. REPORT_EVENT_NAMES 54; EVENT_NAMES 107.
