# Sandbox providers

Three government ID checks need licensed data or credentials (A-tier, ADR 0002): `id_aamva_database_lookup`, `id_public_figure_detection` and `id_age_inconsistency_detection`. So do three selfie checks (Phase 4, C44): `selfie_age_comparison`, `selfie_public_figure_detection`, and the provider half of `selfie_suspicious_entity_detection`. OpenVerify ships a provider port for each (`apps/api/src/ports.ts`) and a **deterministic sandbox provider** (`apps/api/src/providers/sandbox.ts`), so tests and demos can reach every outcome without real data. No real adapter ships (C35, C44). The [selfie providers](#selfie-providers) are described in their own section below.

Phase 5 (C63) adds four more provider kinds with a sandbox each in Workflow 5A: the SMS sender of the phone code (`sms`), the database records (`database`), the AAMVA type, which shares the `aamva` binding of the government ID lookup, and the EVM RPC of contract wallets (`evmRpc`). Workflow 5B adds four for the business checks: the business registers (`businessRegistry`), the domain age (`domainAge`), the malicious-website feeds (`maliciousWebsite`) and the backlinks (`backlink`), and the deterministic Utopia trust anchor that `seed:dev` puts in the chip trust store. Their magic values are in [Phase 5 providers](#phase-5-providers). A sandbox provider answers from these documented rules only; no check special-cases a fixture beyond them (ADR 0002).

## Binding a provider

Each provider is bound per environment kind with one variable:

| Check | Sandbox environments | Production environments |
|---|---|---|
| `id_aamva_database_lookup` | `OPENVERIFY_PROVIDER_AAMVA_SANDBOX` | `OPENVERIFY_PROVIDER_AAMVA_PRODUCTION` |
| `id_public_figure_detection` | `OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX` | `OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION` |
| `id_age_inconsistency_detection` | `OPENVERIFY_PROVIDER_AGE_ESTIMATE_SANDBOX` | `OPENVERIFY_PROVIDER_AGE_ESTIMATE_PRODUCTION` |
| `selfie_age_comparison` | `OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_SANDBOX` | `OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_PRODUCTION` |
| `selfie_public_figure_detection` | `OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_SANDBOX` | `OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_PRODUCTION` |
| `selfie_suspicious_entity_detection` | `OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_SANDBOX` | `OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_PRODUCTION` |
| `phone_number_otp_comparison` (the SMS that carries the code) | `OPENVERIFY_PROVIDER_SMS_SANDBOX` | `OPENVERIFY_PROVIDER_SMS_PRODUCTION` |
| the `database_*` checks | `OPENVERIFY_PROVIDER_DATABASE_SANDBOX` | `OPENVERIFY_PROVIDER_DATABASE_PRODUCTION` |
| the `aamva_*` checks | `OPENVERIFY_PROVIDER_AAMVA_SANDBOX` (shared with `id_aamva_database_lookup`) | `OPENVERIFY_PROVIDER_AAMVA_PRODUCTION` |
| `crypto_wallet_address_comparison` (contract wallets) | `OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX` | `OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION` |
| the `database_business_*` checks | `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX` | `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION` |
| `business_website_domain_age_detection` | `OPENVERIFY_PROVIDER_DOMAIN_AGE_SANDBOX` | `OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION` |
| `business_website_malicious_website_detection` | `OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_SANDBOX` | `OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION` |
| `business_website_backlink_detection` | `OPENVERIFY_PROVIDER_BACKLINK_SANDBOX` | `OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION` |

- A variable takes `sandbox` or is empty, except those that also name a real adapter: `sms` takes `twilio` ([phone and email checks](contact.md#channels-and-configuration)), `evmRpc` takes `json-rpc` ([crypto wallet checks](crypto-wallet.md#contract-wallets-and-the-evm-rpc)), `businessRegistry` takes a list of `gleif`, `companies-house` and `sec-edgar`, or `none`, `domainAge` takes `rdap` or `none`, and `maliciousWebsite` takes `feed-list` ([business checks](business.md#the-registers)). Two kinds are **on when empty**: `businessRegistry` means GLEIF plus every national register whose credential is set, and `domainAge` means RDAP (F11), so `none` turns them off. `.env.example` binds `sandbox` for sandbox environments and leaves production empty. Each process validates the kinds it reads: the API reads `sms`, `database` and `aamva`, the worker every kind but `sms` (C63).
- **A sandbox provider bound to production refuses to start** the API and the worker (ADR 0002 §3d), as does any value other than `sandbox`. The value is never echoed.
- **Unbound** (empty, in either environment kind): the check answers `not_applicable`/`provider_not_configured`. A required check then sends the verification to review (ADR 0002 §3e). The one exception is `selfie_suspicious_entity_detection`, which falls back to its built-in heuristic without a provider. An unbound `sms` sender keeps a phone step from being published (`otp_channel_not_configured`), and in a production environment an unbound `database` or `aamva` provider keeps those steps from being published unless the type sets `accept-review-without-provider` (C50.4).
- **The e2e stack** (`e2e/src/env.ts`) leaves the ten C44 variables empty, whatever the shell exports, and two e2e specs rely on it (`government-id-review`, `selfie-review`). It binds `sms`, `database`, `aamva`, `evmRpc`, `businessRegistry`, `domainAge`, `maliciousWebsite` and `backlink` to `sandbox` for sandbox environments, sets `none` for the production register and domain age and leaves the other production kinds empty (C63, V23), with no Twilio credential, RPC URL, register key or EDGAR contact, and the trust-store refresh off, so no network provider is ever bound; the `phone-otp`, `database`, `crypto-wallet` and `kyb` specs read the sandbox answers below, and `nfc-chip` the Utopia anchor. `id_aamva_database_lookup` stays disabled in the default template, so binding `aamva` changes no Phase 3 result.
- The A-tier checks are disabled in the default template; enable them in a template to use them.

The worker asks a provider only when its check is enabled and a provider is bound for the environment's kind. The check then answers `input_missing` or `feature_absent` where the document falls short of what the provider needs.

## Magic values

The sandbox providers look at no image and call nothing. Their answer depends only on the **last four characters of the extracted identification number**, upper-cased and stripped to `A-Z0-9`. For example, `UT4829163` ends in `9163`, and `D 1234-0000` ends in `0000`.

### AAMVA database lookup

Reached only for an established US AAMVA driver licence or ID card (its PDF417 header). Any other established document answers `feature_absent` before the provider is asked; a document without an identification number answers `input_missing`.

| Number ends in | Provider answer | Check result |
|---|---|---|
| `0000` | no match, on `name-last` and `birthdate` | `failed`, `aamva_record_mismatch`, `mismatched-fields: ["name-last", "birthdate"]` |
| `0001` | no match, on `name-last` (Phase 5, C59.4) | `failed`, `aamva_record_mismatch`, `mismatched-fields: ["name-last"]` |
| `0002` | no match, on `address-postal-code` (C59.4) | `failed`, `aamva_record_mismatch`, `mismatched-fields: ["address-postal-code"]` |
| `5555` | the jurisdiction does not take part in DLDV (C59.4) | `not_applicable`, `aamva_jurisdiction_not_participating` (blocks a required check: review) |
| `9999` | no record | `failed`, `aamva_record_not_found` |
| anything else | match | `passed` |

The `0001`, `0002` and `5555` endings are new in Phase 5: they changed the government ID sandbox answers for those endings, which before were a match. The same endings answer the [AAMVA type](#aamva-dldv).

### Public figure

Needs the ID portrait (no portrait: `input_missing`).

| Number ends in | Provider answer | Check result |
|---|---|---|
| `7777` | a gallery match | `failed`, `public_figure_match` |
| `4040` | an empty gallery | `not_applicable`, `no_reference_data` (blocks a required check) |
| anything else | no match | `passed` |

### Age estimate

Needs a birth date and the ID portrait (otherwise `input_missing`). The provider's estimate is:

- the age the birth date gives on the evaluation day (30 when the provider gets no readable birth date);
- plus **25 years** when the number ends in **`8888`**;
- always with confidence 0.9.

The check compares that estimate with the age from the birth date, against `max-age-difference-years` (default 10):

| Number ends in | Difference | Check result (default threshold) |
|---|---|---|
| `8888` | 25 years | `failed`, `apparent_age_inconsistent` |
| anything else | 0 years | `passed` |

The ages themselves stay out of the result; only their difference is kept.

## Selfie providers

The selfie sandbox providers (C44) look at no image and call nothing either. Their answer depends on **tokens in the inquiry's `reference-id`**, which the customer chooses when creating the inquiry. The reference id is lower-cased first; a token must stand on its own, after the start or a character other than `a-z0-9`, and not be continued by a letter, a digit or (for the two word tokens) a hyphen:

| Token | Regular expression (on the lower-cased reference id) | Provider | Answer |
|---|---|---|---|
| `sandbox-public-figure` | `(?:^\|[^a-z0-9])sandbox-public-figure(?![a-z0-9-])` | public figure | a match, score 0.97 |
| `sandbox-suspicious-entity` | `(?:^\|[^a-z0-9])sandbox-suspicious-entity(?![a-z0-9-])` | suspicious entity | flagged, score 0.97 |
| `sandbox-age-<n>`, `n` 0–150 | `(?:^\|[^a-z0-9])sandbox-age-(\d{1,3})(?![0-9])` | age estimate | age `n` |

- **Otherwise** the public-figure provider answers no match (score 0.03), the suspicious-entity provider not flagged (score 0.03), and the age provider the age the **compared ID's birthdate** gives on the evaluation day (the inquiry's government ID extraction), or **30** without a readable birthdate. A `sandbox-age-` value above 150, or of four digits, is no magic value.
- **Precedence.** When a reference id carries several tokens, only the first in the order public figure, suspicious entity, age decides; the other providers give their ordinary answer. For example, `acme-42 sandbox-public-figure sandbox-age-17` makes the public-figure provider match and the age provider answer from the birthdate.
- **What a provider receives.** Every selfie provider gets the centre image bytes only (`{ image }`). A sandbox provider (`sandbox: true`) also gets `{ referenceId, birthdate }`; a real adapter never does. The birthdate is decrypted from the extraction only when `selfie_age_comparison` is enabled; otherwise it is `null`.
- **What the checks do with the answers:**
  - `selfie_public_figure_detection`: a match fails with `public_figure_match`;
  - `selfie_suspicious_entity_detection`: flagged fails with `provider_flagged`, the score its confidence (with a provider bound, the built-in heuristic does not run; an upload marked `trainedAlgorithmicMedia` or `compositeSynthetic` still fails outright);
  - `selfie_age_comparison`: the age fails only beyond `min-age`/`max-age`, or away from the age by the compared ID's birthdate, by more than `buffer-years` (default 3). For example, without a compared ID, `sandbox-age-17` passes a `min-age` of 18 (one year, inside the buffer) and fails a `min-age` of 21 with `age_outside_limits`. With a compared ID, a magic age more than 3 years from the birthdate's age also fails, with `age_inconsistent_with_birthdate`. Without limits and without a birthdate it answers `no_reference_data`.
- A centre without a face answers `input_missing` for the age and public-figure checks, whatever the provider said; the suspicious-entity check takes the provider's answer as it is.

## Phase 5 providers

### SMS sender and sink

The sandbox SMS sender (`OPENVERIFY_PROVIDER_SMS_SANDBOX=sandbox`, sandbox environments only; C55.10, C55.11) sends nothing. It keeps each code it would have sent, with the number's blind index (never the number) and the time, in the Valkey list `openverify:sandbox-sms:<environment id>`: at most 100 entries, for 900 seconds. A test harness reads them with an API key of the sandbox environment holding the `sandbox:read` scope (admin and developer roles):

```
POST /api/v1/sandbox/sms-messages/search
{ "phone-number": "+12025550147" }

{ "data": [ { "code": "042817", "sent-at": "2026-10-23T12:00:05.000Z" } ] }
```

- The number goes in the body, never in a URL, and the stored API log redacts `code`.
- Newest first; spaces, dots, hyphens and parentheses in the number are ignored; a number that is not E.164 once they are removed finds nothing.
- The route exists only while the sandbox sender is bound and the API is not in production mode (it is absent from that mode's `/openapi.json`), and a production environment's key gets 404.
- Every code is a real random code: the sandbox changes where the code goes, never what it is or how it is checked.

Email has no sandbox sender: the API's mailer sends the code, and in development (and in the e2e stack) Mailpit receives it.

### Reserved mail domains

In a **sandbox** environment, `email_address_mx_detection` answers without a DNS query for the reserved names of RFC 2606 (C56): a domain under `.test` or `.example` takes mail (`passed`, `route: reserved`), and one under `.invalid` fails `domain_not_found`. Other domains are looked up in DNS as in production. The disposable-domain check has no sandbox rule: use `deny-domains` and `allow-domains` (the `email-otp` e2e spec denies `disposable.test`).

### Database provider

The sandbox database provider (`OPENVERIFY_PROVIDER_DATABASE_SANDBOX=sandbox`; C59.2) echoes the values it is asked about as a record that is **never authoritative** and covers every country, so a miss is review, never a failure. A token in the inquiry's `reference-id` changes the record. Tokens follow the selfie tokens' shape (lower-cased, after the start or a character other than `a-z0-9`, not continued by a letter, digit or hyphen); when several are present, the first in this order decides:

| Token | The record | Under the default template |
|---|---|---|
| `sandbox-database-not-found` | none | `database_identity_comparison` `not_applicable`, `no_matching_record` (review) |
| `sandbox-database-name-mismatch` | the surname `Quillfeather` (`Marrowstone` when that was entered) | `failed`, `low_confidence_match` |
| `sandbox-database-nickname` | the formal given name of an entered nickname (Bob: Robert), else a nickname of an entered formal name | `passed` (a partial name, method `nickname`) |
| `sandbox-database-address-mismatch` | street `88 Synthetic Lane` (or `99 Placeholder Avenue`), postal code digits moved by five | `failed`, `low_confidence_match` |
| `sandbox-database-address-variant` | street words abbreviated, or spelled out (Street and St, Avenue and Ave, Road, Boulevard, Drive, Lane, Court, Place, Apartment, Suite) | `passed` |
| `sandbox-database-birthdate-mismatch` | the birth date a year later (29 February becomes 28 February) | `failed`, `low_confidence_match` |
| `sandbox-database-birthdate-partial` | the birth month only (`YYYY-MM`) | `passed` (a precision-limited birth date) |
| `sandbox-database-no-birthdate` | no birth date (a thin file) | `not_applicable`, `insufficient_data` (review) |
| none | the values asked about | `passed` |

An identification number comes back only as `identification-number-match: true`. The record carries the fields the step collected; the provider never sees the others.

### AAMVA DLDV

The AAMVA type (`aamva`, C59.4) uses the same sandbox provider and endings as `id_aamva_database_lookup` above, read from the last four characters of the entered (or copied) `identification-number`:

| Number ends in | `aamva_identity_comparison` under the default template |
|---|---|
| `0000` | `failed`, `record_mismatch`, on `name-last` and `birthdate` |
| `0001` | `failed`, `record_mismatch`, on `name-last` |
| `0002` | `failed`, `record_mismatch`, on `address-postal-code` (`passed` when `ignored-fields` holds it) |
| `5555` | the silent step is skipped; the form goes to review (`jurisdiction_not_participating`), or is skipped with `on-jurisdiction-not-participating: skip` |
| `9999`, or no number | `failed`, `record_not_found` |
| anything else | `passed` |

### EVM RPC

The sandbox EVM RPC (`OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX=sandbox`; C57.5) serves every `eip155` chain and nothing else (`provider_not_configured` off EVM chains):

- `eth_getCode` answers synthetic code (`0x5f5ffd`) for the contract wallet `0x00000000000000000000000000000000000c0de5` (in any case) and `0x` for every other address, so a signature by another key fails `signature_address_mismatch`.
- ERC-1271 `isValidSignature` on that contract answers the magic value `0x1626ba7e` for a 65-byte signature of the digest by its owner key, and `0xffffffff` otherwise. The owner key is derived from the label `sandbox/contract-wallet-owner` (`sha256("openverify/test-wallet/sandbox/contract-wallet-owner")`, address `0x0e956ba07dc897863a2413a7130e9183a0a991b1`); only that address is in runtime code, never the key.
- The contract wallet passes only with `allow-contract-wallets` (or an equal expected address); otherwise it answers `contract_wallet_not_allowed` (review).

### Business register

The sandbox register (`OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX=sandbox`, alone; C61.6) covers every country and answers authoritatively. The **last four letters or digits of the registration number**, upper-cased, choose its answer:

| Number ends in | The register's answer | Under the default template |
|---|---|---|
| `0000` | another business: "Marrowstone Placeholder Holdings" at "88 Synthetic Lane", number `00000001` (or "Quillfeather Placeholder Trading", "99 Placeholder Avenue", `00000002` when those were entered) | `database_business_identity_comparison` `failed`, `low_confidence_match` |
| `9999` | not found | `not_applicable`, `registration_number_not_found` (review) |
| `8888` | the entered business, `dissolved` | `database_business_active_business_detection` `failed`, `business_inactive` |
| `7777` | the entered business, whose persons are `MARROWSTONE, Quentin` (born 1968-11) only | `database_business_associated_persons_comparison` `failed`, `associated_person_not_on_register` (advisory: the verification passes) |
| anything else, or no number | the entered business, `active`, with the officer `PLACEHOLDER, Ada` (born 1980-04) and the person with significant control `TESTERTON, Robin` (born 1975-09) | `passed` |

The register cannot see the persons a user enters, so an associated person passes only as one of the listed ones, with that birth month. The record id is the registration number, else `sandbox-` and twelve hex characters of a digest of the country, name and LEI. A Companies House number must still have its shape (`12340000`, not `0000`).

### Website names

In a **sandbox** environment, `business_website_resolution_detection` answers without a DNS query for the reserved names of RFC 2606 (C61.3, as for mail): a host under `.example` or `.test` resolves (`passed`, `route: reserved`), and one under `.invalid` fails `domain_not_resolving`. The sandbox website providers (C61.6) read the host without a leading `www.`:

| Host | Domain age | Malicious website | Backlinks |
|---|---|---|---|
| `new.example` | registered 3 days ago: `domain_recently_registered` (advisory) | not listed | 0 |
| `old.example` | registered 20 years ago: `passed` | not listed | 0 |
| a subdomain of either (`shop.old.example`) | `domain_age_unavailable`, flag `subdomain` | not listed | 0 |
| `nordap.test` | `domain_age_unavailable`, flag `no-rdap-service` | not listed | 0 |
| `malicious.example` and its subdomains | `domain_age_unavailable`, flag `not-found` | listed for `phishing` by the feed `sandbox` | 0 |
| `backlinks.example` (and `www.`) | `domain_age_unavailable`, flag `not-found` | not listed | 250: `passed` |
| any other host | `domain_age_unavailable`, flag `not-found` | not listed | 0: `backlinks_below_threshold` at the default 10 |

The ages are counted back from the start of the current UTC day, so `new.example` is three whole days old at any moment of the day. The malicious-website and backlink checks are disabled in the default template.

### Chip trust anchor

`seed:dev` (`pnpm --filter @openverify/api seed:dev`, refused in production mode) inserts the **Utopia** test CSCA of `@openverify/emrtd/testing`: country `UT`, built from the fixed seed `openverify/emrtd/utopia-csca/v1` (an explicit-parameter brainpoolP256r1 key), valid from 1 January of the previous UTC year for 16 years, so re-running the seed within a year finds the same certificate. It is marked sandbox-only, listed by the enabled source `openverify-sandbox`, and comes with a CRL current for 90 days that each run of the seed renews (C62.8). Chips signed under it pass passive authentication in sandbox environments only: the production loader leaves sandbox-only anchors out, and a `UTO` chip in a production environment fails `specimen_issuer` before anything else is judged. The seed's JSON output names the anchor (`sandboxTrustAnchor`). Build such chips with `buildUtopiaChip` (see `docs/checks/nfc.md`).

## Phase 6 reports

Phase 6 (C83) adds five provider kinds for the [report types](../reports/README.md), each with a deterministic sandbox provider, and two synthetic lists that `seed:dev` imports. The report sandboxes answer from the documented rules below only; no report special-cases a value beyond them (ADR 0002, ADR 0005).

| Kind | Used by | Sandbox environments | Production environments | Real adapter |
|---|---|---|---|---|
| `adverseMedia` | `adverse-media`, `business-adverse-media` | `OPENVERIFY_PROVIDER_ADVERSE_MEDIA_SANDBOX` | `OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION` | `gdelt-doc` (needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`) |
| `emailIntelligence` | `email-address` | `OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_SANDBOX` | `OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION` | `hibp` (`OPENVERIFY_HIBP_API_KEY`) |
| `phoneIntelligence` | `phone-number` | `OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_SANDBOX` | `OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION` | `twilio-lookup` (`OPENVERIFY_TWILIO_LOOKUP_*`) |
| `addressVerification` | `address-lookup` | `OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_SANDBOX` | `OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_PRODUCTION` | `smarty` (`OPENVERIFY_SMARTY_AUTH_*`) |
| `cryptoExposure` | the exposure block of `crypto-address-watchlist` | `OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_SANDBOX` | `OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_PRODUCTION` | none in Phase 6 |

- The worker alone reads these kinds and their credentials. Unbound is the default: a media report then errors `provider_not_configured`, and the email, phone and address reports list the provider's fields in `unavailable-fields` with `provider_not_configured`. A sandbox value on a production variable stops the worker.
- **The e2e stack** binds all five to `sandbox` for sandbox environments and none to production, with no vendor credential, no EU token, no Wikidata contact, GDELT never acknowledged and the list refresh off; the lists reach it only through `seed:dev` and `watchlists:sync --import`, which make no request. The `report-*` specs read the values below.

### Sandbox lists

`seed:dev` imports two synthetic lists into the sandbox-only sources (`origin: import`), and the seeded sandbox templates select only them. They are static and never stale. Every entry is fictional; the committed files are in `packages/watchlist/fixtures/`, generated by `@openverify/watchlist/testing` (`SANDBOX_WATCHLIST_MAGIC`, `SANDBOX_PEP_MAGIC`).

| Entry | List | What screens it |
|---|---|---|
| `SBX-1001` "Avery Sandbox Quillfeather", born 1980-04-12, GB, passport `SBXP12345`, with a Cyrillic name and the weak alias "Avy Quill" | `openverify-sandbox` | a `watchlist` report on `Avery` `Quillfeather` (`1980-04-12`) |
| `SBX-1002` "Rowan Fixturedale" | `openverify-sandbox` versions 2-4 | version 2 adds the entry, version 3 changes its birth date (a dismissal lapses), version 4 adds a programme (notify-on-change); query `Rowan` `Fixturedale`, without a birth date |
| `SBX-2001` "Sandbox Sanctioned Holdings Ltd", LEI `5299000SANDBOXLEI047`, registration `SBX00000001` (GB) | `openverify-sandbox` | a `business-watchlist` report by name or LEI |
| `SBX-3001` vessel "Sandbox Voyager", IMO `9999993`, MMSI `100999993` | `openverify-sandbox` | a `business-watchlist` report by IMO, whatever `entity-kinds` says |
| `SBX-2002` "Sandbox Listed Party", with the EIP-55 example address `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed` (ETH), the BIP-173 example address (XBT) and a TRON-format address (USDT) | `openverify-sandbox` | a `crypto-address-watchlist` report on one of them (published test vectors, not any party's wallet) |
| `SBX-2003` "Corvanel Sectoral Ironworks" (GB), listed only on the Sectoral Sanctions Identifications List under programme `SANDBOX-SSI-1` (K19, Workflow 9D) | `openverify-sandbox` | a `business-watchlist` report by name: the console shows that list under "Other lists", never as an SDN-level block |
| `Q-test-1001` head of government "Marlowe Testerton" (class 1, born 1968-03-14), and `Q-test-1003` to `Q-test-1007`: a former minister (class 1, left office 2026-02-28), an ambassador and the head of an international organisation (class 2), a state-enterprise board member (class 3) and a mayor (class 4) | `openverify-sandbox-pep` | a `politically-exposed-person` report on their names |
| `Q-test-1002` spouse "Imogen Testerton" | `openverify-sandbox-pep` | screened only with `include-relatives: true` |

The other entries (`SYN-6001` onwards, `Q-test-5001` onwards) are generated fillers whose names share no distinctive token with the entries above. `packages/watchlist/fixtures/wikidata-pep.synthetic.answers.json` states the sandbox office holders and the spouse as a Wikidata answers document with real position-class ids, for `watchlists:sync --import <file> --source wikidata-pep` (no request, no User-Agent).

### Report providers

- **Adverse media:** a screened name holding `sandbox-media` (or the tokens `sandbox` then `media`) gets two synthetic articles under `sandbox-news.example`, seen 1 and 10 days earlier, in English, with no source country; anything else gets none. The sandbox calls nothing and takes no GDELT budget. A business name also needs a second distinctive word, because the sandbox articles name no country: "Sandbox-Media Quarrystone Holdings Ltd" matches, "Sandbox-Media Holdings Ltd" does not.
- **Email breaches:** a local part holding `sandbox-breached` gets one breach 90 days old; anything else, `sandbox-spam` included, gets none (no spam adapter exists). In sandbox environments the reserved names `disposable.example` (disposable) and `relay.example` (a relay) are honoured, and `.test` and `.example` domains are answered without DNS.
- **Phone line type** (`+1 NPA 555 01xx`, the NANP fictional range, by the last two digits; the carrier is `Sandbox Carrier`): `00` mobile, `01` non-fixed VoIP, `02` prepaid, `03` mobile with a SIM swap 6 hours ago, `04` mobile ported 10 days ago, `05` unreachable, `06` fixed VoIP; any other number is not checked.
- **Address verification** (US addresses, by the house number, the first word of `address-street-1`): `1000` confirmed and residential, `1001` confirmed and commercial, `1002` not confirmed, `1003` a CMRA, `1004` vacant, `1005` secondary missing, `1006` secondary invalid; any other number gives `deliverability: unknown`.
- **Crypto exposure** (EVM addresses): ending in `dead`, indirect exposure; ending in `beef`, direct exposure; any other EVM address, none; any other chain, unavailable (never a pass).

## Phase 7 network data and signals

Phase 7 (C93.5, C93.6, C90.9) adds one provider kind, `ipReputation`, and the synthetic network data a sandbox environment answers from. Live network data (DB-IP, Tor, cloud ranges) reaches an install only through the operator's sync ([network data](../network/README.md)); the sandbox data below is generated by `@openverify/signals/testing` (`SANDBOX_NETWORK`, `sandboxNetworkBundle()`) and imported by `seed:dev` as the source `openverify-sandbox-network` (`origin: import`, never stale). A production environment never reads it: there, a documentation address is `address_not_public`.

| Kind | Used by | Sandbox environments | Production environments | Real adapter |
|---|---|---|---|---|
| `ipReputation` | the session's `is-proxy` (the API, at the session's first flow call) and the `ip-address` report's `proxy-detected` (the worker) | `OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX` (`.env.example`: `sandbox`) | `OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION` (unbound) | `mmdb-file`: an operator-licensed anonymous-IP MMDB at `OPENVERIFY_IP_REPUTATION_MMDB_PATH` (compose mounts `data/ip-reputation/` read-only at `/var/lib/openverify/ip-reputation`); it answers locally and sends nothing |

Unlike the Phase 6 kinds, `ipReputation` is read by both the API and the worker. Unbound, `is-proxy` and `proxy-detected` are `null` with `provider_not_configured`, and a template cannot publish a review rule on `inquiry/proxy_detected` (422 `provider_not_bound`).

### Sandbox addresses

In a sandbox environment, an address from the documentation ranges is answered from the sandbox bundle alone; every other public address is answered from the real sources the operator synced, if any.

| Address | Facts |
|---|---|
| `192.0.2.10` | a Tor exit: `is-tor` `true`, threat level `high`; the `ip-address` report's `tor-exit-node` is `MATCHED` |
| `192.0.2.20` | the fictional provider `example-cloud` (service `EXAMPLE_COMPUTE`, region `example-1`): `is-datacenter` `true`, `ip-connection-type` `datacenter`; the report's `datacenter-ip` and `service-type` `DATACENTER` |
| `192.0.2.30` | VPN AS64500: `is-vpn` `true` (H, confidence 0.6), threat level `medium` |
| `192.0.2.40` | a `public_proxy` through the sandbox `ipReputation`: `is-proxy` `true`, threat level `high` |
| `192.0.2.50` | hosting AS64503 only: `hosting-asn` `true` (H, confidence 0.5); the public datacenter fields stay `null` |
| the rest of `192.0.2.0/24` | AS64504 "Example Sandbox Network" |
| `198.51.100.0/24` | AS64501 "Example Residential": nothing listed, so the threat level is `low` ("no listed risk found", with its capped confidence and `vpn_list_not_exhaustive`) and the exit list answers `false` (`CLEARED`) |
| `203.0.113.0/24` | AS64502 with a fictional city point in the open South Pacific: (-30, -140) on `203.0.113.0/25` and (-30.5, -140.5) on `203.0.113.128/25`, region `ZZ-01`, so two sessions there are a non-zero distance apart |
| `2001:db8::/48` | IPv6, AS64501: `is-tor` is `null` with `ipv6_not_covered` (the exit list has no IPv6 exits) |

Every sandbox address is in the user-assigned country `ZZ`. The e2e stack presents these addresses to the API through a trusted loopback proxy (`OPENVERIFY_TRUST_PROXY=127.0.0.1`), adding `X-Forwarded-For` to the browser's API requests (`e2e/tests/support/network.ts`); the API's CORS list does not include that header.

### Sandbox signal outcome

In a sandbox environment the flow signals body may carry `sandbox-outcome` (C90.9): `bot` gives `inquiry/bot_score` 95 and `inquiry/behavior_threat_level` `high`, `human` gives 5 and `low`, both with confidence 1.0 and the evidence reason `sandbox_outcome`. A production environment refuses the member with 422 `sandbox_only_value`.

On Android (Phase 10, Workflow 10A), the host app chooses the outcome when it installs the SDK's components: `OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.BOT))` (or `HUMAN`). The SDK reads nothing from the device for it, and adds `sandbox-outcome` to its one signal body only when the session's environment is a sandbox, so a production session never sends it. `:openverify-sdk:stackTest` drives a sandbox inquiry with `BOT` and reads `inquiry/bot_score` 95 on the server ([the Android integration guide](../android/integration.md)).

## Device integrity

Phase 10 (C211.4, Workflow 10B) adds the provider kind `deviceIntegrity`, read by both the API (whether the session asks the Android SDK for a Play Integrity token) and the worker (the `integrity-decode` job).

| Kind | Sandbox environments | Production environments | Real adapter |
|---|---|---|---|
| `deviceIntegrity` | `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX`: `sandbox` or `play-integrity` (`.env.example`: unbound) | `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION`: `play-integrity` only; `sandbox` stops the process | `play-integrity`: Google's `decodeIntegrityToken` with the operator's service account, the package name and certificate digests (`OPENVERIFY_PLAY_INTEGRITY_*`, [the Android guide](../android/device-integrity.md#server-settings)) |

Unbound (the default), the session never asks for a token, the two Play Integrity signals are `null` with `provider_not_configured`, and a template cannot publish a review rule on them (422 `provider_not_bound`).

The `sandbox` provider answers the token the client posts from these magic values, deterministically, and never calls anything:

| Token | `device_integrity_level` | `app_recognized` |
|---|---|---|
| `sandbox-strong` | `strong` | `true` |
| `sandbox-device` | `device` | `true` |
| `sandbox-basic` | `basic` | `true` |
| `sandbox-none` | `none` (no label) | `null`, `integrity_unevaluated` |
| `sandbox-unrecognized-app` | `device` | `false` (an unrecognized version, another certificate) |
| `sandbox-replayed` | `null`, `integrity_decode_failed` (the request hash does not match) | `null`, `integrity_decode_failed` |

Any other token is refused (`sandbox_token_unknown`) and stored as a failed decode (`integrity_decode_failed`). Each value names the provider in `signal-details.sources` with `sandbox: true`. The e2e stack binds `sandbox` for sandbox environments (`e2e/tests/device-integrity.spec.ts`). On Android the host app's own `IntegrityTokenProvider` returns the magic value in a sandbox test build.

## Phase 7 lists, graph and transactions

Workflow 7B (C97-C106.2) adds no provider kind: lists, the graph and transactions read only what the platform already holds. In a sandbox environment:

- **Lists.** No sandbox list is seeded; create your own with synthetic values. An end user's email address at a [reserved mail domain](#reserved-mail-domains) (`.test`, `.example`) is confirmed without a DNS query, so an email list can be screened end to end (`e2e/tests/lists.spec.ts`). A face or background list embeds through the configured vision service, and its masked background copy comes from the vision route `POST /v1/mask/background`; the synthetic faces of `fixtures/` are the only faces to use.
- **The `custom-list` report.** `seed:dev` publishes `Default custom list` with no list pinned, so each report names the lists it screens ([the report](../reports/custom-list.md)).
- **The graph.** The documentation addresses of [the sandbox addresses](#sandbox-addresses) are indexed as `ip_address` values in a sandbox environment only; a production environment never indexes a documentation or other non-global range.
- **Transactions.** Card-like test strings belong only in tests of the guard that refuses them.

## Phase 8 workflows

Workflow 8A (C126) adds one provider kind, `slack`, and a mail sandbox with no kind of its own. Each records and never sends, and is refused in production. Workflow 8B adds the attachment scanner (below).

| What | Sandbox environments | Production environments |
|---|---|---|
| Send Slack Message | `OPENVERIFY_PROVIDER_SLACK_SANDBOX`: `sandbox` or `incoming-webhook` | `OPENVERIFY_PROVIDER_SLACK_PRODUCTION`: `incoming-webhook` |
| Send Email | The mail sandbox, whatever SMTP says | The install's SMTP server |
| Send SMS | `OPENVERIFY_PROVIDER_SMS_SANDBOX`, recorded in the `workflow-sms` list | `OPENVERIFY_PROVIDER_SMS_PRODUCTION` |

- **Records.** Workflow messages go to their own Valkey lists, one per environment and kind (`openverify:sandbox-messages:<environment>:<kind>`, kinds `workflow-sms`, `email`, `slack`), each body sealed, at most 500 entries, kept 24 hours. The OTP list is untouched. `POST /api/v1/sandbox/email-messages/search`, `/slack-messages/search` and `/workflow-sms-messages/search` read them with `sandbox:read`, masked, and a production environment's key answers 404. See [messaging](../workflows/messaging.md#sandbox-records).
- **Slack.** A sandbox record holds the secret's id, never the URL. The secret's value is still opened and checked, so a sandbox run refuses what production would. The step reads `delivery: recorded`.
- **Mail.** A listed address is recorded with no SMTP server, so the catalogue reads Send Email as available in a sandbox environment on any install.
- **The scanner** (Workflow 8B, C135.5). `OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_{SANDBOX,PRODUCTION}` take `clamd`, `sandbox` or `none` (unset reads `none`), and `OPENVERIFY_CLAMD_SOCKET` is required while a binding names `clamd`. See [attachments and scanning](../cases/attachments.md).
  - **Sandbox verdicts.** The sandbox scanner is deterministic: an attachment holding the EICAR test string anywhere is `infected`, and everything else is `clean`. It looks at nothing else, so it is not a scan, and the console labels it "sandbox scan (not a real scan)". It is refused for production environments.
  - **Both processes read the name.** The worker scans; the API reads the same two names, never the socket, to apply the serving rules (only `clean` is served while a scanner is bound, `pending` answers 409 `attachment_scan_pending`). Compose passes both names to both. Set them alike: an attachment the API records for a provider the worker has not bound stays `pending` and is never served, and the worker logs it.
  - **`none`.** Every attachment reads `not_scanned` and is served behind a warning.
- **Loopback receivers.** `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK=true` lets a sandbox environment of a non-production install call a local receiver ([HTTPS request](../workflows/https-request.md#destinations)). The worker must trust its certificate, for example through `NODE_EXTRA_CA_CERTS`, as the full-stack suite does with a throwaway one.

## Labels

Every result a sandbox provider gave carries `provenance.provider = { "id": "sandbox", "sandbox": true }`, beside the thresholds it was judged against. A provider failure is retried with the job, then recorded as `execution_error` on that check alone (C30.3).

## With the synthetic fixtures

- **The Utopia card** (`fixtures/generated/id-front.jpg`, number `UT4829163`) is not an AAMVA card, so the AAMVA lookup answers `feature_absent`. The public-figure and age providers see the ending `9163`: no match, and no age difference.
- **The synthetic proof-of-address set** (`fixtures/generated/poa/`) and **the TD3 passport page** (`fixtures/generated/nfc/td3-passport.jpg`, number `UP7316408`, with its MRZ record and person A's JPEG 2000 chip portrait) are described in `docs/checks/document.md` and `docs/checks/nfc.md`. The TD3 page is no AAMVA card either.
- **The synthetic AAMVA payloads** (`contracts/fixtures/aamva/valid.json`, rendered as barcode-only images in `fixtures/generated/aamva/`) carry the numbers `Y9876543`, `987654321`, `T12345678901234` and `12345678`, none ending in a magic value, so the AAMVA lookup answers a match. To reach the other outcomes, write a synthetic payload whose `DAQ` ends in a magic value, following `contracts/fixtures/aamva/README.md` (fictional people only, with the `OPENVERIFY SYNTHETIC TEST DATA` subfile).

## Adding a real provider

Implement the port in `apps/api/src/ports.ts` (`AamvaLookupProvider.lookup`, `PublicFigureProvider.match`, `AgeEstimateProvider.estimate`, or for the selfie checks `SelfieAgeEstimateProvider.estimateAge`, `SelfiePublicFigureProvider.matchPublicFigure` or `SuspiciousEntityProvider.assess`, which take `{ image }` alone), give it an id and `sandbox: false`, add its name to `PROVIDER_NAMES` and to the binding in `apps/api/src/providers/index.ts`, and throw a `ProviderError` that says whether a retry can help. A real provider must never answer from magic values, and binding it to sandbox environments is the operator's choice. A real selfie provider also needs consent text covering the processor, a processor agreement and a cross-border transfer review (C44).
