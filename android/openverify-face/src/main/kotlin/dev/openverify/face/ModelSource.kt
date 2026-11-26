package dev.openverify.face

import java.io.InputStream

/**
 * Where the face-detection model's bytes come from, and the digest they must have (C204.2, C205.3;
 * review V11). An internal type of this module: the SDK's seam (`FaceDetectorFactory`,
 * `FaceDetector`, `YunetOutputs`) knows nothing of a model file, so the model and its SHA-256 are
 * this module's concern alone.
 *
 * The shipped source is the AAR's own asset, copied at build time from the file
 * `scripts/fetch_models.py --only face_detection_yunet` fetched, after its digest was checked against
 * `models/manifest.json`; a test's source reads that fetched file directly. Whoever opens a source
 * checks the bytes against [sha256] before giving them to ONNX Runtime, and refuses any other bytes.
 */
internal interface ModelSource {
    /** The model's file name, such as `face_detection_yunet_2026may.onnx`. A constant, never a path. */
    val name: String

    /** The SHA-256 the model's bytes must have: 64 lower-case hexadecimal characters. */
    val sha256: String

    /** Opens the model's bytes. The caller closes the stream. */
    fun open(): InputStream
}
