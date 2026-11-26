package dev.openverify.sdk.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C198.2, C198.6 (review H04): every foreground and background pair the SDK's composables draw, run
 * through the mapped scheme, against boundary palettes that pass Phase 9's contrast gate (C160.4)
 * with their gated pairs at the gate's minimums, 4.5:1 and 3:1. A pair the mapping placed on a
 * background the gate never checked would fall below its minimum on such a palette, so this proves
 * the mapping draws only gated pairs, not that any screen meets WCAG (C198.8; C212 checks screens).
 *
 * The SDK does not re-judge an operator's palette (C198.6): the gate below is a test copy of
 * `packages/core/src/contrast/index.ts` (WCAG 2.2 relative luminance, never rounded).
 */
internal class ThemeContrastTest {

    private enum class Purpose(val minimum: Double?) { TEXT(4.5), NON_TEXT(3.0), DECORATIVE(null), DISABLED(null) }

    /** One pair a composable draws: [foreground] over [background], each a role or a token Material has no role for. */
    private class Drawn(val what: String, val foreground: (MappedTheme) -> Color, val background: (MappedTheme) -> Color, val purpose: Purpose)

    private fun pair(what: String, foreground: (ColorScheme) -> Color, background: (ColorScheme) -> Color, purpose: Purpose) =
        Drawn(what, { foreground(it.colorScheme) }, { background(it.colorScheme) }, purpose)

    /**
     * The table (C198.2: "a pair the table states and tests"). Material 3 1.4.0's defaults for the
     * components the SDK uses (Button, TextButton, OutlinedButton, OutlinedTextField, Checkbox,
     * RadioButton, Card on errorContainer, DropdownMenu, CircularProgressIndicator,
     * HorizontalDivider, Snackbar) and the SDK's own text, every screen drawn on `surface`
     * (`InquiryFlowScreen`'s root `Surface`).
     */
    private val drawn: List<Drawn> = listOf(
        pair("body text", { it.onSurface }, { it.surface }, Purpose.TEXT),
        pair("text on the background", { it.onBackground }, { it.background }, Purpose.TEXT),
        pair("labels, hints, supporting text, outlined button labels", { it.onSurfaceVariant }, { it.surface }, Purpose.TEXT),
        pair("error text and field errors", { it.error }, { it.surface }, Purpose.TEXT),
        pair("error text on the background", { it.error }, { it.background }, Purpose.TEXT),
        pair("filled button label, checkbox check", { it.onPrimary }, { it.primary }, Purpose.TEXT),
        pair("text button label, focused field label, links", { it.primary }, { it.surface }, Purpose.TEXT),
        pair("the error card", { it.onErrorContainer }, { it.errorContainer }, Purpose.TEXT),
        pair("menu items", { it.onSurface }, { it.surfaceContainer }, Purpose.TEXT),
        pair("menu item icons", { it.onSurfaceVariant }, { it.surfaceContainer }, Purpose.TEXT),
        pair("dialog and date picker text", { it.onSurface }, { it.surfaceContainerHigh }, Purpose.TEXT),
        pair("dialog and date picker buttons", { it.primary }, { it.surfaceContainerHigh }, Purpose.TEXT),
        pair("cards and filled fields", { it.onSurface }, { it.surfaceContainerHighest }, Purpose.TEXT),
        pair("their labels", { it.onSurfaceVariant }, { it.surfaceContainerHighest }, Purpose.TEXT),
        pair("bottom sheets and elevated buttons", { it.primary }, { it.surfaceContainerLow }, Purpose.TEXT),
        pair("tonal containers", { it.onPrimaryContainer }, { it.primaryContainer }, Purpose.TEXT),
        pair("secondary containers", { it.onSecondaryContainer }, { it.secondaryContainer }, Purpose.TEXT),
        pair("tertiary containers", { it.onTertiaryContainer }, { it.tertiaryContainer }, Purpose.TEXT),
        pair("a danger button's label", { it.onError }, { it.error }, Purpose.TEXT),
        pair("snackbar text", { it.inverseOnSurface }, { it.inverseSurface }, Purpose.TEXT),
        pair("snackbar action", { it.inversePrimary }, { it.inverseSurface }, Purpose.TEXT),
        Drawn("a pressed filled button", { it.colorScheme.onPrimary }, { it.pressedPrimary }, Purpose.TEXT),
        Drawn("a pressed danger button", { it.colorScheme.onError }, { it.pressedDanger }, Purpose.TEXT),
        pair("field outline", { it.outline }, { it.surface }, Purpose.NON_TEXT),
        pair("field outline on the background", { it.outline }, { it.background }, Purpose.NON_TEXT),
        pair("focused field outline, checked box, progress", { it.primary }, { it.surface }, Purpose.NON_TEXT),
        pair("unchecked box and radio", { it.onSurfaceVariant }, { it.surface }, Purpose.NON_TEXT),
        pair("error outline", { it.error }, { it.surface }, Purpose.NON_TEXT),
        Drawn("focus indicator", { it.focus }, { it.colorScheme.surface }, Purpose.NON_TEXT),
        Drawn("focus indicator on the background", { it.focus }, { it.colorScheme.background }, Purpose.NON_TEXT),
        Drawn("focus indicator on a filled button", { it.focus }, { it.colorScheme.primary }, Purpose.NON_TEXT),
        pair("dividers and outlined button borders (decorative: line has no gated pair, C160.4)", { it.outlineVariant }, { it.surface }, Purpose.DECORATIVE),
        pair("disabled text and controls (inactive components are outside WCAG 1.4.3 and 1.4.11)", { it.onSurface.copy(alpha = 0.38f) }, { it.surface }, Purpose.DISABLED),
        pair("a disabled button's container", { it.onSurface.copy(alpha = 0.12f) }, { it.surface }, Purpose.DISABLED),
    )

