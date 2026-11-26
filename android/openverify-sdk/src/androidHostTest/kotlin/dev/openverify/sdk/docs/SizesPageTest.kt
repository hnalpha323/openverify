package dev.openverify.sdk.docs

import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Locale

/**
 * C216.3 (review H18): `docs/android/sizes.md` publishes only the configurations whose artifacts
 * exist in full, each figure as measured. The measured figures are `android/size-baseline.json`
 * (release-checks' `check-size.py` writes and compares it), so this test holds the page to that
 * file: the same configurations, the same ABIs, and each figure to a tenth of a megabyte
 * (10^6 bytes). A configuration added to the baseline, or a figure that moved by a tenth, fails
 * here until the page says so; a table for an artifact that does not exist fails too.
 */
internal class SizesPageTest {

    private val page: String = File("../../docs/android/sizes.md").takeIf { it.exists() }?.readText().orEmpty()

    @Test
    fun `the sizes page shows exactly the baseline's configurations and ABIs, each figure to a tenth of a megabyte`() {
        val baseline = OpenVerifyJson.parseToJsonElement(File("../size-baseline.json").readText()) as JsonObject
        val expected = (baseline.getValue("configurations") as JsonObject).mapValues { (_, configuration) ->
            ((configuration as JsonObject).getValue("abis") as JsonObject).mapValues { (_, abi) ->
                listOf("download_bytes", "install_bytes").map { megabytes(((abi as JsonObject).getValue(it) as JsonPrimitive).content.toLong()) }
            }
        }
        assertEquals(expected, published())
    }

    @Test
    fun `no configuration is labelled as without the reader, now that openverify-nfc holds it (Workflow 10E)`() {
        val headings = page.lines().filter { it.startsWith("### `") }
        assertEquals(4, headings.size) { "sdk, sdk,nfc, sdk,face and sdk,nfc,face: $headings" }
        assertTrue("reader" in headings.first { it.startsWith("### `sdk,nfc`:") })
        assertTrue("without the reader" !in page) { "the page still says the module holds no reader" }
    }

    @Test
    fun `ONNX Runtime's cost is the measured one, and the unmeasured custom build is called unmeasured`() {
        assertTrue("about 34 MB" !in page) { "the estimate is replaced by what bundletool measured (C216.3)" }
        assertTrue("libonnxruntime.so" in page && "34.2 MB uncompressed" in page)
        assertTrue("custom build" in page.lowercase() && "**not been measured**" in page) { "the custom ONNX Runtime build was not measured, and the page says so" }
        assertTrue("absolute cap" in page)
    }

    /** The page's tables: under each `### `<configuration>`` heading, a row per ABI with its download and install figures. */
    private fun published(): Map<String, Map<String, List<String>>> {
        val tables = linkedMapOf<String, MutableMap<String, List<String>>>()
        var current: MutableMap<String, List<String>>? = null
        page.lines().forEach { line ->
            when {
                line.startsWith("#") -> current = HEADING.find(line)?.let { tables.getOrPut(it.groupValues[1]) { linkedMapOf() } }
                else -> ROW.find(line)?.let { row -> current?.put(row.groupValues[1], listOf(row.groupValues[2], row.groupValues[3])) }
            }
        }
        return tables
    }

    private companion object {
        val HEADING = Regex("""^### `([a-z,]+)`""")
        val ROW = Regex("""^\| `([a-z0-9_-]+)` \| ([0-9.]+) MB \| ([0-9.]+) MB \|""")

        fun megabytes(bytes: Long): String = String.format(Locale.ROOT, "%.1f", bytes / 1_000_000.0)
    }
}
