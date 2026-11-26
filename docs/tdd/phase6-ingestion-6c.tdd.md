# TDD record: `ingestion-6c` (Phase 6, Workflow 6C Stage 1)

Owner decisions 9, 10, 20 and 21 after Workflow 6B (`docs/plans/phase-6.plan.md`, "Owner decisions after Workflow 6B" and "Workflow 6C"). Every command below was run from the repository root after `source scripts/env.sh`; the output is abbreviated to the lines that matter. Commits are path-scoped, on `main`, never pushed.

| Slice | Decision | RED | GREEN |
|---|---|---|---|
| 0. The record type, a stub for the other 6C agents | 9 | — | `fc88287e` |
| 1. The risk-data hash reads the members only when present | 9 | `a9a506ae` | `6530831a` |
| 2. The OFAC parser writes list memberships | 9 | `7b46c7b6` | `3d749d24` |
| 3. The PEP build derives `relative_of_class` | 9 | `ad173b78` | `832fd6ba` |
| 4. The synthetic OFAC files write memberships | 9 | `70dbd6b0` (stub `0fdbf648`) | `6407e32b` |
| 5. The sandbox PEP relative carries its class | 9 | `21136dc9` | `f9830d38` |
| 6. The first sync after the upgrade (acceptance) | 9 | `65016ac0`, mutation-checked | — |
| 6b. No score changes (guard) | 9 | `6240b074` | — |
| 7. The change signal is dropped | 10 | `f8a5668e` | `d66c3a78` |
| 8. The redirect keeps scheme, host and port | 20 | `34f64dae` | `eedcd091` |
| 9. The UN note | 21 | `7f09516e` | `4e4ae89a` |
| Docs | 1, 9, 10, 19, 20, 21 | — | `9081cd7b`, `c3061942` |

## Slice 0: the record type first (`fc88287e`)

So that `matcher-6c` and `api-reports-6c` could build on the names at once, the record type and schema gained the two optional members in a commit of their own, before any behaviour (rule 5's stub):

- `list_memberships?: { list: string (≤ 200), program: string (≤ 200) | null }[]`, 1 to 100 items (`watchlistListMembershipSchema`, `WatchlistListMembership`);
- `relative_of_class?: 1 | 2 | 3 | 4` (an integer).

```
$ pnpm --filter @openverify/watchlist exec vitest run src/record --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

The golden vectors of the existing records held: no hash read the members yet.

## Slice 1: risk data only when present (decision 9)

RED (`a9a506ae`). The new golden vectors (`bab2e9da…f448c6`, `75ba0e0d…ec57f0`, `c0880d04…dc0ba1062`, `498689ea…c79f642a`) come from an independent Python implementation of the canonical JSON rule, kept outside git, which also reproduces the two frozen vectors of 6A (`871585ed…d491a3`, `8c441511…f3e2c0`).

```
$ pnpm --filter @openverify/watchlist exec vitest run src/record --coverage.enabled=false
 × parses list_memberships and relative_of_class, and refuses what they cannot mean
   AssertionError: expected true to be false            (record.test.ts:284: a class without relations)
 × enter the risk-data hash only when present, and never the content hash
   Expected: "bab2e9da67834c698435482dd386b883a8c7e5b5cd1a5f7456410c10f7f448c6"
   Received: "871585eda4ec0850ab6f731d50a09dd90064f5d4e4348bdef480f62380d491a3"
 Tests  2 failed | 12 passed (14)
```

GREEN (`6530831a`): `riskDataHash` adds `list_memberships` (set-like) and `relative_of_class` to its projection as members whose value is `undefined` when absent, which canonical JSON leaves out, so a record without them hashes byte for byte as before; `contentHash` is untouched; the schema refuses a `relative_of_class` on a record without `relations`.

```
$ pnpm --filter @openverify/watchlist exec vitest run --coverage.enabled=false
 Test Files  50 passed (50)
      Tests  472 passed (472)
```

## Slice 2: OFAC list memberships (decision 9)

OFAC's enhanced XSD (read as a reference at SHA-256 `0c56f9f2…2b97f`, the file watchlist-ingest read, never committed) gives an entity `sanctionsLists/sanctionsList` (with `id` and `datePublished`) and `sanctionsPrograms/sanctionsProgram` (with `id`) side by side, and nothing ties a programme to a list. So a membership names a programme only when the entry is on that one list alone, and `null` otherwise.

RED (`7b46c7b6`):

```
$ pnpm --filter @openverify/watchlist exec vitest run src/parsers/ofac.test.ts --coverage.enabled=false
 × ties each programme to the one non-SDN list an entry is on, changing only its risk data
 × ties no programme when an entry is on several lists, or names none
   AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]   (ofac.test.ts:738, :759)
 Tests  2 failed | 12 passed (14)
