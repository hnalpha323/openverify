# Device integrity on Android

What the SDK reports about the device's integrity, and how a host app adds Google Play Integrity (Phase 10, Workflow 10B; plan C210, C211). **The device reports; the server judges** (ADR 0009). Every signal below is beta and **never decisive alone**: publish refuses a flow failure or a workflow decline that follows from one without a verification outcome in between ([signals](../checks/signals.md#device-integrity)).

## The indicator probes (C210)

Under the session-integrity tier, after consent and only when the template's consent step shows `notice.session-integrity`, the SDK runs its own probes once per launch, off the main thread, and adds the codes they found to its one signals body (`android-integrity`), beside `debugger-connected` and `app-debuggable`:

| Family | Codes | What it reads |
|---|---|---|
| Emulator | `build_hardware_goldfish_or_ranchu`, `build_product_sdk`, `build_model_emulator`, `qemu_property`, `qemu_device_file`, `no_telephony_and_generic_board` | the public `Build` fields (never `FINGERPRINT`), whether the device has telephony, whether the emulator's QEMU device files exist |
| Root | `su_binary_on_path`, `build_tags_test_keys`, `system_mounted_rw`, `magisk_mount_trace`, `ro_debuggable_and_not_secure` | whether `su` exists in fixed directories, `Build.TAGS` and `Build.TYPE`, the mount table (`/proc/mounts`) |
| Hooking | `frida_in_process_maps`, `frida_thread_name`, `xposed_bridge_loadable`, `xposed_in_stack_trace`, `unexpected_native_library` | the paths mapped into the app's own process (`/proc/self/maps`), its thread names, whether two Xposed classes can be loaded (never initialised), the main thread's stack |

- **Codes only.** No path, file content, class name or build value leaves the device. A probe whose read the platform refuses reports nothing, and a family none of whose probes answered is left out, never sent as clean.
- **Never read:** other installed apps (no `<queries>`, no `QUERY_ALL_PACKAGES`), accessibility services, `ADB_ENABLED`, `DEVELOPMENT_SETTINGS_ENABLED`, the IMEI, MAC addresses, network ports, `Build.FINGERPRINT` parsing. The SDK manifest asks for no new permission.
- **On the server** the codes become `inquiry/device_emulated`, `inquiry/device_rooted` and `inquiry/device_hooked`: `true` with the codes as reasons and a confidence by the number of independent families (0.5, 0.7, 0.85, provisional), or `null` (`no_indicator_found`, `not_android`, `collector_missing`). **A clean result is never `false`, "not rooted" or a pass.**
- **What they cannot see.** Every probe runs inside an environment the attacker may control: root hiding, a modified emulator image, renamed hooking tools and a repackaged app return clean answers. They say nothing about camera injection or a relay. An emulator is expected to report itself as one, and the device test asserts it; that assertion has not yet run to its end on a device.
- **The debugger facts.** `debugger-connected` is medium evidence for `inquiry/bot_score` and counts as one automation artefact; `app-debuggable` (your own build) is weak evidence. Neither alone reaches the score's strong band. They show that a debugger was attached or the app was a debug build when the body was read, not who attached it or why.

The probes' total time is measured by the device test `IntegrityProbesDeviceTest` whenever it runs on a device or an emulator (asserted under 500 ms; the 50 ms target and each read's share are logged under the tag `openverify-probes`). Its last run on an emulator, before Workflow 10C, measured 520 ms and failed that bound. Workflow 10C then made each read happen once per collection (on the host, about a third of the earlier CPU time on a large synthetic process). On one phone since (a Pixel 9 on Android 17) the test passed with 94.9 ms and 98.0 ms, so the 50 ms target is not met there and stays reported, never asserted. No emulator has run the test since that change, so the bound is not yet shown to hold on one.

## Play Integrity (C211)

Play Integrity is **off by default** and needs two things: the operator binds a `deviceIntegrity` provider for the environment (`OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX` or `_PRODUCTION`: `play-integrity`, or `sandbox` in a sandbox), and the host app installs an `IntegrityTokenProvider`. Without either, nothing is requested and the two signals read `null` (`provider_not_configured` or `integrity_token_unavailable`).

When the session says `integrity: { request: true }` (a provider bound, consent under the session-integrity tier, no token or verdict yet for the inquiry, the inquiry not decided), the SDK, beside the flow and never holding it:

1. creates one challenge (`POST /api/v1/flow/integrity-challenges`): the server answers an `ich_` id and a `request-hash` it computed (SHA-256 over a fixed label, the session id and 16 random bytes), valid for 600 s;
2. calls your `token(requestHash)` once;
3. posts the token (`POST /api/v1/flow/integrity-tokens`, at most 16 KiB), answered 202.

