# Phase 6 research: email risk, phone risk, address lookup, crypto-address and business watchlists

Prepared 2026-10-22 for OpenVerify Phase 6 ("Reports", `docs/PLAN.md` §6 and §4.4 [R1]). This note covers five report types. For each it asks what we can compute honestly with permissive data and code, and what needs a paid provider: an adapter with a deterministic sandbox provider, tier A in ADR 0002 [R2]. Fuzzy name matching, list ingestion, PEP and adverse media for persons have their own notes. This note touches them only where business screening differs.

The note is written in our own words. Field names, enum values, event names, report type names, configuration keys and URL paths are reproduced only because they are short identifiers needed for functional parity. Anything the public sources do not state is marked **not documented**. A statement we infer, but that no source states, is marked **(inference)**. "Observed" means a live request or computation made on 2026-10-22. Every citation key is defined in [Sources and pins](#sources-and-pins).

Legend: ✅ passes rule 4 [R3] · ⚠️ passes with a caveat, or needs the owner · ❌ fails rule 4 or is not recommended. **R / H / A** are the ADR 0002 tiers [R2]: real, heuristic (`beta` with a confidence), adapter plus sandbox.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-08**. This note needs **no new npm or PyPI runtime package**. Every recommendation is our own code over data files pinned in `data/manifest.json` [R6], or over adapters. The rule therefore matters here only for data commits and for libphonenumber.

---

## Summary

1. **Email risk is mostly real logic on DNS, with a small authored data set.** Phase 5 already gives syntax, MX with null MX, disposable domains and RDAP [R4 C55.8, C56, C61.4]. Phase 6 adds:
   - free-mail, privacy-relay and role-account tables;
   - the domain's mail provider, from its MX host names;
   - SPF and DMARC presence;
   - typo detection;
   - first seen in this environment.

   Breach exposure, spam traps, reputation networks, email age and social presence need vendor data (A). SPF/DMARC strictness says almost nothing about a user's risk: gmail.com and outlook.com publish `p=none`, while the disposable mailinator.com publishes `p=reject` (observed [E22]). The public schema marks those fields deprecated [P1].
2. **No permissively licensed free-mail list has clean provenance.**
   - goware (MIT) and derhuerst (ISC) were imported from unlicensed gists, and about a third of their entries are disposable domains (2,832 of 8,758). They also list a privacy relay as a free provider.
   - Kikobeats (MIT) mixes free and disposable domains, takes HubSpot's unlicensed list, and runs a `postinstall` script.
   - willwhite (ISC) has been stale since 2020.

   Recommendation: an **authored table** of about 200 consumer mailbox domains. Each row cites the provider's own page, as Phase 5 did for nicknames [R4 C58.3].
3. **Phone risk without a carrier is the numbering plan.** libphonenumber gives possible versus valid, the number type, the region and a numbering-plan location [T1] [T2]. Its type for ordinary US and Canadian numbers is `FIXED_LINE_OR_MOBILE` (observed [T3]). Its carrier file for +1 covers only the Caribbean and the US territories, not the 50 states or Canada (observed [T2]). Network line type, current carrier, porting, SIM swap, reachability, prepaid and non-fixed VoIP need a telecom provider (A). The public phone-risk shape (score 0–1000, levels `low` to `high`, `allow`/`flag`/`block`) matches Telesign's documented Score API band for band [P2] [H2] [T7] **(inference)**.
4. **Address lookup has nothing free for deliverability, residential versus commercial or unit validation, and two obvious routes are closed.**
   - USPS limits its APIs to "to facilitate USPS shipping or mailing transactions" [A8]. That excludes identity verification without a separate USPS licence.
   - The public Nominatim forbids personal data [A1], and all OSM-based geocoders return ODbL data [A1] [A20].

   The public address-lookup fields are Smarty's US Street API fields, one for one [P3] [A14] **(inference)**. Phase 6 can do parsing and normalisation (Phase 5), postcode validity, ZIP-to-state consistency, PO box and APO/FPO/DPO designators, and a postcode-centroid geocode from GeoNames (CC BY 4.0). Everything USPS-derived is A.
5. **The crypto-address watchlist is fully R-tier from OFAC, but not from `SDN.CSV`.** The CSV's remarks column is cut at 1,000 characters, so it holds 506 unique addresses (11 of them truncated fragments, 3 more with a trailing full stop; corrected in fact-check). The same publication's `SDN_ADVANCED.XML` holds **1,066 address features (1,050 unique) on 106 parties across 20 tickers** (observed [C1] [C2]).
   - Tickers do not name chains. USDT appears on TRON, Ethereum and Bitcoin (Omni) formats, and one `XBT` entry is a TRON address.
   - Matching must derive the chain from the address format.
   - Commercial analytics (Chainalysis, TRM, Elliptic) add indirect exposure and clustering. They are adapters only, and the public surface has separate report types for them [S1].
6. **The business watchlist can match more than names.** OFAC's SDN entities carry exact identifiers: 4,501 registration numbers, 4,382 tax ids, 739 business registration numbers, 535 company numbers, 186 LEIs, 1,289 websites, 227 SWIFT/BIC features and 219 email addresses. The registration and tax counts span all SDN record types; on `Entity` records alone they are 4,487 and 3,839 (543 tax ids sit on individuals). The website and email counts are `Entity` records only; across all records they are 1,302 and 370 (corrected in fact-check). Vessels carry IMO numbers (1,568, of which 1,555 pass the check digit) and aircraft carry serial and tail numbers (observed [C2]). All of these are deterministic matches beside the fuzzy name match.
7. **OFAC's 50 percent rule cannot be applied.** It blocks entities that blocked persons own 50 % or more, directly or indirectly, in aggregate [B1] [B2] [B3]. Applying it needs complete ownership percentages, which no free source provides. UK Companies House PSC bands put exactly 50 % in the "more than 25 % but not more than 50 %" band [B6], so even UK data cannot decide the boundary or aggregate several owners. We can screen the business's known persons and flag listed owners and parents, and we must say plainly that this is not 50 %-rule screening.
8. **Two Phase 5 contracts need small amendments.** The `DnsResolver` port has no `resolveTxt` [R7]. The outbound HTTP client refuses every redirect [R4 C54.6], but OFAC's export endpoint answers `302` to a pre-signed S3 URL on `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com` (observed [C1]).

---

## 0. The public parity target (what the five reports expose)

From the public OpenAPI schemas at `persona-openapi` @ `805512b`, API version folder `2026-09-29` [P1]–[P6], the Help Center [H1]–[H7] and our surface index [S1].

| Report type (`type`) | Request `query` | Result fields (identifiers only) | Events [S1] | Public behaviour notes |
|---|---|---|---|---|
| `report/email-address` | `email-address` (required) | `email-reputation` (`high`/`medium`/`low`), `email-domain`, `email-domain-exists`, `email-is-valid-mx`, `email-is-deliverable`, `email-is-disposable`, `email-is-spam`, `email-is-suspicious`, `email-domain-age-days`, `email-estimated-age-days`, `email-credentials-leaked-recent`, `email-malicious-activity-detected-recent`, `age-estimated-13-plus`/`16-plus`/`18-plus`. **Deprecated:** `email-reference-count`, `email-domain-reputation`, `email-first-seen-days`, `email-last-seen-days`, `email-credentials-leaked`, `email-data-breached`, `email-malicious-activity-detected`, `email-is-blocklisted`, `email-is-free-provider`, `email-is-spoofable`, `email-is-spf-strict`, `email-is-dmarc-enforced` [P1] | `.ready`, `.errored` | Uses first- and third-party sources [H1]. No configuration [H1]. Privacy-relay and masking domains are skipped and shown as "no match" [H1] |
| `report/phone-number` (schema title "Phone Risk") | `phone-number` (E.164) | `phone-type` (`FIXED_LINE`, `MOBILE`, `PREPAID`, `TOLL_FREE`, `VOIP`, `PAGER`, `PAYPHONE`, `INVALID`, `RESTRICTED_PREMIUM`, `PERSONAL`, `VOICEMAIL`, `OTHER`), `phone-carrier`, `phone-city`, `phone-subdivision`, `phone-country-code`, `phone-risk-level`, `phone-risk-recommendation` (`block`/`allow`/`flag`), `phone-risk-score`, `phone-risk-sim-swap` (`very-low` to `high`, `N/A`) [P2] | `.ready`, `.errored` | A vendor computes it [H2]. The schema says the score is out of 1000 [P2]; the Help Center says 0–100, with five bands [H2]. Telesign's score is 0–1000 with the same five bands ×10 [T7]. SIM swap needs a separate template [H2] |
| `report/address-lookup` | `addressee`?, `address-street-1`, `address-street-2`?, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code` (all but addressee and street-2 required) | `resolved-*`; `metadata-record-type`, `-zip-type`, `-county-fips`, `-county-name`, `-carrier-route`, `-carrier-route-type`, `-congressional-district`, `-building-default-indicator`, `-residential-delivery-indicator`, `-latitude`, `-longitude`, `-precision`, `-time-zone`, `-utc-offset`, `-obeys-daylight-savings`, `-ews-match`; `analysis-dpv-match-code`(+`-decoded`), `-dpv-footnotes`(+decoded), `-dpv-cmra`, `-dpv-vacant`, `-active`, `-footnotes`, `-lacs-link-code`, `-lacs-link-indicator`, `-suite-link-match`; `error-message` [P3] | `.submitted`, `.ready`, `.errored` | US by default; international "with limited fields"; USPS-sourced outputs are US-only; optional imagery and virtual-address modules [H3]. The names match Smarty's US Street API `metadata`/`analysis` fields [A14] **(inference about the vendor)** |
| `report/crypto-address-watchlist` | `crypto-address` | `result[]`: list `name`, `url`, `list-type`, `slug`, `flag-code`, `entities[]` (`name`, `alias-type`, `birthdates[]` with `granularity`, `crypto-addresses[]` with `type` (ticker) and `address`) [P4] | `.ready`, `.matched`, `.errored` (no `.dismissed`) | OFAC is the only list searched; sources are checked up to every 10 minutes [H4] |
| `report/business-watchlist` | `term` (required), `address-country-code` (optional) | `term`, `matched-lists[]` (slugs), `sanction-list[]`, `fitness-probity-list[]`, `warning-list[]` (`name`, `url`), `ignore-list[]` (`ignored-at`, `run-history-completed-at`, `match` with `list-type(s)`, `slug`, `country-code`, `flag-code`, `entities[]` with `match-levels[]` such as `name_exact`, `user`, `ignore-reason`) [P5] | `.ready`, `.matched`, `.dismissed`, `.errored` | 100+ sanctions and warning lists; sanctions refreshed within 24 h, warnings within a month; default name matching "Strict" [H5] [H7] |

Reports can also run continuously on a schedule [P7]. Shared attributes are `status` (`pending`, `ready`, `errored`), `created-at`, `completed-at`, `redacted-at`, `report-template-version-name`, `has-match`, `is-continuous`, `is-recurring` and `tags` [P6]. Sandbox test inputs exist for the email, phone, crypto and business reports, but not for address lookup [H6]. We define our own magic values (§7) and use **no real names**.

The surface also has vendor-specific report types, `chainalysis-address-screening`, `trm-wallet-screening`, `coinbase-check-crypto-risk` and `comply-advantage-search` [S1]. So commercial crypto analytics and commercial screening are separate reports, not parts of the watchlist report **(inference from the type names)**.

---

## 1. Email risk (`report/email-address`)

### 1.1 What Phase 5 already builds, and what Phase 6 reuses

| Phase 5 piece | Contract | Phase 6 use |
|---|---|---|
| WHATWG syntax, RFC 5321 lengths, `domainToASCII`, SMTPUTF8 refused | C55.8 [R4] | Gives `syntax_invalid`. The report does not reject the address; it reports the reason |
| MX via `MxResolver` / `DnsResolver` (3 s, 2 tries; 1 h positive and 5 min negative cache): null MX is `domain_rejects_mail`, NXDOMAIN is `domain_not_found`, no MX falls back to A/AAAA (RFC 5321 §5.1) else `no_mail_server`; timeouts are `execution_error` | C56 [R4] [R7] [E1] [E2] | Feeds `email-domain-exists` and `email-is-valid-mx`. A null MX makes `email-is-valid-mx` false and is a hard risk reason |
| Disposable list: `disposable_email_blocklist.conf` @ `6fcca80`, CC0, 9,213 domains, matched against the domain and each parent, with org allow and deny lists | C56 [R4] [R6] [E17] | `email-is-disposable` (R) |
| RDAP client with the IANA bootstrap, answering only for the exact host or the host without `www.` | C61.4 [R4] | `email-domain-age-days` (R). This needs a **registered-domain mode**: `user@mail.example.co.uk` should be aged at the registered domain with a `subdomain` flag, not answered "unavailable" (§1.6) |
| Email OTP (`email_address_otp_comparison`) | C55 [R4] | The only proof of mailbox deliverability we have: `email-is-deliverable: true` only when the same inquiry holds a confirmed code for this address (§1.5) |

### 1.2 Free-mail provider lists

| Candidate | Version / commit (date) | ≥14 d | Licence (verified) | Size | Provenance and content | Verdict |
|---|---|---|---|---|---|---|
| goware/emailproviders `generate/domains.txt` | `84a3a48` (2025-07-21) | ✅ | MIT (GitHub licence API; README) [E10] | 8,758 domains, 120,154 B, SHA-256 `54572f5e…53fa8d3` (observed) | Its history imports domains from unlicensed gists (tbrianjones 2015, maximulian 2016), from vboctor/disposable_email_checker and from edwin-zvs [E10]. **2,832 entries are on our CC0 disposable list.** It also lists `privaterelay.appleid.com` (observed) | ⚠️ The licence passes, but provenance is weak and the content is polluted |
| derhuerst/email-providers (npm) | 2.27.0 (2026-10-05) | ✅ | ISC (`license.md` in the tarball) [E11] | `all.json` 8,760, `common.json` 353 (observed) | `build.js` fetches a fork of goware's `domains.txt`, and ranks `common.json` by the Majestic Million (CC BY 3.0 Unported [E15]). The same 2,832 disposable overlap (observed) | ⚠️ Same provenance as goware. `common.json` would carry a CC BY 3.0 attribution for its ranking |
| willwhite/freemail `data/free.txt` (npm `freemail`) | 1.7.0 (2020-07-03), `5d69d4e` | ✅ | ISC (LICENSE) [E12] | 4,466 domains, 63,371 B, SHA-256 `9e535d40…e28cb84a`; 10 on the disposable list (observed) | The README says it syncs "various lists from around the web"; `sources.txt` is gone at that commit [E12]. Depends on `tldjs` | ❌ Stale for six years; provenance unstated |
| Kikobeats/free-email-domains (npm) | 1.15.11 (2026-10-22) / newest passing 1.12.22 (2026-10-08) | 1.12.22 | MIT (`LICENSE.md`) [E13] | "30,000+" domains [E13] | **Free and disposable merged in one array**, so it cannot answer "free provider". The free part comes from a HubSpot knowledge-base page with no licence. The package has a `postinstall` script [E13] | ❌ Wrong semantics, unlicensed source, install script |
| HubSpot "free domains" page | n/a | n/a | **Not documented.** The page was not fetched here; Kikobeats' README links it as a knowledge-base article, which is vendor content with no open licence named [E13] | not measured | Source of the above | ❌ until a licence is shown |
| Wikidata classes webmail (Q327618, Q126738381), email hosting (Q5368818), mailbox provider (Q1273203) | query of 2026-10-22 | n/a | CC0 [R5 §2.6] | 65 items, 63 with an official website (observed [E16]) | The official website is not the mail domain (for example a provider's site versus its mailbox domain) | ⚠️ A CC0 seed for names and links only; too thin to be the list |

**Recommendation: an authored table.** Write `free-mail-domains.json` with about 200 consumer mailbox domains (the large global and regional providers and their country domains). Each row records:
- the domain;
- the provider;
- `kind`: `free`, `paid-consumer` or `relay`;
- a `source` URL on the provider's own site.

A domain name with its provider is a fact, and authoring it avoids every provenance question **(inference)**. Commit it as authored data, as Phase 5 did with `nicknames.json` [R4 C58.3]. A build test fails if any entry is on the disposable list. The flag is informational and does not raise risk, because the public schema deprecated `email-is-free-provider` [P1].

**Privacy relays get their own kind.** Apple's relay addresses end in `@privaterelay.appleid.com` (or `@icloud.com`) and forward to the account's verified address [E9]. `mozmail.com` and `duck.com` have their own MX hosts (observed [E22]). The public behaviour skips relay domains and reports "no match" [H1]. Our proposal: `email-reputation: null` with reason `privacy_relay`, never `low` or `high`. A relay neither proves nor disproves anything.

### 1.3 Role accounts

| Source | Version (date) | Licence | Size | Verdict |
|---|---|---|---|---|
| RFC 2142 mailbox names (`info`, `marketing`, `sales`, `support`, `abuse`, `noc`, `security`, `postmaster`, `hostmaster`, `usenet`, `news`, `webmaster`, `www`, `uucp`, `ftp`) | May 1997 | IETF RFC (standard; names are protocol identifiers) [E6] | 15 names | ✅ the seed |
| mixmaxhq/role-based-email-addresses (npm) | 3.1.0 (2025-03-26), `4ad4731` | MIT (`LICENSE` in the tarball, © 2015 Mixmax) [E14] | 1,018 local parts in `src/index.js` (observed) | ⚠️ The licence passes. The README says only that the entries came "from several places", and the list includes generic words (`agency`, `agents`) that are often personal **(inference)** |

**Recommendation:** an authored list of about 80 local parts: the RFC 2142 names plus `admin`, `billing`, `contact`, `hello`, `help`, `hr`, `jobs`, `noreply`/`no-reply`, `office`, `team` and similar. Compare after lower-casing and after cutting a `+tag` (RFC 5233 subaddressing). The result is `email-is-role-account` (ours, R), which is a medium risk reason: a shared mailbox does not identify one person.

### 1.4 Domain signals from DNS (R, informational)

- **Mail provider.** From the MX host names, through an authored suffix table of about 30 entries:
  - `gmail-smtp-in.l.google.com` and `aspmx.l.google.com`: Google;
  - `*.protection.outlook.com`: Microsoft;
  - `*.yahoodns.net`: Yahoo;
  - `mx0*.mail.icloud.com`: Apple;
  - `*.protonmail.ch`: Proton;
  - `*.messagingengine.com`: Fastmail;
  - `*.zoho.com`, `*.emig.gmx.net`, `mx.yandex.ru`, `mxs.mail.ru`, `mx*.qq.com`;
  - the relay hosts.

  All of these were observed on 2026-10-22 [E22]. Output: `email-mx-provider` (ours). It explains a custom domain ("Google-hosted business domain"). It also gives a heuristic: a custom domain whose MX points at a known disposable service's own MX hosts is probably disposable (H, `beta`, reason `mx_of_disposable_service`). The table of those hosts is authored too.
- **SPF.** RFC 7208 [E3]: read only the domain's own `v=spf1` TXT record and record the terminal `all` qualifier (`-`, `~`, `?`, `+`) or a `redirect=`. **Do not evaluate `include:` recursively**, because each include is another lookup that the domain owner controls. Output: `email-spf-policy` (ours).
- **DMARC.** RFC 9989 (May 2026, Proposed Standard) obsoletes RFC 7489 and RFC 9091 [E4] [E5]. It replaces the Public Suffix List with a **DNS tree walk** of at most 8 queries [E4 §4.10]. That fits the Phase 5 decision not to ship the PSL (MPL-2.0 runtime data) [R4 C56].
  - Read `p`, `sp`, `np` and the testing tag `t`, which replaces `pct`.
  - Output: `email-dmarc-policy` (ours: `reject`, `quarantine`, `none`, `absent`).
  - Example: `_dmarc.privaterelay.appleid.com` does not exist (observed), so the tree walk goes on to `appleid.com`.
- **Why informational only.**
  - gmail.com and outlook.com publish `p=none`.
  - yahoo.com, zoho.com, mail.ru and the disposable mailinator.com publish `p=reject` and/or `-all`.
  - example.com publishes `p=reject` with a null MX (all observed [E22]).

  A strict policy protects the domain from spoofing; it says nothing about the person. The public schema deprecated `email-is-spoofable`, `email-is-spf-strict` and `email-is-dmarc-enforced` [P1].
- **Port change.** `DnsResolver` has `resolveMx`, `resolve4` and `resolve6` only [R7]. Phase 6 adds `resolveTxt` with the same error mapping. The caps are 4 KiB per TXT answer and 8 DMARC queries per address.

### 1.5 Deliverability and why there is no SMTP probing

Phase 5 refused SMTP `RCPT TO` probing [R4 C56] [R5 §3.3]. The reasons, with sources:
- **It proves nothing reliable.**
  - RFC 5321 lets sites disable `VRFY`/`EXPN`, and then they must answer `252`, which neither confirms nor denies [E1 §3.5.3, §7.3].
  - Catch-all domains accept every `RCPT TO` **(inference, common practice)**.
  - Greylisting answers unknown senders with temporary failures by design [E7].
- **It often cannot run.** Google Cloud blocks outbound TCP 25 to external destinations for most projects [E8]. Other clouds restrict it too **(inference; not checked here)**.
- **It is abusive and leaks data.** It opens a connection to a third party's mail server about an end user, without the user's knowledge. Repeated probes damage the sending IP's reputation **(inference)**.

What we can say instead, and how we name it:
- `email-domain-accepts-mail` (ours, R): MX present, or the implicit MX through A/AAAA, and no null MX.
- `email-is-deliverable` (parity field): `true` **only** when the inquiry holds a confirmed email OTP for this exact address (C55). Otherwise `null`, never `false` and never guessed. "We delivered a code and the user typed it" is the one real proof of a mailbox.

### 1.6 Domain age (RDAP, R)

- Reuse the C61.4 `domainAge` port [R4]. Add a `registered-domain` answer mode for email domains: the first registry answer while trimming labels from the left, with flag `subdomain` when the mail domain is longer.
- Skip RDAP for domains in the free-mail table (their age is not informative), and record `not_requested`.
- A domain under a shared platform suffix (a hosted subdomain service) gets the platform's age, so flag it **(inference)**.
- RDAP terms and limits are as recorded in Phase 5 [R5 §5.5].
- Output: `email-domain-age-days`. Thresholds are `min-domain-age-days` (default 30, as C61.7 uses the same key for websites) and `young-domain-days` (default 365, ours).

### 1.7 Typo detection (H)

A custom domain at Damerau–Levenshtein distance 1 from one of the top 50 free-mail domains (for example `gmial.com`), and not itself in the free-mail table, gives `email-domain-typo-suggestion` (ours) and reason `domain_typo_of_major_provider`. It uses our existing distance code, with no package. The npm `@zootools/email-spell-checker` 1.12.0 (2023, MIT) and `mailcheck` 1.1.1 (2015, no licence field) are not needed [E13 registry note]. This is H: a near-miss domain can be a real company.

### 1.8 What needs paid or third-party data (A)

| Signal (parity field) | Source | Terms that decide it | Port |
|---|---|---|---|
| Breach exposure (`email-credentials-leaked-recent`) | **Have I Been Pwned** API v3: `GET https://haveibeenpwned.com/api/v3/breachedaccount/{account}` with an `hibp-api-key` header and a descriptive User-Agent (a request without one gets 403). Options `truncateResponse`, `Domain`, `IncludeUnverified`. Rate limit set by the plan (`Rpm`); 429 with `retry-after` [E18] | Breach and paste data are **CC BY 4.0**, with HIBP named and linked as the source [E18]. The March 2026 terms restrict use for a third party's benefit unless "you have purchased a Paid Service which expressly allows you to do so" (clause 2.1.1.2; quoted because it decides the question) [E20]. The subscription page says Core does not permit use on behalf of third parties [E19]. Plans: Core 1–5 from US$4.39 to $319 a month billed annually (10–1,000 RPM); Pro 1–5 from $379 to $4,599 (1,000–16,000 RPM, stealer logs); High RPM from $1,150 [E19]. Submitted addresses become "Subscriber Data" that HIBP may use to provide the service, and the subscriber must hold the consents [E20]. Pwned Passwords is free but is about passwords, not emails [E18] | `emailIntelligence` adapter, `hibp`, with the operator's own key and plan. Whether an IDV operator screening its own users is "use on behalf of third parties" is **not documented**, so it is an owner and operator decision (Needs the owner A3). Show "Source: Have I Been Pwned" wherever breach data appears |
| Reputation, spam trap, malicious activity, network-based "first seen" age (`email-reputation` from a vendor, `email-is-spam`, `email-malicious-activity-detected-recent`, `email-estimated-age-days`) | Commercial reputation networks. Example: the SEON Email API returns a network risk score, deliverability, domain age, registrations across online platforms ("social presence"), breach details and SEON fraud history; it is a commercial product with a free trial [E21]. Other vendors (Emailage, Ekata, IPQualityScore, deliverability services such as Kickbox) were **not checked here** | Vendor contracts; per-call pricing **not documented** in the sources read | `emailIntelligence`: `seon`, or another vendor later, plus `sandbox` |
| Age estimates (`age-estimated-13-plus`/`16-plus`/`18-plus`) | Vendor-only; how they are derived is **not documented** [P1] | n/a | Not proposed (Needs the owner C5) |

**Our own "first seen" (R).** `email-first-seen-in-environment-days` (ours) and a count of other accounts sharing the address, read from the blind index the email OTP already keeps (C53 [R4]). This is real evidence from the operator's own data, not network reputation. Phase 7's lists and graph will reuse it.

### 1.9 Proposed risk rule (H, `beta`)

`email-reputation` keeps the public direction: `high` means trustworthy and `low` means risky [P1] [H6]. Each reason has a fixed contribution; the result is the worst band reached, so it is readable rather than a weighted sum.

| Band | Any of these reasons | Confidence |
|---|---|---|
| `low` | `syntax_invalid`; `domain_not_found`; `domain_rejects_mail` (null MX); `no_mail_server`; `disposable_domain`; `domain_recently_registered` (custom domain, age < `min-domain-age-days`); `mx_of_disposable_service` (H) | 0.95 for the DNS and list facts; 0.7 for age; 0.5 for the MX heuristic |
| `medium` | `domain_typo_of_major_provider`; `role_account`; `young_domain` (custom domain, age < `young-domain-days`); with an adapter, a breach in the last 12 months or a vendor flag | 0.4–0.6 |
| `high` | none of the above, and the domain accepts mail | 0.5 (absence of bad signals is weak evidence) |
| `null` | `privacy_relay`; any DNS or RDAP `execution_error` that blocks a hard reason (never `high` on a timeout, ADR 0002 §3a) | n/a |

`email-is-suspicious` is `true` exactly when the band is `low`. Informational fields (free provider, MX provider, SPF, DMARC) never change the band. The thresholds, the reasons that applied and the provenance (list commits, RDAP server, DNS time) go into the result, as ADR 0002 §3c and §3f require [R2]. The rule stays `beta` until it has a calibration report.

---

## 2. Phone risk (`report/phone-number`)

### 2.1 What libphonenumber gives (R)

| Fact | How | Notes |
|---|---|---|
| **Possible versus valid** | `isPossible()` checks length; `isValid()` with `/max` metadata checks the digits against the national plan [R5 §3.1] | "Valid" means a range that can be assigned, not a working number [R5 §3.1]. Example: `+44 7700 900123` is possible but **not valid**, and so is `+33 6 39 98 00 00` (observed [T3]). Both ranges are commonly described as reserved for drama; that was not checked here |
| **Number type** | `getType()` with `/max`: `MOBILE`, `FIXED_LINE`, `FIXED_LINE_OR_MOBILE`, `TOLL_FREE`, `PREMIUM_RATE`, `SHARED_COST`, `VOIP`, `PERSONAL_NUMBER`, `PAGER`, `UAN`, `VOICEMAIL` [R5 §3.1] | US and Canadian geographic numbers answer `FIXED_LINE_OR_MOBILE`. Example: `+1 202 555 0100` (observed [T3]). The plan has no US `VOIP` type [R5 §3.1]. `+1 500 555 0006` is `PERSONAL_NUMBER` (observed) |
| **Region** | `phoneNumber.country` (not `isValidNumberForRegion`) [R5 §3.1] | Where the range is allocated, not where the person is |
| **Numbering-plan location** | Google's `resources/geocoding/en` at v9.0.41: 151 files, 6,545,071 B, Apache-2.0 [T2] | Gives `phone-city` / `phone-subdivision` for fixed-line ranges and NANP area codes; mobile ranges usually give the country only **(inference from the data layout)**. Label the result `numbering-plan` |
| **Original range holder** | Google's `resources/carrier/en` at v9.0.41: 206 files, 656,947 B (corrected in fact-check, from the GitHub contents listing at the tag), Apache-2.0 [T2] | The **original** carrier, not the current one after porting [R5 §3.1]. For +1 the file covers only area codes 242, 246, 264, 268, 284, 340, 345, 441, 473, 649, 658, 659, 664, 670, 671, 684, 721, 758, 767, 784, 787, 809, 868, 869, 876 and 939: the Caribbean, Puerto Rico, the USVI, Guam, the NMI and American Samoa. **None of the 50 states or Canada** (observed [T2]) |

**Versions.**
- libphonenumber-js latest is **1.13.15 (2026-10-08 09:14 UTC)**, which now passes the 14-day rule. The repo pins 1.13.14 [T1] [R5 §3.1].
- Google libphonenumber latest is **v9.0.41 (2026-10-08)**, which also passes; v9.0.40 was released 2026-09-24 [T2].
- Python `phonenumbers` 9.0.41 (2026-10-08) is Apache-2.0 and would be needed only if phone logic moved to Python [T13].

**Recommendation:**
- Keep `libphonenumber-js` (`/max`) in `packages/checks`, and bump to 1.13.15 in Phase 6 if wanted.
- Build `phone-numbering-location.json` from the geocoding files, and `phone-original-carrier.json` from the carrier files, through `data/manifest.json` [R6] with pinned SHA-256 and a NOTICE line (Apache-2.0).
- Ship the carrier as `phone-carrier` with flag `original-carrier`, `beta`, informational. It is absent for US and Canadian numbers.
- Building only the countries an operator enables would keep the image small **(inference)**.

### 2.2 What needs a carrier or telecom provider (A)

Network line type (including **non-fixed VoIP**), **current** carrier and porting, **SIM swap**, **reachability / line status**, **prepaid** and **payphone** (two public `phone-type` values [P2]), caller name, reassigned-number checks and traffic-pattern fraud scores all need a carrier or an aggregator. The public phone-risk behaviour itself relies on a vendor's databases and traffic patterns [H2].

| Provider | API shape (one line) | Terms and cost (high level) |
|---|---|---|
| **Twilio Lookup v2** | `GET https://lookups.twilio.com/v2/PhoneNumbers/{E.164}?Fields=…` with HTTP Basic auth (API key SID and secret) [T4]. Data packages: `line_type_intelligence` (`type` ∈ `landline`, `mobile`, `fixedVoip`, `nonFixedVoip`, `personal`, `tollFree`, `premium`, `sharedCost`, `uan`, `voicemail`, `pager`, `unknown`, plus `carrier_name`, `mobile_country_code`, `mobile_network_code`) [T5], `caller_name` (US only), `sim_swap` and `call_forwarding` (private beta, carrier approval), `line_status` (public beta, 140+ countries), `identity_match`, `reassigned_number` (US, by application), `sms_pumping_risk` [T4] | Validation is free. Line type intelligence $0.008, CNAM $0.01, line status $0.007 down to $0.00385, identity match $0.10 (varies by country), reassigned number $0.02 down to $0.0015, SMS pumping risk $0.025 outside North America and free inside. SIM swap and call forwarding go through sales [T6]. Canadian line type needs NPAC approval, otherwise error 60601 [T5] |
| **Telesign Intelligence (Score)** | `POST https://detect.telesign.com/intelligence/phone`, form-encoded, Basic or Digest auth, with `phone_number` and a required `account_lifecycle_event`. Returns `numbering`, `phone_type`, `location`, `carrier`, `risk.score` 0–1000, `risk.level` (`low` 0–200, `medium-low`, `medium`, `medium-high`, `high` 801–1000), `risk.recommendation` (`allow`/`flag`/`block`) and `risk_insights` [T7] | Pricing and contract **not documented** on the page read [T7] |
| **Vonage** | Number Insight (Basic/Standard/Advanced) **sunsets on 2027-02-04** [T8]. Its replacement, the Identity Insights API, combines format, original and current carrier, SIM swap and subscriber match in one call [T8] [T9] | Endpoint, auth and pricing **not documented** on the overview pages read [T9] |
| **CAMARA SIM Swap** (GSMA Open Gateway, through an operator or an aggregator) | `POST /check` `{ phoneNumber, maxAge (1–2400 h) }` → `{ swapped }`; `POST /retrieve-date` → `{ latestSimChange (RFC 3339 or null), monitoredPeriod? }`; a 400 `OUT_OF_RANGE` when local law caps the look-back [T10] | The spec is Apache-2.0. Stable spec 2.1.0 is at release r3.3 (2025-12-01). r4.1 (2026-10-06, `2.2.0-rc.3`) and r4.2 (2026-10-20, `2.2.0-rc.4`, younger than 14 days) are release candidates [T10]. Access and price depend on the operator |

**Port.** `phoneIntelligence` with values `twilio-lookup`, `sandbox`, and later `telesign` or `camara`. Request: `{ e164, packages: ('line_type' | 'carrier' | 'sim_swap' | 'line_status' | 'porting')[] }`. Answer: normalised fields with `provider` and `sandbox`. An unbound provider answers `provider_not_configured` for adapter-only fields (ADR 0002 §3e). Only the numbering-plan fields are filled in that case.

**Own evidence (R).** A confirmed SMS OTP in the same inquiry (C55) proves the number was reachable and held by the user at that time. `phone-reachable-at-otp: true` (ours) is the honest free reachability signal.

### 2.3 Proposed phone-type mapping and risk rule (H, `beta`)

Map numbering-plan types onto the public `phone-type` vocabulary [P2] without inventing a network answer:

| libphonenumber | `phone-type` | `phone-risk-level` / `phone-risk-recommendation` | Confidence |
|---|---|---|---|
| not valid | `INVALID` | `high` / `block` | 0.95 |
| `PREMIUM_RATE`, `SHARED_COST`, `UAN` | `RESTRICTED_PREMIUM` | `high` / `block` | 0.9 |
| `TOLL_FREE`, `PAGER`, `VOICEMAIL` | the same names | `high` / `block` (the same set Phase 5 refuses for OTP [R4 C55.8]) | 0.9 |
| `VOIP` (where the plan has one) | `VOIP` | `medium-high` / `block` (configurable) | 0.7 |
| `PERSONAL_NUMBER` | `PERSONAL` | `medium-low` / `allow` | 0.5 |
| `MOBILE`, `FIXED_LINE` | the same | `low` / `allow` | 0.5 |
| `FIXED_LINE_OR_MOBILE` | `null`, with our `phone-type-numbering-plan: FIXED_LINE_OR_MOBILE` | `low` / `allow`, flag `line_type_undetermined` | 0.3 |

- With `phoneIntelligence` bound, the network type replaces the plan type: `nonFixedVoip` maps to `VOIP` `high`/`block`, `fixedVoip` to `FIXED_LINE`.
- SIM swap within 24 h gives `high`; within 7 days, `medium-high`.
- A recent port gives `medium`. Its window is **not documented** by any source here and is ours to choose.
- `phone-risk-score` stays `null` unless a provider returns one, which is passed through with its provider id. **We never synthesise a vendor-style 0–1000 score** from the numbering plan.
- `PREPAID`, `PAYPHONE` and `OTHER` appear only from a provider.

---

## 3. Address lookup (`report/address-lookup`)

### 3.1 What we can compute (R)

| Output | How | Data and licence |
|---|---|---|
| Parsed and normalised components (`resolved-*` as **normalised**, not postal-corrected; flag `resolution: normalised`) | Phase 5's libpostal-style normaliser [R4 C58.4] | libpostal dictionaries (MIT), OpenCage `address-formatting/conf` (MIT), libaddressinput postal regexes (CC BY 4.0) [R5 §2.3] |
| Postcode format valid; US ZIP prefix ↔ state consistency | libaddressinput regexes for 180 regions; US/CA `sub_zips` [R5 §2.3] [A19] | CC BY 4.0, attributed ✅ |
| PO box, APO/FPO/DPO with `AA`/`AE`/`AP`, `PMB` designator | Phase 3 `id_po_box_detection` patterns, exported in Phase 5 [R4 C59.3] | ours ✅ |
| Coarse coordinates (`metadata-latitude`/`-longitude`, `metadata-precision: postcode`, ours) | The postcode centroid from the GeoNames postal dump | CC BY 4.0, rebuilt daily; `allCountries.zip` 19.7 MB, `US.zip` 634 KB; the GB file contains Royal Mail data [R5 §2.3] [A18] ✅ (attribution; check the GB rows' notice before using them) |
| `metadata-time-zone` | From the US state or postcode **(H)**. Polygon time-zone data (OSM-derived boundary builders) would be ODbL **(inference: not checked here)** | ⚠️ coarse only |

These answer "is this a well-formed address that could exist", never "mail is delivered here".

### 3.2 Geocoders and their terms

| Option | Code licence | Data licence | Terms that decide it | Verdict |
|---|---|---|---|---|
| **Public Nominatim** (`nominatim.openstreetmap.org`) | n/a | **ODbL** (share-alike); small extracts are likely fair use [A1] | At most 1 request per second; an identifying User-Agent; caching required; no bulk, no autocomplete; **no personal data or confidential material may be submitted** [A1] | ❌ An end user's address is personal data |
| **Self-hosted Nominatim** | **GPL-3.0** (osm-search/Nominatim; latest v5.3.3, 2026-10-14; newest ≥14 d v5.3.2, 2026-04-19) [A3] | ODbL | Run as a separate service, so the GPL is not linked into us **(inference)**. The OSMF geocoding guideline (endorsed 2017-08-24) says individual results are an insubstantial extract and **do not trigger share-alike** when the database is unmodified and the results are not aggregated into a substantial database. Attribution to OpenStreetMap is still required [A2] | ⚠️ operator-run only; ODbL data at runtime conflicts with rule 4 as written (owner) |
| **Photon** (komoot) | **Apache-2.0** (latest 1.3.0, 2026-08-07, ≥14 d) [A4] | ODbL (built from OSM) | As above | ⚠️ the best self-hosted option if the owner allows ODbL data under the guideline |
| **Pelias** | **MIT** [A5] | Mixed: OSM (ODbL), OpenAddresses (per source; "many others have a share-alike clause"), Who's On First (format CC0; per-source terms), GeoNames (CC BY) [A5] [A6] | Attribution per source | ⚠️ the same ODbL question, plus per-source vetting |
| **OpenAddresses** | BSD-3-Clause (repo), MIT (batch) [A7] | Per source; "most sources only require attribution" [A7]; Pelias reports many share-alike sources [A5] | Per-source licence file | ⚠️ only per source after vetting; says an address exists, not that it is deliverable |
| **US Census Geocoder** | US government service | TIGER/Line-based; batch up to 10,000 records [A17] | Terms and privacy are **not documented** on the API page [A17]; sending end-user addresses to a third party is an operator decision | ⚠️ adapter only, off by default |

### 3.3 National postal sources (licensed)

| Source | Facts | Verdict |
|---|---|---|
| **USPS Addresses API v3** (Web Tools retired 2026-01-25 [A9]) | Account registration with identity proofing; an Operational Test API licence to keep using the Addressing API; use limited "to facilitate USPS shipping or mailing transactions" (quoted because it decides the question), with other uses needing a specific USPS licence; datamining, address lists and AI or database building prohibited; deletion on demand; terms last updated 2026-01-22 [A8] | ❌ for identity verification without a separate USPS licence |
| **USPS DPV and RDI** (data products for CASS software) | DPV says whether a ZIP+4 address is a known delivery point and needs certified software [A11]. RDI says residential or business, is updated monthly as hash tables, and is licensed through a certified vendor or the NCSC [A10] | A (through a CASS-certified vendor) |
| **Royal Mail PAF** (UK) | Licensed for a fee. Royal Mail must offer it on reasonable terms under the Postal Services Act 2000 [A13]. A 2022 factsheet caps one organisation's PAF fees at £18,400 a year (plus £2,175 each for Multiple Residence and Not Yet Built) [A12]. Current prices are **not documented** in the sources read | A |

### 3.4 Commercial verification (one line each)

- **Smarty US Street API:** CASS-certified (badge). Its `metadata` (`record_type`, `zip_type`, `county_fips`, `carrier_route`, `rdi`, `precision`, `time_zone`, `ews_match` and more) and `analysis` (`dpv_match_code`, `dpv_footnotes`, `dpv_cmra`, `dpv_vacant`, `dpv_no_stat`, `active`, `footnotes`, `lacslink_*`, `suitelink_match`, `enhanced_match`) are exactly the public parity fields; credentials go in `auth-id`/`auth-token` [A14].
- **Google Address Validation API:** validates components, geocodes, and offers USPS CASS for the US and PR (`enableUspsCass`). USPS reviews artificially created addresses, and Google must then stop service and report the customer to USPS. Google Maps Platform service terms apply [A15].
- **Loqate (GBG) Address Verify:** 250 countries and territories, an Address Verification Code describing match quality, geocoding; pricing on a separate page [A16].

**Deliverability, residential versus commercial, vacancy, CMRA and unit (secondary) validation need licensed postal data** (USPS DPV/RDI/LACSLink/SuiteLink in the US, PAF in the UK) through a certified vendor. We cannot do them for free, and we say so.

### 3.5 Port and sandbox

**Port `addressVerification`.** Values: `smarty` (first real adapter), `sandbox`, unset; later `google` and `loqate`, and `geocoder-photon` only if the owner approves (Needs the owner B3).
- Request: the normalised components and the country. Only those fields reach the vendor; never the addressee unless the template sends it.
- Answer: `deliverability` (`confirmed`, `confirmed-missing-secondary`, `confirmed-secondary-invalid`, `not-confirmed`, `unknown`), `residential` (`residential`, `commercial`, `unknown`), `cmra`, `vacant`, `active`, the standardised address, the geocode with precision, the raw vendor codes in a `vendor` object, and `provider`.
- Unbound: the USPS-derived parity fields are `null` with `provider_not_configured`, and the R fields of §3.1 are still filled.

**Sandbox (deterministic, sandbox environments only; the house number decides, as the last-four-digits rule does elsewhere [R8]):**

| House number | Answer |
|---|---|
| `1000` | confirmed, residential |
| `1001` | confirmed, commercial |
| `1002` | not confirmed (undeliverable) |
| `1003` | confirmed, CMRA |
| `1004` | confirmed, vacant |
| `1005` | confirmed, secondary missing |
| `1006` | confirmed, secondary invalid |
| anything else | normalised echo with `deliverability: unknown` |

---

## 4. Crypto-address watchlist (`report/crypto-address-watchlist`)

### 4.1 The free data: OFAC SDN digital-currency addresses (R)

**Source.** OFAC Sanctions List Service exports [C1] [C2] [C3]:
- `SDN.CSV`: 5,744,136 B, SHA-256 `96dade5a…0f70bda`, S3 folder dated 2026-10-20.
- `SDN_ADVANCED.ZIP`: 5,737,099 B, SHA-256 `5b157b9e…09283313`. Its `SDN_ADVANCED.XML` is 127,668,232 B, with `DateOfIssue` 2026-10-21.
- Both are downloaded through a `302` from `sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/<file>` to a pre-signed S3 URL that lasts one hour (observed).

**Licence.** US government work, not subject to copyright under 17 U.S.C. §105 [C10] **(inference applied to OFAC data)**. The SLS page states no terms of reuse [C3]. The watchlist note covers this in full. Status: ✅. The 14-day rule does **not** apply to sanctions data: the newest verified publication must be used **(inference; a 14-day delay would screen against a stale list)**.

**Encoding.** In the advanced XML:
- each address is a `Feature` whose `FeatureTypeID` resolves to `Digital Currency Address - <TICKER>`;
- the value is in `FeatureVersion/VersionDetail`;
- the feature hangs off the party's `Profile`, whose `PartySubTypeID` and `PartyTypeID` give `Entity` or `Individual` (observed).

In `SDN.CSV` the addresses appear only inside the free-text remarks column, as `Digital Currency Address - XBT <address>;`. **That column is cut at 1,000 characters**: 36 rows are exactly 1,000 characters long. 26 of them carry digital-currency addresses, several cut mid-address (observed).

**Counts** (observed in `SDN_ADVANCED.XML` of 2026-10-21; the CSV counts are in brackets):

| Ticker | Features (unique) | Address formats found (observed checksum results) |
|---|---|---|
| XBT | 534 (532) [CSV 261] | base58check `0x00` 209, `0x05` 178, bech32 v0 146 (all valid); **1 TRON-format address under XBT**; 4 also listed as USDT (Omni) |
| TRX | 261 (261) [87] | all TRON base58check `0x41`, valid |
| ETH | 120 (120) [87] | 65 mixed case, **all with a valid EIP-55 checksum**; 55 all lower case (no checksum) |
| USDT | 94 (94) [43] | TRON 79; EVM 8; Bitcoin base58 (Omni) 7 |
| LTC | 14 (13) | `L` (`0x30`) 12, `M` (`0x32`) 1, bech32 `ltc1` 1 |
| XMR | 11 (11) | 10 standard (95 characters); **1 is a 64-hex string, not a Monero address** |
| BCH | 7 (7) | CashAddr 6 (valid), legacy base58 1 |
| DASH 5, ZEC 4 (t-addr, `0x1cb8`), SOL 4 (32 bytes, no checksum), USDC 2, DOGE 2, ETC 1, BTG 1, BSV 1, XVG 1, XRP 1, ARB 1, BSC 1, BNB 1 | | BNB is a valid bech32 `bnb1…` (the retired BNB Beacon Chain); ARB and BSC share one EVM address with ETH |

- **Totals:** 1,066 features and 1,050 unique canonical addresses on **106 parties** (33 entities, 73 individuals); 594 addresses on entities and 472 on individuals.
- **Concentration:** the busiest party has 134 addresses, and 12 parties have more than 20.
- **Cross-listing:** 10 addresses appear under more than one ticker (observed).
- **CSV versus XML:** the CSV yields 506 unique strings, 14 of them not exact matches: 11 truncated fragments and 3 complete addresses with a trailing full stop. After stripping that full stop, 555 of the 1,050 XML addresses are missing from it (558 only if the 3 are counted as missing) (corrected in fact-check).
- **Correction:** Phase 5's per-ticker counts (XBT 262 …) [R5 §4.2] were taken from the CSV and undercount by about half.

**Other free sources.** OpenSanctions republishes crypto wallets but licenses its data CC BY-NC 4.0 and sells commercial licences [C8] ❌. The UN, EU and UK lists were **not checked** for wallet addresses in this note.

### 4.2 Matching rules per chain

Matching is **exact on a canonical form**: one changed character is a different address, so there is **no fuzzy matching** for addresses.
- **Canonicalisation.** Reuse Phase 5's C57 canonicalisation [R4 C57.2]: EVM lower-case hex; bech32 and bech32m lower case (BIP-173 forbids mixed case [C9]); CashAddr lower case, with or without `bitcoincash:`; base58 exact and case-sensitive (BTC legacy, LTC, DOGE, DASH, ZEC t-addr, TRON, XRP, Solana, Monero).
- **Input clean-up.** Strip a URI scheme and query (`bitcoin:` BIP-21, `ethereum:` EIP-681) and surrounding whitespace before canonicalising.
- **Chain comes from the format, not the ticker.** Classify each list entry by format (the Phase 5 validators). Keep the listed ticker as metadata (`crypto-addresses[].type`, parity [P4]). An EVM address listed under ETH also matches the same address on any EVM chain, because it is the same key **(inference; OFAC itself lists one address under ETH, ARB and BSC)**.
- **Validate the query, not the list.** The list contains entries that fail validation (the 64-hex XMR value) or carry a misleading ticker. Ingest every entry as a raw string plus its canonical form, and never drop an entry because it fails a checksum (observed).
- **Related keys (H, flag only).**
  - A BCH legacy address and its CashAddr encode the same hash: convert both to (type, hash160) and match.
  - A BTC address with the same hash160 as a listed BCH or BSV address is the same private key on a forked chain. Report it as `related_key`, review-level, never as a list match **(inference)**.
- **Result shape (parity).** List `name`/`url`/`slug`/`list-type`, then the party: `name`, `alias-type`, `birthdates` with `granularity`, and **all** of the party's `crypto-addresses` [P4] [H4].
- **Continuous monitoring.** Keep a blind index (HMAC, as C53 [R4]) of each monitored canonical address. On every new publication, diff the address set and look up only the added addresses in the index. Monitoring then never decrypts stored inputs **(inference: design proposal)**.
- **Ingestion.** Parse `SDN_ADVANCED.XML` (or `SDN_ENHANCED.XML`), never the CSV. Stream-parse with entity expansion refused, as Phase 5 does for XMP [R4 C60.2]. Use the same refresh job as the person watchlist.
- **Redirect.** The OFAC `302` conflicts with C54.6's no-redirect rule [R4 C54.6]. Either allow exactly one HTTPS redirect from `sanctionslistservice.ofac.treas.gov` to the exact S3 host `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`, sending no credentials, or run the fetch as an operator-run sync like C62.7 [R4 C62.7]. Either way the parsed file is checked (root element, `DateOfIssue` not older than the stored one, size bounds).

### 4.3 What commercial analytics add (A)

A list hit covers only the addresses OFAC names. Analytics vendors add **clustering** (addresses controlled by the same entity), **attribution** (exchanges, mixers, darknet markets) and **direct or indirect exposure** (funds within N hops of a sanctioned cluster), with a risk score.

| Vendor | Public facts | Status |
|---|---|---|
| Chainalysis | Address Screening is a commercial product reached through a demo request, with APIs [C5]. Its free on-chain **Sanctions Oracle is deprecated**: "no longer supported or maintained", no new addresses, last updated 2026-03-18 [C4] | ❌ for the oracle; A for the paid product |
| TRM Labs | A free sanctions screening API was announced in 2022 [C6]; the current docs need a login [C6] | Status **not documented** publicly; A |
| Elliptic Lens | Wallet and transaction screening with a risk score, more than 60 blockchains and 250 bridges [C7]; access and pricing not stated | A |

**Port `cryptoExposure`.** Values `sandbox`, and later `chainalysis` or `trm`. Answer: `{ directSanctioned, exposure: [{ category, share, hops }], cluster?, riskScore?, provider }`. These map onto the separate vendor report types in the surface [S1] (`chainalysis-address-screening`, `trm-wallet-screening`), not onto the R-tier watchlist report.

**Sandbox.** The watchlist report runs on real OFAC data in every environment. It is R-tier, so no sandbox is needed for correctness. For tests and demos, sandbox environments also load a **synthetic fixture list**: a fictitious party named "Sandbox Listed Party" whose addresses are published test vectors, for example the EIP-55 example `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed` and a BIP-173 example address. No real sanctioned address or person is committed (CLAUDE.md rule 3 [R3]).

---

## 5. Business watchlist (`report/business-watchlist`)

### 5.1 What to match against

- **Entries.** The person-watchlist ingestion also yields the non-individual entries:
  - OFAC SDN: 10,042 entities, 1,568 vessels and 342 aircraft in the 2026-10-21 publication (observed [C2]);
  - the UN, EU and UK lists' entities (counted in the watchlist note).
- **Fuzzy name match.** Use the shared matcher (normalisation, transliteration, Jaro-Winkler, token set) with business-name rules from Phase 5 C58.6 [R4]: legal-form canonicalisation, `&` ↔ `and`, a leading "The", punctuation.
- **Legal-form data:**

  | Source | Version (date) | Licence | Size | Verdict |
  |---|---|---|---|---|
  | **rigour** `resources/names/org_types.yml` (OpenSanctions) | commit `607fa82` (2026-09-21) | **MIT** (`LICENSE` at the commit, © 2023-2025 OpenSanctions Datenbanken GmbH) [B9] | 126,592 B, SHA-256 `772d6c6c…9f087f20`; 466 types and 1,905 aliases (corrected in fact-check: 2,371 is the aliases plus the 466 entry lines), `generic` tags `LLC`, `JSC`, `LP`, `LLP`, `GP`, `SP`, `COOP`, `NGO`, `SOE`, `FIN`, `JV`, `MIL`, `REL` (observed) | ✅ **seed**, pinned in `data/manifest.json`, generated into a TS table. Built for sanctions matching. The rigour PyPI package is not needed: latest 2.6.1 (2026-10-21), newest passing 2.5.0 (2026-09-10) [B9] |
  | GLEIF **ISO 20275 ELF code list** | v1.6 (2026-02-19) | **Not documented**: the page shows "Copyright GLEIF 2026". The LEI data terms grant CC0 for data "available through the Access Service" and do not mention code lists [B10] [B11] | 757,673 B CSV, SHA-256 `c55edc42…25506ef4`; 4,002 rows, 3,599 codes, 130 countries; 1,518 rows with local abbreviations, 56 transliterated (observed) | ⚠️ Cross-check only until the licence is confirmed (owner) |

- **Matching rule.** Compare names with legal forms canonicalised to their `generic` tag:
  - the same name with different generic forms (`LLC` versus `JSC`) is at most `partial`, with a flag;
  - a form present on one side only is ignored for the level, with a flag.

  This follows C58.2's rule for differing forms [R4]. A business name stripped down to one common word ("Global") is too weak to report alone **(inference)**: require a second token or an identifier, or go to review.
- **Country filter.** Use `address-country-code` [P5] against the entry's country features (OFAC `Location`, `Nationality of Registration`; other lists' address countries). An entry without a country is never filtered out: missing is not a mismatch (C58.1 [R4]).
- **Deterministic identifier matches (R, beside the name).** These come from KYB (Phase 5) or the request, and need exact equality after normalisation:

  | Identifier | OFAC SDN count (observed [C2]) | Normalisation |
  |---|---|---|
  | LEI (`Legal Entity Number`) | 186 | 20 characters, ISO 17442 check digits; links straight to the GLEIF record of C61 |
  | Registration / company / business registration number | 4,501 (4,487 on `Entity` records; corrected in fact-check) / 535 / 739 | Per country, as C52.3 validates them [R4]; compare only within the same country |
  | Tax id | 4,382 (3,839 on `Entity` records, 543 on individuals; corrected in fact-check) | Per country |
  | Website domain | 1,289 features | The registered domain of the KYB website (C61), lower case |
  | Email address | 219 features | Lower case; the domain alone is not a match |
  | SWIFT/BIC | 227 features | 8 or 11 characters, upper case; the first 8 compared |
  | Vessel IMO number (`Vessel Registration Identification`) | 1,568 (1,555 pass the 7-digit check, 10 fail, 3 lack 7 digits) | Check digit = Σ dᵢ·(7−i) for i = 0…5, mod 10 |
  | Vessel MMSI | 835 | 9 digits |
  | Aircraft MSN / tail number | 292 / 156 features | Upper case, separators stripped |

  An identifier hit is a `full` match whatever the name says. A name-only hit is levelled by the matcher.
- **Output.** `matched-lists` (slugs), `sanction-list[]` and `ignore-list[]` with `match-levels` [P5]. `fitness-probity-list[]` and `warning-list[]` stay empty: no free source for regulator warning lists has been vetted (Needs the owner C2), and we say so in the result's `lists-searched`.

### 5.2 Ownership and the 50 percent rule (what we cannot do)

**The rule.**
- OFAC treats an entity as blocked when one or more blocked persons own **50 % or more** of it, directly or indirectly, **in aggregate**. Stakes held under different programmes count together (FAQ 399, 2014-08-13) [B3] [B1].
- Indirect ownership runs through intermediate entities that blocked persons own 50 % or more (FAQ 401, with worked examples) [B2].
- Control without 50 % ownership does not block automatically, but OFAC may designate the entity (FAQ 398, 2020-08-11) [B1]. Dealings with a blocked person acting for a company stay prohibited (FAQ 400) [B1].
- OFAC "urges persons" to research ownership themselves (quoted because it sets who carries the burden) [B2].
- The UK tests ownership of **more than 50 %** or control, and OFSI said in 2022 it would not simply aggregate different designated persons' holdings. These are secondary sources [B4] [B5]; the EU criteria were **not re-read** here.

**Why we cannot apply it.** Applying the rule means walking a complete ownership graph with percentages, across borders, and summing the stakes of listed owners. No free, licence-clean source gives that:

| Source | What it gives | Why it is not enough |
|---|---|---|
| UK Companies House PSC (Phase 5 provider, free key) | Persons with significant control in bands: `ownership-of-shares-25-to-50-percent` means more than 25 % and not more than 50 %; `50-to-75` means more than 50 % and not more than 75 %; `75-to-100` [B6] | UK companies only. Owners of 25 % or less are not listed. **Exactly 50 % falls in the 25-to-50 band**, so OFAC's "50 % or more" boundary cannot be decided, and two listed owners in the 25–50 band cannot be summed. Self-declared and possibly stale |
| GLEIF Level 2 (CC0) | Direct and ultimate **accounting-consolidation** parents [B7] | Not percentages, and not ownership as the rule defines it |
| Open Ownership register (BODS) | Closed on 2024-11-29; republished datasets remain; ODC-By, attribution required [B8] | A few countries; personal data; not maintained as a register |
| Commercial ownership graphs (Moody's Orbis, Dun & Bradstreet, Sayari, Kharon, LSEG and others) | Percentages and graphs | Not researched here; A only |

**What we can do (honest subset):**
1. **Screen the business's known persons.** Officers, PSCs (Companies House) and owners submitted in KYB (C61.7) go through the person watchlist report (R).
2. **Flag owners we know about (H, `beta`):**
   - `owner_listed_majority`: a PSC in the `50-to-75` or `75-to-100` band is itself listed. Under OFAC's rule the company is then blocked, so this is review-level and high confidence. It appears only for UK companies.
   - `owner_listed_minority`: a listed PSC in the 25-to-50 band. Review.
   - `parent_listed`: a GLEIF direct or ultimate parent (by LEI) is listed. Review.
3. **State the limit in every result and in the docs.** For example: "Not an assessment under OFAC's 50 percent rule or the EU and UK ownership-and-control tests; ownership data covers UK PSCs and GLEIF parents only." Never mark a business "clear" on ownership grounds.
4. **Port `beneficialOwnership`** (sandbox only in Phase 6) for an operator's licensed ownership data later.

### 5.3 Adverse media for businesses (briefly)

GDELT's terms allow "unlimited and unrestricted use" (quoted because it decides the licence question), including commercial use, with a citation and a link to GDELT [B12]. The DOC 2.0 API searches a rolling three months and returns at most 250 records per query. It supports exact phrases, `sourcecountry:`, `sourcelang:`, `domain:` and `theme:` operators [B13].

How businesses differ from persons:
- **Legal forms.** Articles rarely include them, so search the name with its form stripped.
- **Ambiguity.** Stripping the form makes common words ambiguous ("Apple", "Global"). Require the full distinctive phrase in quotes, plus either the country (`sourcecountry:` or the name of the country) or a second distinctive token.
- **No birth dates.** Businesses have none to filter on; registration number, city and website domain are the disambiguators.
- **Themes.** Business-relevant themes (fraud, corruption, sanctions, money laundering, regulatory action) differ from person themes. The theme list belongs to the adverse-media note.
- **Output.** The DOC API returns article metadata, not article text **(inference)**. A match is a link for the reviewer, `beta`, never a finding on its own.

---

## 6. Cross-cutting: privacy, honesty and provenance

- **Inputs are sealed.** Email addresses, phone numbers, addresses and crypto addresses go into the `encrypted` column helper. The business `term` should be sealed too, because a sole trader's business name is a person's name **(inference)**. Monitoring uses blind indexes.
- **Vendors receive only their port's request fields** (C63 [R4]): never the reference id, the account or other inquiry data. Every vendor is a processor under the operator's contract. HIBP requires its consents warranty [E20].
- **Attribution in the report UI and API.** CC BY 4.0 HIBP data names HIBP [E18]. GeoNames and libaddressinput data are credited [R5 §2.3]. GDELT is cited [B12]. OSM is credited if an OSM geocoder is ever bound [A2].
- **No fake answers.** Fields that need a provider are `null` with `provider_not_configured` (ADR 0002 §3e). Fields computed by a heuristic carry `beta`, a confidence, reasons and thresholds (§3c). `resolved-*` from our normaliser is labelled `normalised`. Phone location is labelled `numbering-plan`. The carrier is labelled `original-carrier`.

---

## 7. Proposed sandbox magic values (sandbox environments only; `provider: { id: "sandbox", sandbox: true }`)

| Report | Magic | Answer |
|---|---|---|
| Email | Domains under the reserved TLDs (C56's rule [R4]): `disposable.example`, `relay.example`, `new.example` (3 days old, as C61.6), `old.example` (20 years); local-part tokens `sandbox-breached`, `sandbox-spam` | Disposable, relay, young domain, old domain; a breach in the last year (adapter path) and a spam-trap flag (adapter path). Anything else gets the real R logic with DNS skipped for `*.example` |
| Phone | NANP fictional numbers `+1 NPA 555 01xx`. NANPA reserves 555-0100 to 555-0199 for fictional use [T11], and they are `valid`, `FIXED_LINE_OR_MOBILE` in libphonenumber (observed [T3]). The last two digits pick the answer. Australian `0491 570 xxx` (ACMA fictitious mobiles [T12]; `+61 491 570 156` is `valid`, `MOBILE`, observed) for a non-NANP mobile | `00` mobile, low; `01` non-fixed VoIP, high; `02` prepaid; `03` SIM swapped within 24 h; `04` ported in the last 30 days; `05` unreachable; `06` fixed VoIP; others: numbering plan only |
| Address | House number `1000`–`1006` (§3.5) | Confirmed, commercial, undeliverable, CMRA, vacant, missing or invalid secondary |
| Crypto watchlist | The synthetic fixture list (§4.3) | A hit on "Sandbox Listed Party" |
| Crypto exposure | EVM addresses ending in `…dead` / `…beef` | Indirect exposure, 2 hops / direct cluster |
| Business watchlist | Synthetic fixtures: the name "Sandbox Sanctioned Holdings Ltd"; LEI `5299000SANDBOXLEI047`, whose ISO 7064 MOD 97-10 check digits are valid and which GLEIF reports as not issued (observed: `total 0` [B14]); IMO `9999993`, which passes the check digit (whether it is assigned to a real vessel was **not checked**) | Name hit, identifier hit, vessel hit |

No magic value is a real person's or company's name, unlike the public sandbox inputs [H6].

---

## 8. Report type → what we compute

| Report type | R (real) | H (`beta`, confidence) | A (adapter + sandbox) | Data and licences |
|---|---|---|---|---|
| `report/email-address` | `email-domain`, `email-domain-exists`, `email-is-valid-mx` (null MX aware), `email-domain-accepts-mail`*, `email-is-disposable`, `email-domain-age-days` (RDAP), `email-is-free-provider`* (informational), `email-is-relay`*, `email-is-role-account`*, `email-mx-provider`*, `email-spf-policy`*, `email-dmarc-policy`* (RFC 9989), `email-is-deliverable` (true only after a confirmed OTP), `email-first-seen-in-environment-days`* | `email-reputation`, `email-is-suspicious` (§1.9 rule), `email-domain-typo-suggestion`*, `mx_of_disposable_service` | `email-credentials-leaked-recent` (HIBP), `email-is-spam`, `email-malicious-activity-detected-recent`, `email-estimated-age-days` (reputation vendor such as SEON) | Disposable list CC0 @ `6fcca80` ✅; authored free-mail, relay, role and MX-provider tables (ours) ✅; RFC 2142 ✅; IANA RDAP bootstrap CC0 ✅; HIBP CC BY 4.0 under paid terms ⚠️; goware MIT / derhuerst ISC ⚠️ (provenance, not adopted); Kikobeats ❌; willwhite ❌; HubSpot ❌ |
| `report/phone-number` | `phone-country-code`, possible/valid*, `phone-type` from the numbering plan (mapping §2.3), `phone-city`/`phone-subdivision` (numbering plan), `phone-reachable-at-otp`* | `phone-risk-level`, `phone-risk-recommendation` (type rule), `phone-carrier` as the original range holder (not US/CA) | Network line type, non-fixed VoIP, current carrier, porting, `phone-risk-sim-swap`, line status and reachability, prepaid and payphone, `phone-risk-score` (Twilio Lookup v2, Telesign, Vonage Identity Insights, CAMARA SIM Swap) | libphonenumber-js 1.13.15 MIT ✅ (2026-10-08, passes); libphonenumber v9.0.41 geocoding and carrier data Apache-2.0 ✅ (2026-10-08, passes); vendors under contract ⚠️ |
| `report/address-lookup` | Parse and normalise (`resolved-*` labelled normalised), postcode validity, ZIP ↔ state, PO box / APO/FPO/DPO / PMB, postcode-centroid coordinates (`precision: postcode`*) | CMRA keyword hint, coarse time zone | DPV match code and footnotes, CMRA, vacant, active, RDI, LACSLink, SuiteLink, carrier route, county, congressional district, ZIP type, building default, EWS, rooftop geocode (Smarty, Google, Loqate); UK PAF | libpostal dictionaries MIT ✅, OpenCage conf MIT ✅, libaddressinput CC BY 4.0 ✅, GeoNames CC BY 4.0 ✅; USPS APIs ❌ (shipping and mailing only); PAF licensed (A); OSM/Nominatim/Photon/Pelias data ODbL ⚠️ (operator-run only, owner); public Nominatim ❌ (no personal data) |
| `report/crypto-address-watchlist` | Exact canonical match against OFAC SDN advanced XML (1,066 features, 20 tickers), the full party record in the parity shape, monitoring by blind-index diff | `related_key` (same hash160 on a forked chain) | Exposure, clustering, attribution, risk score (Chainalysis, TRM, Elliptic; also their own report types) | OFAC SDN, US government work ✅; OpenSanctions CC BY-NC ❌; Chainalysis oracle deprecated ❌ |
| `report/business-watchlist` | Name match on entity entries (OFAC, UN, EU, UK), legal-form canonicalisation, country filter, exact identifier matches (LEI, registration and tax numbers, website, email, SWIFT/BIC, IMO, MMSI, aircraft MSN and tail), screening of known persons through the person watchlist | `owner_listed_majority`, `owner_listed_minority`, `parent_listed` (UK PSC bands, GLEIF Level 2), business adverse media (GDELT) | Warning and fitness-and-probity lists, ownership graphs (50 % rule), commercial screening (`comply-advantage-search` in the surface) | rigour `org_types.yml` MIT @ `607fa82` ✅; GLEIF ELF v1.6 licence not documented ⚠️; Companies House PSC (no reuse restrictions; personal data) ✅; GLEIF Level 2 CC0 ✅; GDELT commercial use allowed with a citation ✅; Open Ownership ODC-By ⚠️ |

\* Ours: no public counterpart, labelled as such.

---

## What Phase 6 should take from this (proposed)

1. **Report fields and tiers.** Implement the five reports with the parity identifiers of §0 and the R/H/A split of §8. Our additional fields are marked "ours". Adapter-only fields are `null` with `provider_not_configured`; heuristics carry `beta`, a confidence, reasons and thresholds.
2. **New provider kinds (a C63-style amendment).** `emailIntelligence` (`hibp`, `sandbox`), `phoneIntelligence` (`twilio-lookup`, `sandbox`), `addressVerification` (`smarty`, `sandbox`), `cryptoExposure` (`sandbox`) and `beneficialOwnership` (`sandbox`). Each is unbound by default; a sandbox binding in production refuses to start (ADR 0002 §3d). Real adapters go through the C54.6 outbound client with their own content-type allowlist and response cap.
3. **Authored data, committed and reviewed.** `free-mail-domains.json` (about 200 rows with source URLs, `kind` free / paid-consumer / relay), `role-local-parts.json` (RFC 2142 plus about 65 authored), `mx-providers.json` (about 30 suffixes, including relay and disposable-service MX hosts). A build test asserts no free-mail row is on the disposable list.
4. **Pinned data through `data/manifest.json`** [R6]: rigour `org_types.yml` @ `607fa82` (MIT), and libphonenumber `resources/geocoding/en` and `resources/carrier/en` at v9.0.41 (Apache-2.0, NOTICE line). Each is generated into compact TS tables, with the source commit and SHA-256 recorded beside them.
5. **Amend the DNS port.** Add `resolveTxt` (4 KiB cap, same error mapping as [R7]). Implement the RFC 9989 DMARC tree walk (≤ 8 queries). Parse SPF without following `include:`. Cache like MX (1 h positive, 5 min negative).
6. **Amend the RDAP port.** Add a `registered-domain` answer mode with a `subdomain` flag for email domains; skip known free-mail domains.
7. **Deliverability and reachability come only from our own OTP.** `email-is-deliverable: true` and `phone-reachable-at-otp: true` only when a confirmed OTP for the exact destination exists in the inquiry. No SMTP probing.
8. **Crypto ingestion from `SDN_ADVANCED.XML`, never `SDN.CSV`.** Derive the chain from the address format; keep the raw string, canonical form and ticker; never drop an entry that fails a checksum. Re-screen monitored addresses by blind-index diff on each publication. Correct Phase 5's ticker counts in `docs/research/phase5-libraries.md` §4.2.
9. **Resolve the OFAC redirect.** Allow exactly one HTTPS redirect to the exact OFAC S3 host for the sanctions fetcher, or run it as an operator sync (owner question D1). Validate the file before swapping it in.
10. **Business screening.** Exact identifier matches beside fuzzy names (LEI, registration numbers within a country, website domain, SWIFT/BIC, IMO with its check digit, MMSI, aircraft serials). Screen officers, PSCs and submitted owners through the person watchlist. Add the three ownership flags. State in every result and in `docs/reports/business-watchlist.md` that this is **not** a 50 %-rule or ownership-and-control assessment.
11. **Phone mapping.** Use the §2.3 type mapping and risk rule. Never synthesise a 0–1000 score.
12. **Address honesty.** `resolved-*` from the normaliser is labelled `normalised`; postcode-centroid coordinates are labelled `precision: postcode`. USPS-derived fields stay `null` without a certified vendor. No USPS API adapter.
13. **Sandbox magic values from §7, documented in `docs/checks/sandbox-providers.md`.** No real names, companies or sanctioned addresses in fixtures.
14. **No new runtime package.** Everything above is our own TypeScript over pinned data, plus adapters over `undici`.

---

## Needs the owner

### A. Accounts, keys and vendor terms (per deployment; none needed for CI)

1. **Phone vendor.** Default: build the Twilio Lookup v2 adapter (self-service, per-request pricing, line type $0.008 [T6]) plus the sandbox. Defer Telesign, Vonage Identity Insights and CAMARA until an operator asks.
2. **Address vendor.** Default: build the Smarty US Street adapter (CASS-certified; the field set is the parity target [A14]) plus the sandbox. Google and Loqate later. **No USPS adapter**, because USPS terms limit use to shipping and mailing [A8].
3. **HIBP.** Default: build the adapter, unbound. The docs say the operator needs its own key on a plan whose terms allow screening its users: Core forbids use on behalf of third parties [E19], and whether Pro or High RPM allows it is **not documented** [E20]. The docs also cover CC BY 4.0 attribution and the consents warranty.
4. **Crypto analytics.** Default: port and sandbox only; no vendor adapter in Phase 6.

### B. Licence and provenance decisions

1. **Free-mail list.** Default: the authored table. Alternative: goware `domains.txt` (MIT) minus the disposable and relay entries. Not recommended, because its sources are unlicensed gists [E10].
2. **Role list.** Default: RFC 2142 plus authored entries. Alternative: Mixmax 3.1.0 (MIT, 1,018 entries, provenance unstated) [E14].
3. **ODbL geocoding** (self-hosted Photon or Nominatim with OSM data). Rule 4 excludes ODbL at runtime, while the OSMF guideline says per-address results do not trigger share-alike [A2]. Default: **not in Phase 6**. If approved, add an operator-run `geocoder-photon` adapter, off by default, never shipping OSM data, with "© OpenStreetMap contributors" shown on results.
4. **GLEIF ELF code list** (licence not documented [B10] [B11]). Default: do not vendor it; use rigour (MIT) and cross-check against ELF offline only. Alternatively, ask GLEIF for a licence statement.
5. **New licences not named in rule 4.** CC BY 3.0 (Majestic Million) appears only through derhuerst `common.json`, which is not adopted. ODC-By (Open Ownership) is not adopted. Default: adopt neither.
6. **Public-domain US government data and `fetch_data.py`.** `PERMISSIVE_LICENSES` has no public-domain identifier [R9]. Default: sanctions data does not go through `data/manifest.json`. The watchlist sync fetches it at run time with verification, and it is never committed.

### C. Policy decisions

1. **Ownership claims.** Default: never claim 50 %-rule or ownership-and-control screening. Ship only the three flags with the stated limit.
2. **Warning and fitness-and-probity lists** (`warning-list`, `fitness-probity-list` [P5]). Default: empty in Phase 6, with `lists-searched` naming what was searched. Vetting regulator warning lists is later work.
3. **Release-age rule and sanctions data.** Default: the 14-day rule applies to code packages and static data commits, never to sanctions publications. They use the newest publication that passes verification.
4. **Privacy relays.** Default: `email-reputation: null` with `privacy_relay`, matching the public skip behaviour [H1]. The alternative is `high` with a flag.
5. **Age estimates from email** (`age-estimated-*` [P1]). Default: not implemented, even as an adapter. They are child-safety-sensitive and the method is not documented.
6. **Report disclaimers.** The public reports carry consumer-reporting disclaimers [H1]–[H5]. Default: our docs say reports are signals for the operator's own decisions, with wording left to the owner's legal review. Nothing is copied.
7. **Phone risk recency windows.** SIM swap 24 h / 7 d and port 30 d are not documented publicly. Default: as in §2.3, configurable per template.
8. **Recent-port and young-domain thresholds.** Defaults `min-domain-age-days` 30 and `young-domain-days` 365, configurable.

### D. Engineering decisions that touch Phase 5 contracts

1. **OFAC redirect versus C54.6.** Default: a one-host redirect allowance for the sanctions fetcher only, tested to refuse any other host.
2. **`DnsResolver.resolveTxt` and the RDAP `registered-domain` mode.** Default: Phase 6 Stage 1 amends both ports, with the Phase 5 owners' tests kept.

---

## Gaps (what could not be established)

- TRM's current free sanctions API: the docs are behind a login [C6]. The Chainalysis free API endpoint: only the deprecated oracle is documented [C4].
- Telesign and Vonage Identity Insights pricing, and Vonage's endpoint and auth: not on the pages read [T7] [T9].
- USPS Addresses v3 field list and rate limits: the developer portal renders client-side and the page returned no API text [A8].
- Current Royal Mail PAF prices: only a 2022 fee cap and older documents [A12].
- Whether the UN, EU or UK lists publish wallet addresses: not checked.
- The licence of the GLEIF ELF code list [B10] [B11].
- The licences of free "range holder" numbering data (NANPA central-office-code reports, Ofcom numbering data): not researched; they could give a US and UK original-carrier signal.
- Emailage, Ekata, IPQualityScore and Kickbox products and terms: not verified.
- The EU ownership-and-control criteria: not re-read. The UK position rests on law-firm summaries [B4] [B5].
- Free regulator warning lists for `warning-list`: not researched.
- The sandbox IMO value in §7 was not checked against a vessel registry. The sandbox LEI was checked against GLEIF: not issued, observed.

---

## Sources and pins

All read 2026-10-22 unless stated. "Observed" means a request or computation made that day. Files were downloaded to a local scratch directory (not committed) and parsed with stdlib Python under `-I`. Nothing downloaded was executed.

### Repository (read-only)

- [R1] `/home/mhnoor/persona-opensource/docs/PLAN.md` §2, §3 (technology table rows: sanctions, PEP/adverse media, KYB, email/phone, IP), §4.4, §6.
- [R2] `/home/mhnoor/persona-opensource/docs/adr/0002-check-tiers.md`.
- [R3] `/home/mhnoor/persona-opensource/CLAUDE.md` (rules 3, 4, 5).
- [R4] `/home/mhnoor/persona-opensource/docs/plans/phase-5.plan.md`: C52.3, C53, C54.6, C55.8, C56, C57, C58 (C58.1–C58.6), C59.3, C60.2, C61 (C61.4, C61.6, C61.7), C62.7, C63.
- [R5] `/home/mhnoor/persona-opensource/docs/research/phase5-libraries.md` §2.3, §2.6, §3.1, §3.3, §4.2, §5.5.
- [R6] `/home/mhnoor/persona-opensource/data/manifest.json`.
- [R7] `/home/mhnoor/persona-opensource/apps/api/src/dns/index.ts` (the `DnsResolver` with `resolveMx`, `resolve4`, `resolve6`).
- [R8] `/home/mhnoor/persona-opensource/docs/checks/sandbox-providers.md`.
- [R9] `/home/mhnoor/persona-opensource/scripts/fetch_data.py` (`PERMISSIVE_LICENSES`).
- [S1] `/home/mhnoor/persona-opensource/docs/research/persona-surface.md` ("Report types (52)", `report_*` webhook events, `reports/*` paths).

### Persona public sources (identifiers only)

`persona-id/persona-openapi` @ `805512b348af1c5d345bea8d7db7eb43d1821872` (commit of 2026-10-21), folder `2026-09-29/components/schemas/`:
- [P1] `report-email-address.yaml`, `report-email-address-request.yaml` — https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/report-email-address.yaml
- [P2] `report-phone-risk.yaml`, `report-phone-risk-request.yaml` — https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/report-phone-risk.yaml
- [P3] `report-address-lookup.yaml`, `report-address-lookup-request.yaml` — https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/report-address-lookup.yaml
- [P4] `report-crypto-address-watchlist.yaml` (+ request) — https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/report-crypto-address-watchlist.yaml
- [P5] `report-business-watchlist.yaml` (+ request) — https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/report-business-watchlist.yaml
- [P6] `report-shared-attributes.yaml`, `report-shared-request-attributes.yaml`, `report-template-*.yaml` — https://github.com/persona-id/persona-openapi/tree/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas
- [P7] Reports overview — https://docs.withpersona.com/reports.md

Help Center (as Markdown, `/articles/<id>.md`; robots.txt allows it):
- [H1] Email Risk Report — https://help.withpersona.com/articles/4IqHs9oWE6ihGakWUzYCcL/
- [H2] Phone Risk Report (last updated 2026-09-30) — https://help.withpersona.com/articles/6MsSJ5GQjHhtIN0xxLLeby/
- [H3] Address Lookup Report — https://help.withpersona.com/articles/79VIhKIprbykNbIDkzkAHt/
- [H4] Crypto Address Watchlist Report — https://help.withpersona.com/articles/562IPh6XJ91ekE3kAEOrLj/
- [H5] Business Watchlist Report — https://help.withpersona.com/articles/4y3oaeL7pc2f5DHKT50smE/
- [H6] Test your Report by triggering hits — https://help.withpersona.com/articles/56sLAbSytkmI57zpbug3xc/
- [H7] Name match requirements for Reports — https://help.withpersona.com/articles/1FOJzuI3uMFmcDuR5zkged/

### Email

- [E1] RFC 5321 (§3.5.3, §5.1, §7.3) — https://www.rfc-editor.org/rfc/rfc5321.txt
- [E2] RFC 7505, null MX (June 2015) — https://www.rfc-editor.org/rfc/rfc7505
- [E3] RFC 7208, SPF (April 2014; updated by 7372, 8553, 8616) — https://www.rfc-editor.org/rfc/rfc7208 (metadata https://www.rfc-editor.org/rfc/rfc7208.json)
- [E4] RFC 9989, DMARC (May 2026, Proposed Standard, obsoletes RFC 7489 and RFC 9091; §4.10 DNS Tree Walk) — https://www.rfc-editor.org/rfc/rfc9989.txt (metadata https://www.rfc-editor.org/rfc/rfc9989.json)
- [E5] RFC 7489 metadata (obsoleted by 9989, 9990, 9991) — https://www.rfc-editor.org/rfc/rfc7489.json
- [E6] RFC 2142, mailbox names — https://www.rfc-editor.org/rfc/rfc2142.txt
- [E7] RFC 6647, greylisting — https://www.rfc-editor.org/rfc/rfc6647.txt
- [E8] Google Cloud, sending email from an instance (port 25 blocked to external destinations) — https://docs.cloud.google.com/compute/docs/tutorials/sending-mail
- [E9] Apple, communicating using the private email relay service — https://developer.apple.com/tutorials/data/documentation/signinwithapple/communicating-using-the-private-email-relay-service.md
- [E10] goware/emailproviders @ `84a3a4874840d9027bcaf26902ebd9d3ec969fa5` (2025-07-21): README and LICENSE (MIT), `generate/domains.txt` (sha256 `54572f5e1195ddb434d8cd27d196c9913fcff80bf2662e7ea34b2f02853fa8d3`), import history — https://github.com/goware/emailproviders/commits/master/generate/domains.txt
- [E11] email-providers (derhuerst) 2.27.0 (2026-10-05), ISC — https://registry.npmjs.org/email-providers ; `build.js` @ `d86966266ff4d717d152f4c3c7427a2dc9a2c2a9` — https://github.com/derhuerst/email-providers/blob/d86966266ff4d717d152f4c3c7427a2dc9a2c2a9/build.js
- [E12] freemail (willwhite) 1.7.0 (2020-07-03), ISC — https://registry.npmjs.org/freemail ; `data/free.txt` @ `5d69d4e6f03564c9083e3b669228479ba7d520f6` (sha256 `9e535d40c69477d353e755a62846ebefdc6c3b662871847535320e6fd28cb84a`) — https://github.com/willwhite/freemail/tree/5d69d4e6f03564c9083e3b669228479ba7d520f6
- [E13] free-email-domains (Kikobeats) 1.15.11 (2026-10-22), newest passing 1.12.22 (2026-10-08), MIT, `postinstall` script — https://registry.npmjs.org/free-email-domains ; README and LICENSE.md @ `6ddc43920ffccae1680ea91330d23174fb6c2692` — https://github.com/kikobeats/free-email-domains/blob/6ddc43920ffccae1680ea91330d23174fb6c2692/README.md ; also `mailcheck` 1.1.1 and `@zootools/email-spell-checker` 1.12.0 — https://registry.npmjs.org/mailcheck , https://registry.npmjs.org/@zootools%2Femail-spell-checker
- [E14] role-based-email-addresses (Mixmax) 3.1.0 (2025-03-26), MIT — https://registry.npmjs.org/role-based-email-addresses ; https://github.com/mixmaxhq/role-based-email-addresses/tree/4ad47311a1b88c47d248433ac5092050bbc12a51
- [E15] Majestic Million (CC BY 3.0 Unported) — https://majestic.com/reports/majestic-million
- [E16] Wikidata search and SPARQL (count of items of Q327618, Q126738381, Q5368818, Q1273203: 65; 63 with P856) — https://www.wikidata.org/w/api.php?action=wbsearchentities , https://query.wikidata.org/sparql
- [E17] Disposable list, as pinned in [R6] — https://github.com/disposable-email-domains/disposable-email-domains/blob/6fcca80a3fd4c4a5f7c364788f3b4812a8325754/LICENSE.txt
- [E18] Have I Been Pwned API v3 — https://haveibeenpwned.com/API/v3
- [E19] HIBP subscriptions — https://haveibeenpwned.com/Subscription
- [E20] HIBP Terms of Use (last updated March 2026) — https://haveibeenpwned.com/TermsOfUse
- [E21] SEON Email API — https://docs.seon.io/api-reference/email-api
- [E22] Observed DNS on 2026-10-22 (Node 22 `node:dns/promises` `Resolver`, 3 s, 2 tries): MX, SPF `all`/`redirect` and DMARC `p=` for gmail.com, outlook.com, yahoo.com, icloud.com, proton.me, zoho.com, fastmail.com, gmx.net, yandex.ru, mail.ru, qq.com, privaterelay.appleid.com, mozmail.com, duck.com, mailinator.com, example.com.

### Phone

- [T1] libphonenumber-js: latest 1.13.15 (2026-10-08T09:14Z, MIT); the repo pins 1.13.14 — https://registry.npmjs.org/libphonenumber-js
- [T2] google/libphonenumber releases (v9.0.41 2026-10-08; v9.0.40 2026-09-24) — https://github.com/google/libphonenumber/releases ; `resources/carrier/en` and `resources/geocoding/en` at v9.0.41 — https://github.com/google/libphonenumber/tree/v9.0.41/resources ; `carrier/en/1.txt` (697 prefixes, 26 NPAs, observed) — https://github.com/google/libphonenumber/blob/v9.0.41/resources/carrier/en/1.txt
- [T3] Observed with `libphonenumber-js@1.13.14` `/max` from the repo's `node_modules`: `+12015550123`, `+12025550100`, `+12025550199` valid `FIXED_LINE_OR_MOBILE`; `+15005550006` valid `PERSONAL_NUMBER`; `+447700900123` possible, not valid; `+442079460123` valid `FIXED_LINE`; `+61491570156` valid `MOBILE`; `+33639980000` not valid.
- [T4] Twilio Lookup v2 API — https://www.twilio.com/docs/lookup/v2-api
- [T5] Twilio Line Type Intelligence — https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence
- [T6] Twilio Lookup pricing — https://www.twilio.com/en-us/user-authentication-identity/pricing/lookup
- [T7] Telesign Intelligence, getting started — https://developer.telesign.com/enterprise/docs/intelligence-get-started
- [T8] Vonage Number Insight overview (sunset 2027-02-04) — https://developer.vonage.com/en/number-insight/overview
- [T9] Vonage Identity Insights overview — https://developer.vonage.com/en/identity-insights/overview
- [T10] CAMARA SimSwap (Apache-2.0; releases r3.3 2025-12-01 = 2.1.0, r4.1 2026-10-06 = 2.2.0-rc.3, r4.2 2026-10-20 = 2.2.0-rc.4) — https://github.com/camaraproject/SimSwap/releases ; https://github.com/camaraproject/SimSwap/blob/r4.1/code/API_definitions/sim-swap.yaml
- [T11] NANPA, 555 line numbers (555-0100 to 555-0199 reserved for fictional use) — https://nanpa.com/numbering/555-line-numbers
- [T12] ACMA, phone numbers for use in TV shows, films and creative works — https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works
- [T13] phonenumbers (PyPI) 9.0.41 (2026-10-08), Apache-2.0 — https://pypi.org/pypi/phonenumbers/json

### Address

- [A1] Nominatim Usage Policy — https://operations.osmfoundation.org/policies/nominatim/
- [A2] OSMF Geocoding Guideline (endorsed 2017-08-24) — https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline
- [A3] osm-search/Nominatim (GPL-3.0; v5.3.3 2026-10-14, v5.3.2 2026-04-19) — https://github.com/osm-search/Nominatim
- [A4] komoot/photon (Apache-2.0; 1.3.0 2026-08-07) — https://github.com/komoot/photon
- [A5] Pelias data sources — https://github.com/pelias/documentation/blob/master/data-sources.md ; pelias/pelias (MIT) — https://github.com/pelias/pelias
- [A6] Who's On First data licence — https://github.com/whosonfirst-data/whosonfirst-data/blob/master/LICENSE.md
- [A7] OpenAddresses — https://openaddresses.io/ ; repos https://github.com/openaddresses/openaddresses (BSD-3-Clause), https://github.com/openaddresses/batch (MIT)
- [A8] USPS APIs Terms and Conditions (last updated 2026-01-22) — https://developers.usps.com/terms-and-conditions ; Addresses v3 page — https://developers.usps.com/addressesv3
- [A9] USPS Web Tools documentation and retirement (2026-01-25) — https://www.usps.com/business/web-tools-apis/documentation-updates.htm
- [A10] USPS PostalPro, RDI — https://postalpro.usps.com/address-quality-solutions/residential-delivery-indicator-rdi
- [A11] USPS PostalPro, DPV — https://postalpro.usps.com/address-quality/dpv
- [A12] Royal Mail PAF, Organisation Use Fee factsheet (2022) — https://www.poweredbypaf.com/wp-content/uploads/2022/10/Factsheet_Organisation_Use_Fee-1.pdf
- [A13] Ofcom statement on PAF — https://www.ofcom.org.uk/__data/assets/pdf_file/0024/62628/statementpaf.pdf
- [A14] Smarty US Street API — https://www.smarty.com/docs/cloud/us-street-api
- [A15] Google Address Validation API overview — https://developers.google.com/maps/documentation/address-validation/overview
- [A16] Loqate Address Verify — https://www.loqate.com/en-gb/address-verification/
- [A17] US Census Geocoder API — https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- [A18] GeoNames postal codes readme (CC BY 4.0) — https://download.geonames.org/export/zip/readme.txt (as recorded in [R5] §2.3)
- [A19] google/libaddressinput (CC BY 4.0 data) — https://github.com/google/libaddressinput/blob/81eb9628382b07d371d8ea0b11badf7de3857fd5/README.md (as recorded in [R5] §2.3)
- [A20] OpenStreetMap copyright and licence (ODbL) — https://www.openstreetmap.org/copyright

### Crypto

- [C1] OFAC SLS export `SDN.CSV` — https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV (302 to S3 folder `…/2026-10-20/…`; 5,744,136 B; sha256 `96dade5a1cde8c9746937b4859ad75d8f2a34eed1a4046cc1f2240a830f70bda`; 19,472 rows; remarks capped at 1,000 characters, observed)
- [C2] OFAC SLS export `SDN_ADVANCED.ZIP` — https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.ZIP (5,737,099 B; sha256 `5b157b9e3159dc86c512d50d9e55aa2bd508dd089464e4b8383dce0009283313`; `SDN_ADVANCED.XML` 127,668,232 B, `DateOfIssue` 2026-10-21). Sizes of `SDN.XML` 29,245,041 B and `SDN_ENHANCED.XML` 109,924,494 B (observed by range request).
- [C3] OFAC Sanctions List Service page (no reuse terms stated) — https://ofac.treasury.gov/sanctions-list-service
- [C4] Chainalysis Sanctions Oracle documentation (deprecated; last updated 2026-03-18) — https://go.chainalysis.com/chainalysis-oracle-docs.html
- [C5] Chainalysis Address Screening — https://www.chainalysis.com/free-cryptocurrency-sanctions-screening-tools/
- [C6] TRM free sanctions screening tool announcement (2022-03-24) — https://www.trmlabs.com/post/trms-free-sanctions-screening-tool-goes-live and https://www.businesswire.com/news/home/20220324005727/en/TRMs-Free-Sanctions-Screening-Tool-Goes-Live ; docs (login required) https://docs.trmlabs.com/reference/sanctions-screening
- [C7] Elliptic Lens — https://www.elliptic.co/platform/lens
- [C8] OpenSanctions licensing (CC BY-NC 4.0; commercial licences) — https://www.opensanctions.org/licensing/
- [C9] BIP-173, BIP-350, EIP-55 (as recorded in [R5] §4.2, §4.4) — https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki , https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki , https://eips.ethereum.org/EIPS/eip-55
- [C10] 17 U.S.C. §105 — https://www.law.cornell.edu/uscode/text/17/105

### Business

- [B1] OFAC FAQs, Entities Owned by Blocked Persons (398 released 2020-08-11; 399, 400, 401 released 2014-08-13) — https://ofac.treasury.gov/faqs/topic/1521
- [B2] OFAC FAQ 401 — https://ofac.treasury.gov/faqs/401
- [B3] OFAC FAQ 399 — https://ofac.treasury.gov/faqs/399
- [B4] Greenberg Traurig, UK Russian sanctions: updated guidance on ownership and control (March 2022; secondary) — https://www.gtlaw.com/en/insights/2022/3/uk-russian-sanctions-updated-guidance-on-ownership-and-control
- [B5] Herbert Smith Freehills Kramer, OFSI updates its enforcement guidance regarding ownership and control (March 2023; secondary) — https://www.hsfkramer.com/notes/sanctions/2023-03/ofsi-updates-its-enforcement-guidance-regarding-ownership-and-control-by-sanctioned-persons
- [B6] companieshouse/api-enumerations `psc_descriptions.yml` @ `0d3fb78` (2025-11-07; the repository has no LICENSE, so values are re-typed as facts, as Phase 5 decided) — https://github.com/companieshouse/api-enumerations/blob/0d3fb78/psc_descriptions.yml
- [B7] GLEIF Level 2 data, who owns whom — https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-2-data-who-owns-whom
- [B8] Open Ownership Register (closed 2024-11-29; ODC-By) — https://openownership.org/topics/open-ownership-register , https://register.openownership.org/terms-and-conditions
- [B9] opensanctions/rigour @ `607fa82b1ba3338c5e2e04f81c3a77e8cbbe0ee7` (2026-09-21): LICENSE (MIT), `resources/names/org_types.yml` (sha256 `772d6c6cf48af7a5b4832ac9aab1e293f0002111f2abb9588377a0459f087f20`), README — https://github.com/opensanctions/rigour/blob/607fa82b1ba3338c5e2e04f81c3a77e8cbbe0ee7/resources/names/org_types.yml ; PyPI (2.6.1 2026-10-21; 2.5.0 2026-09-10) — https://pypi.org/pypi/rigour/json
- [B10] GLEIF ISO 20275 ELF code list v1.6 (2026-02-19; CSV sha256 `c55edc421e49ce362457f772d6bfa41f5fc63ecaadea74db5735722625506ef4`) — https://www.gleif.org/en/about-lei/code-lists/iso-20275-entity-legal-forms-code-list
- [B11] GLEIF LEI data terms of use — https://www.gleif.org/en/meta/lei-data-terms-of-use
- [B14] GLEIF API lookup of the synthetic sandbox LEI `5299000SANDBOXLEI047` (`total 0`, observed) — https://api.gleif.org/api/v1/lei-records?filter%5Blei%5D=5299000SANDBOXLEI047
- [B12] GDELT about and terms of use — https://www.gdeltproject.org/about.html
- [B13] GDELT DOC 2.0 API — https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

---

## Fact-check (2026-10-22)

An independent pass re-opened each load-bearing fact at its primary source. It read the OpenAPI tarball at `805512b`, vendor and standards pages, the GitHub API and raw files at the stated commits, and the registries. It re-downloaded the OFAC files, rigour `org_types.yml`, the goware list, the repo-pinned CC0 disposable list and the GLEIF ELF CSV, each into its own empty directory. It ran `libphonenumber-js` 1.13.14 from the repo's installed copy (read only) on fictional numbers, and resolved DMARC records with Node's resolver. It sent at most one request per second per host and no personal data; the only identifier sent anywhere was the synthetic LEI, to GLEIF. **Totals: 28 facts; 23 confirmed, 4 corrected, 1 partly unverified.** Corrections are marked "(corrected in fact-check)" in the text.

| # | Fact | Verdict | Evidence from the fact-check |
|---|---|---|---|
| 1 | Email report fields; free-provider, spoofable, SPF-strict and DMARC-enforced deprecated | confirmed | `report-email-address.yaml`: those four are "(Deprecated)"; the others are present. `email-domain-reputation` carries `deprecated: true` |
| 2 | Phone type has 12 values; score "out of 1000"; recommendation block/allow/flag; Telesign 0–1000 with the same bands | confirmed | `report-phone-risk.yaml`; Telesign Intelligence scale 0–200 low/allow, 201–400 medium-low/allow, 401–600 medium/flag, 601–800 medium-high/block, 801–1000 high/block |
| 3 | Address-lookup fields correspond to Smarty US Street `metadata`/`analysis` names | confirmed | Persona has `metadata-residential-delivery-indicator`, `analysis-dpv-match-code`, `analysis-dpv-cmra`, `analysis-lacs-link-*` and `analysis-suite-link-match`; the Smarty page has `rdi`, `dpv_match_code`, `dpv_cmra`, `lacslink_code`/`_indicator`, `suitelink_match`. "One for one" stays an inference |
| 4 | `SDN_ADVANCED.ZIP`: 5,737,099 B, SHA-256 `5b157b9e…3313`; 1,066 features (1,050 unique) on 106 parties (33 entities, 73 individuals), 20 tickers | confirmed | Re-downloaded with an identical hash. The counts were re-measured on the same publication's enhanced XML (publication 1075): 1,066 / 1,050 / 20; 106 parties = 33 Entity + 73 Individual; XBT 534, TRX 261, ETH 120, USDT 94 |
| 5 | SDN.CSV remarks cut at 1,000 characters: 506 unique addresses, 14 fragments, 558 missing | **corrected** | 506 unique values (`96dade5a…` re-matched; 36 remarks at exactly 1,000 characters). Of the 14 inexact values, 11 are truncated fragments and 3 are complete addresses with a trailing full stop, so 555 addresses are absent (558 only if those 3 count). That Phase 5's CSV counts undercount is confirmed (`phase5-libraries.md` gives XBT 262) |
| 6 | OFAC exports 302 to pre-signed S3, which conflicts with C54.6 `maxRedirections: 0` | confirmed | Probes; Phase 5 plan C54.6 (read only) |
| 7 | Tickers are not chains: USDT 79/8/7; one XBT is Tron; BNB `bnb1`; one XMR is 64-hex; all 65 mixed-case ETH pass EIP-55 | confirmed | Re-parsed; EIP-55 checked with our own Keccak-256 (validated on the empty-string vector) |
| 8 | SDN identifier counts: Registration Number 4,501, Tax ID 4,382, BRN 739, Company Number 535, LEI 186, Website 1,289, SWIFT/BIC 227, Email 219; vessels 1,568 with IMO (1,555 valid), MMSI 835; aircraft 342 | **corrected** (scope) | Every number reproduces, but the scopes differ. Registration and tax counts span all record types; on `Entity` records alone they are 4,487 and 3,839, with 543 tax ids on individuals. Website and email counts are `Entity` records only; across all records they are 1,302 and 370. The rest are confirmed. Corrected in finding 6 and the identifier table |
| 9 | 50 Percent Rule: aggregate ownership of 50% or more, direct or indirect (FAQs 399 and 401 of 2014-08-13; 398 of 2020-08-11) | confirmed | FAQ topic 1521 |
| 10 | Companies House PSC band `ownership-of-shares-25-to-50-percent` = more than 25%, not more than 50% | confirmed | `psc_descriptions.yml` at `0d3fb78` |
| 11 | USPS API terms (updated 2026-01-22) limit use to USPS shipping or mailing; no datamining; no address lists | confirmed | developers.usps.com terms: "Updated: 1/22/2026" |
| 12 | Nominatim: at most 1 request per second, no personal data, ODbL; OSMF Geocoding Guideline (2017-08-24): individual results do not trigger share-alike | confirmed | Usage policy; the guideline is "Endorsed by the OSMF board 2017-08-24" |
| 13 | Nominatim GPL-3.0 (v5.3.3, 2026-10-14); Photon Apache-2.0 (1.3.0, 2026-08-07); Pelias MIT | confirmed | GitHub licence and latest-release API (Pelias publishes no releases) |
| 14 | HIBP API data CC BY 4.0; terms (March 2026) restrict third-party benefit unless a Paid Service allows it; Core US$4.39–$319 a month with no third-party use, Pro US$379–$4,599 | confirmed | API v3 page licence section; terms "last updated in March 2026"; subscription page prices and "does not permit use on behalf of third parties" |
| 15 | Twilio Lookup v2 URL; line type $0.008, CNAM $0.01, identity match $0.10, SIM swap through sales | confirmed | Docs URL form; pricing page (CNAM appears as "Inbound caller identification", US only) |
| 16 | Vonage Number Insight sunsets 2027-02-04; the replacement is Identity Insights | confirmed | Overview page banner |
| 17 | CAMARA SimSwap Apache-2.0; stable 2.1.0 at r3.3 (2025-12-01); r4.2 (2026-10-20) is 2.2.0-rc.4 | confirmed | GitHub releases (r4.2 marked pre-release) and licence |
| 18 | libphonenumber-js 1.13.15 (2026-10-08, MIT) passes; the repo pins 1.13.14; libphonenumber v9.0.41: carrier/en 206 files 656,938 B, geocoding/en 151 files 6,545,071 B; `carrier/en/1.txt` covers 26 NPAs | **corrected** (one size) | 1.13.15 published 2026-10-08T09:14Z; `pnpm-workspace.yaml` pins 1.13.14; v9.0.41 published 2026-10-08, Apache-2.0. The GitHub contents listing gives carrier/en 206 files and **656,947 B**. Geocoding and the 26 NPAs are confirmed |
| 19 | Observations with 1.13.14 (+1 555-01xx FIXED_LINE_OR_MOBILE, +1 500 PERSONAL_NUMBER, +44 7700 900xxx invalid, +61 491 570 156 MOBILE); NANPA reserves 555-0100 to 0199 | confirmed | Local run with `max` metadata; NANPA page ("fictitious, non-working numbers") |
| 20 | RFC 9989 (May 2026, Standards Track) obsoletes 7489 and 9091; tree walk of at most 8 queries instead of the PSL | confirmed | RFC text header and §4.10 |
| 21 | DMARC: gmail.com and outlook.com `p=none`, mailinator.com `p=reject`, example.com null MX with `p=reject` | confirmed | Resolved at fact-check time |
| 22 | goware/emailproviders `84a3a48` (2025-07-21, MIT): 8,758 domains, 2,832 on the CC0 list, imported from gists; email-providers 2.27.0 (2026-10-05, ISC) built from it | confirmed | Commit date via API; `domains.txt` SHA-256 `54572f5e…a8d3`; overlap measured against the repo-pinned `disposable_email_blocklist.conf` at `6fcca80`; commit history shows gist imports (tbrianjones, maximulian); the email-providers README credits goware |
| 23 | free-email-domains (MIT; latest 1.15.11 of 2026-10-22; newest passing 1.12.22 of 2026-10-08) mixes free and disposable domains, sources HubSpot, has a postinstall script | confirmed | npm; README at `6ddc439` |
| 24 | rigour `org_types.yml` @ `607fa82`: MIT, 126,592 B, SHA-256 `772d6c6c…9f087f20`, 434 legal-form types | **corrected** | Size and hash re-matched, but the file holds **466** type entries with 1,905 aliases. The note's "2,371 alias lines" is the aliases plus the 466 entry lines. Its 13 `generic` tags are confirmed |
| 25 | GLEIF ELF v1.6 (2026-02-19): 4,002 rows, 3,599 codes, 130 countries; licence not documented | confirmed | CSV `2026-02-19-elf-code-list-v1.6.csv` re-counted; no licence on the page (only a generic "Terms" link) |
| 26 | OpenSanctions data CC BY-NC 4.0; the Chainalysis Sanctions Oracle is deprecated (last updated 2026-03-18) | confirmed / could not verify the date | The licence and the deprecation banner ("no longer supported or maintained") are confirmed. The page shows no date and sends no `Last-Modified`, so 2026-03-18 is unsourced on the primary page |
| 27 | GDELT terms allow unlimited use with a citation; DOC 2.0 covers 3 months with at most 250 records | confirmed | As in the data-sources fact-check |
| 28 | Public sandbox inputs use real names and companies; the synthetic LEI `5299000SANDBOXLEI047` has valid MOD 97-10 check digits and is not issued | confirmed | H6 test inputs (real people and a real company); our MOD 97 gives 1; GLEIF API `total` 0 |
