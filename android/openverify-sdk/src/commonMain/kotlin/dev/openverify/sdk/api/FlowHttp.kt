package dev.openverify.sdk.api

import dev.openverify.sdk.OPENVERIFY_SDK_VERSION

import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.Problem
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.prepareRequest
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsChannel
import io.ktor.utils.io.readRemaining
import kotlinx.io.readByteArray
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.OutgoingContent
import io.ktor.http.content.TextContent
import kotlinx.io.IOException
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.Json

/**
 * Whether a `Content-Type` value is a well-formed media type with a `json` or `+json` subtype,
 * as OkHttp's `MediaType` read it: only then is an error body read as a problem.
 */
internal fun isJsonMediaType(contentType: String?): Boolean {
    val match = contentType?.let(MEDIA_TYPE::matchEntire) ?: return false
    val subtype = match.groupValues[2].lowercase()
    return subtype == "json" || subtype.endsWith("+json")
}

/** An RFC 7230 token, as OkHttp's `MediaType` reads one. */
private const val MEDIA_TOKEN = "[a-zA-Z0-9!#$%&'*+.^_`{|}~-]+"
private val MEDIA_TYPE = Regex("($MEDIA_TOKEN)/($MEDIA_TOKEN)(?:;\\s*(?:$MEDIA_TOKEN=(?:$MEDIA_TOKEN|\"[^\"]*\"))?)*")

/**
 * What the flow API clients share: the SDK's headers, JSON bodies, and error responses,
 * including `application/problem+json` bodies, mapped to [FlowApiException]. The client must
 * come from [flowHttpClient], so that no redirect is followed.
 */
internal class FlowHttp(private val client: HttpClient, val json: Json = OpenVerifyJson) {

    fun <T> jsonBody(serializer: SerializationStrategy<T>, value: T): OutgoingContent =
        TextContent(json.encodeToString(serializer, value), JSON)

    /**
     * Sends a [method] request to [url] with the SDK's `Accept`, `User-Agent` and
     * `OpenVerify-Flow-Spec` headers, an
     * `Authorization` header when there is an [authorization], and [body], then decodes a 2xx
     * body with [deserializer]. Cancelling the caller cancels the exchange.
     * @throws FlowApiException for a failed exchange, an error status or an unexpected body.
     */
    suspend fun <T> send(
        method: HttpMethod,
        url: String,
        deserializer: DeserializationStrategy<T>,
        authorization: String? = null,
        body: OutgoingContent? = null,
    ): T {
        val response = try {
            val answer = client.request(url) {
                this.method = method
                header(HttpHeaders.Accept, ACCEPT)
                header(HttpHeaders.UserAgent, USER_AGENT)
                // C151.7, C193.1: the flow-spec versions this SDK renders: 2 only (decision 7).
                header(FLOW_SPEC_HEADER, FLOW_SPEC_VERSIONS)
                authorization?.let { header(HttpHeaders.Authorization, it) }
                body?.let { setBody(it) }
            }
            RawResponse(
                code = answer.status.value,
                isJson = isJsonMediaType(answer.lastHeader(HttpHeaders.ContentType)),
                requestId = answer.lastHeader(REQUEST_ID),
                retryAfter = answer.lastHeader(HttpHeaders.RetryAfter),
                body = utf8(answer.bodyAsBytes()),
            )
        } catch (e: IOException) {
            throw FlowApiException.Network(e)
        }
        if (response.code !in 200..299) {
            throw httpError(response)
        }
        return try {
            json.decodeFromString(deserializer, response.body)
        } catch (e: IllegalArgumentException) {
            // SerializationException is an IllegalArgumentException.
            throw FlowApiException.InvalidResponse(e)
        }
    }

