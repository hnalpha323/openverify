package dev.openverify.sdk.capture.barcode

/** No reader on iOS in this release (C203.2: the next release's Apple Vision); it claims nothing. */
internal actual fun platformBarcodeReader(): BarcodeReader? = null
