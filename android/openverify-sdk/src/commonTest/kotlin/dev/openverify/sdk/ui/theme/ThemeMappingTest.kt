package dev.openverify.sdk.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.contentColorFor
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.model.FlowThemeFont
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C198.2 (review H04), C198.5 (review H21): the twelve tokens onto every Material 3 role, the radius
 * onto `Shapes`, the variant from `mode`, the dark palette and the `appearance` option, and the
 * built-in palettes shared with the web through `contracts/fixtures/theme/builtin-palettes.json`.
 */
internal class ThemeMappingTest {

    private val fixture = Json.parseToJsonElement(readContractFixture("theme/builtin-palettes.json")).jsonObject

    private fun fixturePalette(variant: String): Map<String, String> =
        fixture.getValue(variant).jsonObject.mapValues { it.value.jsonPrimitive.content }

    /** A palette whose twelve colours differ from each other and from every Material baseline colour. */
    private val distinct: Map<String, String> = ThemeToken.entries.mapIndexed { index, token ->
        token.wire to "#0${(index + 1).toString(16)}${(index + 1).toString(16)}0${(index + 3).toString(16)}${(index + 1).toString(16)}"
    }.toMap()

    /**
     * Workflow 10A integration-10a (android-theme's finding): Material 3 picks a container's content
     * colour by the first role in `contentColorFor`'s order that equals it, and that order reaches
     * `errorContainer` before `surface`. So no role Material checks before `surface` may equal it, or
     * every `Surface` draws its text in `danger`. Over the built-in palettes and an operator palette.
     */
    @Test
    fun textOnTheSurfaceFamilyIsInkNotDanger() {
        val palettes = listOf(fixturePalette("light"), fixturePalette("dark"), distinct).map { assertNotNull(ThemePalette.of(it)) }
        for (palette in palettes) {
            val scheme = colorSchemeOf(palette)
            val ink = palette[ThemeToken.INK]
            for ((role, container) in listOf(
                "surface" to scheme.surface,
                "surfaceContainerLow" to scheme.surfaceContainerLow,
                "surfaceContainerHigh" to scheme.surfaceContainerHigh,
                "surfaceContainerHighest" to scheme.surfaceContainerHighest,
                "background" to scheme.background,
            )) {
                assertEquals(hex(ink), hex(scheme.contentColorFor(container)), "text on $role")
            }
        }
    }

    private fun hex(colour: Color): String = "#" + (colour.toArgb() and 0xffffff).toString(16).padStart(6, '0')

    private fun theme(mode: String, dark: Map<String, String>?, radius: Int = 8, light: Map<String, String> = distinct): FlowTheme =
        FlowTheme(
            themeSetId = "theset_synthetic",
            revision = 1,
            mode = mode,
            light = light,
            dark = dark,
            radius = radius,
            font = FlowThemeFont(kind = "system", platforms = listOf("web", "android")),
            logo = null,
            placement = "header",
        )

    @Test
    fun aPaletteIsExactlyTheTwelveTokensEachLowerCaseHex() {
        assertNotNull(ThemePalette.of(distinct))
        assertEquals(distinct.keys, ThemeToken.entries.map { it.wire }.toSet())
        assertNull(ThemePalette.of(distinct - "focus"), "a missing token")
        assertNull(ThemePalette.of(distinct + ("on-danger" to "#ffffff")), "a token outside the twelve")
        assertNull(ThemePalette.of(distinct + ("primary" to "#1447E6")), "upper case")
        assertNull(ThemePalette.of(distinct + ("primary" to "#1447e")), "five digits")
        assertNull(ThemePalette.of(distinct + ("primary" to "1447e6")), "no hash")
        assertNull(ThemePalette.of(distinct + ("primary" to "#1447e6ff")), "alpha")
        assertNull(ThemePalette.of(distinct + ("primary" to "#1447g6")), "not hex")
        assertNull(ThemePalette.of(distinct + ("primary" to "red")), "a name")
        val palette = ThemePalette.of(distinct)!!
        assertEquals(distinct["ink-muted"], hex(palette[ThemeToken.INK_MUTED]))
    }

    @Test
    fun theBuiltInPalettesAreTheWebsFromTheSharedFixture() {
        assertEquals(ThemeToken.entries.map { it.wire }, fixture.getValue("tokens").jsonArray.map { it.jsonPrimitive.content })
        for ((variant, name) in listOf(ThemeVariant.LIGHT to "light", ThemeVariant.DARK to "dark")) {
            val builtIn = BUILTIN_PALETTES.getValue(variant)
            assertEquals(fixturePalette(name), ThemeToken.entries.associate { it.wire to hex(builtIn[it]) }, name)
        }
    }

