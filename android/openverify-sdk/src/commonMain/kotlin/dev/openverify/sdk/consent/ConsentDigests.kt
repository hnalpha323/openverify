package dev.openverify.sdk.consent

import dev.openverify.sdk.OPENVERIFY_SDK_VERSION
import dev.openverify.sdk.flow.logic.Sha256
import dev.openverify.sdk.i18n.COPY_KEY_RULES
import dev.openverify.sdk.i18n.LegalKind
import dev.openverify.sdk.i18n.OperatorCopy
import dev.openverify.sdk.i18n.ResolvedText
import dev.openverify.sdk.i18n.SDK_COPY_KEYS
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.sdkStringIn
import dev.openverify.sdk.i18n.sdkStringTable
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowSession

/**
 * C200.1: the consent evidence the SDK reports beside `text-keys`, in the consent body's own words:
 * the SHA-256 of each text as rendered (`text-sha256`, in the order of `text-keys` then
 * `optional-text-keys`), where its copy came from (`copy-source`) and the SDK's consent-text catalog
 * version (`catalog-version`). [NONE] reports none of them, and the body then leaves all three out.
 * The server checks the digests a body carries against the consent texts it stored and stores none
 * of them; a body without them is not checked (KP11-79).
 */
internal data class ConsentEvidence(
    val textSha256: List<String>? = null,
    val copySource: String? = null,
    val catalogVersion: String? = null,
) {
    internal companion object {
        /** No evidence: the body carries none of the three members. */
        internal val NONE: ConsentEvidence = ConsentEvidence()
    }
}

/**
 * C200.2: what a consent text's placeholders are filled with: `days` from the session's
 * `face-template-retention-days`, written with Kotlin's own `toString()`, which is ASCII on every
 * platform whatever the device's locale (C196.3), and `organization` from its
 * `organization-display-name`, which the server serves NFC-normalised.
 */
internal data class ConsentValues(val retentionDays: Int?, val organization: String?) {
    /** The placeholder values by name; a value the session does not give is absent. */
    internal fun byName(): Map<String, String> = buildMap {
        retentionDays?.let { put("days", it.toString()) }
        organization?.let { put("organization", it) }
    }

    internal companion object {
        fun of(session: FlowSession): ConsentValues = ConsentValues(session.faceTemplateRetentionDays, session.organizationDisplayName)
    }
}

/** The agreement's label: the consent checkbox every consent step shows (C200.3 `consent.checkbox`). */
internal const val CONSENT_AGREEMENT_KEY: String = "consent.checkbox"

/** A consent text, or the agreement's label, as the consent screen shows it (C200.2). */
internal sealed interface ConsentText {
    /**
     * [logical] is the text the digest is taken over (placeholders filled, no format character
     * added), [display] the same with each filled value isolated (C199.5); [custom] when the words
     * are the operator's.
     */
    data class Shown(val key: String, val logical: String, val display: String, val custom: Boolean) : ConsentText

    /** The text cannot be shown as written: a required one makes the step unsupported, an optional one is not offered. */
    data class Unavailable(val key: String) : ConsentText
}

/**
 * C200.3: the consent texts by flow key, with their resources: the key map's entries that have a flow
 * key and a `consent` or `notice` legal mark (`SDK_COPY_KEYS` with `COPY_KEY_RULES`), the eight texts
 * `exportConsentTexts` appends to the server's table (`consent.checkbox`, the agreement's label, among
 * them).
 */
internal val CONSENT_TEXT_RESOURCES: Map<String, String> = SDK_COPY_KEYS.entries
    .filter { (_, flowKey) -> COPY_KEY_RULES[flowKey]?.legal.let { it == LegalKind.CONSENT || it == LegalKind.NOTICE } }
    .associate { (resource, flowKey) -> flowKey to resource }

/**
 * C200.2, C199.6: consent text [key] as the consent screen shows it in [language] (a base tag of the
 * SDK's languages): the operator's text when the session's [copy] holds one in [language] (C162.5:
 * the SDK has its own text in every language it chooses, so [defaultLanguage]'s custom text never
 * replaces it), its `{name}` placeholders filled; else the SDK's own, its `{{name}}` placeholders
 * filled. [ConsentText.Unavailable] when the key has no text, or its text names a value [values] does
 * not give (an operator's `{organization}` without `organization-display-name`, `{{days}}` without
 * the retention), or the operator's text cannot be read as written: never a text with a placeholder
 * left in it.
 */
internal fun consentText(key: String, language: String, copy: FlowCopy?, defaultLanguage: String, values: ConsentValues): ConsentText {
    val resource = CONSENT_TEXT_RESOURCES[key] ?: return ConsentText.Unavailable(key)
    val named = values.byName()
    when (val resolved = OperatorCopy(copy, language, defaultLanguage).forResource(resource, named)) {
        is ResolvedText.Custom -> return ConsentText.Shown(key, resolved.text.logical, resolved.text.display, custom = true)
        ResolvedText.Unsupported -> return ConsentText.Unavailable(key)
        ResolvedText.BuiltIn -> Unit
    }
    val template = sdkStringIn(language, resource, emptyList()) ?: return ConsentText.Unavailable(key)
    val filled = filledBuiltIn(template, named) ?: return ConsentText.Unavailable(key)
    return ConsentText.Shown(key, filled.first, filled.second, custom = false)
}

