# Phase 7, Workflow 7B Stage 3: `api-biometric-lists` (family L)

C97.4 and C99.7: face and background lists. Item creation from an inquiry with the consent check, the embed job through vision, the item's own sealed copy and its retention by the consent window, the bounded decrypting cache, the background prefilter and ORB confirmation, the acknowledgement setting with `onSettingsChangedInTx`, and `BiometricListMatcher`, `BiometricItemRedactor` and `BiometricListsGate`.

Base `57ac714f`. Commands ran from the repository root unless stated, after `source scripts/env.sh`. Faces appear only in the vision test that reads the public-domain fixture set; every other test uses random bytes behind an image signature and seeded vectors.

## 1. Vision: `POST /v1/mask/background` (owner decision 16)

No route returned a person-masked image: `POST /v1/compare/background` masks inside the comparison and answers scores. The route is new, and `VisionClient.maskBackground` reads it.

**Stub:** `b7c6359d`. **RED** `tests/test_background_mask.py`, seen failing on the stub:

```
$ uv run pytest tests/test_background_mask.py -q --no-cov
src/openverify_vision/background.py:252: NotImplementedError
FAILED tests/test_background_mask.py::test_the_person_is_gone_and_the_finder_sees_no_face
...
13 failed, 1 passed in 1.45s
```

The one pass is the service-token refusal, which the middleware answers before any route. **GREEN** `e719e13d`:

```
$ uv run ruff check && uv run ruff format --check && uv run mypy src tools
All checks passed!
196 files already formatted
Success: no issues found in 78 source files
$ uv run pytest tests/test_background_mask.py tests/test_background.py tests/test_schemas_document.py tests/test_contract_fixtures.py -q --no-cov
90 passed in 5.15s
```

**Design.** The copy is the 640-pixel comparison copy with every face the finder sees, head and shoulders grown by `MASK_GROWTH`, painted out by Telea inpainting. A flat fill would leave a hard edge that spends the comparison's 1,000-keypoint budget. The public-domain test confirms YuNet finds no face in the masked copy, and that the copy still confirms a re-framed room and refuses another studio. A frame with no face answers 422 `no_face_found`, which the job reads through `isUnreadableImageError`. A PNG carries none of the upload's metadata.

Cost on one thread: 126 ms CPU per mask, 203 KB per PNG, on the synthetic 640 x 480 room.

## 2. The API client

**Stub** `f15031e5` (the port member, the bound, and the four fakes that implement `VisionClient`). **RED** `afe4f625`:

```
FAIL src/vision/index.test.ts > ... > refuses a masked background over the 640 px of the contract (C99.7)
AssertionError: expected Error: maskBackground is not built yet to be an instance of VisionResponseError
Tests  2 failed | 75 passed (77)
```

**GREEN** `b2b5468c`: 77 passed, `tsc` exit 0.

## 3. The repository

**Stub** `dd3c08f4`, **RED** `ce346d06` (41 failed on `ListRepositoryNotBuiltError`), **GREEN** `1effd659` (59 passed with the plumbing test).

The first GREEN test run showed one failure in my own setup, `inquiry_sessions_handoff_fields_together`: the handoff columns fill together. Fixed in the test.

Reading `api-lists`' `redactListItems` before the commit changed two things:
- `list_matches.list_item_id` goes `null` with the item (C99.3), which mine did not do. A test now holds it.
- Its lock order is item, then list, and the C16 pass locks items with `skip locked`. Mine locked lists first, which could deadlock against that pass, so mine moved to inquiry, item, list.

## 4. The gate, the redactor and the hook

**RED** (with test support, and `readBiometricListsBasis` as a stub):

```
FAIL ... > BiometricListsGate (C97.4) > says no until a basis is recorded, and only for that environment
Error: isAcknowledged is not built yet
FAIL ... > onSettingsChangedInTx (C97.4, P08) > redacts every biometric list when the basis is cleared
Tests  5 failed | 4 passed (9)
```

**GREEN** `0b0fa99c`: 9 passed, db 44 passed.

## 5. Adding an item

**RED**: 24 failed on the stub. **GREEN** `82fb6fcd`: 33 passed across the folder. `lockBiometricList` was dropped for `api-lists`' `lockList`.

## 6. The embed job and its sweep

