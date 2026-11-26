# Phase 7 research: browser and device signals, bot detection and the law that governs them

Prepared 2026-10-27 (local time, UTC−4; requests ran from about 16:45 to 17:40 UTC) for OpenVerify Phase 7, "Signals, lists, graph, transactions" (`docs/PLAN.md` §6 Phase 7, §4.4, and the Signals row of §2 [R1]).

**Scope.** This note covers:
- what the web flow (`apps/flow`) and the Android SDK (`android/openverify-sdk`) can honestly collect;
- how a server can score it;
- what the law requires.

It does not cover IP geolocation, Tor, cloud and VPN data sources, lists, the graph or transactions, except where they consume these signals.

**Clean room.** Everything is in our own words. Field names, enum values, event names, type names, configuration keys and URL paths are reproduced only as identifiers needed for parity. No sentences, UI copy or help text are copied. Licence text is quoted only as short fragments of a company's copyright line, to identify the holder. Individual authors and copyright holders are not named, and papers are cited by title. Repository owners' handles appear only where a citation's URL needs them. Statements no source makes are marked **(inference)**; facts the public sources do not give are marked **not documented**. No real personal data appears: no person's IP address, fingerprint, face or name.

**Method.**
- **Package metadata:** npm registry documents for 16 package names (one, `broprint.js`, does not exist on npm).
- **Tarballs:** 12 package tarballs, inspected in memory with `python3 -I` scripts kept in `scripts/` (`npm_summary.py`, `tgz_inspect.py`). Nothing from a download was executed.
- **Licences and sources:** LICENSE files and source files read at the tag or `gitHead` through `raw.githubusercontent.com` and `api.github.com`; neither host has a robots file.
- **Pages:** vendor and regulator pages read with a fetcher.
- **Android reference pages:** saved and searched with `android_ref_extract.py`.
- **PDFs** (EDPB 2/2023, WP29 9/2014, the CNIL guidelines): text extracted by `pdf_text.py` with `pypdf` 6.20.1, in a throwaway `uv` environment resolved with `--exclude-newer 2026-10-13`.
- **Robots and rate:** robots.txt was read before each new host (exceptions under "Process deviations"), and requests stayed at one per second per host or slower (5 s for legislation.gov.uk; a single request to blog.mozilla.org, whose crawl delay is 10 s).
- **Sibling downloads:** a sibling agent's clone of the Persona OpenAPI was used only to find file names. The files cited here were fetched again at the same commit.
- **Budget:** my downloads total about 19 MB, under the 30 MB budget. The shared `downloads/` folder also holds other agents' files.
- **Repository:** read-only, at `fe4850ca`; nothing in it was changed.

**Process deviations** (recorded honestly):
- One request to `developer.android.com` went out in the same step as its robots.txt check, not after it. The path requested (`/privacy-and-security/...`) is allowed by that file, and it answered 404.
- One page each on `arxiv.org`, `www.fastly.com` and `w3c.github.io` was fetched before their robots.txt was read; it was read afterwards. All three paths are allowed (`/abs`, `/blog/...` and `/webdriver/`), and a single request per host is within arXiv's 15 s crawl delay.
- The DataDome article [S4] and the papers [P1][P2][P3][P5][P6][P7] were read only through search-engine summaries of their abstracts and records, not fetched. The numbers taken from them are those that the summaries attribute to the abstracts.
- `www.ilga.gov` and `lig.ilga.gov` failed TLS verification (an incomplete certificate chain). BIPA's definition was therefore read through a search engine's reading of the official ILGA page, not fetched directly. TLS verification was not disabled.
- `leginfo.legislature.ca.gov` answered 403, so the CCPA text was read from the `california.public.law` mirror.
- The Texas statute page rendered only navigation, so CUBI's definition comes from a search summary of the official page.
- Mozilla's support article on fingerprinting failed to load.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**.

**Legend.** ✅ passes rule 4 for commercial self-hosting · ⚠️ passes with a caveat or needs an owner decision · ❌ fails. Tiers R, H and A are those of ADR 0002 [R3]; the honesty rules are CLAUDE.md rule 5 [R2].

---

## Summary

1. **FingerprintJS is MIT again.** 5.0.0 (2025-10-22) moved from BUSL-1.1 back to MIT; 5.3.0 (2026-10-07) is both the latest and the newest pinnable version [L2][L3]. Only 4.x is BSL. PLAN §3 and THIRD_PARTY_LICENSES still say "v3 only" and exclude "v4+" [R1][R23]. Even so, **we recommend our own collector**, for four reasons:
   - FingerprintJS's npm build sends usage statistics by default (`monitoring: false` turns that off);
   - its component set is outside semver, and identifiers can change between minor versions;
   - it probes for ad blockers;
   - it costs about 16 KB gzipped, against a 4 KB budget for ours [L4][L5][L6][M1].
2. **ThumbmarkJS 1.12.0 (MIT) evaluates remote code** on sampled runs unless `logging: false` is set [L8]. **BotD 2.0.0 (MIT)** is a short list of static artefact rules with a stability-only roadmap [L7]. ClientJS is unmaintained; CreepJS is a test page, not a library [L9][L10].
3. **Browsers break fingerprint reuse by design.**
   - Safari adds noise to canvas and audio in Private Browsing [B1], and Safari 26 restricts known fingerprinting scripts, with no browsing-mode limit stated in the post (reading it as all browsing is an inference; corrected in fact-check) [B2].
   - Firefox randomises canvas in private windows, and in its "Baseline" set from 151 [B3].
   - Brave randomises values per session and per site [B6].
   - Chrome's Privacy Budget is archived and was never built [B7].

   A fingerprint is therefore a weak, short-lived link: hash it in two tiers, detect the noise, and never decide on it alone (§1.4).
4. **Automation detection only raises risk.** `navigator.webdriver` and driver globals are strong when present. The classic CDP check stopped working in May 2025 [S3]. Stealth plugins cover most static artefacts [L16]. Humans in fraud farms, real-device automation and patched browsers cannot be detected client-side (§2.3).
5. **Behavioural metrics stay aggregate.** We collect counts, coarse timings and one cadence class, never raw keystrokes or coordinates. Keystroke timings identify people [P7], and California and Washington law name keystroke patterns as biometric [U2][U3]. `bot_score` (0–100) and `behavior_threat_level` match Persona's signal names [D1]; both are H-tier `beta` and never auto-decline (§3.4, §6.2).
6. **TLS fingerprints need a proxy we do not run.** JA3 is unstable on Chrome [S5]. JA4 is BSD-3 and could be read from a trusted proxy header by an optional adapter; JA4+ is under the non-commercial FoxIO licence ❌ [L19].
7. **Android without Play Integrity** gives `ANDROID_ID` (per app-signing key, user and device) [A2], debugger state [A3], and heuristic emulator and root indicators. `ADB_ENABLED` and developer settings always read 0 to third-party apps [A4].
8. **QR handoff.** RFC 10027 (BCP 247, August 2026) example B6, "illicit onboarding", is the IDV threat [I1]. We propose a new 256-bit, single-use `ovh_` token with a 5-minute lifetime bound to the issuing session, carried in the URL fragment; a context screen on the phone; "this was not me" on the desktop; and IP distance in meters as a review signal (§5).
9. **Law.** Fingerprinting falls under ePrivacy Art. 5(3) [E1][E2]. Per-session fraud-prevention signals are the best candidates for the strictly-necessary exemption: WP29 9/2014 §7.5 [E1], CNIL ¶49 [E4] and the UK's new PECR Sch. A1 fraud example (in force 5 February 2026) [E5][E6] all point that way. Cross-inquiry device recognition should be opt-in with consent (WP29 9/2014 §7.4 [E1]).
10. **Defaults.** Nothing is collected before the consent step. Session-integrity signals are on; device recognition is off with an optional consent key; GPS is off; JA4 is off. Everything is in the final table and in "Needs the owner".

## 0. OpenVerify today: what the flow and the SDK collect

Read on 2026-10-27 at `fe4850ca` (read-only). Phase 6 agents were writing in the same tree; nothing here depends on their files.

