package dev.openverify.sdk.signals

/**
 * The indicator codes the device-integrity probes found (C210.2), by family, each in the contract's
 * order. A family is `null` when none of its rules ran to an answer (every read it needs threw), and
 * empty when they ran and found nothing. Empty is never "not rooted" or a pass: every probe runs inside
 * an environment the person may control (C210.6).
 */
internal data class IntegrityIndicators(
    val emulator: List<String>?,
    val root: List<String>?,
    val hooking: List<String>?,
)

/** One rule: the code it reports, and whether its reads find it. */
internal class IndicatorRule(val code: String, val found: (DeviceProbe) -> Boolean)

/**
 * C210.2, C210.3 (Workflow 10B): the emulator, root and hooking rules, each a pure function over a
 * [DeviceProbe]. Our own heuristics (decision 31; RootBeer 0.1.2 read as a reference only). Every
 * constant below is provisional, with its basis; none was tuned on a device's answer. A rule whose read
 * throws an [Exception] records nothing for itself, and the others still answer.
 */
internal object IntegrityProbes {

    /**
     * `ro.hardware` of the Android Emulator's virtual boards: `goldfish` (the QEMU1 board) and `ranchu`
     * (the QEMU2 board), AOSP `device/generic/goldfish`.
     */
    val EMULATOR_HARDWARE: Set<String> = setOf("goldfish", "ranchu")

    /** The SDK emulator products' and models' token (`sdk`, `google_sdk`, `sdk_gphone64_x86_64`, ...). */
    const val SDK_TOKEN: String = "sdk"

    /** Model texts of emulator images: the old SDK images' model and any model naming an emulator. */
    const val SDK_MODEL_PREFIX: String = "android sdk built for"
    const val EMULATOR_WORD: String = "emulator"

    /**
     * QEMU in the public build fields: a field naming QEMU, or AOSP's generic emulator product, whose
     * brand and device both start with `generic` (`generic_x86`, `generic_x86_64`). Only public `Build`
     * fields are read (C210.3); `ro.kernel.qemu` is not exposed by a public API.
     */
    const val QEMU_WORD: String = "qemu"
    const val GENERIC_PREFIX: String = "generic"

    /** The emulator's QEMU pipes, its `qemud` socket, trace device and property service (AOSP goldfish). */
    val QEMU_FILES: List<String> = listOf(
        "/dev/qemu_pipe",
        "/dev/goldfish_pipe",
        "/dev/socket/qemud",
        "/sys/qemu_trace",
        "/system/bin/qemu-props",
        "/vendor/bin/qemu-props",
        "/system/lib/libc_malloc_debug_qemu.so",
        "/system/lib64/libc_malloc_debug_qemu.so",
    )

    /** Boards of emulator images: `unknown`, `generic*` and `goldfish*`. */
    val GENERIC_BOARDS: Set<String> = setOf("unknown", "generic")
    val GENERIC_BOARD_PREFIXES: List<String> = listOf("generic", "goldfish")

    /** Where root tools put an `su` binary: the system's binary directories and the usual root-tool ones. */
    val SU_DIRECTORIES: List<String> = listOf(
        "/system/bin/",
        "/system/xbin/",
        "/system/sbin/",
        "/sbin/",
        "/su/bin/",
        "/system/bin/failsafe/",
        "/system/sd/xbin/",
        "/data/local/",
        "/data/local/bin/",
        "/data/local/xbin/",
        "/vendor/bin/",
        "/product/bin/",
        "/debug_ramdisk/",
    )

    /** A build signed with the platform's test keys (`ro.build.tags`), as a self-built or rooted image is. */
    const val TEST_KEYS: String = "test-keys"

    /**
     * The system partition's mount points: `/system`, `/system_root`, and `/` on system-as-root devices
     * (Android 10 and later), where a read-write mount from a block device means the system was
     * remounted. A RAM-backed root (`rootfs`, `tmpfs`) is not the system partition.
     */
    val SYSTEM_MOUNT_POINTS: Set<String> = setOf("/system", "/system_root", "/")
    val RAM_FILESYSTEMS: Set<String> = setOf("rootfs", "tmpfs", "ramfs")

    /** Magisk's mounts, and modules mounted from `/data/adb/modules` (which KernelSU shares). */
    val MAGISK_MOUNT_MARKERS: List<String> = listOf("magisk", "/data/adb/modules")

