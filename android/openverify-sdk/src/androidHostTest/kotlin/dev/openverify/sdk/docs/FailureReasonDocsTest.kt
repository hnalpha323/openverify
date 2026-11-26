package dev.openverify.sdk.docs

import dev.openverify.sdk.FailureReason
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C190.4: the published table of failure reasons. `docs/android/failure-reasons.md` holds one row
 * per [FailureReason] with what happened and what the host should do, and the SDK README's
 * "Failure reasons" section names every reason once, grouped by what the host should do, so a new
 * reason cannot ship without both.
 */
internal class FailureReasonDocsTest {

    private val reasons = FailureReason.entries.map { it.name }

    @Test
    fun `the failure-reason page has one row for each reason, in the enum's order`() {
        val rows = File("../../docs/android/failure-reasons.md").readLines().mapNotNull { ROW.find(it)?.groupValues?.get(1) }
        assertEquals(reasons, rows)
    }

    @Test
    fun `the README's failure-reason section names every reason once and links the page`() {
        val readme = File("README.md").readText()
        val section = readme.substringAfter("## Failure reasons", "").substringBefore("\n## ")
        val named = section.lines().filter { it.startsWith("|") }.flatMap { line -> CODE.findAll(line.split("|")[1]).map { it.groupValues[1] } }
        assertEquals(reasons.sorted(), named.sorted())
        assertEquals(true, "docs/android/failure-reasons.md" in section, "the section links the full table")
    }

    private companion object {
        /** A table row whose first cell is one reason in code type. */
        val ROW = Regex("""^\| `([A-Z_]+)` \|""")
        val CODE = Regex("`([A-Z_]+)`")
    }
}
