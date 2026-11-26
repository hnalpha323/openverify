# Signals

Signals describe how a verification was carried out: the network a session came from, the device, and how the person used the flow. They are facts for a reviewer, never a verdict. **No signal passes, fails or declines anything** (ADR 0006): no verification check reads one, and the only thing a signal can do on its own is move a completed inquiry to `needs_review`, when the template's `signal-config` says so. Heuristic signals ship as `beta` with a confidence, their reasons and the thresholds applied.

## Where they appear

- **The inquiry** carries `signals`, an array of `{ name, value }` in registry order, and `signal-details` (ours), a map from each name to `{ tier, stage, version, confidence?, reasons[], thresholds?, sources?[], sessions?[], null-reason?, computed-at }`, plus a top-level `computed-at`. Both are in every inquiry payload and webhook. `signals` is `[]` and `computed-at` is `null` until the signals are computed; with the environment setting `expose-signals` off, the API and webhooks serve `[]` and `{ computed-at }` (the console still shows them).
- **When.** On the inquiry's first move into `completed`, `failed` or `expired`, an outbox row is written in the same transaction; the `inquiry-signals` job computes the values from the stored session facts and the sealed collector bodies, freezes them, and applies the template's rule. A sweep re-enqueues a lost job every 15 seconds. A redacted inquiry gets no signals.
- **The sessions** carry the parsed device (`os-name`, `browser-name`, `device-type`, …), the network facts with their tiers and provenance (`is-tor`, `is-datacenter`, `is-vpn`, `is-proxy`, `hosting-asn`, `threat-level`, `country-code`, …), and the handoff fields. `GET /api/v1/inquiry-sessions/:id?include=device,network` adds the `device` and `network` resources.

## The catalogue

