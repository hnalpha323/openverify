package dev.openverify.sdk.ui

import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.RetryHint
import org.jetbrains.compose.resources.StringResource

/** Consent texts the SDK can show, by flow-spec text key. */
internal object ConsentTexts {
    val resources: Map<String, StringResource> = mapOf(
        "consent.biometric" to Res.string.openverify_consent_biometric,
        "consent.processing" to Res.string.openverify_consent_processing,
        // C42.3: the optional matching consent of the default template (C45.1).
        "consent.biometric-matching" to Res.string.openverify_consent_biometric_matching,
        // C94.6 (ADR 0006): the collection tiers' notices and the optional device-recognition consent.
        "notice.session-integrity" to Res.string.openverify_notice_session_integrity,
        "notice.device-recognition" to Res.string.openverify_notice_device_recognition,
        // C211.9, decision 66 (Workflow 10B): the notice that names Google, shown with session integrity.
        "notice.play-integrity" to Res.string.openverify_notice_play_integrity,
        "consent.device-recognition" to Res.string.openverify_consent_device_recognition,
        // C128.4: the optional consent an explicit-consent biometric decision checks.
        "consent.automated-decision" to Res.string.openverify_consent_automated_decision,
    )

    val keys: Set<String> get() = resources.keys

    /**
     * The label of each optional consent text's own checkbox (C42.3). An optional text is offered
     * only when it has both a text and a label here.
     */
    val optionalCheckboxes: Map<String, StringResource> = mapOf(
        "consent.biometric-matching" to Res.string.openverify_consent_biometric_matching_checkbox,
        "consent.device-recognition" to Res.string.openverify_consent_device_recognition_checkbox,
        "consent.automated-decision" to Res.string.openverify_consent_automated_decision_checkbox,
    )
}

/** The placeholder the matching consent text uses for the face template retention (C42.3). */
private const val DAYS_PLACEHOLDER = "{{days}}"

/**
 * [text] as the consent screen shows it: `{{days}}` filled from the session's
 * `face-template-retention-days`. `null` when the text names the days and the session gives none,
 * so the text is not offered rather than shown without its retention period.
 */
internal fun consentText(text: String, retentionDays: Int?): String? = when {
    DAYS_PLACEHOLDER !in text -> text
    retentionDays == null -> null
    else -> text.replace(DAYS_PLACEHOLDER, retentionDays.toString())
}

/**
 * Messages for the reason codes a retry hint can carry: those of the failed, required
 * `user_behavior` checks (`PHASE1_CHECK_REASONS`, the Phase 3 `GOVERNMENT_ID_CHECK_REASONS`, C29.4,
 * the Phase 4 `SELFIE_CHECK_REASONS`, C39.2, and the Phase 5 `PHASE5_RETRY_HINT_REASONS`, C51.2). `contracts/fixtures/flow/retry-hint-reasons.json` lists them, and `MessagesTest` reads it.
 */
