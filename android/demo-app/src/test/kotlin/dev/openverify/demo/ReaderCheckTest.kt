package dev.openverify.demo

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.model.FileKind
import kotlinx.coroutines.awaitCancellation
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.net.URL

/**
 * C209.6 (decision 48; review H09): the demo's reader check, a debug-only screen on which the owner
 * reads a real document with the installed chip reader. It exists only in a debug build that
 * includes openverify-nfc; it shows pass or fail per protocol and file and never a value of the chip;
 * it calls no server, writes no file and drops what was read at once.
 *
 * The gate runs this once per configuration (`sdk`, `sdk,nfc`, `sdk,face`, `sdk,nfc,face`), and each
 * case asserts what its configuration holds: the screen's behaviour in a build with `nfc`, and that
 * there is no such screen in a build without. The class is named by text because it is compiled only
 * with `nfc`. Everything here is synthetic.
 */
@OptIn(ExperimentalOpenVerifyApi::class)
@RunWith(RobolectricTestRunner::class)
class ReaderCheckTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val included = "nfc" in DemoArtifacts.included
    private val systemProxies: ProxySelector? = ProxySelector.getDefault()

    @After
    fun reset() {
        ProxySelector.setDefault(systemProxies)
        EventLog.shared.clear()
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    /** A chip reader that returns what a real one would, with a canary in every byte array, and remembers what it handed out. */
    private class FakeReader(private val failure: ChipReadFailure? = null, private val never: Boolean = false) : ChipReader {
        val accesses = mutableListOf<ChipAccess>()
        val challenges = mutableListOf<Int>()
        val handedOut = mutableListOf<ByteArray>()
        var stopped = false

        override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
            accesses += access
            challenges += challenge.size
            progress(ChipProgress.WaitingForDocument)
            if (never) {
                try {
                    awaitCancellation()
                } finally {
                    stopped = true
                }
            }
            progress(ChipProgress.Connected)
            progress(ChipProgress.Reading(FileKind.CHIP_SOD, 0))
            progress(ChipProgress.Reading(FileKind.CHIP_SOD, 100))
            progress(ChipProgress.Reading(FileKind.CHIP_DG1, 0))
            progress(ChipProgress.Reading(FileKind.CHIP_DG1, 40))
            if (failure != null) throw ChipReadException(failure)
            progress(ChipProgress.Authenticating)
            progress(ChipProgress.Done)
            val files = listOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_DG15).associateWith { CANARY.toByteArray() }
            val response = CANARY.toByteArray()
            handedOut += files.values
            handedOut += response
            return ChipRead(
                files,
                response,
                ChipDeviceReport(
                    listOf(
                        ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.PACE, ChipDeviceReport.Outcome.FAILED),
                        ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.BAC, ChipDeviceReport.Outcome.SUCCEEDED),
                        ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.CHIP_AUTHENTICATION, ChipDeviceReport.Outcome.NOT_ATTEMPTED),
                        ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.ACTIVE_AUTHENTICATION, ChipDeviceReport.Outcome.SUCCEEDED),
                    ),
                    readMillis = 987_654,
                ),
            )
        }
    }

    /** Fails any connection the JVM's HTTP clients try: they ask the default proxy selector before they connect. */
    private class NoNetwork : ProxySelector() {
        val asked = mutableListOf<String>()

        override fun select(uri: URI): List<Proxy> {
            asked += uri.scheme
            throw IllegalStateException("the reader check opened a connection")
        }

        override fun connectFailed(uri: URI, address: SocketAddress, failure: IOException) = Unit
    }

    private fun declaredActivities(): List<String> =
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_ACTIVITIES).activities.orEmpty().map { it.name }

    private fun launch(): ActivityScenario<Activity> = ActivityScenario.launch(Intent().setClassName(context, SCREEN))

    private fun type(tag: String, text: String) {
        compose.onNodeWithTag(tag).performScrollTo().performTextInput(text)
    }

    private fun tap(tag: String) {
        compose.onNodeWithTag(tag).performScrollTo().performClick()
        compose.waitForIdle()
    }

    private fun typeTheMrzKey() {
        type("reader-check-document-number", "X12345678")
        type("reader-check-birth-date", "900101")
        type("reader-check-expiry-date", "310101")
    }

    private fun everyFileOfTheApp(): Set<String> =
        File(context.applicationInfo.dataDir).walkTopDown().filter { it.isFile }.map { "${it.path}:${it.length()}:${it.lastModified()}" }.toSet()

    @Test
    fun `the reader check exists exactly in a debug build that includes the NFC module`() {
        assertEquals(included, SCREEN in declaredActivities())
        if (included) {
            assertNotNull(Class.forName(SCREEN))
            assertNotNull(Class.forName("dev.openverify.demo.readercheck.ReaderCheck"))
        } else {
            assertThrows(ClassNotFoundException::class.java) { Class.forName(SCREEN) }
            assertThrows(ClassNotFoundException::class.java) { Class.forName("dev.openverify.demo.readercheck.ReaderCheck") }
        }
    }

    @Test
    fun `the release build never holds it, and only the debug source set compiles it`() {
        val release = File(checkNotNull(System.getProperty("openverify.demo.releaseManifest")) { "the build passes the release manifest" }).readText()
        assertTrue("dev.openverify.demo.MainActivity" in release)
        assertFalse("readercheck" in release.lowercase())

        // The build file names the folder in one place, the debug build type's source set, and only with nfc.
        val build = File("build.gradle.kts").readText().lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
        val debugOnly = Regex("""if \("nfc" in demoArtifacts\) \{\s*getByName\("debug"\) \{([^}]*)\}""").find(build)?.groupValues?.get(1).orEmpty()
        assertEquals(3, Regex("src/readerCheck").findAll(debugOnly).count())
        assertEquals(3, Regex("src/readerCheck").findAll(build).count())

        // No other source set knows the screen.
        val others = listOf("src/main", "src/minifiedSmoke", "src/nfc", "src/withoutNfc", "src/face", "src/withoutFace")
            .flatMap { root -> File(root).walkTopDown().filter { it.isFile }.toList() }
        assertTrue(others.size > 10)
        assertEquals(emptyList<String>(), others.filter { "readercheck" in it.readText().lowercase() || "reader_check" in it.readText() }.map { it.path })
    }

    @Test
    fun `a check reads once with the installed reader and shows pass or fail per protocol and file, and nothing of the chip`() {
        if (!included) return assertFalse(SCREEN in declaredActivities())
        val reader = FakeReader()
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = reader))
        launch().use {
            typeTheMrzKey()

            tap("reader-check-read")

            assertEquals(1, reader.accesses.size)
            assertEquals("X12345678590010113101012", (reader.accesses.single() as ChipAccess.Mrz).seed.mrzInformation)
            assertEquals(listOf(8), reader.challenges)
            compose.onNodeWithTag("reader-check-protocol-pace").assertTextEquals("pace: fail")
            compose.onNodeWithTag("reader-check-protocol-bac").assertTextEquals("bac: pass")
            compose.onNodeWithTag("reader-check-protocol-chip_authentication").assertTextEquals("chip_authentication: not attempted, or not on the chip")
            compose.onNodeWithTag("reader-check-protocol-active_authentication").assertTextEquals("active_authentication: pass")
            compose.onNodeWithTag("reader-check-file-chip-sod").assertTextEquals("chip-sod: pass")
            compose.onNodeWithTag("reader-check-file-chip-dg1").assertTextEquals("chip-dg1: pass")
            compose.onNodeWithTag("reader-check-file-chip-dg2").assertTextEquals("chip-dg2: pass")
            compose.onNodeWithTag("reader-check-file-chip-dg15").assertTextEquals("chip-dg15: pass")
            compose.onNodeWithTag("reader-check-file-chip-dg14").assertTextEquals("chip-dg14: not attempted, or not on the chip")
            // Nothing of the chip is on the screen: no byte as text, hex or a count, and no timing.
            val screen = compose.onRoot(useUnmergedTree = true).printToString(maxDepth = Int.MAX_VALUE)
            assertTrue("chip-sod: pass" in screen)
            listOf(CANARY, CANARY.toByteArray().joinToString("") { "%02x".format(it) }, "987654", "${CANARY.length} bytes").forEach { assertFalse(it, it in screen) }
        }
    }

    @Test
    fun `what the reader returned is overwritten before the result is shown`() {
        if (!included) return assertFalse(SCREEN in declaredActivities())
        val reader = FakeReader()
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = reader))
        launch().use {
            typeTheMrzKey()

            tap("reader-check-read")

            assertEquals(5, reader.handedOut.size)
            reader.handedOut.forEach { bytes -> assertTrue(bytes.all { it == 0.toByte() }) }
        }
    }

    @Test
    fun `a check opens no connection, starts no flow and writes no file`() {
        val network = NoNetwork()
        ProxySelector.setDefault(network)
        // The tripwire works: a connection the JVM's HTTP client tries is refused by it.
        assertThrows(Exception::class.java) { (URL("http://192.0.2.1/").openConnection() as HttpURLConnection).connect() }
        assertEquals(listOf("http"), network.asked)
        if (!included) return assertFalse(SCREEN in declaredActivities())
        network.asked.clear()
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = FakeReader(), eventListener = EventLog.shared))
        launch().use {
            val before = everyFileOfTheApp()
            typeTheMrzKey()

            tap("reader-check-read")

            compose.onNodeWithTag("reader-check-file-chip-dg1").assertTextEquals("chip-dg1: pass")
            assertEquals(emptyList<String>(), network.asked)
            assertEquals(0, EventLog.shared.names.value.size)
            assertEquals(before, everyFileOfTheApp())
            // The key the person typed is held by the screen, not by its saved state: a recreated screen has none of it.
            assertTrue("X12345678" in compose.onRoot(useUnmergedTree = true).printToString(maxDepth = Int.MAX_VALUE))
            it.recreate()
            compose.waitForIdle()
            assertFalse("X12345678" in compose.onRoot(useUnmergedTree = true).printToString(maxDepth = Int.MAX_VALUE))
            assertEquals(before, everyFileOfTheApp())
        }
    }

    @Test
    fun `a failed read shows the reader's reason and the files it reached, pass or fail`() {
        if (!included) return assertFalse(SCREEN in declaredActivities())
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = FakeReader(failure = ChipReadFailure.TAG_LOST)))
        launch().use {
            typeTheMrzKey()

            tap("reader-check-read")

            compose.onNodeWithTag("reader-check-status").assertTextEquals("The read failed: tag_lost")
            compose.onNodeWithTag("reader-check-file-chip-sod").assertTextEquals("chip-sod: pass")
            compose.onNodeWithTag("reader-check-file-chip-dg1").assertTextEquals("chip-dg1: fail")
            assertEquals(0, compose.onAllNodesWithTag("reader-check-protocol-bac").fetchSemanticsNodes().size)
        }
    }

    @Test
    fun `a card access number is taken as the key, and a key that cannot be one is refused before any read`() {
        if (!included) return assertFalse(SCREEN in declaredActivities())
        val reader = FakeReader()
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = reader))
        launch().use {
            tap("reader-check-read")
            compose.onNodeWithTag("reader-check-status").assertTextEquals(
                "Check the key: the document number, and both dates as six digits; or the six digits of the card access number.",
            )
            assertEquals(0, reader.accesses.size)

            tap("reader-check-key-can")
            type("reader-check-can", "123456")
            tap("reader-check-read")

            assertEquals("123456", (reader.accesses.single() as ChipAccess.Can).can)
        }
    }

    @Test
    fun `leaving the screen stops the read, and a build without a reader says so`() {
        if (!included) return assertFalse(SCREEN in declaredActivities())
        val reader = FakeReader(never = true)
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = reader))
        launch().use { scenario ->
            typeTheMrzKey()
            tap("reader-check-read")
            compose.onNodeWithTag("reader-check-status").assertTextEquals("Phase: waiting")
            assertFalse(reader.stopped)

            scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED)

            assertTrue(reader.stopped)
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
            compose.onNodeWithTag("reader-check-status").assertTextEquals("Stopped. Nothing was kept.")

            OpenVerifyAndroid.install(OpenVerifyComponents())
            tap("reader-check-read")
            compose.onNodeWithTag("reader-check-status").assertTextEquals("No chip reader is installed in this build.")
        }
    }

    private companion object {
        const val SCREEN = "dev.openverify.demo.readercheck.ReaderCheckActivity"

        /** What a chip's bytes would be, made up: it must never reach the screen. */
        const val CANARY = "CANARY7Q<<UTOPIA"
    }
}
