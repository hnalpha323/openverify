package dev.openverify.demo.artifacts

import android.content.Context
import dev.openverify.sdk.face.FaceDetectorFactory

/**
 * The demo's hook for openverify-face in a build without it (C218.1, KP10-45): no face detector, so a
 * selfie keeps the manual shutter with the server's prompts (C204.6). The build compiles this file
 * only when `openverifyDemoArtifacts` leaves `face` out; with it,
 * `src/face/kotlin/.../FaceArtifact.kt` is compiled instead.
 */
internal object FaceArtifact {
    /** Always `null`: this build does not include openverify-face. */
    @Suppress("UNUSED_PARAMETER")
    fun faceDetectorFactory(context: Context): FaceDetectorFactory? = null
}
