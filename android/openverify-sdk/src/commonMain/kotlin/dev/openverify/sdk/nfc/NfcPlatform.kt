package dev.openverify.sdk.nfc

/** C207.12: what the phone offers for reading a document chip. */
internal enum class NfcAvailability {
    /** NFC hardware is present and on. */
    READY,

    /** NFC hardware is present and off. */
    DISABLED,

    /** The device has no NFC hardware. */
    NO_HARDWARE,
}

/**
 * C207.12 (review F16; ours): what the phone offers, read by the NFC screens before any chip read.
 * Whether a reader is installed is the registry's (`OpenVerifyComponents.chipReader`, C191), not
 * this seam's. Internal, so outside the ABI dump. Platform code makes it (the Android actual takes
 * a `Context`); common code only receives it.
 */
internal expect class NfcPlatform {
    /** Whether the device has NFC and whether it is on; reads need no permission. */
    fun availability(): NfcAvailability

    /** Opens the system's NFC settings, where the platform has them. */
    fun openSettings()
}
