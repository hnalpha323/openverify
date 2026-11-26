# Phase 7 research: how Persona signals, lists, graph and transactions behave (clean-room notes)

Prepared 2026-10-27 for OpenVerify Phase 7 ("Signals, lists, graph, transactions", `docs/PLAN.md` §6 Phase 7, §4.4
and the Signals, Lists, Graph and Transactions rows of §2 [R1]): the browser signal collector, network intelligence, device
handoff, the 13 list types with importers and matching, the account graph with templates and an explorer, and transactions
with typed fields, statuses and labels.

Everything below is written in our own words. Field names, enum values, event names, type names, configuration keys and URL
paths are reproduced only because they are short identifiers needed for functional parity. No sentences, UI copy, display
names or help text are copied; where the public sources give only a display label (signal names in the dashboard, explorer
buttons), the behaviour is described instead. Anything the public sources do not state is marked **not documented**.
Statements we infer, and that no source states, are marked **(inference)**. Every citation key (`[O7]`, `[H15]`, `[P5]`, ...)
is defined in "Sources and pins" with its full URL; every source was read on 2026-10-27. Example values in Persona's material
that look like real IP addresses or real people's names are not reproduced; this note uses `192.0.2.0/24`, `2001:db8::/32`
and fictional values.

"OpenVerify today" means the working tree at `fe4850c`, read on 2026-10-27, with Phase 6 being built by other agents: no
device, network, list, graph or transaction resource exists, and `packages/signals` (PLAN §3) has not been created [R1] [R5]
[R6].

---

## Summary

1. **Signals live on three resources.** An inquiry session (`iqse_`) carries the parsed user agent, the handoff method, four
   network booleans (`is-proxy`, `is-vpn`, `is-tor`, `is-datacenter`), `threat-level`, IP geolocation, GPS (with precision and,
   since 2026-09-29, a reverse-geocoded country), the connection type and the ISP; it links to a device (`dev_`, holding the
   browser and device fingerprints and a vendor id) and a network (`net_`, holding service and proxy types and a threat level
   with `unknown`) [O1] [O2] [O3].
2. **Inquiry-level signals are a `[{ name, value }]` array** (`inquiry/bot_score` 0–100, `inquiry/behavior_threat_level`
   `low`/`medium`/`high`), feature-gated, limited to the signals a template version collects, and present in every inquiry
   webhook. The docs describe it; the OpenAPI inquiry schema at the pin does not (it has only an untyped, enterprise-only
   `behaviors` map) [D1] [O12]. **Distances are raw meters** in the API, webhooks and events [D1].
3. **Signals never pass or fail, and no verification check consumes them.** No public check identifier reads an IP, a GPS
   point, a fingerprint or a list; IP-versus-document country and distance rules are workflow conditions, and device reuse is
   Graph's job [H3] [H7] [D9] [R4]. Persona's own new `report/ip-address` (2026-10-24) shows that its datacenter flag is an AWS
   and GCP range lookup and its Tor flag an exit-list lookup [O39] [G2].
4. **Device handoff** is a flow component offering a QR code with a short link, an email or an SMS; the new device opens a new
   session recording `device-handoff-method`; handoff links are one-time links (single use, 5-minute grace), default lifetime
   1 hour, overridable per inquiry; the 25-session cap counts them [H14] [H15] [O1] [D3] [H69]. For account recovery, Persona
   warns that whoever starts a verification controls what its success unlocks [H19].
5. **Lists:** 13 kinds in the docs, 11 item types and 9 list-create paths in the API; per-type fields and matching (email by
   address or domain, IP or CIDR, a point with `radius-meters`, fuzzy first names on request); statuses `pending`, `active`,
   `archived`; archiving by `DELETE`; `match-count` but no public match records and **no list events**; CSV importers for six
   types plus face images (about 50 per call) [D10] [O13] [O14] [O17] [O18] [D26] [D6].
6. **List matching changes nothing by itself.** Matches surface on the inquiry, account and case pages and in workflow steps
   (Get List Match returns a boolean; Add Item To List; Add Item To Face List from an inquiry step) [H25] [H28] [H29] [H30].
7. **Graph** links accounts through property nodes (names, birthdates, emails with local-part and domain forms, phones,
   addresses, postal codes, ID and document numbers, SSNs, IPs, browser and device fingerprints, a device token, custom nodes,
   and organisation-enabled similarity nodes); a query names starting nodes, connecting properties, maximum hops and a node
   limit (default 100); templates take `{{param}}` values and are not versioned; `POST /graph-queries` runs a template
   asynchronously or with `run-sync`; the explorer bulk-tags, changes status, exports and adds values to lists [H37] [H38]
   [H40] [D15] [H35].
8. **Transactions** are customer-typed events (`txn_`, types `txntp_`) with field schemas of fifteen wire types (more than the
   ten in the docs and the nine in PLAN §2), shared field options (`required`, `write-policy` `write_once`,
   `redaction-policy` `never`), free-form statuses from the type (only `created` reserved), model labels with a score,
   relations, attached objects, tags, redaction and biometric redaction, and ten events [O38] [O24] [O26] [O28] [O33] [D6].
   Types are dashboard-only and unversioned [O34] [H49].
9. **Licences (section 7):** DB-IP Lite ⚠️ (CC BY 4.0 with a link-back duty), Tor exit lists ✅ (CC0), AWS ranges ⚠️ (no
   stated licence), Google ranges ⚠️ (no stated licence; the host's robots file literally allows the range files under RFC 9309
   (corrected in fact-check)), the one VPN ASN list found ✅ for its curated ASN files (its README declares MIT; GitHub detects
   no LICENSE file) (corrected in fact-check), MaxMind GeoLite ❌ (EULA, share-alike), IPinfo Lite ❌ (CC BY-SA 4.0),
   IP2Location LITE ❌ (its own LITE data licence: no redistribution or resale, bound to a master licence agreement for
   internal use; no Creative Commons licence) (corrected in fact-check), iptoasn ⚠️ (PDDL, unclear scope) [P1]–[P13].
10. **What is honest for free:** Tor, cloud ranges, coarse geolocation, ASN, distances and handoff are real (R tier against
    dated data); VPN, proxy, threat level, bot score, behaviour threat level and fingerprint linking can only be `beta`
    heuristics with confidences, and commercial IP or device reputation only an adapter with a sandbox provider [R3].

---

## Gap table

Verdicts: **MATCH** (adopt the public behaviour as is), **OURS** (no public counterpart, or we deliberately differ; labelled as
ours), **DEFER** (a later phase), **HONEST** (we cannot do it for free: an adapter with a sandbox provider, or a `beta`
heuristic with a confidence). Row ids are not citation keys.

