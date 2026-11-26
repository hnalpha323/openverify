# Phase 7 research: network-intelligence data sources and their terms

Checked 2026-10-27; server `Date` headers ran from 16:50 to 17:23 UTC. This note covers every data source the Phase 7 network signals would read: IP geolocation, IP to ASN and organisation, Tor, cloud and datacenter ranges, VPN and proxy detection, GPS distances and reverse geocoding. For each source it records:
- how a self-hosted operator gets and refreshes it;
- whether its terms allow commercial self-hosted use;
- what tests use instead.

Everything is written in our own words. Terms are quoted only where the exact wording decides a licence question (at most one short phrase per source, flagged). Field names, enum values and URL paths are reproduced only as identifiers. Statements that no source makes are marked **(inference)**; facts the sources do not give are marked **not documented**. No real person's IP address, location, fingerprint or name of a private individual appears here; examples use `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` and `2001:db8::/32` [X6][X7].

**Method.**
- **Robots first.** Each host's `robots.txt` was fetched before any other request to it. It was evaluated by a matcher implementing RFC 9309 [X8]: longest match, `*` and `$`, merged groups, redirects followed, and 4xx meaning "unavailable", so access is allowed, while 5xx means disallow. The matcher also obeyed any group naming Anthropic's agents. At least 1.2 s separated requests to one host. The User-Agent was descriptive, with no contact details.
- **Probes recorded headers only.** Download URLs were probed with `HEAD`, or with a ranged `GET` of the first bytes, recording status, type, size and validators.
- **Small files were downloaded for inspection**, each into its own new directory, and inspected with `python3 -I` scripts kept in a separate directory (`resume/phase7-research/scripts/`):
  - the DB-IP Country and ASN Lite MMDBs (4.1 and 5.2 MB);
  - the AWS, Google, Oracle, Cloudflare, DigitalOcean and Linode range files;
  - the Tor bulk exit list;
  - the RIR checksum and signature companions;
  - two curated ASN lists;
  - npm packuments and LICENSE files.

  About 16.9 MB was kept, within the 30 MB budget. Nothing downloaded was executed.
- **Measurements of our own** are cited as `[M-…]`.
- **Nothing in the repository was changed.**

**Process deviations (recorded honestly).**
- **PyPI.** One `HEAD` of `pypi.org/pypi/pyasn/json` was sent before the robots matcher was replaced. PyPI's robots file disallows `/pypi/*/json`, which the Python standard-library parser had missed. No body was read.
- **RouteViews.** One `GET` of the `www.routeviews.org` home page was sent before its robots file's full agent list was read. That file names Anthropic's crawlers. The saved page was deleted unread, and no further request went to that host.
- **iptoasn.com.** The same standard-library parser would have allowed `iptoasn.com/data/*.gz`, which that site disallows. The rule was read by hand first, and nothing was fetched from that path.

The log is in `resume/phase7-research/deviations.log`.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**.

Legend: ✅ passes rule 4 [R2] for commercial self-hosting · ⚠️ passes with a caveat or needs an owner decision · ❌ fails. Tiers R / H / A are those of ADR 0002 [R3]; the honesty rules are rule 5 [R2].

## Summary

| Source | Rule 4 | Basis in one line | How the operator gets it |
|---|---|---|---|
| **DB-IP Country / City / ASN Lite** | ✅ | CC BY 4.0, verified on every Lite page and in the terms of service; credit DB-IP plus a link back on web pages that show results [D1][D5] | Operator-run monthly sync. Only the current and previous month stay online [D8], so a pin in `data/manifest.json` would break within two months |
| IPinfo Lite | ❌ | CC BY-SA 4.0 (share-alike), and an account token [I1][I3] | Not built in |
| IP2Location LITE / IP2Proxy LITE | ❌ | Custom licence: no redistribution, bound to a master agreement for internal use only; an account token [P2][P3] | Not built in |
| MaxMind GeoLite | ❌ | A proprietary EULA over CC BY-SA 4.0: FCRA and government-benefit uses banned, 30-day destruction, disclosure consent; an account and a key [M1][M2] | Never |
| RIR delegated statistics | ⚠️ | APNIC and AFRINIC: free download and use [G1][G2]; ARIN and LACNIC: no terms found; RIPE NCC: the site copyright statement requires written authorisation for commercial use [G4]. Country of registration, not of use | Not needed (DB-IP covers country); optional cross-check after an owner decision |
| iptoasn.com | ⚠️ | PDDL 1.0 [A1], but robots disallows `/data/*.gz` [A3] and its provenance is undocumented | Not built in |
| RouteViews / pyasn, RIPE RIS, RIR bulk WHOIS, PeeringDB, CAIDA | ❌ / ⚠️ | Robots disallow, non-commercial terms, agreements for operational purposes only, or a custom terminable licence [A4][G9][A7][A8][A9][A10][A11] | Not built in |
| **Tor exit lists** (CollecTor / check.torproject.org) | ✅ | Tor Metrics data under a CC0 declaration [T2]; hourly | Operator-run hourly sync of `exit-addresses` (Onionoo is robots-disallowed [T3]) |
| **Cloud provider ranges** (AWS, Google, Oracle, Cloudflare, DigitalOcean, Akamai/Linode) | ⚠️ | Factual lists published for programmatic use, with no licence stated [C1][C4] | Operator-run sync, each provider switchable |
| Azure service tags | ⚠️ leaning ❌ | Microsoft site terms default to personal, non-commercial use, though the page asks sites to download weekly [C5][C9] | Off by default until the owner decides |
| Apple Private Relay egress | ⚠️ | No terms; published for geolocation and recognition [C7] | Opt-in (`is_relay`, not a fraud flag) |
| **X4BNet curated ASN lists; bad-asn-list** | ✅ | MIT (README declaration / LICENSE) [N1][N4] | **Pinned snapshot** by commit through `fetch_data.py` |
| X4BNet generated prefix lists | ⚠️ | Expanded from iptoasn data and providers' lists [N3] | Not used; we expand the ASNs with DB-IP ourselves |
| Open-proxy lists (FireHOL and others) | ❌ | No licence; aggregations of third-party feeds [N6] | Never; `is_proxy` needs an A-tier adapter |
| Commercial anonymiser feeds (MaxMind Anonymous IP, IPinfo Privacy, IPQualityScore, Spur) | A-tier | Paid or keyed vendor products [V1]–[V5] | Adapters with a deterministic sandbox |
| **Natural Earth** (countries, admin-1, populated places) | ✅ | Public domain [S4][S5] | **Pinned snapshot** at tag `v5.1.2` through `fetch_data.py` |
| GeoNames | ⚠️ | CC BY, commercial use allowed [S6]; but `download.geonames.org` disallows all robots [S7] | Operator import only |
| OSM / Nominatim | ❌ | ODbL share-alike; usage policy limits [S8][S9] | Never at runtime |

**Five conclusions.**
1. **Every free source misses residential proxies, and most VPNs.** Only Tor, the exact provider ranges and the hosting-ASN lists are usable. `is_proxy` and residential-proxy detection are A-tier, and `is_vpn` and `threat_level` are H-tier beta (§5).
2. **DB-IP is the only permissive geolocation and ASN source.** It cannot be pinned for long, so Phase 7 needs the Phase 6 C76 sync pattern [R8] for permissive commercial data too, not only for public-sector data (§9).
3. **Distances.** Haversine on R₁ is within 0.56% of the ellipsoid on our measurement. That is far inside the inputs' uncertainty, which every distance should carry (§6.2).
4. **Reverse geocoding.** Natural Earth (public domain, pinned) gives country and region honestly. City level is heuristic, and street level needs an adapter (§6.3).
5. **Privacy.** IP addresses are personal data. Keep the sealed address, blind-index it for matching, never log it, and never let a network signal decline an inquiry on its own (§7).

## Corrections to the repository's records

- **PLAN §3, "IP intel … public"** [R1]. Only part of the row is right:
  - DB-IP Lite is CC BY 4.0 (verified), with a **link-back duty** on web pages that show results [D1].
  - The Tor exit list is **CC0** through Tor Metrics [T2].
  - The cloud ranges carry **no licence**, and Azure's sits under Microsoft's default non-commercial site terms [C9].
  - "VPN ASN lists" now have a candidate: X4BNet's curated ASN files (MIT) [N1], expanded with DB-IP rather than with the iptoasn data the upstream build uses [N3].

  The licence cell should say so instead of "public".
- **`THIRD_PARTY_LICENSES.md` §4.2** [R6]:
  - The DB-IP row: verified, attribution plus link-back, monthly, operator-synced.
  - The Tor row: "Public (Tor Project)" → CC0 (Tor Metrics), hourly.
  - The cloud row: "terms vary" → no licence stated for AWS, Google, Oracle, Cloudflare and DigitalOcean; Microsoft's site terms for Azure.
  - The VPN ASN row: X4BNet `input/*/ASN.txt` and bad-asn-list, MIT, pinned by commit.
  - New rows: Natural Earth (public domain), MaxMind GeoLite (❌, EULA), IPinfo Lite (❌, BY-SA), IP2Location LITE (❌, licence), OSM (❌, ODbL).
- **CLAUDE.md rule 4, "downloads go through `scripts/fetch-*` with pinned SHA-256 hashes"** [R2]. DB-IP keeps only two months online [D8], and the Tor and cloud lists change hourly to weekly. As in Phase 6, these need an operator-run, verified, never-committed sync [R8]. Phase 6's planned ADR 0005 (C87; not yet in `docs/adr/` on 2026-10-27) covers "live public-sector data" [R8], but **DB-IP is commercial CC BY data, not public-sector data**, so the ADR's scope must be widened, or a Phase 7 ADR written (owner item 1).
- **`scripts/fetch_data.py` `PERMISSIVE_LICENSES`** [R7] lists SPDX ids only. Natural Earth's public-domain statement has no SPDX id (a `LicenseRef-` entry would be needed), and iptoasn's `PDDL-1.0` is absent (owner items 4 and 5).

## 1. IP geolocation

### 1.1 DB-IP Lite (country, city, ASN): ✅ CC BY 4.0, with a link-back duty

- **Publisher.** DB-IP, operated by Eris Networks S.A.S (France) [D1][D5].
- **Licence (verified).** Each Lite page and the Lite index say the free databases are under CC BY 4.0 and link `creativecommons.org/licenses/by/4.0/` [D1][D2][D3][D4]. The terms of service exclude the free downloads from the paid-licence clauses (no redistribution, single licensee) and say they stay under CC BY 4.0 [D5]. The FAQ states that commercial use and redistribution of the free downloads are allowed if the licence terms are met [D6]. **✅.**
- **Attribution duties.** Credit DB-IP.com for the data. A web application must also show a link back to `https://db-ip.com` on the pages that display or use results from the database; the publisher gives an HTML snippet whose link text reads "IP Geolocation by DB-IP" (quoted because the wording is the duty) [D1]. For OpenVerify, that means the dashboard pages that show an IP location or a distance derived from it, the docs, and the provenance of each signal (inference).
- **Upstream data.** Part of DB-IP's data comes from GeoNames, which DB-IP credits as CC BY [D5]. The MMDB records carry `geoname_id` values [M-D1]. No extra duty is stated beyond DB-IP's own (inference: crediting DB-IP covers it, and the GeoNames credit can sit beside it in `THIRD_PARTY_LICENSES.md`).
- **The publisher's code is LGPL.** DB-IP's own PHP import code is under LGPL [D5][D7]. OpenVerify must not use it; any MMDB reader under §8 will do.

**Files (all `https://download.db-ip.com/free/`, probed 2026-10-27; every one answered 200 `application/octet-stream` with `Last-Modified: Thu, 01 Oct 2026 06:29 GMT`, served through Cloudflare with `cache-control: max-age=28800`)** [D8]:

| Database | File | Bytes (gzip) | Records | Uncompressed (page) | Fields |
|---|---|---|---|---|---|
| Country Lite | `dbip-country-lite-2026-10.mmdb.gz` | 4,123,384 | 710,834 | 8.0 MB (measured 8,348,509 B) | `continent.code`, `continent.geoname_id`, `continent.names`, `country.iso_code`, `country.geoname_id`, `country.is_in_european_union`, `country.names` (10 languages) |
| Country Lite | `dbip-country-lite-2026-10.csv.gz` | 4,491,785 | 710,834 | 29.8 MB | address range plus country fields; the per-format column list was not read |
| City Lite | `dbip-city-lite-2026-10.mmdb.gz` | 60,193,321 | 7,786,864 | 121.1 MB | as Country, plus `city.names`, `subdivisions.names`, `location.latitude`, `location.longitude` [D9] |
| City Lite | `dbip-city-lite-2026-10.csv.gz` | 85,827,400 | 7,786,864 | 660.7 MB | `ip_start`, `ip_end`, `continent`, `country`, `stateprov`, `city`, `latitude`, `longitude` (RFC 4180, UTF-8) [D10] |
| ASN Lite | `dbip-asn-lite-2026-10.mmdb.gz` | 5,186,202 | 477,362 | 9.1 MB (measured 9,566,363 B) | `autonomous_system_number`, `autonomous_system_organization` |
| ASN Lite | `dbip-asn-lite-2026-10.csv.gz` | 7,015,072 | 477,362 | 29.0 MB | `ip_start`, `ip_end`, AS number, AS organisation |

