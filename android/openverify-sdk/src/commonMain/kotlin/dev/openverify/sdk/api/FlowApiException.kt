package dev.openverify.sdk.api

import dev.openverify.sdk.model.Problem
import kotlinx.serialization.MissingFieldException
import kotlinx.serialization.SerializationException
// On Android this is a typealias of java.io.IOException, so Network keeps its JVM signature.
import kotlinx.io.IOException

/**
 * Every way a flow API call can fail. C213.3 (review P06): each carries a constant [code] and a fixed
 * message, never a serialization excerpt, a response body or a server `title` or `detail`; the
 * problem itself stays in [Http.problem] for the driver's own use (its `code`), never in a message.
 */
internal sealed class FlowApiException(
    /** A constant, lower-case dotted code: `flow_api.<kind>`, or `flow_api.http_<status>`. */
    public val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {

    /**
     * The server answered with an error status. [problem] is its `application/problem+json`
     * body when it sent one, and [requestId] identifies the request in the server's logs.
     */
    public sealed class Http(
        public val status: Int,
        public val problem: Problem?,
        public val requestId: String?,
    ) : FlowApiException("flow_api.http_$status", "HTTP $status")

    /** 401: the session token is invalid or has expired. Retrying with it cannot succeed. */
    public class Unauthorized(problem: Problem?, requestId: String?) : Http(401, problem, requestId)

    /** 403. */
    public class Forbidden(problem: Problem?, requestId: String?) : Http(403, problem, requestId)

    /** 404. */
    public class NotFound(problem: Problem?, requestId: String?) : Http(404, problem, requestId)

    /** 409: the request conflicts with the inquiry's state, for example an upload before consent. */
    public class Conflict(problem: Problem?, requestId: String?) : Http(409, problem, requestId)

    /**
     * 410: the inquiry was redacted (C9 `redacted`), so the flow cannot collect anything more.
     * Retrying cannot succeed.
     */
    public class Redacted(problem: Problem?, requestId: String?) : Http(410, problem, requestId)

    /**
     * 401 from the one-time link redeem (C10): the link is unknown, used, revoked or expired.
     * The server gives the same answer for each, and retrying cannot succeed.
     */
    public class LinkRefused(problem: Problem?, requestId: String?) : Http(401, problem, requestId)

    /** 400, 413, 415 or 422: the server rejected the request as invalid. */
    public class Rejected(status: Int, problem: Problem?, requestId: String?) : Http(status, problem, requestId)

    /** 429. [retryAfterSeconds] comes from the `Retry-After` header when it holds seconds. */
    public class RateLimited(
        problem: Problem?,
        requestId: String?,
        public val retryAfterSeconds: Long?,
    ) : Http(429, problem, requestId)

    /** 5xx. */
    public class ServerError(status: Int, problem: Problem?, requestId: String?) : Http(status, problem, requestId)

    /** Any other status that is not 2xx, including redirects, which the client never follows. */
    public class UnexpectedStatus(status: Int, problem: Problem?, requestId: String?) :
        Http(status, problem, requestId)

    /** The exchange did not complete: no connection, a timeout or a dropped connection. */
    public class Network(cause: IOException) : FlowApiException("flow_api.network", "Network error", cause)

    /**
     * A 2xx response whose body is not the JSON the contract describes. C213.3: it keeps only the kind
     * of its cause as a fixed code ([decodeFailure]) and where decoding failed ([jsonPath]), never the
     * cause, whose message quotes the body.
     */
    public class InvalidResponse(cause: Throwable?) : FlowApiException("flow_api.invalid_response", "Unexpected response body") {
        /**
         * KP10-56: the decoding failure as a fixed code, chosen by the failure's type: `missing_field`
         * (a required member is absent), `malformed_json` (any other serialization failure: bad JSON, a
         * wrong type, trailing bytes), `invalid_value` (a value the model's own checks refuse) or
         * `other`; `null` without a cause (a body over its size cap). A type check survives R8's
         * renaming, where a class name read as text did not, so no consumer rule keeps a name for it.
         */
        public val decodeFailure: String? = cause?.let(::decodeFailureOf)

        /** Where in the body decoding failed (`$.inquiry.status`), member names and indices only. */
        public val jsonPath: String? = cause?.message?.let(::jsonPathOf)

        internal companion object {
            /** Every code [decodeFailure] can hold. */
            internal val DECODE_FAILURES: Set<String?> = setOf("missing_field", "malformed_json", "invalid_value", "other")
        }
    }

    /** Polling stopped while the server was still processing the verification. */
    public class StillProcessing(public val verificationId: String) :
        FlowApiException("flow_api.still_processing", "Verification is still being processed")
}

/** KP10-56: [FlowApiException.InvalidResponse.decodeFailure] of [cause], by its type. */
private fun decodeFailureOf(cause: Throwable): String = when (cause) {
    is MissingFieldException -> "missing_field"
    is SerializationException -> "malformed_json"
    is IllegalArgumentException -> "invalid_value"
    else -> "other"
}

/** kotlinx.serialization's `at path: $...` in a decoding failure's message. */
private val PATH_IN_MESSAGE = Regex("""at path: (\$\S*)""")

/** One step of a JSON path: a member name of the contract's shape, or an array index. */
private val PATH_STEP = Regex("""\.[A-Za-z][A-Za-z0-9_-]{0,63}|\[[0-9]{1,6}]""")

/**
 * The JSON path in a decoding failure's [message], up to its first step that is not a member name or
 * an index (a map key, which can be anything the server stored), so no value of the body is kept.
 */
private fun jsonPathOf(message: String): String? {
    val path = PATH_IN_MESSAGE.find(message)?.groupValues?.get(1) ?: return null
    val kept = StringBuilder("$")
    var at = 1
    while (at < path.length) {
        val step = PATH_STEP.matchAt(path, at) ?: break
        kept.append(step.value)
        at = step.range.last + 1
    }
    return kept.toString()
}