### Session and device signals

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| S1 | Session attributes of 1.2 (UA parse, OS, browser, device type, SDK, handoff method, `is-*`, `threat-level`, IP geo, GPS with precision and country, connection type, ISP, network owner) | The same attribute names on `inquiry-session`, all nullable; IP and GPS sealed and shown only with `pii:view` as `ip-address` is today | Migration parity; C15 PII gating already exists | MATCH (names) / OURS (sealing) | [O1] [R5] |
| S2 | Separate `device` (`dev_`) and `network` (`net_`) resources; device list needs `filter[inquiry-session-id]`; no network path | Add both prefixes; `GET /devices` (same required filter) and `GET /devices/:id`; network only as a relationship and `include` | Parity; the network resource holds the lookups' provenance | MATCH | [O2] [O3] [O9] [O10] |
| S3 | Statuses `new`/`active`/`expired`; a separate `.canceled` event that may repeat | Keep our `active`/`expired`/`canceled`, document the mapping | Our C10 machine predates this and is tested | OURS | [O1] [D6] [R5] |
| S4 | 25 sessions per inquiry, then refusal or expiry; `expire-all`; per-session one-time link | Template setting `max-sessions` (default 25, refuse the 26th with 409); `POST /inquiry-sessions/expire-all` (`meta.inquiry-ids`); OTL per session | Parity; bounds link-sharing | MATCH | [D2] [O4] [O7] [O8] [H69] |
| S5 | `is-tor` | Exit-list lookup against a dated CC0 TorDNSEL list; provenance `as-of` | Real, cheap | HONEST (R against dated data) | [O39] [P2] [P3] |
| S6 | `is-datacenter` (Persona's own report: AWS or GCP ranges) | Cloud-range lookup; `null`, never `false`, when the address is outside every list we hold for a reason we cannot rule out (inference: report coverage with the value) | A missing list must not read as "residential" | HONEST (R, stated coverage) | [O39] [P5] [P7] |
| S7 | `is-vpn`, `is-proxy` | `beta` heuristics from operator-supplied VPN ASN and range lists (empty by default, so `null`) plus datacenter and Tor membership; an `ipReputation` adapter port with a sandbox | The only permissive VPN seed found is X4BNet's curated VPN ASN file (16 ASNs, MIT by README declaration), which covers only VPN operators with their own ASNs (corrected in fact-check); residential proxies are undetectable for free | HONEST (H + A) | [P9] [R3] |
| S8 | `threat-level` (`unknown`, `low`, `medium`, `high`) | `beta` roll-up of S5–S7, local velocity and list hits, with `confidence` and `reasons`; `unknown` when inputs are missing | Our own rules, so they must say what they used | HONEST (H) | [O3] [R3] |
| S9 | IP geolocation (country, region, latitude, longitude) | DB-IP Lite lookups with attribution and an "approximate" marker | Only passing free source | HONEST (R, coarse) | [O1] [P1] |
| S10 | GPS point, `gps-precision`, `gps-country-code`; GPS cleared on redaction (2026-09-29) | Template option to request location (off by default); record the browser's or OS's accuracy as precision; offline reverse-geocode to a country; clear GPS in the session redaction | Parity; consent and minimisation | MATCH / OURS (default off) | [O1] [C8] [C12] |
| S11 | `ip-connection-type` (mobile, datacenter, residential, corporate, education) | Set `datacenter` from S6; leave the others `null` unless an adapter answers | Free data cannot tell residential from corporate or mobile | HONEST | [O1] [C10] |
| S12 | `ip-isp`, `network-organization` | ASN and organisation from DB-IP ASN Lite | Real data, attribution | MATCH | [O1] [C11] [P1] |
| S13 | Inquiry `signals`: `[{ name, value }]`, `inquiry/` namespace, only template-assigned signals, in every inquiry webhook; distances in meters | Same attribute (always present, `[]` when none), our documented catalogue, each signal with tier, stage and, for H tier, `confidence` and `reasons` in a sibling `signal-details` (ours) | Parity of shape; ADR 0002 honesty for every heuristic | MATCH / OURS (catalogue, details) | [D1] [H2] [R3] |
| S14 | `inquiry/bot_score` 0–100 | Our rules over automation artefacts and input timing; `beta`; reasons; never a pass or fail | No public method; ours | HONEST (H) | [D1] [H4] |
| S15 | `inquiry/behavior_threat_level` `low`/`medium`/`high` | `beta` roll-up of our behaviour signals, computed at completion | Same | HONEST (H) | [D1] [H4] |
| S16 | Distances: IP or GPS to residence, between sessions, between the last two verifications, in meters | Haversine in meters, raw floats; `null` when either point is missing; record which points were used | Parity; units are a contract | MATCH | [D1] [H2] [H7] |
| S17 | Signals collected per template; only hosted, embedded and SDK flows have behaviour signals | Template `signals` list (allowlisted names); server-API inquiries have none | Parity and minimisation | MATCH | [H3] [H4] |
| S18 | Signals never pass or fail; decisions only in workflows | No verification check consumes a signal; until Phase 8, an inquiry-template rule `on-signal` (ours, off by default) can route to `needs_review`, never decline | Parity; keeps Phase 7 usable without workflows | MATCH / OURS (rule) | [H3] [D9] [R9] |
| S19 | Browser fingerprint, browser-side device fingerprint, SDK device id, device token | Own collector (FingerprintJS v3 at most, PLAN §3); per-environment keyed hashes; a first-party device token in storage; `beta` for linking | Collisions and spoofing are inherent | HONEST (H) | [O2] [H38] [H39] [R1] |
| S20 | Automation detection | `navigator.webdriver`, headless and CDP artefacts; feeds S14; production versus sandbox as in Phase 4's integrity rule | Already partly in Phase 4 | HONEST (H) | [R7] |
| S21 | `report/ip-address` (new 2026-10-24) | A thin report type over the same lookups, `has-match` defined by us (any of Tor, VPN, proxy, datacenter true) | Parity; reuse | MATCH / OURS (`has-match` rule) | [O39] [G2] |
| S22 | Sentinel passive collection into transactions | Not in Phase 7; transactions keep a `signals` attribute that stays `null` | Needs an SDK and the workflow engine | DEFER | [H11] [O24] |
| S23 | Rooted device, emulator, Play Integrity | Phase 10 Android | PLAN §6 | DEFER | [R1] |

### Device handoff

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| DH1 | A flow component offering QR (with a short link), email, or SMS | A `device-handoff` flow-spec component; QR and copyable short link, email through the Phase 5 mail adapter; SMS only with a configured SMS adapter and the Phase 5 SMS-pumping limits | Parity; reuse | MATCH | [H14] [H15] [O1] |
| DH2 | Handoff link default lifetime 1 hour; per-inquiry `one_time_link_expiration_seconds` | Template `handoff-link-ttl-seconds` (default 3600) and a per-inquiry `meta` override | Parity | MATCH | [H6] [H69] [C7] |
| DH3 | One-time-link codes single use with a 5-minute grace | Reuse C10 one-time links with a `purpose` (`resume`, `handoff`); a 5-minute grace for the same device re-opening | Parity; C10 exists | MATCH | [D3] [R5] |
| DH4 | The new device opens a new session recording `device-handoff-method` | Same; `qr` for QR and the copied short link (we cannot tell them apart without a parameter; ours), `email`, `sms` | Parity | MATCH / OURS (`qr` for both) | [O1] [C3] |
| DH5 | First-device behaviour after handoff | The first session shows a waiting state, polls the flow status, and continues or closes when the second device submits | Not documented | OURS | — |
| DH6 | New-device and unrecognised-link warnings; advice on attestation for account recovery | A confirmation screen on the second device naming the organisation and the time of the request; an optional "I started this" attestation step | Mitigates handoff phishing; triggers not documented | OURS | [H18] [H19] |
| DH7 | Handoffs count against the session cap | Same | Parity | MATCH | [D2] |
| DH8 | iOS App Clip handoff | Not applicable | No native target yet | DEFER (Phase 10) | [H19] |

### Lists

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| L1 | 13 list kinds; the API exposes 11 item types and 9 list-create paths | All 13 with full API (list create for device fingerprints, fields, faces and backgrounds is ours) | Self-hosters have no support desk | MATCH / OURS (API breadth) | [D10] [O16] [O17] |
| L2 | `lst_` lists; per-type item prefixes (`libf_`, `lidf_`, `lic_`, `liea_`, `liif_`, `ligl_`, `ligin_`, `liip_`, `lin_`, `lipn_`) | Same prefixes; ours for strings, faces and backgrounds | Parity | MATCH / OURS | [O14] |
| L3 | Item statuses `pending`, `active`, `archived`; archive by `DELETE`; archived lists stay readable but stop matching | Same; `pending` means "not yet indexed for matching" (ours) | The meaning of `pending` is not documented | MATCH / OURS (definition) | [O14] [O15] [O17] |
| L4 | `match-count` per item; matches visible in the dashboard only | `match-count` plus a `list-match` resource (ours) listing which inquiry, account or transaction matched which item | Integrators need the evidence through the API | MATCH / OURS | [O14] [C13] [H6] |
| L5 | CSV importers (email, geolocation, ID number, IP, name, phone; field type defined; face by images) with `mprt_` status and counts | Same paths and columns; our limits (size and row caps stated in the API) | Limits are not documented | MATCH / OURS (limits) | [O18] [D11] [D26] |
| L6 | No CSV importer for strings | Add one (ours, harmless) | Consistency | OURS | [D11] |
| L7 | Per-type matching (exact; email by address or domain; IP or CIDR; radius in meters; fuzzy first name) | Same semantics; our normalisation: E.164 via libphonenumber, ID numbers alphanumeric upper-case with the ID class, email lower-cased with IDN to ASCII, countries ISO alpha-2 | Parity; normalisation is not documented | MATCH / OURS (normalisation) | [O13] [O17] [D11] |
| L8 | Geolocation list: which point is tested is not documented | Test GPS when present and the IP location otherwise, record which, and never match an IP location whose accuracy is coarser than the radius (inference) | Honesty about coarse IP data | OURS | [O14] |
| L9 | Fuzzy first name | The Phase 5 C58 matcher's nickname and typo rules for first names only | Reuse | OURS (method) | [O13] [R10] |
| L10 | Face lists (biometric consent required; image import; add-from-inquiry workflow step) | Sealed templates with `source: list` in `face_templates`, matched by the C42.4 scan; items added from inquiries with matching consent; image import deferred to an owner decision | Reuse Phase 4; consent purpose differs | OURS / owner | [D26] [H30] [R7] |
| L11 | Selfie-background lists | Layout vectors in `selfie_backgrounds` (or a sibling table) with the HNSW and ORB comparison of C41.2 and C42.8 | Reuse Phase 4 | OURS | [D10] [R7] |
| L12 | No list-match verification check | No new check ids; list screening at inquiry completion and on demand writes `list-match` records and signals (`inquiry/list_match_count`, ours); an inquiry-template rule `on-list-match` (ours) routes to review | Clean-room parity; the PLAN phrase "list-match checks" maps here (owner question) | OURS | [R4] [D9] [R1] |
| L13 | No list events | Ours: `list-match.created`; nothing else | Integrators need a push signal for matches | OURS | [D6] |
| L14 | Per-list retention window for items | `item-retention-days` on the list, enforced by the C16 retention pass | Parity | MATCH | [H25] |
| L15 | `creator` relationship (user, workflow run or step, API key, importer) | Same, with our prefixes (`usr_`, `key_`, importer) | Parity, audit | MATCH | [O14] |
| L16 | Scopes `list.read`, `list.write`, `importer.read`, `importer.write` | `lists:read`, `lists:write`, `importers:read`, `importers:write` | Our `resource:action` names | MATCH (split) | [D7] |
| L17 | `report/custom-list` | Not in Phase 7 (Get List Match covers it once workflows exist) | Duplicate path | DEFER | [D6] [R9] |

### Graph

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| GR1 | Accounts linked through property nodes; clusters; hops | `graph_nodes` (environment, kind, keyed hash of the normalised value) and `graph_links` (account, node, first and last seen); recursive CTE with a hop bound | PLAN §6; Postgres only | MATCH (model) / OURS (storage) | [H37] [R1] |
| GR2 | Property types of 4.1 | Phase 7 set: account id, reference id, name, birthdate, email (with local-part and domain forms), phone, address, postal code, browser and device fingerprints, device token, IP (private, loopback and relay ranges excluded), ID number, document number, created-at; custom nodes from account fields | Parity minus similarity and camera nodes | MATCH | [H38] |
| GR3 | Node limit (default 100), maximum hops, `node-limit-reached` | Same defaults; our caps (hops at most 6, node limit at most 1,000, a statement timeout) | Bounded cost | MATCH / OURS (caps) | [H35] [H37] [D15] |
| GR4 | Templates with `{{param}}`; `account_id` auto-bound; no versioning; no template API | A template API, immutable versions, the same parameter rules | Self-hosting; audit | MATCH (syntax) / OURS (API, versions) | [H40] [O22] |
| GR5 | `POST /graph-queries` async or `run-sync`, timeout under 60 s; statuses and events | Same body, statuses and the six `graph-query.*` events | Parity | MATCH | [D15] [O21] [O22] [D6] |
| GR6 | Explorer with bulk tag, status, export CSV, create case, add to list | Cytoscape.js explorer; tag, account status, export, add to list; create case in Phase 8 | Parity | MATCH / DEFER (case) | [H35] [H42] [R1] |
| GR7 | Similarity nodes (email, selfie, background), camera fingerprints | Not in Phase 7 | Biometric 1:N at graph scale needs its own decision | DEFER | [H36] [H38] |
| GR8 | Sync Graph before Run Graph Query | Index synchronously when an account, inquiry or session changes; no manual sync needed; workflow steps in Phase 8 | Removes a stale-data trap | OURS / DEFER | [H43] [H44] |
| GR9 | Snapshots of results for cases | Store each query's result (`nodes`, `accounts`) as the snapshot; redactable | Parity | MATCH | [H37] [O21] |
| GR10 | Redaction of graph data is not documented | Redacting an account or inquiry deletes its links and orphaned nodes in the same transaction | Rule 3 | OURS | [H38] |

### Transactions

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| T1 | `transaction` (`txn_`) with `status`, `reference-id`, `fields`, `tags`, `signals`, timestamps; relationships of 5.4 | Same attributes and relationships; `fields` values sealed when the schema marks them PII (ours) | Parity; rule 3 | MATCH / OURS (sealing) | [O24] |
| T2 | Types `txntp_` with fifteen field-schema wire types and shared config | All fifteen in the contract; `relation-schema` targets and `json` informational schemas may answer 422 until their producers exist | Parity; PLAN §2 lists only nine | MATCH | [O38] [O25] |
| T3 | Type API: retrieve only | Full type API (create, update, archive) | Self-hosting | OURS | [O34] |
| T4 | Types unversioned; existing transactions keep their creation-time configuration | Immutable type versions; each transaction pins its version | What Persona describes is a versioned snapshot in practice | OURS | [H49] |
| T5 | Custom statuses per type; `created` reserved; a suggested set; unknown status refused | Same; the type resource lists its statuses (ours) | The API hides them today | MATCH / OURS | [H47] [O28] |
| T6 | Labels (`txnl_`, `model-label`, `model-version`, a score in the request) | Same, storing the score too | Parity | MATCH | [O26] [O32] |
| T7 | Relations by `relation-schema-key` to accounts or transactions | Reuse the Phase 2 account relation service; same bodies | Parity, reuse | MATCH | [O30] [H60] |
| T8 | `add-objects`/`remove-objects` (at most 100: documents, inquiries, reports, verifications) | Same | Parity | MATCH | [O29] |
| T9 | Tags | Same three routes over the tag service | Parity | MATCH | [O31] |
| T10 | Redact: PII now, children asynchronously, event after all | Same | Parity | MATCH | [O28] [C22] |
| T11 | Redact biometrics of the transaction and associated objects (`x-private`) | Same route; "biometric" defined as selfie files, face templates, background rows, NFC DG2 portraits, ID portrait crops | Parity; our definition stated | MATCH / OURS (definition) | [O33] [D24] |
| T12 | Ten transaction and type events; relation context naming conflicts | Same names; context `related-account-id`/`related-txn-id` as the newer changelog says | Parity; resolve the conflict once | MATCH | [D6] [O35] [C25] |
| T13 | List filters by reference id, type and identifier | Same | Parity | MATCH | [O27] [C20] |
| T14 | Filterable fields (10 per type), saved views, type conversion | Dashboard work in Phase 9 | Scope | DEFER | [H53] [H55] [H52] |
| T15 | Workflow steps Create Transaction, Update Transaction Status, Set Relation; trigger on `transaction.created` | Phase 8 | PLAN §6 | DEFER | [H56] [H57] [D20] |
| T16 | `transaction` relationship on inquiries, verifications, reports, documents; `txns` on cases | Fill on inquiries, verifications and reports now; cases in Phase 8 | Phase 6 left it null | MATCH / DEFER | [C23] [C24] [C16] [R9] |
| T17 | Scopes `txn.read`, `txn.write` | `transactions:read`, `transactions:write` | Our names | MATCH (split) | [D7] |

### Platform

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 7 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| PL1 | Dashboard Sessions and Signals tabs, list matches, explorer, transactions index | Build them (section 6) | Acceptance needs dashboard use | MATCH | [H2] [H6] [H35] [H52] |
| PL2 | Account and case modules for signals, list matches, graph, transactions | Account page now; case modules in Phase 8 | Cases are Phase 8 | MATCH / DEFER | [H10] [H31] [H45] [H58] |
| PL3 | Signal analytics (distribution, time series) | Phase 9 analytics | Scope | DEFER | [H2] |

---

## Corrections to the repository's records

1. **Transaction field types (PLAN §2, Transactions row).** The row lists nine types (bool, date, file, float, hash, int, string,
   choices, array) [R1]. The docs list ten (adding documents) and the OpenAPI union fifteen wire types: `string`, `integer`,
   `number`, `boolean`, `date`, `datetime`, `email-address`, `choices`, `multi-choices`, `array`, `hash`, `file`,
   `platform-file`, `json`, `relation-schema` [D19] [O38]. "float" is `number` and "int" is `integer` on the wire.
2. **List-item types (`persona-surface.md`, "List-item types (11)").** The docs name 13 kinds; the two missing are face and
   selfie background [R4] [D10]. The index also lacks the face importer path `importer/list-item/faces` (in the docs, not in the
   GitHub spec) and the importer types `importer/list-item/face` and `importer/list-item/field` [D26] [D31] [O18].
3. **Graph-query events (`persona-surface.md`).** The events page adds `graph-query.submitted` to the five webhook files [D6]
   [O23] [R4].
4. **Other events missing from the index:** `transaction-type.converted-field`, `session.created` and `session.expired` [D6]
   [R4].
5. **A new report type.** `report/ip-address` was added to the spec on 2026-10-24, after the Phase 6 pin [O39] [G2]; the Phase 6
   note recorded the type from the events page only [R9].
6. **IP intel sources (PLAN §3, "IP intel" row).** "VPN ASN lists" has one permissive candidate, X4BNet's curated ASN files
   (MIT by README declaration; no LICENSE file), which cover only VPN operators that run their own ASNs (corrected in
   fact-check); "DB-IP Lite geo (CC BY 4.0)" should add the link-back duty on pages that show results; cloud ranges carry no
   stated licence [P1] [P5] [P7] [P9] [R1].
7. **Signals (PLAN §2, Signals row).** Correct as far as it goes; it should add the device and network resources, the
   inquiry's `signals` array being documented outside the OpenAPI spec, and the two bot-score scales (0–100 on the inquiry, a
   fraction on Sentinel sessions) [O2] [O3] [D1] [O12] [O35].
8. **"List-match checks" (PLAN §6 Phase 7).** No public verification check matches lists; the phrase needs a definition in the
   Phase 7 plan (owner question 7) [R1] [R4] [D9].

---

## Sources and pins

**Read date.** Every source below was read on **2026-10-27**, one request per second per host at most, with a descriptive
User-Agent that carries no contact details, after reading each host's robots file. No personal data was sent anywhere.

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, licence Apache-2.0 (GitHub API metadata [G1]), commit
**`e64dbfbd04968b4f48e41ad571eb85861ac969bf`** (HEAD on 2026-10-27, committed 2026-10-27T08:08:31Z), directory `2026-09-29/`
(the default API version; tree `c30a98b`, 900 files). This is newer than the Phase 6 pin `805512b` (2026-10-21) [R9]. The
files were read one by one from `raw.githubusercontent.com` at that commit (that host serves no robots file; `github.com`'s
robots file disallows its own `/raw/` and tarball paths, which were not used). Every `O` link is
`https://github.com/persona-id/persona-openapi/blob/e64dbfbd04968b4f48e41ad571eb85861ac969bf/2026-09-29/` followed by the path
shown; `{` and `}` in file names are written `%7B` and `%7D`.

| Key | What | Path |
|---|---|---|
| O1 | Inquiry session schema and example | `components/schemas/inquiry-session.yaml`, `components/examples/inquiry-session.yaml` |
| O2 | Device schema and example | `components/schemas/device.yaml`, `components/examples/device.yaml` |
| O3 | Network schema | `components/schemas/network.yaml` |
| O4 | List and create inquiry sessions (25-session cap) | `paths/inquiry-sessions.yaml` |
| O5 | Retrieve an inquiry session | `paths/inquiry-sessions_%7Binquiry-session-id%7D.yaml` |
| O6 | Expire a session | `paths/inquiry-sessions_%7Binquiry-session-id%7D_expire.yaml` |
| O7 | Expire all sessions of given inquiries | `paths/inquiry-sessions_expire-all.yaml` |
| O8 | One-time link for a session | `paths/inquiry-sessions_%7Binquiry-session-id%7D_generate-one-time-link.yaml` |
| O9 | Devices list (required filter) and retrieve | `paths/devices.yaml`, `paths/devices_%7Bdevice-id%7D.yaml` |
| O10 | Session `included` types (device, inquiry, network) | `components/schemas/inquiry-sessions-included-objects.yaml` |
| O11 | Session webhooks and example bodies | `webhooks/inquiry-session.started.yaml`, `.expired.yaml`, `.canceled.yaml`; `components/examples/inquiry-session-{started,expired,canceled}-webhook-body.yaml` |
| O12 | Inquiry schema (`behaviors`, `sessions`, `transaction`; no `signals`) | `components/schemas/inquiry.yaml` |
| O13 | List union and per-type list schemas | `components/schemas/list.yaml`, `lists-shared-attributes.yaml`, `lists-{browser-fingerprints,countries,email-addresses,geolocations,government-id-numbers,ip-addresses,names,phone-numbers,strings}.yaml` |
| O14 | List-item shared attributes and the 11 item schemas, with examples | `components/schemas/list-item-shared-attributes.yaml`, `list-item-*.yaml`; `components/examples/list-item-*.yaml` |
| O15 | List all, retrieve, archive lists | `paths/lists.yaml`, `paths/lists_%7Blist-id%7D.yaml` |
| O16 | Create a list, per type (9 paths) | `paths/list_*.yaml` |
| O17 | Create, retrieve, archive list items, per type | `paths/list-item_*.yaml`, `paths/list-item_*_%7Blist-item-id%7D.yaml` |
| O18 | List-item CSV importers, request body, importer schemas | `paths/importer_list-item_*.yaml` (6), `components/requestBodies/list-item-importer-csv-request.yaml`, `components/schemas/importer.yaml`, `importer-shared-attributes.yaml`, `importer-list-item-*.yaml` |
| O19 | Importers list and retrieve | `paths/importers.yaml`, `paths/importers_%7Bimporter-id%7D.yaml` |
| O20 | Importer pipeline runs | `webhooks/importer-pipeline-run.*.yaml`, `components/schemas/importer-pipeline-run.yaml`, `importer-pipeline.yaml` |
| O21 | Graph query schema | `components/schemas/graph-query.yaml` |
| O22 | Create and retrieve graph queries | `paths/graph-queries.yaml`, `paths/graph-queries_%7Bgraph-query-id%7D.yaml` |
| O23 | Graph query webhooks (5) | `webhooks/graph-query.{cancelled,completed,errored,reran,timed-out}.yaml` |
| O24 | Transaction schema | `components/schemas/transaction.yaml` |
| O25 | Transaction type schema and example | `components/schemas/transaction-type.yaml`, `components/examples/transaction-type.yaml` |
| O26 | Transaction label schema and example | `components/schemas/transaction-label.yaml`, `components/examples/transaction-with-label.yaml` |
| O27 | Create and list transactions | `paths/transactions.yaml` |
| O28 | Retrieve, update, redact a transaction | `paths/transactions_%7Btransaction-id%7D.yaml` |
| O29 | Attach and detach objects | `paths/transactions_%7Btransaction-id%7D_add-objects.yaml`, `_remove-objects.yaml` |
| O30 | Add and remove relations | `paths/transactions_%7Btransaction-id%7D_add-relation.yaml`, `_remove-relation.yaml` |
| O31 | Tags | `paths/transactions_%7Btransaction-id%7D_add-tag.yaml`, `_remove-tag.yaml`, `_set-tags.yaml` |
| O32 | Label | `paths/transactions_%7Btransaction-id%7D_label.yaml` |
| O33 | Redact biometrics (`x-private`) | `paths/transactions_%7Btransaction-id%7D_redact-biometrics.yaml` |
| O34 | Retrieve a transaction type | `paths/transaction-types_%7Btransaction-type-id%7D.yaml` |
| O35 | Transaction and type webhooks and example bodies (relation context, Sentinel session) | `webhooks/transaction.*.yaml` (8), `webhooks/transaction-type.deleted-field.yaml`, `components/examples/transaction-*-webhook-body.yaml` |
| O36 | Transaction retrieve example (typed `fields`) | `components/examples/transaction-retrieve.yaml` |
| O37 | Transaction `included` types | `components/schemas/transactions-included-objects.yaml` |
| O38 | Field schemas (15 types and shared config) | `components/schemas/field-schema.yaml`, `field-schema-*.yaml` (15) and `field-schema-default-config.yaml` |
| O39 | IP address report, request and example | `components/schemas/report-ip-address.yaml`, `report-ip-address-request.yaml`, `components/examples/report-ip-address.yaml` |

