package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.FlowCopy

/**
 * C199.6, C199.7 (Phase 9 C162.2-C162.6; decision 13): the session's operator copy over the SDK's
 * own strings. The copy of the current step replaces the SDK's text for each key the key map places
 * (`android/openverify-sdk/i18n/key-map.json`, its reverse is [SDK_COPY_KEYS]), with `{name}`
 * placeholders filled from the key's closed list and no other syntax interpreted. Component texts
 * (`<step>.<component>.<attribute>`) are always operator copy, through C162.5's fallbacks, never a
 * raw key. An override the SDK cannot place keeps the built-in text when its key has no legal mark
 * and renders the step unsupported when it has one, since the SDK's own words where the operator
 * wrote a legal text would misstate it. The SDK never translates operator copy (C199.9).
 */

/** C162.2's legal kinds (`COPY_LEGAL_KINDS`). */
internal enum class LegalKind(internal val wire: String) {
    CONSENT("consent"),
    NOTICE("notice"),
    DECISION("decision"),
    RETENTION("retention"),
}

/** One built-in key's rules: its closed list of `{name}` [placeholders] and its [legal] kind. */
internal data class CopyKeyRule(internal val placeholders: List<String>, internal val legal: LegalKind?)

private val ORGANIZATION = listOf("organization")

private fun title(): CopyKeyRule = CopyKeyRule(ORGANIZATION, null)

private fun consent(placeholders: List<String> = ORGANIZATION): CopyKeyRule = CopyKeyRule(placeholders, LegalKind.CONSENT)

/**
 * Phase 9's `COPY_KEYS` (`packages/flow-spec/src/v2/copy-keys.ts`) as the SDK reads it at run time:
 * each key's placeholders and legal mark. `CopyKeysFixtureTest` holds it to
 * `contracts/fixtures/i18n/copy-keys.json`, which api-android-10a exports from `COPY_KEYS`.
 */
internal val COPY_KEY_RULES: Map<String, CopyKeyRule> = mapOf(
    "consent.title" to title(),
    "consent.biometric" to consent(listOf("days", "organization")),
    "consent.biometric-matching" to consent(listOf("days", "organization")),
    "consent.processing" to consent(),
    "consent.device-recognition" to consent(),
    "consent.automated-decision" to consent(),
    "consent.checkbox" to consent(),
    "consent.continue" to CopyKeyRule(emptyList(), null),
    "notice.session-integrity" to CopyKeyRule(ORGANIZATION, LegalKind.NOTICE),
    "notice.device-recognition" to CopyKeyRule(ORGANIZATION, LegalKind.NOTICE),
    "notice.play-integrity" to CopyKeyRule(ORGANIZATION, LegalKind.NOTICE),
    "completion.title" to title(),
    "failure.title" to title(),
    "screen.continue" to CopyKeyRule(emptyList(), null),
    "screen.help" to title(),
    "screen.helpLink" to title(),
    "screen.privacyLink" to title(),
    "screen.waiting.title" to title(),
    "screen.waiting.message" to title(),
    "screen.halted.title" to title(),
    "screen.halted.message" to title(),
    // C238.3, C238.10 (Phase 11, Workflow 11A): the share-consent step's texts. The server composes
    // them into the step's client view, operator copy included (SERVER_COMPOSED_COPY_KEYS).
    "share.consent.title" to consent(listOf("recipient")),
    "share.consent.source" to consent(listOf("source", "recipient", "categories", "expires", "withdraw")),
    "share.consent.destination" to consent(listOf("source", "recipient", "categories", "expires", "withdraw", "retention")),
    "share.consent.biometric-source" to consent(listOf("source", "recipient")),
    "share.consent.biometric-destination" to consent(listOf("source", "recipient", "retention")),
    "share.consent.accept" to consent(emptyList()),
    "share.consent.decline" to consent(emptyList()),
    "share.consent.withdraw" to consent(listOf("recipient")),
)

