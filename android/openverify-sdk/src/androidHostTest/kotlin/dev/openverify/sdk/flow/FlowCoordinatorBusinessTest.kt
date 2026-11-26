package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.logic.TypedDigits
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.AssociatedPersonInputs
import dev.openverify.sdk.model.BusinessWebsiteInputs
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ContractFixturesTest
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowMetadata
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowTransition
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PersonInput
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.ProblemFieldError
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * C52.3, C61, C64.2: the business registry and business website steps in the flow engine. A
 * business step's verification is made when it opens, so the inputs every match group needs are
 * required on the device (C52.2); its values and people are checked, entered and submitted, and a
 * 422's pointers come back to their field or person. A website step needs no guidance: its
 * verification is made when the values are sent. Every value is synthetic.
 */
internal class FlowCoordinatorBusinessTest {

    private val business = DatabaseBusinessStep("business")
    private val withPeople = DatabaseBusinessStep("business", collectAssociatedPersons = true)
    private val website = BusinessWebsiteStep("website")
    private val completion = CompletionStep("completion", "flow.completion")
    private val failure = FailureStep("failure", "flow.failure")
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private val businessFields = listOf(
        InputField.BUSINESS_NAME,
        InputField.COUNTRY_CODE,
        InputField.REGISTRATION_NUMBER,
        InputField.LEI,
        InputField.ADDRESS_STREET_1,
        InputField.ADDRESS_STREET_2,
        InputField.ADDRESS_CITY,
        InputField.ADDRESS_SUBDIVISION,
        InputField.ADDRESS_POSTAL_CODE,
    )

    private val company = mapOf(
        InputField.BUSINESS_NAME to " Example Widgets Ltd ",
        InputField.COUNTRY_CODE to "GB",
        InputField.REGISTRATION_NUMBER to "01234567",
        InputField.ADDRESS_CITY to "",
    )

    private fun flowOf(vararg steps: FlowStep): Flow = Flow(
        FlowMetadata(specVersion = 1, id = "kyb", version = 1, name = "KYB"),
        steps.toList() + completion + failure,
        steps.map { FlowTransition(it.id, failure.id, ContractFixturesTest.FAILED_CONDITION) },
    )

    private fun api(vararg steps: FlowStep, verifications: List<FlowVerification> = emptyList()) = FakeFlowServer(
        flow = flowOf(*steps),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(NOW),
        verifications = verifications,
    )

    private fun coordinator(api: FakeFlowApi) = FlowCoordinator(api, INQUIRY_ID, settings)

