package dev.openverify.sdk

import okhttp3.CertificatePinner
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

/**
 * C191.1 (C213.4; review P11): `OpenVerifyAndroidTransport.okHttp` derives the flow's client from
 * the host's (`newBuilder()`): redirects forced off, so a session token only ever goes to the API's
 * origin, and the host's certificate pinner, timeouts, proxy and interceptors kept. The host's own
 * client is left as it was.
 */
internal class OpenVerifyAndroidTransportTest {

    private val pinner = CertificatePinner.Builder()
        .add("api.example.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        .build()
    private val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved("proxy.example.com", 3128))
    private val interceptor = Interceptor { chain -> chain.proceed(chain.request()) }

    private val host: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .certificatePinner(pinner)
        .connectTimeout(7, TimeUnit.SECONDS)
        .readTimeout(11, TimeUnit.SECONDS)
        .writeTimeout(13, TimeUnit.SECONDS)
        .callTimeout(17, TimeUnit.SECONDS)
        .proxy(proxy)
        .addInterceptor(interceptor)
        .build()

    private val derived: OkHttpClient = (OpenVerifyAndroidTransport.okHttp(host) as OkHttpFlowTransport).client

    @Test
    fun `the derived client follows no redirect, plain or to https`() {
        assertFalse(derived.followRedirects)
        assertFalse(derived.followSslRedirects)
    }

    @Test
    fun `the derived client keeps the host's pinner, timeouts, proxy and interceptors`() {
        assertEquals(pinner.pins, derived.certificatePinner.pins)
        assertEquals(listOf(7_000, 11_000, 13_000, 17_000), listOf(derived.connectTimeoutMillis, derived.readTimeoutMillis, derived.writeTimeoutMillis, derived.callTimeoutMillis))
        assertEquals(proxy, derived.proxy)
        assertEquals(listOf(interceptor), derived.interceptors)
    }

    @Test
    fun `the host's own client is left as it was`() {
        assertTrue(host.followRedirects)
        assertTrue(host.followSslRedirects)
    }

    @Test
    fun `the derived client shares the host's connection pool and dispatcher`() {
        assertTrue(derived.connectionPool === host.connectionPool)
        assertTrue(derived.dispatcher === host.dispatcher)
    }
}
