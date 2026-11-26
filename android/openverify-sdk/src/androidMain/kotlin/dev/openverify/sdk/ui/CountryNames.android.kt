package dev.openverify.sdk.ui

import java.util.IllformedLocaleException
import java.util.Locale

/** The platform's (CLDR) name of the region, as `java.util.Locale` gives it. */
internal actual fun countryName(code: String, languageTag: String): String? {
    if (!REGION.matches(code)) return null
    val region = try {
        Locale.Builder().setRegion(code).build()
    } catch (_: IllformedLocaleException) {
        return null
    }
    return region.getDisplayCountry(Locale.forLanguageTag(languageTag)).takeIf { it.isNotEmpty() && it != code }
}

private val REGION = Regex("[A-Z]{2}")
