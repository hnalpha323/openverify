package dev.openverify.sdk.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The phone and form screens name countries in the language their texts are shown in (C64.2). */
internal class CountryNamesTest {

    @Test
    fun `a country is named in English or Spanish`() {
        assertEquals("United States", countryName("US", "en"))
        assertEquals("Estados Unidos", countryName("US", "es"))
        assertEquals("United Kingdom", countryName("GB", "en"))
        assertEquals("Canadá", countryName("CA", "es"))
    }

    @Test
    fun `a code that is not a region has no name, so the screen shows the code`() {
        assertNull(countryName("1A", "en"))
        assertNull(countryName("USA", "en"))
        assertNull(countryName("", "en"))
    }
}
