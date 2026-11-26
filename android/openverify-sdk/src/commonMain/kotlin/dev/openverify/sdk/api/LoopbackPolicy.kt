package dev.openverify.sdk.api

/**
 * C190.2 (decision 65; review V01): whether the SDK may talk to the API over plain `http`.
 * [ApiBaseUrl] accepts `http` only for `localhost`, `127.0.0.1`, `::1` and `10.0.2.2`, and on a real
 * phone `10.0.2.2` is an ordinary private address, so the SDK connects over plain `http` only when
 * this seam allows it: on Android, in a debuggable host app or under the SDK's own internal test
 * override; on iOS, never. `https` is always allowed.
 */
internal expect fun loopbackHttpAllowed(): Boolean

/** Applies [loopbackHttpAllowed] to an API base URL before the SDK connects to it (C190.2). */
internal object LoopbackPolicy {
    /**
     * Whether the SDK may connect to [apiBaseUrl], a URL [ApiBaseUrl] accepts: always over `https`,
     * over plain `http` (which [ApiBaseUrl] accepts for the loopback hosts only) when
     * [loopbackHttpAllowed].
     *
     * @throws IllegalArgumentException as [ApiBaseUrl.parse] does.
     */
    fun allows(apiBaseUrl: String): Boolean = ApiBaseUrl.parse(apiBaseUrl).scheme == "https" || loopbackHttpAllowed()
}