| Signal | Value | Tier, stage | Collection | What it cannot tell |
|---|---|---|---|---|
| `inquiry/bot_score` (public name) | 0-100, higher is more bot-like | H, `beta` | session integrity | real-device or OS-level automation, patched browsers, fraud-farm humans; a low score proves nothing |
| `inquiry/behavior_threat_level` (public name) | `low`, `medium`, `high` | H, `beta` | session integrity | needs at least 3 screens and 20 input events, else `null` (`insufficient_behaviour`) |
| `inquiry/automation_artefact_count` | distinct strong artefacts across sessions | R, `ga` | session integrity | the data is reported by the client; 0 carries `no_artefact_found`, not "human" |
| `inquiry/session_count` | sessions of the inquiry | R, `ga` | server | a server-API inquiry has none |
| `inquiry/network_threat_level` | `low`, `medium`, `high` | H, `beta` | server | residential proxies, most VPNs; `low` means "no listed risk found" |
| `inquiry/tor_detected` | `true` or `false` | R, `ga` | server | IPv6 (the exit list has no IPv6 exits); `false` only when every session was a public IPv4 address checked against a fresh list |
| `inquiry/datacenter_detected` | `true` or `null` | R, `ga` | server | anything outside the providers' published ranges; never `false` |
| `inquiry/vpn_detected` | `true` or `null` | H, `beta` | server | most VPNs (they rent general hosting); never `false` |
| `inquiry/proxy_detected` | `true`, an adapter's recorded `false`, or `null` | A, `beta` | server | anything without an `ipReputation` adapter bound |
| `inquiry/country_from_session` (public name) | ISO 3166-1 alpha-2 | H, `beta`, approximate | server | VPNs, roaming, corporate egress |
| `inquiry/country_comparison` (public name) | `same` or `different` (vocabulary ours) | H, `beta`, approximate | server | `null` with `ip_country_unreliable` for Tor, VPN-ASN, provider-range or privacy-relay sessions |
| `inquiry/max_session_distance` | meters between the two farthest session points | R, `ga`, approximate | server | needs DB-IP City Lite; a country is not a point |
| `inquiry/handoff_count` | device handoffs | R, `ga` | server | |
| `inquiry/device_emulated` | `true` or `null` | H, `beta`, not decisive alone | session integrity, Android | emulators that hide their build properties and devices; never `false` ([device integrity](#device-integrity)) |
| `inquiry/device_rooted` | `true` or `null` | H, `beta`, not decisive alone | session integrity, Android | root hiding (Magisk's DenyList, Zygisk modules); never `false` or "not rooted" |
| `inquiry/device_hooked` | `true` or `null` | H, `beta`, not decisive alone | session integrity, Android | renamed or injected-late hooking tools; never `false` |
| `inquiry/device_integrity_level` | `strong`, `device`, `basic`, `none` | A, `beta`, not decisive alone | Play Integrity, Android | the person; camera injection or a relay on a certified device; devices without Google Play |
| `inquiry/app_recognized` | `true` or `false` | A, `beta`, not decisive alone | Play Integrity, Android | a sideloaded or self-built host app is unrecognized by design; `UNEVALUATED` is `null`, never `false` |

Names without "public name" are ours. Every signal is in the default set and may be tested by a review rule. Three public signals are not built in Phase 7: the residence-distance signals need an address geocoder (no permissive data supports one), and velocity and fingerprint reuse are answered by the graph's templates in Workflow 7B.

**Null is not false.** When a signal could not be evaluated its value is `null`, and `signal-details` gives the reason from one frozen list (`SIGNAL_NULL_REASONS`): `signals_not_collected` (no flow session), `collector_missing` (a consented session that sent nothing), `collection_disabled`, `consent_not_given`, `list_stale`, `list_unavailable`, `provider_not_configured`, `not_in_known_ranges`, `not_in_provider_data`, `client_address_untrusted`, `address_not_public`, `ipv6_not_covered`, `location_too_coarse`, `input_missing`, `fingerprint_randomised`, `insufficient_behaviour`, `insufficient_sessions`, `sessions_not_evaluated`, `ip_country_unreliable`, and since Phase 10 `no_indicator_found`, `not_android`, `integrity_token_unavailable` (each ignored by default), `integrity_unevaluated` and `integrity_decode_failed` (each sent to review by default). A value combined over several sessions records each session's own reason.

**Combining sessions.** A boolean is `true` if any session is, and `false` only if every session was evaluated and `false`. The network threat level is the highest, and `null` if any session's is. Behaviour signals read the consented sessions only (a rejected or declined handoff session is left out); `bot_score` is the highest over sessions that sent a payload and names the silent ones (`partial_sessions`).

**Sandbox.** In a sandbox environment, [the sandbox addresses](sandbox-providers.md#sandbox-addresses) answer the network facts and `sandbox-outcome` (`bot` or `human`) fixes the two behaviour scores.

## Review rules (`signal-config`)

A template version's `signal-config` (pinned per version, like `report-config`):

```json
{
  "collect": "default",
  "on-signal": "needs_review",
  "review-rules": [
    { "signal": "inquiry/tor_detected", "eq": true },
    { "signal": "inquiry/bot_score", "gte": 90, "on-null": "ignore" }
  ]
}
```

- `on-signal` is `none` by default. With `needs_review`, a rule matches when its comparison holds, or when the value is `null` and its `on-null` says `needs_review`. Without `on-null`, the reason's own default applies: a data or collection gap (`list_stale`, `list_unavailable`, `provider_not_configured`, `collector_missing`, `client_address_untrusted`) goes to review; a fact about the subject or an operator's choice is ignored.
- A match moves a `completed` inquiry to `needs_review` (`inquiry.marked-for-review`), with the cause (`signal_rule` or `signal_unevaluated`) and the rules in `signal-details.review`. A decided inquiry is never changed (`inquiry_already_decided`), and nothing is ever declined: an automated decline on a signal is an Art. 22 decision we leave to the operator.
- Publish refuses an unknown name (422 `unknown_signal`), a rule outside `collect`, a comparison that does not fit the type (`signal_rule_invalid`), a rule on `inquiry/proxy_detected` where no `ipReputation` adapter is bound, and a rule on `inquiry/device_integrity_level` or `inquiry/app_recognized` where no `deviceIntegrity` provider is bound (`provider_not_bound`), because every inquiry would then go to review.

## Collection: the two tiers

An environment's `signal-collection` setting (permission `settings:privacy`, admin only, audit-logged) has two tiers. Server-side signals (network, sessions, handoff) do not depend on either: they are computed from what the API already records, under the operator's privacy notice for the flow.

- **Session integrity** (`on` by default): automation artefacts and aggregate behaviour, collected after the consent step, only under a template whose consent step shows the notice `notice.session-integrity`. The default template shows it ("To protect your verification against fraud, this page checks how it is being used, such as whether a browser is automated. It does not read your keystrokes or what you type."). Without the notice, or with the tier `off`, nothing is collected and the behaviour signals are `null` with `collection_disabled`.
- **Device recognition** (`off` by default): stable device characteristics and a canvas digest on the web, `ANDROID_ID` on Android, turned into keyed fingerprints. `consent` needs the optional `consent.device-recognition`, unticked by default and ticked on the session that collects; `exempt` collects on a recorded basis (`device-recognition-basis`) and needs the notice `notice.device-recognition`, and a template in `exempt` mode cannot also offer the optional tick, so a declined tick is never overridden.

Whose consent counts is decided by one function, `getEffectiveConsent`: a phone reached by [device handoff](../flow/handoff.md) records its own consent before anything is read, and a rejected phone's consent authorises nothing. `POST /api/v1/flow/signals` answers 409 `consent_required` until the posting session may collect, drops recognition members sent without that tier, and stores at most 200 bodies per session (later ones are counted, not stored).

## The browser collector

Our own, in `@openverify/signals/browser`: at most 4,096 bytes gzipped (a test bundles and measures it), with no dependency, no network call of its own (the flow posts its bodies), no cookie or other storage, no iframe, no worker and no remote code; it runs under the flow's production CSP. Before the session reports its tiers it instantiates nothing: no listener, and no read of `navigator`, a canvas or WebGL. Every browser API it reads has an entry in its registry (`BROWSER_API_READS`) with its tier and purpose. A body is sent for each screen the person leaves, and the flow sends the open screen before a submission, so the last screen arrives before the inquiry completes.

- **Integrity:** `navigator.webdriver`, known automation globals (reported as closed kinds, never their names), headless markers in the user agent or client hints, a zero-sized focused window, plugin and MIME lists that contradict the built-in PDF viewer, native functions rewritten in script, scripted (untrusted) input events, and the low-entropy client hints, time zone and up to five languages, which the server compares with the request's headers and the IP country.
- **Behaviour, per screen, aggregates only:** counts of pastes, drops, autofills, corrections, focus losses and hidden periods; whole-second dwell and hidden time; when the first input came (in four buckets); whether typing cadence was uniform (from three running sums, never the intervals); which pointer types were used; whether the pointer moved before the first click.
- **Never collected:** key values or codes, per-key timings, pointer coordinates or paths, scroll positions, clipboard contents, font lists, ad-block probes, permissions, speech voices, WebRTC, audio, plugin names, accessibility media queries (they can reveal a disability) and Android accessibility services. The Chrome DevTools Protocol `Runtime.enable` probe is not used: it stopped working on current Chromium.
- **Recognition (device recognition only):** the screen size and pixel ratio in buckets, colour depth, CPU count, memory class, touch points, the WebGL vendor and renderer, and the SHA-256 of a fixed 2D drawing computed in the browser, read twice: when the two readbacks differ, the browser adds noise, no digest is sent, and the device is marked `fingerprint-randomised` (only its class is kept).

A body goes when its screen closes, and the screen open when the tab closes goes on `pagehide`, kept alive past the page. A reloaded page or a later SDK launch numbers its bodies from the session's `next-sequence`, because the server ignores a repeated sequence. An outcome screen collects nothing: a finished session may read but not write. A body that still fails stays a gap in the data, never evidence.

**A fingerprint is not an identifier.** The server turns the components into HMACs under the environment's blind-index key: the strict `browser-fingerprint`, the coarser `device-class` (ours; shared by everyone with the same model and configuration, so never a list probe), and on Android `device-fingerprint` from `ANDROID_ID`. Each records the key id; fingerprints from another install, or after a key rotation, never match. The components are kept sealed for `signal-component-retention-days` (30 by default); devices are deleted after `device-retention-days` (365) without a sighting.

**Scores and their caps.** A strong artefact (`webdriver`, an automation global, untrusted input events, a headless marker) sets `bot_score` to at least 90. Medium and weak evidence (cross-layer inconsistency, uniform cadence without corrections, screens faster than 2 seconds, clicks without pointer travel, pastes, focus losses, long hidden periods) together never pass 60, and 70 or more needs a strong artefact. **Accessibility:** uniform cadence, fast screens and clicks without pointer travel are also what voice control, switch access and keyboard-only use look like; the cap keeps assistive technology out of the bot band, and golden keyboard-only and voice-control profiles are tested to stay below 70. Below the medium band the confidence is capped at 0.5 with `no_artefact_found`: absence of evidence is not proof. The aggregates are computed on the client, so a script that posts its own bodies can fabricate them.

## The Android SDK

`DeviceSignals` reads, after consent and only under the session's tiers: under session integrity, `Debug.isDebuggerConnected()` and the host app's `FLAG_DEBUGGABLE`, the device class (`smartphone` or `tablet`) and, since Phase 10, the emulator, root and hooking probes below; under device recognition, `Settings.Secure.ANDROID_ID` (unique per signing key, user and device on Android 8 and later). It never reads `ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED`, accessibility services, other installed apps, the IMEI or MAC addresses. A host app that enables device recognition declares "Device or other IDs" in its Google Play Data safety form; the SDK README lists the entries per tier, and [the Android guide](../android/device-integrity.md) the probes and the Play Integrity recipe.

**The debugger facts** (Phase 10). `debugger-connected` is medium evidence for `bot_score` (`android_debugger_connected`, at most the medium band) and counts as one automation artefact in `automation_artefact_count`; `app-debuggable` (the host app's own build) is weak evidence (`android_app_debuggable`). Neither alone reaches the strong band, and a body with neither reads the low band with `no_artefact_found`, never "human". They show that a debugger was attached, or the app was a debug build, when the body was read; they do not show who attached it or why (a developer testing their own app looks the same). `behavior_threat_level` has no Android input: it stays `null` with `input_missing`.

## Device integrity

Five signals from Phase 10 (C210, C211), all `beta` and **never decisive alone** (`decisive-alone: false` in the registry):

- **The heuristics** `device_emulated`, `device_rooted` and `device_hooked` read the indicator codes the Android SDK's probes sent in `android-integrity` (emulator: `build_hardware_goldfish_or_ranchu`, `build_product_sdk`, `build_model_emulator`, `qemu_property`, `qemu_device_file`, `no_telephony_and_generic_board`; root: `su_binary_on_path`, `build_tags_test_keys`, `system_mounted_rw`, `magisk_mount_trace`, `ro_debuggable_and_not_secure`; hooking: `frida_in_process_maps`, `frida_thread_name`, `xposed_bridge_loadable`, `xposed_in_stack_trace`, `unexpected_native_library`). Each is `true` with its codes as reasons and a confidence by the number of independent indicator families (build properties, files and mounts, the process): 0.5, 0.7, 0.85, provisional. Otherwise it is `null`: `no_indicator_found` (the probes ran and found nothing), `not_android` (only web sessions collected), `collector_missing`. **A clean result is never `false`, "not rooted" or a pass.**
- **What the heuristics cannot see.** Every probe runs inside an environment the attacker may control: root hiding, a modified emulator image, renamed hooking tools and a repackaged app return clean answers. They say nothing about camera injection or a relay.
- **Play Integrity** (`device_integrity_level`, `app_recognized`, A-tier) is off by default: it needs a `deviceIntegrity` provider bound for the environment kind (`play-integrity`, or `sandbox` in a sandbox) and a host app that installs an `IntegrityTokenProvider`. The token is decoded and judged on the server, in a job; only a fixed projection of the verdict is stored, sealed (the device recognition labels, the app recognition, each server check, the decode time), and every other member Google returns is dropped. No Play Integrity field feeds a device list, the graph, `device-fingerprint` or `device-class`. Every value names its provider in `sources`, with whether it is the sandbox. The `null` reasons: `provider_not_configured` (no provider bound, to review by default, which is why publish refuses a rule then), `integrity_token_unavailable` (the host installed no provider, or it gave nothing; ignored by default), `collector_missing` (a token posted but not yet decoded), `integrity_decode_failed` (a failed decode, or a replayed or foreign token: a failed package, request hash or timestamp check; to review) and **`integrity_unevaluated`**: Play answers `UNEVALUATED` when a requirement was missed, typically because the device did not meet integrity, which is what a hooked, rooted or emulated device produces. It is a data gap with an adverse cause, so it goes to review whatever the rule's `on-null` says, and it is never `false`.
- **What Play Integrity cannot see.** A verdict is about the app and the device, never the person: a certified device can still present an injected camera feed through a granted app, or relay a real person; devices without Google Play give no verdict; sideloaded or self-built host apps are unrecognized by design. Google's default quota is 10,000 requests a day per Cloud project; the SDK asks once per inquiry, only when the session says so.

**Publish (decision 32).** The rule is defined over what a route reads, not over what it reads alone:

- **Flows:** a `failure` step downstream of a route whose condition reads any of the five is refused (422 `definition_invalid`, code `signal_not_decisive_alone`), in every environment, unless a verification step and a route that reads that verification's outcome lie between the signal's route and the failure. Adding a trivially true fact to the condition does not pass.
- **Workflows:** the same rule refuses a `decline_inquiry` step and every other adverse step after a route on such a signal, unless a `run_verification` step and a route on its outcome lie between.
- **Every route** that reads such a signal, either way, needs the acknowledgement `heuristic:<step id>` where Phase 9's heuristic acknowledgements apply, the two A-tier Play Integrity signals included.
- **The limit:** a condition that couples the signal with the outcome of a verification that does lie on the path passes the check; the decision record then names the signal codes with their tiers. We recommend `flag_for_review` over a decline.
- **The notice:** while a `deviceIntegrity` provider is bound, a v2 flow whose consent shows `notice.session-integrity` must also show `notice.play-integrity` (it names Google and what Google receives) on that consent or on a screen that dominates it (422 `definition_invalid`, code `play_integrity_notice_missing`; Phase 10 decision 66).

**Session integrity, the notice and the law.** The probes run only under `notice.session-integrity`; the [session-integrity assessment template](../compliance/session-integrity.md) lists each probe for the operator's strictly-necessary assessment (not legal advice).

## The law (not legal advice)

This section names the questions an operator answers before turning collection on; it is not legal advice, and OpenVerify takes no position on the answers.

- **Session integrity without a separate consent** rests on the operator's assessment that reading these characteristics is strictly necessary for the service the person asked for (the ePrivacy exemption): see WP29 Opinion 9/2014 §7.5, CNIL délibération 2020-091 ¶49, and UK PECR Schedule A1 paragraph 4 (in force from 2026-02-05). The person is still told (GDPR Art. 13), which is what `notice.session-integrity` does.
- **Device recognition** stores and reads device identifiers across visits; outside a documented exemption it needs the person's consent, which `consent.device-recognition` records on the session that collects.
- **Automated decisions.** Signals never decide; a review rule sends an inquiry to a person. An operator who builds automatic declines on top (Phase 8 workflows) carries the Art. 22 duties.

**A DPIA outline** an operator can start from: the purpose (fraud prevention in identity verification); the data (per tier, above); the necessity and the less intrusive alternatives considered (server-side signals only; session integrity without recognition); retention (the three windows above, and `ip-retention-days` for addresses); who can see it (`pii:view` for addresses, locations and fingerprints; `settings:privacy` for the switches); the risks (false positives against assistive technology, a fingerprint used to track, a client-chosen address) and the measures (the caps, keyed HMACs per environment, `client_address_untrusted`); and the review of each signal's thresholds, all provisional until a calibration exists.
