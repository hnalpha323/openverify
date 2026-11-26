# TDD evidence: Workflow 5A Stage 1b, `foundation` (Phase 5)

- **Slice owner:** the Workflow 5A Stage 1b `foundation` agent, running alone (it may touch any path its deliverables need).
- **Date:** 2026-10-22 and 2026-10-23.
- **Base:** `5b11009` (the end of Stage 1a); this stage's commits run from `df17719` to the commit that adds the last section of this file.
- **Input:** the "Stage 1b: foundation" bullet of `docs/plans/phase-5.plan.md` and the sections it names (C53, C54 in full, C63 for the 5A provider kinds), plus the hooks Stage 1a's amendments hand to Stage 1b. Decisions taken here are in the plan's "Workflow 5A Stage 1b amendments (foundation)".

Each change follows the same cycle:
1. A stub (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `feat` or `fix` commit), then a refactor with the suite green where one was worth making.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every name, number, address, code and key in these tests is synthetic.

## 1. Dependencies, added once (C55.8, C57.1, C58.7)

Commit `df17719` (chore, no behaviour). Added under `flock /tmp/openverify-pnpm.lock`:
- `packages/checks`: `libphonenumber-js` 1.13.14, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0, `@scure/base` 2.4.0, `@scure/btc-signer` 2.4.1 (catalog entries, exact); dev oracles `bitcoin-address-validation` 4.0.0 and `micro-eth-signer` 0.20.1.
- `apps/flow`: `libphonenumber-js` (catalog) for the phone step's calling codes and `/min` formatting.
- `e2e`: the four `@noble`/`@scure` packages, for the test signers.
- Root: `eslint-plugin-regexp` 3.3.1.

