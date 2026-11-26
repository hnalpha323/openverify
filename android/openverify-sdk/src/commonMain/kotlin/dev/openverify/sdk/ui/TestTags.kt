package dev.openverify.sdk.ui

import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.PersonField

/** Semantics tags for UI tests. */
internal object TestTags {
    const val CONSENT_CHECKBOX = "openverify:consent-checkbox"

    /** The checkbox of the optional consent text [key] (C42.3). */
    fun optionalConsent(key: String): String = "openverify:consent-optional:$key"
    const val PREVIEW = "openverify:preview"
    const val REVIEW_PHOTO = "openverify:review-photo"
    const val DOCUMENT_GUIDE = "openverify:guide-document"
    const val OVAL_GUIDE = "openverify:guide-oval"
    const val PROGRESS = "openverify:progress"
    const val SANDBOX_BANNER = "openverify:sandbox-banner"

    // The Phase 5 steps (C64.2).

    /** The phone step's country selector. */
    const val OTP_COUNTRY = "openverify:otp-country"

    /** The phone number or email address field. */
    const val OTP_DESTINATION = "openverify:otp-destination"

    /** The code field. */
    const val OTP_CODE = "openverify:otp-code"

    /** A form's field for the body member [field] (C52.3), a text field or a selector. */
    fun input(field: InputField): String = "openverify:input:${field.wireName}"

    /** The wallet step's network selector. */
    const val CRYPTO_CHAIN = "openverify:crypto-chain"
    const val CRYPTO_ADDRESS = "openverify:crypto-address"

    /** The message to sign, as the server built it. */
    const val CRYPTO_MESSAGE = "openverify:crypto-message"
    const val CRYPTO_SIGNATURE = "openverify:crypto-signature"
    const val CRYPTO_SIGNED_MESSAGE = "openverify:crypto-signed-message"

    /** The choice [value] of an open selector: a country, a state or a network. */
    fun option(value: String): String = "openverify:option:$value"

    // The Workflow 5B steps (C64.2).

    /** The document step's button that opens the file picker. */
    const val DOCUMENT_CHOOSE = "openverify:document-choose"

    /** The document step's button that opens the camera. */
    const val DOCUMENT_PHOTO = "openverify:document-photo"

    /** The picked document's name and size. */
    const val DOCUMENT_PICKED = "openverify:document-picked"

    /** The camera's page-shaped frame for a document. */
    const val PAGE_GUIDE = "openverify:guide-page"

    /** The button that adds an associated person to a business form. */
    const val PERSON_ADD = "openverify:person-add"

    // The status nodes the accessibility tests find (C212.2; Workflow 10D).

    /** A refusal or a problem the person can act on ([dev.openverify.sdk.ui.steps.ErrorMessage]). */
    const val ERROR_MESSAGE = "openverify:error-message"

    /** A request on its way ([dev.openverify.sdk.ui.steps.BusyRow]). */
    const val BUSY = "openverify:busy"

    /** The consent's acceptance on its way. */
    const val CONSENT_SAVING = "openverify:consent-saving"

    /** The capture screen's shutter. */
    const val CAPTURE_SHUTTER = "openverify:capture-shutter"

    /** The capture screen's "the photo could not be taken" or "could not be used". */
    const val CAPTURE_PROBLEM = "openverify:capture-problem"

    /** The notice that a selfie capture started again. */
    const val CAPTURE_RESTARTED = "openverify:capture-restarted"

    /** A kept selfie photo on its way. */
    const val CAPTURE_SENDING = "openverify:capture-sending"

    /** The waiting screen's message. */
    const val WAITING_MESSAGE = "openverify:waiting-message"

    /** The field [field] of the associated person at [index] (from 0). */
    fun person(index: Int, field: PersonField): String = "openverify:person:$index:${field.wireName}"
}