/**
 * C238.3, C238.7 (Phase 11, Workflow 11A; orchestrator decision 18): the copy keys whose texts the
 * server composes into a step's client view (the `share_consent` step's body, biometric text and
 * buttons), the version's operator copy included. The SDK shows the served text, never a catalog
 * text for them, so an override of one is neither placed nor refused here: it is already in the view.
 * `LegalKeyMapTest` holds it to `key-map.json`'s `serverComposed` list.
 */
internal val SERVER_COMPOSED_COPY_KEYS: Set<String> = COPY_KEY_RULES.keys.filter { it.startsWith("share.consent.") }.toSet()

/** C162.2: a component copy key's attributes (`COMPONENT_COPY_ATTRIBUTES`); an option is `option.<option key>`. */
internal val COMPONENT_COPY_ATTRIBUTES: List<String> = listOf("label", "hint", "title", "body", "button", "alt")

/** A component text takes `{organization}` only (`apps/api/src/services/templates/copy-rules.ts`). */
private val COMPONENT_PLACEHOLDERS = ORGANIZATION

/**
 * The key map's reverse at run time: each SDK string resource that operator copy may replace, and
 * the flow key it is replaced by. `SdkCopyKeysTest` holds it to the entries of `key-map.json` that
 * carry a flow key (android-i18n's file), so an entry added there fails until it is named here.
 */
internal val SDK_COPY_KEYS: Map<String, String> = mapOf(
    "openverify_consent_title" to "consent.title",
    "openverify_consent_biometric" to "consent.biometric",
    "openverify_consent_processing" to "consent.processing",
    "openverify_consent_biometric_matching" to "consent.biometric-matching",
    "openverify_consent_checkbox" to "consent.checkbox",
    "openverify_notice_session_integrity" to "notice.session-integrity",
    "openverify_notice_device_recognition" to "notice.device-recognition",
    "openverify_notice_play_integrity" to "notice.play-integrity",
    "openverify_consent_device_recognition" to "consent.device-recognition",
    "openverify_consent_automated_decision" to "consent.automated-decision",
    "openverify_consent_continue" to "consent.continue",
    "openverify_screen_continue" to "screen.continue",
    "openverify_waiting_title" to "screen.waiting.title",
    "openverify_waiting_message" to "screen.waiting.message",
    "openverify_halted_title" to "screen.halted.title",
    "openverify_halted_message" to "screen.halted.message",
    "openverify_help_link" to "screen.helpLink",
    "openverify_privacy_link" to "screen.privacyLink",
)

/** Where an operator's copy key lands on Android (C199.7). */
internal sealed class CopyKeyPlacement {
    /** A built-in key the key map places on these SDK [resources]. */
    internal data class Placed(internal val resources: List<String>) : CopyKeyPlacement()

    /** A component text (`<step>.<component>.<attribute>`): always operator copy. */
    internal data object Component : CopyKeyPlacement()

    /** A key the SDK cannot place and with no legal weight: the built-in text stays (the caller emits a PII-free event). */
    internal data object Ignored : CopyKeyPlacement()

    /** A legal key the SDK cannot place: the step renders unsupported. */
    internal data class Unsupported(internal val legal: LegalKind) : CopyKeyPlacement()

    /** A key the server composes into the step's view ([SERVER_COMPOSED_COPY_KEYS]): nothing to place. */
    internal data object ServerComposed : CopyKeyPlacement()
}

/** Whether [key] is a component copy key: `<step>.<component>.<attribute>` or `<step>.<component>.option.<option key>`. */
private fun isComponentKey(key: String): Boolean {
    val parts = key.split('.')
    if (parts.any { it.isEmpty() }) return false
    return (parts.size == 3 && parts[2] in COMPONENT_COPY_ATTRIBUTES) || (parts.size == 4 && parts[2] == "option")
}

