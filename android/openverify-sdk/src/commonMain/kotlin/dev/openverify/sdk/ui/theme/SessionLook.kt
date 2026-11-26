package dev.openverify.sdk.ui.theme

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import dev.openverify.sdk.i18n.LanguageChoice
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowTheme

/**
 * What the SDK's chrome reads from the session (C197.4, C198, C199): the theme it applies (C198.1,
 * [SessionTheme]), the version's languages (C199.2, C199.3), the help and privacy links (C162.3),
 * the organisation's display name (C198.3) and the operator's copy (C162.6, the logo's alt text and
 * the links' words). It holds no field value and no token: only what the version and the
 * environment state for every person.
 */
internal data class SessionLook(
    internal val theme: FlowTheme? = null,
    internal val locales: FlowLocales? = null,
    internal val links: FlowLinks? = null,
    internal val organizationDisplayName: String? = null,
    internal val copy: FlowCopy? = null,
) {
    internal companion object {
        /** Before a session is read: the built-in theme, every SDK language, no links. */
        internal val NONE: SessionLook = SessionLook()

        /** The look of [session], its theme only when [SessionTheme.usable] (C198.1); [NONE] without one. */
        internal fun of(session: FlowSession?): SessionLook = if (session == null) {
            NONE
        } else {
            SessionLook(
                theme = session.theme?.takeIf(SessionTheme::usable),
                locales = session.locales,
                links = session.links,
                organizationDisplayName = session.organizationDisplayName,
                copy = session.copy,
            )
        }
    }
}

/** The session's look for the SDK's chrome, provided by `OpenVerifyTheme`. */
internal val LocalSessionLook: ProvidableCompositionLocal<SessionLook> = staticCompositionLocalOf { SessionLook.NONE }

/**
 * The person's choice in the language selector (C199.3), a base tag or null before any choice. It
 * names no person and holds nothing typed, and it lives in memory only (no saved state, C213.2): the
 * owner of the flow's state (the view model) keeps one, so a rotation keeps the choice.
 */
internal class LanguageSelection {
    internal var selected: String? by mutableStateOf(null)
}

/** The selector's state, provided by `OpenVerifyTheme`; null outside it. */
internal val LocalLanguageSelection: ProvidableCompositionLocal<LanguageSelection?> = staticCompositionLocalOf { null }

/** The language chosen for this composition (C199.2), provided by `OpenVerifyTheme`; null outside it. */
internal val LocalLanguageChoice: ProvidableCompositionLocal<LanguageChoice?> = staticCompositionLocalOf { null }

/**
 * The theme's colours Material 3 has no role for (C198.2): [focus] for the SDK's focus indicator,
 * [pressedPrimary] and [pressedDanger] (`primary-hover`, `danger-hover`) for pressed states, and the
 * [variant] drawn.
 */
internal data class OpenVerifyColors(
    internal val focus: Color,
    internal val pressedPrimary: Color,
    internal val pressedDanger: Color,
    internal val variant: ThemeVariant,
)

/** The applied theme's extra colours, provided by `OpenVerifyTheme`; null outside it. */
internal val LocalOpenVerifyColors: ProvidableCompositionLocal<OpenVerifyColors?> = staticCompositionLocalOf { null }
