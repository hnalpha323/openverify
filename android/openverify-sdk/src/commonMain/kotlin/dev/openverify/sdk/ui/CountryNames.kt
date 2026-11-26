package dev.openverify.sdk.ui

/**
 * The name of the country [code] (ISO 3166-1 alpha-2) in the language [languageTag], or `null`
 * when the platform has none, and the screen shows the code instead.
 */
internal expect fun countryName(code: String, languageTag: String): String?