/**
 * C199.7: where [key] lands. A built-in key ([rules]) the key map ([keyMap], resource to flow key)
 * places is [CopyKeyPlacement.Placed] on its resources; an unplaced built-in key is
 * [CopyKeyPlacement.Unsupported] when it has a legal mark and [CopyKeyPlacement.Ignored] when not, unless
 * the server composes it into the view ([CopyKeyPlacement.ServerComposed], Workflow 11A); a
 * component key is [CopyKeyPlacement.Component]; anything else (the server refuses an unknown key on
 * save) is [CopyKeyPlacement.Ignored].
 */
internal fun placeCopyKey(key: String, rules: Map<String, CopyKeyRule> = COPY_KEY_RULES, keyMap: Map<String, String> = SDK_COPY_KEYS): CopyKeyPlacement {
    val rule = rules[key] ?: return if (isComponentKey(key)) CopyKeyPlacement.Component else CopyKeyPlacement.Ignored
    val resources = keyMap.filterValues { it == key }.keys.sorted()
    return when {
        key in SERVER_COMPOSED_COPY_KEYS -> CopyKeyPlacement.ServerComposed
        resources.isNotEmpty() -> CopyKeyPlacement.Placed(resources)
        rule.legal != null -> CopyKeyPlacement.Unsupported(rule.legal)
        else -> CopyKeyPlacement.Ignored
    }
}

/** The keys of a session's copy that the SDK cannot place, by outcome (C199.7), each once, in the copy's order. */
internal data class CopyReview(internal val unsupported: List<String>, internal val ignored: List<String>) {
    /** Whether the step must render unsupported (a legal text the SDK cannot place). */
    internal val rendersUnsupported: Boolean get() = unsupported.isNotEmpty()
}

/** C199.7 over every key of [copy], in every locale it carries. */
internal fun reviewCopy(copy: FlowCopy?, rules: Map<String, CopyKeyRule> = COPY_KEY_RULES, keyMap: Map<String, String> = SDK_COPY_KEYS): CopyReview {
    val keys = copy?.messages?.values?.flatMap { it.keys }?.distinct().orEmpty()
    val placements = keys.associateWith { placeCopyKey(it, rules, keyMap) }
    return CopyReview(
        unsupported = placements.filterValues { it is CopyKeyPlacement.Unsupported }.keys.toList(),
        ignored = placements.filterValues { it == CopyKeyPlacement.Ignored }.keys.toList(),
    )
}

/**
 * A text with its placeholders filled: [logical] is what the consent digest is taken over (C200.2:
 * the values as they are, no format character added), [display] the same text with each filled
 * value isolated by U+2068 and U+2069 (C199.5), so a Latin name keeps its order inside Arabic text.
 */
internal data class FilledText(internal val logical: String, internal val display: String)

private const val FIRST_STRONG_ISOLATE = '⁨'
private const val POP_DIRECTIONAL_ISOLATE = '⁩'
private const val PLACEHOLDER_NAME_LONGEST = 40

/** The `{name}` placeholder name starting after the brace at [open], `[a-z][a-z0-9_]{0,39}`, or null. */
private fun placeholderAt(text: String, open: Int): String? {
    val close = text.indexOf('}', open + 1)
    if (close < 0) return null
    val name = text.substring(open + 1, close)
    if (name.isEmpty() || name.length > PLACEHOLDER_NAME_LONGEST || name[0] !in 'a'..'z') return null
    return name.takeIf { it.all { character -> character in 'a'..'z' || character in '0'..'9' || character == '_' } }
}

/**
 * C199.6 (Phase 9 C162.3): [text] with each `{name}` filled from [values], in one pass, so a filled
 * value is never read again. Null when the text cannot be shown as written: a placeholder outside
 * [allowed] or with no value, or a brace that does not stand around a placeholder name (the server
 * refuses both on save). No other syntax is interpreted.
 */
