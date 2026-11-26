package dev.openverify.sdk.signals

/**
 * The iOS placeholder of [DeviceSignals] (C94.7, ADR 0004). It reads nothing and sends nothing, so an
 * iOS session's signals read `collector_missing` on the server, never a clean device. The flow
 * signals contract has no iOS platform yet; iOS device facts, with DeviceCheck and App Attest, are
 * Phase 10's.
 */
internal val IosDeviceSignals: DeviceSignals = DeviceSignals.None
