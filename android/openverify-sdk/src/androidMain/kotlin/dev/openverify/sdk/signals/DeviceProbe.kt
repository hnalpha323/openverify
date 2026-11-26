package dev.openverify.sdk.signals

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Looper
import java.io.IOException
import java.io.File

/**
 * The public `android.os.Build` fields the emulator and root rules read (C210.3). `Build.FINGERPRINT`
 * is never read: the platform says not to parse it (C210.2). Each field is the platform's value, or an
 * empty string when the platform gives none.
 */
internal data class BuildFields(
    val board: String = "",
    val brand: String = "",
    val device: String = "",
    val hardware: String = "",
    val manufacturer: String = "",
    val model: String = "",
    val product: String = "",
    val tags: String = "",
    val type: String = "",
)

/**
 * Everything the device-integrity rules read (C210.3, Workflow 10B), so each rule is a pure function
 * over this probe and a host test runs every rule over a fake. Only these reads exist: the public
 * `Build` fields, whether the device has telephony, whether a fixed path exists, the paths mapped
 * into this process, this process's thread names, the mount table, whether a named class can be
 * loaded (never initialised), and the class names on the main thread's stack. Nothing here reads
 * other apps, settings, hardware identifiers or the network (C210.2, decision 31).
 */
internal interface DeviceProbe {
    fun build(): BuildFields

    /** `PackageManager.hasSystemFeature(FEATURE_TELEPHONY)`; never `TelephonyManager`. */
    fun hasTelephony(): Boolean

    fun fileExists(path: String): Boolean

    /** The distinct path names mapped into this process (`/proc/self/maps`' last column). */
    fun processMaps(): List<String>

    /** This process's thread names (`/proc/self/task/<tid>/comm`). */
    fun threadNames(): List<String>

    /** The mount table's lines (`/proc/mounts`). */
    fun mounts(): List<String>

    /** Whether the app's class loader can load [name], without initialising it. */
    fun classLoadable(name: String): Boolean

    /** The class names of the main thread's stack frames. */
    fun mainThreadStack(): List<String>
}

/**
 * [DeviceProbe] over the platform, through the host app's [context] and its class loader. Every path is
 * read under [root]: the device's own file system, except in host tests, which give a temporary one.
 * A read the platform refuses throws, so its rules record nothing (C210.3); none is retried.
 */
internal class ContextDeviceProbe(private val context: Context, private val root: File = File("/")) : DeviceProbe {

    override fun build(): BuildFields = BuildFields(
        board = Build.BOARD.orEmpty(),
        brand = Build.BRAND.orEmpty(),
        device = Build.DEVICE.orEmpty(),
        hardware = Build.HARDWARE.orEmpty(),
        manufacturer = Build.MANUFACTURER.orEmpty(),
        model = Build.MODEL.orEmpty(),
        product = Build.PRODUCT.orEmpty(),
        tags = Build.TAGS.orEmpty(),
        type = Build.TYPE.orEmpty(),
    )

    override fun hasTelephony(): Boolean = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)

    override fun fileExists(path: String): Boolean = file(path).exists()

    override fun processMaps(): List<String> =
        // `address perms offset dev inode [path]`: only the path is kept, once, so nothing about the
        // layout of this process is held, and an unnamed region is skipped. KP10-22: one pass, no
        // `Regex`; a file's regions follow each other, so most lines repeat the path before them.
        file("/proc/self/maps").useLines { lines ->
            val paths = LinkedHashSet<String>()
            var last: String? = null
            for (line in lines) {
                val path = ProcFields.rest(line, MAPS_FIELDS - 1) ?: continue
                if (path != last) {
                    paths += path
                    last = path
                }
            }
            paths.toList()
        }

    override fun threadNames(): List<String> {
        val tasks = file("/proc/self/task").listFiles() ?: throw IOException("no task directory")
        return tasks.mapNotNull { task -> File(task, "comm").takeIf { it.isFile }?.readText()?.trim() }
    }

    override fun mounts(): List<String> = file("/proc/mounts").readLines()

    override fun classLoadable(name: String): Boolean = try {
        // Never initialised (review P22): a probed class's static initialiser does not run.
        Class.forName(name, false, context.classLoader)
        true
    } catch (_: ClassNotFoundException) {
        false
    } catch (_: LinkageError) {
        false
    }

    override fun mainThreadStack(): List<String> = Looper.getMainLooper().thread.stackTrace.map { it.className }

    private fun file(path: String): File = File(root, path.removePrefix("/"))

    private companion object {
        /** `/proc/self/maps` has five fields before the path, which may itself hold spaces. */
        const val MAPS_FIELDS = 6
    }
}