    /**
     * `ro.debuggable=1` with `ro.secure=0` is what an `eng` build sets (AOSP `build/make/core/main.mk`);
     * only `Build.TYPE` (`ro.build.type`) is public, so the rule reads it.
     */
    const val ENG_BUILD: String = "eng"

    /** Frida's agent and gadget libraries and its server's directory, in the process's maps. */
    val FRIDA_MAP_MARKERS: List<String> = listOf("frida-agent", "frida-gadget", "libfrida", "re.frida.server")

    /** Frida's JavaScript thread and its pools, by thread name. */
    val FRIDA_THREAD_MARKERS: List<String> = listOf("gum-js-loop", "frida")

    /** Xposed's bridge classes, loadable in a hooked app's class loader. */
    val XPOSED_CLASSES: List<String> = listOf("de.robv.android.xposed.XposedBridge", "de.robv.android.xposed.XposedHelpers")

    /** The hooking frameworks' packages, on the main thread's stack. */
    val HOOK_STACK_PREFIXES: List<String> = listOf("de.robv.android.xposed.", "com.saurik.substrate.", "org.lsposed.", "io.github.lsposed.")

    /**
     * Native libraries no app or system library is mapped from: the root tools' directories, and the
     * injection frameworks' libraries (Riru, LSPosed's `lspd`, Cydia Substrate, Zygisk) wherever they are.
     */
    val UNEXPECTED_LIBRARY_DIRECTORIES: List<String> = listOf("/data/local/", "/data/adb/", "/debug_ramdisk/", "/sbin/")
    val UNEXPECTED_LIBRARY_NAMES: List<String> = listOf("riru", "lspd", "substrate", "zygisk", "xposed")

    val EMULATOR: List<IndicatorRule> = listOf(
        IndicatorRule("build_hardware_goldfish_or_ranchu") { it.build().hardware.lowercase() in EMULATOR_HARDWARE },
        IndicatorRule("build_product_sdk") { SDK_TOKEN in tokens(it.build().product) },
        IndicatorRule("build_model_emulator") { probe ->
            val model = probe.build().model.lowercase()
            EMULATOR_WORD in model || model.startsWith(SDK_MODEL_PREFIX) || SDK_TOKEN in tokens(model)
        },
        IndicatorRule("qemu_property") { probe ->
            val build = probe.build()
            listOf(build.board, build.brand, build.device, build.hardware, build.manufacturer, build.model, build.product)
                .any { QEMU_WORD in it.lowercase() } ||
                (build.brand.lowercase().startsWith(GENERIC_PREFIX) && build.device.lowercase().startsWith(GENERIC_PREFIX))
        },
        IndicatorRule("qemu_device_file") { probe -> QEMU_FILES.any(probe::fileExists) },
        IndicatorRule("no_telephony_and_generic_board") { probe ->
            val board = probe.build().board.lowercase()
            val generic = board in GENERIC_BOARDS || GENERIC_BOARD_PREFIXES.any(board::startsWith)
            generic && !probe.hasTelephony()
        },
    )

    val ROOT: List<IndicatorRule> = listOf(
        IndicatorRule("su_binary_on_path") { probe -> SU_DIRECTORIES.any { probe.fileExists(it + "su") } },
        IndicatorRule("build_tags_test_keys") { TEST_KEYS in it.build().tags },
        IndicatorRule("system_mounted_rw") { probe -> probe.mounts().any(::systemMountedReadWrite) },
        IndicatorRule("magisk_mount_trace") { probe -> probe.mounts().any { line -> containsAny(line, MAGISK_MOUNT_MARKERS) } },
        IndicatorRule("ro_debuggable_and_not_secure") { it.build().type == ENG_BUILD },
    )

    val HOOKING: List<IndicatorRule> = listOf(
        IndicatorRule("frida_in_process_maps") { probe -> probe.processMaps().any { path -> containsAny(path, FRIDA_MAP_MARKERS) } },
        IndicatorRule("frida_thread_name") { probe -> probe.threadNames().any { name -> containsAny(name, FRIDA_THREAD_MARKERS) } },
        IndicatorRule("xposed_bridge_loadable") { probe -> XPOSED_CLASSES.any(probe::classLoadable) },
        IndicatorRule("xposed_in_stack_trace") { probe -> probe.mainThreadStack().any { name -> HOOK_STACK_PREFIXES.any(name::startsWith) } },
        IndicatorRule("unexpected_native_library") { probe -> probe.processMaps().any(::unexpectedLibrary) },
    )

