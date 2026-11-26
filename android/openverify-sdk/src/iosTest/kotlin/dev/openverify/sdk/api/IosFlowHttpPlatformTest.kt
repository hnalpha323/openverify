package dev.openverify.sdk.api

import io.ktor.client.engine.darwin.DarwinClientEngineConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertSame

/** The iOS side of the flow HTTP seam. Compiled on Linux; it runs on the simulator from Phase 10 (K8). */
class IosFlowHttpPlatformTest {

    @Test
    fun theUserAgentNamesIos() {
        assertEquals("iOS", PLATFORM_NAME)
    }

    @Test
    fun theDefaultClientIsOneClientOnTheDarwinEngine() {
        val client = defaultFlowHttpClient()

        assertSame(client, defaultFlowHttpClient())
        assertIs<DarwinClientEngineConfig>(client.engine.config)
    }
}