    @Test
    fun everyRoleIsSetFromATokenAsTheTableStates() {
        val expected = mapOf(
            "primary" to "primary", "onPrimary" to "on-primary",
            "primaryContainer" to "canvas", "onPrimaryContainer" to "ink", "inversePrimary" to "surface",
            "secondary" to "primary", "onSecondary" to "on-primary",
            "secondaryContainer" to "canvas", "onSecondaryContainer" to "ink",
            "tertiary" to "primary", "onTertiary" to "on-primary",
            "tertiaryContainer" to "canvas", "onTertiaryContainer" to "ink",
            "background" to "canvas", "onBackground" to "ink",
            "surface" to "surface", "onSurface" to "ink",
            "surfaceVariant" to "surface", "onSurfaceVariant" to "ink-muted", "surfaceTint" to "surface",
            "inverseSurface" to "ink", "inverseOnSurface" to "surface",
            "error" to "danger", "onError" to "on-primary",
            "errorContainer" to "canvas", "onErrorContainer" to "danger",
            "outline" to "control", "outlineVariant" to "line",
            "surfaceBright" to "surface", "surfaceDim" to "canvas",
            "surfaceContainer" to "canvas", "surfaceContainerHigh" to "surface",
            "surfaceContainerHighest" to "surface", "surfaceContainerLow" to "surface",
            "surfaceContainerLowest" to "surface",
            "primaryFixed" to "canvas", "primaryFixedDim" to "canvas",
            "onPrimaryFixed" to "ink", "onPrimaryFixedVariant" to "ink",
            "secondaryFixed" to "canvas", "secondaryFixedDim" to "canvas",
            "onSecondaryFixed" to "ink", "onSecondaryFixedVariant" to "ink",
            "tertiaryFixed" to "canvas", "tertiaryFixedDim" to "canvas",
            "onTertiaryFixed" to "ink", "onTertiaryFixedVariant" to "ink",
        )
        val table = COLOR_SCHEME_ROLES.mapValues { (_, source) -> (source as? RoleSource.Token)?.token?.wire ?: "black" }
        assertEquals(expected + ("scrim" to "black"), table)
    }

