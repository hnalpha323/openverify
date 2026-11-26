package dev.openverify.sdk.signals

import dev.openverify.sdk.privacy.SdkModule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C94.3, C94.7: what the SDK never reads, checked over the main sources of every shipped module
 * (comments left out) and their manifests. Developer settings and ADB always read 0 to third-party apps; accessibility services can
 * reveal a disability; telephony and network hardware identifiers are not resettable. The device
 * facts it does read stay in the Android signals code, which reads them only under a tier.
 */
internal class NeverReadTest {

    /** Gradle runs host tests from the module directory. */
    private val sources = File("src")

    private fun code(file: File): String =
        file.readText()
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""//[^\n]*"""), "")

    /**
     * The main sources of every shipped module (Workflow 10C, privacy-checks): the SDK's own and each
     * optional artifact's, one entry per module in [SdkModule.ALL], so the lists below hold for
     * `openverify-nfc` too and for a module added later.
     */
    private fun mainSources(): List<File> =
        SdkModule.SHIPPED.flatMap { module ->
            module.mainRoots.map(::File).filter { it.isDirectory }.flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        }.also { check(it.size > 50) { "Found only ${it.size} sources under ${sources.absolutePath}" } }

    @Test
    fun `no source reads developer settings, accessibility services or hardware identifiers`() {
        val found = mainSources().flatMap { file ->
            val text = code(file)
            NEVER_READ.filter { it.containsMatchIn(text) }.map { "${file.path}: ${it.pattern}" }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `the device facts are read only by the Android signals code`() {
        val readers = mainSources()
            .filter { file -> DEVICE_FACTS.any { it.containsMatchIn(code(file)) } }
            .map { it.invariantSeparatorsPath }

        assertEquals(listOf(SIGNALS_READER), readers)
    }

    /**
     * C210.3 (Workflow 10B): the device-integrity probes read the process's maps, threads and mounts,
     * load classes and read the main thread's stack only through [ContextDeviceProbe], so every such read
     * is one of its rules' and runs only under session integrity.
     */
    @Test
    fun `the device-integrity reads stay in the probe`() {
        val readers = mainSources()
            .filter { file -> PROBE_READS.any { it.containsMatchIn(code(file)) } }
            .map { it.invariantSeparatorsPath }

        assertEquals(listOf(PROBE), readers)
    }

    /** C210.2 (decision 66): what other apps are installed is not read at all, so no `<queries>` entry. */
    @Test
    fun `the manifest declares no package visibility`() {
        SdkModule.SHIPPED.forEach { module ->
            val manifest = File(module.manifest).readText()

            assertEquals(false, "<queries" in manifest, module.name)
        }
    }

    /**
     * Workflow 10A (foundation-10a, C213.3): whether the host app is debuggable is also read by the
     * Android `platformLog` actual, which logs `SdkLog`'s codes only in a debuggable host, and
     * (android-sdk-api, C190.2) by the `LoopbackPolicy` actual, which allows plain http to a loopback
     * host only in a debuggable host. Each reader is named by its path.
     */
    @Test
    fun `whether the host is debuggable is read only by the named readers`() {
        val readers = mainSources()
            .filter { file -> DEBUGGABLE.containsMatchIn(code(file)) }
            .map { it.invariantSeparatorsPath }
            .sorted()

        assertEquals(DEBUGGABLE_READERS, readers)
    }

    /** The log writer's read stays a read: it reaches no flow API, signal, request, intent or storage. */
    @Test
    fun `the log writer's read of the debuggable flag sends nothing`() {
        val writer = code(File(LOG_WRITER))

        assertEquals(emptyList<String>(), SENDS.filter { it.containsMatchIn(writer) }.map { it.pattern })
    }

    /**
     * Workflow 10A (android-sdk-api, C213.1, decision 36): beside the internet and the camera, the
     * normal permission that lets the flow's window hide other apps' overlays on API 31 and later.
     */
    @Test
    fun `the manifest asks for the internet, the camera and to hide overlays only`() {
        val manifest = File(sources, "androidMain/AndroidManifest.xml").readText()
        val permissions = Regex("""<uses-permission\s+android:name="([^"]+)"""").findAll(manifest).map { it.groupValues[1] }.toList()

        assertEquals(listOf("android.permission.INTERNET", "android.permission.CAMERA", "android.permission.HIDE_OVERLAY_WINDOWS"), permissions)
    }

    private companion object {
        val NEVER_READ = listOf(
            "ADB_ENABLED",
            "DEVELOPMENT_SETTINGS_ENABLED",
            "ENABLED_ACCESSIBILITY_SERVICES",
            "Accessibility(Manager|Service)",
            "TelephonyManager",
            "get(Imei|Meid|DeviceId|SubscriberId|SimSerialNumber|Serial|MacAddress|HardwareAddress)\\b",
            "Wifi(Info|Manager)",
            "BluetoothAdapter",
            "Build\\.SERIAL",
            // C210.2 (Workflow 10B, decision 31): the device-integrity probes never parse the build
            // fingerprint, list or query other apps, or read the network's interfaces and ports.
            "Build\\.FINGERPRINT",
            "QUERY_ALL_PACKAGES",
            "getInstalled(Packages|Applications)",
            "queryIntent(Activities|Services)",
            "NetworkInterface",
            "/proc/net",
        ).map(::Regex)

        const val PROBE = "src/androidMain/kotlin/dev/openverify/sdk/signals/DeviceProbe.kt"

        /** C210.3: the probes' reads of the process, the file system and class loading, only in [PROBE]. */
        val PROBE_READS = listOf("/proc/", "Class\\.forName", "\\.stackTrace\\b|getStackTrace", "FEATURE_TELEPHONY").map(::Regex)

        const val SIGNALS_READER = "src/androidMain/kotlin/dev/openverify/sdk/signals/AndroidDeviceSignals.kt"
        const val LOG_WRITER = "src/androidMain/kotlin/dev/openverify/sdk/log/PlatformLog.android.kt"
        const val LOOPBACK_POLICY = "src/androidMain/kotlin/dev/openverify/sdk/api/LoopbackPolicy.android.kt"

        /** Read only by [SIGNALS_READER]. */
        val DEVICE_FACTS = listOf("Secure\\.ANDROID_ID", "isDebuggerConnected", "smallestScreenWidthDp").map(::Regex)

        /** `ApplicationInfo.FLAG_DEBUGGABLE`, read only by [DEBUGGABLE_READERS]. */
        val DEBUGGABLE = Regex("FLAG_DEBUGGABLE")
        /** Workflow 10E: each optional artifact's one logger reads the flag for the same rule as [LOG_WRITER] (C213.3). */
        val MODULE_LOGGERS = listOf(
            "../openverify-nfc/src/main/kotlin/dev/openverify/nfc/NfcLog.kt",
            "../openverify-face/src/main/kotlin/dev/openverify/face/FaceLog.kt",
        )
        val DEBUGGABLE_READERS = (listOf(LOG_WRITER, LOOPBACK_POLICY, SIGNALS_READER) + MODULE_LOGGERS).sorted()

        /** What would send or keep a value: the flow API, signals, HTTP, intents, saved state, storage. */
        val SENDS = listOf(
            "dev\\.openverify\\.sdk\\.(api|signals|model|flow)",
            "FlowApi",
            "sendSignals",
            "HttpClient",
            "\\bIntent\\b",
            "\\bBundle\\b",
            "SharedPreferences",
        ).map(::Regex)
    }
}
