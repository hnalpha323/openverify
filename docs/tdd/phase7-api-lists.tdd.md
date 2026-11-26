# Phase 7, Workflow 7B Stage 3: `api-lists` (family L)

C97, C99.1-C99.6, C99.9 and C106.2. Every slice went stub (where a test needed a name), RED, GREEN. Run `source scripts/env.sh` first. All commits are path-scoped; nothing was pushed.

## Slices

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| Repositories: lists, items with keys and side rows, matches, the screening outbox | `4e0eb772` | `bd688682` | `3e89fb9d` (lint `81d8891f`) |
| Routes and services: lists, items, matches | none (the routes answered 501) | `e5945de0` | `12d9be73` |
| `matchLists` | in the RED commit | `312a9183` | `2e31d1a6` |
| `POST /lists/match`, `ListItemWriter`, `ListService` | in the RED commit | `558d7c6c` | `6147bd8b` |
| Screening job and sweep, probes, selection, `on-list-match`, the merge, the filter subject | none | `470a8c14` | `eb28edfc` |
| `list-config` publish rules | none | `8927ee89` | `b20cc105` |
| `id_compromised_detection` and `CompromisedIdLookup` | in the RED commit | `2a8a9b6f` | `54a64030` |
| `rebuildListIndexes` | none | `c717050b` | `121390dd` |
| Custom-list job | none | `ed2e897c` | `2f6f7cc3` |
| Custom-list completion query | none | `3812a658` | `2f6f7cc3` |
| Matched lists, list rules, included matches | in the RED commit | `29f52c8a` | `d29aa89b` |
| C99.8 on Postgres | none | added after GREEN: `58236747` | passed on its first run |
| Stored API logs | none | added after GREEN: `0d4586e6` | passed on its first run |

Two tests above were not RED first: the C99.8 file and the stored API log test cover behaviour already built, and both passed on their first run. They are characterisation tests, and are recorded as that.

## RED and GREEN evidence

Abbreviated, as the commands printed it.

```text
$ pnpm --filter @openverify/db exec vitest run src/repositories/list-repositories.test.ts --coverage.enabled=false
 Tests  37 failed | 1 passed (38)              # RED: ListRepositoryNotBuiltError
 Tests  38 passed (38)                         # GREEN

$ pnpm exec vitest run src/routes/server/lists.test.ts src/routes/server/list-items.test.ts src/routes/server/list-matches.test.ts --coverage.enabled=false
 Tests  63 failed | 1 passed (64)              # RED: 501 from the frozen routes
 Tests  64 passed (64)                         # GREEN

$ pnpm exec vitest run src/services/lists/match.test.ts --coverage.enabled=false
 Tests  35 failed (35)                         # RED: NotImplementedError
 Tests  35 passed (35)                         # GREEN

$ pnpm exec vitest run src/services/lists/item-writer.test.ts src/routes/server/lists-match.test.ts --coverage.enabled=false
 Tests  11 failed | 2 passed (13)              # RED
 Tests  69 passed (69)                         # GREEN, with the two route files

$ pnpm exec vitest run src/jobs/lists/screen.test.ts --coverage.enabled=false
 Tests  31 failed (31)                         # RED
 Tests  106 passed (106)                       # GREEN, with the merge, filter and match files

$ pnpm exec vitest run src/services/signals/served-list-count.test.ts src/services/lists/filter-subjects.test.ts --coverage.enabled=false
 Tests  8 failed | 3 passed (11)               # RED

$ pnpm exec vitest run src/services/publish/list-config.test.ts --coverage.enabled=false
 Tests  2 failed | 3 passed (5)                # RED
 Tests  11 passed (11)                         # GREEN, with the template test

$ pnpm exec vitest run src/government-id/id-compromised-detection.test.ts --coverage.enabled=false   # packages/checks
 Tests  2 failed | 12 passed (14)              # RED
$ pnpm exec vitest run src/services/lists/compromised-ids.test.ts --coverage.enabled=false
 Tests  6 failed | 3 passed (9)                # RED
 Tests  9 passed (9)                           # GREEN

$ pnpm exec vitest run src/services/lists/rebuild.test.ts --coverage.enabled=false
 Tests  3 failed | 3 passed (6)                # RED
 Tests  6 passed (6)                           # GREEN

$ pnpm exec vitest run src/jobs/report-types/custom-list.test.ts --coverage.enabled=false
 Tests  10 failed (10)                         # RED: ReportTypeNotBuiltError
 Tests  24 passed (24)                         # GREEN, with the completion, index files

$ pnpm exec vitest run src/services/reports/completion-custom-list.test.ts --coverage.enabled=false
 Tests  2 failed | 2 passed (4)                # RED, seen by putting the old case back for one run

$ pnpm exec vitest run src/services/lists/report-view.test.ts src/routes/server/list-matches.test.ts --coverage.enabled=false
 Tests  4 failed | 10 passed (14)              # RED
 Tests  39 passed (39)                         # GREEN, with lists.test.ts

$ pnpm exec vitest run --config vitest.integration.config.ts src/services/lists/lists.integration.test.ts
 Tests  12 passed (12)   Duration 41.60s       # Postgres 17, load 51
```

