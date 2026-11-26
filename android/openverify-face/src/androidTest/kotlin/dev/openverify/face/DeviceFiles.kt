package dev.openverify.face

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.nio.ByteBuffer
import java.security.MessageDigest

/** What the device tests read from their own APK's assets (the build's `copyFaceFixture`) and how they decode an image. */
internal object DeviceFiles {
    private const val DIRECTORY = "openverify-face-test"

    fun asset(context: Context, name: String): ByteArray = context.assets.open("$DIRECTORY/$name").use { it.readBytes() }

    fun drawnFace(context: Context): DrawnFaceVectors = DrawnFaceVectors(String(asset(context, "yunet-decode.json")))

    fun faceFrame(context: Context): FaceFrameVectors = FaceFrameVectors(String(asset(context, "yunet-face-frame-vectors.json")))

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** An image's pixels as an upright frame, four bytes a pixel in R, G, B, A order: the platform's own decoder, full size. */
    fun frame(image: ByteArray): ReferenceFrame {
        val options = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inScaled = false
        }
        val bitmap = BitmapFactory.decodeByteArray(image, 0, image.size, options) ?: error("the image did not decode")
        try {
            check(bitmap.config == Bitmap.Config.ARGB_8888) { "the image decoded to another pixel layout" }
            // ARGB_8888's bytes in memory are R, G, B, A.
            val rgba = ByteArray(bitmap.width * bitmap.height * 4)
            bitmap.copyPixelsToBuffer(ByteBuffer.wrap(rgba))
            return ReferenceFrame(bitmap.width, bitmap.height, 0, rgba)
        } finally {
            bitmap.recycle()
        }
    }

    /** The drawn synthetic face as the detector's input. */
    fun drawnTensor(vectors: DrawnFaceVectors): ReferenceTensor = YunetReference.tensor(frame(vectors.png))
}