**What the MMDB files say about themselves (measured on the Country and ASN files)** [M-D1]:
- MaxMind DB binary format 2.0, `ip_version` 6, `record_size` 24 (inference from the MMDB format: IPv4 lookups go through the IPv6 tree).
- `database_type` is `DBIP-Country-Lite` and `DBIP-ASN-Lite (compat=GeoLite2-ASN)`. The ASN file declares compatibility with the GeoLite2-ASN schema, and DB-IP says it keeps its MMDB schema as close as possible to what existing readers expect [D9]. A reader written for one fits the other (inference).
- `build_epoch` 1790818572 and 1790818896, which is 2026-10-01 01:36 and 01:41 UTC. The `description` holds only the product name; **the file carries no licence field**, so the attribution must come from our own manifest (inference).
- No accuracy radius, no postal code, no time zone and no `registered_country` in the Lite records [M-D1][D9]. The City Lite coordinates are approximate [D1], one point per city record, not a measured position (inference).

**Cadence and change signal.**
- Monthly, usually on the 1st [D6]. The October 2026 files were stamped 2026-10-01 [D8].
- Each release is a full replacement; no diff is offered [D6].
- The file name embeds the month. The cheapest check is a `HEAD` on the next month's name: a 404 means no new release (measured: `2026-11` answered 404) [D8]. `ETag` and `Last-Modified` change with each file.

**Retention, which decides how the operator gets it.** Only the current and the previous month answer. `2026-09` answered 200 (`Last-Modified` 2026-09-01); `2026-08`, `2026-06`, `2026-03`, `2026-01`, `2025-12` and `2025-10` all answered 404 [D8]. A URL pinned in `data/manifest.json` would therefore stop working after one to two months, and `scripts/fetch_data.py` would fail for every new install from then on (inference from [R7]). DB-IP therefore fits the C76 pattern of an operator-run sync better than a committed pin (§9).

**Integrity.**
- Each download page shows an MD5 and a SHA-1 [D1][D2][D3]. **Both are digests of the decompressed file, not of the `.gz`**: the measured MD5 and SHA-1 of the decompressed Country MMDB equal the page's values (`b8647f71…569e`, `e515b630…5b0e`), and so do the ASN MMDB's (`918a033b…e173`, `bc76615c…769a`). The digests of the `.gz` files differ [M-D1].
- No SHA-256 and no signature are published. Both published digests come from the same HTTPS page as the file, so they guard against corruption, not against a compromised publisher (inference).
- A sync can scrape the page's digests and compare them after decompression, then record its own SHA-256 (inference).

**Access.** No account, no token, no documented rate limit. `db-ip.com/robots.txt` disallows only `/admin/`; `download.db-ip.com/robots.txt` answers 404 [D8]. The page shows a licence-acceptance control before the download links [D1]; an operator-run sync should make the operator accept the CC BY terms once in configuration (inference).

**Accuracy (honesty).** The Lite editions are subsets of the paid ones with reduced coverage and accuracy, and they skip the paid editions' QA [D1][D6]. DB-IP rates its own accuracy at 77 for City Lite against 96 for the paid edition, on an internal index it does not define further [D1]. Accuracy is worse on mobile networks [D6]. A country answer is usable as a signal; a city answer is a coarse hint (inference).

### 1.2 IPinfo free databases (IPinfo Lite): ❌ CC BY-SA 4.0, token required

- **Products.** IPinfo Lite gives country, continent and ASN fields (`asn`, `as_name`, `as_domain`, `country_code`, `country`, `continent_code`, `continent`) for IPv4 and IPv6, refreshed daily, as an API or a download [I1]. The older "IP to Country + ASN" download is described as legacy and closed to new users [I2].
- **Licence (verified).** The Lite page and the database page say Lite data is under **CC BY-SA 4.0** and link the BY-SA deed [I1][I3]. Share-alike data licences are excluded at runtime under this survey's rules, so **❌** as a built-in source. IPinfo's own reading is that commercial use is allowed with a credit link [I1]; the exclusion is our policy, not their restriction.
- **Access.** Every download URL needs the operator's account token as a `token` query parameter: `https://ipinfo.io/data/ipinfo_lite.{mmdb,csv.gz,json.gz,parquet}?token=…` [I3]. Without one, `https://ipinfo.io/data/ipinfo_lite.mmdb` answered **401** (`text/plain`, 12 B), and so did the legacy `data/free/country_asn.mmdb` [I4]. Their robots file disallows every URL containing `?token`, so no tokenised URL was probed [I4].
- **Size and cadence.** On 2026-10-27 the page listed "Last Updated: Oct 26, 2026", 4,275,771 lines, and sizes from 24.55 to 29.1 MB per format [I3]. Samples are offered at `https://ipinfo.io/data/sample/ipinfo_lite.{csv,json,mmdb}` [I3].
- **Verdict.** Not built in. An operator who accepts the share-alike terms could load the file as their own data through a generic MMDB provider, which is an owner decision ("Needs the owner" 2).

### 1.3 IP2Location LITE (and IP2Proxy LITE, ASN LITE): ❌ custom licence, no redistribution, account required

- **Publisher.** Hexasoft Development Sdn. Bhd. (IP2Location) [P2]. LITE downloads moved from `lite.ip2location.com` to `www.ip2location.com`, behind one free sign-up [P1][P4].
- **Licence (verified).** The LITE data licence page grants use only on its own conditions: agree to the site's terms of use, credit IP2Location with a fixed acknowledgement line, and no redistribution or resale. The decisive wording is "not permitted to redistribute or resell this product" (quoted because it decides) [P3]. The terms of use it incorporates are a master licence agreement whose standard and site licences allow internal business use only and forbid compilations, derivative works and use in products offered to the licensee's end users [P2]. It is not one of the rule-4 licences; it is a proprietary licence. **❌.** The marketing pages still call LITE free for personal or commercial use with attribution [P1][P5], which does not change the licence text.
- **Access and cadence.** An account and a download token: `https://www.ip2location.com/download?token={DOWNLOAD_TOKEN}&file={DATABASE_CODE}`, answered by a redirect to an R2 pre-signed URL since May 2025 [P4]. The LITE page is inconsistent about cadence: its feature list says monthly releases, and its comparison table gives LITE a semi-monthly update [P4]. The downloader page says the geolocation databases update on the first day of each month and the IP2Proxy databases daily, and asks clients to download on a random day of the first week [P4]. The ASN LITE page lists sizes of 158.74 MB (BIN) and 108.67 MB (CSV, 1,459,129 rows) for one edition and 266.58 MB and 112.14 MB (906,239 rows) for the other [P5].
- **IP2Proxy LITE** lists open proxies (`PUB`) only, refreshed every two weeks. VPN, Tor, data-centre, residential and other proxy types are in the commercial edition only [P6]. It is relevant to §5, and it fails on the same licence.

### 1.4 MaxMind GeoLite (GeoLite2): ❌ proprietary EULA layered over CC BY-SA 4.0

- **Agreement (verified, "Updated on: February 12, 2026").** The GeoLite End User License Agreement [M1]:
  - incorporates CC BY-SA 4.0 for the copyrightable elements, plus MaxMind's data-processing addendum, privacy policy and website terms; the EULA prevails;
  - requires attribution (its example line names GeoLite Data and links maxmind.com);
  - grants a separate internal-business-use licence;
  - **forbids use as a factor in credit, insurance, employment or government-benefit eligibility, or for any FCRA permissible purpose**;
  - forbids using the data to identify or locate a specific household, individual or street address;
  - forbids disclosing the data to third parties without MaxMind's written consent, except as CC BY-SA allows;
  - imposes security duties and incident notification;
  - requires destroying old versions **within 30 days** of a new release, and everything when the licence ends.
- **Access.** A MaxMind account and a licence key; at most 30 database downloads per day [M2].
- **Verdict.** A proprietary EULA plus a share-alike licence: **❌** under rule 4, as PLAN and CLAUDE.md already say. Two clauses would also bind an identity-verification product directly: the FCRA-purpose ban and the government-benefit-eligibility ban (inference: some operators verify identity for exactly those decisions).
- **Cadence.** **Not documented** on the pages read.
- **A trap for later contributors.** DB-IP's ASN Lite file says it is `compat=GeoLite2-ASN` [M-D1], and many libraries and Docker images ship GeoLite2 downloaders. A schema-compatible reader is fine; a GeoLite2 download step, or a test fixture copied from a GeoLite2 file, is not (inference).

### 1.5 RIR delegated statistics (country of registration): ⚠️ by RIR

**What they are.** Each RIR publishes a daily "extended" file in the RIR statistics exchange format [G1][G6]. It has:
- a version line: `2|ripencc|<serial>|<records>|<startdate>|<enddate>|<UTC offset>`;
- `summary` lines per type;
- records of the form `registry|cc|type|start|value|date|status|opaque-id`, where `type` is `asn`, `ipv4` or `ipv6`; `value` is a host count for IPv4 (not necessarily a CIDR block) and a prefix length for IPv6; and `status` is one of `available`, `allocated`, `assigned` or `reserved` [M-G1][G1].