private val retryReasons: Map<String, StringResource> = mapOf(
    "image_blurry" to Res.string.openverify_retry_image_blurry,
    "glare_present" to Res.string.openverify_retry_glare_present,
    "portrait_not_present" to Res.string.openverify_retry_portrait_not_present,
    "front_not_present" to Res.string.openverify_retry_front_not_present,
    "back_not_present" to Res.string.openverify_retry_back_not_present,
    "image_too_dark" to Res.string.openverify_retry_image_too_dark,
    "image_too_bright" to Res.string.openverify_retry_image_too_bright,
    "face_not_present" to Res.string.openverify_retry_face_not_present,
    "multiple_faces_present" to Res.string.openverify_retry_multiple_faces_present,
    "image_unreadable" to Res.string.openverify_retry_image_unreadable,
    "document_not_found" to Res.string.openverify_retry_document_not_found,
    "insufficient_text" to Res.string.openverify_retry_insufficient_text,
    "identity_features_not_found" to Res.string.openverify_retry_identity_features_not_found,
    "resolution_too_low" to Res.string.openverify_retry_resolution_too_low,
    "back_feature_not_found" to Res.string.openverify_retry_back_feature_not_found,
    "portrait_too_small" to Res.string.openverify_retry_portrait_too_small,
    "portrait_blurry" to Res.string.openverify_retry_portrait_blurry,
    "portrait_obstructed" to Res.string.openverify_retry_portrait_obstructed,
    "mrz_not_found" to Res.string.openverify_retry_mrz_not_found,
    "mrz_unreadable" to Res.string.openverify_retry_mrz_unreadable,
    "barcode_not_found" to Res.string.openverify_retry_barcode_not_found,
    "required_fields_missing" to Res.string.openverify_retry_required_fields_missing,
    "face_too_small" to Res.string.openverify_retry_face_too_small,
    "face_glare" to Res.string.openverify_retry_face_glare,
    "pose_not_center" to Res.string.openverify_retry_pose_not_center,
    "pose_not_left" to Res.string.openverify_retry_pose_not_left,
    "pose_not_right" to Res.string.openverify_retry_pose_not_right,
    "face_covered" to Res.string.openverify_retry_face_covered,
    "glasses_detected" to Res.string.openverify_retry_glasses_detected,
    // C51.2: the frozen Phase 5 user-behaviour reasons (strings_retry.xml).
    "document_type_not_accepted" to Res.string.openverify_retry_document_type_not_accepted,
    "document_unreadable" to Res.string.openverify_retry_document_unreadable,
    "document_password_protected" to Res.string.openverify_retry_document_password_protected,
    "document_too_large" to Res.string.openverify_retry_document_too_large,
    "document_too_many_pages" to Res.string.openverify_retry_document_too_many_pages,
    "name_not_found" to Res.string.openverify_retry_name_not_found,
    "address_not_found" to Res.string.openverify_retry_address_not_found,
    "issue_date_not_found" to Res.string.openverify_retry_issue_date_not_found,
    "issuer_not_found" to Res.string.openverify_retry_issuer_not_found,
    "document_expired" to Res.string.openverify_retry_document_expired,
    "document_too_old" to Res.string.openverify_retry_document_too_old,
    "po_box_detected" to Res.string.openverify_retry_po_box_detected,
    "otp_attempts_exhausted" to Res.string.openverify_retry_otp_attempts_exhausted,
    "otp_not_confirmed" to Res.string.openverify_retry_otp_not_confirmed,
    "domain_not_found" to Res.string.openverify_retry_domain_not_found,
    "domain_rejects_mail" to Res.string.openverify_retry_domain_rejects_mail,
    "no_mail_server" to Res.string.openverify_retry_no_mail_server,
    "address_invalid" to Res.string.openverify_retry_address_invalid,
    "address_checksum_invalid" to Res.string.openverify_retry_address_checksum_invalid,
    "signature_invalid" to Res.string.openverify_retry_signature_invalid,
    "signature_address_mismatch" to Res.string.openverify_retry_signature_address_mismatch,
    "expected_address_mismatch" to Res.string.openverify_retry_expected_address_mismatch,
    "country_not_enabled" to Res.string.openverify_retry_country_not_enabled,
    "domain_not_resolving" to Res.string.openverify_retry_domain_not_resolving,
    "document_name_mismatch" to Res.string.openverify_retry_document_name_mismatch,
)

/** The message for one retry-hint reason code, or a generic one for codes this SDK does not know. */
internal fun retryReasonMessage(reason: String): StringResource = retryReasons[reason] ?: Res.string.openverify_retry_generic

/** Messages for [hints], without repeats. A hint without reasons gets the generic message. */
internal fun retryMessages(hints: List<RetryHint>): List<StringResource> =
    hints.flatMap { hint ->
        if (hint.reasons.isEmpty()) listOf(Res.string.openverify_retry_generic) else hint.reasons.map(::retryReasonMessage)
    }.distinct()

