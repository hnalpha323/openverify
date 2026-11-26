package dev.openverify.sdk.integrity

/**
 * Gives an integrity token for the server to decode and judge (C211.2). The SDK calls it only
 * after consent, when the session asks for one, with the request hash the server computed. A
 * `null` answer or a thrown exception sends nothing, and the integrity signals read `null`.
 * OpenVerify ships no Google code (Phase 10 P3): a host that wants Play Integrity implements this
 * with its own dependency, as the README's recipe shows.
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(integrityTokenProvider = object : IntegrityTokenProvider {
 *     override suspend fun token(requestHash: String): String? = myTokenFor(requestHash)
 * }))
 * ```
 */
public interface IntegrityTokenProvider {
    /** A token bound to [requestHash], or `null` when there is none. */
    public suspend fun token(requestHash: String): String?
}
