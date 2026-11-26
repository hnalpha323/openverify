package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.CODE_EXPIRES_AT
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.MASKED_DESTINATION
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.RESEND_AVAILABLE_AT
import dev.openverify.sdk.flow.FakeFlowApi.Companion.conflict
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.flow.logic.TypedDigits
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ContractFixturesTest
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowMetadata
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowTransition
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.net.SocketTimeoutException
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/**
 * C55, C64.2: the phone and email steps in the flow engine, against a fake C55 server. The number
 * or address is entered, a code sent and confirmed, and the verification submitted at once; every
 * refusal the server can answer leads somewhere, so no request leaves the user without a next step
 * (C55.6, H07, V11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorOtpTest {

    private val phoneStep = PhoneOtpStep("phone", listOf("US", "CA"))
    private val emailStep = EmailOtpStep("email", codeLength = 8)
    private val completion = CompletionStep("completion", "flow.completion")
    private val failure = FailureStep("failure", "flow.failure")
    private val phone = OtpDestination.Phone("+1 555 555 0100")
    private val email = OtpDestination.Email("jane@example.test")
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private val entry = FlowState.Otp(phoneStep, OtpChannel.PHONE, listOf("US", "CA"), codeLength = 6)

    /** The fake server's open code after its first send (`FakeFlowApi.otpGuidance`). */
    private val firstCode = OtpCode(
        MASKED_DESTINATION,
        Instant.parse(CODE_EXPIRES_AT),
        Instant.parse(RESEND_AVAILABLE_AT),
        sendsRemaining = 4,
        attemptsRemaining = 5,
    )

    private val notConfirmed = RetryHint("phone_number_otp_comparison", listOf("otp_not_confirmed"))

    private fun flowOf(vararg steps: FlowStep): Flow = Flow(
        FlowMetadata(specVersion = 1, id = "phone", version = 1, name = "Phone"),
        steps.toList() + completion + failure,
        steps.map { FlowTransition(it.id, failure.id, ContractFixturesTest.FAILED_CONDITION) },
    )

    private fun api(vararg steps: FlowStep, verifications: List<FlowVerification> = emptyList()) = FakeFlowServer(
        flow = flowOf(*(if (steps.isEmpty()) arrayOf(phoneStep) else steps)),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(NOW),
        verifications = verifications,
    )

    private fun coordinator(api: FakeFlowApi) = FlowCoordinator(api, INQUIRY_ID, settings)

    private fun TestScope.recordStates(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    private fun FakeFlowApi.created(): String = verifications.last().id

    /** A phone verification the server holds with an open code, as a session lists it. */
    private fun withOpenCode(api: FakeFlowApi, status: VerificationStatus = VerificationStatus.INITIATED): FlowVerification =
        verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, status).let {
            it.copy(attributes = it.attributes.copy(guidance = api.otpGuidance(VerificationType.PHONE_NUMBER, 3, 2)))
        }

    // The destination and the code -----------------------------------------------------------

    @Test
    fun `a phone step opens on the number entry with the step's countries and a six-digit code, creating nothing yet`() = runTest {
        val api = api()
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(entry, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `sending a code creates the verification, sends it to the number and opens the code entry`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()

        coordinator.sendOtp(phone)

        assertEquals(entry.copy(code = firstCode), coordinator.state.value)
        assertTrue(entry.copy(busy = true) in states, states.toString())
        assertEquals(listOf("getSession", "createVerification:phone-number", "sendOtp"), api.calls)
        assertEquals(listOf<OtpDestination>(phone), api.otpDestinations)
    }

    @Test
    fun `a correct code confirms, submits at once and the step is done once it passes (C50_7)`() = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()
        coordinator.sendOtp(phone)

        coordinator.confirmOtp("123456")

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(
            listOf("getSession", "createVerification:phone-number", "sendOtp", "confirmOtp", "submit", "getVerification", "getSession"),
            api.calls,
        )
        assertTrue(FlowState.Processing(phoneStep) in states, states.toString())
    }

    @Test
    fun `a wrong code stays on the code entry, saying so with the tries left (C52_7)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)

        coordinator.confirmOtp("000000")

        assertEquals(entry.copy(code = firstCode.copy(attemptsRemaining = 4), error = OtpError.CODE_INCORRECT), coordinator.state.value)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource("otp_expired, CODE_EXPIRED", "otp_code_exhausted, CODE_EXHAUSTED")
    fun `an expired or exhausted code stays on the code entry, saying a new one is needed`(code: String, error: OtpError) = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.failNext("confirmOtp", conflict(code))

        coordinator.confirmOtp("123456")

        val expected = if (error == OtpError.CODE_EXHAUSTED) firstCode.copy(attemptsRemaining = 0) else firstCode
        assertEquals(entry.copy(code = expected, error = error), coordinator.state.value)
    }

    @Test
    fun `a confirm the server says had no code goes back to the entry, asking for one first`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.failNext("confirmOtp", conflict("otp_not_sent"))

        coordinator.confirmOtp("123456")

        assertEquals(entry.copy(error = OtpError.CODE_NOT_SENT), coordinator.state.value)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource("arabic-indic", "persian")
    fun `a code typed in Arabic-Indic or Persian digits is confirmed as its ASCII digits (C196_3)`(keyboard: String) = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)

        coordinator.confirmOtp(if (keyboard == "persian") TypedDigits.persian("123456") else TypedDigits.arabicIndic("123456"))

        // The fake server compares the code it was sent with "123456", so it confirms only ASCII.
        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "confirmOtp" })
    }

    @Test
    fun `a phone number typed in Arabic-Indic digits is sent as ASCII (C196_3)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.sendOtp(OtpDestination.Phone("+1 " + TypedDigits.arabicIndic("555 555 0100")))

        assertEquals(listOf<OtpDestination>(phone), api.otpDestinations)
    }

    @Test
    fun `a code of the wrong length, or with something other than digits, is never sent`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)

        for (code in listOf("12345", "1234567", "12345a", "")) coordinator.confirmOtp(code)

        assertEquals(0, api.calls.count { it == "confirmOtp" })
        assertEquals(entry.copy(code = firstCode), coordinator.state.value)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource("otp_destination_invalid, DESTINATION_INVALID", "otp_destination_not_allowed, DESTINATION_NOT_ALLOWED")
    fun `a number the server refuses stays on the entry, saying why (C55_8)`(code: String, error: OtpError) = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.Rejected(422, Problem(status = 422, code = code), null))

        coordinator.sendOtp(phone)

        assertEquals(entry.copy(error = error), coordinator.state.value)
    }

    @Test
    fun `a failed delivery goes back to the entry, so the user can check the number (C64_1)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.failNext("sendOtp", FlowApiException.ServerError(502, Problem(status = 502, code = "otp_delivery_failed"), null))

        coordinator.resendOtp()

        assertEquals(entry.copy(error = OtpError.DELIVERY_FAILED), coordinator.state.value)
    }

    @Test
    fun `a new code goes to the same number, and the screen says it is a new one`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)

        coordinator.resendOtp()

        assertEquals(entry.copy(code = firstCode.copy(sendsRemaining = 3, resent = true)), coordinator.state.value)
        assertEquals(listOf<OtpDestination>(phone, phone), api.otpDestinations)
        assertEquals(1, api.calls.count { it == "createVerification:phone-number" })
    }

    @Test
    fun `a resend that is too soon keeps the code and says when the next send is allowed (C52_7)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        val later = "2026-10-20T12:02:00.000Z"
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_resend_too_soon", resendAvailableAt = later), null, 60))

        coordinator.resendOtp()

        assertEquals(
            entry.copy(code = firstCode.copy(resendAvailableAt = Instant.parse(later)), error = OtpError.RESEND_TOO_SOON),
            coordinator.state.value,
        )
    }

    @Test
    fun `changing the number goes back to the entry and sends to the new one on the same verification`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)

        coordinator.changeOtpDestination()
        val afterChange = coordinator.state.value
        val other = OtpDestination.Phone("+1 555 555 0199")
        coordinator.sendOtp(other)

        assertEquals(entry, afterChange)
        assertEquals(listOf<OtpDestination>(phone, other), api.otpDestinations)
        assertEquals(1, api.calls.count { it == "createVerification:phone-number" })
    }

    @Test
    fun `an email step sends to the email address with the step's code length, and ignores a phone number`() = runTest {
        val api = api(emailStep)
        val coordinator = coordinator(api)
        coordinator.start()
        val emailEntry = FlowState.Otp(emailStep, OtpChannel.EMAIL, emptyList(), codeLength = 8)
        val opened = coordinator.state.value

        coordinator.sendOtp(phone)
        coordinator.sendOtp(email)

        assertEquals(emailEntry, opened)
        assertEquals(emailEntry.copy(code = firstCode), coordinator.state.value)
        assertEquals(listOf("getSession", "createVerification:email-address", "sendOtp"), api.calls)
        assertEquals(listOf<OtpDestination>(email), api.otpDestinations)
    }

    // Limits: continue to review (C55.6, V11) -------------------------------------------------

    @Test
    fun `a limit refusal lets the user continue, and continuing submits the verification for review`() = runTest {
        val api = api()
        api.decide(VerificationStatus.NEEDS_REVIEW, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 3600))

        coordinator.sendOtp(phone)
        val limited = coordinator.state.value
        api.otpLimited += api.created()
        coordinator.continueAfterLimit()

        assertEquals(entry.copy(limited = true), limited)
        assertEquals(FlowState.Completed(completion, InquiryStatus.PENDING), coordinator.state.value)
        assertEquals(listOf("submit", "getVerification", "getSession"), api.calls.takeLast(3))
    }

    @Test
    fun `the limit store being down is a limit refusal too (C55_7)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.failNext("confirmOtp", FlowApiException.ServerError(503, Problem(status = 503, code = "otp_rate_limited"), null))

        coordinator.confirmOtp("123456")

        assertEquals(entry.copy(code = firstCode, limited = true), coordinator.state.value)
    }

    @Test
    fun `while limited, nothing but continuing is sent`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 3600))
        coordinator.resendOtp()
        val calls = api.calls.size

        coordinator.resendOtp()
        coordinator.confirmOtp("123456")
        coordinator.sendOtp(phone)
        coordinator.changeOtpDestination()

        assertEquals(calls, api.calls.size)
        assertEquals(entry.copy(code = firstCode, limited = true), coordinator.state.value)
    }

    @Test
    fun `continuing after a refusal the server did not record stays on the screen, saying it could not continue`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 60))
        coordinator.sendOtp(phone)

        coordinator.continueAfterLimit()

        assertEquals(entry.copy(limited = true, error = OtpError.CONTINUE_REFUSED), coordinator.state.value)
        assertEquals(VerificationStatus.INITIATED, api.verifications.single().attributes.status)
    }

    // The verification moved on: wait for it, then start again (C55.5, C55.6) ----------------

    @Test
    fun `too many wrong codes submitted the verification, so the flow waits for its decision, then offers to start again`() = runTest {
        val api = api()
        val exhausted = RetryHint("phone_number_otp_comparison", listOf("otp_attempts_exhausted"))
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, exhausted)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.submitOnNext("confirmOtp", "otp_attempts_exhausted")

        coordinator.confirmOtp("000000")
        val restarted = coordinator.state.value
        coordinator.sendOtp(phone)

        assertEquals(entry.copy(retryHints = listOf(exhausted)), restarted)
        assertEquals(2, api.calls.count { it == "createVerification:phone-number" })
        assertEquals(entry.copy(code = firstCode, retryHints = listOf(exhausted)), coordinator.state.value)
    }

    @Test
    fun `a send after the last one submitted the verification, so the flow waits for its decision, then offers to start again`() = runTest {
        val api = api()
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, notConfirmed)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.submitOnNext("sendOtp", "otp_not_confirmed")

        coordinator.resendOtp()

        assertEquals(entry.copy(retryHints = listOf(notConfirmed)), coordinator.state.value)
    }

    @Test
    fun `a code already confirmed elsewhere moves on, and the verification is submitted at once`() = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.sendOtp(phone)
        api.confirmOtp(api.created(), "123456")

        coordinator.confirmOtp("123456")

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf("confirmOtp", "getSession", "submit", "getVerification", "getSession"), api.calls.takeLast(5))
    }

    @Test
    fun `a failed attempt with attempts left starts again with its hints and a new verification (C64_1)`() = runTest {
        val api = api(verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, VerificationStatus.FAILED, notConfirmed)))
        val coordinator = coordinator(api)

        coordinator.start()
        coordinator.sendOtp(phone)

        assertEquals(entry.copy(code = firstCode, retryHints = listOf(notConfirmed)), coordinator.state.value)
        assertEquals(listOf("getSession", "createVerification:phone-number", "sendOtp"), api.calls)
    }

    @Test
    fun `when the last attempt failed, the flow ends where the server's position ends it`() = runTest {
        val lastTry = phoneStep.copy(maxAttempts = 1)
        val api = api(lastTry, verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, VerificationStatus.FAILED, notConfirmed)))
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        assertTrue(states.none { it is FlowState.Otp }, states.toString())
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    // Resuming (C64.1) --------------------------------------------------------------------

    @Test
    fun `resuming an initiated verification with an open code opens the code entry, and the code goes to that verification`() = runTest {
        val api = api()
        val resumed = withOpenCode(api)
        api.verifications += resumed
        api.openCodes[resumed.id] = FakeFlowApi.OpenCode(phone, "123456")
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()
        val opened = coordinator.state.value
        coordinator.confirmOtp("123456")

        assertEquals(entry.copy(code = firstCode.copy(sendsRemaining = 3, attemptsRemaining = 2)), opened)
        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf("getSession", "confirmOtp", "submit", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `a resend after resuming asks for the number again, as only the user knows it`() = runTest {
        val api = api()
        api.verifications += withOpenCode(api)
        val coordinator = coordinator(api)
        coordinator.start()
        val resumed = coordinator.state.value

        coordinator.resendOtp()

        assertEquals(entry.copy(code = firstCode.copy(sendsRemaining = 3, attemptsRemaining = 2)), resumed)
        assertEquals(entry, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `resuming a confirmed verification submits it at once`() = runTest {
        val api = api()
        api.verifications += withOpenCode(api, VerificationStatus.CONFIRMED)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf("getSession", "submit", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `resuming a submitted verification waits for its decision without submitting again`() = runTest {
        val api = api()
        api.verifications += withOpenCode(api, VerificationStatus.SUBMITTED)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf("getSession", "getVerification", "getSession"), api.calls)
    }

    @Test
    fun `the server's guidance gives the countries and code length when it has some`() = runTest {
        val api = api()
        val guided = verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, VerificationStatus.INITIATED)
        api.verifications += guided.copy(
            attributes = guided.attributes.copy(
                guidance = buildJsonObject {
                    putJsonArray("allowed-countries") { add("CA") }
                    put("code-length", 8)
                    put("otp", JsonNull)
                },
            ),
        )
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(entry.copy(allowedCountries = listOf("CA"), codeLength = 8), coordinator.state.value)
    }

    // Errors ----------------------------------------------------------------------------------

    @Test
    fun `a lost send answer is retried by re-reading the session, never by sending twice`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.Network(SocketTimeoutException("timeout")))

        coordinator.sendOtp(phone)
        val failed = coordinator.state.value
        coordinator.retry()

        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), failed)
        assertEquals(entry, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "sendOtp" })
        assertEquals("getSession", api.calls.last())
    }

    @Test
    fun `an unexpected refusal of a send shows the error screen`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.Rejected(422, Problem(status = 422, code = "otp_channel_not_configured"), null))

        coordinator.sendOtp(phone)

        assertEquals(FlowState.Error(FlowError.REJECTED, canRetry = false), coordinator.state.value)
    }

    // Paths the tests above leave out (pinned after the code) -----------------------------------

    @Test
    fun `a verification status this SDK does not know stops the step instead of guessing`() = runTest {
        val api = api(verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, VerificationStatus.UNKNOWN)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported("verification status unknown"), coordinator.state.value)
    }

    @Test
    fun `continuing after a limit refusal the server has meanwhile submitted continues from where it stands`() = runTest {
        val api = api()
        api.decide(VerificationStatus.NEEDS_REVIEW, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 60))
        coordinator.sendOtp(phone)
        api.otpLimited += api.created()
        api.submitVerification(api.created(), null)
        api.failNext("submit", conflict("otp_not_confirmed"))

        coordinator.continueAfterLimit()

        assertEquals(FlowState.Completed(completion, InquiryStatus.PENDING), coordinator.state.value)
    }

    @Test
    fun `a failure while continuing after a limit refusal shows the error screen, whose retry re-reads the session`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 60))
        coordinator.sendOtp(phone)
        api.failNext("submit", FlowApiException.Network(SocketTimeoutException("timeout")))

        coordinator.continueAfterLimit()
        val failed = coordinator.state.value
        coordinator.retry()

        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), failed)
        assertEquals(entry, coordinator.state.value)
    }

    @Test
    fun `a server value the client refuses to send ends the step with an invalid response`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("sendOtp", IllegalArgumentException("Not a verification ID"))

        coordinator.sendOtp(phone)

        assertEquals(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false), coordinator.state.value)
    }

    @Test
    fun `a number over the 32 characters the server takes is never sent, and the entry says so, keeping the step (Workflow 5C review P028)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        // A pasted number with a note after it: "+1 " and 33 characters typed.
        coordinator.sendOtp(OtpDestination.Phone("+1 (555) 555-0100 (mobile, evenings)"))
        val refused = coordinator.state.value
        val callsAfterRefusal = api.calls.toList()
        // At the bound, 32 characters, the number goes out.
        coordinator.sendOtp(OtpDestination.Phone("+1 555 555 0100 ext 12345678 999"))

        assertEquals(entry.copy(error = OtpError.DESTINATION_TOO_LONG), refused)
        assertEquals(listOf("getSession"), callsAfterRefusal)
        assertEquals(entry.copy(code = firstCode), coordinator.state.value)
    }

    @Test
    fun `an email address over the 254 characters the server takes is never sent, and the entry says so (Workflow 5C review P028)`() = runTest {
        val api = api(emailStep)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.sendOtp(OtpDestination.Email("${"j".repeat(64)}@${"e".repeat(185)}.test"))

        assertEquals(
            FlowState.Otp(emailStep, OtpChannel.EMAIL, emptyList(), codeLength = 8, error = OtpError.DESTINATION_TOO_LONG),
            coordinator.state.value,
        )
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a send the server answers without guidance still opens a code entry, describing nothing it was not told`() = runTest {
        val api = api(emailStep)
        api.describesCodes = false
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.sendOtp(email)

        assertEquals(FlowState.Otp(emailStep, OtpChannel.EMAIL, emptyList(), codeLength = 8, code = UNDESCRIBED_CODE), coordinator.state.value)
    }

    @Test
    fun `an open code whose times cannot be read leaves them out`() {
        val unreadable = verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.EMAIL_ADDRESS, VerificationStatus.INITIATED).let {
            it.copy(
                attributes = it.attributes.copy(
                    guidance = buildJsonObject {
                        put("code-length", 6)
                        put(
                            "otp",
                            buildJsonObject {
                                put("masked-destination", "j•••@example.test")
                                put("expires-at", "soon")
                                put("resend-available-at", "2026-13-40T99:00:00Z")
                                put("sends-remaining", 2)
                                put("attempts-remaining", 3)
                            },
                        )
                    },
                ),
            )
        }

        assertEquals(OtpCode("j•••@example.test", null, null, 2, 3), otpState(emailStep, unreadable, emptyList()).code)
    }
}
