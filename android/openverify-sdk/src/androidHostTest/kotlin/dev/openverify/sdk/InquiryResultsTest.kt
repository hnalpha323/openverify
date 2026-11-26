package dev.openverify.sdk

import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.InquiryStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

internal class InquiryResultsTest {

    @Test
    fun `completion reports the inquiry status`() {
        assertEquals(
            InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED),
            InquiryResults.forFinish(FlowState.Completed(CompletionStep("done"), InquiryStatus.COMPLETED), INQUIRY_ID),
        )
        assertEquals(
            InquiryResult.Completed(INQUIRY_ID, InquiryStatus.PENDING),
            InquiryResults.forFinish(FlowState.Completed(null, InquiryStatus.PENDING), INQUIRY_ID),
        )
    }

    @Test
    fun `an inquiry in review completes the flow, with its status for the host app (C30_6)`() {
        assertEquals(
            InquiryResult.Completed(INQUIRY_ID, InquiryStatus.NEEDS_REVIEW),
            InquiryResults.forFinish(FlowState.Completed(CompletionStep("done"), InquiryStatus.NEEDS_REVIEW), INQUIRY_ID),
        )
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("failures")
    fun `endings other than completion are failures with a reason`(state: FlowState, reason: FailureReason) {
        assertEquals(InquiryResult.Failed(INQUIRY_ID, reason), InquiryResults.forFinish(state, INQUIRY_ID))
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("unfinished")
    fun `finishing before the flow ends is a cancellation`(state: FlowState) {
        assertEquals(InquiryResult.Canceled(INQUIRY_ID), InquiryResults.forFinish(state, INQUIRY_ID))
    }

    companion object {
        const val INQUIRY_ID = FakeFlowApi.INQUIRY_ID

        @JvmStatic
        fun failures(): List<Arguments> = listOf(
            Arguments.of(FlowState.Failed(FailureStep("failure"), InquiryStatus.FAILED), FailureReason.INQUIRY_FAILED),
            Arguments.of(FlowState.Failed(null, InquiryStatus.FAILED), FailureReason.INQUIRY_FAILED),
            Arguments.of(FlowState.Expired, FailureReason.INQUIRY_EXPIRED),
            Arguments.of(FlowState.Unsupported("step form"), FailureReason.UNSUPPORTED_FLOW),
            Arguments.of(FlowState.Error(FlowError.SESSION_EXPIRED, false), FailureReason.SESSION_EXPIRED),
            Arguments.of(FlowState.Error(FlowError.INQUIRY_MISMATCH, false), FailureReason.INVALID_REQUEST),
            Arguments.of(FlowState.Error(FlowError.NETWORK, true), FailureReason.NETWORK_ERROR),
            Arguments.of(FlowState.Error(FlowError.SERVER, true), FailureReason.SERVER_ERROR),
            Arguments.of(FlowState.Error(FlowError.REJECTED, false), FailureReason.SERVER_ERROR),
            Arguments.of(FlowState.Error(FlowError.INVALID_RESPONSE, true), FailureReason.SERVER_ERROR),
            Arguments.of(FlowState.Error(FlowError.OUT_OF_SYNC, true), FailureReason.SERVER_ERROR),
            Arguments.of(FlowState.Error(FlowError.STILL_PROCESSING, true), FailureReason.STILL_PROCESSING),
            Arguments.of(FlowState.SessionEnded(SessionEndReason.EXPIRED), FailureReason.SESSION_EXPIRED),
            Arguments.of(FlowState.SessionEnded(SessionEndReason.CANCELED), FailureReason.SESSION_CANCELED),
            Arguments.of(FlowState.Redacted, FailureReason.INQUIRY_REDACTED),
            Arguments.of(FlowState.LinkRefused, FailureReason.LINK_INVALID),
            // Every attempt is used, so the inquiry cannot be resumed; its decision comes by webhook.
        )

        @JvmStatic
        fun unfinished(): List<FlowState> = listOf(
            FlowState.Loading,
            FlowState.Consent(ConsentStep("consent", listOf("consent.biometric"), true)),
            FlowState.AwaitingCamera(FakeFlowApi.DEFAULT_FLOW.steps[2]),
            FlowState.Capture(FakeFlowApi.DEFAULT_FLOW.steps[1], FileKind.FRONT, 0, 2),
            FlowState.Processing(FakeFlowApi.DEFAULT_FLOW.steps[1]),
            // C64.2: leaving a phone or email step before it ends cancels; the inquiry can be resumed.
            FlowState.Otp(PhoneOtpStep("phone", listOf("US")), OtpChannel.PHONE, listOf("US"), codeLength = 6),
            FlowState.Form(AamvaStep("aamva", AamvaSource.FORM), listOf(InputField.NAME_FIRST), setOf(InputField.NAME_FIRST)),
            FlowState.CryptoWallet(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE)), listOf("eip155:1")),
        )
    }
}