**RED**: 27 failed on `processListItemEmbed is not built yet`. **GREEN** `ee246f88`: 27 passed.

## 7. The cache

**RED**: 14 failed on `not built yet`. **GREEN**: 15 passed.

## 8. The matcher

**RED** `1b836c38`: 41 failed. **GREEN** `b8be9b58`: 41 passed; the folder 89.

## 9. Redaction coverage (plan item 15)

`list_item_faces` and `list_item_backgrounds` moved to `SUBJECT_PII_TABLES`, really seeded by `seedPiiSubject`, with a sealed template carrying the PII marker and a masked object in storage. RED against the stub redactor:

```
FAIL src/services/redaction.test.ts > redactAccount (C16) > leaves nothing of the subject in any table or in storage
AssertionError: expected '[{"id":"acc_01M6AAR8P0PMRS51MC04HZ8Q4…' not to contain 'Zyxw-synthetic-pii'
Tests  5 failed | 20 passed (25)
```

That RED found a defect in my own design, which the plan's port would have shipped. `redactBySource` deleted the side row and answered the object's key; if storage failed after the commit, a retry found no row, and the object was orphaned. Now a masked object stays recorded on its row, without its layout, until the job has deleted it. The caller still deletes it at once, and the sweep covers a crash or a storage failure. `keepMaskedObjects` went with that. GREEN `0769598c`: 141 passed.

## 10. Races on Postgres 17

`src/services/lists/biometric/races.integration.test.ts`, 9 tests, each order held inside its transaction, and each waiting writer proved to wait. They were written after the code they test, so each lock was removed in a private worktree to see them fail:

| Mutation | Result |
|---|---|
| `readBiometricListsBasis` without `FOR SHARE` | 2 failed: `the add first: the clear waits`, `the clear first: the add waits` |
| `lockList` without `FOR UPDATE` | 1 failed: `gives the last place to one of two sources` (2 fulfilled) |
| `activate` without `status = 'pending'` | not caught here; the db unit tests hold it |

The job's two races still passed with no shared lock: the item row lock and the `pending` guard also cover them, so the shared lock is what protects a row that does not exist yet (the add).

## 11. The worker

**RED**: `expected undefined to be defined` on `screen.mock.calls[0]?.[1].biometric`. **GREEN** `dc89a6cc`: 55 passed across the three worker test files.

## 12. Measurements

All under `/tmp/openverify-e2e.lock`, Node 22, one thread. Load before 4.71 4.92 4.86, after 4.58 4.88 4.85.

- **Memory.** 10,000 faces: heapUsed +2.83 MB, arrayBuffers +4.88 MB, so 809 B per face, 297 B beyond the 512 B vector. `FACE_OVERHEAD_BYTES` had been 256, written before this was measured, and is now 300. A full list of 10,000 is about 8.1 MB.
- **The bound.** Offered 20 full lists at 64 MB, the cache held 8 and evicted 12. That count was taken at 256 B; at 300 B a full list counts 8.12 MB against 67.1 MB, so eight still fit.
- **A scan.** 10,000 templates: 6.63 ms CPU.
- **Hit rate.** Synthetic traffic, one hour, 5 lists of 2,000 items, each screening reading all five:

| Traffic | Hit rate | Hits | Misses | Evictions |
|---|---|---|---|---|
| a screening a second, an item every 5 minutes | 99.91% | 17,983 | 17 | 12 |
| a screening a minute, an item every 5 minutes | 94.33% | 283 | 17 | 12 |
| a screening every 20 minutes, an item an hour | 0.00% | 0 | 15 | 10 |

The last row is the idle expiry working: with no reader inside ten minutes, nothing stays decrypted. That is the privacy bound doing its job, at the cost of opening the list's templates for each such screening. That unseal cost was not measured.

## Report (api-biometric-lists)

**Status:** done. **Blockers:** none.

