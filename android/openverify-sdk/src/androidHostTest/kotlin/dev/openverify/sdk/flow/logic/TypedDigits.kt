package dev.openverify.sdk.flow.logic

/**
 * What a keyboard that writes Arabic-Indic (U+0660 to U+0669) or Persian (U+06F0 to U+06F9) digits
 * puts in a field (C196.3): [text] with each ASCII digit replaced, everything else as it is.
 */
internal object TypedDigits {
    fun arabicIndic(text: String): String = shifted(text, 0x0660)

    fun persian(text: String): String = shifted(text, 0x06F0)

    private fun shifted(text: String, zero: Int): String =
        text.map { if (it in '0'..'9') (zero + (it - '0')).toChar() else it }.joinToString("")
}
