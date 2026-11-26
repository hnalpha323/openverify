package dev.openverify.sdk.nfc

/**
 * C207.12 (rule 17): nothing is built for iOS in this release, so the iOS actual reports
 * [NfcAvailability.NO_HARDWARE] and claims nothing.
 */
internal actual class NfcPlatform {
    actual fun availability(): NfcAvailability = NfcAvailability.NO_HARDWARE

    actual fun openSettings() {}
}
