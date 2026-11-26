# TDD evidence: Workflow 7B Stage 1b, `foundation-7b` (Phase 7)

- **Slice owner:** the Workflow 7B Stage 1b `foundation-7b` agent (plumbing only), beside the Stage 2 agents (`list-logic`, `transaction-schemas`).
- **Date:** 2026-10-31.
- **Base:** `1396ad20` (the end of Stage 1a).
- **Input:** the "Stage 1b: foundation-7b" bullet of `docs/plans/phase-7.plan.md`, family by family; "Workflow 7B Stage 1a amendments (contracts-7b)". The decisions this stage took are in the plan's "Workflow 7B Stage 1b amendments (foundation-7b)".

Each unit follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles and type-checks; the test, run and seen failing for its intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`). Every command ran after `source scripts/env.sh`; output is trimmed to the lines that matter.

## How to regenerate migration 0024 (for checkpoint (G))

`0024_phase7b.sql` is one file for the whole Workflow, never a 0025, and `0023_phase7a` is never edited. Prepare the change in a private worktree (`git worktree add /tmp/<area>-wt HEAD`, then `pnpm install --frozen-lockfile --offline` under the pnpm lock), test it there, copy the files into the shared tree and commit them as one step: a table ahead of its migration fails every insert on it in the other agents' suites.

Save this as `regen.sh`, run it as `bash regen.sh <repo root>`, and add each new table with `updated_at` to `TRIGGERS`. Hand edits so far: `CREATE EXTENSION IF NOT EXISTS vector` first (CLAUDE.md), the `set_updated_at` triggers of (L) and (T), and (T)'s append-only function and its two triggers. No composite unique key needed moving: every key is inside a new table's `CREATE TABLE`, and `inquiries`, `accounts`, `reports` and `verifications` already had theirs.

```bash
#!/bin/bash
# Regenerates migration 0024 as one file: core built first, the old file, snapshot and journal
# entry 24 removed, drizzle-kit generate, then the hand edits re-applied.
# Usage: regen.sh <repo root>. The (G) checkpoint adds its tables to TRIGGERS, and any further
# append-only trigger or composite unique key move as a further hand edit below.
set -euo pipefail
ROOT=${1:-/home/mhnoor/persona-opensource}
source /home/mhnoor/persona-opensource/scripts/env.sh >/dev/null
cd "$ROOT"
pnpm --filter @openverify/core build >/dev/null 2>&1
cd packages/db
rm -f drizzle/0024_phase7b.sql drizzle/meta/0024_snapshot.json
python3 - <<'PY'
import json
p='drizzle/meta/_journal.json'
j=json.load(open(p))
j['entries']=[e for e in j['entries'] if e['idx']!=24]
open(p,'w').write(json.dumps(j,indent=2)+'\n')
PY
pnpm exec drizzle-kit generate --name phase7b 2>&1 | tail -1
python3 - <<'PY'
p='drizzle/0024_phase7b.sql'
s=open(p).read().rstrip('\n')
assert 'DROP TABLE' not in s and 'DROP TYPE' not in s
# CLAUDE.md: a migration that needs pgvector runs CREATE EXTENSION IF NOT EXISTS vector itself.
s='CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint\n'+s
if not s.endswith('--> statement-breakpoint'):
    s+='--> statement-breakpoint'
TRIGGERS=['lists','list_items','list_matches','list_screenings','importers',
          'transaction_types','transaction_type_versions','transactions','transaction_labels',
          'transaction_files']
s+='\n'+'--> statement-breakpoint\n'.join(f'CREATE TRIGGER "{t}_set_updated_at" BEFORE UPDATE ON "{t}" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();' for t in TRIGGERS)
# Hand edit (C105.4, the C73 pattern): the status history and the labels are append-only.
s+='''--> statement-breakpoint
-- Hand edit (C105.4, C105.5; the C73.2 pattern): a transaction's status history and labels are
-- append-only. The one UPDATE allowed is a transaction redaction
-- (`openverify.transaction_redaction = 'on'`, transaction-local, set only by the redaction
-- repository) that nulls the trigger's free-text columns and stamps `redacted_at`, with every other
-- column unchanged. A DELETE is refused unless the transaction deletes an environment
-- (`openverify.environment_deletion = 'on'`): transactions are redacted, never deleted (C105.5).
-- Neither table holds a sealed value, so a KEK rewrap has no case here.
CREATE OR REPLACE FUNCTION "openverify_transaction_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free_text text[] := TG_ARGV[0:];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('openverify.environment_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  IF coalesce(current_setting('openverify.transaction_redaction', true), '') = 'on'
     AND NEW."redacted_at" IS NOT NULL
     AND (to_jsonb(NEW) - free_text - 'redacted_at' - 'updated_at')
       = (to_jsonb(OLD) - free_text - 'redacted_at' - 'updated_at')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(free_text) AS member(name) WHERE to_jsonb(NEW) ->> member.name IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "transaction_status_history_append_only" BEFORE UPDATE OR DELETE ON "transaction_status_history" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('from_status', 'to_status');--> statement-breakpoint
CREATE TRIGGER "transaction_labels_append_only" BEFORE UPDATE OR DELETE ON "transaction_labels" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('label', 'model_version');'''
open(p,'w').write(s)
j='drizzle/meta/_journal.json'
t=open(j).read()
if not t.endswith('\n'): open(j,'w').write(t+'\n')
PY
(cd "$ROOT" && pnpm exec prettier --write packages/db/drizzle/meta/0024_snapshot.json >/dev/null)
echo regenerated
```

## Checkpoint (L): lists and importers

Ends at `cb2745b2`.

### L.1 Migration 0024 extended: the list tables (C98, C99, C100)
RED `27346b04`; GREEN `e16ed583`, prepared in a private worktree and brought in as one commit.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-list-tables.test.ts src/testing.test.ts src/migrate.test.ts src/schema-v2.test.ts --coverage.enabled=false)
     × refuses an item id of no item prefix, a key that is not hex, and an unknown key kind
     × keeps a value sealed and a key as text, never bytea (F10)
     × keeps a background layout as a 144-dimension vector, with no ANN index (C99.7)
     × lists every encrypted column for the KEK rewrap
error: relation "lists" does not exist
AssertionError: expected [] to deeply equal [ { access: 'spgist', …(1) } ]
AssertionError: expected [] to deeply equal [ { access: 'gist', …(1) } ]
AssertionError: expected [ 'account_relations', …(67) ] to deeply equal [ 'account_relations', …(79) ]
AssertionError: expected 'ALTER TABLE "report_templates" DROP C…' to contain 'CREATE EXTENSION IF NOT EXISTS vector'
 Test Files  4 failed (4)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts)
     × creates the list tables on an empty database; the containment and box operators use their indexes
     × upgrades a database at 0023 with rows in it: the version keeps its row with an empty list-config
Caused by: error: relation "lists" does not exist
Caused by: error: column "list_config" does not exist
      Tests  2 failed (2)
```
GREEN (in the worktree): `tables/lists.ts`, `list_config`, the sealed columns, `REWRAP_TABLES`, the seeds of `@openverify/db/testing`, and 0024 regenerated with the script above.
```
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false)      Test Files  89 passed (89)     Tests  1239 passed (1239)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts src/migration-0023.integration.test.ts src/list-index-order.integration.test.ts)      Tests  7 passed (7)
```
The upgrade test asserts both operator classes from the catalogs on Postgres 17, on an empty database and after an upgrade from `0023_phase7a` with rows in it, and `explain` shows `range >>= '192.0.2.7'` and `bbox @>` using their indexes.

### L.2 The 7B identifier labels (C98.2, C101.2, C105.4)
RED `10df6b79`; GREEN in `a88b9c2b`.
```
$ (cd packages/db && pnpm exec vitest run src/identifier-key.test.ts --coverage.enabled=false)
     × has one label per list key kind and per graph or transaction key (C98.2, C101.2, C105.4)
     × matches the OpenSSL vector for identifier-string (Workflow 7B)
     ... one per label, twenty in all
```
GREEN: `Tests 29 passed (29)`. The vectors came from OpenSSL 3, by the commands in the test's header, not from our code.

### L.3 The db repository stubs and what is built in them
Stubs `a88b9c2b`; RED `cc50be5d`; GREEN `f9cfc345`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/list-plumbing.test.ts src/repositories/subject-ids.test.ts --coverage.enabled=false)
     × writes one pending row per inquiry; a later move keeps the first row
     × nulls the compared value and the reason and sets redacted-at
     × stubs the match events and forgets the stored copies by the match id
     × finds lst ids      (and lis, liea, lifc, ligin, lmt, mprt)
     × nulls the IP-sourced values past the window and keeps the record and other values
      Tests  15 failed | 6 passed (21)
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false src/repositories)
 Test Files  66 passed (66)      Tests  570 passed (570)
```

### L.4 Masking and API logs (C97.6, C100.1, C107.5)
RED `e15836c2`; GREEN `9fba2012`.
```
$ (cd apps/api && pnpm exec vitest run src/auth/pii-lists.test.ts --coverage.enabled=false)
     × joins every list and importer name
     × nulls each value an item serves, keeping the rest
     × masks item create bodies, probes and dismissal reasons under data.attributes
     × stores the file as its length and SHA-256, for every reader
      Tests  6 failed | 2 passed (8)
GREEN: Tests 38 passed (38) (src/auth)
```
`leaves a signal value alone: masking is by attribute, not at every depth` passed in RED and passes now: it is the guard contracts-7b asked for.

### L.5 Hooks, ports, queues, workers and frozen routes
Stubs `ddef0abb`; RED `a2e396fc` (84 tests); GREEN `5f31ca2d`.
```
$ (cd apps/api && pnpm exec vitest run <the eleven files> --coverage.enabled=false)
     × starts them only with the list producers
     × hands each job to its processor with the worker’s keys
     × runs rebuildListIndexes and prints counts only
     × asks the redactor with the inquiry, and deletes the objects it names after the commit
     × is strict: a list match fails any filter that is present
     × serves the defaults, stored as {}, for a version that sets none
 Test Files  10 failed | 1 passed (11)      Tests  84 failed | 79 passed (163)
```
GREEN, after correcting three tests of mine (a template is created per inquiry, so `list_config` is set after it; `drain` stops on a short batch; `api.token` is an API key):
```
$ (cd apps/api && pnpm exec vitest run src/services/list-screening-hook.test.ts src/services/list-hooks.test.ts src/services/retention-lists.test.ts src/routes/list-routes.test.ts --coverage.enabled=false)
 Test Files  4 passed (4)      Tests  97 passed (97)
```

### L.6 The API dependencies and the fakes
RED `f710bce7`; GREEN `1b6fe766`.
```
     × passes on every dependency, including the Phase 2 ports, by reference
AssertionError: expected [ 'accounts', 'audit', …(23) ] to deeply equal [ 'accounts', 'audit', …(27) ]
GREEN: Tests 28 passed (28); src/services/lists/ports.test.ts Tests 11 passed (11)
```

### L.7 `POST /lists/match` reads `pii:view` as C15 does
RED `0eb10926`; GREEN `cb2745b2`. A frozen `config.scopes` with `pii:view` would refuse an API key, which sees PII unless it was minted masked (C15), so the route uses `requirePiiView`, as a report's dismissal does.
```
     × POST /lists/match needs lists:read and pii:view (P11)
AssertionError: expected 403 to be 501 // Object.is equality
GREEN: Tests 110 passed (110)  (list routes, OpenAPI, scopes)
```

### Commits that did not read green
- `ddef0abb` (stubs) carried `TS1484` errors in `test-support/fakes.ts`, types imported as values, fixed by `a2e396fc`. The command chained the commit after `tsc` without reading its exit code.
- `a88b9c2b` made the cast in `identifier-key.test.ts` unnecessary, a lint error, and `5f31ca2d` broke the dashboard's typecheck (`RetentionSetting` took in `biometric-lists-basis`); the forced gate found both, and `43fcf870` fixed both.

### Column forms (C107.5)
| Column | Form |
|---|---|
| `list_items.value` | sealed JSON, row AAD `list_items.value#<id>` |
| `list_items.match_key`, `list_item_keys.match_key`, `list_import_rows.match_key` | 64-hex HMAC (`hexDigest`) |
| `list_items.country_code` | plaintext by decision: not PII (C97.6), matched on this column (C98.2) |
| `list_item_ip_ranges.range` | plaintext `cidr` by decision 28 |
| `list_item_geo.bbox` | plaintext `box`, rounded outward to 0.01° (C107.5) |
| `list_item_faces.template` | sealed, row AAD `list_item_faces.template#<item id>` |
| `list_item_backgrounds.layout`, `valid_cells`, `coverage` | plaintext by decision, as `selfie_backgrounds` (C107.5) |
| `list_item_backgrounds.masked_file_key`, `masked_file_wrapped_dek` | envelope object, `file` AAD |
| `list_matches.matched_value`, `reason` | sealed, row AAD `list_matches.<column>#<id>` |
| `importers.storage_key`, `wrapped_dek` | envelope object, `file` AAD |
| `list_import_rows.value` | sealed JSON, AAD `list_import_rows.value#<importer id>/<row>` (`importRowKey`) |
| `list_import_errors.*` | a code, a line and a column header, never a value |
| `lists.*`, `list_screenings.*` | no PII: names, ids, counts and closed reasons (list names are operator text, C97.6) |

### PGlite migration time (Risks)
`createTestDatabase()` in a fresh process: cold with an empty `OPENVERIFY_TEST_DB_CACHE_DIR`, then warm. Each take is one hold of `/tmp/openverify-e2e.lock`, with the 1-minute load beside it.

| Tree | Cold (ms) | Warm (ms) | Load (1 min) |
|---|---|---|---|
| Base `1396ad20`, first takes | 4,111 · 3,655 · 4,048 | 644 · 645 · 634 | 0.11 to 0.32 |
| Head, first takes | 4,320 · 4,384 · 4,707 | 745 · 699 · 863 | 1.24 to 1.54 |
| Interleaved, base | 3,767 · 3,949 · 3,721 | 702 · 668 · 618 | 1.62 to 1.80 |
| Interleaved, head | 5,310 · 5,129 · 3,811 | 725 · 697 · 644 | 1.62 to 1.73 |

Over the six takes each, the median moves from about 3,858 ms to about 4,546 ms cold, and from 645 ms to 712 ms warm: about +0.7 s cold and +70 ms warm, with one head take at 3,811 ms, so the spread is as wide as the effect. Every PGlite hook stays far inside its 120 s guard.

### Final gates (foreground, exit codes read from the command itself)
```
pnpm install --frozen-lockfile                          rc 0
pnpm turbo run lint typecheck --force                   rc 0   Tasks: 30 successful, 30 total
pnpm format:check                                       rc 0
pnpm turbo run test --force --filter=!@openverify/api   rc 0   Tasks: 14 successful, 14 total
  core 1,174; contracts 2,613; checks 3,787; db 1,278 (94.78 / 88.81 / 94.46 / 95.02); dashboard 3,970; flow 1,088;
  watchlist 759; node 303; emrtd 318; signals 186; config 187; flow-spec 117; e2e helpers 109; ui 54
API: two blob shards (each rc 1 on its own partial coverage, no failed test), then the merge
  pnpm exec vitest run --merge-reports=<dir> --coverage rc 0   Test Files 383 passed, Tests 5,132 passed, 96.19 / 88.4 / 97.88 / 96.25
pnpm test:integration                                   rc 0   db 67 in 15 files, api 172 in 31 files
bash infra/tests/ci-workflow.test.sh                    rc 0   209 passed
pnpm --filter @openverify/watchlist benchmark:typecheck rc 0
pnpm --filter @openverify/watchlist benchmark:test      rc 0
e2e gate (own stack per shard, under the lock):
  pnpm --filter @openverify/flow e2e                    rc 0   79 passed in 26.4 s
  playwright test --shard=1/3                           rc 0   32 passed in 3.0 min
  playwright test --shard=2/3                           rc 0   34 passed in 6.3 min
  playwright test --shard=3/3                           rc 0   29 passed in 4.8 min
```
The Android gate was not run: this checkpoint changed nothing under `contracts/fixtures/`. These gates ran at `43fcf870`; `POST /lists/match`'s fix after them was checked by the list routes, OpenAPI and scope tests, `tsc` and eslint.

