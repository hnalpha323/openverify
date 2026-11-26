package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.FailureScreen
import dev.openverify.sdk.ui.screen.ScreenGoldens.Golden
import dev.openverify.sdk.ui.screen.ScreenGoldens.Look
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * android-screens' goldens at font scale 1.0 (C219.3's budget; synthetic content only, rule 3), each
 * with the accessibility checks of C212.2 (`verifyGolden`): every screen state in English and the
 * built-in light theme; the text-heavy screens (the form components, the failure and contest screen)
 * in the five languages; and each screen with a non-default, gate-passing operator palette in light
 * and dark (C198.8). Recorded only by `screenshotTest -Proborazzi.test.record=true`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h3400dp-mdpi")
internal class ScreenGoldensTest {

    @get:Rule
    val rule = createComposeRule()

    private fun golden(name: String, language: String = "en", look: Look = Look.BUILT_IN_LIGHT, route: FlowContestRoute? = null, act: () -> Unit = {}, content: @Composable () -> Unit) {
        rule.setContent { Golden(language, 1f, look, ScreenGoldens.environment(language, route), content) }
        act()
        rule.onRoot().verifyGolden(GoldenOwner.SCREENS, name)
    }

    private fun submit() {
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private val failed = FlowState.Failed(FailureStep("failed", "flow.failure"), InquiryStatus.DECLINED)

    // Every state of the screen step, in English, built-in light. -------------------------------

    @Test
    fun `the content components`() = golden("screen-content") { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.contentScreen)) }

    @Test
    fun `every form component, empty`() = golden("screen-form-empty") { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.formScreen)) }

    @Test
    fun `every form component, filled, a masked value held by the server`() =
        golden("screen-form-filled") { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.formScreen, ScreenGoldens.filled)) }

    @Test
    fun `every form component with the device's errors and their summary`() =
        golden("screen-form-errors", act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.formScreen)) }

    @Test
    fun `every form component while the submission is on its way`() =
        golden("screen-form-submitting") { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.formScreen, ScreenGoldens.filled, submitting = true)) }

    @Test
    fun `the server's refusals, on a field and for the screen`() = golden("screen-form-refused") {
        ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen, ScreenGoldens.filled, refusedFields = setOf("nickname"), refused = true))
    }

    @Test
    fun `the cancel confirmation`() = golden("screen-cancel-confirm", act = { rule.onNodeWithTag(ScreenTags.component("stop")).performScrollTo().performClick() }) {
        ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.contentScreen))
    }

    @Test
    fun `the failure screen without a contest route`() = golden("failure-plain") { FailureScreen(failed, onDone = {}) }

    @Test
    fun `the failure screen with a contact only`() = golden("failure-contest-contact", route = ScreenGoldens.contestContact) { FailureScreen(failed, onDone = {}) }

    // The text-heavy screens in the five languages (en also in the states above). ---------------

    private fun matrixForm(language: String) =
        golden("screen-form-matrix-$language", language, act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen)) }

    private fun contest(language: String) =
        golden("failure-contest-link-$language", language, route = ScreenGoldens.contestLink) { FailureScreen(failed, onDone = {}) }

    @Test fun `the form matrix in English`() = matrixForm("en")

    @Test fun `the form matrix in Spanish`() = matrixForm("es")

    @Test fun `the form matrix in French`() = matrixForm("fr")

    @Test fun `the form matrix in German`() = matrixForm("de")

    @Test fun `the form matrix in Arabic`() = matrixForm("ar")

    @Test fun `the contest route in English`() = contest("en")

    @Test fun `the contest route in Spanish`() = contest("es")

    @Test fun `the contest route in French`() = contest("fr")

    @Test fun `the contest route in German`() = contest("de")

    @Test fun `the contest route in Arabic`() = contest("ar")

    // A non-default operator palette, light and dark (C198.8). ----------------------------------

    @Test
    fun `the form with errors in an operator's light palette`() =
        golden("screen-form-errors-operator-light", look = Look.OPERATOR_LIGHT, act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen)) }

    @Test
    fun `the form with errors in an operator's dark palette`() =
        golden("screen-form-errors-operator-dark", look = Look.OPERATOR_DARK, act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen)) }

    @Test
    fun `the contest route in an operator's light palette`() =
        golden("failure-contest-link-operator-light", look = Look.OPERATOR_LIGHT, route = ScreenGoldens.contestLink) { FailureScreen(failed, onDone = {}) }

    @Test
    fun `the contest route in an operator's dark palette`() =
        golden("failure-contest-link-operator-dark", look = Look.OPERATOR_DARK, route = ScreenGoldens.contestLink) { FailureScreen(failed, onDone = {}) }
}

/**
 * android-screens' goldens at font scale 2.0 (C219.3): one state per screen in Arabic, dark, and the
 * text-heavy screens (the form components, the contest route) in the five languages, on a window tall
 * enough for the larger text.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h3600dp-mdpi")
internal class ScreenGoldensLargeTextTest {

    @get:Rule
    val rule = createComposeRule()

    private fun golden(name: String, language: String, look: Look = Look.BUILT_IN_LIGHT, route: FlowContestRoute? = null, act: () -> Unit = {}, content: @Composable () -> Unit) {
        rule.setContent { Golden(language, 2f, look, ScreenGoldens.environment(language, route), content) }
        act()
        rule.onRoot().verifyGolden(GoldenOwner.SCREENS, name)
    }

    private fun submit() {
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private val failed = FlowState.Failed(FailureStep("failed", "flow.failure"), InquiryStatus.DECLINED)

    @Test
    fun `the screen step in Arabic, dark, at 2x`() =
        golden("screen-form-errors-ar-dark-2x", "ar", Look.BUILT_IN_DARK, act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen)) }

    @Test
    fun `the failure screen in Arabic, dark, at 2x`() =
        golden("failure-contest-link-ar-dark-2x", "ar", Look.BUILT_IN_DARK, route = ScreenGoldens.contestLink) { FailureScreen(failed, onDone = {}) }

    private fun matrixForm(language: String) =
        golden("screen-form-matrix-$language-2x", language, act = ::submit) { ScreenGoldens.Screen(ScreenGoldens.state(ScreenGoldens.matrixScreen)) }

    private fun contest(language: String) =
        golden("failure-contest-link-$language-2x", language, route = ScreenGoldens.contestLink) { FailureScreen(failed, onDone = {}) }

    @Test fun `the form matrix in English at 2x`() = matrixForm("en")

    @Test fun `the form matrix in Spanish at 2x`() = matrixForm("es")

    @Test fun `the form matrix in French at 2x`() = matrixForm("fr")

    @Test fun `the form matrix in German at 2x`() = matrixForm("de")

    @Test fun `the form matrix in Arabic at 2x`() = matrixForm("ar")

    @Test fun `the contest route in English at 2x`() = contest("en")

    @Test fun `the contest route in Spanish at 2x`() = contest("es")

    @Test fun `the contest route in French at 2x`() = contest("fr")

    @Test fun `the contest route in German at 2x`() = contest("de")

    @Test fun `the contest route in Arabic at 2x`() = contest("ar")
}
