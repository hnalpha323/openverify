package dev.openverify.sdk.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.model.FlowTheme

/**
 * C198.2 (review H04): the session theme's twelve tokens (Phase 9 C160.3) onto Material 3, pure.
 * Every [ColorScheme] role is set from a token, so none keeps Material's baseline on an operator's
 * screen, and every pair the SDK's composables draw is one of the pairs Phase 9's contrast gate
 * checks (C160.4), or a pair `ThemeContrastTest`'s table states and tests. `radius` maps onto
 * [Shapes]; `mode`, the session's dark palette and [Appearance] choose the variant (C198.5).
 *
 * The SDK does not re-judge a palette (C198.6): the server's gate passed it. android-theme applies
 * the result through `OpenVerifyTheme` (C198.1, C198.3-C198.7).
 */

/** C160.3's twelve palette tokens, by their wire names, in the contracts' order. */
internal enum class ThemeToken(internal val wire: String) {
    PRIMARY("primary"),
    PRIMARY_HOVER("primary-hover"),
    ON_PRIMARY("on-primary"),
    DANGER("danger"),
    DANGER_HOVER("danger-hover"),
    SURFACE("surface"),
    CANVAS("canvas"),
    INK("ink"),
    INK_MUTED("ink-muted"),
    LINE("line"),
    CONTROL("control"),
    FOCUS("focus"),
}

/** A complete palette: each of the twelve tokens an opaque colour. */
internal class ThemePalette internal constructor(private val colours: Map<ThemeToken, Color>) {
    internal operator fun get(token: ThemeToken): Color = colours.getValue(token)

    internal companion object {
        /**
         * The palette of a session theme's map (C198.1), or null when it is not exactly the twelve
         * tokens, each `^#[0-9a-f]{6}$` (lower case, no alpha), so the caller falls back to the
         * built-in theme for the whole session.
         */
        internal fun of(palette: Map<String, String>): ThemePalette? {
            if (palette.size != ThemeToken.entries.size) return null
            val colours = ThemeToken.entries.associateWith { token -> palette[token.wire]?.let(::hexColour) ?: return null }
            return ThemePalette(colours)
        }
    }
}

/** `#rrggbb` in lower case as an opaque colour, or null for anything else. */
private fun hexColour(text: String): Color? {
    if (text.length != 7 || text[0] != '#') return null
    var rgb = 0
    for (index in 1 until 7) {
        val digit = text[index]
        val value = when (digit) {
            in '0'..'9' -> digit - '0'
            in 'a'..'f' -> digit - 'a' + 10
            else -> return null
        }
        rgb = rgb * 16 + value
    }
    return Color(0xff000000.toInt() or rgb)
}

/** Which palette a screen draws. */
internal enum class ThemeVariant { LIGHT, DARK }

/** Where a [ColorScheme] role's colour comes from: a token, or [BLACK] for the scrim. */
internal sealed class RoleSource {
    internal data class Token(internal val token: ThemeToken) : RoleSource()

    /** Material's own scrim, black; components apply their alpha (0.32) over it. */
    internal data object BLACK : RoleSource()
}

private fun token(token: ThemeToken): RoleSource = RoleSource.Token(token)

/**
 * Every [ColorScheme] role and its source (C198.2): `primary`, `on-primary`, `surface`; `canvas` as
 * `background` and `surfaceContainer`; `ink` as `onSurface` and `onBackground`; `ink-muted` as
 * `onSurfaceVariant`; `line` as `outlineVariant`; `control` as `outline`; `danger` as `error`;
 * `on-primary` as `onError`. The rest, so that none keeps the baseline:
 * - secondary and tertiary are the primary pair, their containers (and the fixed ones) `canvas`
 *   under `ink`, which the gate checks;
 * - the surface family is `surface`, except `surfaceContainer` and `surfaceDim` (`canvas`):
 *   dialogs, date pickers, sheets, cards and filled fields (`surfaceContainerLow`, `High` and
 *   `Highest`) put `primary` text on their container, and the gate checks `primary` on `surface`
 *   only;
 * - `surfaceTint` is `surface`, so tonal elevation keeps the gated surface;
 * - `inverseSurface` is `ink` under `surface` (and `inversePrimary`): the gated pair inverted;
 * - `errorContainer` is `canvas` under `danger` (Workflow 10A integration-10a): Material's
 *   `contentColorFor` checks `errorContainer` before `surface`, so no role it checks before `surface`
 *   may equal `surface`, or every `Surface` would draw its text in `danger`; on `canvas` the
 *   `background` role is met first, and `danger` on `canvas` is a gated pair;
 * - `scrim` is Material's black.
 * `focus`, `primary-hover` and `danger-hover` have no role: [MappedTheme] carries them.
 */
