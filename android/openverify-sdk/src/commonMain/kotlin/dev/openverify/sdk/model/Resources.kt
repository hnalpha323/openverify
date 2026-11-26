// KP10-12: the public wire enums carry no @Serializable; every property of theirs here is (de)coded by
// its internal wire serializer.
@file:UseSerializers(InquiryStatus.Serializer::class, FileKind.Serializer::class)

package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.UseSerializers
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// JSON:API-style envelopes (contract C1). Attribute names are kebab-case on the wire.

/** `{ type, id }` linkage to another resource. */
@Serializable
internal data class ResourceIdentifier(val type: String, val id: String)

@Serializable
internal data class ToOneRelationship(val data: ResourceIdentifier)

@Serializable
internal data class ToManyRelationship(val data: List<ResourceIdentifier>)

// Inquiry (C2) ------------------------------------------------------------------------------

/** `GET /api/v1/inquiries/:id`; `?include=verifications` fills [included]. */
@Serializable
internal data class InquiryDocument(
    val data: InquiryResource,
    val included: List<VerificationResource> = emptyList(),
)

@Serializable
internal data class InquiryResource(
    val type: String,
    val id: String,
    val attributes: InquiryAttributes,
    val relationships: InquiryRelationships,
)

@Serializable
internal data class InquiryAttributes(
    val status: InquiryStatus,
    @SerialName("reference-id") val referenceId: String? = null,
    /** Data about the person being verified. It is PII, so [toString] leaves it out. */
    val fields: JsonObject = JsonObject(emptyMap()),
    @SerialName("created-at") val createdAt: String,
    @SerialName("updated-at") val updatedAt: String,
) {
    override fun toString(): String =
        "InquiryAttributes(status=$status, referenceId=$referenceId, fields=<${fields.size} redacted>, " +
            "createdAt=$createdAt, updatedAt=$updatedAt)"
}

@Serializable
internal data class InquiryRelationships(
    @SerialName("inquiry-template") val inquiryTemplate: ToOneRelationship,
    /** Every attempt, oldest first. */
    val verifications: ToManyRelationship,
)

// Verification, full view (C2): server API, dashboard and webhooks -------------------------

/** `GET /api/v1/verifications/:id`; may include the verification's files. */
@Serializable
internal data class VerificationDocument(
    val data: VerificationResource,
    val included: List<FileResource> = emptyList(),
)

@Serializable
internal data class VerificationResource(
    val type: String,
    val id: String,
    val attributes: VerificationAttributes,
    val relationships: VerificationRelationships,
) {
    val verificationType: VerificationType get() = VerificationType.fromResourceType(type)
}

@Serializable
internal data class VerificationAttributes(
    val status: VerificationStatus,
    /** ISO 3166-1 alpha-2 issuing country; government ID only. */
    val country: String? = null,
    /** Government ID only. */
    @SerialName("id-class") val idClass: String? = null,
    val checks: List<VerificationCheck> = emptyList(),
    @SerialName("created-at") val createdAt: String,
    @SerialName("updated-at") val updatedAt: String,
)

/** One check outcome. [metadata] holds scores, never PII or embeddings. */
@Serializable
internal data class VerificationCheck(
    val name: String,
    val status: CheckStatus,
    val reasons: List<String> = emptyList(),
    val requirement: CheckRequirement,
    val metadata: JsonObject = JsonObject(emptyMap()),
)

@Serializable
internal data class VerificationRelationships(
    val inquiry: ToOneRelationship,
    val files: ToManyRelationship,
)

// Verification, flow view (C3): status and user-facing retry hints only --------------------

/** `POST /flow/verifications`, `GET /flow/verifications/:id` and `.../submit` responses. */
@Serializable
internal data class FlowVerificationDocument(val data: FlowVerification)

@Serializable
internal data class FlowVerification(
    val type: String,
    val id: String,
    val attributes: FlowVerificationAttributes,
) {
    val verificationType: VerificationType get() = VerificationType.fromResourceType(type)
}

@Serializable
internal data class FlowVerificationAttributes(
    val status: VerificationStatus,
    @SerialName("retry-hints") val retryHints: List<RetryHint> = emptyList(),
    @SerialName("created-at") val createdAt: String,
    @SerialName("updated-at") val updatedAt: String,
    /**
     * C52.2: how to run a Phase 5 type's step, in the type's own shape (`null` for the government ID
     * and selfie, and from a server that does not build it yet). It never holds a code or an entered
     * value, but the OTP state names the destination, masked, so [toString] leaves it out.
     */
    val guidance: JsonObject? = null,
    /** C52.2: whether a form type's entered values were received. */
    @SerialName("inputs-received") val inputsReceived: Boolean? = null,
) {
    override fun toString(): String =
        "FlowVerificationAttributes(status=$status, retryHints=$retryHints, createdAt=$createdAt, updatedAt=$updatedAt, " +
            "guidance=${if (guidance == null) "null" else "<redacted>"}, inputsReceived=$inputsReceived)"
}

