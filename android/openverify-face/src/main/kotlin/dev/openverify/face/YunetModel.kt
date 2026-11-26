package dev.openverify.face

import android.content.res.AssetManager
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * The face-detection model this artifact ships (C205.3, decision 23): YuNet from OpenCV Zoo, MIT,
 * pinned in the repository's `models/manifest.json`. The build copies the fetched file into the AAR's
 * assets only after its digest matched that manifest, and [verifiedBytes] checks the same digest again
 * on the device before ONNX Runtime sees a byte, so a repackaged or damaged asset is never run.
 */
internal object YunetModel {
    /** The model's file name. */
    const val NAME: String = "face_detection_yunet_2026may.onnx"

    /** The SHA-256 of the model's bytes, as `models/manifest.json` pins it (a host test holds the two equal). */
    const val SHA256: String = "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0"

    /** Where the build puts the model among the AAR's assets. */
    const val ASSET: String = "openverify-face/$NAME"
}

/** The shipped model: the AAR's own asset. */
internal class AssetModelSource(private val assets: AssetManager) : ModelSource {
    override val name: String get() = YunetModel.NAME

    override val sha256: String get() = YunetModel.SHA256

    override fun open(): InputStream = assets.open(YunetModel.ASSET)
}

/**
 * The model's bytes, read whole and checked against [ModelSource.sha256]. Any other bytes, or a source
 * that cannot be read, are refused with a fixed message (C213.3): nothing of the failure is repeated.
 */
internal fun ModelSource.verifiedBytes(): ByteArray {
    val bytes = try {
        open().use { it.readBytes() }
    } catch (_: IOException) {
        FaceLog.log("face.model_unreadable")
        throw IllegalStateException("openverify-face: the model cannot be read")
    }
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { byte -> HEX[(byte.toInt() shr 4) and 0xF].toString() + HEX[byte.toInt() and 0xF] }
    if (digest != sha256) {
        FaceLog.log("face.model_digest_mismatch")
        throw IllegalStateException("openverify-face: the model does not have its pinned SHA-256")
    }
    return bytes
}

private const val HEX = "0123456789abcdef"