private const val FIRST_STRONG_ISOLATE = '\u2068'
private const val POP_DIRECTIONAL_ISOLATE = '\u2069'

/**
 * A built-in consent text with each `{{name}}` filled from [values], in one pass, as the logical and
 * the displayed text (each value between U+2068 and U+2069 in the second only, C199.5); `null` when a
 * placeholder has no value. Released texts hold `{{name}}` placeholders only (the web's form, which
 * the server's table and its fill share, C200.3).
 */
private fun filledBuiltIn(template: String, values: Map<String, String>): Pair<String, String>? {
    val logical = StringBuilder(template.length)
    val display = StringBuilder(template.length)
    var at = 0
    while (at < template.length) {
        val open = template.indexOf("{{", at)
        if (open < 0) {
            logical.append(template, at, template.length)
            display.append(template, at, template.length)
            break
        }
        val close = template.indexOf("}}", open + 2)
        if (close < 0) return null
        val value = values[template.substring(open + 2, close)] ?: return null
        logical.append(template, at, open).append(value)
        display.append(template, at, open).append(FIRST_STRONG_ISOLATE).append(value).append(POP_DIRECTIONAL_ISOLATE)
        at = close + 2
    }
    return logical.toString() to display.toString()
}

/** C200.3: the locales of the SDK's consent catalog, in the order of the server's table. */
private val CONSENT_CATALOG_LOCALES: List<String> = listOf("en", "es", "fr", "de", "ar")

/**
 * The version, computed once from the SDK's own texts as `exportConsentTexts` computes it from the
 * same resources: the lines `<locale>\t<flow key>\t<SHA-256 of the text>\n` in locale order, then
 * flow key order. A text missing from a locale's table changes the version, so the server then
 * refuses the consent rather than match it against another text.
 */
private val catalogVersion: String by lazy {
    val lines = CONSENT_CATALOG_LOCALES.joinToString("") { locale ->
        CONSENT_TEXT_RESOURCES.entries.sortedBy { it.key }.joinToString("") { (flowKey, resource) ->
            "$locale\t$flowKey\t${Sha256.hexOfUtf8(sdkStringTable(locale)?.strings?.get(resource).orEmpty())}\n"
        }
    }
    "android-$OPENVERIFY_SDK_VERSION-${Sha256.hexOfUtf8(lines).take(16)}"
}

/**
 * C200.1 (review F07): the SDK's consent-text catalog version, `android-<SDK version>-<the first 16
 * hex digits of a SHA-256 over the consent texts only>`, so a change to any other string makes no new
 * version. `ConsentTextTest` holds it to the rows `exportConsentTexts` wrote into the server's table.
 */
internal fun consentCatalogVersion(): String = catalogVersion

/**
 * The consent hook (C200; Workflow 10A Stage 1b, filled by android-sdk-api). `FlowCoordinator` calls
 * it once per consent it sends and passes the result to `FlowApi.acceptConsent`, which encodes it.
 *
 * C200.1, C200.2 (decision 14; reviews H07, F06): `text-sha256` is the SHA-256 of each text's logical
 * form, in the order of `text-keys` then [optionalTextKeys], each resolved as the consent screen
 * resolves it ([consentText]) in [locale], the language it was shown in (C193.9); `copy-source` is
 * `custom` when every text is the operator's, `built-in` when none is, and left out when they are
 * mixed, since the server matches a `custom` body against the operator's copy only and a `built-in`
 * one against the released texts only; `catalog-version` is [consentCatalogVersion]. A text the
 * screen could not show gives no evidence at all ([ConsentEvidence.NONE]): the server then records
 * the consent unmatched, never as matched. The texts are NFC already (the SDK's at build time, the
 * operator's and the organisation's name as the server serves them), so no normaliser runs here.
 *
 * The digests record what the SDK reports it rendered (C200.6): they show the server accepted a
 * matching text, not that a person read it.
 */
internal suspend fun consentEvidence(
    step: ConsentStep,
    optionalTextKeys: List<String>,
    locale: String,
    session: FlowSession,
): ConsentEvidence {
    val values = ConsentValues.of(session)
    val defaultLanguage = session.locales?.default ?: SDK_DEFAULT_LANGUAGE
    val texts = (step.textKeys + optionalTextKeys).map { consentText(it, locale, session.copy, defaultLanguage, values) }
    val shown = texts.filterIsInstance<ConsentText.Shown>()
    if (shown.size != texts.size) return ConsentEvidence.NONE
    val source = when {
        shown.all { it.custom } -> COPY_SOURCE_CUSTOM
        shown.none { it.custom } -> COPY_SOURCE_BUILT_IN
        else -> null
    }
    return ConsentEvidence(shown.map { Sha256.hexOfUtf8(it.logical) }, source, consentCatalogVersion())
}

private const val COPY_SOURCE_CUSTOM = "custom"
private const val COPY_SOURCE_BUILT_IN = "built-in"
