package dev.openverify.sdk.signals

import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.AndroidRecognitionSignals
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.util.concurrent.Executors

/**
 * C94.7: the Android body reads only what the session's tiers allow. Session integrity reads the
 * debugger facts; device recognition reads `ANDROID_ID`; neither tier reads nothing at all.
 */
internal class AndroidDeviceSignalsTest {

    /** Device facts that count each read, so a test can show a fact was never read. */
    private class CountingFacts(
        var debugger: Boolean = false,
        var debuggable: Boolean = false,
        var id: String? = ANDROID_ID,
        var smallestWidthDp: Int = 411,
    ) : AndroidDeviceFacts {
        val reads = mutableListOf<String>()

        override fun debuggerConnected(): Boolean = debugger.also { reads += "debugger" }

        override fun appDebuggable(): Boolean = debuggable.also { reads += "debuggable" }

        override fun androidId(): String? = id.also { reads += "android-id" }

        override fun smallestScreenWidthDp(): Int = smallestWidthDp.also { reads += "smallest-width" }
    }

    private val integrityOnly = FlowSessionSignals(integrity = true, recognition = false)
    private val recognitionOnly = FlowSessionSignals(integrity = false, recognition = true)
    private val both = FlowSessionSignals(integrity = true, recognition = true)
    private val neither = FlowSessionSignals(integrity = false, recognition = false)

    @Test
    fun `session integrity sends the debugger facts and the device class, and never reads the ANDROID_ID`() = runTest {
        val facts = CountingFacts(debugger = true, debuggable = false)

        val body = AndroidDeviceSignals(facts).collect(integrityOnly, "consent", 0)

        assertEquals(
            FlowSignals(
                platform = "android",
                collectorVersion = 1,
                screen = "consent",
                sequence = 0,
                androidIntegrity = AndroidIntegritySignals(debuggerConnected = true, appDebuggable = false),
                deviceClass = "smartphone",
            ),
            body,
        )
        assertEquals(listOf("debugger", "debuggable", "smallest-width"), facts.reads)
    }

    @Test
    fun `device recognition sends the ANDROID_ID and never reads the debugger facts`() = runTest {
        val facts = CountingFacts()

        val body = AndroidDeviceSignals(facts).collect(recognitionOnly, "government_id", 4)

        assertEquals(
            FlowSignals(
                collectorVersion = 1,
                screen = "government_id",
                sequence = 4,
                androidRecognition = AndroidRecognitionSignals(ANDROID_ID),
                deviceClass = "smartphone",
            ),
            body,
        )
        assertEquals(listOf("android-id", "smallest-width"), facts.reads)
    }

    @Test
    fun `both tiers send both members`() = runTest {
        val facts = CountingFacts(debuggable = true)

        val body = AndroidDeviceSignals(facts).collect(both, "consent", 0)

        assertEquals(AndroidIntegritySignals(debuggerConnected = false, appDebuggable = true), body?.androidIntegrity)
        assertEquals(AndroidRecognitionSignals(ANDROID_ID), body?.androidRecognition)
    }

    @Test
    fun `with neither tier nothing is read and nothing is sent`() = runTest {
        val facts = CountingFacts()

        assertNull(AndroidDeviceSignals(facts).collect(neither, "consent", 0))
        assertEquals(emptyList<String>(), facts.reads)
    }

    @Test
    fun `an upper-case ANDROID_ID is sent in the contract's lower case`() = runTest {
        val body = AndroidDeviceSignals(CountingFacts(id = "0F1E2D3C4B5A6978")).collect(recognitionOnly, "consent", 0)

        assertEquals(AndroidRecognitionSignals(ANDROID_ID), body?.androidRecognition)
    }

    @ParameterizedTest
    @ValueSource(strings = ["", "0f1e2d3c4b5a69780", "not-hex-at-all", "0f1e 2d3c"])
    fun `an ANDROID_ID the contract cannot carry is left out, never replaced`(id: String) = runTest {
        val body = AndroidDeviceSignals(CountingFacts(id = id)).collect(both, "consent", 0)

        assertNull(body?.androidRecognition)
        assertEquals(AndroidIntegritySignals(debuggerConnected = false, appDebuggable = false), body?.androidIntegrity)
    }