A GREEN went in with a lint error: `3e89fb9d` carried an `any` in `list-plumbing.test.ts`, because that chain did not stop on eslint's exit code. `81d8891f` fixed it.

The completion test was written beside its implementation. Its RED was seen afterwards, by putting the old `case` back for one run, then restoring the file, and the test was committed before the implementation.

## Findings on the way

- **The C78 scorer scores a given name alone as 0.** It anchors on the family token, so `scoreNamePair` on first names only never matches. The fuzzy method scores whole names; the last names already agree through the key, so the first names decide. Probed on synthetic names under `tolerant`: `Jonathon`/`Jonathan` 0.978, `Robert`/`Bob` 0.913, `Maria`/`Jonathon` 0.565 (minimum 0.8).
- **A probe's box has to be the probe's reach, not its point.** C99.2's `bbox @> box(p, p)` misses an item whose centre is outside the box but whose radius plus the uncertainty reaches the probe. `findGeoListItems` overlaps (`&&`) with the box of the probe's own uncertainty.
- **`components.methods` refuses `_`.** The report contract's pattern is `^[a-z][a-z0-9-]*$`, so `fuzzy_name` is served there as `fuzzy-name`; `entity.method` keeps the enum.
- **`insertListItems` wrote keys row by row** in the first GREEN; `f5304b5e` writes them one statement per chunk, for the importer's 100,000 rows.
- **Two routes would have answered a status their frozen schema does not declare** (`PATCH /lists/:id` 409, `POST /lists/match` 404). `5e3af846` removes both: an archived list takes a change, and an unknown named list reads `list_archived`.

## The hooks outside these paths

`docs/tdd/phase7-api-lists.hooks.patch` is the exact change for every file outside `api-lists`' paths, against `f5304b5e`, verified in a private worktree: `tsc` clean over the API, and 118 tests passing, among them `custom-list-engine.test.ts`, which is part of the patch and runs a custom-list report through the real framework and served resource. Nothing in the shared tree carries it.

## The 1,000,000-item fuzzy name list (C99.2)

Measured once at `f5304b5e` in `/tmp/api-lists-wt`, on a throwaway Postgres 17 container (`openverify-api-lists-bench`, port 55432, started with `POSTGRES_TEST_COMMAND`, removed at 02:40Z), as two resumable steps, each under `/tmp/openverify-e2e.lock`. Load 42 before the measure step and 17 after; the box was shared with other agents throughout, so the numbers are an upper bound, not a budget check.

- Seed: 1,000,000 items of one fuzzy `name` list (`allow-fuzzy-name-first` true), names from `@openverify/watchlist/testing` (`fictionalFamilyName`, `fictionalGivenName`, `zipfSampler`, seed `api-lists-1m`): 50,000 family names and 5,000 given names on a Zipf law. Every item has a unique exact key (the bench salts it with the row number, so the exact key never answers) and its `identifier-name-last` candidate keys.
- List health (`listListItemHealth`, 10 runs): p50 227.2 ms, p95 285.6 ms.
- Probe (`matchLists`, one name, 300 probes from the same law): p50 616.2 ms, p95 971.2 ms, max 1,604.5 ms.
- 117 of 300 probes answered `limit_exceeded` (their last name has more than `fuzzy-name-candidate-cap` 2,000 candidates); 44 last names in the list are over the cap; 1,812 fuzzy matches over the 300 probes.
- Reading: a heavy-headed last name is unscreened with `limit_exceeded`, never "no match". No budget is set for this in C99; nothing was tuned on it. The cap, the C78 scorer and its threshold are unchanged.