| Key | GitHub API |
|---|---|
| G1 | `https://api.github.com/repos/persona-id/persona-openapi` (licence `apache-2.0`) and `.../commits?per_page=5` (HEAD `e64dbfb`, 2026-10-27T08:08:31Z) |
| G2 | `https://api.github.com/repos/persona-id/persona-openapi/commits?path=2026-09-29/components/schemas/report-ip-address.yaml` (one commit, `09d45de`, 2026-10-24T08:07:32Z) |

**Developer docs (D) and changelog (C).** `docs.withpersona.com`, version 2026-09-29, read as Markdown (`.md` suffix), starting
from the version's index `https://docs.withpersona.com/2026-09-29/llms.txt` (579 lines). The robots file disallows only
`/api/fern-docs/`. All 97 changelog entry pages listed in `https://docs.withpersona.com/2026-09-29/updates/changelog/llms.txt`
were read and searched; the relevant ones are cited.

| Key | URL (`https://docs.withpersona.com/2026-09-29/` + path) |
|---|---|
| D1 | `inquiry-signals.md` |
| D2 | `inquiry-sessions.md` |
| D3 | `resuming-inquiries.md` |
| D4 | `inquiry-one-time-links.md` |
| D5 | `ensuring-user-access-to-inquiries.md` |
| D6 | `events.md` |
| D7 | `api-keys.md` |
| D8 | `workflows.md` |
| D9 | `verification-checks.md` |
| D10 | `lists.md` |
| D11 | `lists-cookbook.md` |
| D14 | `graph-query-templates.md` |
| D15 | `running-graph-queries.md` |
| D16 | `transactions.md` |
| D17 | `transaction-api-first-lifecycle.md` |
| D18 | `transactions-model-lifecycle.md` |
| D19 | `transaction-types.md` |
| D20 | `building-workflows.md` |
| D21 | `connection-objects.md` |
| D24 | `api-reference/transactions/redact-transaction-biometrics.md` |
| D26 | `api-reference/importers/import-face-lists.md` |
| D27 | `api-reference/devices/list-all-devices.md`, `api-reference/devices/retrieve-a-device.md` |
| D31 | `api-reference/importers/list-all-importers.md` (importer types, including `importer/list-item/face`) |

| Key | Changelog entry (`https://docs.withpersona.com/2026-09-29/updates/changelog/` + date + `.md`) | Subject |
|---|---|---|
| C1 | `2021/8/18` | browser fingerprint moved from the session to the device |
| C2 | `2023/5/29` | inquiry session endpoints |
| C3 | `2024/1/22` | `device-handoff-method`, `started-at`, `expired-at` |
| C4 | `2024/3/4` | device endpoints |
| C5 | `2024/4/8` | session `device` relationship |
| C6 | `2024/7/1` | `is-vpn` |
| C7 | `2024/8/26` | per-inquiry expiration overrides, including the handoff link |
| C8 | `2024/9/3` | GPS attributes |
| C9 | `2024/11/4` | session `network` relationship |
| C10 | `2025/2/24` | `ip-connection-type` |
| C11 | `2025/5/19` | `ip-isp`, `network-organization` |
| C12 | `2026/9/29` | `gps-country-code`; GPS cleared on session redaction |
| C13 | `2025/10/27` | list items lose `inquiry_matches`; `fields` keys not inflected |
| C14 | `2025/9/15` | string lists by API |
| C15 | `2023/1/5` | graph `stats`; graph in closed beta |
| C16 | `2023/3/20` | cases gain `txns` |
| C17 | `2023/4/10` | transaction status updates by API |
| C18 | `2023/8/28` | transaction tag endpoints |
| C19 | `2023/9/18` | `mime-type` on file fields |
| C20 | `2024/10/7` | transaction identifier filter |
| C21 | `2024/4/15` | redact a transaction |
| C22 | `2024/4/29` | asynchronous redaction of related objects; event after all are redacted |
| C23 | `2024/9/16` | `transaction` relationship on inquiries, verifications, reports |
| C24 | `2024/9/30` | `transaction` relationship on documents |
| C25 | `2026/3/30` | `related-txn-id` in relation event contexts |
| C26 | `2026/4/13` | document create, update and submit deprecated in favour of transactions |
| C27 | `2026/6/9` | add and remove transaction (and account) relations |
| C28 | `2025/6/30` | `page-count` on file field schemas |
| C30 | `2026/10/14` | importing accounts needs `account.write` |

**Help Center (H).** Article ids under `https://help.withpersona.com/articles/<id>/`, each read as Markdown
(`/articles/<id>.md`, which the site's robots file points agents to; the robots file disallows only `/gated/`). `H0` is the
index `https://help.withpersona.com/llms.txt` (1,092 lines). Five articles linked from public pages answered **404**: the
behaviour-signal definitions (`11J1yKHLG0IKRWnvOKJ3ur`), the lists overview (`7IqWZFDaPjn8RTJtbgUjfV`), list types
(`2SyBJcNqYRJX8sotVOmY7Z`), check attributes (`2Q2Mk72I8dHPC4MiF2noHo`) and check fail reasons (`1s4cBbzUTvaaduPCCQAuKp`).

| Key | Article (id) | Key | Article (id) |
|---|---|---|---|
| H1 | Signals overview (`3aYYkI9NMDsyVqx5V3IT3G`) | H34 | Graph overview (`6atsHmQOjAswNrwMR8NY0R`) |
| H2 | Interpreting signals (`59xyT8o5Did16ovuqSIUDj`) | H35 | Graph Explorer interface (`7DbcO4qiCbn4aY0Oc5iO8W`) |
| H3 | How to use signals (`O9RVEgZvOTj2D47FGJJSb`) | H36 | Similarity nodes (`xbZkdiCn31NKowQnJ1Of9a`) |
| H4 | Behaviour signals (`V809YiUBfhmD5ocRMVp6r7`) | H37 | Graph glossary (`mDyQ4BlICWkXzVyUQyFwo`) |
| H5 | Fraud signals solution (`7re03dJ4NohXA7c9x2hIw5`) | H38 | Graph query reference (`2dlG9Q9liRn43wUIxHntRT`) |
| H6 | Reviewing an inquiry (`3JkqiHmtOWftGHDPKYcOCW`) | H39 | Getting started with Graph (`3f4U7X7lojUsDiEB2dco9h`) |
| H7 | IP location versus entered location workflow (`4mcuRU8tqlKMloQPUiyQp6`) | H40 | Graph query templates (`HrEtfnRzxodCUWvBVD86wL`) |
| H8 | Case device module (`1iVI1ODRccwLNt2D0wdUow`) | H41 | Proactive detection with Graph (`sSqJsbYrVxMw2ub3kq8aOd`) |
| H9 | Case location module (`708uiY0BgKdVKMkDTanNvW`) | H42 | Reactive investigations with Graph (`pTsMvO8BQpnUQ7LhP2QlXy`) |
| H10 | Account signals module (`x3E5MEfhCv5CsPdRi7c5uJ`) | H43 | Run Graph Query step (`1yqPtt4uqQ4C4qttQQTf4Q`) |
| H11 | Sentinel overview (`OzIPtG0LQsMTVqp22x0t4Q`) | H44 | Sync Graph step (`338LZn4WIhbRurb91DFRQF`) |
| H12 | Sentinel web integration (`m5MQFn7vxjQiZ1nKpnx8e6`) | H45 | Account Graph module (`iyb1Bl45vXZD5NTLAoCofW`) |
| H13 | Sentinel Android integration (`BbLOYiPtcRzaPAeDE7lUGj`) | H46 | Transactions overview (`5mzXj1PHBXtX5UlYbfZyvx`) |
| H14 | Device Handoff component (`r9sOQvL9uRALxnHxKbTsfO`) | H47 | Transaction statuses (`1YTSCV5t6ypNj7ZyF5wAnc`) |
| H15 | Device handoff for end users (`1eWai1tzBuIZ8fA3QknyBd`) | H48 | Transaction types and fields (`2QtlaeVrfaokLJnLZ8cRNL`) |
| H16 | How long verification links last (`l5oQUmnEtq4VZNAdyHfQZc`) | H49 | Transaction type change management (`1k1gje8mMgVi9kQ9G2q1U8`) |
| H17 | Getting a new verification link (`c4aR3PAzMNynOxBYNm5Pz`) | H50 | Transaction types in platform connections (`a05HEDD3ni9V2Y7QlqvOfH`) |
| H18 | External display name (`5UYSMJCixxdgud9jHzpN4r`) | H51 | Creating a transaction (`2TvflQM7ehSqRvP23jVuDI`) |
| H19 | Native mobile app verification (`2YEOllyeCf2gVzgoSlfqld`) | H52 | Transaction filters and saved views (`2eW9ZaGx8R9VJBEZGmbeSG`) |
| H20 | Capture methods (`7JQ78WDWLj5L63qXEu7AqJ`) | H53 | Converting field types (`7FwFUnNr5vyCizY27led5V`) |
| H21 | Verifying on a computer (`5MdA4QMSU7o2OZ5VGr8Q1D`) | H54 | Transaction field editor (`46CAEFF2OIg2G826BAlfkG`) |
| H22 | Fraud best practices for KYC (`5CB08CPfpTv9ogZCbfmS0D`) | H55 | Filterable fields (`1IThQFBK8LC8XqOY1pxvQV`) |
| H23 | Government ID repeat check (`6pGzYouPWF1Z4SKzLWRMT5`) | H56 | Create Transaction step (`6yTKeRbCEdxNfYBucXqBZU`) |
| H25 | Using lists (`7hJRIKMYIVTAnzoGVwWwV0`) | H57 | Update Transaction Status step (`7tVM7NL7V9mLUvNZO2q3vw`) |
| H27 | Deny lists in workflows (`2n7CJGa7b62iHlRmTXa3VW`) | H58 | Case transaction module (`6nF7jCSPDouODLowxtM1fR`) |
| H28 | Get List Match step (`JhJwzlzBVgW4bxNdJJSot`) | H59 | Account transaction module (`fn4ugTFlGivz8b7f4hx2D9`) |
| H29 | Add Item To List step (`78GxoTrZkNkVTIDkmlkXfF`) | H60 | Account relations (`1aMbe1XEyhiAHgFz1oOjDj`) |
| H30 | Add Item To Face List step (`gnAr5qyid6E0BOFNAxj2f`) | H61 | Key concepts (`2rnw3ACMbi22Y9NFUb0FQf`) |
| H31 | Account list matches module (`64tz1SDfq1icPpDcqp60QY`) | H67 | Inquiry details overview (`tUfG7pPmt3wQhsF8PKGQJp`) |
| H32 | Case list matches module (`64tz1SDfq1icPpDcqp60Qu`) | H68 | Understanding inquiry details (`nqBDRxxIjiIvnOwsCpri6`) |
| H33 | Importers overview (`2fpD7Bwb7OrzAS4g7XWoMG`) | H69 | Controlling when inquiries expire (`5TKUNJRjtKqtwU02Z5Ka1X`) |

**Publishers (P).** Each publisher's own page, after its robots file.

| Key | URL | Used for |
|---|---|---|
| P1 | https://db-ip.com/db/lite.php | DB-IP Lite: CC BY 4.0, attribution and link-back, monthly, CSV and MMDB, country, city and ASN editions |
| P2 | https://metrics.torproject.org/ | Tor Metrics data under CC0 (graphs CC BY 3.0 US) |
| P3 | https://metrics.torproject.org/collector.html | CollecTor: TorDNSEL exit lists, recent (72 h) and archived |
| P4 | https://check.torproject.org/torbulkexitlist | HEAD only: 200, 17,361 bytes, Last-Modified 2026-10-27 16:47:46 GMT |
| P5 | https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-ranges.html | AWS publishes `ip-ranges.json`; update notifications; no licence stated |
| P6 | https://ip-ranges.amazonaws.com/ip-ranges.json | HEAD only: `application/json`, 2,736,131 bytes, Last-Modified 2026-10-27 15:26:15 GMT (the host's robots file answers 403, which RFC 9309 treats as no restriction) |
| P7 | https://cloud.google.com/compute/docs/faq | Google Cloud points to `https://www.gstatic.com/ipranges/cloud.json`; no licence stated |
| P8 | https://www.gstatic.com/robots.txt | Ends with `Disallow: /`, but its unanchored `Allow: /*.js` matches `/ipranges/cloud.json` and wins on length under RFC 9309, so the range files are literally allowed (corrected in fact-check); this note did not fetch `cloud.json` |
| P9 | https://api.github.com/repos/X4BNet/lists_vpn | VPN provider lists: `license: null` (no LICENSE file detected); the README at the head commit declares MIT for the scripts, automation and lists (corrected in fact-check) |
| P10 | https://iptoasn.com/ | IP to ASN and country TSV, hourly; a footer PDDL v1.0 statement of unclear scope |
| P11 | https://www.maxmind.com/en/geolite2/eula | GeoLite EULA (updated 2026-02-12), CC BY-SA 4.0 for copyrightable parts, FCRA clause |
| P12 | https://lite.ip2location.com/ | IP2Location LITE: no Creative Commons licence is linked; the LITE data licence (`/data-license`) forbids redistribution and resale and binds to the terms of use, a master licence agreement for internal business use (corrected in fact-check); the marketing text calls LITE free for commercial use with attribution |
| P13 | https://ipinfo.io/lite | IPinfo Lite: CC BY-SA 4.0 with attribution; daily |

**Repository (R).** Read-only paths in `/home/mhnoor/persona-opensource` at `fe4850c`.

| Key | Path |
|---|---|
| R1 | `docs/PLAN.md` §2 (Signals, Lists, Graph, Transactions rows), §3 (technology table: browser fingerprint, IP intel, graph UI), §4.4, §6 |
| R2 | `CLAUDE.md` rules 3, 4, 5 |
| R3 | `docs/adr/0002-check-tiers.md` |
| R4 | `docs/research/persona-surface.md` (checks, list-item types, webhook events, paths) |
| R5 | `packages/contracts/src/inquiry-sessions.ts`; `packages/db/src/tables/inquiries.ts` (`inquiry_sessions`, `one_time_links`, contract C10) |
| R6 | `packages/contracts/src/ids.ts` (`ID_PREFIXES`), `event-names.ts`, `account-types.ts` (`ACCOUNT_FIELD_TYPES`) |
| R7 | `docs/plans/phase-4.plan.md` C40 (capture, device snapshot), C41.2 (background comparison), C42 (face templates, background index, consent), C43 (integrity rule) |
| R8 | `docs/plans/phase-6.plan.md` C76 (operator-run sync of live public data, never committed), C85.1 (the streaming outbound client) |
| R9 | `docs/research/phase6-behaviour.md` (G8 `transaction` relationship, §5, §6 `custom-list` and `ip-address`, owner question 8) |
| R10 | `docs/plans/phase-5.plan.md` C58 (the name matching library) |

**Downloads.** Everything fetched sits under
`/home/mhnoor/.claude/projects/-home-mhnoor-persona-opensource/resume/phase7-research/downloads/behaviour-*` (about 3.9 MB
on disk in total); the fetch scripts are in `.../phase7-research/scripts/`. Nothing downloaded was executed.

---

## 1. Session and device signals

### 1.1 Three resources, not one

| Object | Id prefix | What it is (our words) | Sources |
|---|---|---|---|
| Inquiry session | `iqse_` | One access of an inquiry by an end user from one device. A device handoff opens a second session on the second device. A device may hold many sessions; a session belongs to exactly one device | [D2] [O1] |
| Device | `dev_` | The device behind a session; carries the fingerprints | [O2] [O9] [C4] [C5] |
| Network | `net_` | The network the session came from; carries the IP intelligence | [O3] [O10] [C9] |

- A session links to its `inquiry`, its `device` (nullable) and its `network` (nullable); the session webhooks put all three in
  `included` [O1] [O10] [O11].
- The inquiry lists its `sessions` (to-many) [O12].
- **Session cap.** By default an inquiry accepts at most 25 sessions; creating more is refused. The template can also be set to
  expire the inquiry when too many sessions start, which Persona presents as a defence against a captured link being passed
  between devices [D2] [O4] [H6] [H69].
- **Session token.** A session is represented to the browser as a JWT that the hosted and embedded flows keep in the tab's
  `sessionStorage`; a different window or a closed tab loses it, and the end user then needs a resumed inquiry or a one-time link
  [D2] [D3] [D5]. A session's expiry is copied from the inquiry's when the session is created, and is not moved by a later
  resume [D2].
- **Statuses.** The schema lists `new`, `active` and `expired` and warns that values may be added [O1]. A separate event
  `inquiry-session.canceled` exists, fired when the end user cancels; since sessions can be resumed, one session may produce
  several cancel events [D6] [O11]. Whether `canceled` is ever a status value is **not documented** (the cancel example payload
  shows `expired`) [O11].

### 1.2 Inquiry session attributes

All attributes are nullable unless stated. Example values in the public spec include a real-looking public IP address; we use
documentation ranges instead.

| Attribute | Type and vocabulary | Meaning (our words) | Sources |
|---|---|---|---|
| `status` | string: `new`, `active`, `expired` (open enumeration) | Session lifecycle | [O1] |
| `created-at`, `started-at`, `expired-at` | date-time | Creation; first start; expiry (the last two added 2024-01-22) | [O1] [C3] |
| `ip-address` | string | Client address, IPv4 or IPv6 (example `192.0.2.10` in our docs) | [O1] |
| `user-agent` | string | Raw User-Agent header | [O1] |
| `os-name`, `os-full-version` | string | Parsed operating system and version (examples `iOS`, `Mac`) | [O1] |
| `device-type` | string; examples `smartphone`, `desktop` | Parsed device class; full vocabulary **not documented** | [O1] |
| `device-name` | string | Parsed hardware model where known (an Apple model string in the example) | [O1] |
| `browser-name`, `browser-full-version` | string | Parsed browser | [O1] |
| `mobile-sdk-name`, `mobile-sdk-full-version` | string | Set when the session came from a native SDK | [O1] |
| `device-handoff-method` | string; examples `email`, `sms`, `qr`; null without a handoff | How this session was reached from another device (section 2) | [O1] [C3] |
| `is-proxy`, `is-vpn`, `is-tor`, `is-datacenter` | boolean | Network classification of the session's IP (`is-vpn` added 2024-07-01) | [O1] [C6] |
| `threat-level` | string; examples `low`, `medium` | A risk rating of the IP from network metadata | [O1] [H2] |
| `country-code`, `country-name`, `region-code`, `region-name` | strings; ISO 3166-1 alpha-2 country | Location of the IP | [O1] |
| `latitude`, `longitude` | number | Approximate location of the IP | [O1] |
| `gps-latitude`, `gps-longitude` | number | Device-reported coordinates (added 2024-09-03) | [O1] [C8] |
| `gps-precision` | string; example `precise` | Precision of the device location; other values **not documented** (inference: the browser and OS "approximate" versus "precise" location grants) | [O1] [C8] |
| `gps-country-code` | ISO 3166-1 alpha-2 | Country from reverse-geocoding the GPS point; null when never stored, which does not mean it cannot be derived (added 2026-09-29) | [O1] [C12] |
| `ip-connection-type` | string: `mobile`, `datacenter`, `residential`, `corporate`, `education` | Connection class of the IP (added 2025-02-24) | [O1] [C10] |
| `ip-isp`, `network-organization` | string | ISP name and network owner (added 2025-05-19) | [O1] [C11] |

- **Redaction.** Since 2026-09-29, redacting a session clears its GPS coordinates, precision, geocoded country and region and the
  stored raw geocoder answer, including inside stored copies of webhook bodies and events; sessions redacted earlier keep them
  [C12]. Redaction of the other attributes is **not documented** here.
- **History.** `browser-fingerprint` was a session attribute until 2021-08-18, when it moved to the device [C1]. Session
  endpoints arrived on 2023-05-29, the device relationship on 2024-04-08, the network relationship on 2024-11-04 [C2] [C5] [C9].

### 1.3 Device and network resources

**Device** (`dev_`) [O2] [O9] [D27]:
- `device-vendor-id`: a vendor-assigned UUID (inference: the iOS `identifierForVendor` or an Android equivalent, which the
  Graph reference calls the OS-provided identifier for SDK flows [H38]);
- `device-fingerprint` and `browser-fingerprint`: opaque strings;
- `GET /api/v1/devices` **requires** `filter[inquiry-session-id]`; `GET /api/v1/devices/{device-id}`; both since 2024-03-04
  [O9] [C4]. No create, update, redact or event exists for devices [O9] [D6].
- How either fingerprint is computed, its stability, and its collision rate are **not documented**. The Graph reference
  distinguishes four device identities: a browser fingerprint, a browser-side device fingerprint (on by default once Graph is
  set up), an SDK device fingerprint (the OS identifier, a UUID), and a persistent device token stored client-side by Persona
  [H38]. A Graph article warns that browser-side device fingerprints collide for people with the same browser settings, so they
  give more false positives than the other link types [H39].

**Network** (`net_`) [O3] [C9]: `created-at`, `ip-address`, `service-provider`, `service-type` (`residential`, `mobile`,
`datacenter`, `corporate`, `education`), `proxy-type` (`residential`, `mobile`, `corporate`, `vpn`, `unknown`, `tor`),
`threat-level` (`unknown`, `low`, `medium`, `high`), the country and region pair, `latitude`, `longitude`. All enumerations are
open. The network appears only as a relationship and in `included`; there is no `networks` path [O10] [R4].

**Two vocabularies for the same facts.** The session repeats network facts under other names: `ip-connection-type` mirrors
`service-type`, `ip-isp` and `network-organization` mirror `service-provider`, and the four `is-*` booleans flatten
`proxy-type` [O1] [O3]. The session's `threat-level` examples omit `unknown` [O1].

### 1.4 Session API, events and scopes

| Action | Path | Notes | Sources |
|---|---|---|---|
| List | `GET /api/v1/inquiry-sessions` | `filter[inquiry-id]`; newest first; cursor links | [O4] |
| Create | `POST /api/v1/inquiry-sessions` | body `data.attributes.inquiry-id`; 25-session cap | [O4] |
| Retrieve | `GET /api/v1/inquiry-sessions/{id}` | `include` and `fields` supported | [O5] |
| Expire one | `POST /api/v1/inquiry-sessions/{id}/expire` | | [O6] |
| Expire many | `POST /api/v1/inquiry-sessions/expire-all` | `meta.inquiry-ids[]`; expires every active session of those inquiries | [O7] |
| One-time link | `POST /api/v1/inquiry-sessions/{id}/generate-one-time-link` | answer `meta.one-time-link` and `meta.one-time-link-short` | [O8] |

- **Events:** `inquiry-session.started` (a device starts a session; each device spawns its own), `inquiry-session.expired`,
  `inquiry-session.canceled` [D6] [O11]. The events page also lists `session.created` and `session.expired` for a separate
  "session" resource whose meaning is **not documented** [D6].
- **Scopes:** `session.read`, `session.write` [D7]. No device or network scope is listed [D7].

### 1.5 Inquiry-level signals

**Shape.** When an organisation has the feature enabled, `GET /api/v1/inquiries/{id}` carries `data.attributes.signals`, an
array of `{ name, value }`, where `name` is namespaced (`inquiry/bot_score`, `inquiry/behavior_threat_level`) and `value` is a
string or a number. Disabled, the array is empty. Because it is an inline attribute it appears in every inquiry webhook payload
with no extra configuration [D1].
- A signal is present only when it is assigned to the inquiry's template version and its visibility rules (product features,
  environment) are met, so the set varies by template and version [D1] [H3].