    @Test
    fun theSchemeTakesEachRoleFromThePaletteAndKeepsNoBaseline() {
        val palette = ThemePalette.of(distinct)!!
        val scheme = colorSchemeOf(palette)
        val roles = schemeRoles(scheme)
        assertEquals(COLOR_SCHEME_ROLES.keys, roles.keys)
        val wrong = COLOR_SCHEME_ROLES.mapNotNull { (role, source) ->
            val expected = when (source) {
                is RoleSource.Token -> palette[source.token]
                RoleSource.BLACK -> Color.Black
            }
            if (roles.getValue(role) == expected) null else "$role: ${hex(roles.getValue(role))}"
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun theRadiusMapsOntoShapesAsTheWebScaleAroundIt() {
        val eight = shapesOf(8)
        assertEquals(RoundedCornerShape(6.dp), eight.extraSmall)
        assertEquals(RoundedCornerShape(8.dp), eight.small)
        assertEquals(RoundedCornerShape(8.dp), eight.medium)
        assertEquals(RoundedCornerShape(10.dp), eight.large)
        assertEquals(RoundedCornerShape(14.dp), eight.extraLarge)
        val square = shapesOf(0)
        assertEquals(RoundedCornerShape(0.dp), square.extraSmall)
        assertEquals(RoundedCornerShape(6.dp), square.extraLarge)
        assertEquals(RoundedCornerShape(22.dp), shapesOf(24).extraSmall)
        assertEquals(RoundedCornerShape(24.dp), shapesOf(24).medium)
        assertEquals(shapesOf(BUILTIN_THEME_RADIUS).medium, shapesOf(25).medium, "outside 0 to 24, the built-in radius")
        assertEquals(shapesOf(BUILTIN_THEME_RADIUS).medium, shapesOf(-1).medium)
    }

    @Test
    fun theVariantFollowsTheModeTheDarkPaletteAndTheAppearance() {
        val cases = listOf(
            // mode, has dark, appearance, system dark -> variant
            Triple("auto", true, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.DARK),
            Triple("light", false, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
            Triple("light", true, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
            Triple("dark", true, Appearance.SYSTEM) to mapOf(false to ThemeVariant.DARK, true to ThemeVariant.DARK),
            Triple("dark", false, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
            Triple("auto", true, Appearance.LIGHT) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
            Triple("auto", true, Appearance.DARK) to mapOf(false to ThemeVariant.DARK, true to ThemeVariant.DARK),
            Triple("light", false, Appearance.DARK) to mapOf(false to ThemeVariant.DARK, true to ThemeVariant.DARK),
            Triple(null, true, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.DARK),
            Triple(null, true, Appearance.LIGHT) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
            Triple("sepia", true, Appearance.SYSTEM) to mapOf(false to ThemeVariant.LIGHT, true to ThemeVariant.LIGHT),
        )
        val wrong = cases.flatMap { (input, answers) ->
            answers.mapNotNull { (systemDark, expected) ->
                val got = themeVariantOf(input.first, input.second, input.third, systemDark)
                if (got == expected) null else "$input, system dark $systemDark: $got"
            }
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun aSessionWithNoThemeDrawsTheBuiltInPalettes() {
        val light = mappedThemeOf(null, Appearance.SYSTEM, systemDark = false)
        assertTrue(light.builtIn)
        assertFalse(light.fellBack)
        assertEquals(ThemeVariant.LIGHT, light.variant)
        assertEquals(BUILTIN_PALETTES.getValue(ThemeVariant.LIGHT)[ThemeToken.PRIMARY], light.colorScheme.primary)
        assertEquals(shapesOf(BUILTIN_THEME_RADIUS).medium, light.shapes.medium)
        val dark = mappedThemeOf(null, Appearance.SYSTEM, systemDark = true)
        assertEquals(ThemeVariant.DARK, dark.variant)
        assertEquals(BUILTIN_PALETTES.getValue(ThemeVariant.DARK)[ThemeToken.SURFACE], dark.colorScheme.surface)
    }

    @Test
    fun aSessionThemeDrawsItsOwnPaletteRadiusAndTheTokensMaterialHasNoRoleFor() {
        val mapped = mappedThemeOf(theme("light", dark = null, radius = 12), Appearance.SYSTEM, systemDark = true)
        assertFalse(mapped.builtIn)
        assertFalse(mapped.fellBack)
        assertEquals(ThemeVariant.LIGHT, mapped.variant)
        val palette = ThemePalette.of(distinct)!!
        assertEquals(palette[ThemeToken.PRIMARY], mapped.colorScheme.primary)
        assertEquals(palette[ThemeToken.FOCUS], mapped.focus)
        assertEquals(palette[ThemeToken.PRIMARY_HOVER], mapped.pressedPrimary)
        assertEquals(palette[ThemeToken.DANGER_HOVER], mapped.pressedDanger)
        assertEquals(RoundedCornerShape(12.dp), mapped.shapes.medium)
    }

    @Test
    fun aDarkVariantDrawsTheSessionsDarkPaletteOrForcedTheBuiltInOne() {
        val dark = fixturePalette("light").mapValues { "#101010" } + ("on-primary" to "#fefefe")
        val auto = mappedThemeOf(theme("auto", dark = dark), Appearance.SYSTEM, systemDark = true)
        assertEquals(ThemeVariant.DARK, auto.variant)
        assertEquals(ThemePalette.of(dark)!![ThemeToken.SURFACE], auto.colorScheme.surface)
        val forced = mappedThemeOf(theme("light", dark = null), Appearance.DARK, systemDark = false)
        assertEquals(ThemeVariant.DARK, forced.variant)
        assertFalse(forced.builtIn)
        assertEquals(BUILTIN_PALETTES.getValue(ThemeVariant.DARK)[ThemeToken.SURFACE], forced.colorScheme.surface, "C198.5: a forced dark with no dark palette")
    }

    @Test
    fun aThemeTheSdkCannotUseFallsBackToTheBuiltInThemeForTheWholeSession() {
        val badLight = mappedThemeOf(theme("auto", dark = distinct, light = distinct + ("primary" to "#FFFFFF")), Appearance.SYSTEM, systemDark = false)
        assertTrue(badLight.builtIn)
        assertTrue(badLight.fellBack)
        assertEquals(BUILTIN_PALETTES.getValue(ThemeVariant.LIGHT)[ThemeToken.PRIMARY], badLight.colorScheme.primary)
        val badDark = mappedThemeOf(theme("auto", dark = distinct - "line"), Appearance.SYSTEM, systemDark = false)
        assertTrue(badDark.fellBack, "an unusable dark palette fails the whole theme, even while light is drawn")
        assertEquals(BUILTIN_PALETTES.getValue(ThemeVariant.LIGHT)[ThemeToken.SURFACE], badDark.colorScheme.surface)
        val badRadius = mappedThemeOf(theme("light", dark = null, radius = 30), Appearance.SYSTEM, systemDark = false)
        assertTrue(badRadius.fellBack)
        assertEquals(shapesOf(BUILTIN_THEME_RADIUS).medium, badRadius.shapes.medium)
    }
}