The two files were never committed (they need a container this repo does not start, and a fixed scratch path). Their full text follows, so the run can be repeated.

### `apps/api/src/services/lists/list-bench-seed.integration.test.ts`

```ts
/**
 * C99.2: the 1,000,000-item fuzzy list, measured. Not committed; its text is in the TDD record.
 * Names from `@openverify/watchlist/testing`'s seeded generators, on a Zipf law.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { newId } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  createList,
  runMigrations,
  setDefaultKeyring,
  sealJson,
  SEALED,
  identifierKey,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, createTestTenant } from '@openverify/db/testing';
import { listLastNameKeyInputs, listNameKeyInputs } from '@openverify/watchlist';
import {
  fictionalFamilyName,
  fictionalGivenName,
  seededRandom,
  zipfSampler,
} from '@openverify/watchlist/testing';
import { it } from 'vitest';

const ITEMS = 1_000_000;
const BATCH = 20_000;
const PROBES = 300;

const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] ?? 0;


const STATE = '/tmp/claude-1000/-home-mhnoor-persona-opensource/cc8c7756-b894-4110-9307-0bc1fc75e3f6/scratchpad/bench-state.json';
const URL_ = 'postgres://postgres:bench@127.0.0.1:55432/bench';

it('seeds', async () => {
  const pool = createIntegrationPool(URL_, { max: 4 });
  const db: Database = createDatabase(pool);
  const kek = randomBytes(32);
  setDefaultKeyring(createKeyring(kek));
  await runMigrations(db);
  const environmentId = (await createTestTenant(db)).environment.id;
  const key = new Uint8Array(randomBytes(32));
  const list = await createList(db, environmentId, { id: newId('lst'), type: 'name', name: 'Bench', allowFuzzyNameFirst: true });
  writeFileSync(STATE, JSON.stringify({ environmentId, listId: list.id, key: Buffer.from(key).toString('hex'), kek: kek.toString('hex') }));
  const random = seededRandom('api-lists-1m');
  const familyPool = Array.from({ length: 50_000 }, () => fictionalFamilyName(random));
  const givenPool = Array.from({ length: 5_000 }, () => fictionalGivenName(random));
  const family = zipfSampler(familyPool.length);
  const given = zipfSampler(givenPool.length);
  const nameOf = () => ({
    'name-first': givenPool[given(random)]?.latin ?? 'Alpha',
    'name-last': familyPool[family(random)]?.latin ?? 'Beta',
  });
  for (let start = 0; start < ITEMS; start += BATCH) {
    const ids: string[] = [];
    const values: string[] = [];
    const keys: string[] = [];
    const lastIds: string[] = [];
    const lastKeys: string[] = [];
    for (let index = 0; index < BATCH; index += 1) {
      const id = `lin_${String(start + index).padStart(26, 'A')}`;
      const name = nameOf();
      const first = listNameKeyInputs(name)[0];
      const last = listLastNameKeyInputs(name);
      if (first === undefined) continue;
      ids.push(id);
      values.push(sealJson(SEALED.listItemValue, id, name));
      keys.push(identifierKey(key, { environmentId, kind: first.keyKind, input: `${first.input}|${String(start + index)}` }));
      for (const input of last) {
        lastIds.push(id);
        lastKeys.push(identifierKey(key, { environmentId, kind: input.keyKind, input: input.input }));
      }
    }
    await pool.query(
      `insert into list_items (id, environment_id, list_id, value, match_key, normaliser_version)
       select unnest($1::text[]), $2, $3, unnest($4::text[]), unnest($5::text[]), 'lists-1'`,
      [ids, environmentId, list.id, values, keys],
    );
    await pool.query(
      `insert into list_item_keys (environment_id, item_id, key_kind, match_key)
       select $1, unnest($2::text[]), 'identifier-name-last', unnest($3::text[]) on conflict do nothing`,
      [environmentId, lastIds, lastKeys],
    );
    if (start % 100_000 === 0) console.log(`[seed] ${String(start)}`);
  }
  await pool.query(`update lists set item_count = $1, version = 2 where id = $2`, [ITEMS, list.id]);
  await pool.query('analyze list_items');
  await pool.query('analyze list_item_keys');
  console.log('[seed] done');
  await pool.end();
}, 3_000_000);
```

