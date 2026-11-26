package dev.openverify.sdk.signals

import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * C210.3, C210.6 (Workflow 10B; review F31): the device-integrity probes on a real Android image
 * (the build host has no emulator). Their rules are the host tests' ([IntegrityProbesTest]); this
 * checks the platform glue: the reads answer on a device, their total time fits a generous bound, and
 * the device reports what it is: an emulator names at least one emulator indicator, a phone names none.
 *
 * Which of the two the device is comes from the run, never from the probes under test: the
 * instrumentation argument `openverifyDeviceKind=emulator` (CI's emulator jobs pass it with
 * `-Pandroid.testInstrumentationRunnerArguments.openverifyDeviceKind=emulator`). Without it the device
 * is taken for a phone (a Pixel 9 on Android 17 was the first, 2026-11-10: 94.9 ms, no indicator).
 *
 * The bound is 500 ms, since a tight bound on a shared 2-vCPU emulator would be flaky and retries are
 * forbidden; the 50 ms target is reported (the log line `openverify-probes`), never asserted. The time
 * is the first, cold run of every probe, as a flow's one collection runs them.
 *
 * KP10-22 (CI run 42762952128: 520.0 ms): the same single cold run is also timed read by read, through
 * a wrapper around the probe that only reads the clock, and every line is logged before any assertion,
 * so a run over the bound still says where the time went. The SDK's own code gains no timing and no
 * log line.
 */
@RunWith(AndroidJUnit4::class)
class IntegrityProbesDeviceTest {

    /** [probe] with each read's calls and time counted; it changes no answer and keeps no value. */
    private class TimedProbe(private val probe: DeviceProbe) : DeviceProbe {
        val calls = linkedMapOf<String, Int>()
        val nanos = linkedMapOf<String, Long>()

        private inline fun <T> timed(name: String, read: () -> T): T {
            val started = SystemClock.elapsedRealtimeNanos()
            try {
                return read()
            } finally {
                nanos[name] = (nanos[name] ?: 0L) + SystemClock.elapsedRealtimeNanos() - started
                calls[name] = (calls[name] ?: 0) + 1
            }
        }

        override fun build(): BuildFields = timed("build") { probe.build() }

        override fun hasTelephony(): Boolean = timed("telephony") { probe.hasTelephony() }

        override fun fileExists(path: String): Boolean = timed("files") { probe.fileExists(path) }

        override fun processMaps(): List<String> = timed("maps") { probe.processMaps() }

        override fun threadNames(): List<String> = timed("threads") { probe.threadNames() }

        override fun mounts(): List<String> = timed("mounts") { probe.mounts() }

        override fun classLoadable(name: String): Boolean = timed("classes") { probe.classLoadable(name) }

        override fun mainThreadStack(): List<String> = timed("stack") { probe.mainThreadStack() }
    }

    @Test
    fun theProbesAnswerWithinTheBoundAndTheDeviceReportsWhatItIs() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val platform = ContextDeviceProbe(context)
        val probe = TimedProbe(platform)

        val started = SystemClock.elapsedRealtimeNanos()
        val found = IntegrityProbes.collect(probe)
        val elapsedMs = (SystemClock.elapsedRealtimeNanos() - started) / NANOS_A_MILLI

        // Every line before any assertion: a run over the bound still shows each read's share.
        Log.i(TAG, "probes total %.1f ms (bound %d ms, target %d ms)".format(elapsedMs, BOUND_MS, TARGET_MS))
        probe.nanos.forEach { (name, nanos) ->
            Log.i(TAG, "probes read %s: %.1f ms in %d call(s)".format(name, nanos / NANOS_A_MILLI, probe.calls.getValue(name)))
        }
        Log.i(TAG, "probes rules and first use, outside the reads: %.1f ms".format(elapsedMs - probe.nanos.values.sum() / NANOS_A_MILLI))
        Log.i(TAG, "probes sizes: %d mapped paths, %d threads, %d mounts".format(readSize { platform.processMaps() }, readSize { platform.threadNames() }, readSize { platform.mounts() }))

        assertTrue("the probes took %.1f ms, over the %d ms bound".format(elapsedMs, BOUND_MS), elapsedMs <= BOUND_MS)
        // Every family's reads answer on a device: none of them threw for all its rules.
        assertNotNull(found.emulator)
        assertNotNull(found.root)
        assertNotNull(found.hooking)
        // C210.6: an emulator's build fields say it is one, and a phone's say nothing of the kind.
        val kind = InstrumentationRegistry.getArguments().getString(DEVICE_KIND_ARGUMENT) ?: KIND_PHONE
        assertTrue("$DEVICE_KIND_ARGUMENT is '$kind'; it is '$KIND_EMULATOR' or absent", kind == KIND_EMULATOR || kind == KIND_PHONE)
        if (kind == KIND_EMULATOR) {
            assertTrue("the emulator reported no emulator indicator", found.emulator.orEmpty().isNotEmpty())
        } else {
            assertTrue(
                "a phone reported the emulator indicators ${found.emulator}; on an emulator pass " +
                    "-Pandroid.testInstrumentationRunnerArguments.$DEVICE_KIND_ARGUMENT=$KIND_EMULATOR",
                found.emulator.orEmpty().isEmpty(),
            )
        }
        // KP10-22: one collection read the maps, the mounts and the build fields once each.
        listOf("build", "maps", "mounts", "threads", "stack").forEach { name ->
            assertTrue("$name was read ${probe.calls[name]} times in one collection", (probe.calls[name] ?: 0) <= 1)
        }
    }

    /** How many entries a read gives, after the timed run and outside it; -1 when the platform refuses it. */
    private fun readSize(read: () -> List<String>): Int = try {
        read().size
    } catch (_: Exception) {
        -1
    }

    private companion object {
        const val TAG = "openverify-probes"
        const val BOUND_MS = 500
        const val TARGET_MS = 50
        const val NANOS_A_MILLI = 1_000_000.0
        const val DEVICE_KIND_ARGUMENT = "openverifyDeviceKind"
        const val KIND_EMULATOR = "emulator"
        const val KIND_PHONE = "phone"
    }
}