    /**
     * C160.6, C198.3: `GET [url]` with the SDK's headers and [authorization], answering a 2xx body as
     * its bytes. The body is streamed and never read past [maxBytes]: a longer one (declared or sent)
     * is an [FlowApiException.InvalidResponse], so a malformed answer cannot exhaust memory.
     * @throws FlowApiException for a failed exchange, an error status or a body above [maxBytes].
     */
    suspend fun bytes(url: String, authorization: String, maxBytes: Int): ByteArray = try {
        client.prepareRequest(url) {
            method = HttpMethod.Get
            header(HttpHeaders.Accept, "*/*, application/problem+json")
            header(HttpHeaders.UserAgent, USER_AGENT)
            header(FLOW_SPEC_HEADER, FLOW_SPEC_VERSIONS)
            header(HttpHeaders.Authorization, authorization)
        }.execute { answer ->
            if (answer.status.value !in 200..299) {
                throw httpError(
                    RawResponse(
                        code = answer.status.value,
                        isJson = isJsonMediaType(answer.lastHeader(HttpHeaders.ContentType)),
                        requestId = answer.lastHeader(REQUEST_ID),
                        retryAfter = answer.lastHeader(HttpHeaders.RetryAfter),
                        body = utf8(answer.bodyAsChannel().readRemaining(MAX_PROBLEM_BYTES).readByteArray()),
                    ),
                )
            }
            val declared = answer.lastHeader(HttpHeaders.ContentLength)?.toLongOrNull()
            if (declared != null && declared > maxBytes) throw FlowApiException.InvalidResponse(null)
            val read = answer.bodyAsChannel().readRemaining(maxBytes.toLong() + 1).readByteArray()
            if (read.size > maxBytes) throw FlowApiException.InvalidResponse(null)
            read
        }
    } catch (e: IOException) {
        throw FlowApiException.Network(e)
    }

    private fun httpError(response: RawResponse): FlowApiException.Http {
        val problem = if (response.isJson) {
            runCatching { json.decodeFromString(Problem.serializer(), response.body) }.getOrNull()
        } else {
            null
        }
        val requestId = response.requestId ?: problem?.requestId
        return when (val status = response.code) {
            401 -> FlowApiException.Unauthorized(problem, requestId)
            403 -> FlowApiException.Forbidden(problem, requestId)
            404 -> FlowApiException.NotFound(problem, requestId)
            409 -> FlowApiException.Conflict(problem, requestId)
            410 -> FlowApiException.Redacted(problem, requestId)
            400, 413, 415, 422 -> FlowApiException.Rejected(status, problem, requestId)
            429 -> FlowApiException.RateLimited(problem, requestId, response.retryAfter?.toLongOrNull())
            in 500..599 -> FlowApiException.ServerError(status, problem, requestId)
            else -> FlowApiException.UnexpectedStatus(status, problem, requestId)
        }
    }

    /** The parts of a response the clients use, read in full inside the exchange. */
    private class RawResponse(
        val code: Int,
        val isJson: Boolean,
        val requestId: String?,
        val retryAfter: String?,
        val body: String,
    )

    companion object {
        /** C214.3: the generated constant of android/gradle.properties' openverifyVersion. */
        const val SDK_VERSION = OPENVERIFY_SDK_VERSION
        private const val ACCEPT = "application/json, application/problem+json"
        private const val REQUEST_ID = "x-request-id"
        private val USER_AGENT = "OpenVerify-$PLATFORM_NAME/$SDK_VERSION"

        /** The most of an error body read as a problem, beside a streamed answer. */
        private const val MAX_PROBLEM_BYTES = 64L * 1024

        /** C151.7 (`FLOW_SPEC_HEADER` of `@openverify/contracts`): the versions a client renders. */
        const val FLOW_SPEC_HEADER = "OpenVerify-Flow-Spec"

        /** C193.1 (decision 7): spec 2 only; this SDK no longer renders the v1 projection. */
        const val FLOW_SPEC_VERSIONS = "2"

        /** Exactly the type OkHttp sent before K4, parameter included. */
        val JSON: ContentType = ContentType.parse("application/json; charset=utf-8")
    }
}

/** A header's last value, as OkHttp's `Response.header` returned it. */
private fun HttpResponse.lastHeader(name: String): String? = headers.getAll(name)?.lastOrNull()

/**
 * JSON is UTF-8 (RFC 8259 §8.1), whatever charset a response names, and a leading byte order
 * mark is skipped as OkHttp skipped it. Malformed bytes become U+FFFD, as with OkHttp.
 */
private fun utf8(bytes: ByteArray): String = bytes.decodeToString().removePrefix("\uFEFF")
