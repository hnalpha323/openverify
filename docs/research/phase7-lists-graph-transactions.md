# Phase 7 research: lists, the account graph and transactions (engineering)

Status: complete, 2026-10-27. Every section below was written as it was finished.

**Summary.**
- **Lists.** Eleven list-item types in the public OpenAPI, plus face lists (public in the developer docs, which give a face-image importer) and selfie-background lists (named in the docs, no documented path) (corrected in fact-check). Exact types use HMAC blind indexes over versioned normalisations with the existing per-environment subkey (R). CIDR ranges need a plaintext `cidr` column with SP-GiST or an explicitly named GiST `inet_ops` (a `btree_gist` default class silently scans) (R). Radius matching is plain SQL in core Postgres; `earthdistance` is untrusted and needs a superuser (R). Fuzzy names reuse Phase 6's matcher (H). Face lists need their own sealed templates, the 0.5 threshold, a size cap, the probed person's consent and an operator acknowledgement (R, advisory).
- **CSV.** `csv-parse` 7.0.3 and `csv-stringify` 6.9.0 (MIT); strict UTF-8 before parsing; caps; staging with all-or-nothing by default; codes, never values, in errors; an export neutraliser wider than `escape_formulas`.
- **Graph.** A bipartite attribute table with degrees; breadth-first search with a visited set, depth ≤ 3 and per-value fan-out caps (under 30 ms at a million synthetic accounts). A recursive CTE repeats 3.7× to 7× the work. IP links alone merged a random million-account graph into one component. No Apache AGE: not in the pinned image.
- **Explorer.** Cytoscape.js 3.34.3 with fCoSE, canvas, at most 2,000 nodes, and a table alternative.
- **Transactions.** The public field-schema union has 15 types, and `hash` is a nested object, not a hashed value (a correction to PLAN §2). Validate by walking stored schemas with zod; use ajv only for `json` fields' schemas, behind a restricted meta-schema.

## 0. Scope, method and conventions

Prepared 2026-10-27 for OpenVerify Phase 7 ("Signals, lists, graph, transactions", `docs/PLAN.md` §6 Phase 7, §4.4 and the Lists, Graph and Transactions rows of §2 [R1]). This note is the **engineering** half: how to store, match, traverse, import, export, validate and show these objects on the stack OpenVerify already runs (Postgres 17 with pgvector in the pinned image `pgvector/pgvector:pg17`, Drizzle, Fastify, the Next.js console, sealed PII columns and per-environment HMAC blind indexes). Persona's public behaviour for the same objects is the subject of the sibling note `phase7-behaviour.md`; network data sources are in `phase7-network-data.md`, and the browser and Android collectors in `phase7-client-signals.md`. Where this note needs a public identifier (a path, an event name, a list-item type) it takes it from the repository's surface index [R4] and does not re-derive Persona's semantics.

**Conventions.** Everything is in our own words. Identifiers (field names, enum values, event names, type names, configuration keys, URL paths) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement we infer, and that no source makes, is marked **(inference)**. Every claim carries a citation key defined in section 9, with the URL and the read date (all 2026-10-27). Licence verdicts use the repository rule 4 [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3].

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**. Each package row gives the latest version and the newest one that passes.

**Method.**
- The repository was read, never changed: `docs/PLAN.md`, `CLAUDE.md`, ADR 0002, the surface index, the Phase 4 and Phase 6 plans, `packages/db/src/{blind-index,sealed,crypto}.ts`, `packages/db/src/tables/{selfie,accounts,inquiries,government-id-extractions}.ts`, `apps/dashboard/next.config.ts`, the API and dashboard `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, ADR 0001, the idempotency plugin and the Phase 4 calibration report [R1]–[R19].
- The pinned database image already present on this machine (`pgvector/pgvector@sha256:ac08538c…a75d`, created 2026-10-01, `PG_VERSION=17.11-1.pgdg12+2`) was inspected first without running it (`docker create` + `docker export`, listing and reading the extension control files), then run as a throwaway container with `--network none` to check operators, plans and timings on synthetic data only [M1]. Nothing from a download was executed.
- Package facts come from each registry's metadata document and the LICENSE file at the release tag or commit. Specifications come from their publishers' pages. Every host's `robots.txt` was read before any other request to it, with at most one request per second per host, a descriptive User-Agent without contact details, and no personal data sent.

## 1. What exists already (read-only review of the repository)

| Area | What the code does today | What it means for Phase 7 | Source |
|---|---|---|---|
| Blind indexes | `identificationNumberIndex`, `otpDestinationIndex`, `cryptoAddressIndex`, `chipSodIndex` and `chipDocumentNumberIndex` are HMAC-SHA-256 under a per-environment subkey `HMAC(OPENVERIFY_BLIND_INDEX_KEY, "openverify/blind-index/v1\|<environment id>")`, each with its own label (`openverify/<purpose>/v1`) and a fixed normalisation; output 64 lowercase hex. The key is separate from the KEK; `blind-index:rebuild` recomputes every index after a key change | Every exact list match can reuse this construction with new labels. The same value in two environments gives unrelated indexes, so list keys, graph attributes and transaction field keys are environment-bound by construction | [R5] |
| Index storage | Phase 3–5 indexes are `text` (64 hex) with a `^[0-9a-f]{64}$` check and a partial index led by `environment_id`; Phase 6 stores its new HMACs as 32 raw bytes (`report_matches.entry_index`) | `bytea` halves the key size (32 B against 64 B plus header), which matters for the graph's attribute table (section 5). Pick one and say so (section 10) | [R5][R7][R8] |
| Sealed columns | `sealValue`/`sealJson` bind each ciphertext to `<table>.<column>#<row id>`; every value gets its own random DEK (AES-256-GCM) wrapped by the KEK (AES-256-GCM), envelope `ov1.<kid>.<wrapped DEK>.<payload>`. Ciphertexts are randomised and cannot be compared or indexed | A sealed list value is readable only by a process with the KEK, one row at a time. Matching that needs the plaintext (CIDR, radius, fuzzy names, face cosine) must either keep a non-sealed derived column or decrypt in the worker (section 3) | [R6][R9] |
| Face templates | `face_templates` (`ftpl_`): the L2-normalised SFace embedding as base64 float32, sealed; written only for a passed selfie with liveness and ID comparison passed **and** the optional `consent.biometric-matching`; deleted on redaction, on an operator decline or a failed inquiry, and after `face-template-retention-days` (default 365, at most 1,095). No vector column and no ANN index (owner decision 3); the worker decrypts up to `face-search-max-templates` (default 50,000) newest first and scores cosines in process; measured about 2.1 s for 50,000 on the development CPU. `source` is checked to be `selfie`; C42.8 says face lists "may use the same table with other `source` values" | A face list cannot point at a template: a decline deletes it, and owner decision 14 says known-fraudster faces belong to Phase 7's face lists. A face-list item needs its own sealed copy (section 2.3) | [R10][R11] |
| Background index | `selfie_backgrounds` (`sbg_`): `layout vector(144)` (48 cells × mean Lab), `valid_cells`, `coverage`, an HNSW `vector_l2_ops` index, one row per template; the check then confirms candidates with ORB + RANSAC through vision `/v1/compare/background` on the stored centre files | A selfie-background list needs the vector **and** an image to confirm against, because the vector alone is a coarse prefilter (section 2.4) | [R10][R11] |
| Accounts | `accounts` (`acc_`) with a sealed `fields` JSON, tags, `consolidated_into`; `account_relations` (directed, typed, unique per from/to/type) | The graph links accounts, so its edges must follow consolidation (an absorbed account points at its survivor) and redaction | [R12] |
| Sessions | `inquiry_sessions.ip` and `.user_agent` are sealed; `audit_logs.ip` is encrypted with a static context | Today no IP, fingerprint or location is stored in any matchable form; Phase 7's signals work adds them (sibling notes) | [R12] |
| IP column type | `api_keys.allowed_ips` is already a `cidr[]` | The `cidr`/`inet` types are already in use; no new dependency | [R12] |
| Validation | `zod` 4.6.7 is a direct dependency of the API; `ajv` 8.20.0 is already in the lockfile, pulled by `@fastify/ajv-compiler` 4.0.7 for Fastify's own route validation | A transaction field-schema validator can be built from zod with no new dependency; ajv is present but only as Fastify's internal (section 7) | [R13][R14] |
| CSV | No CSV parser or writer is in the lockfile | Phase 7 adds one (section 4) | [R14] |
| Console CSP | `apps/dashboard/next.config.ts` sends `Content-Security-Policy: frame-ancestors 'none'` only; a script CSP with nonces is left for later | A graph library must still be chosen so that a later `script-src` without `'unsafe-eval'` and a `worker-src` without `blob:` keep working (section 6) | [R15] |
| Persona identifiers | 11 list-item types (`browser-fingerprints`, `countries`, `device-fingerprints`, `email-addresses`, `fields`, `geolocations`, `government-id-numbers`, `ip-addresses`, `names`, `phone-numbers`, `strings`); importers for six of them (`importer/list-item/{email-addresses,geolocations,government-id-numbers,ip-addresses,names,phone-numbers}`); `graph-queries`, `graph-query.{completed,errored,timed-out,cancelled,reran}`; `transaction-types/{id}`, `transactions/{id}/{label,redact-biometrics,add-relation,...}`, `transaction.*` and `transaction-type.deleted-field` events; `batch-jobs/{id}/errors`; report type `custom-list`. PLAN §2 adds face and selfie-background lists for 13 types | The developer docs name both kinds; faces have a documented importer, `POST /importer/list-item/faces` (`image-files[]`, `list-id`), while selfie backgrounds have no documented path, so only the latter's names are ours (corrected in fact-check) (section 2). Graph queries are asynchronous objects with a lifecycle (section 5.5) | [R1][R4] |

## 2. List matching per list type

### 2.0 Shape shared by every type

