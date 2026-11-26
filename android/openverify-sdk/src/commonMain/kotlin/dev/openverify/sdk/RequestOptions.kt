package dev.openverify.sdk

import dev.openverify.sdk.i18n.canonicalLanguageTag

/**
 * C190.2: the rules for the options a host passes beside the credentials (`Request.locale`,
 * `OneTimeLink.locale`), in common code so the next release's iOS entry points share them.
 */
internal object RequestOptions {
    /** C190.2: a locale is a BCP 47 tag of at most 35 characters. */
    const val LOCALE_MAX_LENGTH: Int = 35

    /** The refusal, which names no value. */
    const val LOCALE_REFUSED: String = "locale must be a BCP 47 language tag of at most 35 characters, such as es or ar-EG"

    /**
     * Whether [locale] is a well-formed BCP 47 tag of at most [LOCALE_MAX_LENGTH] characters, as
     * written: no surrounding space and no `_`, which the language chooser would forgive. Whether the
     * SDK has its language does not matter here: an unsupported tag falls back without error (C199.2).
     */
    fun isLocale(locale: String): Boolean =
        locale.length in 1..LOCALE_MAX_LENGTH && locale.none { it == '_' || it.isWhitespace() } && canonicalLanguageTag(locale) != null
}