- **Not in the OpenAPI schema at the pin.** The inquiry schema has no `signals` attribute; it has `behaviors`, an untyped object
  of enterprise-only risk signals whose keys are deliberately not enumerated [O12]. The docs page [D1] is the only public
  description of `signals`. **(inference: `signals` is newer than the last schema edit, or is gated out of the published spec.)**
- **Units** [D1] [D6]: distances are raw floats in **meters** in the API, webhooks and events, with no unit string; the
  dashboard shows kilometres above 1,000 m. Thresholds in workflows and webhook handlers are therefore written in meters (a
  50 km rule is `50000`).

**Value formats** [H2]: boolean, integer, number (decimal), enum (risk levels, countries, time zones, locales), array of
strings, array of enums, string.

**The two named roll-ups** [D1] [H2] [H4]:

| Wire name | Value | Meaning (our words) | Sources |
|---|---|---|---|
| `inquiry/bot_score` | integer 0–100 | Likelihood that a bot submitted the inquiry | [D1] [H2] [H4] |
| `inquiry/behavior_threat_level` | `low`, `medium`, `high` | Output of a proprietary model over several behaviour signals, computed at completion | [D1] [H2] [H4] |

How either is computed is **not documented**; the help center calls the threat-level model proprietary [H4].

**Other signals described in public sources** (wire names are public only where shown in code style; the rest are given by
function, since only display labels exist) [H1] [H2] [H4] [H7] [H22]:

| Layer | Signal (by function) | Value | Sources |
|---|---|---|---|
| Network | IP address; proxy detected; Tor detected (`tor_detected`, `proxy_detected` in workflow paths); IP threat rating; network threat rating; a burst of activity from one IP | booleans; `low`/`medium`/`high` | [H1] [H2] [H7] |
| Network | IP velocity risk: whether the IP carried a high volume of recent activity, distinct from the threat rating | `low`/`medium`/`high` | [H2] |
| Behavioural | Number of sessions on the inquiry (1–2 typical; 3 or more worth a look) | integer | [H2] [H4] |
| Behavioural | Use of keyboard shortcuts; activity at unusual hours; a behaviour flag | **not documented** | [H1] [H4] |
| Behavioural | Largest distance between any two of the inquiry's session locations | number, meters | [H2] |
| Behavioural | Distance from the session location to the residence on the inquiry (`geolocation_to_residency_delta`; the docs also write `geolocation-to-residency-delta`) | number, meters | [D1] [H7] |
| Behavioural | Distance between the locations of the last two verifications (`last_two_verifications_geolocation_delta`) | number, meters | [H7] |
| Behavioural | Country comparison between the session and the inquiry's country (`country_comparison`), and the session's country itself (`country_from_session`) | **not documented** / ISO country | [H7] |
| Behavioural | Impossible travel between sessions | `low`/`medium`/`high` (inference: the baseline tests it for a high level) | [H22] |
| Device | GPS; device type; device identifier; device integrity, including a rooted or jailbroken device; camera properties; locale; app bundle identifiers seen across sessions | mixed | [H1] [H2] [H19] |
| Image | Virtual-camera risk; selfie liveness risk level; biometric comparison | `low`/`medium`/`high` | [H1] [H22] |
| Ensemble | Behaviour threat level; a risk level; `inquiry.risk_label` used as a workflow condition | enum | [H1] [H4] |
| Other examples | An age ratio; a mismatch between the geolocation's language and the user's; the ID's issuing subdivision; a set of IP connection classes across sessions | mixed | [H2] |

- Persona claims more than 50 signals; the full catalogue and definitions are behind the dashboard [H1] [H2]. The help article
  that defines each behaviour signal answers 404 to the public [H0].
- **Which flows collect behaviour signals:** only integrations where Persona draws the interface (embedded, hosted, mobile
  SDKs), never server-API-only inquiries; they are populated when the inquiry completes [H4].
- **Signals never pass or fail.** Enabling one only collects and shows it; acting on it takes a workflow. Persona recommends
  routing to review and a case rather than auto-declining, since a signal is risk, not proof [H3] [H4]. A packaged solution
  runs a workflow that tags the inquiry, marks it for review and opens a case when any configured signal crosses its threshold
  [H5].
- A recommended baseline routes to a case when the network threat rating is high, virtual-camera or liveness risk is medium or
  high, impossible travel is high, the residence country differs from the IP country or region, or sessions move far apart
  [H22].

### 1.6 Where signals appear

| Surface | What it shows | Sources |
|---|---|---|
| Session resource and webhooks | Section 1.2; device and network in `included` | [O1] [O11] |
| Inquiry `signals` attribute and every inquiry webhook | Section 1.5 | [D1] |
| Inquiry template | A per-template list of signals to collect (flow editor settings); flow-editor branching on signal values | [H1] [H3] |
| Workflows | Conditions on signal and session paths (`trigger.geolocation_to_residency_delta`, `tor_detected`, ...) | [H3] [H7] |
| Dashboard, one inquiry | Overview with featured signals (flagged values get an alert icon and a reason on hover) and a behaviour-risk panel; a Sessions tab with a map of session locations, each device and its sessions, network and device details; a Signals tab grouped as featured, network, behavioural, device, all | [H2] [H6] [H67] [H68] |
| Dashboard, all inquiries | A signals overview with a population distribution view and a time-series view | [H2] |
| Account page | A signals module: the account's own signals (when the account type has them) and tabs for up to five most recent inquiries with signals; anomalies always shown; nothing for inquiries in progress | [H10] |
| Case page | A device module (IP, threat rating, network country, configurable fields) and a location module with four sources (ID and database verifications, device or IP geolocation, the profile report) plus fixed overlays, each a named point with a radius | [H8] [H9] |
| Inquiry analytics | Filtering by signals | [H1] |
| Transactions (Sentinel) | Transaction signals from passive collection (section 1.8) | [H11] |
| Graph | IP addresses, browser and device fingerprints and the device token as link types (section 4) | [H38] |

### 1.7 Which verification checks consume these signals

- **None, by identifier.** No check in the public catalogue (the 77 identifiers in the surface index [R4], and every check name
  in the downloaded docs and help articles) reads an IP, a network class, a GPS point, a fingerprint or a list. The verification
  checks page describes checks per verification type with statuses and types only [D9].
- IP-versus-document country and session-distance rules are **workflow conditions** over signals (`country_comparison`,
  `country_from_session`, `geolocation_to_residency_delta`), not checks [H7] [H22].
- Device reuse is handled by **Graph** (shared fingerprints, device tokens, IPs) and **lists** (fingerprint and IP lists), not by
  a check [H38] [H39] [D10].
- The nearest checks: `id_repeat_detection` flags an ID whose details **and** portrait both match an ID submitted on another
  account (either alone passes) [H23]; `selfie_liveness_detection` and `id_electronic_replica_detection` benefit from live
  capture, which also yields the camera and device signals [H22] [H20]. Phase 4's own `selfie_liveness_detection` integrity
  component already reads `webdriver` and the camera label [R7].
- Within OpenVerify's catalogue, the checks that read **list-like** data are Phase 4's own `selfie_repeat_detection` (face
  templates of other accounts) and `selfie_similar_background_detection` (background index), plus `id_repeat_detection` and
  `id_inconsistent_repeat_detection` (ID images and numbers seen on other accounts); face and selfie-background lists would
  feed the same indexes (section 3.4) [R1] [R7].