/** Completion and failure message keys the SDK has text for (the default template's, C7). */
private val completionMessages: Map<String, StringResource> = mapOf("flow.completion" to Res.string.openverify_flow_completion)
private val failureMessages: Map<String, StringResource> = mapOf("flow.failure" to Res.string.openverify_flow_failure)

/** The completion step's message; keys the SDK has no text for get the default one. */
internal fun completionMessage(messageKey: String?): StringResource =
    completionMessages[messageKey] ?: Res.string.openverify_flow_completion

/** The failure step's message; keys the SDK has no text for get the default one. */
internal fun failureMessage(messageKey: String?): StringResource =
    failureMessages[messageKey] ?: Res.string.openverify_flow_failure

internal fun errorMessage(error: FlowError): StringResource = when (error) {
    FlowError.NETWORK -> Res.string.openverify_error_network
    FlowError.SESSION_EXPIRED -> Res.string.openverify_error_session_expired
    FlowError.INQUIRY_MISMATCH -> Res.string.openverify_error_inquiry_mismatch
    FlowError.REJECTED -> Res.string.openverify_error_rejected
    FlowError.OUT_OF_SYNC -> Res.string.openverify_error_out_of_sync
    FlowError.SERVER -> Res.string.openverify_error_server
    FlowError.INVALID_RESPONSE -> Res.string.openverify_error_invalid_response
    FlowError.STILL_PROCESSING -> Res.string.openverify_error_still_processing
}

/** Title, instruction and the review photo's description for a capture. */
internal data class CaptureCopy(
    val title: StringResource,
    val instruction: StringResource,
    val photo: StringResource,
)

/** The copy of a camera capture; `null` for the kinds this SDK never captures with the camera. */
internal fun captureCopy(kind: FileKind): CaptureCopy? = when (kind) {
    FileKind.FRONT -> CaptureCopy(
        Res.string.openverify_id_front_title,
        Res.string.openverify_id_front_instruction,
        Res.string.openverify_id_front_photo,
    )
    FileKind.BACK -> CaptureCopy(
        Res.string.openverify_id_back_title,
        Res.string.openverify_id_back_instruction,
        Res.string.openverify_id_back_photo,
    )
    FileKind.PORTRAIT -> CaptureCopy(
        Res.string.openverify_id_portrait_title,
        Res.string.openverify_id_portrait_instruction,
        Res.string.openverify_id_portrait_photo,
    )
    FileKind.SELFIE_CENTER -> CaptureCopy(
        Res.string.openverify_selfie_center_title,
        Res.string.openverify_selfie_center_instruction,
        Res.string.openverify_selfie_center_photo,
    )
    FileKind.SELFIE_LEFT -> CaptureCopy(
        Res.string.openverify_selfie_left_title,
        Res.string.openverify_selfie_left_instruction,
        Res.string.openverify_selfie_left_photo,
    )
    FileKind.SELFIE_RIGHT -> CaptureCopy(
        Res.string.openverify_selfie_right_title,
        Res.string.openverify_selfie_right_instruction,
        Res.string.openverify_selfie_right_photo,
    )
    // C64.2: a document's photo, taken with the SDK's camera when the step allows it.
    FileKind.DOCUMENT -> CaptureCopy(
        Res.string.openverify_document_capture_title,
        Res.string.openverify_document_capture_instruction,
        Res.string.openverify_document_capture_photo,
    )
    FileKind.CHIP_SOD,
    FileKind.CHIP_DG1,
    FileKind.CHIP_DG2,
    FileKind.CHIP_DG14,
    FileKind.CHIP_DG15,
    FileKind.CHIP_CARD_SECURITY,
    FileKind.CHIP_CARD_ACCESS,
    FileKind.CHIP_COM,
    FileKind.DOCUMENT_PREVIEW,
    FileKind.CHIP_PORTRAIT,
    FileKind.UNKNOWN,
    -> null
}
