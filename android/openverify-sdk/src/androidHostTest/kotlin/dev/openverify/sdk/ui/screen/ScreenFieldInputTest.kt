package dev.openverify.sdk.ui.screen

import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.AddressFields
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UrlComponent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C195.2 (review P07): each typed field kind's keyboard as the IME receives it (the focused field's
 * `EditorInfo`) and its autofill hint as the autofill service receives it (the `ContentType`
 * semantics Compose populates the `ViewStructure` from). A secret (`masked_text`) carries no
 * autofill content type and has autocorrect off. Compose 1.11 cannot do more, which the TDD file
 * records: its `EditorInfo` never sets `IME_FLAG_NO_PERSONALIZED_LEARNING`, a password keyboard
 * would declare `ContentType.Password`, and it has no per-node "not important for autofill".
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
internal class ScreenFieldInputTest {

    @get:Rule
    val rule = createComposeRule()

    private lateinit var view: View

    private fun editorInfoOf(component: FlowComponent, key: String): EditorInfo {
        val copy = mapOf("about.title.title" to "About you", "about.field.label" to "Synthetic field")
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalScreenEnvironment provides screenEnvironment(copy)) {
                ScreenStepScreen(FlowState.Screen(ScreenStep("about", listOf(TextComponent("title", "title", "about.title.title"), component))), ScreenActions())
            }
        }
        rule.onNodeWithTag(ScreenTags.field(key)).performClick()
        return rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }
    }

    private fun assertKeyboard(info: EditorInfo, inputType: Int) {
        assertEquals("input type", inputType, info.inputType)
        assertEquals("autocorrect is off", 0, info.inputType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
        // Recorded in the TDD file: Compose 1.11 never sets it; the keyboard type stands in for it.
        assertEquals("no personalised learning flag", 0, info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING)
    }

    private fun assertContentType(key: String, type: ContentType?) {
        rule.onNodeWithTag(ScreenTags.field(key)).assert(
            if (type == null) SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType) else SemanticsMatcher.expectValue(SemanticsProperties.ContentType, type),
        )
    }

    @Test
    fun `masked text is a secret, with no autofill content type and plain text without autocorrect, shown masked`() {
        val info = editorInfoOf(MaskedTextComponent("secret", "secret", "about.field.label"), "secret")

        // Not the password variation: Compose 1.11 declares ContentType.Password for it (FieldInput.kt).
        assertKeyboard(info, InputType.TYPE_CLASS_TEXT)
        assertContentType("secret", null)
        rule.onNodeWithTag(ScreenTags.field("secret")).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
    }

    @Test
    fun `an email field asks for an email keyboard and the email autofill hint`() {
        assertKeyboard(editorInfoOf(EmailComponent("email", "email", "about.field.label"), "email"), InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        assertContentType("email", ContentType.EmailAddress)
    }

    @Test
    fun `a phone field asks for the phone keyboard and the phone autofill hint`() {
        assertKeyboard(editorInfoOf(PhoneComponent("phone", "phone", "about.field.label", allowedCountries = listOf("US")), "phone"), InputType.TYPE_CLASS_PHONE)
        assertContentType("phone", ContentType.PhoneNumber)
    }

    @Test
    fun `a number field asks for decimal digits and carries no autofill hint`() {
        assertKeyboard(
            editorInfoOf(NumberComponent("count", "count", "about.field.label"), "count"),
            InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL,
        )
        assertContentType("count", null)
    }

    @Test
    fun `a birth date asks for digits and the full birth date hint, another date no hint`() {
        assertKeyboard(editorInfoOf(DateComponent("birthdate", "birthdate", "about.field.label"), "birthdate"), InputType.TYPE_CLASS_NUMBER)
        assertContentType("birthdate", ContentType.BirthDateFull)
    }

    @Test
    fun `a date that is not a birth date carries no autofill hint`() {
        editorInfoOf(DateComponent("start_date", "start_date", "about.field.label"), "start_date")
        assertContentType("start_date", null)
    }

    @Test
    fun `a web address asks for the URI keyboard`() {
        assertKeyboard(editorInfoOf(UrlComponent("site", "site", "about.field.label"), "site"), InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        assertContentType("site", null)
    }

    @Test
    fun `a text input is plain text without autocorrect or a hint`() {
        assertKeyboard(editorInfoOf(TextInputComponent("nickname", "nickname", "about.field.label"), "nickname"), InputType.TYPE_CLASS_TEXT)
        assertContentType("nickname", null)
    }

    @Test
    fun `a text area takes several lines and capitalises sentences`() {
        val info = editorInfoOf(TextAreaComponent("bio", "bio", "about.field.label"), "bio")

        assertEquals(
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT,
            info.inputType,
        )
    }

    @Test
    fun `an address part carries its own autofill hint, a postal code in capitals`() {
        val address = AddressComponent(
            "home",
            "about.field.label",
            AddressFields(street1 = "street", city = "city", postalCode = "postal", country = "country", subdivision = "region"),
        )
        val info = editorInfoOf(address, "postal")

        assertKeyboard(info, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        assertContentType("postal", ContentType.PostalCode)
        assertContentType("street", ContentType.AddressStreet)
        assertContentType("city", ContentType.AddressLocality)
        assertContentType("region", ContentType.AddressRegion)
    }
}
