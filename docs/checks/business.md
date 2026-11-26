# Business registry and business website checks

This page describes the `database-business` and `business-website` verification types as Phase 5 ships them: the values a user enters, the registers and the website sources, the checks, and what a pass means. The binding contracts are C52.3, C61 and C63 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

**What reaches the network.** GLEIF (the LEI register, CC0) and RDAP (domain registration data) are on by default: an install that sets no binding asks them. Companies House and SEC EDGAR are asked only once the operator sets their credential. Nothing is asked of the website itself: OpenVerify never fetches the customer's site. In CI and in the end-to-end stack every one of these is bound to its sandbox provider or turned off; no test reaches a register.

## Contents

- [What a pass means](#what-a-pass-means)
- [The steps and the entered values](#the-steps-and-the-entered-values)
- [The registers](#the-registers)
- [Status](#status)
- [The registry checks](#the-registry-checks)
- [Associated persons](#associated-persons)
- [The website sources](#the-website-sources)
- [The website checks](#the-website-checks)
- [What the verification serves](#what-the-verification-serves)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Known limits](#known-limits)

## What a pass means

- **Business registry:** a public register holds an active business whose name matches the one entered, together with its registration number, or with its address (by default). It does not mean the user acts for that business: unless the step collects associated persons and they match, anyone who knows a company's public details can enter them. A register that does not list a business (a sole trader, a partnership, a small company GLEIF never saw) gives no failure: the verification goes to review.
- **Business website:** the website's host resolves to a public internet address. That is the required core. The advisory domain age says how long ago the domain was registered, where its registry answers RDAP. Neither says who runs the site, that it belongs to the business, or that it is safe: the malicious-website check (disabled by default) needs the operator's own feeds.

## The steps and the entered values

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `database_business` | `database-business` | 3 | `collectAssociatedPersons` (false), `maxAttempts` |
| `business_website` | `business-website` | 3 | `maxAttempts` |

The user enters values through `POST /api/v1/flow/verifications/:id/inputs` (C52.3), then submits. Bodies are kebab-case and strict:

- **Business:** `business-name` (1–300 characters) and `country-code` (ISO 3166-1 alpha-2), and optionally `registration-number`, `lei`, the address parts (`address-street-1`, `-street-2`, `-city`, `-subdivision`, `-postal-code`), and `associated-persons`. A registration number is checked per register: for Companies House (GB) eight digits or two letters and six digits (`01234567`, `SC123456`); for EDGAR (US) a numeric CIK; otherwise 1 to 20 letters and digits. An LEI must pass its ISO 17442 check digits. Associated persons (0 to 10 of `{ name-first, name-last, birthdate? }`, the birth date as `YYYY-MM` or `YYYY-MM-DD`) are refused unless the step collects them. An input every configured match group names is required; the flow view's guidance lists these `required-inputs` with `collect-associated-persons`.
- **Website:** `website-url`, `http` or `https`, at most 2,048 characters, a host with a dot, no IP address, no credentials, port 80 or 443; and optionally `business-name`.

Values are stripped of control and bidirectional characters, trimmed, sealed at rest and never echoed. A refusal is one 422 with a JSON Pointer per member (`/associated-persons/0/name-first`), which both clients show at the field. Both types allow three attempts, because a mistyped number or URL is the user's to correct (decision 50).

## The registers

The worker asks the bound registers in order, the national register of the business's country first, then GLEIF, and stops at the first that holds a record (C61.1):

| Register | Bound when | Covers | A miss is |
|---|---|---|---|
| Companies House | `OPENVERIFY_COMPANIES_HOUSE_API_KEY` is set (production environments; `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY` targets its sandbox service for sandbox environments) | GB | authoritative for a company number |
| SEC EDGAR | `OPENVERIFY_SEC_EDGAR_USER_AGENT` is set (the operator's name and contact address, as EDGAR's fair-access rules ask) | US | not authoritative |
| GLEIF | always, unless the binding says otherwise | every country with LEIs | not authoritative |

The binding is `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_{SANDBOX,PRODUCTION}`, read by the worker only: a list of `gleif`, `companies-house`, `sec-edgar`; `sandbox` alone (sandbox environments only); or `none`. Unset or empty means GLEIF plus every national register whose credential is set; naming a register without its credential stops the worker at startup, naming the variable only.

How each is read:

- **GLEIF:** an entered LEI is read directly. Otherwise the register is searched by registration number within the country, then by legal name, and the closest record by name is kept (none below a partial match), because GLEIF's name filter also returns names that only contain the words.
- **Companies House:** a company number is read directly, and its absence is authoritative; otherwise a name search keeps the closest of 20 results. The record's officers and its individual persons with significant control are read with it only when the step collects associated persons and their check is enabled; otherwise none is fetched (data minimisation).
- **EDGAR:** a numeric registration number is the CIK; otherwise the closest name among the listed companies of `company_tickers.json` (kept in memory for a day). Only listed companies can be found by name (decision 47); EDGAR reports no status and no persons.

Every request goes through the outbound HTTP client: HTTPS, private networks refused, no redirect followed, size and content-type caps, errors without a URL, query or key (C54.6). Each source is paced across the whole install through Valkey by the worker's GCRA limiter, one request per interval with no burst: GLEIF one request a second, Companies House one per 500 ms per environment kind (its 600 per five minutes), EDGAR ten a second. A request waits at most 10 seconds for its turn, then the job retries. A 404 is a miss, 429 and 5xx are retried, anything else is `execution_error` once the attempts are spent.

**The query cache** keeps, for one hour, only what a query found: a record id, or a miss and whether it was authoritative. It keeps no name, status or address, and the record is always read again by its id, so the officers and persons with significant control are re-read for every verification that collects them (C61.2, P08).

## Status

`database_business_active_business_detection` maps each register's status (C61.2, H12):

| Register value | Answer |
|---|---|
| GLEIF `ISSUED` with entity status `ACTIVE` | active |
| GLEIF `LAPSED`, `PENDING_ARCHIVAL` | `status_not_available` (flag `lei-lapsed`), or `business_inactive` with `fail-on-lapsed-lei` |
| GLEIF `RETIRED`, `MERGED`, entity status `INACTIVE`, an entity expiration | `business_inactive` |
| GLEIF `ANNULLED`, `DUPLICATE` | `no_registry_record` |
| Companies House `active`, `open`, `registered` (an active proposal to strike off is flagged `active-proposal-to-strike-off`) | active |
| Companies House `dissolved`, `liquidation`, `receivership`, `administration`, `insolvency-proceedings`, `voluntary-arrangement`, `converted-closed`, `closed`, `removed` | `business_inactive` |
| EDGAR | `status_not_available` |
| any other value, or none | `status_not_available` (flag `status-unmapped`), never active |

A lapsed LEI is often an unpaid renewal of a live business, so by default it goes to review.

## The registry checks

| Check | Default | Fails with | `not_applicable` with |
|---|---|---|---|
| `database_business_identity_comparison` | required | `low_confidence_match` (fraud) | `registration_number_not_found`, `no_registry_record`, `insufficient_data` |
| `database_business_active_business_detection` | required | `business_inactive` (fraud) | `no_registry_record`, `status_not_available` |
| `database_business_associated_persons_comparison` | advisory | `associated_person_not_on_register` (fraud) | `not_requested` (non-blocking), `source_has_no_persons`, `no_registry_record` |
| `database_business_enabled_country_detection` | required | `country_not_enabled` (user behaviour) | `no_allowlist` (non-blocking) |
| `database_business_service_available_detection` | required | none | `provider_not_configured`, `execution_error` |

- **Identity:** the best level over the record's legal name and each of its other names (transliterations included), its registration number and its registered address, against the configured match groups (C58.1). By default a group of the name (partial) and the number (full) and a group of the name and the address (both partial): any group met passes, every group unmet fails, otherwise `insufficient_data` (review). A registration number the authoritative register lacks answers `registration_number_not_found` (review: a one-digit slip is not fraud). Any other miss answers `no_registry_record`. Business names compare with legal forms canonicalised (Ltd and Limited, GmbH written apart), `&` read as "and", a leading "The" and punctuation ignored.
- **Enabled country:** the type's `allowed-countries`, else `no_allowlist`.
- **Service available:** passes when a register covering the country answered, found or not; outside every bound register's countries it answers `provider_not_configured` (flag `country-not-covered`).

## Associated persons

When the step collects them, each person entered must match an active officer or an individual person with significant control of the record, by name (at `min-match-level`, the register's `SURNAME, Forenames` reordered) and by month and year of birth, compared exactly. Companies House publishes only the month and year of a birth date, so a full date entered is compared on those. A name that matches with a birth month that cannot be compared answers `input_missing` (review).

Who is on the register: a company's officers (directors and secretaries) and its persons with significant control, individuals who hold more than 25% of the shares or votes, can appoint the board, or otherwise control the company. A shareholder below that threshold who is not an officer is not listed, so an owner can be "not on the register" for a reason the register's rules give. The check is advisory for that reason. Corporate officers and corporate controllers are left out, since they are companies, and only the first 100 of each list are read.

## The website sources

- **Resolution:** the worker's DNS resolver asks for the host's A and AAAA records (3 s, two tries); an address counts only when it is public (outside the special-purpose ranges the webhook guard also refuses; IPv6 must be global unicast). No HTTP request is made.
- **Domain age** (`OPENVERIFY_PROVIDER_DOMAIN_AGE_*`: `rdap` when unset or empty, `sandbox`, `none`): our RDAP client finds the registry through IANA's bootstrap file (HTTPS services only, kept as long as its `max-age` or `Expires` says, between one hour and seven days, else a day), then asks at most four names, trimming labels from the left, never the bare TLD. Only the host itself, or the host without a leading `www.`, gets a registration date: when only a shorter name answers, the site lives on a platform's subdomain and is not aged by the platform (`domain_age_unavailable`, flag `subdomain`). Dates are kept for a day under the SHA-256 of the domain, and each RDAP host gets one request a second. No WHOIS, no registrar referral is followed.
- **Malicious websites** (`OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_*`: `feed-list` or `sandbox`): `data/malicious-feeds.json` ships empty, because the feeds commonly cited are not free for commercial use (URLhaus is not CC0; Safe Browsing and the free OpenPhish feed are non-commercial). An operator adds up to 32 feeds of their own (HTTPS, `domains` or `urls`, a category of `malware`, `phishing` or `spam_source`, a refresh interval of 5 minutes to 7 days, and the feed's terms); the worker's repeatable job refreshes them into Valkey as host names only. A `domains` feed matches the host and its parents, a `urls` feed the exact host. A feed older than twice its interval, or never loaded, answers `execution_error`; no feed at all is `provider_not_configured`.
- **Backlinks** (`OPENVERIFY_PROVIDER_BACKLINK_*`): only a sandbox provider exists; no production source ships.

## The website checks

| Check | Default | Fails with | `not_applicable` with |
|---|---|---|---|
| `business_website_resolution_detection` (ours) | required | `domain_not_resolving` (user behaviour: a mistyped URL) | `execution_error` |
| `business_website_domain_age_detection` | advisory | `domain_recently_registered` (fraud), below `min-domain-age-days` | `domain_age_unavailable` (flags `subdomain`, `no-rdap-service`, `not-found`, `no-registration-date`, `future-date`) |
| `business_website_malicious_website_detection` | disabled | `malware`, `phishing`, `spam_source` | `provider_not_configured`, `execution_error` |
| `business_website_backlink_detection` | disabled | `backlinks_below_threshold` | none |

Metadata holds counts, routes, flags and public dates only: the resolution's `route`, `address-count` and `public-address-count` (never an address), the domain's `registered-at` (a day) and `age-days`, the feeds' `feed-count`, and `backlink-count` with `backlink-threshold`.

## What the verification serves

Attributes (C52.8, server and console APIs, never the flow API; personal members masked without `pii:view` and `null` after redaction):

- **Business registry:** the entered `business-name`, `registration-number`, `lei`, address parts and `associated-persons`, and the register's `registry-record-id`, `registry-legal-name` (personal data: a sole trader's name), `registry-source` and `registry-status`. The record's summary (id, legal name, status, jurisdiction, registered address) is sealed in `business_registry_records`; officers and persons with significant control are never stored.
- **Business website:** `website-url` and `website-domain` (personal data), and `domain-registered-at`, the domain age check's registration day at midnight UTC (`null` when the age was unavailable, and after a redaction, which clears check metadata).

## Configuration

| Check | Key | Default | Basis |
|---|---|---|---|
| identity | `match-groups` (1–5 groups over `name`, `registration-number`, `address`) | name partial with number full; name partial with address partial | ours |
| active | `fail-on-lapsed-lei` | false | ours: a lapsed LEI is often an unpaid renewal |
| associated persons | `min-match-level` (`partial`, `full`) | `partial` | ours |
| domain age | `min-domain-age-days` (1–3,650) | 90 | ours |
| backlinks | `min-backlinks` (0–100,000) | 10 | ours |

The business type also takes the type-level option `allowed-countries`. Every default is provisional and recorded as `threshold-basis` on the result.

## Privacy

Officer and person-with-significant-control data is personal data wherever it comes from (Companies House sets no reuse rules, but data protection law still applies). It stays in the worker's memory for the one comparison: the cache holds record ids and misses only, and a test scans every Valkey key and value the business and website paths write for the sandbox officers' and the entered persons' names and birth months. The Valkey keys the paths write:

| Key (under `openverify:`) | Holds | Lives |
|---|---|---|
| `kyb-registry:<source>:<sha256 of the query>` | a record id, or a miss and whether it was authoritative | 1 hour |
| `rate-limit:pacing:<rule>:<sha256 of the key>` | the GCRA limiter's next turn (the worker) | one interval |
| `pacing:<rule>:<sha256 of the key>:<slot>` | random tokens (only without the limiter) | two intervals |
| `rdap:bootstrap` | the TLD to RDAP service table | its `max-age` or `Expires`, 1 hour to 7 days (1 day without either) |
| `rdap:date:<sha256 of the domain>` | a registration date | 1 day |
| `malicious-feed:<id>` and its generations | host names and the refresh's time and count | twice the interval plus 10 minutes |

Rows follow the inquiry's retention; set `inquiry-retention-days`, since the default keeps inquiries forever.

## Known limits

- GLEIF lists only businesses that obtained an LEI, so it misses most small ones; sole traders and partnerships are on no company register. Both go to review, never to a failure.
- EDGAR is searched by name among listed companies only, scoring every one (about 0.7 s a lookup); its full CIK index is later (H31a). EDGAR has no status, so its businesses' active check goes to review.
- Companies House officers and persons with significant control: only the first 100 of each are read.
- The answer shapes of Companies House and EDGAR follow their published references and were not checked against the live services, which need a key or a contact; GLEIF's were observed on 2026-10-24. Re-check them, and each source's terms, before relying on them.
- RDAP does not cover every TLD, and never a subdomain on a platform; both are `domain_age_unavailable`.
- While Valkey is down, each worker paces itself alone.

The sandbox register, the sandbox website names and the officers they answer with are listed in `docs/checks/sandbox-providers.md`. The full-stack spec `e2e/tests/kyb.spec.ts` drives them: a business found active through the hosted flow's form, the endings `0000`, `8888` and `7777`, `old.example` through the website form, and `new.example`.
