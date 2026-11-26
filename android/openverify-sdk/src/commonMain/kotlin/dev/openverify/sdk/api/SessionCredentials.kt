package dev.openverify.sdk.api

/** Format rules for what a host app passes to the SDK (contract C1). */
internal object SessionCredentials {
    /** `ovs_` plus 256 random bits in unpadded base64url. */
    private val SESSION_TOKEN = Regex("ovs_[A-Za-z0-9_-]{43}")

    /** `ovo_` plus 256 random bits in unpadded base64url (C9). */
    private val ONE_TIME_TOKEN = Regex("ovo_[A-Za-z0-9_-]{43}")

    /** `inq_` plus a ULID in upper-case Crockford base32. */
    private val INQUIRY_ID = Regex("inq_[0-9A-HJKMNP-TV-Z]{26}")

    fun isInquiryId(value: String): Boolean = INQUIRY_ID.matches(value)

    fun isSessionToken(value: String): Boolean = SESSION_TOKEN.matches(value)

    /** @throws IllegalArgumentException without echoing the value, which is a secret. */
    fun requireSessionToken(value: String) {
        require(isSessionToken(value)) { "sessionToken must be an OpenVerify session token (ovs_...)" }
    }

    fun isOneTimeToken(value: String): Boolean = ONE_TIME_TOKEN.matches(value)

    /** @throws IllegalArgumentException without echoing the value, which is a secret. */
    fun requireOneTimeToken(value: String) {
        require(isOneTimeToken(value)) { "oneTimeToken must be an OpenVerify one-time link token (ovo_...)" }
    }

    /**
     * Parses the API base URL strictly ([ApiBaseUrl]): absolute, no query, fragment or
     * credentials, an ASCII host, and https unless the host is a local development host.
     */
    fun parseApiBaseUrl(value: String): ApiBaseUrl = ApiBaseUrl.parse(value)
}
