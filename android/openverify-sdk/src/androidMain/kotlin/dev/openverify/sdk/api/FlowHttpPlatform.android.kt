// Java sees the OkHttpClient factories below as FlowApiClients.FlowApiClient(...).
@file:JvmName("FlowApiClients")

package dev.openverify.sdk.api

import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

internal actual val PLATFORM_NAME: String = "Android"

/** One OkHttp client for every flow: OkHttp clients are meant to be shared. */
internal val sharedOkHttpClient: OkHttpClient by lazy {
    OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // Uploads are up to 10 MiB, which can be slow on mobile networks.
        .writeTimeout(60, TimeUnit.SECONDS)
        // A session token only ever goes to the API's origin.
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
}

private val sharedFlowHttpClient: HttpClient by lazy { okHttpFlowClient(sharedOkHttpClient) }

/** Ktor's OkHttp engine over [sharedOkHttpClient]. */
internal actual fun defaultFlowHttpClient(): HttpClient = sharedFlowHttpClient

/**
 * A flow client on Ktor's OkHttp engine over [okHttpClient], which keeps its connection pool,
 * dispatcher, timeouts, TLS settings and listeners. It never follows a redirect, whatever the
 * OkHttp client would do.
 */
internal fun okHttpFlowClient(okHttpClient: OkHttpClient): HttpClient = flowHttpClient(
    OkHttp.create {
        preconfigured = okHttpClient
        config {
            followRedirects(false)
            followSslRedirects(false)
            // Ktor's engine turns this on; the OkHttp client's own choice stands.
            retryOnConnectionFailure(okHttpClient.retryOnConnectionFailure)
        }
    },
)

/**
 * A [FlowApiClient] on your own [httpClient], to share its connection pool. Its redirect settings
 * are overridden: no flow call follows a redirect.
 *
 * @throws IllegalArgumentException as the [FlowApiClient] constructor does.
 */
internal fun FlowApiClient(
    apiBaseUrl: String,
    sessionToken: String,
    httpClient: OkHttpClient,
    json: Json = OpenVerifyJson,
): FlowApiClient = FlowApiClient(apiBaseUrl, sessionToken, okHttpFlowClient(httpClient), json)

/** A [OneTimeLinkClient] on your own [httpClient], as [FlowApiClient] takes one. */
internal fun OneTimeLinkClient(apiBaseUrl: String, httpClient: OkHttpClient, json: Json = OpenVerifyJson): OneTimeLinkClient =
    OneTimeLinkClient(apiBaseUrl, okHttpFlowClient(httpClient), json)
