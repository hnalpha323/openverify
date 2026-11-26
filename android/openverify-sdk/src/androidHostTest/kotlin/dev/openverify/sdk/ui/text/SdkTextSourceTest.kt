package dev.openverify.sdk.ui.text

import dev.openverify.sdk.privacy.SdkModule
import dev.openverify.sdk.privacy.SourceScan
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C212.2 (review H19): every text the SDK draws goes through its one text composable
 * (`ui/text/SdkText.kt`), which records whether the text was cut off. No other main source of a
 * shipped module may import Material's or the foundation's text composables; a text field's label
 * and value are the field's own and are not read here.
 */
internal class SdkTextSourceTest {

    private val wrapper = "ui/text/SdkText.kt"
    private val direct = Regex("""^import androidx\.compose\.(material3\.(Text|\*)|material\.(Text|\*)|foundation\.text\.(BasicText|\*))\s*$""", RegexOption.MULTILINE)
    private val qualified = Regex("""androidx\.compose\.(material3|material)\.Text\(|foundation\.text\.BasicText\(""")

    private val sources: List<Pair<String, String>> = SdkModule.SHIPPED.flatMap(SourceScan::sourcesOf)

    @Test
    fun `no shipped source but the SDK's text composable draws a text directly (C212_2)`() {
        val offenders = sources
            .filter { (path, _) -> !path.endsWith(wrapper) }
            .filter { (_, text) -> SourceScan.code(text).let { direct.containsMatchIn(it) || qualified.containsMatchIn(it) } }
            .map { it.first }
            .sorted()

        assertEquals(emptyList<String>(), offenders)
    }

    @Test
    fun `the scan reads the SDK's sources and would see a direct import`() {
        assertTrue(sources.any { it.first.endsWith(wrapper) }, "the scan does not read $wrapper")
        assertTrue(direct.containsMatchIn("import androidx.compose.material3.Text\n"))
        assertTrue(direct.containsMatchIn("import androidx.compose.material3.*\n"))
        assertTrue(qualified.containsMatchIn("androidx.compose.material3.Text(\"a\")"))
    }
}
