package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.flow.logic.TypedDigits
import dev.openverify.sdk.flow.logic.normalisesDigits
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ContractFixturesTest
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DatabaseStep
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
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.ProblemFieldError
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.putJsonArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.SocketTimeoutException
import kotlin.time.Duration.Companion.seconds

/**
 * C52.3, C59, C64.2: the database step and the AAMVA step in the flow engine. A form's values are
 * checked on the device, entered, and the verification submitted; the server's 422 pointers come
 * back to their fields. A silent AAMVA step is never created or submitted by the client: it waits
 * until the server creates or skips its attempt (C59.6).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorFormTest {

    private val databaseStep = DatabaseStep(
        "db",
        listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.BIRTHDATE, DatabaseField.ADDRESS_STREET_1, DatabaseField.ADDRESS_COUNTRY_CODE),
        requiredFields = listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.BIRTHDATE, DatabaseField.ADDRESS_COUNTRY_CODE),
    )
    private val formStep = AamvaStep("aamva", AamvaSource.FORM)
    private val silentStep = AamvaStep("aamva", AamvaSource.GOVERNMENT_ID)
    private val completion = CompletionStep("completion", "flow.completion")
    private val failure = FailureStep("failure", "flow.failure")
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private val databaseFields = listOf(
        InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.ADDRESS_STREET_1, InputField.ADDRESS_COUNTRY_CODE,
    )
    private val databaseForm = FlowState.Form(
        databaseStep,
        databaseFields,
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.ADDRESS_COUNTRY_CODE),
    )
    private val aamvaForm = FlowState.Form(
        formStep,
        listOf(
            InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER,
            InputField.ISSUING_AUTHORITY, InputField.ISSUE_DATE, InputField.EXPIRATION_DATE, InputField.ADDRESS_POSTAL_CODE,
        ),
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER, InputField.ISSUING_AUTHORITY),
    )

    private val values = mapOf(
        InputField.NAME_FIRST to "  Jane ",
        InputField.NAME_LAST to "Example",
        InputField.BIRTHDATE to "1990-04-23",
        InputField.ADDRESS_STREET_1 to "",
        InputField.ADDRESS_COUNTRY_CODE to "US",
    )
    private val poBox = RetryHint("database_po_box_detection", listOf("po_box_detected"))

    private fun flowOf(vararg steps: FlowStep): Flow = Flow(
        FlowMetadata(specVersion = 1, id = "records", version = 1, name = "Records"),
        steps.toList() + completion + failure,
        steps.map { FlowTransition(it.id, failure.id, ContractFixturesTest.FAILED_CONDITION) },
    )

    private fun api(vararg steps: FlowStep, verifications: List<FlowVerification> = emptyList()) = FakeFlowServer(
        flow = flowOf(*steps),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(NOW),
        verifications = verifications,
    )

    private fun coordinator(api: FakeFlowApi, settings: FlowCoordinator.Settings = this.settings) = FlowCoordinator(api, INQUIRY_ID, settings)

    private fun TestScope.recordStates(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    // The database form (C52.3) -------------------------------------------------------------

    @Test
    fun `a database step opens its form with the step's fields in order and the ones it requires, creating nothing yet`() = runTest {
        val api = api(databaseStep)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(databaseForm, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a database step that names no required fields requires the names and the country, which every one collects (C50_3)`() = runTest {
        val api = api(databaseStep.copy(requiredFields = null))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(
            databaseForm.copy(step = databaseStep.copy(requiredFields = null), required = setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_COUNTRY_CODE)),
            coordinator.state.value,
        )
    }

    @Test
    fun `a database step's own required fields join the names and the country every database step requires, as the server's guidance does (C52_3)`() = runTest {
        val step = databaseStep.copy(requiredFields = listOf(DatabaseField.BIRTHDATE))
        val api = api(step)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(
            databaseForm.copy(
                step = step,
                required = setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.ADDRESS_COUNTRY_CODE),
            ),
            coordinator.state.value,
        )
    }

    @Test
    fun `entering the values creates the verification, sends the trimmed values the user gave, then submits and waits`() = runTest {
        val api = api(databaseStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()

        coordinator.submitInputs(values)

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(
            listOf("getSession", "createVerification:database", "enterInputs", "submit", "getVerification", "getSession"),
            api.calls,
        )
        assertEquals(
            DatabaseInputs(nameFirst = "Jane", nameLast = "Example", birthdate = "1990-04-23", addressCountryCode = "US"),
            api.entered.values.single(),
        )
        assertTrue(databaseForm.copy(submitting = true) in states, states.toString())
        assertTrue(FlowState.Processing(databaseStep) in states, states.toString())
    }

    @Test
    fun `a date typed in Arabic-Indic digits is checked and entered as ASCII (C196_3)`() = runTest {
        val api = api(databaseStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(values + (InputField.BIRTHDATE to TypedDigits.arabicIndic("1990-04-23")))

        assertEquals(
            DatabaseInputs(nameFirst = "Jane", nameLast = "Example", birthdate = "1990-04-23", addressCountryCode = "US"),
            api.entered.values.single(),
        )
    }

    @Test
    fun `the AAMVA form's dates, card number and postal code typed in Persian digits are entered as ASCII (C196_3)`() = runTest {
        val api = api(formStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            mapOf(
                InputField.NAME_FIRST to "Jane",
                InputField.NAME_LAST to "Example",
                InputField.BIRTHDATE to TypedDigits.persian("1990-04-23"),
                InputField.IDENTIFICATION_NUMBER to TypedDigits.persian("D1234567"),
                InputField.ISSUING_AUTHORITY to "CA",
                InputField.ADDRESS_POSTAL_CODE to TypedDigits.persian("90001"),
            ),
        )

        assertEquals(AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA", addressPostalCode = "90001"), api.entered.values.single())
    }

    @Test
    fun `every typed field of a form normalises its digits but the email address and the website, as the web flow does (C196_3)`() {
        assertEquals(
            setOf(InputField.EMAIL_ADDRESS, InputField.WEBSITE_URL, InputField.ADDRESS_COUNTRY_CODE, InputField.COUNTRY_CODE, InputField.ISSUING_AUTHORITY),
            InputField.entries.filterNot(::normalisesDigits).toSet(),
        )
    }

    @Test
    fun `a required field left blank, or a value outside its contract, is shown on its field and nothing is sent`() = runTest {
        val api = api(databaseStep)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(values + (InputField.NAME_LAST to "  ") + (InputField.BIRTHDATE to "1990-02-30"))

        assertEquals(
            databaseForm.copy(errors = mapOf(InputField.NAME_LAST to InputProblem.MISSING, InputField.BIRTHDATE to InputProblem.INVALID)),
            coordinator.state.value,
        )
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a value for a field the step does not collect is never sent`() = runTest {
        val api = api(databaseStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(values + (InputField.EMAIL_ADDRESS to "jane@example.test") + (InputField.ISSUING_AUTHORITY to "CA"))

        assertEquals(
            DatabaseInputs(nameFirst = "Jane", nameLast = "Example", birthdate = "1990-04-23", addressCountryCode = "US"),
            api.entered.values.single(),
        )
    }

    @Test
    fun `the server's 422 pointers come back to their fields, and the next try uses the same verification`() = runTest {
        val api = api(databaseStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext(
            "enterInputs",
            FlowApiException.Rejected(
                422,
                Problem(
                    status = 422,
                    errors = listOf(ProblemFieldError("body", "/birthdate", "is outside the range"), ProblemFieldError(pointer = "/address-street-1")),
                ),
                null,
            ),
        )

        coordinator.submitInputs(values)
        val refused = coordinator.state.value
        coordinator.submitInputs(values)

        assertEquals(
            databaseForm.copy(errors = mapOf(InputField.BIRTHDATE to InputProblem.REFUSED, InputField.ADDRESS_STREET_1 to InputProblem.REFUSED)),
            refused,
        )
        assertEquals(1, api.calls.count { it == "createVerification:database" })
        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
    }

    @Test
    fun `a 422 that names no field this form shows says the values were refused`() = runTest {
        val api = api(databaseStep)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("enterInputs", FlowApiException.Rejected(422, Problem(status = 422, errors = listOf(ProblemFieldError(pointer = "/name-middle"))), null))

        coordinator.submitInputs(values)

        assertEquals(databaseForm.copy(refused = true), coordinator.state.value)
    }

    @Test
    fun `a failed attempt with attempts left opens the form again with its hints and a new verification`() = runTest {
        val twice = databaseStep.copy(maxAttempts = 2)
        val api = api(twice, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.DATABASE, VerificationStatus.FAILED, poBox)))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()
        val opened = coordinator.state.value
        coordinator.submitInputs(values)

        assertEquals(databaseForm.copy(step = twice, retryHints = listOf(poBox)), opened)
        assertEquals(1, api.calls.count { it == "createVerification:database" })
    }

    @Test
    fun `a typed step's failed attempt with no retry hints is never retried, the server's position ends the flow, with attempts left (K7A-6, C50_5)`() = runTest {
        val twice = databaseStep.copy(maxAttempts = 2)
        val api = api(twice, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.DATABASE, VerificationStatus.REQUIRES_RETRY)))
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        assertTrue(states.none { it is FlowState.Form }, states.toString())
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `a database step's one attempt used up ends where the server's position ends it (C50_1)`() = runTest {
        val api = api(databaseStep, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.DATABASE, VerificationStatus.FAILED)))
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        assertTrue(states.none { it is FlowState.Form }, states.toString())
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `the server's guidance gives the fields and the required ones when it has some (C52_2)`() = runTest {
        val initiated = verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.DATABASE, VerificationStatus.INITIATED)
        val guided = initiated.copy(
            attributes = initiated.attributes.copy(
                guidance = buildJsonObject {
                    putJsonArray("fields") { listOf("name-first", "name-last", "address-country-code", "email-address").forEach { add(it) } }
                    putJsonArray("required-fields") { add("email-address") }
                },
            ),
        )
        val api = api(databaseStep, verifications = listOf(guided))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(
            databaseForm.copy(
                fields = listOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_COUNTRY_CODE, InputField.EMAIL_ADDRESS),
                required = setOf(InputField.EMAIL_ADDRESS),
            ),
            coordinator.state.value,
        )
    }

    @Test
    fun `resuming an attempt whose values the server holds submits it at once`() = runTest {
        val initiated = verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.DATABASE, VerificationStatus.INITIATED)
        val api = api(databaseStep, verifications = listOf(initiated.copy(attributes = initiated.attributes.copy(inputsReceived = true))))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf("getSession", "submit", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `a lost answer while entering the values is retried with the same values`() = runTest {
        val api = api(databaseStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("enterInputs", FlowApiException.Network(SocketTimeoutException("timeout")))

        coordinator.submitInputs(values)
        val failed = coordinator.state.value
        coordinator.retry()

        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), failed)
        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(2, api.calls.count { it == "enterInputs" })
        assertEquals(1, api.calls.count { it == "createVerification:database" })
    }

    // The AAMVA form (C52.3, C59.5) ----------------------------------------------------------

    @Test
    fun `an AAMVA form step opens on the card's details, five of them required`() = runTest {
        val api = api(formStep)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(aamvaForm, coordinator.state.value)
    }

    @Test
    fun `the AAMVA form sends the card's details as printed`() = runTest {
        val api = api(formStep)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(
            mapOf(
                InputField.NAME_FIRST to "Jane",
                InputField.NAME_LAST to "Example",
                InputField.BIRTHDATE to "1990-04-23",
                InputField.IDENTIFICATION_NUMBER to "D1234567",
                InputField.ISSUING_AUTHORITY to "CA",
                InputField.ADDRESS_POSTAL_CODE to "90001",
            ),
        )

        assertEquals(AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA", addressPostalCode = "90001"), api.entered.values.single())
        assertEquals(listOf("getSession", "createVerification:aamva", "enterInputs", "submit", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `an AAMVA form without its required details, or with a ZIP code of another form, sends nothing`() = runTest {
        val api = api(formStep)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitInputs(mapOf(InputField.NAME_FIRST to "Jane", InputField.ISSUING_AUTHORITY to "ON", InputField.ADDRESS_POSTAL_CODE to "9000"))

        assertEquals(
            aamvaForm.copy(
                errors = mapOf(
                    InputField.NAME_LAST to InputProblem.MISSING,
                    InputField.BIRTHDATE to InputProblem.MISSING,
                    InputField.IDENTIFICATION_NUMBER to InputProblem.MISSING,
                    InputField.ISSUING_AUTHORITY to InputProblem.INVALID,
                    InputField.ADDRESS_POSTAL_CODE to InputProblem.INVALID,
                ),
            ),
            coordinator.state.value,
        )
        assertEquals(listOf("getSession"), api.calls)
    }

    // The silent AAMVA step (C59.6) ----------------------------------------------------------

    @Test
    fun `a silent AAMVA step waits while the server has not created its attempt, then waits for its decision, never creating it`() = runTest {
        val api = api(silentStep)
        api.createAfter(reads = 1, verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.AAMVA, VerificationStatus.SUBMITTED))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertTrue(FlowState.Processing(silentStep) in states, states.toString())
        assertEquals(listOf("getSession", "getSession", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `a silent AAMVA attempt the server skipped is done (C50_5)`() = runTest {
        val api = api(silentStep, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.AAMVA, VerificationStatus.SKIPPED)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.PENDING), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a failed silent AAMVA attempt has no retry, so the flow ends where the server's position ends it (C50_5)`() = runTest {
        val api = api(silentStep, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.AAMVA, VerificationStatus.FAILED)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `a silent AAMVA step the server never creates stops waiting with a retry`() = runTest {
        val api = api(silentStep)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true), coordinator.state.value)
        assertEquals(1 + settings.pollAttempts, api.calls.count { it == "getSession" })
        assertTrue(api.calls.none { it.startsWith("createVerification") }, api.calls.toString())
    }

    // Paths the tests above leave out (pinned after the code) -----------------------------------

    @Test
    fun `each database field is asked as the body member of its name (C52_3)`() = runTest {
        val every = DatabaseStep("db", DatabaseField.entries.toList())
        val api = api(every)
        val coordinator = coordinator(api)

        coordinator.start()

        val fields = (coordinator.state.value as FlowState.Form).fields
        assertEquals(
            DatabaseField.entries.map { it.name.lowercase().replace('_', '-') },
            fields.map { it.wireName },
        )
    }

    @Test
    fun `a silent AAMVA attempt whose status this SDK does not know stops the step instead of guessing`() = runTest {
        val api = api(silentStep, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.AAMVA, VerificationStatus.UNKNOWN)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported("verification status unknown"), coordinator.state.value)
    }

    @Test
    fun `a refusal of the values that is not a 422 shows the error screen`() = runTest {
        val api = api(databaseStep)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("enterInputs", FlowApiException.Rejected(400, Problem(status = 400), null))

        coordinator.submitInputs(values)

        assertEquals(FlowState.Error(FlowError.REJECTED, canRetry = false), coordinator.state.value)
    }
}
