# TDD evidence: `api-providers` (Phase 6, Workflow 6A Stage 3)

Area: C81 and C82's provider side and C83 — the `gdelt-doc` adapter with `gdeltQuery` (V10), the
shared budget (V09), truncation and no cache; the `hibp`, `twilio-lookup` and `smarty` adapters
against local stubs; every sandbox provider with its magic values; the acknowledgement rule;
`resolveTxt` and the RDAP `registered-domain` mode (C85.2, C85.3); the report types
`adverse-media`, `business-adverse-media`, `email-address`, `phone-number` and `address-lookup`
with the OTP-confirmed deliverability and reachability lookups; the `cryptoExposure` provider.

Every slice went stub (when a name did not exist yet), then RED (run and seen failing for its
intended reason), then GREEN. Commands run from `apps/api` after `source scripts/env.sh`, with
`--coverage.enabled=false` while iterating. Output is abbreviated to the lines that matter.

## Slice 1: TXT lookups and the report DNS cache (C85.2)

Owned file: `apps/api/src/dns/txt.ts` (`resolveTxtRecords`, the frozen signature, plus
`createCachedDnsResolver`, `TXT_MAX_ANSWER_BYTES`, `DNS_CACHE_SECONDS`, `DNS_CACHE_MAX_ENTRIES`).

**Decision (C85.2, P15).** The cache of the report's DNS answers (TXT for SPF and DMARC, MX with
the real exchange names, A and AAAA) lives in process memory, never in Valkey: a TXT answer of a
vanity domain carries the domain itself (`rua=mailto:…@<domain>`), and an email domain is personal
data (P15). It keeps answers 1 h, NXDOMAIN and NODATA 5 min, nothing a retry may cure, at most
10,000 answers.

Stub: `c685e2e2` (the cap, lifetimes and `createCachedDnsResolver` returning the resolver
unchanged).

RED:

```
$ pnpm exec vitest run src/dns/txt.test.ts --coverage.enabled=false
 ❯ src/dns/txt.test.ts (12 tests | 8 failed) 34ms
     × answers each TXT record as its character strings, as Node returns them
     × maps Node’s failures to the MX resolver’s, never naming the host
     × reads an answer of exactly 4 KiB, and refuses a larger one as failed
     × is the worker resolver’s resolveTxt
     × keeps an answer for an hour, then asks again
     × keeps NXDOMAIN and NODATA for five minutes, each time as a fresh error of its code
     × answers each lookup apart: the record type and the name both key it
     × keeps at most maxEntries answers, dropping the oldest
AssertionError: promise rejected "DnsResolverError: DNS query failed (faile… { …(2) }" instead of resolving
AssertionError: ENOTFOUND: expected DnsResolverError: … to match object { code: 'not_found', retryable: false }
```

The four that passed are refusals the stub already gives (every lookup `failed`), which GREEN
must keep.

GREEN:

```
$ pnpm exec vitest run src/dns --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

## Slice 2: the RDAP `registered-domain` mode (C85.3)

Owned file: `apps/api/src/providers/domain-age/registered-domain.ts`
(`createRegisteredDomainAgeProvider(name, options)` over the `domainAge` binding's name).

**Decision (Stage 1a amendment 4, P03, P15).** The mode never writes an email domain's date to
Valkey: the C61.4 client keeps dates install-wide under an unsalted SHA-256 of the domain, which a
Valkey reader reverses by guessing and which a second tenant's lookup would hit. The mode builds
its own C61.4 client over a cache that passes the bootstrap and drops the date keys, and keeps a
date in process memory under the report's environment (`scope`) for a day (`RDAP_DATE_TTL_SECONDS`);
without a scope it keeps nothing. Known free-mail domains are never asked (a `RangeError`).

Stub: the factory rejecting every lookup, and `RegisteredDomainAgeRequest.scope` (optional).

RED:

```
$ pnpm exec vitest run src/providers/domain-age/registered-domain.test.ts --coverage.enabled=false
     × answers for the domain itself, unflagged
     × answers a mail subdomain for its registered domain, flagged
     × passes on an answer that is no date: not found, no service, no registration date
     × keeps no email domain’s date in Valkey, only the bootstrap the client shares
     × keeps a date in memory for its scope only, for a day; without a scope, nothing
     × never asks about a known free-mail domain
     × ages the sandbox’s reserved names and their subdomains, flagging those
     × answers anything else as the sandbox does
