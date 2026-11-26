package dev.openverify.sdk.signals

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C211.3 (Workflow 10B): `FlowApiClient` sends the two integrity calls through `signals/IntegrityRequests.kt`
 * over its own HTTP client (wired by integration-10b; the no-argument stubs are gone), and only the
 * integrity request calls them.
 */
internal class IntegrityRequestsStubTest {

    @Test
    fun `only the integrity request calls the integrity routes, beside their declarations and delegations`() {
        val allowed = setOf("api/FlowApi.kt", "api/FlowApiClient.kt", "api/OneTimeLinkFlowApi.kt", "signals/IntegrityRequests.kt", "signals/Integrity.kt")
        val callers = File("src").walkTopDown()
            .filter { it.isFile && it.extension == "kt" && ("/commonMain/" in it.path || "/androidMain/" in it.path) }
            .filter { file -> file.readText().let { "createIntegrityChallenge(" in it || "sendIntegrityToken(" in it } }
            .map { it.path.substringAfter("/dev/openverify/sdk/") }
            .filterNot { it in allowed }
            .toList()
        assertEquals(emptyList<String>(), callers)
    }
}
