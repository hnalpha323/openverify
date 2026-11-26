package dev.openverify.sdk.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.LayoutDirection
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_logo_description
import dev.openverify.sdk.i18n.LanguageChoice
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.i18n.OperatorCopy
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.chooseLanguage
import dev.openverify.sdk.i18n.isRightToLeft
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.theme.LanguageSelection
import dev.openverify.sdk.ui.theme.LocalLanguageChoice
import dev.openverify.sdk.ui.theme.LocalLanguageSelection
import dev.openverify.sdk.ui.theme.LocalOpenVerifyColors
import dev.openverify.sdk.ui.theme.LocalSessionLook
import dev.openverify.sdk.ui.theme.LocalThemeAssets
import dev.openverify.sdk.ui.theme.LocalThemeBrand
import dev.openverify.sdk.ui.theme.OpenVerifyColors
import dev.openverify.sdk.ui.theme.SessionLook
import dev.openverify.sdk.ui.theme.SystemBarIcons
import dev.openverify.sdk.ui.theme.ThemeAssetSource
import dev.openverify.sdk.ui.theme.ThemeBrand
import dev.openverify.sdk.ui.theme.decodeLogo
import dev.openverify.sdk.ui.theme.loadLogo
import dev.openverify.sdk.ui.theme.mappedThemeOf

/**
 * The root of every SDK screen (C198, C199): the session's theme mapped onto Material 3, the chosen
 * language and its layout direction, and the chrome's inputs, for the composition below it only.
 * The host's own theme, configuration and JVM default locale are never read back or changed.
 *
 * - **Theme** (C198.1, C198.2, C198.5): [look]'s theme, already checked ([SessionLook.of]), through
 *   `mappedThemeOf`; [appearance] `LIGHT` or `DARK` forces a variant, `SYSTEM` follows [systemDark]
 *   as the session's mode allows, and a forced dark with no session dark palette draws the built-in
 *   dark one. No session theme draws the built-in palettes, shared with the web
 *   (`contracts/fixtures/theme/builtin-palettes.json`). The typography is Material's default over
 *   the system font, always (C198.4). The tokens Material has no role for are
 *   [LocalOpenVerifyColors].
 * - **Bars** (C198.7): dark icons over a light surface, light over a dark one.
 * - **Language** (C199.2, C199.4, C199.5): the person's choice in the selector ([language]), then
 *   [requestedLocale] (`Request.locale`), then the device's locales, by RFC 4647 lookup among the
 *   version's enabled locales the SDK bundles, then the version's default, then English
 *   (`chooseLanguage`). It is the facade's language ([LocalSdkLanguage]) and sets
 *   [LocalLayoutDirection]: Arabic lays out right to left even in a host without
 *   `android:supportsRtl`, and every other SDK language left to right on an Arabic device.
 * - **Brand** (C198.3): the theme's logo, fetched once through [themeAssets], checked before it is
 *   decoded, described by its alt-key's operator text (or the organisation's name), or decorative
 *   beside the organisation's name; until it is shown, or when it cannot be, the name alone.
 */
@Composable
internal fun OpenVerifyTheme(
    look: SessionLook = SessionLook.NONE,
    appearance: Appearance = Appearance.SYSTEM,
    requestedLocale: String? = null,
    language: LanguageSelection = remember { LanguageSelection() },
    themeAssets: ThemeAssetSource? = null,
    systemDark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val mapped = remember(look.theme, appearance, systemDark) { mappedThemeOf(look.theme, appearance, systemDark) }
    val device = LocaleList.current.localeList.map { it.toLanguageTag() }
    val choice = chooseLanguage(language.selected, requestedLocale, device, look.locales)
    SystemBarIcons(lightBackground = mapped.colorScheme.surface.luminance() > 0.5f)
    CompositionLocalProvider(
        LocalSdkLanguage provides choice.language,
        LocalLanguageChoice provides choice,
        LocalLanguageSelection provides language,
        LocalLayoutDirection provides if (isRightToLeft(choice.language)) LayoutDirection.Rtl else LayoutDirection.Ltr,
        LocalSessionLook provides look,
        LocalThemeAssets provides themeAssets,
        LocalOpenVerifyColors provides OpenVerifyColors(mapped.focus, mapped.pressedPrimary, mapped.pressedDanger, mapped.variant),
    ) {
        CompositionLocalProvider(LocalThemeBrand provides themeBrand(look, choice, themeAssets)) {
            MaterialTheme(colorScheme = mapped.colorScheme, shapes = mapped.shapes, content = content)
        }
    }
}

/** C198.3: what the brand header shows for [look]'s logo, or null when the theme has none. */
@Composable
private fun themeBrand(look: SessionLook, choice: LanguageChoice, themeAssets: ThemeAssetSource?): ThemeBrand? {
    val logo = look.theme?.logo
    val image by produceState<ImageBitmap?>(null, logo?.assetId, themeAssets) {
        value = null
        if (logo != null && themeAssets != null) value = loadLogo(themeAssets, logo.assetId, ::decodeLogo)
    }
    if (logo == null) return null
    val name = look.organizationDisplayName
    val organization = name?.let { mapOf("organization" to it) }.orEmpty()
    val alt = logo.altKey?.let { key ->
        OperatorCopy(look.copy, choice.language, look.locales?.default ?: SDK_DEFAULT_LANGUAGE).component(key, organization)?.text?.logical
    }
    val shown = image
    return when {
        shown == null -> ThemeBrand(null, null, name ?: alt)
        logo.decorative -> ThemeBrand(shown, null, name)
        else -> ThemeBrand(shown, alt ?: name ?: sdkString(Res.string.openverify_logo_description), null)
    }
}
