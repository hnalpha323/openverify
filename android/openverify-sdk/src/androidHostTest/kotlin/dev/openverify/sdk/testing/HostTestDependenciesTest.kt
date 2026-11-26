package dev.openverify.sdk.testing

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Workflow 11A Stage 1a (C) (C256.2, C258.3; KP11-1): the SDK's host tests can build certificates with
 * `okhttp-tls`'s `HeldCertificate` (the pinning recipe's host test over a TLS `MockWebServer`), and the
 * artifact stays in the host-test scope only: it is never on a classpath the published SDK declares.
 * The artifact is the one 10C pinned for the demo's device tests (the catalog's `okhttp-tls`, at the
 * okhttp version), not a new version.
 */
internal class HostTestDependenciesTest {

    @Test
    fun `the host tests can build a held certificate with okhttp-tls`() {
        val held = Class.forName("okhttp3.tls.HeldCertificate")
        assertEquals("okhttp3.tls.HeldCertificate", held.name)
    }

    @Test
    fun `okhttp-tls is locked for the host tests only, at the okhttp version`() {
        val lines = File("gradle.lockfile").readLines()
        val okhttp = lines.single { it.startsWith("com.squareup.okhttp3:okhttp:") }.substringBefore('=')
        val tls = lines.singleOrNull { it.startsWith("com.squareup.okhttp3:okhttp-tls:") }
            ?: error("okhttp-tls is not in the SDK's lockfile")
        assertEquals(okhttp.substringAfterLast(':'), tls.substringBefore('=').substringAfterLast(':'))
        val configurations = tls.substringAfter('=').split(',')
        assertTrue(configurations.isNotEmpty())
        val outsideHostTests = configurations.filterNot {
            it.startsWith("androidHostTest") || it == "allTestSourceSetsCompileDependenciesMetadata"
        }
        assertEquals(emptyList<String>(), outsideHostTests)
    }
}
