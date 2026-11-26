package dev.openverify.sdk.signals

import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.FlowSignals

/**
 * The bounds of the Android signal body (`@openverify/contracts` `flowSignalsSchema`, C94.2, C94.7),
 * checked by the client before a body leaves the device. `AndroidSignalContractTest` reads each value
 * from the TypeScript sources, so a change there fails the SDK's tests.
 */
internal object AndroidSignalContract {
    /** `@openverify/core` `COLLECTOR_VERSION` (C90.1, H24): the version this body was frozen with. */
    const val COLLECTOR_VERSION: Int = 1

    /** The one platform the SDK sends; the contract also has `web`, which only the browser sends. */
    const val PLATFORM: String = "android"

    /** `ANDROID_DEVICE_CLASSES`: an SDK session's `device-type` (C94.5). */
    val DEVICE_CLASSES: List<String> = listOf("smartphone", "tablet")

    /** `SANDBOX_SIGNAL_OUTCOMES` (C90.9): sandbox environments only. */
    val SANDBOX_OUTCOMES: List<String> = listOf("bot", "human")

    /** `collector-version`'s bounds. */
    val COLLECTOR_VERSIONS: IntRange = 1..1000

    /** `sequence`'s bounds. */
    val SEQUENCES: IntRange = 0..1_000_000

    /** `screen`: a flow-spec step id (`stepIdSchema`). */
    val SCREEN: Regex = Regex("[a-z][a-z0-9_-]{0,63}")

    /** `android-id`: `Settings.Secure.ANDROID_ID`, 64 bits in lower-case hex. */
    val ANDROID_ID: Regex = Regex("[0-9a-f]{1,16}")

    /**
     * The names of [signals]' members outside the contract, in wire order; empty when it may be sent.
     * Names only: a value, such as the ANDROID_ID, is personal data and never appears here.
     */
    fun problems(signals: FlowSignals): List<String> = buildList {
        if (signals.platform != PLATFORM) add("platform")
        if (signals.collectorVersion !in COLLECTOR_VERSIONS) add("collector-version")
        if (!SCREEN.matches(signals.screen)) add("screen")
        if (signals.sequence !in SEQUENCES) add("sequence")
        if (signals.androidIntegrity?.let(::indicatorsWithin) == false) add("android-integrity")
        if (signals.androidRecognition?.let { ANDROID_ID.matches(it.androidId) } == false) add("android-recognition")
        if (signals.deviceClass?.let { it in DEVICE_CLASSES } == false) add("device-class")
        if (signals.sandboxOutcome?.let { it in SANDBOX_OUTCOMES } == false) add("sandbox-outcome")
    }

    /** C210.2 (Workflow 10B): `ANDROID_EMULATOR_INDICATORS` of `packages/contracts/src/flow-signals.ts`. */
    val EMULATOR_INDICATORS: List<String> = listOf(
        "build_hardware_goldfish_or_ranchu", "build_product_sdk", "build_model_emulator",
        "qemu_property", "qemu_device_file", "no_telephony_and_generic_board",
    )

    /** C210.2: `ANDROID_ROOT_INDICATORS`. */
    val ROOT_INDICATORS: List<String> = listOf(
        "su_binary_on_path", "build_tags_test_keys", "system_mounted_rw", "magisk_mount_trace", "ro_debuggable_and_not_secure",
    )

    /** C210.2: `ANDROID_HOOKING_INDICATORS`. */
    val HOOKING_INDICATORS: List<String> = listOf(
        "frida_in_process_maps", "frida_thread_name", "xposed_bridge_loadable", "xposed_in_stack_trace", "unexpected_native_library",
    )

    /** C210.2: `ANDROID_INDICATORS_MAX`, codes a list. */
    const val INDICATORS_MAX: Int = 12

    /** C210.2: each present list holds only its family's codes, each once, at most [INDICATORS_MAX]. */
    private fun indicatorsWithin(integrity: AndroidIntegritySignals): Boolean =
        listWithin(integrity.emulatorIndicators, EMULATOR_INDICATORS) &&
            listWithin(integrity.rootIndicators, ROOT_INDICATORS) &&
            listWithin(integrity.hookingIndicators, HOOKING_INDICATORS)

    private fun listWithin(codes: List<String>?, family: List<String>): Boolean =
        codes == null || (codes.size <= INDICATORS_MAX && codes.toSet().size == codes.size && family.containsAll(codes))
}
