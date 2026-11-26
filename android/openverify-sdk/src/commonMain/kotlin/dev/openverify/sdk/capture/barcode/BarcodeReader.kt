package dev.openverify.sdk.capture.barcode

import dev.openverify.sdk.camera.AnalysisFrame

/**
 * C203.2 (Workflow 10B): reads a PDF417 in an analysis frame for guidance only. The raw bytes, since
 * AAMVA's control characters matter for the header check; the caller drops them at once and never
 * uploads or logs them (C203.3). Null when nothing decodes. zxing-cpp implements it on Android
 * (pdf417-guidance, `androidMain/.../capture/barcode/`); iOS has none in this release.
 */
internal interface BarcodeReader {
    suspend fun readPdf417(frame: AnalysisFrame): ByteArray?
}

/** The platform's reader, or null where the SDK has none (iOS; and Android until pdf417-guidance fills it). */
internal expect fun platformBarcodeReader(): BarcodeReader?
