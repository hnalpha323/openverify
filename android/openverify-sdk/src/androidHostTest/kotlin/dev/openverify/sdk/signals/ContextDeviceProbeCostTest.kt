package dev.openverify.sdk.signals

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.testing.CpuCost
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * KP10-22 (C210.3; rule 6: thread CPU time, never the wall clock, held against a reference
 * workload measured beside it, [CpuCost]): the cost of one collection through
 * [ContextDeviceProbe] over a large synthetic process: 24,000 mapped regions of 3,000 files, 300
 * threads and 400 mounts, several times what an app process holds, so the reads of `/proc` dominate as
 * they did in the 520 ms run on the CI emulator. A regression guard for the host; the device's own
 * time is the device test's (`IntegrityProbesDeviceTest`).
 */
@RunWith(RobolectricTestRunner::class)
class ContextDeviceProbeCostTest {

    @get:Rule
    val folder = TemporaryFolder()

    private val context: Context = ApplicationProvider.getApplicationContext()

    /** A clean, large process under [root]; no indicator anywhere, so every rule reads to the end. */
    private fun writeLargeProc(root: File) {
        File(root, "proc/self").mkdirs()
        File(root, "proc/self/maps").bufferedWriter().use { out ->
            repeat(MAPPED_FILES) { file ->
                repeat(REGIONS_A_FILE) { region ->
                    val start = 0x7000_0000L + (file * REGIONS_A_FILE + region) * 0x1000L
                    val perms = if (region % 2 == 0) "r--p" else "r-xp"
                    out.write("%x-%x %s %08x fd:00 %d".format(start, start + 0x1000, perms, region * 0x1000, 1000 + file).padEnd(73))
                    out.write("/data/app/~~synthetic/com.example-app/lib/arm64/libexample_module_$file.so\n")
                }
                // An unnamed region between files, as a real process has.
                out.write("%x-%x rw-p 00000000 00:00 0\n".format(0x1000_0000L + file * 0x1000L, 0x1000_1000L + file * 0x1000L))
            }
        }
        repeat(THREADS) { index ->
            File(root, "proc/self/task/${1000 + index}").mkdirs()
            File(root, "proc/self/task/${1000 + index}/comm").writeText("pool-$index-thread\n")
        }
        File(root, "proc/mounts").bufferedWriter().use { out ->
            out.write("/dev/block/dm-0 / ext4 ro,seclabel,relatime 0 0\n")
            repeat(MOUNTS - 1) { index -> out.write("/dev/block/dm-${index + 1} /apex/com.example.module$index ext4 ro,dirsync,seclabel,nodev,noatime 0 0\n") }
        }
    }

    @Test
    fun `one collection over a large process stays inside its CPU budget`() {
        assertTrue(CpuCost.supported)
        val root = folder.newFolder("device")
        writeLargeProc(root)
        val probe = ContextDeviceProbe(context, root)
        assertEquals("every mapped file is read, once", MAPPED_FILES, probe.processMaps().size)
        assertEquals(THREADS, probe.threadNames().size)
        assertEquals(MOUNTS, probe.mounts().size)

        val cold = CpuCost.millis { IntegrityProbes.collect(probe) }
        val cost = CpuCost.relative(RUNS, WARM_UPS) { assertEquals(IntegrityIndicators(emptyList(), emptyList(), emptyList()), IntegrityProbes.collect(probe)) }

        println(
            "probes over $MAPPED_FILES files in ${MAPPED_FILES * (REGIONS_A_FILE + 1)} regions, $THREADS threads, $MOUNTS mounts: cold %.1f ms, median of $RUNS %.1f ms CPU, %.2f times the reference's %.1f ms (budget $BUDGET times)"
                .format(cold, cost.millis, cost.ratio, cost.referenceMillis),
        )
        assertTrue("one collection took %.2f times the reference workload, over the budget of %.1f".format(cost.ratio, BUDGET), cost.ratio <= BUDGET)
    }

    private companion object {
        const val MAPPED_FILES = 3_000
        const val REGIONS_A_FILE = 7
        const val THREADS = 300
        const val MOUNTS = 400
        const val WARM_UPS = 3
        const val RUNS = 9


        /**
         * Provisional, in units of [CpuCost.reference] (24 to 28 ms on a quiet host). While the
         * collection scanned the maps and the mounts twice with a `Regex` split per line it took
         * 69.6 ms of CPU here, about 2.8 times the reference; with one pass each and no `Regex`,
         * 22.1 to 24.7 ms, 0.88 times (0.90 beside 36 busy loops, where the milliseconds doubled). The
         * budget is twice the second figure and under two thirds of the first, so a return to two
         * passes fails: `docs/tdd/phase10-carry-10c.tdd.md`, `phase10-integration-10c.tdd.md`.
         */
        const val BUDGET = 1.8
    }
}