**Web flow (`apps/flow`).**
- **CSP** (production builds only, as a `<meta>` prepended by `securityMetaPlugin`) [R5]: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (for onnxruntime-web's face guidance, C46.1); `connect-src 'self' <API origin>`; `img-src 'self' blob: data:`; `media-src 'self' blob:`; `object-src 'none'`; `base-uri 'none'`; `form-action 'none'`. There is no `style-src`, `worker-src` or `frame-src`, so all three fall back to `default-src 'self'` (inline `<style>` and `style=""` attributes are blocked; script-set CSSOM properties are not). The code comment says `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` must come from the serving layer as headers [R5]. `index.html` also sets `<meta name="referrer" content="no-referrer">`.
- **Transport** [R15]: every request uses `credentials: 'omit'`; the session token travels only in `Authorization`; the hosted credentials arrive in the URL fragment and are taken out before anything else runs (`main.tsx`). No `localStorage`, `sessionStorage`, IndexedDB or cookie is used anywhere in `src` (searched).
- **What is read from the browser today:** `navigator.languages` for language selection only (`main.tsx:27`), and, on a selfie submit, the **C40.4 device snapshot** (`src/selfie/device-snapshot.ts`) [R6][R7]: a sanitised camera `label`; track `settings` (width, height, frame rate, facing mode, resize mode); `capabilities` (maxima and facing modes); Chromium's `frame-stats` (delivered, discarded, total); `webdriver` (`navigator.webdriver === true`); `image-mirrored: false`. The device and group ids are never sent. Nothing else (no screen, timezone, canvas, WebGL, audio, fonts, hardware concurrency, pointer or keyboard data) is collected.
- **How the server uses it:** `selfie_liveness_detection`'s integrity component fails in production on `webdriver: true` or a file-path camera label (`automated_capture`), and a label on the virtual-camera list (`VIRTUAL_CAMERA_NAMES`) sends the result to review (`capture_device_suspicious`); a sandbox records and waives them [R9].

**Server.**
- `inquiry_sessions` keeps the **first flow call's IP and User-Agent**, each sealed with the `encrypted` helper; the consent record keeps the accepted text keys, the optional keys ticked, the locale, and its own sealed IP and User-Agent [R8]. The `inquiry-session` resource exposes `ip-address` and `user-agent` [R16]. `request.ip` is the socket peer unless `OPENVERIFY_TRUST_PROXY` names trusted proxies (C15) [R17].
- Consent keys today: `consent.biometric` and `consent.processing` (required), `consent.biometric-matching` (optional, C42.3) in the default template [R18]. The C42.3 pattern (an optional, unticked consent that gates storage and the checks that need it, which then answer `not_applicable`/`not_consented`) is the model for an optional fraud-signals consent (inference) [R13].
- There is no `packages/signals` package yet, although PLAN §3 plans one [R1].

**Android SDK (`android/openverify-sdk`, KMP).**
- `CameraFacts.toDeviceSnapshot()` (commonMain) sends the same C40.4 snapshot from CameraX: camera ids as `label`, lens facing, resolution, frame rate, `frame-rate-max`, `image-mirrored` [R10]. No `webdriver` equivalent, and **no emulator, root, debugger, hooking or app-integrity signal** exists.
- Requests carry `User-Agent: OpenVerify-Android/<version>` (or `OpenVerify-iOS/...`) and follow no redirect [R11]. The manifest asks for `INTERNET` and `CAMERA` only; `minSdk` 26, `compileSdk`/`targetSdk` 36 [R12].

**Consequence for Phase 7 (inference).** Everything this note proposes is new collection. The C40.4 snapshot is the only precedent, and it was justified by the selfie it accompanies; a general signal collector needs its own legal basis (§6), its own contract and its own consent key.

## 1. Browser fingerprinting

### 1.1 Collectors, versions and licences

Versions, dates and `license` fields come from the npm registry documents [L1][L7][L8][L9][L11][L12]. Licences come from the LICENSE file at the tag or the `gitHead` the registry records, and inside the published tarball where one exists. Sizes are our own measurements of the published files, gzip level 9 [M1]. "Newest ≥14 d" means released on or before 2026-10-13.

| Candidate | Version: latest / newest ≥14 d | Released | Licence (LICENSE file) | Size (min, then gzip) | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| **`@fingerprintjs/fingerprintjs` v5** | 5.3.0 / **5.3.0** | 2026-10-07 | **MIT**: "MIT License, Copyright (c) 2025 FingerprintJS, Inc" at tag `v5.0.0` and at 5.3.0's `gitHead` `dac5ae5`, and inside the 5.3.0 tarball [L2][M1] | `fp.min.js` 37,093 B, **16,235 B** gzip; no dependencies; `sideEffects: false` [M1] | Active (last push 2026-10-21); 5.1 made Firefox private-mode identifiers stable, 5.2 added a `userAgentData` source, 5.3 updated Android detection [L3] | ⚠️ Passes rule 4. Caveats in 1.4: a usage-statistics request is on by default, the component set is outside semver, and identifiers may change between minor versions |
| `@fingerprintjs/fingerprintjs` v4 | 4.6.2 | 2025-04-10 | **BUSL-1.1**, with no additional use grant; each version converts to MIT four years after its release [L2] | - | Superseded by v5 | ❌ BSL (rule 4) |
| `@fingerprintjs/fingerprintjs` v3 | 3.4.2 | 2023-07-06 | MIT, "Copyright (c) 2023 FingerprintJS, Inc" [L2] | 33,780 B, 14,207 B gzip; depends on `tslib` [M1] | No release since 2023 | ⚠️ Passes, but superseded: v5 is MIT and maintained |
| `fingerprintjs2` | 2.1.4 | 2021-03-02 | MIT (npm) | - | Deprecated in favour of the scoped package [L12] | ❌ deprecated |
| **`@fingerprintjs/botd`** (bot detection, §2) | 2.0.0 / **2.0.0** | 2025-11-04 | MIT, "Copyright (c) 2025 FingerprintJS, Inc" at `v2.0.0` and in the tarball [L7][M1] | ESM unminified 27,519 B, **6,596 B** gzip; no dependencies [M1] | README declares a stability-only roadmap [L7] | ⚠️ Passes; a usage-statistics request is on by default (§2.2) |
| **`@thumbmarkjs/thumbmarkjs`** | 1.12.0 / **1.12.0** | 2026-09-25 | MIT (copyright 2024, an individual author) at `gitHead` `7d84534` and in the tarball [L8][M1] | ESM 31,348 B, **11,492 B** gzip [M1] | Active; one main maintainer plus a commercial API [L8] | ⚠️ Passes; caveat: `logging` is on by default, and on sampled runs it fetches and **evaluates a remote script** (1.4) |
| `clientjs` | 0.2.1 / 0.2.1 | 2021-10-25 | Apache-2.0 (LICENSE at `ce103dc`). Versions 0.1.5 to 0.1.9 declared GPL-3.0 on npm [L9] | unpacked 1,008,831 B | No commit since 2023-01-08 [L9] | ❌ unmaintained (the licence passes) |
| CreepJS (`abrahamjuliot/creepjs`) | not on npm; GitHub `master` at `10aa672` (2026-06-11) | - | MIT (copyright 2021, the repository owner) [L10] | - | A research test page, not a packaged library. The npm name `creepjs` belongs to an unrelated 2016 package [L10] | Reference only: useful for testing lie and tamper detection; not a dependency |
| `get-browser-fingerprint` | 5.2.4 / 5.2.4 | 2026-04-02 | `license: MIT` in package.json only; **no LICENSE file** in the tarball or the repository (GitHub reports none) [L11][M1] | 14,455 B, 4,554 B gzip (unminified) [M1] | Single maintainer | ⚠️ No licence text to reproduce; not recommended |

**Correction to the repository's records.** PLAN §3's row "own collector (+ FingerprintJS **v3** MIT only, not v4 BSL)" [R1] is out of date. FingerprintJS returned to MIT in **5.0.0 (2025-10-22)**; the release note states the change from BUSL-1.1 to MIT [L3], and the LICENSE files confirm it [L2]. Only the 4.x line is BSL.

### 1.2 What the collectors measure

FingerprintJS 5.3.0 runs 42 sources in a fixed order [L5]:
- **asynchronous first:** `userAgentData`, `fonts`, `domBlockers`, `fontPreferences`, `audio`, `screenFrame`;
- **then:** `canvas`, `osCpu`, `languages`, `colorDepth`, `deviceMemory`, `screenResolution`, `hardwareConcurrency`, `timezone`, `sessionStorage`, `localStorage`, `indexedDB`, `openDatabase`, `cpuClass`, `platform`, `plugins`, `touchSupport`, `vendor`, `vendorFlavors`, `cookiesEnabled`, `colorGamut`, `invertedColors`, `forcedColors`, `monochrome`, `contrast`, `reducedMotion`, `reducedTransparency`, `hdr`, `math`, `pdfViewerEnabled`, `architecture`, `applePay`, `privateClickMeasurement`, `audioBaseLatency`, `dateTimeLocale`;
- **last, because they can disturb canvas:** `webGlBasics`, `webGlExtensions`.

ThumbmarkJS 1.12.0 has 13 component groups: `audio`, `canvas`, `fonts`, `hardware`, `locales`, `math`, `permissions`, `plugins`, `screen`, `speech`, `system`, `webgl`, `webrtc` [L8]. Its WebRTC component makes an offer on a peer connection with an empty ICE server list, so it gathers host candidates only and contacts no server [L8].

What each family of signal measures. This is our summary: the mechanisms for canvas, audio and fonts are those in FingerprintJS's source [L5]; the "why it varies" column is inference.

| Signal | What it reads | Why it varies between devices |
|---|---|---|
| Canvas | Two images on a 2D canvas: a text line with an emoji, and a geometry drawing; plus a winding-rule test. FingerprintJS reads the text image **twice** and marks the canvas `unstable` when the two readbacks differ, and it skips images entirely on browsers it knows add noise (Safari 17 private mode; Firefox 120+ private and strict ETP) [L5] | Font rasterisation, anti-aliasing, GPU and driver differences |
| WebGL | Vendor and renderer strings (unmasked through `WEBGL_debug_renderer_info` where allowed), limits, extensions, shader precision | GPU model and driver |
| Audio | An `OfflineAudioContext` renders a triangle-wave oscillator through a dynamics compressor; a hash of the rendered channel data [L5]; separately, the base latency | Floating-point differences in the audio stack |
| Fonts | Spans in candidate fonts compared against the `monospace`, `sans-serif` and `serif` base fonts, measured inside a hidden iframe [L5] | Installed fonts, OS and language packs |
| Screen | Width, height, available area, colour depth, device pixel ratio, colour gamut, HDR | Display hardware and settings |
| Timezone and locale | `Intl.DateTimeFormat().resolvedOptions().timeZone`, the offset, `navigator.languages`, date formatting | User settings; correlates with location |
| Hardware | `navigator.hardwareConcurrency`, `navigator.deviceMemory` (Chromium only, rounded values: inference), `maxTouchPoints` | CPU, RAM and touch hardware |
| Platform and UA | `navigator.platform`, `userAgent`, UA Client Hints (`navigator.userAgentData`), vendor | Browser, OS and version |
| Preferences | Media queries for contrast, reduced motion, forced colours, inverted colours | Accessibility settings (sensitive, see 1.5) |
| Storage availability | Whether `localStorage`, `sessionStorage` and IndexedDB exist | Private modes, settings |
| DOM blockers | Whether hidden elements matching ad-block filter selectors get hidden | Installed content blockers and regional filter lists |

**Stability and entropy, as published.**
- **Panopticlick (2010):** about a million visits; the fingerprint carried at least 18.1 bits of entropy; browsers changed fingerprints often, but a simple heuristic still matched changed fingerprints to the old ones with 99.1% of guesses correct [P1].
- **Large-scale re-measurement (2018):** 2,067,942 fingerprints from one of France's 15 most visited sites; only **33.6%** were unique, far below the earlier 80–90% figures, and non-unique fingerprints were fragile (one changed attribute often made them unique) [P2].
- **FP-STALKER (2018):** 98,598 fingerprints from 1,905 browser instances; fingerprints changed every few hours to days, yet linking could follow a browser for 54.48 days on average, and 26% of browsers for over 100 days [P3].
- **Chrome population (2024):** a study over tens of millions of Chrome browsers found that entropy varies by site category, and proposed entropy as a risk measure [P4].
- **Vendors' own claims:** FingerprintJS says its open-source accuracy is significantly lower than its commercial service [L6]. Its built-in `confidence.score` is a fixed prior by platform (0.4 on Android, 0.3 or 0.5 on Safari, 0.6 on Windows, 0.5 on macOS, 0.7 elsewhere), not a measurement [L5]. ThumbmarkJS claims about 80% uniqueness in general populations, lower on Mac and Safari [L8]. These are vendor statements, not independent evaluations.

### 1.3 The browsers' anti-fingerprinting defences (state on 2026-10-27)

| Browser | What it does | Where it applies | Effect on reuse detection (inference unless cited) |
|---|---|---|---|
| **Safari 17 to 17.5** (Advanced Fingerprinting Protection) | Small noise on 2D canvas and WebGL pixel readback (also in workers from 17.5), and on Web Audio samples (made consistent within a buffer in 17.5, so it cannot be averaged out); `screen` and `outer*` sizes report the viewport, and `screenX`/`screenY` report 0. The stated aim is a fingerprint that differs per site and changes on each fresh start [B1] | Private Browsing by default; a setting extends it to all browsing [B1] | Canvas, audio and screen are not stable across sessions in Private Browsing |
| **Safari 26** | **Known fingerprinting scripts** cannot reliably read screen size, hardware concurrency, speech voices, payment capabilities, Web Audio or 2D canvas, cannot write long-lived storage, and cannot read query parameters or the referrer. How scripts are classified is **not documented** [B2] | Only scripts classified as known fingerprinting scripts; the post names no browsing mode, so "all browsing" is our reading (inference; corrected in fact-check) [B2] | A first-party, self-hosted collector is unlikely to be on such a list (inference). Bundling an unmodified known library may be detected; whether it is is **not documented** |
| **Firefox: Fingerprinting Protection (FPP)** | Canvas randomisation (from 120 in private browsing), font visibility limited to the language pack, fdlibm maths, `maxTouchPoints` collapsed, available screen area reported as the resolution, `hardwareConcurrency` tiered (143 in private browsing) [B3]. Firefox 145 extended it, and Mozilla reports the share of users who look unique halved [B4] | Private Browsing and ETP Strict by default [B4]. Mozilla's tracking page lists canvas randomisation, `maxTouchPoints` and screen in its "Baseline" column for desktop Release **from 151** [B3]; the page does not define "Baseline" (we read it as normal browsing: inference) | From Firefox 151, a canvas hash is likely to change per site and per session even in normal windows (inference). A community configuration guide says that from Firefox 120 the canvas noise is keyed per eTLD+1, per session and per window mode [B5]; Mozilla's pages do not say (**not documented** by Mozilla) |
| **Firefox: `privacy.resistFingerprinting` (RFP)** | A broader mode that makes values uniform rather than noised. The community guide gives two examples, timezone always UTC and `prefers-color-scheme` always light, and lists some side effects (canvas breakage, a 60 Hz refresh lock) [B5]. Mozilla's support article could not be read from here (it failed to load for the fetcher), so the full list of uniform values is **not verified** | A preference; that it is off in stock Firefox is our understanding, not verified here (inference) | Many RFP users look identical; a match among them means little (inference) |
| **Brave** | Two methods: values made uniform or empty, and values **randomised** from a seed that changes per session, per site (eTLD+1) and per storage area; third-party frames share the top-level site's seed [B6] | Default Shields setting [B6] | Randomised components (canvas, audio and others) differ across sessions and sites, so a raw hash will not match a returning Brave user |
| **Chrome** | The **Privacy Budget** proposal is archived and was never implemented in any browser [B7]. User-Agent reduction is the shipped passive measure [B7]. Incognito has **Script Blocking**: third-party scripts and iframes from domains on the Blocked Domain List (part of the Masked Domain List, built by crawling for known re-identification code) are blocked [B8]. Google retired IP Protection and most other Privacy Sandbox APIs on 2025-10-17 [B9] | Script Blocking: Incognito only, third-party contexts only [B8] | In normal Chrome a fingerprint stays fairly stable, apart from UA reduction (the full version and model are available only through UA-CH high-entropy hints) |

### 1.4 What this means for reuse detection

1. **A fingerprint is a probabilistic, short-lived link, not an identifier.** The same person on Safari Private Browsing, Brave, Firefox private or ETP Strict windows, or Firefox 151 and later, will often get a new hash each session [B1][B3][B6]. Two different people on the same model of iPhone with default settings often share one [P2]. Reuse matches are therefore evidence to weigh, never proof (inference).
2. **Hash two tiers, not one** (inference). A strict hash over all stable components finds exact reuse. A coarse "device class" hash over the low-entropy, unrandomised parts (UA family and major version, OS, platform, screen bucket, timezone, languages, `hardwareConcurrency`) finds the same device class within a short window. Neither ever decides alone.
3. **Detect the defences and record them instead of fighting them.** Two canvas readbacks of the same drawing that differ show that the browser adds noise; FingerprintJS uses exactly this test to drop the canvas [L5]. Record it as `fingerprint-randomised: true` and lower the weight of the match. Never treat it as a fraud signal: Safari, Firefox and Brave do this for ordinary users [B1][B3][B6] (inference).
4. **Keep components versioned.** FingerprintJS does not keep its component set under semver, and says identifiers may change even within a minor version [L5][L6]. Stored hashes made by a dependency would silently stop matching after an upgrade. A collector we own, with a `collector-version` stored next to each hash, avoids this (inference).
5. **Never put raw components into the graph.** Only the keyed hashes become graph edges or list values (Phase 7 lists `browser-fingerprints` and `device-fingerprints` [R4]). The low-entropy components are kept sealed, for the operator to read (inference).

**Dependency hazards found in the code.**
- **FingerprintJS:** by default, `load()` has a 0.1% chance of sending a request to `m1.openfpcdn.io`, at most once a week per browser, carrying the library version, the page's headers (origin and referrer included) and the client IP; `monitoring: false` turns it off [L4][L5]. The flow's CSP would block it [R5], but it must be off in code too. Its `domBlockers` source probes for ad-block filter lists, which can reveal the user's region and choice of extensions. Its `fonts` and `fontPreferences` sources measure inside a hidden `about:blank` or `srcdoc` iframe, and it writes styles through `style.setProperty`, which the CSP allows [L5].
- **ThumbmarkJS:** with the default `logging: true`, at most 0.01% of runs send a sample to `api.thumbmarkjs.com/log` and **fetch and evaluate** a script from `experimental.thumbmarkjs.com`. Our CSP (no `unsafe-eval`; `connect-src` limited to the API) would block both, and `logging: false` turns both off [L8]. The `collect_beacon` behaviour needs an API key, which we would never set [L8]. Remote code evaluation in an identity-verification page is unacceptable whatever the CSP (inference).

### 1.5 Recommendation: our own minimal collector

**Build our own collector in `packages/signals`** (browser entry, no dependencies). Use FingerprintJS v5 (MIT) as a design reference: if any code is adapted, keep its copyright notice in `THIRD_PARTY_LICENSES.md` (MIT condition; inference). Do not add a fingerprinting dependency to the flow. Reasons:
- **data minimisation:** only components we can name in the consent text;
- **no network calls and no remote code;**
- **a stable, versioned contract** (1.4 item 4);
- **size:** the flow's main bundle is 820,481 B, or 237,048 B gzipped, today [M1]. FingerprintJS would add about 16 KB gzipped (+6.8%); our collector should stay within **4 KB gzipped**, enforced by a size test (inference).

**Proposed components (v1)**, each bounded and validated by a strict zod schema like C40.4 [R7]:
- **fingerprint inputs:** UA-CH low-entropy brands, `mobile` and `platform`, with `navigator.userAgent` as the fallback; `languages` (at most 5); IANA timezone; screen width, height, colour depth and device pixel ratio, bucketed; `hardwareConcurrency`; `deviceMemory`; `maxTouchPoints`; a **2D canvas digest** (SHA-256 of `toDataURL` over a fixed drawing, computed in the browser; only the digest leaves it); a second readback to detect noise; the WebGL vendor and renderer strings (unmasked only where the browser allows); a **collector version**.
- **left out:** font enumeration, ad-block probing, permissions, speech voices, WebRTC, audio, plugins, and accessibility media queries. Accessibility preferences can point to a disability, which could be special-category data if used to infer health; leaving them out costs little entropy (inference).

**Server side:**
- Compute `browser-fingerprint` as an **HMAC-SHA-256** over the canonical JSON of the stable components, keyed per environment. A key derived from the KEK under a purpose label would work (inference). Also compute the coarse device-class HMAC (1.4 item 2).
- Store the HMACs plain, as indexable values, and the component values sealed.
- The keyed hash stops cross-installation linking and dictionary reversal of the low-entropy inputs (inference). Its cost: a fingerprint list imported from another system cannot match, unless the operator imports raw components (which we would not accept) or uses the same key.

**CSP impact.**
- The own collector needs **no change** to the current policy [R5]. Canvas readback is not governed by CSP. Hashing uses `crypto.subtle`, a secure-context API that needs no CSP permission. No iframe, worker or remote fetch is involved.
- If FingerprintJS were ever adopted instead, a Phase 7 Playwright test would have to confirm that its `about:blank`/`srcdoc` iframes measure correctly under `default-src 'self'` with no `frame-src` (inference: they inherit the parent's policy, and nothing is fetched).
- The serving layer's headers still need `Permissions-Policy` (camera, and, if GPS is collected, `geolocation=(self)`) [R5].

## 2. Automation and bot detection

### 2.1 What a page can see of automation

| Artefact | Mechanism | Strength and caveats |
|---|---|---|
| `navigator.webdriver` | The WebDriver spec requires it to be true while the browser is under remote control: it is set when a WebDriver session is created [S1] | Strong when true (OpenVerify already fails a production selfie on it [R9]). Absent with plain CDP control (Puppeteer and Playwright drive Chromium over CDP, not WebDriver: inference), and the stealth plugin ships a `navigator.webdriver` evasion for it [L16] |
| Driver globals | BotD v2.0.0 looks for known globals on `window` and `document`, for Selenium (`_selenium`, `__selenium_evaluate`, a three-letter-prefix regex for ChromeDriver's injected arrays), WebDriver (`__webdriver_evaluate`, `$cdc_asdjflasutopfhvcZLmcfl_`, `__fxdriver_evaluate`, ...), PhantomJS (`callPhantom`, `_phantom`), Nightmare (`__nightmare`), CefSharp, `domAutomation`, and others [L7] | Strong when present; trivially removed by a patched driver (inference) |
| Headless markers | A UA containing `Headless`, `PhantomJS`, `Electron` or `slimerjs` [L7]; a 0×0 outer window while the document has focus [L7]; an empty plugin array, inconsistent MIME types, missing notification permissions [L7]. Chrome's headless has shared headful Chrome's code since version 112, and the old separate headless mode now exists only as the `chrome-headless-shell` binary (from 132.0.6793.0) [S2] | Weak to medium: new headless looks much like headful Chrome. Whether its UA still contains `HeadlessChrome` is **not documented** on Chrome's page [S2] |
| CDP side effects | The classic check defines a getter on an `Error`'s `stack` and logs the error; Chromium serialised logged objects only when a CDP client had enabled the `Runtime` domain, so the getter fired. Two V8 commits in May 2025 stopped error previews from running user getters, which broke the check [S3]. The same probe also fired for users with DevTools open [S4] | **Gone** on current Chromium [S3]. Do not build on it |
| Tool bindings | Playwright and Puppeteer inject named bindings and evaluation-script markers (inference; no primary source read here, and BotD has no Playwright- or Puppeteer-specific detector at v2.0.0 [L7]) | Version-specific and easily renamed; not recommended as a default rule |
| Environment lies | Native functions whose `toString` is not native, `eval.toString().length` inconsistent with the claimed engine, `Function.prototype.bind` missing, an error stack that names PhantomJS, `navigator.languages` empty, `productSub` or `appVersion` inconsistent with the UA [L7] | Medium; each also misfires on unusual but genuine browsers (inference) |
| Cross-layer consistency | The server sees `User-Agent` and the `Sec-CH-UA*` headers; the page sees `navigator.userAgent`, `navigator.userAgentData`, `Intl` timezone and `navigator.languages`. Contradictions (a Safari UA with Chromium-only APIs; `Accept-Language` disagreeing with `navigator.languages`; a timezone far from IP geolocation) suggest spoofing (inference) | Medium; VPN users, travellers and privacy browsers produce some contradictions honestly |

### 2.2 BotD 2.0.0 in detail

- **Licence and version:** MIT; 2.0.0 (2025-11-04) is both the latest and the newest passing version [L7]. The 2.0.0 release changed only the compile target, from ES5 to ES2018 [L7]. The README declares a stability-only roadmap [L7].
- **What it runs:** 18 registered detectors: `detectAppVersion`, `detectDocumentAttributes`, `detectErrorTrace`, `detectEvalLengthInconsistency`, `detectFunctionBind`, `detectLanguagesLengthInconsistency`, `detectNotificationPermissions`, `detectPluginsArray`, `detectPluginsLengthInconsistency`, `detectProcess`, `detectUserAgent`, `detectWebDriver`, `detectWebGL`, `detectWindowExternal`, `detectWindowSize`, `detectMimeTypesConsistent`, `detectProductSub`, `detectDistinctiveProperties`. An RTT detector exists in the source tree but is not registered [L7].
- **What it returns:** `{ bot: false }` or `{ bot: true, botKind }`, where the documented `botKind` values are `unknown`, `headless_chrome`, `phantomjs`, `nightmare`, `selenium`, `electron`, `nodejs`, `rhino`, `couchjs`, `sequentum`, `slimerjs`, `cefsharp` [L7]. There is no score and no confidence.
- **Telemetry:** the npm build's `load()` has a 0.1% chance of calling `m1.openfpcdn.io`, as FingerprintJS does; `monitoring: false` disables it [L7].
- **Verdict:** ⚠️. Its checks are a short list of static artefact rules, about 6.6 KB gzipped unminified. Re-implementing the rules worth having (driver globals, webdriver, UA markers, focus-aware 0×0 window, plugin and MIME consistency) in our collector takes little code and gives us reasons and versions; a vendored copy would also work under MIT (inference). Either way it detects **basic** automation only, as its own README says [L7].

### 2.3 Stealth tooling and the honest limit

- `puppeteer-extra-plugin-stealth` 2.11.2 (MIT, released 2023-03-01, LICENSE at `2f4a357`) [L16] ships 17 evasions [L16]: `chrome.app`, `chrome.csi`, `chrome.loadTimes`, `chrome.runtime`, `defaultArgs`, `iframe.contentWindow`, `media.codecs`, `navigator.hardwareConcurrency`, `navigator.languages`, `navigator.permissions`, `navigator.plugins`, `navigator.vendor`, `navigator.webdriver`, `sourceurl`, `user-agent-override`, `webgl.vendor`, `window.outerdimensions`. Together they cover most of the static artefacts in 2.1 (inference from the names).
- Patched or recompiled browsers, CDP-free drivers and commercial "anti-detect" browsers present a consistent, real-looking environment (inference; no primary source read for them here).
- **What a client-side check cannot detect at all (inference):**
  - a human operator in a fraud farm on real devices;
  - OS-level automation (scripted input on a real desktop or phone);
  - a real browser fed a virtual camera or an injected video stream (the C43 virtual-camera list catches only known labels [R9]);
  - a modified browser that answers every probe as a stock one would;
  - replay of a genuine signal payload, unless the server binds it to a nonce and a session.
- **So:** automation signals can only **raise** risk. Absence of signals never proves a human. The bot score is H-tier `beta`, and no check may `pass` because no bot was found (ADR 0002 rule 3a [R3]).

### 2.4 Server-side signals

| Signal | What it needs | Licence | Verdict |
|---|---|---|---|
| Request timing (session start to first upload, to submit; inter-request gaps; too-regular intervals) | Timestamps the API already records (inference) | ours | ✅ R-tier facts, used in the H-tier score |
| Header order and casing | `rawHeaders` on a connection the API terminates itself. Behind a reverse proxy, the proxy rewrites order and casing (inference) | ours | ⚠️ Useless behind most proxies; off by default |
| HTTP/2 frame fingerprint (SETTINGS, priority, pseudo-header order) | The client's own HTTP/2 connection | method only | ⚠️ Same limitation; not proposed |
| **JA3** (TLS ClientHello hash) | The raw ClientHello, which only the TLS terminator sees | BSD-3-Clause; the `salesforce/ja3` repository is archived [L20] | ❌ Chrome has permuted ClientHello extensions on every connection since January 2023 (108–110), so JA3 differs per connection [S5] |
| **JA4** (TLS client fingerprint; sorts extensions, so survives the permutation) | The raw ClientHello at the terminator | **BSD-3-Clause** (`LICENSE-JA4`) [L19] | ⚠️ Passes rule 4, but we do not terminate TLS. A self-hosted operator runs a proxy (nginx, HAProxy, Caddy, a cloud load balancer); JA4 also changes when TLS libraries update, about yearly [L19] |
| **JA4+** (`JA4H` HTTP, `JA4T` TCP, `JA4L` latency, `JA4S`, `JA4X`, `JA4SSH`, ...) | As above | **FoxIO License 1.1**: copyright licence for non-commercial purposes only; the FAQ says a vendor who provides value to paying customers with it needs an OEM licence [L19] | ❌ Fails rule 4. The FoxIO nginx module computes JA4+ and is therefore under that licence too [L19] |

**Proposal.** A `tls-fingerprint` adapter that reads a JA4 value from a header the operator's proxy sets, trusted only from addresses that `OPENVERIFY_TRUST_PROXY` already trusts (C15 [R17]). It is off by default, and documented as optional. The JA4 README lists, as offering JA4 (not JA4+), Cloudflare, AWS CloudFront and WAF, Google Cloud Armor, Akamai, Vercel and ngrok, and third-party HAProxy plugins [L19]; the licences of those plugins were not checked here. We ship no JA4+ code. A sandbox provider returns fixed JA4 strings for tests (ADR 0002 tier A [R3]). A JA4 value is a property of the client software, not of a person, but it is still a device signal under §6 (inference).

### 2.5 Parsing the User-Agent for the session's device fields

Persona's session has `os-name`, `os-full-version`, `device-type` (examples `smartphone`, `desktop`), `device-name`, `browser-name`, `browser-full-version`, `mobile-sdk-name` and `mobile-sdk-full-version` [O1]. These come from the User-Agent, UA Client Hints and, for SDKs, the SDK's own header (inference). Server-side parsers:

| Candidate | Version: latest / newest ≥14 d | Licence (LICENSE file) | Size | Verdict |
|---|---|---|---|---|
| **`bowser`** | 2.15.0 (2026-10-26, too new) / **2.14.1** (2026-02-08) | MIT (copyright 2015, the original author) [L14][M1] | `es5.js` 36,752 B, 7,549 B gzip [M1] | ✅ **Use.** Already in the lockfile at 2.14.1, pulled in by `@aws-sdk/core` [R22], so it adds no new package |
| `ua-parser-js` v1 | 1.0.41 (2025-08-19) | MIT (`license.md`, copyright 2012–2025, the author) [L13][M1] | min 25,377 B, 9,619 B gzip [M1] | ⚠️ Passes, but it is the legacy line |
| `ua-parser-js` v2 | 2.0.10 (2026-05-21) | **AGPL-3.0-or-later** (`LICENSE.md`) [L13][M1] | - | ❌ AGPL (rule 4). The npm history alternates between MIT 0.7.x/1.x and AGPL 2.x releases [L13], so pin the major version |
| `isbot` (crawler UA patterns) | 5.2.2 (2026-08-27) | **Unlicense** (LICENSE) [L15][M1] | 9,472 B, 3,236 B gzip [M1] | ⚠️ A public-domain dedication, but not on rule 4's list; needs an owner exception. It is also irrelevant to an IDV flow, where search crawlers have no session (inference) |

The SDKs already identify themselves (`OpenVerify-Android/<version>` [R11]), so `mobile-sdk-name` and `mobile-sdk-full-version` can be parsed from that header exactly, with no library.

## 3. Behavioural metrics

Persona exposes two inquiry-level signals by these names: `inquiry/bot_score` (a number; the example value is 42) and `inquiry/behavior_threat_level` (a string; the example is `low`). Both sit in a `signals` array of `{ name, value }` on the inquiry and in its webhooks, behind an organisation-level feature flag [D1]. The inquiry resource also has a `behaviors` object whose keys the public spec does not enumerate [O3]. Persona's help centre states the ranges, `bot_score` 0 to 100 (the likelihood that a bot submitted the inquiry) and `behavior_threat_level` `low`, `medium` or `high` (help article `V809YiUBfhmD5ocRMVp6r7`, the behaviour note's [H4]); the computation is **not documented** (corrected in fact-check). What follows is our own design.

### 3.1 What the page can measure

| Metric | How (standard APIs) | Notes |
|---|---|---|
| Paste | The `paste` event (a `ClipboardEvent`) and `input`/`beforeinput` events with `inputType` `insertFromPaste`; drops are `insertFromDrop` [S6] | Count only. Never read the clipboard contents |
| Autofill | `element.matches(':autofill')`, defined in HTML and Selectors 4, with `:-webkit-autofill` as its specified alias; not yet Baseline [S7]. Browser autocomplete can also arrive as `insertReplacementText` [S6] | Password managers and browser autofill are normal, and helpful for people with motor or cognitive impairments (inference) |
| Corrections | `inputType` values `deleteContentBackward`, `deleteContentForward`, `deleteWordBackward`, `deleteByCut`, and others [S6] | Count only |
| Hesitation | Time from a field's `focus` to its first `input`; time from screen render to the first interaction | Coarse buckets only |
| Dwell | Time on each flow screen | Rounded to whole seconds (inference: enough for "too fast" rules) |
| Focus loss and tab switches | `window` `blur`/`focus`, `document.visibilityState` and `visibilitychange` | Count and total hidden time, rounded |
| Typing cadence | Intervals between `keydown` events, reduced **in the browser** to one class (`uniform`, `variable`, `insufficient`) from the coefficient of variation | Never the intervals themselves (3.3) |
| Pointer activity | Whether any `pointermove` happened before a click or tap, and the pointer types seen (`mouse`, `pen`, `touch`) | Never coordinates or trajectories (3.3) |
| Synthetic events | `Event.isTrusted === false` on input, click or key events, meaning the page's own script made them | Strong when seen. CDP-driven input arrives as trusted events, so its absence proves nothing (inference) |
| DevTools open | Heuristics such as window-size gaps or debugger timing | ❌ Unreliable and easy to trip by accident. Not proposed |

### 3.2 Published evidence of their value against bots

- **Mouse data plus server logs beat either alone.** Combining server logs with mouse-movement biometrics detected bots that imitate human behaviour better than either module alone, in a framework tested against moderate and advanced (human-like) bots [P5].
- **Synthetic trajectories can be detected, and can be generated.** A detector trained against synthetic trajectories (heuristic functions and a GAN) found high-realism bot trajectories with about 93% average accuracy from a single trajectory. Fusing it with established mouse-dynamics features improved accuracy by more than 36% relative. The public benchmark has 58 real users [P6]. The same work shows that human-like trajectories can be synthesised [P6] (inference: a determined attacker can do the same).
- **Vendors combine many layers.** A commercial bot-detection blog describes combining mouse, scroll and typing behaviour with environment fingerprinting, proxy detection and time-series analysis, and says no single signal suffices [S3].
- **Not found:** no peer-reviewed study we read measures paste, autofill or hesitation counts against bots in an identity-verification flow. Their value is **not documented**; treat them as weak evidence.

**Caveats for an IDV flow (inference).**
- Most of the flow is camera capture on phones, so pointer data is sparse or absent.
- Accessibility tools (screen readers, switch access, voice control, password managers) produce "unusual" patterns: no pointer, instant input, pasted values. A behavioural score that penalises them would discriminate against disabled users, and would sit badly with the flow's WCAG 2.2 AA goal [R1].

### 3.3 Privacy: when behaviour becomes biometric

- **Keystroke timings identify people.** In a benchmark of 51 subjects typing a password 400 times each, the best of 14 detectors verified typists with equal-error rates of 9.6% to 10.2% [P7]. Raw inter-key timings are therefore a behavioural biometric, not neutral telemetry (inference from [P7]).
- **GDPR:** biometric data means personal data from specific technical processing of physical, physiological or **behavioural** characteristics that allows or confirms unique identification [G1]. Our aggregates are not processed to identify anyone, and are too coarse to do so (inference). That is the design goal of 3.4, and the DPIA should record it.
- **California:** the CCPA's definition of biometric information names **keystroke patterns or rhythms** explicitly [U2] (§6.3).
- **Mouse trajectories:** they can also identify individuals, which is what mouse-dynamics authentication research relies on (inference; [P6] uses them only for bot detection). We collect no coordinates.

### 3.4 Recommendation: aggregate-only metrics and an H-tier score

**Client (in `packages/signals`):** compute per flow screen, and send with the step's submit:
- **counts:** `paste-count`, `drop-count`, `autofill-count`, `correction-count`, `focus-loss-count`, `hidden-count`, `untrusted-event-count`;
- **coarse timings:** `dwell-seconds` (whole seconds, capped at 3,600); `hidden-seconds`; `first-input-bucket` (`<0.25s`, `0.25–1s`, `1–5s`, `>5s`, `none`);
- **classes:** `typing-cadence` (`uniform`, `variable`, `insufficient`, from at least 8 intervals); `pointer-types` (subset of `mouse`, `pen`, `touch`); `pointer-before-click` (`true`, `false`, `n/a`).

**Never sent:** key values or codes, per-key timings, coordinates, trajectories, scroll positions, clipboard contents. The zod schema is a `strictObject` with bounded integers and enums, so a modified client cannot smuggle raw data through it (as C40.4 does for the device snapshot [R7]). A unit test asserts that the collector's output keys equal the schema's keys.

**Server: `bot_score` and `behavior_threat_level`**, H-tier, `stage: beta`, with `confidence`, reasons and the thresholds applied (ADR 0002 rule 3c [R3]). All weights below are inference and provisional until a calibration report exists.

| Evidence class | Examples | Effect (provisional) |
|---|---|---|
| Strong automation | `navigator.webdriver` true; driver globals; `untrusted-event-count > 0` on inputs; a UA headless marker | Score at least 90; reason codes per artefact |
| Medium | Cross-layer inconsistencies (§2.1); `typing-cadence: uniform` with no correction anywhere; screens completed faster than a set floor; `pointer-before-click: false` with `mouse` as the only pointer type | +10 to +25 each, capped |
| Weak | Paste or autofill into identity fields; many focus losses; long hidden periods | +0 to +5 each, capped low; **never** enough to reach a "high" band alone |
| Not evidence | No signals collected (consent declined, old client, collector error) | No score: `not_applicable` with reason `signals_not_collected` |

- **Score:** 0–100, higher meaning more bot-like, which is Persona's documented scale (help article `V809YiUBfhmD5ocRMVp6r7`; corrected in fact-check); its example value is 42 [D1].
- **Confidence:** the share of evidence groups actually collected, times the margin from the nearest threshold, like `heuristicConfidence` in C43 [R9] (inference).
- **`behavior_threat_level`:** `low`, `medium` or `high`, from the behavioural aggregates only (no device artefacts), with the same honesty rules.
- **Use in decisions:** both are signals for rules, workflows and review, **not checks that pass**. If the owner wants a registry check (for example `session_automation_detection`, a name of ours, not Persona's), it can only `fail` or send to review on evidence; with no evidence it answers `not_applicable`, never `passed` (ADR 0002 rule 3a [R3]).
- **What it cannot detect** (stated in the docs): humans in fraud farms; OS-level or real-device automation; patched browsers; GAN-quality synthetic input; replayed payloads, unless each is bound to the session and a server nonce. Assistive technology can raise the weak and medium classes, which is why they are capped.

## 4. Android signals without Play Integrity

**What the SDK reports today** (§0): the C40.4 camera snapshot (camera ids, facing, resolution, frame rates, `image-mirrored`) and `User-Agent: OpenVerify-Android/<version>` [R10][R11]. Nothing about the device's integrity.

**Play Integrity (Phase 10, one line).** Google's API returns a signed verdict on the device (`deviceIntegrity`, with tiers such as `MEETS_STRONG_INTEGRITY`), the app (`appRecognitionVerdict`) and the licence (`appLicensingVerdict`), bound to a server `nonce` or `requestHash`. It needs Google Play services, and the default quota is 10,000 requests per day [A1]. It is a proprietary Google service, so it belongs in Phase 10 as an A-tier adapter with a sandbox provider [R1][R3].

**What a library can read without it** (public APIs on `minSdk` 26):

| Signal | API | What the platform says | Verdict |
|---|---|---|---|
| App-scoped device id | `Settings.Secure.ANDROID_ID` | On Android 8.0 and later: a 64-bit value unique to each combination of app-signing key, user and device; it may change on a factory reset or a signing-key change; apps installed before the 8.0 OTA see it change on reinstall [A2] | ✅ The honest Android `device-fingerprint` source, HMAC-keyed per environment like the web hash (§1.5). It is per host app: the same phone in two customers' apps gives two values (by design). Reading it is reading stored device information under ePrivacy Art. 5(3) (inference, §6) |
| Debugger attached | `android.os.Debug.isDebuggerConnected()` [A3] | Whether a debugger is attached now [A3] | ✅ R-tier fact, H-tier meaning: a developer or an attacker |
| Host app debuggable | `ApplicationInfo.FLAG_DEBUGGABLE` on the host app's own `applicationInfo` (inference: standard API, page not read) | - | ✅ Tells the operator that a debug build of their app is in use; sandbox only in practice |
| ADB and developer options | `Settings.Global.ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED` | **Both always return 0 to third-party apps** [A4] | ❌ Useless; drop from any checklist |
| Emulator | `Build.FINGERPRINT`, `HARDWARE`, `PRODUCT`, `TAGS` (for example `generic`/`sdk_gphone` products, `goldfish`/`ranchu` hardware, `test-keys` tags), missing sensors, no telephony | `FINGERPRINT` identifies the build and the docs say **not to parse it**; `TAGS` holds labels like `unsigned,debug` [A5] | ⚠️ H-tier heuristic. Stock emulator images are easy to spot (inference); a modified image can report any `Build` values |
| Root | An `su` binary on common paths; `test-keys`; known root-manager packages (package visibility from Android 11 needs a `<queries>` entry, and Play restricts `QUERY_ALL_PACKAGES`: inference); a writable `/system`; SELinux not enforcing | **not documented** as a platform API: these are community heuristics | ⚠️ H-tier. Root-hiding modules defeat them (inference) |
| Hooking frameworks | Frida's default port or agent libraries in `/proc/self/maps`; Xposed or LSPosed classes in stack traces | Community heuristics | ⚠️ H-tier; renamed or rebuilt tools evade them (inference) |
| Mock location | `Location.isMock()` (API 31), `isFromMockProvider()` (API 18–30, deprecated) [A6] | True when a test provider supplied the fix [A6] | ✅ R-tier fact, only if GPS is collected (a §6 consent decision) |
| Accessibility services enabled | `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` | Remote-access malware abuses them; so do assistive tools (inference) | ❌ Not proposed: it can reveal a disability |

**Limits.** Every local check runs inside an environment the attacker controls. A rooted device with hiding modules, a modified emulator image, or a hooking framework can return stock answers to every probe (inference). Google itself points abuse detection to Play Integrity rather than to local checks or hardware identifiers, and steers apps away from non-resettable identifiers such as IMEI and MAC (restricted since Android 10 and 6.0) [A7]. So in Phase 7 these signals:
- are reported as **facts** (`debugger-attached`, `emulator-indicators: [...]`, `root-indicators: [...]`, `mock-location`);
- feed the H-tier `bot_score`/device risk with reasons;
- never `pass` anything.

**Where the code goes.** A `DeviceSignals` interface in `commonMain`, with the Android implementation in `androidMain` and an iOS placeholder (ADR 0004; the iOS counterparts, DeviceCheck and App Attest, are proprietary Apple services for Phase 10: inference). This follows the C40.4 pattern [R10]. The request travels in the same strict contract as the web collector, with a `platform: android` discriminator (inference).

## 5. Device handoff by QR

### 5.1 Parity facts

- In Persona, switching from a desktop to a phone creates a **second inquiry session**; one session belongs to one device, and an inquiry allows 25 sessions by default [D2].
- The session resource has `device-handoff-method`, whose examples are `email`, `sms` and `qr`, and a `device` relationship (`dev_` ids). The `device` resource carries `device-vendor-id`, `device-fingerprint` and `browser-fingerprint` [O1][O2].
- How Persona builds, secures or expires the handoff code is **not documented**.

### 5.2 The threat: illicit onboarding

**RFC 10027** (BCP 247, August 2026; formerly `draft-ietf-oauth-cross-device-security`) [I1] is now the reference for cross-device flows:
- It names the attack on code- and QR-based flows **Cross-Device Consent Phishing** (CDCP), and the attack on session transfer **Cross-Device Session Phishing** (CDSP). Both exploit the unauthenticated channel between the two devices [I1 §1.1–1.2, §4.2].
- Its example B6, **illicit onboarding**, is our case almost exactly. An attacker starts an identity onboarding, takes the QR code, and sends it to a victim with a plausible pretext. The victim scans it and presents their identity documents, and the attacker's account is activated [I1 §4.3.6].
- RFC 8628 §5.4 describes the same remote-phishing risk for the device grant. It recommends telling the user what they are authorising, confirming the device is theirs, and keeping codes short-lived; it notes that a phisher in real time can still present a fresh code [I2].
- OWASP's QRLJacking page describes the login variant and suggests confirmation details, network and location restrictions, and same-place checks [W1].

For OpenVerify (inference): the **desktop** session starts the inquiry, and the **phone** captures the ID and selfie. If an attacker creates an inquiry for an account they control, renders the handoff QR and gets a victim to scan it, the victim's real documents and face verify the attacker's account. No token theft is involved. **The phone side therefore matters more than the QR's secrecy.**

### 5.3 Secure design (proposal; every item inference unless cited)

**Token**
- A new token kind, `ovh_` plus 256 random bits, like every C1/C9 token (prefix plus 32 random bytes in base64url, stored as SHA-256 only, compared in constant time) [R19].
- Not a C10 one-time link: generating a C10 link revokes the inquiry's other unused links [R20], which would cancel a link the operator emailed.
- Bound to the inquiry **and** the issuing session (`iqse_`).
- **Single use** [I1 §6.1.3]. **Short-lived**: default 5 minutes, configurable from 2 to 15, never past the inquiry's `expires-at` [I1 §6.1.2].
- At most one live handoff token per session: issuing a new one revokes the previous one.
- Redemption shares the existing per-IP `one-time-link-redeem` rate limit (30 per minute by default) [R21][I1 §6.1.11].
- 256 bits of entropy makes brute force irrelevant; RFC 8628's typed codes carry far less (its example has about 34.5 bits) only because people type them [I2 §5.1].

**URL**
- `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&handoff-token=ovh_...`, with the token in the **fragment**, as C10 does [R20]. The flow's bootstrap already relies on the fragment never reaching servers [R15].
- The QR is generated locally in the flow with the `qrcode` package the dashboard already pins (1.5.4, MIT, 2024-08-05) [L17]. It is rendered as a `data:` image or SVG, which the CSP's `img-src 'self' blob: data:` already allows [R5]. No third-party QR service is involved.
- `qrcode` declares runtime dependencies (`dijkstrajs`, `pngjs`, `yargs`) [L17]. For the flow bundle, a dependency-free alternative such as `uqr` 0.1.3 (MIT, 2026-04-03) or `lean-qr` 2.7.4 (MIT, 2026-09-07) may be smaller [L18]. Measure before choosing.

**Desktop page shows**
- the QR, a plain-language instruction, a countdown, and a "new code" action (which revokes the old one);
- the operator's configured fallbacks: Persona offers `email` and `sms` as handoff methods [O1], and we already have C55 OTP delivery and C10 links;
- after redemption: "continued on your phone at HH:MM" with a coarse description of the phone's session (OS and browser family only), and a **"this was not me"** action that expires the phone session (`inquiry-session.canceled` style event; inference);
- the desktop session then waits read-only, so two devices never capture in parallel.

**Phone page shows, before any capture**
- the organisation and brand of the template, what will be verified and why, and when and roughly where the flow started (city or country from IP geolocation, if Phase 7 network data is configured);
- a clear **decline** option given equal weight with continue [I1 §6.1.14];
- advice that this code should only appear on the operator's own site, never in an email or message [I1 §6.1.14];
- optionally (template setting, off by default), a short confirmation code shown on the desktop that the user types on the phone. This is a form of RFC 10027's request binding with out-of-band data [I1 §6.1.17], close to RFC 8628's advice to check that the same code shows on both devices [I2 §5.4]. It stops a QR forwarded without its context. It does not stop an attacker who collects the code from the victim as part of the phishing exchange [I1 §6.1.17].

**Proximity as a risk signal, not a gate** [I1 §6.1.1]
- Compute the distance in **meters** between the issuing session's IP geolocation and the redeeming session's IP geolocation (and GPS, if collected), plus whether the ASN or country differs.
- The RFC warns that IP mapping misfires near borders and with VPNs, and that GNSS can be spoofed [I1 §6.1.1]. So: flag and route to review above an operator threshold; never fail outright.
- FIDO hybrid with BLE proximity is the RFC's recommended way to enforce proximity [I1 §6.1.1], and NIST notes that the physical-proximity requirement of hybrid connections reduces phishing [N1 §3.2.11]. A web flow cannot rely on it (inference).

**Downstream checks that catch B6 anyway**
- `selfie_account_comparison` (the victim's face does not match the account's earlier selfies) [R13], and `id_account_comparison` [R4];
- Phase 7 graph edges: one device or IP across many accounts, or one account handed to many unrelated phones.

**Honest limit.** No web-only design prevents a real-time social-engineering relay. The short TTL, the context screen and the distance signal raise its cost and leave evidence, nothing more [I1 §6.1.2][I1 §6.1.14][I1 §6.1.17]. NIST likewise classes out-of-band transfers of a code, QR included, as **not phishing-resistant** [N1 §3.1.3][N1 §3.2.5].

### 5.4 What the sessions should record

| Where | Field (proposed; kebab-case JSON as in PLAN §5 [R1]) | Notes |
|---|---|---|
| New (phone) session | `device-handoff-method`: `qr`, `email`, `sms` (Persona parity [O1]), plus `link` for an operator one-time link (ours) | Null for the first session |
| New session | `handoff-from-session-id` (`iqse_…`), `handoff-created-at`, `handoff-redeemed-at` (ours) | Links the two sessions for the graph |
| New session | `handoff-distance-meters` (IP to IP; and GPS to IP when GPS is collected), `handoff-country-changed`, `handoff-asn-changed` (ours) | R-tier facts; feed H-tier risk |
| Issuing session | Handoff tokens issued, revoked and expired (counts); "this was not me" with timestamp | Audit log entries too (C9 audit pattern; inference) |
| Events | `inquiry-session.started` for the new session (exists in the surface index [R4]); a session canceled by "this was not me" emits `inquiry-session.canceled` [R4] | No new event names needed |
| Retention | As the session (C16); the token hash is deleted at use or expiry plus the C16 grace period (inference) | - |

## 6. Law and consent

This section is an engineering reading of public texts, **not legal advice**. OpenVerify takes no position on any operator's lawful basis; this follows the Phase 6 stance [R14]. The operator, as the controller of its own deployment, decides.

### 6.1 Reading device information: ePrivacy Article 5(3) and its national laws

- **The rule.** Article 5(3) of the ePrivacy Directive (2002/58/EC, as amended in 2009) allows storing information on, or **gaining access to** information already stored in, a user's terminal equipment only with consent given after clear information. There are two exceptions: (a) access solely to transmit a communication; (b) access **strictly necessary** to provide a service the user explicitly requested. WP29 restates both criteria [E1].
- **Fingerprinting is in scope.** WP29 Opinion 9/2014 (adopted 25 November 2014) applies Article 5(3) to device fingerprinting [E1]. EDPB Guidelines 2/2023 (version 2.0, adopted 7 October 2024; version 1.0 was 14 November 2023) build on it [E2]:
  - JavaScript that tells the browser to send information back is gaining access [E2 ¶33];
  - information computed on the device and then sent (our canvas digest, our behavioural aggregates) is still access [E2 ¶53];
  - relying on protocol data such as the User-Agent or `Accept` headers **for fingerprinting** can bring Article 5(3) into play [E2 ¶43];
  - an IP address that originates from the user's equipment can be in scope too [E2 ¶55];
  - user-entered values collected by client code are gained access as well [E2 ¶62–63].
- **The exemptions are not analysed** in the 2023 guidelines, which say only that applicability does not always mean consent is needed, and point back to WP29 9/2014 for examples [E2 ¶56].
- **What WP29 9/2014 says about security uses** [E1 §7.4–7.5]:
  - **user-centric security** can be exempt under criterion (b), but only for the security of the service the user explicitly asked for, and only with no secondary use, enforced by technical and organisational safeguards;
  - **device recognition used as an extra authentication factor** is *not* strictly necessary, so it needs consent;
  - security of third-party services the user did not request is not covered.
- **National implementations read here:**
  - **Germany:** §25 TDDDG (the renamed TTDSG). Consent after clear information under GDPR standards; exceptions for transmission only, or where strictly necessary ("unbedingt erforderlich") for a digital service the user expressly requested [E3].
  - **France:** the CNIL's guidelines (Délibération 2020-091, 17 September 2020) list as exempt the trackers used for authentication, **including those that secure the authentication mechanism, for example by limiting automated or unexpected access attempts** [E4 ¶49].
  - **United Kingdom:** PECR regulation 6, with the new Schedule A1 inserted by the Data (Use and Access) Act 2025 s.112 and Sch. 12 [E5], in force from **5 February 2026** (SI 2026/82, reg. 2) [E6]. Its strictly-necessary exception gives examples: protecting information connected with the requested service, the security of the user's equipment, **preventing or detecting fraud in connection with providing the requested service** (paraphrased), technical faults, and automatic authentication of the user [E5].

**What this means for OpenVerify (inference):**
1. **Per-session integrity signals** are the strongest candidates for the strictly-necessary exemption:
   - what they are: automation artefacts and aggregate behaviour, computed for **this inquiry only**, used only to judge this verification, and never turned into a reusable identifier;
   - why they qualify: the user asked to be verified, and the verification is worthless if a script can complete it. France's authentication-security example [E4] and the UK's explicit fraud example [E5] point the same way.
   - The condition is **no secondary use** [E1 §7.5]: no marketing, no cross-customer sharing, and retention tied to the inquiry.
2. **Cross-inquiry device recognition** is much closer to the device-recognition case WP29 said needs consent [E1 §7.4]:
   - what it is: browser and device fingerprint hashes, `ANDROID_ID`, list matches, graph edges;
   - why it is weaker: it protects the operator against the user, not the user's own service.
   - The UK's fraud example may cover it for UK operators [E5]; elsewhere in the EEA it is unsettled, because the EDPB has not analysed the exemptions [E2 ¶56].
   - Default: **off**, and **consent** when turned on.
3. **Timing:** nothing is read before the flow's consent step. The default template's first step is already consent [R18], and today uploads are refused before consent [R8].

### 6.2 GDPR

- **Fingerprints are personal data.** Online identifiers make a person identifiable [G1 Art 4(1)]. Recital 30 says traces from devices and protocols (IP addresses, cookie identifiers, and similar), combined with other server data, can profile and identify people [G2]. Fingerprint hashes, IPs and device ids are therefore personal data wherever they can be linked to an inquiry, which in OpenVerify they always are (inference).
- **Lawful basis (the operator's choice).** Processing strictly necessary to prevent fraud is named as a legitimate interest [G3]. A regulated operator may rely instead on a legal obligation (AML customer due diligence: inference). Either way, the ePrivacy question in 6.1 is separate: Article 5(3) governs the access itself, the GDPR governs what follows [E1].
- **Biometric data (Art. 9).** Defined as personal data from specific technical processing of physical, physiological or behavioural characteristics that allows or confirms unique identification [G1 Art 4(14)]. Raw keystroke timings can do that (§3.3 [P7]). The §3.4 aggregates are designed not to (inference). Collecting raw timings would put the operator under Art. 9 and the US laws below.
- **Automated decisions (Art. 22).** People have the right not to be subject to a decision based solely on automated processing with legal or similarly significant effects. Exceptions are contract necessity, law with safeguards, or explicit consent, and even then human intervention and the right to contest must be offered [G4]. **Default:** H-tier signals may route an inquiry to `needs_review` but never auto-decline it. An operator who wants auto-decline rules on `bot_score` writes them in a workflow and owns that choice (inference).
- **DPIA:** large-scale fraud profiling with device signals is a likely case for a data protection impact assessment. The docs should provide a template, and the decision is the operator's (inference).

### 6.3 United States: when behavioural data is biometric

| Law | Covers keystrokes or behaviour? | Consequence for us |
|---|---|---|
| **Illinois BIPA**, 740 ILCS 14/10 | "Biometric identifier" is a closed list: retina or iris scan, fingerprint, voiceprint, scan of hand or face geometry, with exclusions (writing samples, signatures, photographs, and others). "Biometric information" is information based on such an identifier [U1] | Keystroke and mouse aggregates are **not** BIPA identifiers. Face geometry is, and Phase 4 already treats it so [R13] |
| **California CCPA/CPRA**, Civ. Code §1798.140 | "Biometric information" (subdivision (c)) covers physiological, biological or **behavioural** characteristics used to establish identity, and lists keystroke patterns or rhythms among its examples. Processing biometric information to uniquely identify a consumer is **sensitive personal information** (ae)(2)(A) [U2] | Raw keystroke timing is in scope. Our aggregates are not used to identify anyone (inference) |
| **Washington My Health My Data Act**, RCW 19.373.010 | "Biometric data" (subsection (4)) covers measurements of physical, biological or behavioural characteristics that identify a consumer, including keystroke patterns or rhythms that contain identifying information (4)(b) [U3]. Biometric data is a category of **consumer health data** (8)(b)(ix) [U3] | Identifying keystroke data would become consumer health data, with that Act's consent duties (inference). Another reason never to send raw timings |
| **Texas CUBI**, Bus. & Com. Code §503.001 | "Biometric identifier": retina or iris scan, fingerprint, voiceprint, record of hand or face geometry [U4] | No keystroke coverage. Face geometry as for BIPA |

### 6.4 What a self-hosted operator must decide

1. **Which signal tiers run**, per environment:
   - session integrity (default **on**);
   - device recognition (default **off**);
   - GPS (default **off**; the browser asks permission anyway);
   - the TLS-fingerprint adapter (default **off**).
2. **The legal basis for each tier**, and the ePrivacy position: exemption or consent. It is recorded in an environment setting with a free-text justification, and changes are audit-logged (inference).
3. **Consent text.** A new optional consent key for device recognition, for example `consent.device-recognition` (a name of ours), following the C42.3 `consent.biometric-matching` pattern: unticked by default; when declined, the device checks answer `not_applicable`/`not_consented` [R13].
4. **Retention.**
   - Raw sealed components: the shortest window (proposed default 30 days).
   - Behavioural aggregates: with the inquiry.
   - Fingerprint HMACs: with the list or graph policy, and deleted on redaction.
5. **Jurisdiction notes** in the operator's privacy notice: EU/EEA, UK, California, Washington, Illinois.
6. **Whether any H-tier signal may auto-decline.** Default: no (6.2).

**Recommended defaults** (inference, matching the existing consent model):
- collect nothing before the consent step;
- after it, collect session-integrity signals under the operator's documented strictly-necessary assessment, with no secondary use;
- collect device-recognition signals only with the optional consent;
- document the operator's choice in the environment settings and the audit log.

## Final table: signal → how collected → tier → privacy class → recommended default

**Tiers:**
- **R:** a fact, measured deterministically. Its *interpretation* may still be heuristic.
- **H:** a heuristic, shipped as `beta` with a confidence.
- **A:** an adapter plus a sandbox provider (ADR 0002 [R3]).

**Privacy classes (ours):**
- **N:** network or protocol data (personal data, sealed at rest).
- **D:** a low-entropy device characteristic (personal data once linked to an inquiry; reading it is ePrivacy access, §6.1).
- **I:** identifier-grade; links inquiries (personal data; ePrivacy access; enables cross-inquiry tracking).
- **B:** a behavioural aggregate, biometric-safe by design.
- **B!:** raw behavioural data (biometric risk).
- **L:** location.
- **S:** can reveal a sensitive trait, such as a disability.

**Defaults:**
- **on:** session integrity; collected after the consent step, with no secondary use (§6.1 point 1).
- **opt-in:** device recognition; off by default, and when enabled it needs the optional consent key (§6.4).
- **off:** operator-enabled.
- **never:** not collected.

| Signal | How collected | Tier | Privacy | Default |
|---|---|---|---|---|
| IP address (first flow call; consent record) | Socket or trusted proxy (C15); stored sealed today [R8] | R | N | on (exists) |
| User-Agent, `Sec-CH-UA*`, `Accept-Language` | Request headers | R | N/D | on |
| `os-name`, `browser-name`, `device-type`, `mobile-sdk-*` | `bowser` 2.14.1 on the UA; the SDK header (§2.5) | R (parse) | D | on |
| IP geolocation, ASN, Tor, cloud, VPN, `threat-level` | Server lookups (the network-data note) | R lookups; H for VPN and threat level | L/N | on when data is configured |
| Request timing (session to upload to submit) | API timestamps | R | N | on |
| `navigator.webdriver` | JS (exists in the selfie snapshot [R6]) | R | D | on |
| Driver globals, headless markers, environment lies | JS, rules after BotD [L7] | H | D | on |
| Cross-layer consistency (UA vs UA-CH vs JS; language; timezone vs IP) | Server comparison | H | D | on |
| Timezone, `navigator.languages`, UA-CH low-entropy values | JS | R | D | on (needed for the consistency checks) |
| Screen buckets, `hardwareConcurrency`, `deviceMemory`, `maxTouchPoints` | JS | R | D (fingerprint input) | opt-in |
| Canvas digest; noise detected (`fingerprint-randomised`) | JS; only the digest leaves the browser | R | I (input) / D | opt-in |
| WebGL vendor and renderer | JS | R | D (fingerprint input) | opt-in |
| `browser-fingerprint` (strict HMAC) and device-class HMAC | Server, from the components; keyed per environment | R value, H when matched | I | opt-in |
| Paste, drop, autofill, correction counts | JS events (`inputType`, `:autofill`) | R | B | on |
| Dwell, hidden seconds, focus losses, first-input bucket | JS events | R | B | on |
| `typing-cadence` class | JS, reduced in the browser | H | B | on |
| `pointer-types`, `pointer-before-click` | JS events | R | B | on |
| `untrusted-event-count` | JS `isTrusted` | R | B/D | on |
| `bot_score` (0–100), `behavior_threat_level` | Server, from the above | H (`beta`, confidence, reasons) | derived | on (computed when inputs exist; never auto-decline) |
| Raw keystrokes, inter-key timings, pointer coordinates or trajectories, clipboard contents | - | - | B! | **never** |
| Font enumeration, ad-block probing, permissions, speech voices, WebRTC, audio, plugins | - | - | I | **never** (v1) |
| Accessibility media queries; Android accessibility services | - | - | S | **never** |
| JA4 from a trusted proxy header | Adapter (§2.4) | A (sandbox: fixed values) | D | off |
| JA3, JA4+ | - | ❌ JA3 unstable; JA4+ licence | - | **never** |
| `device-handoff-method`, `handoff-from-session-id`, handoff timestamps | Server, on QR, email or SMS handoff | R | N | on when handoff is used |
| `handoff-distance-meters`, country or ASN changed | Server, from IP geolocation (and GPS) | R value, H when used | L | on when IP geo is configured |
| GPS position; `isMock` (Android) | Browser Geolocation API with the browser's prompt; Android `Location` [A6] | R | L | off |
| `ANDROID_ID` HMAC | SDK [A2] | R value, H when matched | I | opt-in |
| Debugger attached; host app debuggable | SDK [A3] | R | D | on |
| Emulator, root and hooking indicators | SDK, community heuristics | H | D | on |
| `ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED` | Always 0 for third-party apps [A4] | - | - | **never** (useless) |
| Play Integrity verdict | Phase 10 adapter [A1] | A | D | off (Phase 10) |
| C40.4 camera snapshot | Existing, with a selfie [R6][R10] | R | D | on (exists) |

## What Phase 7 should take from this (proposed)

1. **Fix the records.** Three places are out of date:
   - PLAN §3, row "Browser fingerprint" [R1];
   - THIRD_PARTY_LICENSES.md line 261, "FingerprintJS v3 only", and line 382, which excludes "FingerprintJS v4+" as BSL [R23].

   FingerprintJS is **MIT again from 5.0.0 (2025-10-22)**; only 4.x is BUSL-1.1 [L2][L3]. The new wording: "own collector; FingerprintJS v5 (MIT) as design reference; v4.x excluded (BSL)". PLAN §4.4's "headless/CDP artifacts" should note that the classic CDP `Runtime.enable` check no longer works on current Chromium [S3].
2. **Create `packages/signals`** with a browser entry and a server entry, no runtime dependencies in the browser entry:
   - **collector v1** (§1.5): bounded components, a canvas digest with noise detection, a `collector-version`, and only what the consent text can name;
   - **automation rules** (§2.1–2.2): webdriver, driver globals, UA markers, focus-aware 0×0 window, plugin and MIME consistency, `isTrusted`;
   - **behavioural aggregates** (§3.4): counts, coarse timings and classes only;
   - a **size test**: at most 4 KB gzipped for the browser entry;
   - **no network** and no change to the CSP. A Playwright test under the production CSP asserts there is no violation and no request to any origin but the API.
3. **Contracts** in `@openverify/contracts`: a strict zod `flowSignalsSchema` (enums and bounded integers, a `platform` discriminator `web`/`android`), sent with the existing flow calls after consent.
   - Tests: the collector's key set equals the schema's.
   - A test that no field can carry a string longer than its bound, so raw keystrokes or coordinates can never pass.
4. **Server scoring.**
   - Per-environment **HMAC** fingerprints (strict and device-class) from sealed components, never raw components in lists or the graph.
   - `fingerprint-randomised` lowers a match's weight.
   - `bot_score` (0–100) and `behavior_threat_level` (`low`/`medium`/`high`) are **H-tier** `beta`, with `confidence`, reason codes and thresholds (ADR 0002 [R3]).
   - Both are exposed in a Persona-style `signals` array of `{ name, value }` on the inquiry (`inquiry/bot_score`, `inquiry/behavior_threat_level` [D1]) and in its webhooks.
   - Absent inputs give no score (`signals_not_collected`), and nothing ever `passes` for "no bot found".
   - A sandbox provider maps documented magic values to fixed scores (ADR 0002 rule 3d).
5. **Two collection tiers per environment**:
   - `session-integrity`: on by default, after the consent step, no secondary use;
   - `device-recognition`: off by default; when enabled it needs the optional consent key, for example `consent.device-recognition` (the C42.3 pattern; declined means `not_applicable`/`not_consented` for the device checks).
   - Each tier carries a free-text legal-basis note; changes are audit-logged.
6. **Lists and graph** (other Phase 7 notes) consume only `browser-fingerprints` and `device-fingerprints` HMAC values [R4]. A CSV import of fingerprint values is accepted only as values produced by this installation's key (say so in the importer docs).
7. **Android** (`DeviceSignals` in `commonMain`, Android implementation in `androidMain`):
   - `ANDROID_ID` HMAC (opt-in tier);
   - debugger attached and host app debuggable (session tier);
   - emulator, root and hooking indicators as H-tier reasons.
   - **Drop** `ADB_ENABLED` and `DEVELOPMENT_SETTINGS_ENABLED`, which always read 0 [A4], and **never** read accessibility services.
   - Play Integrity stays Phase 10 as an A-tier adapter [A1].
8. **QR handoff** (§5.3–5.4):
   - a new `ovh_` token (256 bits, SHA-256 at rest, single use, 5-minute default, bound to the issuing session, one live per session);
   - the token in the URL fragment;
   - the QR generated locally;
   - a context screen on the phone with decline as prominent as continue;
   - "this was not me" on the desktop;
   - `device-handoff-method` and our handoff fields on the new session;
   - IP-to-IP (and GPS) **distance in meters** as a review signal, never a gate.
   - Cite RFC 10027 example B6 in the docs.
9. **UA parsing** with `bowser` 2.14.1, already locked transitively [R22]. Never `ua-parser-js` 2.x (AGPL) [L13]; `isbot` is not needed.
10. **TLS:** an optional `tls-fingerprint` adapter that reads **JA4** (BSD-3) from a trusted proxy header, off by default, with a sandbox provider. No JA3 (unstable on Chrome [S5]), and no JA4+ code (FoxIO licence) [L19].
11. **Docs** (`docs/checks/signals.md`):
    - each signal's tier and default;
    - what nothing here can detect (§2.3, §3.4);
    - the browser defences and why a fingerprint is not an identifier (§1.3–1.4);
    - the law section as "not legal advice" with the operator's decisions (§6.4);
    - a DPIA template;
    - the accessibility caveat (§3.2).
12. **Surface index:** add, as identifiers only, the inquiry `signals` array and its two names, the inquiry `behaviors` object, the session's device and network attributes, `device-handoff-method`, and the `device` attributes `device-vendor-id`, `device-fingerprint` and `browser-fingerprint` [O1][O2][O3][D1].

## Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Own collector, or depend on FingerprintJS v5 (MIT since 5.0.0)? | **Own collector** (≤4 KB gzipped, no network, versioned components); FingerprintJS v5 as a reference only. If it is ever adopted: `monitoring: false`, a pinned version, and the identifier version stored |
| 2 | Collect session-integrity signals without a separate consent, under the strictly-necessary exemption, after the consent step? | **Yes**, documented as the operator's assessment (WP29 9/2014 §7.5, CNIL ¶49, UK Sch. A1 para 4) with no secondary use; the operator can switch it off |
| 3 | Cross-inquiry device recognition (fingerprint HMACs, `ANDROID_ID`, list and graph use) | **Off by default**; when enabled, the optional `consent.device-recognition` key. An operator may set an `exempt` mode with a recorded justification (for example UK Sch. A1 para 4(2)) |
| 4 | Expose the `signals` array (`inquiry/bot_score`, `inquiry/behavior_threat_level`) on the inquiry API and webhooks by default? Persona gates it behind a feature flag [D1] | **Yes**, labelled beta with confidence; an environment setting can hide it |
| 5 | May any H-tier signal auto-decline? | **No.** It routes to review; auto-decline only through an operator-written workflow (GDPR Art. 22 [G4]) |
| 6 | Collect GPS in Phase 7 (browser prompt; Android location permission)? | **Not in Phase 7**; IP-based distances only. Revisit with the flow builder |
| 7 | Retention of sealed raw components and behavioural aggregates | Components **30 days**; aggregates with the inquiry; HMACs with the list and graph policy; all deleted on redaction |
| 8 | The JA4 proxy-header adapter | **Interface and sandbox only**, off; no JA4+ ever (FoxIO licence) |
| 9 | Handoff token lifetime and the optional confirmation code | **5 minutes** (2 to 15 configurable); confirmation code **off** by default, a template setting |
| 10 | QR library for the flow | **Measure** `qrcode` 1.5.4 (already used by the dashboard) against `uqr` 0.1.3 and `lean-qr` 2.7.4 in the flow bundle; choose the smaller one, all MIT |
| 11 | Android collectors in Phase 7 or Phase 10? PLAN §4.4 lists emulator and root under Phase 7 signals, and §6 Phase 10 lists "device signals: root/emulator" [R1] | **Phase 7**: the contract, server scoring and the cheap Android facts (`ANDROID_ID` HMAC, debugger). **Phase 10**: emulator, root and hooking heuristics with Play Integrity |
| 12 | An `isbot` exception (Unlicense is not on rule 4's list) | **No exception**: not needed for an IDV flow |
| 13 | Persona-style registry checks for signals (for example a `session_automation_detection` check of ours) | **Signals only in Phase 7**; add a check later only if review shows operators need one. It may only fail or review on evidence, never pass |

## Sources and pins

Every source was read on **2026-10-27**. "Raw" links are `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`. "Measured" means our own `python3 -I` script over a downloaded file [M1].

**Repository (R)**, `/home/mhnoor/persona-opensource` at `fe4850ca8b710ba6b70c50a8ead9ff2e9355b713` (read-only):
- [R1] `docs/PLAN.md` §2 (Signals, Lists, Graph, Transactions rows), §3 (technology table, row "Browser fingerprint" at line 142), §4.4 (line 284), §6 (Phases 7 and 10), §9
- [R2] `CLAUDE.md` rules 4 and 5
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (list-item types, `inquiry-session.*` events, `devices`, `list-item/*` paths)
- [R5] `apps/flow/src/security/security-meta.ts` (`buildContentSecurityPolicy`); `apps/flow/index.html`
- [R6] `apps/flow/src/selfie/device-snapshot.ts`
- [R7] `packages/contracts/src/selfie-captures.ts` (`selfieDeviceSnapshotSchema`, C40.4)
- [R8] `packages/db/src/tables/inquiries.ts` (`inquiry_sessions`, consent record, sealed `ip` and `user_agent`)
- [R9] `packages/checks/src/selfie/selfie-liveness-detection.ts`, `virtual-cameras.ts`
- [R10] `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/camera/CameraFacts.kt`
- [R11] `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/api/FlowHttp.kt`, `FlowHttpPlatform.kt`
- [R12] `android/openverify-sdk/src/androidMain/AndroidManifest.xml`; `android/gradle/libs.versions.toml`
- [R13] `docs/plans/phase-4.plan.md` C42 (C42.3 matching consent; account and repeat comparisons)
- [R14] `docs/plans/phase-6.plan.md` C76, C85.1; `docs/research/phase6-data-sources.md` ("Needs the owner" 12)
- [R15] `apps/flow/src/api/flow-transport.ts`; `apps/flow/src/main.tsx`; `apps/flow/src/session/session-bootstrap.ts`
- [R16] `packages/contracts/src/inquiry-sessions.ts`
- [R17] `apps/api/src/operator-auth/settings.ts`; `apps/api/src/app.ts` (`trustProxy`, C15)
- [R18] `packages/contracts/src/inquiry-templates.ts` (default template, consent step)
- [R19] `packages/contracts/src/tokens.ts`
- [R20] `apps/api/src/services/one-time-links.ts`
- [R21] `apps/api/src/app.ts` (rate-limit defaults); `apps/api/src/plugins/rate-limit.ts`
- [R22] `pnpm-lock.yaml` (`bowser: 2.14.1` under `@aws-sdk/core@3.978.3`)
- [R23] `THIRD_PARTY_LICENSES.md` lines 261 and 382

**Libraries (L)**, npm registry documents `https://registry.npmjs.org/<name>` (scoped names with `%2F`):
- [L1] `@fingerprintjs/fingerprintjs`: 91 versions. Licence history: MIT to 3.4.2 (2023-07-06); `BUSL-1.1` from 4.0.0 (2023-07-26) to 4.6.2 (2025-04-10); MIT from 5.0.0 (2025-10-22). Latest 5.3.0 (2026-10-07T06:46:34Z), `gitHead` `dac5ae59409669f09aa09c0b2f44b7615b0520da`
- [L2] LICENSE files: raw `fingerprintjs/fingerprintjs` at `v3.4.2` (MIT, © 2023), `v4.6.2` (Business Source License 1.1, no additional use grant, change licence MIT after four years per version), `v5.0.0` and `dac5ae5` (MIT, © 2025); also inside the 5.3.0 and 3.4.2 tarballs [M1]
- [L3] `https://api.github.com/repos/fingerprintjs/fingerprintjs/releases?per_page=30` (notes for v4.0.0, v5.0.0, v5.0.1, v5.1.0, v5.2.0, v5.3.0)
- [L4] raw `fingerprintjs/fingerprintjs/dac5ae5/docs/api.md` (the `monitoring` option)
- [L5] raw `fingerprintjs/fingerprintjs/dac5ae5/` `src/sources/index.ts`, `src/utils/dom.ts`, `src/confidence.ts`, `src/agent.ts` (`m1.openfpcdn.io` monitoring request)
- [L6] raw `fingerprintjs/fingerprintjs/dac5ae5/readme.md`, `docs/version_policy.md`
- [L7] `@fingerprintjs/botd` (2.0.0, 2025-11-04, MIT); raw `fingerprintjs/botd/v2.0.0/` (tag commit `dc6a8f99ce5e`) `LICENSE`, `README.md`, `docs/api.md`, `src/index.ts`, `src/types.ts`, `src/detectors/index.ts`, `src/detectors/{webdriver,user_agent,window_size,rtt}.ts`, `src/sources/distinctive_properties.ts`; `https://api.github.com/repos/fingerprintjs/botd/releases`; contents listings of `src/detectors` and `src/sources` at `v2.0.0`
- [L8] `@thumbmarkjs/thumbmarkjs` (1.12.0, 2026-09-25, `gitHead` `7d845343492b5afde9c013cf0cfff1299067d798`); raw at that commit: `LICENSE`, `README.md`, `src/components/webrtc/index.ts`; contents listing of `src/components`
- [L9] `clientjs` (0.2.1, 2021-10-25; 0.1.5–0.1.9 declared GPL-3.0); `https://api.github.com/repos/jackspirou/clientjs` (last push 2023-01-08); raw LICENSE at `ce103dc29da3ad09805d78ca4494d8f356c97db0` (Apache-2.0)
- [L10] `https://api.github.com/repos/abrahamjuliot/creepjs` (MIT, last push 2026-06-11); raw LICENSE at `master` = `10aa6724cd33a1015db1574211890518cd04f0cc`; npm `creepjs` (1.0.0, 2016, an unrelated package from another repository)
- [L11] `get-browser-fingerprint` (5.2.4, 2026-04-02); `https://api.github.com/repos/damianobarbati/get-browser-fingerprint` (licence: none)
- [L12] `fingerprintjs2` (2.1.4, 2021-03-02, deprecated)
- [L13] `ua-parser-js` (licence alternates by line; 1.0.41 on 2025-08-19, MIT; 2.0.10 on 2026-05-21, AGPL-3.0-or-later); tarballs 1.0.41 (`license.md`) and 2.0.10 (`LICENSE.md`) [M1]
- [L14] `bowser` (2.15.0 on 2026-10-26; 2.14.1 on 2026-02-08, MIT); 2.14.1 tarball `LICENSE` [M1]
- [L15] `isbot` (5.2.2, 2026-08-27, Unlicense from 3.0.22); 5.2.2 tarball `LICENSE` [M1]
- [L16] `puppeteer-extra-plugin-stealth` (2.11.2, 2023-03-01, `gitHead` `2f4a357f233b35a7a20f16ce007f5ef3f62765b9`); raw `berstend/puppeteer-extra` LICENSE at that commit (MIT); contents listing of `packages/puppeteer-extra-plugin-stealth/evasions` at that commit
- [L17] `qrcode` (1.5.4, 2024-08-05, MIT; dependencies `dijkstrajs`, `pngjs`, `yargs`); 1.5.4 tarball `license` (MIT, copyright 2012, the author) [M1]; `apps/dashboard/package.json` pins `"qrcode": "1.5.4"`
- [L18] `uqr` (0.1.3, 2026-04-03; tarball LICENSE MIT, two copyright holders); `lean-qr` (2.7.4, 2026-09-07; tarball LICENSE MIT, copyright 2021–2025, the author); `qrcode-generator` (2.0.4, 2025-08-07, MIT per npm only, LICENSE not read)
- [L19] raw `FoxIO-LLC/ja4/c6469a7b0dbf8fe963810162429fbfd9d1acc4d5/` `LICENSE` (FoxIO License 1.1 for JA4+), `LICENSE-JA4` (BSD-3-Clause for JA4), `License%20FAQ.md`, `README.md` (head commit dated 2026-10-06)
- [L20] `https://api.github.com/repos/salesforce/ja3` (BSD-3-Clause, archived)

**Measurements (M)**
- [M1] Our measurements of tarballs downloaded from `https://registry.npmjs.org/<name>/-/<file>.tgz`, read in memory by `scripts/tgz_inspect.py` (LICENSE heads, `package.json` fields, raw and gzip-9 sizes). Also `apps/flow/dist/assets/index-BdgvoKEw.js`, the flow build present on disk on 2026-10-27: 820,481 B raw, 237,048 B gzip-9. The tarballs: FingerprintJS 5.3.0 and 3.4.2, BotD 2.0.0, ThumbmarkJS 1.12.0, get-browser-fingerprint 5.2.4, qrcode 1.5.4, uqr 0.1.3, lean-qr 2.7.4, ua-parser-js 1.0.41 and 2.0.10, bowser 2.14.1, isbot 5.2.2.

**Browsers (B)**
- [B1] https://webkit.org/blog/15697/private-browsing-2-0/ (2024-07-16; `/blog/14595/` answers 301 to it)
- [B2] https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ (2025-09-15)
- [B3] https://wiki.mozilla.org/Fingerprinting (updated 2026-05-12; reflects Firefox 151)
- [B4] https://blog.mozilla.org/en/firefox/fingerprinting-protections/ (2025-11-10; Firefox 145)
- [B5] https://github.com/arkenfox/user.js/wiki/3.3-Overrides-%5BTo-RFP-or-Not%5D (community guide; edited 2026-08-04)
- [B6] https://github.com/brave/brave-browser/wiki/Fingerprinting-Protections (edited 2026-01-07)
- [B7] https://privacysandbox.google.com/protections/privacy-budget (marked no longer active; updated 2022-03-04; `developer.chrome.com/docs/privacy-sandbox/privacy-budget` answers 301 to it)
- [B8] https://privacysandbox.google.com/protections/script-blocking (updated 2025-10-27)
- [B9] https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies (2025-10-17)

**Persona (D, O)**
- [D1] https://docs.withpersona.com/2026-09-29/inquiry-signals.md (the robots file disallows only `/api/fern-docs/`)
- [D2] https://docs.withpersona.com/2026-09-29/inquiry-sessions.md
- [O1] raw `persona-id/persona-openapi/e64dbfbd04968b4f48e41ad571eb85861ac969bf/2026-09-29/components/schemas/inquiry-session.yaml` (commit dated 2026-10-27T08:08:31Z)
- [O2] same commit, `2026-09-29/components/schemas/device.yaml`
- [O3] same commit, `2026-09-29/components/schemas/inquiry.yaml` (`behaviors`)

**Studies (P)**
- [P1] "How Unique Is Your Web Browser?", PETS 2010 (EFF), https://panopticlick.eff.org/browser-uniqueness.pdf (the location search results give; read through search summaries)
- [P2] "Hiding in the Crowd: an Analysis of the Effectiveness of Browser Fingerprinting at Large Scale", WWW 2018, DOI 10.1145/3178876.3186097, https://hal.archives-ouvertes.fr/hal-01718234 (search summary of the HAL record)
- [P3] "FP-STALKER: Tracking Browser Fingerprint Evolutions", IEEE S&P 2018, https://hal.archives-ouvertes.fr/hal-01652021 (search summary)
- [P4] "Assessing Web Fingerprinting Risk", WWW 2024, https://arxiv.org/abs/2403.15607 (abstract fetched)
- [P5] "Detection of Advanced Web Bots by Combining Web Logs with Mouse Behavioural Biometrics", Digital Threats: Research and Practice 2(3), 2021, DOI 10.1145/3447815, https://eprints.bournemouth.ac.uk/36055/ (search summary)
- [P6] "BeCAPTCHA-Mouse: Synthetic Mouse Trajectories and Improved Bot Detection", Pattern Recognition 2022, DOI 10.1016/j.patcog.2022.108643, https://arxiv.org/abs/2005.00890 (search summary)
- [P7] "Comparing Anomaly-Detection Algorithms for Keystroke Dynamics", DSN 2009, https://www.cs.cmu.edu/~keystroke/KillourhyMaxion09.pdf (search summary)

**Specifications and industry (S)**
- [S1] W3C WebDriver, Editor's Draft 2026-07-09, https://w3c.github.io/webdriver/ (`NavigatorAutomationInformation`, the webdriver-active flag)
- [S2] https://developer.chrome.com/docs/chromium/headless (updated 2024-10-21)
- [S3] https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/ (2025-08-28)
- [S4] https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/ (search summary only)
- [S5] https://www.fastly.com/blog/a-first-look-at-chromes-tls-clienthello-permutation-in-the-wild (2023-02-08)
- [S6] https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/inputType ; Input Events Level 2, https://w3c.github.io/input-events/ (values as listed through MDN)
- [S7] https://developer.mozilla.org/en-US/docs/Web/CSS/:autofill

**Android (A)**, saved reference pages searched locally (each about 2.3 MB):
- [A1] https://developer.android.com/google/play/integrity/overview (updated 2026-04-20)
- [A2] https://developer.android.com/reference/android/provider/Settings.Secure (`ANDROID_ID`)
- [A3] https://developer.android.com/reference/android/os/Debug (`isDebuggerConnected()`)
- [A4] https://developer.android.com/reference/android/provider/Settings.Global (`ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED`)
- [A5] https://developer.android.com/reference/android/os/Build (`FINGERPRINT`, `HARDWARE`, `PRODUCT`, `TAGS`)
- [A6] https://developer.android.com/reference/android/location/Location (`isMock()`, `isFromMockProvider()`)
- [A7] https://developer.android.com/identity/user-data-ids (updated 2026-10-23)

**Cross-device standards (I, N, W)**
- [I1] RFC 10027 / BCP 247, "Best Current Practice for Security of Cross-Device Flows", August 2026, https://www.rfc-editor.org/rfc/rfc10027.txt (SHA-256 `6dbc22add43407cb07f1b665a94f63fdd6302f99fcc42978527d6767a442ffc1`); https://datatracker.ietf.org/doc/rfc10027/ (formerly `draft-ietf-oauth-cross-device-security`, last version -16)
- [I2] RFC 8628, OAuth 2.0 Device Authorization Grant, §5.1 and §5.4, https://www.rfc-editor.org/rfc/rfc8628.txt (SHA-256 `ebd3c37415aa665b55b412fccd9571943e8dbd3f2bf0b18fee4924264252decd`)
- [N1] NIST SP 800-63B-4 (July 2025), https://pages.nist.gov/800-63-4/sp800-63b/authenticators/ §3.1.3, §3.2.5, §3.2.11
- [W1] OWASP, QRLJacking, https://community.owasp.org/attacks/Qrljacking (`owasp.org/www-community/attacks/Qrljacking` answers 308 to it)

**EU and UK law (E, G)**
- [E1] Article 29 Working Party, Opinion 9/2014 on device fingerprinting (WP 224), adopted 25 November 2014, https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp224_en.pdf (SHA-256 `d25a871b27403d19ae6665a634060874954d5c8fad12e07c6f9c94b38d170445`); §6 (criteria A and B), §7.4, §7.5
- [E2] EDPB Guidelines 2/2023 on the Technical Scope of Art. 5(3) ePrivacy Directive, version 2.0 adopted 7 October 2024 (version 1.0, 14 November 2023), https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf (SHA-256 `dbc1d37783e35ae8668925f92a590ae282eec24c98381a5a8f91b5c2048b5b03`); ¶2, ¶33, ¶43, ¶53, ¶55–56, ¶62–63; landing page https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en
- [E3] §25 TDDDG, https://www.gesetze-im-internet.de/ttdsg/__25.html (the `/tdddg/` path answers 404)
- [E4] CNIL, Délibération n° 2020-091 of 17 September 2020 (guidelines on cookies and other trackers), ¶49, https://www.cnil.fr/sites/cnil/files/atoms/files/lignes_directrices_de_la_cnil_sur_les_cookies_et_autres_traceurs.pdf (SHA-256 `88de95e6032b898b5a46b5c981bf9998a57ab1deacd82123d6a32447509572dd`)
- [E5] Data (Use and Access) Act 2025, Schedule 12 as enacted (inserting PECR Schedule A1; para 4 is the strictly-necessary exception), https://www.legislation.gov.uk/ukpga/2025/18/schedule/12/enacted
- [E6] The Data (Use and Access) Act 2025 (Commencement No. 6 and Transitional and Saving Provisions) Regulations 2026, SI 2026/82, reg. 2 (s.112 and Sch. 12 in force 5 February 2026; made 29 January 2026), https://www.legislation.gov.uk/uksi/2026/82/made
- [G1] GDPR Art. 4(1) and 4(14), read via https://gdpr-info.eu/art-4-gdpr/ (official text https://eur-lex.europa.eu/eli/reg/2016/679/oj, which refuses scripted fetches)
- [G2] GDPR Recital 30, https://gdpr-info.eu/recitals/no-30/
- [G3] GDPR Recital 47, https://gdpr-info.eu/recitals/no-47/
- [G4] GDPR Art. 22, https://gdpr-info.eu/art-22-gdpr/

**US law (U)**
- [U1] Illinois BIPA, 740 ILCS 14/10, https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3004&ChapterID=57 and https://lig.ilga.gov/legislation/ilcs/documents/074000140K10.htm (as amended by P.A. 103-0769). Both failed TLS verification from here; read through a search engine's reading of the official page
- [U2] Cal. Civ. Code §1798.140(c) and (ae)(2)(A). Official https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140 answered 403; read via https://california.public.law/codes/civil_code_section_1798.140 (the page shows "updated Jan. 1, 2026")
- [U3] RCW 19.373.010(4)(b) and (8)(b)(ix), https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010
- [U4] Tex. Bus. & Com. Code §503.001, https://statutes.capitol.texas.gov/Docs/BC/htm/BC.503.htm (it rendered only navigation for the fetcher; the definition comes from a search summary of that page)

**Scripts** (in `/home/mhnoor/.claude/projects/-home-mhnoor-persona-opensource/resume/phase7-research/scripts/`, run with `python3 -I`, paths passed as arguments): `npm_summary.py`, `tgz_inspect.py`, `android_ref_extract.py`, `pdf_text.py`.

## Fact-check (2026-10-27)

Independent re-check of the load-bearing facts, 17:40–18:15 UTC, by a separate agent. Every fact was re-opened at its primary
source with a new fetcher (standard library, `python3 -I`, scripts kept in the session scratchpad, not in `scripts/`): robots.txt
first, evaluated per RFC 9309 plus any group naming Anthropic's agents; at least 1.2 s between requests to one host, and any
`Crawl-delay` honoured (5 s for legislation.gov.uk, 10 s for the Illinois hosts); a descriptive User-Agent without contact
details; no personal data sent. Downloads went into new, empty `downloads/fc-*` directories, and tarballs were read in memory;
nothing downloaded was executed. PDFs were read with `pypdf` 6.20.1 in a throwaway `uv` environment resolved with
`--exclude-newer 2026-10-13`. **TLS:** the Illinois General Assembly hosts still send an incomplete certificate chain. The issuing
intermediate was fetched from the CA's own AIA address (`crt.sectigo.com`), verified against the system roots with `openssl verify`,
and loaded beside the system store for those requests only; verification was never disabled. That made the official BIPA text
readable. Only the rows below and the sentences marked "(corrected in fact-check)" changed.

| # | Fact (as listed for Phase 7) | Verdict | Primary evidence |
|---|---|---|---|
| 1 | FingerprintJS MIT again from 5.0.0 (2025-10-22); LICENSE at `v5.0.0` and `dac5ae5` MIT; 5.3.0 released 2026-10-07 | confirmed | Registry: licence MIT up to 3.4.2, `BUSL-1.1` from 4.0.0 (2023-07-26), MIT from 5.0.0 (2025-10-22); 5.3.0 at 2026-10-07T06:46:34Z with `gitHead` `dac5ae5…`; both LICENSE files MIT; the v5.0.0 release note states the change |
| 2 | 4.x (last 4.6.2, 2025-04-10) is BSL 1.1 with no additional use grant | confirmed | LICENSE at `v4.6.2` ("Additional Use Grant: None"; each version changes to MIT four years after its first release) |
| 3 | npm builds default to `monitoring: true`; 0.1% of `load()` calls reach `m1.openfpcdn.io` with version, headers and IP; `monitoring: false` disables it | confirmed | `docs/api.md` at `dac5ae5`; `src/agent.ts` (`Math.random() >= 0.001`, `m1.openfpcdn.io`, `monitoring = true`); BotD `src/index.ts` at `v2.0.0` has the same pattern |
| 4 | Measured sizes of the three libraries and of the flow bundle | confirmed | Own tarball measurements identical (`fp.min.js` 37,093 / 16,235 B; `botd.esm.js` 27,519 / 6,596 B; `thumbmark.esm.js` 31,348 / 11,492 B). The flow bundle is 820,481 B; its 237,048 B figure is GNU `gzip -9` output (Python's gzip-9 gives 236,896 B), so the +6.8% estimate is unaffected |
| 5 | ThumbmarkJS 1.12.0 (MIT, 2026-09-25): sampled logging and remote script evaluation by default | confirmed | Registry; README at `7d84534` (`logging` default true; at most 0.01% of runs; `api.thumbmarkjs.com/log`; a script fetched from `experimental.thumbmarkjs.com` and evaluated; `logging: false` stops both) |
| 6 | BotD 2.0.0 (MIT, 2025-11-04): 18 detectors, `{bot, botKind}`, stability-only roadmap | confirmed | Registry; `src/detectors/index.ts` registers 18; `docs/api.md`; the README's maintenance section |
| 7 | JA4 BSD-3-Clause; JA4+ under FoxIO License 1.1, non-commercial | confirmed | `LICENSE-JA4` (BSD three-clause text) and `LICENSE` at `c6469a7` (FoxIO 1.1, non-commercial purposes only; it names JA4S, JA4H, JA4L, JA4LS, JA4X, JA4T, JA4TS, JA4TScan, JA4D, JA4D6, JA4SScan, JA4E and JA4SSH) |
| 8 | Chrome permutes ClientHello extensions since January 2023 (108–110) | confirmed | Fastly post of 2023-02-08: update shipped on 20 January; planned for 110 and observed in 108 and 109; JA3 becomes practically unique per connection |
| 9 | `ua-parser-js` 2.x AGPL (2.0.10, 2026-05-21); `bowser` 2.14.1 MIT in the lockfile via `@aws-sdk/core` 3.978.3; 2.15.0 too new | confirmed | Registry (2.15.0 published 2026-10-26); `pnpm-lock.yaml` (`bowser: 2.14.1` under `@aws-sdk/core@3.978.3`) |
| 10 | `isbot` 5.2.2 is Unlicense, not on rule 4's list | confirmed | Registry; CLAUDE.md rule 4 |
| 11 | The classic CDP stack-getter check broke with two V8 commits in May 2025 | confirmed | Castle post (commits of 7 and 9 May 2025) |
| 12 | Persona `signals` array with `inquiry/bot_score` (42) and `inquiry/behavior_threat_level` (`low`), feature-gated, meters | confirmed | D1. **Related claim corrected:** §3 and §3.4 said the range was not documented; help article `V809YiUBfhmD5ocRMVp6r7` gives `bot_score` 0 to 100 and the three threat levels |
| 13 | Session `device-handoff-method` and network booleans; device attributes | confirmed | `inquiry-session.yaml`, `device.yaml` at `e64dbfb` (the local copy matches the published tree's blob hashes) |
| 14a | Firefox: canvas randomisation in private browsing from 120, in the desktop Baseline Release column from 151, Baseline undefined | confirmed | wiki.mozilla.org/Fingerprinting ("As of Firefox 151 Release, last updated 5/12/26"; CanvasRandomization: FPP (PBM) Release 120, Baseline Release 151) |
| 14b | Safari 26 restricts known fingerprinting scripts "in all browsing" | **corrected** (precision) | The WebKit post describes the restriction without naming any browsing mode; "all browsing" is our reading, not its statement |
| 14c | Chrome Privacy Budget archived, never implemented | confirmed | The page says the proposal is no longer active and has not been implemented in any browser |
| 15 | `ANDROID_ID` per signing key, user and device, may change on factory reset; `ADB_ENABLED` and `DEVELOPMENT_SETTINGS_ENABLED` always 0 for third-party apps | confirmed | `Settings.Secure` and `Settings.Global` reference pages |
| 16 | RFC 10027 / BCP 247 (August 2026); example B6; §6.1.1–6.1.17 | confirmed | rfc-editor.org text, SHA-256 identical to the note's pin; header, §4.3.6 and the §6.1 titles |
| 17 | EDPB 2/2023 v2.0 adopted 7 October 2024; ¶33, ¶53; exemptions not analysed (¶56) | confirmed | The PDF (version table: 1.0 on 14 November 2023, 2.0 on 7 October 2024); ¶33, ¶43, ¶53, ¶55, ¶56 and footnote 30 (pointing to WP29 9/2014) read |
| 18 | WP29 Opinion 9/2014 (25 November 2014) §7.4 and §7.5 | confirmed | The PDF ("Adopted on 25 November 2014"; §7.4 device fingerprint as a second authentication factor needs consent; §7.5 user-centric security exempt only without secondary use) |
| 19 | UK PECR Sch. A1 para 4(2) fraud example; in force 5 February 2026 by SI 2026/82 reg. 2 | confirmed | DUAA 2025 Sch. 12 as enacted (para 4(2)(c)); SI 2026/82, made 29 January 2026, reg. 2(w) and (z13) |
| 20 | CNIL 2020-091 ¶49; §25 TDDDG exceptions | confirmed | CNIL PDF ¶49 (authentication trackers, including those securing it against automated access attempts); gesetze-im-internet.de §25(2) |
| 21 | CCPA §1798.140(c) and (ae)(2)(A); RCW 19.373.010(4)(b) and (8)(b)(ix); BIPA closed list without keystrokes | confirmed | CCPA through california.public.law (the official leginfo page still answers 403); RCW at app.leg.wa.gov; **BIPA from the official ILGA file repository** (`ftp.ilga.gov/ILCS/Ch 0740/Act 0014/074000140K10.html`; source note P.A. 103-769), which replaces the search-engine reading |
| 22 | Repository: flow CSP; C10 link revocation; tokens; Android SDK reports only the C40.4 snapshot | confirmed | `security-meta.ts`; `one-time-links.ts` (older unused links revoked); `tokens.ts` (`TOKEN_BYTES = 32`, SHA-256 stored); no device-integrity code in `android/openverify-sdk/src` (the only "emulator" hits concern the development host alias) |

**Counts:** 22 facts (24 rows): 23 rows confirmed, 1 corrected (Safari wording); 0 could not verify. One related claim (the `bot_score` range) was also corrected in §3 and §3.4.