### 1.8 Sentinel: signals outside the inquiry flow

- Passive device and network collection at moments the customer chooses (sign-in, payout change, account update), through a web
  iframe, an iOS SDK or an Android SDK [H11] [H12] [H13].
- Each collection creates a **transaction** of a Sentinel transaction type, linked to an account by the customer's reference id
  (optionally auto-creating the account), and a workflow triggered on that transaction decides: allow, open a case, hold, or
  step up to a selfie or ID check [H11] [H12].
- Examples of collected signals: IP, connection type, approximate location, device token or fingerprint, model, OS, proxy,
  network threat rating, and a count of devices seen over a window (velocity) [H11]. The event
  `transaction.sentinel-session-processed` reports a processed collection [D6] [O35].
- The web integration loads a page from Persona with a client token, transaction type, a `context` string and the account
  reference id, then triggers collection by a `postMessage` of type `persona/passive/collect`; it makes two fingerprinting calls
  and one transaction-creation call [H12].
- Sentinel events feed Graph when the reference id is passed [H12] [H38].

### 1.9 The IP address report (new on 2026-10-24)

A report type `report/ip-address` appeared in the spec on 2026-10-24, after the Phase 6 pin [O39] [G2]:
- **Query:** one IPv4 or IPv6 host; CIDR ranges, netmasks and zone indexes are refused [O39].
- **Result:** `service-type` (open set: `RESIDENTIAL`, `DATACENTER`, `CORPORATE`, `MOBILE`, `EDUCATION`, `SATELLITE`,
  `IN_FLIGHT_WIFI`, `GOOGLE`), `vpn-detected`, `proxy-detected`, `tor-exit-node` (`MATCHED`, `CLEARED`, or `ERRORED` when the
  exit-list lookup failed), `datacenter-ip` (the IP belongs to a known cloud provider, AWS or GCP), `isp`, `mobile-ip`, country
  code and name, city, region, `latitude` and `longitude` (as strings), and `error` (set when the lookup failed, with the report
  `errored`; vendor detail withheld) [O39].
- Its outcome uses the shared report `status` and `has-match` [O39]. What makes `has-match` true is **not documented**: the
  example answers `true` with every flag clear [O39].
- This is direct public evidence that Persona's own datacenter flag is a **cloud-range lookup** and its Tor flag an **exit-list
  lookup** [O39], the two free sources PLAN §3 names [R1].

### 1.10 OpenVerify today and the honest limits

**Today** [R5] [R6] [R7]:
- `inquiry_sessions` stores `ip` and `user_agent` sealed, a consent record, statuses `active`, `expired` and `canceled`, and the
  three `inquiry-session.*` events; the resource exposes `ip-address` and `user-agent` to users with `pii:view` only.
- There is no device, network or signal resource, and `packages/signals` (PLAN §3) does not exist.
- The selfie capture's device snapshot (camera label, settings, `webdriver`) is sealed and cleared at decision time (Phase 4
  C40.4, C40.5).

**What each signal can and cannot honestly be** (feeds the gap table):

