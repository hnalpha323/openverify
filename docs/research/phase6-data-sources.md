# Phase 6 research: sanctions, PEP and adverse-media data sources and their terms

Checked 2026-10-22 (local time, UTC−4; server `Date` headers ran from 2026-10-22 15:47 to 2026-10-23 01:27 UTC). This note covers every data source that the Phase 6 watchlist, PEP, adverse-media, crypto-address-watchlist and business-watchlist reports would read. For each source it records how a self-hosted operator fetches and refreshes it, and whether its terms allow commercial self-hosted use. Everything is written in our own words. Terms are quoted only where the exact wording decides a licence question, at most one short phrase per source, and the quote is flagged. Field and element names are reproduced only as identifiers. Statements that no source makes are marked **(inference)**; facts the sources do not give are marked **not documented**.

**Method.**
- Publisher pages were read with a fetcher.
- Every download URL was probed with `HEAD`, or with a 1-byte ranged `GET` where `HEAD` was refused, recording status, content type, size and validators, never the body.
- A few small files were downloaded into an isolated scratch directory and inspected with `python3 -I` scripts kept in a separate directory: the OFAC enhanced SDN ZIP (6.8 MB), the UN XML (2.2 MB), the OFAC delta and XSDs, the UK XSD, the EU RSS, and the first 64 KiB of the EU and UK XML.
- Licences of the four OpenSanctions packages were read from PyPI JSON and from the LICENSE file at each release tag.
- Nothing in the repository was changed.

**Process deviations (recorded honestly; see "Gaps" in the structured report).**
- **Download budget exceeded.** The EU FSF server ignores `Range`, so three 1-byte probes streamed about 76 MB into `/dev/null`. Total network transfer was about 90 MB against a budget of about 50 MB. About 9 MB was kept. Every later probe aborted on any body over 64 KiB.
- **robots.txt breach.** `data.opensanctions.org/robots.txt` disallows everything. Twelve metadata requests, each answered with a bodiless 307, went out in the same command that first read it; that host was not used again.
- **Wikidata not queried.** `query.wikidata.org/robots.txt` disallows `/sparql`, so no SPARQL query was sent from this session. Wikidata sizes come from published statistics.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-08**.

Legend: ✅ passes rule 4 [R2] for commercial self-hosting · ⚠️ passes with a caveat or needs an owner decision · ❌ fails. Tiers R / H / A are those of ADR 0002 [R3], and the honesty rules are rule 5 [R2].

---

## Summary

| # | Source | Rule 4 | Basis in one line | How the operator gets it | Size (measured 2026-10-22) |
|---|---|---|---|---|---|
| a | **OFAC SDN + Consolidated** (Sanctions List Service) | ✅ | US government work, no copyright (17 U.S.C. §105) [L1]; Treasury's own open-data record says CC0 [F11] | Operator-run sync; `SDN_ENHANCED.ZIP` + `CONS_ENHANCED.XML`; change signal from `/changes/latest` | SDN: 19,471 entries (10,042 entities, 7,519 individuals, 1,568 vessels, 342 aircraft); 1,066 digital-currency features. ZIP 6,793,008 B, XML 109,924,494 B |
| b | **UN Security Council Consolidated List** | ⚠️ | The UN website terms grant personal, non-commercial use only [N4]. UN documents are public domain under ST/AI/189/Add.9/Rev.2 [N5], but the XML list carries no document symbol | Operator-run sync, disabled by default (owner decision) | 736 individuals + 274 entities; 2,185,396 B |
| c | **EU Financial Sanctions Files (FSF)** | ✅ | Decision 2011/833/EU Art. 4 (commercial or non-commercial reuse, credit the source) [E6]; CC BY 4.0 default notice [E5] | Operator-run sync with the public `token=` URL from the EU catalogue [E1]; change signal from RSS [E3] | XML 1.1: 25,767,041 B; about 6,128 targets [S5] |
| d | **UK Sanctions List (FCDO)**, the only UK source since 2026-01-28 | ✅ | OGL v3.0 [K1][K7]: commercial use with attribution; **personal data is outside the licence** | Operator-run sync of the XML; change signal from the GOV.UK content API [K5] | XML 22,051,514 B; about 6,411 targets [S6] |
| d′ | OFSI Consolidated List (legacy) | ❌ | Closed 2026-01-28 and no longer updated [K1] | Do not use | ConList.xml 54,098,673 B, still served [K6] |
| e | Canada SEMA / JVCFOA | ⚠️ | Canada.ca terms: non-commercial reproduction free; commercial redistribution needs written permission [X3] | Operator-added source, off by default | 2,891,117 B [X2] |
| e | Australia DFAT | ⚠️ | **Not verified**: the host timed out from here and from the fetch service | Operator-added source, off by default | not measured |
| e | Switzerland SECO (SESAM) | ⚠️ | Site terms ask for consent to reproduce [X8]; official enactments are not protected (CopA Art. 5) [X9] | Operator-added source, off by default | not measured |
| e | World Bank debarment | ❌ | Site material and APIs are non-commercial by default; derivative or commercial use needs consent [X11] | Adapter only, with the operator's own permission | - |
| e | Interpol red notices | ❌ | Commercial use, reproduction of wanted-person data and automated extraction are all prohibited without permission [X12] | Never | - |
| e | FATF country lists | ⚠️ | Facts (country membership), published after each plenary [X14]; site terms unreadable (403) | Operator-maintained `countries` list (Phase 7 lists), no fetch | - |
| e | US Consolidated Screening List (trade.gov), for the business watchlist | ✅ | US government work [L1]; no terms stated [X15] | Operator-run sync, off by default (US export controls) | JSON 33,911,558 B [X16] |
| f | OpenSanctions **data** | ❌ | CC BY-NC 4.0; business use needs a paid licence [S1] | Never built in; at most an A-tier adapter for an operator who holds a licence | - |
| f | OpenSanctions **code** (followthemoney, nomenklatura, rigour, yente) | ✅ | MIT at the release tags [S7–S10] | Reference for schemas and methodology only; not a dependency | - |
| g | **Wikidata** (PEP) | ✅ data / ⚠️ use | Data CC0 [W1]; query service limits and User-Agent policy [W2][W3]; the result is heuristic | Operator-run `pep:sync` over the query service with the operator's own User-Agent contact; dumps (156.6 GB) not recommended | about 266k persons, 105k positions, 262 countries in one curated derivation [S4] |
| h | **GDELT** DOC 2.0 API (adverse media) | ✅ GDELT data / ⚠️ articles and privacy | GDELT terms allow commercial use with a citation and link [G2]; the articles belong to their publishers (store URL + title only; EU press-publisher right [E7]); each query discloses the screened name to GDELT | On-demand adapter, opt-in, 1 request per 5 s; alternative: a local index of the 15-minute GKG files [G5] | rolling 3-month window, ≤ 250 results per query [G1] |
| i | Other crypto sources (UK `CryptoWalletAddress`, Chainalysis, Israel NBCTF) | ✅ / A / ⚠️ | UK as d; Chainalysis is proprietary [C2]; NBCTF primary source and terms **not documented** [C3] | UK through its own sync; Chainalysis as an A-tier adapter; NBCTF not built in | - |

Neither `data/manifest.json` nor `scripts/fetch_data.py` (C56 [R5][R7]) can pin any of these lists to a SHA-256, because they change daily. Every list in this note therefore follows the C62.7 trust-store pattern: an operator-run sync, never committed. Tests use synthetic lists written in each publisher's format.

### Corrections to the repository's records

- **PLAN §3 "UK OFSI"** [R1] and **THIRD_PARTY_LICENSES §4.2** [R6]: OFSI's Consolidated List closed on Wednesday 28 January 2026. The FCDO **UK Sanctions List** has been the only source of UK designations since then [K1].
- **THIRD_PARTY_LICENSES §4.2, UN "Public, UN terms of use":** the UN website terms grant personal, **non-commercial** use only [N4]. The row should read ⚠️ until the owner decides (see "Needs the owner").
- **THIRD_PARTY_LICENSES §4.2, GDELT "attribution requested (terms to verify)":** GDELT's terms allow academic, commercial and governmental use without fee. Any use or redistribution must cite the GDELT Project and link to gdeltproject.org [G2]. The articles themselves remain the publishers' copyright.
- **THIRD_PARTY_LICENSES §4.2, OFAC "public domain":** correct by statute [L1]. Treasury's own Project Open Data record also declares CC0 for the SDN list [F11]. The download location moved to the Sanctions List Service in 2024 [F10]; the old `treasury.gov/ofac/downloads/...` URLs now redirect twice [F13].
- **THIRD_PARTY_LICENSES §4.2, EU "data.europa.eu":** the catalogue tags the files with the Commission reuse notice (Decision 2011/833/EU) [E1]. The files are served from `webgate.ec.europa.eu/fsd/fsf` behind a URL token (§3.3).

---

## 1. US OFAC: SDN and Consolidated (non-SDN) lists

### 1.1 Publisher, URLs and what answers

- **Publisher:** the US Treasury's Office of Foreign Assets Control. Since May 2024 the files are delivered by the Sanctions List Service (SLS) [F1][F10].
- **Download base:** `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/<FILE>` [F3][F4].
- **A trap on OFAC's own page.** The static SDN download page links every file to a development host, `ofacwebdev.wc2h.treasury.gov/SlsPublicApi_hotfix/...` [F2]. The Consolidated page uses the production host [F3]. Clients must use the production base above, never URLs scraped from that page.

**What a `GET` actually does.** Every export answers **`302 Found`** (served by IIS) with a `Location` pointing to a **pre-signed AWS GovCloud S3 URL**:
- host `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`;
- path `/Published/<uuid>/<preview date>/<uuid>/<FILE>`;
- `X-Amz-Expires=3600`, and an `X-Amz-Security-Token` in the query [F4].

The temporary credentials in that query string must never be logged (inference). `HEAD` is inconsistent: some files answer `200` with `Last-Modified` from the IIS layer, others answer `400` [F4].

**S3 metadata on the objects (measured):**
- `x-amz-meta-publication-id: 1075`;
- `x-amz-meta-delta-name: 2026-10-21_delta.xml`;
- `x-amz-meta-preview-date: 10/20/2026 1:33:26 PM`;
- `Last-Modified: Wed, 21 Oct 2026 16:35:21 GMT`.

The legacy `https://www.treasury.gov/ofac/downloads/sdn.xml` answers 302 from Akamai to the SLS, which answers 302 to S3 [F13].

