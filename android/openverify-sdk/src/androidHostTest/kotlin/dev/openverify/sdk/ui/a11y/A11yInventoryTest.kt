package dev.openverify.sdk.ui.a11y

import dev.openverify.sdk.capture.barcode.BarcodeHint
import dev.openverify.sdk.capture.document.DocumentHint
import dev.openverify.sdk.capture.selfie.GuidanceMessage
import dev.openverify.sdk.capture.selfie.SelfieExtensionOutcome
import dev.openverify.sdk.flow.CryptoError
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpError
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.nfc.NfcAccessKind
import dev.openverify.sdk.nfc.NfcEntryError
import dev.openverify.sdk.nfc.NfcNotice
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.testing.GoldenOwner
import java.io.File
import java.lang.reflect.Modifier
import org.junit.Assert
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * C212.1, C212.2, C219.3 (Workflow 10D, android-a11y-audit): the inventory holds every state the
 * screens can show, each state has a golden (or shares, by name, the layout of a state that has
 * one), every golden on disk belongs to a state, and no test draws a golden without the
 * accessibility checks. So a later screen, state or golden cannot skip them. It runs under
 * Robolectric only because the inventory's synthetic photo is a real (grey) JPEG.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
internal class A11yInventoryTest {

    private fun assertEquals(expected: Any?, actual: Any?, what: String = "") = Assert.assertEquals(what, expected, actual)

    private fun assertTrue(condition: Boolean, what: String = "") = Assert.assertTrue(what, condition)

    private val screenshots = File("src/androidHostTest/screenshots")
    private val tests = File("src/androidHostTest/kotlin")
    private val states = A11yCatalog.STATES

    /** A state's goldens, its own or those of the state whose layout it shares. */
    private fun goldensOf(state: A11yState, seen: Set<String> = emptySet()): List<String> = when {
        state.goldens.isNotEmpty() -> state.goldens
        state.variantOf == null || state.name in seen -> emptyList()
        else -> states.firstOrNull { it.name == state.variantOf }?.let { goldensOf(it, seen + state.name) }.orEmpty()
    }

    @Test
    fun `every state has a name of its own`() {
        assertEquals(emptyList<String>(), states.groupBy { it.name }.filterValues { it.size > 1 }.keys.sorted())
        assertTrue(states.all { Regex("[a-z0-9]+(-[a-z0-9]+)*").matches(it.name) })
    }

    @Test
    fun `every state has a golden, or shares the layout of a state that has one`() {
        val without = states.filter { goldensOf(it).isEmpty() }.map { it.name }
        val both = states.filter { it.goldens.isNotEmpty() && it.variantOf != null }.map { it.name }
        val wrongScreen = states.filter { state -> state.variantOf != null && states.first { it.name == state.variantOf }.screen != state.screen && state.screen != A11yScreen.STATUS }.map { it.name }

        assertEquals(emptyList<String>(), without, "states with no golden")
        assertEquals(emptyList<String>(), both, "states that name both a golden and a state to share one with")
        assertEquals(emptyList<String>(), wrongScreen, "states that share a golden with another screen")
    }

    @Test
    fun `every golden a state names is on disk, and belongs to one state`() {
        val named = states.flatMap { state -> state.goldens.map { it to state.name } }
        val missing = named.filter { (golden, _) -> !File(screenshots, "$golden.png").isFile }.map { "${it.second}: ${it.first}" }
        val shared = named.groupBy({ it.first }, { it.second }).filterValues { it.size > 1 }.keys.sorted()

        assertEquals(emptyList<String>(), missing, "goldens that are not recorded")
        assertEquals(emptyList<String>(), shared, "goldens named by two states")
    }

    @Test
    fun `every golden on disk belongs to a state of the inventory`() {
        val onDisk = screenshots.walkTopDown().filter { it.isFile && it.extension == "png" }.map { it.relativeTo(screenshots).invariantSeparatorsPath.removeSuffix(".png") }.toSet()
        val named = states.flatMap { it.goldens }.toSet()

        // The screenshot task's own golden shows no SDK screen (`ScreenshotWiringTest`).
        assertEquals(setOf("foundation-10a/screenshot-wiring"), onDisk - named)
        assertTrue(onDisk.size >= 92, "the goldens were not found from ${screenshots.absolutePath}")
    }

    @Test
    fun `every golden folder has its owner, and the audit's own goldens are where the inventory says`() {
        val folders = screenshots.listFiles { file -> file.isDirectory }.orEmpty().map { it.name }.toSet()

        assertEquals(GoldenOwner.entries.map { it.folder }.toSet(), folders + GoldenOwner.entries.map { it.folder }.filter { !File(screenshots, it).exists() })
        assertTrue(states.flatMap { it.goldens }.all { golden -> GoldenOwner.entries.any { golden.startsWith("${it.folder}/") } })
    }

    @Test
    fun `no test draws a golden without the accessibility checks`() {
        val capture = Regex("""\b(captureRoboImage|captureScreenRoboImage|captureRoboGif|RoborazziRule|captureToImage)\b""")
        val direct = tests.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.name != "Goldens.kt" && it.name != "A11yInventoryTest.kt" }
            .filter { capture.containsMatchIn(it.readText()) }
            .map { it.relativeTo(tests).invariantSeparatorsPath }
            .toList()
        val goldens = File(tests, "dev/openverify/sdk/testing/Goldens.kt").readText()