/** A failed check the user can fix by retrying (`user_behavior` checks only). */
@Serializable
internal data class RetryHint(val name: String, val reasons: List<String> = emptyList())

// File (C3) ---------------------------------------------------------------------------------

@Serializable
internal data class FileDocument(val data: FileResource)

/** An uploaded image. It never carries the client's file name or the contents. */
@Serializable
internal data class FileResource(
    val type: String,
    val id: String,
    val attributes: FileAttributes,
    val relationships: FileRelationships,
)

@Serializable
internal data class FileAttributes(
    val kind: FileKind,
    @SerialName("mime-type") val mimeType: String,
    @SerialName("byte-size") val byteSize: Long,
    @SerialName("created-at") val createdAt: String,
)

@Serializable
internal data class FileRelationships(val verification: ToOneRelationship)

// Problem details (RFC 9457) ----------------------------------------------------------------

/**
 * An `application/problem+json` error body. Every member is optional, as RFC 9457 allows, and
 * extension members other than the ones below are ignored.
 */
@Serializable
internal data class Problem(
    val type: String = "about:blank",
    val title: String? = null,
    val status: Int? = null,
    /** Human-readable explanation. The server never puts PII in it. */
    val detail: String? = null,
    val instance: String? = null,
    /** Same value as the `x-request-id` response header. */
    val requestId: String? = null,
    val errors: List<ProblemFieldError> = emptyList(),
    /**
     * Machine-readable snake_case code, such as `session_expired` or `session_canceled` on the
     * 401 of an inactive flow session (C10).
     */
    val code: String? = null,
    /**
     * Why a flow session was canceled, with `code` `session_canceled` (C25.8). A reason added
     * after this SDK version decodes as [SessionCanceledReason.UNKNOWN], never as an error.
     */
    val reason: SessionCanceledReason? = null,
    /** C52.7: the tries left for the code, with `otp_incorrect`. */
    @SerialName("attempts-remaining") val attemptsRemaining: Int? = null,
    /** C52.7: when a new code may be sent, with `otp_resend_too_soon`. */
    @SerialName("resend-available-at") val resendAvailableAt: String? = null,
)

@Serializable
internal data class ProblemFieldError(
    val location: String? = null,
    val pointer: String? = null,
    val detail: String? = null,
)

// Event (C5) --------------------------------------------------------------------------------

@Serializable
internal data class EventDocument(val data: EventResource)

@Serializable
internal data class EventResource(
    val type: String,
    val id: String,
    val attributes: EventAttributes,
)

@Serializable
internal data class EventAttributes(
    /** For example `inquiry.completed`. */
    val name: String,
    val payload: EventPayload,
    @SerialName("created-at") val createdAt: String,
)

/** The resource the event is about. It can hold PII, so [toString] leaves the body out. */
@Serializable
internal data class EventPayload(
    val data: JsonObject,
    val included: List<JsonObject> = emptyList(),
) {
    override fun toString(): String = "EventPayload(data=<redacted>, included=<${included.size} redacted>)"
}

// Flow session (C3) -------------------------------------------------------------------------

