package dev.openverify.sdk.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin

internal actual val PLATFORM_NAME: String = "iOS"

/**
 * One client on Ktor's Darwin engine (NSURLSession), which brings the system's TLS, App
 * Transport Security and proxies. Its delegate refuses every native redirect, and
 * [flowHttpClient] follows none. It keeps NSURLSession's default 60 seconds without data;
 * Android's OkHttp client allows 15 to connect, 30 between reads and 60 between writes.
 * Compiled on Linux, run on the iOS simulator from Phase 10.
 */
private val sharedFlowHttpClient: HttpClient by lazy { flowHttpClient(Darwin.create()) }

internal actual fun defaultFlowHttpClient(): HttpClient = sharedFlowHttpClient