## Report (foundation-7b, checkpoint (L))

### Handoff

#### How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-foundation-7b.tdd.md`. Decisions: `docs/plans/phase-7.plan.md`, "Workflow 7B Stage 1b amendments (foundation-7b)", Checkpoint (L), items 1-19.
- db: `pnpm --filter @openverify/db exec vitest run src/phase7-list-tables.test.ts src/repositories/list-plumbing.test.ts src/identifier-key.test.ts --coverage.enabled=false`.
- Upgrade test: `(cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts)`.
- API: `pnpm --filter @openverify/api exec vitest run src/services/list-screening-hook.test.ts src/services/list-hooks.test.ts src/services/lists/ports.test.ts src/services/inquiry-list-screening-served.test.ts src/services/retention-lists.test.ts src/routes/list-routes.test.ts src/routes/server/inquiry-template-list-config.test.ts src/routes/dashboard/settings-lists.test.ts src/jobs/list-queues.test.ts src/worker-lists.test.ts src/jobs/repeatable/phase7.test.ts src/auth/pii-lists.test.ts --coverage.enabled=false`.

#### Checkpoint commit
Checkpoint (L) ends at `cb2745b2` (code) and `2a2a775a` (plan and record). RED/GREEN: tables `27346b04`/`e16ed583`; labels and stubs `10df6b79`/`a88b9c2b`; db plumbing `cc50be5d`/`f9cfc345`; masking `e15836c2`/`9fba2012`; API stubs `ddef0abb`, wiring `a2e396fc`/`5f31ca2d`; dependencies `f710bce7`/`1b6fe766`; fixes `43fcf870`; `POST /lists/match` `0eb10926`/`cb2745b2`.

#### Regenerating migration 0024
The whole script is in the TDD record, "How to regenerate migration 0024". In order: `pnpm --filter @openverify/core build`; delete `0024_phase7b.sql`, `meta/0024_snapshot.json` and journal entry 24; `pnpm exec drizzle-kit generate --name phase7b` in `packages/db`; put `CREATE EXTENSION IF NOT EXISTS vector;` first; append the `set_updated_at` triggers of `lists`, `list_items`, `list_matches`, `list_screenings`, `importers` plus each new table of yours; run prettier on the snapshot. (T) adds its append-only triggers as a further hand edit. The `report_type` CHECK statements of Stage 1a regenerate unchanged. Do it in a private worktree and commit the tables and migration as one step.

#### Tables (`packages/db/src/tables/lists.ts`, exported from `schema.ts`)
- **`lists`:** `id` (`lst`), `environment_id`, `type`, `name`, `status`, `archived_at`, `version`, `item_count`, `item_retention_days`, `screen_at_completion`, `field_key`, `case_sensitive`, `default_region`, `use_for_compromised_ids`, `allow_fuzzy_name_first`, timestamps. Indexes: unique `(environment_id, id)`; `lists_environment_id_created_at_id_idx`; partial `lists_environment_id_type_active_idx`. CHECKs hold each kind's member to its kind; `lists_biometric_retention`.
- **`list_items`:** `id` (any item prefix), `environment_id`, `list_id`, `value`, `match_key`, `country_code`, `normaliser_version`, `key_id`, `status`, `archive_reason`, `match_count`, `created_by_type`, `created_by_id`, `archived_at`, `redacted_at`, timestamps. Indexes: unique `(environment_id, id)`; partial unique `list_items_active_match_key_key`; partial `list_items_environment_id_country_code_idx`; `list_items_environment_id_list_id_created_at_id_idx`.
- **`list_item_keys`:** pk `(environment_id, item_id, key_kind, match_key)`; `list_item_keys_environment_id_key_kind_match_key_idx`.
- **`list_item_ip_ranges`:** pk `item_id`; `range cidr`; `list_item_ip_ranges_range_idx` (spgist `inet_ops`).
- **`list_item_geo`:** pk `(item_id, part)`; `bbox box`; `list_item_geo_bbox_idx` (gist `box_ops`).
- **`list_item_faces`:** pk `item_id`; `template`, `model` (null while pending), `source_inquiry_id`; index on the source.
- **`list_item_backgrounds`:** pk `item_id`; `layout vector(144)`, `valid_cells`, `coverage` (null while pending), `masked_file_key`, `masked_file_wrapped_dek`, `source_inquiry_id`; no ANN index.
- **`list_matches`:** `id` (`lmt`), `list_id`, `list_item_id`, `inquiry_id`, `account_id`, `source`, `method`, `tier`, `confidence`, `approximate`, `score`, `distance_meters`, `list_version`, `matched_value`, `status`, `dismissed_at`, `reason`, `redacted_at`, timestamps. Partial unique `list_matches_inquiry_item_source_key`; four `..._created_at_id_idx` listings (environment, inquiry, account, list).
- **`list_screenings`:** pk `(environment_id, inquiry_id)`; `trigger_status`, `status`, `match_count`, `unscreened`, `not_applicable`, `review_cause`, `attempts`, `last_error_code`, `enqueued_at`, `screened_at`; `list_screenings_pending_idx`.
- **`importers`:** `id` (`mprt`), `list_id`, `status`, `mode`, `encoding`, the counts, `file_sha256`, `file_bytes`, `storage_key`, `wrapped_dek`, `object_deleted_at`, `attempts`, `last_error_code`, `enqueued_at`, `completed_at`. Indexes: both listings, `importers_file_idempotency_idx`, `importers_pending_idx`, `importers_object_purge_idx`.
- **`list_import_rows`:** identity `id`, `importer_id`, `row`, `value`, `match_key`; unique `(importer_id, row)`. **`list_import_errors`:** identity `id`, `importer_id`, `row`, `column`, `code`.
- **`inquiry_template_versions.list_config`:** jsonb, default `{}`.
- Also exported: `LIST_ITEM_CREATOR_TYPES`, `ListItemCreatorType`, `LIST_SCREENING_TRIGGER_VALUES`, `importRowKey(importerId, row)`, and the row types.

#### Repositories (`packages/db/src/repositories/`, all in `index.ts`)
Each stub rejects with `ListRepositoryNotBuiltError` (`list-repository.ts`, with `listRepositoryNotBuilt(name)`). They are typed `const`s, so an owner rewrites each as a function with the same signature.
- **`lists.ts` (`api-lists`):** BUILT `anyListScreenedByAll(tx, environmentId)`. Stubs `createList`, `getList`, `listLists`, `updateList`, `archiveList`, `countActiveLists`, `listCompromisedIdLists`. Types `NewList`, `ListChanges`, `ListFilters`.
- **`list-items.ts` (`api-lists`):** stubs `insertListItems`, `getListItem`, `listListItems`, `archiveListItem`, `redactListItems`; `redactExpiredListItems(db, options)` answers 0 until built. Types `NewListItem`, `ListItemInsertion`, `ListItem`.
- **`list-matches.ts` (`api-lists`):** stubs `insertListMatches`, `getListMatch`, `listListMatches`, `dismissListMatch`. Types `NewListMatch`, `ListMatch`, `ListMatchFilters`.
- **`list-screenings.ts` (`api-lists`):** BUILT `createListScreening`, `getListScreening`, `listInquiryListScreenings`. Stubs `listPendingListScreenings`, `markListScreeningsEnqueued`, `completeListScreening`. Types `ListScreening`, `ListScreeningTrigger`, `PendingListScreening`, `ListScreeningOutcome`.
- **`list-biometrics.ts` (`api-biometric-lists`):** stubs `createListItemBiometricRow`, `completeListItemFace`, `completeListItemBackground`, `listListFaceTemplates`, `listBiometricItemsBySource`.
- **`importers.ts` (`api-importers`):** stubs `createImporter`, `getImporter`, `listImporters`, `findRecentImporter`, `listPendingImporters`, `markImportersEnqueued`, `stageImportRows`, `listStagedImportRows`, `recordImportErrors`, `listImporterErrors`, `completeImporter`, `markImportObjectDeleted`; `listImportObjectsDue(db, options)` answers `[]` until built.
- **`@openverify/db/testing`:** `seedList`, `seedListItem`, `seedListItemFace`, `seedListItemBackground`, `seedListMatch`, `openListMatchValues`, `seedImporter`, `seedListImportRow`, all by SQL.

#### Sealing, envelopes, rewrap, labels
- `ENCRYPTED_COLUMNS`: `importers.wrapped_dek` (file), `list_import_rows.value`, `list_item_backgrounds.masked_file_wrapped_dek` (file), `list_item_faces.template`, `list_items.value`, `list_matches.matched_value`, `list_matches.reason`.
- `SEALED`: `listItemValue`, `listItemFaceTemplate`, `listMatchMatchedValue`, `listMatchReason`, `listImportRowValue` (bound to `importRowKey`). An envelope object passes its row's id as the `encryptBytes` context.
- `REWRAP_TABLES` gains `importers`, `list_import_rows` (bigint id), `list_item_backgrounds` and `list_item_faces` (`item_id`), `list_items`, `list_matches`; the rewrap test seeds every column.
- `IDENTIFIER_KEY_LABELS` gains the fourteen `LIST_KEY_KINDS` and `identifier-reference-id`, `identifier-name-birthdate`, `identifier-address`, `identifier-postal-code`, `identifier-birthdate`, `identifier-transaction-field`, each `openverify/<kind>/v1` with an OpenSSL vector, so (T) and (G) add none.

#### Masking, API logs, redaction, subjects, retention
- `MASKED_ATTRIBUTES` (`auth/pii.ts`) and the API-log set (`services/api-logs.ts`) join `PII_LIST_ATTRIBUTES` and `PII_IMPORTER_ATTRIBUTES`, at the attribute level, so `signals[].value` stays. `withoutImporterFile(body)` reduces `data.attributes.file` to `{ length, sha256 }` before storage.
- `REDACTION_SUBJECT_ID_PREFIXES` gains `lst`, the thirteen item prefixes, `lmt`, `mprt`.
- `redactInquiryRecords` nulls `list_matches.matched_value` and `reason`, sets `redacted_at`, and stubs and forgets the match ids.
- `nullExpiredAddresses` nulls `matched_value` for `session.ip-address`, `.ip-country`, `.ip-point`.
- `runRetention` reports `redactedListItems` and `purgedImportObjects`.
- `redaction.test-support.ts`: `list_matches` in `SUBJECT_PII_TABLES`, seeded (`listMatchId`) and scanned; `THIRD_PARTY_LIST_PII_TABLES`; `BIOMETRIC_LIST_PII_TABLES`, which `api-biometric-lists` moves (plan item 15).

#### Settings
`biometric-lists-basis` (`biometricListsBasisSchema`, `EnvironmentSettings`, `DashboardSettings`, `settings:privacy`). `PRIVACY_SETTINGS` in `services/settings.ts`.

#### Hooks and stubs in the API (file, signature; owner)
- `createListScreeningInTx(tx, { inquiry, from, to }) => Promise<boolean>`, `writesListScreening`: `services/lists/screening.ts`, BUILT; `api-lists` owns it from Stage 3.
- `servedInquirySignals({ inquiry, listScreening }, view)`: `services/signals/served.ts`; `api-lists` builds the merge.
- `listConfigPublishProblems({ deps, db, environment, listConfig }) => ListConfigProblem[]`: `services/publish/list-config.ts`; `api-lists`.
- `onSettingsChangedInTx(tx, environmentId, before, after)`: `services/lists/biometric/settings-hook.ts`; `api-biometric-lists`.
- `unbuiltCompromisedIdLookup`: `services/lists/compromised-ids.ts`; `api-lists`. `GovernmentIdDeps.compromisedIds` and `ProcessVerificationDeps.compromisedIds`; `lookUpCompromisedId` in `jobs/government-id.ts` passes `compromisedList` when not `null`.
- `rebuildListIndexes(db, key, { batchSize }) => { scanned, updated }`: `services/lists/rebuild.ts`, called from `apps/api/scripts/blind-index-rebuild.ts`, whose result gains `lists`; `api-lists`.
- `resolveListMatchFilterSubjects(db, environmentId, payloads)`: `services/lists/filter-subjects.ts`; `api-lists`. `eventFilterSubjects` marks it strict.
- `purgeExpiredImportObjects({ db, storage }, options) => number`: `services/importers/purge.ts`; `api-importers`.
- `RedactionServiceOptions.biometricItems`; the redactor runs in `redactInquiry`'s transaction, and its `storageKeys` are deleted after the commit.
- `unbuiltListItemWriter`, `unbuiltListService`: `services/lists/item-writer.ts`. `unbuiltBiometricItemRedactor`, `unbuiltBiometricListsGate`, `unbuiltBiometricListMatcher`: `services/lists/biometric/index.ts`.
- `ListProblemError(code, detail, { errors?, headers? })`: `errors.ts`.

#### Ports and fakes
Ports in `ports.ts`: `ListScreenJob`, `ListScreenQueue.enqueueListScreen`, `ListImportJob`, `ListImportQueue.enqueueListImport`, `ListItemEmbedJob`, `ListItemEmbedQueue.enqueueListItemEmbed`, `CompromisedIdLookup.lookup`, `CompromisedIdAnswer`, `CompromisedIdUnscreened`, `ListItemWriter.insertItems`, `ListItemToWrite`, `ListItemRefusal`, `ListItemWriteResult`, `ListService.createItem`, `BiometricListMatcher.match`, `BiometricListSelection`, `BiometricListMatch`, `BiometricListComparison`, `BiometricListOutcome`, `BiometricItemRedactor.redactBySource`, `BiometricListsGate.isAcknowledged`. Fakes in `test-support/fakes.ts`: `createFakeListItemWriter`, `createFakeListService`, `createFakeBiometricListMatcher`, `createFakeBiometricItemRedactor`, `createFakeBiometricListsGate`, `createFakeCompromisedIdLookup`. `ApiDependencies` gains the optional `listImports`, `listItemEmbeds`, `listService`, `biometricListsGate`; the container wires them, and an owner replaces its `unbuilt*` constant there.

#### Queues, sweeps, workers (`jobs/list-queues.ts`)
`LIST_SCREEN_QUEUE`/`_JOB` `list-screen`, `LIST_IMPORT_QUEUE`/`_JOB` `list-import`, `LIST_ITEM_EMBED_QUEUE`/`_JOB` `list-item-embed`; `LIST_SCREEN_SWEEP_QUEUE`, `LIST_IMPORT_SWEEP_QUEUE`, `LIST_ITEM_EMBED_SWEEP_QUEUE`; `LIST_SWEEP_INTERVAL_MS` (15 s); `LIST_JOB_OPTIONS`; `createListScreenQueue`, `createListImportQueue`, `createListItemEmbedQueue`, each lazy and closable. Job stubs, which reject naming their owner while the sweeps enqueue nothing: `jobs/lists/screen.ts` (`processListScreen`, `ListScreenDeps`), `jobs/lists/sweep.ts` (`runListScreenSweep`), `jobs/lists/embed.ts` (`processListItemEmbed`, `runListItemEmbedSweep`), `jobs/importers/process.ts` (`processListImport`, `ListImportDeps` with `writer`), `jobs/importers/sweep.ts` (`runListImportSweep`). `StartWorkersOptions.lists: WorkerListOptions { screens, imports, embeds, process?: { screen?, import?, embed? }, writer? }`; `listJobProcessor` in `worker.ts`; `phase7RepeatableJobs(deps, network, signals, lists)`; `ListRepeatableDeps`.

