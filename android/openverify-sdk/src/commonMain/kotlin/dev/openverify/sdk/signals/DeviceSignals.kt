package dev.openverify.sdk.signals

import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals

/**
 * What the SDK reads about the device for signals (plan C94.7, ADR 0006), after consent and only
 * under the tiers the session reports ([FlowSessionSignals]). Declared here in `commonMain`; the
 * Android implementation is `AndroidDeviceSignals` (`androidMain`), and iOS has a placeholder that
 * reads nothing until Phase 10.
 *
 * [None] reads nothing and sends nothing, which the server reads as `collector_missing` for a
 * consented session (C90.3), never as a clean device.
 */
internal interface DeviceSignals {
    /**
     * The body to send for [screen] under [tiers], or `null` to send nothing. Called only after the
     * session may collect; it must not read anything a tier does not allow. It suspends (Workflow
     * 10B, C210.3): the device-integrity probes read files, so an implementation reads off the main thread.
     */
    public suspend fun collect(tiers: FlowSessionSignals, screen: String, sequence: Int): FlowSignals?

    public companion object {
        /** Reads nothing: the default until a host app gets the Android implementation. */
        public val None: DeviceSignals = object : DeviceSignals {
            override suspend fun collect(tiers: FlowSessionSignals, screen: String, sequence: Int): FlowSignals? = null
        }
    }
}
