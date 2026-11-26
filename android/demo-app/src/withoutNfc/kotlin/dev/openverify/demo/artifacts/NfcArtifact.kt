package dev.openverify.demo.artifacts

import android.content.Context
import dev.openverify.sdk.chip.ChipReader

/**
 * The demo's hook for openverify-nfc in a build without it (C218.1, KP10-45): no chip reader, so an
 * NFC step shows "this app cannot read document chips" and the author's fallback (C191.3). The build
 * compiles this file only when `openverifyDemoArtifacts` leaves `nfc` out; with it,
 * `src/nfc/kotlin/.../NfcArtifact.kt` is compiled instead.
 */
internal object NfcArtifact {
    /** Always `null`: this build does not include openverify-nfc. */
    @Suppress("UNUSED_PARAMETER")
    fun chipReader(context: Context): ChipReader? = null
}
