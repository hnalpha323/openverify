package dev.openverify.sdk.capture.barcode

import zxingcpp.BarcodeReader as ZxingReader

/**
 * C203.2: zxing-cpp's options for the PDF417 hint: PDF417 only, its raw bytes (AAMVA's control
 * characters matter, so no HRI or escaped text), any orientation and downscaled passes, one symbol, no
 * failed reads. They are the options the host calibration decodes with
 * (`services/vision/tests/test_android_pdf417_assets.py`, `android_read`), so its result holds here.
 */
internal fun pdf417Options(): ZxingReader.Options = ZxingReader.Options().apply {
    formats = setOf(ZxingReader.Format.PDF_417)
    textMode = ZxingReader.TextMode.PLAIN
    tryHarder = true
    tryRotate = true
    tryDownscale = true
    tryInvert = false
    isPure = false
    binarizer = ZxingReader.Binarizer.LOCAL_AVERAGE
    maxNumberOfSymbols = 1
    returnErrors = false
}

/**
 * C203.2: the raw bytes of the first PDF417 among [results] that decoded without an error and holds
 * something. It is the decoder's own array, not a copy, so when the guidance wipes it (C203.3) no other
 * copy of the bytes is left in the result.
 */
internal fun firstPdf417(results: List<ZxingReader.Result>): ByteArray? = results.firstOrNull {
    it.format == ZxingReader.Format.PDF_417 &&
        (it.error == null || it.error?.type == ZxingReader.ErrorType.NONE) &&
        it.bytes?.isNotEmpty() == true
}?.bytes