| File | Status / type (final hop) | Bytes | Use |
|---|---|---|---|
| `SDN_ENHANCED.ZIP` | 302 → 206, `application/zip` | 6,793,008 | **recommended** (one member `SDN_ENHANCED.XML`, 109,924,494 B) |
| `SDN_ENHANCED.XML` | 302 → 206, `text/xml` | 109,924,494 | alternative |
| `SDN_ADVANCED.XML` | 302 → 206, `text/xml` | 127,668,232 | UN-style advanced model; larger, harder to parse |
| `SDN.XML` / `SDN_XML.ZIP` | 302 → 206, `text/xml` | 29,245,041 / - | legacy flat XML |
| `SDN.CSV`, `ADD.CSV`, `ALT.CSV`, `SDN_COMMENTS.CSV` | 302 → 206, `text/csv` | 5,744,136 (SDN.CSV) | **not for screening**: birth dates, IDs and crypto addresses sit in a free-text `Remarks` column, which is capped at 1,000 characters and spills into `SDN_COMMENTS` [F7] |
| `CONS_ENHANCED.XML` / `.ZIP` | 302 → 206, `text/xml` | 3,870,352 | **recommended** for the non-SDN lists |
| `CONS_ADVANCED.XML`, `CONSOLIDATED.XML`, `CONS_PRIM.CSV` | 302 → 206 | 4,580,537 / 1,078,267 / - | alternatives |
| `ENHANCED_XML.xsd`, `ADVANCED_XML.xsd`, `XML.xsd`, `DAT_SPEC.TXT` | 302 → S3 `/Export-XSDs/` | 18,045 (enhanced XSD) | schemas; the enhanced XSD's target namespace is `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ENHANCED_XML` |
| `https://sanctionslistservice.ofac.treas.gov/changes/latest` | 302 → S3 `/DeltaArchive/2026-10-21_delta.xml` | 103,434 | the latest delta (the page's `/api/changes/latest` link answers 404) [F5] |

**Content types differ by hop.** On `HEAD`, IIS labels `.CSV` and `.ZIP` as `text/xml`; S3 labels them correctly. A per-client content-type allowlist must judge the final hop only (inference).

### 1.2 Schema relevant to screening (enhanced XML, measured on the 2026-10-21 SDN file) [F6][M1]

- **Root and publication.** The root is `sanctionsData`. `publicationInfo/dataAsOf` read `2026-10-21T00:00:00-04:00` in this file.
- **Entities.** Each `entity` carries `generalInfo/identityId` and `entityType` (`Individual` 7,519, `Entity` 10,042, `Vessel` 1,568, `Aircraft` 342). It also carries `sanctionsLists/sanctionsList` with a `datePublished` attribute (the listing date), `sanctionsPrograms` (72 programmes), `sanctionsTypes` and `legalAuthorities`.
- **Names.** `names/name` has `isPrimary` and an `aliasType` (`A.K.A.` 24,013, `F.K.A.` 582, `N.K.A.` 18). It also has **`isLowQuality`**: `true` on 4,421 of 44,084 names, which is OFAC's "weak alias" flag and should lower match weight.
- **Translations and scripts.** Each name has `translations/translation` with a `script`. Name translations alone count Latin 44,282; Cyrillic 3,670; Arabic 1,500; Chinese Simplified 374; Chinese Traditional 177; Korean 44; Japanese 15; Greek 9; Hangul 4; Armenian, Hebrew and Georgian 2 each (5,799 non-Latin). The larger figures first given here (Latin 67,210; Cyrillic 3,810; Arabic 1,502; Chinese Simplified 425; Chinese Traditional 185; Japanese 26; Greek 10) count every `translation` in the file, address translations included (corrected in fact-check). Each name translation carries `formattedFirstName`, `formattedLastName` and `formattedFullName`.
- **Name parts.** `nameParts/namePart/type` takes the values `Entity Name`, `Last Name`, `First Name`, `Middle Name`, `Vessel Name`, `Patronymic`, `Matronymic`, `Nickname`, `Aircraft Name` and `Maiden Name`.
- **Features.** Each `features/feature` has a `type` (74 types) and a `value`. Dated features also carry a structured `valueDate`: `fromDateBegin`, `fromDateEnd`, `toDateBegin`, `toDateEnd`, `isApproximate` and `isDateRange`. This maps directly onto the C58.5 partial-date rules [R5]. Feature types used for screening include:
  - `Birthdate` (8,203), `Place of Birth` (5,024), `Nationality Country` (5,940), `Citizenship Country` (1,103), `Gender`;
  - `Organization Established Date`, `Website`, `Email Address`, `Phone Number`, `SWIFT/BIC`;
  - vessel features (flag, call sign, IMO via the documents, type, tonnage) and aircraft features (model, MSN, tail number, operator);
  - the digital-currency features below.
- **Documents, addresses, relationships.**
  - `identityDocuments/identityDocument` (109 types, led by `Registration Number`, `Tax ID No.`, `Passport`, `National ID No.`, `Vessel Registration Identification`, `MMSI`) carries `documentNumber`, `issuingCountry`, `issueDate`, `expirationDate` and `isValid`.
  - `addresses/address` carries `addressParts` and `country`.
  - There are 9,204 `relationships`.
- **Digital-currency addresses** [F8][F9][M1]:
  - **Label.** Each address is its own feature whose `type` is the fixed text `Digital Currency Address - ` followed by a currency **symbol**; the value is the address itself (OFAC allows up to 256 characters [F9]). The SDN file holds **1,066 such features, 1,050 distinct values**:
    - XBT 534, TRX 261, ETH 120, USDT 94, LTC 14, XMR 11, BCH 7, DASH 5, SOL 4, ZEC 4;
    - DOGE and USDC 2 each;
    - ARB, BNB, BSC, BSV, BTG, ETC, XRP and XVG 1 each.
  - **Symbols are not chains.** By address shape (measured), USDT entries split into 79 Tron, 8 EVM and 7 Bitcoin-base58 (Omni) addresses. One `XBT`-labelled value has a Tron address shape (inference: a labelling slip).
  - **Case.** ETH addresses mix lowercase (55) and EIP-55 mixed case (65).
  - **Exhaustiveness.** OFAC says its address listings are not exhaustive [F8].
- **Delta file** [F5]. Root `sanctionsData`, namespace `https://www.treasury.gov/ofac/DeltaFile/1.0`. It holds `publicationInfo/datePublished` and `publicationType`, then entities with `action` set to `add` or `remove`. In `DeltaFile.xsd`, entities and other elements take the `elementAction` type (`add`, `remove`). `update` exists only in the `valueAction` type (`add`, `remove`, `update`) on individual values, which carry `oldValue` and, for references, `oldRefId` (corrected in fact-check; the earlier text gave entities an `update` action). The 2026-10-21 delta had 18 adds and 4 removes.

### 1.3 Cadence, change detection, integrity, access

- **Cadence:** irregular. Actions are published on business days as OFAC acts [F11]. Changes may appear in the files before the Federal Register, and the Federal Register prevails if the two differ [F7].
- **Change detection, cheapest first:**
  1. the `Location` of `GET /changes/latest` (the delta file name embeds the date);
  2. the S3 `x-amz-meta-publication-id` (1075) and `Last-Modified`;
  3. `publicationInfo/dataAsOf` inside the file.

  OFAC also offers email alerts (GovDelivery) [F1]; there is **no RSS** [F1].
- **Integrity:** HTTPS only. **No signature or checksum is published** [F1][F2]. The S3 `ETag` is **not** an MD5 of the data, because the objects use SSE-KMS [L2]. This was verified: the downloaded ZIP's MD5 differs from its ETag. Use the ETag only as a change token.
- **Access:** no key and no registration. No rate limit is documented. `sanctionslist.ofac.treas.gov/robots.txt` answers a JSON 403, and the SLS host has no robots file.
- **Terms.** No copyright exists in US government works [L1]. Treasury's site-policy page is silent on reuse [F12]. Treasury's harvested Project Open Data record for the SDN list declares CC0 [F11]. **✅.**

---

## 2. UN Security Council Consolidated List

### 2.1 URLs and what answers

- **XML.** `https://scsanctions.un.org/resources/xml/en/consolidated.xml` answers `302` to a **signed Azure Blob URL** at `unsolprodfiles.blob.core.windows.net/publiclegacyxmlfiles/EN/consolidatedLegacyByPRN.xml?<SAS>` (`application/xml`, 2,185,396 B) [N1]. The Spanish (`/sp/`) and French (`/fr/`) XML answer the same way [N1].
- **HTML.** `https://scsanctions.un.org/consolidated/` redirects to the HTML version (1,793,361 B) [N2]. The old `/resources/htm/en/...` and `/resources/pdf/en/...` paths return 404.
- **Schema.** The XML names `https://www.un.org/sc/resources/sc-sanctions.xsd` as its schema, which answered **502** to the researcher, then 403 without a User-Agent and 404 with a browser User-Agent at fact-check; it is unavailable either way (corrected in fact-check) [N6]. Validation therefore needs our own schema (inference).
- **Landing page.** The page at `main.un.org/securitycouncil/...` answers an empty `202` to automated clients [N3]. What it says about formats (XML, HTML, PDF) comes from search summaries only.

### 2.2 Schema (measured) [N1]

- **Root.** `CONSOLIDATED_LIST` with a `dateGenerated` attribute (`2026-10-22T23:00:06.809Z`).
- **Sections.** `INDIVIDUALS/INDIVIDUAL` (736) and `ENTITIES/ENTITY` (274).
- **Identity and listing fields:**
  - `DATAID` and `VERSIONNUM` (per-record identity and version);
  - `FIRST_NAME`, `SECOND_NAME`, `THIRD_NAME`, `FOURTH_NAME`;
  - `NAME_ORIGINAL_SCRIPT` (379 records);
  - `UN_LIST_TYPE` (14 regimes) and `REFERENCE_NUMBER`;
  - `LISTED_ON` (ISO date) and `LAST_DAY_UPDATED/VALUE`;
  - `LAST_REVIEWED_ON`, `NATIONALITY/VALUE`, `DESIGNATION`, `TITLE`, `GENDER`, `COMMENTS1`, `INTERPOL_LINK`.
- **Aliases.** `INDIVIDUAL_ALIAS` and `ENTITY_ALIAS` carry `ALIAS_NAME` and `QUALITY`. `QUALITY` is meant to be `Good` or `Low`, but the data also holds `a.k.a.` (586), `f.k.a.` (17) and empty values (294). The parser must normalise it.
- **Birth dates.** `INDIVIDUAL_DATE_OF_BIRTH` carries `TYPE_OF_DATE` (`EXACT` 751, `APPROXIMATELY` 117, `BETWEEN` 32, empty 49) with `DATE`, `YEAR`, `FROM_YEAR` or `TO_YEAR`.
- **Place of birth.** `INDIVIDUAL_PLACE_OF_BIRTH` carries `COUNTRY`, `CITY`, `STATE_PROVINCE` and `STREET`.
- **Documents.** `INDIVIDUAL_DOCUMENT` carries `TYPE_OF_DOCUMENT` (`Passport`, `National Identification Number`), `NUMBER`, `ISSUING_COUNTRY`, `DATE_OF_ISSUE` and `DATE_OF_EXPIRY`.
- **Addresses.** `*_ADDRESS` carries `STREET`, `CITY`, `STATE_PROVINCE`, `ZIP_CODE` and `COUNTRY`.
- **Crypto.** **No crypto-address field.** One free-text mention matched a crypto keyword.
- **Delisting.** There is no delisting record; a delisted entry simply disappears (inference: removals are announced in Committee press releases).

### 2.3 Cadence, change detection, integrity, terms

- **Cadence.** The file is regenerated about daily: `dateGenerated` read 23:00 UTC and the blob `Last-Modified` 23:02 GMT on 2026-10-22. `Last-Modified` and `ETag` therefore change without any content change (inference). Real changes show in `DATAID`/`VERSIONNUM` and `LAST_DAY_UPDATED`. Compare content, not headers.
- **Integrity.** HTTPS only; no signature or checksum.
- **Access.** No key. `scsanctions.un.org/robots.txt` returns an application message rather than a robots file.
- **Terms (⚠️).**
  - The UN website terms allow downloading and copying for personal, non-commercial use, and forbid commercial reuse, redistribution and derivative works. The decisive wording is "non-commercial use" (quoted because it decides) [N4].
  - UN administrative instruction ST/AI/189/Add.9/Rev.2 (1987) makes "Official Records, United Nations documents and public information material" public domain as a rule [N5]. The XML list is not a symbol document, so it is unclear whether that rule covers it (inference).
  - The list exists so that States and their regulated firms apply the measures. EU and UK lists carry UN designations: `unitedNationId` in the EU file, `UNReferenceNumber` and `DesignationSource` in the UK file.
  - **Recommendation:** a UN source definition that **ships disabled**, with the terms note, until the owner decides.

---

## 3. EU Financial Sanctions Files (FSF)

### 3.1 Publisher and URLs

- **Publisher and cadence.** The catalogue names DG FISMA as publisher, `daily` as accrual periodicity, and `https://webgate.ec.europa.eu/fsd/fsf#!/files` as landing page [E1].
- **Distributions, tagged "European Commission reuse notice" (Decision 2011/833/EU)**, except two (corrected in fact-check): the CSV 1.0 file (`csvFullSanctionsList`) is tagged CC BY 4.0, and the linked EU Sanctions Tracker app is tagged CC BY-ND 4.0. Neither affects the XML 1.1 recommended here.

| File | URL (all `https://webgate.ec.europa.eu/fsd/fsf/public/...`) | Status / type | Bytes | Name served |
|---|---|---|---|---|
| XML 1.1 (recommended) | `files/xmlFullSanctionsList_1_1/content?token=<public token>` | 200 `application/xml` | 25,767,041 | `20261015-FULL-1_1(xsd).xml` |
| CSV 1.1 | `files/csvFullSanctionsList_1_1/content?token=<public token>` | 200 `text/plain` | 25,166,754 | `20261015-FULL-1_1.csv` |
| XML 1.0 | `files/xmlFullSanctionsList/content?token=<public token>` | 200 `application/xml` | 25,572,310 | `20261015-FULL(xsd).xml` |
| any file without the token | `files/xmlFullSanctionsList_1_1/content` | **403** `application/json` | - | - |
| RSS | `rss` | 200 `text/xml; charset=UTF-8` (3,934 B) | - | 5 items, newest `pubDate` Thu, 15 Oct 2026 10:20 GMT |

[E2][E3]

### 3.2 Schema (from the first 64 KiB of XML 1.1) [E2]

- **Root.** `export`, namespace `http://eu.europa.ec/fpi/fsd/export`, with attributes `generationDate` (`2026-10-15T12:10:34.160+02:00`) and **`globalFileId`** (`185699`, a numeric file id usable for monotonicity; inference).
- **Entries.** `sanctionEntity` carries `euReferenceNumber`, `unitedNationId`, `logicalId` and `designationDetails`.
- **Remarks and regulation.** Each entry has `remark`, and `regulation` with `regulationType`, `organisationType`, `publicationDate`, `entryIntoForceDate`, `numberTitle`, `programme`, `logicalId` and `publicationUrl`.
- **Subject type.** `subjectType` has `code` (`person` or `enterprise`) and `classificationCode` (`P` or `E`).
- **Names.** `nameAlias` carries `firstName`, `middleName`, `lastName`, `wholeName`, `function`, `gender`, `title` and `nameLanguage`. It also carries **`strong`** (`true` or `false`; the EU's alias-strength flag) and `regulationLanguage`.
- **Citizenship and birth.** `citizenship` carries `countryIso2Code` and `region`. `birthdate` carries `circa`, `calendarType`, `birthdate`, `dayOfMonth`, `monthOfYear`, `year`, `city`, `zipCode`, `place`, `region` and `countryIso2Code`. The day, month and year fields carry partial dates.
- **Not in the sample.** Identification and address elements are in the schema but not in the 64 KiB sample. The XSD itself is **not publicly linked**; the manual says each file comes with its schema inside the logged-in area [E4]. A crypto-address field is **not documented**.
- **Delisting.** There is no delisting record; an entry disappears (inference).

### 3.3 How the download is gated

- **Per-user tokens.** The FSF Stakeholders' manual describes a login through EU Login. Logged-in users see "settings for crawler/robot" URLs whose token, the manual says, is the logged-in user's id. They also see each file's **checksum** [E4].
- **The public token.** The catalogue record [E1] and the public RSS feed [E3] both publish the same fixed token, the base64 encoding of the ASCII string "token-2017" (not reproduced here, so secret scanners stay quiet). With it, the files download without any login (measured above). Without it the answer is 403.
- **Practical gating.** The gating is nominal for that token. Checksums and the XSD stay behind the login.
- **Recommendation.** Accept an operator-supplied token: an operator who registers gets their own token and the checksums. Default to the token the catalogue publishes (inference).

### 3.4 Cadence, integrity, terms

- **Cadence and change detection.** The catalogue says daily [E1]. The last regeneration was on 2026-10-15. The RSS `pubDate` signals a new file [E3]. `generationDate` and `globalFileId` identify the file. The manual also mentions email notifications to registered users [E4].
- **Integrity.** HTTPS. A checksum is shown only to logged-in users [E4]. `robots.txt` answers 404.
- **Terms (✅).**
  - Decision 2011/833/EU Art. 4 makes Commission documents reusable "for commercial or non-commercial purposes" (quoted because it decides) under the Art. 6 conditions: credit the source, do not distort, no Commission liability [E6].
  - The Commission's legal notice applies CC BY 4.0 by default [E5].
  - The Decision requires data-protection compliance [E6]. The personal data in the file stays subject to GDPR (§10.2).
  - The FSF page also states that only the Official Journal is authentic [S5].

---

## 4. UK: OFSI Consolidated List versus the FCDO UK Sanctions List

### 4.1 Which one is authoritative on 2026-10-22

- **The UK Sanctions List (FCDO) is.** The GOV.UK publication page says the OFSI Consolidated List of Asset Freeze Targets closed on Wednesday 28 January 2026 and is no longer updated. The UK Sanctions List is now the only source of UK designations [K1].
- **Page dates.** The page was first published on 6 July 2020 and last updated on 16 October 2026 [K1]. The content API gives `public_updated_at 2026-10-16T10:30:50+01:00` [K5].
- **The legacy blob still answers.** `https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml` returns 200 (`text/xml`, 54,098,673 B), and `ConList.csv` returns 16,641,139 B [K6]. Both show `Last-Modified: Wed, 03 Jun 2026`, after the stated closure; why is **not documented**.
- **Recommendation: ❌, do not use.** A client still pointing at it is screening against a frozen list.

### 4.2 URLs (all `https://sanctionslist.fcdo.gov.uk/docs/`) [K1][K2]

| File | Status / type | Bytes | Validators |
|---|---|---|---|
| `UK-Sanctions-List.xml` (recommended) | 200 `text/xml` | 22,051,514 | `Last-Modified` Fri, 16 Oct 2026 09:29:07 GMT; `ETag`; `cache-control: max-age=0, s-maxage=86400, no-cache` |
| `UK-Sanctions-List.csv` | 200 `application/octet-stream` | 50,154,885 | as above |
| `UK-Sanctions-List.ods` | 200 `application/octet-stream` | 8,140,910 | as above |
| `.odt`, `.html`, `.txt`, `.pdf` | listed on the page | - | - |
| XSD `SanctionsListSchema-4.33.3.xsd` (`assets.publishing.service.gov.uk/media/6916e72cdb01ecfcf96fc96b/`) | 200 `application/octet-stream` | 16,418 | `Last-Modified` 14 Nov 2025 |

`sanctionslist.fcdo.gov.uk/robots.txt` answers an S3 `AccessDenied` XML.

### 4.3 Schema (XSD 4.33.3, format guide, first 64 KiB of the XML) [K3][K4]

- **Root and record.** The root is `Designations`, with `DateGenerated` as **dd/mm/yyyy** (`16/10/2026`). Each `Designation` carries:
  - `LastUpdated` and `DateDesignated` (dd/mm/yyyy);
  - `UniqueID` (for example `AFG0001`; a person may hold several, one per regime [K4]);
  - `OFSIGroupID`, `UNReferenceNumber` and `RegimeName`;
  - `IndividualEntityShip` (`Individual`, `Entity`, `Ship`);
  - **`DesignationSource`** (UK only, UN only, or both [K4]);
  - `SanctionsImposed` with per-measure indicators (`AssetFreeze`, `TravelBan`, `ArmsEmbargo`, `TrustServicesSanctions`, `DirectorDisqualificationSanction` and others);
  - `UKStatementofReasons` and `OtherInformation`.
- **Names.** `Names/Name` carries `Name1` to `Name6`; for individuals `Name6` is the surname, and for entities and ships it is the full name [K4]. It also carries `NameType` (`Primary Name`, `Primary Name Variation`, `Alias`) and **`AliasStrength`** (good or low, only where the UN supplies it) [K4]. `NonLatinNames/NonLatinName` carries `NameNonLatinScript`, `NonLatinScriptType` and `NonLatinScriptLanguage`.
- **Individuals.** `IndividualDetails` carries `DOBs/DOB` as dd/mm/yyyy, with unknown parts allowed as a pattern like `dd/mm/1970` [K4]. It also carries `Nationalities`, `PassportDetails` (`PassportNumber`, `PassportAdditionalInformation`), `NationalIdentifierDetails`, `Positions`, `BirthDetails` (`TownOfBirth`, `CountryOfBirth`) and `Genders`.
- **Entities and ships.** `EntityDetails` carries `TypeOfEntities`, `Subsidiaries`, `ParentCompanies` and `BusinessRegistrationNumbers`. `ShipDetails` carries `IMONumbers`, `CurrentBelievedFlagOfShips`, `PreviousFlags`, `CurrentOwnerOperators`, `HullIdentificationNumbers`, `TypeOfShipDetails`, `TonnageOfShipDetails`, `LengthOfShipDetails` and `YearsBuilt`.
- **Contacts and crypto.** `Addresses/Address` (`AddressLine1` to `6`, `AddressPostalCode`, `AddressCountry`), `PhoneNumbers`, `EmailAddresses` and `Websites`. **`CryptoWalletAddresses/CryptoWalletAddress`** is in the XSD [K3]; the format guide does not describe it, and its chain labelling is **not documented** [K4]. Counts were not measured.
- **Versioning.** There is no delta file and no schema version inside the data [K4]. The XSD file name carries the version.

### 4.4 Cadence, change detection, integrity, terms

- **Cadence.** Changes are published as they happen (482 change-history entries since 2020) [K5].
- **Change detection.** `GET https://www.gov.uk/api/content/government/publications/the-uk-sanctions-list` (JSON, about 94 KB) returns `public_updated_at` and `details.change_history`. Each change-history entry has a `public_timestamp` and a note such as "Added 2 new designations under the Iran sanctions regime" [K5]. `ETag` and `Last-Modified` on the file, and `DateGenerated` inside it, have day precision only. Email alerts go through GovDelivery [K1].
- **Integrity.** HTTPS; no signature or checksum.
- **Terms (✅).**
  - All content is under OGL v3.0 [K1]. OGL v3.0 allows copying, adaptation and commercial use if the source is credited. The default attribution is "Contains public sector information licensed under the Open Government Licence v3.0." [K7].
  - OGL v3.0 does **not** license personal data [K7]. Designated individuals' data is personal data, so the operator needs its own lawful basis under UK GDPR (§10.2).

---

## 5. Optional extras an operator might add (one row each)

| Source | URL probed (status, type, size) | Format / cadence | Terms | Verdict |
|---|---|---|---|---|
| **Canada**: Consolidated Canadian Autonomous Sanctions List (SEMA, JVCFOA) | `https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml`: 200 `text/xml`, 2,891,117 B, `Last-Modified` 15 Oct 2026 [X2] | XML and PDF. The page said "last updated 22 Sept 2026" (stale against the file's own header). The page says the list is administrative and has no force of law [X1] | No licence on the page. Canada.ca terms allow non-commercial reproduction without permission; reproduction for commercial redistribution needs "prior written permission from the copyright administrator" (quoted because it decides) [X3]. Internal screening without redistribution may fall outside that clause (inference). An open.canada.ca record was not found (its API timed out) | ⚠️ operator opt-in |
| **Australia**: DFAT Consolidated List | `https://www.dfat.gov.au/...`: **timed out** from this host and from the fetch service [X4] | XLSX (about 1 MB per a search summary); improved list launched 6 Nov 2025 [X5] | **Not verified** | ⚠️ operator opt-in, terms to verify |
| **Switzerland**: SECO SESAM | `https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=en&action=downloadXmlGesamtlisteAction`: 200 `text/xml`, `consolidated-list_2026-10-20.xml` [X7] | XML with XSD (dated 3 Nov 2023), value lists and an example on the SECO page [X6] | admin.ch terms: any reproduction needs prior written consent [X8]. CopA Art. 5(1)(a) leaves acts, ordinances and other official enactments unprotected, and Art. 5(2) their official collections [X9]. The sanctions annexes are ordinance content (inference) | ⚠️ operator opt-in |
| **World Bank** debarred firms and individuals | Page only; the list "updates every 3 hours"; no file or API documented [X10] | HTML table (firm, address, country, dates, grounds, cross-debarment) | Site material: non-commercial only; derivative or commercial use needs consent. APIs: non-commercial [X11] | ❌ (adapter only, with the operator's own permission) |
| **Interpol** red notices | not probed | Public extracts only, published at the member country's request [X13] | Commercial use, reproduction of wanted-person data, transmission to third parties and data mining or robots are all prohibited without written permission [X12] | ❌ never |
| **FATF** high-risk and increased-monitoring jurisdictions | fatf-gafi.org answers 403 to fetchers | Country lists, updated after each plenary (February and June 2026 outcomes found) [X14] | Not readable (403). Country membership is a fact (inference) | ⚠️ as an operator-maintained `countries` list (Phase 7), no fetch |
| **US Consolidated Screening List** (ITA): 13 export and sanctions lists across Commerce, State and Treasury | `https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json`: 206 `application/json`, 33,911,558 B; `.csv` 16,832,471 B; `.tsv` [X16] | Daily at 05:00 US Eastern; the Federal Register stays authoritative [X15] | No terms stated [X15]; US government work [L1]. Overlaps OFAC | ✅ business-watchlist opt-in |

---

## 6. OpenSanctions (reference only)

### 6.1 Data licence

The data is under **CC BY-NC 4.0** ("Attribution NonCommercial", quoted because it decides) [S1]. Business use needs a paid licence: a hosted per-query API, an internal-use screening licence, or a reseller licence [S1]. Every dataset page repeats that businesses must acquire a licence [S4][S5][S6]. A self-hosted OpenVerify install used by a business is commercial use, so the data **fails rule 4** (❌). It must never be fetched, bundled or used as a default. At most it can be an A-tier adapter for an operator who holds the licence (owner decision; default none).

Robots: `data.opensanctions.org` disallows all paths. `www.opensanctions.org` allows dataset and documentation pages for generic agents, with `Crawl-delay: 10` [S2].

### 6.2 Code (✅ MIT; methodology reference, not a dependency)

| Package | Registry (PyPI JSON) | Latest / newest ≤ 2026-10-08 | Released | LICENSE at tag (commit) | Use for us |
|---|---|---|---|---|---|
| `followthemoney` | `https://pypi.org/pypi/followthemoney/json` | 4.11.1 / **4.11.0** | 2026-10-21 / 2026-09-03 | MIT; copyright Journalism Development Network 2017–2024, OpenSanctions 2025 (`v4.11.0` → `8aaaece`) [S7] | Entity schema vocabulary (Person, Organization, Vessel, Airplane, CryptoWallet, Position, Occupancy, Sanction): a model for our normalised watchlist record |
| `nomenklatura` | `https://pypi.org/pypi/nomenklatura/json` | 4.17.4 / **4.17.1** | 2026-10-22 / 2026-10-07 | MIT (`4.17.1` → `c9224ab`) [S8] | Entity resolution and matching ideas (name and identifier comparison, match explanations) |
| `rigour` | `https://pypi.org/pypi/rigour/json` | 2.6.1 / **2.5.0** | 2026-10-21 / 2026-09-10 | MIT (`v2.5.0` → `b0ba4ad`). It bundles `resources/names/org_types.yml` (126 KB legal-form table), stopwords, symbols and territories; the README says its address formats derive from OpenCage `address-formatting` (MIT) [S9] | Legal-form and stopword tables could seed C58.6 business-name canonicalisation, **each file's provenance checked before porting** (its ISO 639-3 table comes from SIL, whose terms were not checked) |
| `yente` | `https://pypi.org/pypi/yente/json` | 5.5.0 / **5.5.0** | 2026-06-23 | MIT (`v5.5.0` → `258c0a1`) [S10] | Screening API design (match and search endpoints, scored results with explanations) |

Their PEP methodology [S3] is a useful public reference, described here in our own words:
- **Model.** A position, an occupancy (the person's tenure in it) and a person.
- **Topics.** A role topic (executive, legislative, diplomatic and so on) and a jurisdiction topic (national, international organisation, state, municipal).
- **Retention after leaving office.** 50 years for national heads of state or government, 20 years for other national, intergovernmental or diplomatic posts, 5 years for the rest. These are their own risk choices; they note the EU's 12-month minimum.
- **Exclusions.** People who died more than 5 years ago, anyone implied to be over 110, and tenures that started more than 40 years ago with no end date (not treated as current).
- **Family and associates.** Tagged separately (`role.rca`).

---

## 7. PEP from Wikidata

### 7.1 Licence, access paths and their limits

- **Licence.** Structured data (main, Property, Lexeme and EntitySchema namespaces) is **CC0** [W1]. **✅.**
- **Query service** (`https://query.wikidata.org/sparql`, GET or POST) [W2]:
  - 60 s timeout per query;
  - 60 s of processing time per 60 s per client (User-Agent plus IP);
  - 30 error queries per minute;
  - 5 parallel queries per IP;
  - `429` with `Retry-After` when exceeded, and ignoring it risks a ban;
  - GET responses are cached, POST responses are not.

  The manual announces a **2026–2027 backend migration with new v2 endpoint URLs** [W2], so the endpoint must be configurable. The 2025 graph split moved scholarly articles to a separate graph; humans and positions stay in the main graph [W7].
- **User-Agent.** The policy requires a descriptive User-Agent naming the tool and a way to contact its operator. Generic agents may get 403 without notice [W3]. **OpenVerify cannot ship a contact**, so the operator must set one, as with EDGAR in C61 [R5] (inference).
- **Robots.** `query.wikidata.org/robots.txt` disallows `/sparql` and `/bigdata`, and `www.wikidata.org` disallows `/w/` and `/api/` for generic robots [W4]. The query service manual invites programmatic SPARQL clients within its limits [W2]. An operator-run sync is an API client, not a crawler (inference), but the owner should note the tension.
- **Dumps** (`https://dumps.wikimedia.org/wikidatawiki/entities/`) [W5]:
  - `latest-all.json.gz`: 156,603,056,120 B (`Last-Modified` 20 Oct 2026);
  - `latest-all.json.bz2`: 103,488,697,311 B;
  - `latest-truthy.nt.gz`: 71,710,466,638 B.

  These are far too large for a PEP feature. Not recommended except for operators who already mirror Wikidata.

### 7.2 Defining a PEP set from positions held

Wikidata models a person holding an office with **`P39` (position held)**. Its value-type constraint lists 20 classes, `Q4164871` (position) first, and its subject-type constraint lists 11 classes, `Q5` (human) first [W6]. `Q294414` (public office) and `Q845436` (mandate) are not constraint classes: they appear as the property's related items (`P1629`, "Wikidata item of this property") (corrected in fact-check). Its qualifiers carry the facts screening needs [W6]:
- dates: `P580` start time, `P582` end time, `P585` point in time, `P1534` end cause;
- jurisdiction and organisation: `P1001` applies to jurisdiction, `P2389` organization directed by the office or position, `P108` employer;
- election: `P768` electoral district, `P2715` elected in, `P4100` parliamentary group, `P102` political party;
- succession: `P1365` replaces, `P1366` replaced by.

The inverse is `P1308` (position holder) [W6].

A sync would proceed as follows (inference):
1. **Choose positions, not people.** Take position items that are instances of, or subclasses (`P31`/`P279`) of, classes for heads of state and government, ministers, members of national legislatures, supreme and constitutional court judges, central bank governors, ambassadors, senior military officers, state-owned enterprise heads, international-organisation leaders and party leaders. Add the national top offices reachable from each country item.
2. **Anchor the list in official definitions where they exist.** The EU requires each Member State to publish the exact functions that count as prominent public functions, and the Commission to assemble a single list [E9]. The Commission's own list for EU institutions is Decision C/2023/611 [E9]. A Council working document reports that 17 Member States include regional and local posts and 10 do not [W9].
3. **Commit a curated table** `positions.json`: QID, country, level, role, source (an official list reference or `authored`). Record the query text, date and result SHA-256 beside it, exactly as the C58.3 nickname table does [R5].
4. **For each position**, fetch its holders, with start and end dates, birth date (`P569`), death date (`P570`), citizenship (`P27`) and all labels and aliases in every language (multi-script names).
5. **Family** through spouse `P26`, child `P40`, father `P22`, mother `P25`, sibling `P3373` and relative `P1038`. Wikidata has **no** reliable "close associate" property (inference), so associates are out of scope and flagged as such.

The property and class IDs above other than those on the P39 page [W6] are from our own knowledge and **must be verified at implementation** (record each label with its ID).

**Approximate size.** One curated derivation (OpenSanctions `wd_peps`) holds about 266,362 persons, 104,883 positions and 262 countries, last changed 2026-10-22, and still excludes sub-national posts [S4]. A narrower national-level set will be smaller (inference).

**Refresh.** Wikidata changes continuously; a weekly operator-run sync is enough for PEP status (inference).

### 7.3 FATF definition, and the honest limits

- **The FATF categories** [W8]:
  - **foreign PEPs:** entrusted with prominent public functions by a foreign country;
  - **domestic PEPs:** entrusted with them at home;
  - **international organisation PEPs:** senior management of an international organisation (directors, deputies, board members or equivalent).

  Examples include heads of state or government, senior politicians, senior government, judicial or military officials, senior executives of state-owned corporations and important party officials. **Middle-ranking and junior officials are excluded.**
- **Family and associates.** Family members are relatives by blood or by marriage or a similar partnership; close associates are people closely connected socially or professionally.
- **No fixed time limit.** How long someone stays a PEP after leaving office is a risk assessment, not a prescribed time limit. Family members follow the PEP's status.
- **Databases.** Commercial PEP databases are neither required nor sufficient for compliance.
- **Honest limits (inference):**
  - Wikidata coverage is uneven by country and level: rich for national legislatures and cabinets, thin for state-owned enterprises, the judiciary below supreme courts, the military and local office.
  - Dates are often missing: an open-ended `P39` may mean "still in office" or "unknown end".
  - Family links are sparse.
  - Anyone can edit Wikidata.
- **Consequence.** The PEP report is **H-tier, `stage: beta`**, with a confidence and reason codes (`position_level`, `in_office`, `left_office_years`, `relation`). A match always means review, never an automatic decline. A "no match" never asserts that someone is not a PEP; the report says "no match in the configured sources".

---

## 8. Adverse media from GDELT

### 8.1 DOC 2.0 API

- **Endpoint.** `https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=...&format=...` [G1].
- **Query syntax** [G1]:
  - quoted phrases, `(a OR b)` without nesting, a leading `-` to exclude;
  - `domain:` and `domainis:`, `sourcecountry:`, `sourcelang:`;
  - `theme:` (GKG themes);
  - `tone<`/`tone>` and `toneabs`;
  - `near` and `repeat`;
  - image operators.
- **Modes.**
  - Articles: `artlist`, `artgallery`.
  - Timelines: `timelinevol`, `timelinevolraw`, `timelinevolinfo`, `timelinetone`, `timelinelang`, `timelinesourcecountry`.
  - `tonechart`, plus image and word-cloud modes.
- **Formats.** HTML, CSV, JSON, JSONP, RSS, RSSArchive and JSONFeed [G1].
- **Window.** A rolling **3 months**, through `timespan` (minimum 15 minutes) or `startdatetime`/`enddatetime` as `YYYYMMDDHHMMSS` [G1].
- **Results.** `maxrecords` defaults to 75 and is at most 250. `sort` is `hybridrel`, `datedesc`, `dateasc`, `tonedesc` or `toneasc` [G1].
- **Languages.** Searches run across 65 machine-translated languages using English queries [G1].
- **What `artlist` JSON returns.** Per article: `url`, `url_mobile`, `title`, `seendate` (when GDELT saw it), `socialimage`, `domain`, `language` and `sourcecountry` [G4]. **No full text**, and no per-article tone in `artlist` (inference; tone is a filter and a `tonechart` mode).
- **Rate limit.** Two requests from this session, 20 s apart, both got **429** with a plain-text body asking for one request every 5 seconds [G3]. Expect throttling on shared egress addresses (inference).
- **Error handling.** One third-party client reports that malformed queries can return a plain-text error with status 200, so parse defensively [G4].

### 8.2 Terms and what may be stored

- **GDELT's terms.** All GDELT datasets are open for "unlimited and unrestricted use for any academic, commercial, or governmental use" (quoted because it decides). Redistribution is allowed. Any use must cite the GDELT Project and link to `https://www.gdeltproject.org/` [G2]. **✅** for GDELT's data.
- **Articles (⚠️).** The articles are third-party copyright, and GDELT's terms say nothing about them [G2]. In the EU, press publishers hold a right over online use of their publications, except for hyperlinks and "individual words or very short extracts". Whether a headline is a very short extract is contested [E7].
- **What to store (inference).** The article URL, domain, `seendate`, language and source country, plus the title capped at about 200 characters and shown only as the link text. Never fetch, store or render the body, image or snippet. Offer a setting to keep URL and domain only.
- **Personal data (⚠️).** An adverse-media hit links a named person to alleged wrongdoing. That is likely "criminal offence data", which GDPR Art. 10 lets a private party process only where Union or Member State law authorises it [E8] (inference: AML law usually does for obliged entities). Each DOC API query also **sends the screened name to GDELT**, a third party, from the operator's server: a disclosure and possibly an international transfer.
- **Tier and defaults (inference).** The provider is opt-in, bound only when the operator accepts that note. The adverse-media report is **H-tier beta**: name co-occurrence in news is not identity, so every hit goes to review.

### 8.3 Alternatives

- **GDELT GKG local index (same terms) [G5].** `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` (HTTPS, 320 B) lists, every 15 minutes, the newest `export`, `mentions` and `gkg` files, each with its **size and MD5**. The `gkg.csv.zip` was 5,008,767 B. The listed URLs use `http://`, and that host 301-redirects to HTTPS, so rewrite to `https://` and verify the MD5 (inference). A worker can build a local person-name → article index, keeping URL, date, tone and themes for a configured window. **Names never leave the install.** The cost is about 0.5 GB/day zipped to download and a large index (inference). Proposed as a later option.
- **Commercial media APIs.** These are A-tier adapters with a deterministic sandbox, like Persona's vendor report types `comply-advantage-search` [R4].
- **Common Crawl News and scraping.** Not alternatives: the crawled pages stay under their publishers' copyright (inference). No permissive full-text news corpus with global coverage was found.

---

## 9. Crypto-address watchlist sources

| Source | What | Terms | Verdict |
|---|---|---|---|
| OFAC SDN `Digital Currency Address - <SYM>` features (§1.2) | 1,050 distinct addresses across 20 symbols; symbols are currencies or tokens, not chains [M1] | as §1 | ✅ primary |
| UK Sanctions List `CryptoWalletAddresses` (§4.3) | Present in the XSD; count and chain labelling not measured or documented [K3][K4] | OGL v3.0 | ✅ |
| UN, EU FSF | No dedicated field (UN measured; EU **not documented**) | - | - |
| `0xB10C/ofac-sanctioned-digital-currency-addresses` | A tool (MIT) that re-extracts OFAC addresses into per-symbol lists [C1] | MIT tool; the data is OFAC's | Not needed (we parse OFAC directly); a useful cross-check in tests |
| Chainalysis sanctions oracle and API | Announced free in 2022 for US, EU and UN lists [C2]; today's product page describes a paid screening product, and current terms are **not documented** [C2] | proprietary | A-tier adapter only (Persona's `chainalysis-address-screening` and `trm-wallet-screening` report types are vendor adapters too [R4]) |
| Israel NBCTF seizure orders | Seizure orders naming wallets, reported in 2021 and 2025 [C3]; primary files, format and terms **not documented** | not documented | ⚠️ not built in |

Matching rule for this report (inference, building on C57 validators [R5]):
- Normalise each address per format: lowercase EVM hex and bech32; keep base58 case-sensitive; strip the `bitcoincash:` prefix.
- Match exactly on the normalised value **regardless of the list's symbol**, and report the symbol as metadata. Token labels (USDT, USDC) say nothing about the chain, and at least one label is wrong (§1.2).
- An address valid on several chains (EVM) matches on all of them.
- The match is R-tier (exact). OFAC's non-exhaustiveness [F8] goes in the docs.

---

## 10. Cross-cutting findings for the Phase 5 foundations

### 10.1 What the C54.6 outbound client must accommodate [R5]

- **Redirects.** C54.6 fixes `maxRedirections: 0`. OFAC and the UN serve **every** file through a 302 to pre-signed object storage: AWS GovCloud S3 for OFAC, Azure Blob SAS for the UN [F4][N1]. The watchlist clients need **exactly one** redirect, to an exact host allowlisted per source (`wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`, `unsolprodfiles.blob.core.windows.net`). The target must be HTTPS, pass the vetted lookup, and receive no credentials. Its `Location` must never be logged, since it carries temporary credentials (inference).
- **Size caps.** These lists need per-client caps well above 1 MiB: OFAC enhanced ZIP 6.8 MB inflating to 110 MB, EU 26 MB, UK 22 MB, CSL 34 MB. For a ZIP, require exactly one member with the expected name, check its declared size against a cap, and count bytes while inflating (zip-bomb guard; inference).
- **Content types.** These must be per source and judged on the final hop: `text/xml`, `application/xml`, `application/zip`, `text/csv`, `text/plain` (EU CSV) and `application/octet-stream` (UK CSV and ODS).
- **Ranges.** Range requests are ignored by the EU (measured). No client should rely on them.

### 10.2 Personal data in every list

Every list in this note holds personal data of named individuals. OGL v3.0 expressly excludes personal data [K7], and the EU reuse decision defers to data-protection law [E6]. The operator therefore needs a lawful basis to hold the lists and the screening results (inference: a legal obligation under AML or sanctions law for obliged entities), plus retention rules (C16). Adverse media adds the GDPR Art. 10 question [E8]. OpenVerify can only document this; it cannot decide it.

### 10.3 Email risk, phone risk and address lookup (pointer only, not researched here)

These reports read the Phase 5 sources:
- **Email risk:** the CC0 disposable-domain list and MX lookups (C56) [R5].
- **Phone risk:** libphonenumber metadata, which has no carrier data. A carrier or line-type answer is an A-tier adapter (C55, C63) [R5].
- **Address lookup:** needs a geocoder, which is an A-tier adapter with a sandbox. OpenStreetMap data is ODbL 1.0, a share-alike database licence [X17], so it cannot ship as runtime data under rule 4; an operator may bind their own geocoding service.

---

## Final table: source → rule 4 → how the operator gets it → what tests use

The mechanism is the same everywhere. A source manifest (`watchlists/sources.json`, committed) lists for each source:
- id, publisher, URL, allowed redirect host, allowed content types and size cap;
- parser id, terms note and attribution line;
- whether it is enabled by default.

An operator-run `watchlists:sync [--source <id>]` reads the manifest. A repeatable job runs it only when `OPENVERIFY_WATCHLIST_REFRESH=true`, mirroring C62.7's opt-in [R5]. For each source it:
1. checks the source's cheap change signal;
2. downloads through the outbound client, HTTPS only, with caps;
3. records the SHA-256 of what it fetched;
4. validates the parse against a strict schema;
5. refuses a generation older than the stored one (monotonicity), skips an identical hash, and refuses to apply a drop of more than a configured share of entries without `--allow-mass-removal` (inference, mirroring the C62.7 rollback and withdrawal checks);
6. writes one snapshot in a transaction under a per-source advisory lock, with a `watchlist_syncs` audit row.

The data is never committed and never shipped. CI never contacts a publisher.

| Source | Rule 4 | Change signal / monotonicity key | Mechanism | Tests use instead |
|---|---|---|---|---|
| OFAC SDN | ✅ | `/changes/latest` `Location` (delta date), S3 `x-amz-meta-publication-id`, `publicationInfo/dataAsOf` | sync of `SDN_ENHANCED.ZIP`; deltas optional (full file is only 6.8 MB) | synthetic enhanced XML (3–5 entities: individual with Latin and Cyrillic translations and a low-quality alias, entity, vessel, digital-currency features incl. a USDT-on-Tron and a mixed-case ETH value) zipped; a synthetic delta with `add`/`remove`/`update`; a local HTTPS stub that answers 302 to an allowlisted stub host |
| OFAC Consolidated | ✅ | as above | sync of `CONS_ENHANCED.XML` | as above, with a `Sectoral Sanctions Identifications List` membership |
| UN SC | ⚠️ (ships disabled) | `dateGenerated` plus per-record `DATAID`/`VERSIONNUM`; compare content, not headers | sync of the EN XML through the Azure 302 | synthetic `CONSOLIDATED_LIST` with `QUALITY` values `Good`, `Low`, `a.k.a.` and empty, `TYPE_OF_DATE` `EXACT`/`APPROXIMATELY`/`BETWEEN` |
| EU FSF | ✅ | RSS `pubDate`; `export@generationDate` and `globalFileId` | sync of XML 1.1 with the operator's token (default: the catalogue's public token) | synthetic `export` with `nameAlias strong="false"`, partial `birthdate`, `unitedNationId`; a 403-without-token stub |
| UK Sanctions List | ✅ | GOV.UK content API `public_updated_at` and `change_history`; `DateGenerated` (dd/mm/yyyy) | sync of the XML | synthetic `Designations` with `Name1`–`Name6`, `AliasStrength`, `NonLatinNames`, a `dd/mm/1970` partial DOB, a `CryptoWalletAddress`, `DesignationSource` UN |
| OFSI ConList (legacy) | ❌ | - | none; a startup warning if configured | a test that the manifest has no OFSI URL |
| Canada / Australia / Switzerland | ⚠️ | file `Last-Modified` / generation date | operator-added manifest entries, off by default | none in Phase 6 beyond the generic manifest validation |
| CSL (trade.gov) | ✅ | `Last-Modified` (daily 05:00 ET) | opt-in sync for the business watchlist | synthetic JSON rows for an Entity List company |
| World Bank, Interpol, OpenSanctions data | ❌ | - | none (adapters only with the operator's licence) | sandbox provider |
| Wikidata PEP | ✅ data, H-tier | sync timestamp; query text and result SHA-256; per-item `lastrevid` (inference) | operator-run `pep:sync` with `OPENVERIFY_WIKIDATA_USER_AGENT` (required, with the operator's contact), a configurable endpoint, POST, ≤ 1 concurrent query, back-off on 429/`Retry-After`, paged per position | recorded synthetic SPARQL JSON results (fictional QIDs `Q-test-*`, fictional names), including an open-ended `P39`, a spouse link and a dead holder |
| GDELT DOC (adverse media) | ✅ / ⚠️ | none (on-demand); cache 24 h keyed by the SHA-256 of the normalised query | opt-in adapter, install-wide GCRA 1 per 5 s, citation line in the report | a local stub serving synthetic `artlist` JSON, a plain-text error with status 200, and a 429 |
| GDELT GKG index (later) | ✅ / ⚠️ | `lastupdate.txt` file stamps and MD5 | optional worker | a synthetic two-row GKG CSV in a ZIP with its MD5 |
| Chainalysis, commercial media, OpenSanctions API | A-tier | - | adapters bound by operator credentials | deterministic sandbox providers with magic values |

---

## What Phase 6 should take from this (proposed)

1. **Default sources: OFAC SDN, OFAC Consolidated, EU FSF and the UK Sanctions List**, all ✅. UN ships as a disabled source definition with its terms note. Canada, Australia and Switzerland are documented as operator-added entries, off by default. CSL is opt-in for the business watchlist. OFSI is never used.
2. **Formats.** OFAC **enhanced XML** (ZIP for SDN), UN legacy XML, EU **XML 1.1**, UK **XML**. Never the CSVs: OFAC's put identifiers in free-text remarks.
3. **One normalised record** inspired by FollowTheMoney (MIT) [S7]. It holds:
   - kind (individual, entity, vessel, aircraft) and names with parts and scripts;
   - an alias **weight** from `isLowQuality` (OFAC), `QUALITY` (UN), `strong` (EU) and `AliasStrength` (UK);
   - partial dates mapped to the C58.5 rules (OFAC `valueDate` ranges, UN `TYPE_OF_DATE`, EU day/month/year, UK `dd/mm/yyyy` placeholders);
   - countries as ISO 3166 codes, documents, addresses and crypto addresses;
   - programmes and listing dates;
   - source provenance (source id, snapshot SHA-256, record id and version).
4. **Matching** reuses C58: folding, transliteration, token Jaro-Winkler and nicknames, plus C58.6 legal forms for entities. Scores come with explanations, and the DOB and country filters run as **filters that lower the score or exclude**, never as reasons to "pass" a weak name match. Low-quality aliases need a higher threshold. Exact identifier hits (passport, IMO, crypto address) are strong evidence. Watchlist name matching is R-tier for the arithmetic, but results always go to review on a match. The report never says "clear"; it says "no match in sources X at snapshot Y".
5. **The C62.7 sync pattern** for every list, with the monotonicity, hash, schema, mass-removal and staleness checks in the final table. A report whose source snapshot is older than a configured age (default 48 h; inference) answers `list_stale` (`execution_error` class), never a silent pass, mirroring C61.5's feed staleness rule.
6. **An amendment to C54.6.** Allow one redirect to an allowlisted storage host per watchlist client. Never log `Location`. Set per-client caps and content types from §10.1. Add a ZIP guard.
7. **Continuous monitoring should be delta-driven.** On each new snapshot, compute added and changed records (OFAC deltas, or our own diff for UN, EU and UK) and screen only those against monitored subjects. Do a full re-screen only on a matcher-version change. Emit the Persona-parity events `report_watchlist.matched` and `report_crypto-address-watchlist.matched` and their siblings [R4]. A dismissed match is keyed by (subject, source record id, record version) so that a changed record re-alerts.
8. **PEP:** H-tier beta. `pep:sync` over a committed, curated `positions.json`, anchored in the EU functions lists [E9], FATF categories [W8], operator-set retention windows (default: in office or left within 12 months, matching the EU minimum noted in [S3]; 5 years for national heads of state or government; see "Needs the owner" 7), family via P26/P40/P22/P25/P3373/P1038, no associates. The operator's User-Agent contact is required, so it is unbound by default.
9. **Adverse media:** H-tier beta, an opt-in `gdelt-doc` adapter plus a sandbox. Store only URL, domain, date, language, source country and a capped title; include the GDELT citation. Rate-limit 1 per 5 s per install, cache 24 h. A GKG local index is a later option for operators who must not send names to a third party.
10. **Crypto-address watchlist:** R-tier exact match on normalised addresses from OFAC and UK, with the symbol kept as metadata; Chainalysis and TRM as A-tier adapters.
11. **Business watchlist:** sanctions entities (OFAC, EU, UK, opt-in UN) plus opt-in CSL; names enriched from the subject's KYB record (C61 GLEIF `otherNames`).
12. **Records to fix** (the corrections in "Summary"): PLAN §3 sanctions row, THIRD_PARTY_LICENSES §4.2 rows for UN, OFSI to FCDO, GDELT and OFAC URLs; add the CSL row; add the OpenSanctions-data ❌ row; record the per-source attribution lines (OGL v3.0, EU, GDELT) in the report footer and the docs.

## Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Enable the UN Consolidated List by default? Its website terms are non-commercial [N4]; the public-domain rule for UN documents [N5] may not cover the XML | **Ship it disabled** with the terms note. EU, UK and OFAC carry most UN designations. Revisit if the owner accepts the risk or the UN confirms reuse |
| 2 | Canada, Australia and Switzerland lists (no open licence; Australia unverified) | **Not built in**; documented as operator-added manifest entries, off by default |
| 3 | An exception to C54.6's "no redirects" rule for OFAC and UN storage redirects | **Yes:** one hop to an exact allowlisted host per source, HTTPS, vetted lookup, `Location` never logged |
| 4 | An OpenSanctions adapter (yente or the hosted API) for operators who buy a licence | **No adapter in Phase 6**; reconsider in Phase 11 |
| 5 | Adverse media sends screened names to GDELT (third party, US) | **Opt-in** `gdelt-doc` provider, unbound by default; binding requires `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`. GKG local index deferred |
| 6 | Storing article titles (EU press-publisher right) | Store the URL plus a title capped at 200 characters, rendered only as link text; a setting to keep URL and domain only |
| 7 | PEP retention after leaving office | Operator setting per level; default **12 months**, with national head of state or government **5 years** (inference; FATF prescribes no fixed limit [W8]) |
| 8 | Querying `query.wikidata.org` while its robots.txt disallows `/sparql` for crawlers | **Allowed for the operator-run sync** as an API client under the usage policy [W2][W3], with the operator's contact User-Agent required; never from CI |
| 9 | CSL (US export controls) in the business watchlist | **Opt-in**, off by default |
| 10 | Chainalysis or TRM crypto adapters | Interfaces plus sandbox only; no vendor client until an operator asks |
| 11 | The EU FSF token | Accept `OPENVERIFY_EU_FSF_TOKEN`, defaulting to the token the EU catalogue publishes [E1] |
| 12 | Lawful-basis and DPIA guidance for screening data, including GDPR Art. 10 for adverse media | Document it in `docs/checks/reports.md` as the operator's responsibility; OpenVerify takes no position |
| 13 | Staleness threshold for a source snapshot | **48 h** for OFAC, EU and UK (UN 72 h if enabled); above it, `list_stale` and review |

---

## Sources and pins

All read on **2026-10-22**. Probes record status, type and size only. "Measured" means our own script over a downloaded file:
- SDN_ENHANCED.ZIP: SHA-256 `80d0a8de8734d9d278996e1ac5d6659f0c043a23c4e2926b4aa556f9a85b2c8b`, 6,793,008 B, `dataAsOf` 2026-10-21;
- UN consolidated.xml: SHA-256 `a52a47a62939482afdba2ec2becb86c88a5d6a93875665b4c8f11e99cda1d2a4`, 2,185,396 B, `dateGenerated` 2026-10-22T23:00:06.809Z;
- OFAC delta 2026-10-21: SHA-256 `b9a5875189e034f49656a9aac71fda18ce750ab2ef67351aeb9cdadba35bdc61`.

**Repository (R)**
- [R1] `docs/PLAN.md` §3 (technology table), §4.4, §6 Phase 6
- [R2] `CLAUDE.md` rules 4 and 5
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (Report types (52); `report_*` events; `reports/*` paths)
- [R5] `docs/plans/phase-5.plan.md` C54.6, C56, C57, C58, C61, C62.7
- [R6] `THIRD_PARTY_LICENSES.md` §4.2
- [R7] `data/manifest.json`, `scripts/fetch_data.py`

**OFAC (F), measurements (M), US and AWS law and docs (L)**
- [F1] https://ofac.treasury.gov/sanctions-list-service
- [F2] https://sanctionslist.ofac.treas.gov/Home/static/sdn.html (links point to `ofacwebdev.wc2h.treasury.gov/SlsPublicApi_hotfix/...`)
- [F3] https://sanctionslist.ofac.treas.gov/Home/static/consolidated.html
- [F4] https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ followed by `SDN_ENHANCED.ZIP`, `SDN_ENHANCED.XML`, `SDN_ADVANCED.XML`, `SDN.XML`, `SDN.CSV`, `ADD.CSV`, `CONSOLIDATED.XML`, `CONS_ENHANCED.XML`, `CONS_ADVANCED.XML`, `CONS_PRIM.CSV`, `ENHANCED_XML.xsd`, `DAT_SPEC.TXT` (probed; 302 to `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`)
- [F5] https://sanctionslistservice.ofac.treas.gov/changes/latest (302 to `/DeltaArchive/2026-10-21_delta.xml`); https://www.treasury.gov/ofac/downloads/sanctions/1.0/DeltaFile.xsd
- [F6] https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ENHANCED_XML.xsd (SHA-256 `0c56f9f2d5b9f1ad57dffcd379ed66824c46fbae1e8074157b2b5be46652b97f`)
- [F7] https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/DAT_SPEC.TXT (updated 09/25/2023)
- [F8] https://ofac.treasury.gov/faqs/562 (2018-03-19)
- [F9] https://ofac.treasury.gov/faqs/563 (2018-06-06)
- [F10] https://ofac.treasury.gov/recent-actions/20240507_44
- [F11] https://catalog.data.gov/harvest_record/b966879e-23e7-4b62-8da3-9d6b9caf1f56/raw (Treasury Project Open Data record: licence `http://creativecommons.org/publicdomain/zero/1.0/`, accrual `irregular`)
- [F12] https://home.treasury.gov/subfooter/site-policies-and-notices
- [F13] https://www.treasury.gov/ofac/downloads/sdn.xml and https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml (Akamai 302, then SLS 302, then S3)
- [M1] Our measurement of `SDN_ENHANCED.ZIP` (pins above)
- [L1] 17 U.S.C. §105, https://www.copyright.gov/title17/92chap1.html
- [L2] https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html (ETag is not an MD5 under SSE-KMS)

**UN (N)**
- [N1] https://scsanctions.un.org/resources/xml/en/consolidated.xml (302 to `unsolprodfiles.blob.core.windows.net/publiclegacyxmlfiles/EN/consolidatedLegacyByPRN.xml`); `/sp/` and `/fr/` likewise; measured (pin above)
- [N2] https://scsanctions.un.org/consolidated/
- [N3] https://www.un.org/sc/suborg/en/sanctions/un-sc-consolidated-list (301 to `main.un.org/securitycouncil/un-sc-consolidated-list`, which answers an empty 202 to scripts; content seen only through search summaries)
- [N4] https://www.un.org/en/about-us/terms-of-use
- [N5] https://en.wikisource.org/wiki/ST/AI/189/Add.9/Rev.2 (17 September 1987)
- [N6] https://www.un.org/sc/resources/sc-sanctions.xsd (502; 403 or 404 at fact-check, corrected in fact-check)

**EU (E)**
- [E1] https://data.europa.eu/api/hub/search/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions (licence resource `http://data.europa.eu/eli/dec/2011/833/oj`; accrual daily)
- [E2] https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=<public token> ; https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=<public token> ; https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList/content?token=<public token>
- [E3] https://webgate.ec.europa.eu/fsd/fsf/public/rss
- [E4] FSF Stakeholders' User Manual, https://circabc.europa.eu/d/a/workspace/SpacesStore/9cf02a9e-7604-4178-a21d-d0b6bdcb4114/MA_FSF_EN.pdf
- [E5] https://commission.europa.eu/legal-notice_en
- [E6] Commission Decision 2011/833/EU, http://data.europa.eu/eli/dec/2011/833/oj (EUR-Lex refuses scripted fetches; read via https://lexaris.de/book/version/documentflat/head/2120378)
- [E7] Directive (EU) 2019/790 Art. 15, https://eur-lex.europa.eu/eli/dir/2019/790/oj ; commentary at https://legalblogs.wolterskluwer.com/copyright-blog/taking-freedom-of-information-seriously-the-very-short-extracts-limitation-in-article-15-cdsm-directive-and-how-not-to-implement-it-part-1/
- [E8] GDPR Art. 10, https://eur-lex.europa.eu/eli/reg/2016/679/oj (read via https://gdpr-info.eu/art-10-gdpr/)
- [E9] Directive (EU) 2015/849 Art. 20a, https://www.legislation.gov.uk/eudr/2015/849/article/20a ; Commission Decision C/2023/611, http://data.europa.eu/eli/C/2023/611/oj (read via https://lexaris.de/book/version/documentflat/head/4660819) ; C/2023/724, https://eur-lex.europa.eu/eli/C/2023/724/oj/eng (scope not verified)

**UK (K)**
- [K1] https://www.gov.uk/government/publications/the-uk-sanctions-list
- [K2] https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml , `.csv` , `.ods`
- [K3] https://assets.publishing.service.gov.uk/media/6916e72cdb01ecfcf96fc96b/SanctionsListSchema-4.33.3.xsd
- [K4] https://www.gov.uk/guidance/format-guide-for-the-uk-sanctions-list
- [K5] https://www.gov.uk/api/content/government/publications/the-uk-sanctions-list
- [K6] https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml and `ConList.csv`
- [K7] https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/

**Extras (X)**
- [X1] https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng
- [X2] https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml
- [X3] https://www.canada.ca/en/transparency/terms.html
- [X4] https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list (timed out)
- [X5] https://dfat.gov.au/news/improved-consolidated-list (timed out; search summary only)
- [X6] https://www.seco.admin.ch/seco/en/home/Aussenwirtschaftspolitik_Wirtschaftliche_Zusammenarbeit/Wirtschaftsbeziehungen/exportkontrollen-und-sanktionen/sanktionen-embargos/sanktionsmassnahmen/suche_sanktionsadressaten.html
- [X7] https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=en&action=downloadXmlGesamtlisteAction
- [X8] https://www.admin.ch/gov/en/start/terms-and-conditions.html
- [X9] Swiss CopA Art. 5 (unofficial English), https://lawbrary.ch/law/art/URG-v2022.01-en-art-5
- [X10] https://www.worldbank.org/en/projects-operations/procurement/debarred-firms
- [X11] https://www.worldbank.org/en/about/legal/terms-and-conditions
- [X12] https://www.interpol.int/en/Who-we-are/Terms-of-use
- [X13] https://www.interpol.int/en/How-we-work/Notices/Red-Notices/View-Red-Notices (search summary)
- [X14] https://www.fatf-gafi.org/content/fatf-gafi/en/publications/Fatfgeneral/outcomes-FATF-plenary-february-2026.html (search summary; the site answers 403 to fetchers)
- [X15] https://www.trade.gov/consolidated-screening-list
- [X16] https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json and `.csv`
- [X17] https://www.openstreetmap.org/copyright (ODbL 1.0, share-alike: relevant if address lookup ever considers OSM data; ❌ as shipped runtime data)

**OpenSanctions (S)**
- [S1] https://www.opensanctions.org/licensing/
- [S2] https://www.opensanctions.org/robots.txt ; https://data.opensanctions.org/robots.txt
- [S3] https://www.opensanctions.org/docs/pep/methodology/
- [S4] https://www.opensanctions.org/datasets/wd_peps/
- [S5] https://www.opensanctions.org/datasets/eu_fsf/
- [S6] https://www.opensanctions.org/datasets/gb_fcdo_sanctions/
- [S7] https://pypi.org/pypi/followthemoney/json ; https://github.com/opensanctions/followthemoney/blob/8aaaece224da3f46e4aa76768cf0dd363b4ce194/LICENSE
- [S8] https://pypi.org/pypi/nomenklatura/json ; https://github.com/opensanctions/nomenklatura/blob/c9224abbf453b4b4abb30b09c30477601add2e38/LICENSE
- [S9] https://pypi.org/pypi/rigour/json ; https://github.com/opensanctions/rigour/blob/b0ba4adce7c99a5947b45d3461c69278e808521d/LICENSE ; README at the same tag
- [S10] https://pypi.org/pypi/yente/json ; https://github.com/opensanctions/yente/blob/258c0a1fbcd9e7f70acdb113f19c28b7eac282b8/LICENSE

**Wikidata and FATF (W)**
- [W1] https://www.wikidata.org/wiki/Wikidata:Licensing
- [W2] https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual
- [W3] https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy (last edited 27 March 2026)
- [W4] https://query.wikidata.org/robots.txt ; https://www.wikidata.org/robots.txt
- [W5] https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz , `latest-all.json.bz2` , `latest-truthy.nt.gz` (HEAD)
- [W6] https://www.wikidata.org/wiki/Property:P39
- [W7] https://meta.wikimedia.org/wiki/WikiCite/WDQS_graph_split (search summary)
- [W8] FATF Guidance, Politically Exposed Persons (Recommendations 12 and 22), June 2013: canonical https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Peps-r12-r22.html (403 to fetchers); read from the mirror https://cbos.gov.sd/sites/default/files/guidance-pep-rec12-22.pdf
- [W9] Council working document WK 7542/2023, https://data.consilium.europa.eu/doc/document/WK-7542-2023-INIT/en/pdf (search summary)

**GDELT (G)**
- [G1] https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- [G2] https://www.gdeltproject.org/about.html (Terms of Use)
- [G3] https://api.gdeltproject.org/api/v2/doc/doc?query=%22sanctions%20evasion%22&mode=artlist&format=json&maxrecords=3&timespan=3d&sort=datedesc (429 twice)
- [G4] https://pypi.org/project/gdeltdoc/ (third-party client; field list)
- [G5] https://data.gdeltproject.org/gdeltv2/lastupdate.txt

**Crypto (C)**
- [C1] https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (MIT; pushed 2026-10-01)
- [C2] https://www.chainalysis.com/free-cryptocurrency-sanctions-screening-tools/ (now describes a paid product); 2022 launch coverage https://decrypt.co/94808
- [C3] https://techcrunch.com/2025/09/15/israel-announces-seizure-of-1-5-million-from-crypto-wallets-tied-to-iran/ (secondary)

---

## Fact-check (2026-10-22)

An independent pass re-opened each load-bearing fact at its primary source. It re-downloaded `SDN_ENHANCED.ZIP`, `SDN_ADVANCED.ZIP`, `SDN.CSV`, `ALT.CSV`, the latest delta, the UN XML and several XSDs, each into its own empty directory, and parsed them with `python3 -I`. It read registry JSON, `git ls-remote` tag refs and the publishers' pages. It sent at most one request per second per host (10 s on opensanctions.org, per its `Crawl-delay`) and no personal data. OFAC was still on publication 1075, so every OFAC hash re-matched. **Totals: 32 facts; 29 confirmed, 3 corrected, 0 unverified.** Two further statements in the text were corrected: the §1.2 script counts and the §3.1 licence tags. Every correction is marked "(corrected in fact-check)".

| # | Fact | Verdict | Evidence from the fact-check |
|---|---|---|---|
| 1 | No US copyright (§105(a)); Treasury's Project Open Data record declares CC0, accrual `irregular` | confirmed | copyright.gov chapter 1, §105(a); catalog.data.gov harvest record: `license` is `http://creativecommons.org/publicdomain/zero/1.0/`, `accrualPeriodicity` is `irregular` (record modified 2016-11-01) |
| 2 | Export base; `GET` answers 302 to a pre-signed GovCloud S3 URL with `X-Amz-Expires=3600` and a security token | confirmed | 7 exports probed. Only the host and parameter names were logged, never the `Location` |
| 3 | The static SDN page links a development host | confirmed | 18 links to `https://ofacwebdev.wc2h.treasury.gov/SlsPublicApi_hotfix`; the Consolidated page uses the production API host |
| 4 | `SDN_ENHANCED.ZIP` 6,793,008 B, SHA-256 `80d0a8de…2c8b`, one member of 109,924,494 B, `dataAsOf` 2026-10-21; entity counts; 4,421 of 44,084 names low quality | confirmed | Re-downloaded; identical hash; counts re-parsed: 10,042 / 7,519 / 1,568 / 342, total 19,471 |
| 5 | `CONS_ENHANCED.XML` 3,870,352 B; `SDN_ADVANCED.XML` 127,668,232 B; `SDN.XML` 29,245,041 B | confirmed | 1-byte ranged GETs (`Content-Range` totals); S3 `x-amz-meta-publication-id` 1075 |
| 6 | Enhanced XSD namespace, root `sanctionsData`, `publicationInfo/dataAsOf`, `valueDate` sub-elements | confirmed | `ENHANCED_XML.xsd`: 18,045 B, SHA-256 `0c56f9f2…2b97f` (same as [F6]) |
| 7 | Digital-currency features: 1,066 features, 1,050 values, 20 symbols; USDT 79 Tron / 8 EVM / 7 base58; up to 256 characters; not exhaustive | confirmed | Re-parsed. One `XBT` value has a Tron shape; ETH 55 lower case and 65 mixed case, all 65 valid EIP-55 (checked with our own Keccak-256). FAQ 563 (2018-06-06) and FAQ 562 (2018-03-19) |
| 8 | Latest delta `2026-10-21_delta.xml` (103,434 B); actions add/remove/update per `DeltaFile.xsd` | **corrected** | The delta and its hash are confirmed (`b9a58751…dc61`; 18 add, 4 remove). The XSD gives entities and elements `elementAction` (`add`, `remove`) only; `update` exists only in `valueAction` on individual values, with `oldValue`/`oldRefId`. Corrected in §1.2 |
| 9 | S3 objects use SSE-KMS, so the ETag is not an MD5 of the data | confirmed | `x-amz-server-side-encryption: aws:kms`; ZIP MD5 `adf1683c…` against ETag `859ea5e2…`; the AWS `Object` API page states the SSE-KMS rule |
| 10 | UN XML: 302 to Azure SAS, 2,185,396 B, SHA-256 `a52a47a6…d2a4`, 736 + 274, no crypto field; the XSD answers 502 | **corrected** (XSD status only) | File, hash and counts re-confirmed. The XSD URL now answers 403 without a User-Agent and 404 with a browser one: unavailable either way. Corrected in §2.1 and [N6] |
| 11 | UN terms personal and non-commercial only; ST/AI/189/Add.9/Rev.2 (17 Sep 1987) public-domain rule | confirmed | UN terms §(a); Wikisource text ¶2 (official records, documents under a symbol, public information material) |
| 12 | EU XML 1.1 URL: 200 `application/xml`, 25,767,041 B, `20261015-FULL-1_1(xsd).xml`; root `export` with `generationDate` and `globalFileId` 185699; 403 without the token | confirmed | HEAD works on this host (no body streamed); first bytes read through a closed pipe |
| 13 | The public token (the base64 encoding of "token-2017") is in the catalogue and the RSS; per-user tokens and checksums sit behind EU Login | confirmed | 15 occurrences in the RSS; catalogue distributions; FSF manual (19 pages): "the URLs include a token, which is the User ID of the currently logged user", with checksums in the logged-in files view |
| 14 | Decision 2011/833/EU Art. 4 "commercial or non-commercial purposes" with source credit; CC BY 4.0 by default | confirmed | Decision text via the Publications Office cellar (CELEX 32011D0833): Art. 4 and Art. 6 (acknowledge the source); Commission legal notice |
| 15 | OFSI list closed Wed 28 Jan 2026; FCDO list the only source; legacy `ConList.xml` still answers (54,098,673 B, `Last-Modified` 2026-06-03) | confirmed | GOV.UK pages; HEAD of the blob |
| 16 | UK XML 22,051,514 B `text/xml`; XSD 4.33.3 elements; `DateGenerated` dd/mm/yyyy | confirmed | HEAD; XSD 16,418 B defines `Name1`, `Name6`, `NameType`, `AliasStrength`, `NonLatinNames`, `CryptoWalletAddresses`, `DesignationSource`, `DateGenerated`; the XML starts with `<DateGenerated>16/10/2026` |
| 17 | GOV.UK content API: `public_updated_at` and 482 change-history entries | confirmed | `public_updated_at` 2026-10-16T10:30:50+01:00; 482 entries |
| 18 | OGL v3.0: commercial use with the standard attribution line; personal data excluded | confirmed | National Archives OGL v3 text |
| 19 | OpenSanctions data CC BY-NC 4.0; `data.opensanctions.org` robots disallows all | confirmed | Licensing page; `robots.txt` is `Disallow: /` (robots file only, nothing else fetched from that host) |
| 20 | followthemoney, nomenklatura, rigour and yente versions, dates, MIT, tag commits | confirmed | PyPI JSON; `git ls-remote` peeled tags: `v4.11.0`→`8aaaece`, `4.17.1`→`c9224ab`, `v2.5.0`→`b0ba4ad`, `v5.5.0`→`258c0a1`; MIT `LICENSE` at each commit |
| 21 | Wikidata CC0; query-service limits; v2 endpoint migration 2026–2027; User-Agent must name the tool and a contact | confirmed | WDQS User Manual (last edited 2026-10-01): 60 s deadline, 60 s per 60 s per client, 30 errors/min, 5 parallel per IP, 429 with `Retry-After`; User-Agent policy (last edited 2026-03-27) |
| 22 | `query.wikidata.org/robots.txt` disallows `/sparql` and `/bigdata`; dump sizes | confirmed | robots file; HEAD: 156,603,056,120 B and 71,710,466,638 B (also `.bz2` 103,488,697,311 B) |
| 23 | P39: value class Q4164871, subject Q5, the qualifiers listed, inverse P1308 | **corrected** (§7.2 text) | `Special:EntityData/P39.json`: the value-type constraint lists 20 classes (Q4164871 first) and the subject-type constraint 11 (Q5 first). All twelve qualifiers are in the 104-entry allowed-qualifiers list; inverse P1308. The text's claim that Q294414 and Q845436 are allowed classes was wrong: they are `P1629` related items |
| 24 | `wd_peps`: about 266,362 persons, 104,883 positions, 262 countries, no sub-national posts | confirmed | Dataset page: People 266,362 (Targets 266,363), Positions 104,883, 262 countries; sub-national positions are "going forward" |
| 25 | FATF PEP guidance (June 2013) points | confirmed (mirror only) | The cbos.gov.sd mirror (36 pages) has each point in ¶11, ¶37, the family and associate definitions, "Time limits of PEP status" and ¶61. The canonical fatf-gafi.org page was not retried; it answers 403 to scripts |
| 26 | GDELT terms: unlimited use including commercial, with a citation and link | confirmed | about.html "Terms of Use" and "Redistributing GDELT" |
| 27 | DOC 2.0: endpoint, rolling 3 months, maxrecords ≤ 250 (default 75), 65 languages; artlist fields; 429 asks for one request per 5 s | confirmed | The DOC 2.0 post; gdeltdoc's PyPI README (secondary, as stated); one synthetic query from this pass got 429 with the "one every 5 seconds" text |
| 28 | `lastupdate.txt` lists 15-minute export, mentions and gkg files with size and MD5 | confirmed | Re-read: three `http://` entries with size and MD5. The GKG size changes every 15 minutes (4,151,615 B at fact-check) |
| 29 | Directive 2019/790 Art. 15 excludes hyperlinking and "individual words or very short extracts" | confirmed | Directive text via the cellar (CELEX 32019L0790), Art. 15 |
| 30 | CSL JSON 33,911,558 B, daily at 05:00 ET, 13 lists, no stated terms | confirmed | Ranged GET: `Content-Range …/33911558` (HEAD answers 404); trade.gov page: "every day at 5:00 AM EST/EDT"; 13 list abbreviations; no licence on the page |
| 31 | World Bank site and APIs non-commercial by default; Interpol forbids commercial use, wanted-person reproduction and robots without permission | confirmed | World Bank terms (Materials and APIs sections); Interpol terms of use |
| 32 | Canada SEMA XML 2,891,117 B; Canada.ca terms need written permission for commercial redistribution | confirmed | HEAD 200 `text/xml`, 2,891,117 B, `Last-Modified` 2026-10-15. Canada.ca timed out from this host, so the terms were read through the fetch service (page modified 2025-09-05) |
| - | §1.2 text: per-script translation counts given as name counts | **corrected** | Those figures count every `translation`, address translations included. Name translations alone: Latin 44,282, Cyrillic 3,670, Arabic 1,500, Chinese Simplified 374, Chinese Traditional 177, Japanese 15, Greek 9 (5,799 non-Latin) |
| - | §3.1 text: every distribution tagged with the Commission reuse notice | **corrected** | CSV 1.0 is tagged CC BY 4.0 and the Sanctions Tracker app CC BY-ND 4.0; the rest are `COM_REUSE` |
