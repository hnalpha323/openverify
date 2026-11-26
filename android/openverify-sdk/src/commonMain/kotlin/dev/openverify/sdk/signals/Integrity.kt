package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.ServerPosition
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.FlowSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * C211.3 (Workflow 10B): the SDK's half of Play Integrity. When the session asks for a token
 * (`integrity { request: true }`), it takes a challenge from the server, asks the host's
 * [IntegrityTokenProvider] for a token bound to the challenge's request hash, and posts the token;
 * every failure sends nothing (C211.2). The coordinator calls [requestIntegrityVerdict] after consent
 * and on a consented load, beside the flow as it sends the signals: a child of the calling action,
 * never awaited, its failure swallowed (foundation-10b's hook in `FlowCoordinator`).
 *
 * This file is `device-integrity-android`'s.
 */
internal fun interface IntegrityVerdictRequest {
    suspend fun requestIntegrityVerdict(session: FlowSession)

    companion object {
        /** Requests nothing: the coordinator's default. */
        val None: IntegrityVerdictRequest = IntegrityVerdictRequest { }
    }
}

/**
 * The request a launch installs in its coordinator: [api] is the flow's own client, [provider] what the
 * host installed (`OpenVerifyComponents.integrityTokenProvider`). Without a provider it is
 * [IntegrityVerdictRequest.None]: nothing is asked of the server either (C211.1).
 */
internal fun integrityVerdictRequest(api: FlowApi, provider: IntegrityTokenProvider?): IntegrityVerdictRequest =
    if (provider == null) IntegrityVerdictRequest.None else ProviderVerdictRequest(api, provider)

/**
 * C211.3: at most one request per launch of an inquiry (decision 34: the default Cloud quota is 10,000 a
 * day), only once the session has consent, asks for a token and is not decided:
 * 1. `POST /api/v1/flow/integrity-challenges`, whose `request-hash` the server computed;
 * 2. the host's `token(requestHash)`: `null`, an exception or a token outside the contract sends nothing;
 * 3. `POST /api/v1/flow/integrity-tokens` with the challenge's id and the token.
 *
 * Any failure sends nothing more and is never retried, so the integrity signals read `null` on the
 * server. A 409 `integrity_challenge_invalid` (the token's first post may have landed and its answer been
 * lost, so the client's retry found the challenge used; C193.5, review P26) is answered by reading the
 * session once, never by a second challenge; the request shows nothing, and the position stays the
 * coordinator's to render. Neither the hash nor the token is kept or logged (C211.4, rule 11).
 */
internal class ProviderVerdictRequest(
    private val api: FlowApi,
    private val provider: IntegrityTokenProvider,
) : IntegrityVerdictRequest {

    private val once = Mutex()
    private var started = false

    override suspend fun requestIntegrityVerdict(session: FlowSession) {
        if (!asks(session)) return
        once.withLock {
            if (started) return
            started = true
        }
        val challenge = attempt { api.createIntegrityChallenge() } ?: run {
            SdkLog.log("integrity.challenge_failed")
            return
        }
        if (!IntegrityRequests.CHALLENGE_ID.matches(challenge.id) || !IntegrityRequests.REQUEST_HASH.matches(challenge.requestHash)) {
            SdkLog.log("integrity.challenge_refused")
            return
        }
        val token = attempt { provider.token(challenge.requestHash) }
        if (token == null || token.length !in 1..IntegrityRequests.TOKEN_MAX_LENGTH) {
            SdkLog.log("integrity.token_unavailable")
            return
        }
        try {
            api.sendIntegrityToken(challenge.id, token)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (conflict: FlowApiException.Conflict) {
            if (conflict.problem?.code != FlowProblemCodes.INTEGRITY_CHALLENGE_INVALID) {
                SdkLog.log("integrity.token_failed")
                return
            }
            SdkLog.log("integrity.challenge_invalid")
            attempt { api.getSession() }
        } catch (_: Exception) {
            SdkLog.log("integrity.token_failed")
        }
    }

    /** Whether [session] asks for a token now: consented, asking, and not decided. */
    private fun asks(session: FlowSession): Boolean =
        session.integrity?.request == true && session.consent != null && ServerPosition.decided(session) == null

    /** [block]'s answer, or `null` when it throws an exception; a cancellation goes on. */
    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        block()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        null
    }
}
