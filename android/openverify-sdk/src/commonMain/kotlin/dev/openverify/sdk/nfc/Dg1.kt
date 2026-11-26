package dev.openverify.sdk.nfc

/**
 * What DG1's MRZ says, shown on the review screen for the person to confirm before anything is
 * uploaded (C207.5; behaviour M20). Personal data: in memory only, never printed.
 */
internal data class Dg1Details(
    /** The primary identifier, then the secondary one, as the MRZ spells them. */
    val name: String,
    val documentNumber: String,
    /** The MRZ's three-letter nationality code. */
    val nationality: String,
    /** YYMMDD, as the MRZ holds it. */
    val birthDate: String,
    /** YYMMDD, as the MRZ holds it. */
    val expiryDate: String,
) {
    override fun toString(): String = "Dg1Details(<redacted>)"
}

/**
 * C207.2 (the review): DG1 parsed in common code (ICAO Doc 9303 Part 10 §4.7.1: tag `61` holding
 * tag `5F1F`, the MRZ of a TD1, TD2 or TD3 document; the field positions are Parts 4, 5 and 6's).
 * It reads what the chip says and judges nothing: check digits and the binding to the photographed
 * MRZ are the server's (C207.11). Anything that is not such a file is `null`, never an exception.
 */
internal object Dg1 {
    private const val TD1_LENGTH = 90
    private const val TD2_LENGTH = 72
    private const val TD3_LENGTH = 88
    private const val FILLER = '<'

    /** The MRZ's details, or `null` when [bytes] are not a DG1 this SDK can show. */
    fun parse(bytes: ByteArray): Dg1Details? {
        val content = value(bytes, 0, intArrayOf(0x61)) ?: return null
        val mrz = value(bytes, content.first, intArrayOf(0x5F, 0x1F), content.last + 1) ?: return null
        val text = CharArray(mrz.last - mrz.first + 1) { index ->
            val character = bytes[mrz.first + index].toInt().toChar()
            if (character !in 'A'..'Z' && character !in '0'..'9' && character != FILLER) return null
            character
        }.concatToString()
        return when (text.length) {
            TD1_LENGTH -> Dg1Details(
                name = name(text.substring(60, 90)),
                documentNumber = td1Number(text),
                nationality = code(text.substring(45, 48)),
                birthDate = text.substring(30, 36),
                expiryDate = text.substring(38, 44),
            )
            TD2_LENGTH -> Dg1Details(
                name = name(text.substring(5, 36)),
                documentNumber = code(text.substring(36, 45)),
                nationality = code(text.substring(46, 49)),
                birthDate = text.substring(49, 55),
                expiryDate = text.substring(57, 63),
            )
            TD3_LENGTH -> Dg1Details(
                name = name(text.substring(5, 44)),
                documentNumber = code(text.substring(44, 53)),
                nationality = code(text.substring(54, 57)),
                birthDate = text.substring(57, 63),
                expiryDate = text.substring(65, 71),
            )
            else -> null
        }
    }

    /**
     * The value of the data object with [tag] that starts at [at], as the range of its bytes, or
     * `null` when the tag is another, the length is not a short or one- or two-byte long form, or the
     * value runs past [end].
     */
    private fun value(bytes: ByteArray, at: Int, tag: IntArray, end: Int = bytes.size): IntRange? {
        var index = at
        for (part in tag) {
            if (index >= end || (bytes[index].toInt() and 0xFF) != part) return null
            index += 1
        }
        if (index >= end) return null
        val first = bytes[index].toInt() and 0xFF
        index += 1
        val length = when {
            first < 0x80 -> first
            first == 0x81 && index < end -> (bytes[index].toInt() and 0xFF).also { index += 1 }
            first == 0x82 && index + 1 < end -> (((bytes[index].toInt() and 0xFF) shl 8) or (bytes[index + 1].toInt() and 0xFF)).also { index += 2 }
            else -> return null
        }
        if (length == 0 || index + length > end) return null
        return index until index + length
    }

    /** "PRIMARY, SECONDARY NAMES" from an MRZ name field (`PRIMARY<<SECONDARY<NAMES<<<`). */
    private fun name(field: String): String {
        val parts = field.trimEnd(FILLER).split("<<", limit = 2)
        val primary = words(parts[0])
        val secondary = parts.getOrNull(1)?.let(::words).orEmpty()
        return if (secondary.isEmpty()) primary else "$primary, $secondary"
    }

    private fun words(part: String): String = part.split(FILLER).filter { it.isNotEmpty() }.joinToString(" ")

    private fun code(field: String): String = field.trimEnd(FILLER)

    /**
     * A TD1 document number (Doc 9303 Part 5 §4.2.2): nine characters, or, when its check digit is
     * `<`, those nine and the characters of the optional data up to their own check digit.
     */
    private fun td1Number(text: String): String {
        val number = text.substring(5, 14)
        if (text[14] != FILLER) return code(number)
        val rest = text.substring(15, 30).substringBefore(FILLER)
        return if (rest.length < 2) code(number) else number + rest.dropLast(1)
    }
}
