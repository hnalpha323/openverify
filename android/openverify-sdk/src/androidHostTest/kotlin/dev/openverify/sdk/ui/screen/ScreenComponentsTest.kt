package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CheckboxGroupComponent
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** C195.1-C195.2: the choice, date, phone and image components as a person uses them; synthetic values only (native graphics, for a real bitmap). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h1400dp")
internal class ScreenComponentsTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = ScreenActions()

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private val options = listOf(ComponentOption("a", "alpha", "about.option.a"), ComponentOption("b", "beta", "about.option.b"))
    private val copy = mapOf(
        "about.title.title" to "About you",
        "about.field.label" to "Synthetic field",
        "about.option.a" to "Alpha",
        "about.next.button" to "Continue",
        "about.logo.alt" to "Synthetic logo",
    )

    private fun show(vararg components: FlowComponent, asset: (String) -> ImageBitmap? = { null }) {
        val step = ScreenStep("about", listOf(TextComponent("title", "title", "about.title.title")) + components + ButtonComponent("next", "about.next.button", "submit"))
        val environment = ScreenEnvironment(
            text = screenEnvironment(copy).text,
            language = "en",
            asset = asset,
        )
        rule.setContent {
            CompositionLocalProvider(LocalScreenEnvironment provides environment, LocalUriHandler provides RecordingUriHandler()) {
                ScreenStepScreen(FlowState.Screen(step), actions)
            }
        }
    }

    private fun submit(): Map<String, FlowValue> {
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()
        return actions.submissions.single().first
    }

    @Test
    fun `a select offers its options by their words, an option without words by its value`() {
        show(SelectComponent("kind", "kind", "about.field.label", options = options))

        rule.onNodeWithTag(ScreenTags.field("kind")).performClick()
        rule.onNodeWithTag(TestTags.option("beta")).assert(SemanticsMatcher.expectValue(SemanticsProperties.Text, listOf(androidx.compose.ui.text.AnnotatedString("beta"))))
        rule.onNodeWithText("Alpha").performClick()

        assertEquals(FlowValue.Text("alpha"), submit()["kind"])
    }

    @Test
    fun `a country select offers only its allowed countries`() {
        show(CountrySelectComponent("country", "country", "about.field.label", allowedCountries = listOf("CA", "US")))

        rule.onNodeWithTag(ScreenTags.field("country")).performClick()
        rule.onNodeWithTag(TestTags.option("FR")).assertDoesNotExist()
        rule.onNodeWithTag(TestTags.option("CA")).performClick()

        assertEquals(FlowValue.Text("CA"), submit()["country"])
    }

    @Test
    fun `a checkbox group and a multi select send every option ticked, and a second tap unticks it`() {
        show(CheckboxGroupComponent("topics", "topics", "about.field.label", options = options), MultiSelectComponent("tags", "tags", "about.field.label", options = options))

        rule.onNodeWithTag(ScreenTags.choice("topics", "alpha")).performClick()
        rule.onNodeWithTag(ScreenTags.choice("topics", "beta")).performClick()
        rule.onNodeWithTag(ScreenTags.choice("tags", "beta")).performClick()
        rule.onNodeWithTag(ScreenTags.choice("tags", "beta")).performClick()

        val values = submit()
        assertEquals(FlowValue.Texts(listOf("alpha", "beta")), values["topics"])
        assertEquals(FlowValue.Empty, values["tags"])
    }

    @Test
    fun `a date typed is kept by the picker, which opens on it and uses it`() {
        show(DateComponent("start", "start", "about.field.label"))

        rule.onNodeWithTag(ScreenTags.field("start")).performTextInput("2024-02-29")
        rule.onNodeWithTag(ScreenTags.datePick("start")).performClick()
        rule.onNodeWithText(text(Res.string.openverify_screen_date_use)).performClick()

        assertEquals(FlowValue.Text("2024-02-29"), submit()["start"])
    }

    @Test
    fun `the picker closed without a choice changes nothing`() {
        show(DateComponent("start", "start", "about.field.label"))

        rule.onNodeWithTag(ScreenTags.datePick("start")).performClick()
        rule.onNodeWithText(text(Res.string.openverify_cancel)).performClick()

        assertEquals(FlowValue.Empty, submit()["start"])
    }

    @Test
    fun `a phone number goes out with the chosen country's calling code`() {
        show(PhoneComponent("phone", "phone", "about.field.label", allowedCountries = listOf("GB", "US")))

        rule.onNodeWithTag(ScreenTags.field("phone")).performTextInput("20 7946 0000")
        rule.onNodeWithTag(ScreenTags.phoneCountry("phone")).performClick()
        rule.onNodeWithTag(TestTags.option("GB")).performClick()

        assertEquals(FlowValue.Text("+44 20 7946 0000"), submit()["phone"])
    }

    @Test
    fun `a loaded image is shown with its text alternative, a decorative one with none`() {
        val bitmap = ImageBitmap(8, 8)
        show(ImageComponent("logo", "tas_synthetic", altKey = "about.logo.alt", decorative = false), ImageComponent("flourish", "tas_synthetic", decorative = true), asset = { bitmap })

        rule.onNodeWithTag(ScreenTags.component("logo")).assert(SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf("Synthetic logo")))
        rule.onNodeWithTag(ScreenTags.component("flourish")).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
    }
}