#### Frozen routes (schemas from `@openverify/contracts`; 501 until built)
- **`routes/server/lists.ts`, `services/lists/lists.ts` (`api-lists`):** `POST /list/<plural>` for thirteen kinds (`LIST_CREATE_BODY_SCHEMAS`, 201 `listResourceDocumentSchema`, `lists:write`); `GET /lists` (`listListsQuerySchema`, `listResourceListDocumentSchema`); `GET`, `PATCH` (`updateListBodySchema`), `DELETE /lists/:id`; `POST /lists/match` (`matchListsBodySchema`, `matchListsResponseSchema`, `lists:read` plus `requirePiiView`). Service stubs `createList`, `listLists`, `getListDocument`, `updateList`, `archiveList`, `matchLists`, and `ListActing`.
- **`routes/server/list-items.ts`, `services/lists/items.ts`:** `POST /list-item/<plural>` (`LIST_ITEM_CREATE_BODY_SCHEMAS`), `GET` and `DELETE /list-item/<plural>/:id` (`listItemDocumentSchema`), `GET /list-items` (`listListItemsQuerySchema`, `listItemListDocumentSchema`). Stubs `createListItem`, `getListItemDocument`, `archiveListItem`, `listListItems`.
- **`routes/server/list-matches.ts`, `services/lists/matches.ts`:** `GET /list-matches`, `GET /list-matches/:id`, `POST /list-matches/:id/dismiss` (`dismissListMatchBodySchema`). Stubs `listListMatches`, `getListMatchDocument`, `dismissListMatch`.
- **`routes/server/importers.ts`, `services/importers/importers.ts` (`api-importers`):** `POST /importer/list-item/<plural>` for eleven kinds (JSON by `createImporterBodySchema`, or a buffered multipart body; `importers:write` and `lists:write`; `IMPORTER_BODY_LIMIT_BYTES`), `GET /importers`, `GET /importers/:id`, `GET /importers/:id/errors`. Stubs `createImporter(deps, acting, kind, body, contentType)`, `listImporters`, `getImporterDocument`, `listImporterErrors`.

### Contract deviations

1. C98.1 gains list_items.country_code: C98.2 says a country matches on the plaintext column, which C98.1 does not name; not PII by C97.6 (plan item 1).
2. list_items gains archive_reason (C99.7's source_unavailable) and keeps normaliser_version not null, so a biometric item writes LIST_KEYS_VERSION (plan item 1).
3. Biometric side rows are written with the pending item, with template, model, layout, valid_cells and coverage null until embedded, because the resource serves source-inquiry-id while pending; list_item_backgrounds also carries source_inquiry_id, which C98.1 lists only for faces (plan item 2).
4. list_matches is unique on (environment, inquiry, item, source), so a retried job and the C99.9 record write one match (plan item 3).
5. LIST_SCREENING_STATUSES has no skipped, unlike the signals outbox: a job that finds the inquiry redacted after its row was written ends the row errored with a last_error_code (plan item 4). api-lists: if a served state is wanted for it, that is a contracts change for integration-7b.
6. The importer table is named importers, with file_bytes, attempts, last_error_code and enqueued_at beyond C100; list_import_rows also holds a match_key so a repeat within the file is counted without opening it (plan item 5).
7. writesListScreening uses the signals outbox's moves, so created -> expired writes a row too: V17 over C99.4's 'first move out of pending' (plan item 6).
8. servedInquirySignals takes { inquiry, listScreening } as its first argument, and inquiryRecordOf, inquiryResourceFor and toInquiryResource each gain a trailing listScreening parameter defaulting to null (plan item 7).
9. biometric-lists-basis trims and refuses an empty string with 400; null clears it. Its schema and settings members are new here, because Stage 1a did not add them (plan item 9).
10. POST /lists/match reads pii:view through requirePiiView, not config.scopes, because an unmasked API key holds no pii:view scope (plan item 10).
11. list-item-embed-sweep is a name beyond C107.1's list; the (L) bullet gives all three queues sweeps (plan item 12).
12. CompromisedIdLookup answers null with no configured list; the port and its fake carry unscreened, and the check's input type stays { matched } until api-lists widens it in packages/checks. The stub never answers, so no value reaches it.
13. redaction.test-support.ts holds a new category, BIOMETRIC_LIST_PII_TABLES, for list_item_faces and list_item_backgrounds: rule 11 asks that a subject's table join SUBJECT_PII_TABLES and be really seeded, which the stub redactor cannot pass. Amendment: api-biometric-lists may edit services/redaction.test-support.ts and services/redaction.test.ts to move both tables, when it builds redactBySource (plan item 15).
14. ip-retention-days covers session.ip-country and session.ip-point as well as session.ip-address: C91.7 says IP-sourced values (plan item 14).
15. The OpenAPI snapshot was regenerated at (L), not only after the last checkpoint, because its test is part of the API suite, as at 7A's (S). apps/dashboard/src/components/operators/settings-fields.ts changed as a typecheck minimum.
16. Existing tests changed with the plan, none weakened: plan item 19.
17. Commits that did not read green: ddef0abb (a tsc error in fakes.ts, fixed by a2e396fc; the chain did not read tsc's exit code), a88b9c2b (a lint error in identifier-key.test.ts) and 5f31ca2d (the dashboard's typecheck), both fixed by 43fcf870. Recorded in the TDD file.

### Followups

- foundation-7b, checkpoint (T): extend 0024 by the regeneration steps in the TDD record, add the transaction tables with their append-only triggers, the error classes for TRANSACTION_PROBLEM_STATUSES, PII_TRANSACTION_ATTRIBUTES in both masking sets, and the prefixes txn, txnf, txnl. No new identifier label is needed.
- foundation-7b, checkpoint (G): the same, with PII_GRAPH_ATTRIBUTES, GRAPH_PROBLEM_STATUSES and grphq. After the last checkpoint, regenerate the OpenAPI snapshot.
- api-lists: replace the typed-const stubs with functions of the same signatures; wire the real CompromisedIdLookup through ProcessVerificationDeps.compromisedIds and the ListItemWriter through StartWorkersOptions.lists.writer in worker.ts, and listService in container.ts; enforce lists-write and lists-match; check pii:view on face and background item creation; answer filter_required on GET /list-items.
- api-importers: enforce the importers policy; read a multipart buffer for its parts; purge objects through listImportObjectsDue, markImportObjectDeleted and storage.delete.
- api-biometric-lists: build redactBySource and move list_item_faces and list_item_backgrounds into SUBJECT_PII_TABLES, really seeded by seedPiiSubject (plan item 15), and wire biometricItems into createRedactionService, whose callers still use the stub.
- integration-7b: the list-item-embed-sweep name joins C107.1's list in the docs. The Android gate was not run at (L), because no fixture changed.

### Measurements

- PGlite, six takes each, one per hold of the e2e lock, loads 0.11 to 1.80: base 1396ad20 cold 3,655 to 4,111 ms (median about 3,858), warm 618 to 702 ms (median 645); head cold 3,811 to 5,310 ms (median about 4,546), warm 644 to 863 ms (median 712). About +0.7 s cold and +70 ms warm, with one head take at 3,811 ms, so the spread is as wide as the effect; every hook stays far inside its 120 s guard.
- TypeScript unit suite: 15 packages green; api 5,132 tests in 383 files at 96.19 / 88.4 / 97.88 / 96.25 (statements, branches, functions, lines); db 1,278 at 94.78 / 88.81 / 94.46 / 95.02.
- Other packages: core 1,174, contracts 2,613, checks 3,787, dashboard 3,970, flow 1,088, watchlist 759, node 303, emrtd 318, signals 186, config 187, flow-spec 117, e2e helpers 109, ui 54. core and checks include Stage 2 work in the tree.
- Integration: db 67 in 15 files, api 172 in 31 files.
- e2e: mocked flow 79 in 26.4 s (load 7.12); full stack 95 tests in three shards of 32, 34 and 29: 3.0, 6.3 and 4.8 minutes.
- infra/tests/ci-workflow.test.sh: 209 passed. benchmark:typecheck and benchmark:test pass.
- Migration 0024: 304+ lines, 12 tables, 1 column, 5 triggers. OpenAPI snapshot: +10,015 lines.

## Checkpoint (T): transactions

Ends at `cea18d7b` (the last code commit; `1ccec2e3` ended the code before the snapshot `8705e964` and the T.7 fix). Decisions: the plan's "Workflow 7B Stage 1b amendments (foundation-7b)", Checkpoint (T), items 1-18.

### T.1 Migration 0024 extended: the transaction tables (C104, C105)
RED `6af71836`; GREEN `8d265bc3`, prepared in a private worktree and brought in as one step.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-transaction-tables.test.ts src/testing.test.ts src/migrate.test.ts src/schema-v2.test.ts --coverage.enabled=false)
 Test Files  4 failed (4)      Tests  30 failed | 179 passed (209)
-   "transaction_field_keys", ... "transactions",        (the table list)
```
GREEN, after correcting four expectations of mine: `pg_indexes` prints `DESC` for `DESC NULLS FIRST`, and a row with no target is refused by the generated column's `NOT NULL` before the CHECK.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-transaction-tables.test.ts --coverage.enabled=false)      Tests  27 passed (27)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts src/migration-0023.integration.test.ts src/list-index-order.integration.test.ts)      Tests  8 passed (8)
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false)      Test Files  91 passed (91)     Tests  1306 passed (1306)
```
The upgrade test writes a row of every table on Postgres 17, on an empty database and after an upgrade from `0023_phase7a` with rows in it, and exercises the append-only trigger, whose `TG_ARGV[0:]` slice behaves the same on PGlite and on the server.

### T.2 The db repositories, the redaction, the C16 reads and the prefixes
Stubs `3309f77f`; RED `b827db44`; GREEN `8768ac33`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/transaction-plumbing.test.ts --coverage.enabled=false)
     × nulls the fields, the field keys and the filename, and returns the undeleted files
     × keeps the fields it is told to keep, with their keys, sealed again for the row (P21)
     × stubs the events and reports how many, for the transaction, its files and labels (P04)
     × forgets the stored copies that are about it or mention it (P04)
     × finds the unredacted transactions past their environment's window, oldest first
     × finds txn ids      (and txnf, txnl)
 Test Files  1 failed (1)      Tests  15 failed | 35 passed (50)
GREEN: Test Files  4 passed (4)      Tests  70 passed (70)   (with subject-ids, retention, redaction)
```

### T.3 Masking and the setting (C105.2, C105.8, C107.5, C107.7)
RED `f336ddbe`; GREEN `434f8704`.
```
$ (cd apps/api && pnpm exec vitest run src/auth/pii-transactions.test.ts --coverage.enabled=false)
     × masks fields member-wise, keeping each key and type, and the result still parses
     × masks a stored query's searched value and keeps the field's key (C105.2)
     × masks the searched value in a stored answer's next link, keeping the rest of it
     × leaves no searched value in the preview of a body too long to store whole (2B F008)
 Test Files  1 failed (1)      Tests  7 failed | 4 passed (11)
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/settings-transactions.test.ts --coverage.enabled=false)
     × reads null by default, and is stored and served once set
     × goes back to null                 Tests  2 failed | 4 passed (6)