A `null`, an exception, an empty or over-long token, or any failure sends nothing more, and the flow goes on. The SDK asks at most once per launch; the server stops asking (`request: false`) once a token was taken for the inquiry. The SDK never keeps, logs or shows the token. The server decodes it in a job (never in the request), checks the package name, the request hash, the timestamp (within 10 minutes), the app recognition and your certificate digest, and stores only a fixed projection: the device recognition labels, the app recognition, the result of each check and the decode time. Everything else Google returns is dropped.

- `inquiry/device_integrity_level`: `strong`, `device`, `basic` or `none` (A-tier, beta).
- `inquiry/app_recognized`: `true` only for `PLAY_RECOGNIZED` with a configured certificate digest; `false` for an unrecognized version or another digest. Play's `UNEVALUATED` is `null` with `integrity_unevaluated`, never `false`: Play reports it when the device did not meet integrity, typically a hooked, rooted or emulated device, so it goes to review whatever the rule's `on-null` says.
- A replayed or foreign token (a failed package, hash or timestamp check) or a failed decode reads `null` with `integrity_decode_failed`.

**Limits.** A verdict is about the app and the device, never the person: a certified device can still present an injected camera feed through a granted app, or relay a real person, and devices without Google Play give no verdict. **Sideloaded and self-built host apps are unrecognized by design.** The Play Integrity API's default quota is **10,000 requests a day** per Cloud project; the SDK's one request per inquiry, only when the session asks, keeps within it until you raise it with Google.

### The host-side provider (the recipe)

OpenVerify ships no Google code (Phase 10 P3 declined), so the provider lives in your app, with your own dependency on `com.google.android.play:integrity` (Google's terms, not an open-source licence). A few lines are enough. Prepare the standard request **lazily, on the first `token()` call**, never at install or launch: `token()` is called only after consent and only when the session asks, so nothing contacts Google for a person who never reaches that point.

```kotlin
import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await // org.jetbrains.kotlinx:kotlinx-coroutines-play-services

class PlayIntegrityTokens(private val context: Context, private val cloudProjectNumber: Long) : IntegrityTokenProvider {
    private val lock = Mutex()
    private var prepared: StandardIntegrityTokenProvider? = null

    override suspend fun token(requestHash: String): String? = runCatching {
        val provider = lock.withLock {
            prepared ?: IntegrityManagerFactory.createStandard(context.applicationContext)
                .prepareIntegrityToken(PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(cloudProjectNumber).build())
                .await()
                .also { prepared = it }
        }
        provider.request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
            .await()
            .token()
    }.getOrNull() // a failure sends nothing; the signals read null
}

// In Application.onCreate: constructing it contacts nobody.
OpenVerifyAndroid.install(OpenVerifyComponents(integrityTokenProvider = PlayIntegrityTokens(this, CLOUD_PROJECT_NUMBER)))
```

What the SDK guarantees around your provider: `token()` is called only after consent, only when the session asks, at most once per inquiry launch, with the server's request hash, off the main thread and beside the flow, so a provider that never answers holds nothing up. What your provider sends to Google (your app's package, version and signing certificate, its licence status and the device's attestation) is your app's own request: declare it under Google's Data safety guidance for the Play Integrity API, and show `notice.play-integrity` on the consent step that precedes the collection (publish requires it while a provider is bound, and the server asks a session for a token only when its consent showed the notice, so a flow published before the binding is never asked).

### Server settings

Read by the worker while either environment kind binds `play-integrity` (`.env.example`):

| Variable | What |
|---|---|
| `OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME` | your app's package name, which every token must name |
| `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS` | your signing certificates' SHA-256 digests as Play reports them (43 base64url characters each, comma-separated, 1 to 10) |
| `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | the service account key file (JSON) that signs the OAuth assertion for `decodeIntegrityToken`; a secret, never logged |

The decode goes through the outbound client (15 s, no redirects); a production environment refuses the `sandbox` binding. Both flow routes share the rate policy `flow-integrity` (5 an hour per inquiry). In a sandbox, bind `sandbox` and post a [magic token](../checks/sandbox-providers.md#device-integrity) instead of a real one.

## Status

- **The notices.** Since Workflow 10B the Android wording of `notice.session-integrity` names what the probes read, and `notice.play-integrity` names Google and what it receives, in the five languages (machine-drafted outside English, pending the owner's review). While a `deviceIntegrity` provider is bound, publish refuses a v2 flow whose consent shows `notice.session-integrity` without `notice.play-integrity` on it or on a screen before it (`play_integrity_notice_missing`).
- The device tests need a device or an emulator. They are compiled and lint-checked on every run of the Android gate, and each assertion about SDK logic has a host test over a fake. They have run on one phone only ([what is not yet proved](release-and-support.md#what-is-not-yet-proved)); the device proofs still open are listed in the Phase 10 progress entry.
