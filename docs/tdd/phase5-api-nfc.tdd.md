# Phase 5, Workflow 5B Stage 3: `api-nfc` (TDD evidence)

Owner: `api-nfc`.

**Paths:**
- `apps/api/src/routes/flow/government-id-nfc.ts`, `apps/api/src/services/chip-challenges/`
- `apps/api/src/services/{guidance,attributes,submit,publish,sub-resources}/government-id-nfc.ts`
- `apps/api/src/jobs/types/government-id-nfc.ts`, `apps/api/src/jobs/repeatable/trust-anchors.ts`
- `apps/api/src/trust-anchors/`, `apps/api/src/seed/dev-seed.ts`, `apps/api/scripts/trust-anchors-sync.ts`
- `apps/api/src/routes/dashboard/trust-anchors.ts`, `trust-anchors/manifest.json`
- `packages/db/src/repositories/{chip-challenges,chip-reads,trust-anchors}.ts`
- tests beside them, plus `apps/api/src/trust-anchors-sync.test.ts` (the command's)

**Contracts:** C62.5 to C62.10 and the C52.8, C53, C50.4 parts of the NFC type.

Every command ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Output is abbreviated with `…`. `api-document` and `api-kyb` edited the same tree at the same time; a typecheck error in their files during a run (`providers/business-registry/sec-edgar.ts`, `services/attributes/business-exits.test.ts`) was theirs and gone by the next run.

## 1. Repository writes (`packages/db`)

**Stub:** `2b68566c chore(db): stub the chip challenge writes …`. Each new function threw `not implemented (n arguments)` through one helper using every argument, so the stub linted; `tsc --noEmit`, `eslint` and `prettier --check` were clean.

**RED:** `cb88e187 test(db): …` adds `chip-challenges.test.ts`, `chip-reads.test.ts` and `trust-anchors.test.ts` on PGlite:
- challenges: only the nonce's SHA-256 stored; one `initiated` per verification; the count; supersede, or expire past the expiry; consume once with the echoed nonce (another nonce, verification or environment, an expired, superseded, redacted or unknown challenge match nothing), sealing the AA response with its nonce and the report; `processed` clears both;
- reads: sealed DG1 fields and SOD signature, both indexes; replaced on a re-run, never over a redacted read; the key's length checked first; sightings count selfie-bound reads of the SOD in unredacted inquiries of other accounts only;
- trust store: sources follow the manifest; a list applied in one transaction (anchors, current memberships, the source's signing time, the audit row); withdrawal and re-listing; a rollback refused, changing nothing; an unknown source refused; an anchor withdrawn only when no enabled source lists it; CRLs current and monotonic, older ones of the issuer dropped, refusals audited; a seeded anchor kept sandbox-only; the console overview.

```
$ cd packages/db && pnpm exec vitest run src/repositories/chip-challenges.test.ts src/repositories/chip-reads.test.ts src/repositories/trust-anchors.test.ts --coverage.enabled=false
 FAIL  src/repositories/chip-challenges.test.ts > createChipChallenge (C62.5) > writes an initiated challenge holding only the nonce SHA-256
Error: not implemented (3 arguments)
 …
 FAIL  src/repositories/trust-anchors.test.ts > syncTrustAnchorSources (C62.7) > creates the manifest sources and follows their enabled flag
Error: not implemented (2 arguments)
 Test Files  3 failed (3)
      Tests  26 failed | 1 passed (27)
```

The one pass was the key-length refusal, which the stub's throw also satisfies.

**GREEN:** `40232968 feat(db): …`.
- The challenge writes are conditional updates; `consumeChipChallenge` also requires `nonce_sha256 = sha256(echoed nonce)`. The sealed `aa_response` holds `{ nonce, response }` (the job needs the nonce bytes; the row keeps only their hash); `openChipChallengeEvidence` still returns the bare response.
- `writeChipRead` upserts with `setWhere … redacted_at is null` and throws when that matched nothing; `countChipSightings` joins `inquiries` and leaves out the current inquiry and its account.
- `applyTrustSync` takes `pg_advisory_xact_lock(hashtext('openverify/trust-anchor-source/<id>'))` and, per CRL issuer, `…/trust-crl-issuer/<country>/<key id>`.

One RED test was defective: its FR CRL expired before the sync's own clock, so the sync rightly refused it. Its `nextUpdate` was moved between the sync and the overview in the GREEN commit.

```
$ cd packages/db && pnpm exec vitest run src/repositories/trust-anchors.test.ts src/repositories/chip-challenges.test.ts src/repositories/chip-reads.test.ts src/repositories/phase5b-repositories.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  39 passed (39)
```

## 2. Chip challenges, guidance and the cancel hook

**Stub:** `dbf5f6cd chore(api): stub the chip challenge service …` (`rules.ts`, `create.ts`, `index.ts`, and the test-only `testing.ts` with `nfcTemplateAttributes`).

**RED:** `e5dac247 test(api): …` (`routes/flow/government-id-nfc.test.ts`, `services/chip-challenges/rules.test.ts`, `services/sub-resources/government-id-nfc.test.ts`): 8 CSPRNG bytes as 16 hex characters returned once, only their SHA-256 stored, 300 s; the open challenge superseded, or expired past its expiry; the 11th cancels the verification (`verification.canceled`), failing the inquiry on its last attempt; the C52.1 preconditions; the guidance is `{}`; a cancel supersedes the open challenge.

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/government-id-nfc.test.ts src/services/chip-challenges/rules.test.ts src/services/sub-resources/government-id-nfc.test.ts --coverage.enabled=false
Error: expected HTTP 201, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Chip challenges are not built yet.", …}
Error: not implemented (1 arguments)
AssertionError: expected 'initiated' to be 'superseded' // Object.is equality
AssertionError: expected null to deeply equal {}
 Test Files  3 failed (3)
      Tests  10 failed | 2 passed (12)
```

The passes were the preconditions (`requireFlowVerification`, already built) and the golden refusal bodies (constants). A first draft of the guidance case used `toMatchObject({ guidance: {} })`, which `null` satisfied; it was made strict before the RED commit.

**GREEN:** `549991f9 feat(api): …`.

```
 Test Files  3 passed (3)
      Tests  12 passed (12)
$ pnpm exec vitest run src/openapi.test.ts src/routes/flow/verification-mutations.contract.test.ts src/services/guidance src/services/sub-resources --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  68 passed (68)
```

## 3. The submit guard

**RED:** `fcd10302 test(api): …` (`routes/flow/government-id-nfc-submit.test.ts`, with chip helpers in `services/chip-challenges/testing.ts`: a TD3 MRZ with computed check digits, a Utopia chip, the uploads). Chips are uploaded through the real files route.

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/government-id-nfc-submit.test.ts --coverage.enabled=false
AssertionError: expected 'initiated' to be 'submitted' // Object.is equality
AssertionError: expected 202 to be 409 // Object.is equality
 Test Files  1 failed (1)
      Tests  5 failed | 3 passed (8)
```

The passes were what the standard guard already did (the 422s for missing files and another member, and an unreadable SOD submitted).

**GREEN:** `82719d6e feat(api): …` (the guard and `services/chip-challenges/chip-files.ts`, which the job shares).

```
$ pnpm exec vitest run src/routes/flow/government-id-nfc-submit.test.ts src/routes/flow/phase5-submit.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

## 4. The sandbox anchor

**Stub** `2c57cc03`, **RED** `dac0aef4` (`trust-anchors/sandbox.test.ts`): 2 failed, `Error: not implemented (2 arguments)`. **GREEN** `8c40af65`: 2 passed. The Utopia CSCA (`buildUtopiaCsca`) is applied through `applyTrustSync` to the enabled `openverify-sandbox` source as a one-certificate "list" signed at `now`, so an anchor of an earlier year is withdrawn by the next year's seed.

## 5. The NFC job

**RED:** `f1a62574 test(api): …` (`jobs/types/government-id-nfc.test.ts`, with `seedNfcInquiry` in `testing.ts`; the Utopia anchor installed; the fake vision answers the golden face, or another for the mismatch).

```
$ cd apps/api && pnpm exec vitest run src/jobs/types/government-id-nfc.test.ts --coverage.enabled=false
 FAIL  … > passes a genuine chip bound to the selfie and the ID, and stores the read and the portrait
PermanentJobError: The job cannot succeed (unsupported_verification)
 …
 FAIL  … > marks the challenge processed and clears its evidence when processing cannot finish
AssertionError: expected 'submitted' to be 'processed' // Object.is equality
 Test Files  1 failed (1)
      Tests  10 failed (10)
```

**GREEN:** `cfd890f5 feat(api): …`, `runnable: true`.

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
$ pnpm exec vitest run src/jobs/types/index.test.ts src/jobs/type-hooks.test.ts src/routes/flow/verifications.test.ts src/routes/flow/phase5-create-upload.test.ts src/routes/flow/phase5-submit.test.ts src/emrtd-contract.test.ts --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  81 passed (81)
$ pnpm exec vitest run src/jobs/inquiry-outcome.test.ts src/phase5-masking.test.ts src/routes/dashboard/phase5-masking.test.ts src/routes/flow/verification-mutations.contract.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  138 passed (138)
```

## 6. Attributes and the publish rule

**RED:** `ad9a5c6e test(api): …` (`services/attributes/government-id-nfc-exits.test.ts`, `services/publish/government-id-nfc.test.ts`).

```
AssertionError: expected {} to deeply equal { 'name-first': 'AVERY', …(10) }      (7 exits cases)
AssertionError: expected [] to deeply equal [ { …(3) } ]
AssertionError: expected 201 to be 422 // Object.is equality
```

**GREEN:** `fb68e0e7 feat(api): …`. The first GREEN run failed the redaction case: a redaction clears check metadata (`verification_checks.metadata -> {}`), so `integrity`, `revocation` and `hash-algorithm` now fall back to the chip read's non-PII PA summary, which a redaction keeps. The exits test had seeded a summary without `revocation` and `hashAlgorithm`; it now seeds what the job writes.

```
$ pnpm exec vitest run src/services/attributes/government-id-nfc-exits.test.ts src/services/publish/government-id-nfc.test.ts src/jobs/types/government-id-nfc.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  21 passed (21)
```

**Reasons contract** `94e96a39` (`jobs/types/government-id-nfc-contract.test.ts`), written after the code: every reason the evaluators emit is published, and every published reason but `issuer_mismatch` is emitted. Its first run failed because `NFC_EVALUATOR_OUTCOMES.id_nfc_expired_detection.passed` omits `expired_within_grace_period`, which the evaluator does emit (through the Phase 3 `idNfcExpiredDetection`); the test proves the emission by evaluation instead of trusting the table. 14 passed.

## 7. The console route

**RED:** `7483d193` replaces the stub's 501 case in `routes/dashboard/trust-anchors.test.ts`. A first draft moved the harness clock after the operator signed in (401); the store is now judged at the harness clock, and the empty-store case runs on a database of its own.

```
AssertionError: expected 501 to be 200 // Object.is equality     (2 cases)
 Tests  2 failed | 3 passed (5)
```

**GREEN:** `5e0ec182`: with `openapi.test.ts`, 18 passed.

## 8. The manifest

**RED:** `a47ecc02` (`trust-anchors/committed-manifest.test.ts`), run with the manifest draft moved aside: `Error: ENOENT … trust-anchors/manifest.json` (2 failed). **GREEN:** `e8bd8467`: 2 passed.

Each root was read from its publisher's page on 2026-10-24, downloaded into a scratch folder outside the repository and hashed (`python3 -I` for the zip):

| Source | Published fingerprint | Downloaded certificate |
|---|---|---|
| `bsi-de` | SHA-256 `20:84:AE:D7:…:91:AD:A8` (CSCA 10/24) | `[ROOT-CA]_CSCA07.cer` in the zip: `2084aed7…4e91ada8` |
| `npkd-nl` | SHA-256 `41:13:56:D2:…:15:1A:24` (serial 7) | `411356d2…6e151a24` |
| `ita` | SHA-1 `e8 e9 95 76 … c9 d2 63` (CSCA05) | SHA-1 `e8e99576…85c9d263`, SHA-256 `615bd40c…9c83fa3a` |
| `che` | SHA-256 `84:39:90:bd:…:95:87:bc` (2026) | `843990bd…f99587bc` |

No list, certificate or CRL was committed.

## 9. The sync

**Stub** `f9beb6b9`. **RED** `f8dc38c3` (`trust-anchors/sync.test.ts`, 25 cases over synthetic sources served by a scripted outbound client):

```
$ cd apps/api && pnpm exec vitest run src/trust-anchors/sync.test.ts --coverage.enabled=false
     11 Error: not implemented (3 arguments)
      3 Error: not implemented (2 arguments)
      1 AssertionError: expected error to be instance of TrustContainerError
 Test Files  1 failed (1)
      Tests  25 failed (25)
```

**GREEN** `fab6f606`: 25 passed.

## 10. The command, the loader and the refresh job

**Stubs** `7ef8efec` (the loader; the command's runtime, with the existing not-built case passing a stand-in runtime so it still compiled) and `a2c42a04` (the job's loader option). **RED** `1cacd958`:

```
$ pnpm exec vitest run src/trust-anchors/load.test.ts src/jobs/repeatable/trust-anchors.test.ts src/trust-anchors-sync.test.ts --coverage.enabled=false
TrustAnchorSyncNotBuiltError: not built (every source, 1 sources)
AssertionError: expected Error: not implemented (1 arguments) to be an instance of TrustAnchorManifestError
PermanentJobError: The job cannot succeed (repeatable_job_not_built)
 Test Files  3 failed (3)
      Tests  6 failed | 10 passed (16)
```

The stub `a2c42a04` left one lint error (`void options`, `no-meaningless-void-operator`), fixed by the GREEN commit `029cce0a`.

```
$ pnpm exec vitest run src/trust-anchors/load.test.ts src/jobs/repeatable/ src/trust-anchors-sync.test.ts src/trust-anchors/ --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  65 passed (65)
```

## 11. seed:dev

**Stub** `c3dcfd6a` (the optional `sandboxTrustAnchor` member). **RED** `cc1e6b1c`:

```
$ pnpm exec vitest run src/seed/dev-seed.test.ts --coverage.enabled=false
AssertionError: expected [] to deeply equal [ Array(1) ]
AssertionError: expected undefined to deeply equal { id: StringMatching{…}, …(1) }
AssertionError: expected 'OpenVerify dev seed: created a new or…' to contain 'trust anchor  a1a1a1a1…'
 Tests  3 failed | 27 passed (30)
```

**GREEN** `17d33b04`: 30 passed. An unset `OPENVERIFY_MODE` resolves through `defaultAppMode(NODE_ENV)` as the API resolves it, so two existing settings cases that pass explicit environments now name `OPENVERIFY_MODE: 'development'`, as `.env.example`, compose and the e2e environment do.

## 12. Race tests (Testcontainers)

`48d453eb test(api): …` (`services/chip-challenges/chip-races.integration.test.ts`, `trust-anchors/sync-races.integration.test.ts`), written after the writers, so they never failed first. One assertion was wrong on its first run (an older list refused first never stores its extra anchor); it now accepts absent or withdrawn.

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/chip-challenges/chip-races.integration.test.ts src/trust-anchors/sync-races.integration.test.ts
 Test Files  2 passed (2)
      Tests  14 passed (14)      (run twice)
```

## 13. Final gates

```
$ pnpm --filter @openverify/api test
 Test Files  252 passed (252)
      Tests  3786 passed (3786)
Statements   : 96.94% ( 9667/9972 )
Branches     : 89.27% ( 5825/6525 )
Lines        : 96.95% ( 9372/9666 )
real	6m6.340s
$ pnpm --filter @openverify/db test
 Test Files  66 passed (66)
      Tests  844 passed (844)
Statements   : 98.72% ( 2326/2356 )
$ pnpm --filter @openverify/emrtd test
 Test Files  18 passed (18)
      Tests  307 passed (307)
Statements   : 94.95% ( 1299/1368 )
$ pnpm typecheck        Tasks: 13 successful, 13 total
$ pnpm lint             Tasks: 13 successful, 13 total
$ pnpm format:check     All matched files use Prettier code style!
```

```
$ pnpm test:integration
@openverify/api:test:integration:  Test Files  24 passed (24)
@openverify/api:test:integration:       Tests  122 passed (122)
@openverify/db:test:integration:  Test Files  11 passed (11)
@openverify/db:test:integration:       Tests  57 passed (57)
 Tasks:    2 successful, 2 total
real	2m19.228s
```

The full `pnpm e2e` takes longer than one foreground call, so, as `fixtures-5b` did, the e2e lock was held for the whole run by a background `flock /tmp/openverify-e2e.lock` holder while three foreground parts ran under it (the seed in each full-stack part runs this stage's `seed:dev`, sandbox anchor included):

```
$ pnpm turbo run build --filter=@openverify/e2e^... --filter=@openverify/flow^...
 Tasks:    6 successful, 6 total
$ pnpm --filter @openverify/flow e2e
  68 passed (31.9s)
$ pnpm --filter @openverify/e2e exec playwright test --shard=1/2
[e2e +14.8s] migrating and seeding the database
  31 passed (2.7m)
$ pnpm --filter @openverify/e2e exec playwright test --shard=2/2
  29 passed (7.6m)
```
