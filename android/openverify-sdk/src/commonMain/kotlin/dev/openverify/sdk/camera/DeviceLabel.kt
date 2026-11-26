package dev.openverify.sdk.camera

/** The server's `DEVICE_LABEL_MAX_LENGTH`, in code points. */
internal const val DEVICE_LABEL_MAX_CODE_POINTS = 200

/**
 * Control and bidirectional-override characters, which the server's `sanitizeDeviceLabel` also
 * removes. The control range is `\p{Cc}` (U+0000 to U+001F and U+007F to U+009F) spelled out, so
 * every platform's regex engine reads it the same way.
 */
private val CONTROL_AND_BIDI = Regex("[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]")

/** A device label as the server keeps it (C40.4 `sanitizeDeviceLabel`), so nothing longer is sent. */
internal fun cleanDeviceLabel(label: String): String {
    val cleaned = label.replace(CONTROL_AND_BIDI, "")
    // Walks DEVICE_LABEL_MAX_CODE_POINTS code points: a surrogate pair is one, and so is an unpaired
    // surrogate, as String.codePointCount and the server's Array.from count them.
    var end = 0
    var codePoints = 0
    while (end < cleaned.length && codePoints < DEVICE_LABEL_MAX_CODE_POINTS) {
        val pair = cleaned[end].isHighSurrogate() && end + 1 < cleaned.length && cleaned[end + 1].isLowSurrogate()
        end += if (pair) 2 else 1
        codePoints++
    }
    return cleaned.substring(0, end)
}
