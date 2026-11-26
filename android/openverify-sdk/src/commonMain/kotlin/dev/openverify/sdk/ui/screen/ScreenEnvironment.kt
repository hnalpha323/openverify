package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.OperatorCopy
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowValue

/**
 * What the `screen` step (C195), the verification steps' prefilled values (C195.6) and the failure
 * screen's contest route (C197.3) read from the session that the flow state does not carry: the
 * component texts in the chosen language, the version's links, the session's `values`, the decision's
 * contest route and the theme assets. The screen's own values, the fields a 422 refused and its
 * submission are the driver's (`FlowState.Screen`, `FlowActions.submitScreen`).
 *
 * Workflow 10A hook (android-screens; a missing hook named in its report): the dispatcher's caller
 * provides it once with [LocalScreenEnvironment] from the driver's session, `android-theme`'s chosen
 * language and theme assets, and the view model's [ScreenDrafts]. Until it does, [NONE] holds: no
 * component text, so every screen renders unsupported (never a raw key, C199.6), no prefill and no
 * contest route.
 */
internal class ScreenEnvironment(
    /** C162.5, C199.6: a component copy key's text and its language, or null when no catalog holds it. */
    internal val text: (key: String) -> ComponentText?,
    /** The chosen language (a base tag); a text from another language says so (WCAG 3.1.2). */
    internal val language: String,
    /** C162.3: the version's `https:` link fields a `link` button names. */
    internal val links: FlowLinks? = null,
    /** C151.5, C195.6: the session's values, which a verification step's `prefillFrom` fills its fields with. */
    internal val values: Map<String, FlowValue> = emptyMap(),
    /** C128.7, C197.3: how the person contests a decline, shown on the failure screen. */
    internal val contestRoute: FlowContestRoute? = null,
    /** C198.3: a theme asset once fetched and decoded (`android-theme`), or null: the text alternative stands in. */
    internal val asset: (assetId: String) -> ImageBitmap? = { null },
    /** What the person typed, kept in the view model's memory across a rotation (C195.5); null keeps it in the composition. */
    internal val drafts: ScreenDrafts? = null,
) {
    override fun toString(): String = "ScreenEnvironment(language=$language)"

    internal companion object {
        /** No session: no text, so a screen renders unsupported; nothing prefilled; no contest route. */
        internal val NONE: ScreenEnvironment = ScreenEnvironment(text = { null }, language = SDK_DEFAULT_LANGUAGE)
    }
}

/** The environment of the screens below; [ScreenEnvironment.NONE] until the dispatcher's caller provides one. */
internal val LocalScreenEnvironment = staticCompositionLocalOf { ScreenEnvironment.NONE }

/**
 * The environment of [session] in the chosen [language] (C199.2): component texts from its `copy`
 * (C162.5's fallback to `locales.default`), `{organization}` from `organization-display-name`; its
 * links, values and contest route.
 */
internal fun screenEnvironmentOf(
    session: FlowSession,
    language: String,
    asset: (assetId: String) -> ImageBitmap? = { null },
    drafts: ScreenDrafts? = null,
): ScreenEnvironment {
    val copy = OperatorCopy(session.copy, language, session.locales?.default ?: SDK_DEFAULT_LANGUAGE)
    val placeholders = buildMap {
        session.organizationDisplayName?.let { put("organization", it) }
    }
    return ScreenEnvironment(
        text = { key -> copy.component(key, placeholders) },
        language = language,
        links = session.links,
        values = session.values.orEmpty(),
        contestRoute = session.decisionContestRoute,
        asset = asset,
        drafts = drafts,
    )
}

/**
 * What the person typed into a screen, by step id: personal data kept in memory only (C195.5,
 * C213.2), never in saved state; [forget] drops a step's form once the flow leaves it.
 */
internal class ScreenDrafts {
    private val forms = mutableStateMapOf<String, ScreenFormState>()

    internal operator fun get(stepId: String): ScreenFormState? = forms[stepId]

    internal operator fun set(stepId: String, state: ScreenFormState) {
        forms[stepId] = state
    }

    internal fun forget(stepId: String) {
        forms.remove(stepId)
    }

    internal fun clear() = forms.clear()

    override fun toString(): String = "ScreenDrafts(<${forms.size} redacted>)"
}
