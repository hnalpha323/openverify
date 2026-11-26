package dev.openverify.sdk.signals

import dev.openverify.sdk.api.ApiBaseUrl
import dev.openverify.sdk.api.FlowHttp
import dev.openverify.sdk.model.FlowIntegrityChallenge
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder

/**
 * C211.3 (Workflow 10B): the integrity routes as the flow API client sends them, over its [FlowHttp],
 * its API base and its `Authorization` value, so they carry the SDK's headers and map errors to
 * `FlowApiException` like every other flow call. `FlowApiClient.createIntegrityChallenge` and
 * `sendIntegrityToken` call these once their delegation passes the client's three values (a hook in
 * `api/FlowApiClient.kt`, which is shared; see the no-argument stubs below).
 */
internal object IntegrityRequests {
    /** `ich_` plus a ULID (contract C1), as `flowIntegrityTokenBodySchema`'s `challenge-id` takes it. */
    val CHALLENGE_ID: Regex = Regex("ich_[0-9A-HJKMNP-TV-Z]{26}")

    /** `flowIntegrityChallengeSchema`'s `request-hash`: base64url, no padding, of 32 bytes. */
    val REQUEST_HASH: Regex = Regex("[A-Za-z0-9_-]{43}")

    /** `INTEGRITY_TOKEN_MAX_LENGTH`: at most 16 KiB of token. */
    const val TOKEN_MAX_LENGTH: Int = 16 * 1024

    /** `POST /api/v1/flow/integrity-challenges` with an empty object (`flowIntegrityChallengeBodySchema`). */
    suspend fun challenge(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String): FlowIntegrityChallenge =
        http.send(
            HttpMethod.Post,
            apiBase.resolve("api", "v1", "flow", "integrity-challenges"),
            FlowIntegrityChallenge.serializer(),
            authorization,
            TextContent("{}", FlowHttp.JSON),
        )

    /**
     * `POST /api/v1/flow/integrity-tokens` (`flowIntegrityTokenBodySchema`), answered 202 with no body.
     * The messages name neither value: the token is the device's attestation (C211.4).
     */
    suspend fun token(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String, challengeId: String, token: String) {
        require(CHALLENGE_ID.matches(challengeId)) { "Not an integrity challenge ID" }
        require(token.length in 1..TOKEN_MAX_LENGTH) { "An integrity token is 1 to 16384 characters" }
        http.send(
            HttpMethod.Post,
            apiBase.resolve("api", "v1", "flow", "integrity-tokens"),
            Accepted,
            authorization,
            http.jsonBody(IntegrityTokenBody.serializer(), IntegrityTokenBody(challengeId, token)),
        )
    }
}

@Serializable
private class IntegrityTokenBody(@SerialName("challenge-id") val challengeId: String, val token: String) {
    /** The token is never printed. */
    override fun toString(): String = "IntegrityTokenBody(challengeId=$challengeId, token=<redacted>)"
}

/** The 202 of `POST /api/v1/flow/integrity-tokens`, which has no body. */
private object Accepted : DeserializationStrategy<Unit> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("dev.openverify.sdk.signals.Accepted")

    override fun deserialize(decoder: Decoder) = Unit
}
