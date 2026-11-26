package dev.openverify.sdk.privacy

import android.os.Bundle
import android.os.Looper
import android.util.SparseArray
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.input.TextFieldValue
import androidx.test.core.app.ActivityScenario
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyInquiryActivity
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FlowComponentSerializer
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.nfc.Dg1Details
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.screen.LocalPlatformApiLevel
import dev.openverify.sdk.ui.steps.NfcStepScreen
import dev.openverify.sdk.ui.steps.NfcStepTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * C213.2 (decision 37; review P07, V03): what a person types lives in memory only. On each screen of
 * [PrivacyScreens.ALL] the real activity is launched, a canary is typed into every typed field and
 * chosen in every choice the table controls, the activity is recreated, and no `Bundle` it saved holds
 * a canary at any depth ([SavedText]). The same pass checks C213.1 where it types: on this platform
 * level (Robolectric's API 36) every typed field is accessibility-data-sensitive.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h4000dp")
internal class SavedStateCanaryTest(private val screen: PrivacyScreen) {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val server = PrivacyFlowServer()

    @After
    fun stop() {
        server.close()
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    private fun waitFor(tag: String) {
        compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun `no saved Bundle holds what was typed or chosen, across a recreation`() {
        server.session = screen.session
        screen.setup()
        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(server.launchIntent()).use { scenario ->
            screen.path.forEach { tag ->
                waitFor(tag)
                compose.onNodeWithTag(tag).performScrollTo().performClick()
            }
            waitFor(screen.ready)
            val canaries = mutableSetOf<String>()
            screen.entries.forEach { entry ->
                when (entry) {
                    is PrivacyEntry.Typed -> {
                        val node = compose.onNodeWithTag(entry.tag).performScrollTo()
                        node.assert(SemanticsMatcher.expectValue(SemanticsProperties.IsSensitiveData, true))
                        node.performTextInput(entry.canary)
                        compose.waitForIdle()
                        val shown = node.fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()
                        // A masked field shows as many dots; a phone number is shown as typed.
                        assertEquals("${entry.kind} (${entry.tag}) took the canary", entry.canary.length, shown.length)
                        canaries += entry.canary
                    }
                    is PrivacyEntry.Menu -> {
                        // The language menu changes every text on the screen: it is the window test's, not a value.
                        if (entry.kind != "language") {
                            compose.onNodeWithTag(entry.tag).performScrollTo().performClick()
                            waitFor(entry.option)
                            compose.onNodeWithTag(entry.option).performClick()
                            compose.waitForIdle()
                            entry.canary?.let(canaries::add)
                        }
                    }
                    is PrivacyEntry.Choice -> {
                        compose.onNodeWithTag(entry.tag).performScrollTo().performClick()
                        compose.waitForIdle()
                        entry.canary?.let(canaries::add)
                    }
                    is PrivacyEntry.Dialog -> Unit
                }
            }

            val saved = savedBundles { scenario.recreate() }
            // The flow is on screen again: on this screen, or where the session opens (a value kept in composition only is gone).
            waitFor(screen.path.firstOrNull() ?: screen.ready)

            assertTrue("the recreation saved a Bundle", saved.isNotEmpty())
            val text = saved.flatMap(SavedText::of)
            assertTrue("the saved state was read: ${text.size} values", text.size > 3)
            assertEquals("$screen: a canary in saved state", emptyList<String>(), canaries.filter { canary -> text.any { canary in it } })
            assertEquals(emptyList<String>(), server.otherPaths.toList())
        }
    }

    internal companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun screens(): List<Array<Any>> = PrivacyScreens.ALL.map { arrayOf<Any>(it) }
    }
}

/**
 * The controls for [SavedStateCanaryTest]: [SavedText] finds a value wherever saved state can hold
 * one, so a canary it does not report is not there. Each case saves the canary the way a careless
 * screen would (`DataAtRestScanTest` refuses those calls in SDK sources) and expects it found.
 */
@RunWith(RobolectricTestRunner::class)
internal class SavedTextTest {

    private val canary = PrivacyScreens.CANARY

    private fun found(saved: Any?): Boolean = SavedText.of(saved).any { canary in it }

    @Test
    fun `a string, a nested bundle, a list, an array, a sparse array, characters and bytes are read`() {
        assertTrue(found(Bundle().apply { putString("typed", canary) }))
        assertTrue(found(Bundle().apply { putBundle("inner", Bundle().apply { putBundle("deeper", Bundle().apply { putCharSequence("typed", canary) }) }) }))
        assertTrue(found(Bundle().apply { putStringArrayList("typed", arrayListOf("other", canary)) }))
        assertTrue(found(Bundle().apply { putStringArray("typed", arrayOf(canary)) }))
        assertTrue(found(Bundle().apply { putCharArray("typed", canary.toCharArray()) }))
        assertTrue(found(Bundle().apply { putByteArray("typed", canary.toByteArray(Charsets.UTF_8)) }))
        assertTrue(found(Bundle().apply { putByteArray("typed", canary.toByteArray(Charsets.UTF_16LE)) }))
        assertTrue(found(Bundle().apply { putSparseParcelableArray("typed", SparseArray<android.os.Parcelable>().apply { put(7, Bundle().apply { putString("x", canary) }) }) }))
        assertTrue(found(Bundle().apply { putSerializable("typed", hashMapOf("key" to listOf(canary))) }))
        assertTrue("a key", found(Bundle().apply { putInt(canary, 1) }))
    }

    @Test
    fun `a number saved as a number is read as its digits`() {
        val saved = Bundle().apply { putLong("typed", PrivacyScreens.DIGITS_CANARY.toLong()) }

        assertTrue(SavedText.of(saved).any { PrivacyScreens.DIGITS_CANARY in it })
    }

    @Test
    fun `a bundle without the canary reports none`() {
        assertEquals(false, found(Bundle().apply { putString("typed", "synthetic") }))
    }

    @Test
    fun `a value kept with rememberSaveable or rememberTextFieldState is found in the activity's saved state`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        controller.get().setContent {
            rememberSaveable { mutableStateOf("$canary plain") }
            rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("$canary value")) }
            rememberTextFieldState(initialText = "$canary state")
        }
        shadowOf(Looper.getMainLooper()).idle()

        val saved = Bundle().also(controller::saveInstanceState)
        val text = SavedText.of(saved)

        listOf("plain", "value", "state").forEach { kind -> assertTrue("$kind: ${text.size} values", text.any { "$canary $kind" in it }) }
        controller.pause().stop().destroy()
    }
}

