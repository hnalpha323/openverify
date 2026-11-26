package dev.openverify.sdk.ui

import android.app.Activity
import android.graphics.Bitmap
import android.view.View
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_cancel
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.ui.theme.LanguageSelection
import dev.openverify.sdk.ui.theme.LocalOpenVerifyColors
import dev.openverify.sdk.ui.theme.LocalThemeBrand
import dev.openverify.sdk.ui.theme.OpenVerifyColors
import dev.openverify.sdk.ui.theme.SessionLook
import dev.openverify.sdk.ui.theme.ThemeAssetSource
import dev.openverify.sdk.ui.theme.ThemeBrand
import dev.openverify.sdk.ui.theme.ThemeFixtures
import dev.openverify.sdk.ui.theme.ThemeVariant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/**
 * C198 and C199 applied at the root of the SDK's composition: the session's palette and radius are
 * what Material draws (C198.2), `Appearance` and the session's mode pick the variant (C198.5), the
 * extra tokens and the logo reach the chrome (C198.2, C198.3), the bar icons follow the palette
 * (C198.7), and the chosen language (C199.2) is the facade's language and the layout's direction
 * (C199.4, C199.5) whatever the process locale says.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
internal class OpenVerifyThemeTest {

    @get:Rule
    val rule = createComposeRule()

    private class Drawn {
        var scheme: ColorScheme? = null
        var shapes: Shapes? = null
        var extras: OpenVerifyColors? = null
        var direction: LayoutDirection? = null
        var language: String? = null
        var brand: ThemeBrand? = null
        var view: View? = null
    }

    private fun draw(
        look: SessionLook = SessionLook.NONE,
        appearance: Appearance = Appearance.SYSTEM,
        systemDark: Boolean = false,
        requestedLocale: String? = null,
        language: LanguageSelection = LanguageSelection(),
        themeAssets: ThemeAssetSource? = null,
    ): Drawn {
        val drawn = Drawn()
        rule.setContent {
            OpenVerifyTheme(look, appearance, requestedLocale, language, themeAssets, systemDark) {
                drawn.scheme = MaterialTheme.colorScheme
                drawn.shapes = MaterialTheme.shapes
                drawn.extras = LocalOpenVerifyColors.current
                drawn.direction = LocalLayoutDirection.current
                drawn.language = LocalSdkLanguage.current
                drawn.brand = LocalThemeBrand.current
                drawn.view = LocalView.current
                Text(sdkString(Res.string.openverify_cancel))
            }
        }
        rule.waitForIdle()
        return drawn
    }

    private fun colour(hex: String): Color = Color(0xff000000.toInt() or hex.removePrefix("#").toInt(16))

    private fun themed(mode: String = "auto", dark: Map<String, String>? = ThemeFixtures.DARK) =
        SessionLook(theme = ThemeFixtures.theme(mode = mode, dark = dark))

    @Test
    fun `the operator palette and radius are what Material draws`() {
        val drawn = draw(themed())

        assertEquals(colour("#0b6e4f"), drawn.scheme?.primary)
        assertEquals(colour("#ffffff"), drawn.scheme?.surface)
        assertEquals(colour("#f2f7f5"), drawn.scheme?.background)
        assertEquals(RoundedCornerShape(12.dp), drawn.shapes?.small)
        assertEquals(OpenVerifyColors(colour("#000000"), colour("#08553d"), colour("#8c1d18"), ThemeVariant.LIGHT), drawn.extras)
    }

    @Test
    fun `without a session theme the built-in palettes are drawn, following the device`() {
        assertEquals(colour("#1447e6"), draw().scheme?.primary)
    }

    @Test
    fun `without a session theme a dark device draws the built-in dark palette`() {
        assertEquals(colour("#3b8bff"), draw(systemDark = true).scheme?.primary)
    }

    @Test
    fun `an auto theme follows a dark device`() {
        assertEquals(colour("#5dd6a8"), draw(themed(), systemDark = true).scheme?.primary)
    }

    @Test
    fun `a light-mode theme stays light on a dark device`() {
        assertEquals(colour("#0b6e4f"), draw(themed(mode = "light"), systemDark = true).scheme?.primary)
    }

    @Test
    fun `LIGHT forces the light palette on a dark device`() {
        assertEquals(colour("#0b6e4f"), draw(themed(), Appearance.LIGHT, systemDark = true).scheme?.primary)
    }

    @Test
    fun `DARK forces the dark palette on a light device`() {
        assertEquals(colour("#5dd6a8"), draw(themed(), Appearance.DARK).scheme?.primary)
    }

    @Test
    fun `DARK with no session dark palette draws the built-in dark palette`() {
        val drawn = draw(themed(mode = "light", dark = null), Appearance.DARK)

        assertEquals(colour("#3b8bff"), drawn.scheme?.primary)
        assertEquals(ThemeVariant.DARK, drawn.extras?.variant)
    }

    @Test
    fun `a light palette sets dark bar icons and a dark palette light ones`() {
        val light = draw(themed())
        val view = checkNotNull(light.view)
        val controller = WindowCompat.getInsetsController((view.context as Activity).window, view)
        assertTrue(controller.isAppearanceLightStatusBars)
        assertTrue(controller.isAppearanceLightNavigationBars)
    }

    @Test
    fun `a dark palette sets light bar icons`() {
        val dark = draw(themed(), Appearance.DARK)
        val view = checkNotNull(dark.view)
        val controller = WindowCompat.getInsetsController((view.context as Activity).window, view)
        assertFalse(controller.isAppearanceLightStatusBars)
        assertFalse(controller.isAppearanceLightNavigationBars)
    }

    @Test
    fun `the host's locale chooses the language in a process of another locale`() {
        val drawn = draw(requestedLocale = "fr-CA")

        assertEquals("fr", drawn.language)
        rule.onNodeWithText("Annuler").assertExists()
        assertEquals("en", java.util.Locale.getDefault().language)
    }

    @Test
    fun `the person's choice comes before the host's locale, and changes the strings at once`() {
        val selection = LanguageSelection().apply { selected = "de" }
        draw(requestedLocale = "fr", language = selection)
        rule.onNodeWithText("Abbrechen").assertExists()

        rule.runOnIdle { selection.selected = "es" }

        rule.onNodeWithText("Cancelar").assertExists()
    }

    @Test
    @Config(qualifiers = "es")
    fun `without a choice or a host locale the device's language is chosen`() {
        assertEquals("es", draw().language)
        rule.onNodeWithText("Cancelar").assertExists()
    }

    @Test
    fun `a language the version does not enable is not chosen`() {
        val look = SessionLook(locales = FlowLocales(listOf("en", "ar"), "ar"))

        assertEquals("en", draw(look, requestedLocale = "fr").language)
    }

    @Test
    fun `Arabic lays out right to left in an English process`() {
        val drawn = draw(requestedLocale = "ar")

        assertEquals(LayoutDirection.Rtl, drawn.direction)
        rule.onNodeWithText("إلغاء").assertExists()
    }

    @Test
    @Config(qualifiers = "ar")
    fun `English lays out left to right on an Arabic device, and Arabic right to left`() {
        assertEquals(LayoutDirection.Ltr, draw(requestedLocale = "en").direction)
    }

    @Test
    @Config(qualifiers = "ar")
    fun `an Arabic device chooses Arabic, right to left`() {
        val drawn = draw()

        assertEquals("ar", drawn.language)
        assertEquals(LayoutDirection.Rtl, drawn.direction)
    }

    private fun pngLogo(): ByteArray {
        val bitmap = Bitmap.createBitmap(48, 24, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(11, 110, 79)) }
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private fun logoLook(decorative: Boolean) = SessionLook(
        theme = ThemeFixtures.theme(logo = ThemeFixtures.logo(decorative)),
        organizationDisplayName = "Synthetic Org",
        copy = FlowCopy(
            mapOf(
                "en" to mapOf(ThemeFixtures.LOGO_ALT_KEY to "{organization} logo"),
                "fr" to mapOf(ThemeFixtures.LOGO_ALT_KEY to "Logo de {organization}"),
            ),
        ),
    )

    @Test
    fun `a logo is fetched once, checked, decoded and described by its alt text in the chosen language`() {
        var fetched = 0
        val drawn = draw(logoLook(decorative = false), requestedLocale = "fr", themeAssets = { assetId ->
            fetched += 1
            check(assetId == ThemeFixtures.LOGO_ASSET)
            pngLogo()
        })
        rule.waitUntil { drawn.brand?.logo != null }

        assertEquals(48, drawn.brand?.logo?.width)
        assertEquals("Logo de Synthetic Org", drawn.brand?.description)
        assertNull(drawn.brand?.name)
        assertEquals(1, fetched)
    }

    @Test
    fun `a decorative logo has no description, and the organisation's name shows beside it`() {
        val drawn = draw(logoLook(decorative = true), themeAssets = { pngLogo() })
        rule.waitUntil { drawn.brand?.logo != null }

        assertNull(drawn.brand?.description)
        assertEquals("Synthetic Org", drawn.brand?.name)
    }

    @Test
    fun `a logo that cannot be fetched shows the organisation's name only`() {
        val drawn = draw(logoLook(decorative = false), themeAssets = { error("synthetic 404") })
        rule.waitForIdle()

        assertNotNull(drawn.brand)
        assertNull(drawn.brand?.logo)
        assertEquals("Synthetic Org", drawn.brand?.name)
    }

    @Test
    fun `a theme without a logo shows no brand`() {
        assertNull(draw(themed()).brand)
    }
}