| Signal | Free method | What it cannot detect | Tier |
|---|---|---|---|
| Geolocation from IP | A permissive IP-to-location database (the data-sources note decides which) | Country-level accuracy only for mobile carriers and corporate egress; VPN and proxy users appear where the exit is | R (lookup), with stated accuracy |
| `is-tor` | The Tor Project's exit list | Bridges and non-exit relays; exits that rotate between list refreshes | R against a dated list |
| `is-datacenter` | Published cloud-provider IP ranges (Persona's own report uses AWS and GCP [O39]) | Small hosting providers and residential proxies | R against dated lists, coverage stated |
| `is-vpn` | ASN lists of commercial VPN operators | Any VPN on a residential or shared ASN, a self-hosted VPN, a new provider | H, `beta`, confidence |
| `is-proxy` | Datacenter, Tor and VPN membership combined; header clues on our own edge (inference) | Residential proxy networks, which are the main tool of fraud farms | H, `beta`, confidence |
| `threat-level` | Our own roll-up of the above plus local history (velocity on the IP, list hits) | Any commercial reputation (abuse feeds, botnet telemetry) | H, `beta`; commercial reputation as an A-tier adapter with a sandbox |
| GPS | The browser Geolocation API or the OS location, with permission | Spoofed locations (emulators, mock-location apps, browser overrides); refused permission | R as reported, never as verified |
| Distances in meters | Haversine on WGS 84 between any two points | Accuracy is bounded by the worse of the two points | R |
| Browser and device fingerprints | Our own collector (FingerprintJS v3 MIT at most, PLAN §3) | Anti-detect browsers, fingerprint randomisation, identical corporate builds; collisions | H for linking, `beta` |
| Automation | `navigator.webdriver`, headless and CDP artefacts | A patched or human-in-the-loop browser; mobile device farms | H, `beta` |
| Bot score, behaviour threat level | Our own rules over timing, focus, paste and input cadence | A human fraud farm; a careful script | H, `beta`, confidence, reasons |
| Rooted device, emulator | Android checks in the SDK; an optional Play Integrity adapter (PLAN §6 Phase 10) | A hidden root, a hooked app | H (local) / A (Play Integrity) |

## 2. Device handoff

### 2.1 What the end user sees

- A flow-editor component, a button, that offers to continue the inquiry on another device; its text, style and visibility
  rules are configurable [H14]. Typical use: move from a computer to a phone for capture [H14] [D2].
- **Three ways across** [H15] [O1] [C3]:
  - a **QR code**, with a short link printed below it to copy into a mobile browser;
  - an **email** to an address the user types;
  - an **SMS** (the session vocabulary has `sms`; the end-user article describes only QR, short link and email).
- The handoff email and SMS name the business through its configured external display name, falling back to the organisation
  name [H18].
- In-flow security dialogs exist for a **new device**, for an **unrecognised link** (phishing) and for **sandbox** [H18]; their
  triggers are **not documented**.
- A user who started elsewhere and lost the link is told to return to the original device and hand off again [H17].
- A business can require a phone; flows that prefer one offer the handoff [H21]. iOS can open a native App Clip from the link or
  QR (iOS 17.6+); Android has no equivalent since Instant Apps were deprecated [H19].

### 2.2 Lifetime and security properties

| Property | Public behaviour | Sources |
|---|---|---|
| Lifetime | A template setting for the device-handoff link, default **1 hour**; overridable per inquiry with `meta.one_time_link_expiration_seconds` at creation (since 2024-08-26); the end-user guide says "often around an hour" and asks users to finish quickly | [H6] [H69] [C7] [H16] |
| Why short | Persona calls handoff links authenticated links and advises the shortest expiry the use case allows | [H6] [H69] |
| Single use | One-time-link codes expire after one use, with a 5-minute grace period; session tokens stay valid for the session's life | [D3] |
| Form | One-time links are short URLs carrying a `code` query parameter, suited to QR codes; they work only in browser flows, not in SDKs; none can be made for an expired inquiry | [D3] [D4] [O8] |
| Inquiry expiry | Expiring an inquiry expires all its sessions and one-time links | [H69] |
| Session cap | The 25-session cap counts handoff sessions | [D2] [H6] |
| Who controls the session | For account-recovery or workforce use, whoever **starts** the verification controls what follows its success; Persona advises limiting who can start it, warning users not to complete a verification someone asked them to, an attestation step, and training | [H19] |

### 2.3 What is recorded

- The new device's session carries `device-handoff-method` (`email`, `sms`, `qr`, or null without a handoff), plus its own IP,
  device and network [O1] [C3].
- The session count and the largest distance between session locations are signals (section 1.5) [H2].
- `inquiry-session.started` fires for the new session [D6].

**Not documented:** whether the first device's session stays active or is expired when the second starts; how the first device
learns that the second finished (inference: it polls the inquiry); whether the handoff code is bound to the first device's
session; rate limits on handoff emails and SMS; what the QR encodes beyond the short link; whether a copied short link records
`qr` or another value.

### 2.4 OpenVerify today

Phase 2 contract C10 already has single-use one-time links (`ovo_` tokens, SHA-256 stored, a new link revokes the older unused
ones) and `POST /inquiry-sessions/:id/expire` [R5]. Handoff therefore needs a **purpose** on a one-time link (handoff versus
resume), its own short default lifetime, the method recorded on the session that redeems it, and a waiting state on the first
device.

## 3. Lists

### 3.1 The model

- A **list** (`lst_`) is a container of one type; each value in it is a **list item** whose type matches the list's [D10]
  [O13] [O16]. Lists hold allow lists as well as block lists (a vetted email list that approves, a blocked IP list that
  declines) [D10] [H25].
- List attributes: `name`, `status`, `archived-at`, `created-at`, `updated-at`; the name list adds `allow-fuzzy-name-first`
  [O13]. Relationship `list-items` [O13].
- List-item attributes shared by every type: `status` (`pending`, `active`, `archived`, open set), `archived-at`, `created-at`,
  `updated-at`, `redacted-at`, `match-count` (default 0) [O14]. Relationship `creator`: a `user`, a `workflow-run` (`wfr_`), a
  `workflow-step/action` (`wfs_`), an `api-key`, or the importer that wrote it (`importer/list-item/<type>`, `mprt_`), or null
  [O14].
- Since API version 2025-10-27 list items no longer carry `inquiry_matches`, which had always been empty [C13]. Where the
  matches themselves are exposed through the API is **not documented**.
- **Retention per list.** When a list is created in the dashboard, an advanced option turns on redaction of its items after a
  chosen window [H25].

### 3.2 The thirteen types

The developer docs name 13 kinds of list [D10]; the API exposes fewer.

| # | Kind | Item type and prefix | Item fields | Create list by API | Item API | CSV/bulk importer | Sources |
|---|---|---|---|---|---|---|---|
| 1 | Browser fingerprint | `list-item/browser-fingerprint`, `libf_` | `value` (opaque string) | `POST /list/browser-fingerprints` | yes | no | [O14] [O16] [O17] |
| 2 | Device fingerprint | `list-item/device-fingerprint`, `lidf_` | `value` | **no** create path | yes | no | [O14] [O17] [R4] |
| 3 | Country | `list-item/country`, `lic_` | `country-code` (ISO 3166-1 alpha-2) | `POST /list/countries` | yes | no | [O14] [O16] |
| 4 | Email address | `list-item/email-address`, `liea_` | `value`; `match-type` `email_address` (the whole address) or `domain` (any address at that domain) | `POST /list/email-addresses` | yes | CSV `value,match_type` | [O14] [O17] [D11] |
| 5 | Face | **not in the OpenAPI** (docs: `importer/list-item/face`) | images | dashboard (support-enabled) | **not documented** | image upload `POST /importer/list-item/faces` with `image-files[]` and `list-id`, about 50 images of about 500 KB per call recommended; biometric consent is the customer's duty | [D10] [D26] [D31] |
| 6 | Geolocation | `list-item/geolocation`, `ligl_` | `latitude` (−90..90), `longitude` (−180..180), `radius-meters` (the match distance from the point) | `POST /list/geolocations` | yes | CSV `latitude,longitude,radius_meters` | [O14] [O17] [D11] |
| 7 | Government ID number | `list-item/government-id-number`, `ligin_` | `id-number`, `id-class` (for example `pp` passport, `dl` driver licence; the full code list is given on request) | `POST /list/government-id-numbers` | yes | CSV `id_number,id_class` | [O14] [O17] [D11] |
| 8 | Inquiry field | `list-item/field`, `liif_` | `field-value` only; which field the list compares is **not documented** (inference: set on the list in the dashboard) | **no** create path | yes | importer type exists (`importer/list-item/field`), no path | [O14] [O17] [O18] |
| 9 | IP address | `list-item/ip-address`, `liip_` | `value`: IPv4, IPv6, or a CIDR subnet matching every address inside it | `POST /list/ip-addresses` | yes | CSV `value` | [O14] [O17] [D11] |
| 10 | Name | `list-item/name`, `lin_` | `name-first`, `name-last`; the list's `allow-fuzzy-name-first` makes the first name match fuzzily | `POST /list/names` | yes | CSV `name_first,name_last` | [O13] [O14] [D11] |
| 11 | Phone number | `list-item/phone-number`, `lipn_` | `value` (the CSV example is E.164; the schema example is digits only) | `POST /list/phone-numbers` | yes | CSV `value` | [O14] [O17] [D11] |
| 12 | Selfie background | **not in the OpenAPI** | **not documented** | **not documented** | **not documented** | **not documented** | [D10] |
| 13 | String | `list-item/string` (the example id reuses the name prefix `lin_`) | `value` (coupon codes, order ids) | `POST /list/strings` (since 2025-09-15) | yes | **none** | [O14] [O17] [D11] [C14] |

Notes:
- The list union in the spec has eight members; it omits strings (although a strings list schema and path exist), device
  fingerprints and fields [O13] [O16].
- `docs/research/persona-surface.md` lists 11 list-item types; faces and selfie backgrounds are the two the docs add [R4] [D10].
- Item endpoints per type: `POST /list-item/<type>` (body `list-id` plus the fields), `GET /list-item/<type>/{id}`,
  `DELETE /list-item/<type>/{id}` (archive: archived items are not matched against new inquiries) [O17].
- List endpoints: `GET /lists` (`filter[status]` `active` or `archived`, newest first), `GET /lists/{id}`, `DELETE /lists/{id}`
  (archive: an archived list stays retrievable and stops matching) [O15].
- Importers: `POST /importer/list-item/<type>` takes multipart (`data[attributes][file]`, `data[attributes][list-id]`) or JSON
  with a base64 file; it answers an importer (`mprt_`) with `status` (`pending`, `ready`, `errored`), `successful-count`,
  `duplicate-count`, `error-count`, `created-at`, `completed-at` [O18]. `GET /importers` and `GET /importers/{id}` list and read
  them [O19]. Row and size limits for list CSVs are **not documented** (the 10,000-row cap belongs to report bulk creation [R9]).
- Scopes: `list.read`, `list.write`; `importer.read`, `importer.write` (importing accounts also needs `account.write` since
  2026-10-14) [D7] [C30].
- **Events:** none. The events page has no `list.*` or `list-item.*` event [D6]; importer pipelines emit
  `importer-pipeline-run.started|completed|errored|canceled|paused|resumed`, which concern the generic Importers product
  (accounts and transactions from CSV, S3, Snowflake and similar sources), not list importers [D6] [O20] [H33].

### 3.3 How matching happens

| Path | Behaviour | Sources |
|---|---|---|
| Inquiry, automatic | An inquiry that matches a list shows it as a risk signal on its page, and inquiries can be filtered by list match; the inquiry has a List matches tab with the matches from lists run during the inquiry and from workflows on it | [H25] [H6] |
| Flow logic | The inquiry flow can branch on whether collected data matches a list entry | [H61] |
| Workflow Get List Match | Pick a list, map the item fields and the values to test; the step returns a boolean; continue-on-error option | [H28] |
| Workflow conditional | A conditional step can test for a match, or the absence of one, against a list | [H25] [H27] |
| Workflow Add Item To List | Adds values from the run (an email, an IP, an ID number) to a list; continue-on-error option | [H29] [D8] |
| Workflow Add Item To Face List | Adds the image from an earlier inquiry-based step (trigger, Fetch Object, Create Inquiry) to a face list | [H30] |
| Graph Explorer | Add a property node (a device fingerprint, an IP) to a list from its hover card | [H35] |
| Account and case pages | A List Matches module shows every list match related to the account or case | [H31] [H32] |
| Reports | A `report/custom-list` type with `.ready`, `.matched`, `.dismissed`, `.errored` events, dismissible | [D6] [R9] |

**Exact versus fuzzy** [O13] [O17] [D11]:
- exact on strings, fingerprints, countries, phone numbers and ID numbers (normalisation rules **not documented**; the Graph
  reference's rules for the same data, letters and digits only for ID numbers and a country code required for phones, are a
  plausible guide **(inference)** [H38]);
- the email list matches a whole address or a whole domain;
- the IP list matches an address or any address in a CIDR range;
- the geolocation list matches within `radius-meters` of a point; which location is tested (IP geolocation, GPS, or both) is
  **not documented**;
- the name list is exact unless `allow-fuzzy-name-first` is set, which loosens the first name only; the fuzzy method is **not
  documented**;
- face and selfie-background matching are biometric and image similarity; thresholds and methods are **not documented**.

**What the inquiry does with a match:** nothing by itself. A match changes no inquiry status; automation needs a workflow, and
Persona advises auto-declining only on high-precision identifiers (ID numbers, verified emails) and reviewing name matches by
hand, since published lists go stale [H25] [H27].

**No list-match verification check** exists among the public check identifiers [R4] [D9]. The PLAN's "list-match checks" are
therefore ours (section 7 of the gap table).

**Public fraud data.** Persona points customers to government advisories as list sources and stresses that it ingests no
third-party list itself; the customer reviews and imports the data [H27].

### 3.4 Face and selfie-background lists and OpenVerify's Phase 4 index

- Phase 4 stores sealed SFace templates (`face_templates`, `source` `selfie`) only for passed, live, ID-matched selfies with
  the separate matching consent, scans them in the worker (default cap 50,000), and keeps a `selfie_backgrounds` table with a
  144-number layout vector under HNSW, written only beside a template [R7]. C42.8 already reserves other `source` values for
  "Lists: Face (Phase 7)" and leaves an ANN mode to that decision [R7].
- A face list item is therefore a sealed template with `source` `list` and a `list_item_id`, matched by the same 1:N scan
  against the current selfie; a selfie-background list item is a layout vector in `selfie_backgrounds` (or a sibling table)
  matched by the same HNSW query plus the ORB comparison of C41.2 [R7] **(inference: reuse fits both)**.
- Persona says only that face lists need biometric-processing consent and that the face list type is enabled through support
  [D10] [D26]. OpenVerify's consent (C42.3) covers comparison with earlier selfies submitted to the same organisation [R7]; a
  list built from **imported** images of people who never used the flow is a different processing purpose. That is an owner
  question (Needs the owner).

## 4. Graph

### 4.1 What links accounts

- Graph links **accounts**, not inquiries. An inquiry's data reaches the graph through its account [H34] [H37]. An account is
  indexed when it completes an inquiry, when it is added through the Graph API, or when an importer brings it in [H37].
- A **link** joins an account node to a property node; two accounts sharing a property node form a **cluster**; the distance
  between accounts is counted in **hops** (two accounts sharing a property directly are 2 hops apart; a chain through an
  intermediary is 4 or more) [H37].
- **Property types** (the query reference; formats as Persona states them) [H38]:

| Property | Match rule (our words) |
|---|---|
| Account id | the token |
| Reference id | exact, case-sensitive |
| Birthdate | `YYYY-MM-DD` |
| Name | full name in any word order, case- and accent-insensitive |
| Email address | a full address, a local part (`user@`) or a domain (`@example.com`) |
| Email similarity | a configured similarity node (section 4.3) |
| Phone number | must carry the country code; spaces, dashes and brackets ignored |
| Address | the primary address, normalised and validated, only when street, city, subdivision, postal code and country are all present |
| Postal code | normalised on its own; a 5-digit ZIP also matches ZIP+4 |
| Selfie similarity | image similarity, enabled per organisation, not in every region, removed when the selfie is redacted |
| Image background similarity | photos taken in the same or a similar place, by comparing backgrounds; enabled per organisation |
| Camera fingerprint | a sensor-level fingerprint of the camera that took the photos; limited availability |
| Browser fingerprint | any collected in a browser session or a Sentinel session; not for API-only accounts |
| Device fingerprint (browser) | when device fingerprinting is on for the template (on by default with Graph) |
| Device fingerprint (SDK) | the OS-provided device identifier, a UUID |
| Device token | a persistent identifier Persona stores client-side |
| IP address | any used in an inquiry or Sentinel session; private, loopback and iCloud Private Relay addresses excluded |
| Government ID number | letters and digits only, more than 5 characters; SSNs go to the SSN node instead |
| Government ID document number | the document's own serial number |
| SSN; last 4 SSN | nine digits; or the last four only, one or the other per entry |
| Created at | a time stamp in the viewer's time zone |
| Custom node | a node the customer defines from account or inquiry fields through node functions (a hashed card number, an internal id); existing accounts show it only after a sync |

  The table holds for hosted, embedded and SDK flows; server-API integrations populate a different set **(not documented
  which)** [H38]. First-party data comes in through importers, third-party data through marketplace integrations [H34].

### 4.2 Queries, templates and limits

- **A query** names the **starting nodes** (one or more property clauses with values), the properties that define a
  **connected** account, the **maximum hops**, and a **node limit** (default 100) [H35] [H37].
- **Two shapes of query:** from a known account or value outward; or a pattern over all accounts in a time window (accounts
  that share a property) [H35] [H42].
- **Query templates.** Saving a query makes a template; values become parameters written as a name in double curly braces;
  names are case-sensitive, letters, digits and underscores only; any number of parameters; a parameter named `account_id` is
  bound automatically to the triggering account in a workflow [H40]. Saving under an existing name overwrites that template
  everywhere at once: templates are **not versioned** [H40]. Templates are listed on a dashboard page and loaded into the
  explorer [D14] [H40]. **There is no public template API**: no `graph-query-templates` path exists, templates are referenced by
  id only [O22] [R4].
- **Running through the API** [D15] [O21] [O22]:
  - `POST /api/v1/graph-queries` with `graph-query-template-id` (required), `parameter-map` (required in practice;
    `variable-map` is its deprecated name), optional `timeout-in-seconds` (the spec says greater than 0 and less than 60; the
    guide says up to 60), and `meta.run-sync` (default false). Asynchronous by default: the answer is `201` with status
    `submitted`; with `run-sync` it returns the completed result, or what was gathered so far.
  - `GET /api/v1/graph-queries/{id}` returns `status` (`submitted`, `completed`, `errored`, `cancelled`, `timed_out`), `params`,
    `created-at`, `updated-at`, `errored-at`, `completed-at`, `redacted-at` (when set, `nodes` is empty), `stats` (empty by
    default, custom aggregates for some customers), `explorer-url`, `node-limit-reached`, `nodes[]` (`type`, `value`; types such
    as `account` and `device_fingerprint`), and the `accounts` relationship (`included` may carry the accounts).
  - At the node limit the traversal stops and returns what it has, with `node-limit-reached: true`; pagination is offered only
    on request [D15].
  - Since 2023-01-05 a graph query shows computed `stats` instead of the raw result [C15].
  - Scopes `graph.read`, `graph.write` [D7].
  - Performance advice: a narrow `created-at` window and a rare node type (ID number rather than name) run faster [D15].
- **Events:** `graph-query.submitted`, `.completed`, `.errored`, `.cancelled`, `.timed-out`, `.reran` [D6]. The OpenAPI defines
  webhooks for five of them, without `.submitted` [O23]; the surface index lists the same five [R4]. How a query is re-run (the
  `.reran` event) and how one is cancelled have no public endpoint **(not documented)**.

### 4.3 Similarity nodes

Exact matching is the default. Some property types can instead link two accounts through a **similarity node** when their
values are close enough (two email addresses that differ by punctuation and digits, a cropped or re-angled photo) [H36]:
- a similarity node always joins exactly **two** accounts; three look-alikes make three pairs, never a fan-out cluster [H36];
- similarity is turned on per property type, with an adjustable sensitivity, in a graph configuration page [H36];
- availability varies by organisation and region [H36] [H38];
- the comparison methods and thresholds are **not documented**.

### 4.4 The explorer and its bulk actions

Described from the help center, not copied [H35] [H42]:
- a query editor (starting-node clauses, connected-node properties, maximum hops, node limit, run, save, load a template);
- a canvas with select and pan modes, re-layout, zoom, multi-select by drag or shift-click, drag to rearrange;
- a results overview with summary statistics and per-property counts, from which nodes with a given property value can be
  hidden;
- hover cards per node (account details; the shared value; two images side by side for an image-similarity node) with quick
  actions; a badge on nodes that can be expanded to show more connections;
- **actions, most in bulk on a selection:** tag accounts, update account status (for example to fraudulent), export accounts as
  CSV (one, a selection, or all results), create a case, and add a property value to a list.

**Account statuses as labels.** Persona advises three account statuses for graph decisions (active after approval, inactive,
fraudulent) and queries such as shared email, shared name and birthdate, shared SSN or ID number, shared device fingerprint or
token (more telling at cluster size 3 or more), shared device fingerprint with a fraudulent account (more false positives),
shared IP with a fraudulent account in the last 12 hours (useful only at larger clusters), and shared custom properties [H39].

### 4.5 Graph in workflows, accounts and cases

- **Sync Graph** (workflow step) writes an account's current data into the graph before a query; modes: the default without
  image-embedding similarity, everything including image similarity, or only the nodes a chosen template needs. Persona says to
  sync before every query, since a query over unsynced data runs on stale data without an error [H44] [H41] [H43].
- **Run Graph Query** (workflow step) picks a template and the fields for its parameters, can store a **snapshot** of the
  result for later review, and can run **asynchronously**, in which case a wait on `graph-query.completed` must come before any
  step that reads it (an early read gives an account count of −1, meaning still running, as against 0 for no match; branch on
  `.errored` and `.cancelled` too) [H43].
- A typical proactive workflow: trigger on `inquiry.completed`, Sync Graph, one or more Run Graph Query steps in parallel, then
  tag, mark for review, open a case or decline on a cluster above a chosen size [H41] [H39].
- **Account and case Graph module:** an embedded view driven by chosen templates, with the account in context supplying the
  `account_id`; it shows **direct** connections only and opens the full multi-hop result in the explorer; it compares against
  historical snapshots [H45] [D14] [H35]. Plan-gated (higher plans) [H45].
- Graph launched as a closed beta (2023-01-05) [C15].

### 4.6 Not documented

Depth limits beyond the node limit and the hop setting (the maximum hop value), the size of the indexed population, how long
results and snapshots are kept, how redaction of an account removes its nodes (only selfie-similarity removal on selfie
redaction is stated [H38]), how stale an account's nodes may be without a sync, whether inquiries without accounts are indexed,
the custom-node function language, and the graph configuration API.

## 5. Transactions

### 5.1 What a transaction is

- An account is the "who"; a transaction is a "what": an event or journey the customer defines (onboarding, a loan
  application, a withdrawal, a booking, a submitted form) [D16] [H46]. The object is generic; the customer gives it a type, a
  field schema and statuses [D16] [D19].
- Everything that happens around a transaction happens in **workflows**: a transaction triggers workflows, which create
  verifications, reports and cases and set the transaction's status. Persona positions it as the backbone of API-first
  integrations (one call that starts several verifications) and as the replacement for the deprecated document create, update
  and submit endpoints (2026-04-13) [H46] [H50] [D20] [C26].
- Ids: transaction `txn_`, type `txntp_`, label `txnl_`, Sentinel session `snts_` [O24] [O25] [O26].

### 5.2 Transaction types and field schemas

- **API surface:** `GET /api/v1/transaction-types/{id}` only; types are created and edited in the dashboard [O34] [R4]. The
  type resource carries `name`, `created-at`, `updated-at`, `field-schemas[]` [O25]. **Statuses are not exposed by the API**;
  the update endpoint says the valid set lives on the type in the dashboard and an unknown status is refused (error text
  `Status does not exist`, an identifier clients may match on) [O28].
- **No versioning.** A saved change applies at once to new transactions, with no draft, publish step, history or rollback;
  existing transactions stay with the configuration they were created under [H49] [H50].
- **Archiving and deleting.** Fields and whole types can be archived (to fix a wrong key or follow a changed model), after which
  dependent workflows must be updated [D19]. Fields can also be deactivated or deleted in the field editor [H54]; deletion
  emits `transaction-type.deleted-field` (payload: the type) [O35] [D6]. A type conversion emits
  `transaction-type.converted-field` [D6].
- **Field editor:** label (display), key (unique, used by the API and by workflows), type, default value, relations; plan-gated
  [H48] [H54].

**Field types.** The docs page lists ten kinds (boolean, date, documents, file, float, hash, integer, string, multiple choices,
array) [D19]. The OpenAPI union has **fifteen** wire types, each with `type`, `key`, `label`, an optional `default-value` and a
`config` [O38]:

| Wire type | Config options (beyond the shared ones) | Sources |
|---|---|---|
| `string` | `max-char-length` (default 255, at most 1024), `sanitize[]` (`html`) | [O38] |
| `integer` | `min`, `max` | [O38] |
| `number` (the docs' "float") | `min`, `max` | [O38] [D19] |
| `boolean` | none | [O38] |
| `date` | `min-date`, `max-date` (ISO dates) | [O38] |
| `datetime` | none | [O38] |
| `email-address` | none | [O38] |
| `choices` | `options[]`, `option-labels[]`, `allow-empty` (default false); the default must be an option | [O38] |
| `multi-choices` | the same; each default entry must be an option | [O38] |
| `array` | `item-schema` (a field schema) | [O38] |
| `hash` | `item-schemas[]` (nested field schemas), `ignore-unknown-keys` (default false) | [O38] |
| `file` | `max-file-size-bytes` (default 10,000,000), `min-file-size-bytes` (default 1), `supported-mime-types[]` (default: common image types, PDF, plain text, CSV, MP4, WebM, QuickTime), `page-count-limit-enabled`, `page-count-min`, `page-count-max` | [O38] [C28] |
| `platform-file` | none (inference: the docs' "documents") | [O38] |
| `json` | `json-schema` (Draft 7, informational, server-synthesised for some verification types) | [O38] |
| `relation-schema` | `target` (`document-generic`, `document-government-id`, `document-government-id-nfc`, `document-mdoc`, `document-qr-code`, `selfie`) | [O38] |

**Shared config on every type** [O38]: `required`, `archived-at`, `deactivated-at`, `source-key-path` (set when the field is an
alias of another), `redaction-policy` (`none` redactable, `never`), `write-policy` (`none`, `write_once`: later writes refused
once set).

**Values on the wire.** `fields` maps each key to `{ type, value }`; a file value carries `filename`, `byte-size`,
`mime-type` (since 2023-09-18) and a short-lived download URL; a hash nests typed values [O36] [C19]. Field keys are not key
inflected (2025-10-27) [O24] [C13].

**Converting a field type** keeps the key, rewrites every stored value in the background, makes the field unreadable and
unwritable meanwhile, and clears any value that does not parse in the target type; some conversions (datetime to date, number
to integer) always lose a part; the help center lists the lossless and lossy pairs [H53].

**Filterable fields:** up to ten per type, never calculated, file, hash or relation fields; indexing can take hours [H55].
**Identifiers:** `filter[identifier][key]` and `[value]` on the list endpoint, keys from the type's configuration (plan-gated)
[O27] [C20] [H54].

### 5.3 Statuses and labels

- **Status** is a free string from the type's set. `created` is the only status Persona reserves [H47]. The guides suggest
  `created`, `completed`, `approved`, `declined` and `needs review` (with a space, also in the schema examples) as a lifecycle,
  with funnel metrics such as approved over created [H47] [D17] [O24]. A new type starts with created, approved, declined and
  needs review, according to one article [H57].
- Statuses change through `PATCH /api/v1/transactions/{id}` (`status`, since 2023-04-10) or the workflow step Update Transaction
  Status, which offers the type's custom statuses too [O28] [C17] [H57]. Each change emits `transaction.status-updated`, and
  creation emits `transaction.created` [D17] [D18].
- **Labels** are a separate, model-oriented record: `POST /transactions/{id}/label` with `meta.label`, `meta.score` (float) and
  `meta.model-version` creates a `transaction-label` (`model-label`, `model-version`, timestamps), linked from the transaction's
  `transaction-label` relationship, and emits `transaction.labeled` [O32] [O26] [O35]. The PATCH body also accepts `label`
  [O28]. What labels are for is **not documented** (inference: ground-truth or model-score feedback, given the model version and
  score). The stored score is not returned in the label schema [O26].

### 5.4 The transaction resource and its API

**Attributes** [O24]: `status`, `reference-id` (the account's reference id in the customer's user model), `fields`, `tags`,
`signals` (an untyped map, present only when the type has Sentinel enabled, filled once a Sentinel session is processed),
`created-at`, `updated-at`.

**Relationships** [O24] [O37]:
- `transaction-type`; `transaction-label`;
- `reviewer` (a workflow run, workflow step or user);
- `related-objects`: the objects involved in the transaction's workflow runs (accounts, inquiries, verifications, reports,
  cases), at most 100; any item a transaction-triggered workflow run touches is implicitly related [O24] [D21];
- `sentinel-sessions` (empty unless Sentinel collected data).

**Endpoints** [O27]–[O33]:

| Action | Path | Body | Sources |
|---|---|---|---|
| Create | `POST /api/v1/transactions` | `transaction-type-id` (required, `txntp_`), `fields`, `reference-id`, `tags`; answers 201, or 200 | [O27] |
| List | `GET /api/v1/transactions` | `filter[reference-id]`, `filter[transaction-type-id]`, `filter[identifier]`; newest first, across all types | [O27] |
| Retrieve | `GET /api/v1/transactions/{id}` | `include` for related objects | [O28] |
| Update | `PATCH /api/v1/transactions/{id}` | `fields`, `status`, `reference-id`, `label`, `tags` | [O28] |
| Redact | `DELETE /api/v1/transactions/{id}` | PII of the transaction now; child objects asynchronously; irreversible | [O28] [C21] [C22] |
| Redact biometrics | `POST /api/v1/transactions/{id}/redact-biometrics` | none; deletes biometric data of the transaction **and every associated object**, irreversible; marked `x-private` in the spec | [O33] [D24] |
| Attach objects | `POST .../add-objects`, `.../remove-objects` | `meta.object-ids[]`, at most 100; documents, inquiries, reports, verifications | [O29] |
| Relations | `POST .../add-relation`, `.../remove-relation` | `meta.relation-schema-key`, `meta.target-object-id` (an account or a transaction); idempotent (no effect when present or absent); since 2026-06-09 | [O30] [C27] |
| Tags | `POST .../add-tag`, `.../remove-tag`, `.../set-tags` | `meta.tag-name` or `meta.tag-id` (arrays for set-tags); since 2023-08-28 | [O31] [C18] |
| Label | `POST .../label` | `meta.label`, `meta.score`, `meta.model-version` | [O32] |

Scopes: `txn.read`, `txn.write` [D7].

**Relations** are typed, named, bidirectional links defined per account type and transaction type as `relation` fields, one-to-
one or one-to-many ("is an array"), each side configured separately; a workflow action sets them [H60] [D21].

**Events** [D6] [O35]: `transaction.created`, `.status-updated`, `.updated-fields`, `.labeled`, `.redacted` (emitted only after
every related object is redacted, since 2024-04-29 [C22]), `.added-relation`, `.removed-relation`,
`.sentinel-session-processed`; `transaction-type.deleted-field`, `transaction-type.converted-field`. Relation events carry a
`context` with the relation key and the target: the example uses `target-account-id` and `target-txn-id`, while the changelog
names `related-account-id` and `related-txn-id` [O35] [C25]; the sources conflict. The surface index lacks
`transaction-type.converted-field` [R4].

### 5.5 How transactions feed workflows, cases, accounts and the graph

- **Workflows:** `transaction.created` is the usual trigger for API-first flows [D20]; recurring triggers can run over sets of
  transactions [D8]; the Create Transaction step makes one from a workflow (type and fields), and the Update Transaction Status
  step moves it [H51] [H56] [H57]; Set Relation links it [H60]; continue-on-error is available on each step [H56] [H57].
- **Other objects point back:** inquiries, verifications and reports (since 2024-09-16) and documents (since 2024-09-30) carry a
  `transaction` relationship; cases carry `txns` (since 2023-03-20) and a transaction module; accounts have a transaction module
  with one-click actions (update fields or tags, redact) [C23] [C24] [C16] [H58] [H59] [O12].
- **Importers** can write transactions from CSV, S3, Snowflake and other sources, with `upsert` or `create` write modes keyed by
  reference id [H33].
- **Sentinel** transactions carry device and network data (section 1.8); the processed session in the example event carries
  IP, a device token, device and browser fingerprints, `bot-score` as a **fraction (0.02)**, unlike the inquiry's 0–100
  `inquiry/bot_score`, `threat-level`, `proxy`, `tor`, `datacenter`, `vpn`, `ip-connection-type`, `ip-isp`, location and
  `account-reference-id` [O35] [D1].
- **Graph:** the graph indexes accounts. Transactions reach it only through the account their reference id names, as Sentinel's
  IPs and fingerprints do [H12] [H38] **(inference: no transaction node type is listed in the query reference)**.
- **Dashboard:** an index with date filters, saved views and 10–200 rows per page; a type editor with fields and statuses; a
  connections view per type listing the workflows it triggers and what they create [H52] [H50].

### 5.6 OpenVerify today

No transaction, type or label resource exists; account types support four field types (`string`, `number`, `boolean`, `date`)
[R6]. Phase 6 leaves the report `transaction` relationship null until Phase 7 [R9].

## 6. Where these meet the rest of the platform

**Reports.** Three links. A `report/ip-address` report gives one-off IP intelligence outside a session (section 1.9) [O39]; a
`report/custom-list` report screens against the customer's own lists, with match and dismissal events, which Phase 6 left for
Phase 7 lists and which its review engine could host [D6] [R9]; and every report has a `transaction` relationship that Phase 6
leaves null until transactions exist [R9]. Persona's API-first guide drives watchlist and PEP reports from a transaction whose
workflow sets the transaction's status on a hit [R9]. OpenVerify should fill the `transaction` relationship in Phase 7 and add
the IP address report as a thin wrapper over the same network-intel lookup the sessions use; the custom-list report can wait
for the workflow engine **(inference: it duplicates Get List Match until workflows exist)**.

**Workflows (Phase 8).** Every decision in this note is workflow-driven in the public product: signals and list matches never
change an inquiry by themselves [H3] [H25]; Get List Match, Add Item To List, Add Item To Face List, Sync Graph, Run Graph Query,
Create Transaction, Update Transaction Status, Set Relation and Trust Device are workflow actions [H28] [H29] [H30] [H44] [H43]
[H56] [H57] [H60] [D8]; `transaction.created` and `inquiry.completed` are the usual triggers [D20] [H41]. Phase 7 therefore
builds the **services** those steps will call (list match, list add, graph sync and query, transaction create and status) as
plain functions with tests, and gives Phase 8 nothing to rebuild. Until Phase 8, a small inquiry-template option (for example
"on list match: needs review", as Phase 6 did for reports [R9]) keeps the features usable; it is ours and labelled.

**Cases (Phase 8).** Cases receive device, location (with radius overlays), list-match, graph (direct connections plus
snapshots) and transaction modules, and `txns` attachments [H8] [H9] [H32] [H45] [H58] [C16]. Phase 7 should expose the data
those modules will read (session map points, list matches per inquiry and per account, graph snapshots, transactions per account)
through the API and the dashboard inquiry and account pages, and leave the case modules to Phase 8.

**Dashboard.** Phase 7 needs: the inquiry Sessions tab (map, devices, per-session network and device details), a Signals tab
(grouped, with Beta badges and reasons), List matches; a Lists section (create, items, CSV import, archive); the Graph explorer
(Cytoscape.js, PLAN §3) with tag, status, export, add-to-list and bulk selection; Transactions (index, detail, types editor with
fields and statuses); account-page modules for signals, list matches, graph and transactions [H2] [H6] [H35] [H52] [H10] [H31]
[H45] [H59]. Signal population analytics (distribution and time series) belong with Phase 9 analytics [H2] [R1].

**Deferred to later phases.**
- Phase 8: every workflow step named above, recurring triggers over transactions, case modules, Trust Device.
- Phase 9: signal analytics, saved views for transactions and lists, CSV exports beyond graph results, flow-editor branching on
  signals, the configurable signal set per template in a visual builder (the API can carry it in Phase 7).
- Phase 10: Android device signals (root, emulator, Play Integrity adapter), Android handoff target, a Sentinel-like passive
  SDK call.
- Phase 11: Connect sharing of signals.
- Not planned unless the owner asks: graph similarity nodes for images and email (section 4.3), camera sensor fingerprints,
  Persona's account-signals product, Data Explorer, risk scoring.

## 7. Data and licence notes for Phase 7 network intelligence

Feasibility only, under `CLAUDE.md` rule 4 [R2]. Each publisher's own page was read on 2026-10-27 (one request per host, a
descriptive User-Agent, robots files read first). This note recommends **no package**, so no version pins appear here; the
libraries note should pin any parser, MMDB reader, QR encoder or fingerprint collector under the 14-day rule.

| Source | Publisher terms (decisive part, in our words unless quoted) | Format and cadence | Verdict | Sources |
|---|---|---|---|---|
| DB-IP Lite (country, city, ASN) | CC BY 4.0; attribution to DB-IP required; for a web application, a link back to DB-IP on pages that display or use results | CSV and MMDB; monthly (the October 2026 editions were listed); a reduced-accuracy subset of the commercial data | ⚠️ passes with attribution, and the link-back duty lands on the dashboard pages that show IP locations | [P1] |
| Tor exit lists (TorDNSEL, through Tor Metrics CollecTor; the bulk exit list on the check service) | Tor Metrics states its data is CC0 (graphs are CC BY 3.0 US) | Plain-text exit lists (recent 72 hours, plus archives); the bulk list answered 17,361 bytes with a Last-Modified the same day | ✅ CC0 | [P2] [P3] [P4] |
| AWS `ip-ranges.json` | No licence on the documentation page; published so customers can identify AWS traffic; update notifications by subscription | JSON (2,736,131 bytes on a HEAD, modified the same day) | ⚠️ factual public data with no stated licence; operator-run sync, never committed (C76 pattern) | [P5] [P6] |
| Google Cloud `cloud.json` | No licence stated on the FAQ that points to it (its CC BY 4.0 covers the page text); the file sits on `www.gstatic.com`, whose robots file literally allows it under RFC 9309 through an unanchored `Allow: /*.js` (corrected in fact-check) | JSON of customer-usable external ranges | ⚠️ no stated licence; the robots match is incidental (a `.js` rule catching `.json`), so the owner may still prefer caution (corrected in fact-check) | [P7] [P8] |
| Other clouds (Azure service tags, Oracle, smaller hosts) | **not researched** | — | — | — |
| VPN ASN list `X4BNet/lists_vpn` | The GitHub API detects no LICENSE file, but the README declares MIT for the scripts, automation and the lists, source files and generated output (corrected in fact-check) | Text lists, updated automatically (pushed the same day) | ✅ for the curated `input/*/ASN.txt` files pinned by commit; ⚠️ for the generated prefix lists, built from iptoasn data (corrected in fact-check) | [P9] |
| iptoasn.com (IP to ASN and country) | A footer line says "Licensed under Public Domain (PDDL v1.0)" (quoted because the scope decides the question), placed beside the source-code link, so whether it covers the data is unclear; PDDL is not on rule 4's list, though it is a public-domain dedication like CC0 | TSV, updated hourly | ⚠️ owner decision (scope of the statement; PDDL versus the CC0 entry of rule 4) | [P10] |
| MaxMind GeoLite | A proprietary end-user licence agreement, with the copyrightable parts under CC BY-SA 4.0, and a clause against FCRA uses | MMDB, CSV; an account is needed | ❌ EULA and share-alike | [P11] |
| IP2Location LITE | Its own LITE data licence: no redistribution or resale, a fixed credit line, and the site's terms of use, a master licence agreement limited to internal business use; no Creative Commons licence is linked (corrected in fact-check) | CSV, BIN; monthly | ❌ proprietary licence (corrected in fact-check) | [P12] |
| IPinfo Lite | CC BY-SA 4.0 with attribution | Country and ASN; daily | ❌ share-alike data | [P13] |
| Commercial IP reputation, proxy and residential-proxy detection, device reputation networks | Vendor contracts | API | A-tier adapter with a deterministic sandbox provider only | [R3] |

Consequences:
- **Geolocation:** DB-IP Lite is the only candidate here that passes, and it is coarse (the vendor says reduced accuracy). City
  results, and any distance computed from an IP location, must carry that accuracy in their provenance (inference: a per-source
  accuracy radius is not published for the Lite files, so the API should state "approximate" rather than invent a radius).
- **ASN and ISP:** DB-IP's ASN Lite file (CC BY 4.0) gives ASN and organisation names, so `ip-isp`/`network-organization` can be
  R tier; iptoasn waits on the owner.
- **Tor:** R tier against a dated CC0 list.
- **Datacenter:** R tier for AWS and Google (no licence stated for either; Google's robots file literally allows the files,
  corrected in fact-check) against dated lists; the same lists drive
  Persona's own `datacenter-ip` [O39]. Coverage of everything else is honest only as "unknown", never as "not a datacenter".
- **VPN:** one permissive seed exists, X4BNet's curated VPN ASN file (16 ASNs, MIT by README declaration), but it covers only
  VPN operators with their own ASNs (corrected in fact-check). `is-vpn` ships as H tier from operator-supplied ASN and range
  lists (empty by default, so the signal answers null, never false), optionally seeded from that file, plus an adapter port.
- **All lists** follow Phase 6's C76 pattern: a committed manifest with URL, content type, size cap and parser; an operator-run
  sync through the C85.1 streaming client; SHA-256 and publication time recorded per sync; staleness; never committed or baked
  into an image [R8].

## What Phase 7 should take from this (proposed)

Recommendations for the Phase 7 plan, not decisions; owner questions follow.

### Must match (parity)

1. **Ids and resources.** Add to `ID_PREFIXES`: `device: 'dev'`, `network: 'net'`, `list: 'lst'`, the ten item prefixes of L2
   (plus ours for strings, faces and backgrounds), `importer: 'mprt'`, `graphQuery: 'grphq'`, `graphQueryTemplate` (ours),
   `transaction: 'txn'`, `transactionType: 'txntp'`, `transactionLabel: 'txnl'`. Zod schemas are the contract and generate the
   OpenAPI, as usual.
2. **Session attributes** of section 1.2 with the same names and vocabularies, all nullable; `device` and `network`
   relationships; `GET /devices` with the required session filter; `expire-all`; the 25-session template cap; GPS cleared on
   redaction.
3. **Inquiry `signals`** as `[{ name, value }]`, names namespaced `inquiry/`, values in meters for every distance, only the
   template's configured signals, in every inquiry payload; `[]` when none.
4. **Handoff:** QR with a short link, email, and SMS (adapter-gated); a `purpose: handoff` one-time link, single use with a
   5-minute grace, default lifetime 3600 s, per-inquiry override; the new session records `device-handoff-method`.
5. **Lists:** all 13 kinds; the public paths for lists, items, archiving and the six CSV importers with their column names;
   item statuses, `match-count`, `creator`, per-list item retention; the matching semantics of L7.
6. **Graph:** account and property nodes, hops, node limit (default 100), templates with `{{param}}` and the `account_id`
   binding; `POST /graph-queries` (async, `run-sync`, timeout under 60 s) and `GET /graph-queries/:id` with the public
   attributes; the six `graph-query.*` events; an explorer with tag, account status, CSV export and add-to-list in bulk.
7. **Transactions:** the resource, the fifteen field-schema types with their options and the shared config
   (`write-policy`, `redaction-policy`), custom statuses with `created` reserved, labels, relations, attached objects, tags,
   redaction (children asynchronously, event after all), redact-biometrics, and the ten events; the `transaction`
   relationship filled on inquiries, verifications and reports.

### Ours, keep and label

1. **Signal honesty (extend ADR 0002 to signals, or a new ADR at the next free number).** Every signal is registered like a
   check: id, tier, stage, version, and for H tier a `confidence`, `reasons` and the thresholds used, served in a sibling
   `signal-details` map so the public `signals` shape stays intact. A lookup against missing or stale data answers `null`,
   never `false` (no "not a VPN" without a VPN list). Provenance carries each list's sync id, publication time and SHA-256, as
   Phase 6 C76 does for watchlists.
2. **Network intel package** (`packages/signals` or a sibling): Tor (CC0), AWS ranges, optionally Google ranges, DB-IP Lite
   country, city and ASN, operator-supplied VPN and proxy lists, all through a C76-style manifest and an operator-run sync over
   the C85.1 streaming client; never committed or baked into images; staleness per source.
3. **Collector** in `apps/flow`: user agent (server-parsed), automation artefacts, a first-party device token, a fingerprint
   built from our own collector (FingerprintJS v3 MIT at most), focus, paste and timing counters for the behaviour signals;
   everything after the consent screen; hashes keyed per environment so a fingerprint never links across organisations.
4. **List matches as records.** A `list-match` resource (subject, list, item, matched value form, time), the
   `list-match.created` event, and an inquiry-template rule `on-list-match: needs_review` (off by default) until Phase 8
   workflows exist.
5. **Graph storage:** normalised values stored as keyed HMACs in `graph_nodes` (display values come from the sealed sources
   when a viewer has `pii:view`), indexed synchronously on account, inquiry and session writes, links deleted on redaction,
   recursive CTEs bounded by hops, node limit and a statement timeout; versioned query templates with an API.
6. **Transaction types** with a full API and immutable versions that each transaction pins; statuses listed on the type.
7. **Face and background lists** reuse Phase 4's sealed templates (`source: list`) and background index, with items added only
   from inquiries that hold matching consent in Phase 7.

### Build order (proposed slices)

1. **Contracts first:** ids, resources, events, scopes, the signal registry, field schemas (stubs, then RED tests).
2. **Network intel and the session:** manifest, sync, lookups, the device and network resources, distances; a sandbox
   provider for reputation with documented magic addresses inside `192.0.2.0/24` and `2001:db8::/32`.
3. **Collector and signals:** the flow collector, server parsing, the H-tier roll-ups with confidences, the template signal set.
4. **Handoff:** the component, the one-time-link purpose, email (Mailpit in dev), the waiting state, the e2e test across two
   browser contexts.
5. **Lists:** resources, importers, matching per type, `list-match`, face and background lists on the Phase 4 tables.
6. **Graph:** indexer, query engine, templates, API, events, the explorer (Cytoscape.js).
7. **Transactions:** types and versions, the resource and its actions, events, relationships to inquiries, verifications and
   reports.
8. **Dashboard:** sessions and signals tabs, lists, explorer, transactions, account-page modules; the DB-IP attribution line.

### Nice to have / later

Sentinel-style passive collection for transactions; `report/custom-list`; graph similarity nodes; camera fingerprints;
Android device integrity (Phase 10); filterable transaction fields and saved views (Phase 9); workflow steps (Phase 8);
commercial IP and device reputation adapters.

### Open questions (no public answer)

- How Persona computes its fingerprints, `bot_score`, `behavior_threat_level` and `threat-level`.
- Which location a geolocation list tests, and how fuzzy first-name matching works.
- What a field list compares, and how face and selfie-background lists match.
- Whether list matching runs automatically on every inquiry or only where configured; where matches appear in the API.
- Maximum hop setting, graph retention, and how redaction removes graph data.
- What transaction labels are for, and why the label score is not returned.
- Which name the relation event context uses (`target-*` in the example, `related-*` in the changelog).
- What `session.created` and `session.expired` belong to.

## Needs the owner

Each item gives the decision, the default we recommend, and why. Phase 7 can proceed on the defaults; record the answers in the
Phase 7 plan and `docs/PROGRESS.md`.

1. **Live network data versus rule 4's pinned SHA-256.** Exit lists change hourly, cloud ranges daily, DB-IP monthly.
   - **Default:** the Phase 6 pattern (C76 and its ADR): a committed manifest with URL, content type, size cap and parser; an
     operator-run sync, never committed or baked into an image; SHA-256, publication time and counts recorded per sync;
     staleness turns signals `null`, never `false`.
2. **DB-IP Lite attribution.** CC BY 4.0 requires attribution, and a link back on web pages that display or use results [P1].
   - **Default:** an attribution line with a link in `THIRD_PARTY_LICENSES.md`, the API docs, and the footer of every dashboard
     page that shows IP locations.
3. **Google Cloud ranges.** No licence is stated; the host's robots file literally allows the range files under RFC 9309,
   through an unanchored `Allow: /*.js` that also matches `.json` (corrected in fact-check) [P7] [P8].
   - **Default:** the source is in the manifest but disabled; an operator who enables it accepts that note. AWS ranges are on by
     default (no licence stated, published for identification) [P5].
4. **iptoasn data (PDDL, scope unclear).**
   - **Default:** not used; DB-IP's ASN Lite file covers ASN and organisation. Revisit only if the owner rules PDDL equivalent to
     CC0 for rule 4 and the publisher confirms the statement covers the data.
5. **VPN and proxy detection with only one small permissive VPN seed** (X4BNet's 16-ASN file, MIT by README declaration;
   corrected in fact-check).
   - **Default:** `beta` heuristics over operator-supplied lists (empty by default, so the signals answer `null`), plus an
     `ipReputation` adapter port with a deterministic sandbox provider; the docs say residential proxies are not detected.
6. **Device fingerprinting and GPS under ePrivacy and GDPR.** Reading device characteristics and location is processing that
   may need consent in the operator's jurisdiction **(inference; not legal advice)**.
   - **Default:** collection starts only after the flow's consent screen, GPS is off by default per template and requested with
     its own prompt, fingerprints are keyed per environment and never cross organisations, and the compliance guide names the
     operator's duty.
7. **What "list-match checks" means** (PLAN §6). No public check matches lists [R4] [D9].
   - **Default:** no new verification check ids; list screening writes `list-match` records and signals, and an inquiry-template
     rule `on-list-match` (ours, off by default) routes to `needs_review`. If the owner wants checks, the next-best design is one
     check per verification type that holds the screened data (for example ID numbers on government ID), each labelled ours.
8. **Signals and decisions before Phase 8.**
   - **Default:** signals never change an inquiry's status on their own (Persona's model); an `on-signal` template rule (ours, off
     by default) may route to review, never decline.
