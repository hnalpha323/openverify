package dev.openverify.sdk.ui

/** Until Phase 10 the iOS build names no country, so its screens show the code. */
@Suppress("UNUSED_PARAMETER")
internal actual fun countryName(code: String, languageTag: String): String? = null
