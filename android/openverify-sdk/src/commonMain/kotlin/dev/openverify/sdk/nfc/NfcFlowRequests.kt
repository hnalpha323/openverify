package dev.openverify.sdk.nfc

import dev.openverify.sdk.api.ApiBaseUrl
import dev.openverify.sdk.api.FlowHttp
import dev.openverify.sdk.model.ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FileDocument
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowChipSubmitBody
import dev.openverify.sdk.model.FlowClientUnable
import dev.openverify.sdk.model.FlowClientUnableBody
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.FlowSandboxChipBody
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.FlowVerificationDocument
import dev.openverify.sdk.model.SandboxChipScenario
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.PartData
import io.ktor.http.content.TextContent
import kotlin.io.encoding.Base64
import kotlinx.io.Buffer

/**
 * C207.1 (Workflow 10C): the NFC routes as the flow API client sends them, over its [FlowHttp], its
 * API base and its `Authorization` value, so they carry the SDK's headers and map errors to
 * `FlowApiException` like every other flow call (as `signals/IntegrityRequests.kt` does).
 * `FlowApiClient`'s five NFC methods delegate here with those three values. Every bound the server
 * holds is checked before anything is sent, and no message names a value: the bodies are chip data.
 * `NfcRequestFixturesTest` holds each encoding to its committed fixture (C224.4).
 */
internal object NfcFlowRequests {
    /** `ver_` plus a ULID in upper-case Crockford base32 (contract C1), a path segment of every NFC route. */
    private val VERIFICATION_ID = Regex("ver_[0-9A-HJKMNP-TV-Z]{26}")

    /** C52.4: the chip's files the server takes; DG11 and DG12 have no kind and are never sent (C207.4). */
    val CHIP_KINDS: List<FileKind> = listOf(
        FileKind.CHIP_SOD,
        FileKind.CHIP_DG1,
        FileKind.CHIP_DG2,
        FileKind.CHIP_DG14,
        FileKind.CHIP_DG15,
        FileKind.CHIP_CARD_SECURITY,
        FileKind.CHIP_CARD_ACCESS,
        FileKind.CHIP_COM,
    )

    /** C207.1: DG2 (the portrait) is at most 1 MiB. */
    const val DG2_MAX_BYTES: Int = 1024 * 1024

    /** C207.1: every other chip file is at most 64 KiB. */
    const val FILE_MAX_BYTES: Int = 64 * 1024

    /** The most bytes the server takes for a chip file of [kind]. */
    fun maxBytes(kind: FileKind): Int = if (kind == FileKind.CHIP_DG2) DG2_MAX_BYTES else FILE_MAX_BYTES

    /** `POST /api/v1/flow/verifications/:id/chip-challenges` with an empty object (C62.5). */
    suspend fun chipChallenge(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String, verificationId: String): FlowChipChallenge =
        http.send(
            HttpMethod.Post,
            url(apiBase, verificationId, "chip-challenges"),
            FlowChipChallenge.serializer(),
            authorization,
            TextContent("{}", FlowHttp.JSON),
        )

    /**
     * `POST /api/v1/flow/verifications/:id/files` (multipart `kind` and `file`) with one chip file:
     * one of the eight chip kinds, DG2 at most 1 MiB and the others at most 64 KiB, checked before
     * sending (C207.1). The part is named `<kind>.bin`, `application/octet-stream`.
     */
    suspend fun chipFile(
        http: FlowHttp,
        apiBase: ApiBaseUrl,
        authorization: String,
        verificationId: String,
        kind: FileKind,
        bytes: ByteArray,
    ): FileResource {
        require(kind in CHIP_KINDS) { "Not a chip file kind" }
        require(bytes.isNotEmpty() && bytes.size <= maxBytes(kind)) { "A chip file is empty or over its size limit" }
        val parts = listOf(
            // `kind` first, so a streaming server knows it before the file arrives.
            PartData.FormItem(kind.wireValue, {}, Headers.build { append(HttpHeaders.ContentDisposition, "form-data; name=\"kind\"") }),
            PartData.BinaryItem(
                { Buffer().apply { write(bytes) } },
                {},
                Headers.build {
                    append(HttpHeaders.ContentDisposition, "form-data; name=\"file\"; filename=\"${kind.wireValue}.bin\"")
                    append(HttpHeaders.ContentType, CHIP_FILE_TYPE)
                    append(HttpHeaders.ContentLength, bytes.size.toString())
                },
            ),
        )
        return http.send(
            HttpMethod.Post,
            url(apiBase, verificationId, "files"),
            FileDocument.serializer(),
            authorization,
            MultiPartFormDataContent(parts),
        ).data
    }

    /** `POST /api/v1/flow/verifications/:id/submit` with the body's `chip` member (C62.5). */
    suspend fun chipSubmit(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String, verificationId: String, chip: FlowChipSubmit): FlowVerification {
        chip.activeAuthenticationResponse?.let { response ->
            val size = try {
                Base64.decode(response).size
            } catch (_: IllegalArgumentException) {
                -1
            }
            require(size in 1..ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES) { "An Active Authentication response is base64 of 1 byte to 1 KiB" }
        }
        return http.send(
            HttpMethod.Post,
            url(apiBase, verificationId, "submit"),
            FlowVerificationDocument.serializer(),
            authorization,
            http.jsonBody(FlowChipSubmitBody.serializer(), FlowChipSubmitBody(chip)),
        ).data
    }

    /** `POST /api/v1/flow/verifications/:id/client-unable` (C207.9). */
    suspend fun clientUnable(
        http: FlowHttp,
        apiBase: ApiBaseUrl,
        authorization: String,
        verificationId: String,
        reason: ClientUnableReason,
    ): FlowClientUnable = http.send(
        HttpMethod.Post,
        url(apiBase, verificationId, "client-unable"),
        FlowClientUnable.serializer(),
        authorization,
        http.jsonBody(FlowClientUnableBody.serializer(), FlowClientUnableBody(reason)),
    )

    /** `POST /api/v1/flow/verifications/:id/sandbox-chip` (C208.1), sandbox environments only. */
    suspend fun sandboxChip(
        http: FlowHttp,
        apiBase: ApiBaseUrl,
        authorization: String,
        verificationId: String,
        challengeId: String,
        scenario: SandboxChipScenario,
    ): FlowSandboxChip = http.send(
        HttpMethod.Post,
        url(apiBase, verificationId, "sandbox-chip"),
        FlowSandboxChip.serializer(),
        authorization,
        http.jsonBody(FlowSandboxChipBody.serializer(), FlowSandboxChipBody(challengeId, scenario)),
    )

    /** Validated rather than only encoded: `..` would be resolved as a dot segment. */
    private fun url(apiBase: ApiBaseUrl, verificationId: String, action: String): String {
        require(VERIFICATION_ID.matches(verificationId)) { "Not a verification ID" }
        return apiBase.resolve("api", "v1", "flow", "verifications", verificationId, action)
    }

    /** A chip file is opaque bytes to the upload route. */
    private const val CHIP_FILE_TYPE = "application/octet-stream"
}