internal val COLOR_SCHEME_ROLES: Map<String, RoleSource> = mapOf(
    "primary" to token(ThemeToken.PRIMARY),
    "onPrimary" to token(ThemeToken.ON_PRIMARY),
    "primaryContainer" to token(ThemeToken.CANVAS),
    "onPrimaryContainer" to token(ThemeToken.INK),
    "inversePrimary" to token(ThemeToken.SURFACE),
    "secondary" to token(ThemeToken.PRIMARY),
    "onSecondary" to token(ThemeToken.ON_PRIMARY),
    "secondaryContainer" to token(ThemeToken.CANVAS),
    "onSecondaryContainer" to token(ThemeToken.INK),
    "tertiary" to token(ThemeToken.PRIMARY),
    "onTertiary" to token(ThemeToken.ON_PRIMARY),
    "tertiaryContainer" to token(ThemeToken.CANVAS),
    "onTertiaryContainer" to token(ThemeToken.INK),
    "background" to token(ThemeToken.CANVAS),
    "onBackground" to token(ThemeToken.INK),
    "surface" to token(ThemeToken.SURFACE),
    "onSurface" to token(ThemeToken.INK),
    "surfaceVariant" to token(ThemeToken.SURFACE),
    "onSurfaceVariant" to token(ThemeToken.INK_MUTED),
    "surfaceTint" to token(ThemeToken.SURFACE),
    "inverseSurface" to token(ThemeToken.INK),
    "inverseOnSurface" to token(ThemeToken.SURFACE),
    "error" to token(ThemeToken.DANGER),
    "onError" to token(ThemeToken.ON_PRIMARY),
    "errorContainer" to token(ThemeToken.CANVAS),
    "onErrorContainer" to token(ThemeToken.DANGER),
    "outline" to token(ThemeToken.CONTROL),
    "outlineVariant" to token(ThemeToken.LINE),
    "scrim" to RoleSource.BLACK,
    "surfaceBright" to token(ThemeToken.SURFACE),
    "surfaceDim" to token(ThemeToken.CANVAS),
    "surfaceContainer" to token(ThemeToken.CANVAS),
    "surfaceContainerHigh" to token(ThemeToken.SURFACE),
    "surfaceContainerHighest" to token(ThemeToken.SURFACE),
    "surfaceContainerLow" to token(ThemeToken.SURFACE),
    "surfaceContainerLowest" to token(ThemeToken.SURFACE),
    "primaryFixed" to token(ThemeToken.CANVAS),
    "primaryFixedDim" to token(ThemeToken.CANVAS),
    "onPrimaryFixed" to token(ThemeToken.INK),
    "onPrimaryFixedVariant" to token(ThemeToken.INK),
    "secondaryFixed" to token(ThemeToken.CANVAS),
    "secondaryFixedDim" to token(ThemeToken.CANVAS),
    "onSecondaryFixed" to token(ThemeToken.INK),
    "onSecondaryFixedVariant" to token(ThemeToken.INK),
    "tertiaryFixed" to token(ThemeToken.CANVAS),
    "tertiaryFixedDim" to token(ThemeToken.CANVAS),
    "onTertiaryFixed" to token(ThemeToken.INK),
    "onTertiaryFixedVariant" to token(ThemeToken.INK),
)