### `apps/api/src/services/lists/list-bench-measure.integration.test.ts`

```ts
/** C99.2: measures the seeded 1,000,000-item list. */
import { readFileSync } from 'node:fs';
import { createDatabase, createKeyring, getList, listListItemHealth, setDefaultKeyring, type Database } from '@openverify/db';
import { createIntegrationPool } from '@openverify/db/testing';
import { loadVariantGroups } from '@openverify/watchlist';
import { fictionalFamilyName, fictionalGivenName, seededRandom, zipfSampler } from '@openverify/watchlist/testing';
import { expect, it } from 'vitest';
import { matchLists } from './match.js';

const STATE = '/tmp/claude-1000/-home-mhnoor-persona-opensource/cc8c7756-b894-4110-9307-0bc1fc75e3f6/scratchpad/bench-state.json';
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] ?? 0;

it('measures', async () => {
  const state = JSON.parse(readFileSync(STATE, 'utf8')) as { environmentId: string; listId: string; key: string; kek: string };
  const { environmentId } = state;
  const key = new Uint8Array(Buffer.from(state.key, 'hex'));
  setDefaultKeyring(createKeyring(Buffer.from(state.kek, 'hex')));
  const pool = createIntegrationPool('postgres://postgres:bench@127.0.0.1:55432/bench', { max: 4 });
  const db: Database = createDatabase(pool);
  const row = await getList(db, environmentId, state.listId);
  const loaded = loadVariantGroups('/home/mhnoor/persona-opensource/data/variant-groups.json');
  if (loaded.status !== 'loaded' || row === null) throw new Error('no groups');
  const matcherData = { status: 'loaded', groups: loaded.groups, keysVersion: 'x' } as const;
  const random = seededRandom('api-lists-1m');
  const familyPool = Array.from({ length: 50_000 }, () => fictionalFamilyName(random));
  const givenPool = Array.from({ length: 5_000 }, () => fictionalGivenName(random));
  const family = zipfSampler(familyPool.length);
  const given = zipfSampler(givenPool.length);
  const healthTimes: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const t = performance.now();
    await listListItemHealth(db, environmentId, [row.id], { normaliserVersion: 'lists-1', keyId: 'AAAAAAAAAAA' });
    healthTimes.push(performance.now() - t);
  }
  const times: number[] = [];
  let limit = 0;
  let found = 0;
  for (let i = 0; i < 300; i += 1) {
    const name = { 'name-first': givenPool[given(random)]?.latin ?? 'A', 'name-last': familyPool[family(random)]?.latin ?? 'B' };
    const t = performance.now();
    const outcome = await matchLists(db, environmentId, [{ source: 'request', kind: 'name', values: [name] }], { key, lists: [row], matcherData });
    times.push(performance.now() - t);
    if (outcome.unscreened.some(({ reason }) => reason === 'limit_exceeded')) limit += 1;
    found += outcome.matches.length;
  }
  const counts = await pool.query<{ c: string }>(`select count(*) as c from (select match_key from list_item_keys group by match_key having count(*) > 2000) t`);
  console.log(`[bench] health p50 ${quantile(healthTimes, 0.5).toFixed(1)} p95 ${quantile(healthTimes, 0.95).toFixed(1)} ms; probe p50 ${quantile(times, 0.5).toFixed(1)} p95 ${quantile(times, 0.95).toFixed(1)} max ${Math.max(...times).toFixed(1)} ms; limit_exceeded ${String(limit)}/300; fuzzy matches ${String(found)}; last names over the cap ${counts.rows[0]?.c ?? '?'}`);
  expect(times).toHaveLength(300);
  await pool.end();
}, 500_000);
```

## Final gates

