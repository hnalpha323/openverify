# Phase 5, Workflow 5B Stage 3: `api-kyb` (TDD evidence)

Owner: `api-kyb`.

**Paths:**
- `apps/api/src/providers/{business-registry,domain-age,malicious-website,backlink}/`
- `apps/api/src/jobs/types/{database-business,business-website}.ts`
- `apps/api/src/services/{guidance,attributes,submit,sub-resources}/{database-business,business-website}.ts`
- `apps/api/src/jobs/repeatable/feeds.ts`
- `packages/db/src/repositories/business-registry-records.ts`
- tests beside them, plus the KYB contract, exit and race tests under `apps/api/src/jobs/`

**Contracts:** C61 (the registers, the website's resolution, domain age, malicious-website feeds and backlinks), C53.3 (`business_registry_records`), C52.2 and C52.8 (guidance and attributes) for the `database-business` and `business-website` types.

Every command ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Output is abbreviated with `…`. The other Stage 3 agents (`api-document`, `api-nfc`) were editing the same tree at the same time; a typecheck error in their files is named where it appeared.

## 1. The registry record write (`packages/db`)

**Stub:** `e92ee10f chore(db): stub putBusinessRegistryRecord …`. The stub rejects `not implemented`; `tsc --noEmit` and `eslint` were clean.

**RED:** `b1face39 test(db): …` (`repositories/business-registry-records.test.ts`, PGlite): the summary sealed to the verification with its source and fetch time; no value in clear in the row; a re-run replaces it while unredacted; never over a redacted row; another environment refused.

```
$ cd packages/db && pnpm exec vitest run src/repositories/business-registry-records.test.ts --coverage.enabled=false
 FAIL  … > seals the summary to the verification and records the source and when it was fetched
Error: putBusinessRegistryRecord: not implemented (object, env_01M5P15TV2BGDR0RPXTT98MYP4, object)
 …
 FAIL  … > refuses a verification of another environment
AssertionError: expected [Function] to throw error matching /another environment/ but got 'putBusinessRegistryRecord: not implem…'
      Tests  5 failed (5)
```

**GREEN:** `f5905016 feat(db): …`. An insert with `on conflict (verification_id) do update … where environment_id = $env and redacted_at is null`; no row back means another environment or a redacted row. A verification of another environment fails the composite foreign key; that error quotes the query with its sealed parameters, so it is replaced by one naming the cause alone (thrown outside the `catch`).

```
$ cd packages/db && pnpm exec vitest run src/repositories/business-registry-records.test.ts src/repositories/phase5b-repositories.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

## 2. Pacing, the JSON request and the sandbox register (`providers/business-registry/`)

**Stub:** `bff737ff chore(api): …`: `pacing.ts` (`createProviderPacer`, `PacingRule`, `DEFAULT_PACING_MAX_WAIT_MS`), `http.ts` (`requestJson`, `JsonAnswer`), `sandbox.ts` (`SANDBOX_REGISTRY_MAGIC`, `SANDBOX_REGISTRY_PERSONS`, `SANDBOX_REGISTRY_OTHER_PERSONS`, `createSandboxRegister`), each rejecting.

**RED:** `9b39db1a test(api): …`, three test files and `testing.ts` (`createMockOutbound`: an outbound factory over undici's `MockAgent` with the outbound client's https-only, status, content-type and cap rules; `jsonHeaders`).
- pacing: one request per slot; two pacers on one cache pace together; keys apart; the key holds the rule and a SHA-256 of the key; `rate_limited` (retryable) past the wait; a slot cut by a burst counts as taken; no cache, or a failing cache, paces the process alone;
- `requestJson`: JSON, 404, 429, 5xx, 401/403, 400/422, a redirect (one request made), a body that is not JSON, a refused content type, the outbound client's failures with their retry rule, and the real client's vetted lookup refusing a private answer;
- the sandbox register: the echo with the sandbox officer and PSC, a derived record id without a number, `0000`, `9999`, `8888`, `7777`, the last four letters or digits only, every country.

```
$ cd apps/api && pnpm exec vitest run src/providers/business-registry/ --coverage.enabled=false
 FAIL  src/providers/business-registry/http.test.ts > requestJson (C61.2) > answers the JSON of a 2xx answer of an accepted type
ProviderError: registry requests are not built (GET)
 …
 FAIL  src/providers/business-registry/pacing.test.ts > createProviderPacer (C61.2) > lets the first request of a slot through at once …
ProviderError: pacing is not built (gleif, 7, 3)
 …
 FAIL  src/providers/business-registry/sandbox.test.ts > the sandbox register (C61.6) > echoes the input as an active, authoritative record …
ProviderError: The sandbox register is not built (GB)
 …
      Tests  8 failed | 1 passed (9)          (sandbox.test.ts; the identity test passes on the stub)
```

(`tsc --noEmit` for the package showed one error, in `api-document`'s `services/guidance/document.test.ts`.)

**GREEN:** `037c89bd feat(api): …`.
- Pacing: each interval is a slot key `openverify:pacing:<rule>:<sha256(key)>:<slot>`; a request pushes a random token (`pushCapped`, 16 kept, TTL two intervals) and holds the slot when its token is the oldest of an uncut list; otherwise it sleeps to the next slot, or refuses `rate_limited` past `maxWaitMs` (10 s). A cache failure falls back to a per-process schedule.
- `requestJson`: 404 is not found; 3xx `<name>_redirect`, 429 `<name>_rate_limited` (retryable), 5xx `<name>_unavailable` (retryable), 401/403 `<name>_unauthorized`, other statuses `<name>_rejected`; a body that is not JSON `<name>_malformed`; an `OutboundHttpError` becomes `<name>_<its code>` with its retry rule.
- The sandbox register answers by the ending (`sandboxRegistryAnswer`).

```
$ cd apps/api && pnpm exec vitest run src/providers/business-registry/pacing.test.ts --coverage.enabled=false
      Tests  9 passed (9)
$ … src/providers/business-registry/http.test.ts
      Tests  13 passed (13)
$ … src/providers/business-registry/sandbox.test.ts
      Tests  9 passed (9)
```

## 3. The registers: GLEIF, Companies House, SEC EDGAR, the query cache (`providers/business-registry/`)

**Stub:** `a3f79436 chore(api): …`: `gleif.ts` (`createGleifRegister`, `GLEIF_API_BASE_URL`, `GLEIF_PACING`, `GLEIF_SEARCH_PAGE_SIZE`), `companies-house.ts` (`createCompaniesHouseRegister`, `COMPANIES_HOUSE_BASE_URLS`, `COMPANIES_HOUSE_PACING`, `COMPANY_NUMBER`), `sec-edgar.ts` (`createSecEdgarRegister`, `SEC_EDGAR_URLS`, `SEC_EDGAR_PACING`, `SEC_EDGAR_TICKERS_TTL_MS`), `query-cache.ts` (`createRegistryQueryCache`, `REGISTRY_QUERY_CACHE_TTL_SECONDS`), `candidates.ts` (`closestByName`), each rejecting. A lint finding (`regexp/prefer-d`) was fixed before the commit.

**RED:** `a1d96983 test(api): …`, five test files against `MockAgent` with synthetic answers shaped like the GLEIF API (JSON:API `lei-records`), the Companies House public data API (profile, search, officers, PSCs) and `data.sec.gov` (submissions, `company_tickers.json`).

```
$ cd apps/api && pnpm exec vitest run src/providers/business-registry/{query-cache,candidates,gleif,companies-house,sec-edgar}.test.ts --coverage.enabled=false
 Test Files  5 failed (5)
      Tests  46 failed | 1 passed (47)
      2 AssertionError: expected ProviderError: companies-house is not bui… { …(2) } to match object { …(2) }
      1 AssertionError: expected ProviderError: gleif is not built (GB, 2) { …(2) } to match object { code: 'gleif_not_configured', …(1) }
      …
      1 Error: not built (companies-house, GB, not_found)
```

**GREEN:** `6f113fce feat(api): …`.
- GLEIF: an LEI is read by `/lei-records/{lei}`; otherwise `filter[entity.registeredAs]` with the country (any record under the number is kept), then `filter[entity.legalName]` (the closest name at least `partial`). `status` is the registration status, `statusDetail` the entity status, `INACTIVE` for an entity expiration. Never authoritative, no persons; the search's resolution is cached, the record always read by its LEI.
- Companies House: GB only; a company number (upper-cased, validated) is read directly and a 404 there is an authoritative miss; otherwise `/search/companies` keeps the closest title. Officers (corporate ones dropped) and individual PSCs are read on every lookup, with `YYYY-MM` birth months; Basic auth with the key as user name; the sandbox host for sandbox environments.
- EDGAR: US only; a numeric number is the CIK (`CIK##########.json`); otherwise the closest listed company of `company_tickers.json` (in memory a day, 8 MiB cap). `status` null, no persons, never authoritative; the CIK served as entered when it equals the record's.
- Query cache: `openverify:kyb-registry:<source>:<sha256(normalised query)>`, a record id or a miss, an hour; skipped when the cache fails.

**A RED defect corrected in GREEN:** the GLEIF fixture's default other and transliterated names (`UTOPIA WIDGETS`) match the entered name, so the "no record matches the name" case found one; the fixture now takes `otherNames` and `transliterated` overrides and that case passes names that do not match. No production code was fitted to it.

```
$ cd apps/api && pnpm exec vitest run src/providers/business-registry/ --coverage.enabled=false
      Tests  78 passed (78)
```

## 4. The registers' factory (`providers/business-registry/index.ts`)

**RED:** `b5af08fe test(api): …` (`index.test.ts`): the binding's order, Companies House's key and host per environment kind, GLEIF through the outbound client over the shared pacer and query cache, the sandbox register. The first commit attempt was refused by the gitleaks hook (`generic-api-key` on a synthetic key literal); the keys were reworded as named constants, nothing ignored.

```
$ cd apps/api && pnpm exec vitest run src/providers/business-registry/index.test.ts --coverage.enabled=false
 FAIL  … > gives Companies House the key and host of the environment kind
ProviderError: The companies-house register is not built yet (4 options)
 …
      Tests  3 failed | 1 passed (4)
```

**GREEN:** `38ba42b2 feat(api): …`: one pacer and one query cache over the options' cache for the binding's registers. `providers/phase5b-providers.test.ts`, which tested the five stubs (contracts-5b), lost its two register cases (the plan replaced the stubs); `25d3abfe fix(api): …` removed the optional chain the lint then flagged.

```
$ cd apps/api && pnpm exec vitest run src/providers/ --coverage.enabled=false
      Tests  307 passed (307)
```

## 5. Domain age: RDAP and the sandbox (`providers/domain-age/`)

**Stub:** `78a86520 chore(api): …`: `rdap.ts` (`createRdapDomainAgeProvider`, `IANA_RDAP_BOOTSTRAP_URL`, `RDAP_BOOTSTRAP_TTL_SECONDS`, `RDAP_DATE_TTL_SECONDS`, `RDAP_MAX_QUERIES`, `RDAP_PACING`), `sandbox.ts` (`createSandboxDomainAgeProvider`, `SANDBOX_DOMAIN_AGES`, `SANDBOX_NO_RDAP_HOST`).

**RED:** `3a373be6 test(api): …` (`rdap.test.ts`, `sandbox.test.ts`, `index.test.ts`) with a synthetic bootstrap and RFC 9083 answers on reserved names.

```
$ cd apps/api && pnpm exec vitest run src/providers/domain-age/ --coverage.enabled=false
 Test Files  3 failed (3)
      Tests  17 failed | 1 passed (18)
      1 AssertionError: expected ProviderError: rdap is not built (22, 1) { …(2) } to match object { code: 'rdap_not_configured', …(1) }
      3 ProviderError: rdap is not built (22, 4)
      1 ProviderError: The domain age provider is not built yet (1 options)
      …
```

**GREEN:** `6c9278ee feat(api): …`. The bootstrap (HTTPS services only, longest label match) is kept a day in Valkey (`openverify:rdap:bootstrap`) and in memory; dates are checked first under `openverify:rdap:date:<sha256(domain)>` for the host and the host without `www.`; then at most four names above the TLD entry are asked, paced one a second per RDAP host. Only the host (or without `www.`) yields a date; a shorter answer is `subdomain`; no answer `not_found`; no `registration` event `no_registration_date`. The stub test's domain age case went.

```
$ cd apps/api && pnpm exec vitest run src/providers/ --coverage.enabled=false
      Tests  324 passed (324)
```

## 6. Malicious-website feeds, the refresh job and backlinks

**Stub:** `e23dac5e chore(api): …`: `malicious-website/store.ts` (`feedHosts`, `readFeedMeta`, `readFeedHosts`, `writeFeed`, `MAX_FEED_HOSTS`, `MAX_FEED_BYTES`), `feed-provider.ts` (`createFeedListProvider`), `sandbox.ts` (`createSandboxMaliciousWebsiteProvider`, `SANDBOX_MALICIOUS_DOMAIN`, `SANDBOX_FEED_ID`), `backlink/sandbox.ts` (`createSandboxBacklinkProvider`, `SANDBOX_BACKLINK_HOST`, `SANDBOX_BACKLINK_COUNT`), `jobs/repeatable/feeds.ts` (`refreshMaliciousFeeds`, `FeedRefreshSummary`).

**RED:** `d74a8368 test(api): …`: six test files (the store, the feed-list provider, the sandbox, the factory, the backlink sandbox, the refresh job against `MockAgent`).

```
$ cd apps/api && pnpm exec vitest run src/providers/malicious-website/ src/providers/backlink/ src/jobs/repeatable/feeds.test.ts --coverage.enabled=false
 Test Files  6 failed | 1 passed (7)
      Tests  28 failed | 14 passed (42)
```

(The file that passed is contracts-5b's `feed-list.test.ts`; the other passes are the stubs' identities.)

**GREEN:** `2441dedf feat(api): …`.
- Store: hosts only (a `urls` feed's path and query dropped; comments, blanks, IP addresses and names without a dot skipped; hosts-file lines read), a generation per refresh (`openverify:malicious-feed:<id>:entries:<uuid>`) then the meta naming it (`openverify:malicious-feed:<id>`), both for twice the interval plus 600 s.
- Provider: `domains` match the host and each parent (never the TLD), `urls` the exact host; a fresh listing wins; otherwise any feed never loaded or older than twice its interval is `stale`; no feed `no_feeds`; each generation read once into memory; a failing store `feed_store_unavailable` (retryable).
- Refresh: due feeds fetched one at a time (`malicious-feed` client, text types, 32 MiB, 30 s), failures logged as `{ feed, error }` codes; a failed feed keeps its last list.
- The sandbox lists `malicious.example` and its subdomains for phishing; the backlink sandbox counts 250 for `backlinks.example`.
- The stub block of `phase5b-providers.test.ts` went with its last two cases.

**A RED defect corrected in GREEN:** `xn--synthetic-9za.example` is not valid punycode, so the WHATWG URL parser rightly refuses it; the case uses `xn--bcher-kva.example`.

```
$ cd apps/api && pnpm exec vitest run src/jobs/repeatable/ src/worker.test.ts src/providers/ --coverage.enabled=false
      Tests  391 passed (391)
```

## 7. The jobs (`jobs/types/database-business.ts`, `business-website.ts`)

**RED:** `f4b52bf1 test(api): …` (`database-business.test.ts`, `business-website.test.ts`, PGlite, through `processVerification`), against the Stage 1b stubs (`unbuiltTypeJob`, not runnable).

```
$ cd apps/api && pnpm exec vitest run src/jobs/types/database-business.test.ts src/jobs/types/business-website.test.ts --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  25 failed (25)
     19 PermanentJobError: The job cannot succeed (unsupported_verification)
      1 AssertionError: expected { type: 'database_business', …(4) } to match object { type: 'database_business', …(1) }
      1 AssertionError: expected error to be instance of ProviderError
      …
```

**GREEN:** `4802af0e feat(api): …`. Both jobs are runnable. The business job builds the C61.1 request from the entered values, orders the bound registers national first then GLEIF, asks each through `askProvider` until one finds the business, evaluates, and its decision seals the found record's summary (`putBusinessRegistryRecord`) before `verificationEvent()`. The website job takes the host with `websiteHostOf`, resolves A and AAAA through `deps.dnsResolver` (NXDOMAIN `not_found`, no data `no_address`, any other failure retried), skips the query for the sandbox reserved names, and asks the domain age, feed and backlink providers only for enabled checks.

```
$ cd apps/api && pnpm exec vitest run src/jobs/ --coverage.enabled=false
      Tests  534 passed (534)
```

## 8. Guidance and attributes; submit and cancel hooks

**RED:** `fcee5161 test(api): …` (four test files, PGlite) against the Stage 1b stubs (`unbuiltGuidanceHook`, `unbuiltAttributeHook`).

```
$ cd apps/api && pnpm exec vitest run src/services/guidance/{database-business,business-website}.test.ts src/services/attributes/{database-business,business-website}.test.ts --coverage.enabled=false
 Test Files  4 failed (4)
      Tests  14 failed (14)
```

**GREEN:** `6682043b feat(api): …`: the guidance (`collect-associated-persons`, `required-inputs` from `businessRequiredInputs`; `{}` for the website; `inputs-received`), the attributes (the entered business with `country-code` served as `address-country-code`, the register's record id, legal name, source and status; the website's URL, host and the domain age check's `registered-at` at midnight UTC). The submit guards (`standardSubmitGuard({ inputs: true })`) and cancel hooks (`noSubResources()`) Stage 1b wrote were already what the plan asks; only their comments changed (pinned by `routes/flow/phase5-submit.test.ts`).

```
$ cd apps/api && pnpm exec vitest run src/services/guidance/ src/services/attributes/ --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  87 passed (87)
```

## 9. Pins written on built code (disclosed: they passed on their first run)

- `801b15f0`: `services/attributes/business-exits.test.ts` (the attributes at every exit, masked without `pii:view`, null after redaction) and `jobs/business-contract.test.ts` (`BUSINESS_EVALUATOR_REASONS` equals `BUSINESS_CHECK_REASONS`; the golden fixtures parse). One expectation was mine and wrong before its first green run: a full redaction clears the checks' metadata, so `domain-registered-at` is null after it (the hook's comment now says so).
- `0d17a57f`: `jobs/types/kyb-valkey-scan.test.ts`: both environments end to end, then every key and value scanned for the officers', PSCs' and entered persons' names and birth months, the business and the website's path and query. A mutation (the query cache storing the business name) made it fail, then was reverted:

```
$ cd apps/api && pnpm exec vitest run src/jobs/types/kyb-valkey-scan.test.ts --coverage.enabled=false      (with the mutation)
AssertionError: expected 'openverify:malicious-feed:synthetic-p…' not to contain 'Quillfeather'
      Tests  1 failed | 1 passed (2)
$ … (reverted)
      Tests  2 passed (2)
```

- `230d0d57`: `jobs/database-business-race.integration.test.ts` (Testcontainers, `pgvector/pgvector:pg17`): a redaction that starts while the decision writes the record waits and nulls it with the values; a decision after a redaction writes none; two jobs decide once with one record and one `verification.passed` carrying `registry-source`.

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/jobs/database-business-race.integration.test.ts
      Tests  3 passed (3)
```

The whole API unit suite after these units:

```
$ cd apps/api && pnpm exec vitest run --coverage.enabled=false
 Test Files  252 passed (252)
      Tests  3786 passed (3786)
```

## 10. A flow-level pin, and the final gates

`4ea58c0b test(api): …` (`jobs/types/kyb-flow.test.ts`, pins built behaviour): business registry and website verifications created through the flow API (with their guidance), their values entered, submitted, judged by the sandbox providers and read back: `01234567` passes with the record, `12348888` fails as `dissolved`, `old.example` passes with its date, `utopia.invalid` fails.

GLEIF's answer shape was re-observed on 2026-10-24 (one live request for a public record, outside any test): `filter[entity.legalName]` and `filter[entity.legalAddress.country]` are accepted, the record carries the members the client reads, and the name filter is partial (a second, different company answered), which is why the client keeps the closest record by name.

Final gates, in the foreground (another agent's in-flight change made `openapi.test.ts` fail once in an earlier full run; it passed on the rerun below with no change of mine):

```
$ pnpm typecheck
 Tasks:    13 successful, 13 total
$ pnpm lint
 Tasks:    13 successful, 13 total
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm --filter @openverify/api test
 Test Files  253 passed (253)
      Tests  3790 passed (3790)
Statements   : 96.94% ( 9667/9972 )
Branches     : 89.34% ( 5830/6525 )
Functions    : 98.63% ( 2388/2421 )
Lines        : 96.95% ( 9372/9666 )
$ pnpm --filter @openverify/db test
 Test Files  66 passed (66)
      Tests  844 passed (844)
Statements   : 98.72% ( 2326/2356 )
Branches     : 92.24% ( 1416/1535 )
$ pnpm test:integration
@openverify/db:test:integration:  Test Files  11 passed (11)      Tests  57 passed (57)
@openverify/api:test:integration: Test Files  24 passed (24)      Tests  122 passed (122)
```

(A first `pnpm test:integration` run failed `api-nfc`'s `chip-races.integration.test.ts` as a whole file, with nothing else failing; it passed alone, 11 of 11, and in the full rerun above.)

`pnpm e2e` takes longer than one foreground call allows, so it ran in three foreground parts, each under `flock /tmp/openverify-e2e.lock` after `pnpm turbo run build --filter=@openverify/e2e^...`:

```
$ pnpm --filter @openverify/flow e2e
  68 passed (17.2s)
$ pnpm --filter @openverify/e2e exec playwright test --shard=1/2
  31 passed (2.0m)
$ pnpm --filter @openverify/e2e exec playwright test --shard=2/2
  29 passed (5.7m)
```

Coverage of this area's own sources (their tests only): 96.75% statements, 88.47% branches, 95.62% functions, 97% lines (280 tests).