    @Test
    fun `a business step makes its verification on opening and requires what every match group needs`() = runTest {
        val api = api(business)
        api.businessRequiredInputs = listOf("business-name", "registration-number")
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(
            FlowState.Form(business, businessFields, setOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE, InputField.REGISTRATION_NUMBER)),
            coordinator.state.value,
        )
        assertEquals(listOf("getSession", "createVerification:database-business", "getSession"), api.calls)
    }

    @Test
    fun `a business step that collects people says so, from its guidance`() = runTest {
        val coordinator = coordinator(api(withPeople))

        coordinator.start()

        assertEquals(
            FlowState.Form(withPeople, businessFields, setOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE), collectsPersons = true),
            coordinator.state.value,
        )
    }

    @Test
    fun `the business and its people are checked on the device first, and nothing is sent until they hold`() = runTest {
        val api = api(withPeople)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            company + (InputField.REGISTRATION_NUMBER to "1234567") + (InputField.LEI to "OPENVERIFYSYNTH00100"),
            listOf(mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to " ", PersonField.BIRTHDATE to "04/1980")),
        )

        val shown = coordinator.state.value as FlowState.Form
        assertEquals(mapOf(InputField.REGISTRATION_NUMBER to InputProblem.INVALID, InputField.LEI to InputProblem.INVALID), shown.errors)
        assertEquals(
            mapOf(
                PersonInput(0, PersonField.NAME_LAST) to InputProblem.MISSING,
                PersonInput(0, PersonField.BIRTHDATE) to InputProblem.INVALID,
            ),
            shown.personErrors,
        )
        assertEquals(0, api.calls.count { it == "enterInputs" })
    }

    @Test
    fun `the business and its people are entered, trimmed and without blanks, then the verification is submitted`() = runTest {
        val api = api(withPeople)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            company,
            listOf(
                mapOf(PersonField.NAME_FIRST to " Robin ", PersonField.NAME_LAST to "Sample", PersonField.BIRTHDATE to "1980-04"),
                mapOf(PersonField.NAME_FIRST to "Casey", PersonField.NAME_LAST to "Placeholder", PersonField.BIRTHDATE to ""),
            ),
        )

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        val id = api.verifications.single().id
        assertEquals(
            DatabaseBusinessInputs(
                "Example Widgets Ltd",
                "GB",
                registrationNumber = "01234567",
                associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample", "1980-04"), AssociatedPersonInputs("Casey", "Placeholder")),
            ),
            api.entered[id],
        )
        assertEquals(listOf(id), api.submits.map { it.verificationId })
    }

    @Test
    fun `a person's birth date and the registration number typed in Arabic-Indic digits are entered as ASCII (C196_3)`() = runTest {
        val api = api(withPeople)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            company + (InputField.REGISTRATION_NUMBER to TypedDigits.arabicIndic("01234567")),
            listOf(mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to "Sample", PersonField.BIRTHDATE to TypedDigits.arabicIndic("1980-04"))),
        )

        assertEquals(
            DatabaseBusinessInputs(
                "Example Widgets Ltd",
                "GB",
                registrationNumber = "01234567",
                associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample", "1980-04")),
            ),
            api.entered.values.single(),
        )
    }

    @Test
    fun `people are never sent for a step that does not collect them`() = runTest {
        val api = api(business)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(company, listOf(mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to "Sample")))

        assertEquals(null, (api.entered.values.single() as DatabaseBusinessInputs).associatedPersons)
    }

    @Test
    fun `a 422 pointer at a member left empty asks for it, and one at a person comes back to that person`() = runTest {
        val api = api(withPeople)
        api.failNext(
            "enterInputs",
            FlowApiException.Rejected(
                422,
                Problem(
                    status = 422,
                    errors = listOf(
                        ProblemFieldError(pointer = "/lei"),
                        ProblemFieldError(pointer = "/address-street-1"),
                        ProblemFieldError(pointer = "/associated-persons/0/name-last"),
                    ),
                ),
                null,
            ),
        )
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            company + (InputField.LEI to "OPENVERIFYSYNTH00181"),
            listOf(mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to "Sample")),
        )

        val shown = coordinator.state.value as FlowState.Form
        assertEquals(mapOf(InputField.LEI to InputProblem.REFUSED, InputField.ADDRESS_STREET_1 to InputProblem.MISSING), shown.errors)
        assertEquals(mapOf(PersonInput(0, PersonField.NAME_LAST) to InputProblem.REFUSED), shown.personErrors)
        assertEquals(false, shown.submitting)
    }

    @Test
    fun `a resumed business attempt whose values the server holds is submitted at once`() = runTest {
        val held = verification("ver_01M5CK16P0D13FXHZSS4TCFBV0", VerificationType.DATABASE_BUSINESS, VerificationStatus.INITIATED)
            .let { it.copy(attributes = it.attributes.copy(inputsReceived = true)) }
        val api = api(business, verifications = listOf(held))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(0, api.calls.count { it.startsWith("createVerification") || it == "enterInputs" })
    }

    @Test
    fun `a website step opens its form without making its verification, and checks the URL on the device`() = runTest {
        val api = api(website)
        val coordinator = coordinator(api)

        coordinator.start()
        assertEquals(FlowState.Form(website, listOf(InputField.WEBSITE_URL, InputField.BUSINESS_NAME), setOf(InputField.WEBSITE_URL)), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)

        coordinator.submitInputs(mapOf(InputField.WEBSITE_URL to "www.example.com"))
        assertEquals(mapOf(InputField.WEBSITE_URL to InputProblem.INVALID), (coordinator.state.value as FlowState.Form).errors)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a website's URL is entered with its verification made then, and the verification submitted`() = runTest {
        val api = api(website)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(mapOf(InputField.WEBSITE_URL to " https://www.example.com ", InputField.BUSINESS_NAME to ""))

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(BusinessWebsiteInputs("https://www.example.com"), api.entered.values.single())
        assertEquals(1, api.calls.count { it == "createVerification:business-website" })
    }
}
