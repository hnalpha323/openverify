package dev.openverify.sdk.face

/**
 * Makes a [FaceDetector] for one selfie capture screen (C204.2); `openverify-face` implements it
 * with ONNX Runtime and YuNet. Without one, selfies keep the manual shutter (C204.6).
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(faceDetectorFactory = OpenVerifyFace.detectorFactory(context)))
 * ```
 */
public interface FaceDetectorFactory {
    public fun create(): FaceDetector
}

/**
 * Runs YuNet on one analysis frame and returns its raw outputs; the SDK decodes boxes and
 * landmarks in common code, so decoding is the same on every platform (C204.2). Frames are
 * analysed only on the selfie capture screen, after consent, and nothing is stored or sent
 * (C204.8). Closed with the screen.
 */
public interface FaceDetector : AutoCloseable {
    /** [input] is the letterboxed BGR planar tensor, [width] by [height] pixels. */
    public suspend fun detect(input: FloatArray, width: Int, height: Int): YunetOutputs
}

/**
 * YuNet's twelve output tensors, each flattened row-major as the web's `YunetOutputs` record names
 * them (`cls_8`, `obj_8`, `bbox_8`, `kps_8`, then strides 16 and 32;
 * `apps/flow/src/guidance/yunet-decode.ts`), so the common decoder and every detector agree on one
 * order (review F17).
 */
public class YunetOutputs(
    public val cls8: FloatArray,
    public val cls16: FloatArray,
    public val cls32: FloatArray,
    public val obj8: FloatArray,
    public val obj16: FloatArray,
    public val obj32: FloatArray,
    public val bbox8: FloatArray,
    public val bbox16: FloatArray,
    public val bbox32: FloatArray,
    public val kps8: FloatArray,
    public val kps16: FloatArray,
    public val kps32: FloatArray,
) {
    /** The tensor by its model name, such as `kps_32`; `null` for any other name. */
    public fun tensor(name: String): FloatArray? = when (name) {
        "cls_8" -> cls8
        "cls_16" -> cls16
        "cls_32" -> cls32
        "obj_8" -> obj8
        "obj_16" -> obj16
        "obj_32" -> obj32
        "bbox_8" -> bbox8
        "bbox_16" -> bbox16
        "bbox_32" -> bbox32
        "kps_8" -> kps8
        "kps_16" -> kps16
        "kps_32" -> kps32
        else -> null
    }

    public companion object {
        /** The twelve output names, heads by stride, in this class's constructor order. */
        public val NAMES: List<String> =
            listOf("cls", "obj", "bbox", "kps").flatMap { head -> listOf(8, 16, 32).map { "${head}_$it" } }
    }
}
