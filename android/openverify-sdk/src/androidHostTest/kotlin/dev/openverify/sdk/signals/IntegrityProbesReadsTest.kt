package dev.openverify.sdk.signals

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

/**
 * KP10-22 (C210.3; CI run 42762952128: the probes' cold run took 520 ms on the emulator): one
 * collection makes each read once, however many rules use it, and no result changes: every rule is
 * still answered, and a read that throws still records nothing for its own rules only. The lines of
 * `/proc` are split without a `Regex`, to the same fields.
 */
internal class IntegrityProbesReadsTest {

    /** A probe that counts each read; every indicator is present unless [failing] names the read. */
    private class CountingProbe(private val failing: Set<String> = emptySet()) : DeviceProbe {
        val reads = mutableMapOf<String, Int>()

        private fun <T> read(name: String, value: () -> T): T {
            reads[name] = (reads[name] ?: 0) + 1
            if (name.substringBefore(':') in failing) throw IllegalStateException("$name unreadable")
            return value()
        }

        override fun build(): BuildFields = read("build") {
            BuildFields(board = "goldfish_x86", brand = "generic", device = "generic_x86", hardware = "ranchu", model = "sdk_gphone64_x86_64", product = "sdk_gphone64_x86_64", tags = "test-keys", type = "eng")
        }

        override fun hasTelephony(): Boolean = read("telephony") { false }

        override fun fileExists(path: String): Boolean = read("file:$path") { path == IntegrityProbes.QEMU_FILES.last() || path == IntegrityProbes.SU_DIRECTORIES.last() + "su" }

        override fun processMaps(): List<String> = read("maps") { listOf("/system/lib64/libc.so", "/data/local/tmp/frida-agent-64.so") }

        override fun threadNames(): List<String> = read("threads") { listOf("main", "gum-js-loop") }

        override fun mounts(): List<String> = read("mounts") { listOf("/dev/block/dm-1 /system ext4 rw 0 0", "magisk /sbin tmpfs rw 0 0") }

        override fun classLoadable(name: String): Boolean = read("class:$name") { name.endsWith("XposedHelpers") }

        override fun mainThreadStack(): List<String> = read("stack") { listOf("android.os.Looper", "de.robv.android.xposed.XposedBridge") }
    }

    private val everything = IntegrityIndicators(AndroidSignalContract.EMULATOR_INDICATORS, AndroidSignalContract.ROOT_INDICATORS, AndroidSignalContract.HOOKING_INDICATORS)

    @Test
    fun `one collection makes each read once, and every rule is still answered`() {
        val probe = CountingProbe()

        val found = IntegrityProbes.collect(probe)

        assertEquals(everything, found)
        assertEquals(emptyMap<String, Int>(), probe.reads.filterValues { it > 1 }, "reads made more than once")
        // Every kind of read was made: nothing was skipped to save it.
        assertEquals(setOf("build", "telephony", "file", "maps", "threads", "mounts", "class", "stack"), probe.reads.keys.map { it.substringBefore(':') }.toSet())
        // Each fixed path and class is asked once (the last of each list is the one present, so a rule
        // that stops at its first hit asks them all): 8 QEMU paths and 13 `su` directories, 2 classes.
        assertEquals(IntegrityProbes.QEMU_FILES.size + IntegrityProbes.SU_DIRECTORIES.size, probe.reads.keys.count { it.startsWith("file:") })
        assertEquals(IntegrityProbes.XPOSED_CLASSES.size, probe.reads.keys.count { it.startsWith("class:") })
    }

    @Test
    fun `a second collection reads again, so nothing is kept between collections`() {
        val probe = CountingProbe()

        IntegrityProbes.collect(probe)
        IntegrityProbes.collect(probe)

        assertEquals(2, probe.reads["maps"])
        assertEquals(2, probe.reads["mounts"])
        assertEquals(2, probe.reads["build"])
    }

    @Test
    fun `a read that throws is tried once and records nothing for its own rules only`() {
        val probe = CountingProbe(failing = setOf("maps", "mounts"))

        val found = IntegrityProbes.collect(probe)

        assertEquals(1, probe.reads["maps"], "the maps are not read again for the second rule")
        assertEquals(1, probe.reads["mounts"], "the mounts are not read again for the second rule")
        assertEquals(AndroidSignalContract.EMULATOR_INDICATORS, found.emulator)
        assertEquals(listOf("su_binary_on_path", "build_tags_test_keys", "ro_debuggable_and_not_secure"), found.root)
        assertEquals(listOf("frida_thread_name", "xposed_bridge_loadable", "xposed_in_stack_trace"), found.hooking)
    }

    @Test
    fun `a family whose one shared read threw is still left out, never reported clean`() {
        val found = IntegrityProbes.collect(CountingProbe(failing = setOf("maps", "threads", "class", "stack")))

        assertNull(found.hooking)
    }

    /** `/proc/self/maps` lines: `address perms offset dev inode [path]`, the path maybe with spaces. */
    private val mapsLines = listOf(
        "70a4c000-70a4d000 r--p 00000000 fd:00 1234                               /apex/com.android.runtime/lib64/bionic/libc.so",
        "12c00000-32c00000 rw-p 00000000 00:00 0                                  [anon:dalvik-main space]",
        "7f0000000-7f0001000 r--p 00000000 00:00 0",
        "7f0000000-7f0001000 r--p 00000000 00:00 0 ",
        "7f1000000-7f1001000 r-xp 00000000 fd:00 9 /data/local/tmp/libexample.so (deleted)",
        "   7f1000000-7f1001000\tr-xp\t00000000\tfd:00\t9\t/data/app/~~x/com.example-y/base.apk  ",
        "7f1000000-7f1001000 r-xp 00000000 fd:00 9 /memfd:jit-cache (deleted)\r",
        "7f1000000-7f1001000 r-xp",
        "",
        "   ",
        "one",
        "a b c d e f g h",
    )

    @TestFactory
    fun `the mapped path is the sixth field to the line's end, as the Regex split gave it`(): List<DynamicTest> = mapsLines.map { line ->
        dynamicTest("\"$line\"") {
            val before = line.trim().split(Regex("\\s+"), 6).getOrNull(5)?.trim()
            assertEquals(before, ProcFields.rest(line, 5))
        }
    }

    private val mountLines = listOf(
        "/dev/block/dm-0 / ext4 ro,seclabel,relatime 0 0",
        "tmpfs /dev tmpfs rw,seclabel,nosuid,relatime 0 0",
        "  /dev/block/dm-1\t/system  ext4\trw,seclabel 0 0  ",
        "rootfs / rootfs",
        "rootfs / rootfs rw",
        "",
        "one",
    )

    @TestFactory
    fun `a mount line's first four fields are the Regex split's`(): List<DynamicTest> = mountLines.map { line ->
        dynamicTest("\"$line\"") {
            val before = line.trim().split(Regex("\\s+")).takeIf { it.size >= 4 }?.take(4)
            assertEquals(before, ProcFields.leading(line, 4))
        }
    }

    @Test
    fun `the rules that read lines hold no Regex`() {
        val main = java.io.File("src/androidMain/kotlin/dev/openverify/sdk/signals")
        val holders = listOf("DeviceProbe.kt", "IntegrityIndicators.kt", "ProcFields.kt").filter { name -> "Regex(" in java.io.File(main, name).readText() }

        assertTrue(holders.isEmpty(), "a Regex is compiled on the probes' first, timed run in: $holders")
    }
}
