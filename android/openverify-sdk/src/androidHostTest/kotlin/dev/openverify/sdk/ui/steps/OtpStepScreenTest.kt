package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpCode
import dev.openverify.sdk.flow.OtpError
import dev.openverify.sdk.flow.UNDESCRIBED_CODE
import dev.openverify.sdk.flow.logic.TypedDigits
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/**
 * C55, C64.1, C64.2: the phone and email screen. The number goes out with its country's calling
 * code; the code entry names the masked destination, takes only the code's digits, counts down to
 * the next send and the expiry, and always leaves the user a next step.
 */
@RunWith(RobolectricTestRunner::class)
class OtpStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val drafts = InputDrafts()
    private val now = Instant.parse("2026-10-20T12:00:30Z")
    private val clock = object : Clock {
        override fun now(): Instant = now
    }

    private val phoneStep = PhoneOtpStep("phone", listOf("US", "GB"))
    private val emailStep = EmailOtpStep("email")
    private val entry = FlowState.Otp(phoneStep, OtpChannel.PHONE, listOf("US", "GB"), codeLength = 6)
    private val emailEntry = FlowState.Otp(emailStep, OtpChannel.EMAIL, emptyList(), codeLength = 6)
    private val code = OtpCode("•••• ••00", now + 10.minutes, now + 30.seconds, sendsRemaining = 4, attemptsRemaining = 5)

    /** [res] as a screen shows it: each value isolated (C199.5, K10A-2). */
    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args.map { isolated(it.toString()) }.toTypedArray()) }

    private fun plural(res: PluralStringResource, n: Int) = runBlocking { getPluralString(res, n, isolated(n.toString())) }

    private fun show(state: FlowState.Otp) {
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }
    }

    // The destination -------------------------------------------------------------------------

    @Test
    fun `the phone entry offers the step's countries with their calling codes and sends the number in international form`() {
        show(entry)

        rule.onNodeWithText(text(Res.string.openverify_otp_phone_title)).assertExists()
        rule.onNodeWithTag(TestTags.OTP_COUNTRY).assertTextContains("United States (+1)")
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("555 555 0100")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        assertEquals(listOf<Any?>(OtpDestination.Phone("+1 555 555 0100")), actions.sent)
    }

    @Test
    fun `choosing another country sends the number with that country's calling code`() {
        show(entry)

        rule.onNodeWithTag(TestTags.OTP_COUNTRY).performClick()
        rule.onNodeWithTag(TestTags.option("GB")).performClick()
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("07700 900123")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        rule.onNodeWithTag(TestTags.OTP_COUNTRY).assertTextContains("United Kingdom (+44)")
        assertEquals(listOf<Any?>(OtpDestination.Phone("+44 07700 900123")), actions.sent)
    }

    @Test
    fun `send stays off until a number is typed`() {
        show(entry)

        rule.onNodeWithText(text(Res.string.openverify_otp_send)).assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("5")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).assertIsEnabled()
    }

    @Test
    fun `while a code is on its way the screen says so and nothing can be sent`() {
        drafts["phone:destination"] = "555 555 0100"
        show(entry.copy(busy = true))

        rule.onNodeWithText(text(Res.string.openverify_otp_sending)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).assertIsNotEnabled()
    }

    @Test
    fun `the email entry asks for a well-formed address first, then sends it trimmed`() {
        show(emailEntry)

        rule.onNodeWithText(text(Res.string.openverify_otp_email_title)).assertExists()
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("jane")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_otp_email_invalid)).assertExists()
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextClearance()
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput(" jane@example.test ")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        assertEquals(listOf<Any?>(OtpDestination.Email("jane@example.test")), actions.sent)
    }

    @Test
    fun `each refusal of a destination is said on the entry, in the words of its channel`() {
        var state by mutableStateOf(entry)
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }
        val said = listOf(
            entry.copy(error = OtpError.DESTINATION_INVALID) to Res.string.openverify_otp_error_destination_invalid_phone,
            entry.copy(error = OtpError.DESTINATION_NOT_ALLOWED) to Res.string.openverify_otp_error_not_allowed_phone,
            entry.copy(error = OtpError.DELIVERY_FAILED) to Res.string.openverify_otp_error_delivery_failed_phone,
            entry.copy(error = OtpError.RESEND_TOO_SOON) to Res.string.openverify_otp_error_too_soon,
            entry.copy(error = OtpError.CODE_NOT_SENT) to Res.string.openverify_otp_error_not_sent,
            emailEntry.copy(error = OtpError.DESTINATION_INVALID) to Res.string.openverify_otp_error_destination_invalid_email,
            emailEntry.copy(error = OtpError.DESTINATION_NOT_ALLOWED) to Res.string.openverify_otp_error_not_allowed_email,
            emailEntry.copy(error = OtpError.DELIVERY_FAILED) to Res.string.openverify_otp_error_delivery_failed_email,
        )

        for ((shown, message) in said) {
            state = shown
            rule.onNodeWithText(text(message)).assertExists()
        }
    }

    @Test
    fun `a destination over its limit is said on the entry, in the words of its channel (Workflow 5C review P028)`() {
        var state by mutableStateOf(entry.copy(error = OtpError.DESTINATION_TOO_LONG))
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_otp_error_too_long_phone)).assertExists()
        state = emailEntry.copy(error = OtpError.DESTINATION_TOO_LONG)
        rule.onNodeWithText(text(Res.string.openverify_otp_error_too_long_email)).assertExists()
    }

    @Test
    fun `the number the user typed stays when the screen's state changes`() {
        var state by mutableStateOf(entry)
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("555 555 0100")
        state = entry.copy(error = OtpError.DESTINATION_INVALID)

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assertTextContains("555 555 0100")
    }

    @Test
    fun `the previous attempt's hints show on the entry, so the user knows why to start again`() {
        show(entry.copy(retryHints = listOf(RetryHint("phone_number_otp_comparison", listOf("otp_not_confirmed")))))

        rule.onNodeWithText(text(Res.string.openverify_retry_title_attempt)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_retry_otp_not_confirmed)).assertExists()
    }

    // The code --------------------------------------------------------------------------------

    @Test
    fun `the code entry names the masked destination and confirms only a full code of digits`() {
        show(entry.copy(code = code))

        rule.onNodeWithText(text(Res.string.openverify_otp_sent_to, "•••• ••00")).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_code_hint, 6)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_confirm)).assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.OTP_CODE).performTextInput("12a3456789")
        rule.onNodeWithTag(TestTags.OTP_CODE).assertTextContains("123456")
        rule.onNodeWithText(text(Res.string.openverify_otp_confirm)).performScrollTo().assertIsEnabled().performClick()

        assertEquals(listOf<Any?>("123456"), actions.sent)
    }

    @Test
    fun `a code typed on an Arabic or Persian keyboard is kept as ASCII digits and can be confirmed (C196_3)`() {
        show(entry.copy(code = code))

        rule.onNodeWithTag(TestTags.OTP_CODE).performTextInput(TypedDigits.arabicIndic("123") + TypedDigits.persian("456"))
        rule.onNodeWithTag(TestTags.OTP_CODE).assertTextContains("123456")
        rule.onNodeWithText(text(Res.string.openverify_otp_confirm)).performScrollTo().assertIsEnabled().performClick()

        assertEquals(listOf<Any?>("123456"), actions.sent)
    }

    @Test
    fun `a phone number typed in Arabic-Indic digits shows and goes out as ASCII (C196_3)`() {
        show(entry)

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput(TypedDigits.arabicIndic("555 555 0100"))
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assertTextContains("555 555 0100")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        assertEquals(listOf<Any?>(OtpDestination.Phone("+1 555 555 0100")), actions.sent)
    }

    @Test
    fun `the code entry says how many tries are left and why the last code was refused`() {
        show(entry.copy(code = code.copy(attemptsRemaining = 1), error = OtpError.CODE_INCORRECT))

        rule.onNodeWithText(plural(Res.plurals.openverify_otp_attempts_left, 1)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_error_incorrect)).assertExists()
    }

    @Test
    fun `an exhausted code says a new one is needed`() {
        show(entry.copy(code = code.copy(attemptsRemaining = 0), error = OtpError.CODE_EXHAUSTED))

        rule.onNodeWithText(text(Res.string.openverify_otp_error_exhausted)).assertExists()
    }

    @Test
    fun `a new code says it is new, and a code the server did not describe says only that it was sent`() {
        var state by mutableStateOf(entry.copy(code = code.copy(resent = true)))
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_otp_sent_again, "•••• ••00")).assertExists()
        state = entry.copy(code = UNDESCRIBED_CODE)
        rule.onNodeWithText(text(Res.string.openverify_otp_sent)).assertExists()
    }

    @Test
    fun `while the next send waits, the screen counts down to it and offers no send`() {
        show(entry.copy(code = code))

        rule.onNodeWithText(plural(Res.plurals.openverify_otp_resend_in, 30)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_resend)).assertDoesNotExist()
        rule.onNodeWithText(plural(Res.plurals.openverify_otp_sends_left, 4)).assertExists()
    }

    @Test
    fun `once a new code may be sent, the button sends one`() {
        show(entry.copy(code = code.copy(resendAvailableAt = now - 1.seconds)))

        rule.onNodeWithText(text(Res.string.openverify_otp_resend)).performScrollTo().performClick()

        assertEquals(listOf("resendOtp"), actions.calls)
    }

    @Test
    fun `asking for a new code, or sending to another destination, clears the digits typed for the old one`() {
        var state by mutableStateOf(entry.copy(code = code.copy(resendAvailableAt = now - 1.seconds)))
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_CODE).performTextInput("111111")
        rule.onNodeWithText(text(Res.string.openverify_otp_resend)).performScrollTo().performClick()
        val afterResend = drafts["phone:code"]
        drafts["phone:code"] = "222222"
        state = entry
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("555 555 0199")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        assertEquals("", afterResend)
        assertEquals("", drafts["phone:code"])
    }

    @Test
    fun `the code's expiry is counted in minutes, and an expired code says to ask for a new one`() {
        var state by mutableStateOf(entry.copy(code = code.copy(expiresAt = now + 9.minutes + 1.seconds)))
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(plural(Res.plurals.openverify_otp_expires_in, 10)).assertExists()
        state = entry.copy(code = code.copy(expiresAt = now - 1.seconds))
        rule.onNodeWithText(text(Res.string.openverify_otp_code_expired)).assertExists()
    }

    @Test
    fun `with no send left and no usable code, the user can still continue, which ends the attempt (C55_6)`() {
        show(entry.copy(code = code.copy(sendsRemaining = 0, attemptsRemaining = 0, resendAvailableAt = null)))

        rule.onNodeWithText(text(Res.string.openverify_otp_no_sends_left)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_finish)).performScrollTo().performClick()

        assertEquals(listOf("resendOtp"), actions.calls)
    }

    @Test
    fun `with no send left but a usable code, the user enters it rather than giving up`() {
        show(entry.copy(code = code.copy(sendsRemaining = 0, resendAvailableAt = null)))

        rule.onNodeWithText(text(Res.string.openverify_otp_no_sends_left)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_finish)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_otp_resend)).assertDoesNotExist()
    }

    @Test
    fun `changing the number or address goes back to its entry`() {
        var state by mutableStateOf(entry.copy(code = code))
        rule.setContent { OtpStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_otp_change_phone)).performScrollTo().performClick()
        state = emailEntry.copy(code = code)
        rule.onNodeWithText(text(Res.string.openverify_otp_change_email)).performScrollTo().performClick()

        assertEquals(listOf("changeOtpDestination", "changeOtpDestination"), actions.calls)
    }

    @Test
    fun `while a code is checked the screen says so and nothing can be pressed`() {
        drafts["phone:code"] = "123456"
        show(entry.copy(code = code, busy = true))

        rule.onNodeWithText(text(Res.string.openverify_otp_checking)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_confirm)).assertIsNotEnabled()
    }

    // Limits ----------------------------------------------------------------------------------

    @Test
    fun `a limit refusal offers only to continue, which sends the verification to review (C55_6)`() {
        show(entry.copy(code = code, limited = true))

        rule.onNodeWithText(text(Res.string.openverify_otp_limited_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_limited_message)).assertExists()
        rule.onNodeWithTag(TestTags.OTP_CODE).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_otp_limited_continue)).performScrollTo().performClick()

        assertEquals(listOf("continueAfterLimit"), actions.calls)
    }

    @Test
    fun `a continue the server did not take says so, and continuing can be tried again`() {
        show(entry.copy(limited = true, error = OtpError.CONTINUE_REFUSED))

        rule.onNodeWithText(text(Res.string.openverify_otp_limited_refused)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_limited_continue)).assertIsEnabled()
    }

    @Test
    fun `while continuing the screen says so`() {
        show(entry.copy(limited = true, busy = true))

        rule.onNodeWithText(text(Res.string.openverify_otp_limited_continuing)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_otp_limited_continue)).assertIsNotEnabled()
    }
}
