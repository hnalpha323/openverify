package dev.openverify.face

import android.content.Context
import dev.openverify.sdk.face.FaceDetectorFactory

/**
 * The entry point of `openverify-face`: the face detector a host installs so that a selfie step can
 * guide the person and take each photo when the pose is held (C204.3, C205).
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(faceDetectorFactory = OpenVerifyFace.detectorFactory(context)))
 * ```
 *
 * The detector runs the YuNet model with ONNX Runtime on the device, on the selfie capture screen
 * only. It is guidance, never a liveness verdict: the server decides (C204.7). Nothing it computes is
 * stored or sent (C204.8).
 */
public object OpenVerifyFace {
    @Volatile
    private var factory: FaceDetectorFactory? = null

    /**
     * A [FaceDetectorFactory] for the host app of [context]. Only the application context's assets
     * are kept, so any context may be passed and the factory may be installed once, when the process
     * starts; every call returns the same factory. Nothing of ONNX Runtime is loaded here: its native
     * library loads when the SDK first asks the factory for a detector, on a selfie capture screen.
     */
    public fun detectorFactory(context: Context): FaceDetectorFactory {
        FaceLog.attach(context)
        return factory ?: synchronized(this) {
            factory ?: OrtFaceDetectorFactory(AssetModelSource(context.applicationContext.assets), OrtEnvironments.process).also { factory = it }
        }
    }
}
