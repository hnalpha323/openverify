package dev.openverify.sdk

import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.flow.ShareConsentState

/** How a flow that ends in each state ends for the host app, on every platform. */
internal object InquiryOutcomes {
    /** The result of ending the flow in [state]: terminal states report, others cancel. */
    fun forFinish(state: FlowState, inquiryId: String): InquiryResult = when (state) {
        is FlowState.Completed -> InquiryResult.Completed(inquiryId, state.inquiryStatus)
        is FlowState.Failed -> InquiryResult.Failed(inquiryId, FailureReason.INQUIRY_FAILED)
        FlowState.Expired -> InquiryResult.Failed(inquiryId, FailureReason.INQUIRY_EXPIRED)
        is FlowState.SessionEnded -> InquiryResult.Failed(
            inquiryId,
            when (state.reason) {
                SessionEndReason.EXPIRED -> FailureReason.SESSION_EXPIRED
                SessionEndReason.CANCELED -> FailureReason.SESSION_CANCELED
            },
        )
        FlowState.Redacted -> InquiryResult.Failed(inquiryId, FailureReason.INQUIRY_REDACTED)
        FlowState.LinkRefused -> InquiryResult.Failed(inquiryId, FailureReason.LINK_INVALID)
        is FlowState.Unsupported -> InquiryResult.Failed(inquiryId, FailureReason.UNSUPPORTED_FLOW)
        // C197.2: the server stopped the flow; an operator resumes or expires it.
        FlowState.Halted -> InquiryResult.Failed(inquiryId, FailureReason.FLOW_HALTED)
        is FlowState.Error -> InquiryResult.Failed(inquiryId, reasonFor(state.error))
        FlowState.Loading, is FlowState.Consent, is FlowState.AwaitingCamera, is FlowState.Capture, is FlowState.Processing,
        is FlowState.Otp, is FlowState.Form, is FlowState.CryptoWallet, is FlowState.Document,
        is FlowState.Waiting, is FlowState.Screen,
        // C207.5, C207.6: closing an NFC screen cancels; the inquiry stays resumable and nothing read is kept.
        is FlowState.Nfc,
        // C238.1 (Workflow 11A): closing the share-consent screen records no choice; the inquiry stays resumable.
        is ShareConsentState,
        -> InquiryResult.Canceled(inquiryId)
    }

    private fun reasonFor(error: FlowError): FailureReason = when (error) {
        FlowError.SESSION_EXPIRED -> FailureReason.SESSION_EXPIRED
        FlowError.INQUIRY_MISMATCH -> FailureReason.INVALID_REQUEST
        FlowError.NETWORK -> FailureReason.NETWORK_ERROR
        FlowError.STILL_PROCESSING -> FailureReason.STILL_PROCESSING
        FlowError.REJECTED, FlowError.OUT_OF_SYNC, FlowError.SERVER, FlowError.INVALID_RESPONSE ->
            FailureReason.SERVER_ERROR
    }
}
