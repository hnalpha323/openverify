package dev.openverify.sdk.ui.steps

import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PersonInput
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
 * C52.3, C61, C64.2: the business registry and website forms. The country of registration is
 * chosen by name, the registration number's help and error follow the chosen country's register,
 * the LEI and the URL say their form, and a business that collects people takes up to ten, each
 * with their own fields and objections. Every value is synthetic.
 */
@RunWith(RobolectricTestRunner::class)
class BusinessFormScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val drafts = InputDrafts()
    private val fields = listOf(
        InputField.BUSINESS_NAME, InputField.COUNTRY_CODE, InputField.REGISTRATION_NUMBER, InputField.LEI,
        InputField.ADDRESS_STREET_1, InputField.ADDRESS_STREET_2, InputField.ADDRESS_CITY, InputField.ADDRESS_SUBDIVISION,
        InputField.ADDRESS_POSTAL_CODE,
    )
    private val business = FlowState.Form(DatabaseBusinessStep("business"), fields, setOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE))
    private val withPeople = business.copy(step = DatabaseBusinessStep("business", collectAssociatedPersons = true), collectsPersons = true)
    private val website = FlowState.Form(BusinessWebsiteStep("website"), listOf(InputField.WEBSITE_URL, InputField.BUSINESS_NAME), setOf(InputField.WEBSITE_URL))

    /** [res] as a screen shows it: each value isolated (C199.5, K10A-2). */
    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args.map { isolated(it.toString()) }.toTypedArray()) }

    private fun type(tag: String, value: String) {
        rule.onNodeWithTag(tag).performScrollTo().performTextInput(value)
    }

    private fun choose(field: InputField, value: String) {
        rule.onNodeWithTag(TestTags.input(field)).performScrollTo().performClick()
        rule.onNodeWithTag(TestTags.option(value)).performScrollTo().performClick()
    }

    @Test
    fun `the business form chooses the country of registration by name and sends what was typed`() {
        rule.setContent { DatabaseBusinessStepScreen(business, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_business_title)).assertExists()
        rule.onNodeWithTag(TestTags.input(InputField.LEI)).assertTextContains(text(Res.string.openverify_field_lei_hint))
        type(TestTags.input(InputField.BUSINESS_NAME), "Example Widgets Ltd")
        choose(InputField.COUNTRY_CODE, "GB")
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).performScrollTo().performClick()

        rule.onNodeWithTag(TestTags.input(InputField.COUNTRY_CODE)).assertTextContains("United Kingdom")
        val sent = actions.sent.single() as Map<*, *>
        assertEquals("Example Widgets Ltd", sent[InputField.BUSINESS_NAME])
        assertEquals("GB", sent[InputField.COUNTRY_CODE])
    }

    @Test
    fun `the registration number's help and error follow the register of the chosen country`() {
        drafts["business:country-code"] = "GB"
        rule.setContent {
            DatabaseBusinessStepScreen(business.copy(errors = mapOf(InputField.REGISTRATION_NUMBER to InputProblem.INVALID)), drafts, actions)
        }

        rule.onNodeWithTag(TestTags.input(InputField.REGISTRATION_NUMBER))
            .assertTextContains(text(Res.string.openverify_field_registration_hint_gb))
            .assertTextContains(text(Res.string.openverify_field_error_registration_gb))
    }

    @Test
    fun `an LEI and a website URL say their own form when refused`() {
        rule.setContent { DatabaseBusinessStepScreen(business.copy(errors = mapOf(InputField.LEI to InputProblem.INVALID)), drafts, actions) }

        rule.onNodeWithTag(TestTags.input(InputField.LEI)).assertTextContains(text(Res.string.openverify_field_error_lei))
    }

    @Test
    fun `the website form asks for the URL with its help, and says its form when refused`() {
        rule.setContent { BusinessWebsiteStepScreen(website.copy(errors = mapOf(InputField.WEBSITE_URL to InputProblem.INVALID)), drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_website_title)).assertExists()
        rule.onNodeWithTag(TestTags.input(InputField.WEBSITE_URL))
            .assertTextContains(text(Res.string.openverify_field_website_hint))
            .assertTextContains(text(Res.string.openverify_field_error_url))
    }

    @Test
    fun `a business that collects people adds them one by one, each sent with their fields`() {
        rule.setContent { DatabaseBusinessStepScreen(withPeople, drafts, actions) }

        rule.onNodeWithText(text(Res.string.openverify_persons_title)).assertExists()
        rule.onNodeWithTag(TestTags.PERSON_ADD).performScrollTo().performClick()
        rule.onNodeWithTag(TestTags.PERSON_ADD).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_person_title, 2)).assertExists()
        type(TestTags.person(0, PersonField.NAME_FIRST), "Robin")
        type(TestTags.person(0, PersonField.NAME_LAST), "Sample")
        type(TestTags.person(0, PersonField.BIRTHDATE), "1980-04")
        type(TestTags.person(1, PersonField.NAME_FIRST), "Casey")
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).performScrollTo().performClick()

        assertEquals(
            listOf(
                mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to "Sample", PersonField.BIRTHDATE to "1980-04"),
                mapOf(PersonField.NAME_FIRST to "Casey", PersonField.NAME_LAST to "", PersonField.BIRTHDATE to ""),
            ),
            actions.sent.last(),
        )
    }

    @Test
    fun `removing a person keeps the others' values, and ten is the most`() {
        rule.setContent { DatabaseBusinessStepScreen(withPeople, drafts, actions) }

        repeat(10) { rule.onNodeWithTag(TestTags.PERSON_ADD).performScrollTo().performClick() }
        rule.onNodeWithTag(TestTags.PERSON_ADD).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_persons_full)).assertExists()
        type(TestTags.person(1, PersonField.NAME_FIRST), "Casey")
        rule.onNodeWithText(text(Res.string.openverify_person_remove, 1)).performScrollTo().performClick()

        rule.onNodeWithTag(TestTags.person(0, PersonField.NAME_FIRST)).assertTextContains("Casey")
        rule.onNodeWithTag(TestTags.person(9, PersonField.NAME_FIRST)).assertDoesNotExist()
        rule.onNodeWithTag(TestTags.PERSON_ADD).assertExists()
    }

    @Test
    fun `each person's objection shows on that person's field`() {
        drafts["business:persons"] = "2"
        rule.setContent {
            DatabaseBusinessStepScreen(
                withPeople.copy(
                    personErrors = mapOf(
                        PersonInput(1, PersonField.NAME_LAST) to InputProblem.MISSING,
                        PersonInput(0, PersonField.BIRTHDATE) to InputProblem.INVALID,
                    ),
                ),
                drafts,
                actions,
            )
        }

        rule.onNodeWithTag(TestTags.person(1, PersonField.NAME_LAST)).assertTextContains(text(Res.string.openverify_field_error_missing))
        rule.onNodeWithTag(TestTags.person(0, PersonField.BIRTHDATE)).assertTextContains(text(Res.string.openverify_field_error_birth_month))
        rule.onNodeWithTag(TestTags.person(0, PersonField.BIRTHDATE)).assertTextContains(text(Res.string.openverify_field_person_birthdate_hint))
    }
}