/** `GET /api/v1/flow/session`. The first call moves the inquiry from `created` to `pending`. */
@Serializable
internal data class FlowSession(
    val inquiry: FlowSessionInquiry,
    val flow: Flow,
    /** Every attempt, oldest first. */
    val verifications: List<FlowVerification> = emptyList(),
    /** `null` until the user accepts the consent step. */
    val consent: FlowConsent? = null,
    /** Where the session runs (C19). Servers before Phase 2 leave it out. */
    val environment: FlowEnvironment? = null,
    /**
     * How long the environment keeps face templates, in days (C42.3, C42.6): the `{{days}}` of the
     * optional matching consent text. Servers before Phase 4 leave it out.
     */
    @SerialName("face-template-retention-days") val faceTemplateRetentionDays: Int? = null,
    /** C94.6 (Phase 7): the collector tiers once consent is recorded; `null` before. */
    val signals: FlowSessionSignals? = null,
    /** C211.3 (Workflow 10B): whether to ask the host's integrity provider for one token; `null` when not. */
    val integrity: FlowSessionIntegrity? = null,
    /** C96.3 (Phase 7): the handoff step's state, or `null` when the flow has none. */
    val handoff: FlowHandoff? = null,
    /** C96.3 (F30): a redeemed handoff session's context; an SDK session is never one. */
    @SerialName("handoff-context") val handoffContext: FlowHandoffContext? = null,
    /** C128.7 (Phase 8): how the person contests a decline, on a declined inquiry. */
    @SerialName("decision-contest-route") val decisionContestRoute: FlowContestRoute? = null,
    // Phase 9 (C151.5-C151.8, C158.5, C160.7, C162.3, C162.6), every member optional; the driver
    // requires `spec-version: 2` and a `position` (C193.2). `embed` is web-only and not modelled.
    /** C151.5: where the inquiry is. */
    val position: FlowPosition? = null,
    /** C151.5: the current step's client view, for a client that declared spec 2. */
    val step: FlowStep? = null,
    /** C151.5 (P16): the current screen's bound values only. Personal data. */
    val values: Map<String, FlowValue>? = null,
    /** C160.7: the theme the session renders. */
    val theme: FlowTheme? = null,
    /** C162.6: the operator's copy for the current step, by locale. */
    val copy: FlowCopy? = null,
    /** C161.2: the version's enabled locales and default. */
    val locales: FlowLocales? = null,
    /** C158.5: the completion redirect; ignored on Android (decision 10). */
    val completion: FlowCompletion? = null,
    /** C151.7: the flow-spec version served. */
    @SerialName("spec-version") val specVersion: Int? = null,
    /** C162.3 (Workflow 9B): the help and privacy links. */
    val links: FlowLinks? = null,
    /**
     * C200.2, C221.12 (Workflow 10A): the environment's display name, NFC-normalised, which fills
     * `{organization}` in operator copy; `null` when the environment sets none, absent from earlier
     * servers.
     */
    @SerialName("organization-display-name") val organizationDisplayName: String? = null,
    /**
     * C237.6 (Workflow 11A, clients-connect; V02): this session's accepted, unwithdrawn share
     * consents, each offered for withdrawal on every later step and the completion screen; absent
     * while there are none.
     */
    @SerialName("withdrawable-share-consents") val withdrawableShareConsents: List<FlowWithdrawableShareConsent>? = null,
)

@Serializable
internal data class FlowSessionInquiry(val id: String, val status: InquiryStatus)

@Serializable
internal data class FlowConsent(@SerialName("accepted-at") val acceptedAt: String)

@Serializable
internal data class FlowEnvironment(val kind: EnvironmentKind)

// Inquiry session (C10, C20) ---------------------------------------------------------------

/** `GET /api/v1/inquiry-sessions/:id` (server API): the session a flow runs in. */
@Serializable
internal data class InquirySessionDocument(val data: InquirySessionResource)

@Serializable
internal data class InquirySessionResource(
    val type: String,
    val id: String,
    val attributes: InquirySessionAttributes,
    val relationships: InquirySessionRelationships,
)

@Serializable
internal data class InquirySessionAttributes(
    val status: InquirySessionStatus,
    @SerialName("created-at") val createdAt: String,
    /** The first flow API call; `null` until then. */
    @SerialName("started-at") val startedAt: String? = null,
    @SerialName("expires-at") val expiresAt: String,
    /** The end user's address from the first flow call. PII: `null` when masked. */
    @SerialName("ip-address") val ipAddress: String? = null,
    /** The end user's browser or app from the first flow call. PII: `null` when masked. */
    @SerialName("user-agent") val userAgent: String? = null,
) {
    override fun toString(): String =
        "InquirySessionAttributes(status=$status, createdAt=$createdAt, startedAt=$startedAt, expiresAt=$expiresAt, " +
            "ipAddress=${if (ipAddress == null) "null" else "<redacted>"}, " +
            "userAgent=${if (userAgent == null) "null" else "<redacted>"})"
}

@Serializable
internal data class InquirySessionRelationships(val inquiry: ToOneRelationship)

/** C211.3 (Workflow 10B): the session's `integrity` member. */
@Serializable
internal data class FlowSessionIntegrity(val request: Boolean)

/**
 * C211.3 (Workflow 10B): `POST /api/v1/flow/integrity-challenges`' answer: the challenge's id (`ich_`),
 * the base64url `request-hash` the device passes to Play Integrity, and its expiry.
 */
@Serializable
internal data class FlowIntegrityChallenge(
    val id: String,
    @SerialName("request-hash") val requestHash: String,
    @SerialName("expires-at") val expiresAt: String,
)
