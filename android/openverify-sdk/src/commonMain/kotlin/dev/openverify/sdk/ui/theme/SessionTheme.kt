package dev.openverify.sdk.ui.theme

import dev.openverify.sdk.Appearance
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowTheme
import kotlin.concurrent.Volatile

/**
 * The theme hook (C198.1; Workflow 10A Stage 1b). `FlowCoordinator` asks it, for every session it
 * adopts, which theme the SDK applies, and publishes the answer as its `theme`; `null` is the
 * built-in theme (`OpenVerifyTheme`'s own palettes, `BUILTIN_PALETTES`).
 *
 * A session theme is applied only when it meets its contract ([usable]): its light palette, and its
 * dark palette when sent, hold exactly the twelve tokens of C160.3, each `#rrggbb` in lower case,
 * and its radius is 0 to 24. Otherwise the built-in theme is used for the whole session (fail
 * closed), and the SDK logs the constant code [REFUSED] (C213.3): never a colour, a token or the
 * theme's id. A refused theme read again (the session is read after every step and every wait) is
 * not logged again. The font is never read: the SDK draws the system font (C198.4).
 */
internal object SessionTheme {
    /** The PII-free code logged when a session's theme is refused (C198.1, C213.3). */
    internal const val REFUSED: String = "theme.session_theme_refused"

    @Volatile
    private var lastRefused: FlowTheme? = null

    /** The theme to apply for [session], or `null` for the built-in theme. */
    internal fun of(session: FlowSession): FlowTheme? {
        val theme = session.theme ?: return null
        if (usable(theme)) return theme
        if (lastRefused != theme) {
            lastRefused = theme
            SdkLog.log("theme.session_theme_refused")
        }
        return null
    }

    /** Whether [theme] meets its contract (C198.1), by the mapping's own check (`mappedThemeOf`). */
    internal fun usable(theme: FlowTheme): Boolean = !mappedThemeOf(theme, Appearance.SYSTEM, systemDark = false).fellBack
}