        assertEquals(emptyList<String>(), direct, "tests that capture an image themselves")
        // The one capture is followed by the checks, in the one function every golden goes through.
        val verify = goldens.substringAfter("internal fun SemanticsNodeInteraction.verifyGolden").substringBefore("\n}\n")
        assertTrue(verify.indexOf("captureRoboImage(") in 0 until verify.indexOf("checkAccessibility()"), "verifyGolden no longer runs the checks after its capture")
        assertEquals(1, Regex("""captureRoboImage\(""").findAll(goldens).count())
    }

    // The audit's table ----------------------------------------------------------------------------

    /** The inventory as the audit document tables it: one row per state. */
    private fun table(): String = buildString {
        appendLine("| Screen | State | Goldens | Checks run | Result |")
        appendLine("|---|---|---|---|---|")
        states.forEach { state ->
            val goldens = if (state.goldens.isEmpty()) {
                "none of its own: the layout of `${state.variantOf}`"
            } else {
                "${state.goldens.size}: " + state.goldens.groupBy({ it.substringBefore('/') }, { it.substringAfter('/') }).entries.joinToString("; ") { (folder, names) -> "`$folder/` ${names.joinToString(", ")}" }
            }
            val checks = if (state.goldens.isEmpty()) "host sweep" else "host sweep; ATF on each golden"
            appendLine("| ${state.screen.title} | `${state.name}` | $goldens | $checks | pass |")
        }
    }.trimEnd()

    @Test
    fun `the newest Android audit tables the inventory as it is`() {
        val audits = File("../../docs/accessibility").listFiles { file -> Regex("""android-audit-\d{4}-\d{2}-\d{2}\.md""").matches(file.name) }.orEmpty().sortedBy { it.name }
        // What the document should hold, for whoever updates it (a build output, never the working tree).
        File("build/a11y").mkdirs()
        File("build/a11y/inventory-table.md").writeText(table() + "\n")
        assertTrue(audits.isNotEmpty(), "docs/accessibility holds no android-audit-<date>.md")
        val written = audits.last().readText().substringAfter("<!-- inventory:start -->").substringBefore("<!-- inventory:end -->").trim()

        assertEquals(table(), written, "the audit's inventory table (the expected one is in build/a11y/inventory-table.md)")
    }

    // Coverage: what the screens can show ---------------------------------------------------------

    /** Every enum value and every object reachable from [value]'s fields (the state's data classes). */
    private fun reachable(value: Any?, into: MutableSet<Any>, depth: Int = 0) {
        if (value == null || depth > 6) return
        when (value) {
            is Enum<*> -> into += value
            is Iterable<*> -> value.forEach { reachable(it, into, depth + 1) }
            is Map<*, *> -> value.forEach { (key, item) -> reachable(key, into, depth + 1); reachable(item, into, depth + 1) }
            else -> if (value.javaClass.name.startsWith("dev.openverify.sdk.")) {
                into += value.javaClass
                value.javaClass.declaredFields.filter { !Modifier.isStatic(it.modifiers) }.forEach { field ->
                    field.isAccessible = true
                    reachable(field.get(value), into, depth + 1)
                }
            }
        }
    }

    private val shown: Set<Any> by lazy {
        buildSet {
            states.forEach { state ->
                reachable(state.flowState, this)
                state.shows.forEach { reachable(it, this) }
            }
        }
    }

    private fun permitted(type: Class<*>): List<Class<*>> = checkNotNull(type.permittedSubclasses) { "${type.name} is not sealed for the JVM" }.toList()

    @Test
    fun `every flow state and every NFC view has a state in the inventory`() {
        val flowStates = permitted(FlowState::class.java)
        val views = permitted(NfcView::class.java)

        assertTrue(flowStates.size >= 21 && views.size >= 6, "the sealed types were not read: ${flowStates.size}, ${views.size}")
        assertEquals(emptyList<String>(), (flowStates + views).filter { it !in shown }.map { it.simpleName })
    }

    @Test
    fun `every message, phase, notice and error the screens can show has a state in the inventory`() {
        val values: List<Enum<*>> = listOf(
            FlowError.entries, SessionEndReason.entries, OtpChannel.entries, OtpError.entries, DocumentError.entries, CryptoError.entries,
            NfcAccessKind.entries, NfcEntryError.entries, NfcPhase.entries, NfcNotice.entries, NfcUnable.entries,
            DocumentHint.entries, BarcodeHint.entries, GuidanceMessage.entries, SelfieExtensionOutcome.entries,
        ).flatten()

        assertEquals(emptyList<String>(), values.filter { it !in shown }.map { "${it.javaClass.simpleName}.${it.name}" })
    }

    @Test
    fun `every state is listed under the screen its flow state belongs to`() {
        val guidance = setOf(A11yScreen.CHROME, A11yScreen.DOCUMENT_GUIDANCE, A11yScreen.BARCODE_GUIDANCE, A11yScreen.SELFIE_GUIDANCE)
        val misplaced = states
            .filter { it.screen !in guidance }
            .mapNotNull { state -> state.flowState?.let { flow -> state.name.takeIf { A11yCatalog.screenOf(flow) != state.screen } } }

        assertEquals(emptyList<String>(), misplaced)
        assertEquals(emptyList<String>(), A11yScreen.entries.filter { screen -> states.none { it.screen == screen } }.map { it.name })
    }
}
