package dev.openverify.demo.artifacts

import android.content.Context
import dev.openverify.face.OpenVerifyFace
import dev.openverify.sdk.face.FaceDetectorFactory

/**
 * The demo's hook for openverify-face in a build that includes it (C218.1, KP10-45): the artifact's
 * face detector factory, made from the application's context. The build compiles this file only when
 * `openverifyDemoArtifacts` includes `face`; otherwise `src/withoutFace/kotlin/.../FaceArtifact.kt`
 * answers `null`. face-onnx owns this file.
 */
internal object FaceArtifact {
    /** The face detector factory the demo installs. */
    fun faceDetectorFactory(context: Context): FaceDetectorFactory? = OpenVerifyFace.detectorFactory(context)
}