GREEN (in a private worktree at HEAD, because of another agent's uncommitted import): Test Files  10 passed (10)     Tests  122 passed (122)
```
The `next` link is the exit the plan does not name: `nextLink` repeats the query in the answer, and an API log stores the answer.

### T.4 Hooks, frozen routes, filters and the relationship
Stubs `4b294a4b`, `6ea8c000`; RED `90282694`; GREEN `86744ade`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/transaction-routes.test.ts src/services/transaction-hooks.test.ts src/services/transaction-relationship-served.test.ts --coverage.enabled=false)
     × runs rebuildTransactionFieldKeys and prints counts only
     × runs the hook with the time and the override, and answers its result
     × deletes the objects after the commit and marks them
     × resolves a transaction through its hook and marks it strict
     × POST /transaction-types answers 501 until built     (every route: 404 until registered)
     × GET /inquiries/:id serves the latest transaction, and null without one
```
GREEN, after three corrections: `optionalBody` (Fastify validates a missing body as `null`, so `.optional()` answers 400), the `PUT` being outside the idempotency plugin, and `markTransactionFilesDeleted`'s shape:
```
$ (cd apps/api && pnpm exec vitest run src/routes/transaction-routes.test.ts src/services/transaction-hooks.test.ts src/services/transaction-relationship-served.test.ts --coverage.enabled=false)
 Test Files  3 passed (3)      Tests  91 passed (91)
$ (cd packages/core && pnpm exec vitest run src/webhook-payload.test.ts --coverage.enabled=false)      Tests  28 passed (28)
$ (cd packages/db && pnpm exec vitest run src/repositories/webhooks.test.ts src/repositories/transaction-plumbing.test.ts --coverage.enabled=false)      Tests  67 passed (67)
```
`86744ade` was committed from the index with `git apply --cached`: `api-biometric-lists` had uncommitted edits in `services/redaction.test-support.ts` and `redaction.test.ts`, so a path-scoped commit would have taken them. The same hunks went into its working files, so its next commit keeps them.

### T.5 An account's include served more than it was asked for (C70.5, C107.6)
Stub `41551eca`; RED `d794b0dd`; GREEN `1ccec2e3`. Found while wiring `includedTransactionsFor`: since Stage 1a's two new include values, any include ran `includedReportsFor`, past `reports:read`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/server/account-includes.test.ts --coverage.enabled=false)
     × includes the transactions, as the hook answers them, and never the reports
     × reads no report for a caller with transactions:read alone
     × includes both, reports first, when both were asked for
     × reads no report for an include of list matches
AssertionError: expected [ { type: 'report/watchlist', ...(3) } ] to deeply equal [ { type: 'transaction', ...(3) } ]
 Test Files  1 failed (1)      Tests  4 failed | 3 passed (7)
GREEN: Test Files  3 passed (3)      Tests  67 passed (67)   (with report-includes and accounts)
```
RED first ran a worker out of memory. A failed `not.toHaveBeenCalled` prints the call's arguments, and the PGlite handle among them holds the whole WASM heap, so these tests assert by count.

### T.6 The OpenAPI snapshot
`8705e964`: 18 transaction paths, `x-private` on `redact-biometrics`. Generated with `pnpm --filter @openverify/api openapi:write` in a private worktree at HEAD, so no uncommitted route reached it.

### T.7 The file content's OpenAPI entry (C105.2)
RED `458736e6`; GREEN `a967eec9`; fix `cea18d7b`. `GET /transactions/:id/files/:fileId/content` showed an empty schema under `application/json`. RED (`458736e6`) asked the 200 entry for `{ type: 'string', format: 'binary' }` under `application/octet-stream`; GREEN (`a967eec9`) set the response type to `z.string()` and the snapshot to `{ "type": "string" }`, which `tsc` refused, because the handler sends a `Buffer` (`transactions.ts(228,15)`), found by the forced lint and typecheck gate. `cea18d7b` puts the response type back to `z.instanceof(Buffer)` and states the bytes the way OpenAPI 3.1 does, by the media type alone: the entry is `application/octet-stream` with the content schema `{}`, and the test asserts the 200 entry's media type (`{ 200: { content: { 'application/octet-stream': {} } } }`), no stricter than before `458736e6`. The RED run's output was not kept by the run that stopped; `cea18d7b`'s check:
```
$ (cd apps/api && pnpm exec vitest run src/routes/transaction-routes.test.ts src/openapi.test.ts --coverage.enabled=false)
 Test Files  2 passed (2)      Tests  64 passed (64)      (tsc and eslint rc 0)
```

### Commits that did not read green
- `6ea8c000` (stub) left `apps/api/scripts/blind-index-rebuild.ts` without `transactions` in its result, a `tsc` error fixed by `86744ade`, 20 minutes later. My command printed `api=2` and went on to commit: the chain did not read `tsc`'s exit code. The same fault as `ddef0abb` at (L).
- `a967eec9` (GREEN of T.7) did not typecheck: `apps/api/src/routes/server/transactions.ts(228,15)`, a `Buffer` sent where the response type was `z.string()`. Found by the forced lint and typecheck gate; fixed by `cea18d7b`.

### Column forms (C107.5)
| Column | Form |
|---|---|
| `transactions.fields` | sealed JSON, row AAD `transactions.fields#<id>` |
| `transaction_files.filename` | sealed, row AAD `transaction_files.filename#<id>` |
| `transaction_files.storage_key`, `wrapped_dek` | envelope object, `file` AAD (`encryptBytes`, the row's id as its context) |
| `transaction_field_keys.value_key` | 64-hex HMAC (`hexDigest`), `openverify/identifier-transaction-field/v1` |
| `transactions.reference_id`, `status`, `tags`, `transaction_status_history.*`, `transaction_labels.*` | plaintext by decision: not PII (C105.8), and the docs say not to put personal data in them |
| `transaction_files.mime_type`, `byte_size`, `sha256`, `field_key` | plaintext by decision: no value, as on `files` |
| `transaction_types.*`, `transaction_type_versions.*`, `transaction_objects.*`, `transaction_relations.*` | no PII: names, configuration and ids |

### PGlite migration time (Risks)
`createTestDatabase()` in a fresh process, cold then warm, each pair one hold of `/tmp/openverify-e2e.lock`, with the load beside it. The script (`measure.sh <worktree> <label> <takes>`) writes a one-test file `packages/db/src/zz-pglite-measure.test.ts` into a private worktree that times `await createTestDatabase()`, then for each take, under one hold of the lock, makes an empty directory, runs the test with `OPENVERIFY_TEST_DB_CACHE_DIR` set to it (cold: it migrates and caches the template), runs it again with the same directory (warm), and prints both with `/proc/loadavg`. It removes the test file at the end. Base and head were each a private worktree (`git worktree add --detach`, `pnpm install --frozen-lockfile --offline`), removed afterwards.

| Tree | Cold (ms) | Warm (ms) | Load (1 min) |
|---|---|---|---|
| base `57ac714f` (end of (L)) | 3,742 / 3,854 / 3,763 | 893 / 893 / 880 | 1.44-1.56 |
| head `6ddf6b06` (after (T); the migration is the same since `8d265bc3`) | 3,951 / 4,116 / 3,944 | 947 / 920 / 899 | 1.47-1.70 |

About +0.2 s cold (median 3,763 to 3,951 ms) and +27 ms warm (median 893 to 920 ms). An earlier set taken while the API suites of three agents ran (head cold 5,671 / 9,583 / 20,858 ms at loads 3.9 / 11.5 / 22.8) measured the load, not the migration, and is discarded. Every hook stays far inside its 120 s guard.

### Final gates (foreground, exit codes read from the command itself)
At HEAD `05769f58` (the commits after it, to `6ddf6b06`, are other agents' docs only), 2026-11-01, beside the Stage 3 agents' own gates (load 15-40 during lint and the unit suites):
```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile          rc=0 (Lockfile is up to date)
$ pnpm turbo run typecheck --force                                       rc=0  Tasks: 15 successful, 15 total
$ pnpm turbo run lint --force                                            14 of 15 successful; @openverify/api#lint killed at the 10-minute call cap (load ~30)
$ (cd apps/api && pnpm lint)                                             rc=0  (eslint ., 8 m 44 s)
$ pnpm format:check                                                      rc=0  All matched files use Prettier code style!
$ pnpm turbo run test --force --filter='!@openverify/api'               13 packages finished green, then the call cap stopped it during watchlist:
    e2e 109, flow-spec 117, signals 186, config 187, ui 54, emrtd 318, node 303, core 1,177, contracts 2,615,
    checks 3,791, flow 1,088, db 1,467 (95.65 / 88.65 / 97.03 / 95.88), dashboard 3,971
$ pnpm turbo run test --filter='!@openverify/api' --filter='!@openverify/watchlist'   rc=0  Cached: 13 cached, 13 total (each finished task exited 0)
$ (cd packages/watchlist && pnpm test)                                   rc=0  Tests 759 passed; 98.63% statements
$ (cd apps/api && pnpm exec vitest run --coverage --shard=1/2 --reporter=blob ...) and --shard=2/2   (each rc 1 on its partial coverage, no failed test)
$ (cd apps/api && pnpm exec vitest run --merge-reports=<blobs> --coverage)   rc=0  Test Files 414 passed (414)  Tests 5691 passed (5691)
    All files 96.27 / 88.49 / 97.94 / 96.32
$ pnpm test:integration                                                  rc=0  db 68 in 15 files, api 201 in 34 files
$ bash infra/tests/ci-workflow.test.sh                                   rc=0  209 passed, 0 failed
$ pnpm --filter @openverify/watchlist benchmark:typecheck / benchmark:test   rc=0 (before cea18d7b; no later commit touches what they import)
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e      rc=0  79 passed (20.2 s, load 4.9)
$ flock ... sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/3'   rc=0  32 passed (2.4 m, load 1.3)
$ ... --shard=2/3                                                        rc=0  34 passed (5.3 m, load 2.5)
$ ... --shard=3/3                                                        rc=0  29 passed (4.5 m, load 1.6)
Android gate: not run; no (T) commit touched contracts/fixtures/ or a contract the SDK decodes.
```
A first shard 1/3 call ran out of the 10-minute cap while waiting for the lock and was killed as its stack started; the app processes it left were stopped and the next shard's run took the compose project down first.

## Report (foundation-7b, checkpoint (T))

### Summary
Checkpoint (T) is done. Its code is 18 path-scoped commits, `6af71836..cea18d7b`, on top of the (L) checkpoint (`57ac714f`); `a1b52aa2` holds the plan amendments and the TDD record, and the last commit appends this report. Each unit went stub (where a test needed a name), RED, then GREEN. Nothing was pushed, no dependency was added, no fixture changed, and every worktree of mine is removed (the superseded `/tmp/foundation-7b-t6-wt` was discarded). Evidence: `docs/tdd/phase7-foundation-7b.tdd.md`, "Checkpoint (T): transactions"; decisions: the plan's "Workflow 7B Stage 1b amendments (foundation-7b)", "Checkpoint (T) transactions (ends at `cea18d7b`)", items 1-18.

**What landed**
- **Migration 0024, still one file.** Nine transaction tables, five more `set_updated_at` triggers, and one append-only function, `openverify_transaction_history_append_only`, on `transaction_status_history` and `transaction_labels`. It was prepared in a private worktree and brought in as one commit. The upgrade test writes a row of every table on Postgres 17, on an empty database and after an upgrade from `0023_phase7a`, and exercises the trigger.
- **Data at rest.** `transactions.fields` and `transaction_files.filename` sealed, the file envelope (`storage_key`, `wrapped_dek`), both tables in `REWRAP_TABLES`, field keys as HMACs under the (L) label `identifier-transaction-field`.
- **Redaction and retention.** `redactTransactionRecords` is built in the database, with `stubEventPayloads` and `forgetStoredResponses`, keeping the `never` fields sealed again for the row. `RedactionService.redactTransaction` runs `api-transactions`' hook, audits, dispatches and deletes the objects after the commit. `transaction-retention-days` and the C16 pass (`redactedTransactions`, `failedTransactionRedactions`, `purgedTransactionFiles`). Prefixes `txn`, `txnf`, `txnl`.
- **Masking.** `PII_TRANSACTION_ATTRIBUTES` in both sets; `fields` masked member-wise, keeping each key and type; `filter[identifier][value]` masked in a stored query and in a stored answer's `links.next`.
- **Hooks and routes.** Every transaction, type and version route is frozen and answers 501 until built, including `PUT /transactions/:id/files/:fieldKey` (multipart) and `GET /transactions/:id/files/:fileId/content` (`pii:view`). The relationship resolver, the strict filter subject (with multi-valued template and account-type links), the account include hook, and `rebuildTransactionFieldKeys` in `blind-index:rebuild`.
- **A bug fixed on the way:** since Stage 1a, `GET /accounts/:id?include=transactions` (or `list-matches`) served the account's reports past `reports:read`; each include now runs only its own hook.

**Gates, all in the foreground at HEAD `05769f58` (later commits are other agents' docs only):** install rc 0; forced typecheck 15/15; forced lint 14/15 in turbo plus the API's lint alone rc 0 (turbo's run hit the 10-minute call cap on the API's eslint at load ~30); format rc 0; the 14 other packages' tests green (13 in a forced turbo run, replayed rc 0 from turbo's cache, watchlist alone rc 0); the API suite as two blob shards plus the merge, rc 0, 5,691 tests at 96.27% statements; integration rc 0 (db 68, api 201); `ci-workflow.test.sh` 209 passed; the e2e gate: 79 mocked, then 32, 34 and 29 full-stack. The Android gate was not run: no fixture or decoded contract changed.

**Things to know**
- One open owner question (plan item 7): does redacting an account or inquiry reach its transactions? Today it does not.
- Two commits did not read green, both fixed and recorded: `6ea8c000` (a `tsc` error in `blind-index-rebuild.ts`, fixed by `86744ade`) and `a967eec9` (a `tsc` error in `routes/server/transactions.ts(228,15)`, fixed by `cea18d7b`).
- The 18 code commits carry the retired `Claude-Session` trailer, added by the earlier harness; they cannot be amended under rule 2.

### Handoff
## How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-foundation-7b.tdd.md`, "Checkpoint (T): transactions". Decisions: `docs/plans/phase-7.plan.md`, "Workflow 7B Stage 1b amendments (foundation-7b)", "Checkpoint (T) transactions (ends at `cea18d7b`)", items 1-18.
- db: `pnpm --filter @openverify/db exec vitest run src/phase7-transaction-tables.test.ts src/repositories/transaction-plumbing.test.ts --coverage.enabled=false`.
- Upgrade test: `(cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts)`.
- API: `pnpm --filter @openverify/api exec vitest run src/routes/transaction-routes.test.ts src/services/transaction-hooks.test.ts src/services/transaction-relationship-served.test.ts src/auth/pii-transactions.test.ts src/routes/dashboard/settings-transactions.test.ts src/routes/server/account-includes.test.ts --coverage.enabled=false`.

## Checkpoint commit
Checkpoint (T) ends at `cea18d7b` (code); `a1b52aa2` holds the plan and the record. Stub / RED / GREEN: tables RED `6af71836`, GREEN `8d265bc3`; db repositories and redaction stubs `3309f77f`, RED `b827db44`, GREEN `8768ac33`; masking and setting RED `f336ddbe`, GREEN `434f8704`; services, routes and hooks stubs `4b294a4b` and `6ea8c000`, RED `90282694`, GREEN `86744ade`; account include stub `41551eca`, RED `d794b0dd`, GREEN `1ccec2e3`; OpenAPI snapshot `8705e964`; file content entry RED `458736e6`, GREEN `a967eec9`, fix `cea18d7b`.

## Regenerating migration 0024 (for checkpoint (G))
The whole script, `regen.sh`, is in the TDD record, "How to regenerate migration 0024 (for checkpoint (G))". In order: `pnpm --filter @openverify/core build`; delete `drizzle/0024_phase7b.sql`, `drizzle/meta/0024_snapshot.json` and journal entry 24; `pnpm exec drizzle-kit generate --name phase7b` in `packages/db`; put `CREATE EXTENSION IF NOT EXISTS vector;` first; append the `set_updated_at` triggers of `lists`, `list_items`, `list_matches`, `list_screenings`, `importers`, `transaction_types`, `transaction_type_versions`, `transactions`, `transaction_labels`, `transaction_files` (add (G)'s tables to `TRIGGERS`); append the function `openverify_transaction_history_append_only` and its two triggers (`transaction_status_history_append_only` with arguments `from_status`, `to_status`; `transaction_labels_append_only` with `label`, `model_version`); run prettier on the snapshot. No composite unique key needed moving. Do it in a private worktree and commit tables and migration as one step.

## Tables (`packages/db/src/tables/transactions.ts`, exported from `schema.ts`)
- **`transaction_types`:** `id` (`txntp`), `environment_id`, `name` (1-255), `status` (`TRANSACTION_TYPE_STATUSES`, default `active`), timestamps. Index `transaction_types_environment_id_created_at_id_idx`. Content lives in the versions; `latest-version` and `published-version` are read from them.
- **`transaction_type_versions`:** `id` (`txntpv`), `environment_id`, `transaction_type_id`, `version` (>= 1), `status` (default `draft`), `field_schemas` jsonb `[]`, `statuses` text[] (first member `created`, CHECK), `relation_schemas` jsonb `[]`, `allow_card_like_strings` (default false), `published_at`, timestamps. Unique `transaction_type_versions_transaction_type_id_version_key`; partial unique `transaction_type_versions_one_published_key`; `transaction_type_versions_env_type_created_at_id_idx`; CHECKs on version, status, statuses, caps.
- **`transactions`:** `id` (`txn`), `environment_id`, `transaction_type_id`, `transaction_type_version_id`, `reference_id`, `status`, `fields` (sealed; null only once redacted, `transactions_fields_until_redacted`), `tags` text[], `redacted_at`, `biometrics_redacted_at`, timestamps. Indexes: `transactions_environment_id_created_at_id_idx`, `transactions_environment_id_type_status_created_at_id_idx` (both end in `id DESC`), `transactions_environment_id_reference_id_idx`, `transactions_unredacted_created_at_idx`, `transactions_lower_tags_idx` (gin over the lower-cased tags).
- **`transaction_status_history`** (append-only): identity `id`, `transaction_id`, `from_status`, `to_status`, actor type and `actor_id`, `redacted_at`, `created_at`. Index `transaction_status_history_transaction_created_at_id_idx`.
- **`transaction_labels`** (append-only): `id` (`txnl`), `transaction_id`, `label`, `model_version`, `score`, `redacted_at`, timestamps. Index `transaction_labels_transaction_created_at_id_idx`.
- **`transaction_objects`:** `transaction_id`, one nullable column per kind (`account_id`, `inquiry_id`, `report_id`, `verification_id`), each with its composite foreign key, generated `object_id`; primary key on the transaction and `object_id`; `transaction_objects_environment_id_object_id_idx`; CHECK of exactly one kind.
- **`transaction_relations`:** `transaction_id`, `relation_schema_key`, `account_id` or `related_transaction_id`, generated `target_id`; primary key with the key and target; `transaction_relations_environment_id_target_id_idx`; CHECK of exactly one target.
- **`transaction_field_keys`:** `transaction_id`, `field_key`, `value_key` (64-hex HMAC, `openverify/identifier-transaction-field/v1`); primary key; `transaction_field_keys_lookup_idx`.
- **`transaction_files`:** `id` (`txnf`), `transaction_id`, `field_key`, `filename` (sealed), `mime_type`, `byte_size` (>= 0), `sha256`, `storage_key`, `wrapped_dek` (envelope), `deleted_at`, `redacted_at`, timestamps. Unique `transaction_files_storage_key_key`; partial unique `transaction_files_one_live_per_field_key`; `transaction_files_undeleted_redacted_idx`.

## Repositories (`packages/db/src/repositories/`, all exported through `index.ts`)
Each stub rejects with `TransactionRepositoryNotBuiltError` (`transaction-repository.ts`, with `transactionRepositoryNotBuilt(name)`). They are typed `const`s: the owner (`api-transactions`) rewrites each as a function of the same signature.
- `transaction-types.ts`: stubs `createTransactionType`, `getTransactionType`, `listTransactionTypes`, `renameTransactionType`, `archiveTransactionType`; types `TransactionType`, `NewTransactionType`, `TransactionTypeFilters`.
- `transaction-type-versions.ts`: stubs `createTransactionTypeVersion`, `getTransactionTypeVersion`, `listCurrentTransactionTypeVersions`, `updateTransactionTypeVersionDraft`, `publishTransactionTypeVersion`; types `TransactionTypeVersion`, `TransactionTypeVersionValues`, `NewTransactionTypeVersion`.
- `transactions.ts`: BUILT `toTransaction`; stubs `createTransaction`, `getTransaction`, `lockTransaction`, `listTransactions`, `updateTransaction`; types `Transaction`, `NewTransaction`, `TransactionChanges`, `TransactionFilters`.
- `transaction-history.ts`: stubs `appendTransactionStatus`, `listTransactionStatusHistory`; type `NewTransactionStatus`.
- `transaction-labels.ts`: stubs `addTransactionLabel`, `latestTransactionLabels`, `listTransactionLabels`; type `NewTransactionLabel`.
- `transaction-links.ts`: stubs `addTransactionObjects`, `removeTransactionObjects`, `listTransactionObjects`, `latestTransactionsOfObjects`, `addTransactionRelation`, `removeTransactionRelation`, `listTransactionRelations`; types `TransactionObjectId`, `TransactionRelationInput`.
- `transaction-field-keys.ts`: stub `replaceTransactionFieldKeys`; type `TransactionFieldKey`.
- `transaction-files.ts`: BUILT `toTransactionFile`, `listRedactedTransactionFiles`, `markTransactionFilesDeleted`; stubs `createTransactionFile`, `getTransactionFile`, `listTransactionFiles`; types `TransactionFile`, `NewTransactionFile`, `RedactedTransactionFile`.
- `transaction-redaction.ts`: BUILT `redactTransactionRecords(tx, options: TransactionRedactionOptions) => TransactionRedaction`: nulls `fields` (re-sealing the kept keys, `keepFieldKeys`), the field keys and file names, redacts the history and labels under `openverify.transaction_redaction = 'on'`, calls `stubEventPayloads` and `forgetStoredResponses` for the transaction, its files and labels, and returns the undeleted files.
- `retention.ts`: BUILT `listTransactionsDueForRetention` (the unredacted transactions past their environment's window, oldest first).
- `@openverify/db/testing`: `seedTransactionType`, `seedTransaction`, `seedTransactionFile`, `seedTransactionStatus`, `seedTransactionLabel`, `seedTransactionFieldKey`, all by SQL.

## Sealing, envelopes, rewrap, labels, masking, API logs, redaction, subjects, retention
- `ENCRYPTED_COLUMNS`: `transactions.fields` (row), `transaction_files.filename` (row), `transaction_files.wrapped_dek` (file). `SEALED`: `transactionFields`, `transactionFileFilename`. The file object passes the row's id as its `encryptBytes` context.
- `REWRAP_TABLES` gains `transaction_files`, `transactions`.
- No new identifier label: `identifier-transaction-field` came at (L).
- `MASKED_ATTRIBUTES` (`auth/pii.ts`) and the API-log set (`services/api-logs.ts`) join `PII_TRANSACTION_ATTRIBUTES` (`fields`, `content`, `filter[identifier][value]`). `maskFieldValues` (`auth/pii.ts`) keeps each field's key and `type` and nulls `value`. In a stored API log read without `pii:view`, `filter[identifier][value]` is in `MASKED_MEMBERS` and is emptied in a stored answer's `links.next`.
- `REDACTION_SUBJECT_ID_PREFIXES` gains `txn`, `txnf`, `txnl`.
- `RedactionService.redactTransaction(ctx, id, actor, { includeNever })` (`ports.ts`, `services/redaction.ts`); `purgeRedactedTransactionFiles` (`services/redaction.ts`). The fake `createFakeRedactionService` records `transaction` targets.
- `redaction.test-support.ts`: `TRANSACTION_PII_TABLES` (`transaction_files`, `transactions`), scanned by `redactTransactionRecords`' tests; not in `SUBJECT_PII_TABLES` pending plan item 7.
- Setting `transaction-retention-days` (`transactionRetentionDaysSchema` in `packages/contracts/src/dashboard-api.ts`, 1-3,650 or null; `EnvironmentSettings`, dashboard settings, `settings:write`). `runRetention` reports `redactedTransactions`, `failedTransactionRedactions`, `purgedTransactionFiles` (failures in `failedPurges`); `redactDueReports` became `redactDueObjects(kind, ...)` in `services/retention.ts`.

## Hooks and service stubs (file, signature; owner `api-transactions`)
- `redactTransactionInTx: RedactTransactionInTx = (tx, deps: TransactionRedactionDeps, environmentId, transactionId, options: RedactTransactionInTxOptions) => RedactedTransaction`: `services/transactions/redaction.ts`. Reads the pinned version, passes the `never` keys as `keepFieldKeys` (`[]` with `include-never`) and stages `transaction.redacted`.
- `resolveTransactionRelationships: (db, environmentId, objectIds) => ReadonlyMap<string, string | null>`: `services/transactions/relationships.ts`. Unbuilt it answers an empty map and every read leaves the `transaction` member out. It is called by `inquiryResourceOf`, `getInquiryDocument`, `listInquiries`, `getVerificationDocument`, `stageVerificationEvent`, the console inquiry read and list, and `reportViewOf`. `inquiryRecordOf`, `inquiryResourceFor`, `toInquiryResource`, `verificationRecordOf` and `toVerificationResource` gained a trailing parameter.
- `resolveTransactionFilterSubjects: (db, environmentId, payloads) => Pick<WebhookFilterSubject, 'inquiryTemplateIds' | 'accountTypeIds'>[]`: `services/transactions/filter-subjects.ts`; strict in `eventFilterSubjects` (`events/subject.ts`). `WebhookFilterSubject` and `EventSubject` gain `inquiryTemplateIds` and `accountTypeIds`, read by `matchesWebhookFilters` and `listWebhooksForEvent` with `?|`. Unbuilt, a transaction fails any present filter; a `transaction-type` event is strict with nothing to resolve.
- `includedTransactionsFor: (tx, environmentId, { accountId }, mask) => ...` and `MAX_INCLUDED_TRANSACTIONS`: `services/transactions/includes.ts`, used by `routes/server/accounts.ts`, which now runs each include's own hook (`api-lists` adds `list-matches` to that one array).
- `rebuildTransactionFieldKeys: (db, key, options) => RebuildIndexesResult`: `services/transactions/rebuild.ts`, run by `apps/api/scripts/blind-index-rebuild.ts`, whose result gains `transactions`; zero counts until built.
- Service stubs (each `notBuilt(name)` from `services/transactions/acting.ts`, a 501; `TransactionActing`): `services/transactions/types.ts` `createTransactionType`, `listTransactionTypes`, `getTransactionTypeDocument`, `updateTransactionType`, `archiveTransactionType`, `ListTransactionTypesQuery`; `services/transactions/versions.ts` `createTransactionTypeVersion`, `getTransactionTypeVersionDocument`, `updateTransactionTypeVersion`, `publishTransactionTypeVersion`; `services/transactions/transactions.ts` `createTransaction`, `listTransactions`, `getTransactionDocument`, `updateTransaction`, `redactTransaction`, `redactTransactionBiometrics`, `addTransactionObjects`, `removeTransactionObjects`, `addTransactionRelation`, `removeTransactionRelation`, `changeTransactionTags`, `labelTransaction`, types `ListTransactionsQuery`, `GetTransactionQuery`, `TransactionTagChange`; `services/transactions/files.ts` `putTransactionFile(deps, acting, id, fieldKey, ...)`, `readTransactionFile`, types `TransactionFileUpload`, `TransactionFileContent`.
- `TransactionProblemError(code, detail, { errors?, headers? })`: `errors.ts`, status from `TRANSACTION_PROBLEM_STATUSES`.
- No queue, sweep, worker or port is new at (T); the fakes gain only the redaction service's `transaction` target.

## Frozen routes (schemas from `@openverify/contracts`; 501 until built)
- **`routes/server/transactions.ts`:** `POST /transactions` (`createTransactionBodySchema`, 201 `transactionDocumentSchema`, `transactions:write`); `GET /transactions` (`listTransactionsQuerySchema`, `transactionListDocumentSchema`, `transactions:read`); `GET /transactions/:id` (`getTransactionQuerySchema`, `transactionIncludeDocumentSchema`, new in contracts); `PATCH /transactions/:id` (`updateTransactionBodySchema`); `DELETE /transactions/:id` (`transactions:redact`, `optionalBody(redactTransactionBodySchema)`); `POST /transactions/:id/redact-biometrics` (`transactions:redact`, `x-private`); `PUT /transactions/:id/files/:fieldKey` (multipart, `@fastify/multipart` registered in the plugin, outside the idempotency plugin); `GET /transactions/:id/files/:fileId/content` (`application/octet-stream`, content schema `{}`, response type `z.instanceof(Buffer)`, `requirePiiView` in the handler); `POST /transactions/:id/add-objects`, `/remove-objects` (`transactionObjectsBodySchema`); `/add-relation`, `/remove-relation` (`transactionRelationBodySchema`); `/add-tag` (`addTagBodySchema`), `/remove-tag` (`removeTagBodySchema`), `/set-tags` (`setTagsBodySchema`); `/label` (`labelTransactionBodySchema`). Params are `:fileId` and `:fieldKey` (Fastify reads a hyphen as a separator), in OpenAPI too.
- **`routes/server/transaction-types.ts`:** `POST /transaction-types` (`createTransactionTypeBodySchema`, 201 `transactionTypeDocumentSchema`, `transaction-types:write`); `GET /transaction-types` (`listTransactionTypesQuerySchema`, `transactionTypeListDocumentSchema`, `transactions:read`); `GET`, `PATCH` (`updateTransactionTypeBodySchema`), `DELETE /transaction-types/:id`.
- **`routes/server/transaction-type-versions.ts`:** `POST /transaction-type-versions` (`createTransactionTypeVersionBodySchema`, 201 `transactionTypeVersionDocumentSchema`); `GET`, `PATCH /transaction-type-versions/:id` (`updateTransactionTypeVersionBodySchema`); `POST /transaction-type-versions/:id/publish` (`optionalBody(publishTransactionTypeVersionBodySchema)`).
- The OpenAPI snapshot (`docs/api/openapi.json`) holds the 18 transaction paths (`8705e964`, `cea18d7b`).

### Contract deviations
1. C105.4's tables are held as C71 holds a template: transaction_types holds a name and a status, the content lives in transaction_type_versions, and latest-version and published-version are read from the versions. transactions gains transactions_environment_id_reference_id_idx (filter[reference-id]) and transactions_unredacted_created_at_idx (the C16 walk) beyond C105.4's two indexes, each ending in id DESC; fields may be null only once redacted (plan (T) item 1).
2. The history and the labels are append-only by one function, openverify_transaction_history_append_only, with the free-text columns as trigger arguments: an UPDATE passes only under openverify.transaction_redaction = 'on' when it nulls every one of them, stamps redacted_at and changes nothing else; a DELETE passes only under openverify.environment_deletion = 'on'. C105.5's free text is read as from_status and to_status, and label and model_version (plan (T) item 2).
3. transaction_objects holds accounts too (C105.1's related-objects), and both link tables keep one nullable column per kind with its composite foreign key and a generated object_id or target_id (plan (T) item 3).
4. transaction_files gains redacted_at and sha256 beyond C105.4, and a partial unique index of one live file per field key; a file nested in an array has no route and is refused in a JSON body (plan (T) item 4).
5. The transaction redaction is built in the database (redactTransactionRecords) by foundation-7b; redactTransactionInTx is api-transactions' hook; tags, the reference and the current status stay, and a later run with include-never can take a kept field and is audited (plan (T) item 5).
6. A redacted label is not served, because transactionLabelResourceSchema requires model-label (plan (T) item 6).
7. OPEN, for the owner: does redacting an account or an inquiry reach its transactions? C105.5 is silent. Today it does not: transactions and transaction_files sit in TRANSACTION_PII_TABLES, not SUBJECT_PII_TABLES. Proposal: redactAccount redacts the transactions linked by transaction_objects.account_id or transaction_relations.account_id through redactTransaction, as C73.5 does for reports, and the two tables move to SUBJECT_PII_TABLES (plan (T) item 7).
8. WebhookFilterSubject and EventSubject gain inquiryTemplateIds and accountTypeIds for C107.4's several links, read with ?| by matchesWebhookFilters and listWebhooksForEvent; unbuilt, a transaction fails any present filter (plan (T) item 8).
9. The transaction relationship is resolved at every read by resolveTransactionRelationships; inquiryRecordOf, inquiryResourceFor, toInquiryResource, verificationRecordOf and toVerificationResource each gain a trailing parameter; inquiry.created's and the flow's verification event payloads are not wired (plan (T) item 9).
10. Bug fixed: since Stage 1a, GET /accounts/:id?include=transactions (or list-matches) served the account's reports past reports:read. Each include now runs its own hook; api-lists needs leave to add its list-matches hook to that one array in routes/server/accounts.ts (plan (T) item 10).
11. transaction-retention-days and the C16 pass: redactDueReports became redactDueObjects(kind, ...), keeping its log keys; a transaction the unbuilt hook cannot redact fails the run, which cannot happen before api-transactions writes one (plan (T) item 11).
12. blind-index:rebuild runs rebuildTransactionFieldKeys, beyond the (T) bullet, so a key change does not leave filter[identifier] silently answering nothing (plan (T) item 12).
13. Masking: fields keeps each key and type and nulls value (maskFieldValues); filter[identifier][value] joins the API-log MASKED_MEMBERS and is emptied in a stored answer's links.next (plan (T) item 13).
14. transactionIncludeDocumentSchema is new in contracts, because transactionDocumentSchema is strict and GET /transactions/:id takes include (plan (T) item 14).
15. Routes: :fileId and :fieldKey (Fastify reads a hyphen as a separator), also in OpenAPI; @fastify/multipart registered in the transaction plugin; the PUT keeps no idempotent answer; DELETE /:id, redact-biometrics and publish take optionalBody(...); the file content checks requirePiiView in the handler (plan (T) item 15).
16. The OpenAPI snapshot was regenerated at (T), as at (L) (plan (T) item 16). The file content is documented as application/octet-stream with the content schema {}, as OpenAPI 3.1 states bytes by the media type; the attempt at { type: string } (458736e6, a967eec9) broke the API typecheck and was undone by cea18d7b, whose test asserts the media type only, no stricter than before 458736e6 (plan (T) item 17).
17. Existing tests changed with the plan, none weakened: the public table list, ENCRYPTED_COLUMNS, REDACTION_SUBJECT_ID_PREFIXES, the position of the devices line of blind-index:rebuild, the redaction coverage test, the pinned retention reports and their RedactionService doubles, DASHBOARD_SETTINGS_DEFAULTS, and RetentionSetting in the dashboard (typecheck minimum) (plan (T) item 18).
18. Commits that did not read green: 6ea8c000 (a tsc error in apps/api/scripts/blind-index-rebuild.ts, fixed by 86744ade) and a967eec9 (a tsc error at apps/api/src/routes/server/transactions.ts(228,15), fixed by cea18d7b). 86744ade was committed from the index with git apply --cached because api-biometric-lists had uncommitted edits in the same two test-support files. The 18 code commits carry the retired Claude-Session trailer added by the earlier harness; rule 2 forbids amending them.

### Followups
- foundation-7b, checkpoint (G): extend 0024 with regen.sh from the TDD record (add the graph tables to TRIGGERS), add the error classes for GRAPH_PROBLEM_STATUSES, PII_GRAPH_ATTRIBUTES in both masking sets at the attribute level (a graph node's value is a nested member), the prefix grphq (and grqt, grqtv if they hold PII), and regenerate the OpenAPI snapshot after the last checkpoint.
- api-transactions: replace the typed-const repository stubs and the service stubs with functions of the same signatures; build redactTransactionInTx, resolveTransactionRelationships, resolveTransactionFilterSubjects, includedTransactionsFor and rebuildTransactionFieldKeys; mask fields with mask.attributes(built.attributes); enforce the transaction policies.
- Owner: decide plan (T) item 7 (account or inquiry redaction reaching its transactions). If yes, the owner of redactAccount builds it and moves transactions and transaction_files into SUBJECT_PII_TABLES, really seeded by seedPiiSubject.
- api-lists: add the list-matches include hook to the include array in apps/api/src/routes/server/accounts.ts (plan (T) item 10 gives the leave).
- Owner or 7C: orphaned e2e app processes from other agents' calls killed at the 10-minute cap are still running (pids 948384-948588, started about 00:48, and 960330-960516, started about 01:03 on 2026-11-01: vision, API, worker, flow preview, dashboard). They are not mine, so I left them; whoever owns them should stop them, because an orphan worker could read a later run's queues if the ports are shared. A shard call killed at the cap leaves its stack running; the e2e runner could stop its child processes on SIGTERM.
- Owner or 7C: the forced turbo lint and the non-API forced test run do not fit one 10-minute call when three agents' suites run together (load ~30); the API's eslint alone takes about 9 minutes then.

### Measurements
- PGlite createTestDatabase, three takes each, one cold and warm pair per hold of the e2e lock, load 1.44-1.70: base 57ac714f (end of (L)) cold 3,742 / 3,854 / 3,763 ms, warm 893 / 893 / 880 ms; head 6ddf6b06 (after (T)) cold 3,951 / 4,116 / 3,944 ms, warm 947 / 920 / 899 ms. About +0.2 s cold and +27 ms warm (medians). An earlier head set at loads 3.9-22.8 (cold up to 20,858 ms) measured the load and is discarded.
- API unit suite: 5,691 tests in 414 files at 96.27 / 88.49 / 97.94 / 96.32 (statements, branches, functions, lines), two blob shards plus the merge.
- Other packages: core 1,177, contracts 2,615, checks 3,791, db 1,467 (95.65 / 88.65 / 97.03 / 95.88), dashboard 3,971, flow 1,088, watchlist 759, node 303, emrtd 318, signals 186, config 187, flow-spec 117, e2e helpers 109, ui 54 (includes Stage 2-3 work in the tree).
- Integration: db 68 in 15 files, api 201 in 34 files.
- e2e: mocked flow 79 in 20.2 s (load 4.9); full stack 95 tests in shards of 32, 34 and 29: 2.4, 5.3 and 4.5 minutes (loads 1.3, 2.5, 1.6).
- infra/tests/ci-workflow.test.sh: 209 passed. benchmark:typecheck and benchmark:test rc 0 (before cea18d7b; nothing they import changed since).
- The API's eslint alone took 8 m 44 s at load ~28; the forced turbo lint does not fit one 10-minute call at that load.
- Migration 0024 after (T): 21 tables of 7B (12 list, 9 transaction), 1 column, 10 set_updated_at triggers, 1 append-only function on 2 triggers.

### Blockers
- none

## Checkpoint (G): graph

Ends at `e2c41177` (the last code commit). Base `603f917f` (the (T) report). Decisions: the plan's "Workflow 7B Stage 1b amendments (foundation-7b)", "Checkpoint (G) graph (ends at `e2c41177`)", items 1-18. This was the last Stage 1b checkpoint, so the OpenAPI snapshot is final for Stage 1b.

### How to regenerate migration 0024 (after checkpoint (G))

The script of the top of this record, with the graph tables in `TRIGGERS` and one more hand edit at the end. The whole of it, as run for (G) (`/tmp/opencode/7b/foundation-7b/g/regen.sh`):

```bash
#!/bin/bash
# Regenerates migration 0024 as one file: core built first, the old file, snapshot and journal
# entry 24 removed, drizzle-kit generate, then the hand edits re-applied.
# Usage: regen.sh <repo root>. Each later change adds its tables to TRIGGERS, and any further
# append-only trigger, seed statement or composite unique key move as a further hand edit below.
set -euo pipefail
ROOT=${1:-/home/mhnoor/persona-opensource}
source /home/mhnoor/persona-opensource/scripts/env.sh >/dev/null
cd "$ROOT"
pnpm --filter @openverify/core build >/dev/null 2>&1
cd packages/db
rm -f drizzle/0024_phase7b.sql drizzle/meta/0024_snapshot.json
python3 - <<'PY'
import json
p='drizzle/meta/_journal.json'
j=json.load(open(p))
j['entries']=[e for e in j['entries'] if e['idx']!=24]
open(p,'w').write(json.dumps(j,indent=2)+'\n')
PY
pnpm exec drizzle-kit generate --name phase7b 2>&1 | tail -1
python3 - <<'PY'
p='drizzle/0024_phase7b.sql'
s=open(p).read().rstrip('\n')
assert 'DROP TABLE' not in s and 'DROP TYPE' not in s
s='CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint\n'+s
if not s.endswith('--> statement-breakpoint'):
    s+='--> statement-breakpoint'
TRIGGERS=['lists','list_items','list_matches','list_screenings','importers',
          'transaction_types','transaction_type_versions','transactions','transaction_labels',
          'transaction_files',
          'graph_index_jobs','graph_index_state','graph_query_templates',
          'graph_query_template_versions','graph_queries']
s+='\n'+'--> statement-breakpoint\n'.join(f'CREATE TRIGGER "{t}_set_updated_at" BEFORE UPDATE ON "{t}" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();' for t in TRIGGERS)
# Hand edit (C105.4, the C73 pattern): the status history and the labels are append-only.
s+='''--> statement-breakpoint
-- Hand edit (C105.4, C105.5; the C73.2 pattern): a transaction's status history and labels are
-- append-only. The one UPDATE allowed is a transaction redaction
-- (`openverify.transaction_redaction = 'on'`, transaction-local, set only by the redaction
-- repository) that nulls the trigger's free-text columns and stamps `redacted_at`, with every other
-- column unchanged. A DELETE is refused unless the transaction deletes an environment
-- (`openverify.environment_deletion = 'on'`): transactions are redacted, never deleted (C105.5).
-- Neither table holds a sealed value, so a KEK rewrap has no case here.
CREATE OR REPLACE FUNCTION "openverify_transaction_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free_text text[] := TG_ARGV[0:];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('openverify.environment_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  IF coalesce(current_setting('openverify.transaction_redaction', true), '') = 'on'
     AND NEW."redacted_at" IS NOT NULL
     AND (to_jsonb(NEW) - free_text - 'redacted_at' - 'updated_at')
       = (to_jsonb(OLD) - free_text - 'redacted_at' - 'updated_at')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(free_text) AS member(name) WHERE to_jsonb(NEW) ->> member.name IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "transaction_status_history_append_only" BEFORE UPDATE OR DELETE ON "transaction_status_history" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('from_status', 'to_status');--> statement-breakpoint
CREATE TRIGGER "transaction_labels_append_only" BEFORE UPDATE OR DELETE ON "transaction_labels" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('label', 'model_version');'''
# (G) (C101.5, H10, V11): every environment that predates the graph starts each kind incomplete.
s+='''--> statement-breakpoint
-- Hand edit (C101.5, H10, V11): every environment that exists before this migration starts each
-- graph kind (the codes of GRAPH_KIND_REGISTRY, 1-18) incomplete, so `graph-backfill` indexes what
-- it already holds. An environment created later has no row, which reads complete.
INSERT INTO "graph_index_state" ("environment_id", "kind", "complete")
SELECT "environments"."id", "kinds"."code", false
  FROM "environments" CROSS JOIN generate_series(1, 18) AS "kinds"("code");'''
open(p,'w').write(s)
j='drizzle/meta/_journal.json'
t=open(j).read()
if not t.endswith('\n'): open(j,'w').write(t+'\n')
PY
(cd "$ROOT" && pnpm exec prettier --write packages/db/drizzle/meta/0024_snapshot.json >/dev/null)
echo regenerated
```

Run it in a private worktree, check with a sorted diff of the statements that every earlier statement survives (at (G): 0 removed, 41 added), then copy the SQL, the snapshot and the journal into the shared tree and commit them with the tables as one step. No composite unique key needed moving: `inquiries` and `accounts` had their `(environment_id, id)` keys.

### G.1 Migration 0024 extended: the graph tables (C101, C102)
RED `44a364c6`; GREEN `1ffd7875`, prepared in a private worktree and brought in as one commit.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-graph-tables.test.ts src/migrate.test.ts src/schema-v2.test.ts src/testing.test.ts --coverage.enabled=false)
     × extends 0024 with the Workflow 7B (G) graph tables, their triggers and the upgrade state, no table recreated (C101, C102)
     × lists every encrypted column for the KEK rewrap
     × creates every table of the (G) checkpoint
     ... (every catalog and constraint test)
AssertionError: graph_index_jobs: expected 'CREATE EXTENSION IF NOT EXISTS vector…' to contain 'CREATE TABLE "graph_index_jobs"'
 Test Files  4 failed (4)      Tests  25 failed | 181 passed (206)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts)
     × creates the graph tables on an empty database; a new environment has no backfill to do
     × upgrades a database at 0023 with rows in it: the version keeps its row with an empty list-config
Caused by: error: relation "graph_attributes" does not exist
Caused by: error: relation "graph_index_state" does not exist
      Tests  2 failed | 2 passed (4)
```
GREEN (in the worktree), after correcting two expectations of mine: a source type outside the vocabulary also fails the source id's CHECK, which Postgres may report first (the test now accepts either and reads the type CHECK's definition from the catalog), and a row whose status is not `pending` needs its `indexed_at` to reach the status CHECK.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-graph-tables.test.ts --coverage.enabled=false)      Tests  23 passed (23)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts src/migration-0023.integration.test.ts)      Tests  6 passed (6)
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false)      Test Files  97 passed (97)     Tests  1476 passed (1476)
```
On Postgres 17 the upgrade test writes 0023's rows, migrates, finds an incomplete row of each of the 18 kinds for that environment and none for one created after, writes a row of every graph table, and finds the stored result by its account through the GIN index. `GRAPH_QUERY_PII_TABLES` joined the API's redaction coverage in the same commit, because `graph_queries.params` joined `ENCRYPTED_COLUMNS`.

### G.2 The db repository stubs and what is built in them
Stubs `c71ad14a`; RED `792f09e2`; GREEN `d70cfb8a`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/graph-plumbing.test.ts --coverage.enabled=false)
     × writes one pending row per inquiry; a later call keeps the first
     × empties the params, nodes, links, node map and accounts, and sets redacted-at
     × stubs the query’s events and reports how many
     × forgets the stored copies that are about it or mention it
     × finds the unredacted queries past 30 days by default, or the environment’s window, oldest first
     × finds grphq ids, and not the template ids
GraphRepositoryNotBuiltError: createGraphIndexJob is not built yet (api-graph)
AssertionError: expected [] to deeply equal [ 'grphq_01M6ATPEPX7ZZGKY6K1SJNJVJG' ]
      Tests  9 failed | 1 passed (10)
GREEN: (cd packages/db && pnpm exec vitest run --coverage.enabled=false)  Test Files  98 passed (98)  Tests  1489 passed (1489)
```

### G.3 Masking and the settings (C101.5, C102.4, C102.7, C107.5, C107.7)
Stub `0337c4fb` (the settings hook); RED `66339f9a`; GREEN `6c88bd9a`, format `42a12d88`.
```
$ (cd apps/api && pnpm exec vitest run src/auth/pii-graph.test.ts src/routes/dashboard/settings-graph.test.ts --coverage.enabled=false)
     × joins every graph name
     × masks params member-wise, keeping each name, and the result still parses
     × masks a query body’s parameter-map and its deprecated variable-map
     × serves the defaults: indexing on, weak kinds and components off, results kept 30 days
     × graph-indexing needs settings:privacy; settings:write alone gets 403 and nothing changes (F37)
     × sees the settings before and after each change
      Tests  12 failed | 11 passed (23)
GREEN: Test Files  11 passed (11)      Tests  131 passed (131)   (src/auth, the settings tests, api-logs)
```
`masks the audited unmask's plaintext value (C102.6)` passed in RED: `value` was already masked at the attribute level since (L).

### G.4 Hooks, queues, workers, repeatable jobs, the producer and the frozen routes
Stubs `155e1623`, `9b9fc484`, `bc108b3d`, `8725355b`; RED `d579b6b9` (124 tests); GREEN `e2c41177`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/graph-routes.test.ts src/services/graph-hooks.test.ts src/services/graph-index-hook.test.ts src/routes/flow/session-graph-hook.test.ts src/jobs/graph-queues.test.ts src/worker-graph.test.ts src/jobs/repeatable/phase7.test.ts src/services/context.test.ts src/container.test.ts --coverage.enabled=false)
     × passes on every dependency, including the Phase 2 ports, by reference
     × schedules the two sweeps, the backfill tick and the nightly components, with their deps
     × starts them only with the graph producers
     × POST /graph-queries answers 501 until built          (every graph route: 404 until registered)
     × runs on POST /accounts with the fields and the reference id, in the transaction
     × after the inquiries moved, under the consolidation’s locks
     × runs the inquiry’s hook in its redaction’s transaction
     × runs rebuildGraphIndexes and prints counts only
     × is strict: a graph query fails any filter that is present
     × on the first move into completed (["start_inquiry","complete_inquiry"])
     × once, in the start’s transaction, with the account, the session and the network
     × never rolls the start back when the indexer fails
 Test Files  8 failed | 1 passed (9)      Tests  60 failed | 64 passed (124)
$ (cd packages/db && pnpm exec vitest run src/repositories/graph-plumbing.test.ts --coverage.enabled=false)
     × redacts one batch of what is due, oldest first, and answers how many
```
GREEN, after one correction of mine: the inquiry test API resolves accounts through a test double, so the test of the account an inquiry creates calls `createAccountsService().resolveForInquiry` directly.
```
 Test Files  10 passed (10)      Tests  135 passed (135)   (the nine files and blind-index-rebuild.test.ts)
 Test Files  41 passed (41)      Tests  647 passed (647)   (accounts, redaction, events, workers, retention, the flow routes, inquiries, the (L) and (T) hooks)
$ pnpm --filter @openverify/api openapi:write             rc 0 (eleven graph paths; 2,626 lines added)
```
The queue test (`graph-queues.test.ts`) passed in RED: `jobs/graph-queues.ts` came whole with the stubs, as `list-queues.ts` did at (L).

### Commits that did not read green
- `6c88bd9a` (GREEN of G.3) left `apps/dashboard/src/components/operators/settings-fields.ts` unformatted: the chain read `prettier --check | tail -1`, tail's status. Fixed by `42a12d88` a minute later; nothing else in it failed (`tsc` and the tests had passed).

### Column forms (C107.5)
| Column | Form |
|---|---|
| `graph_queries.params` | sealed JSON, row AAD `graph_queries.params#<id>` |
| `graph_attributes.value_key` | 64-hex HMAC under the kind's identifier label (F10) |
| `graph_attributes.key_id`, `kind`, `account_id`, `source_*`, `inquiry_id`, times | plaintext by decision: a key id, a frozen code and ids, as on `devices` |
| `graph_queries.nodes`, `links`, `node_map`, `account_ids`, `kinds_not_indexed` | plaintext by decision: account ids, random node ids local to the result, value keys and kind codes, never a value (P17) |
| `graph_index_jobs.*`, `graph_index_state.*`, `graph_components.*` | no PII: ids, codes, counts and times |
| `graph_query_templates.*`, `graph_query_template_versions.config` | no PII: names and `{{param}}` bindings, never a value (C102.2) |

### PGlite migration time (Risks)
`createTestDatabase()` in a fresh process, cold then warm, each pair one hold of `/tmp/openverify-e2e.lock` (`measure.sh`, as at (T)). Base and head were private worktrees.

| Tree | Cold (ms) | Warm (ms) | Load (1 min) |
|---|---|---|---|
| base `78da85a1` (before (G)) | 3,864 / 3,840 / 3,895 | 892 / 893 / 914 | 0.92-1.08 |
| head `e2c41177` (after (G)) | 4,624 / 4,007 / 3,966 | 942 / 930 / 949 | 6.13-7.75 |
| interleaved, base `44a364c6` (same migration as `78da85a1`) | 7,154 / 7,448 | 1,692 / 1,625 | 7.86-11.20 |
| interleaved, head `e2c41177` | 7,981 / 8,751 | 1,945 / 1,566 | 10.28-12.16 |

The first pair moved from medians of 3,864 to 4,007 ms cold and 893 to 942 ms warm, but the head was measured at a load six times the base's; the interleaved pairs, at the same load, differ by about 0.5-1.1 s cold and -60 to +250 ms warm, as wide as the noise. Every PGlite hook stays far inside its 120 s guard.

### Final gates (foreground, exit codes read from the command itself)
At HEAD `e2c41177` and the commits other agents made after it (`api-transactions`'), 2026-11-01, loads 8-37 during the unit and integration suites:
```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile        rc=0 (Lockfile is up to date)
$ pnpm turbo run typecheck --force                                     rc=0  Tasks: 15 successful, 15 total
$ pnpm turbo run lint --force --filter='!@openverify/api'              rc=0  Tasks: 14 successful, 14 total
$ (cd apps/api && pnpm lint)                                           rc=0  (eslint ., 1 m 51 s)
$ pnpm format:check                                                    rc=0
$ pnpm turbo run test --force --filter='!@openverify/api'             rc=0  Tasks: 14 successful, 14 total
    e2e 109, node 303, config 187, ui 54, emrtd 318, signals 186, core 1,177, flow-spec 117,
    contracts 2,616, checks 3,791, flow 1,088, db 1,490 (94.64 / 87.65 / 94.6 / 94.82), dashboard 3,971, watchlist 759
$ (cd apps/api && pnpm exec vitest run --coverage --coverage.reportsDirectory=<own dir> --shard=1/2 --reporter=blob ...) and --shard=2/2
    each rc 1 on its partial coverage, no failed test (an own reports directory, because another
    agent's API run held apps/api/coverage)
$ (cd apps/api && pnpm exec vitest run --merge-reports=<blobs> --coverage --coverage.reportsDirectory=<own dir>)   rc=0
    Test Files 426 passed (426)  Tests 5813 passed (5813)  All files 96.06 / 88.13 / 97.69 / 96.12
$ pnpm test:integration                                                rc=0  db 69 in 15 files (183 s), api 204 in 35 files (417 s)
$ bash infra/tests/ci-workflow.test.sh                                 rc=0  209 passed, 0 failed
$ pnpm --filter @openverify/watchlist benchmark:typecheck              rc=0
$ pnpm --filter @openverify/watchlist benchmark:test                   rc=0
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e    rc=0  79 passed (22.2 s)
$ flock ... sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/3'   rc=0  32 passed (2.5 m, load 11.4)
$ ... --shard=2/3                                                      rc=0  34 passed (5.2 m, load 4.9)
$ ... --shard=3/3                                                      rc=0  29 passed (4.6 m, load 1.2)
```
The Android gate was not run: no fixture under `contracts/fixtures/` and no contract the SDK decodes changed. The turbo lint was run without the API, then the API's lint on its own, because the API's eslint alone has exceeded one 10-minute call at load ~30 (the (T) record).

## Report (foundation-7b, checkpoint (G))

### Handoff

#### How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-foundation-7b.tdd.md`, "Checkpoint (G): graph". Decisions: `docs/plans/phase-7.plan.md`, "Workflow 7B Stage 1b amendments (foundation-7b)", "Checkpoint (G) graph (ends at `e2c41177`)", items 1-18.
- db: `pnpm --filter @openverify/db exec vitest run src/phase7-graph-tables.test.ts src/repositories/graph-plumbing.test.ts --coverage.enabled=false`.
- Upgrade test: `(cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0024.integration.test.ts)`.
- API: `pnpm --filter @openverify/api exec vitest run src/routes/graph-routes.test.ts src/services/graph-hooks.test.ts src/services/graph-index-hook.test.ts src/routes/flow/session-graph-hook.test.ts src/jobs/graph-queues.test.ts src/worker-graph.test.ts src/jobs/repeatable/phase7.test.ts src/auth/pii-graph.test.ts src/routes/dashboard/settings-graph.test.ts --coverage.enabled=false`.
- When another agent's API run holds `apps/api/coverage`, give your coverage run its own `--coverage.reportsDirectory`.

#### Checkpoint commit
Checkpoint (G) ends at `e2c41177` (code); `92cfdaa3` holds the plan amendments and the record. Stub / RED / GREEN: tables RED `44a364c6`, GREEN `1ffd7875`; db repositories stubs `c71ad14a`, RED `792f09e2`, GREEN `d70cfb8a`; masking and settings stub `0337c4fb`, RED `66339f9a`, GREEN `6c88bd9a`, format `42a12d88`; hooks, queues, workers and routes stubs `155e1623`, `9b9fc484`, `bc108b3d`, `8725355b`, RED `d579b6b9`, GREEN `e2c41177` (with the OpenAPI snapshot).

#### Regenerating migration 0024
The whole script is in the TDD record, "How to regenerate migration 0024 (after checkpoint (G))". In order: `pnpm --filter @openverify/core build`; delete `drizzle/0024_phase7b.sql`, `drizzle/meta/0024_snapshot.json` and journal entry 24; `pnpm exec drizzle-kit generate --name phase7b` in `packages/db`; put `CREATE EXTENSION IF NOT EXISTS vector;` first; append the `set_updated_at` triggers of `lists`, `list_items`, `list_matches`, `list_screenings`, `importers`, `transaction_types`, `transaction_type_versions`, `transactions`, `transaction_labels`, `transaction_files`, `graph_index_jobs`, `graph_index_state`, `graph_query_templates`, `graph_query_template_versions`, `graph_queries`; append (T)'s function `openverify_transaction_history_append_only` and its two triggers; append (G)'s `INSERT INTO "graph_index_state" ... SELECT "environments"."id", "kinds"."code", false FROM "environments" CROSS JOIN generate_series(1, 18)`; run prettier on the snapshot; check with a sorted statement diff that nothing earlier was removed. Do it in a private worktree and commit tables and migration as one step. No composite unique key needed moving.

#### Tables (`packages/db/src/tables/graph.ts`, exported from `schema.ts`)
- **`graph_attributes`:** `environment_id`, `kind` (smallint, CHECK in the 18 codes), `value_key` (64 hex), `key_id` (`^[A-Za-z0-9_-]{11}$`), `account_id`, `source_type` (`account`, `inquiry`, `inquiry-session`, `verification`), `source_id` (CHECKed to the type's prefix), `inquiry_id` (null exactly for `account`; equal to `source_id` for `inquiry`), `first_seen_at`, `last_seen_at`. Primary key `graph_attributes_pkey (environment_id, kind, value_key, account_id, source_type, source_id)` (C101.1's value index is its prefix). Indexes `graph_attributes_environment_id_account_id_kind_idx (environment_id, account_id, kind, value_key)`, partial `graph_attributes_environment_id_inquiry_id_idx`. Foreign keys `graph_attributes_account_fk`, `graph_attributes_inquiry_fk` (cascade). No degree table.
- **`graph_index_jobs`:** pk `(environment_id, inquiry_id)`; `trigger_status` (`completed`, `failed`, `expired`), `status` (`pending`, `completed`, `skipped`, `errored`), `attempts`, `last_error_code`, `enqueued_at`, `indexed_at` (set exactly when not pending), timestamps; `graph_index_jobs_pending_idx`; `graph_index_jobs_inquiry_fk` (cascade).
- **`graph_index_state`:** pk `(environment_id, kind)`; `indexed_since`, `complete` (= `completed_at is not null`), `backfill_cursor` jsonb, `completed_at`, timestamps; `graph_index_state_incomplete_idx`. No row reads complete; the migration seeds 18 incomplete rows for each environment that existed before it.
- **`graph_components`:** pk `(environment_id, account_id)`; `component_id` (1-64), `size` (>= 1), `computed_at`; `graph_components_environment_id_component_id_idx`.
- **`graph_query_templates`:** `id` (`grqt`), `name` (1-255), `status` (`active`, `archived`), timestamps; unique `(environment_id, id)`; `graph_query_templates_environment_id_created_at_id_idx`.
- **`graph_query_template_versions`:** `id` (`grqtv`), `graph_query_template_id`, `version` (>= 1), `status` (`draft`, `published`, `superseded`), `config` jsonb, `published_at` (null exactly for drafts), timestamps; unique `(environment_id, id)`, `graph_query_template_versions_template_id_version_key`, partial unique `graph_query_template_versions_one_published_key`, `graph_query_template_versions_env_template_created_at_id_idx`.
- **`graph_queries`:** `id` (`grphq`), `graph_query_template_id`, `graph_query_template_version_id` (composite foreign keys, no action), `status` (`GRAPH_QUERY_STATUSES`, default `submitted`), `params` (sealed, null only once redacted), `timeout_seconds` (1-59, default 30), `run_sync`, `nodes`, `links`, `node_map` (jsonb), `account_ids` (text[]), `kinds_not_indexed` (smallint[]), `skipped_hub_values`, `node_limit_reached`, `attempts`, `last_error_code`, `enqueued_at`, `errored_at`, `completed_at`, `redacted_at`, timestamps. Indexes: listing `(environment_id, created_at DESC, id DESC)`, `..._template_created_at_id_idx`, `graph_queries_submitted_idx`, `graph_queries_unredacted_created_at_idx`, GIN `graph_queries_account_ids_idx`. CHECKs on completed and errored times, redacted emptiness, kind codes, timeout.
- Also exported: `GRAPH_SOURCE_TYPES`, `GraphSourceType`, `GRAPH_INDEX_TRIGGER_VALUES`, `GraphIndexTrigger`, `GRAPH_INDEX_JOB_STATUSES`, `GraphIndexJobStatus`, and the row types `GraphAttributeRow`, `GraphIndexJobRow`, `GraphIndexStateRow`, `GraphComponentRow`, `GraphQueryTemplateRow`, `GraphQueryTemplateVersionRow`, `GraphQueryRow`. `EnvironmentSettings` gains `graph-indexing`, `graph-weak-kinds`, `graph-components`, `graph-query-retention-days`.

#### Repositories (`packages/db/src/repositories/`, all exported through `index.ts`)
Each stub rejects with `GraphRepositoryNotBuiltError` (`graph-repository.ts`, with `graphRepositoryNotBuilt(name)`, message naming `api-graph`). They are typed `const`s; `api-graph` rewrites each as a function of the same signature.
- `graph-attributes.ts`: stubs `upsertGraphAttributes(tx, env, rows, at)`, `replaceAccountGraphAttributes(tx, env, accountId, rows, at)`, `listAccountGraphAttributes(db, env, { accountIds, kinds })`, `listGraphValueHolders(db, env, { kind, valueKey, cap })` (limit cap + 1), `moveInquiryGraphAttributes(tx, env, { inquiryIds, accountId })`, `moveAccountGraphAttributes(tx, env, { targetId, sourceIds })`, `deleteInquiryGraphAttributes(tx, env, inquiryId)`, `deleteAccountGraphAttributes(tx, env, accountId)`, `listGraphAttributesKeyedOtherwise(db, { keyId, limit })`; type `NewGraphAttribute`.
- `graph-index-jobs.ts`: BUILT `createGraphIndexJob(tx, env, { inquiryId, triggerStatus }) => boolean` (once per inquiry), `getGraphIndexJob(db, env, inquiryId)`; stubs `listPendingGraphIndexJobs(db, { olderThan, limit })` (`PendingGraphIndexJob { environmentId, inquiryId, inquiryRedacted }`), `markGraphIndexJobsEnqueued(db, jobs, at)`, `endGraphIndexJob(tx, env, inquiryId, { status, code?, at })`.
- `graph-index-state.ts`: BUILT `listGraphIndexStates(db, env)` (kind order); stubs `markGraphKindsIncomplete(tx, env, kinds, at)`, `listIncompleteGraphIndexStates(db, { limit })`, `advanceGraphBackfill(tx, env, kind, { cursor, complete, at })`.
- `graph-components.ts`: stubs `replaceGraphComponents(tx, env, rows, computedAt)`, `getGraphComponent(db, env, accountId)`.
- `graph-query-templates.ts`: stubs `createGraphQueryTemplate`, `getGraphQueryTemplate`, `lockGraphQueryTemplate`, `listGraphQueryTemplates(db, env, filters, page)`, `updateGraphQueryTemplate`, `createGraphQueryTemplateVersion`, `getGraphQueryTemplateVersion`, `listCurrentGraphQueryTemplateVersions`, `updateGraphQueryTemplateVersionDraft`, `publishGraphQueryTemplateVersion`; type `GraphQueryTemplateFilters`.
- `graph-queries.ts`: stubs `createGraphQuery(tx, env, NewGraphQuery)`, `getGraphQuery`, `lockGraphQuery`, `listGraphQueries(db, env, GraphQueryFilters, page)`, `openGraphQueryParamsOf(row)` (sync, throws), `storeGraphQueryResult(tx, env, id, GraphQueryResult)`, `cancelGraphQuery(tx, env, id, at)`, `resubmitGraphQuery(tx, env, id, at)`, `listSubmittedGraphQueries(db, { olderThan, limit })`, `markGraphQueriesEnqueued(db, queries, at)`, `scrubAccountFromGraphQueries(tx, env, accountId) => string[]`.
- `graph-redaction.ts`: BUILT `redactGraphQueryRecords(db, env, queryId, { at? }) => GraphQueryRedaction | null` (`{ query, alreadyRedacted, stubbedEvents }`; params null, result emptied, `stubEventPayloads` and `forgetStoredResponses` for the id) and `redactExpiredGraphQueries(db, { now?, limit? }) => number` (one batch).
- `retention.ts`: BUILT `listGraphQueriesDueForRetention(db, SweepOptions)` and `DEFAULT_GRAPH_QUERY_RETENTION_DAYS` (30).
- `@openverify/db/testing`: `seedGraphAttribute`, `seedGraphQueryTemplate`, `seedGraphQuery`, `openGraphQueryParams`, all by SQL.

#### Sealing, rewrap, labels, masking, API logs, redaction, subjects, retention, settings
- `ENCRYPTED_COLUMNS`: `graph_queries.params` (row). `SEALED.graphQueryParams`. `REWRAP_TABLES` gains `graph_queries` (the rewrap test seeds it). No new identifier label: (L) added every graph key's.
- `MASKED_ATTRIBUTES` (`auth/pii.ts`) and the API-log set (`services/api-logs.ts`) join `PII_GRAPH_ATTRIBUTES` (`params`, `parameter-map`, `variable-map`, `value`); `params` is member-wise in both (`MEMBER_WISE`, and the `query`-like branch of `maskMembers`).
- `REDACTION_SUBJECT_ID_PREFIXES` gains `grphq` (not `grqt` or `grqtv`: configuration).
- `redaction.test-support.ts`: `GRAPH_QUERY_PII_TABLES` (`graph_queries`), excluded from the subject scan like `TRANSACTION_PII_TABLES`.
- `runRetention` reports `redactedGraphQueries` (`drain(redactExpiredGraphQueries)`).
- Settings (`packages/contracts/src/dashboard-api.ts`): `GRAPH_SETTING_DEFAULTS`, `GRAPH_QUERY_RETENTION_DAYS`, `graphQueryRetentionDaysSchema`; served by `getDashboardSettings`, set by `updateDashboardSettings`; `PRIVACY_SETTINGS` gains `graph-indexing`, `graph-weak-kinds`, `graph-components`. Dashboard type `GraphSetting` in `settings-fields.ts`.

#### Hooks (file, signature; owner `api-graph` unless BUILT)
- `indexAccountAttributesInTx(tx, environmentId, accountId, source: GraphIndexSource, attributes: GraphAttributesInput) => Promise<number>`: `services/graph/indexing.ts`; no-op (0) until built. `GraphIndexSource` = `{ type: 'account' | 'inquiry', id }` or `{ type: 'inquiry-session' | 'verification', id, inquiryId }`; `GraphAttributesInput` = `{ kind: 'account-fields', referenceId, fields }` | `{ kind: 'session-address', ip, networkId }` | `{ kind: 'inquiry-linked' }`. Called by `createAccount`, `updateAccount` (fields or reference changed), `resolveForInquiry` (new account with a reference id), `addAccountObjects` and `removeAccountObjects` (each moved inquiry) in `services/accounts.ts`.
- `indexSessionAddressInTx(tx, session, network: { networkId } | null, { ip })`: `services/graph/session-start.ts`, BUILT: `null` indexes nothing; otherwise it reads the inquiry's account and calls the indexer in a savepoint, swallowing a failure. Called in `recordSessionStart` (`services/inquiry-sessions.ts`) after `recordSessionDeviceInTx`.
- `createGraphIndexJobInTx(tx, { inquiry, from, to }) => Promise<boolean>`, `writesGraphIndexJob`: `services/graph/index-outbox.ts`, BUILT; called in `transitionInquiryInTx` after `createListScreeningInTx`; never for a redacted inquiry.
- `moveGraphOnConsolidationInTx(tx, { environmentId, targetId, sourceIds }) => number`: `services/graph/consolidation.ts`; called in `consolidateAccounts` after `moveReportLinksInTx`.
- `redactInquiryGraphInTx(tx, { environmentId, inquiryId, at })`, `redactAccountGraphInTx(tx, { environmentId, accountId, at }) => GraphRedactionOutcome { deletedRows, scrubbedQueries }`: `services/graph/redaction.ts`; called in `redactInquiry` (after the biometric redactor) and `redactAccount` (before the account reports).
- `onGraphSettingsChangedInTx(tx, environmentId, before, after)`: `services/graph/settings-hook.ts`; called in `updateDashboardSettings` after `onSettingsChangedInTx`.
- `rebuildGraphIndexes(db, key, { batchSize }) => RebuildIndexesResult`: `services/graph/rebuild.ts`; run by `blind-index:rebuild` after the transaction field keys, result member `graph`, line `scanned N graph rows, re-indexed M.`
- `runGraphReindex({ db, blindIndexKey }, { environmentId?, batchSize }) => { environments, accounts, inquiries, rows }`: `services/graph/reindex.ts`; throws until built. `scripts/graph-reindex.ts` (`parseGraphReindexArgs`, `GraphReindexUsageError`, `main`, `DEFAULT_REINDEX_BATCH_SIZE` 500); `scripts/graph-benchmark.ts` (`main` rejects with `GRAPH_BENCHMARK_NOT_BUILT`). `apps/api/package.json`: `graph:reindex`, `graph:benchmark`.
- `resolveGraphQueryFilterSubjects(db, env, payloads)`: `services/graph/filter-subjects.ts`, answers `{}` each; `eventFilterSubjects` marks `graph-query` strict.
- `GraphProblemError(code, detail, { errors?, headers? })`: `errors.ts`, status from `GRAPH_PROBLEM_STATUSES`.

#### Ports, fakes, queues, workers
- Ports (`ports.ts`): `GraphIndexJob { environmentId, inquiryId }`, `GraphIndexQueue.enqueueGraphIndex`, `GraphQueryJob { environmentId, graphQueryId }`, `GraphQueryQueue.enqueueGraphQuery`. Fakes (`test-support/fakes.ts`): `createRecordingGraphIndexQueue`, `createRecordingGraphQueryQueue`.
- `jobs/graph-queues.ts`: `GRAPH_INDEX_QUEUE`/`_JOB` `graph-index`, `GRAPH_QUERY_QUEUE`/`_JOB` `graph-query`, `GRAPH_INDEX_SWEEP_QUEUE`, `GRAPH_QUERY_SWEEP_QUEUE`, `GRAPH_SWEEP_INTERVAL_MS` (15 s), `GRAPH_BACKFILL_QUEUE` `graph-backfill`, `GRAPH_BACKFILL_INTERVAL_MS` (60 s), `GRAPH_COMPONENTS_QUEUE` `graph-components`, `GRAPH_COMPONENTS_PATTERN` (`0 3 * * *`), `GRAPH_INDEX_JOB_OPTIONS` (5 attempts), `GRAPH_QUERY_JOB_OPTIONS` (1 attempt), `createGraphIndexQueue`, `createGraphQueryQueue` (lazy, closable).
- Job stubs (`jobs/graph/`): `index-job.ts` `processGraphIndex(job, GraphIndexDeps { db, clock, logger, keyring, blindIndexKey })` rejects; `index-sweep.ts` `runGraphIndexSweep({ db, clock, logger, index })`; `query.ts` `processGraphQuery(job, GraphQueryDeps { db, clock, logger, events })` rejects, result `{ status: GraphQueryStatus | 'waiting' }`; `query-sweep.ts` `runGraphQuerySweep({ db, clock, logger, queries })`; `backfill.ts` `runGraphBackfill({ db, clock, logger, keyring, blindIndexKey })`; `components.ts` `runGraphComponents({ db, clock, logger })`. The sweeps, backfill and components do nothing until built.
- `StartWorkersOptions.graph: WorkerGraphOptions { index, queries, process?: { index?, query? } }` starts `graph-index` and `graph-query` (through `listJobProcessor`); `phase7RepeatableJobs(deps, network, signals, lists, graph?: GraphRepeatableDeps { index, queries, keyring, blindIndexKey })` schedules the four jobs after the list sweeps; the worker process builds both producers and closes them. `ApiDependencies.graphQueries` and `ContainerOverrides.graphQueries`; the container wires and closes it.

#### Frozen routes (schemas from `@openverify/contracts`; 501 until built; services in `services/graph/`)
- `routes/server/graph-query-templates.ts` (`templates.ts`): `POST /graph-query-templates` (`createGraphQueryTemplateBodySchema`, 201 `graphQueryTemplateDocumentSchema`, `graph:write`); `GET /graph-query-templates` (`listGraphQueryTemplatesQuerySchema`, `graphQueryTemplateListDocumentSchema`, `graph:read`); `GET`, `PATCH` (`updateGraphQueryTemplateBodySchema`), `DELETE /graph-query-templates/:id`.
- `routes/server/graph-query-template-versions.ts` (`versions.ts`): `POST /graph-query-template-versions` (201), `GET`, `PATCH /graph-query-template-versions/:id`, `POST /:id/publish` (`optionalBody(publishGraphQueryTemplateVersionBodySchema)`), `graphQueryTemplateVersionDocumentSchema`.
- `routes/server/graph-queries.ts` (`queries.ts`, `node-values.ts`, `actions.ts`): `POST /graph-queries` (`createGraphQueryBodySchema`, 201 `graphQueryDocumentSchema`, `graph:write`); `GET /graph-queries` (`listGraphQueriesQuerySchema`, `graphQueryListDocumentSchema`); `GET /graph-queries/:id`; `POST /:id/rerun`, `/:id/cancel` (`optionalBody`, `graph:write`); `GET /graph-queries/:id/nodes/:nodeId/value` (`graphNodeValueDocumentSchema`, `graph:read` and `requirePiiView`); `POST /graph-queries/:id/actions` (`graphQueryActionBodySchema`, `graph:read`; 200 `graphQueryActionResultDocumentSchema` or `text/csv`). `graphActingOf(request)` builds `GraphActing` (`Acting` plus `principal`); the action service gets `{ idempotencyKey }`; `GraphQueryActionAnswer` is `{ kind: 'document', document }` or `{ kind: 'csv', csv }`.
- The OpenAPI snapshot holds the eleven graph paths (`e2c41177`).


### Contract deviations

1. graph_attributes keeps C101.1's columns and two more: source_type takes account, inquiry, inquiry-session or verification (CHECKed with the source id's prefix), and inquiry_id names the inquiry of every source but the account, so an inquiry's redaction deletes its rows in one indexed statement and an IP row names its session for the unmask. C101.1's (environment_id, kind, value_key) index is the primary key's prefix; the account index is (environment_id, account_id, kind, value_key) (plan (G) item 1).
2. A new environment starts complete without a row: a kind with no graph_index_state row reads complete since the environment began. Migration 0024 seeds 18 incomplete rows for each environment that predates it, as a hand edit (plan (G) item 2).
3. graph_index_jobs has a skipped status (redacted after the row was written, or graph-indexing off when the job ran); createGraphIndexJobInTx writes on the signals outbox's moves (created -> expired too, V17) and reads no setting: the job reads graph-indexing (plan (G) item 3).
4. graph_queries stores the result as jsonb nodes, links and node_map, account_ids text[] with a GIN index and kinds_not_indexed smallint[], plaintext by decision (ids, random node ids, value keys), with params sealed (plan (G) item 4).
5. The C102.7 retention redaction is built in the database by foundation-7b (redactGraphQueryRecords, listGraphQueriesDueForRetention, redactExpiredGraphQueries), with a default of 30 days, and runs in the C16 pass directly, not through RedactionService; no event is staged, because no graph-query.redacted event exists (plan (G) item 5).
6. graph_components.component_id is the run's own label (1-64 characters, no format), api-graph's choice (plan (G) item 6).
7. The four graph settings are new here (Stage 1a did not add them): graph-indexing, graph-weak-kinds and graph-components under settings:privacy, graph-query-retention-days under settings:write; onGraphSettingsChangedInTx(tx, environmentId, before, after) runs after onSettingsChangedInTx and also sees signal-collection, which is how enabling device recognition marks the device kinds incomplete (plan (G) item 7).
8. params is masked member-wise (each parameter's name stays), in a served resource and in a stored API log; parameter-map, variable-map and the unmask's value whole (plan (G) item 8).
9. indexAccountAttributesInTx's attributes are a closed union of what each caller holds (account-fields, session-address with the network id, inquiry-linked), and its source a GraphIndexSource (plan (G) items 9-10).
10. The session start's call is indexSessionAddressInTx (built here), which reads null from evaluateSessionNetworkInTx as no address and runs the indexer in a savepoint, swallowing a failure without a log (no logger there, K7A-10): a missed IP row is a gap in a weak kind (plan (G) item 11).
11. graph-backfill is a 60 s repeatable tick that does nothing once every state row is complete, rather than a job enqueued at startup and by a switch: it runs at startup until complete and picks a switch up within a minute without an API-side producer. graph-components is nightly at 03:00 UTC. graph-query jobs take one attempt; the sweep is the retry (plan (G) item 12).
12. Routes: :nodeId for C102.6's :node-id (Fastify reads a hyphen as a separator); POST /graph-queries answers 201 also with meta.run-sync; the unmask checks requirePiiView in the handler; the actions route documents its 200 under application/json and text/csv and passes the Idempotency-Key to the service, which owns refusing a non-preview call without one; GraphActing carries the principal (plan (G) item 13).
13. graph_attributes is not in SUBJECT_PII_TABLES, because it holds no sealed column and the stub hooks delete nothing; graph_queries sits in GRAPH_QUERY_PII_TABLES. Amendment: api-graph may edit services/redaction.test-support.ts and services/redaction.test.ts to seed and scan graph_attributes and a stored result naming the subject's account when it builds the redaction hooks (plan (G) item 15).
14. blind-index:rebuild runs rebuildGraphIndexes after the transaction field keys; graph:reindex parses --environment and --batch-size, and graph:benchmark exits 1 until built (plan (G) item 16).
15. The OpenAPI snapshot was regenerated at (G), the last checkpoint (plan (G) item 17).
16. Existing tests changed with the plan, none weakened: testing.test.ts's table list, schema-v2.test.ts's encrypted columns, subject-ids.test.ts (grphq), redaction.test.ts's coverage categories, retention.test.ts's EMPTY and retention-run.test.ts's JSON (redactedGraphQueries: 0), blind-index-rebuild.test.ts's devices line (at(-5)), dashboard-api.test.ts's DASHBOARD_SETTINGS_DEFAULTS, services/context.test.ts's dependency keys, key-rotation.test.ts's seeds, and RetentionSetting in the dashboard (typecheck minimum) (plan (G) item 18).
17. Commits that did not read green: 6c88bd9a (GREEN of the masking and settings) left apps/dashboard/src/components/operators/settings-fields.ts unformatted, because the chain read prettier's status through tail; fixed by 42a12d88. Recorded in the TDD file.

### Followups

- api-graph: replace the typed-const repository stubs (graph-attributes, graph-index-jobs, graph-index-state, graph-components, graph-query-templates, graph-queries) and the API stubs (indexAccountAttributesInTx, moveGraphOnConsolidationInTx, redactInquiryGraphInTx, redactAccountGraphInTx, onGraphSettingsChangedInTx, rebuildGraphIndexes, runGraphReindex, the jobs in jobs/graph/, the services in services/graph/{templates,versions,queries,node-values,actions}.ts, scripts/graph-benchmark.ts) with functions of the same signatures; enforce the graph-queries and graph-unmask policies; refuse a person-identifying parameter without pii:view and a non-preview action without an Idempotency-Key.
- api-graph: seed graph_attributes and a stored result naming the subject's account in seedPiiSubject and assert the redaction leaves none, when the redaction hooks are built (plan (G) item 15 gives the leave).
- api-graph: the indexer's IP row must refuse a trust-all address in production and non-global, relay and documentation ranges outside a sandbox (P05), reading them from the network row by its id; and must write with graph-indexing on only, weak kinds only with graph-weak-kinds on, fingerprint kinds only under the device-recognition tier.
- integration-7b: graph-backfill as a 60 s tick and graph-components at 03:00 UTC join C107.1's description in docs/graph/; the node client's graphQueries.action parses JSON only, so the export (text/csv) needs its own method if a client wants it (as contracts-7b noted).
- Owner or 7C (K7A-10): the session start has no logger, so a swallowed indexer failure leaves no trace; a logger in SessionNetworkDeps or the start's deps would let indexSessionAddressInTx log the error's name.
- The Android gate was not run at (G): no fixture or decoded contract changed.

### Measurements

- PGlite createTestDatabase, one cold and warm pair per hold of the e2e lock: base 78da85a1 cold 3,864 / 3,840 / 3,895 ms, warm 892 / 893 / 914 ms (load 0.9-1.1); head e2c41177 cold 4,624 / 4,007 / 3,966 ms, warm 942 / 930 / 949 ms (load 6.1-7.8). Interleaved at load 7.9-12.2: base 44a364c6 cold 7,154 / 7,448, warm 1,692 / 1,625; head cold 7,981 / 8,751, warm 1,945 / 1,566. The effect is within the load's noise; every hook stays far inside its 120 s guard.
- API unit suite: 5,813 tests in 426 files at 96.06 / 88.13 / 97.69 / 96.12 (statements, branches, functions, lines), two blob shards plus the merge (merge 963 s).
- Other packages: e2e 109, node 303, config 187, ui 54, emrtd 318, signals 186, core 1,177, flow-spec 117, contracts 2,616, checks 3,791, flow 1,088, db 1,490 (94.64 / 87.65 / 94.6 / 94.82), dashboard 3,971, watchlist 759.
- Integration: db 69 in 15 files (183 s), api 204 in 35 files (417 s), loads 20-35.
- e2e: mocked flow 79 in 22.2 s; full stack 95 tests in shards of 32, 34 and 29: 2.5, 5.2 and 4.6 minutes (loads 11.4, 4.9, 1.2).
- infra/tests/ci-workflow.test.sh: 209 passed. benchmark:typecheck and benchmark:test rc 0. The API's eslint alone: 1 m 51 s at load ~9.
- Migration 0024 after (G): 28 tables of 7B (12 list, 9 transaction, 7 graph), 1 column, 15 set_updated_at triggers, 1 append-only function on 2 triggers, 1 seed statement; the (G) regeneration added 41 statements and removed none. OpenAPI snapshot: +2,626 lines, 11 graph paths.

### Blockers

None.
