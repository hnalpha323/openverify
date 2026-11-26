package dev.openverify.sdk.nfc

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/**
 * C207.2, C207.5: DG1's MRZ parsed in common code, for the review screen. The MRZs are ICAO Doc
 * 9303's published specimens of the state Utopia (`contracts/fixtures/mrz/icao-td{1,2,3}.json`),
 * wrapped as a chip holds them (tag `61`, tag `5F1F`). Synthetic data only.
 */
class Dg1Test {
    private fun dg1(mrz: String, longForm: Boolean = false): ByteArray {
        val text = mrz.encodeToByteArray()
        val inner = byteArrayOf(0x5F, 0x1F) + length(text.size, longForm) + text
        return byteArrayOf(0x61) + length(inner.size, longForm) + inner
    }

    private fun length(size: Int, longForm: Boolean): ByteArray =
        if (longForm || size > 0x7F) byteArrayOf(0x81.toByte(), size.toByte()) else byteArrayOf(size.toByte())

    @Test
    fun a_TD3_passport_shows_its_name_number_nationality_and_dates() {
        assertEquals(
            Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415"),
            Dg1.parse(dg1(TD3)),
        )
    }

    @Test
    fun a_TD1_card_shows_the_same_members_from_its_three_lines() {
        assertEquals(
            Dg1Details("ERIKSSON, ANNA MARIA", "D23145890", "UTO", "740812", "120415"),
            Dg1.parse(dg1(TD1)),
        )
    }

    @Test
    fun a_TD2_document_shows_the_same_members() {
        assertEquals(
            Dg1Details("ERIKSSON, ANNA MARIA", "D23145890", "UTO", "740812", "120415"),
            Dg1.parse(dg1(TD2)),
        )
    }

    @Test
    fun a_TD1_document_number_longer_than_nine_characters_is_read_in_full() {
        // Doc 9303 Part 5 §4.2.2: a '<' check digit, then the rest and its check digit in the optional data.
        val long = "I<UTOD23145890<7349<<<<<<<<<<<" + "7408122F1204159UTO<<<<<<<<<<<6" + "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"

        assertEquals("D23145890734", Dg1.parse(dg1(long))?.documentNumber)
    }

    @Test
    fun a_name_with_one_identifier_shows_it_alone() {
        val single = "P<UTOERIKSSON<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10"

        assertEquals("ERIKSSON", Dg1.parse(dg1(single))?.name)
    }

    @Test
    fun long_form_lengths_are_read() {
        assertEquals("L898902C3", Dg1.parse(dg1(TD3, longForm = true))?.documentNumber)
    }

    @Test
    fun bytes_that_are_not_a_DG1_show_nothing() {
        assertNull(Dg1.parse(byteArrayOf()))
        assertNull(Dg1.parse("synthetic".encodeToByteArray()))
        assertNull(Dg1.parse(dg1(TD3).copyOf(40)))
        assertNull(Dg1.parse(dg1(TD3.dropLast(3))))
        assertNull(Dg1.parse(dg1(TD3.replace('P', 'é'))))
        // A length that claims more than the file holds.
        assertNull(Dg1.parse(byteArrayOf(0x61, 0x7F, 0x5F, 0x1F, 0x58) + TD3.encodeToByteArray()))
    }

    @Test
    fun the_details_never_print_their_values() {
        val details = checkNotNull(Dg1.parse(dg1(TD3)))

        assertEquals("Dg1Details(<redacted>)", details.toString())
        assertFalse("ERIKSSON" in NfcView.Review(details).toString())
    }

    private companion object {
        const val TD3 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10"
        const val TD1 = "I<UTOD231458907<<<<<<<<<<<<<<<" + "7408122F1204159UTO<<<<<<<<<<<6" + "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"
        const val TD2 = "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<" + "D231458907UTO7408122F1204159<<<<<<<6"
    }
}
