package dev.openverify.sdk.mrz

/** Machine Readable Zone helpers (ICAO Doc 9303). */
internal object Mrz {
    /** The filler character that completes vacant MRZ positions. */
    const val FILLER: Char = '<'

    private val WEIGHTS = intArrayOf(7, 3, 1)

    /**
     * Check digit of an MRZ [field], as defined in ICAO Doc 9303 Part 3 §4.9.
     *
     * The digit is the sum of the character values, weighted 7, 3, 1, 7, 3, 1, …
     * from left to right, modulo 10. Character values are: `0`–`9` → 0–9,
     * `A`–`Z` → 10–35, and the filler `<` → 0.
     *
     * @throws IllegalArgumentException if [field] contains anything other than `0`–`9`,
     *   `A`–`Z` or `<`. The message gives only the position, never the value, because
     *   MRZ fields are personal data.
     */
    fun checkDigit(field: String): Int {
        var sum = 0
        for ((index, char) in field.withIndex()) {
            sum += characterValue(char, index) * WEIGHTS[index % WEIGHTS.size]
        }
        return sum % 10
    }

    private fun characterValue(char: Char, index: Int): Int = when (char) {
        in '0'..'9' -> char - '0'
        in 'A'..'Z' -> char - 'A' + 10
        FILLER -> 0
        else -> throw IllegalArgumentException("Invalid MRZ character at position ${index + 1}")
    }
}
