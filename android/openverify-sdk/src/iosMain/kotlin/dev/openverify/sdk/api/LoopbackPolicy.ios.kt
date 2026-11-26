package dev.openverify.sdk.api

/**
 * iOS has no host app to run yet (next release): plain http is never allowed, so the placeholder
 * claims nothing (ADR 0004). `https` is unaffected.
 */
internal actual fun loopbackHttpAllowed(): Boolean = false
