package dev.openverify.sdk.ui

/** A 2 x 3 pixel red PNG (RGBA, 74 bytes), written by hand, for the preview decoding tests. */
internal val TWO_BY_THREE_PNG: ByteArray =
    (
        "89504E470D0A1A0A0000000D4948445200000002000000030806000000B9EADE81" +
            "000000114944415478DA63F8CFC0F01F8419301800A1790BF5302B05190000000049454E44AE426082"
        ).chunked(2).map { it.toInt(16).toByte() }.toByteArray()
