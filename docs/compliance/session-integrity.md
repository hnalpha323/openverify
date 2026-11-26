# Session integrity: a strictly-necessary assessment template

This is not legal advice. You are the controller, and you decide whether the ePrivacy "strictly necessary" exemption applies to your service; OpenVerify takes no position on the answer. This page lists, probe by probe, what OpenVerify reads from the person's browser or device under the **session-integrity** tier, so that your assessment covers each one. The tier and its notice are described in [signals](../checks/signals.md#collection-the-two-tiers).

Not reviewed by counsel.

## When the tier collects

- The environment's `signal-collection` setting has session integrity `on` (the default), **and**
- the template's consent step shows the notice `notice.session-integrity`, **and**
- the person has given the consent step's agreement on this session (`getEffectiveConsent`).

Before all three hold, nothing below is read. On Android the probes run once per app launch, off the main thread; in a browser the collector instantiates nothing before the session reports its tiers.

## Template

Copy the table into your assessment and fill the last two columns for your service. "Sent" is what leaves the device; everything else is read and discarded on the device.

| # | Client | What is read | What is sent | Purpose (OpenVerify's) | Strictly necessary for your service? (yours) | Less intrusive alternative considered (yours) |
|---|---|---|---|---|---|---|
| 1 | Browser | `navigator.webdriver`, known automation globals, headless markers in the user agent and client hints, a zero-sized focused window, plugin and MIME lists, native functions rewritten in script, untrusted input events | closed artefact kinds (never names or values) | detect scripted or automated verification | | |
| 2 | Browser | low-entropy client hints, time zone, up to five languages | the values, compared on the server with the request headers and the IP country | detect a client that contradicts its own network | | |
| 3 | Browser | per-screen aggregates: counts of pastes, drops, autofills, corrections, focus losses, hidden periods; whole-second dwell; first-input bucket; uniform cadence (three running sums); pointer types; pointer travel before the first click | the aggregates | detect scripted input, within the accessibility caps | | |
| 4 | Android | `Debug.isDebuggerConnected()` | `debugger-connected` | detect a debugger attached to the verification | | |
| 5 | Android | the host app's `ApplicationInfo.FLAG_DEBUGGABLE` | `app-debuggable` | flag a debug build of the host app | | |
| 6 | Android | the public `Build` fields `BOARD`, `BRAND`, `DEVICE`, `HARDWARE`, `MANUFACTURER`, `MODEL`, `PRODUCT` (never `FINGERPRINT`) | the codes `build_hardware_goldfish_or_ranchu`, `build_product_sdk`, `build_model_emulator`, `qemu_property` | detect an emulator | | |
| 7 | Android | whether the device has telephony (`PackageManager.hasSystemFeature`), with the board name | `no_telephony_and_generic_board` | detect an emulator | | |
| 8 | Android | whether the emulator's QEMU device files exist (`/dev/qemu_pipe`, `/dev/goldfish_pipe`, `/dev/socket/qemud`, `/sys/qemu_trace`, the qemu-props binaries, `libc_malloc_debug_qemu.so`) | `qemu_device_file` | detect an emulator | | |
| 9 | Android | whether `su` exists in 13 fixed directories | `su_binary_on_path` | detect root | | |
| 10 | Android | `Build.TAGS` and `Build.TYPE` | `build_tags_test_keys`, `ro_debuggable_and_not_secure` | detect a test-signed or engineering build | | |
| 11 | Android | the mount table (`/proc/mounts`) | `system_mounted_rw`, `magisk_mount_trace` | detect root | | |
| 12 | Android | the paths mapped into the app's own process (`/proc/self/maps`) | `frida_in_process_maps`, `unexpected_native_library` | detect an instrumentation or hooking library in the app | | |
| 13 | Android | the app's own thread names (`/proc/self/task/*/comm`) | `frida_thread_name` | detect an instrumentation agent | | |
| 14 | Android | whether two Xposed classes can be loaded by the app's class loader (never initialised) | `xposed_bridge_loadable` | detect a hooking framework | | |
| 15 | Android | the class names on the app's main-thread stack | `xposed_in_stack_trace` | detect a hooking framework | | |
| 16 | Android | the device class from the screen configuration | `device-class` (`smartphone` or `tablet`) | context for a reviewer | | |

**Sent are codes from fixed lists** (`ANDROID_EMULATOR_INDICATORS`, `ANDROID_ROOT_INDICATORS`, `ANDROID_HOOKING_INDICATORS` in `packages/contracts/src/flow-signals.ts`), at most 12 per family. No path, file content, class name, thread name or build value is sent.

**Never read under any tier:** other installed apps (no `<queries>` entry, no `QUERY_ALL_PACKAGES`), accessibility services, `ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED`, the IMEI, MAC addresses, network ports, keystrokes, pointer paths, the clipboard.

## Points your assessment should address

- **Necessity.** Whether detecting automation, emulators, root and hooking is strictly necessary to provide the identity verification the person asked for, or a further purpose of yours.
- **The notice.** `notice.session-integrity` tells the person before collection (GDPR Art. 13). On Android its built-in text (Phase 10 decision 66) names the probes: the device's build properties, the app's own process (its memory map, thread names and loaded classes), the mount table and the presence of known files, and says that only the names of the signs found are sent. If you word your own copy, keep it at least as specific.
- **Play Integrity is separate.** It sends the host app's own request to Google (the app's package, version and signing certificate, its licence status and the device's attestation) and is off by default; if you bind it, Google is a recipient, and publish requires `notice.play-integrity` beside the session-integrity notice (C211.9).
- **Use of the results.** The resulting signals are beta heuristics, never decisive alone: publish refuses a decline that follows from them without a verification outcome in between. A review rule sends an inquiry to a person.
- **Retention.** The sealed signal bodies follow `signal-component-retention-days`; the frozen signals live with the inquiry and are redacted with it.

References for your counsel: WP29 Opinion 9/2014 §7.5; CNIL délibération 2020-091 ¶49; UK PECR Schedule A1 paragraph 4 (in force from 2026-02-05).
