package dev.openverify.sdk.signals

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowBuild
import org.robolectric.util.ReflectionHelpers
import java.io.File

/** A synthetic clean phone's `Build` fields, set through Robolectric's shadow. */
private fun shadowCleanPhone() {
    ShadowBuild.setBoard("ex1000")
    ShadowBuild.setBrand("example")
    ReflectionHelpers.setStaticField(Build::class.java, "DEVICE", "ex1000")
    ShadowBuild.setHardware("ex1000")
    ShadowBuild.setManufacturer("Example")
    ShadowBuild.setModel("EX-1000")
    ShadowBuild.setProduct("ex1000")
    ShadowBuild.setTags("release-keys")
    ShadowBuild.setType("user")
}

/** A fake file system for the probe: a clean phone's `/proc`, under [root]. */
private fun writeCleanProc(root: File) {
    File(root, "proc/self").mkdirs()
    File(root, "proc/self/maps").writeText(
        """
        70a4c000-70a4d000 r--p 00000000 fd:00 1234                               /apex/com.android.runtime/lib64/bionic/libc.so
        70a4d000-70a4e000 r-xp 00001000 fd:00 1234                               /apex/com.android.runtime/lib64/bionic/libc.so
        12c00000-32c00000 rw-p 00000000 00:00 0                                  [anon:dalvik-main space]
        7f0000000-7f0001000 r--p 00000000 00:00 0
        """.trimIndent() + "\n",
    )
    listOf("main", "RenderThread").forEachIndexed { index, name ->
        File(root, "proc/self/task/${index + 100}").mkdirs()
        File(root, "proc/self/task/${index + 100}/comm").writeText("$name\n")
    }
    File(root, "proc/mounts").writeText(
        """
        /dev/block/dm-0 / ext4 ro,seclabel,relatime 0 0
        tmpfs /dev tmpfs rw,seclabel,nosuid,relatime 0 0
        /dev/block/dm-5 /data f2fs rw,lazytime,seclabel 0 0
        """.trimIndent() + "\n",
    )
}

/** Set by [ThrowingProbeTarget]'s initialiser, so a test sees whether it ran. */
internal object ProbeTargetState {
    @JvmField var initialised: Boolean = false
}

/** A class whose initialiser throws (review P22): loading it must never initialise it. */
internal class ThrowingProbeTarget {
    companion object {
        init {
            ProbeTargetState.initialised = true
            throw IllegalStateException("a probed class was initialised")
        }
    }
}

/**
 * C210.3 (Workflow 10B): [ContextDeviceProbe]'s platform reads under Robolectric: the shadowed `Build`
 * fields, the telephony feature, and a fake file system rooted in a temporary folder.
 */
@RunWith(RobolectricTestRunner::class)
class ContextDeviceProbeTest {

    @get:Rule
    val folder = TemporaryFolder()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private lateinit var root: File

    @Before
    fun cleanPhone() {
        shadowCleanPhone()
        root = folder.newFolder("device")
        writeCleanProc(root)
    }

    @After
    fun resetBuild() = ShadowBuild.reset()

    private fun probe() = ContextDeviceProbe(context, root)

    @Test
    fun `the Build fields are the platform's public ones`() {
        ShadowBuild.setHardware("ranchu")
        ShadowBuild.setTags("test-keys")
        ShadowBuild.setType("eng")

        assertEquals(
            BuildFields(board = "ex1000", brand = "example", device = "ex1000", hardware = "ranchu", manufacturer = "Example", model = "EX-1000", product = "ex1000", tags = "test-keys", type = "eng"),
            probe().build(),
        )
    }