```

The two guards in the same commit (an SDN-only entry has no member; the SDN List is read in any case and spacing, and a list without a name is skipped) passed at RED, as they should: the earlier parser wrote no member at all.

GREEN (`3d749d24`): `listMemberships` in `parsers/ofac.ts` takes each list once by its lookup key, in the file's order, cut to the label cap, and leaves out the SDN List; `finishRecord` leaves an empty list out of the record, so it stays absent rather than empty.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/parsers --coverage.enabled=false
      Tests  89 passed (89)
```

The whole package then passed but for `src/testing/held-out/golden.test.ts`, an untracked file of `evaluation-set-6c` being written at the time (7 failures there, none in my paths).

The weak AKAs need no new member: `ofacNames` already sets `names[].quality` to `weak` from `isLowQuality`, which `maps a person: names by translation, weak aliases, …` asserts (the "Avy Q" alias). The EU (`strong="false"`), UK (`AliasStrength` "low") and UN (`QUALITY` "Low") parsers do the same.

## Slice 3: a relative's class (decision 9)

RED (`ad173b78`). The test service now takes its tables as a parameter (the defaults are the module's), so one test can build two class rows.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/pep --coverage.enabled=false
 × gives each relative the class of the PEP it relates to, and a holder without family links none
   AssertionError: expected undefined to be 1                                  (build.test.ts:459)
 × carries a holder's class change to each of its relatives, as a change of risk data only
   AssertionError: Q-test-1101: expected undefined to be 2                     (build.test.ts:479)
 × takes the most senior class when a relative relates to PEPs of several classes
   AssertionError: expected { entry_id: 'Q-test-1303', …(11) } to match object { …(2) }   (build.test.ts:526)
 Tests  3 failed | 49 passed (52)
```

GREEN (`832fd6ba`): the build computes each kept holder's class (the most senior class of its kept positions) and gives every record with `relations` the most senior class of the PEPs it relates to.

```
$ pnpm --filter @openverify/watchlist exec vitest run --coverage.enabled=false
 Test Files  51 passed (51)
      Tests  486 passed (486)
```

## Slice 4: the synthetic OFAC files (decision 9)

A stub first (`0fdbf648`): `OFAC_LIST_NAMES`, the writer's two list names, exported unchanged, so the RED test compiles.

RED (`70dbd6b0`):

```
$ pnpm --filter @openverify/watchlist exec vitest run src/testing/formats --coverage.enabled=false
 × writes a record's list memberships as its lists, beside the SDN List on the SDN file
   AssertionError: expected [ …(2) ] to deeply equal [ [ …(2) ], …(1) ]       (publishers.test.ts:171)
 × reads back the list memberships of a Consolidated file
   AssertionError: expected [ [ { …(2) } ], …(2) ] to deeply equal [ [ { …(2) } ], …(2) ]   (parsers-compat.test.ts:116)
 Tests  2 failed | 27 passed (29)
```

GREEN (`6407e32b`): `ofacEnhancedXml` writes a record's membership lists as its `sanctionsList`s (beside the SDN List on the SDN file); a record without memberships is written exactly as before, so every existing file keeps its output for a given seed.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/testing --coverage.enabled=false
      Tests  130 passed (130)
```

## Slice 5: the sandbox PEP list (decision 9)

The PEP report's class filter is to read the class from the relative's own record, so the committed sandbox relative must carry it as a PEP pass would.

RED (`21136dc9`):

```
$ pnpm --filter @openverify/watchlist exec vitest run src/testing/sandbox.test.ts --coverage.enabled=false
 × holds fictional office holders of every class and one relative
   AssertionError: expected undefined to be 1                                  (sandbox.test.ts:220)
 Tests  1 failed | 7 passed (8)
```

GREEN (`f9830d38`): the generator gives the spouse its head of government's class, and the committed file was regenerated:

```
$ OPENVERIFY_WRITE_FIXTURES=1 pnpm --filter @openverify/watchlist exec vitest run src/testing/fixture-files.test.ts --coverage.enabled=false
      Tests  5 passed (5)
$ pnpm exec prettier --write packages/watchlist/fixtures
$ git diff packages/watchlist/fixtures      # one change: "relative_of_class": 1 on Q-test-1002
$ pnpm --filter @openverify/watchlist exec vitest run src --coverage.enabled=false
 Test Files  51 passed (51)
      Tests  488 passed (488)
```

## Slice 6: the first sync after the upgrade (decision 9, acceptance)

The plan's three tests at the sync's level, over PGlite (`apps/api/src/watchlists/sync.test.ts`). "Before the upgrade" is the new parser's records without `list_memberships`, which is exactly what the earlier parser wrote, imported as the normalised format; then the publisher's file is synced, dated a day later.

- An SDN publication, whose entries are on the SDN List alone: `added 0, changed 0`, both hashes and `changed_sync_id` of every entry unchanged, no name row rewritten (`xmin`), no re-screen.
- A Consolidated publication: every entry gains a membership; `changed` = every entry, each with its content hash unchanged and its risk-data hash changed, `changed_sync_id` = the new sync, no name row rewritten, `rescreen_state` `pending` and one `report-rescreen` enqueued.

These came after the units of slices 1 to 4, so they passed on their first run (`65016ac0`). To show that they can fail for the intended reason, the risk-data projection of `list_memberships` was forced to `undefined` for one run and then restored (the file's diff was empty afterwards):

```
$ pnpm --filter @openverify/api exec vitest run src/watchlists/sync.test.ts --coverage.enabled=false -t "upgrade"
      Tests  2 passed | 25 skipped (27)
# mutated hashes.ts:
 × changes only the risk-data hash of an entry that gains list memberships, which gets changed_sync_id and is re-screened
   AssertionError: expected { sourceId: 'ofac-consolidated', …(9) } to match object { outcome: 'applied', added: +0, …(3) }
      Tests  1 failed | 1 passed | 25 skipped (27)
```

A holder's class change reaching each relative is slice 3's second test; the sync cannot be given other class rows than `pep-positions.json`'s.

## Slice 6b: no score changes (decision 9, guard)

`record.test.ts` screens a subject against `LISTED` and `RECORD`, and `RELATIVE` with and without its class, through `screenCandidates` (`tolerant`, weak aliases screened): each pair gives equal matches, one each (`6240b074`). It passed on its first run, since the matcher reads neither member; it stays as a guard for later changes. The same commit replaced a `delete copied[member]` in the slice 1 test helper, which the lint rule `no-dynamic-delete` refused.

## Slice 7: the change signal is dropped (decision 10)

RED (`f8a5668e`): the committed manifest has no `change_signal` member on any source and its schema refuses one; the package entry point exports no signal reader, and `@openverify/watchlist/testing` no writer of their answers.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/stubs.test.ts --coverage.enabled=false
 × exports no change-signal reader, nor a writer of their answers (owner decision 10 after 6B)
   AssertionError: ofacChangeSignal: expected { …(175), …(1) } to not have property "ofacChangeSignal"
 Tests  1 failed | 2 passed (3)
$ pnpm --filter @openverify/api exec vitest run src/watchlists/manifest.test.ts --coverage.enabled=false
 × names no change signal: every check downloads the file and compares its SHA-256 (owner decision 10 after 6B)
   AssertionError: ofac-sdn: expected [ 'id', 'publisher', 'kind', …(15) ] to not include 'change_signal'
 Tests  1 failed | 12 passed (13)
```

The new manifest test replaced "names a change signal where the publisher offers one (C77.4)", whose behaviour the decision removes.

GREEN (`d66c3a78`):

- `watchlists/sources.json` and `manifest.ts`: `change_signal` and `WATCHLIST_CHANGE_SIGNALS` removed (the strict schema now refuses the member);
- `packages/watchlist/src/parsers/signals.ts` (`ofacChangeSignal`, `euChangeSignal`, `ukChangeSignal`, `changeSignalMoved`, `ChangeSignal`) and its test removed. No reader stays for provenance: no code called them, and each parser reads its publication time from the file itself (OFAC `publicationInfo/dataAsOf`, EU `generationDate`, UK `DateGenerated`, UN `dateGenerated`; the PEP build takes the sync's time);
- `packages/watchlist/src/testing/formats/signals.ts` (the synthetic signal answers) and its test removed;
- the sync had no pre-check to remove (C76.2 step 2 was never built); its header now says why none is asked.

```
$ pnpm --filter @openverify/watchlist exec vitest run src --coverage.enabled=false
 Test Files  49 passed (49)
      Tests  475 passed (475)
$ pnpm --filter @openverify/api exec vitest run src/watchlists src/http/stream.test.ts --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  93 passed (93)
$ pnpm --filter @openverify/api exec tsc --noEmit        # clean
```

## Slice 8: the redirect keeps scheme, host and port (decision 20)

RED (`34f64dae`): a second local server on another port; the list server redirects to the allowed host on that port.

```
$ pnpm --filter @openverify/api exec vitest run src/http/stream.test.ts --coverage.enabled=false
 × refuses a redirect to the allowed host on another port, without requesting it (owner decision 20 after 6B)
   Error: expected an OutboundHttpError      (the client followed the redirect, and the other port answered 200)
 × keeps the scheme, the host and the port (owner decision 20 after 6B)
   AssertionError: expected URL { href: 'https://storage.example.test:8443/x', … } to be null   (stream.test.ts:351)
 Tests  2 failed | 13 passed (15)
```

One existing assertion changed with the decision: `http://storage…` from an `https` base, for a client allowed plain HTTP, was followable; it changes scheme, so the assertion now uses an `http` base, and the new test asserts the `https` to `http` refusal.

GREEN (`eedcd091`): `followableRedirect` also requires the target's protocol and port to equal the request's (`URL.port`, so `:443` written or not is the same port on HTTPS).

```
$ pnpm --filter @openverify/api exec vitest run src/http/stream.test.ts src/watchlists --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  95 passed (95)
```

## Slice 9: the UN note (decision 21)

RED (`7f09516e`):

```
$ pnpm --filter @openverify/api exec vitest run src/watchlists/manifest.test.ts --coverage.enabled=false
 × says that the UN list cannot be enabled in this release, as the reports README does (owner decision 21 after 6B)
   AssertionError: expected 'The UN website terms grant personal, …' to match /cannot be enabled in this release/
 Tests  1 failed | 13 passed (14)
```

GREEN (`4e4ae89a`): the note says the source ships disabled and cannot be enabled in this release, every start and refresh tick setting it back to disabled, with the opt-in carried to Phase 11.

```
$ pnpm --filter @openverify/api exec vitest run src/watchlists/manifest.test.ts src/watchlists/reconcile.test.ts --coverage.enabled=false
      Tests  18 passed (18)
```

## Docs (`9081cd7b`, `c3061942`)

`docs/reports/README.md`: what a list entry holds (both hashes, weak aliases carried by `names[].quality`, `list_memberships`, `relative_of_class`, both risk data only when present); "Upgrading to Workflow 6C" (re-key once, written from decision 1 and 19; one re-screen of each entry that gains a member, a reviewed notify-on-change match returning to `pending` once); no change signal by design, with the conditional request carried to Phase 11; the redirect's scheme and port; the UN note.

## Final gates

Run in the foreground at the end, with the other 6C agents' commits up to `55e95a58` in the tree. The one-minute load average is given at the start and the end of each call.

| Gate | Result | Load |
|---|---|---|
| `pnpm --filter @openverify/watchlist test` | 62 files, 582 tests passed; 98.7 / 89.47 / 98.88 / 98.69 (statements / branches / functions / lines) | 9.89 → 10.77 |
| `pnpm --filter @openverify/db test` | 77 files, 977 tests passed; 95.77 / 89.77 / 96.51 / 96.11 | 10.07 → 15.07 |
| API suite (`apps/api`: `vitest run --coverage --shard=1/2` and `2/2` with blob reports, then `--merge-reports --coverage`) | 318 files, 4,505 tests passed; merged 96.16 / 88.23 / 97.54 / 96.26 (each shard alone is under 80%, as expected) | 14.40 → 17.41 |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 14 of 14 tasks each; Prettier clean | 13.91 → 7.22 |
| `pnpm test:integration` | db 12 files, 60 tests (133 s); api 27 files, 146 tests (271 s); all passed | 7.30 → 12.74 |
| e2e, as `flock /tmp/openverify-e2e.lock pnpm e2e` in four calls | mocked flow 69 passed (24.5 s); full stack `--shard=1/3` 31 passed (3.1 min), `2/3` 31 passed (5.2 min), `3/3` 29 passed (5.9 min): 91 in all | 11.01 → 9.69 |

An earlier run of the same gates, while the other agents' RED steps and uncommitted GREEN edits were in the tree, failed only in their files (`src/keys/name-keys.test.ts`, `src/match/retrieval.test.ts`, `scripts/benchmark-paired.test.mjs`, `watchlist-reads.test.ts`, `report-repositories.test.ts`, `watchlist-sources.test.ts`, `matching-reports.test.ts`, `watchlists-fake.test.ts`); none of those failures was in a path of mine, and every one was gone at the final run.
