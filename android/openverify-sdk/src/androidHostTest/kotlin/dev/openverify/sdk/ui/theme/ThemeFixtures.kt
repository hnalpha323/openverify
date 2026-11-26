package dev.openverify.sdk.ui.theme

import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.model.FlowThemeFont
import dev.openverify.sdk.model.FlowThemeLogo

/**
 * A synthetic operator theme for android-theme's tests and goldens (C198.8: a non-default palette
 * that passes Phase 9's gate, C160.4; `ThemeFixturesTest` holds its pairs to the gate's ratios).
 */
internal object ThemeFixtures {
    val LIGHT: Map<String, String> = mapOf(
        "primary" to "#0b6e4f",
        "primary-hover" to "#08553d",
        "on-primary" to "#ffffff",
        "danger" to "#b3261e",
        "danger-hover" to "#8c1d18",
        "surface" to "#ffffff",
        "canvas" to "#f2f7f5",
        "ink" to "#10201a",
        "ink-muted" to "#46564f",
        "line" to "#c8d5cf",
        "control" to "#66756e",
        "focus" to "#000000",
    )

    val DARK: Map<String, String> = mapOf(
        "primary" to "#5dd6a8",
        "primary-hover" to "#8fe6c4",
        "on-primary" to "#04120d",
        "danger" to "#ff8a80",
        "danger-hover" to "#ffb4ab",
        "surface" to "#10201a",
        "canvas" to "#08130f",
        "ink" to "#eef7f3",
        "ink-muted" to "#a9bdb4",
        "line" to "#2e4038",
        "control" to "#7f948b",
        "focus" to "#696969",
    )

    const val LOGO_ASSET: String = "tas_synthetic_logo"
    const val LOGO_ALT_KEY: String = "theme.logo.alt"

    fun theme(
        mode: String = "auto",
        light: Map<String, String> = LIGHT,
        dark: Map<String, String>? = DARK,
        radius: Int = 12,
        logo: FlowThemeLogo? = null,
        placement: String = "header",
    ): FlowTheme = FlowTheme(
        themeSetId = "tset_synthetic",
        revision = 3,
        mode = mode,
        light = light,
        dark = dark,
        radius = radius,
        font = FlowThemeFont("system", platforms = listOf("web", "android")),
        logo = logo,
        placement = placement,
    )

    fun logo(decorative: Boolean = false): FlowThemeLogo =
        FlowThemeLogo(assetId = LOGO_ASSET, altKey = if (decorative) null else LOGO_ALT_KEY, decorative = decorative)
}