**The country is where the holder registered, not where the address is used.** APNIC and AFRINIC both say the reports show where resources were first allocated or assigned, and must not be read as an authoritative statement of where a resource is in use today [G1][G2]. This is a country-of-registration signal only (inference: a multinational's or a cloud provider's block shows the holder's home country).

| RIR | URL (probed 2026-10-27) | Status / type / bytes | Last-Modified | Integrity companions | Terms found |
|---|---|---|---|---|---|
| ARIN | `https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest` | 200 `application/octet-stream`, 12,882,531 | 27 Oct 2026 13:00 GMT | `.md5` 200 (67 B); `.asc` 404 | None for the files. The statistics page calls the file a daily report, shows only a site copyright line, and links WHOIS terms that it does not apply to the files [G3] |
| RIPE NCC | `https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest` | 200, 18,112,083 | 26 Oct 2026 23:12 GMT | `.md5` 200 (74 B); `.asc` 404 | The RIPE NCC copyright statement covers materials on any page whose domain includes `ripe.net`. Without prior written authorisation it allows use only for private, public non-commercial, research, educational or demonstration purposes, unmodified and identified as RIPE NCC material [G4] |
| APNIC | `https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest` | 200, 9,285,959 | 27 Oct 2026 15:15 GMT | `.md5` 200 (`MD5 (…) = <hex>`); `.asc` 200 (OpenPGP detached signature, 195 B) | The files are "freely available for download and use" (quoted because it decides), on condition that APNIC bears no liability [G1] |
| LACNIC | `https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest` | 200 (no content type), 4,579,088 | 27 Oct 2026 02:56 GMT | `.md5` 200; `.asc` 404 | None in the README or the format document [G5][G6] |
| AFRINIC | `https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest` | 200 (no content type), 1,007,525 | 27 Oct 2026 00:07 GMT | `.md5` 200; `.asc` 200 (195 B) | The same free-use condition as APNIC's [G2] |
| NRO combined (published by the RIPE NCC since 2020) | `https://ftp.ripe.net/pub/stats/ripencc/nro-stats/latest/nro-delegated-stats` | 200, 57,048,456 | 27 Oct 2026 12:05 GMT | `.md5` 200 (54 B) | Hosted on `ripe.net`, so the RIPE question applies (inference) [G7] |

[G8] (probes)

**Robots.** `ftp.arin.net`, `ftp.apnic.net` and `ftp.lacnic.net` have no robots file (404). `ftp.ripe.net` disallows only two documents and the Atlas measurements path; `ftp.afrinic.net` disallows `/rfc`, `/db` and `/OVA` [G8].

**Verdicts.**
- APNIC and AFRINIC: **⚠️**. There is an explicit permission to download and use, but no named licence; the grant covers use, not redistribution (inference).
- ARIN and LACNIC: **⚠️, terms not documented.** Allocation facts are probably not protected by copyright in the US (inference), but no statement was found.
- RIPE NCC (and the NRO file it hosts): **⚠️, leaning ❌**. If the site-wide copyright statement covers `ftp.ripe.net`, as its domain wording suggests, then commercial use needs written authorisation [G4]. The statement does not mention statistics, and RIS raw data falls under separate, explicitly non-commercial raw-data terms [G9].

**Recommendation (inference).** DB-IP Country Lite (✅) already gives a country per address with a clear licence. RIR statistics are not needed for country lookup. If they are ever used, as a "country of registration" cross-check or for the ASN registration country, use APNIC and AFRINIC freely, and use RIPE NCC, ARIN and LACNIC only after the owner decides ("Needs the owner" 3). The APNIC `.asc` signature is the only signed source in this section, but the signing key's distribution was not checked (**not documented** here).

## 2. IP to ASN and organisation

The ISP/ASN signal and every "is this a hosting network?" rule (§4, §5) need an address → AS number → organisation map. Sources, best first:

### 2.1 DB-IP ASN Lite: ✅ (the recommended default)

See §1.1. It is monthly, CC BY 4.0, 477,362 ranges, with `autonomous_system_number` and `autonomous_system_organization`, and a GeoLite2-ASN-compatible MMDB (5.2 MB gzip, 9.6 MB) [D3][M-D1]. The same attribution line covers it. It gives no network type (hosting, ISP, mobile): any "datacenter" judgement must come from §4's lists and our own AS tables (inference).

### 2.2 iptoasn.com: ⚠️ PDDL 1.0, but its robots file asks bots not to fetch the files

- **Publisher.** Maintained by one individual; the public API was shut down at the end of 2020 [A1].
- **Files** (TSV, gzip). They are `ip2asn-v4.tsv.gz`, `ip2asn-v4-u32.tsv.gz`, `ip2asn-v6.tsv.gz` and `ip2asn-combined.tsv.gz`, with columns `range_start range_end AS_number country_code AS_description`, plus `ip2country-v4/v6` files with `range_start range_end country_code`. The page says it is updated hourly [A1].
- **Licence.** The page says "Public Domain (PDDL v1.0)" and links the Open Data Commons PDDL 1.0 [A1]. PDDL is a public-domain dedication comparable to CC0, but rule 4 does not name it (**⚠️**: owner to confirm, as with 0BSD [R6]). The data's own provenance (which BGP feeds and registry files it is built from) is **not documented** on the page or in the server's README [A1][A2]. That matters because a dedication covers only what the maintainer holds (inference).
- **Robots.** `iptoasn.com/robots.txt` allows `/` but, in a second `User-agent: *` group, disallows `/data/*.gz$`, with a comment that bots should use direct links [A3]. The maintainer's own server downloads `https://iptoasn.com/data/ip2asn-combined.tsv.gz` every 60 minutes by default [A2]. **No `.gz` was requested from this session**, so size, type and validators are **not measured**.
- **Verdict.** Not a default. It could be an operator-added source if the owner accepts PDDL and the operator accepts the robots tension, which is the same question as Wikidata's in Phase 6 [R8].

### 2.3 RouteViews BGP tables (with pyasn): ⚠️ terms not verifiable; robots disallow the archive

- **Data.** RouteViews (University of Oregon) archives MRT RIB snapshots from its BGP collectors at `archive.routeviews.org` [A4]. `pyasn` converts a RIB into a prefix → origin-AS table [A5].
- **Robots.** `archive.routeviews.org/robots.txt` (dated 2025-04-02 in its comment) disallows `/` for every agent [A4]. `www.routeviews.org/robots.txt` names Anthropic's crawlers among the agents it blocks [A4]. Neither site was read beyond robots files, and one home-page request sent before the full list was read was discarded unread (see "Method").
- **Terms.** **Not verified at the source.** A secondary infobox lists CC BY 4.0 [A6], which is not enough to rely on.
- **pyasn** (the converter). MIT at tag `1.6.2` (commit `655be973`, committed 2023-09-01), and it bundles py-radix under its own permissive notice [A5]. The PyPI registry JSON was not read because PyPI's robots file disallows `/pypi/*/json`, and the project page answered a browser challenge. So the registry release date is **not documented** here. It is Python, while the network signals run in the TypeScript API, so it would be a build tool at most (inference).
- **Verdict.** Not recommended. An origin-AS table from BGP is more current than a monthly file, but nothing here is verified as safe to fetch automatically or to reuse commercially.

### 2.4 RIPE RIS raw data: ❌ non-commercial

The RIPE NCC's raw-data terms forbid access and use "for any commercial purposes" (quoted because it decides) and forbid redistribution; they allow research and network-operations support [G9]. **❌.**

### 2.5 RIR bulk WHOIS: ❌ agreement-bound, operational purposes only

| RIR | Access | Purpose limit | Verdict |
|---|---|---|---|
| ARIN | An ARIN Online account, a signed Bulk Whois agreement and a ticket stating the intended use. ARIN approves or denies. Daily `arin_db.txt`/`.xml` [A7] | Internet operational or technical research purposes. ARIN declines requests to fold the data into products or internal systems without a clear community benefit [A7] | ❌ |
| RIPE NCC | Database terms (no date or version stated) [A8] | Access only for the eight Article 3 purposes, none of which is fraud screening by a commercial service. No re-packaging, downloading, compiling or redistribution except an insubstantial part or with the RIPE NCC's permission; no marketing use [A8] | ❌ |
| APNIC | A signed acceptable-use agreement [A9] | Agreed Internet operational purposes; no targeting of advertising [A9] | ❌ |
| AFRINIC | `ftp.afrinic.net/robots.txt` disallows `/db`, which prefixes the database directory [G8] | not read | ❌ (not probed) |
| LACNIC | **not researched** | - | - |

Organisation names per AS are in DB-IP ASN Lite already (§2.1), so none of these is needed.

### 2.6 PeeringDB: ❌ AUP

PeeringDB's acceptable use policy forbids reproducing or storing any part of the data except for Internet operational purposes PeeringDB approves. It allows full downloads only for "Internet operational issues", defined as troubleshooting, abuse reporting and Internet research, and expressly not marketing, demographic mapping or other commercial purposes. Bulk passing-on needs approval [A10]. Its network-type field would help classify hosting networks (inference), but the policy rules it out. **❌.**

### 2.7 CAIDA datasets (AS organisations, AS classification, prefix-to-AS): ❌ built in

The public-dataset agreement (page "Last Modified August 11, 2022") grants a limited, non-exclusive, non-transferable, non-assignable and terminable licence to copy, modify and use the data. It also requires a fixed citation and a report to CAIDA of any publication that uses the data [A11]. It is a custom licence that each user accepts for themselves and that CAIDA can end at will, not a rule-4 licence. **❌** as a built-in source; an operator could accept it for their own install (inference).

## 3. Tor exit relays

### 3.1 Endpoints (probed 2026-10-27)

| Endpoint | What | Status / headers | Robots |
|---|---|---|---|
| `https://check.torproject.org/torbulkexitlist` | One exit address per line | 200, 17,361 B, **no `Content-Type`**, `ETag`, `Last-Modified` 16:47:46 GMT | `check.torproject.org` allows everything [T1] |
| `https://check.torproject.org/exit-addresses` | TorDNSEL format: `ExitNode <fingerprint>`, `Published`, `LastStatus`, then one or more `ExitAddress <address> <time>` | 200, 433,699 B, same `Last-Modified` | as above [T1] |
| `https://collector.torproject.org/recent/exit-lists/` | Archived TorDNSEL lists, one file per hour | 200 HTML index: 91 files covering about three days, about 424 KB each, named for about :12 past each hour and modified at :37 | no robots file (404) [T2] |
| `https://onionoo.torproject.org/details?flag=Exit` | JSON relay documents (`exit_addresses`, `or_addresses`, `flags`, `last_seen`, `exit_policy_summary`, `relays_published`) | **not requested** | robots disallows `/summary`, `/details`, `/bandwidth`, `/weights`, `/clients` and `/uptime` for every agent [T3] |

**Measured (bulk list, 2026-10-27 16:47 GMT)** [M-T1]: 1,226 lines, all distinct and all valid **IPv4**. There is **no IPv6 address** in the bulk list. SHA-256 `7b164f97…c5f8`. No address is reproduced in this note.

### 3.2 Format, cadence, change signal

- **TorDNSEL.** It records the address a relay was actually seen exiting from, which can differ from the address it advertises. Each entry carries the relay fingerprint, its descriptor's publication time, the last consensus that listed it, and each observed exit address with its observation time [T2][M-T1].
- **Cadence: hourly.** CollecTor writes one exit-list file per hour [T2]. On check.torproject.org, every `LastStatus` read was the 16:00:00 consensus and the files were stamped 16:47 [M-T1].
- **Change signal.** `ETag` or `Last-Modified` on the two check.torproject.org files. Onionoo asks clients to send `If-Modified-Since` and answers `304` [T3], but its robots file forbids those endpoints to automated agents.

### 3.3 Terms

- Tor Metrics publishes its data under a **CC0** declaration; only the graphs are CC BY 3.0 US. The decisive wording is "freely available under a CC0 no copyright declaration" (quoted because it decides) [T2].
- TorDNSEL exit lists are one of the CollecTor data types that statement covers [T2].
- check.torproject.org states no terms of its own (**not documented**). Its files carry the same TorDNSEL data (inference).
- **✅** for CollecTor; **✅ (inference)** for check.torproject.org.
- Exit addresses belong to relay operators who publish them to the Tor network. They identify infrastructure, not the end user (inference); see §7.

### 3.4 What a Tor signal can and cannot say (honesty)

- **R-tier as an exact match**, with provenance (list time, SHA-256). An address is on the list or it is not.
- **It cannot see:**
  - bridges and pluggable transports, which hide entry points; they do not matter for traffic that reaches us, which leaves through an exit (inference);
  - exits that use IPv6, since the bulk list has none: use `exit-addresses`, which carries whatever TorDNSEL observed, or treat IPv6 as unknown (inference);
  - relays that joined after the last fetch;
  - a person using Tor through a VPN chain or a proxy in front of Tor.
- **Staleness.** An address can stay listed for a while after its relay has gone. The TorDNSEL timestamps let a match be limited to addresses seen in the last N hours (inference: default 24 h).
- **Recommendation.** Sync `exit-addresses` hourly as an operator-run job (C76 pattern) and keep only addresses observed in the window. Fall back to `torbulkexitlist`. Never call Onionoo by default.

## 4. Cloud and datacenter ranges

Two kinds of source feed `is_datacenter`: (a) ranges each provider publishes for its own network, which are exact for that provider; (b) curated lists of hosting ASNs, expanded to prefixes through §2.1's ASN data.

### 4.1 Provider-published ranges (probed and measured 2026-10-27)

| Provider | URL | Status / type / bytes | Structure (measured) | Change signal | Integrity |
|---|---|---|---|---|---|
| **AWS** | `https://ip-ranges.amazonaws.com/ip-ranges.json` | 200 `application/json`, 2,736,131 (S3) | `syncToken` (publication time, Unix epoch), `createDate` (`YYYY-MM-DD-hh-mm-ss` UTC), `prefixes[]` {`ip_prefix`, `region`, `network_border_group`, `service`}: 10,686; `ipv6_prefixes[]` {`ipv6_prefix`, …}: 7,005. 27 distinct IPv4 `service` values; `AMAZON` (6,072) contains every other subset [C2]. 43 distinct `region` values, `GLOBAL` among them [C1][C2][M-C1] | `syncToken`; SNS topic `arn:aws:sns:us-east-1:806199016981:AmazonIpSpaceChanged`, whose message carries `create-time`, `synctoken`, `md5`, `url`. Notifications may arrive out of order [C3] | The S3 `ETag` equals the file's MD5 (measured: `c0fa4dc0…ad58`), and the SNS message carries the same MD5 [C3][M-C1]. AWS tells programmatic clients to verify TLS [C1]. A sibling RFC 8805 geofeed `geo-ip-feed.csv` covers Local Zones [C1] |
| **Google Cloud** | `https://www.gstatic.com/ipranges/cloud.json` | 200 `application/json`, 116,078 | `syncToken`, `creationTime`, `prefixes[]` {`ipv4Prefix` or `ipv6Prefix`, `service` (`Google Cloud`), `scope` (48 distinct values, `global` among them)}: 1,040 IPv4 and 95 IPv6 [M-C2] | `syncToken`, `creationTime`, `Last-Modified` | none |
| **Google (all)** | `https://www.gstatic.com/ipranges/goog.json` | 200 `application/json`, 6,315 | 132 IPv4 and 16 IPv6 prefixes, with no service field [M-C2] | as above | none. This is Google's whole address space, customer cloud ranges included. The FAQ documents only `cloud.json` [C4] and no subtraction rule. `goog.json` is not a datacenter list (inference) |
| **Microsoft Azure** | Download Center item 56519 [C5], whose file name changes weekly: `https://download.microsoft.com/download/7/1/d/71d86715-5596-4529-9b13-da13a5de5b63/ServiceTags_Public_20261019.json` | 200 `application/octet-stream`, 4,870,615, `content-disposition: attachment`; page `version` 2026.10.19, `datePublished` 10/20/2026 | Root `changeNumber` (423), `cloud` (`Public`), `values[]` {`name`, `id`, `properties` {`changeNumber`, `region`, `regionId`, `platform`, `systemService`, `addressPrefixes[]`, …}} (first 3 KB read) [M-C3] | The details page embeds the current file name and `version`. It says the file is updated weekly and that new ranges are not used for at least a week [C5] | none published. `ETag` is a hash-like token whose algorithm is **not documented** |
| **Oracle Cloud** | `https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json` | 200 `application/json`, 234,112, `Last-Modified` 25 Aug 2026 | `last_updated_timestamp` (2026-08-25T08:06:24), `regions[]` {`region`, `cidrs[]` {`cidr`, `tags`}, `ipv6_cidrs[]`}: 56 regions, 1,107 IPv4 CIDRs, tags `OCI` 560, `OSN` 547, `OBJECT_STORAGE` 68 [M-C4] | `last_updated_timestamp`, `ETag` | none |
| **Cloudflare** | `https://www.cloudflare.com/ips-v4`, `/ips-v6`; API `https://api.cloudflare.com/client/v4/ips` | 200 `text/plain` (no length); API 200 JSON, 505 B (`HEAD` answers 405) | 15 IPv4 and 7 IPv6 prefixes; the API returns `result.ipv4_cidrs`, `result.ipv6_cidrs`, `result.etag` [M-C5] | the API's `etag` | none. These are Cloudflare's proxy edge. Traffic from them means a proxied path, not a Cloudflare-hosted client. Whether WARP egress falls inside them is **not documented** |
| **DigitalOcean** | `https://www.digitalocean.com/geo/google.csv` (the apex redirects here) | 200 `application/csv`, 53,163; two consecutive requests showed different `Last-Modified` values (CDN) | RFC 8805 geofeed (`prefix,country,region,city,postal`): 1,235 rows, 1,087 IPv4 and 148 IPv6, 8 countries [M-C6] | content hash (headers unstable) | none |
| **Akamai (Linode)** | `https://geoip.linode.com/` | 200 `text/plain`, 192,744, `ETag` | RFC 8805 geofeed with a header comment naming RFC 8805 and a "Last modified" stamp (2026-10-27 10:00:05): 5,505 rows, 5,409 IPv4 and 96 IPv6, 22 countries [M-C6] | the header stamp, `ETag` | none |
| **Hetzner** | **No official range file or geofeed was found** [C6] | - | Hetzner's networks are identifiable only through their ASNs (§2.1 plus §4.2) | - | - |
| **Apple iCloud Private Relay** (a privacy relay, not a datacenter) | `https://mask-api.icloud.com/egress-ip-ranges.csv` | 200 `text/plain`, 12,048,635, `ETag`, `max-age=3600` | geofeed-like CSV, 5 columns (`prefix,country,region,city,`) [M-C7] | `ETag` | none. Apple presents it for geolocation and for recognising Private Relay traffic. It suggests treating relay addresses like carrier-grade NAT, and it describes blocking only as a common generic mitigation, not as advice [C7] |

**Robots.**
- `ip-ranges.amazonaws.com/robots.txt` answers 403 (an S3 `AccessDenied`), which RFC 9309 treats as "unavailable", so access is allowed [C8].
- `www.gstatic.com/robots.txt` ends with `Disallow: /`, but its `Allow: /*.js` line prefix-matches `/ipranges/cloud.json` and wins on length under RFC 9309. The files are literally allowed, and Google's own FAQ directs clients to them [C4][C8].
- `download.microsoft.com/robots.txt` redirects to an HTML page (no rules).
- `docs.oracle.com`, `www.cloudflare.com`, `www.digitalocean.com` and `developer.apple.com` allow these paths.
- `api.cloudflare.com` has no robots file. `geoip.linode.com` and `mask-api.icloud.com` answer HTML or 400 for robots (no rules) [C8].

**Terms (the common finding).** None of these files carries a licence, and none of the pages read states reuse terms for the data:
- **AWS:** no terms on the range pages [C1][C2][C3].
- **Google:** the FAQ page's CC BY 4.0 covers the documentation text, not the JSON [C4].
- **Apple:** no terms on the page [C7].
- **Microsoft:** the Download Center falls under the website terms of use. "Unless otherwise specified", they limit the services, download areas included, to personal and non-commercial use [C9]. The details page itself tells users to download the file weekly and update their sites to identify Azure services [C5]. That arguably "specifies otherwise" for that use (inference), but it is not an explicit licence.
- **Oracle, Cloudflare, DigitalOcean, Akamai:** their terms were **not checked**.

**Verdict.**
- **⚠️** for every provider list: they are factual statements of a provider's own prefixes, published for programmatic consumption (firewalls, geolocation), with no licence.
- **⚠️ leaning ❌ for Azure** until the owner accepts the Microsoft wording.
- How to consume them (inference): never commit or redistribute them, fetch them only through an operator-run sync, keep each provider individually switchable, and store provenance (URL, SHA-256, publication stamp).

### 4.2 Community hosting/VPN ASN lists

| List | Licence (verified) | Provenance and freshness | Verdict |
|---|---|---|---|
| **X4BNet `lists_vpn`** (`github.com/X4BNet/lists_vpn`, head `f2a466fa`, 2026-10-27) | The README declares MIT for "the scripts, automation, and the list itself"; there is no LICENSE file, so GitHub detects none [N1][N2] | Curated ASN lists: `input/datacenter/ASN.txt` (948 lines holding 934 distinct ASNs (corrected in fact-check), 35,075 B) and `input/vpn/ASN.txt` (16 ASNs). The build expands them into prefixes **from `iptoasn.com`'s `ip2asn-v4.tsv.gz`** (§2.2). It adds provider-published VPN egress lists (Apple Private Relay, Mullvad, PIA) and manual entries, and rebuilds automatically [N2][N3]. Outputs: `output/datacenter/ipv4.txt` (697,923 B), `output/vpn/ipv4.txt` (179,678 B), plus IPv6 | ✅ **for the two curated ASN files**, pinned by commit, with the README's licence text kept. ⚠️ for the generated prefix outputs, whose prefixes inherit iptoasn's PDDL (§2.2) and the VPN providers' own terms (not checked) |
| **brianhama `bad-asn-list`** (head `b825d2e0`, 2026-04-12) | MIT (GitHub-detected LICENSE) [N4] | A hand-curated CSV (`ASN,Entity`), 742 rows holding 723 distinct ASNs (corrected in fact-check), of cloud, managed hosting and colocation networks [N4][M-N1]. Its README suggests GeoLite2 for the lookup, which we would replace with §2.1 | ✅ pinned by commit, as a second seed |
| `client9/ipcat` | MIT [N5] | Archived on GitHub (last push 2023-02-02) | ❌ stale |
| `jhassine/server-ip-addresses` | **No licence** detected [N5] | Daily-updated datacenter CIDRs | ❌ (no licence means no grant) |

**How the datacenter signal should be built (inference).**
1. Take the pinned ASN seeds (X4BNet datacenter and VPN ASN files, bad-asn-list), plus a committed OpenVerify table for gaps (for example Hetzner's ASNs, recorded with their RIR registration as evidence).
2. Resolve them to prefixes with **DB-IP ASN Lite** (✅), never with iptoasn or GeoLite2.
3. Overlay the provider-published ranges (§4.1) as exact, provider-labelled matches.
4. Report `is_datacenter` with a reason (`provider_range:<provider>` or `hosting_asn:<asn>`), the list snapshot and the ASN data's month.

The provider-range match is R-tier (exact). The ASN-level judgement is H-tier: ASNs mix hosting with other traffic, and a curated list both misses networks and includes some that carry ordinary users (§5).

## 5. VPN and proxy detection

### 5.1 What public, permissively licensed data can support

| Signal | Built from | Tier | What it catches | What it misses (honesty) |
|---|---|---|---|---|
| `is_tor` | §3 TorDNSEL exit list (CC0) | R (exact) | Traffic leaving Tor through a listed exit | IPv6 exits (absent from the bulk list), exits that joined since the last sync, Tor behind a VPN |
| `is_datacenter` | §4.1 provider ranges (exact) plus §4.2 hosting ASNs resolved by DB-IP ASN Lite | R for provider ranges; H for ASN membership | Self-hosted VPNs, proxies and bots on the big clouds and on listed hosting networks | Small hosts missing from the seeds; hosting ASNs that also carry office or residential customers (false positives); BYOIP blocks, which AWS says are not in its file [C1] |
| `is_vpn` | X4BNet's VPN ASN list (16 ASNs), plus provider-published egress lists if the owner accepts their unstated terms, plus a committed OpenVerify table of VPN-operator ASNs with evidence | **H, beta** | Commercial VPN operators that run their own ASNs | **Most VPN exits.** Most VPN providers rent servers on general hosting networks, so their exits are indistinguishable from other hosting traffic by ASN alone. That is why the datacenter signal does most of the work (inference). An ASN-based VPN flag is a weak lower bound |
| `is_relay` (ours: privacy relay) | Apple's Private Relay egress file (⚠️ terms) | R (exact) if adopted | iCloud Private Relay | Other relays. Apple suggests treating relay traffic like carrier-grade NAT, not as a fraud signal [C7], so this should not raise the threat level on its own (inference) |
| `is_proxy` | **No permissive source.** Public open-proxy lists are scraped aggregations without a licence: FireHOL's ipsets repository has no licence and aggregates third-party feeds [N6]; IP2Proxy LITE is a proprietary licence (§1.3) | - | - | Everything; ship `is_proxy` as `null` (not evaluated) unless an adapter is bound |
| **Residential proxies** | **Nothing public.** Residential proxy networks route through real consumer connections (often unwitting devices), so their addresses look like ordinary ISP customers in every free source | - | - | **All of them.** Only commercial feeds that observe proxy-network behaviour claim to detect them, and their accuracy is not independently documented (§5.2) |
| Mobile carrier-grade NAT | ASN or ISP names (DB-IP ASN Lite) | H | Marks shared addresses, so IP reuse across accounts on mobile networks is explained rather than flagged (inference) | Carrier ASNs that also serve fixed lines |

**Consequence for the checks (ADR 0002):**
- `is_tor` and the provider-range part of `is_datacenter` are **R-tier** facts about the address, with list provenance.
- `is_vpn`, the ASN part of `is_datacenter`, and anything derived from them (`threat_level`) are **H-tier, `stage: beta`**, with a confidence and reason codes.
- `is_proxy`, and any residential-proxy claim, are **A-tier**: an adapter plus a deterministic sandbox provider. Without an adapter they answer `null` / `not_applicable` with `provider_not_configured`, never `false`. A `false` would claim the address is clean, which no free source can support (rule 5; ADR 0002 rule 3a, 3e).

### 5.2 Commercial feeds, as A-tier adapters only

| Vendor | Product (public field names) | Access | Note |
|---|---|---|---|
| MaxMind | GeoIP Anonymous IP database: `network`, `is_anonymous`, `is_anonymous_vpn`, `is_hosting_provider`, `is_public_proxy`, `is_residential_proxy` (suspected anonymising address on a residential ISP, excluding peer-to-peer proxies), `is_tor_exit_node`; flags set to 1 or blank [V1] | Paid (enterprise sales) [V1] | Not GeoLite: a separate commercial licence. Same MMDB reader as §8 |
| IPinfo | Privacy Detection database: `network`, `hosting`, `proxy`, `tor`, `relay`, `vpn`, `service`, plus a `start_ip`/`end_ip` variant [V2]. Residential proxies are a separate dataset [V2] | Token; paid status **not stated on the page read** [V2] | Download (MMDB/CSV) or API |
| IPQualityScore | Proxy Detection API: `fraud_score`, `proxy`, `vpn`, `tor`, `active_vpn`, `active_tor`, `recent_abuse`, `bot_status`, `connection_type`, `abuse_velocity`, `ISP`, `ASN`, and others; `https://ipqualityscore.com/api/json/ip/<KEY>/<IP>` [V3] | API key in the URL path; a free allowance of lookups is advertised [V3] | **The key in the path ends up in access logs and proxies.** The adapter must redact that path segment from every log (inference). Every lookup also sends the end user's address to the vendor (§7) |
| Spur | Context API `GET https://api.spur.us/v2/context/:ip` with header `Token`; top-level `as`, `client` (`behaviors`, `concentration`, `count`, `countries`, `proxies`, `spread`, `types`), `infrastructure`, `ip`, `location`, `organization`, `risks`, `services`, `tunnels` (`anonymous`, `entries`, `operator`, `type`) [V4]; bulk "Data Feeds" for on-premises use [V5] | Token | The only one here whose public schema names residential-proxy client observations |

**Adapter shape (inference, mirroring Phase 6 C83).**
- One `ip-intelligence` provider kind. It returns a normalised result: `is_vpn`, `is_proxy`, `is_tor`, `is_relay`, `is_datacenter`, `is_residential_proxy`, each `true | false | null`, plus `provider`, `fetched_at` and the vendor's raw risk score.
- **Downloaded-file vendors** (MaxMind Anonymous IP, IPinfo, Spur feeds) answer locally, so no end-user address leaves the install. The operator brings the file and the licence.
- **API vendors** (IPQualityScore, Spur Context) are opt-in, with a disclosure acknowledgement, like Phase 6's GDELT decision [R8].
- **The sandbox provider** answers by documentation-range magic values, for example (inference):

  | Address | Answer |
  |---|---|
  | `192.0.2.10` | clean residential |
  | `192.0.2.20` | VPN |
  | `192.0.2.30` | public proxy |
  | `192.0.2.40` | residential proxy |
  | `192.0.2.50` | Tor |
  | `198.51.100.0/24` | datacenter |
  | `2001:db8::/32` | the IPv6 equivalents |

  The sandbox never binds in production (ADR 0002 rule 3d).

### 5.3 Threat level (ours, H-tier)

A `threat_level` (`low`, `medium`, `high`) can only be a documented combination of the facts above:
- Tor;
- datacenter by provider or ASN;
- the VPN ASN flag;
- the adapter's flags, if bound;
- distance mismatches from §6;
- the client signals covered by the sibling note.

Ship it as `stage: beta` with its inputs, weights and a confidence. It is never a pass (inference). With no adapter bound, the docs must say it cannot see residential proxies or most VPNs.

## 6. GPS, distances and reverse geocoding

### 6.1 The browser Geolocation API: consent and accuracy

The W3C Geolocation API is a Candidate Recommendation Snapshot of 26 March 2026. It had been a Recommendation on 1 September 2022 and returned to CR so that features could keep being added [S1].

**Consent.**
- Location is a powerful feature that needs the user's express permission before any data is shared. The `geolocation` permission check enforces this normatively [S1].
- A request from a non-secure context fails with `PERMISSION_DENIED`, and a request from a hidden document waits until the document is visible [S1].
- **Iframes.** The Permissions Policy default allowlist is `'self'`. A third-party iframe needs `allow="geolocation"`, and a first party can disable the API with `Permissions-Policy: geolocation=()` [S1].
- **Consequence for OpenVerify (inference).** The embedded flow (an iframe on the customer's site) gets a position only if the customer's embed markup grants `allow="geolocation"`. The SDK must document that, and the flow's own `Permissions-Policy` header must not turn it off. The flow's CSP and headers are covered in the client-signals note.

**What the API returns.**
- `coords.latitude` and `coords.longitude` (WGS 84);
- `coords.accuracy`, a non-negative number of **meters at the 95% confidence level**;
- `altitude`, `altitudeAccuracy`, `heading`, `speed` (nullable);
- a `timestamp`;
- options `enableHighAccuracy`, `timeout` and `maximumAge` (a cached position may be returned);
- errors `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT` [S1].

**Not proof of location.** The specification gives "no guarantee" that the API returns the device's actual location (quoted because it decides) [S1]. The source may be GPS, Wi-Fi, cell or the IP address itself. A position is a claim by the client and can be spoofed by browser settings, extensions or automation (inference). It is H-tier evidence at best and never a pass on its own.

**Recipients' duties (the specification's privacy section)** [S1]:
- request position only when necessary;
- use it only for the stated task;
- dispose of it afterwards unless the user allows keeping it;
- protect it, and let the user update or delete it;
- do not retransmit it without the user's express permission.

**Android** (for the SDK, in brief) [S2]:
- **Approximate** (`ACCESS_COARSE_LOCATION`) is accurate to about 3 km²; **precise** (`ACCESS_FINE_LOCATION`) is usually within about 50 m.
- A user can grant approximate only, even when precise is declared.
- Background access needs `ACCESS_BACKGROUND_LOCATION` from Android 10. A verification flow needs foreground access only (inference).

### 6.2 Distances in meters: haversine is enough; record the uncertainty instead

**Measured** [M-S1] with our own script on 30,000 random, fictional point pairs. Haversine used the mean radius R₁ = (2a + b)/3 = 6,371,008.77 m, computed from the WGS 84 constants a = 6,378,137 m and f = 1/298.257223563 (constants from the WGS 84 definition, not re-read in this session). The reference was our own implementation of Vincenty's inverse formula on WGS 84:

| Distance band | Pairs | Median relative error | 99th percentile | Maximum |
|---|---|---|---|---|
| < 10 km | 10,000 | 0.184% | 0.544% | 0.561% |
| 10–1,000 km | 124 | 0.177% | 0.527% | 0.546% |
| > 1,000 km | 19,876 | 0.112% | 0.461% | 0.549% |

- **The Vincenty implementation reproduces a published test line.** Flinders Peak to Buninyong is 54,972.271 m (the reference value is quoted from memory, not re-read); haversine gives 54,925.508 m, 46.8 m short [M-S1].
- **Vincenty fails near antipodes.** It did not converge on 28 of 36 near-antipodal test pairs within 200 iterations [M-S1].
- **The GeographicLib geodesic algorithms** (2013) are accurate, robust and fast for the inverse problem on the ellipsoid, per the paper's abstract [S3]. They are available on npm as `geographiclib-geodesic` (MIT, §8).

**Recommendation (inference).** Use haversine with R₁ and round to whole meters. The worst error, about 0.56% (5.6 km on a 1,000 km gap), is far below the uncertainty of the inputs:
- an IP location is a city point with no stated radius (DB-IP Lite carries none, §1.1);
- a document address resolves to a city or postal centroid (§6.3);
- a GPS fix carries its own 95% radius.

Each distance should carry the uncertainty of its endpoints. Rules like "IP and GPS more than N km apart" should compare against N plus both radii. Use `geographiclib-geodesic` only if exact ellipsoidal meters are ever required. Its paper describes the method as robust [S3]; its behaviour near antipodes was not tested here, while Vincenty's failed [M-S1].

### 6.3 Reverse (and forward) geocoding: options and terms

The comparisons need country, region and city from a GPS point (reverse geocoding) and a point for a document address (forward geocoding, at city or postal level).

| Option | Licence | Access | Verdict |
|---|---|---|---|
| **Natural Earth** admin-0 countries (10m: 13,287,234 B GeoJSON; 50m: 3,083,490 B) and admin-1 (10m: 40,726,851 B), populated places (10m simple: 4,932,147 B); tag `v5.1.2` (`f1890d9f`) of `github.com/nvkelso/natural-earth-vector` [S4] | **Public domain.** "No permission is needed", crediting the authors is unnecessary; its name data comes from Wikidata (CC0) [S5]. `LICENSE.md` at the tag opens with "Everything here is public domain" and also holds contributors' grants to Natural Earth [S4] | `raw.githubusercontent.com` at a pinned commit (no robots file) | **✅.** A pinned snapshot through `fetch_data.py`. Point-in-polygon gives the country (fields `ISO_A2`, `ISO_A2_EH`, `ADM0_A3`, …) [M-S2] and the first-level region; nearest populated place gives a coarse city. Caveat: the boundaries show de facto control, and some features need the `_EH` ISO field (inference to verify at implementation) |
| **GeoNames** dumps (`cities1000`, postal codes and others) | CC BY ("cc-by licence"), commercial usage allowed, credit GeoNames with a link [S6] | **`download.geonames.org/robots.txt` disallows `/` for every agent** [S7]. The web services need a `username`, with 10,000 credits a day and 1,000 an hour, and every lookup sends coordinates or names to GeoNames [S6] | ⚠️. The licence passes, but automated download conflicts with robots. Operator-imported only (`--import` of a file the operator downloaded by hand), never fetched by our code |
| **OpenStreetMap / Nominatim** | Data **ODbL** (share-alike) [S8][S9]. The public Nominatim service allows at most one request per second, needs an identifying User-Agent or Referer, discourages periodic and bulk use, and forbids autocomplete and scraping [S9] | public API or self-hosted | **❌ at runtime.** ODbL is a share-alike database licence. A store of reverse-geocoded results built from OSM data could be a derivative database that must be offered under ODbL (inference), which is excluded by policy. The public API would also send every user's coordinates to a third party |
| **Commercial geocoders** (Google, Mapbox, HERE and others) | Their terms were **not checked** here | API keys | A-tier adapter only, with a sandbox, if the owner wants street-level geocoding |

**What is honestly possible without paid data (inference).**
- GPS → country: R-tier (Natural Earth point-in-polygon).
- GPS → region: R-tier at first-level subdivisions.
- GPS → city: H-tier (nearest populated place).
- Document address → point: H-tier at city level (name match against Natural Earth populated places, or GeoNames if imported).
- Street-level distance: not possible without an adapter.

## 7. Privacy: IP addresses as personal data

### 7.1 The law, briefly (not legal advice)

- **IP addresses are personal data in most deployments.** GDPR Recital 30 names internet protocol addresses among the online identifiers that can associate a person with their device [X1]. In case C-582/14 (judgment of 19 October 2016), the Court of Justice held that a dynamic IP address is personal data for a website operator that has legal means to identify the visitor with the additional data the access provider holds (per the CURIA press release 112/16, read through a search summary) [X2]. An identity-verification operator also holds the name, the document and the selfie beside the address, so identifiability is direct (inference).
- **Lawful basis.** Recital 47 calls processing "strictly necessary for the purposes of preventing fraud" a legitimate interest (quoted because it decides), subject to a balancing test that weighs the person's reasonable expectations [X3]. The operator is the controller and makes that assessment; OpenVerify can only document it (as Phase 6 did for screening data [R8]).
- **Automated decisions.** Article 22 gives a right not to be subject to a decision based solely on automated processing with legal or similarly significant effects. The exceptions are contract, law or explicit consent, and two of them require human intervention, the person's view and a way to contest [X4]. A network signal (VPN, datacenter, distance) **must not decline an inquiry on its own**. This matches ADR 0002: H-tier results route to review [R3].
- **Precise location is more sensitive.** The W3C recipients' duties are in §6.1 [S1]. Under California's CPRA, "precise geolocation" (a device-derived location within a circle of 1,850 feet radius) is a category of sensitive personal information that consumers can limit (per secondary explainers; statute text not read) [X5].
- **The lists themselves.** Tor exit addresses can belong to individuals who run relays at home (inference), so a stored exit list may hold personal data of relay operators, as watchlists hold that of listed persons [R8]. Keep the lists purpose-limited, show only matches in the console, and expire old snapshots (C76.8's pattern).

### 7.2 What OpenVerify stores today (read-only inventory, 2026-10-27)

- **Session and consent IP.** The inquiry session's client IP is sealed in an encrypted column (`ipSealed`), and the consent record seals its `ip` inside the JSON (context `inquiry_sessions.consent.ip`) [R9].
- **Audit log IP.** Encrypted (`encrypted('ip', { context: 'audit_logs.ip' })`) [R9].
- **API logs.** The IP is masked (`mask.ipAddress`), and the stored client IP is capped at 64 characters [R9].
- **Client address.** The API derives it through Fastify `trustProxy`, from the operator's `OPENVERIFY_TRUST_PROXY` setting (C15) [R9].

  **Every network signal must use that resolved address, never a client-supplied `X-Forwarded-For`.** Otherwise a client could choose the address it is judged by (inference).

### 7.3 Minimisation and retention (proposed, inference)

| Datum | Keep | Form | Retention |
|---|---|---|---|
| Full client IP | yes, for exact list matches (the `ip-addresses` list-item type [R4]) and the audit trail | sealed, as today; plus a per-environment HMAC blind index of the full address for list lookups | inquiry retention (C16), with an optional shorter `ip-retention-days` that drops the sealed value and keeps the derived signals |
| Network prefix (/24 IPv4, /48 IPv6) | yes, for graph edges ("same network") | HMAC blind index only; never the prefix in clear | as the full IP |
| Derived network facts | yes | country, ASN, organisation, flags, reason codes, list and snapshot ids, data month | as the verification result |
| GPS fix | only when the template requests it and the user grants it; the `geolocations` list-item type [R4] matches against the derived point | sealed like Phase 4's face templates [R5]; coordinates rounded to 4 decimal places (about 11 m) before sealing, plus `accuracy` | shortest; drop raw coordinates after the distance and region are derived (default 30 days, an owner decision) |
| Distances | yes | whole meters, with both endpoints' uncertainty | as the result |
| Logs (pino) | never the IP or the coordinates | ASN and country only, if anything | log retention |
| Third-party disclosure | none by default | API adapters (§5.2) are opt-in with a disclosure acknowledgement; downloaded-file adapters answer locally | - |

**Test data.**
- Every address in fixtures, tests, docs and the sandbox provider comes from the documentation ranges: `192.0.2.0/24` (TEST-NET-1), `198.51.100.0/24` (TEST-NET-2) and `203.0.113.0/24` (TEST-NET-3) [X6], and `2001:db8::/32` for IPv6 [X7].
- Geofeed, MMDB, range-file and exit-list fixtures are synthetic files in each publisher's format, built from those ranges.
- Fixture coordinates are fictional points, for example open ocean or a grid, never a real person's location.

## 8. Libraries that read these formats

Release-age rule: a pinnable version was released on or before **2026-10-13**. Licences were read from the npm packument (`registry.npmjs.org/<name>`) and from the LICENSE file at the release's `gitHead` or tag commit. None declares an install script.

| Package | Latest = newest ≤ 2026-10-13 | Released | Licence (registry; file at commit) | Dependencies | Use |
|---|---|---|---|---|---|
| `mmdb-lib` | 3.0.3 | 2026-07-30 | MIT; `LICENSE` at `52bdcd0e` [K1] | none | **Recommended** MMDB reader for DB-IP Lite and any operator-supplied MMDB (MaxMind Anonymous IP, IPinfo): a decoder over a buffer with no dependencies |
| `maxmind` | 5.0.7 | 2026-08-01 | MIT; `LICENSE` at `5fb78b33` [K2] | `mmdb-lib` 3.0.3, `tiny-lru` 13.0.0 | A wrapper over `mmdb-lib` with a cache (inference from its dependencies); not needed |
| `tiny-lru` (via `maxmind`) | 13.0.0, pinned exactly by `maxmind` 5.0.7; it is not the latest: 13.1.1 (2026-10-21) is too new, and the newest passing version is 13.1.0 (2026-09-27) (corrected in fact-check) | 2026-03-29 | BSD-3-Clause; `LICENSE` at `7076d0c4` [K3] | none | only if `maxmind` is used |
| `ipaddr.js` | 2.5.0 | 2026-08-04 | MIT; `LICENSE` at `dc552827` [K4] | none | Address parsing, IPv4-mapped IPv6, CIDR matching. **Already in `pnpm-lock.yaml` at 2.5.0** [R10] |
| `geographiclib-geodesic` | 2.2.0 | 2025-08-22 | MIT; `LICENSE.txt` at tag `v2.2.0` (`1faa63ce`) [K5] | none | Only if exact ellipsoidal distances are required (§6.2) |

**Not needed (inference).**
- Range sets for Tor, cloud and list prefixes can be our own sorted-interval tables, with a binary search over 16-byte keys. That is a few dozen lines with property tests, and it avoids a dependency.
- Haversine is ten lines.
- GeoJSON point-in-polygon for Natural Earth can be our own ray-casting over the pre-simplified 50m layer, or a permissive library chosen at implementation (not researched here).
- No GeoLite2 downloader package may be added (§1.4).

## 9. Final table: source → rule 4 → how the operator gets it → what tests use

There are two mechanisms, as in Phase 6 [R7][R8]:
- **(P) Pinned snapshot.** The publisher offers fixed versions: a Git commit or tag. A `data/manifest.json` entry carries the URL at that commit, its SHA-256, size, SPDX licence and licence URL. `python3 scripts/fetch_data.py` verifies and stores it, gitignored and never committed.
- **(S) Operator-run sync** (the C76 pattern). The publisher keeps no fixed versions. A committed source manifest (`network-sources.json`; name proposed) lists, per source, the URL, the allowed redirect host, the content types, the byte caps, the change signal, the refresh interval, a stale-after limit, enabled-by-default, the terms note and the attribution line. An operator CLI (`network:sync [--source <id>] [--import <file>]`) and an opt-in refresh job (`OPENVERIFY_NETWORK_REFRESH=true`) then follow the Phase 6 steps:
  1. check the change signal;
  2. download through the C85.1 streaming client;
  3. verify the publisher's digest where one exists;
  4. record our SHA-256;
  5. parse strictly;
  6. refuse a mass removal or an older publication;
  7. apply in one transaction.

Never in CI, never committed.

| Source | Rule 4 | Mechanism | Change signal / integrity | Refresh · stale after (proposed) | Tests use instead |
|---|---|---|---|---|---|
| DB-IP Country Lite (MMDB) | ✅ | S (`dbip-country-lite`), enabled | next month's file name; `ETag`; page MD5/SHA-1 of the decompressed file | daily check · 45 days | a synthetic MMDB written by our own test writer, with `192.0.2.0/25` → `ZZ`-style fictional codes and `2001:db8::/48` |
| DB-IP City Lite (MMDB, 60 MB gzip) | ✅ | S, **off by default** (size; city is a coarse hint) | as above | monthly · 45 days | synthetic MMDB with a fictional city point |
| DB-IP ASN Lite (MMDB) | ✅ | S, enabled | as above | daily check · 45 days | synthetic MMDB: `198.51.100.0/24` → AS64500 (RFC 5398 reserves 64496–64511 and 65536–65551 for documentation [X9]) as "Example Hosting" |
| IPinfo Lite, IP2Location LITE, GeoLite | ❌ | none; a startup warning if an operator points a source at them (inference) | - | - | a test that the manifest has no `ipinfo.io/data`, `ip2location.com/download` or `maxmind.com` URL |
| RIR delegated stats | ⚠️ | S, disabled; APNIC and AFRINIC only if enabled | `.md5`; APNIC and AFRINIC `.asc` | daily · 72 h | synthetic `delegated-*-extended` files with a version line, summaries and documentation-range records |
| iptoasn.com | ⚠️ | none (robots) | - | - | - |
| Tor `exit-addresses` | ✅ | S (`tor-exits`), enabled | `ETag`/`Last-Modified`; TorDNSEL timestamps | 1 h · 6 h; match window 24 h | synthetic TorDNSEL text: fictional 40-hex fingerprints, `ExitAddress 203.0.113.7 <time>`, an old entry outside the window |
| AWS `ip-ranges.json` | ⚠️ | S, enabled | `syncToken`; ETag = MD5 | 6 h · 7 days | synthetic JSON in AWS's schema with `198.51.100.0/26` `EC2` and an `AMAZON`-only range |
| Google `cloud.json` | ⚠️ | S, enabled | `syncToken`, `creationTime` | 6 h · 7 days | synthetic JSON with `ipv4Prefix`/`ipv6Prefix` and `scope` |
| Azure service tags | ⚠️ leaning ❌ | S, **disabled** (owner item 6) | page `version`, file name | weekly · 21 days | synthetic `values[].properties.addressPrefixes` |
| Oracle, Cloudflare | ⚠️ | S, enabled | `last_updated_timestamp`; API `etag` | daily · 14 days | synthetic files in each schema |
| DigitalOcean, Akamai/Linode geofeeds | ⚠️ | S, enabled | content SHA-256; Linode header stamp | daily · 14 days | synthetic RFC 8805 rows |
| Apple Private Relay | ⚠️ | S, disabled (owner item 7) | `ETag` | daily · 7 days | synthetic 5-column rows |
| X4BNet `input/datacenter/ASN.txt`, `input/vpn/ASN.txt` | ✅ | **P**, pinned by commit (`f2a466fa…` was the head on 2026-10-27; pin one at least 14 days old, by analogy with the package rule) | SHA-256 | on manifest bump | synthetic ASN files (`AS64500 # Example Hosting`) |
| bad-asn-list `bad-asn-list.csv` | ✅ | **P**, commit `b825d2e0…` (2026-04-12) | SHA-256 | on manifest bump | synthetic CSV |
| OpenVerify's own ASN table (gaps, VPN operators) | ✅ (ours) | committed, with evidence per row | - | on review | the table itself, with fictional rows in tests |
| Commercial anonymiser feeds | A-tier | adapters (download or API) | vendor's | vendor's | deterministic sandbox provider with documentation-range magic values (§5.2) |
| Natural Earth admin-0 50m, admin-1 10m, populated places | ✅ | **P**, tag `v5.1.2` (`f1890d9f…`) | SHA-256 | on manifest bump | small synthetic GeoJSON polygons (a fictional square "ZZ" country) |
| GeoNames | ⚠️ | operator `--import` only | SHA-256 recorded | operator's | synthetic rows in GeoNames' column order |
| OSM / Nominatim | ❌ | none | - | - | - |

**Stale or missing data is never a pass** (inference, mirroring C76.3 [R8]). A network check whose source is unsynced or stale answers `not_applicable` with `list_unavailable` or `list_stale` (an `execution_error`-class reason). The decision engine then treats a required check per ADR 0002 rule 3b.

## What Phase 7 should take from this (proposed)

1. **Default sources.**
   - **Geolocation and ASN:** DB-IP Country Lite and ASN Lite (MMDB), operator-synced monthly; City Lite off by default.
   - **Tor:** TorDNSEL `exit-addresses`, hourly.
   - **Datacenter ranges:** AWS, Google Cloud, Oracle, Cloudflare, DigitalOcean and Linode; Azure and Apple Private Relay disabled pending owner decisions.
   - **Hosting ASNs:** X4BNet's two curated ASN files and bad-asn-list, pinned by commit, plus a committed OpenVerify ASN table with evidence per row.
   - **Boundaries:** Natural Earth, pinned at `v5.1.2`.
   - **Never:** IPinfo Lite, IP2Location LITE, GeoLite, OSM, PeeringDB, CAIDA, RouteViews, iptoasn, or open-proxy lists.
2. **Extend the C76 sync** to a `network-sources.json` manifest and a `network:sync` CLI with the same guards: change signal, the C85.1 streaming client, digest checks, SHA-256 provenance, strict parse, mass-removal and rollback refusal, staleness, `--import` for air-gapped installs, the refresh job opt-in, and never in CI [R8].
   - **DB-IP needs a scraper of its own download page** for the month's MD5/SHA-1. Those digests cover the decompressed file, so check them after gunzip, with a cap on the inflated size.
   - **Content types** from §1 and §4 include `application/octet-stream`, `application/csv`, `text/plain` and a missing type (check.torproject.org). Judge by the final hop.
3. **Signal tiers (ADR 0002)** [R3]:
   - **R-tier** (exact list or range facts, with provenance): `is_tor` and provider-range `is_datacenter`; `is_relay` if Apple's list is enabled.
   - **H-tier, `stage: beta`, with confidence and reasons:** ASN-based `is_datacenter`, `is_vpn`, `threat_level`, IP→city, GPS→city, document→point.
   - **A-tier** (adapter plus deterministic sandbox): `is_proxy`, residential proxies and vendor risk scores (§5.2).
   - **Unknown is `null`, never `false`.** A required check with no source answers `not_applicable` / `provider_not_configured` or `list_unavailable`.
   - **No network signal declines on its own** (GDPR Art. 22 [X4]); H-tier results route to review.
4. **Distances.** Haversine on R₁, in whole meters. Each distance carries both endpoints' uncertainty: GPS `accuracy`, a city-centroid flag for IP and document points. Threshold rules compare against the sum. `geographiclib-geodesic` (MIT) is reserved for exact needs.
5. **Readers.** `mmdb-lib` 3.0.3 (MIT, no dependencies) for MMDB, and `ipaddr.js` 2.5.0 (MIT; already in the lockfile) for parsing. Use our own sorted-interval sets for ranges and our own point-in-polygon over Natural Earth 50m. No GeoLite downloader.
6. **Client address.** Use only Fastify's `trustProxy`-resolved address (C15), with IPv4-mapped IPv6 normalised. Document that a wrong `OPENVERIFY_TRUST_PROXY` makes every signal describe the proxy.
7. **Privacy by default** (§7.3). Keep the sealed IP and the full-IP and /24-/48 HMAC blind indexes. GPS only when the template asks and the user grants it, rounded to four decimals, sealed, with short retention. Never log IPs or coordinates. Third-party API adapters are opt-in with a disclosure acknowledgement.
8. **Attribution.**
   - The DB-IP link-back belongs on every dashboard page that shows an IP location or distance, in the docs and in provenance.
   - Tor (CC0) and Natural Earth (public domain) need none, but should be credited in `THIRD_PARTY_LICENSES.md` as a courtesy.
   - The X4BNet and bad-asn-list MIT notices ship with the data files.
9. **Embedded flow.** The iframe needs `allow="geolocation"` from the customer's markup [S1]. The SDK docs and the demo site must show it, and the flow must still work when the user refuses location.
10. **Tests.**
    - Synthetic files in every publisher's format, from documentation ranges [X6][X7] and documentation ASNs [X9].
    - A test writer for MMDB fixtures, so no real database is ever committed.
    - Manifest tests that refuse excluded hosts (`ipinfo.io/data`, `ip2location.com/download`, `maxmind.com`, `nominatim.openstreetmap.org`).
    - Staleness tests with a frozen clock.
    - A test that `is_proxy` is `null` without an adapter.
11. **Records to fix:** PLAN §3's IP-intel row, `THIRD_PARTY_LICENSES.md` §4.2 (the rows in "Corrections"), and the scope of ADR 0005 or a new Phase 7 ADR covering permissive commercial data (DB-IP).

## Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | DB-IP cannot be pinned for more than about two months. Allow an operator-run sync (never committed) for **permissively licensed commercial** data, not only public-sector data (Phase 6 ADR 0005's planned scope) | **Yes:** widen ADR 0005, or write ADR 0006 "Network data: operator-synced, verified, never committed", with the C76 guards |
| 2 | Share-alike IP data (IPinfo Lite CC BY-SA, MaxMind's BY-SA layer) loaded by an operator through a generic MMDB provider | **Not supported in Phase 7.** The generic provider accepts only files the manifest marks permissive; revisit if operators ask |
| 3 | RIR delegated statistics (RIPE NCC: written authorisation for commercial use; ARIN and LACNIC: no terms found) | **Not built in.** Country comes from DB-IP; if needed later, APNIC and AFRINIC only |
| 4 | `PDDL-1.0` (iptoasn) as a rule-4 licence | **Accept as CC0-equivalent in principle**, but do not use iptoasn while its robots file disallows the data files |
| 5 | Natural Earth's public-domain statement as a manifest licence (no SPDX id) | **Accept** as `LicenseRef-NaturalEarth-PublicDomain` in `fetch_data.py`'s allowlist, with the terms URL |
| 6 | Azure service tags under Microsoft's default non-commercial site terms, though the page tells sites to download weekly | **Disabled by default**, with a terms note; an operator may enable it |
| 7 | Apple Private Relay egress list (no terms; Apple advises treating it like carrier-grade NAT) | **Opt-in**, as `is_relay` only, never raising `threat_level` by itself |
| 8 | Provider range files with no licence (AWS, Google, Oracle, Cloudflare, DigitalOcean, Linode) | **Enabled, operator-synced, never redistributed**, each switchable; terms note "no licence stated; facts published for programmatic use" |
| 9 | Which commercial anonymiser adapters to ship | **Interfaces plus the sandbox only**, plus one downloaded-file MMDB adapter (covers MaxMind Anonymous IP and IPinfo Privacy files the operator licenses). No API vendor client until an operator asks |
| 10 | GPS retention and precision | Collect only when the template requests it; four decimals; **30 days** raw, derived facts with the result |
| 11 | IP retention separate from inquiry retention | Add `ip-retention-days`, default **equal to inquiry retention**, with an option to drop the sealed address early and keep derived facts |
| 12 | Network-data staleness limits (DB-IP 45 days, Tor 6 h, cloud 7–14 days) | **As proposed in §9**; stale means `list_stale`, never a pass |
| 13 | DB-IP City Lite (60 MB gzip, 121 MB MMDB, a coarse city point) | **Off by default**; country and ASN suffice for the default checks |

## Sources and pins

Every source was read on **2026-10-27**. "Probed" means robots first, then `HEAD` or a ranged `GET`, recording headers only. "Measured" means our own `python3 -I` script over a downloaded file.

**Pins (measured)**

| File | SHA-256 | Bytes | Notes |
|---|---|---|---|
| `dbip-country-lite-2026-10.mmdb.gz` | `4cd44536ddfd40fec7eca94a233f7d19f38d470e6522e653cb8d27001f5fe177` | 4,123,384 | decompressed 8,348,509 B: SHA-256 `dbd70ccfa2a13627eaf4913d19920a1a229f1b3c5439ac01c509995b6364202a`, MD5 `b8647f712bcabbe01f8afe3ff9e7569e`, SHA-1 `e515b63075ad48847f9c4332b724742e8ba15b0e` (MD5 and SHA-1 equal the page's) |
| `dbip-asn-lite-2026-10.mmdb.gz` | `6cdde02baa8c1bd619ab84c2e505ecd91d45288b5a87faadf1b7c41525a17a94` | 5,186,202 | decompressed 9,566,363 B: SHA-256 `4384bfcfb594391bc4e0ab37751f44661eaf7cadbeee28a90a6b82dc935fec4c`, MD5 `918a033bb1424c310ea5dedbd2e6e173`, SHA-1 `bc76615cd8f99b7b3a878803b1c84cbeda65769a` (equal the page's) |
| `torbulkexitlist` (16:47:46 GMT) | `7b164f9771b404fe7d1930afcccad21d79f59ce2fb5772d25e3d30ae26ecc5f8` | 17,361 | 1,226 IPv4 lines |
| AWS `ip-ranges.json` (`syncToken` 1793107625) | `e8e28174195fd212dec0befe7f1951376b27cbb94d940d44b6dc1a52d4fe64a1` | 2,736,131 | MD5 `c0fa4dc0c2f4e611a171ca34ec5aad58` = `ETag` |
| Google `cloud.json` (`syncToken` 1793110333116) | `284e3d82f1512c73e1b9480d0fcdc3ef230fd1bbe8594aca72353c5555c8527d` | 116,078 | |
| Google `goog.json` | `59d7365aba16130d49067afd6b4784a45c5a0c7835fa4ba90a284ca9d14d8ef3` | 6,315 | |
| Oracle `public_ip_ranges.json` | `59e5ba5e92e38f911ce377f1d71c6eaa89ffcf53f9eb4ccd667d9ffca81ead7d` | 234,112 | |
| Cloudflare `ips-v4` / `ips-v6` / API `ips` | `f02c6d83…9e7b` / `9e9d39e3…a9` / `f3d0a357…5efd` | 230 / 104 / 505 | |
| DigitalOcean `geo/google.csv` | `d6b07fc9c8ed00820f4eb6821fb0f33d6cf6536ddf7aa6d6dff6435e96c0bf7c` | 53,163 | |
| Linode geofeed | `675edae8d4cf065b09387513ba17a2869429f5912edaf6967b7c1c1fd55cfb6e` | 192,744 | |
| X4BNet `lists_vpn` head | commit `f2a466fa963ef0b273ccecaca10e6fa41eb97b17` (2026-10-27T16:07:01Z) | - | `input/datacenter/ASN.txt` 35,075 B (948 lines, 934 distinct ASNs; corrected in fact-check); `input/vpn/ASN.txt` 509 B (16 ASNs) |
| `brianhama/bad-asn-list` head | commit `b825d2e0e09684842599b75881fc76cb42f0e8c6` (2026-04-12T23:36:14Z) | 24,159 (`bad-asn-list.csv`) | 742 rows (723 distinct ASNs; corrected in fact-check) |
| Natural Earth `v5.1.2` | commit `f1890d9f152c896d250a77557a5751a93d494776` | - | |
| pyasn `1.6.2` | commit `655be973bdd63c43949f2a8480d63bc6ad1ea056` (2023-09-01) | - | |

**Repository (R)**
- [R1] `docs/PLAN.md` §2 (Signals, Lists, Graph, Transactions rows), §3 (technology table: browser fingerprint, IP intel, graph UI), §4.4, §6 Phase 7
- [R2] `CLAUDE.md` rules 4 and 5
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (list-item types `ip-addresses`, `geolocations`; `inquiry-sessions`, `devices` paths)
- [R5] `docs/plans/phase-4.plan.md` C42 (sealed templates and the background index, context only)
- [R6] `THIRD_PARTY_LICENSES.md` §4.2 (DB-IP, Tor, cloud and VPN rows "to verify on adoption")
- [R7] `data/manifest.json`, `scripts/fetch_data.py` (`PERMISSIVE_LICENSES`, commit-pinned URLs)
- [R8] `docs/plans/phase-6.plan.md` C76, C83, C85.1, C87; `docs/research/phase6-data-sources.md` (the Wikidata robots tension, GDELT disclosure, final-table pattern)
- [R9] `packages/db/src/tables/inquiries.ts` (`ipSealed`, consent `ip` context), `packages/db/src/tables/audit-logs.ts` (`audit_logs.ip`), `apps/api/src/services/api-logs.ts` (`mask.ipAddress`), `apps/api/src/services/inquiry-sessions.ts` (64-character cap), `apps/api/src/config.ts` and `apps/api/src/container.ts` (`trustProxy`, `OPENVERIFY_TRUST_PROXY`)
- [R10] `pnpm-lock.yaml` (`ipaddr.js@2.5.0`)

**DB-IP (D) and measurement (M-D1)**
- [D1] https://db-ip.com/db/download/ip-to-city-lite
- [D2] https://db-ip.com/db/download/ip-to-country-lite
- [D3] https://db-ip.com/db/download/ip-to-asn-lite
- [D4] https://db-ip.com/db/lite.php
- [D5] https://db-ip.com/tos.php (free downloads under CC BY 4.0; GeoNames acknowledgement; open-source code under LGPL)
- [D6] https://db-ip.com/faq.php
- [D7] https://db-ip.com/db/format/ip-to-city-lite/csv.html (PHP import package)
- [D8] https://download.db-ip.com/free/dbip-{country,city,asn}-lite-2026-10.{mmdb,csv}.gz (probed), `dbip-country-lite-2026-09.mmdb.gz` (200), `-2026-08`, `-2026-06`, `-2026-03`, `-2026-01`, `-2025-12`, `-2025-10`, `-2026-11` (404); https://download.db-ip.com/robots.txt (404); https://db-ip.com/robots.txt
- [D9] https://db-ip.com/db/format/ip-to-city-lite/mmdb.html
- [D10] as [D7] (CSV fields)
- [M-D1] measurement of the Country and ASN Lite MMDBs (pins above; metadata `DBIP-Country-Lite`, `DBIP-ASN-Lite (compat=GeoLite2-ASN)`, `build_epoch` 1790818572 and 1790818896)

**IPinfo (I)**
- [I1] https://ipinfo.io/lite
- [I2] https://ipinfo.io/developers/ip-to-country-asn-database
- [I3] https://ipinfo.io/developers/ipinfo-lite-database
- [I4] https://ipinfo.io/data/ipinfo_lite.mmdb and https://ipinfo.io/data/free/country_asn.mmdb (probed without token: 401); https://ipinfo.io/robots.txt

**IP2Location (P)**
- [P1] https://lite.ip2location.com/
- [P2] https://lite.ip2location.com/terms-of-use (Master License Agreement, Hexasoft Development Sdn. Bhd.)
- [P3] https://lite.ip2location.com/data-license
- [P4] https://www.ip2location.com/database/lite ; https://www.ip2location.com/free/downloader
- [P5] https://lite.ip2location.com/database-asn
- [P6] https://lite.ip2location.com/ip2proxy-lite

**MaxMind (M)**
- [M1] https://www.maxmind.com/en/geolite/eula (redirect from `/en/geolite2/eula`; "Updated on: February 12, 2026")
- [M2] https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/

**Registries (G) and measurement (M-G1)**
- [G1] https://ftp.apnic.net/stats/apnic/README-EXTENDED.TXT
- [G2] https://ftp.afrinic.net/pub/stats/afrinic/README-EXTENDED.txt
- [G3] https://www.arin.net/reference/research/statistics/nro_stats/ ; https://ftp.arin.net/pub/stats/arin/README
- [G4] https://www.ripe.net/about-us/legal/copyright-statement/
- [G5] https://ftp.lacnic.net/pub/stats/lacnic/README
- [G6] https://ftp.lacnic.net/pub/stats/lacnic/RIR-Statistics-Exchange-Format.txt ; https://ftp.ripe.net/pub/stats/ripencc/RIR-Statistics-Exchange-Format.txt
- [G7] https://ftp.ripe.net/pub/stats/ripencc/nro-stats/latest/nro-delegated-stats (probed); the 2020 handover to the RIPE NCC, via https://lists.afrinic.net/pipermail/announce/2020/002214.html (search summary)
- [G8] the five `delegated-*-extended-latest` files and their `.md5`/`.asc` (probed); robots files of `ftp.arin.net`, `ftp.ripe.net`, `ftp.apnic.net`, `ftp.lacnic.net`, `ftp.afrinic.net`
- [G9] https://www.ripe.net/analyse/raw-data-sets/terms-conditions/
- [M-G1] the first 1,500 B of the RIPE NCC file; the APNIC `.md5` and `.asc`

**ASN and organisation sources (A)**
- [A1] https://iptoasn.com/
- [A2] https://raw.githubusercontent.com/jedisct1/iptoasn-webservice/master/README.md
- [A3] https://iptoasn.com/robots.txt
- [A4] https://archive.routeviews.org/robots.txt ; https://www.routeviews.org/robots.txt
- [A5] https://api.github.com/repos/hadiasghari/pyasn (licence `NOASSERTION` in the API; last push 2024-12-21) and `/tags`; https://raw.githubusercontent.com/hadiasghari/pyasn/655be973bdd63c43949f2a8480d63bc6ad1ea056/LICENSE (MIT, with py-radix's notice)
- [A6] https://en.wikipedia.org/wiki/Route_Views (search summary only; not verified)
- [A7] https://www.arin.net/reference/research/bulkwhois/
- [A8] https://www.ripe.net/manage-ips-and-asns/db/support/documentation/terms/
- [A9] https://www.apnic.net/manage-ip/using-whois/bulk-access/
- [A10] https://www.peeringdb.com/aup
- [A11] https://www.caida.org/about/legal/aua/public_aua/ ("Last Modified August 11, 2022")

**Tor (T) and measurement (M-T1)**
- [T1] https://check.torproject.org/torbulkexitlist ; https://check.torproject.org/exit-addresses (first 2 KB); https://check.torproject.org/robots.txt
- [T2] https://metrics.torproject.org/collector.html (CC0 statement; TorDNSEL type); https://collector.torproject.org/recent/exit-lists/
- [T3] https://onionoo.torproject.org/robots.txt ; https://metrics.torproject.org/onionoo.html
- [M-T1] measurement of the bulk list and the `exit-addresses` head (pins above)

**Cloud and relay ranges (C) and measurements (M-C1 … M-C7)**
- [C1] https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-ranges.html
- [C2] https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-syntax.html
- [C3] https://docs.aws.amazon.com/vpc/latest/userguide/subscribe-notifications.html
- [C4] https://docs.cloud.google.com/compute/docs/faq (redirect from `cloud.google.com`)
- [C5] https://www.microsoft.com/en-us/download/details.aspx?id=56519
- [C6] web search for an official Hetzner list (third-party aggregators only)
- [C7] https://developer.apple.com/icloud/prepare-your-network-for-icloud-private-relay/ ; https://mask-api.icloud.com/egress-ip-ranges.csv (probed, first 800 B)
- [C8] robots files of `ip-ranges.amazonaws.com` (403), `www.gstatic.com`, `download.microsoft.com` (301 to HTML), `docs.oracle.com`, `www.cloudflare.com`, `api.cloudflare.com` (404), `www.digitalocean.com`, `geoip.linode.com`, `mask-api.icloud.com` (400), `developer.apple.com`
- [C9] https://www.microsoft.com/en-us/legal/terms-of-use ("last updated February 7, 2022")
- [M-C1] AWS file; [M-C2] Google files; [M-C3] Azure first 3 KB (`ServiceTags_Public_20261019.json`); [M-C4] Oracle; [M-C5] Cloudflare; [M-C6] DigitalOcean and Linode geofeeds; [M-C7] Apple first 800 B

**Community lists (N) and measurement (M-N1)**
- [N1] https://raw.githubusercontent.com/X4BNet/lists_vpn/main/README.md
- [N2] https://api.github.com/repos/X4BNet/lists_vpn (licence null) and `/contents`
- [N3] https://api.github.com/repos/X4BNet/lists_vpn/git/trees/main?recursive=1 ; https://raw.githubusercontent.com/X4BNet/lists_vpn/main/.github/workflows/build-list.yml ; the two `input/*/ASN.txt` files
- [N4] https://api.github.com/repos/brianhama/bad-asn-list (MIT) ; https://raw.githubusercontent.com/brianhama/bad-asn-list/master/README.md ; `bad-asn-list.csv`
- [N5] https://api.github.com/repos/client9/ipcat (MIT, archived) ; https://api.github.com/repos/jhassine/server-ip-addresses (no licence)
- [N6] https://api.github.com/repos/firehol/blocklist-ipsets (no licence detected)
- [M-N1] row count of `bad-asn-list.csv`

**Commercial anonymiser feeds (V)**
- [V1] https://dev.maxmind.com/geoip/docs/databases/anonymous-ip/
- [V2] https://ipinfo.io/developers/privacy-detection-database
- [V3] https://www.ipqualityscore.com/documentation/proxy-detection-api/overview
- [V4] https://docs.spur.us/context-api
- [V5] https://docs.spur.us/

**Location and geodesy (S) and measurements (M-S1, M-S2)**
- [S1] W3C Geolocation, Candidate Recommendation Snapshot 26 March 2026, https://www.w3.org/TR/2026/CR-geolocation-20260326/ (read at https://www.w3.org/TR/geolocation/)
- [S2] https://developer.android.com/develop/sensors-and-location/location/permissions
- [S3] "Algorithms for geodesics", J. Geodesy 87(1), 43–55 (2013), arXiv:1109.4448, https://arxiv.org/abs/1109.4448 (abstract read)
- [S4] https://api.github.com/repos/nvkelso/natural-earth-vector and `/tags`; https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/LICENSE.md ; GeoJSON sizes from `master` (probed)
- [S5] https://www.naturalearthdata.com/about/terms-of-use/
- [S6] https://www.geonames.org/export/
- [S7] https://download.geonames.org/robots.txt
- [S8] https://www.openstreetmap.org/copyright
- [S9] https://operations.osmfoundation.org/policies/nominatim/
- [M-S1] `scripts/geodesy_check.py --pairs 30000 --seed 7` (fictional points; our own haversine and Vincenty)
- [M-S2] the first 4 KB of `ne_50m_admin_0_countries.geojson` at `v5.1.2`

**Privacy and standards (X)**
- [X1] GDPR Recital 30, https://gdpr-info.eu/recitals/no-30/
- [X2] CJEU C-582/14, ECLI:EU:C:2016:779; CURIA press release 112/16, via a search summary (https://curia.europa.eu ; commentary https://www.insideprivacy.com/international/cjeu-confirms-dynamic-ip-addresses-to-be-personal-data/). EUR-Lex returned an empty page to the fetcher
- [X3] GDPR Recital 47, https://gdpr-info.eu/recitals/no-47/
- [X4] GDPR Art. 22, https://gdpr-info.eu/art-22-gdpr/
- [X5] Cal. Civ. Code §1798.140 "precise geolocation" (1,850-foot radius), via secondary explainers (https://www.caprivacy.org/?p=2515 ; https://www.hsfkramer.com/insights/2025-03/privacy-regulators-target-the-location-data-industry); statute text not read
- [X6] RFC 5737, https://www.rfc-editor.org/rfc/rfc5737.txt
- [X7] RFC 3849, https://www.rfc-editor.org/rfc/rfc3849.txt
- [X8] RFC 9309 §2.3.1.2–2.3.1.4, https://www.rfc-editor.org/rfc/rfc9309.txt
- [X9] RFC 5398, https://www.rfc-editor.org/rfc/rfc5398.txt (64496–64511 and 65536–65551)

**Packages (K)** (packuments at `https://registry.npmjs.org/<name>`; LICENSE at the commit)
- [K1] `mmdb-lib` 3.0.3 (2026-07-30), https://raw.githubusercontent.com/runk/mmdb-lib/52bdcd0e68317278d63dc45c6e4047d51adcb0cc/LICENSE
- [K2] `maxmind` 5.0.7 (2026-08-01), https://raw.githubusercontent.com/runk/node-maxmind/5fb78b33ad4fed7bee5c6c74b3d181c33583f832/LICENSE
- [K3] `tiny-lru` 13.0.0 (2026-03-29), https://raw.githubusercontent.com/avoidwork/tiny-lru/7076d0c4377fc534b89330a510d291f8d4ab62f4/LICENSE
- [K4] `ipaddr.js` 2.5.0 (2026-08-04), https://raw.githubusercontent.com/whitequark/ipaddr.js/dc55282780d8702bac31ef012ca52e4a77fbca1f/LICENSE
- [K5] `geographiclib-geodesic` 2.2.0 (2025-08-22), https://raw.githubusercontent.com/geographiclib/geographiclib-js/1faa63ce75c4d74ff491e486dda48bfbc3296645/LICENSE.txt

## Fact-check (2026-10-27)

Independent re-check of the load-bearing facts, 17:40–18:15 UTC, by a separate agent. Every fact was re-opened at its primary
source with a new fetcher (standard library, `python3 -I`, scripts kept in the session scratchpad, not in `scripts/`): robots.txt
first, evaluated per RFC 9309 plus any group naming Anthropic's agents; at least 1.2 s between requests to one host, and any
`Crawl-delay` honoured; a descriptive User-Agent without contact details; no personal data sent. Files were downloaded into new,
empty `downloads/fc-*` directories (the DB-IP Country and ASN MMDBs, the AWS and Google range files and the Tor bulk list among
them) and measured with our own readers; nothing downloaded was executed. Process notes: `docs.aws.amazon.com` asks for a 5 s
crawl delay, and two of its pages were requested 1 s apart before the fetcher honoured `Crawl-delay`; the DB-IP and RIPE NCC pages
print the requester's public address, which was replaced by `192.0.2.0` in this check's copies. Only the rows below and the
sentences marked "(corrected in fact-check)" changed.

| # | Fact (as listed for Phase 7) | Verdict | Primary evidence |
|---|---|---|---|
| 1 | DB-IP Lite CC BY 4.0, link back on pages that show results; free downloads outside the paid-licence clauses; commercial use and redistribution allowed | confirmed | The Lite index and the three download pages (licence and link-back duty); the terms of service (the paid-licence terms "do not apply to the free database downloads", quoted because it decides); the FAQ |
| 2 | URL pattern; October files `Last-Modified` 2026-10-01; only the current and previous month answer | confirmed | `HEAD` of all six October files (200, 1 Oct 2026 06:29 GMT); `2026-09` 200 (1 Sep); `2026-08` and `2026-11` 404. The older months were not re-probed |
| 3 | Sizes (gzip) and record counts | confirmed | `Content-Length` of the six files equals the note; record counts from the pages |
| 4 | Page MD5/SHA-1 cover the decompressed MMDB; `.gz` SHA-256 `4cd44536…` | confirmed | Own download and hashing: decompressed MD5 and SHA-1 equal the page; the `.gz` MD5 differs; `.gz` SHA-256 identical to the pin |
| 5 | ASN Lite MMDB metadata and fields | confirmed | Own metadata decoder: `DBIP-ASN-Lite (compat=GeoLite2-ASN)`, format 2.0, `ip_version` 6, `record_size` 24, `build_epoch` 1790818896; both field names occur in the data section |
| 6 | IPinfo Lite CC BY-SA 4.0; downloads need `?token=` (401 without) | confirmed | Both pages; `HEAD` of `ipinfo_lite.mmdb` without a token: 401. The page counters have moved since ("Last Updated: Oct 27, 2026", 4,374,965 lines) |
| 7 | IP2Location LITE: no redistribution or resale; master licence agreement for internal use | confirmed | `lite.ip2location.com/data-license` and `/terms-of-use`; no Creative Commons link on either, or on `www.ip2location.com/database/lite` |
| 8 | MaxMind GeoLite EULA (2026-02-12): CC BY-SA plus EULA; FCRA and benefit-eligibility bans; 30-day destruction; account and key; 30 downloads a day | confirmed | EULA (`/en/geolite2/eula` redirects to `/en/geolite/eula`); developer page ("limited to 30 database downloads per day") |
| 9 | APNIC and AFRINIC free download and use with a no-liability condition; RIPE NCC copyright statement | confirmed | Both `README-EXTENDED` files; the RIPE NCC statement (private, public non-commercial, research, educational or demonstration use; written authorisation otherwise) |
| 10 | iptoasn PDDL 1.0, hourly; robots disallows `/data/*.gz` | confirmed | Footer and "Updated hourly"; the second `User-agent: *` group of its robots file has `Disallow: /data/*.gz$` |
| 11 | RouteViews robots files | confirmed | Robots files only: `archive.routeviews.org` disallows `/` for every agent; `www.routeviews.org` names `anthropic-ai`, `Claude-Web` and `ClaudeBot`, so the fetcher skipped both hosts |
| 12 | Tor: CC0; bulk list 17,361 B, 1,226 IPv4, no IPv6, SHA-256 `7b164f97…`; CollecTor hourly; Onionoo robots | confirmed | CC0 footer of metrics.torproject.org (also on collector.html); bulk list re-downloaded, unchanged since 16:47:46 GMT (identical SHA-256; 1,226 valid IPv4; no IPv6); the CollecTor `recent/exit-lists/` index holds one file per hour (90 at 17:11 UTC); Onionoo robots disallows `/summary` and `/details` |
| 13 | AWS `ip-ranges.json`: 2,736,131 B, `syncToken` 1793107625, 10,686 + 7,005 prefixes, `ETag` = MD5, SNS topic | confirmed (snapshot) | The saved 13:27 UTC publication re-measured (size, `syncToken`, counts, MD5 `c0fa4dc0…`); the SNS ARN is on the AWS notifications page. The live file has been republished since (2,736,442 B, `syncToken` 1793114825, 10,688 IPv4 + 7,005 IPv6), and its `ETag` again equals its MD5 |
| 14 | Google `cloud.json` and `goog.json` sizes, counts, fields; no licence for the JSON | confirmed | Both files fetched (identical SHA-256 to the pins); 1,040 + 95 prefixes with `ipv4Prefix`/`ipv6Prefix`/`service`/`scope`; the FAQ's CC BY 4.0 covers page text only |
| 15 | Azure service tags: item 56519, weekly `ServiceTags_Public_20261019.json` 4,870,615 B; Microsoft site terms | confirmed | Details page (`version` 2026.10.19, weekly); `HEAD` of the file 4,870,615 B; terms of use ("Last Updated: February 7, 2022": personal and non-commercial unless otherwise specified) |
| 16 | X4BNet head `f2a466f…`; README MIT; datacenter file 948 ASNs; VPN file 16; build expands via iptoasn | **corrected** (count) | Commit and date, the README's MIT declaration, the 16-ASN VPN file and the workflow's `ip2asn-v4.tsv.gz` download are right; `input/datacenter/ASN.txt` has 948 lines but 934 distinct ASNs (14 repeated) |
| 17 | `bad-asn-list` MIT, commit `b825d2e…` (2026-04-12), 742 ASNs | **corrected** (count) | Licence (GitHub-detected MIT and the LICENSE file) and commit are right; `bad-asn-list.csv` has 742 data rows but 723 distinct ASNs |
| 18 | W3C Geolocation CR Snapshot 2026-03-26; express permission; secure context; accuracy in meters at 95%; `allow="geolocation"`; no guarantee | confirmed | https://www.w3.org/TR/geolocation/ |
| 19 | Haversine on R₁ within 0.561% of WGS 84; Vincenty failed on 28 of 36 near-antipodal pairs | confirmed (bound) | Analytic check: the worst case is a short north–south arc at the equator, where R₁ exceeds the meridian radius of curvature by 0.5614%, matching the measured maximum. The 28-of-36 count depends on the note's own test pairs and was not re-measured (non-convergence near antipodes is a known limit of Vincenty's method) |
| 20 | Natural Earth public domain; `v5.1.2` = `f1890d9f…`; 50m countries 3,083,490 B with `ISO_A2`, `ISO_A2_EH`, `ADM0_A3` | confirmed | Terms page; GitHub API (`v5.1.2` → `f1890d9f…`, committed 2022-05-13); `HEAD` at that commit 3,083,490 B; the three fields in the first 6 KB; `LICENSE.md` at the commit |
| 21 | GeoNames CC BY, commercial use allowed; `download.geonames.org` robots disallows `/` | confirmed | Export page; its robots file (the fetcher skipped the download) |
| 22 | Nominatim usage policy; OSM data ODbL | confirmed | Usage policy (1 request per second at most, identifying User-Agent or Referer, bulk discouraged); copyright page |
| 23 | npm: `mmdb-lib` 3.0.3, `maxmind` 5.0.7, `tiny-lru` 13.0.0, `ipaddr.js` 2.5.0, `geographiclib-geodesic` 2.2.0; all latest versions pass the cutoff | **corrected** (tiny-lru) | Registry packuments confirm versions, dates, licences and dependencies for all five, but `tiny-lru`'s latest is 13.1.1 (2026-10-21), which fails the cutoff; the newest passing is 13.1.0 (2026-09-27). `maxmind` 5.0.7 pins 13.0.0 exactly (2026-03-29, BSD-3-Clause), which passes. `ipaddr.js@2.5.0` is in `pnpm-lock.yaml` |
| 24 | Documentation ranges and ASNs | confirmed | RFC 5737, RFC 3849, RFC 5398 at rfc-editor.org |
| 25 | Repository: sealed session and consent IP, encrypted `audit_logs.ip`, masked IPs in API logs, `trustProxy`/`OPENVERIFY_TRUST_PROXY` | confirmed | `packages/db/src/tables/inquiries.ts` (`ipSealed`, `inquiry_sessions.consent.ip`), `audit-logs.ts`, `apps/api/src/services/api-logs.ts` (`mask.ipAddress`), `inquiry-sessions.ts` (64-character cap), `apps/api/src/app.ts` and `container.ts` |

**Counts:** 25 facts: 22 confirmed, 3 corrected, 0 could not verify (one sub-part of 19 not re-measured).