At `05769f58`, all in the foreground, each read by its exit code:

- API unit suite at 05769f58, as four blob shards plus the merge (the two-shard form exceeded 10 minutes at load 33-40; loads 33.0, 36.9, 34.7, 23.6 at the shards' starts): 414 files, 5,691 passed, 0 failed; coverage 96.27 / 88.48 / 97.94 / 96.32 (statements, branches, functions, lines); merge rc 0.
- e2e full stack at 05769f58 (Stage 3 form, own stack per shard): shard 1/3 32 passed in 3.2 min (load 16.96), 2/3 34 passed in 7.9 min (load 8.56), 3/3 29 passed in 4.5 min (load 4.93); mocked flow 79 passed earlier at 05769f58.
- Android gate: BUILD SUCCESSFUL in 15 s (mostly up to date), rc 0, load 2.94.
- Earlier gates after 05769f58: db 1,467 tests at 95.65%; checks 3,791; contracts 2,615; dashboard 3,971; test:integration db 68, api 201; turbo lint typecheck --force 30/30; format:check clean.

## Report (api-lists)

### Summary

Every deliverable of the api-lists bullet is built test-first in 28 path-scoped commits, 4e0eb772..05769f58 (interleaved with api-biometric-lists commits), plus the TDD record commit. Nothing was pushed and no dependency was added. Built: the list, item, match and screening repositories; the list, item, match and on-demand match routes with lists-write and lists-match enforced; matchLists for the non-biometric kinds with tiers, unscreened and not-applicable; the screening job and sweep with on-list-match and the redacted guard; the list_match_count merge in served.ts; the list-config publish rules; CompromisedIdLookup with compromised_list_unavailable; rebuildListIndexes; item retention; the list-match filter resolver; the custom-list report job and completion case. Final gates, all rc 0 in the foreground: the API suite (5,691 tests, 96.27% statements, as four blob shards plus the merge), db, checks, contracts, dashboard, test:integration, forced turbo lint and typecheck, format:check, the e2e gate (79 mocked, 32/34/29 full stack) and the Android gate. One thing is not live: the hooks in 11 shared files (container, worker, includes, custom-list persistence) are a committed patch for integration-7b, docs/tdd/phase7-api-lists.hooks.patch, not applied.

### Handoff

## How to run
- Run `source scripts/env.sh` first. Evidence and this report: `docs/tdd/phase7-api-lists.tdd.md`. The hooks outside these paths: `docs/tdd/phase7-api-lists.hooks.patch`.
- db: `pnpm --filter @openverify/db exec vitest run src/repositories/list-repositories.test.ts --coverage.enabled=false`.
- API, from apps/api: `pnpm exec vitest run src/services/lists src/jobs/lists/screen.test.ts src/routes/server/lists.test.ts src/routes/server/list-items.test.ts src/routes/server/list-matches.test.ts src/routes/server/lists-match.test.ts src/services/publish/list-config.test.ts src/services/signals/served-list-count.test.ts src/jobs/report-types/custom-list.test.ts src/services/reports/completion-custom-list.test.ts --coverage.enabled=false`.
- checks: `pnpm --filter @openverify/checks exec vitest run src/government-id/id-compromised-detection.test.ts --coverage.enabled=false`.
- Postgres (C99.8: the SP-GiST plan, containment, the antimeridian, the fuzzy name): `(cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/lists/lists.integration.test.ts)`, 12 tests.

## Routes (schemas frozen by foundation-7b; every write takes `lists-write` 600/60 s, `POST /lists/match` takes `lists-match` 60/60 s, both as consumeReportRate does, in `services/lists/rate.ts`: `consumeListWrite`, `consumeListMatch`; 429 with Retry-After)
- `POST /api/v1/list/<plural>` (13 kinds; `lists:write`): 201 list. Problems: 400 schema; 409 `list_limit_reached` (1,000 active lists per environment); face and background lists also need the biometric gate (api-biometric-lists).
- `GET /api/v1/lists` (`lists:read`): C1 listing, created_at DESC, id DESC.
- `GET /api/v1/lists/:id` (`lists:read`): 404 outside the environment.
- `PATCH /api/v1/lists/:id` (`lists:write`): an archived list still takes a change (no 409, which the frozen schema does not declare).
- `DELETE /api/v1/lists/:id` (`lists:write`): archives; items stay readable.
- `POST /api/v1/lists/match` (`lists:read` plus `requirePiiView`, 403 first): exact, CIDR and radius only (P25, `onDemand`); answers `list-match-result` with `matches`, `unscreened`, `not-applicable`; writes no list match. A named list that is unknown or archived reads `list_archived` (no 404, not in the frozen schema); 422 `list_kind_mismatch` for a probe of another kind.
- `POST /api/v1/list-item/<plural>` (`lists:write`; face and background also `requirePiiView`): 201 item. Problems: 409 `list_item_exists` (same active match key), `list_archived`, `list_limit_reached` (1,000,000 items, 10,000 biometric); 422 `list_kind_mismatch`, and a value refusal (`invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class`) with a code and a member (`field-error.ts`), never the value.
- `GET` and `DELETE /api/v1/list-item/<plural>/:id` (`lists:read` / `lists:write`): masked members without pii:view.
- `GET /api/v1/list-items` (`lists:read`): 400 `filter_required` without `filter[list-id]`.
- `GET /api/v1/list-matches`, `GET /api/v1/list-matches/:id` (`lists:read`): `matched-value` and `reason` masked without pii:view.
- `POST /api/v1/list-matches/:id/dismiss` (`lists:write`): 409 `list_match_not_open` for a match already dismissed or redacted; the reason is sealed (500 characters).

## matchLists (`apps/api/src/services/lists/match.ts`)
`matchLists(tx, environmentId, probes: readonly ListProbe[], options: MatchListsOptions): Promise<ListMatchOutcome>`. Reads only; the caller writes what it keeps.
- `ListProbe { source: ListProbeSource; kind: ListKind; values; untrusted?; unreadable? }`.
- `MatchListsOptions { key; lists: readonly ListRow[]; onDemand?; biometric?: BiometricListOutcome | 'no_subject'; matcherData?; fuzzyCandidateCap? }`.
- `ListMatchOutcome { matches: FoundListMatch[]; unscreened: { 'list-id', reason }[]; notApplicable: { 'list-id', reason }[] }`. `FoundListMatch` carries listId, listKind, listVersion, listItemId, source, method, tier, confidence, approximate, score, distanceMeters, matchedValue (for sealing).
- Methods: exact key (R), CIDR containment through SP-GiST, geolocation by box overlap (`&&` with the probe's uncertainty box) then haversine (H, approximate), fuzzy name through the last-name candidate keys and the unchanged C78 scorer and threshold, capped at `fuzzy-name-candidate-cap` 2,000 (`limit_exceeded` above it, never "no match"). An outdated `normaliser_version` reads `normaliser_outdated`, a rotated key `key_rotated`, an unreadable probe `probe_unavailable`.

## The screening job (C99.3-C99.5)
- Outbox: `createListScreeningInTx` (foundation-7b) writes `list_screenings`; `runListScreenSweep` (`jobs/lists/sweep.ts`, `LIST_SCREEN_REENQUEUE_AFTER_MS` 2 min, `LIST_SCREEN_SWEEP_LIMIT` 500) enqueues `list-screen`; `processListScreen` (`jobs/lists/screen.ts`, `LIST_SCREEN_MAX_ATTEMPTS` 5) builds the C99.5 probes (`probes.ts`; government_id_country included; verifications with from_rejected_handoff left out), selects the lists (`selection.ts`), runs matchLists, writes list matches (unique per inquiry, item, source), stores `match_count`, `unscreened`, `not_applicable`, `review_cause`, and emits `list-match.created` with matched-value and reason null.
- A redacted inquiry: the job and the sweep skip it (the row ends errored with a last_error_code); on-list-match never moves a redacted inquiry to needs_review (checked here, since the 6D guard leaves completed -> needs_review open).
- `servedInquirySignals` merges `inquiry/list_match_count` with `list-screening` details (V06); with expose-signals off nothing is served; it answers while the stored signals are null.
- `resolveListMatchFilterSubjects` (`services/lists/filter-subjects.ts`) resolves the strict list-match webhook filter.
- `listConfigPublishProblems` (`services/publish/list-config.ts`): `list_kind_mismatch`, `kind_not_collected`, with pointers.
- `createCompromisedIdLookup(deps)` (`services/lists/compromised-ids.ts`): the opted-in lists; `id_compromised_detection` answers not_applicable with `compromised_list_unavailable` for a list it could not read, and a match writes the C99.9 record.
- `rebuildListIndexes(db, key, { batchSize })` (`services/lists/rebuild.ts`): recomputes every key from the sealed values; a rotated fingerprint item stays unmatched (`key_rotated`).
- `createListItemWriter({ blindIndexKey })`, `createListService(deps)` (`services/lists/item-writer.ts`): the real ports; NOT wired until the hooks patch is applied.

## The report type
`customListReportJob` (`jobs/report-types/custom-list.ts`, type `custom-list`): matches keyed by the item, list provenance in `reportListProvenanceSchema`'s shape, an unscreened list errors the run, `list-ids` at most 20. The completion case in `services/reports/completion.ts` takes the C99.5 query sources including government_id_country. Its persistence of listSources, the served resource and the create/publish list problems are in the hooks patch.

## What integration-7b must do
- Apply `docs/tdd/phase7-api-lists.hooks.patch` (11 files: container.ts, worker.ts, routes/server/accounts.ts, services/inquiries.ts, services/reports/{reports,resources,templates}.ts, services/retention.ts, jobs/report-types/job.ts, jobs/reports/persist.ts, and the new jobs/report-types/custom-list-engine.test.ts). `git apply --check` passes on 05769f58. It was verified on f5304b5e only (tsc clean, 118 tests in 8 files), never linted, never in the full suite. Until it lands, the container serves `unbuiltListService`, the worker has no real CompromisedIdLookup or ListItemWriter, `include=list-matches` serves nothing, and a custom-list report stores no list provenance.

## What the e2e and the console need
- A full-stack lists spec (C111.2): create a list (e.g. email-address, synthetic example.com), add an item, complete an inquiry on a template whose version publishes `list-config` selecting it, wait for the list-screen job (sweep 15 s), then read `GET /list-matches?filter[inquiry-id]=`, the inquiry's `inquiry/list_match_count` with expose-signals on, and dismiss it. It needs the hooks patch for the worker writer and the include.
- The console: list pages per kind with masked values without pii:view; the match list with dismiss (reason PII); a "not screened" state per list from `unscreened` and `not-applicable` reasons, never shown as "no match"; the custom-list report results (Stage 1a's `CustomListResults`).

### contractDeviations

- Hooks outside api-lists paths: docs/tdd/phase7-api-lists.hooks.patch (committed 0d4586e6) is the exact change to 11 shared files (apps/api/src/container.ts, worker.ts, routes/server/accounts.ts, services/inquiries.ts, services/reports/reports.ts, resources.ts, templates.ts, services/retention.ts, jobs/report-types/job.ts, jobs/reports/persist.ts, and the new jobs/report-types/custom-list-engine.test.ts): wires createListService into the container, createCompromisedIdLookup and createListItemWriter into the worker, serves include=list-matches on inquiries and accounts, persists and serves the custom-list listSources, refuses custom-list list problems at report create and template publish, and deletes item objects in the retention purge. Not applied by api-lists (shared files); integration-7b applies it. Plan amendment 10 (uncommitted in the plan) gives leave only for the accounts.ts line, which is in the patch.
- 54a64030 added one line each outside api-lists paths: compromised_list_unavailable to packages/contracts/src/government-id-check-reasons.ts (the id_compromised_detection reasons) and its words to apps/dashboard/src/lib/check-reasons.ts. Needed because C99.9 makes the check answer not_applicable for a configured list it could not read. The Android SDK does not decode government-ID reasons; the Android gate passed.
- 05769f58 changed the pinned expectation in apps/api/src/jobs/signals/process.test.ts (api-signals' file): the served signals now carry inquiry/list_match_count beside the frozen ones (C99.4, V06). Behaviour change by the plan, not a weakening.
- C99.2 geolocation: a probe is matched by box overlap (&&) with the box of the probe's own uncertainty, not bbox @> box(p, p) as written: containment of the point misses an item whose centre is outside the probe box but whose radius plus the uncertainty reaches it. Amend C99.2 to the overlap.
- C99.2 fuzzy name: the C78 scorer anchors on the family token and scores a given name alone as 0, so the fuzzy method scores the whole name (the last names already agree through the candidate key). Scorer, threshold and cap unchanged.
- components.methods in the report contract refuses an underscore (^[a-z][a-z0-9-]*$), so fuzzy_name is served there as fuzzy-name; entity.method keeps the enum value.
- 5e3af846: PATCH /lists/:id no longer answers 409 for an archived list (an archived list takes a change), and POST /lists/match reads an unknown named list as list_archived instead of 404, because neither status is in the frozen route schemas. If 409/404 are wanted, that is a route-schema change for integration-7b.
- A redacted inquiry found by the screening job ends its list_screenings row errored with a last_error_code (LIST_SCREENING_STATUSES has no skipped; foundation-7b plan item 4).
- GREEN 3e89fb9d carried a lint error (an any in list-plumbing.test.ts) because its chain did not stop on eslint's exit code; 81d8891f fixed it. Two tests were characterisation tests, green on their first run: 58236747 (C99.8 on Postgres) and the stored-API-log test in 0d4586e6.
- The completion-custom-list test's RED was seen after its implementation was written, by restoring the old case for one run; the test was committed before the implementation (ed2e897c/3812a658 then 2f6f7cc3).
- The 1,000,000-item benchmark files were never committed (they need a container this repo does not start and a fixed scratch path); their full text is in the TDD record.

### Followups

- integration-7b: apply docs/tdd/phase7-api-lists.hooks.patch on HEAD (git apply --check passes on 05769f58), then lint it and run the API suite; until then the real ListService, CompromisedIdLookup and worker ListItemWriter are not live, include=list-matches serves nothing, and custom-list reports store no list provenance.
- integration-7b: commit plan amendment 10 (leave for the accounts.ts include line) and the amendments in contractDeviations (the C99.2 box overlap, the whole-name fuzzy score, fuzzy-name in components.methods, the 409/404 removal).
- integration-7b: write the full-stack lists spec of C111.2 (create, item, completion screening, list matches, dismiss, list_match_count) once the hooks patch is in.
- Owner or Phase 11: a heavy-headed last name over fuzzy-name-candidate-cap 2,000 leaves 117 of 300 Zipf probes unscreened with limit_exceeded on a 1,000,000-item fuzzy list; any change of the cap needs a quality calibration (decision 9 after 6C).
- Owner or 7C: the API unit suite no longer fits two shards under load (a 1/2 shard ran past 10 minutes at load 40); it was run as four blob shards plus the merge. The prompt's two-shard form may need four.

### Measurements

- API unit suite at 05769f58, as four blob shards plus the merge (the two-shard form exceeded 10 minutes at load 33-40; loads 33.0, 36.9, 34.7, 23.6 at the shards' starts): 414 files, 5,691 passed, 0 failed; coverage 96.27 / 88.48 / 97.94 / 96.32 (statements, branches, functions, lines); merge rc 0.
- e2e full stack at 05769f58 (Stage 3 form, own stack per shard): shard 1/3 32 passed in 3.2 min (load 16.96), 2/3 34 passed in 7.9 min (load 8.56), 3/3 29 passed in 4.5 min (load 4.93); mocked flow 79 passed earlier at 05769f58.
- Android gate: BUILD SUCCESSFUL in 15 s (mostly up to date), rc 0, load 2.94.
- 1,000,000-item fuzzy name list (C99.2), under the e2e lock, load 42 before and 17 after: list health p50 227.2 / p95 285.6 ms; probe p50 616.2 / p95 971.2 / max 1,604.5 ms; 117 of 300 probes limit_exceeded; 1,812 fuzzy matches; 44 last names over the cap of 2,000.
- Earlier gates after 05769f58: db 1,467 tests at 95.65%; checks 3,791; contracts 2,615; dashboard 3,971; test:integration db 68, api 201; turbo lint typecheck --force 30/30; format:check clean.
- C99.8 on Postgres 17: 12 tests in 41.6 s at load 51.