    @Test
    fun `a device that reports no ANDROID_ID sends no recognition member`() = runTest {
        val body = AndroidDeviceSignals(CountingFacts(id = null)).collect(recognitionOnly, "consent", 0)

        assertEquals(FlowSignals(collectorVersion = 1, screen = "consent", sequence = 0, deviceClass = "smartphone"), body)
    }

    @ParameterizedTest
    @CsvSource("320,smartphone", "411,smartphone", "599,smartphone", "600,tablet", "800,tablet")
    fun `the device class follows the smallest screen width`(widthDp: Int, deviceClass: String) = runTest {
        val body = AndroidDeviceSignals(CountingFacts(smallestWidthDp = widthDp)).collect(integrityOnly, "consent", 0)

        assertEquals(deviceClass, body?.deviceClass)
    }

    @Test
    fun `an undefined smallest width sends no device class rather than a guess`() = runTest {
        val body = AndroidDeviceSignals(CountingFacts(smallestWidthDp = 0)).collect(integrityOnly, "consent", 0)

        assertNull(body?.deviceClass)
    }

    @Test
    fun `the ANDROID_ID never appears when the body is printed`() = runTest {
        val body = AndroidDeviceSignals(CountingFacts()).collect(both, "consent", 0)

        assert(ANDROID_ID !in body.toString()) { body.toString() }
    }

    /** A clean phone's probe (or an emulator's, by [hardware]) that records each read and its thread. */
    private class CountingProbe(private val hardware: String = "ex1000") : DeviceProbe {
        val reads = mutableListOf<String>()
        val threads = mutableSetOf<String>()

        private fun <T> read(name: String, value: T): T {
            reads += name
            threads += Thread.currentThread().name
            return value
        }

        override fun build(): BuildFields = read(
            "build",
            BuildFields("ex1000", "example", "ex1000", hardware, "Example", "EX-1000", "ex1000", "release-keys", "user"),
        )

        override fun hasTelephony(): Boolean = read("telephony", true)

        override fun fileExists(path: String): Boolean = read("files", false)

        override fun processMaps(): List<String> = read("maps", listOf("/system/lib64/libc.so"))

        override fun threadNames(): List<String> = read("threads", listOf("main"))

        override fun mounts(): List<String> = read("mounts", listOf("/dev/block/dm-0 / ext4 ro 0 0"))

        override fun classLoadable(name: String): Boolean = read("classes", false)

        override fun mainThreadStack(): List<String> = read("stack", listOf("android.os.Looper"))
    }

    @Test
    fun `session integrity sends the probes' codes beside the debugger facts (C210_2)`() = runTest {
        val body = AndroidDeviceSignals(CountingFacts(), probe = CountingProbe(hardware = "ranchu")).collect(integrityOnly, "consent", 0)

        assertEquals(
            AndroidIntegritySignals(
                debuggerConnected = false,
                appDebuggable = false,
                emulatorIndicators = listOf("build_hardware_goldfish_or_ranchu"),
                rootIndicators = emptyList(),
                hookingIndicators = emptyList(),
            ),
            body?.androidIntegrity,
        )
    }

    @Test
    fun `device recognition alone, or no tier, never runs a probe`() = runTest {
        val probe = CountingProbe()

        AndroidDeviceSignals(CountingFacts(), probe = probe).collect(recognitionOnly, "consent", 0)
        AndroidDeviceSignals(CountingFacts(), probe = probe).collect(neither, "consent", 0)

        assertEquals(emptyList<String>(), probe.reads)
    }

    @Test
    fun `the reads run on the dispatcher given, never the caller's thread`() = runTest {
        val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "integrity-probes") }
        try {
            val probe = CountingProbe()

            AndroidDeviceSignals(CountingFacts(), probe = probe, dispatcher = executor.asCoroutineDispatcher()).collect(integrityOnly, "consent", 0)

            assertEquals(setOf("integrity-probes"), probe.threads)
        } finally {
            executor.shutdown()
        }
    }

    @Test
    fun `the signals the activity builds run on the IO dispatcher by default`() = runTest {
        val probe = CountingProbe()

        AndroidDeviceSignals(CountingFacts(), probe = probe).collect(integrityOnly, "consent", 0)

        assertEquals(listOf("DefaultDispatcher-worker"), probe.threads.map { it.substringBeforeLast('-') }.distinct())
    }

    private companion object {
        /** A synthetic ANDROID_ID: 16 lowercase hex digits, never a real device's. */
        const val ANDROID_ID = "0f1e2d3c4b5a6978"
    }
}
