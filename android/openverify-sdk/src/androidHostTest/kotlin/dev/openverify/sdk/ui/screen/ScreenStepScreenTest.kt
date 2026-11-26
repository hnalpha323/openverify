package dev.openverify.sdk.ui.screen

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.RadioGroupComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UnsupportedComponent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C195 (Workflow 10A, android-screens): the screen step rendered from its client view, over a fake
 * environment with synthetic words; the server stays the judge of every value (C195.10).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
internal class ScreenStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = ScreenActions()
    private val uris = RecordingUriHandler()

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun equals(field: String, value: String): JsonObject =
        JsonObject(mapOf("===" to JsonArray(listOf(JsonObject(mapOf("var" to JsonPrimitive("screen.$field"))), JsonPrimitive(value)))))

    private val copy = mapOf(
        "about.title.title" to "About you",
        "about.intro.body" to "Tell us a little about yourself.",
        "about.note.caption" to "Synthetic caption",
        "about.nickname.label" to "Nickname",
        "about.nickname.hint" to "As friends call you",
        "about.kind.label" to "You are",
        "about.kind.p" to "A person",
        "about.kind.b" to "A business",
        "about.company.label" to "Company name",
        "about.agree.label" to "I agree",
        "about.secret.label" to "Passphrase",
        "about.next.button" to "Continue",
        "about.later.button" to "Later",
        "about.stop.button" to "Stop",
        "about.help.button" to "Get help",
        "about.privacy.button" to "Privacy notice",
        "about.s1" to "Details",
        "about.s2" to "Documents",
        "about.logo.alt" to "Synthetic logo",
    )

    private val title = TextComponent("title", "title", "about.title.title")
    private val nickname = TextInputComponent("nickname", "nickname", "about.nickname.label", hintKey = "about.nickname.hint", required = true, minLength = 2)
    private val kind = RadioGroupComponent(
        "kind",
        "kind",
        "about.kind.label",
        options = listOf(ComponentOption("p", "person", "about.kind.p"), ComponentOption("b", "business", "about.kind.b")),
    )
    private val company = TextInputComponent("company", "company", "about.company.label", required = true, visibleWhen = equals("kind", "business"))
    private val next = ButtonComponent("next", "about.next.button", "submit")
    private val later = ButtonComponent("later", "about.later.button", "submit", port = "later")
    private val stop = ButtonComponent("stop", "about.stop.button", "cancel")

    private fun show(
        vararg components: FlowComponent,
        values: Map<String, FlowValue> = emptyMap(),
        environment: ScreenEnvironment = screenEnvironment(copy, links = FlowLinks("https://example.com/help", null)),
        submitting: Boolean = false,
        refusedFields: Set<String> = emptySet(),
        refused: Boolean = false,
        direction: LayoutDirection = LayoutDirection.Ltr,
    ) {
        val state = FlowState.Screen(ScreenStep("about", components.toList()), values, submitting, refusedFields, refused)
        rule.setContent {
            CompositionLocalProvider(
                LocalScreenEnvironment provides environment,
                LocalUriHandler provides uris,
                LocalLayoutDirection provides direction,
            ) {
                ScreenStepScreen(state, actions)
            }
        }
    }

    @Test
    fun `components render in order, the first title is the heading and takes focus on arrival (C195_1, C195_8)`() {
        show(
            title,
            TextComponent("intro", "body", "about.intro.body"),
            StepperComponent("steps", listOf("about.s1", "about.s2"), current = 0),
            TextComponent("note", "caption", "about.note.caption"),
            next,
        )

        rule.onNodeWithTag(ScreenTags.HEADING).assertIsFocused().assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        rule.onNodeWithText("About you").assertIsDisplayed()
        val tops = listOf("intro", "steps", "note", "next").map { rule.onNodeWithTag(ScreenTags.component(it)).getUnclippedBoundsInRoot().top }
        assertEquals(tops.sorted(), tops)
        rule.onNodeWithText("Details").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(Res.string.openverify_screen_stepper_current)))
    }

    @Test
    fun `a screen without a title gets the SDK's own heading`() {
        show(nickname, next)

        rule.onNodeWithTag(ScreenTags.HEADING).assertIsFocused()
        rule.onNodeWithText(text(Res.string.openverify_screen_heading)).assertIsDisplayed()
    }

    @Test
    fun `a later component kind renders the whole screen unsupported, never a partial screen (C194_3)`() {
        show(title, ContainerComponent("box", "vertical", listOf(UnsupportedComponent("pad", "signature_pad"))), next)

        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertIsDisplayed()
        rule.onNodeWithText("About you").assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("finish"), actions.calls)
    }

    @Test
    fun `a component text no catalog holds renders unsupported, never a raw key (C199_6)`() {
        show(title, TextInputComponent("other", "other", "about.missing.label"), next)

        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertIsDisplayed()
        rule.onNodeWithText("about.missing.label").assertDoesNotExist()
    }

    @Test
    fun `without a session's environment every screen is unsupported`() {
        show(title, next, environment = ScreenEnvironment.NONE)

        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertIsDisplayed()
    }

    @Test
    fun `a choice shows the component its rule names, and the submission drops a hidden value (C148_4, C196_1)`() {
        show(title, kind, company, next, values = mapOf("company" to FlowValue.Text("Hidden Ltd")))

        rule.onNodeWithText("Company name").assertDoesNotExist()
        rule.onNodeWithTag(ScreenTags.choice("kind", "business")).performClick()
        rule.onNodeWithText("Company name *").assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.choice("kind", "person")).performClick()
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()

        assertEquals(listOf(mapOf("kind" to FlowValue.Text("person")) to null), actions.submissions)
    }

    @Test
    fun `the device's errors are summarised at the top, focused and linked to their fields, and nothing is sent (C195_4)`() {
        show(title, nickname, next)

        rule.onNodeWithTag(ScreenTags.component("next")).performClick()

        // The heading stays first: the summary follows it (C195.8, C195.4).
        assertTrue(rule.onNodeWithTag(ScreenTags.HEADING).getUnclippedBoundsInRoot().bottom <= rule.onNodeWithTag(ScreenTags.SUMMARY).getUnclippedBoundsInRoot().top)
        rule.onNodeWithTag(ScreenTags.SUMMARY).assertIsFocused()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, androidx.compose.ui.semantics.LiveRegionMode.Assertive))
        rule.onNodeWithTag(ScreenTags.field("nickname")).assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, text(Res.string.openverify_screen_error_required)))
        rule.onNodeWithTag(ScreenTags.summaryLink("nickname")).performClick()
        rule.onNodeWithTag(ScreenTags.field("nickname")).assertIsFocused()
        assertTrue(actions.submissions.isEmpty())

        rule.onNodeWithTag(ScreenTags.field("nickname")).performTextInput("S")
        rule.onNodeWithTag(ScreenTags.summaryLink("nickname")).assertDoesNotExist()
    }

    @Test
    fun `valid values are sent with the pressed button's port, the primary button's as null (C195_7)`() {
        show(title, nickname, next, later)

        rule.onNodeWithTag(ScreenTags.field("nickname")).performTextInput("Sam")
        rule.onNodeWithTag(ScreenTags.component("later")).performClick()
        rule.onNodeWithTag(ScreenTags.component("next")).performClick()

        assertEquals(
            listOf(mapOf("nickname" to FlowValue.Text("Sam")) to "later", mapOf("nickname" to FlowValue.Text("Sam")) to null),
            actions.submissions,
        )
    }

    @Test
    fun `the session's values prefill the screen's fields, and a value the server keeps is shown as set (C195_5)`() {
        show(
            title,
            nickname,
            MaskedTextComponent("secret", "secret", "about.secret.label", required = true),
            CheckboxComponent("agree", "agree", "about.agree.label"),
            next,
            values = mapOf("nickname" to FlowValue.Text("Sam"), "secret" to FlowValue.Set, "agree" to FlowValue.Bool(true)),
        )

        rule.onNodeWithText("Sam").assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_screen_set)).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.field("agree")).assertIsOn()
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()

        assertEquals(listOf(mapOf("nickname" to FlowValue.Text("Sam"), "agree" to FlowValue.Bool(true)) to null), actions.submissions)
    }

    @Test
    fun `a field the server refused shows its refusal until the person changes it (C195_4)`() {
        show(title, nickname, next, values = mapOf("nickname" to FlowValue.Text("Sam")), refusedFields = setOf("nickname"))

        rule.onNodeWithTag(ScreenTags.field("nickname")).assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, text(Res.string.openverify_screen_error_refused)))
        rule.onNodeWithTag(ScreenTags.summaryLink("nickname")).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.field("nickname")).performTextInput("my")
        rule.onNodeWithTag(ScreenTags.field("nickname")).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Error))
    }

    @Test
    fun `a refusal no field shows is said above the buttons`() {
        show(title, nickname, next, refused = true)

        rule.onNodeWithTag(ScreenTags.REFUSED).assertExists()
    }

    @Test
    fun `while the submission is on its way nothing can be pressed or typed into`() {
        show(title, nickname, kind, next, submitting = true)

        rule.onNodeWithTag(ScreenTags.component("next")).assertIsNotEnabled()
        rule.onNodeWithTag(ScreenTags.field("nickname")).assertIsNotEnabled()
        rule.onNodeWithTag(ScreenTags.SAVING).assertExists()
    }

    @Test
    fun `a component its rule disables cannot be used, and is not checked (C148_4)`() {
        val gated = TextInputComponent("gated", "gated", "about.company.label", required = true, enabledWhen = equals("kind", "business"))
        show(title, kind, gated, next)

        rule.onNodeWithTag(ScreenTags.field("gated")).assertIsNotEnabled()
        rule.onNodeWithTag(ScreenTags.component("next")).performClick()
        assertEquals(listOf(mapOf("kind" to FlowValue.Empty) to null), actions.submissions)
        rule.onNodeWithTag(ScreenTags.choice("kind", "business")).performClick()
        rule.onNodeWithTag(ScreenTags.field("gated")).assertIsEnabled()
    }

    @Test
    fun `cancel asks first, then cancels, and keeping goes back to the form with its values (C195_3)`() {
        show(title, nickname, stop)

        rule.onNodeWithTag(ScreenTags.field("nickname")).performTextInput("Sam")
        rule.onNodeWithTag(ScreenTags.component("stop")).performClick()
        rule.onNodeWithText(text(Res.string.openverify_screen_cancel_title)).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.CANCEL_KEEP).performClick()
        rule.onNodeWithText("Sam").assertIsDisplayed()
        assertTrue(actions.calls.isEmpty())

        rule.onNodeWithTag(ScreenTags.component("stop")).performClick()
        rule.onNodeWithTag(ScreenTags.CANCEL_CONFIRM).performClick()
        assertEquals(listOf("cancel"), actions.calls)
    }

    @Test
    fun `a link button opens the version's https link in the system browser, and one the version does not set is not shown (C195_3)`() {
        show(title, ButtonComponent("help", "about.help.button", "link", link = "help-url"), ButtonComponent("privacy", "about.privacy.button", "link", link = "privacy-url"))

        rule.onNodeWithTag(ScreenTags.component("help")).performClick()
        rule.onNodeWithTag(ScreenTags.component("privacy")).assertDoesNotExist()
        assertEquals(listOf("https://example.com/help"), uris.opened)
    }

    @Test
    fun `a link that is not https is never opened`() {
        show(
            title,
            ButtonComponent("help", "about.help.button", "link", link = "help-url"),
            environment = screenEnvironment(copy, links = FlowLinks("http://example.com/help", null)),
        )

        rule.onNodeWithTag(ScreenTags.component("help")).performClick()
        assertTrue(uris.opened.isEmpty())
    }

    @Test
    fun `an image not loaded shows its text alternative, and a decorative one nothing (C195_1)`() {
        show(title, ImageComponent("logo", "tas_synthetic", altKey = "about.logo.alt", decorative = false), ImageComponent("flourish", "tas_synthetic", decorative = true))

        rule.onNodeWithText("Synthetic logo").assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.component("flourish")).assertDoesNotExist()
    }

    @Test
    fun `every control is a 48 dp target (C195_8)`() {
        show(title, kind, CheckboxComponent("agree", "agree", "about.agree.label"), FooterComponent("foot", listOf(next, stop)))

        listOf(ScreenTags.choice("kind", "person"), ScreenTags.field("agree"), ScreenTags.component("next"), ScreenTags.component("stop")).forEach {
            rule.onNodeWithTag(it).assertHeightIsAtLeast(48.dp)
        }
    }

    @Test
    fun `the layout uses logical padding only, so right to left mirrors it (C195_8, C199_5)`() {
        show(
            title,
            CheckboxComponent("agree", "agree", "about.agree.label", hintKey = "about.agree.hint"),
            next,
            environment = screenEnvironment(copy + ("about.agree.hint" to "Synthetic hint")),
            direction = LayoutDirection.Rtl,
        )

        // The hint sits under the label, past the box: 24 dp of screen padding and 52 dp at its start.
        val hint = rule.onNodeWithText("Synthetic hint").getUnclippedBoundsInRoot()
        assertEquals(360f - 24f - 52f, hint.right.value, 0.5f)
    }

    @Test
    fun `a text from the default locale's copy carries its own language (C162_5, WCAG 3_1_2)`() {
        val environment = screenEnvironment(copy - "about.intro.body", language = "fr", fromDefault = mapOf("about.intro.body" to "Tell us a little about yourself."))
        show(title, TextComponent("intro", "body", "about.intro.body"), next, environment = environment)

        val shown = rule.onNodeWithTag(ScreenTags.component("intro")).fetchSemanticsNode().config[SemanticsProperties.Text].single()
        assertEquals("en", shown.spanStyles.single().item.localeList?.first()?.language)
    }

    @Test
    fun `typed values live in the view model's drafts, so a new composition of the screen keeps them (C195_5)`() {
        val drafts = ScreenDrafts()
        show(title, nickname, next, environment = screenEnvironment(copy, drafts = drafts))

        rule.onNodeWithTag(ScreenTags.field("nickname")).performTextInput("Sam")

        assertEquals(ScreenValue.Text("Sam"), drafts["about"]?.values?.get("nickname"))
    }

    @Test
    fun `the width a horizontal container gives its children is shared`() {
        rule.setContent {
            CompositionLocalProvider(LocalScreenEnvironment provides screenEnvironment(copy)) {
                Box(Modifier.width(360.dp)) {
                    ScreenStepScreen(
                        FlowState.Screen(ScreenStep("about", listOf(title, ContainerComponent("row", "horizontal", listOf(nickname, company.copy(visibleWhen = null))), next))),
                        actions,
                    )
                }
            }
        }

        val left = rule.onNodeWithTag(ScreenTags.field("nickname")).getUnclippedBoundsInRoot()
        val right = rule.onNodeWithTag(ScreenTags.field("company")).getUnclippedBoundsInRoot()
        assertTrue(left.right <= right.left)
        assertEquals((left.right - left.left).value, (right.right - right.left).value, 1f)
    }
}
