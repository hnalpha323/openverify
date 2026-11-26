package dev.openverify.sdk.ui.theme

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.pow

/**
 * The goldens' operator palettes pass Phase 9's contrast gate (C160.4's sixteen pairs, `CONTRAST_PAIRS`
 * in `packages/core/src/contrast/index.ts`: 4.5:1 for text, labels and links, 3:1 for controls and
 * focus, WCAG's relative luminance, never rounded), so each golden shows a palette a server could
 * serve (C198.8).
 */
internal class ThemeFixturesTest {

    private val pairs: List<Triple<String, String, Double>> = listOf(
        Triple("ink", "surface", 4.5), Triple("ink", "canvas", 4.5),
        Triple("ink-muted", "surface", 4.5), Triple("ink-muted", "canvas", 4.5),
        Triple("danger", "surface", 4.5), Triple("danger", "canvas", 4.5),
        Triple("on-primary", "primary", 4.5), Triple("on-primary", "primary-hover", 4.5),
        Triple("on-primary", "danger", 4.5), Triple("on-primary", "danger-hover", 4.5),
        Triple("primary", "surface", 4.5),
        Triple("control", "surface", 3.0), Triple("control", "canvas", 3.0),
        Triple("focus", "surface", 3.0), Triple("focus", "canvas", 3.0), Triple("focus", "primary", 3.0),
    )

    private fun luminance(hex: String): Double {
        val (red, green, blue) = listOf(1, 3, 5).map { at ->
            val channel = hex.substring(at, at + 2).toInt(16) / 255.0
            if (channel <= 0.04045) channel / 12.92 else ((channel + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }

    private fun ratio(first: String, second: String): Double {
        val (lighter, darker) = listOf(luminance(first), luminance(second)).sortedDescending()
        return (lighter + 0.05) / (darker + 0.05)
    }

    @Test
    fun `the light and dark operator palettes pass every pair of the gate`() {
        for ((name, palette) in listOf("light" to ThemeFixtures.LIGHT, "dark" to ThemeFixtures.DARK)) {
            for ((foreground, background, required) in pairs) {
                val ratio = ratio(palette.getValue(foreground), palette.getValue(background))
                assertTrue(ratio >= required, "$name $foreground on $background: $ratio < $required")
            }
        }
    }
}