/**
 * C213.1, C213.2 for the DG1 review (nfc-sdk, C207.5): what the chip's DG1 says is shown for the
 * person to confirm, marked accessibility-data-sensitive on API 34+, and no saved `Bundle` holds any
 * of it. The review is reached only after a chip read, so its screen is rendered here from its view.
 */
@RunWith(RobolectricTestRunner::class)
internal class NfcReviewSavedStateTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the DG1 review shows the chip's details, marks them data-sensitive and saves none of them`() {
        val canary = PrivacyScreens.CANARY.uppercase()
        val details = Dg1Details(name = "$canary SYNTHETIC", documentNumber = "D${PrivacyScreens.DIGITS_CANARY.take(8)}", nationality = "UTO", birthDate = "740812", expiryDate = "120415")
        rule.setContent {
            CompositionLocalProvider(LocalPlatformApiLevel provides 34) {
                NfcStepScreen(FlowState.Nfc(NfcStep("chip", fallbackAvailable = true), NfcView.Review(details)), RecordingActions())
            }
        }

        rule.onNodeWithTag(NfcStepTags.REVIEW).assert(SemanticsMatcher.expectValue(SemanticsProperties.IsSensitiveData, true))
        rule.onNodeWithText("$canary SYNTHETIC").assertExists()
        rule.onNodeWithText(details.documentNumber).assertExists()

        val saved = savedBundles { rule.activityRule.scenario.recreate() }

        assertTrue("the recreation saved a Bundle", saved.isNotEmpty())
        val text = saved.flatMap(SavedText::of)
        assertEquals(emptyList<String>(), listOf(canary, details.documentNumber).filter { value -> text.any { value in it } })
    }
}

/** The canary's screen step holds every form component the SDK decodes, so a new kind is typed into too. */
@RunWith(RobolectricTestRunner::class)
internal class ScreenComponentKindsTest {

    @Test
    fun `the canary's screen step holds every form component kind`() {
        val notForms = setOf("text", "image", "spacer", "container", "footer", "stepper", "button")
        val inTable = PrivacyScreens.ALL.first().entries.map { it.kind }.toSet() - "language"

        assertEquals((FlowComponentSerializer.kinds - notForms).sorted(), inTable.sorted())
    }
}
