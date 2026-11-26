package dev.openverify.sdk.signals

import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.FlowSignals
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C210.2 (Workflow 10B): `android-integrity`'s three indicator lists are closed, each code once, at
 * most `ANDROID_INDICATORS_MAX`; a body outside that is refused before it leaves the device, by member
 * name only.
 */
class IndicatorContractTest {

    private fun body(emulator: List<String>? = null, root: List<String>? = null, hooking: List<String>? = null) = FlowSignals(
        collectorVersion = 1,
        screen = "consent",
        sequence = 0,
        androidIntegrity = AndroidIntegritySignals(false, false, emulator, root, hooking),
    )

    @Test
    fun absentEmptyAndListedCodesAreWithinTheContract() {
        assertEquals(emptyList(), AndroidSignalContract.problems(body()))
        assertEquals(emptyList(), AndroidSignalContract.problems(body(emptyList(), emptyList(), emptyList())))
        assertEquals(
            emptyList(),
            AndroidSignalContract.problems(
                body(AndroidSignalContract.EMULATOR_INDICATORS, AndroidSignalContract.ROOT_INDICATORS, AndroidSignalContract.HOOKING_INDICATORS),
            ),
        )
    }

    @Test
    fun aCodeOfAnotherFamilyOrNoFamilyIsOutsideTheContract() {
        assertEquals(listOf("android-integrity"), AndroidSignalContract.problems(body(emulator = listOf("su_binary_on_path"))))
        assertEquals(listOf("android-integrity"), AndroidSignalContract.problems(body(root = listOf("not_a_code"))))
        assertEquals(listOf("android-integrity"), AndroidSignalContract.problems(body(hooking = listOf("build_product_sdk"))))
    }

    @Test
    fun aRepeatedCodeIsOutsideTheContract() {
        assertEquals(listOf("android-integrity"), AndroidSignalContract.problems(body(root = listOf("build_tags_test_keys", "build_tags_test_keys"))))
    }

    @Test
    fun moreCodesThanTheBoundAreOutsideTheContract() {
        val tooMany = List(AndroidSignalContract.INDICATORS_MAX + 1) { "frida_thread_name" }

        assertEquals(listOf("android-integrity"), AndroidSignalContract.problems(body(hooking = tooMany)))
    }
}