    /**
     * Runs every rule over [probe], once each, and gives each family's codes in the contract's order.
     * KP10-22: each read is made at most once in a collection, however many rules use it (the build
     * fields seven, the maps and the mounts two each), and nothing is kept for the next collection.
     */
    fun collect(probe: DeviceProbe): IntegrityIndicators {
        val reads = OncePerCollection(probe)
        return IntegrityIndicators(family(EMULATOR, reads), family(ROOT, reads), family(HOOKING, reads))
    }

    private fun family(rules: List<IndicatorRule>, probe: DeviceProbe): List<String>? {
        var answered = false
        val found = rules.filter { rule ->
            val result = try {
                rule.found(probe)
            } catch (_: Exception) {
                // A read the platform refused, or a file that is not there: this rule records nothing.
                null
            }
            if (result != null) answered = true
            result == true
        }.map { it.code }
        return if (answered) found else null
    }

    /** A name's tokens, split where the build system joins words (`sdk_gphone64_x86_64`). */
    private fun tokens(text: String): List<String> = text.lowercase().split('_', '-', ' ')

    /** `<device> <mount point> <type> <options> ...`: a system mount point, read-write, not in RAM. */
    private fun systemMountedReadWrite(line: String): Boolean {
        val (_, mountPoint, type, options) = ProcFields.leading(line, MOUNT_FIELDS) ?: return false
        return mountPoint in SYSTEM_MOUNT_POINTS && type !in RAM_FILESYSTEMS && "rw" in options.split(',')
    }

    /** A mapped native library (`.so`, maybe `(deleted)`) from a root tool's directory or an injection framework. */
    private fun unexpectedLibrary(path: String): Boolean {
        val lower = path.lowercase()
        val library = lower.endsWith(".so") || ".so " in lower
        if (!library) return false
        val name = lower.substringBefore(".so").substringAfterLast('/')
        return UNEXPECTED_LIBRARY_DIRECTORIES.any(lower::startsWith) || UNEXPECTED_LIBRARY_NAMES.any { it in name }
    }

    /** Whether [text], in any case, holds one of the lower-case [markers]; lowered once for all of them. */
    private fun containsAny(text: String, markers: List<String>): Boolean {
        val lower = text.lowercase()
        return markers.any { it in lower }
    }

    /** `<device> <mount point> <type> <options>`: the fields of a mount line the rules read. */
    private const val MOUNT_FIELDS = 4
}

/**
 * KP10-22 (C210.3): [probe]'s reads for one collection, each made at most once: the first call reads,
 * and a later one gets the same answer, or the same exception when the read threw, so a read that the
 * platform refused still records nothing for each rule that needs it and is not tried again. An
 * `Error` is never kept: it propagates from the first call (C210.3). Not shared between threads or
 * collections: [IntegrityProbes.collect] makes one and drops it.
 */
private class OncePerCollection(private val probe: DeviceProbe) : DeviceProbe {
    /** One read's outcome: its value, or the exception it threw. */
    private class Outcome<T>(val value: T?, val failure: Exception?)

    private val whole = HashMap<String, Outcome<*>>()
    private val files = HashMap<String, Outcome<Boolean>>()
    private val classes = HashMap<String, Outcome<Boolean>>()

    private fun <T> outcome(read: () -> T): Outcome<T> = try {
        Outcome(read(), null)
    } catch (failure: Exception) {
        Outcome(null, failure)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> Outcome<*>.get(): T {
        failure?.let { throw it }
        return value as T
    }

    private fun <T> once(name: String, read: () -> T): T = whole.getOrPut(name) { outcome(read) }.get()

    override fun build(): BuildFields = once("build", probe::build)

    override fun hasTelephony(): Boolean = once("telephony", probe::hasTelephony)

    override fun fileExists(path: String): Boolean = files.getOrPut(path) { outcome { probe.fileExists(path) } }.get()

    override fun processMaps(): List<String> = once("maps", probe::processMaps)

    override fun threadNames(): List<String> = once("threads", probe::threadNames)

    override fun mounts(): List<String> = once("mounts", probe::mounts)

    override fun classLoadable(name: String): Boolean = classes.getOrPut(name) { outcome { probe.classLoadable(name) } }.get()

    override fun mainThreadStack(): List<String> = once("stack", probe::mainThreadStack)
}