/** The [ColorScheme] of [palette]: every role from [COLOR_SCHEME_ROLES]. */
internal fun colorSchemeOf(palette: ThemePalette): ColorScheme {
    fun role(name: String): Color =
        when (val source = COLOR_SCHEME_ROLES.getValue(name)) {
            is RoleSource.Token -> palette[source.token]
            RoleSource.BLACK -> Color.Black
        }
    return ColorScheme(
        primary = role("primary"),
        onPrimary = role("onPrimary"),
        primaryContainer = role("primaryContainer"),
        onPrimaryContainer = role("onPrimaryContainer"),
        inversePrimary = role("inversePrimary"),
        secondary = role("secondary"),
        onSecondary = role("onSecondary"),
        secondaryContainer = role("secondaryContainer"),
        onSecondaryContainer = role("onSecondaryContainer"),
        tertiary = role("tertiary"),
        onTertiary = role("onTertiary"),
        tertiaryContainer = role("tertiaryContainer"),
        onTertiaryContainer = role("onTertiaryContainer"),
        background = role("background"),
        onBackground = role("onBackground"),
        surface = role("surface"),
        onSurface = role("onSurface"),
        surfaceVariant = role("surfaceVariant"),
        onSurfaceVariant = role("onSurfaceVariant"),
        surfaceTint = role("surfaceTint"),
        inverseSurface = role("inverseSurface"),
        inverseOnSurface = role("inverseOnSurface"),
        error = role("error"),
        onError = role("onError"),
        errorContainer = role("errorContainer"),
        onErrorContainer = role("onErrorContainer"),
        outline = role("outline"),
        outlineVariant = role("outlineVariant"),
        scrim = role("scrim"),
        surfaceBright = role("surfaceBright"),
        surfaceDim = role("surfaceDim"),
        surfaceContainer = role("surfaceContainer"),
        surfaceContainerHigh = role("surfaceContainerHigh"),
        surfaceContainerHighest = role("surfaceContainerHighest"),
        surfaceContainerLow = role("surfaceContainerLow"),
        surfaceContainerLowest = role("surfaceContainerLowest"),
        primaryFixed = role("primaryFixed"),
        primaryFixedDim = role("primaryFixedDim"),
        onPrimaryFixed = role("onPrimaryFixed"),
        onPrimaryFixedVariant = role("onPrimaryFixedVariant"),
        secondaryFixed = role("secondaryFixed"),
        secondaryFixedDim = role("secondaryFixedDim"),
        onSecondaryFixed = role("onSecondaryFixed"),
        onSecondaryFixedVariant = role("onSecondaryFixedVariant"),
        tertiaryFixed = role("tertiaryFixed"),
        tertiaryFixedDim = role("tertiaryFixedDim"),
        onTertiaryFixed = role("onTertiaryFixed"),
        onTertiaryFixedVariant = role("onTertiaryFixedVariant"),
    )
}

/** The radius of the built-in theme, Phase 9's `BUILTIN_THEME_RADIUS` (`apps/api/src/services/themes/styles.ts`). */
internal const val BUILTIN_THEME_RADIUS: Int = 6

/** C160.3's radius bounds, in dp here as in CSS px there. */
private val THEME_RADIUS_RANGE = 0..24

/**
 * The theme's `radius` (0 to 24) onto [Shapes], as the web flow's scale around `rounded-md`
 * (`apps/flow/src/theme/apply.ts`): extra small `radius - 2` (at least 0), small and medium
 * `radius`, large `radius + 2`, extra large `radius + 6`. A radius outside 0 to 24 takes
 * [BUILTIN_THEME_RADIUS].
 */
internal fun shapesOf(radius: Int): Shapes {
    val base = if (radius in THEME_RADIUS_RANGE) radius else BUILTIN_THEME_RADIUS
    return Shapes(
        extraSmall = RoundedCornerShape(maxOf(0, base - 2).dp),
        small = RoundedCornerShape(base.dp),
        medium = RoundedCornerShape(base.dp),
        large = RoundedCornerShape((base + 2).dp),
        extraLarge = RoundedCornerShape((base + 6).dp),
    )
}

/**
 * C198.5 (review H21): the variant a screen draws. [Appearance.LIGHT] and [Appearance.DARK] force
 * one (a forced dark with no dark palette draws the built-in dark palette, [mappedThemeOf]).
 * [Appearance.SYSTEM] follows the device as the session's `mode` allows, as the web flow's
 * `chooseVariant` does: no dark palette is light; `dark` is dark; `auto` follows [systemDark];
 * `light` and any mode this SDK does not know are light. With no session theme ([mode] null, the
 * built-in palettes, which have a dark one), it follows the device.
 */
internal fun themeVariantOf(mode: String?, hasDarkPalette: Boolean, appearance: Appearance, systemDark: Boolean): ThemeVariant =
    when (appearance) {
        Appearance.LIGHT -> ThemeVariant.LIGHT
        Appearance.DARK -> ThemeVariant.DARK
        Appearance.SYSTEM -> when {
            !hasDarkPalette -> ThemeVariant.LIGHT
            mode == null || mode == "auto" -> if (systemDark) ThemeVariant.DARK else ThemeVariant.LIGHT
            mode == "dark" -> ThemeVariant.DARK
            else -> ThemeVariant.LIGHT
        }
    }

