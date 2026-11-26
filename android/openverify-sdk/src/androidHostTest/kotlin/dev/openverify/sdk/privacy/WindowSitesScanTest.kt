package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.1 (review P19): where the SDK's sources make a window. No source turns the secure flag off or
 * builds a platform dialog, popup or toast (those do not inherit the activity's `FLAG_SECURE`), and
 * every Compose call that opens a window is a row of [PrivacyScreens.ALL], which
 * `WindowSecureFlagTest` opens through the real activity. A new dialog, menu, sheet or tooltip fails
 * here until its row is written.
 */
internal class WindowSitesScanTest {

    @Test
    fun `no source turns the secure flag off or builds a platform window`() {
        val found = SdkModule.SHIPPED.flatMap { module ->
            module.mainRoots.map(::File).filter { it.isDirectory }.flatMap { root ->
                root.walkTopDown().filter { it.isFile && it.extension == "kt" }.flatMap { file ->
                    // Imports are read too: a platform builder is named by its import.
                    val text = SourceScan.code(file.readText())
                    REFUSED.filter { it.containsMatchIn(text) }.map { "${file.invariantSeparatorsPath}: ${it.pattern}" }
                }.toList()
            }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `every call that opens a window is a row the secure-flag test opens`() {
        val inSources = SourceScan.sources.filterNot { (path, _) -> PrivacyScreens.pending(path) }.flatMap { (path, text) ->
            SourceScan.calls(text, WINDOW_COMPOSABLES).groupBy { it.name }.flatMap { (name, calls) -> calls.indices.map { "$path#$name#${it + 1}" } }
        }.toSet()

        val inTable = WindowRow.ALL.map { row ->
            when (val entry = row.entry) {
                is PrivacyEntry.Dialog -> entry.site
                is PrivacyEntry.Menu -> entry.site
                else -> error("not a window: $entry")
            }
        }.toSet() + PrivacyScreens.SELECTOR_MENU

        assertEquals(inSources.sorted(), inTable.sorted())
    }

    @Test
    fun `the scan sees a window call and not its declaration`() {
        val text = """
            internal fun Selector(label: String) { DropdownMenu(expanded = open, onDismissRequest = { open = false }) { } }
            fun Screen() { Selector(label = "(") ; state.Dialog(1) }
        """.trimIndent()

        assertEquals(listOf("DropdownMenu", "Selector"), SourceScan.calls(text, WINDOW_COMPOSABLES).map { it.name })
        assertEquals("label = \"(\"", SourceScan.calls(text, "Selector").single().arguments)
    }

    private companion object {
        /** What C213.1 refuses: the policy that drops the flag, and the platform's window builders. */
        val REFUSED = listOf(
            """SecureFlagPolicy\.SecureOff""",
            """\bSecureOff\b""",
            """android\.app\.(AlertDialog|Dialog|DatePickerDialog|TimePickerDialog|ProgressDialog|DialogFragment)\b""",
            """androidx\.appcompat\.app\.(AlertDialog|AppCompatDialog)""",
            """androidx\.fragment\.app\.DialogFragment""",
            """com\.google\.android\.material\.(bottomsheet|dialog|snackbar|datepicker|timepicker)""",
            """android\.widget\.(PopupWindow|PopupMenu|Toast|ListPopupWindow)\b""",
            """\bAlertDialog\.Builder\b""",
            """\bMaterialAlertDialogBuilder\b""",
            """\bToast\.makeText\b""",
            """\bPopupWindow\s*\(""",
            """\bFLAG_SECURE\.inv\(\)|clearFlags\([^)]*FLAG_SECURE""",
            """\bTYPE_APPLICATION_OVERLAY\b|\bWindowManager\b.*\.addView\(""",
        ).map(::Regex)

        /**
         * The Compose calls that put their content in a window of its own (Material 3 and
         * `androidx.compose.ui.window`), and the SDK's own `Selector`, whose menu is one.
         */
        const val WINDOW_COMPOSABLES =
            "Dialog|AlertDialog|BasicAlertDialog|DatePickerDialog|TimePickerDialog|Popup|DropdownMenu|ExposedDropdownMenu|ExposedDropdownMenuBox|" +
                "ModalBottomSheet|TooltipBox|PlainTooltip|RichTooltip|Selector"
    }
}
