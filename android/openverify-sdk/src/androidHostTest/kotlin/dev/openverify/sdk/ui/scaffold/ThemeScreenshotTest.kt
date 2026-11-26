package dev.openverify.sdk.ui.scaffold

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_cancel
import dev.openverify.sdk.generated.resources.openverify_consent_continue
import dev.openverify.sdk.generated.resources.openverify_consent_title
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.OpenVerifyTheme
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.theme.SessionLook
import dev.openverify.sdk.ui.theme.ThemeFixtures
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/**
 * C219.3, C198.8, C199.5: android-theme's goldens, from synthetic content only (no face, no real
 * name or logo). The chrome (the brand header with a synthetic logo, the help slot with its links and
 * the language selector) around a synthetic step, in the operator palette that passes the gate
 * (`ThemeFixtures`, `ThemeFixturesTest`) in light and dark, in English and in Arabic (right to left),
 * and in the built-in palettes. Every golden also runs the accessibility checks (`verifyGolden`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w320dp-h480dp-xhdpi")
internal class ThemeScreenshotTest {

    @get:Rule
    val rule = createComposeRule()

    private val noBrowser = object : UriHandler {
        override fun openUri(uri: String) = Unit
    }

    /** A synthetic two-colour logo, its left half the operator's primary, so a mirror would show. */
    private fun logo(): ByteArray {
        val bitmap = Bitmap.createBitmap(96, 32, Bitmap.Config.ARGB_8888)
        for (x in 0 until 96) for (y in 0 until 32) {
            bitmap.setPixel(x, y, if (x < 48) android.graphics.Color.rgb(11, 110, 79) else android.graphics.Color.rgb(242, 247, 245))
        }
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private val links = FlowLinks("https://help.example.com/flow", "https://example.com/privacy")

    private fun operator() = SessionLook(
        theme = ThemeFixtures.theme(logo = ThemeFixtures.logo(decorative = true)),
        locales = FlowLocales(listOf("en", "es", "fr", "de", "ar"), "en"),
        links = links,
        organizationDisplayName = "Synthetic Org",
        copy = FlowCopy(emptyMap()),
    )

    private fun builtIn() = SessionLook(locales = FlowLocales(listOf("en", "ar"), "en"), links = links)

    private fun golden(name: String, look: SessionLook, appearance: Appearance, locale: String) {
        val bytes = logo()
        rule.setContent {
            CompositionLocalProvider(LocalUriHandler provides noBrowser) {
                OpenVerifyTheme(look, appearance = appearance, requestedLocale = locale, themeAssets = { bytes }) {
                    Surface {
                        StepScaffold(FlowState.Loading) {
                            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(
                                    sdkString(Res.string.openverify_consent_title),
                                    style = MaterialTheme.typography.titleLarge,
                                    modifier = Modifier.semantics { heading() },
                                )
                                Button(onClick = {}, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_consent_continue)) }
                                OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_cancel)) }
                            }
                        }
                    }
                }
            }
        }
        if (look.theme?.logo != null) rule.waitUntil { rule.onAllNodes(hasTestTag(ChromeTags.BRAND_LOGO)).fetchSemanticsNodes().isNotEmpty() }
        rule.onRoot().verifyGolden(GoldenOwner.THEME, name)
    }

    @Test
    fun `the operator palette in light`() = golden("chrome-operator-light", operator(), Appearance.LIGHT, "en")

    @Test
    fun `the operator palette in dark`() = golden("chrome-operator-dark", operator(), Appearance.DARK, "en")

    @Test
    fun `the operator palette in light, in Arabic, right to left`() = golden("chrome-operator-light-ar", operator(), Appearance.LIGHT, "ar")

    @Test
    fun `the operator palette in dark, in Arabic, right to left`() = golden("chrome-operator-dark-ar", operator(), Appearance.DARK, "ar")

    @Test
    fun `the built-in palette in light`() = golden("chrome-builtin-light", builtIn(), Appearance.LIGHT, "en")

    @Test
    fun `the built-in palette in dark, in Arabic`() = golden("chrome-builtin-dark-ar", builtIn(), Appearance.DARK, "ar")
}
