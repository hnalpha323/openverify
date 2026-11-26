package dev.openverify.sdk.ui.steps

import dev.openverify.sdk.model.US_JURISDICTIONS
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** The AAMVA form names each issuing authority it offers (C52.3 `US_JURISDICTIONS`). */
internal class UsJurisdictionsTest {

    @Test
    fun `every issuing authority has its own name`() {
        assertEquals(US_JURISDICTIONS.toSet(), US_JURISDICTION_NAMES.keys)
        assertEquals(US_JURISDICTIONS.size, US_JURISDICTION_NAMES.values.toSet().size)
        assertEquals("California", US_JURISDICTION_NAMES["CA"])
        assertEquals("District of Columbia", US_JURISDICTION_NAMES["DC"])
        assertEquals("Puerto Rico", US_JURISDICTION_NAMES["PR"])
        assertEquals("U.S. Virgin Islands", US_JURISDICTION_NAMES["VI"])
    }
}
