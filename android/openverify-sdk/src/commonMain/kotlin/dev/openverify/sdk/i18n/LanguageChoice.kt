package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.FlowLocales

/**
 * C199.2 (Phase 9 C161.2; review H21): which of the SDK's languages a session is shown in, a port of
 * `apps/flow/src/i18n/languages.ts`. The candidates, in priority order: the person's choice in the
 * selector, `Request.locale`, then the device's locales; each matched by RFC 4647 lookup against the
 * version's `locales.enabled` that the SDK also bundles; then the version's `locales.default`; then
 * English. Strings are chosen by the base language; numbers and dates format with the full tag
 * (with ASCII digits wherever a value is sent, C196.3). Pure: the device's default locale never
 * enters a tag's case or a lookup.
 */

/** The languages the SDK bundles (decision 12), in Phase 9's `SUPPORTED_LANGUAGES` order. */
internal val SDK_LANGUAGES: List<String> = listOf("en", "es", "fr", "de", "ar")

/** The language when nothing else matches (C161.2). */
internal const val SDK_DEFAULT_LANGUAGE: String = "en"

/** The [language] the strings are chosen by (a base tag) and the full [locale] tag numbers and dates format with. */
internal data class LanguageChoice(internal val language: String, internal val locale: String)

private fun Char.isAsciiLetter(): Boolean = this in 'a'..'z' || this in 'A'..'Z'

private fun Char.isAsciiDigit(): Boolean = this in '0'..'9'

/**
 * A candidate as a well-formed BCP 47 tag in canonical case (`ES_mx` is `es-MX`), or null when it is
 * empty, the wildcard or not a language tag. The check is syntactic (a 2-3 or 5-8 letter language,
 * subtags of 1 to 8 ASCII letters and digits, a singleton followed by a subtag); unlike the web's
 * `Intl.getCanonicalLocales`, no alias is mapped, which no bundled language needs.
 */
internal fun canonicalLanguageTag(candidate: String?): String? {
    val trimmed = candidate?.trim()?.replace('_', '-').orEmpty()
    if (trimmed.isEmpty() || trimmed == "*") return null
    val subtags = trimmed.split('-')
    if (subtags.any { subtag -> subtag.isEmpty() || subtag.length > 8 || !subtag.all { it.isAsciiLetter() || it.isAsciiDigit() } }) return null
    val language = subtags.first()
    if (!language.all { it.isAsciiLetter() } || language.length !in 2..3 && language.length !in 5..8) return null
    if (subtags.last().length == 1) return null
    val canonical = mutableListOf(language.lowercase())
    var extended = false
    var scriptSeen = false
    for (index in 1 until subtags.size) {
        val subtag = subtags[index]
        canonical += when {
            extended -> subtag.lowercase()
            subtag.length == 1 -> {
                extended = true
                subtag.lowercase()
            }
            index == 1 && subtag.length == 4 && subtag.all { it.isAsciiLetter() } -> {
                scriptSeen = true
                subtag.lowercase().replaceFirstChar { it.uppercaseChar() }
            }
            (index == 1 || (index == 2 && scriptSeen)) &&
                ((subtag.length == 2 && subtag.all { it.isAsciiLetter() }) || (subtag.length == 3 && subtag.all { it.isAsciiDigit() })) -> subtag.uppercase()
            else -> subtag.lowercase()
        }
    }
    return canonical.joinToString("-")
}

/**
 * RFC 4647 section 3.4 lookup of [tag] among [available]: the tag is truncated from the end, a
 * single-letter subtag going with the one that follows it, until a whole prefix matches. `ara`
 * never matches `ar`, since subtags are compared whole.
 */
internal fun lookupLanguage(tag: String, available: List<String>): String? {
    var subtags = tag.lowercase().split('-')
    while (subtags.isNotEmpty()) {
        val range = subtags.joinToString("-")
        available.firstOrNull { it == range }?.let { return it }
        subtags = subtags.dropLast(1)
        if (subtags.size >= 2 && subtags.last().length == 1) subtags = subtags.dropLast(1)
    }
    return null
}

/** The languages that may be chosen: the version's enabled locales the SDK bundles, or every bundled one with no `locales` member. */
internal fun availableLanguages(locales: FlowLocales?): List<String> =
    locales?.enabled?.filter { it in SDK_LANGUAGES }?.distinct() ?: SDK_LANGUAGES

/**
 * C199.2: the language a session is shown in. [selected] is the person's choice in the selector,
 * [requested] the host's `Request.locale`, [device] the device's locales in its order.
 *
 * The selector comes first (ours, a refinement of C199.2's order): it is the person's latest act,
 * and a host's locale ahead of it would make the selector a control that does nothing; the web flow
 * behaves the same way (its selector changes the language whatever the `language` parameter said).
 */
internal fun chooseLanguage(selected: String?, requested: String?, device: List<String>, locales: FlowLocales?): LanguageChoice {
    val available = availableLanguages(locales)
    for (candidate in listOf(selected, requested) + device) {
        val tag = canonicalLanguageTag(candidate) ?: continue
        val language = lookupLanguage(tag, available) ?: continue
        return LanguageChoice(language, tag)
    }
    val fallback = listOfNotNull(locales?.default, SDK_DEFAULT_LANGUAGE).plus(available).firstOrNull { it in available } ?: SDK_DEFAULT_LANGUAGE
    return LanguageChoice(fallback, fallback)
}

/** C199.5: whether [language] (a base tag) lays out right to left; of the SDK's languages, Arabic. */
internal fun isRightToLeft(language: String): Boolean = language == "ar"