internal fun fillCopyPlaceholders(text: String, allowed: List<String>, values: Map<String, String>): FilledText? {
    val logical = StringBuilder(text.length)
    val display = StringBuilder(text.length)
    var at = 0
    while (at < text.length) {
        when (val character = text[at]) {
            '{' -> {
                val name = placeholderAt(text, at) ?: return null
                if (name !in allowed) return null
                val value = values[name] ?: return null
                logical.append(value)
                display.append(FIRST_STRONG_ISOLATE).append(value).append(POP_DIRECTIONAL_ISOLATE)
                at += name.length + 2
            }
            '}' -> return null
            else -> {
                logical.append(character)
                display.append(character)
                at += 1
            }
        }
    }
    return FilledText(logical.toString(), display.toString())
}

/** What an SDK string shows (C199.6). */
internal sealed class ResolvedText {
    /** The operator's [text], from [language]'s copy. */
    internal data class Custom(internal val text: FilledText, internal val language: String) : ResolvedText()

    /** The SDK's own string in the chosen language. */
    internal data object BuiltIn : ResolvedText()

    /** The operator wrote a legal text the SDK cannot show as written: the step renders unsupported. */
    internal data object Unsupported : ResolvedText()
}

/** A component text and the language it came from (C162.5; when it is not the chosen one, WCAG 3.1.2 names it). */
internal data class ComponentText(internal val text: FilledText, internal val language: String)

/**
 * A session's operator [copy] in the chosen [language] (a base tag, [chooseLanguage]), with the
 * version's [defaultLanguage] (`locales.default`). The placeholder values are the session's
 * (`organization` from `organization-display-name`, `days` from `face-template-retention-days`,
 * written with Kotlin's own ASCII `toString()`, C196.3).
 */
internal class OperatorCopy(private val copy: FlowCopy?, private val language: String, private val defaultLanguage: String) {
    /**
     * C162.5 for an SDK string: the operator's text in the chosen language, else the SDK's own text
     * in it (the SDK bundles every language it chooses, so the default language's custom text never
     * replaces it). A custom text that cannot be filled is [ResolvedText.Unsupported] for a legal key
     * and [ResolvedText.BuiltIn] otherwise.
     */
    internal fun forResource(resource: String, values: Map<String, String>): ResolvedText {
        val flowKey = SDK_COPY_KEYS[resource] ?: return ResolvedText.BuiltIn
        val text = copy?.messages?.get(language)?.get(flowKey) ?: return ResolvedText.BuiltIn
        val rule = COPY_KEY_RULES[flowKey] ?: return ResolvedText.BuiltIn
        val filled = fillCopyPlaceholders(text, rule.placeholders, values)
            ?: return if (rule.legal != null) ResolvedText.Unsupported else ResolvedText.BuiltIn
        return ResolvedText.Custom(filled, language)
    }

    /**
     * C162.5 for a screen's text, as the web's `copyText` resolves it: in the chosen language, then
     * the default one, the operator's text, else, for a built-in key the key map places (a button
     * labelled `screen.continue`), the SDK's own words in that language; null when none holds it, or
     * the operator's text cannot be filled (never a raw key). A component key has no built-in words.
     */
    internal fun component(key: String, values: Map<String, String>): ComponentText? {
        val builtIn = SDK_COPY_KEYS.entries.firstOrNull { (_, flowKey) -> flowKey == key }?.key
        for (candidate in listOf(language, defaultLanguage).distinct()) {
            val text = copy?.messages?.get(candidate)?.get(key)
            if (text != null) {
                val filled = fillCopyPlaceholders(text, COMPONENT_PLACEHOLDERS, values) ?: return null
                return ComponentText(filled, candidate)
            }
            val own = builtIn?.let { sdkStringIn(candidate, it, emptyList()) }
            if (own != null && "{{" !in own) return ComponentText(FilledText(own, own), candidate)
        }
        return null
    }

    /** C200.1's `copy-source`: whether [flowKey] shown in the chosen language is the operator's text. */
    internal fun isCustom(flowKey: String): Boolean = copy?.messages?.get(language)?.containsKey(flowKey) == true
}