### Summary
Every deliverable in the api-biometric-lists bullet (C97.4, C99.7) is built test-first, in 31 path-scoped commits (`b7c6359d..ac02659a`) on base `57ac714f`, plus this report. Nothing was pushed, no dependency was added, and no environment variable is new. The run was stopped by the usage limit on 2026-11-01 before its last gates. On resume the code was not changed, and the gates were re-run in the shared tree at `05769f58`+:
- **API suite:** 4 blob shards plus the merge, rc 0. 5,691 tests in 414 files, at 96.27 / 88.48 / 97.94 / 96.32.
- **API alone:** `typecheck` rc 0, `lint` rc 0.
- **Whole repo:** `pnpm turbo run lint typecheck --force` rc 0 (30 of 30), `pnpm format:check` rc 0.
- **e2e:** mocked flow 79 passed, rc 0. Full-stack shard 3/3, 29 passed, rc 0. Shards 1/3 (32) and 2/3 (34) were rc 0 on 2026-11-01 03:20Z, with this same code.
- **Already green on 2026-11-01, with this code, not re-run:** db test rc 0 at 95.64%; `pnpm test:integration` rc 0 (api 201, db 68); the Android gate rc 0; vision ruff, format, mypy and pytest (112 passed).

### Handoff
**How to run** (`source scripts/env.sh` first):
- **API:** `pnpm --filter @openverify/api exec vitest run src/services/lists/biometric src/jobs/lists/embed.test.ts src/vision src/services/redaction.test.ts --coverage.enabled=false`
- **db:** `pnpm --filter @openverify/db exec vitest run src/repositories/list-biometrics.test.ts --coverage.enabled=false`
- **Races:** `(cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/lists/biometric/races.integration.test.ts)` (9 tests).
- **Vision:** `(cd services/vision && uv run pytest tests/test_background_mask.py --no-cov)`.

**Vision route `POST /v1/mask/background`** (services/vision, owner decision 16):
- **Body:** the selfie. **Answer:** a PNG, at most 640 px on its longest side: the comparison copy, with every face YuNet finds (grown by `MASK_GROWTH` to the head and shoulders) painted out by Telea inpainting. The PNG carries no upload metadata.
- **Refusals:** 422 `no_face_found` for a frame with no face, which the job reads through `isUnreadableImageError`. Service token as on every route.
- **Fixture:** `contracts/fixtures/vision/png-limits.json` gains its bound.
- **API client:** `VisionClient.maskBackground({ image }): Promise<Uint8Array>` (ports.ts), built in `apps/api/src/vision/index.ts` on `MASKED_BACKGROUND_MAX_SIDE_PX`. It refuses a larger PNG with `VisionResponseError`.

**Port implementations:**
- **`biometricListsGate`** (`services/lists/biometric/index.ts`, wired in container.ts): `isAcknowledged(tx, environmentId)` reads `biometric-lists-basis` through `readBiometricListsBasis`, under `FOR SHARE` on the environment row, so an add and a clear serialise.
- **`biometricItemRedactor.redactBySource`** (same file, wired through `RedactionServiceOptions.biometricItems` in services/redaction.ts): runs in `redactInquiry`'s transaction, through `redactBiometricItems`.
  - Lock order: inquiry, then item, then list, as api-lists' `redactListItems`.
  - It nulls `list_matches.list_item_id` with the item.
  - It answers the masked objects' keys, which the caller deletes after the commit.
  - A masked object stays recorded on its row, without its layout, until it is deleted; `listMaskedObjectsToPurge` and `deleteRedactedBackgroundRow` let the sweep finish after a crash or a storage failure.
- **`createBiometricListMatcher(deps): WorkerBiometricListMatcher`** (`matcher.ts`, given to the screening job by worker.ts). How it decides:
  - **Probe:** the inquiry's centre selfie, under `consent.biometric-matching`, read through `selfieConsentHolds` (`source-selfie.ts`: `getEffectiveConsent` with `sessionId` null, and `matchingConsentHolds`).
  - **Faces:** cosine against the cached templates at `FACE_LIST_THRESHOLD`. A template of another model reads `normaliser_outdated`.
  - **Backgrounds:** an exact layout scan (`nearestListBackgrounds`, no ANN), then at most `BACKGROUND_LIST_CANDIDATES` masked copies through `/v1/compare/background` under the Phase 4 limits. The score is the inlier ratio; the tier is H, with `approximate`.
  - **Never "no match" for what was not read** (H02): a pending item, an unreadable template or object, or an unreadable probe leaves the list in `unscreened`. No selfie gives `subject_has_no_value`, and no consent `consent_not_given`, with no image opened.
  - Advisory only: a match never declines anything.
