package dev.openverify.sdk.ui.steps

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.logic.TypedDigits
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C52.3, C64.2: the database and AAMVA forms. Each field the step collects is labelled, optional
 * ones say so, countries and US jurisdictions are chosen by name, and each objection shows on its
 * own field.
 */
@RunWith(RobolectricTestRunner::class)
class FormStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val drafts = InputDrafts()

    private val databaseStep = DatabaseStep(
        "db",
        listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.BIRTHDATE, DatabaseField.ADDRESS_COUNTRY_CODE, DatabaseField.EMAIL_ADDRESS),
    )
    private val databaseForm = FlowState.Form(
        databaseStep,
        listOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.ADDRESS_COUNTRY_CODE, InputField.EMAIL_ADDRESS),
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_COUNTRY_CODE),
    )
    private val aamvaForm = FlowState.Form(
        AamvaStep("aamva", AamvaSource.FORM),
        listOf(
            InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER,
            InputField.ISSUING_AUTHORITY, InputField.ISSUE_DATE, InputField.EXPIRATION_DATE, InputField.ADDRESS_POSTAL_CODE,
        ),
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER, InputField.ISSUING_AUTHORITY),
    )

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun type(field: InputField, value: String) {
        rule.onNodeWithTag(TestTags.input(field)).performScrollTo().performTextInput(value)
    }

    private fun choose(field: InputField, value: String) {
        rule.onNodeWithTag(TestTags.input(field)).performScrollTo().performClick()
        // The country menu lists every region, more than a phone screen shows.
        rule.onNodeWithTag(TestTags.option(value)).performScrollTo().performClick()
    }

    private fun pressContinue() {
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).performScrollTo().performClick()
    }

    @Test
    fun `the database form labels each field the step collects, saying which are optional, and sends what was typed`() {
        rule.setContent { DatabaseStepScreen(databaseForm, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_database_title)).assertExists()
        rule.onNodeWithTag(TestTags.input(InputField.BIRTHDATE)).assertTextContains(text(Res.string.openverify_field_optional))
        rule.onNodeWithTag(TestTags.input(InputField.ADDRESS_STREET_1)).assertDoesNotExist()
        type(InputField.NAME_FIRST, "Jane")
        type(InputField.NAME_LAST, "Example")
        type(InputField.BIRTHDATE, "1990-04-23")
        choose(InputField.ADDRESS_COUNTRY_CODE, "US")
        pressContinue()

        rule.onNodeWithTag(TestTags.input(InputField.ADDRESS_COUNTRY_CODE)).assertTextContains("United States")
        assertEquals(
            listOf<Any?>(
                mapOf(
                    InputField.NAME_FIRST to "Jane",
                    InputField.NAME_LAST to "Example",
                    InputField.BIRTHDATE to "1990-04-23",
                    InputField.ADDRESS_COUNTRY_CODE to "US",
                    InputField.EMAIL_ADDRESS to "",
                ),
            ),
            actions.sent,
        )
    }

    @Test
    fun `a date typed in Arabic-Indic digits shows and is sent as ASCII, and an email address stays as typed (C196_3)`() {
        rule.setContent { DatabaseStepScreen(databaseForm, drafts, actions) }

        type(InputField.NAME_FIRST, "Jane")
        type(InputField.NAME_LAST, "Example")
        type(InputField.BIRTHDATE, TypedDigits.arabicIndic("1990-04-23"))
        type(InputField.EMAIL_ADDRESS, "jane" + TypedDigits.arabicIndic("7") + "@example.test")
        choose(InputField.ADDRESS_COUNTRY_CODE, "US")
        rule.onNodeWithTag(TestTags.input(InputField.BIRTHDATE)).assertTextContains("1990-04-23")
        pressContinue()

        assertEquals(
            listOf<Any?>(
                mapOf(
                    InputField.NAME_FIRST to "Jane",
                    InputField.NAME_LAST to "Example",
                    InputField.BIRTHDATE to "1990-04-23",
                    InputField.ADDRESS_COUNTRY_CODE to "US",
                    InputField.EMAIL_ADDRESS to "jane" + TypedDigits.arabicIndic("7") + "@example.test",
                ),
            ),
            actions.sent,
        )
    }

    @Test
    fun `each objection shows on its own field, and a refusal no field shows is said above them`() {
        val refused = databaseForm.copy(
            errors = mapOf(
                InputField.NAME_FIRST to InputProblem.MISSING,
                InputField.BIRTHDATE to InputProblem.INVALID,
                InputField.NAME_LAST to InputProblem.TOO_LONG,
                InputField.EMAIL_ADDRESS to InputProblem.REFUSED,
            ),
            refused = true,
        )
        rule.setContent { DatabaseStepScreen(refused, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_form_refused)).assertExists()
        rule.onNodeWithTag(TestTags.input(InputField.NAME_FIRST)).assertTextContains(text(Res.string.openverify_field_error_missing))
        rule.onNodeWithTag(TestTags.input(InputField.BIRTHDATE)).assertTextContains(text(Res.string.openverify_field_error_date))
        rule.onNodeWithTag(TestTags.input(InputField.NAME_LAST)).assertTextContains(text(Res.string.openverify_field_error_too_long))
        rule.onNodeWithTag(TestTags.input(InputField.EMAIL_ADDRESS)).assertTextContains(text(Res.string.openverify_field_error_refused))
    }

    @Test
    fun `a value outside its form shows the field's own words`() {
        rule.setContent { DatabaseStepScreen(databaseForm.copy(errors = mapOf(InputField.EMAIL_ADDRESS to InputProblem.INVALID)), drafts, actions) }

        rule.onNodeWithTag(TestTags.input(InputField.EMAIL_ADDRESS)).assertTextContains(text(Res.string.openverify_field_error_invalid))
    }

    @Test
    fun `while the values are on their way the form says so and cannot be sent again`() {
        rule.setContent { DatabaseStepScreen(databaseForm.copy(submitting = true), drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_form_submitting)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).assertIsNotEnabled()
    }

    @Test
    fun `the previous attempt's hints show above the form`() {
        val hinted = databaseForm.copy(retryHints = listOf(RetryHint("database_po_box_detection", listOf("po_box_detected"))))
        rule.setContent { DatabaseStepScreen(hinted, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_retry_title_attempt)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_retry_po_box_detected)).assertExists()
    }

    @Test
    fun `the AAMVA form asks for the card's details, with the issuing state chosen by name`() {
        rule.setContent { AamvaStepScreen(aamvaForm, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_aamva_title)).assertExists()
        rule.onNodeWithTag(TestTags.input(InputField.IDENTIFICATION_NUMBER)).assertTextContains(text(Res.string.openverify_field_license_number))
        rule.onNodeWithTag(TestTags.input(InputField.ADDRESS_POSTAL_CODE)).assertTextContains(text(Res.string.openverify_field_zip_code))
        type(InputField.NAME_FIRST, "Jane")
        type(InputField.NAME_LAST, "Example")
        type(InputField.BIRTHDATE, "1990-04-23")
        type(InputField.IDENTIFICATION_NUMBER, "D1234567")
        choose(InputField.ISSUING_AUTHORITY, "CA")
        pressContinue()

        rule.onNodeWithTag(TestTags.input(InputField.ISSUING_AUTHORITY)).assertTextContains("California")
        val sent = actions.sent.single() as Map<*, *>
        assertEquals("CA", sent[InputField.ISSUING_AUTHORITY])
        assertEquals("D1234567", sent[InputField.IDENTIFICATION_NUMBER])
    }

    @Test
    fun `values typed earlier are still there when the form comes back`() {
        drafts["db:name-first"] = "Jane"
        rule.setContent { DatabaseStepScreen(databaseForm, drafts, actions) }

        rule.onNodeWithTag(TestTags.input(InputField.NAME_FIRST)).assertTextContains("Jane")
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).assertIsEnabled()
    }
}
