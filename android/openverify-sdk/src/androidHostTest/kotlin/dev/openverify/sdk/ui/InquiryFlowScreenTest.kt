package dev.openverify.sdk.ui

import android.Manifest
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.PhoneOtpStep
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.InquiryStatus
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class InquiryFlowScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val camera = FakeCaptureCamera()
    private val capture = FlowState.Capture(FakeFlowApi.DEFAULT_FLOW.steps[1], FileKind.FRONT, 0, 2)
    private val awaitingCamera = FlowState.AwaitingCamera(FakeFlowApi.DEFAULT_FLOW.steps[2])

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun show(state: FlowState) {
        rule.setContent { InquiryFlowScreen(state, camera, actions) }
    }

    @Test
    fun `loading shows the loading screen`() {
        show(FlowState.Loading)

        rule.onNodeWithText(text(Res.string.openverify_loading)).assertExists()
    }

    @Test
    fun `consent accepts and cancels through the actions`() {
        show(FlowState.Consent(ConsentStep("consent", listOf("consent.biometric"), true)))

        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_cancel)).performScrollTo().performClick()

        assertEquals(listOf("acceptConsent", "cancel"), actions.calls)
    }

    @Test
    fun `capture waits for the camera permission`() {
        show(capture)

        rule.onNodeWithText(text(Res.string.openverify_camera_rationale)).assertExists()
        rule.onNodeWithTag(TestTags.PREVIEW).assertDoesNotExist()
    }

    @Test
    fun `with the camera permission, photos go through the actions`() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
            .grantPermissions(Manifest.permission.CAMERA)
        show(capture)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()
        rule.waitForIdle()

        assertEquals(listOf("capture"), actions.calls)
        assertEquals(1, actions.captured.size)
    }

    @Test
    fun `the selfie step waits behind the camera permission and reports nothing before it is granted (4B H014)`() {
        show(awaitingCamera)

        rule.onNodeWithText(text(Res.string.openverify_camera_rationale)).assertExists()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), actions.calls)
    }

    @Test
    fun `with the camera permission, the waiting selfie step reports the camera ready, once (4B H014)`() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
            .grantPermissions(Manifest.permission.CAMERA)
        show(awaitingCamera)

        rule.onNodeWithText(text(Res.string.openverify_loading)).assertExists()
        rule.waitForIdle()
        assertEquals(listOf("cameraReady"), actions.calls)
    }

    @Test
    fun `a photo under review is retaken or kept through the actions`() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
            .grantPermissions(Manifest.permission.CAMERA)
        show(capture.copy(image = testJpeg()))

        rule.onNodeWithText(text(Res.string.openverify_capture_retake)).performClick()
        rule.onNodeWithText(text(Res.string.openverify_capture_use)).performClick()

        assertEquals(listOf("retake", "confirmCapture"), actions.calls)
    }

    @Test
    fun `processing shows the processing screen`() {
        show(FlowState.Processing(capture.step))

        rule.onNodeWithText(text(Res.string.openverify_processing_title)).assertExists()
    }

    @Test
    fun `a step without photos is checked in its own words, never as photos (C64_2)`() {
        var state: FlowState by mutableStateOf(FlowState.Processing(PhoneOtpStep("phone", listOf("US"))))
        rule.setContent { InquiryFlowScreen(state, camera, actions) }

        rule.onNodeWithText(text(Res.string.openverify_processing_verification_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_processing_title)).assertDoesNotExist()
        state = FlowState.Processing(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE)))
        rule.onNodeWithText(text(Res.string.openverify_processing_verification_title)).assertExists()
        state = FlowState.Processing(capture.step)
        rule.onNodeWithText(text(Res.string.openverify_processing_title)).assertExists()
    }

    @Test
    fun `terminal screens finish the flow`() {
        var state: FlowState by mutableStateOf(FlowState.Completed(CompletionStep("done"), InquiryStatus.COMPLETED))
        rule.setContent { InquiryFlowScreen(state, camera, actions) }

        rule.onNodeWithText(text(Res.string.openverify_done)).performClick()
        state = FlowState.Failed(FailureStep("failure"), InquiryStatus.FAILED)
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        state = FlowState.Unsupported("step form")
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        state = FlowState.Expired
        rule.onNodeWithText(text(Res.string.openverify_expired_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()

        assertEquals(listOf("finish", "finish", "finish", "finish"), actions.calls)
    }

    @Test
    fun `errors retry or finish through the actions`() {
        show(FlowState.Error(FlowError.SERVER, canRetry = true))

        rule.onNodeWithText(text(Res.string.openverify_try_again)).performClick()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()

        assertEquals(listOf("retry", "finish"), actions.calls)
    }

    @Test
    fun `a sandbox session shows its banner above every screen`() {
        var state: FlowState by mutableStateOf(FlowState.Loading)
        rule.setContent { InquiryFlowScreen(state, camera, actions, sandbox = true) }

        rule.onNodeWithTag(TestTags.SANDBOX_BANNER).assertExists()
        state = FlowState.SessionEnded(SessionEndReason.EXPIRED)
        rule.onNodeWithText(text(Res.string.openverify_session_expired_title)).assertExists()
        rule.onNodeWithTag(TestTags.SANDBOX_BANNER).assertExists()
    }

    @Test
    fun `outside the sandbox there is no banner`() {
        show(FlowState.Loading)

        rule.onNodeWithTag(TestTags.SANDBOX_BANNER).assertDoesNotExist()
    }

    @Test
    fun `the screens that end a session finish the flow`() {
        var state: FlowState by mutableStateOf(FlowState.SessionEnded(SessionEndReason.CANCELED))
        rule.setContent { InquiryFlowScreen(state, camera, actions) }

        rule.onNodeWithText(text(Res.string.openverify_session_canceled_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        state = FlowState.Redacted
        rule.onNodeWithText(text(Res.string.openverify_redacted_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        state = FlowState.LinkRefused
        rule.onNodeWithText(text(Res.string.openverify_link_refused_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()

        assertEquals(listOf("finish", "finish", "finish"), actions.calls)
    }

    @Test
    fun `a photo picked in the sandbox goes through the actions`() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
            .grantPermissions(Manifest.permission.CAMERA)
        val picker = FakePhotoPicker()
        rule.setContent {
            InquiryFlowScreen(capture.copy(uploadAllowed = true), camera, actions, sandbox = true, photoPicker = picker)
        }

        rule.onNodeWithText(text(Res.string.openverify_capture_upload)).performClick()
        rule.waitForIdle()

        assertEquals(listOf("pick"), actions.calls)
    }

    @Test
    fun `each Phase 5 step the SDK runs gets its own screen (C64_2)`() {
        val drafts = InputDrafts()
        var state: FlowState by mutableStateOf(
            FlowState.Otp(PhoneOtpStep("phone", listOf("US")), OtpChannel.PHONE, listOf("US"), codeLength = 6),
        )
        rule.setContent { InquiryFlowScreen(state, camera, actions, drafts = drafts) }

        rule.onNodeWithText(text(Res.string.openverify_otp_phone_title)).assertExists()
        state = FlowState.Otp(EmailOtpStep("email"), OtpChannel.EMAIL, emptyList(), codeLength = 6)
        rule.onNodeWithText(text(Res.string.openverify_otp_email_title)).assertExists()
        state = FlowState.Form(DatabaseStep("db", listOf(DatabaseField.NAME_FIRST)), listOf(InputField.NAME_FIRST), setOf(InputField.NAME_FIRST))
        rule.onNodeWithText(text(Res.string.openverify_database_title)).assertExists()
        state = FlowState.Form(AamvaStep("aamva", AamvaSource.FORM), listOf(InputField.NAME_FIRST), setOf(InputField.NAME_FIRST))
        rule.onNodeWithText(text(Res.string.openverify_aamva_title)).assertExists()
        state = FlowState.CryptoWallet(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE)), listOf("eip155:1"))
        rule.onNodeWithText(text(Res.string.openverify_crypto_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertDoesNotExist()
    }

    @Test
    fun `a Phase 5 screen's actions reach the flow, and its typing lands in the drafts the view model keeps`() {
        val drafts = InputDrafts()
        rule.setContent {
            InquiryFlowScreen(FlowState.Otp(EmailOtpStep("email"), OtpChannel.EMAIL, emptyList(), codeLength = 6), camera, actions, drafts = drafts)
        }

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).performTextInput("jane@example.test")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performScrollTo().performClick()

        assertEquals(listOf("sendOtp"), actions.calls)
        assertEquals("jane@example.test", drafts["email:destination"])
    }

    @Test
    fun `the optional consent keys the user ticked go through the actions (C42_3)`() {
        val step = ConsentStep("consent", listOf("consent.biometric"), true, optionalTextKeys = listOf("consent.biometric-matching"))
        show(FlowState.Consent(step, retentionDays = 365))

        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithTag(TestTags.optionalConsent("consent.biometric-matching")).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().performClick()

        assertEquals(listOf(setOf("consent.biometric-matching")), actions.optionalConsents)
    }
}