- **Public item attributes** (from the public OpenAPI's create bodies [O1]; semantics in the sibling note [S1]): `value` for browser fingerprints, device fingerprints, IP addresses, phone numbers and strings (the IP create body's description says IPv4 and IPv6, but the IP list-item schema's `value` example is a /24 range and the developer docs' list cookbook says CIDR subnets are supported and match every address inside them, so ranges are public parity, not ours (corrected in fact-check); PLAN §6 asks for them too [R1][S1]); `value` plus `match-type` (`email_address` or `domain`) for emails; `country-code`; `field-value`; `latitude`, `longitude`, `radius-meters`; `id-class` and `id-number`; `name-first` and `name-last`. Face lists have a documented importer path (`POST /importer/list-item/faces`) and importer type `importer/list-item/face`; selfie-background lists are named in the docs but have no documented path, so their names are ours (corrected in fact-check) [R1][R4][S1].
- **Proposed storage (inference, our design).** One `lists` table (environment-scoped, a `type`, a `version` counter bumped by every item write, `archived_at`) and one `list_items` table with the columns every type shares: `id`, `environment_id`, `list_id`, `value` (sealed JSON of the item as entered, row-bound AAD [R6]), `match_key` (32-byte HMAC, nullable, for the equality types), `normaliser_version`, `created_by`, `created_at`, `archived_at`, `redacted_at`. Types that need more than equality get a side table keyed by the item id: `list_item_ip_ranges (range cidr)`, `list_item_geo (bbox box, lat_coarse, lon_coarse)`, `list_item_faces (template sealed, model)`, `list_item_backgrounds (layout vector(144), valid_cells, coverage, image file id)`. A partial unique index on `(environment_id, list_id, match_key) where archived_at is null` makes a re-import idempotent (section 4).
- **One matching service, several consumers (inference).** `matchLists(tx, environmentId, probes[]) → matches[]`, each match naming the list, the item, the probe's source (for example `government-id.identification-number`, `session.ip-address`, `selfie.center`), the method (`exact`, `cidr`, `radius`, `fuzzy_name`, `face_cosine`, `background`) and, for non-exact methods, a score. Its consumers are the `custom-list` report type (a public type name [R4] that Phase 6 deferred to Phase 7, C88 [R8]), the list-match checks (their ids come from the behaviour note [S1]; ours where it finds none), the PLAN §4.1 "org compromised lists" input of `id_compromised_detection` [R1], and the Phase 8 workflow conditions.
- **Honesty (ADR 0002 rule 3a [R3]).** "No match" is a statement about the lists that were read at a given `version`. A list that could not be read (a face list whose templates could not be opened, a list whose `normaliser_version` is older than the code's) gives `not_applicable` with a reason, never "no match", mirroring Phase 6's `list_unavailable` and `matcher_data_unavailable` [R8].

### 2.1 Per type

| Type | Normalisation before matching (all versioned by `normaliser_version`) | Stored for matching | Operation and index | Tier | Notes |
|---|---|---|---|---|---|
| `strings` | Unicode NFKC, trim, collapse inner whitespace; case-folded unless the list says `case-sensitive` (ours) | HMAC `openverify/list-string/v1` | equality on `match_key` (btree, environment first) | R | JavaScript has no full case fold; `toLowerCase()` after NFKC is the rule, stated in the docs (inference) |
| `email-addresses`, `match-type: email_address` | trim; split at the last `@`; domain lower-cased and converted to ASCII with `node:url` `domainToASCII`; local part lower-cased (RFC 5321 allows a case-sensitive local part, but providers do not use it; inference) | HMAC `openverify/list-email/v1` over `local@domain` | equality | R | Optional second key for provider rules (dots and `+tag` in one large free-mail provider's addresses): a list option, off by default, because it is provider-specific and can join distinct people (inference) |
| `email-addresses`, `match-type: domain` | domain as above, without a leading `@` | HMAC `openverify/list-email-domain/v1` | the probe sends the domain and each parent (`a.b.example` → `b.example` → `example`), one key per level, as Phase 5's disposable check walks parents [R1] | R | A vanity domain names a person, so it is sealed and indexed too |
| `phone-numbers` | parse with `libphonenumber-js` 1.13.14 (already pinned, MIT [R14]) using the item's country or the import's default region; refuse numbers that do not parse; store E.164 | HMAC `openverify/list-phone/v1` over E.164 | equality | R | The probe is the OTP-confirmed number or an inquiry field, normalised the same way |
| `government-id-numbers` | `id-class` as given (or `*` when absent); the number through the existing `normalizeIdentificationNumber` (upper-case, `[A-Z0-9]` only) [R5] | HMAC `openverify/list-government-id-number/v1` over `<class>\|<number>` | the probe sends two keys, `<its class>\|<n>` and `*\|<n>` | R | The C31.8 index cannot be reused: it includes the issuing authority, which a list item does not carry [R5] |
| `names` (exact) | the Phase 5/6 name normaliser (NFKD, marks stripped, case-folded) and both ICAO 9303 folds, so "Müller" gives `MULLER` and `MUELLER` [R8] | HMAC `openverify/list-name/v1` over `<last>\|<first>` per fold (up to 4 keys per item) | equality | R | Order swaps handled by also keying `<first>\|<last>` (inference) |
| `names` (fuzzy, a list option) | the C78 tokens, variant groups and nicknames [R8] | the sealed value only (section 3.3) | the C78 scorer over the list's decrypted names in the worker | **H** (`beta`, the score as confidence) | Phase 6 rates the same scorer H and `beta` until a recall benchmark passes [R8] |
| `ip-addresses`, single address | parse (Node's `net.isIP` plus our canonical form, or `ipaddr.js` 2.5.0, MIT [N15]); an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) becomes IPv4 first, because Postgres puts it in family 6, where `192.0.2.0/24` does not contain it (measured [M1]) | HMAC `openverify/list-ip/v1` over the canonical text | equality | R | `inet '192.0.2.5' = inet '192.0.2.5/32'` is true [M1]; canonicalise before hashing |
| `ip-addresses`, CIDR range (public; corrected in fact-check) | `network()` normalises host bits away; `cidr` refuses them (measured [M1]) | a plaintext `cidr` column (section 3.2) | `range >>= $probe` (contains or equals; `family()` tells v4 from v6 [P1]) with GiST `inet_ops` named explicitly, or SP-GiST, whose `inet_ops` is the default class [P3] | R | **Trap:** with `btree_gist` installed, the default GiST class for a `cidr` column is `gist_cidr_ops`, which cannot serve `>>=`; the measured plan was a sequential scan. Postgres documents that core `inet_ops` is not the default for historical reasons [P2][P4][M1] |
| `countries` | ISO 3166-1 alpha-2, upper case; check `^[A-Z]{2}$` | plaintext | equality | R for the comparison | The probe's source decides the honesty: the ID's issuing country is R; an IP-derived country is H (the network note [S2]) |
| `geolocations` | latitude in [−90, 90], longitude in [−180, 180), `radius-meters` > 0 with an upper cap (ours, for example 500 km) | a coarse plaintext bounding box (section 3.2) plus the sealed exact point | per-item box `@>` the probe point (GiST on `box`), then a haversine on the IUGG mean radius 6,371,008.8 m over the candidates | R for the arithmetic | Distances in meters. An IP-derived point is coarse (H; inference, its accuracy is the network note's subject [S2]); GPS carries its own accuracy radius, which the check should add to the item's radius or report (inference) |
| `browser-fingerprints`, `device-fingerprints` | trim; hex lower-cased when the value is hex | HMAC `openverify/list-browser-fingerprint/v1`, `.../list-device-fingerprint/v1` | equality | R as an equality, **H** as a claim about devices | Identical devices and browsers can share a fingerprint, and one device's fingerprint drifts with updates (inference; the collector's stability is the client-signals note's subject [S3]); "near" fingerprints (component similarity) are H only |
| `fields` | by the field's declared type: string rule; number as a canonical decimal string; date as ISO `YYYY-MM-DD`; boolean `true`/`false` | HMAC `openverify/list-field/v1` over `<field key>\|<canonical value>` | equality | R | The field key belongs to the list (the behaviour note [S1]) |
| `faces` (ours) | an L2-normalised SFace embedding (`sface-2021dec`) | a sealed template per item (section 2.3) | cosine in the worker against the decrypted list | R (model-based, calibrated), advisory | See 2.3 for the false-match arithmetic and consent |
| `selfie-backgrounds` (ours) | the Phase 4 layout (48 cells × mean Lab, `vector(144)`), valid cells, coverage | vector plus a sealed, person-masked background image | nearest vectors, then ORB + RANSAC confirmation through vision `/v1/compare/background` (at most five candidates) [R11] | R arithmetic, `beta`, advisory | Virtual backgrounds defeat it, as Phase 4 documents [R11] |

### 2.2 Measured costs on the pinned image (synthetic data, warm cache) [M1]

| Operation | Size | Result |
|---|---|---|
| CIDR containment, GiST `inet_ops` | 400,003 random ranges (IPv4 /16–/32, IPv6 /64–/96) | index scan, 0.27 ms (IPv4 probe), 0.15 ms (IPv6 probe) |
| CIDR containment, SP-GiST `inet_ops` | same | index scan, 0.04 ms; index 18 MB |
| CIDR containment, no usable index (the `btree_gist` default class) | same | parallel sequential scan, 22 ms |
| Radius, full haversine scan | 100,001 points with their own radius (100 m–50 km) | 30 ms |
| Radius, shared box from the largest radius + btree `(lat, lon)` | same | 0.09 ms, but only valid when the list's largest radius bounds the box |
| Radius, per-item `box` + GiST, probe as a degenerate box | same | 0.24 ms (a probe written as `box @> point` did not use the index; `box @> box(p, p)` did) |
| Radius, `earthdistance` cube GiST | same | 0.33 ms; needs a superuser to install (below) |
| Antimeridian | same | 228 of 100,001 per-item boxes crossed ±180°: such an item needs two box rows (inference) |

**`earthdistance` is not a good fit.** In the pinned image it is `earthdistance 1.2` and requires `cube 1.5`; `cube`, `pg_trgm`, `fuzzystrmatch` and `btree_gist` are marked trusted, `earthdistance` is not, so a non-superuser database owner gets "permission denied to create extension" (measured [M1]; the contrib appendix lists the trusted modules [P7]). Its radius is `earth()` = 6,378,168 m, a sphere the documentation lets you change, and it warns about schema hazards when its schema is writable by untrusted users [P5]. Paris to London came out 343,943 m with it and 343,557 m with a haversine on the IUGG mean radius (0.11% apart) [M1]. Plain SQL in core Postgres (a `box` GiST prefilter and a haversine) is as fast and needs no extension. Licence: every module here is part of PostgreSQL, under the PostgreSQL License ✅ [P8].

### 2.3 Face lists

- **What an item holds.** A sealed copy of an SFace template with its model id and provenance (the source inquiry or an uploaded image), never a pointer to `face_templates`. Phase 4 writes a template only for a passed selfie with matching consent and deletes it when an operator declines the inquiry [R10][R11], which is exactly the inquiry a fraud analyst would add to a face list (owner decision 14 there already points at Phase 7 [R11]). So "add this inquiry's face to a list" must embed the centre selfie again through vision `/v1/embed/face` while the file still exists, inside the same transaction order as the decline (inference).
- **Cost.** Phase 4 measured about 2.1 s to decrypt and score 50,000 sealed templates on the development CPU [R11]; a list of 5,000 is therefore about 0.2 s per probe (inference: linear). A per-process cache keyed by `(list id, version)` removes the decryption from repeated probes, at the cost of plaintext templates in worker memory, which the Phase 4 scan already accepts.
- **False matches grow with the list.** Phase 4's calibration report gives, on studio portraits, the expected false matches of **one** search: at the shared 1:1 threshold 0.394, 0.76 per 1,000 templates and 7.57 per 10,000; at the repeat threshold 0.5, 0.04 per 10,000 (up to 0.24) [R16]. A face list must therefore use the repeat threshold or stricter, cap its size (for example 10,000 items; ours), be advisory (review, never decline), and state in the result how many templates were compared.
- **No ANN index.** Phase 4's privacy review found a keyed rotation inside a pgvector index probably recoverable from the database and the public model, and left an ANN mode to Phase 7 with that finding [R11]. List sizes small enough to scan make the question moot; keep the sealed scan (recommendation).
- **Consent and law (inference; not legal advice).** Face templates are biometric data processed to identify a person, a special category under GDPR Art. 9(1); lifting the prohibition needs explicit consent, a legal-claims basis, or substantial public interest under Union or Member State law (Art. 9(2)(a), (f), (g)) [L2]. The listed person's basis differs from the probed person's: the probed person's `consent.biometric-matching` can gate the check (answer `not_applicable`/`not_consented` without it, as Phase 4 does [R11]); the listed person, typically a suspected fraudster, never consented to being listed. Only the operator can choose that basis, so face lists should ship disabled behind an explicit acknowledgement setting, as Phase 6 did for GDELT [R8].

### 2.4 Selfie-background lists

- **Why the vector is not enough.** The Phase 4 check uses the 144-value layout only to find candidates, then confirms them with ORB + RANSAC on the stored centre images [R11]. A list item therefore needs an image to confirm against. Storing the whole selfie would keep a face; storing the background with the person masked out (vision already masks the person from YuNet's box for the comparison [R11]) keeps only what the check reads (inference).
- **Index.** Lists are small, so an exact scan of `vector(144)` rows is enough; the HNSW index on `selfie_backgrounds` can be reused for "background seen in other inquiries", which is the Phase 4 check, not a list.
- **Limits.** Advisory, `beta`; virtual and blurred backgrounds defeat it; a common office or a stock wallpaper matches many honest people (inference).

## 3. Storing list values that are PII (blind indexes and what they rule out)

### 3.1 What is personal data here

Emails, phone numbers, names, document numbers, fingerprints and IP addresses identify or single out people; GDPR Recital 30 names IP addresses and cookie identifiers among the online identifiers that can be combined into profiles [L1]. Geolocations are location data; face templates are biometric data (Art. 4(14), Art. 9) [L2][L3]; backgrounds show a person's surroundings. Strings and fields are unknown content, so they are treated as PII. Countries are not. Rule 3 requires PII to be encrypted at rest [R2], and the repository already gives every sealed value its own DEK under the KEK with a row-bound AAD [R6][R9].

### 3.2 The construction

- **Exact types.** Seal the item as entered (`value`, for display and re-indexing); store `match_key = HMAC-SHA-256(environment subkey, "<label>|<normalised value>")` as 32 raw bytes; index `(environment_id, list_id, match_key)`. This is the existing construction with new labels [R5], so the same value in two environments gives unrelated keys, and `blind-index:rebuild` gains a `rebuildListIndexes` step that recomputes keys from the sealed values (as Phase 6 does for its own indexes from stored values only [R8]).
- **Cost (measured).** Normalising, HMAC-ing and sealing one value took about 35 µs on one Node 22 thread (3.5 s per 100,000 rows), and the stored envelope plus key averaged 191 bytes per row [M2]. Import cost is dominated by this and by the inserts, not by parsing.
- **CIDR ranges.** A range must be plaintext for `>>=`. A range names a network rather than a person when it is wider than a single host (inference), so: single addresses go to the HMAC path; ranges with a prefix shorter than the host length (for example ≤ /31 for IPv4 and ≤ /127 for IPv6; the threshold is an owner decision) go to a plaintext `cidr` column with GiST `inet_ops` or SP-GiST. The sealed item stays the record of what the operator entered.
- **Geolocations.** A plaintext bounding box rounded outward to 0.01° (about 1.1 km of latitude) is enough for a GiST prefilter; the worker opens the few candidates' sealed exact points for the haversine (inference). A database reader then learns an area to about a kilometre, not the point.
- **Fuzzy names, faces, backgrounds.** No deterministic index can serve them without revealing the values' structure. The worker opens the list's sealed values and matches in memory, with a cache keyed by `(list id, version)`, a cap per list, and the count compared recorded on the result. Phase 6 builds its reverse index the same way, in worker memory, in bounded chunks [R8].

### 3.3 What an HMAC index rules out, and how each need is met

| Need | Why an HMAC cannot serve it | What to do instead |
|---|---|---|
| Containment (CIDR) | Hashes of `192.0.2.5` and `192.0.2.0/24` are unrelated | Plaintext `cidr` for ranges only (3.2) |
| Radius | No order or distance survives a hash | Coarse plaintext box + sealed exact point (3.2) |
| Fuzzy or partial names, typos | Only byte-equal normalised inputs collide | Decrypt in the worker (3.2); or keyed retrieval keys (`HMAC(token)`, `HMAC(skeleton)`, `HMAC(group id)`) to fetch candidates before opening them, which leaks token equality and frequency to a database reader (inference) |
| Domain parents, class wildcards, name folds | One input gives one key | Several probe keys per input (2.1) |
| Case or format variants | Hash of `A` ≠ hash of `a` | Normalise before hashing, and version the normaliser |
| Operator search in the console ("find items like …") | No prefix or substring search | Exact lookup by a typed value only; list browsing opens sealed values page by page under `pii:view` (inference) |
| Copying a list to another environment | Each environment has its own subkey [R5] | Re-index on copy (open, re-key, re-seal) |

**The key is the real protection.** An HMAC hides a value only while `OPENVERIFY_BLIND_INDEX_KEY` stays secret. Phone numbers and document numbers come from small spaces: with the key, a database copy can be enumerated (Node computed about 284,000 HMAC-SHA-256 per second on one thread [M2], so 10^10 candidate numbers for one country code take about 10 core-hours, and far less with native code or a GPU; inference from that rate). The docs should say the blind index key deserves the same care as the KEK, and that equal keys still reveal that two rows share a value (frequency analysis), which is the purpose of the index.

## 4. CSV import and export

### 4.1 Public surface and what it leaves open

The public OpenAPI has importers for six list-item types (`importer/list-item/{email-addresses,geolocations,government-id-numbers,ip-addresses,names,phone-numbers}`), and the developer docs add a face-image importer, `importer/list-item/faces` (corrected in fact-check), plus `importers` and `importers/{id}`, `batch-jobs/{id}/errors`, and `importer-pipeline-run.*` events [R4]; the OpenAPI also has `importer-list-item-field` [O1]. Row and size limits, accepted encodings, the error format and partial-failure semantics are for the behaviour note [S1]; where it finds none they are **not documented**, and the values below are ours.

### 4.2 Pipeline (proposed)

1. **Upload** the file through the existing file path (envelope-encrypted object, sealed metadata) [R9]. The C12 idempotency plugin covers `POST` and `PATCH`, but it fingerprints a multipart body only when the route buffers it (`parseAs: 'buffer'`) and refuses a key on a multipart body the route streams [R19]. So either the import route buffers its upload (20 MB fits) or it accepts no `Idempotency-Key` and relies on the file-level key of step 5 (owner question 7). Record an importer row: list, type, options, the file's SHA-256, status (`pending` → `running` → `completed` | `errored`), counts, `created_by`.
2. **Job** (BullMQ, the worker): stream the object through decryption, then a strict decoder, then the CSV parser, then per-row normalisation (2.1), then batched writes. Nothing reads the whole file into memory.
3. **Two modes** (ours): `all-or-nothing` (default) writes rows into a per-import staging table and applies them in one transaction only when no row failed; `skip-invalid` applies the valid rows and reports the rest. Both end with the same counts: rows read, created, duplicate within the file, already present, invalid.
4. **Errors** are `{ row, column, code }` from a closed set (`invalid_encoding`, `missing_column`, `unknown_column`, `duplicate_column`, `row_limit_exceeded`, `record_too_large`, `field_count_mismatch`, `invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class`), capped at 1,000 per import, served through an errors route like the public `batch-jobs/{id}/errors` [R4]. **Values are never echoed**: csv-parse attaches the offending `record` to some errors (`CSV_RECORD_INCONSISTENT_FIELDS_LENGTH`, `CSV_RECORD_DONT_MATCH_COLUMNS_LENGTH`) [C1], so the job maps each error to its code and line and drops the object, and logs only codes and counts (rule 2's PII-redacted logging [R2]).
5. **Idempotency at three levels**: the request (`Idempotency-Key`, when step 1 buffers); the file (same list, options and SHA-256 within a window returns the existing importer, ours); the row (the partial unique index on `(environment_id, list_id, match_key) where archived_at is null` turns a repeated row into `already_present`). Ranges use the canonical `cidr` text and geolocations a canonical `lat,lon,radius` string rounded to 10⁻⁶ degree as their keys (inference).
6. **Events and audit.** An audit entry per import with counts only. Whether list or importer webhooks exist publicly is for [S1]; the surface index lists no `list.*` events [R4].

### 4.3 Limits and encodings (ours unless cited)

| Limit | Default | Why |
|---|---|---|
| File size | 20 MB | 100,000 rows of a few fields fit easily; the upload path already caps bodies |
| Rows | 100,000 per file (`to_line` set one above the cap, then `row_limit_exceeded`) | About 3.5 s of sealing and hashing [M2], plus inserts; a larger list is several imports |
| Record size | `max_record_size` 4,096 characters; csv-parse's default is unlimited, and its docs present the option as the guard against a wrong delimiter and against filling memory from an uncontrolled source [C1] | |
| Columns | a fixed header per type (for example `value`; `value,match-type`; `latitude,longitude,radius-meters`; `id-class,id-number`; `name-first,name-last`); unknown, missing or repeated columns refuse the file | Parity with the public attribute names [O1] |
| Field count | `relax_column_count: false` (the default) [C1] | A short or long row is an error, not a silent shift |
| Types | `cast: false`; every value stays a string and the type's normaliser decides | csv-parse's `cast` guesses types, which would turn `0012` into `12` [C1] |

**Encodings.** Accept UTF-8 with or without a BOM. csv-parse's `bom` option is off by default and its docs advise turning it on for UTF-8 input [C1]. Decode before parsing with a streaming `TextDecoder('utf-8', { fatal: true })`, which throws `ERR_ENCODING_INVALID_ENCODED_DATA` on an invalid byte (measured on Node 22.22.1 [M2]): an invalid file is refused with `invalid_encoding` instead of being imported with replacement characters. Node's decoder strips a leading BOM by default (measured [M2]), so strip it exactly once, in the decoder or in the parser. An explicit `encoding` parameter can admit legacy single-byte files: Node's built-in decoder (ICU 78.2 here) decoded `0x80 0xE9` as windows-1252 "€é" (measured [M2]), so `iconv-lite` (MIT, 0.7.3, 2026-07-03 [N16]) is needed only for an encoding outside the WHATWG set. csv-parse's own `encoding` option takes Node buffer encodings only and detects only UTF-8 and UTF-16LE BOMs [C1], which is a second reason to decode first. A UTF-16 BOM (`FF FE` or `FE FF`) is either decoded the same way or refused with a clear code (owner choice; default refuse).

### 4.4 Parser choice

| Package | Latest (date) | Newest passing ≤ 2026-10-13 | Licence at the release commit | Fit | Verdict |
|---|---|---|---|---|---|
| `csv-parse` | 7.0.3 (2026-09-25) | 7.0.3 | MIT, `adaltas/node-csv` at `594c646` [N12] | Node `Transform` stream; `bom`, `max_record_size`, `to_line`, `info` (line numbers), `relax_column_count`, `skip_records_with_error`; errors with codes [C1]; no dependencies | ✅ recommended |
| `csv-stringify` | 6.9.0 (2026-09-25) | 6.9.0 | MIT, same commit [N12] | Stream writer; `quoted`, `escape`, `cast`, and `escape_formulas` [C2] | ✅ recommended for export |
| `papaparse` | 5.7.0 (2026-08-24) | 5.7.0 | MIT at `555c1c1` [N13] | Browser-first, also streams in Node; a fine choice for a client-side preview in the console | ✅ (console preview only, optional) |
| `@fast-csv/parse`, `@fast-csv/format` | 5.0.8 (2026-10-05) | 5.0.8 | MIT at `4d44cec` [N14] | Streams; smaller option set | ✅ alternative |

All four have no runtime dependencies in the passing versions (registry metadata [N12]–[N14]).

### 4.5 Export and CSV injection

- **The risk.** A spreadsheet treats a cell that starts with certain characters as a formula, which can exploit the spreadsheet program, trick the user into ignoring warnings, or exfiltrate data from open sheets [W1]. List values are attacker-influenced (a fraudster chooses their email local part or a string field), so every export is exposed (inference).
- **Characters to neutralise.** OWASP's page (updated 2026-10-27) lists `=`, `+`, `-`, `@`, tab (0x09), carriage return (0x0D), line feed (0x0A), and the full-width `＝`, `＋`, `－`, `＠` that some locales also read as formulas. It adds that the field separators and quotes must be handled too, because an attacker can open a new cell mid-value [W1].
- **Recommended rule (inference, built on [W1]).** In our `cast` hook: quote every field, double every embedded `"`, and prefix a `'` to any string cell whose first character is in that list. `csv-stringify`'s built-in `escape_formulas` covers `=`, `+`, `-`, `@`, tab and carriage return with a leading `'` [C2], but not line feed or the full-width forms, so the hook is ours. E.164 phone numbers start with `+`, so every exported phone gets the prefix; the importer strips one leading `'` when the next character is in the list, so an export re-imports unchanged (documented).
- **Stated limits.** OWASP warns that Excel can drop quotes and escapes when a file is saved and re-opened, which re-arms an escaped formula; it describes a tab prefix inside the quoted field as an Excel-resistant alternative that leaves the tab in the data, and says no strategy is safe for every spreadsheet and every downstream parser [W1]. The docs repeat that.
- **Access.** Exports contain PII: masked by default; full values need `pii:view` and a `lists:export` scope (ours), produce an audit entry with counts, and are written to storage behind a short-lived link (inference).

## 5. The account graph

### 5.1 What to link, and how strongly

| Attribute kind | Source in OpenVerify | Key | Strength (inference) | Why |
|---|---|---|---|---|
| Document number | government ID extraction; chip DG1 | the existing C31.8 index and `chipDocumentNumberIndex` [R5] | strong | One document, one holder; a shared number is a repeat or a forgery |
| Chip signature | NFC read | `chipSodIndex` [R5] | strong | Same signed chip data |
| Face | face templates (with matching consent) | none (a similarity, not an equality) | strong, probabilistic | Needs a precomputed "same face" edge from the Phase 4 scan at the repeat threshold, with its score; never an equality key [R11][R16] |
| Phone | OTP-confirmed number (C55) or a typed field | HMAC of E.164 | strong when confirmed, weak when typed | Typing someone else's number costs nothing |
| Email | OTP-confirmed or typed | HMAC of the normalised address | as phone | as phone |
| Crypto wallet | signed-challenge ownership | `cryptoAddressIndex` [R5] | strong when proven | Ownership is proven by signature |
| Device fingerprint | Android device facts, web collector [S3] | HMAC | medium (H) | Identical models collide; values drift |
| Browser fingerprint | web collector [S3] | HMAC | weak to medium (H) | Same browser builds on the same hardware collide |
| Address | inquiry fields, documents | HMAC of a normalised address (the Phase 5 normaliser) | medium | Flats, shared houses, forwarding addresses |
| IP address | session IP | HMAC of the canonical address | **weak** | NAT, carrier NAT, VPN exits, offices, public Wi-Fi |

**Measured consequence of weak kinds.** In a synthetic graph of 1,000,000 accounts where every account has two addresses drawn at random from 300,000 (about 6.7 accounts per address), linking through IP values held by 2 to 50 accounts put **all 1,000,000 accounts in one connected component** (13 label-propagation passes, 193 s in SQL); the same graph linked only through email, phone, device and document gave 10,000 components of about 10 (the planted rings), in about 3.5 s [M1]. A random graph whose mean degree exceeds one has a giant component (inference: standard random-graph behaviour), so weak kinds must never be traversed freely: they are opt-in per query, depth-limited, and excluded from components.

### 5.2 Data structure

- **A bipartite attribute table, not account–account edges.** `graph_attributes (environment_id, kind smallint, value_key bytea(32), account_id, source_type, source_id, first_seen_at, last_seen_at)`, primary key `(environment_id, kind, value_key, account_id)` and an index `(environment_id, account_id)`. Pairwise edges would need `d(d−1)/2` rows for a value with `d` holders: the 20,000-account hub of the benchmark alone would be about 2×10⁸ rows (inference: arithmetic).
- **Degree.** `graph_value_degree (environment_id, kind, value_key, degree)` maintained by the writer in the same transaction, used to skip hub values at query time. Measured at 1,000,000 accounts and 6,000,000 attribute rows: the attribute table took 511 MB of heap and 642 MB of indexes (about 1.15 GB, roughly 190 bytes per row), and a degree row for each of the roughly 4.1 million values about 527 MB (measured before the IP attributes were redrawn, with a similar value count) [M1]. Storing degree rows only for values held by two or more accounts (absent means 1) would remove most of the degree table, since most values are unique (inference).
- **Keys.** Reuse the identifier keys the lists and repeat checks already compute (2.1, [R5]) instead of new graph labels, so a list hit joins the graph directly and `blind-index:rebuild` has one key per kind to recompute (inference; owner question 4). Store them as `bytea(32)`, as Phase 6 does [R8].
- **Consolidation and redaction.** Consolidation moves the absorbed account's rows to the survivor in the consolidation transaction (the accounts table already points absorbed accounts at the survivor [R12]); redaction of an inquiry or account deletes the rows it contributed and decrements degrees, under the existing lock order (inference).

### 5.3 Traversal: recursive CTE or breadth-first search

PostgreSQL 14 and later add `SEARCH { BREADTH | DEPTH } FIRST BY … SET …` and `CYCLE … SET … USING …` to recursive queries; the documentation explains that `CYCLE` tracks the path of each row to stop a path from revisiting itself, and that `UNION` drops only rows that duplicate earlier output [P6]. Both work on the pinned image (measured [M1]). Neither keeps a set of accounts already visited across paths, which a graph explorer needs.

Measured on the synthetic graph (1,000,000 accounts, 6,000,000 rows; one environment; warm cache) [M1]:

| Query | Result | Time |
|---|---|---|
| One hop: accounts sharing any value (degree ≤ 50) with one account | 21 rows, index-only scans | 0.25 ms |
| Breadth-first, visited set, strong kinds only, depth 3, seed in a planted ring | 9 accounts at depth 1, nothing further | 1.5 ms |
| Breadth-first, all kinds, fan-out cap 50, depth 1 / 2 / 3 | 17 / 144 / 1,184 accounts | 1.1 / 5.0 / 26.9 ms |
| Same, depth 4 | 9,430 accounts (8,246 new at depth 4) | 198 ms; with a 5,000-node cap, 245 ms and `capped` |
| Recursive CTE (`UNION`, `CYCLE`), fan-out cap 50, depth 3 | 4,396 rows for 1,184 distinct accounts | 48 ms |
| Same, depth 4 | 66,970 rows for 9,430 distinct accounts | 505 ms |
| Breadth-first, no fan-out cap, seed on the 20,000-account hub, depth 2 | — | cancelled by a 60 s `statement_timeout` |

**Reading.** The cost follows the number of accounts reached, not the size of the table, because every step is an index lookup (inference from the plans [M1]). The recursive CTE repeats work as depth grows (3.7× the distinct rows at depth 3, 7× at depth 4), so a hop-by-hop search with a visited set, run by the API in one read-only transaction with one parameterised statement per hop, is the better structure (recommendation). **Interactive limits** (ours): depth ≤ 3 by default, fan-out cap 50 per value, at most 2,000 accounts per result, `statement_timeout` 5 s; under those caps the database answered in under 30 ms at a million accounts [M1]. The binding limit is the screen: Cytoscape's own measurements put a canvas at about 20 frames per second for 1,200 nodes and 16,000 edges (section 6) [G2].

### 5.4 Alternatives

| Option | Licence | In the pinned image | Verdict |
|---|---|---|---|
| Apache AGE (openCypher on Postgres) | Apache-2.0 at `PG17/v1.7.0-rc0` [N17] ✅ | **No** (`age.control` absent [M1]) | ❌ for this stack: a custom image would replace `pgvector/pgvector:pg17`, which ADR 0001 and `CLAUDE.md` pin for compose and Testcontainers [R2][R18]; each session needs `LOAD 'age'` and `ag_catalog` on the `search_path` [N17], which fights connection pooling; it stores its own vertex and edge tables, duplicating `graph_attributes`; and Cypher text built from templates needs its own injection discipline (inference) |
| Precomputed connected components over strong kinds | — | yes (SQL or the worker) | ✅ as a signal (component id and size per account) and to bound explorer queries. Measured 3.5 s for a full pass at a million accounts [M1]. Merges on insert are cheap with union–find; deletions (redaction) need a rebuild, so a nightly rebuild plus incremental merges (inference) |
| Breadth-first search per query (5.3) | — | yes | ✅ default |

### 5.5 Graph queries and query templates

- **Public lifecycle.** `graph-queries` and `graph-queries/{id}` exist, with `graph-query.completed`, `.errored`, `.timed-out`, `.cancelled` and `.reran` events [R4][O1], so a graph query is an asynchronous object with a terminal status (inference). Its body and template model are for [S1].
- **Templates as data, compiled by us (recommendation).** A template is JSON validated by zod: seeds (account ids, or the accounts of an inquiry or a list match), allowed `kinds` (an enum subset), `max-depth` 1–3, `max-fan-out` ≤ 500, `max-nodes` ≤ 2,000, filters on account type, status, tags and creation window. Our code turns it into the fixed hop statement of 5.3 with every value bound (`kind = any($1::smallint[])`, `account_id = any($2)`); no SQL, Cypher or expression text ever comes from a caller. The run takes `SET LOCAL statement_timeout`, ends `timed-out` when it fires and `completed` with `truncated: true` when a cap binds, and stores a result snapshot (account ids, the kinds that link them, never values) with its own retention (ours, for example 30 days).
- **What a result means.** "Linked by a shared device" is evidence to review, not a finding; graph-derived checks (for example the size of an account's strong component) are H-tier, `beta` and advisory (ADR 0002 [R3]).

### 5.6 Bulk actions from the explorer

- **Actions** (inference): tag, set account status, add the selected accounts' values of one kind to a list (the server opens the sealed sources and re-keys them; nothing is copied from the client), run a report (Phase 6), open a case (Phase 8). Redaction is not a bulk action.
- **Authorisation.** The selection is resolved on the server as the intersection of the submitted ids with a stored graph-query result the caller may read, so graph read access cannot be used to act on arbitrary accounts; each action then checks its own scope (`accounts:write`, `lists:write`, `reports:write`, `cases:write`), not a generic graph right (inference).
- **Execution.** A preview with counts, then a confirmation carrying an `Idempotency-Key`; run as a batch job (the public `batch-jobs` paths and `batch-job.*` events exist [R4]); a cap per action (for example 500 accounts); per-account outcomes (a redacted or consolidated account is skipped and counted); one audit entry per action naming the graph query.

### 5.7 Privacy

- **A graph is profiling.** It evaluates people from their links (GDPR Art. 4(4) [L3]); a decision based solely on it with significant effects is restricted (Art. 22 [L4]); and a systematic, extensive automated evaluation is a listed case for a data protection impact assessment (Art. 35(3)(a)) [L5]. Shared devices or addresses also reveal family and household ties (inference). OpenVerify cannot decide the lawful basis; the docs say the operator needs a DPIA, and the product never auto-declines on a graph signal.
- **Masking.** The explorer shows kinds ("shares a phone number with 3 accounts"), never values, unless the operator holds `pii:view`; each unmask is audited.
- **Audit and retention.** Every graph query (actor, template, seeds, counts, truncation) and every bulk action is audited; results expire; attribute rows follow the retention and redaction of the inquiry or account that produced them.
- **Isolation.** Per-environment subkeys make a value in sandbox and production two unrelated keys [R5]; the graph is per environment by construction.

## 6. The graph explorer UI

### 6.1 Candidates

| Library | Latest / newest passing (≤ 2026-10-13) | Licence at the release commit | Size of the browser build (measured, [M3]) | Rendering | CSP findings (static scan, [M3]) | Verdict |
|---|---|---|---|---|---|---|
| **Cytoscape.js** | 3.34.4 (2026-10-15) / **3.34.3** (2026-09-07) | MIT [N1] | ESM minified 434,102 B, about 136 KB gzip; no dependencies | Canvas 2D; a WebGL mode since 3.31, announced as a preview whose options may change [G2] | One `Function("return this")()` inside a bundled global-object shim, reached only when neither `global` nor `self` exists, so never in a browser (inference from the minified code); a `Blob` only in image export; no `eval`, no workers | ✅ recommended (PLAN §3 already names it [R1]) |
| `cytoscape-fcose` + `cose-base` + `layout-base` | **2.2.0 / 2.2.0 / 2.0.1** (2021–2023) | MIT [N2] | 57 KB + 119 KB + 148 KB unminified | layout only | none found | ✅ recommended layout; the docs describe fCoSE as a faster CoSE-Bilkent with position, alignment and placement constraints [G1]. Last published 2023 (maintenance risk, inference) |
| `cytoscape-cose-bilkent` | **4.1.0** (2019-09-09) | MIT [N3] | 82 KB unpacked | layout only | — | ✅ but superseded by fCoSE; pulls the older `cose-base` 1.x |
| `cytoscape-cola` + `webcola` | **2.5.1** (2022) + **3.4.0** (2019) | MIT [N4] | 22 KB + 80 KB minified | layout only | none found | ✅; brings four d3 1.x packages |
| Built-in Cytoscape layouts (`cose`, `concentric`, `breadthfirst`, `grid`) | with the core | MIT | 0 | — | — | ✅; `breadthfirst` or `concentric` around the seed suit a depth-limited result (inference) |
| **sigma.js** + **graphology** | sigma 4.0.4 (2026-10-27) / **4.0.1** (2026-10-13 14:12 UTC) or **3.0.3** (2026-04-30); graphology **0.26.0** | MIT [N5][N6] | sigma 3.0.3 188 KB (47 KB gzip); graphology 74 KB (14 KB gzip) | WebGL first [G3] | `Blob` + `createObjectURL` only for SVG snapshot export; the ForceAtlas2 **worker** build creates its worker from a Blob URL built from the function's source (`helpers.createWorker`), so it needs `worker-src blob:`; the synchronous layout does not [M3] | ✅ the fallback for results above a few thousand nodes. sigma 4.0.1 was published on the cutoff day itself and the React bindings for 4 (`@react-sigma/core` 6.0.0, 2026-10-14) fail the age rule [N7]; pin sigma 3.0.3 with `@react-sigma/core` 5.0.6 if needed now |
| `force-graph` / `react-force-graph-2d` | **1.52.0 / 1.29.2** (2026-09) | MIT [N8] | 173 KB minified (56 KB gzip) | Canvas 2D with d3-force | six `innerHTML` writes (tooltips), so labels must be escaped before they reach it (inference); a lodash global shim like Cytoscape's | ⚠️ usable; fewer explorer features (selection boxes, compound nodes) |
| `@xyflow/react` | **12.12.0** (2026-09-24) | MIT [N9] | 233 KB ESM | React DOM nodes | none found | ✅ for the Phase 8 workflow editor (PLAN pairs it there [R1]); its performance guide is about memoising node components and collapsing large trees [G4], so it is not a fit for thousands of nodes (inference) |

### 6.2 Rendering limits

- **Cytoscape's own figures** (subjective, their hardware): about 1,200 nodes and 16,000 edges ran at about 20 frames per second on canvas and above 100 with WebGL; about 3,200 nodes and 68,000 edges ran at 3 and 10 [G2]. Their docs list the tuning that matters most: no animations, straight `haystack` edges (the default), solid edges, `pixelRatio: 1` on dense displays, no compound nodes; `hideEdgesOnViewport` and `textureOnViewport` are described as largely moot now [G1].
- **Our graph is sparse.** A depth-3 result with the 50-per-value fan-out cap had 1,184 accounts (5.3); with values drawn as their own small nodes (the bipartite view), or as labelled edges between accounts, the edge count stays within a small multiple of the node count (inference). So **2,000 nodes on canvas, WebGL off** is a safe default; above it, show components or the table only.
- **Layout cost** grows faster than rendering for force-directed layouts (inference); run fCoSE once per result with `animate: false`, and expand incrementally around the clicked node.

### 6.3 Accessibility

- A canvas graph is invisible to assistive technology. W3C's complex-image guidance asks for a two-part alternative, a short description that identifies the image and a long description that carries the essential information, and shows a table as the structured long description [A1].
- **Design (recommendation).** A "Table" view of the same result, always available and the default for keyboard and screen-reader users: one row per account (depth, the kinds that link it, the account it was reached from, status, a selection checkbox), plus a summary sentence ("23 accounts within 2 hops, linked by device and phone"). Selection is shared between table and canvas, and bulk actions work from either.
- WCAG 2.2 criteria that apply [A2]: 1.1.1 non-text content (the table and summary), 1.3.1 info and relationships, 2.1.1 keyboard (every action reachable without the canvas), 1.4.1 use of colour (kinds shown by shape and label as well as colour), 1.4.11 non-text contrast (node and edge strokes), 2.4.7 focus visible, and 2.5.7 dragging movements (dragging a node needs a single-pointer alternative, which the table gives).

### 6.4 Content Security Policy

The console sends only `frame-ancestors 'none'` today; a nonce-based script policy is planned [R15]. Cytoscape and fCoSE need no `'unsafe-eval'` and no worker; WebGL needs no CSP keyword (inference); sigma's ForceAtlas2 worker would need `worker-src blob:`, so use its synchronous layout or a bundled worker file instead (inference). The libraries set styles through the CSSOM (`element.style.…`), which a `style-src` policy does not govern, but any `setAttribute('style', …)` would need `'unsafe-inline'` (inference; a Playwright test under the target policy should confirm). Node labels are rendered on canvas, not as HTML, so masked labels cannot inject markup; tooltips built in React stay escaped (inference).

## 7. Transactions

### 7.1 Public identifiers this design has to carry

- **Objects and routes** [R4]: `transaction-types/{transaction-type-id}`; `transactions`, `transactions/{id}` and its `add-objects`, `remove-objects`, `add-relation`, `remove-relation`, `add-tag`, `remove-tag`, `set-tags`, `label` and `redact-biometrics` actions. The transaction type's id starts `txntp_` and its attributes are `name`, `created-at`, `updated-at` and `field-schemas[]` [O1].
- **Events** [R4][O1]: `transaction.created`, `.updated-fields`, `.status-updated`, `.labeled`, `.added-relation`, `.removed-relation`, `.redacted`, `.sentinel-session-processed`, and `transaction-type.deleted-field`.
- **Field-schema types** [O1] (15, a discriminated union on `type`): `array`, `boolean`, `choices`, `date`, `datetime`, `email-address`, `file`, `hash`, `integer`, `json`, `multi-choices`, `number`, `platform-file`, `string`, `relation-schema`. Every field schema has `key`, `label` and a `config` with `required`, `archived-at`, `deactivated-at`, `source-key-path` (the dotted path of the source field when the schema is an alias), `redaction-policy` (`none`: redactable, `never`: never redacted) and `write-policy` (`none`, `write_once`); both policies are open strings that may gain values [O1]. Type options [O1]:
  - `string`: `max-char-length`, `sanitize`, `default-value`;
  - `integer`, `number`: `min`, `max`, `default-value`;
  - `date`: `min-date`, `max-date`; `datetime`: `default-value`;
  - `choices`, `multi-choices`: `options`, `option-labels`, `allow-empty`, `default-value`;
  - `file`: `max-file-size-bytes`, `min-file-size-bytes`, `supported-mime-types`, `page-count-limit-enabled`, `page-count-min`, `page-count-max`;
  - `array`: `item-schema` (one field schema); `hash`: `item-schemas` (a list of field schemas) and `ignore-unknown-keys` (default false); `json`: `json-schema`;
  - `relation-schema`: `target`, one of `document-generic`, `document-government-id`, `document-government-id-nfc`, `document-mdoc`, `document-qr-code`, `selfie`.

**Correction to PLAN §2** [R1]. Its list "bool/date/file/float/hash/int/string/choices/array" uses names that are not the public identifiers (`boolean`, `number`, `integer`) and leaves out six types (`datetime`, `email-address`, `json`, `multi-choices`, `platform-file`, `relation-schema`). More importantly, **`hash` is a nested object, not a hashed value**: its options are field schemas for its keys and a flag for unknown keys [O1]. That fits "hash" in the Ruby sense of a key–value map (inference). Its purpose is to group sub-fields under one key, each validated by its own schema, for example a payment instrument's brand, last four digits and expiry, or a shipping address (inference). A keyed hash of a sensitive value is a separate need, met in 7.5.

### 7.2 Validating fields on the server

- **Recommendation: interpret the stored field schemas with zod, and never generate code from them.** A transaction type's schemas are operator data. Our code validates them against a zod meta-schema of the 15 types (with caps: at most 100 fields per type, nesting through `hash` and `array` at most 3 levels, at most 200 `options`, `max-char-length` at most 10,000, ours), stores them with a version, and builds the request validator by walking them: `string` to `z.string().max(n)`, `integer` to `z.number().int()` within `Number.MAX_SAFE_INTEGER` and `min`/`max`, `number` to a finite number, `date` and `datetime` to ISO strings checked as real calendar values, `email-address` through the 2.1 normaliser, `choices` to an enum (nullable when `allow-empty`), `multi-choices` to a unique array of that enum, `array` to an array of the item schema with a length cap, `hash` to an object of its item schemas, strict unless `ignore-unknown-keys` (then unknown keys are stripped), `file` and `platform-file` to file ids checked by the file service, `relation-schema` to the id of an object of the allowed `target` in the same environment. The built validator is cached by `(type id, version)`. zod 4.6.7 is already a direct API dependency [R13][N11]. Validation is plain data walking, so no schema can make the server run code (inference).
- **`z.fromJSONSchema()`** exists in zod 4 but its documentation calls it experimental and outside the stable API [V2]; do not build on it.
- **The one place a JSON Schema appears is the `json` type's `json-schema`.** ajv 8.20.0 (MIT [N10]) is already in the lockfile through `@fastify/ajv-compiler` [R14] and would become a direct, pinned dependency. Its security page says it treats schemas as trusted as application code; that untrusted schemas can overflow the stack when deep, compile slowly and validate slowly; that their size and depth should be limited and slow `pattern` and `patternProperties` regular expressions mitigated; that a "secure" meta-schema (`ajv/lib/refs/json-schema-secure.json`) checks some of these; that `ajv-formats` formats should be treated as potentially unsafe; and that a linear-time regex engine (its example is RE2, which carries a native component) removes ReDoS [V1]. An operator's schema is semi-trusted at best (inference). So: accept a `json-schema` only when it passes our own restricted meta-schema (types, `properties`, `required`, `items`, `enum`, numeric and length bounds; no `pattern`, `patternProperties`, `format`, `$ref`, `$data`, remote loading or `dependencies`), at most 16 KiB and depth 10 (ours), compile it once per type version on the server with `allErrors: false` and `strict: true`, and cap the `json` value's own size and depth. ajv compiles schemas to JavaScript functions, which browsers allow only with `'unsafe-eval'`, its page notes [V1]; this runs only in the API, never in the console.
- **`sanitize`** on strings is **not documented** beyond its name [O1]; until [S1] says more, treat it as trimming and control-character removal (inference), and never as HTML sanitising, since the console escapes output anyway.

### 7.3 Statuses, labels, relations and objects

- **Statuses** (`transaction.status-updated` [R4]): a per-type list of snake_case statuses with an initial one (the public semantics and any transitions are for [S1]); a status change is a row in an append-only history with actor and time (inference).
- **Labels** (`transactions/{id}/label`, `transaction.labeled` [R4]): an outcome recorded later, such as a confirmed fraud or a chargeback (inference). Keep every label as history, never overwritten: labels are the ground truth that any later calibration of transaction signals would need (inference).
- **Relations and objects**: join tables with composite foreign keys to `(environment_id, id)` of each side, as Phase 6's `report_accounts` [R8]; `relation-schema` fields point only at documents and selfies of the listed `target` kinds [O1].

### 7.4 Files and biometrics

- **`file` fields** reuse the file path: upload, envelope encryption per object [R9], the per-type `max-file-size-bytes`, `min-file-size-bytes` and `supported-mime-types` [O1] checked on the server against the bytes' signature rather than the declared type, and the PDF page count from the Phase 5 document parser when `page-count-limit-enabled` (inference). `platform-file` presumably references a file the platform already holds (inference; [S1]).
- **`redact-biometrics`** (path [R4]): because `relation-schema` can point at a `selfie` or an identity document [O1], a transaction can carry biometric captures; the action presumably removes those captures and their derived data while keeping the business record (inference). Our version: in one transaction under the Phase 4 lock order, delete the related selfies' files, `face_templates` and `selfie_backgrounds` rows and any document portrait crops, set `biometrics_redacted_at`, and write an audit entry; whether a dedicated event exists is **not documented** in the surface index (only `transaction.redacted` [R4]).

### 7.5 Storage, query indexes and keyed values

- **Tables (proposed).** `transaction_types` (`txntp_`, environment-scoped, `name`, the current schema version, statuses, `archived_at`); `transaction_type_versions` (immutable field schemas, so a transaction keeps the schema it was written under, and a deleted field, `transaction-type.deleted-field` [R4], leaves old values interpretable; inference); `transactions` (type, version, `reference_id` unique per environment, status, `fields` sealed JSON with row AAD [R6], tags, `created_at`, `redacted_at`, `biometrics_redacted_at`); status and label histories; the join tables of 7.3.
- **Indexes.** `(environment_id, created_at desc, id desc)`; `(environment_id, transaction_type_id, status, created_at desc)`; unique `(environment_id, reference_id)`; tags GIN, as for accounts [R12]. Sealed fields cannot be indexed [R9], so field search is equality only, through `transaction_field_keys (environment_id, transaction_id, field_key, value_key bytea(32))` for fields an operator marks `searchable` (ours), HMAC under the environment subkey [R5]. The same keys can feed the graph (5.2) as a "payment instrument" kind. Numeric range queries over sealed amounts are not offered in Phase 7 (inference); a field the operator declares non-personal could later get a plaintext projection.
- **Payment card numbers.** PCI DSS v4.0 requirement 3.5.1.1 (in force since 1 April 2025) requires hashes used to make a PAN unreadable to be keyed cryptographic hashes of the entire PAN, with key management under requirements 3.6 and 3.7, and names HMAC among the acceptable constructions (read through a QSA firm's summary, not the standard itself) [L6]. Our HMAC-SHA-256 under the environment subkey is such a construction, but storing or hashing PANs brings the install into PCI scope (inference). The docs should tell operators to send a processor's token or card fingerprint, never a PAN; a server check refusing 13–19-digit strings that pass the Luhn check in `string` fields would catch mistakes (inference; owner question 9).

### 7.6 Write policy, redaction and retention

- `write-policy: write_once` rejects a second write of that field with a 409 problem; `redaction-policy: never` keeps the field through redaction [O1]. A `never` field must not hold personal data, so refuse `never` on `email-address`, `file`, `platform-file`, `relation-schema` and `hash` fields (ours, inference).
- **Retention** (ours, mirroring Phase 6 C73.6 [R8]): an environment setting `transaction-retention-days` (1–3,650 or null) enforced by redaction, never deletion: sealed fields, files and field keys nulled, `redacted_at` set, `transaction.redacted` emitted once [R4].

## 8. Tiers and limits

Tiers follow ADR 0002 [R3]: R is deterministic or a calibrated open model; H ships `beta` with a confidence and reasons; A is an adapter with a deterministic sandbox provider.

| Capability | Tier | Confidence and reasons | What it cannot tell (stated in the docs) |
|---|---|---|---|
| Exact list match: strings, emails (address and domain with parents), phones (E.164), document numbers (class or wildcard), fields, countries, exact normalised names | **R** | none needed; the reason names the list, the item and the probe's source | A match means the normalised values are equal, nothing more; a typed (unconfirmed) phone or email can belong to someone else |
| IP list: single address and CIDR range | **R** | — | Says nothing about who used the address; shared addresses (carrier NAT, VPN exits, offices) match many people. A probe's country or VPN status comes from the network note's sources [S2] |
| Geolocation list (point and radius, meters) | **R** for the arithmetic | the distance and the probe's own accuracy | The result is as good as the probe: GPS accuracy varies and can be spoofed on a device; an IP-derived location is coarse (inference; [S2]); address geocoding needs an adapter (A) because no permissive global geocoding data ships [R17] |
| Country list against an IP-derived country | **H** (via the source) | the source's accuracy | IP country is wrong for VPNs, roaming and corporate egress |
| Fuzzy name list match | **H**, `beta` | the C78 score and its components [R8] | Recall on real names is unmeasured; transliterated and lossy scripts are flagged as in Phase 6's `coverage` |
| Browser and device fingerprint list match | **R** as equality, **H** as "same device" | stability notes from [S3] | Identical devices collide; values drift with updates; a determined user resets them |
| Face list match | **R** (model-based, calibrated threshold), advisory | the best cosine, the count compared, the threshold | False matches grow with list size: about 0.04 expected per search over 10,000 templates at the 0.5 threshold, 7.57 at 0.394 (studio portraits) [R16]; never a decline on its own |
| Selfie-background list match | **R** arithmetic, `beta`, advisory | inliers and inlier ratio | Virtual or blurred backgrounds defeat it; common rooms match honest people |
| Graph links and component size | **H**, `beta`, advisory | the kinds, the strength class (5.1), the counts | Shared weak attributes link strangers; with IP included, a random million-account graph was one component [M1] |
| Commercial device-reputation or consortium data (shared fraud lists across companies) | **A** | provider's | OpenVerify ships no such data; an adapter with a sandbox provider only (rule 5 [R2]) |
| Transaction field validation | not a check | — | Validates shape, not truth |

**Limits to state in the docs and the API** (defaults ours): 100,000 rows and 20 MB per import; 4,096 characters per CSV record; face lists capped at 10,000 items and disabled until acknowledged; geolocation radius ≤ 500 km; graph depth ≤ 3, fan-out ≤ 50 per value by default (≤ 500), ≤ 2,000 accounts per result, 5 s statement timeout; ≤ 500 accounts per bulk action; transaction types ≤ 100 fields, nesting ≤ 3, `json-schema` ≤ 16 KiB.

## 9. Sources and pins

Every source was read on **2026-10-27**. Robots files were read first for each host: `www.postgresql.org`, `owasp.org`, `csv.js.org`, `zod.dev`, `age.apache.org`, `www.sigmajs.org`, `reactflow.dev`, `www.w3.org`, `gdpr-info.eu` and `www.usd.de` allow the pages used; `github.com` disallows `/*/raw/`, `/*/tree/` and commit listings but not release pages; `registry.npmjs.org`, `raw.githubusercontent.com`, `cdn.jsdelivr.net`, `data.jsdelivr.com`, `js.cytoscape.org`, `blog.js.cytoscape.org` and `ajv.js.org` publish no robots file. My downloads total about 8.2 MB, under `downloads/{npm,licenses,bundles,pgdocs,age,owasp,csvjs,validators,graphdocs,a11y,privacy}/`; scripts are in `scripts/`.

**Repository (R)**, read-only at the working tree of 2026-10-27 (`fe4850ca` plus Phase 6 work in progress)
- [R1] `docs/PLAN.md` §2 (Lists, Graph, Transactions rows), §3 (technology table: browser fingerprint, IP intel, graph UI), §4.1, §4.2, §4.4, §6 Phase 7
- [R2] `CLAUDE.md` rules 2–5
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (list-item types; importer, graph-query, transaction, transaction-type, batch-job paths; `graph-query.*`, `transaction.*`, `transaction-type.deleted-field` events; report type `custom-list`)
- [R5] `packages/db/src/blind-index.ts`
- [R6] `packages/db/src/sealed.ts`
- [R7] `packages/db/src/tables/government-id-extractions.ts` (the `text` hex index and its partial index)
- [R8] `docs/plans/phase-6.plan.md` C73 (storage, 32-byte HMACs, redaction, retention, Postgres logging), C76 (sync pattern), C78 (matcher, reverse index in worker memory), C85.1 (streaming outbound client), C88 (custom-list deferred to Phase 7)
- [R9] `packages/db/src/crypto.ts` (per-value DEK, envelope `ov1`)
- [R10] `packages/db/src/tables/selfie.ts` (`face_templates`, `selfie_backgrounds`)
- [R11] `docs/plans/phase-4.plan.md` C41.2, C42, owner decisions 3 and 14
- [R12] `packages/db/src/tables/{accounts,inquiries,tenancy,audit-logs,platform}.ts`
- [R13] `apps/api/package.json` (`zod` 4.6.7, Fastify 5.12.7)
- [R14] `pnpm-workspace.yaml` (catalog, `libphonenumber-js` 1.13.14) and `pnpm-lock.yaml` (`ajv@8.20.0` via `@fastify/ajv-compiler@4.0.7`; no CSV or graph library)
- [R15] `apps/dashboard/next.config.ts` (CSP `frame-ancestors 'none'` only) and `apps/dashboard/package.json` (Next 16.4.x, React 19.3.x)
- [R16] `docs/calibration/selfie-phase4.md` (thresholds 0.394 and 0.5; 1:N expected false matches)
- [R17] `docs/research/phase6-data-sources.md` §10.3 (geocoding is an adapter; OSM data is ODbL)
- [R18] `docs/adr/0001-stack.md` (compose services table: `pgvector/pgvector:pg17`)
- [R19] `apps/api/src/plugins/idempotency.ts` (C12: `POST` and `PATCH`; multipart fingerprinting needs a buffered body; a key on a streamed multipart body is refused)

**Sibling notes (S)** in `resume/phase7-research/`, read for scope only: [S1] `phase7-behaviour.md`; [S2] `phase7-network-data.md`; [S3] `phase7-client-signals.md`.

**Public OpenAPI (O)**
- [O1] `github.com/persona-id/persona-openapi`, directory `2026-09-29/` (tree `c30a98bcff4b629172eebd28706ff61c948b8d90`), read from the behaviour note's local copy `downloads/behaviour-openapi-e64dbfb/`, whose files match the tree's blob hashes (checked for `components/schemas/field-schema-hash.yaml` `bfa062b9…` and `transaction-type.yaml` `0fa5707a…`): `paths/list-item_*.yaml`, `components/schemas/importer-list-item-*.yaml`, `components/schemas/field-schema*.yaml`, `components/schemas/transaction-type.yaml`, `webhooks/graph-query.*.yaml`, `webhooks/transaction*.yaml`. The copy's directory name records the commit prefix `e64dbfb`; the full commit pin belongs to [S1] and was not found in its text at the time of reading (a gap). Identifiers only; the blob-hash check ties these files to the published tree whatever the commit.

**Measurements (M)**, synthetic data only
- [M1] The pinned image `pgvector/pgvector@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d` (created 2026-10-01; PostgreSQL 17.11 on Debian 12; extensions shipped include `cube` 1.5, `earthdistance` 1.2, `pg_trgm` 1.6, `fuzzystrmatch` 1.2, `btree_gist` 1.7, `vector` 0.8.7; no `age`, no `postgis`), run as a throwaway container with `--network none` on a 12-thread, 31 GB WSL2 machine. Scripts `scripts/01-operators.sql` to `08-components-strong.sql`.
- [M2] Node 22.22.1 (ICU 78.2): `scripts/seal-hmac-bench.mjs` (35 µs per row, 191 bytes per row), a one-line HMAC rate test (283,542 per second, one thread), `TextDecoder` checks.
- [M3] `scripts/csp_scan.py` over the bundles in `downloads/bundles/` (static text scan, nothing executed).

**PostgreSQL documentation (P)**, version 17
- [P1] https://www.postgresql.org/docs/17/functions-net.html
- [P2] https://www.postgresql.org/docs/17/gist.html (§64.2: the core `inet_ops` class is not the default GiST class for `inet` and `cidr`, for historical reasons, so an index must name it)
- [P3] https://www.postgresql.org/docs/17/spgist.html
- [P4] https://www.postgresql.org/docs/17/btree-gist.html
- [P5] https://www.postgresql.org/docs/17/earthdistance.html
- [P6] https://www.postgresql.org/docs/17/queries-with.html (§7.8.2.1 search order, §7.8.2.2 cycle detection)
- [P7] https://www.postgresql.org/docs/17/contrib.html (trusted extensions)
- [P8] https://www.postgresql.org/about/licence/

**Packages (N)**: registry metadata `https://registry.npmjs.org/<name>` and the LICENSE at the release commit `https://raw.githubusercontent.com/<repo>/<commit>/<file>`
- [N1] `cytoscape` 3.34.4 (2026-10-15) / **3.34.3** (2026-09-07), MIT, `cytoscape/cytoscape.js` `716a1cb6c6015d57b674abe626deaeb5e817ee30` LICENSE (SHA-256 `eb319c6e…`); `dist/cytoscape.esm.min.mjs` 434,102 B (about 135.7 KB gzip, [M3])
- [N2] `cytoscape-fcose` **2.2.0** (2023-01-17), MIT, `iVis-at-Bilkent/cytoscape.js-fcose` `78afcf96512a409abc903699277ad616c02dfad9`; `cose-base` **2.2.0** (2023-01-17), MIT, `37f07ed2b8803211ec6c74110574cc47c156a136`; `layout-base` **2.0.1** (2021-06-25), MIT, `3f7549940feef31416cc35ef8256282ebc4d1ecd`
- [N3] `cytoscape-cose-bilkent` **4.1.0** (2019-09-09), MIT, `cytoscape/cytoscape.js-cose-bilkent` `999090a8438b4f14788d636ef4fd7a5355e29e8c`
- [N4] `cytoscape-cola` **2.5.1** (2022-02-23), MIT, `cytoscape/cytoscape.js-cola` `e18af30407422c2b6fade8764521673da29d908b`; `webcola` **3.4.0** (2019-05-10), MIT, `tgdwyer/WebCola` `ebfc1eab0c8c5ef5a18e2eebf7a97bdc4b771b2a` (depends on `d3-dispatch`, `d3-drag`, `d3-timer`, `d3-shape` 1.x)
- [N5] `sigma` 4.0.4 (2026-10-27) / **4.0.1** (2026-10-13T14:12Z, on the cutoff day) / 3.0.3 (2026-04-30), MIT, `jacomyal/sigma.js` `d452af92d3a05a71de847d07c0878707d7f5ecf7` LICENSE.txt
- [N6] `graphology` **0.26.0** (2025-01-26), MIT, `graphology/graphology` `feb3e5c37e791d75f3dab185a56cb25d32c17de7` LICENSE.txt; `graphology-layout-forceatlas2` **0.10.1** (2022-10-17), MIT, same repository
- [N7] `@react-sigma/core` 6.0.0 (2026-10-14, peer `sigma ^4.0.0`) / **5.0.6** (2025-12-01, peer `sigma ^3.0.2`), MIT
- [N8] `force-graph` **1.52.0** (2026-09-28), MIT, `vasturiano/force-graph` `0f059c894bf5b7504460b7028b00bc6e4d95f0d9`; `react-force-graph-2d` **1.29.2** (2026-09-29), MIT, `vasturiano/react-force-graph` `d59a72d24d310567a05d1622fd1f9f2fd13bc8fd`
- [N9] `@xyflow/react` **12.12.0** (2026-09-24), MIT, tag `@xyflow/react@12.12.0` LICENSE (copyright webkid GmbH)
- [N10] `ajv` **8.20.0** (2026-04-24), MIT, `ajv-validator/ajv` `0fba0b8e649909613cfce0999b149cd08f4a4987`
- [N11] `zod` **4.6.7** (2026-10-12), MIT, `colinhacks/zod` `b500a2ee95134f81d74da7911d7378dd2853d042`
- [N12] `csv-parse` **7.0.3** and `csv-stringify` **6.9.0** (both 2026-09-25), MIT, `adaltas/node-csv` `594c6469c4a7376c1048d13c47859c2f91674206` (root LICENSE)
- [N13] `papaparse` **5.7.0** (2026-08-24), MIT, `mholt/PapaParse` `555c1c1b6175e7a043adf8694983776a1e6fdeeb`
- [N14] `@fast-csv/parse` and `@fast-csv/format` **5.0.8** (2026-10-05), MIT, `C2FO/fast-csv` `4d44cec696b39c18d45106d85adefbbfa5087e51`
- [N15] `ipaddr.js` **2.5.0** (2026-08-04), MIT, `whitequark/ipaddr.js` `dc55282780d8702bac31ef012ca52e4a77fbca1f`
- [N16] `iconv-lite` **0.7.3** (2026-07-03), MIT (registry metadata; LICENSE not fetched)
- [N17] Apache AGE: release list https://github.com/apache/age/releases (PG17 line: v1.6.0 on 2025-09-22, v1.7.0 on 2026-02-11; PG18 line v1.8.0 on 2026-07-09; dates read from the page's release timestamps); LICENSE Apache-2.0 at tag `PG17/v1.7.0-rc0` (SHA-256 `59749908…`); README at the same tag (supports Postgres 11–18; setup `CREATE EXTENSION age; LOAD 'age'; SET search_path = ag_catalog, …`)

**CSV (C) and OWASP (W)**
- [C1] https://csv.js.org/parse/options/ , `…/options/bom/`, `…/options/max_record_size/`, `…/options/encoding/`, `…/options/skip_records_with_error/`, https://csv.js.org/parse/errors/ (pages last modified 2026-09-23)
- [C2] https://csv.js.org/stringify/options/ (`escape_formulas`)
- [W1] https://owasp.org/www-community/attacks/CSV_Injection (Last-Modified 2026-10-27)

**Validators (V)**
- [V1] https://ajv.js.org/security.html (Last-Modified 2026-04-24: untrusted schemas, trusted-schema risks, the secure meta-schema, ReDoS and RE2, `ajv-formats`, CSP)
- [V2] https://zod.dev/json-schema (`z.fromJSONSchema()` marked experimental; `z.toJSONSchema()` targets)

**Graph libraries (G)**
- [G1] https://js.cytoscape.org/ (Last-Modified 2026-10-15: Performance section, rendering hints, `haystack` edges, the fCoSE layout entry)
- [G2] https://blog.js.cytoscape.org/2025/01/13/webgl-preview/ and https://blog.js.cytoscape.org/2025/01/13/3.31.0-release/ (WebGL preview in 3.31; frame-rate figures; edge-style limits; provisional options)
- [G3] https://www.sigmajs.org/ (WebGL rendering on graphology)
- [G4] https://reactflow.dev/learn/advanced-use/performance

**Accessibility (A)**
- [A1] https://www.w3.org/WAI/tutorials/images/complex/ (Last-Modified 2026-10-23)
- [A2] https://www.w3.org/TR/WCAG22/ (anchors `#non-text-content`, `#info-and-relationships`, `#keyboard`, `#use-of-color`, `#non-text-contrast`, `#focus-visible`, `#dragging-movements`)

**Privacy and payments law (L)** (GDPR read through gdpr-info.eu's consolidated text; not legal advice)
- [L1] GDPR Recital 30, https://gdpr-info.eu/recitals/no-30/
- [L2] GDPR Art. 9, https://gdpr-info.eu/art-9-gdpr/
- [L3] GDPR Art. 4 (4) profiling and (14) biometric data, https://gdpr-info.eu/art-4-gdpr/
- [L4] GDPR Art. 22, https://gdpr-info.eu/art-22-gdpr/
- [L5] GDPR Art. 35, https://gdpr-info.eu/art-35-gdpr/
- [L6] PCI DSS v4.0 requirement 3.5.1.1, through a QSA firm's summary that quotes it: https://www.usd.de/en/pci-dss-v4-0-keyed-cryptographic-hashes/ (secondary; the standard itself sits behind the PCI SSC document library's licence agreement and was not read)
- Not read: the Illinois Biometric Information Privacy Act (`www.ilga.gov` failed TLS verification from this host), so section 11 item 1 names it without a citation.

## 10. What Phase 7 should take from this (proposed)

1. **One list model.** `lists` (with a `version` counter) and `list_items` (sealed `value`, 32-byte `match_key`, `normaliser_version`, soft archive) plus side tables for ranges, geolocations, faces and backgrounds (2.0). A partial unique index on the active `(environment_id, list_id, match_key)` makes imports idempotent.
2. **Per-type normalisers as pure functions in `packages/checks`**, written test-first with golden vectors, and a `LIST_KEYS_VERSION` that fails a golden test when output changes without a bump, as Phase 6's `keysVersion()` does [R8]. HMAC labels `openverify/list-<type>/v1` under the existing environment subkey [R5]; `blind-index:rebuild` gains `rebuildListIndexes` from sealed values.
3. **One matching service** (`matchLists`) used by the `custom-list` report, the list-match checks, `id_compromised_detection`'s organisation lists and, later, Phase 8 conditions; a list that could not be read answers `not_applicable` with a reason, never "no match".
4. **IP lists:** single addresses through the HMAC; ranges in a plaintext `cidr` column with **SP-GiST** (0.04 ms at 400,000 ranges) or GiST **`inet_ops` named explicitly**, and a migration test that asserts the operator class, because with `btree_gist` installed the default GiST class silently gives a sequential scan [M1][P2]. Fold IPv4-mapped IPv6 to IPv4 before indexing and probing.
5. **Geolocations without `earthdistance`** (not a trusted extension; superuser only [M1][P7]): a per-item `box` with GiST, coarsened to 0.01°, and a haversine on 6,371,008.8 m over the sealed exact points; split boxes that cross ±180°; meters everywhere.
6. **Face lists:** own sealed template copies, re-embedded from the centre selfie when an item is added (the Phase 4 template may be gone after a decline), the 0.5 threshold or stricter, at most 10,000 items, advisory only, the probed person's `consent.biometric-matching` required, and the feature disabled until the operator acknowledges the Art. 9 basis. No ANN index [R11][R16][L2].
7. **Selfie-background lists:** the 144-value layout plus a person-masked background image for the ORB confirmation; `beta`, advisory.
8. **CSV:** `csv-parse` 7.0.3 and `csv-stringify` 6.9.0 (MIT, no dependencies) through the pnpm catalog; strict streaming UTF-8 decoding before parsing; `bom: true`, `max_record_size: 4096`, `relax_column_count: false`, `cast: false`, `info: true`, `to_line` at the row cap; staging with all-or-nothing by default; error codes and line numbers only, never values; 100,000 rows and 20 MB per file.
9. **Export:** quote every field, double quotes, prefix `'` to cells starting with `=`, `+`, `-`, `@`, tab, CR, LF or their full-width forms (our `cast` hook; the built-in `escape_formulas` misses LF and full-width) [W1][C2]; the importer strips that prefix; exports masked by default and audited.
10. **Graph:** the bipartite `graph_attributes` table with a degree table; hop-by-hop breadth-first search with a visited set in one read-only transaction; default depth 2 (maximum 3), fan-out 50, 2,000 accounts, 5 s timeout; IP and browser-fingerprint kinds opt-in per query; connected components nightly over strong kinds only; graph queries as asynchronous objects with the public `graph-query.*` lifecycle; templates as zod-validated JSON compiled to fixed parameterised statements; no Apache AGE.
11. **Bulk actions** resolve the selection against a stored graph-query result, check each action's own scope, run as batch jobs with an `Idempotency-Key`, cap 500 accounts, and audit per action.
12. **Explorer:** Cytoscape.js 3.34.3 with `cytoscape-fcose` 2.2.0 (and its `cose-base` 2.2.0 and `layout-base` 2.0.1), canvas renderer, WebGL off while it is a preview, at most 2,000 nodes, masked labels, and a Table view with shared selection that meets the WCAG 2.2 criteria in 6.3; a Playwright test under the planned nonce CSP.
13. **Transactions:** the 15 public field-schema types and their options, validated by walking stored schemas with zod (no code generation); ajv 8.20.0 as a direct dependency only for `json` fields' `json-schema`, behind a restricted meta-schema and size and depth caps [V1]; immutable type versions; append-only status and label histories; `searchable` fields as keyed field indexes (usable as a graph kind); a PAN guard and PCI guidance; `redact-biometrics` over related selfies and document portraits; retention by redaction.
14. **Tiers and wording** as in section 8; every non-exact result carries its method, score and the count compared.
15. **Tests:** Testcontainers for the operator class, CIDR and IPv6 probes, radius at the antimeridian, breadth-first caps, timeouts and truncation on a synthetic graph (about 100,000 accounts in CI), import idempotency and the staging rollback, encoding refusals, CSV-injection golden vectors, consolidation and redaction of attribute rows; a 1,000,000-account benchmark script reported, not gated (as Phase 6 treats its 2,000,000-name case [R8]).
16. **Records to fix:** PLAN §2 Transactions row (the 15 type names; `hash` is a nested object); PLAN §3 graph UI row (add `cytoscape-fcose`); `THIRD_PARTY_LICENSES.md` rows for `cytoscape`, `cytoscape-fcose`, `cose-base`, `layout-base`, `csv-parse`, `csv-stringify` and `ajv` (MIT), and a note that `earthdistance` and Apache AGE are not used.

## 11. Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Face lists: biometric identification of people who never consented to being listed (GDPR Art. 9; BIPA was not re-read here) | **Ship disabled**; enabling needs an explicit acknowledgement setting naming the operator's lawful basis; advisory only; at most 10,000 items |
| 2 | Require the probed person's `consent.biometric-matching` for face and background list checks | **Yes**, as Phase 4 does for its gallery checks (`not_applicable`/`not_consented` otherwise) |
| 3 | Which IP list values may be stored in plaintext | **Ranges only** (IPv4 prefix ≤ /31, IPv6 ≤ /127); single addresses through the HMAC |
| 4 | One identifier key per kind shared by lists, graph and repeat checks, or separate labels per purpose | **Shared per kind** (fewer HMACs, one rebuild, direct joins); separate labels only if the owner wants purpose separation inside one environment |
| 5 | Weak kinds (IP, browser fingerprint) in the graph | **Excluded by default**; a template may opt in with depth ≤ 2; never in components |
| 6 | Precision of the plaintext geolocation box | **0.01°** (about 1.1 km of latitude) |
| 7 | CSV upload idempotency: buffer the upload so `Idempotency-Key` works, or rely on the file hash | **Buffer up to 20 MB** and accept the key; the file hash as a second guard |
| 8 | Encodings | **UTF-8 only** by default; legacy single-byte encodings through an explicit `encoding` parameter; UTF-16 refused |
| 9 | Refuse card-number-like strings in transaction `string` fields | **On** (13–19 digits passing Luhn), with docs telling operators to send processor tokens |
| 10 | `json` fields' `json-schema` | **Accept a restricted subset** compiled by ajv; refuse `pattern`, `format`, `$ref` and remote loading |
| 11 | Explorer library | **Cytoscape.js + fCoSE** (PLAN §3); sigma 3.0.3 only if results above 2,000 nodes become a requirement |
| 12 | Graph-query result retention | **30 days**, then deleted |
| 13 | Provider-specific email canonicalisation (dots and `+tag`) | **Off**; a per-list option |
| 14 | Bulk-action cap | **500 accounts** per action |
| 15 | Consortium or commercial device-reputation data | **Adapter interfaces with a sandbox provider only**; no vendor client until an operator asks (ADR 0002 tier A) |

## Fact-check (2026-10-27)

Independent re-check of the load-bearing facts, 17:40–18:15 UTC, by a separate agent. Web facts were re-opened at their primary
sources with a new fetcher (standard library, `python3 -I`, scripts kept in the session scratchpad, not in `scripts/`): robots.txt
first, evaluated per RFC 9309 plus any group naming Anthropic's agents; at least 1.2 s between requests to one host, and any
`Crawl-delay` honoured; a descriptive User-Agent without contact details; no personal data sent. Downloads went into new, empty
`downloads/fc-*` directories, and tarballs were read in memory; nothing downloaded was executed. Database facts were re-measured on
the pinned image in throwaway containers started with `--network none`, on synthetic data only. Only the rows below and the
sentences marked "(corrected in fact-check)" changed.

| # | Fact (as listed for Phase 7) | Verdict | Primary evidence |
|---|---|---|---|
| 1 | Pinned image `sha256:ac08538c…a75d` (PostgreSQL 17.11) ships cube 1.5, earthdistance 1.2, pg_trgm 1.6, fuzzystrmatch 1.2, btree_gist 1.7, vector 0.8.7; no AGE, no PostGIS | confirmed | `docker image inspect` (same digest, created 2026-10-01); `docker run --rm --entrypoint sh pgvector/pgvector:pg17 -c 'ls /usr/share/postgresql/17/extension'` and the control files; `PG_VERSION=17.11-1.pgdg12+2`; no `age.control`, no `postgis.control` |
| 2 | `earthdistance` is untrusted; the other four are trusted | confirmed | As a non-superuser database owner: "permission denied to create extension "earthdistance"… Must be superuser"; cube, pg_trgm, fuzzystrmatch and btree_gist were created. The contrib appendix lists the trusted modules |
| 3 | With `btree_gist`, a plain GiST index on `cidr` takes `gist_cidr_ops` and `>>=` scans sequentially; explicit `inet_ops` and SP-GiST use the index | confirmed (plans) | 200,000 synthetic /24 ranges: default class `gist_cidr_ops`, plan `Seq Scan`; `inet_ops` named explicitly and SP-GiST (default class `inet_ops`): `Index Only Scan`. gist.html states the historical-reasons default. The timings were not re-measured |
| 4 | `inet '::ffff:192.0.2.5'` is family 6 and not inside `192.0.2.0/24` | confirmed | `family()` 6; containment false (true for the plain IPv4 address) |
| 5 | Per-item box GiST needs a degenerate-box probe; timings; 228 antimeridian boxes | confirmed (plans) | 100,001 synthetic boxes: `bbox @> point` gives a `Seq Scan`; `bbox @> box(p, p)` gives a `Bitmap Index Scan`. The timings and the 228 count come from random data and were not re-measured |
| 6 | Recursive CTEs support `SEARCH` and `CYCLE` (PostgreSQL 14+); neither keeps a global visited set | confirmed | PostgreSQL 14.0 release notes; queries-with.html; both clauses ran on the image. Nuance: a plain `UNION` drops rows equal to any earlier output row, which removes revisits globally only when a row carries nothing but the account id (no depth) |
| 7 | Graph benchmark at 1,000,000 accounts and 6,000,000 rows | could not verify | Needs the full synthetic build (about 1.2 GB) and minutes of CPU per query set; not re-run. The scripts are `scripts/04-graph-data.sql` to `08-components-strong.sql` |
| 8 | Seal + HMAC 35 µs and 191 bytes per row; HMAC-SHA-256 283,542 per second | could not verify (in part) | HMAC-SHA-256 on Node 22.22.1 here: 266,200 per second on one thread (within 7%, machine-dependent). The seal cost and row size were not re-measured |
| 9 | Phase 4 calibration: 0.76 per 1,000 and 7.57 per 10,000 at 0.394; 0.04 (up to 0.24) per 10,000 at 0.5 | confirmed | `docs/calibration/selfie-phase4.md` (1:N table) |
| 10 | Field-schema union of 15 types; `hash` config; `json` config; policies; tree `c30a98b…`, blob `bfa062b9…` | confirmed | `field-schema.yaml` has 15 members; `field-schema-hash.yaml` (`item-schemas`, `ignore-unknown-keys` default false); `field-schema-json.yaml` (`json-schema`); `field-schema-default-config.yaml`. GitHub API: `c30a98b…` is the `2026-09-29` entry of commit `e64dbfb`'s root tree, which fills this note's commit gap; the blob hash recomputed |
| 11 | List-item attributes; CIDR not documented | **corrected** | The attributes are right. CIDR is public: the IP list-item schema's `value` example is a /24 range, and the developer cookbook says CIDR subnets are supported and match every address inside them. Ranges are parity, not ours |
| 12 | `cytoscape` 3.34.3 (2026-09-07; 3.34.4 on 2026-10-15 fails the cutoff), MIT at `716a1cb…`; ESM min 434,102 B (about 136 KB gzip) | confirmed | Registry (3.34.3 `gitHead` `716a1cb…`); LICENSE at that commit (MIT text); tarball `dist/cytoscape.esm.min.mjs` 434,102 B, 135,664 B gzip-9 |
| 13 | `cytoscape-fcose` 2.2.0, `cose-base` 2.2.0, `layout-base` 2.0.1, MIT | confirmed | Registry (dates and `gitHead`s match); LICENSE files at those commits |
| 14 | Cytoscape WebGL preview since 3.31 with provisional options; canvas frame rates | confirmed | blog.js.cytoscape.org post of 2025-01-13 (about 20 FPS at about 1,200 nodes and 16,000 edges; 3 FPS at about 3,200 and 68,000; options provisional) |
| 15 | sigma 4.0.1 at 2026-10-13T14:12Z, latest 4.0.4; 3.0.3 MIT; `@react-sigma/core` 6.0.0 fails, 5.0.6 pairs with sigma 3; the ForceAtlas2 worker uses a Blob URL | confirmed | Registry (4.0.1 at 14:12:59Z; 4.0.4 at 2026-10-27T14:46:06Z; 6.0.0 on 2026-10-14, peer `sigma ^4.0.0`; 5.0.6 peer `sigma ^3.0.2`); `graphology-layout-forceatlas2` 0.10.1 `helpers.js` builds its worker from `new Blob` and `URL.createObjectURL` |
| 16 | `@xyflow/react` 12.12.0 MIT; `force-graph` 1.52.0 MIT | confirmed | Registry |
| 17 | `csv-parse` 7.0.3 and `csv-stringify` 6.9.0 (2026-09-25), MIT at `594c646…`, no dependencies; `bom` off, `max_record_size` unlimited, errors carry the record | confirmed | Registry (no dependencies, same `gitHead`); root LICENSE at that commit; csv.js.org option and error pages |
| 18 | `escape_formulas` covers `=`, `+`, `-`, `@`, tab and CR; OWASP also lists LF and the full-width forms and warns about Excel | confirmed | csv.js.org; the OWASP page (the `owasp.org/www-community/...` URL now redirects to `community.owasp.org/attacks/CSV_Injection`) |
| 19 | `ajv` 8.20.0 (2026-04-24) MIT at `0fba0b8…`, in the lockfile via `@fastify/ajv-compiler` 4.0.7; schemas treated as trusted code | confirmed | Registry; LICENSE at that commit; `pnpm-lock.yaml`; ajv.js.org/security.html |
| 20 | `zod` 4.6.7 (2026-10-12) MIT, a direct API dependency; `z.fromJSONSchema()` experimental | confirmed | Registry; `apps/api/package.json`; zod.dev/json-schema |
| 21 | Apache AGE Apache-2.0; PG17 line v1.7.0 on 2026-02-11; `LOAD 'age'` and `ag_catalog` on the search path | confirmed | GitHub releases page (PG17 v1.7.0 published 2026-02-11; PG17 v1.6.0 2025-09-22; PG18 v1.8.0 2026-07-09); LICENSE and README at tag `PG17/v1.7.0-rc0` |
| 22 | Idempotency covers `POST`/`PATCH` and refuses a key on a streamed multipart body | confirmed | `apps/api/src/plugins/idempotency.ts` |
| 23 | PCI DSS v4.0 3.5.1.1 keyed hashes of the entire PAN (secondary source) | confirmed (secondary) | The usd.de summary quotes the requirement, gives its 1 April 2025 effective date and names HMAC; the standard itself was not read |
| 24 | GDPR Recital 30; Art. 9; Art. 35(3)(a) | confirmed | gdpr-info.eu pages |
| — | Additional finding: "face and selfie-background lists have no public path; their names are ours" | **corrected** | The developer docs list both kinds among the 13 and document a face importer, `POST /importer/list-item/faces` (`image-files[]`, `list-id`); only selfie-background lists lack a documented path |

**Counts:** 24 facts: 21 confirmed, 1 corrected, 2 could not verify (7, and the seal half of 8). One additional claim (face-list paths) was corrected in the summary, §1, §2.0 and §4.1.
