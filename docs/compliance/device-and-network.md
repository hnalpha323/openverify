# Device and network data

This is not legal advice.

Not reviewed by counsel.

What OpenVerify reads from the person's browser or device and from their network address, on which basis the software expects you to rely, and how long it keeps it. The rules are ADR 0006 (`docs/adr/0006-signals-honesty-collection-tiers-and-network-data.md`) and the signals page ([signals](../checks/signals.md)).

## The three tiers

| Tier | What | Default | What the software requires before it collects |
|---|---|---|---|
| Server signals | The address the API already receives, sessions, list results | Always computed | Your privacy notice for the flow |
| Session integrity | Automation artefacts and aggregate behaviour metrics (never keys, coordinates or timings); on Android, debugger, emulator, root and hooking indicators | On, after consent | The template's consent step shows the notice key `notice.session-integrity`, and the person has given the consent step's agreement on this session; without the key, or with the tier `off`, nothing is collected |
| Device recognition | Stable device characteristics and a canvas digest; on Android, `ANDROID_ID` | Off | `consent` mode: the optional key `consent.device-recognition`, unticked, ticked on the session that collects. `exempt` mode: a recorded basis (`device-recognition-basis`) and the notice key `notice.device-recognition`; a template in exempt mode cannot also offer the tick |

The tiers are the environment setting `signal-collection`, changed only with the permission `settings:privacy` and audit-logged (C90.8). Nothing is read before the session may collect, and no browser API is read without a registry entry and a consent or notice key (ADR 0006 §3).

**The notice texts stay at ADR 0006's defaults until the owner confirms their wording** (owner decision 8 after Workflow 7A). This guide does not reword them; ADR 0006 §3 holds them, and on Android the built-in `notice.session-integrity` text names the probes (Phase 10 decision 66).

## Session integrity on the strictly-necessary basis

Storing or reading information on a person's device needs consent unless it is strictly necessary for a service the person asked for. Whether that exemption covers session integrity for your service is your assessment; OpenVerify takes no position. The sources the software's design follows:

- **WP29 Opinion 9/2014, section 7.5** (re-read on 2026-11-20, [S12](sources.md)): in our reading, device fingerprinting for a security purpose the user has asked for can qualify for the consent exemption only if the data is used for no secondary purpose, with technical and organisational safeguards against such use.
- **CNIL délibération 2020-091, paragraph 49** ([S13](sources.md); **re-read in part on 2026-11-20**: Légifrance answered 403, and in the CNIL's own PDF the list's item on authentication was not legible to us): it lists trackers that may be exempt from consent; Phase 7 cited it for trackers that secure an authentication mechanism.
- **UK PECR, Schedule A1, paragraph 4** (re-read on 2026-11-20, [S14](sources.md); inserted 2026-02-05): an exception for storage or access strictly necessary to provide a service the user requested, which includes protecting the service's security and preventing or detecting fraud.

The probe-by-probe template for your assessment is Phase 10's [session integrity](session-integrity.md) page, and its list of what is never read under any tier holds. The software's side: collection only after the consent step, codes from fixed lists rather than values on Android, beta heuristics that never decide alone (publish refuses a decline that follows from them without a verification outcome between), and the retention below.

## Device recognition

Off by default. If you turn it on, the fingerprints are stored as HMACs under a per-environment key (`devices`, `session_devices`; the key is derived from `OPENVERIFY_BLIND_INDEX_KEY`), never in plain, and the account export lists a device as present with its first and last seen, never its fingerprints ([access requests](access-requests.md)). ADR 0006 expects an operator who turns it on to carry a DPIA for it ([DPIA](dpia.md)).

## Retention

| Data | Setting | Default |
|---|---|---|
| The collector's sealed components and behaviour bodies | `signal-component-retention-days` | 30 days |
| Addresses (the session's, the network evaluation's, list matches from the session's address) | `ip-retention-days` | unset: kept as long as the inquiry |
| Devices not seen again | `device-retention-days` | 365 days |
| The frozen signals on the inquiry | the inquiry's retention, and its redaction | `inquiry-retention-days` unset |

Every setting is on [retention](retention.md).

## Network data

- **What the install looks up**: the session's address against network data the operator's install downloads itself, DB-IP Lite (country and ASN, CC-BY-4.0), the Tor exit list and cloud providers' published ranges ([network data](../network/README.md)). The downloads send no personal data; lookups are local. City-level data (`dbip-city-lite`) is off by default.
- **IP reputation**: only from an operator-licensed file read locally (`OPENVERIFY_IP_REPUTATION_MMDB_PATH`, the `mmdb-file` adapter); a lookup sends nothing anywhere ([recipients](recipients.md)).
- **The client address** is what the install sees through `OPENVERIFY_TRUST_PROXY`; misconfigured, every production network fact is null with `client_address_untrusted` rather than wrong.
- Network facts other than the address and the location are plaintext by decision (C107.5); the address and location are sealed.

## Android

- **What the SDK reads per tier**, what it never reads and one Google Play Data safety row per category are in the SDK README (`android/openverify-sdk/README.md`) and member by member in [Android privacy](../android/privacy.md). The Data safety answers are the app developer's, and the category choice for the release is the owner's (KP10-61, open).
- **`ANDROID_ID`** is read only under device recognition, and sent to be keyed per environment.
- **Consent digests**: the server stores the digest of the consent text the SDK reports it rendered, labelled client-reported; no console view of a consent record exists yet (D4).
- **Play Integrity** is off by default. If an operator binds `play-integrity`, the device's integrity token goes to the operator's server, which sends it to Google to decode, so Google is a recipient; publish then requires the notice `notice.play-integrity` beside the session-integrity notice (C211.9). No Google code ships in the SDK (Phase 10 P3, declined).
- **The chip read** (optional `openverify-nfc`) reads the document's chip into memory and sends it to the operator's server only ([NFC checks](../checks/nfc.md#privacy-and-retention)).
- **The on-device face detector** (optional `openverify-face`) sends nothing: it runs ONNX Runtime inside the app with telemetry switched off. On one phone (a Pixel 9, Android 17, commit `d6af3cc37`) no byte moved over the measured window; that is the measured window on that phone, not a proof for every device ([Android privacy](../android/privacy.md)).
