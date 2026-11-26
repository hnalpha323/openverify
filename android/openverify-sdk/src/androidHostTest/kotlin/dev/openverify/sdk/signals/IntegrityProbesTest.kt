package dev.openverify.sdk.signals

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertThrows

/**
 * C210.2, C210.3 (Workflow 10B): every device-integrity rule is a pure function over a [DeviceProbe],
 * so each one is run here over a fake: the reads that make it report its code, and near misses that
 * must not. The values are synthetic; nothing here reads the host.
 */
internal class IntegrityProbesTest {

    /** A clean phone, as each rule's reads see it. Each field can be replaced, or made to throw. */
    private data class FakeProbe(
        val build: BuildFields = PHONE,
        val telephony: Boolean = true,
        val files: Set<String> = emptySet(),
        val maps: List<String> = PHONE_MAPS,
        val threads: List<String> = listOf("main", "RenderThread", "OkHttp Dispatch"),
        val mountLines: List<String> = PHONE_MOUNTS,
        val classes: Set<String> = emptySet(),
        val stack: List<String> = PHONE_STACK,
        val failing: Set<String> = emptySet(),
    ) : DeviceProbe {
        private fun <T> read(name: String, value: T): T = if (name in failing) throw IllegalStateException("$name unreadable") else value

        override fun build(): BuildFields = read("build", build)

        override fun hasTelephony(): Boolean = read("telephony", telephony)

        override fun fileExists(path: String): Boolean = read("files", path in files)

        override fun processMaps(): List<String> = read("maps", maps)

        override fun threadNames(): List<String> = read("threads", threads)

        override fun mounts(): List<String> = read("mounts", mountLines)

        override fun classLoadable(name: String): Boolean = read("classes", name in classes)

        override fun mainThreadStack(): List<String> = read("stack", stack)
    }

    /** One rule's case: the probe and the codes each family must report. */
    private class Case(val name: String, val probe: FakeProbe, val emulator: List<String> = emptyList(), val root: List<String> = emptyList(), val hooking: List<String> = emptyList())

    private val reporting = listOf(
        Case("ro.hardware goldfish", FakeProbe(build = PHONE.copy(hardware = "goldfish")), emulator = listOf("build_hardware_goldfish_or_ranchu")),
        Case("ro.hardware ranchu, in any case", FakeProbe(build = PHONE.copy(hardware = "Ranchu")), emulator = listOf("build_hardware_goldfish_or_ranchu")),
        Case("an SDK product", FakeProbe(build = PHONE.copy(product = "sdk_phone64_x86_64")), emulator = listOf("build_product_sdk")),
        Case("the google_sdk product", FakeProbe(build = PHONE.copy(product = "google_sdk")), emulator = listOf("build_product_sdk")),
        Case("an emulator model", FakeProbe(build = PHONE.copy(model = "Android SDK built for x86")), emulator = listOf("build_model_emulator")),
        Case("a model naming the emulator", FakeProbe(build = PHONE.copy(model = "Example Emulator")), emulator = listOf("build_model_emulator")),
        Case("an SDK model", FakeProbe(build = PHONE.copy(model = "sdk_gphone64_x86_64")), emulator = listOf("build_model_emulator")),
        Case("a build field naming QEMU", FakeProbe(build = PHONE.copy(board = "qemu_x86")), emulator = listOf("qemu_property")),
        Case("the generic product's brand and device", FakeProbe(build = PHONE.copy(brand = "generic_x86", device = "generic_x86")), emulator = listOf("qemu_property")),
        Case("the QEMU pipe device", FakeProbe(files = setOf("/dev/qemu_pipe")), emulator = listOf("qemu_device_file")),
        Case("the qemud socket", FakeProbe(files = setOf("/dev/socket/qemud")), emulator = listOf("qemu_device_file")),
        Case("no telephony on a goldfish board", FakeProbe(telephony = false, build = PHONE.copy(board = "goldfish_x86_64")), emulator = listOf("no_telephony_and_generic_board")),
        Case("no telephony on an unknown board", FakeProbe(telephony = false, build = PHONE.copy(board = "unknown")), emulator = listOf("no_telephony_and_generic_board")),
        Case("su in /system/xbin", FakeProbe(files = setOf("/system/xbin/su")), root = listOf("su_binary_on_path")),
        Case("su in /sbin", FakeProbe(files = setOf("/sbin/su")), root = listOf("su_binary_on_path")),
        Case("test-keys", FakeProbe(build = PHONE.copy(tags = "test-keys")), root = listOf("build_tags_test_keys")),
        Case("/system mounted read-write", FakeProbe(mountLines = PHONE_MOUNTS + "/dev/block/dm-1 /system ext4 rw,seclabel,relatime 0 0"), root = listOf("system_mounted_rw")),
        Case("the root mounted read-write from a block device", FakeProbe(mountLines = listOf("/dev/block/dm-0 / ext4 rw,seclabel,relatime 0 0")), root = listOf("system_mounted_rw")),
        Case("a Magisk mount", FakeProbe(mountLines = PHONE_MOUNTS + "magisk /system/bin tmpfs ro,seclabel,relatime 0 0"), root = listOf("magisk_mount_trace")),
        Case("a module mounted from /data/adb/modules", FakeProbe(mountLines = PHONE_MOUNTS + "/data/adb/modules/example/system/etc/hosts /system/etc/hosts ext4 ro 0 0"), root = listOf("magisk_mount_trace")),
        Case("an eng build", FakeProbe(build = PHONE.copy(type = "eng")), root = listOf("ro_debuggable_and_not_secure")),
        Case("a Frida agent mapped", FakeProbe(maps = PHONE_MAPS + "/data/local/tmp/re.frida.server/frida-agent-64.so"), hooking = listOf("frida_in_process_maps", "unexpected_native_library")),
        Case("a Frida gadget in the app's own libraries", FakeProbe(maps = PHONE_MAPS + "/data/app/~~x/com.example-y/lib/arm64/libfrida-gadget.so"), hooking = listOf("frida_in_process_maps")),
        Case("Frida's JavaScript thread", FakeProbe(threads = listOf("main", "gum-js-loop")), hooking = listOf("frida_thread_name")),
        Case("a Frida pool thread", FakeProbe(threads = listOf("main", "pool-frida")), hooking = listOf("frida_thread_name")),
        Case("the Xposed bridge loadable", FakeProbe(classes = setOf("de.robv.android.xposed.XposedBridge")), hooking = listOf("xposed_bridge_loadable")),
        Case("Xposed's helpers loadable", FakeProbe(classes = setOf("de.robv.android.xposed.XposedHelpers")), hooking = listOf("xposed_bridge_loadable")),
        Case("Xposed on the main thread's stack", FakeProbe(stack = PHONE_STACK + "de.robv.android.xposed.XposedBridge"), hooking = listOf("xposed_in_stack_trace")),
        Case("Substrate on the main thread's stack", FakeProbe(stack = PHONE_STACK + "com.saurik.substrate.MS\$2"), hooking = listOf("xposed_in_stack_trace")),
        Case("a library loaded from /data/adb", FakeProbe(maps = PHONE_MAPS + "/data/adb/modules/example/lib/libexample.so"), hooking = listOf("unexpected_native_library")),
        Case("a Riru library", FakeProbe(maps = PHONE_MAPS + "/system/lib64/libriru_example.so"), hooking = listOf("unexpected_native_library")),
        Case("a library mapped from a deleted file under /data/local", FakeProbe(maps = PHONE_MAPS + "/data/local/tmp/libexample.so (deleted)"), hooking = listOf("unexpected_native_library")),
    )

