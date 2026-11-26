package dev.openverify.sdk.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine

/** The platform in the SDK's `User-Agent`, `OpenVerify-<platform>/<version>`: `Android` or `iOS`. */
internal expect val PLATFORM_NAME: String

/**
 * The HTTP client flow calls use unless a host app passes its own: one per process, from
 * [flowHttpClient] on the platform's engine (OkHttp on Android, NSURLSession on iOS).
 */
internal expect fun defaultFlowHttpClient(): HttpClient

/**
 * The Ktor client flow calls use on [engine]: every status comes back as a response, and no
 * redirect is followed, so a session token only ever goes to the API's origin. Nothing else is
 * installed: timeouts, TLS and connection pooling belong to the engine.
 */
internal fun flowHttpClient(engine: HttpClientEngine): HttpClient = HttpClient(engine) {
    expectSuccess = false
    followRedirects = false
}