    @Test
    fun `telephony is the package manager's system feature`() {
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, true)
        assertTrue(probe().hasTelephony())

        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, false)
        assertFalse(probe().hasTelephony())
    }

    @Test
    fun `a path exists only under the probe's root`() {
        File(root, "dev").mkdirs()
        File(root, "dev/qemu_pipe").writeText("")

        assertTrue(probe().fileExists("/dev/qemu_pipe"))
        assertFalse(probe().fileExists("/system/xbin/su"))
    }

    @Test
    fun `the maps give each mapped path once, and anonymous regions only by name`() {
        assertEquals(listOf("/apex/com.android.runtime/lib64/bionic/libc.so", "[anon:dalvik-main space]"), probe().processMaps())
    }

    @Test
    fun `the thread names are each task's comm`() {
        assertEquals(setOf("main", "RenderThread"), probe().threadNames().toSet())
        assertEquals(2, probe().threadNames().size)
    }

    @Test
    fun `the mounts are the mount table's lines`() {
        assertEquals(3, probe().mounts().size)
        assertEquals("/dev/block/dm-0 / ext4 ro,seclabel,relatime 0 0", probe().mounts().first())
    }

    @Test
    fun `a missing proc file is a failed read, never a clean answer`() {
        File(root, "proc/self/maps").delete()

        assertThrows(Exception::class.java) { probe().processMaps() }
    }

    @Test
    fun `a class is loaded through the app's class loader and never initialised`() {
        val name = ThrowingProbeTarget::class.java.name

        assertTrue(probe().classLoadable(name))
        assertFalse(ProbeTargetState.initialised)
        assertFalse(probe().classLoadable("dev.openverify.sdk.signals.NoSuchProbeTarget"))
        // Initialising it really does run the throwing initialiser, so the probe above did not.
        assertThrows(ExceptionInInitializerError::class.java) { Class.forName(name, true, context.classLoader) }
        assertTrue(ProbeTargetState.initialised)
    }

    @Test
    fun `the main thread's stack is read by class name`() {
        assertTrue(probe().mainThreadStack().contains(ContextDeviceProbeTest::class.java.name))
    }

    @Test
    fun `the default root is the device's own file system`() {
        val real = folder.newFile("present")

        assertTrue(ContextDeviceProbe(context).fileExists(real.absolutePath))
        assertFalse(ContextDeviceProbe(context).fileExists(real.absolutePath + ".absent"))
    }
}

/**
 * C210.3: every rule whose reads are the platform's runs here through [ContextDeviceProbe], with
 * Robolectric's shadowed `Build` fields and a fake file system, and reports its code. The two class
 * rules (`xposed_bridge_loadable`, `xposed_in_stack_trace`) are run over a fake probe in
 * [IntegrityProbesTest]; their platform reads are [ContextDeviceProbeTest]'s.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
class ContextDeviceProbeRulesTest(private val code: String, private val arrange: (File, Context) -> Unit) {

    @get:Rule
    val folder = TemporaryFolder()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @After
    fun resetBuild() = ShadowBuild.reset()

    @Test
    fun `the rule reports its code through the platform probe`() {
        shadowCleanPhone()
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, true)
        val root = folder.newFolder("device")
        writeCleanProc(root)
        val clean = IntegrityProbes.collect(ContextDeviceProbe(context, root))
        assertEquals(IntegrityIndicators(emptyList(), emptyList(), emptyList()), clean)

        arrange(root, context)
        val found = IntegrityProbes.collect(ContextDeviceProbe(context, root))

        assertEquals(listOf(code), found.emulator.orEmpty() + found.root.orEmpty() + found.hooking.orEmpty())
    }

    companion object {
        private fun File.write(path: String, text: String = "") = File(this, path).apply { parentFile.mkdirs() }.writeText(text)

        private fun File.append(path: String, line: String) = File(this, path).appendText("$line\n")

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf<Pair<String, (File, Context) -> Unit>>(
            "build_hardware_goldfish_or_ranchu" to { _, _ -> ShadowBuild.setHardware("ranchu") },
            "build_product_sdk" to { _, _ -> ShadowBuild.setProduct("sdk_phone64_x86_64") },
            "build_model_emulator" to { _, _ -> ShadowBuild.setModel("Android SDK built for x86_64") },
            "qemu_property" to { _, _ ->
                ShadowBuild.setBrand("generic")
                ReflectionHelpers.setStaticField(Build::class.java, "DEVICE", "generic_x86_64")
            },
            "qemu_device_file" to { root, _ -> root.write("dev/goldfish_pipe") },
            "no_telephony_and_generic_board" to { _, context ->
                ShadowBuild.setBoard("unknown")
                shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, false)
            },
            "su_binary_on_path" to { root, _ -> root.write("system/bin/su") },
            "build_tags_test_keys" to { _, _ -> ShadowBuild.setTags("dev-keys,test-keys") },
            "system_mounted_rw" to { root, _ -> root.append("proc/mounts", "/dev/block/dm-1 /system ext4 rw,seclabel 0 0") },
            "magisk_mount_trace" to { root, _ -> root.append("proc/mounts", "magisk /sbin tmpfs ro,seclabel 0 0") },
            "ro_debuggable_and_not_secure" to { _, _ -> ShadowBuild.setType("eng") },
            "frida_in_process_maps" to { root, _ ->
                root.append("proc/self/maps", "7f1000000-7f1001000 r-xp 00000000 fd:00 9 /data/app/~~x/com.example-y/lib/x86_64/libfrida-gadget.so")
            },
            "frida_thread_name" to { root, _ -> root.write("proc/self/task/300/comm", "gum-js-loop\n") },
            "unexpected_native_library" to { root, _ ->
                root.append("proc/self/maps", "7f2000000-7f2001000 r-xp 00000000 fd:00 9 /data/adb/modules/example/lib/libexample.so")
            },
        ).map { (code, arrange) -> arrayOf(code, arrange) }
    }
}