    private val nearMisses = listOf(
        Case("a hardware name that only contains goldfish", FakeProbe(build = PHONE.copy(hardware = "goldfishbay"))),
        Case("a product with sdk inside a word", FakeProbe(build = PHONE.copy(product = "ex1000sdkx"))),
        Case("a board without telephony that is not generic", FakeProbe(telephony = false)),
        Case("a generic board with telephony", FakeProbe(build = PHONE.copy(board = "generic"))),
        Case("a generic brand on another device", FakeProbe(build = PHONE.copy(brand = "generic"))),
        Case("su outside the fixed directories", FakeProbe(files = setOf("/data/data/com.example/su"))),
        Case("release-keys", FakeProbe(build = PHONE.copy(tags = "release-keys"))),
        Case("a userdebug build", FakeProbe(build = PHONE.copy(type = "userdebug"))),
        Case("/data mounted read-write", FakeProbe(mountLines = PHONE_MOUNTS + "/dev/block/dm-5 /data f2fs rw,lazytime 0 0")),
        Case("a ramdisk root mounted read-write", FakeProbe(mountLines = listOf("rootfs / rootfs rw,seclabel 0 0"))),
        Case("relatime is not rw", FakeProbe(mountLines = listOf("/dev/block/dm-1 /system ext4 ro,relatime,rwx 0 0"))),
        Case("ART's JIT cache in memory", FakeProbe(maps = PHONE_MAPS + "/memfd:jit-cache (deleted)")),
        Case("an ordinary thread name", FakeProbe(threads = listOf("main", "Firebase-pool", "binder:123_2"))),
        Case("an unrelated class on the stack", FakeProbe(stack = PHONE_STACK + "com.example.xposedviewer.MainActivity")),
    )

    @Test
    fun `a clean phone reports every family empty, never absent`() {
        assertEquals(IntegrityIndicators(emptyList(), emptyList(), emptyList()), IntegrityProbes.collect(FakeProbe()))
    }

    @TestFactory
    fun `each rule reports its code from its reads`(): List<DynamicTest> = reporting.map { case ->
        dynamicTest(case.name) {
            assertEquals(IntegrityIndicators(case.emulator, case.root, case.hooking), IntegrityProbes.collect(case.probe))
        }
    }

    @TestFactory
    fun `near misses report nothing`(): List<DynamicTest> = nearMisses.map { case ->
        dynamicTest(case.name) {
            assertEquals(IntegrityIndicators(emptyList(), emptyList(), emptyList()), IntegrityProbes.collect(case.probe))
        }
    }

