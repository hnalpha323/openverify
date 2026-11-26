package dev.openverify.sdk.ui.screen

import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.KeyboardType
import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.FilledText
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.AddressFields
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UrlComponent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** C195.1-C195.3, C199.6 (Workflow 10A, android-screens): the screen's texts, links, dates and keyboards, pure. */
internal class ScreenTextsTest {

    private val step = ScreenStep(
        "about",
        listOf(
            TextComponent("title", "title", "about.title.title"),
            TextInputComponent("nickname", "nickname", "about.nickname.label", hintKey = "about.nickname.hint"),
            SelectComponent("kind", "kind", "about.kind.label", options = listOf(ComponentOption("p", "person", "about.kind.p"))),
            StepperComponent("steps", listOf("about.s1", "about.s2"), current = 1),
            ImageComponent("logo", "tas_synthetic", altKey = "about.logo.alt", decorative = false),
            ImageComponent("flourish", "tas_synthetic", altKey = "about.flourish.alt", decorative = true),
            ButtonComponent("next", "about.next.button", "submit"),
        ),
    )

    @Test
    fun `a screen needs every text label button stepper label and non-decorative alternative never a hint or an option label`() {
        assertEquals(
            listOf("about.title.title", "about.nickname.label", "about.kind.label", "about.s1", "about.s2", "about.logo.alt", "about.next.button"),
            requiredTextKeys(step),
        )
    }

    @Test
    fun `a screen whose required words are all there is complete one gap makes it incomplete`() {
        val all = requiredTextKeys(step).associateWith { ComponentText(FilledText(it, it), "en") }

        assertTrue(screenTextsComplete(step) { all[it] })
        assertFalse(screenTextsComplete(step) { (all - "about.s2")[it] })
    }

    @Test
    fun `only https links with a host are opened`() {
        assertTrue(isHttpsLink("https://example.com/help"))
        assertTrue(isHttpsLink("https://example.com:8443/help?q=1#top"))
        listOf(
            null, "http://example.com", "HTTPS://example.com", "https://", "https:///path", "javascript:alert(1)",
            "intent://example.com", "https://exa mple.com", "https://example.com\\@evil.example", "file:///sdcard/x",
        ).forEach { assertFalse(isHttpsLink(it), it.toString()) }
    }

    @Test
    fun `a picked date is its ISO day in ASCII digits and back`() {
        assertEquals("1970-01-01", isoDateOfEpochMillis(0))
        assertEquals("1969-12-31", isoDateOfEpochMillis(-1))
        assertEquals("2024-02-29", isoDateOfEpochMillis(1_709_164_800_000))
        assertEquals(1_709_164_800_000, epochMillisOfIsoDate("2024-02-29"))
        assertEquals(-86_400_000, epochMillisOfIsoDate("1969-12-31"))
        assertNull(epochMillisOfIsoDate("2023-02-29"))
        assertNull(epochMillisOfIsoDate(""))
        listOf("0001-01-01", "1900-03-01", "2000-02-29", "2099-12-31").forEach { day ->
            assertEquals(day, isoDateOfEpochMillis(epochMillisOfIsoDate(day)!!))
        }
    }

    private fun input(component: dev.openverify.sdk.model.FormComponent, part: AddressPart? = null): FieldInput? =
        fieldInputOf(BoundField((component as? dev.openverify.sdk.model.FieldComponent)?.field ?: "x", component, part))

    @Test
    fun `each typed kind has its keyboard and autofill hint and a secret none - C195_2`() {
        assertEquals(ContentType.EmailAddress, input(EmailComponent("e", "email", "l"))?.contentType)
        assertEquals(KeyboardType.Email, input(EmailComponent("e", "email", "l"))?.keyboard?.keyboardType)
        assertEquals(ContentType.PhoneNumber, input(PhoneComponent("p", "phone", "l"))?.contentType)
        assertEquals(ContentType.BirthDateFull, input(DateComponent("d", "date_of_birth", "l"))?.contentType)
        assertNull(input(DateComponent("d", "start_date", "l"))?.contentType)
        assertEquals(KeyboardType.Decimal, input(NumberComponent("n", "count", "l"))?.keyboard?.keyboardType)
        assertEquals(KeyboardType.Uri, input(UrlComponent("u", "site", "l"))?.keyboard?.keyboardType)
        assertEquals(false, input(TextAreaComponent("t", "bio", "l"))?.singleLine)

        val secret = input(MaskedTextComponent("m", "secret", "l"))!!
        assertNull(secret.contentType)
        assertTrue(secret.secret && secret.masked)
        assertEquals(KeyboardType.Text, secret.keyboard.keyboardType)
        assertEquals(false, secret.keyboard.autoCorrectEnabled)

        val address = AddressComponent("a", "l", AddressFields(street1 = "s1", street2 = "s2", city = "c", subdivision = "r", postalCode = "z", country = "k"))
        assertEquals(
            listOf(ContentType.AddressStreet, ContentType.AddressAuxiliaryDetails, ContentType.AddressLocality, ContentType.AddressRegion, ContentType.PostalCode, null),
            AddressPart.entries.map { input(address, it)?.contentType },
        )
        assertNull(input(address, AddressPart.COUNTRY))
        assertNull(input(CheckboxComponent("c", "agree", "l")))
        assertNull(input(SelectComponent("s", "kind", "l", options = listOf(ComponentOption("p", "person", "k")))))
    }
}
