package dev.openverify.sdk.flow

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * K10A-1 (Workflow 10A Stage 3 amendment 3; done in Workflow 10E): the server-position driver never
 * produced `FlowState.Finalizing` (a failed last attempt is the server's `failed` position, read from
 * the session), so the state, its screen, its mappings and its two strings are removed. This test
 * keeps them from coming back as dead code: a state nothing produces is a screen no test of the flow
 * can reach, and an accessibility inventory row that audits nothing.
 */
internal class DeadStatesSourceTest {

    private val productionRoots = listOf("src/commonMain/kotlin", "src/androidMain/kotlin", "src/iosMain/kotlin")

    private fun productionSources(): List<File> =
        productionRoots.map(::File).filter { it.isDirectory }.flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }

    @Test
    fun `no production source names the finalizing state or its screen`() {
        val sources = productionSources()
        assertTrue(sources.size > 50, "the production sources were read: ${sources.size}")

        val naming = sources.filter { file -> REMOVED.any { it in file.readText() } }.map { it.invariantSeparatorsPath }.sorted()

        assertEquals(emptyList<String>(), naming)
    }

    @Test
    fun `no string and no review row is left for the removed screen`() {
        val resources = File("src/commonMain/composeResources").walkTopDown().filter { it.isFile && it.extension == "xml" }.toList()
        assertTrue(resources.size >= 5, "the string resources were read: ${resources.size}")

        val holding = (resources + File("i18n/review-status.json")).filter { "openverify_finalizing_" in it.readText() }.map { it.invariantSeparatorsPath }.sorted()

        assertEquals(emptyList<String>(), holding)
    }

    private companion object {
        val REMOVED = listOf("Finalizing", "openverify_finalizing_")
    }
}