    private fun channels(colour: Color): IntArray {
        val argb = colour.toArgb()
        return intArrayOf((argb shr 16) and 0xff, (argb shr 8) and 0xff, argb and 0xff)
    }

    private fun linear(byte: Int): Double {
        val channel = byte / 255.0
        return if (channel <= 0.04045) channel / 12.92 else ((channel + 0.055) / 1.055).pow(2.4)
    }

    private fun luminance(colour: Color): Double {
        val (red, green, blue) = channels(colour).map(::linear)
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }

    private fun ratio(first: Color, second: Color): Double {
        val a = luminance(first)
        val b = luminance(second)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    private fun grey(level: Int): Color = Color(level, level, level)

    /** The opaque colour [over] shows when [colour] (with alpha) is drawn on it. */
    private fun composite(colour: Color, over: Color): Color {
        val alpha = colour.alpha
        val top = channels(colour.copy(alpha = 1f))
        val bottom = channels(over)
        return Color(
            (top[0] * alpha + bottom[0] * (1 - alpha)).toInt(),
            (top[1] * alpha + bottom[1] * (1 - alpha)).toInt(),
            (top[2] * alpha + bottom[2] * (1 - alpha)).toInt(),
        )
    }

    /** C160.4's gated pairs and their minimums (`CONTRAST_PAIRS`). */
    private val gated: List<Triple<ThemeToken, ThemeToken, Double>> = listOf(
        Triple(ThemeToken.INK, ThemeToken.SURFACE, 4.5), Triple(ThemeToken.INK, ThemeToken.CANVAS, 4.5),
        Triple(ThemeToken.INK_MUTED, ThemeToken.SURFACE, 4.5), Triple(ThemeToken.INK_MUTED, ThemeToken.CANVAS, 4.5),
        Triple(ThemeToken.DANGER, ThemeToken.SURFACE, 4.5), Triple(ThemeToken.DANGER, ThemeToken.CANVAS, 4.5),
        Triple(ThemeToken.ON_PRIMARY, ThemeToken.PRIMARY, 4.5), Triple(ThemeToken.ON_PRIMARY, ThemeToken.PRIMARY_HOVER, 4.5),
        Triple(ThemeToken.ON_PRIMARY, ThemeToken.DANGER, 4.5), Triple(ThemeToken.ON_PRIMARY, ThemeToken.DANGER_HOVER, 4.5),
        Triple(ThemeToken.PRIMARY, ThemeToken.SURFACE, 4.5),
        Triple(ThemeToken.CONTROL, ThemeToken.SURFACE, 3.0), Triple(ThemeToken.CONTROL, ThemeToken.CANVAS, 3.0),
        Triple(ThemeToken.FOCUS, ThemeToken.SURFACE, 3.0), Triple(ThemeToken.FOCUS, ThemeToken.CANVAS, 3.0),
        Triple(ThemeToken.FOCUS, ThemeToken.PRIMARY, 3.0),
    )

    /** The grey nearest [minimum] against [against] on the side away from it (darker for a light background). */
    private fun boundaryGrey(minimum: Double, against: Color, darker: Boolean): Color {
        val levels = if (darker) (255 downTo 0) else (0..255)
        return levels.map(::grey).first { ratio(it, against) >= minimum }
    }

    /**
     * Two palettes at the gate's edge. Light: `surface` white over a darker `canvas`, so a text on
     * `canvas` passes only when it was checked there; `primary` is the lightest grey that passes on
     * `surface` (so it fails on `canvas`), `control` the lightest at 3:1 on `canvas`. Dark: the mirror
     * image, `surface` lighter than `canvas`, with every text at its minimum on `surface`.
     */
    private fun boundaryPalettes(): List<Pair<String, ThemePalette>> {
        val white = grey(255)
        val lightCanvas = grey(232)
        val light = mapOf(
            ThemeToken.SURFACE to white,
            ThemeToken.CANVAS to lightCanvas,
            ThemeToken.PRIMARY to boundaryGrey(4.5, white, darker = true),
            ThemeToken.PRIMARY_HOVER to grey(80),
            ThemeToken.ON_PRIMARY to white,
            ThemeToken.DANGER to boundaryGrey(4.5, lightCanvas, darker = true),
            ThemeToken.DANGER_HOVER to grey(60),
            ThemeToken.INK to boundaryGrey(4.5, lightCanvas, darker = true),
            ThemeToken.INK_MUTED to boundaryGrey(4.5, lightCanvas, darker = true),
            ThemeToken.LINE to grey(210),
            ThemeToken.CONTROL to boundaryGrey(3.0, lightCanvas, darker = true),
            ThemeToken.FOCUS to grey(0),
        )
        val darkSurface = grey(40)
        val darkCanvas = grey(8)
        val dark = mapOf(
            ThemeToken.SURFACE to darkSurface,
            ThemeToken.CANVAS to darkCanvas,
            ThemeToken.PRIMARY to boundaryGrey(4.5, darkSurface, darker = false),
            ThemeToken.PRIMARY_HOVER to grey(200),
            ThemeToken.ON_PRIMARY to grey(0),
            ThemeToken.DANGER to boundaryGrey(4.5, darkSurface, darker = false),
            ThemeToken.DANGER_HOVER to grey(220),
            ThemeToken.INK to boundaryGrey(4.5, darkSurface, darker = false),
            ThemeToken.INK_MUTED to boundaryGrey(4.5, darkSurface, darker = false),
            ThemeToken.LINE to grey(60),
            ThemeToken.CONTROL to boundaryGrey(3.0, darkSurface, darker = false),
            ThemeToken.FOCUS to grey(255),
        )
        return listOf("light", "dark").zip(listOf(light, dark)) { name, colours ->
            name to ThemePalette.of(colours.entries.associate { (token, colour) -> token.wire to "#" + (colour.toArgb() and 0xffffff).toString(16).padStart(6, '0') })!!
        }
    }

    @Test
    fun theBoundaryPalettesPassTheGateAtItsMinimums() {
        for ((name, palette) in boundaryPalettes()) {
            val ratios = gated.map { (foreground, background, minimum) -> Triple(foreground to background, ratio(palette[foreground], palette[background]), minimum) }
            assertEquals(emptyList(), ratios.filter { it.second < it.third }.map { it.first }, "$name passes the gate")
            for (minimum in listOf(4.5, 3.0)) {
                assertTrue(ratios.any { it.third == minimum && it.second < minimum + 0.15 }, "$name has a pair at $minimum:1")
            }
        }
    }

    @Test
    fun everyPairTheSdkDrawsMeetsItsMinimumThroughTheMappedScheme() {
        val failures = boundaryPalettes().flatMap { (name, palette) ->
            val variant = if (name == "light") ThemeVariant.LIGHT else ThemeVariant.DARK
            val theme = mappedPaletteTheme(palette, variant)
            drawn.mapNotNull { pair ->
                val minimum = pair.purpose.minimum ?: return@mapNotNull null
                val value = ratio(pair.foreground(theme), pair.background(theme))
                if (value >= minimum) null else "$name, ${pair.what}: ${(value * 100).toInt() / 100.0}:1 under $minimum:1"
            }
        }
        assertEquals(emptyList(), failures)
    }

    @Test
    fun theDecorativeAndDisabledPairsAreDrawnFromThePaletteNeverFromMaterialsBaseline() {
        for ((name, palette) in boundaryPalettes()) {
            val theme = mappedPaletteTheme(palette, ThemeVariant.LIGHT)
            assertEquals(palette[ThemeToken.LINE], theme.colorScheme.outlineVariant, name)
            for (pair in drawn.filter { it.purpose == Purpose.DISABLED }) {
                val shown = composite(pair.foreground(theme), pair.background(theme))
                val ink = palette[ThemeToken.INK]
                val surface = palette[ThemeToken.SURFACE]
                assertTrue(ratio(shown, surface) <= ratio(ink, surface), "$name, ${pair.what}: drawn from ink over surface")
            }
        }
    }

    @Test
    fun theBuiltInPalettesDrawEveryPairAtItsMinimum() {
        val failures = ThemeVariant.entries.flatMap { variant ->
            val theme = mappedPaletteTheme(BUILTIN_PALETTES.getValue(variant), variant)
            drawn.mapNotNull { pair ->
                val minimum = pair.purpose.minimum ?: return@mapNotNull null
                if (ratio(pair.foreground(theme), pair.background(theme)) >= minimum) null else "$variant: ${pair.what}"
            }
        }
        assertEquals(emptyList(), failures)
    }

    private fun mappedPaletteTheme(palette: ThemePalette, variant: ThemeVariant): MappedTheme =
        MappedTheme(
            variant = variant,
            colorScheme = colorSchemeOf(palette),
            shapes = shapesOf(BUILTIN_THEME_RADIUS),
            focus = palette[ThemeToken.FOCUS],
            pressedPrimary = palette[ThemeToken.PRIMARY_HOVER],
            pressedDanger = palette[ThemeToken.DANGER_HOVER],
            builtIn = false,
            fellBack = false,
        )
}
