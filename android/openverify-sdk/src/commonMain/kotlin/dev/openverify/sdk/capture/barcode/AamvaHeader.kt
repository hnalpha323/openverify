package dev.openverify.sdk.capture.barcode

/**
 * C203.3: whether decoded PDF417 bytes begin with an AAMVA header, the only thing the device checks
 * before it shows "barcode found". The rule is the server's header rule (`readHeader` in
 * `packages/checks/src/aamva.ts`; the AAMVA DL/ID Card Design Standard, Annex D, Table D.1): `@`, LF,
 * RS, CR, the file type `ANSI `, a six-digit IIN, a two-digit AAMVA version, from version 02 a
 * two-digit jurisdiction version, then a two-digit number of entries that is not zero. It reads the
 * header's form only: no field, subfile or value, and nothing is kept. Whether the barcode is valid
 * or readable is the server's to decide, from the uploaded photo (C203.4).
 */
internal object AamvaHeader {
    private val PREFIX = byteArrayOf(0x40, 0x0A, 0x1E, 0x0D, 0x41, 0x4E, 0x53, 0x49, 0x20) // "@\n\x1e\rANSI "
    private const val IIN_DIGITS = 6
    private const val VERSION_AT = 15

    /** True when [bytes] begin with an AAMVA header. */
    fun matches(bytes: ByteArray): Boolean {
        if (bytes.size < PREFIX.size) return false
        for (index in PREFIX.indices) if (bytes[index] != PREFIX[index]) return false
        if (!digits(bytes, PREFIX.size, IIN_DIGITS)) return false
        val version = twoDigits(bytes, VERSION_AT) ?: return false
        val entriesAt = if (version >= 2) {
            twoDigits(bytes, VERSION_AT + 2) ?: return false
            VERSION_AT + 4
        } else {
            VERSION_AT + 2
        }
        val entries = twoDigits(bytes, entriesAt) ?: return false
        return entries > 0
    }

    private fun twoDigits(bytes: ByteArray, at: Int): Int? =
        if (digits(bytes, at, 2)) (bytes[at] - ZERO) * 10 + (bytes[at + 1] - ZERO) else null

    private fun digits(bytes: ByteArray, at: Int, count: Int): Boolean {
        if (bytes.size < at + count) return false
        for (index in at until at + count) if (bytes[index] !in ZERO..NINE) return false
        return true
    }

    private const val ZERO: Byte = 0x30
    private const val NINE: Byte = 0x39
}
