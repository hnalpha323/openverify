package dev.openverify.sdk.consent

import java.io.File
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * KP11-79 (Workflow 11E docs-records 7, the Kotlin half of KP11-73): the consent evidence's
 * documentation says what the server does with a consent that carries no digests. No column stores
 * a client's `text-sha256`, `copy-source` or `catalog-version`: the server checks the digests it is
 * sent against the texts it stored and keeps none of them, so "recorded with `text-sha256: null`"
 * describes a column that does not exist (`recordInquirySessionConsent`,
 * `packages/db/src/repositories/inquiry-sessions.ts`).
 */
internal class ConsentDigestsRecordTest {

    private val source = File("src/commonMain/kotlin/dev/openverify/sdk/consent/ConsentDigests.kt").readText()

    @Test
    fun `the evidence's documentation names no stored null digest (KP11-79)`() {
        assertTrue(source.contains("internal data class ConsentEvidence"), "the test does not read ConsentDigests.kt")
        assertFalse(Regex("""record(s|ed)?\s+(such a consent\s+)?with\s+`?text-sha256:\s*null""").containsMatchIn(source.replace(Regex("""\s+\*\s+"""), " ")))
        assertTrue(source.replace(Regex("""\s+\*\s+"""), " ").contains("stores none of them"), "the documentation does not say the server stores no digest")
    }
}
