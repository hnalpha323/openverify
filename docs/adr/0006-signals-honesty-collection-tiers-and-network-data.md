# ADR 0006: Signals: honesty, collection tiers and operator-synced network data

- **Status:** Accepted (Workflow 7A Stage 1a, 2026-10-30). It extends ADR 0002 to signals, and records how live network data (IP geolocation and ASN, Tor exits, cloud ranges) meets `CLAUDE.md` rule 4, as ADR 0005 did for public-sector lists.
- **Date:** 2026-10-30
- **Related:** ADR 0002 (check tiers and honesty); ADR 0005 (report honesty and live public-sector data); `docs/plans/phase-7.plan.md` C90-C96, C99.9, C107.7 and decisions 1-6, 8, 12-18, 44, 45, 47, 53-55; the owner decisions 10 and 20 after Workflow 6B; `docs/research/phase7-network-data.md` and `phase7-client-signals.md`.

## Context

Phase 7 gives inquiries signals: facts about the network a session came from, the device, the person's behaviour on the flow, and the move from a desktop to a phone. They are fed by three kinds of evidence, each weaker than a check's:

1. **Lists that are never exhaustive.** A Tor exit list answers for the exits it lists; a cloud provider's ranges answer for that provider; an ASN list of VPN networks misses most VPNs and every residential proxy. "Not listed" is not "not a VPN".
2. **Data the client reports.** Automation artefacts and behaviour aggregates are computed in the browser or the app and sent to us. A script can fabricate or replay them. A low score proves nothing.
3. **Data that changes faster than a pin.** DB-IP keeps only two months of its Lite files online, Tor exits change every hour and cloud ranges every day. Rule 4 asks for downloads pinned by SHA-256, which such data cannot meet without going stale.

Reading device data is also regulated: the ePrivacy rule on terminal equipment, GDPR Art. 13 notice, and Art. 22 on automated decisions. A signal that declined a person on its own would be such a decision.

## Decision

### 1. Signals have tiers, as checks and reports do

Every signal is an entry of `SIGNAL_REGISTRY` (`packages/core/src/signal-registry.ts`) with its layer, tier, stage, version, value type, collection tier and, for an H-tier or combined entry, every threshold it applies with its basis and source. R is exact logic over a stated input (a Tor lookup against a fresh list, a provider-range lookup, a count, a haversine distance); H is a heuristic with a confidence (the bot score, the behaviour and threat levels, the VPN and hosting-ASN flags, the country signals); A is an adapter with a deterministic sandbox (`ipReputation`). Combined tiers follow ADR 0002 (`R/H`: R from one kind of evidence and H from another), and `signal-details.tier` is the tier of the evidence actually used. H-tier entries stay `beta` until a calibration report exists; every constant is `provisional`, and none is tuned on test data. A constant that changes needs a version bump, which a golden test enforces.

### 2. An unknown is `null`, never `false`; no signal decides

- **`null` with a reason.** Every signal a template collects is present on the inquiry. When it could not be evaluated, its value is `null` and `signal-details` names the reason from one frozen enum (`SIGNAL_NULL_REASONS`). Each reason has an `on-null` default (`ON_NULL_DEFAULTS`): a data or collection gap goes to review, a fact about the subject or an operator's choice is ignored.
- **`false` only where the data is exhaustive.** In Phase 7 that is `tor_detected` for a public IPv4 address checked against a fresh exit list, and `proxy_detected` when a bound adapter's file positively records a negative. `datacenter_detected` and `vpn_detected` are typed `true` or `null`, never `false`.
- **The schemas enforce it** (`packages/contracts/src/signals.ts`): never-false flags refuse `false`; a `signal-details` entry of an H-tier signal requires its confidence, reasons and thresholds; a `null` value requires a null reason, and only a `null` value has one.
- **Low is not clean.** A threat level of `low` and a low bot score carry a capped confidence and the limits that apply (`vpn_list_not_exhaustive`, `proxy_not_evaluated`, `no_artefact_found`); the console words them "no listed risk found" and "no automation artefacts found".
- **No signal passes, fails or declines anything.** No check reads a signal, and no check is added for signals. The only effect a signal has is the opt-in template rule `on-signal: needs_review`, which moves a `completed` inquiry to review and never declines, so a person can always reach a human (GDPR Art. 22). An operator who wants a decline writes a Phase 8 workflow and owns that decision.
- **The one stated exception** is a list match, not a signal (C99.9): the existing R-tier check `id_compromised_detection` fails on an exact match of the extracted ID number against a government ID number list the operator opted in with `use-for-compromised-ids`. It is opt-in per list, exact, on the operator's own data, and the check's requirement stays the operator's, who may make it advisory and who owes the person the human review of Art. 22. When such a list could not be screened, the check answers `not_applicable` (`compromised_list_unavailable`), never `passed`.
- **Provenance.** A network-derived value names the sync id, publication time and SHA-256 of each source it read, and an adapter's answer names its provider and `sandbox`.

### 3. Two collection tiers, a notice and a consent

