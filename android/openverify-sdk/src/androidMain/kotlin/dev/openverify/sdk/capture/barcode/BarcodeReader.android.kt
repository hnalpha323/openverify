package dev.openverify.sdk.capture.barcode

/** C203.2: zxing-cpp on Android, one reader per guidance; its native library loads on the first read. */
internal actual fun platformBarcodeReader(): BarcodeReader? = ZxingCppBarcodeReader()
