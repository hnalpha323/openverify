package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.logic.DeviceLocales
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.AddressFields
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import dev.openverify.sdk.model.FlowValueSerializer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.util.Locale

/**
 * C196.3 (review H08): the values a screen sends, and the bounds its errors name, are ASCII on a
 * device whose own default locale formats digits in another script (`ar-EG`, `fa-IR`, `bn-BD`,
 * `mr-IN`, `my-MM`), with the SDK's chosen language both equal to the device's and different from it.
 * The device's locale is set as Android sets it (the Robolectric qualifier) and as the JVM reads it
 * (`Locale.setDefault`); the person types Arabic-Indic and Extended Arabic-Indic digits.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
internal class ScreenDeviceLocaleTest(private val device: String, private val sdkLanguage: String) {

    @get:Rule
    val rule = createComposeRule()

    private val previous: Locale = Locale.getDefault()

    @Before
    fun setDeviceLocale() {
        val locale = Locale.forLanguageTag(device)
        RuntimeEnvironment.setQualifiers("${locale.language}-r${locale.country}")
        Locale.setDefault(locale)
    }

    @After
    fun restoreLocale() {
        Locale.setDefault(previous)
    }

    private val copy = mapOf(
        "about.title.title" to "Synthetic title",
        "about.count.label" to "Count",
        "about.start.label" to "Start",
        "about.phone.label" to "Phone",
        "about.code.label" to "Code",
        "about.home.label" to "Home",
        "about.next.button" to "Continue",
    )

    private val step = ScreenStep(
        "about",
        listOf(
            TextComponent("title", "title", "about.title.title"),
            NumberComponent("count", "count", "about.count.label", min = 1000.0),
            DateComponent("start", "start", "about.start.label"),
            PhoneComponent("phone", "phone", "about.phone.label", allowedCountries = listOf("EG")),
            TextInputComponent("code", "code", "about.code.label"),
            AddressComponent("home", "about.home.label", AddressFields(street1 = "street", city = "city", postalCode = "postal", country = "country")),
            ButtonComponent("next", "about.next.button", "submit"),
        ),
    )

    private fun show(actions: ScreenActions) {
        rule.setContent {
            CompositionLocalProvider(LocalScreenEnvironment provides screenEnvironment(copy, language = sdkLanguage), LocalSdkLanguage provides sdkLanguage) {
                ScreenStepScreen(FlowState.Screen(step), actions)
            }
        }
    }

    @Test
    fun `typed digits in another script are sent as ASCII`() {
        val actions = ScreenActions()
        show(actions)

        rule.onNodeWithTag(ScreenTags.field("count")).performTextInput("١٢٣٤.٥")
        rule.onNodeWithTag(ScreenTags.field("start")).performScrollTo().performTextInput("٢٠٢٤-٠٢-٢٩")
        rule.onNodeWithTag(ScreenTags.field("phone")).performScrollTo().performTextInput("۱۰۰ ۱۲۳ ۴۵۶۷")
        rule.onNodeWithTag(ScreenTags.field("code")).performScrollTo().performTextInput("AB٤٢")
        rule.onNodeWithTag(ScreenTags.field("postal")).performScrollTo().performTextInput("۱۱۵۱۱")
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()

        val (values, button) = actions.submissions.single()
        assertEquals(null, button)
        assertEquals(FlowValue.Number(1234.5), values["count"])
        assertEquals(FlowValue.Text("2024-02-29"), values["start"])
        // The only allowed country is chosen for the person; the number goes out in international form.
        assertEquals(FlowValue.Text("+20 100 123 4567"), values["phone"])
        assertEquals(FlowValue.Text("AB42"), values["code"])
        assertEquals(FlowValue.Text("11511"), values["postal"])
        // The body as the client encodes it carries ASCII digits only.
        val body = OpenVerifyJson.encodeToString(MapSerializer(String.serializer(), FlowValueSerializer), values)
        assertTrue(body, body.none { it.isDigit() && it !in '0'..'9' })
    }

    @Test
    fun `an error's bound is named in ASCII digits`() {
        show(ScreenActions())

        rule.onNodeWithTag(ScreenTags.field("count")).performTextInput("٥")
        rule.onNodeWithTag(ScreenTags.component("next")).performScrollTo().performClick()

        val error = rule.onNodeWithTag(ScreenTags.field("count")).fetchSemanticsNode().config[SemanticsProperties.Error]
        assertTrue(error, "1000" in error)
        assertTrue(error, error.none { it.isDigit() && it !in '0'..'9' })
    }

    @Test
    fun `a picked date and a number shown again are ASCII under the device's locale`() {
        assertEquals("2024-02-29", isoDateOfEpochMillis(1_709_164_800_000))
        assertEquals("1000", numberText(1000.0))
        assertEquals("1234.5", numberText(1234.5))
    }

    internal companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0} device, SDK {1}")
        fun cases(): List<Array<String>> = DeviceLocales.tags().flatMap { tag ->
            val base = Locale.forLanguageTag(tag).language
            // Of these languages the SDK bundles only ar, so only ar-EG can choose its own; the others
            // choose another bundled language, the case where the two differ (C199.2).
            listOf(arrayOf(tag, if (base == "ar") "ar" else "en"), arrayOf(tag, if (base == "ar") "en" else "fr"))
        }
    }
}