Release dates and licences were read from the registry (`pnpm view <name> time license`). One transitive package was too new: `jsdoc-type-pratt-parser` 9.3.0 (2026-10-19, under eslint-plugin-regexp's `^9.0.0`), so a `pnpm-workspace.yaml` override holds it at 9.2.2 (2026-09-17). No `minimumReleaseAgeExclude` entry was written; no package has an install script, so `allowBuilds` is unchanged.
```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile
✓ Lockfile passes supply-chain policies
Lockfile is up to date, resolution step is skipped
```

## 2. The 5A check folders (C54.4)

Stub `a82f3d0`: `packages/checks/src/{contact,crypto,matching,database}/index.ts`, each exporting its area name.
RED:
```
$ (cd packages/checks && pnpm exec vitest run src/index.test.ts --coverage.enabled=false)
 FAIL  src/index.test.ts > @openverify/checks entry point > re-exports everything the database folder exports
AssertionError: DATABASE_CHECKS_AREA: expected undefined to be 'database' // Object.is equality
      Tests  4 failed | 2 passed (6)
```
GREEN (`export * from` each folder's index in `src/index.ts`):
```
$ (cd packages/checks && pnpm exec vitest run src/index.test.ts --coverage.enabled=false)
      Tests  6 passed (6)
```

## 3. Data files, the CI data cache and the Node pin (C56, C62.9, C67, F15, F22)

Stub `0a47aee`: `data/manifest.json` pins `disposable_email_blocklist.conf` at commit `6fcca80a3fd4c4a5f7c364788f3b4812a8325754` (CC0, sha256 `e3bd7355…0f79`, 130,453 bytes, re-read from GitHub on 2026-10-22: `sha256sum` and `wc -c` of the raw file at that commit, `LICENSE.txt` is CC0 1.0); `scripts/fetch_data.py` with its interface only; `.gitignore` keeps `data/*` out but the two manifests.
RED:
```
$ (cd services/vision && uv run pytest tests/test_fetch_data.py -q --no-cov)
FAILED tests/test_fetch_data.py::test_missing_manifest_is_rejected - NotImple...
FAILED tests/test_fetch_data.py::test_downloads_verifies_and_is_idempotent - ...
FAILED tests/test_fetch_data.py::test_the_disposable_list_is_pinned_as_the_plan_records
36 failed in 1.51s
$ bash infra/tests/ci-workflow.test.sh
FAIL - e2e: the data cache keeps every file of data/manifest.json (not cached: ['data/disposable_email_blocklist.conf'])
FAIL - e2e: the data cache key hashes data/manifest.json
FAIL - e2e: fetches every data file in data/manifest.json (no --only list)
FAIL - e2e: the data cache is restored before the fetch
FAIL - e2e: the data files are fetched before the end-to-end tests run
FAIL - setup-pnpm: Node is pinned to the apps image's version (22.22.1) (22)
# 151 passed, 6 failed, 0 skipped
$ bash infra/tests/apps-image-context.test.sh
FAIL - the apps image context has data/manifest.json (the API reads it) (excluded by .dockerignore)
FAIL - the apps image context has data/malicious-feeds.json (the API reads it) (excluded by .dockerignore)
FAIL - the apps image context has data/disposable_email_blocklist.conf (the API reads it) (excluded by .dockerignore)
# 9 passed, 3 failed
```
GREEN: `scripts/fetch_data.py` (standard library only, as `fetch_models.py`: https only, the size cap, the digest checked before the file is moved into place, a reserved-name guard so no download replaces a manifest); the e2e job restores `data/*` from a cache keyed on the manifest, then runs `python3 scripts/fetch_data.py`; `setup-pnpm` defaults to Node `22.22.1`; `.dockerignore` re-includes the three data files.
```
$ (cd services/vision && uv run pytest tests/test_fetch_data.py -q --no-cov)
36 passed in 1.61s
$ (cd services/vision && uv run mypy --strict ../../scripts/fetch_data.py)
Success: no issues found in 1 source file
$ bash infra/tests/ci-workflow.test.sh
# 157 passed, 0 failed, 0 skipped
$ bash infra/tests/apps-image-context.test.sh
# 12 passed, 0 failed
$ python3 scripts/fetch_data.py && python3 scripts/fetch_data.py
disposable_email_domains: downloaded …/data/disposable_email_blocklist.conf (CC0-1.0)
disposable_email_domains: present …/data/disposable_email_blocklist.conf (CC0-1.0)
```

## 4. Migration 0017, the 5A repositories, sealing, indexes, `otpKey`, redaction (C53.2-C53.6, C54.4, C55.3)

Stubs `6d912a7` (the four repository files with their export lines and reads, the `otpc`/`cwc` prefixes, `otpDestinationIndex`, `cryptoAddressIndex`, `otpKey`) and `b19ed36` (`blind-index:rebuild` calls the new index rebuilds). The RED tests write rows with SQL seeders added to `@openverify/db/testing` (`seedVerificationInputs`, `seedOtpChallenge`, `seedOtpVerificationState`, `seedCryptoChallenge`), so no owner's write function is needed. The index and HKDF vectors were computed with OpenSSL 3.0.13 (`openssl dgst -sha256 -mac HMAC`, `openssl kdf … HKDF`). The table tests count only a refusal by an integrity constraint (SQLSTATE class 23), so a missing table cannot pass them.
RED:
```
$ (cd packages/db && pnpm exec vitest run src/phase5-tables.test.ts src/repositories/phase5-repositories.test.ts src/blind-index.test.ts src/crypto.test.ts src/migrate.test.ts src/schema-v2.test.ts src/repositories/key-rotation.test.ts src/repositories/redaction.test.ts --coverage.enabled=false)
     × creates the four Workflow 5A tables in 0017 and changes nothing else (C53.2)
     × matches the HMAC-SHA-256 vectors          Error: otpDestinationIndex is not implemented yet (2 arguments)
     × derives K_otp from the KEK the key id names   Error: otpKey is not implemented yet (2 arguments)
     × lists every encrypted column for the KEK rewrap
     × rewraps every encrypted column, resumably, leaving updated_at and plaintext alone
     × verification_inputs / otp_verification_states / otp_challenges / crypto_challenges
       AssertionError: verification_inputs exists: expected 0 to be greater than 0
     × keeps every row to the environment of its verification and inquiry   (failed with 42P01)
     × reads challenges newest first, the sent one, and opens a destination   (42P01: relation does not exist)
     × clears the Workflow 5A inputs, OTP destinations and wallet evidence of its verifications (C53.6)
$ (cd apps/api && pnpm exec vitest run src/blind-index-rebuild.test.ts src/services/redaction.test.ts --coverage.enabled=false)
     × re-indexes every unredacted OTP destination and wallet address under the new key
     × seeds every encrypted table except operator data
     × leaves nothing of the subject in any table or in storage
```
Test changed with the plan (C53.4): `blind-index-rebuild.test.ts` expects two more count lines (OTP destinations, wallet addresses) after the extractions' line, which is unchanged.
GREEN: the tables (`packages/db/src/tables/{verification-inputs,otp,crypto-challenges}.ts`), migration `0017_phase5_inputs_otp_crypto` from `drizzle-kit generate --name phase5_inputs_otp_crypto` plus a hand-added `updated_at` trigger per table that has one, `ENCRYPTED_COLUMNS` and `SEALED` (six sealed columns), `REWRAP_TABLES` (+3) and `ID_COLUMNS` (`verification_inputs` by `verification_id`), the two index functions (`HMAC(environment subkey, "<label>|…")`), `otpKey` (HKDF over the keyring's KEK), the repository reads, redaction (`redactInquiryRecords` calls the three new redactions) and the rebuilds; `blind-index:rebuild` prints one count line per index.
```
$ (cd packages/db && pnpm test)
 Test Files  56 passed (56)
      Tests  716 passed (716)
All files          |   98.71 |    91.89 |   99.35 |   98.65 |
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0017.integration.test.ts)
      Tests  4 passed (4)
$ (cd apps/api && pnpm exec vitest run src/blind-index-rebuild.test.ts src/services/redaction.test.ts src/kek-rewrap.test.ts --coverage.enabled=false)
      Tests  50 passed (50)
```
Two test edits during GREEN: my new 0017 statement check matched `ON UPDATE no action` and the triggers' `BEFORE UPDATE` with its first regex, so it now checks each statement's kind instead; and `testing.test.ts`'s list of every table gains the four (a test the plan changes, C53.2). `migration-0017.integration.test.ts` (Testcontainers: empty database, upgrade from 0016, two concurrent sends, redaction) confirms on Postgres 17 what the PGlite tests drove RED; it was written with the GREEN change.

## 5. The outbound HTTP client (C54.6, P07)

Stub `51bd8df`: `apps/api/src/http/index.ts` with the factory, client, request, response and `OutboundHttpError` codes.
RED (a loopback server answers; only a client created with `allowPrivateNetworks`, the EVM RPC's setting, may reach it; names resolve through an injected resolver):
```
$ (cd apps/api && pnpm exec vitest run src/http --coverage.enabled=false)
Error: createOutboundHttp is not implemented yet (1 options)
 FAIL  src/http/index.test.ts   Tests  14 skipped (14)   (the suite's beforeAll fails, so every case fails)
```
GREEN (one undici `Agent` per client, its `connect.lookup` the webhook guard's `createVettedLookup`; literal addresses vetted before connecting; non-2xx bodies drained and dropped; the body read chunk by chunk against the cap). undici 7's `request()` has no `maxRedirections` option and follows no redirect without its redirect interceptor, which this agent does not compose in; the 302 test holds that.
```
$ (cd apps/api && pnpm exec vitest run src/http)
      Tests  14 passed (14)
 index.ts |   95.83 |     83.6 |     100 |   95.65 |
```

## 6. The Workflow 5A ports, the mailer flag, the cache and the DNS resolver (C53.8, C54.3, C55.8)

The uncommitted work found at the resume (the mailer's `configured` flag and address objects, `ports.ts`, `providers/errors.ts`, the `sms`, `database` and `evm-rpc` provider folders, `cache/` and `dns/`, the rate-limit rule type and the fakes) was reviewed against the plan and kept: each piece matches C54.3, C55.7, C55.8, C55.10, C57.5 and C59.1. It was committed as the stub `7d7843d`, with the behaviour of `ProviderError.code` and `Mailer.configured` reset to stubs so the tests below fail first. `MailMessage.to` became `{ address }` (C55.8), so the mail, invitation, users and fakes tests that build or read a message follow the type (a test the plan changes).

RED (`0f6f41b`):
```
$ (cd apps/api && pnpm exec vitest run src/mail/index.test.ts src/providers --coverage.enabled=false)
 FAIL  src/mail/index.test.ts > createMailer > says whether an SMTP server is configured, so the OTP channel guard can read it (C54.3)
AssertionError: expected false to be true // Object.is equality
 FAIL  src/providers/errors.test.ts > ProviderError (C53.8) > carries the code it is given and whether a retry can help, with its fixed message
      Tests  2 failed | 68 passed (70)
$ (cd apps/api && pnpm exec vitest run src/cache src/dns --coverage.enabled=false)
 FAIL  src/cache/index.test.ts > createKeyValueCache (C54.3) > stores a value with its TTL and reads it back; a missing key reads null
Error: createKeyValueCache is not implemented yet (1 options)
     × turns ENOTFOUND into a not_found failure that never names the host
      Tests  17 failed (17)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/cache)
Error: createKeyValueCache is not implemented yet (1 options)
      Tests  2 failed (2)
```
GREEN (`356cda4`): `configured: true` with an SMTP URL; `ProviderError` keeps `options.code` (default `provider_error`); the cache checks its `openverify:` key namespace and whole positive TTLs and sizes, rejects at once while ioredis reports Valkey down, and pushes, trims and expires a capped list in one MULTI; the resolver is `new Resolver({ timeout: 3000, tries: 2 })` and maps `ENOTFOUND`, `ENODATA`, `ETIMEOUT`, `ESERVFAIL`, `EREFUSED` to its own codes (anything else `failed`) in a fresh error without a cause, so the host never leaves it.
```
$ (cd apps/api && pnpm exec vitest run src/mail src/providers src/cache src/dns)
      Tests  93 passed (93)
Statements   : 99.41% ( 170/171 )   Branches : 98.24% ( 112/114 )
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/cache)
      Tests  2 passed (2)
```

## 7. Phase 5 problems as a route throws them (C52.7, C55.7)

Builders throw `Phase5ProblemError(code, detail, { members?, headers?, storeUnavailable?, errors? })` (`apps/api/src/errors.ts`); its status comes from `PHASE5_PROBLEM_STATUSES`. Stub `3509714`; RED `b0eef7b` (`src/phase5-problems.test.ts` registers one route per golden problem in `contracts/fixtures/problems/flow/`, documenting its status with `problemResponses`, and compares the answer with the fixture):
```
$ (cd apps/api && pnpm exec vitest run src/phase5-problems.test.ts --coverage.enabled=false)
     × answers otp_incorrect exactly as its golden problem
-   "attempts-remaining": 4,
-   "title": "Unprocessable Content",
+   "title": "Unprocessable Entity",
     × answers otp_rate_limited with 503 while the limit store is down
      Tests  11 failed | 14 passed (25)
```
GREEN: `AppError` gains `members` (RFC 9457 §3.2 extension members), which `problem-details.ts` writes before the standard members so none is replaced; a 422 is titled "Unprocessable Content" (RFC 9110), as `UnprocessableContentError` is; `storeUnavailable` gives 503 for `otp_rate_limited` only (a `RangeError` for any other code).
```
$ (cd apps/api && pnpm exec vitest run src/phase5-problems.test.ts src/problem-details.test.ts src/errors.test.ts --coverage.enabled=false)
      Tests  72 passed (72)
```

## 8. Log keys and the Phase 5 lint rules (C53.8, C58.7)

Stub `5d7c723`: `PERSONAL_LOG_KEYS` in `apps/api/src/logger.ts` (not yet redacted) and `packages/config/eslint/phase5-rules.js` (`PHASE5_FOLDERS`, `REDACTED_PERSONAL_LOG_KEYS`, `phase5Config()` returning no rule), exported as `@openverify/config/eslint-phase5` and spread into the root `eslint.config.js`. RED `aaa3e33`:
```
$ (cd apps/api && pnpm exec vitest run src/logger.test.ts src/jobs/logger.test.ts --coverage.enabled=false)
     × redacts otpCode at depth 0
     × redacts otpDestination at depth 1
     × redacts challengeMessage at depth 2   (… every name at every depth)
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)
     × refuses a personal name in a log call in a Phase 5 folder: { phoneNumber: '+15555550100' }
     × refuses super-linear regular expressions in the matching folders
     × is part of the root ESLint configuration for exactly the Phase 5 folders
      Tests  11 failed | 12 passed (23)
```
The rules are tested with ESLint's `Linter` on synthetic code: the type-aware root config refuses files that are not on disk (probed: "Parsing error … was not found by the project service"), and these rules need no types. GREEN: the eight names join `REDACT_PATHS` at depth 0–2 and the worker's `SENSITIVE_KEYS` (depth 0–3); `code`, `message`, `values`, `destination` and `inputs` are not redacted, so `err.message` and `err.code` stay (tested). The lint config refuses, in `PHASE5_FOLDERS`, a log-call property (identifier or string key, at any depth, except under `pii`) matching `REFUSED_LOG_KEY_PATTERN` (contact details, `code`, `otp`, messages, signatures, entered values, addresses, names, birthdates, document and registration numbers, chip data groups, portraits, URLs, hosts, domains), and enables eslint-plugin-regexp's recommended rules with `no-super-linear-backtracking` and `no-super-linear-move` as errors.
```
$ (cd packages/config && pnpm test)
      Tests  68 passed (68)
$ (cd apps/api && pnpm exec vitest run src/logger.test.ts src/jobs/logger.test.ts --coverage.enabled=false)
      Tests  66 passed (66)
$ pnpm exec eslint apps/api/src/http apps/api/src/cache apps/api/src/dns apps/api/src/providers packages/checks/src/{contact,crypto,matching,database}
(no problems)
```

## 9. The masking lists (C53.7)

RED `ea1a17a`:
```
$ (cd apps/api && pnpm exec vitest run src/auth/pii.test.ts src/services/api-logs.test.ts --coverage.enabled=false)
     × names every attribute the contracts mark PII in the masked list
AssertionError: expected [ 'fields', 'note', …(22) ] to deeply equal ArrayContaining{…}
     × hides each of them from a user without pii:view, fields member-wise, and nothing else
AssertionError: phone-number: expected 'synthetic-phone-number' to be null
     × nulls every Phase 5 PII attribute of a resource in data, included and event payloads, and keeps the others (C53.7)
      Tests  3 failed | 38 passed (41)
```
GREEN: `MASKED_ATTRIBUTES` (`auth/pii.ts`) and the API-log masked set (`services/api-logs.ts`) are the C15 names, the C31.5 extraction and `PII_VERIFICATION_ATTRIBUTES`; `fields` stays member-wise, `associated-persons` and any other nested PII member are nulled whole.
```
$ (cd apps/api && pnpm exec vitest run src/auth src/services/api-logs.test.ts src/routes/server/api-logs.test.ts src/routes/server/events.test.ts src/routes/server/verifications.test.ts src/routes/dashboard/inquiries.test.ts --coverage.enabled=false)
      Tests  118 passed (118)
```
The per-exit tests for every type follow the attribute hooks (section on hooks).

## 10. Provider kinds per process and the new variables (C55.7, C55.10, C57.5, C63, V10, P25)

Stub `5bcfb9d`: `PHASE5A_PROVIDER_KINDS` (`sms`, `database`, `evmRpc`), `PROVIDER_NAMES_BY_KIND`, `PROCESS_PROVIDER_KINDS`, `ProviderBindingOptions`; `ApiConfig` gains `process`, `twilio`, `evmRpc`, `otpSmsMaxPerHourCeiling` (`loadConfig(env, { process })`), all still unread. The tests that list every kind gain the three (a change the plan makes). RED `398a0d0` (the C35 and C44 binding tests now read the worker configuration, which the plan gives those kinds):
```
$ (cd apps/api && pnpm exec vitest run src/providers/index.test.ts --coverage.enabled=false)
     × reads only the kinds each process uses: the API sms, database and aamva, the worker every other
     × refuses OPENVERIFY_PROVIDER_SMS_SANDBOX=vendor-secret-1 without echoing the value
     × binds the SMS sender, the database and the EVM RPC per environment kind, real ones in production
      Tests  10 failed | 16 passed (26)
$ (cd apps/api && pnpm exec vitest run src/config.test.ts --coverage.enabled=false)
     × stops the API naming each missing credential
     × refuses malformed credentials and both senders, without echoing any value
     × stops the worker without URLs, and with malformed or repeated entries, echoing none
     × defaults to 1,000 and reads a whole number from 1 to 1,000,000
      Tests  20 failed | 60 passed (80)
```
The first RED commit was blocked by the gitleaks hook (two `generic-api-key` findings on the synthetic Twilio secrets); the values were reworded to `'s'.repeat(40)`, never ignored.

GREEN: `readProviderSettings(env, process)` reads `PROCESS_PROVIDER_KINDS[process]`; a value outside the kind's names answers `must be twilio or sandbox, or unset` (or the single-name message), `sandbox` on a production variable is refused, a real name may bind production; `createProviderBindings` checks each kind's names, binds `sms`, `database` and `evmRpc` through their factories and refuses `twilio` or `json-rpc` without credentials. `loadConfig` reads the Twilio credentials in the API process while `sms` is `twilio` (SIDs checked by prefix and length, the secret at least 32 characters and on the production placeholder list, exactly one of the messaging service SID and `from`), the EVM RPC URLs in the worker while `evmRpc` is `json-rpc` (`eip155:<n>=https://…`, http only with `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`, no credentials in the authority, no repeated chain; issues name the entry, never its value), and `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING` (1–1,000,000, default 1,000). The worker's `main` loads `{ process: 'worker' }`.
```
$ (cd apps/api && pnpm exec vitest run src/providers src/config.test.ts --coverage.enabled=false)
      Tests  156 passed (156)
$ (cd apps/api && pnpm exec vitest run src/worker.test.ts src/server.test.ts src/container.test.ts src/openapi.test.ts --coverage.enabled=false)
      Tests  64 passed (64)
```

## 11. The C54.3 wiring

Stub `343273e`: `ApiDependencies` gains `providers`, `blindIndexKey`, `cache`, `outboundHttp` and `otpSmsMaxPerHourCeiling` (`dependenciesOf` passes them on, so its key-list test follows the type); the worker's `ProcessVerificationDeps` and `StartWorkersOptions` gain `cache`, `outboundHttp`, `dnsResolver`, `rateLimiter` and the verification queue (unpassed); test fakes `createInMemoryKeyValueCache`, `createFakeDnsResolver`, `createRefusingOutboundHttp` (stubs) and `phase5TestDependencies`, which every hand-built `ApiDependencies` in the integration tests spreads. RED `104a7ee`:
```
$ (cd apps/api && pnpm exec vitest run src/worker.test.ts src/container.test.ts src/test-support/fakes.test.ts --coverage.enabled=false)
     × binds the API process providers from the configuration (C54.3, C63)
     × closes the key-value cache and the outbound client with the rest (C54.3)
     × reads what it stored until the TTL passes on the test clock
     × answers from its zones only and records each query
     × refuses every request as blocked and records it, so no test reaches the network
     × gives the verification job the cache, outbound client, DNS resolver, limiter and queue (C54.3, C59.6)
      Tests  8 failed | 58 passed (66)
```
GREEN: `createContainer` builds `createProviderBindings(config.providers, { clock, twilio, outboundHttp, cache })`, a cache on its own lazy Valkey client and the outbound factory, and closes both; the worker's `main` builds the cache, the outbound factory, `createDnsResolver()`, a GCRA limiter on its own client and a verification queue, binds its providers with the EVM RPC settings, passes all of them to the verification job and closes them; the fakes share the real cache's key and size checks (`checkKey`, `checkCount`).
```
$ (cd apps/api && pnpm exec vitest run src/worker.test.ts src/container.test.ts src/test-support src/services/context.test.ts --coverage.enabled=false)
      Tests  85 passed (85)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/worker.integration.test.ts)
      Tests  7 passed (7)
```

## 12. The job hooks and the settlement (C50.5, C54.1, C59.6)

Refactor `ce09388` (behaviour-preserving, the existing suites as the safety net): `jobs/types/index.ts` defines `VerificationTypeJob<State>` (`evaluate`, `persistInDecisionTx(tx, ctx)`, `afterCommit?`, `onProcessingFailed(tx, ctx)`, `onInquiryVerificationDecided?(tx, ctx)`) and `VERIFICATION_TYPE_JOBS`, one file per type; `jobs/types/government-id.ts` and `selfie.ts` hold the Phase 3 and 4 jobs unchanged (the C11 thresholds moved to `jobs/thresholds.ts`); the nine Phase 5 files are `unbuiltTypeJob` stubs (`runnable: false`, so the flow refuses to create them and the job to judge them, replacing `RUNNABLE_VERIFICATION_TYPES`); `settleInquiry` moved to `services/inquiry-settlement.ts`. `persistInDecisionTx` stages the verification event itself (`ctx.verificationEvent()`) where its payload must see the type's rows, so the government ID writes its extraction first and the selfie stages `selfie.processed` after it, as before.
```
$ (cd apps/api && pnpm exec vitest run src/jobs src/worker.test.ts src/routes/flow src/services --coverage.enabled=false)
      Tests  714 passed (714)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs)
      Tests  13 passed (13)
```
RED `bfc8695` (`jobs/type-hooks.test.ts` replaces the `document` and `aamva` modules with recording jobs through `vi.mock`; `services/inquiry-settlement.test.ts` binds a skipped AAMVA attempt to a passed ID through `verification_inputs`):
```
$ (cd apps/api && pnpm exec vitest run src/jobs/type-hooks.test.ts src/services/inquiry-settlement.test.ts --coverage.enabled=false)
     × evaluates with the type job, persists in the decision transaction, then runs afterCommit
AssertionError: expected [] to deeply equal [ { status: 'passed', …(1) } ]
     × runs every type decision hook in the decision transaction, after the verification event, and enqueues its jobs after commit
AssertionError: expected [] to deeply equal [ { type: 'document', …(2) } ]
     × runs on a verification failed because its processing cannot finish
     × completes once the attempt bound to the decided ID is done, reading its source
AssertionError: expected 'pending' to be 'completed' // Object.is equality
```
GREEN: after `persistInDecisionTx`, a decided verification (and one failed after an error) runs every type's `onInquiryVerificationDecided` in the same transaction; their events are dispatched after the decision's and their jobs enqueued on `deps.queue` after commit (a failed enqueue is logged with ids only); `afterCommit` runs after dispatch; `settleInquiry` reads `listVerificationInputSources` for the AAMVA attempts and passes `sourceVerificationId`. The RED test's marker event had a payload the event publisher refuses, which the RED run never reached; it is now a `verification.created` event of the decided verification.
```
$ (cd apps/api && pnpm exec vitest run src/jobs src/worker.test.ts src/services --coverage.enabled=false)
      Tests  539 passed (539)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs src/worker.integration.test.ts)
      Tests  20 passed (20)
```

## 13. The attribute hooks and the masking test per exit (C52.8, C53.7, C54.1)

Stub `2e87947`: `services/attributes/index.ts` (`VerificationAttributeHook { load(db, verification), mask(attributes, piiMask) }`, `VERIFICATION_ATTRIBUTE_HOOKS`, `attributeHookFor`, `loadVerificationAttributes`, `loadVerificationAttributesOf`) and one `unbuiltAttributeHook()` per Phase 5 type (loads `{}`, masks with the C53.7 list). RED `0116751`: `src/phase5-masking.test.ts` and `routes/dashboard/phase5-masking.test.ts` mock each type's attribute module to load its golden fixture's attributes (`test-support/phase5-attributes.ts`) and check, per type, every exit for a principal with `pii:view` (an API key, a reviewer) and one without (a viewer):
```
$ (cd apps/api && pnpm exec vitest run src/phase5-masking.test.ts src/routes/dashboard/phase5-masking.test.ts --coverage.enabled=false)
AssertionError: expected {} to deeply equal { 'name-first': 'Avery', …(12) }
AssertionError: expected {} to deeply equal { 'phone-number': null, …(3) }
      Tests  36 failed | 9 passed (45)        (server exits)
      Tests  18 failed (18)                   (dashboard inquiry document)
```
GREEN: `verificationResource` and the dashboard's `toVerificationResource` take the loaded attributes and mask them through the type's hook (`maskedTypeAttributes`), then the C53.7 list; `getVerificationDocument`, `getInquiryDocument`, the dashboard inquiry route, `stageVerificationEvent` (every `verification.*` the worker and cancel paths stage) and the flow's `verification.created` and `verification.submitted` load them (`verificationRecordOf` carries them). Two test fixes during GREEN: the mock factories referenced a top-level helper, which vitest's hoisted mocks reach before it exists once an exit imports the hooks (it is now `vi.hoisted`), and single-letter values (`sex: "X"`) are left out of the serialized-body search.
```
$ (cd apps/api && pnpm exec vitest run src/phase5-masking.test.ts src/routes/dashboard/phase5-masking.test.ts --coverage.enabled=false)
      Tests  63 passed (63)
$ (cd apps/api && pnpm exec vitest run src/services src/routes src/jobs --coverage.enabled=false)
      Tests  1435 passed (1435)
```

## 14. The guidance hooks (C52.2, C54.1)

Stub `d016ef8`: `services/guidance/index.ts` (`VerificationGuidanceHook { flowAttributes(ctx) }` over `{ deps, db, verification, step, config }`, `VERIFICATION_GUIDANCE_HOOKS`, `guidanceHookFor`) and one `unbuiltGuidanceHook()` (`{ guidance: null }`) per Phase 5 type. RED `d862499` (`routes/flow/phase5-guidance.test.ts`, the phone hook mocked to record its context):
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/phase5-guidance.test.ts --coverage.enabled=false)
AssertionError: expected { status: 'initiated', …(3) } to match object { guidance: { …(3) } }
      Tests  2 failed (2)
```
GREEN: `flowVerificationResource(deps, db, row, step, config)` (`services/resources.ts`) is async and adds the hook's attributes; `services/flow.ts` builds every flow view (session, create, submit, poll) from the pinned version (`stepForVerificationType`, the type's parsed configuration).
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow src/services --coverage.enabled=false)
      Tests  349 passed (349)
```

## 15. The flow preconditions (C52.1, C54.1)

Stub `283894a`: `services/flow-preconditions.ts` takes `openInquiry`, `assertInquiryOpenUnderLock` and `sessionVerification` from `services/flow.ts` (moved unchanged, now exported) and stubs `requireFlowVerification(deps, session, id, { types, statuses, consent })` and `requireFlowVerificationUnderLock(tx, session, id, statuses)`. RED `928a445`:
```
$ (cd apps/api && pnpm exec vitest run src/services/flow-preconditions.test.ts --coverage.enabled=false)
     × answers 404 for a verification of another inquiry or environment
     × answers 410 once the inquiry was redacted and 409 once it is finished
     × answers 422 for a route of another type
     × answers 409 outside the statuses the route acts on, initiated by default
     × answers 409 without consent, unless the route needs none
     × answers 409 when the verification moved on, or the inquiry closed, meanwhile
      Tests  6 failed | 2 passed (8)
```
GREEN `04c755b`: the checks in the C52.1 order (404, 410, 409 finished, 422 type, 409 status, 409 consent); the locked variant locks the inquiry (re-checked open, unredacted), then the verification (re-checked in `statuses`).
```
$ (cd apps/api && pnpm exec vitest run src/services/flow-preconditions.test.ts src/routes/flow --coverage.enabled=false)
      Tests  194 passed (194)
```

## 16. The submit guards (C52.6, C54.1)

Refactor `23716ad`: `services/submit/index.ts` defines `SubmitGuard { submittableStatuses, checkBody(ctx), inTransaction(ctx), repeat(ctx) }` and `SUBMIT_GUARDS`; `submitVerification` dispatches to the guard of the verification's type; the government ID (`standardSubmitGuard()`, its required files) and the selfie (capture checks, consumption, `selfie.submitted`, the repeat rule) moved behind it unchanged; the nine Phase 5 guards start as the standard guard.
```
$ (cd apps/api && pnpm exec vitest run src/services/submit src/routes/flow --coverage.enabled=false)
      Tests  188 passed (188)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/selfie-capture-races.integration.test.ts src/services/locks.integration.test.ts)
      Tests  17 passed (17)
```
RED `f9349ed` (`routes/flow/phase5-submit.test.ts`, verifications seeded of each type in the Phase 5 template):
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/phase5-submit.test.ts --coverage.enabled=false)
     × needs a database verification entered values (409 inputs_required), then submits it
     × refuses a client submit of a silent AAMVA attempt (409 verification_created_by_server)
     × needs a chip read SOD, DG1 and DG2
     × submits a phone_number verification whose code was confirmed
      Tests  7 failed | 5 passed (12)
```
GREEN: each Phase 5 guard takes its options (`member: 'crypto' | 'chip'`, `inputs: true` for database, AAMVA form, database-business and business-website, `statuses: ['initiated', 'confirmed']` for phone and email) and the AAMVA guard refuses a silent step's submit first (`assertNotCreatedByServer`).
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow src/services/submit --coverage.enabled=false)
      Tests  200 passed (200)
```

## 17. Creation rules and uploads per kind (C50.7, C52.2, C52.4)

RED `de44213` (`routes/flow/phase5-create-upload.test.ts`):
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/phase5-create-upload.test.ts --coverage.enabled=false)
     × answers 409 verification_created_by_server for a silent AAMVA step
     × answers 409 when the type latest attempt was skipped
     × returns an open confirmed attempt instead of creating another
     × takes a PDF for a document, typed by its content
     × takes a chip file whose content is one TLV of its tag, and refuses one that is not
     × answers 413 for a chip file over its 64 KiB cap
      Tests  6 failed | 1 passed (7)
```
GREEN `500b728`: `createFlowVerification` refuses a silent AAMVA step first (`assertNotCreatedByServer`), answers 409 when the type's latest attempt is `skipped`, and returns an open `initiated` or `confirmed` attempt; `uploadFile` caps by `maxUploadBytes(kind)` (`PayloadTooLargeError`, 413) and types by `detectUploadMimeType(kind, bytes)` (415 with a message per kind family); the file resources parse stored types with `acceptedUploadMimeTypeSchema` (the Stage 1a hand-over).
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow src/services src/routes/dashboard --coverage.enabled=false)
      Tests  536 passed (536)
```

## 18. The cancel hooks (C50.7, C54.1)

Refactor `5aa1b8b`: `services/sub-resources/index.ts` (`SubResourceHook.onVerificationCanceled(tx, events, verification) → { staged, storageKeys }`, `SUB_RESOURCE_HOOKS`, `cancelSubResources`), the selfie's open-capture cancel behind `sub-resources/selfie.ts` unchanged, no-op hooks for the other types; `cancelInitiatedVerifications` calls the hook of each verification it cancels.
```
$ (cd apps/api && pnpm exec vitest run src/services src/routes src/jobs --coverage.enabled=false)
      Tests  1470 passed (1470)
```
RED `faeb109` (`services/cancel-confirmed.test.ts`, the phone hook recording):
```
     × expiring an inquiry cancels its confirmed verification through its type hook
AssertionError: expected 'confirmed' to be 'canceled' // Object.is equality
```
GREEN `6fd3fa1`: the cancel path takes `initiated` and `confirmed` verifications.
```
      Tests  1471 passed (1471)
```

## 19. The publish hooks (C50.4, C54.1)

Stub `281f345`: `services/publish/index.ts` (`PublishHook.problems(ctx) → PublishHookProblem[]` with `code`, `pointer`, `detail`; `PUBLISH_HOOKS`; `publishHookProblems`, which asks each type whose step the flow holds once, in step order) and a no-rule hook per Phase 5 type. RED `c36d65a` (`routes/server/phase5-publish.test.ts`, the phone hook replaced):
```
$ (cd apps/api && pnpm exec vitest run src/routes/server/phase5-publish.test.ts --coverage.enabled=false)
     × runs the hook of each type the flow holds and answers its problem with its code and pointer
AssertionError: expected 201 to be 422 // Object.is equality
     × publishes a draft only once its hooks find nothing
AssertionError: expected 200 to be 422 // Object.is equality
```
GREEN: `assertPublishable(deps, db, environmentId, flow, config)` is async; after the C42.3 and C50.4 pure rules it reads the environment and answers the hooks' first code as a `Phase5ProblemError` 422 with an `errors[]` pointer per problem under `/data/attributes`; it runs on create and, in the publishing transaction, on publish.
```
$ (cd apps/api && pnpm exec vitest run src/routes/server src/services --coverage.enabled=false)
      Tests  759 passed (759)
```

## 20. Server-written files (C52.4, C54.1)

Stub `98fd76d`, RED `7b2bc82`:
```
$ (cd packages/db && pnpm exec vitest run src/repositories/files.test.ts --coverage.enabled=false)
     × stores a server-written file whatever the status, replacing the kind earlier one
     × refuses a kind a client uploads
      Tests  2 failed | 7 passed (9)
$ (cd apps/api && pnpm exec vitest run src/services/server-files.test.ts --coverage.enabled=false)
     × seals the PNG under a new key and writes its row while the verification is processed
     × replaces the kind earlier file on a re-run and returns its object to delete
     × refuses bytes that are not a PNG
      Tests  3 failed (3)
```
GREEN: `replaceServerWrittenFile(db, environmentId, input)` refuses a client kind (`RangeError`) and, in one transaction, deletes the kind's earlier rows and inserts the new one, whatever the verification's status; `storeServerFile(tx, { storage, keyring }, { environmentId, verificationId, kind, bytes })` types the bytes (`detectUploadMimeType`: a PNG), seals them with the file id as context, puts the object under a new key, writes the row and returns the replaced objects' keys.
```
      Tests  9 passed (9)   (db)
      Tests  3 passed (3)   (api)
```

## 21. The frozen route schemas, the C52.1 contract and the sandbox sink (C52.1, C54.2, C55.11)

Stub `20b8d70`: the routes with their final params, bodies, responses and problems and a 501 handler, each in its builder's file and registered by the shared plugins:

| Route | File | Body | Answer | Problems |
|---|---|---|---|---|
| `POST /flow/verifications/:id/inputs` | `routes/flow/inputs.ts` | `flowInputsBodySchema` | 200 `flowVerificationDocumentSchema` | 400 401 404 409 410 422 |
| `POST /flow/verifications/:id/otp` | `routes/flow/otp.ts` | `flowOtpSendBodySchema` | 200 `flowVerificationDocumentSchema` | 400 401 404 409 410 422 429 502 503 |
| `POST /flow/verifications/:id/otp/confirm` | `routes/flow/otp.ts` | `flowOtpConfirmBodySchema` | 200 `flowVerificationDocumentSchema` | 400 401 404 409 410 422 429 503 |
| `POST /flow/verifications/:id/crypto-challenges` | `routes/flow/crypto-wallet.ts` | `createCryptoChallengeBodySchema` | 201 `flowCryptoChallengeResponseSchema` | 400 401 404 409 410 422 |
| `POST /flow/verifications/:id/chip-challenges` | `routes/flow/government-id-nfc.ts` | `createChipChallengeBodySchema` | 201 `flowChipChallengeResponseSchema` | 400 401 404 409 410 422 |
| `POST /sandbox/sms-messages/search` (`sandbox:read`) | `routes/server/sandbox-sms.ts` | `sandboxSmsSearchBodySchema` | 200 `sandboxSmsSearchResponseSchema` | 400 401 403 404 |

The sink is registered by `app.ts` only when `servesSandboxSmsSink(mode, providers)` (the sandbox sender bound, not production mode) and answers 404 to a production environment's key. `openapi.test.ts` builds its container with the sandbox sender bound so the snapshot documents the sink (a test the plan changes, C55.11); the snapshot was regenerated.

RED `eaf2edb` (`routes/flow/verification-mutations.contract.test.ts` lists every `POST /api/v1/flow/verifications/{id}/*` of `/openapi.json` with a valid body, and fails a route it does not know):
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/verification-mutations.contract.test.ts --coverage.enabled=false)
      Tests  20 failed | 12 passed (32)     (the five new routes answer 501 before any precondition)
```
GREEN `a976a29`: each new route calls `requireFlowVerification` with its types and statuses first (OTP: `initiated` or `confirmed`, so the handler can answer `otp_already_confirmed`).
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow --coverage.enabled=false)
      Tests  237 passed (237)
```
`src/sandbox-sms-sink.test.ts` (`5335ee3`) pins the sink's wiring, which the stub carried, after the fact: served only bound and outside production mode, 404 for a production key, 403 without `sandbox:read`, no request log line with the number. RED `2af4353` / GREEN `272c9fb`: stored API logs mask a `phone-number` or `email-address` member at any depth for readers without `pii:view`, since these request bodies carry them outside a resource.

## 22. The OTP settings (C55.7, V08)

RED `d797da0` (`routes/dashboard/settings.test.ts`):
```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/settings.test.ts --coverage.enabled=false)
     × serves the budget, 200 per hour by default, and when it last tripped, never by default
     × sets the budget on the environment and audits it
     × refuses a budget above the install ceiling with 422, changing nothing
     × serves the time of the latest budget trip from the audit log
      Tests  4 failed | 13 passed (17)
```
GREEN `f7e23a9`: `EnvironmentSettings['otp-sms-max-per-hour']` and `resolveOtpSmsMaxPerHour` (default 200) and `latestAuditLogAt(db, environmentId, action)` in `packages/db`; `getDashboardSettings(db, ctx, ceiling)` serves the budget (at most the ceiling) and `otp-sms-budget-tripped-at`; `updateDashboardSettings(…, ceiling)` refuses a budget above it (422, pointer `/otp-sms-max-per-hour`) before writing; `AdminRouteContext.otpSmsMaxPerHourCeiling` comes from `ApiDependencies`; the PATCH documents 422. Two settings tests that compared GET and PATCH with `DASHBOARD_SETTINGS_DEFAULTS` now add `OTP_SETTINGS_DEFAULTS` (Stage 1a's hand-over). The db audit test's first action name broke the action-format constraint and was renamed during GREEN.
```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard src/container.test.ts --coverage.enabled=false)
      Tests  176 passed (176)
$ (cd packages/db && pnpm exec vitest run src/repositories/audit-logs.test.ts src/repositories/face-template-settings.test.ts --coverage.enabled=false)
      Tests  7 passed (7)
```

## 23. The dashboard file content schema (C52.4, C54.2)

RED `f77940e` (`openapi.test.ts`):
```
     × documents an image, the PNG previews among them, or a PDF attachment, each as binary
AssertionError: expected [ 'image/jpeg', 'image/png', …(1) ] to deeply equal [ 'application/pdf', …(3) ]
```
GREEN `42f7c64`: the route's 200 lists the images and `application/pdf` (served as an attachment with a server-generated name, which `api-document` builds in 5B), the dashboard swagger transform marks PDF responses binary too, and the snapshot was regenerated. That commit left `routes/dashboard/index.test.ts` asserting the image types only, which the frozen schema changes; it was updated in `e77f93b` (a test the plan changes).
```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard src/openapi.test.ts --coverage.enabled=false)
      Tests  175 passed (175)
```

## 24. The proxy warning at startup (C55.7)

Stub `fa695e6`, RED `694605f`:
```
$ (cd apps/api && pnpm exec vitest run src/server.test.ts --coverage.enabled=false)
     × warns once that per-IP OTP limits key on the proxy address with an SMS sender and no proxy trust
     × says nothing without an SMS sender or with proxy trust set
```
GREEN `7821168`: `startupWarnings(config, providers)` returns the warning when either environment kind binds an SMS sender and `trustProxy` is false; `startServer` logs each once before listening.
```
      Tests  12 passed (12)
```

## 25. The dashboard generic view, the evidence table and the reason-word modules (C54.5)

Stub `eadc57a`: `components/evidence/generic.tsx` (`GenericEvidence`, `EvidenceProps`, `EvidenceState`, `Phase5Verification`), `components/evidence/index.ts` (`EVIDENCE_COMPONENTS`, `isPhase5Verification`, `VerificationEvidence`), one placeholder per type (`components/evidence/<api-type>.tsx` re-exporting the generic view), `lib/reason-words/<api-type>.ts` (empty, typed `ReasonWords`), `lib/reason-words/index.ts` (`PHASE5_REASON_WORDS`, `typeReasonText`) and `reasonText(code, checkName?)`. An earlier attempt at this stub wrote two files through a shell here-document that consumed the wrong block; those files were rewritten before the commit, so nothing of it was committed.
RED `0de069f` (`testing/phase5-fixtures.ts` reads the golden API fixtures from `contracts/fixtures/api/`; a first run failed on `ENOENT` because Vite rewrites `new URL(…, import.meta.url)` into an asset URL, so the helper joins a file path instead):
```
$ (cd apps/dashboard && pnpm exec vitest run src/components/evidence src/lib/reason-words src/components/verification-card.test.tsx 'src/app/verifications/[id]/page.test.tsx' src/components/lifecycle/inquiry-timeline.test.tsx src/components/lifecycle/verification-config-pointers.test.ts --coverage.enabled=false)
 ❯ src/components/lifecycle/verification-config-pointers.test.ts (34 tests | 14 failed)
 ❯ src/components/evidence/generic.test.tsx (17 tests | 17 failed)
 ❯ src/components/evidence/index.test.tsx (21 tests | 10 failed)
 ❯ src/lib/reason-words/lookup.test.tsx (4 tests | 2 failed)
 ❯ src/components/lifecycle/inquiry-timeline.test.tsx (17 tests | 9 failed)
 ❯ src/components/verification-card.test.tsx (17 tests | 3 failed)
 ❯ src/app/verifications/[id]/page.test.tsx (59 tests | 29 failed)
     19 × Unable to find an accessible element with the role "region" and name "Evidence"
      × AssertionError: expected [ 'Checks', 'Images' ] to deeply equal [ 'Checks', 'Evidence', 'Files' ]
      × Unable to find an accessible element with the role "link" and name "AAMVA verification passed"
      × AssertionError: expected undefined to be 'Crypto wallet, allowed chains, entry 1'
      × AssertionError: expected undefined to deeply equal { words: 'No record found', …(1) }
      Tests  84 failed | 95 passed (179)
```
GREEN `b42344f`:
- `GenericEvidence` lists every type attribute in the API's order inside a group named "<title> evidence", each named in words (`registry-record-id` is "Registry record ID"); a PII attribute (from `PII_VERIFICATION_ATTRIBUTES`) that the API nulled reads "Hidden" (with the `pii:view` explanation) or, after a redaction, "Redacted"; objects list their members and lists their entries, masked member-wise like the API; a type that recorded nothing says so. It is a server component and reads only the verification answer.
- `VerificationCard` and `VerificationView` show an "Evidence" section for a Phase 5 type through `VerificationEvidence`, and name a file that is not an image (a PDF document, a chip file) by kind, media type and ID (`components/verification-file.tsx`: `isImageFile`, `NonImageFile`); a government ID keeps its "Images" section.
- The timeline names an event of every type in `VERIFICATION_RESOURCE_TYPES`; `describeConfigPointer` names every API type and the options `allowed-chains` and `accept-review-without-provider`.
- `typeReasonText(code, checkName)` finds the check's type through the registry and reads that type's module (own properties only); `CheckResults` passes each check's name, in the table and in the review note.
Two RED tests were wrong and were corrected with the GREEN commit (noted in its message): the review-note case used a failed check, which never sends a verification to review (C30.4), and `piiValuesOf` now leaves out digit runs under eight characters (the postal code `00000` is in every ID on the page).
```
$ (cd apps/dashboard && pnpm test)
 Test Files  183 passed (183)
      Tests  1946 passed (1946)
All files          |   98.56 |    94.62 |   98.87 |   98.56 |
 ...nents/evidence |     100 |     90.9 |     100 |     100 |
```

## 26. `.env.example` and the split compose environment (C63, P25)

RED `b8e606c` (`infra/tests/compose.test.sh`): `.env.example` declares every provider kind's two bindings, the Twilio, EVM RPC and OTP ceiling variables, binds no provider for production, binds the sms, database and evmRpc sandbox providers for sandbox, and keeps the RPC off private networks; compose gives the api Twilio, the SMS binding and the ceiling, the worker the RPC settings and every kind but SMS, both the database and AAMVA bindings, and migrate no binding.
```
$ bash infra/tests/compose.test.sh --static-only
FAIL - .env.example declares OPENVERIFY_TWILIO_API_KEY_SECRET
FAIL - api receives OPENVERIFY_TWILIO_ACCOUNT_SID
FAIL - worker receives OPENVERIFY_EVM_RPC_URLS
FAIL - migrate receives no provider binding
FAIL - api does not receive OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX
# 206 passed, 47 failed
```
GREEN `e3a75ee`: the variables in `.env.example` (the Twilio secret a `change-me-` placeholder of 49 characters, the SIDs, sender and RPC URLs empty), and three compose anchors: `x-shared-provider-environment` (database, AAMVA), `x-api-provider-environment` (plus SMS and Twilio) and `x-worker-provider-environment` (plus the other A-tier kinds, the EVM RPC binding, URLs and flag), merged into `api` and `worker` only; the ceiling goes to `api`.
```
$ bash infra/tests/compose.test.sh --static-only
# 253 passed, 0 failed
```
Both processes start from `.env.example` with valid keys in place of its placeholders (a one-off probe, not committed): the API binds `aamva, database, sms` for sandbox, the worker `aamva, ageEstimate, database, evmRpc, publicFigure, selfieAgeEstimate, selfiePublicFigure, suspiciousEntity`, and neither binds anything for production.

## 27. The final gates

The integration gate first failed on `operators.integration.test.ts`, which still read the invitation's recipient as a string; the mailer takes `{ address }` since section 6 (C54.3, C55.8), so the test now reads that (`5b1263b`, a test the plan changes). Every gate below then ran in the foreground on `5b1263b`:
```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
$ pnpm typecheck        Tasks: 12 successful, 12 total   (38 s)
$ pnpm lint             Tasks: 12 successful, 12 total   (1 min 19 s)
$ pnpm format:check     All matched files use Prettier code style!
$ pnpm test             Tasks: 12 successful, 12 total   (6 min 17 s, none cached)
  core 711 · node 225 · e2e 79 · config 68 · ui 54 · flow-spec 113 · checks 1336 · contracts 1778
  flow 736 · db 720 · dashboard 1946 · api 2843   = 10,609 passed, 0 failed
  statements: core 100, node 99.09, e2e 96.71, config 100, ui 100, flow-spec 100, checks 98.97,
  contracts 99.85, flow 96.61, db 98.72, dashboard 98.56, api 97.65 (every package >= 80)
$ pnpm test:integration Tasks: 2 successful, 2 total     api 64 passed (15 files), db 52 passed (10 files)
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 12s
191 actionable tasks: 9 executed, 182 up-to-date   (no Android input changed in this stage)
$ pnpm --filter @openverify/api openapi:write   (twice)
382a8676d25a3e9bd7ee21ffb4608ca04317e7009f35f3347509eab4f8013ce9  docs/api/openapi.json   (both runs; no diff)
$ python3 scripts/fetch_data.py
disposable_email_domains: present …/data/disposable_email_blocklist.conf (CC0-1.0)
$ bash infra/tests/ci-workflow.test.sh              # 157 passed, 0 failed, 0 skipped
$ bash infra/tests/compose.test.sh --static-only    # 253 passed, 0 failed
$ bash infra/tests/apps-image-context.test.sh       # 12 passed, 0 failed
$ flock /tmp/openverify-e2e.lock pnpm e2e           Tasks: 9 successful, 9 total   (6 min 58 s)
  flow (Playwright, mocked API) 38 passed · full stack 50 passed
```
