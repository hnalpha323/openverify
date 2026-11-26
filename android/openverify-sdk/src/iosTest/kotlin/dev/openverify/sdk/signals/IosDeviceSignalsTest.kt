package dev.openverify.sdk.signals

import dev.openverify.sdk.model.FlowSessionSignals
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertSame

/**
 * C94.7, C210.1 (Workflow 10B): the iOS placeholder reads nothing and sends nothing, the device-integrity
 * probes included; nothing is built for iOS in this release.
 */
class IosDeviceSignalsTest {

    @Test
    fun the_placeholder_sends_nothing_under_any_tier() = runTest {
        assertNull(IosDeviceSignals.collect(FlowSessionSignals(integrity = true, recognition = true), "consent", 0))
        // `None` also spares the coordinator its session read after consent.
        assertSame(DeviceSignals.None, IosDeviceSignals)
    }
}
