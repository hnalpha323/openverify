package dev.openverify.sdk.mrz

/**
 * The MRZ's access key fields of an eMRTD (ICAO Doc 9303 Part 11 §4.3), the value a
 * `ChipAccess.Mrz` opens the chip with (C207.2, C207.3). The values are personal data: [toString]
 * never shows them, and nothing keeps them beyond the read.
 *
 * ```
 * val seed = BacKeySeed(documentNumber = "L898902C3", dateOfBirth = "740812", dateOfExpiry = "120415")
 * ```
 *
 * @throws IllegalArgumentException as [mrzInformation] does. Messages never contain the values.
 */
public class BacKeySeed(
    /** As in the MRZ, upper case, no separators. */
    public val documentNumber: String,
    /** YYMMDD, `<` for unknown positions. */
    public val dateOfBirth: String,
    /** YYMMDD. */
    public val dateOfExpiry: String,
) {
    /** The `MRZ_information` string of these fields (the companion's [mrzInformation]). */
    public val mrzInformation: String = mrzInformation(documentNumber, dateOfBirth, dateOfExpiry)

    override fun toString(): String = "BacKeySeed(<redacted>)"

    public companion object {
        private const val DOCUMENT_NUMBER_FIELD_LENGTH = 9

        /** YYMMDD. Part 3 §4.8 fills unknown date-of-birth positions with '<'. */
        private val MRZ_DATE = Regex("[0-9<]{6}")

        /**
         * The `MRZ_information` string (ICAO Doc 9303 Part 11 §4.3.2 and Appendix D.2). It is
         * the document number, the date of birth and the date of expiry, each followed by its
         * check digit. The NFC module hashes it (SHA-1) to derive the BAC key seed.
         *
         * All values must be given as they appear in the MRZ, in upper case, with no separators.
         * A document number shorter than 9 characters is padded with `<` to the 9-character
         * field. A longer one (the TD1/TD2 "exceeds 9 characters" case) is used in full.
         *
         * @throws IllegalArgumentException if the document number is empty or has non-MRZ
         *   characters, or if a date is not 6 characters of `0`–`9`/`<`. Messages never contain
         *   the values themselves.
         */
        public fun mrzInformation(documentNumber: String, dateOfBirth: String, dateOfExpiry: String): String {
            require(documentNumber.isNotEmpty()) { "Document number must not be empty" }
            require(MRZ_DATE.matches(dateOfBirth)) { "Date of birth must be 6 MRZ characters (YYMMDD)" }
            require(MRZ_DATE.matches(dateOfExpiry)) { "Date of expiry must be 6 MRZ characters (YYMMDD)" }

            val documentNumberField = documentNumber.padEnd(DOCUMENT_NUMBER_FIELD_LENGTH, Mrz.FILLER)
            return withCheckDigit(documentNumberField) + withCheckDigit(dateOfBirth) + withCheckDigit(dateOfExpiry)
        }

        private fun withCheckDigit(field: String): String = field + Mrz.checkDigit(field)
    }
}
