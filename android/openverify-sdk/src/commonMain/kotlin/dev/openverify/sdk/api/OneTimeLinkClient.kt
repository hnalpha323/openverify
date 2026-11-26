package dev.openverify.sdk.api

import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.HttpClient
import io.ktor.http.HttpMethod
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * `POST /api/v1/flow/one-time-links/redeem` (contracts C10 and C19): trades a one-time link for
 * a session token. The request carries no credentials: the one-time token in its body is the
 * credential. It succeeds once; every refusal is the same generic 401, raised as
 * [FlowApiException.LinkRefused].
 *
 * @param apiBaseUrl as for [FlowApiClient].
 * @param httpClient a client from [flowHttpClient]; the platform's shared one by default.
 */
internal class OneTimeLinkClient(
    apiBaseUrl: String,
    httpClient: HttpClient = defaultFlowHttpClient(),
    json: Json = OpenVerifyJson,
) {
    private val redeemUrl: String =
        SessionCredentials.parseApiBaseUrl(apiBaseUrl).resolve("api", "v1", "flow", "one-time-links", "redeem")
    private val http = FlowHttp(httpClient, json)

    /**
     * @throws IllegalArgumentException for malformed credentials, before any request and
     *   without echoing the token.
     * @throws FlowApiException.LinkRefused when the link is unknown, used, revoked or expired.
     * @throws FlowApiException for any other failure.
     */
    suspend fun redeem(inquiryId: String, oneTimeToken: String): RedeemedSession {
        require(SessionCredentials.isInquiryId(inquiryId)) { "inquiryId must be an OpenVerify inquiry ID (inq_...)" }
        SessionCredentials.requireOneTimeToken(oneTimeToken)
        val body = http.jsonBody(RedeemRequest.serializer(), RedeemRequest(inquiryId, oneTimeToken))
        val answer = try {
            // No Authorization header: the one-time token in the body is the credential.
            http.send(HttpMethod.Post, redeemUrl, RedeemResponse.serializer(), body = body)
        } catch (e: FlowApiException.Unauthorized) {
            throw FlowApiException.LinkRefused(e.problem, e.requestId)
        }
        if (!SessionCredentials.isSessionToken(answer.sessionToken)) {
            throw FlowApiException.InvalidResponse(null)
        }
        return RedeemedSession(answer.sessionToken, answer.expiresAt)
    }
}

/** A redeemed one-time link: a session token, kept in memory only. [toString] never shows it. */
internal data class RedeemedSession(val sessionToken: String, val expiresAt: String) {
    override fun toString(): String = "RedeemedSession(sessionToken=<redacted>, expiresAt=$expiresAt)"
}

@Serializable
private class RedeemRequest(
    @SerialName("inquiry-id") val inquiryId: String,
    @SerialName("one-time-token") val oneTimeToken: String,
)

@Serializable
private class RedeemResponse(
    @SerialName("session-token") val sessionToken: String,
    @SerialName("expires-at") val expiresAt: String,
)