AssertionError: promise rejected "Error: the rdap registered-domain mode is…" instead of resolving
AssertionError: expected error to be instance of RangeError
```

GREEN (the test's IANA stub was made `persist()`: a day later the bootstrap had expired too and
was fetched again, which is the client's documented behaviour, not the mode's):

```
$ pnpm exec vitest run src/providers/domain-age --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

## Slice 3: the sandbox crypto exposure provider (C83, C82.4)

Owned file: `apps/api/src/providers/crypto-exposure/index.ts`. The factory existed as a stub that
rejected every call, so the RED test compiled against it.

RED:

```
$ pnpm exec vitest run src/providers/crypto-exposure --coverage.enabled=false
     × rates an EVM address ending in dead as indirectly exposed
     × rates an EVM address ending in beef as directly exposed, on any EVM chain
     × rates any other EVM address as unexposed
     × does not rate another chain: unavailable, never a pass
AssertionError: promise rejected "Error: the sandbox provider is not built …" instead of resolving
```

GREEN:

```
$ pnpm exec vitest run src/providers/crypto-exposure src/providers/phase6 --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  12 passed (12)
```

## Slice 4: the email intelligence providers, `hibp` and the sandbox (C82.1, C82.4, C83)

Owned folder: `apps/api/src/providers/email-intelligence/`. Stub: `HIBP_API_ORIGIN`.

