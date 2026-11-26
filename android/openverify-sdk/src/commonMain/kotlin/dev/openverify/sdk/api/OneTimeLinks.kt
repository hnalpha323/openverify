package dev.openverify.sdk.api

/**
 * Reads a one-time link (C10), `https://verify.example.com/#inquiry-id=inq_...&one-time-token=ovo_...`,
 * as `POST /api/v1/inquiries/:id/generate-one-time-link` builds it. The link travels in the
 * fragment, so no server sees it on the way. It reads links as `HttpUrl` did
 * (`OneTimeLinksParityTest`); the API is always the host's own base URL, never the link's origin.
 */
internal object OneTimeLinks {
    private const val INQUIRY_ID_PARAM = "inquiry-id"
    private const val ONE_TIME_TOKEN_PARAM = "one-time-token"
    private const val SESSION_TOKEN_PARAM = "session-token"

    /**
     * @param apiBaseUrl the API's base URL, compiled into the host app (C190.2, decision 65): the link
     *   supplies only the inquiry and its one-time token, never the server the SDK talks to, so its
     *   own origin is not read.
     * @throws IllegalArgumentException unless the fragment holds exactly one inquiry ID and one
     *   one-time token, and nothing else that grants access, and the API base URL is valid.
     *   Messages never contain the token.
     */
    fun parse(url: String, apiBaseUrl: String): OneTimeLinkParts {
        val link = requireNotNull(HttpUrlParts.parse(url.trim())) { "url must be an absolute http(s) link" }
        val fragment = requireNotNull(link.encodedFragment) { "url must carry the one-time link in its fragment" }
        // The fragment uses the query syntax: read it as one, up to a second '#'.
        val params = queryParameters(fragment.substringBefore('#'))
        val inquiryIds = params.filter { it.first == INQUIRY_ID_PARAM }
        val tokens = params.filter { it.first == ONE_TIME_TOKEN_PARAM }
        require(inquiryIds.size == 1 && tokens.size == 1) { "url must carry exactly one inquiry ID and one one-time token" }
        require(params.none { it.first == SESSION_TOKEN_PARAM }) { "url must not carry a session token as well" }

        val inquiryId = inquiryIds.single().second.orEmpty()
        val oneTimeToken = tokens.single().second.orEmpty()
        require(SessionCredentials.isInquiryId(inquiryId)) { "inquiryId must be an OpenVerify inquiry ID (inq_...)" }
        SessionCredentials.requireOneTimeToken(oneTimeToken)
        SessionCredentials.parseApiBaseUrl(apiBaseUrl)
        return OneTimeLinkParts(inquiryId, oneTimeToken, apiBaseUrl)
    }

    /** `name=value` pairs split at '&' and the first '=', percent-decoded with '+' as a space; a value is `null` without '='. */
    private fun queryParameters(query: String): List<Pair<String, String?>> = query.split('&').map { pair ->
        val equals = pair.indexOf('=')
        if (equals == -1) {
            percentDecode(pair, plusIsSpace = true) to null
        } else {
            percentDecode(pair, 0, equals, plusIsSpace = true) to percentDecode(pair, equals + 1, pair.length, plusIsSpace = true)
        }
    }
}

/** What a one-time link carries. [toString] never shows the token. */
internal class OneTimeLinkParts(val inquiryId: String, val oneTimeToken: String, val apiBaseUrl: String) {
    override fun toString(): String = "OneTimeLinkParts(inquiryId=$inquiryId, oneTimeToken=<redacted>, apiBaseUrl=$apiBaseUrl)"
}