- **`createBiometricListItem`** (`items.ts`, called by api-lists' `services/lists/items.ts` for `face` and `selfie-background`). It adds an item only:
  - from an inquiry with a decided centre selfie and matching consent, under `pii:view`;
  - once per list and source (`hasLiveBiometricItem`), within `itemsPerBiometricList` 10,000 under api-lists' `lockList`;
  - with the acknowledgement held.

  It writes the pending item and its side row in one transaction, and enqueues the embed job after the commit.
- **`onSettingsChangedInTx(tx, environmentId, before, after)`** (`settings-hook.ts`): clearing the basis redacts every biometric list (`redactBiometricLists`).

**The job** (`jobs/lists/embed.ts`):
- **`processListItemEmbed(job, deps)`:** re-checks the item, the consent, the basis and the inquiry's redaction under the item's row lock. It then:
  - for a face, embeds through vision and stores the item's own sealed template (`completeListItemFace`);
  - for a background, stores the layout, `valid_cells` and coverage, and the masked PNG as an envelope object (`completeListItemBackground`).

  A coverage below `BACKGROUND_MIN_COVERAGE` or an unreadable image ends the item `archived` with `source_unavailable` (`archiveUnavailableBiometricItem`). A failed commit leaves no object, and an inquiry redacted while vision worked gets no template.
- **`runListItemEmbedSweep(deps)`:** every 15 s it does three things:
  - enqueues pending items (`listPendingBiometricItems`);
  - redacts items past their source's consent window (`listBiometricItemsPastRetention`);
  - purges masked objects left by a redaction or a cleared basis.

**The cache** (`cache.ts`, `createBiometricCache`):
- Keyed by list and version, at most `BIOMETRIC_CACHE_BYTES` (64 MB) per worker, with an idle expiry of `BIOMETRIC_CACHE_IDLE_MS` (10 min). Least recently used goes first.
- It counts 512 B per vector plus `FACE_OVERHEAD_BYTES` 300 (measured: 809 B per face).
- Each gallery is wiped with `wipeGallery` on every way out. The matcher re-reads the lists' states every 15 s while it holds anything, and a failed read drops everything.
- **Hit rate** (synthetic, one hour, 5 lists of 2,000):
  - 99.91% at a screening a second;
  - 94.33% at a screening a minute;
  - 0.00% at one every 20 minutes. The idle expiry is the privacy bound working.

**Thresholds** (`thresholds.ts`): none is new and none was tuned. All are provisional with a basis in core.

| Constant | Value | Basis |
|---|---|---|
| `FACE_LIST_THRESHOLD` | 0.5 | Phase 4's repeat threshold, about 0.04 false matches per search over 10,000 templates (docs/calibration/selfie-phase4.md); studio portraits only |
| `BACKGROUND_LIST_CANDIDATES` | 5 | As Phase 4 |
| `BACKGROUND_MIN_INLIERS` | 100 | Research §8: re-framed backdrop 701, different backdrops 0-31 |
| `BACKGROUND_MIN_INLIER_RATIO` | 0.5 | Research §8: 0.98 against 0-0.74 |
| `BACKGROUND_MIN_COVERAGE` | 0.25 | A quarter of the 48 layout cells |
| `BIOMETRIC_CACHE_BYTES` | 64 MB | A cost bound |
| `BIOMETRIC_CACHE_IDLE_MS` | 10 min | A privacy bound |

The three background limits are the Phase 4 defaults of `selfie_similar_background_detection`.

**db** (`packages/db/src/repositories/list-biometrics.ts`): `readBiometricListsBasis`, `hasLiveBiometricItem`, `createListItemBiometricRow`, `insertBiometricListItem`, `getBiometricItem`, `completeListItemFace`, `completeListItemBackground`, `archiveUnavailableBiometricItem`, `listPendingBiometricItems`, `listListFaceTemplates`, `listBiometricListStates`, `listCachedListStates`, `nearestListBackgrounds`, `listBiometricItemsBySource`, `redactBiometricItems`, `redactBiometricLists`, `listBiometricItemsPastRetention`, `listMaskedObjectsToPurge`, `deleteRedactedBackgroundRow`.

### contractDeviations
1. **New vision route.** No route at HEAD returned a person-masked image, and none could be derived (`/v1/compare/background` masks inside the comparison and answers scores). So `POST /v1/mask/background` is new in services/vision (`background.py` `mask_person`, its schema, `tests/test_background_mask.py`), with a bound added to `contracts/fixtures/vision/png-limits.json` and its README. The Android gate was run for that fixture, rc 0.
2. **`VisionClient.maskBackground`** is a new member of the port in `apps/api/src/ports.ts`, outside the bullet's paths. The four fakes that implement `VisionClient` gained it: `jobs/testing.ts` and the worker test fakes.
3. **A masked object stays recorded on its `list_item_backgrounds` row,** layout nulled, until its storage object is deleted. Without this, a storage failure after the commit would orphan the object. So `redactBySource` keeps the row and the embed sweep finishes the deletion (§9). C98.1 does not describe this state.
4. **Plan item 15:** `list_item_faces` and `list_item_backgrounds` moved from `BIOMETRIC_LIST_PII_TABLES` into `SUBJECT_PII_TABLES`, really seeded by `seedPiiSubject` with a sealed template and a masked object in storage. This edited `services/redaction.test-support.ts` and `services/redaction.test.ts` under foundation-7b's leave. `services/redaction.ts` passes the real `biometricItemRedactor`.
5. **Touched outside the bullet's paths, each minimally:** `apps/api/src/worker.ts` (the screening job gets `createBiometricListMatcher`); `apps/api/src/container.ts` (the real `biometricListsGate` in place of `unbuiltBiometricListsGate`); `apps/api/src/jobs/testing.ts` (the vision fake).
6. **Consent is read only** through `getEffectiveConsent` (`sessionId` null) and `matchingConsentHolds`, so a rejected handoff session's consent never counts.
7. **`list_items.normaliser_version`** of a biometric item holds `LIST_KEYS_VERSION`. The comparable model is read from the side row's `model`; a different model is `normaliser_outdated`.
8. **Gate procedure:** the API unit suite ran as 4 blob shards plus the merge, not 2. Under load about 38, one half did not fit a 10-minute call, and the merge applies the same 80% gate to the whole. Each coverage run used its own `--coverage.reportsDirectory`, because another agent's vitest held `apps/api/coverage`.

### Followups
- **integration-7b:**
  - document `POST /v1/mask/background` in the vision docs, and `list-item-embed-sweep` in C107.1's list;
  - state in `docs/lists/` that a face or background list is advisory, H-tier, provisional, and screened only for inquiries with matching consent.
- **Owner or Phase 11:**
  - the face threshold and the background limits are Phase 4's, measured on studio portraits and one re-framed backdrop; a list-specific calibration is needed before GA;
  - the unseal cost of a cold list (the 0% hit-rate case) was not measured.
- **Gate scheduling:** under load about 38 an API blob half does not fit one 10-minute call, so rule 8 may want 4 shards. Concurrent coverage runs in `apps/api` collide on `coverage/` unless each sets `--coverage.reportsDirectory`.

### Measurements
- **API unit suite (merge):** 5,691 tests in 414 files at 96.27 / 88.48 / 97.94 / 96.32; 4 shards of about 7 min each at load 27-38. Coverage of my files:
  - `embed.ts` 98.03%;
  - `matcher.ts` 94.67%;
  - biometric `items.ts` 97.36%;
  - `source-selfie.ts` 93.33%;
  - `thresholds.ts` 100%.
- **e2e:** mocked flow 79 passed in 21.8 s (load 8.0). Full-stack shard 3/3: 29 passed in 4.6 min (load 3.1 before, 2.1 after). Shards 1/3 and 2/3: 32 and 34 passed.
- **Vision mask:** 126 ms CPU per mask; 203 KB per PNG (synthetic 640 x 480 room).
- **Cache memory:** 809 B per face, so a full list of 10,000 is about 8.1 MB. 20 full lists offered at 64 MB: 8 held, 12 evicted. A scan of 10,000 templates: 6.63 ms CPU. Load 4.7 to 4.9.
- **Cache hit rate:** 99.91% / 94.33% / 0.00% (see §12).
- **Earlier on 2026-11-01:**
  - integration: api 201, db 68;
  - db 95.64%;
  - vision pytest 112 passed;
  - races: 9 tests, mutation-checked.