RED (fixtures-6's synthetic HIBP answers through `MockAgent`):

```
$ pnpm exec vitest run src/providers/email-intelligence --coverage.enabled=false
     × asks for the address’s untruncated breaches with the key and a User-Agent
     × reads a 404 as no breach
     × keeps the count but no date when any breach is undated
     × fails a refused key for good, a rate limit and an outage for a retry
     × refuses an answer that is not a list of breaches
     × is never built without its key, naming the variable and not a value
     × is labelled a sandbox and gives a breach 90 days ago for sandbox-breached
     × gives no breach for any other address, sandbox-spam included (no spam adapter)
     × reads the token in the local part only
AssertionError: promise rejected "Error: the hibp provider is not built yet…" instead of resolving
```

GREEN (`hibp.ts`, `sandbox.ts`, the factory). The first GREEN run failed foundation-6's
`phase6-providers.test.ts` ("build each bound provider through its factory"), which builds the
providers without an outbound client; as the C61.4 client does, the missing client is now refused
at the call (`hibp_not_configured`, for good), not at construction, and a test pins it:

```
$ pnpm exec vitest run src/providers/email-intelligence src/providers/phase6 --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

## Slice 5: the phone intelligence providers, `twilio-lookup` and the sandbox (C82.2, C82.4, C83)

Owned folder: `apps/api/src/providers/phone-intelligence/`.

**Decision (C82.2, H08).** The frozen port answer (`PhoneIntelligenceResult`) gives SIM swap and
porting as a date or `null`, which cannot tell "no swap" from "not asked" (Lookup's SIM swap
package needs carrier approval, and Lookup states no porting at all). Both providers answer a
`PhoneIntelligenceAnswer`, the port's answer plus `lookup`, risk-logic's `PhoneIntelligenceLookup`
(what was checked, and Lookup's full line type vocabulary, so `tollFree` or `pager` reach the rule
rather than the port's narrower list). `phoneIntelligenceLookupOf` reads either, a bare port answer
conservatively (a date is checked, a `null` is not). A port amendment is proposed in the report.

Stub: `TWILIO_LOOKUP_ORIGIN`, `PhoneIntelligenceAnswer`, `phoneIntelligenceLookupOf` (nothing
checked).

RED:

```
$ pnpm exec vitest run src/providers/phone-intelligence --coverage.enabled=false
     × asks for line type and SIM swap with the API key, and says what each answered
     × says SIM swap was not checked when the package gave no date
     × says nothing was checked when neither package answered, or the number is not valid
     × keeps Lookup’s full line type for the rule, and the port’s narrower one
     × fails a refused key for good, a rate limit and an outage for a retry
     × refuses an answer that is not Lookup’s, for good
     × is never built without its credentials, naming the variables and not a value
     × is labelled a sandbox and answers 00 as a mobile line with nothing recent
     × answers each magic ending as C82.4 lists it
     × checks nothing for any other number
     × reads an answer that carries what was checked as it is
     × reads a bare port answer conservatively: a date is checked, an absent one is not
      Tests  12 failed (12)
```

GREEN (`twilio-lookup.ts`, `sandbox.ts`, `answer.ts`, the factory):

```
$ pnpm exec vitest run src/providers/phone-intelligence src/providers/phase6 --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  19 passed (19)
```

## Slice 6: the address verification providers, `smarty` and the sandbox (C82.3, C82.4, C83)

Owned folder: `apps/api/src/providers/address-verification/`. Stub: `SMARTY_US_STREET_ORIGIN`.

RED (fixtures-6's synthetic Smarty candidates through `MockAgent`; the last smarty test also ties
the sandbox provider to fixtures-6's scenario stub for every magic house number):

```
$ pnpm exec vitest run src/providers/address-verification --coverage.enabled=false
     × sends the normalised components with the credentials, and maps the candidate
     × sends the addressee only when the request carries one
     × reads the DPV codes: a missing or invalid secondary, and no candidate at all
     × serves no value Smarty gave in another shape
     × fails refused credentials for good, a rate limit and an outage for a retry
     × refuses an answer that is not a list of candidates, for good
     × is never built without its credentials, naming the variables and not a value
     × agrees with fixtures-6’s sandbox scenario stub for every magic house number
     × is labelled a sandbox and answers 1000 as a confirmed residential address
     × answers any other house number as unknown, with nothing else
      Tests  10 failed (10)
```

GREEN (`smarty.ts`, `sandbox.ts`, `fields.ts`, the factory). The first run failed three tests on
the test's own double `close()` of the last `MockAgent` in the scenario loop; the loop now clears
it after closing:

```
$ pnpm exec vitest run src/providers/address-verification src/providers/phase6 --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

## Slice 7a: `gdeltQuery` (C81.2, V10)

Owned file: `apps/api/src/providers/adverse-media/query.ts`. Stub: `5f372b1c`.

**Decisions.** Several screened names (the query's and its `additional-names`) are one OR group of
phrases, so a run makes one request whatever the number of names (one request per name would need
several budget tokens in a row, which a shared budget rarely grants). A single term is written
without a group. `sourcecountry:` takes the country's English name from `Intl.DisplayNames`,
letters only, lower case; a code that is not a region adds nothing. GDELT's own country names are
not published as a list we can pin, so a name GDELT does not know empties only the country re-query
of a truncated answer, which the job never reads as "no match" (slice 8).

RED (exact query strings for names holding `"`, `-`, `sourcecountry:`, `domain:`, `OR` and
parentheses):

```
$ pnpm exec vitest run src/providers/adverse-media/query.test.ts --coverage.enabled=false
     × casefolds a name and keeps its letters and digits, word by word
     × drops every operator character, leaving only words
     × keeps letters of other scripts as C58 folds them, recomposed
     × names a country as the DOC API writes it: its English name, letters only, lower case
     × answers nothing for a code that is not a region
     × writes the name as one phrase and the terms as one OR group, quoting multi-word terms
     × writes one term without a group, and several names as an OR group of phrases
     × adds a country only as sourcecountry from the fixed table
     × lets nothing from the subject out of the phrase, whatever it holds
     × reduces the terms too, and drops a name or a term that is empty
     × refuses a query without any name word
      Tests  11 failed (11)
```

GREEN. The first run failed the two country tests: `Intl.DisplayNames` names `ZZ` "Unknown
Region" even with `fallback: 'none'`, so ISO 3166-1's user-assigned codes (AA, QM-QZ, XA-XZ but
Kosovo's XK, ZZ) are refused before asking it:

```
$ pnpm exec vitest run src/providers/adverse-media/query.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## Slice 7b: the shared GDELT budget (C81.2, V09)

Owned file: `apps/api/src/providers/adverse-media/budget.ts`. Stub: `3e759fd3` (grants nothing).

**Design.** Per request: (1) the environment is recorded in a capped list of askers
(`openverify:gdelt:askers`, entries `<environment id> <ms>`, 60 s TTL), and N is the number of
distinct environments in it within the last 60 s; (2) the environment's share is free when its
next-free time (`openverify:gdelt:share:<environment id>`) has passed, read without consuming
anything; (3) only then the install-wide GCRA (`pacing:gdelt`, one request per 5 s, Valkey's
clock) is consumed; (4) on a grant the share's next-free time moves 5 s × N ahead. Checking the
share before consuming the install token means an environment over its share never burns install
tokens another environment could use, and reading the share without consuming means a refused
install token never costs the share either. A refusal names the earlier of the share's and the
install's next time, plus up to 1 s of jitter. While Valkey is down nothing is granted (the run
waits): sending without the shared budget could exceed GDELT's ask.

RED (a GCRA limiter of the Valkey script's rule on the frozen test clock):

```
$ pnpm exec vitest run src/providers/adverse-media/budget.test.ts --coverage.enabled=false
     × gives one environment waiting alone the whole install budget
     × gives two waiting environments half each
     × keeps an environment over its share from taking another’s
     × counts an environment only while it asked in the last 60 s
     × adds jitter to a refusal’s retry time
     × keeps environment ids and times in Valkey, and the install-wide GCRA under its own rule
     × keeps the budget in this process without Valkey
      Tests  7 failed | 1 passed (8)
```

The one that passed is the Valkey-down refusal, which the stub's refusal already satisfies.

GREEN:

```
$ pnpm exec vitest run src/providers/adverse-media/budget.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Slice 7c: the `gdelt-doc` adapter, the sandbox and the acknowledgement (C81.1-C81.5, C82.4)

Owned folder: `apps/api/src/providers/adverse-media/` (`gdelt.ts`, `sandbox.ts`, the factory).

**Decisions.** The frozen `AdverseMediaSearch` names one phrase and no environment, so the
request the media jobs send is an `AdverseMediaSearchRequest`: the port's search plus
`environmentId` (whose share of the budget the request takes, so the adapter owns its budget with
the limiter and cache `ReportProviderOptions` give it) and `names` (every screened name; the port's
`nameTokens` is the first). GDELT's `artlist` JSON names a language and a country in English
(`English`, `United Kingdom`); the adapter maps them to ISO codes through reverse `Intl.DisplayNames`
tables built at run time, and an unknown one to `null` (missing is not a mismatch). No timespan is
sent: the DOC API searches its rolling three months by default. The factory refuses `gdelt-doc`
without `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true` too (config already refuses it, decision 7).

Stub: the origin, citations, request type and `mediaCitationOf`.

RED (fixtures-6's synthetic GDELT answers through `MockAgent`; the RED test first failed to
typecheck where it passed `names` in an object literal to the port's `search`, and was fixed to
build an `AdverseMediaSearchRequest` first):

```
$ pnpm exec vitest run src/providers/adverse-media/index.test.ts --coverage.enabled=false
     × asks artlist in JSON for the gdeltQuery of the request, 250 records, by hybrid relevance
     × screens every name of the request in one query
     × reads an empty answer as no article, and a full one as truncated
     × caps a title at 200 characters, and reads an unknown language or country as unknown
     × drops an article it cannot read, and keeps the others
     × fails GDELT’s plain-text error and a 429 for a retry, without the subject
     × waits, asking nothing, when the shared budget refuses
     × keeps no article and no name in Valkey: only the budget’s ids and times (P03)
     × is never bound without the disclosure acknowledgement, naming the variable
     × cites GDELT, as its terms require
     × answers two synthetic articles for a name holding sandbox-media, asking no budget
     × finds the token in any screened name, joined or split
     × answers no article for any other name
      Tests  13 failed (13)
```

GREEN (`gdelt.ts`, `sandbox.ts`, `request.ts`, the factory). The first run mapped "United Kingdom"
to `UK`: `Intl` names the reserved alias `UK` like `GB`, and the reverse table kept the last code;
it now keeps the first and skips the reserved `EU`, `EZ`, `UK` and `UN` and the user-assigned codes:

```
$ pnpm exec vitest run src/providers/adverse-media src/providers/phase6 --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  39 passed (39)
```

## Slice 8: the provider-backed report jobs (C81.2-C81.5, C82.1-C82.3, C84.2, P05)

Owned files: `apps/api/src/jobs/report-types/{email-address,phone-number,address-lookup,adverse-media,business-adverse-media}.ts`
and three helpers of their own beside them, `provider-reports.ts` (the last-attempt rule, the
OTP confirmation of P05, the errored result), `media-screening.ts` (the screening both media jobs
run) and `provider-testing.ts` (test support only). Stub: `25e2882b` (the helpers,
`createEmailAddressReportJob` and `runMediaScreening` rejecting every run).

**The run framework's conventions** (api-reports, `jobs/reports/run.ts` and `persist.ts`,
`713b1c64`), which the jobs follow:
- `ReportRunResult.result` holds the type's non-match attributes under their served names at its
  top level; the framework serves only the names in the type's resource schema, so anything else
  (each job's `details`) stays sealed and unserved.
- A media match: `sourceId` null, `entryKey` the article key (the dismiss `entity-id`),
  `contentHash` the article's own hash, `riskDataHash` null, `matchedName` the stored title, and
  `snapshot.entity` the article in its served shape without `match-id` and `score` (the framework
  adds both), beside `snapshot['match-types']`, `snapshot.qualifiers` and `snapshot.components`.
- Any error makes the run `errored`; a wait is `{ kind: 'wait', notBefore }`.
- A thrown error is retried by BullMQ and, on the last attempt, ends the run `errored` with
  `execution_error` keeping the last result. The partial types must instead answer `ready` with
  the failed field `null` (C69.4), so on their last attempt they record the failure themselves.

So the tests (written in the first run, before the conventions were relayed) were aligned before
this RED commit: `servedReport` now builds the report and match rows the framework persists and
serves them through api-reports' own `reportResource` (unmasked), and each test parses that
resource with the type's schema; the attributes are read from `result` itself, and the media
entity from `snapshot.entity`. The phone test serves an empty query and only errors a non-E.164
one: the served query schema keeps the E.164 pattern, so a stored non-E.164 query cannot be served
at all (a note for api-reports' completion queries).

RED:

```
$ pnpm exec vitest run src/jobs/report-types/{email-address,phone-number,address-lookup,adverse-media,business-adverse-media}.test.ts --coverage.enabled=false
     × answers an old reserved domain high, asking no DNS, ready with its provenance
     × reads MX with its real names, SPF and DMARC, and RDAP for a custom domain
     × retries a DNS timeout while attempts remain, then leaves the band null, never high
     × is true only for a completion report whose inquiry confirmed exactly this address
     × answers an ordinary US number from the plan alone: type undetermined, low at 0.3
     × serves the R fields and the sandbox provider’s, sending no addressee by default
     × sends nothing for another country: the provider fields are unsupported_country
     × errors provider_not_configured without a provider, stating its coverage
     × asks again with the country when the answer filled its cap, and is then complete
     × waits for the shared budget, and errors provider_error once it has waited 24 h
     × searches the name without its legal form, and matches the sandbox’s articles
     … (40 in all)
ReportTypeNotBuiltError: The email-address report job is not built yet
AssertionError: expected error to be instance of DnsResolverError
AssertionError: expected error to be instance of ProviderError
 Test Files  5 failed (5)
      Tests  40 failed | 3 passed (43)
```

The three that pass are the contracts alignment pins (risk-logic's `EMAIL_BAND_REASONS`,
`PHONE_LINE_TYPES`, `NUMBERING_PLAN_TYPES`, `PHONE_LEVEL_REASONS` and `ADDRESS_DESIGNATORS` equal
the contracts' lists; every `RISK_UNAVAILABLE_REASONS` entry is a contracts reason), which compare
code risk-logic already committed.

GREEN (`provider-reports.ts`, `email-address.ts`, `phone-number.ts`, `address-lookup.ts`,
`media-screening.ts`, `adverse-media.ts`, `business-adverse-media.ts`):

```
$ pnpm exec vitest run src/jobs/report-types src/jobs/reports/run.test.ts --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  91 passed (91)
```

The first GREEN run failed one test, the business sandbox case: risk-logic's business rule counts
"media" as a generic word, so "Sandbox-Media Holdings Ltd" has one distinctive word ("sandbox")
and needs country evidence that the sandbox's articles never carry (they name no country). The
sandbox must not be special-cased, so the test now uses "Sandbox-Media Quarrystone Holdings Ltd"
(a second distinctive word), and a new case pins that the one-word name stays unconfirmed (no
match). integration-6a's sandbox docs must say a business sandbox name needs a second distinctive
word.

**Decisions.**
- **Last attempt.** `isLastReportAttempt` is `run.attempt >= REPORT_RUN_JOB_OPTIONS.attempts` (5):
  a claim counts once per BullMQ attempt (a budget wait gives its claim back uncounted), and a
  claim past the job's attempts comes from the sweep's crash recovery, which BullMQ does not retry.
  Before it, a DNS timeout or a provider's retryable failure is thrown; on it, the partial types
  record the field `null` with `execution_error` (the report `ready`, C69.4) and the media types
  end `errored` with `provider_error`. A lookup failure that no retry cures is recorded at once.
- **DNS.** The worker's resolver is wrapped once per process in the report DNS cache (slice 1),
  never Valkey. MX keeps the exchanges' real names, sorted by preference, so `email-mx-provider`
  names the preferred exchange's provider; C56's masked MX cache is never read. NODATA falls back
  to the domain's A and AAAA records (RFC 5321 §5.1). DMARC's author domain exists when MX found
  the domain, `null` when MX failed.
- **RDAP.** One registered-domain mode per worker deps and binding (`rdap` or `sandbox`, from the
  `domainAge` binding's id), so its day of in-memory dates outlives a run; scoped by the report's
  environment; asked for a custom domain only.
- **OTP confirmation (P05).** `not_linked` for any origin but `inquiry_completion`; otherwise the
  inquiry's verifications of the type are read, and only a `confirmed` challenge whose opened
  destination equals the query (an email trimmed and lower-cased; a phone number in E.164) gives
  `confirmed`; anything else `not_confirmed`.
- **Provider identity.** `provider` names the provider that answered (`emailIntelligence`,
  `phoneIntelligence`, `addressVerification`, `adverseMedia`), else `null`.
- **Thresholds.** Email: the evaluator's two day thresholds. Phone: risk-logic's SIM swap and port
  windows. Media: `max-article-age-days` and `max-records` (250). Address: none.
- **Media.** The article key is `article:` and the first 32 hex digits of SHA-256 over the URL;
  the content hash is SHA-256 over the URL and the stored title. An article GDELT gives no language
  is served with ISO 639-2 `und` (undetermined), because the article schema's language is not
  nullable. An article that cannot be served (not an http(s) URL, a URL over 2,048 characters, a
  domain outside 1-253 characters, an empty title) is dropped. Re-queried articles are merged with
  the first answer's, deduplicated by key. The 24 h wait is measured from the run id's time.
- **Sealed only.** Each partial type's evaluator `details` (list digests, DMARC detail, the line
  type's source, the designator patterns) is sealed under `details`, which no type schema names.

## Slice 9: `mediaQueryProblem`, the creation-time refusal (C81.2, C81.3)

Owned file: `apps/api/src/jobs/report-types/media-screening.ts`. Report creation (api-reports'
`services/reports/`) must answer 422 `report_query_invalid` for a media name with no word left
(C81.2) and a business name that is one generic word once its legal form is stripped (H13); the
run already errors `insufficient_input` for both. `mediaQueryProblem(subject, query)` gives the
same reading to the creation path: `invalid`, `empty`, `generic` or `null`. Stub: `ab64c3a4`
(always `null`).

RED (`31316c90`):

```
$ pnpm exec vitest run src/jobs/report-types/business-adverse-media.test.ts --coverage.enabled=false
     × names a query that is not the type’s, or has no word left, or one generic word
AssertionError: expected null to be 'invalid' // Object.is equality
      Tests  1 failed | 4 passed (5)
```

The case "accepts what a run screens" passes against the stub's `null`, as it must after GREEN.

GREEN (the function reads the screening's own `screenedOf`). Two of the RED test's person cases
were wrong about the contracts, not about the code, and were corrected: `{ name-first }` alone is
a valid person query (the contracts accept a first name alone), so the `invalid` case now carries
a member the person query does not have; and a person's name must hold a letter, so `empty` is
only a backstop for persons and its case was dropped (the business `empty` case stays).

```
$ pnpm exec vitest run src/jobs/report-types/business-adverse-media.test.ts --coverage.enabled=false
      Tests  5 passed (5)
```

## Pins after GREEN (C82.1, C74.1)

Written on the built jobs, so they passed at once; each was then seen failing against a mutation:
- a null MX gives `low` with `domain_rejects_mail` (a plan honesty case), and NODATA with an A
  record is a domain that exists without an MX (`email-is-valid-mx: false`, never
  `domain_not_found`). The first draft expected `email-is-valid-mx: true` for the implicit MX;
  risk-logic counts only an explicit MX, so the pin follows it. Mutation: the null MX not
  recognised and NODATA read as NXDOMAIN, giving `1 failed | 15 passed (16)`;
- a defect (a `TypeError` from a provider, not a lookup failure) is thrown even on the last
  attempt, so the framework ends the run `errored` with `execution_error` rather than the job
  recording it as a lookup gap. Mutation: `recordedFailure` swallowing every error, giving
  `1 failed | 6 passed (7)`.

```
$ pnpm exec vitest run src/jobs/report-types/email-address.test.ts src/jobs/report-types/phone-number.test.ts --coverage.enabled=false
      Tests  23 passed (23)
```

Refactor (suite green): `isRetryableLookupFailure`, unused once `recordedFailure` held the rule, is
removed from `provider-reports.ts`.

## Final gates (2026-10-27, foreground, at `4f93f370` plus the other Stage 3 agents' commits)

- `pnpm --filter @openverify/api lint`: passed.
- `pnpm --filter @openverify/api test`: the whole suite with coverage no longer fits one 10-minute
  call (9 min 29 s at Stage 1b, more tests since), so it ran as two Vitest shards with blob
  reports (7 min 24 s and 6 min 36 s), merged with `vitest run --merge-reports --coverage`, which
  applies the package's 80% gate to the whole:

  ```
  Test Files  1 failed | 307 passed (308)
       Tests  2 failed | 4425 passed (4427)
  Statements   : 96.42% ( 12665/13134 )
  Branches     : 88.27% ( 7741/8769 )
  Functions    : 98.03% ( 3091/3153 )
  Lines        : 96.47% ( 12251/12699 )
  ```

  The two failures were api-reports' `services/publish/report-config.test.ts`, whose RED commit
  (`a1d934b7`, 21:43:24) landed while shard 2 ran and whose GREEN (`8fe0cd09`, 21:45:39) landed
  before the shard reached it again; re-run alone afterwards: `Tests  2 passed (2)`.
- `pnpm typecheck` (14/14), `pnpm lint` (14/14), `pnpm format:check`: passed. (An earlier
  `pnpm --filter @openverify/api typecheck` met api-reports' in-progress
  `packages/db/src/repositories/reports.ts`; the later repo-wide run passed.)
- `pnpm test:integration`: db `59 passed (59)`; api `1 failed | 128 passed (129)`. The one
  failure is api-watchlists' untracked, in-progress 100,000-name p95 gate
  (`src/watchlists/watchlists.integration.test.ts`, C78.7), while it was still editing
  `packages/db/src/repositories/watchlists.ts`; nothing of this slice is in it.
- e2e (the three calls of `pnpm e2e`, under `/tmp/openverify-e2e.lock`): mocked flow
  `69 passed (33.1s)`; full stack shard 1/2 `42 passed (5.5m)`; shard 2/2 `40 passed (8.3m)`.