- **Server signals** (the address the API already records, the sessions, the lists) are computed whatever the collector tiers say, under the operator's privacy notice for the flow.
- **Session integrity** (automation artefacts and aggregate behaviour metrics, never keys, coordinates or timings) is on by default after the consent step, on the operator's documented strictly-necessary assessment (WP29 9/2014 §7.5, CNIL délibération 2020-091 ¶49, UK PECR Sch. A1 para 4). That assessment is the operator's; OpenVerify takes no position. The person is still told (GDPR Art. 13): a template collects only when its consent step lists the required notice key `notice.session-integrity`, whose default text is "To protect your verification against fraud, this page checks how it is being used, such as whether a browser is automated. It does not read your keystrokes or what you type." Without the key, or with the tier `off`, nothing is collected and the behaviour signals read `collection_disabled`.
- **Device recognition** (stable device characteristics and a canvas digest, and Android's `ANDROID_ID`, keyed per environment) is off by default. `consent` needs the optional key `consent.device-recognition`, unticked by default, ticked on the very session that collects: "Recognise this device on later visits, to protect my account from misuse." `exempt` collects without a tick on a recorded basis (`device-recognition-basis`) and needs the required notice key `notice.device-recognition`: "This service recognises the device you use, to protect accounts from misuse." A template in `exempt` mode cannot also offer the optional tick, so a declined tick is never overridden.
- **Whose consent counts.** One function, `getEffectiveConsent`, decides for every gate. A phone reached by device handoff records its own consent before anything is read or captured, and a rejected phone's consent authorises nothing.
- **Nothing is read before the session may collect,** and no browser API is read without a registry entry and a consent or notice key. The switches are under a separate permission, `settings:privacy` (admin by default), and every change is audit-logged.

### 4. Live network data reaches the database only through the operator's sync

Rule 4 is interpreted for public network data as ADR 0005 interpreted it for public-sector lists:

- **Operator-synced, never committed or shipped.** DB-IP Lite (CC BY 4.0), the Tor exit list (CC0, Tor Metrics) and the cloud providers' published ranges are downloaded only by the operator-run `network:sync`, or by the `network-refresh` tick when `OPENVERIFY_NETWORK_REFRESH=true`. They are never in git, an image, CI or a test. Tests, the e2e and the sandbox use synthetic files in each publisher's format, built from the documentation ranges and ASNs.
- **Verified instead of pinned.** A committed manifest (`network/sources.json`) describes each source: its URLs or monthly URL template, the one host a redirect may go to, content types, byte caps, deadline, parser, refresh and staleness intervals, terms note and attribution. Every check downloads the publication and compares its SHA-256; no publisher change signal is read (owner decision 10 after Workflow 6B), and HTTP conditional requests are Phase 11's. A sync downloads over HTTPS through the vetted lookup, follows at most one redirect to the exact allowed host on the request's own scheme and port (owner decision 20 after Workflow 6B), parses strictly, and applies under a per-source lock with the rollback, mass-removal and mass-addition guards, unless an audited override says otherwise.
- **Stale data answers `null`.** Freshness counts from the last successful check; a stale or unavailable source makes the facts it feeds `null` with `list_stale` or `list_unavailable`. The sandbox source is never read in production.
- **Snapshots are public data, not subject data:** stored unenveloped, with the SHA-256 on the sync row re-checked at every load.
- **Pinned seeds stay pinned.** The hosting and VPN ASN seeds (X4BNet `lists_vpn`, MIT, and `bad-asn-list`, MIT) change rarely, so they go through `scripts/fetch_data.py` at a commit at least 14 days old, with SHA-256 and size in `data/manifest.json`, into the gitignored `data/`.
- **Terms per source.** DB-IP's CC BY 4.0 asks web pages that show results for a link back: "IP geolocation by DB-IP", linking `https://db-ip.com`, appears wherever an IP location or a distance computed from one does. Azure's service tags (Microsoft's site terms are personal and non-commercial) and Apple's Private Relay egress list ship disabled. MaxMind GeoLite (a proprietary EULA), IPinfo Lite (CC BY-SA), IP2Location LITE (no redistribution), OpenStreetMap's Nominatim (ODbL and a usage policy) and iptoasn (robots-disallowed) are not used.

### 5. Where it is enforced

| Rule | Enforcement point |
|---|---|
| Tiers, stages, thresholds with a basis, versions | `packages/core` `SIGNAL_REGISTRY` and its golden test |
| `null` with a reason, never-false flags, H-tier confidence, the `on-null` defaults | `packages/contracts` `signals.ts` (`signalAttributeIssues`, `ON_NULL_DEFAULTS`) and its tests |
| No signal decides; `on-signal` only moves `completed` to `needs_review` | the `inquiry-signals` job (Workflow 7A Stage 3) and its tests |
| Collection only after consent and under the keys | the flow's collector, the `POST /flow/signals` route and the publish rules (Workflow 7A) |
| Network data never committed, verified on every sync | `.gitignore` (`data/*`), the operator CLI, CI never calling a publisher, synthetic fixtures from seeds |

## Alternatives considered

| Option | Why not |
|---|---|
| Answer `false` when an address is not on a list | The lists are not exhaustive; `false` reads as "checked and clean". |
| Ship signals as checks that fail an inquiry | A weak, client-reported or non-exhaustive signal would decline people automatically (GDPR Art. 22) and could not be calibrated. |
| Commit or bake a DB-IP snapshot into the image, pinned by hash | Stale within weeks, and a redistribution the operator never chose. |
| Use FingerprintJS as the collector | v5 is MIT again, but it sends a usage-statistics request by default, its components change between minor versions, and it reads more than a fraud signal needs. Our own collector stays under 4 KB gzipped, with no network call and no storage. |
| Collect session integrity before consent | The ePrivacy assessment is the operator's to make; collecting before the person has seen the notice cannot be justified for everyone. |

## Consequences

- A fresh install has no network data until the operator runs `network:sync`; every network signal reads `list_unavailable` until then, and the console says why.
- Operators carry the notice and consent texts, the strictly-necessary assessment, and a DPIA for device recognition.
- More reasons to explain: null reasons, evidence reasons, confidences and the `beta` badge appear in the console and the docs.
- Fingerprints never cross environments or installations: each is an HMAC under the environment's blind-index subkey, with the key id recorded so a rotated key answers `key_rotated`, never "no match".