9. **Face lists from imported images.** Phase 4's matching consent covers comparison with earlier selfies in the same
   organisation, not photographs of people who never used the flow [R7].
   - **Default:** in Phase 7, face and background list items come only from inquiries that hold matching consent; image import
     waits for an explicit owner decision, a documented lawful basis and a DPIA note in the compliance guide.
10. **Graph value storage.**
    - **Default:** keyed HMAC-SHA-256 of normalised values with a per-environment key derived from the KEK; a KEK rotation
      re-keys the node table (a `graph:rekey` job beside `kek:rewrap`).
11. **Graph similarity nodes** (email, selfie, background similarity).
    - **Default:** not in Phase 7; selfie and background similarity already exist as Phase 4 checks with their own consent.
12. **Transaction type versioning and a type API.**
    - **Default:** a full type API with immutable versions; each transaction pins its version (ours), because a self-hoster has
      no support desk and Persona's own description implies creation-time snapshots [H49].
13. **Handoff by SMS.**
    - **Default:** QR and email in Phase 7; SMS only when an SMS adapter is configured, with Phase 5's SMS-pumping limits.
14. **Bot-score scale.**
    - **Default:** `inquiry/bot_score` as an integer 0–100 (the inquiry's public scale), with our `confidence` beside it; any
      later transaction signal uses the same scale, not the fraction seen on Sentinel sessions [D1] [O35].
15. **Correct the records.**
    - **Default:** update PLAN §2 (transaction field types, signals) and §3 (IP intel row), and `persona-surface.md` (list types,
      face importer, `graph-query.submitted`, `transaction-type.converted-field`, `session.*`, `report/ip-address`) in the Phase 7
      contracts slice.

## Fact-check (2026-10-27)

Independent re-check of the load-bearing facts, 17:40–18:15 UTC, by a separate agent. Every fact was re-opened at its primary
source with a new fetcher (standard library, `python3 -I`, scripts kept in the session scratchpad, not in `scripts/`): robots.txt
first, evaluated per RFC 9309 plus any group naming Anthropic's agents; at least 1.2 s between requests to one host, and any
`Crawl-delay` honoured; a descriptive User-Agent without contact details; no personal data sent. Downloads went into new, empty
`downloads/fc-*` directories, and nothing downloaded was executed. OpenAPI facts were read from `downloads/behaviour-openapi-e64dbfb/`
only after all 276 of its files were checked against the git blob hashes of the published tree `c30a98b` (one API call for the
recursive tree): all 276 match. Process notes: `docs.aws.amazon.com` asks for a 5 s crawl delay, and two of its pages were requested
1 s apart before the fetcher honoured `Crawl-delay`; the RIPE NCC and DB-IP pages print the requester's public address, which was
replaced by `192.0.2.0` in this check's copies. Only the rows below and the sentences marked "(corrected in fact-check)" changed.

| # | Fact (as listed for Phase 7) | Verdict | Primary evidence |
|---|---|---|---|
| 1 | OpenAPI pin `e64dbfb…`, committed 2026-10-27T08:08:31Z, directory `2026-09-29`, Apache-2.0 | confirmed | GitHub API: commit date matches and it was still HEAD at 17:49 UTC; repository licence `Apache-2.0`; the commit's root tree lists `2026-09-29` as tree `c30a98bcff4b…` |
| 2 | Inquiry-session attributes, vocabularies, relationships | confirmed | `inquiry-session.yaml` at the pin. The `ip-connection-type` values are given as `examples`, not an `enum` |
| 3 | Network `service-type`, `proxy-type`, `threat-level` | confirmed | `network.yaml` |
| 4 | Device attributes; `GET /devices` requires `filter[inquiry-session-id]` | confirmed | `device.yaml`; `paths/devices.yaml` (`filter` is `required: true`) |
| 5 | 25 sessions by default; `expire-all` with `meta.inquiry-ids` | confirmed | `paths/inquiry-sessions.yaml`; `paths/inquiry-sessions_expire-all.yaml` (`meta.inquiry-ids` required) |
| 6 | Inquiry `signals` array, `bot_score` 0–100, `behavior_threat_level` levels, meters, feature flag; absent from the OpenAPI inquiry schema | confirmed | D1 gives the shape, the example values, meters and the organisation-level flag; the 0–100 range and the three levels come from H4 (`V809YiUBfhmD5ocRMVp6r7`), not D1. `inquiry.yaml` has `behaviors` and no `signals` attribute |
| 7 | GPS cleared on session redaction; `gps-country-code` added 2026-09-29 | confirmed | C12 |
| 8 | Handoff link default 1 hour; session limit 25; per-inquiry override | confirmed | H69 (1 hour, 25 sessions, `meta.one_time_link_expiration_seconds`); C7; the create-inquiry body in the spec has `meta.one-time-link-expiration-seconds` |
| 9 | One-time-link codes single use, 5-minute grace | confirmed | D3 |
| 10 | 13 list kinds; ten item prefixes; statuses; `match-count` | confirmed | D10 lists 13 kinds; the examples in the pinned tree carry the ten prefixes; `list-item-shared-attributes.yaml` (statuses; `match-count` default 0) |
| 11 | CSV importer columns; no strings importer | confirmed | D11 (it also states that IP lists accept CIDR subnets) |
| 12 | Face importer `POST /importer/list-item/faces` | confirmed | D26 (`image-files[]`, `list-id`; about 50 images of about 500 KB; consent duty) |
| 13 | Events: no list events; six `graph-query.*`; `transaction-type.converted-field`; `session.created`/`.expired` | confirmed | D6 |
| 14 | Graph query API fields, statuses, `node-limit-reached` | confirmed | `paths/graph-queries.yaml` (timeout "greater than 0 and less than 60"); `graph-query.yaml`; D15 ("up to 60") |
| 15 | Node limit default 100; hops; property nodes | confirmed | H37 states the default of 100; H38 |
| 16 | Templates: `{{param}}`, `account_id`, no versioning | confirmed | H40 |
| 17 | Field-schema union of 15 types and shared config | confirmed | `field-schema.yaml` (15 members); `field-schema-default-config.yaml` |
| 18 | Transaction endpoints and bodies | confirmed | `paths/transactions*.yaml`: create requires `transaction-type-id`; PATCH carries `fields`, `status`, `reference-id`, `label`, `tags`; `maxItems: 100`; `relation-schema-key`, `target-object-id`; `label`, `score`, `model-version`; `x-private: true` |
| 19 | Types unversioned; creation-time configuration kept; only `created` reserved | confirmed | H49; H47 |
| 20 | Scopes | confirmed | D7 lists all ten |
| 21 | `report/ip-address` added 2026-10-24 in `09d45de`; `datacenter-ip` means AWS or GCP; `tor-exit-node` values | confirmed | GitHub API (one commit for that path, 2026-10-24T08:07:32Z); `report-ip-address.yaml` |
| 22 | DB-IP Lite terms, cadence, formats, editions | confirmed | P1, the three download pages, the terms of service and the FAQ |
| 23 | Tor Metrics CC0; exit lists via CollecTor; bulk list 17,361 B | confirmed | metrics.torproject.org footer (CC0; graphs CC BY 3.0 US); collector.html; `HEAD` at 17:45 UTC: 17,361 B, `Last-Modified` 16:47:46 GMT |
| 24a | AWS `ip-ranges.json`: no stated licence, 2,736,131 B | confirmed (snapshot) | No licence on the AWS page; the saved 13:27 UTC publication is 2,736,131 B. The live file has been republished since (2,736,442 B at 17:27:40 GMT) |
| 24b | Google `cloud.json` sits on a robots-disallowed path | **corrected** | The gstatic robots file has one `*` group with an unanchored `Allow: /*.js` and a final `Disallow: /`. Under RFC 9309 longest match, `Allow: /*.js` matches `/ipranges/cloud.json` and outranks `/`, so the file is literally allowed; it was fetched here (116,078 B). The FAQ's CC BY 4.0 covers the page text, not the JSON, so "no stated licence" stands |
| 25a | MaxMind GeoLite EULA plus CC BY-SA 4.0 | confirmed | `/en/geolite2/eula` redirects to `/en/geolite/eula` ("Updated on: February 12, 2026") |
| 25b | IP2Location LITE is CC BY-SA 4.0 | **corrected** | No Creative Commons licence is linked on `lite.ip2location.com`, its data-licence page or `www.ip2location.com/database/lite`, nor in this note's own saved copy of P12. The LITE data licence forbids redistribution and resale, requires a fixed credit line and binds the user to the terms of use, a master licence agreement for internal business use. ❌ unchanged, for a different reason |
| 25c | IPinfo Lite CC BY-SA 4.0 | confirmed | P13 and the Lite database page |
| 25d | X4BNet `lists_vpn` has no licence | **corrected** | The API's `license: null` only means no LICENSE file. The README at `f2a466f` declares MIT for "the scripts, automation, and the list itself (source files and generated output)" (quoted because it decides). ✅ for the curated `input/*/ASN.txt` pinned by commit; ⚠️ for generated outputs built from iptoasn data |
| 26 | iptoasn: TSV, hourly, footer PDDL statement of unclear scope | confirmed | iptoasn.com home page (footer beside the source-code link; "Updated hourly"); its robots file also disallows `/data/*.gz$` in a second `*` group |

**Counts:** 26 listed facts, checked as 30 rows: 27 confirmed, 3 corrected, 0 could not verify.
