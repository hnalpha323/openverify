package dev.openverify.demo.artifacts

import android.content.Context
import dev.openverify.nfc.OpenVerifyNfc
import dev.openverify.sdk.chip.ChipReader

/**
 * The demo's hook for openverify-nfc in a build that includes it (C218.1, KP10-45): the artifact's
 * chip reader, made from the application's context. The build compiles this file only when
 * `openverifyDemoArtifacts` includes `nfc`; otherwise `src/withoutNfc/kotlin/.../NfcArtifact.kt`
 * answers `null`. nfc-reader owns this file.
 */
internal object NfcArtifact {
    /** The chip reader the demo installs. */
    fun chipReader(context: Context): ChipReader? = OpenVerifyNfc.chipReader(context)
}