    @Test
    fun `every code of the contract has a rule that reports it`() {
        val reported = reporting.flatMap { it.emulator + it.root + it.hooking }.toSet()

        assertEquals(
            (AndroidSignalContract.EMULATOR_INDICATORS + AndroidSignalContract.ROOT_INDICATORS + AndroidSignalContract.HOOKING_INDICATORS).toSet(),
            reported,
        )
    }

    @Test
    fun `codes come in the contract's order, each once, however many reads find them`() {
        val everything = FakeProbe(
            build = BuildFields(board = "goldfish_x86", brand = "generic", device = "generic_x86", hardware = "ranchu", model = "sdk_gphone64_x86_64", product = "sdk_gphone64_x86_64", tags = "test-keys", type = "eng"),
            telephony = false,
            files = setOf("/dev/qemu_pipe", "/dev/goldfish_pipe", "/system/xbin/su", "/system/bin/su"),
            maps = PHONE_MAPS + listOf("/data/local/tmp/frida-agent-64.so", "/data/adb/lspd/liblspd.so"),
            threads = listOf("gum-js-loop", "pool-frida", "main"),
            mountLines = listOf("/dev/block/dm-1 /system ext4 rw 0 0", "magisk /sbin tmpfs rw 0 0"),
            classes = setOf("de.robv.android.xposed.XposedBridge", "de.robv.android.xposed.XposedHelpers"),
            stack = PHONE_STACK + "de.robv.android.xposed.XposedBridge",
        )

        assertEquals(
            IntegrityIndicators(AndroidSignalContract.EMULATOR_INDICATORS, AndroidSignalContract.ROOT_INDICATORS, AndroidSignalContract.HOOKING_INDICATORS),
            IntegrityProbes.collect(everything),
        )
    }

    @Test
    fun `a read that throws records nothing for its rules, and the other rules still answer`() {
        val probe = FakeProbe(build = PHONE.copy(hardware = "ranchu", tags = "test-keys"), files = setOf("/dev/qemu_pipe", "/sbin/su"), threads = listOf("gum-js-loop"), failing = setOf("files", "maps"))

        assertEquals(
            IntegrityIndicators(listOf("build_hardware_goldfish_or_ranchu"), listOf("build_tags_test_keys"), listOf("frida_thread_name")),
            IntegrityProbes.collect(probe),
        )
    }

    @Test
    fun `a family whose every rule threw is left out, never reported clean`() {
        val hooking = IntegrityProbes.collect(FakeProbe(failing = setOf("maps", "threads", "classes", "stack")))
        val everything = IntegrityProbes.collect(FakeProbe(failing = setOf("build", "telephony", "files", "maps", "threads", "mounts", "classes", "stack")))

        assertEquals(IntegrityIndicators(emptyList(), emptyList(), null), hooking)
        assertNull(everything.emulator)
        assertNull(everything.root)
        assertNull(everything.hooking)
    }

    @Test
    fun `an Error is not swallowed as a missing read`() {
        val probe = object : DeviceProbe by FakeProbe() {
            override fun threadNames(): List<String> = throw OutOfMemoryError("synthetic")
        }

        assertThrows<OutOfMemoryError> { IntegrityProbes.collect(probe) }
    }

    @Test
    fun `each list fits the contract's bound`() {
        listOf(AndroidSignalContract.EMULATOR_INDICATORS, AndroidSignalContract.ROOT_INDICATORS, AndroidSignalContract.HOOKING_INDICATORS).forEach { codes ->
            assertTrue(codes.size <= AndroidSignalContract.INDICATORS_MAX, codes.toString())
        }
    }

    private companion object {
        /** A synthetic phone; no real device's values. */
        val PHONE = BuildFields(
            board = "ex1000",
            brand = "example",
            device = "ex1000",
            hardware = "ex1000",
            manufacturer = "Example",
            model = "EX-1000",
            product = "ex1000",
            tags = "release-keys",
            type = "user",
        )

        val PHONE_MAPS = listOf(
            "/apex/com.android.runtime/lib64/bionic/libc.so",
            "/system/lib64/libandroid_runtime.so",
            "/vendor/lib64/libexample_gpu.so",
            "/data/app/~~x/com.example-y/base.apk",
            "/data/app/~~x/com.example-y/lib/arm64/libexample.so",
            "[anon:dalvik-main space]",
            "/memfd:jit-zygote-cache (deleted)",
        )

        val PHONE_MOUNTS = listOf(
            "/dev/block/dm-0 / ext4 ro,seclabel,relatime 0 0",
            "tmpfs /dev tmpfs rw,seclabel,nosuid,relatime 0 0",
            "/dev/block/dm-5 /data f2fs rw,lazytime,seclabel 0 0",
            "/dev/block/dm-2 /vendor ext4 ro,seclabel,relatime 0 0",
        )

        val PHONE_STACK = listOf("android.os.MessageQueue", "android.os.Looper", "android.app.ActivityThread", "com.android.internal.os.ZygoteInit")
    }
}
