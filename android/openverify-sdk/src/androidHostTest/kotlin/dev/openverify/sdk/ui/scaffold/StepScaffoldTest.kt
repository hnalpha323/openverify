package dev.openverify.sdk.ui.scaffold

import android.graphics.Bitmap
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_cancel
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.ui.OpenVerifyTheme
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.theme.LanguageSelection
import dev.openverify.sdk.ui.theme.SessionLook
import dev.openverify.sdk.ui.theme.ThemeFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/**
 * C197.4, C198.3, C199.3, C199.5: the scaffold every step's content is wrapped in. The brand header
 * above the content (the theme's logo and placement), the fixed help slot after it: the version's
 * `https:` help and privacy links in the web's words or the operator's, and the language selector
 * among the enabled languages the SDK bundles, each named in itself. Arabic lays the chrome out right
 * to left; the logo is never mirrored. Outside `OpenVerifyTheme` the scaffold shows its content alone.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
internal class StepScaffoldTest {

    @get:Rule
    val rule = createComposeRule()

    private val opened = mutableListOf<String>()
    private val handler = object : UriHandler {
        override fun openUri(uri: String) {
            opened += uri
        }
    }

    private var view: android.view.View? = null

    private val links = FlowLinks("https://help.example.com/flow", "https://example.com/privacy")

    private fun show(
        look: SessionLook,
        requestedLocale: String? = null,
        selection: LanguageSelection = LanguageSelection(),
        logo: ByteArray? = null,
    ) {
        rule.setContent {
            CompositionLocalProvider(LocalUriHandler provides handler) {
                view = androidx.compose.ui.platform.LocalView.current
                OpenVerifyTheme(look, requestedLocale = requestedLocale, language = selection, themeAssets = logo?.let { bytes -> { bytes } }) {
                    StepScaffold(FlowState.Loading) {
                        Text(sdkString(Res.string.openverify_cancel), Modifier.testTag("content"))
                    }
                }
            }
        }
        rule.waitForIdle()
    }

    @Test
    fun `outside OpenVerifyTheme the scaffold shows its content alone`() {
        rule.setContent { StepScaffold(FlowState.Loading) { Text("Synthetic content") } }

        rule.onNodeWithText("Synthetic content").assertExists()
        rule.onNodeWithTag(ChromeTags.HELP_SLOT).assertDoesNotExist()
        rule.onNodeWithTag(ChromeTags.BRAND).assertDoesNotExist()
    }

    @Test
    fun `the help and privacy links show in the web's words and open their URL in the browser`() {
        show(SessionLook(links = links, locales = FlowLocales(listOf("en"), "en")))

        rule.onNodeWithTag(ChromeTags.HELP_LINK).assertExists().assert(SemanticsMatcher.expectValue(SemanticsProperties.Text, listOf(androidx.compose.ui.text.AnnotatedString("Get help"))))
        rule.onNodeWithText("Privacy notice").performClick()
        rule.onNodeWithText("Get help").performClick()

        assertEquals(listOf("https://example.com/privacy", "https://help.example.com/flow"), opened)
    }

    @Test
    fun `the operator's words for a link replace the SDK's in the chosen language, the organisation isolated`() {
        val copy = FlowCopy(mapOf("fr" to mapOf("screen.helpLink" to "Aide de {organization}")))
        show(SessionLook(links = links, organizationDisplayName = "Synthetic Org", copy = copy), requestedLocale = "fr")

        rule.onNodeWithText("Aide de ⁨Synthetic Org⁩").assertExists()
        rule.onNodeWithText("Avis de confidentialité").assertExists()
    }

    @Test
    fun `a link that is not https is not shown`() {
        show(SessionLook(links = FlowLinks("http://help.example.com/flow", "https://example.com/privacy")))

        rule.onNodeWithTag(ChromeTags.HELP_LINK).assertDoesNotExist()
        rule.onNodeWithTag(ChromeTags.PRIVACY_LINK).assertExists()
    }

    @Test
    fun `the selector offers the enabled languages the SDK bundles, each named in its own language`() {
        show(SessionLook(locales = FlowLocales(listOf("en", "fr", "ar", "it"), "en")))

        rule.onNodeWithTag(ChromeTags.LANGUAGE_SELECTOR).performClick()

        rule.onNodeWithTag(ChromeTags.languageItem("en")).assertExists()
        rule.onNodeWithText("Français").assertExists()
        rule.onNodeWithText("العربية").assertExists()
        rule.onNodeWithTag(ChromeTags.languageItem("it")).assertDoesNotExist()
        rule.onNodeWithTag(ChromeTags.languageItem("de")).assertDoesNotExist()
    }

    @Test
    fun `the selector is one control, named by its label and the language shown, that changes the language`() {
        show(SessionLook(locales = FlowLocales(listOf("en", "fr"), "en")))

        rule.onNodeWithTag(ChromeTags.LANGUAGE_SELECTOR, useUnmergedTree = false)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.DropdownList))
            .assert(SemanticsMatcher("its click says what it does") { it.config.getOrNull(SemanticsActions.OnClick)?.label == "Change language" })
            .assert(SemanticsMatcher("it reads its label and value") { node ->
                node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } == listOf("Language", "English")
            })
    }

    @Test
    fun `choosing a language changes every string at once`() {
        val selection = LanguageSelection()
        show(SessionLook(locales = FlowLocales(listOf("en", "fr"), "en")), selection = selection)

        rule.onNodeWithTag(ChromeTags.LANGUAGE_SELECTOR).performClick()
        rule.onNodeWithTag(ChromeTags.languageItem("fr")).performClick()

        rule.onNodeWithTag("content").assert(SemanticsMatcher.expectValue(SemanticsProperties.Text, listOf(androidx.compose.ui.text.AnnotatedString("Annuler"))))
        rule.onNodeWithText("Langue").assertExists()
        assertEquals("fr", selection.selected)
    }

    @Test
    fun `one language and no links leave no help slot`() {
        show(SessionLook(locales = FlowLocales(listOf("en"), "en")))

        rule.onNodeWithTag(ChromeTags.LANGUAGE_SELECTOR).assertDoesNotExist()
        rule.onNodeWithTag(ChromeTags.HELP_SLOT).assertDoesNotExist()
    }

    /** A synthetic logo: its left half the operator's primary, its right half ink, so a mirror shows. */
    private fun logo(): ByteArray {
        val bitmap = Bitmap.createBitmap(96, 32, Bitmap.Config.ARGB_8888)
        for (x in 0 until 96) for (y in 0 until 32) {
            bitmap.setPixel(x, y, if (x < 48) android.graphics.Color.rgb(11, 110, 79) else android.graphics.Color.rgb(16, 32, 26))
        }
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private fun logoLook(decorative: Boolean) = SessionLook(
        theme = ThemeFixtures.theme(logo = ThemeFixtures.logo(decorative)),
        organizationDisplayName = "Synthetic Org",
        copy = FlowCopy(mapOf("en" to mapOf(ThemeFixtures.LOGO_ALT_KEY to "{organization} logo"), "ar" to mapOf(ThemeFixtures.LOGO_ALT_KEY to "شعار {organization}"))),
        locales = FlowLocales(listOf("en"), "en"),
    )

    @Test
    fun `the brand header shows the logo with its alt text`() {
        show(logoLook(decorative = false), logo = logo())
        rule.waitUntil { tagged(ChromeTags.BRAND_LOGO) == 1 }

        rule.onNodeWithContentDescription("Synthetic Org logo").assertExists()
        rule.onNodeWithText("Synthetic Org").assertDoesNotExist()
    }

    @Test
    fun `a decorative logo shows the organisation's name beside it and describes nothing`() {
        show(logoLook(decorative = true), logo = logo())
        rule.waitUntil { tagged(ChromeTags.BRAND_LOGO) == 1 }

        rule.onNodeWithText("Synthetic Org").assertExists()
        rule.onNodeWithTag(ChromeTags.BRAND_LOGO).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
    }

    @Test
    fun `a logo that cannot be fetched shows the organisation's name only`() {
        show(logoLook(decorative = false), logo = null)

        rule.onNodeWithTag(ChromeTags.BRAND).assertExists()
        rule.onNodeWithText("Synthetic Org").assertExists()
        rule.onNodeWithTag(ChromeTags.BRAND_LOGO).assertDoesNotExist()
    }

    private fun tagged(tag: String): Int = rule.onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size

    private fun linkIsLeftOfSelector(): Boolean {
        val link = rule.onNodeWithTag(ChromeTags.HELP_LINK).getBoundsInRoot()
        val selector = rule.onNodeWithTag(ChromeTags.LANGUAGE_SELECTOR).getBoundsInRoot()
        return link.left < selector.left
    }

    @Test
    fun `in English the help slot reads left to right`() {
        show(SessionLook(links = links))

        assertTrue(linkIsLeftOfSelector())
    }

    @Test
    fun `Arabic chosen in an English host lays the help slot out right to left`() {
        show(SessionLook(links = links), requestedLocale = "ar")

        rule.onNodeWithText("الحصول على المساعدة").assertExists()
        assertTrue(!linkIsLeftOfSelector())
    }

    @Test
    @Config(qualifiers = "ar")
    fun `on an Arabic device the help slot is right to left and in Arabic`() {
        show(SessionLook(links = links))

        rule.onNodeWithText("إشعار الخصوصية").assertExists()
        rule.onNodeWithText("اللغة").assertExists()
        assertTrue(!linkIsLeftOfSelector())
    }

    @Test
    @Config(qualifiers = "ar")
    fun `the logo is never mirrored in Arabic`() {
        show(logoLook(decorative = false).copy(locales = FlowLocales(listOf("ar"), "ar")), logo = logo())
        rule.waitUntil { tagged(ChromeTags.BRAND_LOGO) == 1 }

        rule.onNodeWithContentDescription("شعار Synthetic Org").assertExists()
        // The window as drawn, read at an eighth of the logo's width from each of its edges.
        val bounds = rule.onNodeWithTag(ChromeTags.BRAND_LOGO).getBoundsInRoot()
        val root = checkNotNull(view)
        val density = root.resources.displayMetrics.density
        val drawn = rule.runOnIdle {
            Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { root.draw(android.graphics.Canvas(it)) }
        }
        val y = ((bounds.top.value + bounds.bottom.value) / 2 * density).toInt()
        val width = bounds.right.value - bounds.left.value
        val left = drawn.getPixel(((bounds.left.value + width / 8) * density).toInt(), y)
        val right = drawn.getPixel(((bounds.right.value - width / 8) * density).toInt(), y)
        assertEquals(android.graphics.Color.rgb(11, 110, 79), left)
        assertEquals(android.graphics.Color.rgb(16, 32, 26), right)
    }
}