/**
 * C198.2: Phase 9's built-in light and dark palettes (`BUILTIN_PALETTES`, the hex tokens of
 * `packages/ui/src/styles.css`), the SDK's defaults, so web and Android start from the same
 * colours. `ThemeMappingTest` holds them to `contracts/fixtures/theme/builtin-palettes.json`.
 */
internal val BUILTIN_PALETTES: Map<ThemeVariant, ThemePalette> = mapOf(
    ThemeVariant.LIGHT to ThemePalette.of(
        mapOf(
            "primary" to "#1447e6", "primary-hover" to "#193cb8", "on-primary" to "#ffffff",
            "danger" to "#c10007", "danger-hover" to "#9f0712", "surface" to "#ffffff",
            "canvas" to "#f9fafb", "ink" to "#101828", "ink-muted" to "#4a5565",
            "line" to "#d1d5dc", "control" to "#6a7282", "focus" to "#000000",
        ),
    )!!,
    ThemeVariant.DARK to ThemePalette.of(
        mapOf(
            "primary" to "#3b8bff", "primary-hover" to "#8ec5ff", "on-primary" to "#030712",
            "danger" to "#ff6467", "danger-hover" to "#ffa2a2", "surface" to "#101828",
            "canvas" to "#030712", "ink" to "#f9fafb", "ink-muted" to "#99a1af",
            "line" to "#364153", "control" to "#6a7282", "focus" to "#ffffff",
        ),
    )!!,
)

/**
 * What a screen draws with: the mapped [colorScheme] and [shapes], and the tokens Material has no
 * role for: [focus] for the SDK's focus indicator, [pressedPrimary] and [pressedDanger]
 * (`primary-hover`, `danger-hover`) for pressed states. [builtIn] when the built-in palettes are
 * drawn (no session theme, or [fellBack]); [fellBack] when the session's theme was unusable
 * (C198.1: the caller emits its PII-free event).
 */
internal class MappedTheme internal constructor(
    internal val variant: ThemeVariant,
    internal val colorScheme: ColorScheme,
    internal val shapes: Shapes,
    internal val focus: Color,
    internal val pressedPrimary: Color,
    internal val pressedDanger: Color,
    internal val builtIn: Boolean,
    internal val fellBack: Boolean,
)

/**
 * The theme a session draws (C198.1, C198.2, C198.5). A theme whose light palette, dark palette (when
 * sent) or radius is outside its contract is not used at all: the built-in theme is drawn for the
 * whole session (fail closed), with [MappedTheme.fellBack]. The variant comes from
 * [themeVariantOf]; a dark variant with no session dark palette draws the built-in dark one.
 */
internal fun mappedThemeOf(theme: FlowTheme?, appearance: Appearance, systemDark: Boolean): MappedTheme {
    val light = theme?.let { ThemePalette.of(it.light) }
    val dark = theme?.dark?.let(ThemePalette::of)
    val usable = theme != null && light != null && (theme.dark == null || dark != null) && theme.radius in THEME_RADIUS_RANGE
    val fellBack = theme != null && !usable
    val variant = if (usable) {
        themeVariantOf(theme!!.mode, hasDarkPalette = dark != null, appearance, systemDark)
    } else {
        themeVariantOf(null, hasDarkPalette = true, appearance, systemDark)
    }
    val palette = when (variant) {
        ThemeVariant.LIGHT -> light.takeIf { usable } ?: BUILTIN_PALETTES.getValue(ThemeVariant.LIGHT)
        ThemeVariant.DARK -> dark.takeIf { usable } ?: BUILTIN_PALETTES.getValue(ThemeVariant.DARK)
    }
    return MappedTheme(
        variant = variant,
        colorScheme = colorSchemeOf(palette),
        shapes = shapesOf(if (usable) theme!!.radius else BUILTIN_THEME_RADIUS),
        focus = palette[ThemeToken.FOCUS],
        pressedPrimary = palette[ThemeToken.PRIMARY_HOVER],
        pressedDanger = palette[ThemeToken.DANGER_HOVER],
        builtIn = !usable,
        fellBack = fellBack,
    )
}
