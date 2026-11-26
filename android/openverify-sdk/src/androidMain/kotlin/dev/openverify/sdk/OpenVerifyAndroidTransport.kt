package dev.openverify.sdk

import dev.openverify.sdk.api.okHttpFlowClient
import io.ktor.client.HttpClient
import okhttp3.OkHttpClient

/**
 * Makes a [FlowTransport] from your own OkHttp client (C191.1, C213.4; review P11), so the flow
 * uses your certificate pinner, timeouts and proxy. The SDK derives its own client from yours
 * (`newBuilder()`) with redirects forced off. Your interceptors run on every flow request, which
 * carries the session token, images and chip files, so install no logging interceptor on it.
 * OkHttp is therefore part of the SDK's public API (C214.4).
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(transport = OpenVerifyAndroidTransport.okHttp(myClient)))
 * ```
 */
public object OpenVerifyAndroidTransport {
    /** A transport over [client], with redirects off. */
    public fun okHttp(client: OkHttpClient): FlowTransport = OkHttpFlowTransport(client)
}

/**
 * The Android [FlowTransport] over the host's [hostClient] (C191.1): the flow's [client] is derived
 * from it with `newBuilder()`, which shares its connection pool and dispatcher and keeps its
 * certificate pinner, timeouts, proxy and interceptors, with redirects forced off. The host's own
 * client is left as it was.
 */
internal class OkHttpFlowTransport(hostClient: OkHttpClient) : FlowTransport() {
    /** The client the flow uses: the host's, following no redirect. */
    val client: OkHttpClient = hostClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    /** The Ktor client over [client], made once per transport. */
    val httpClient: HttpClient by lazy { okHttpFlowClient(client) }
}
