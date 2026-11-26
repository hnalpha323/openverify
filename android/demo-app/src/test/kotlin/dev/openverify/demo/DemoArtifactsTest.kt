package dev.openverify.demo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** C218.1: the Gradle property `openverifyDemoArtifacts` reaches the app, which says what it includes. */
class DemoArtifactsTest {

    @Test
    fun `a configuration names its artifacts`() {
        assertEquals(setOf("sdk"), DemoArtifacts.parse("sdk"))
        assertEquals(setOf("sdk", "nfc"), DemoArtifacts.parse("sdk-nfc"))
        assertEquals(setOf("sdk", "face"), DemoArtifacts.parse("sdk-face"))
        assertEquals(setOf("sdk", "nfc", "face"), DemoArtifacts.parse("sdk-nfc-face"))
    }

    @Test
    fun `this build includes what the Gradle property selected`() {
        val configuration = System.getProperty("openverify.demo.configuration")

        assertTrue(configuration in setOf("sdk", "sdk-nfc", "sdk-face", "sdk-nfc-face"), "the build passes its configuration, got $configuration")
        assertEquals(configuration, BuildConfig.OPENVERIFY_DEMO_ARTIFACTS)
        assertEquals(DemoArtifacts.parse(configuration), DemoArtifacts.included)
    }

    @Test
    fun `the screen says which optional modules the build holds`() {
        assertEquals(R.string.artifacts_sdk, DemoArtifacts.description(setOf("sdk")))
        assertEquals(R.string.artifacts_sdk_nfc, DemoArtifacts.description(setOf("sdk", "nfc")))
        assertEquals(R.string.artifacts_sdk_face, DemoArtifacts.description(setOf("sdk", "face")))
        assertEquals(R.string.artifacts_sdk_nfc_face, DemoArtifacts.description(setOf("sdk", "nfc", "face")))
    }

    @Test
    fun `no line says a module is still to be built, now that the reader and the detector are (Workflow 10E)`() {
        val strings = java.io.File("src/main/res/values/strings.xml").readText()
        val lines = Regex("""<string name="artifacts_[a-z_]+">([^<]*)</string>""").findAll(strings).map { it.groupValues[1] }.toList()

        assertEquals(4, lines.size)
        assertEquals(emptyList<String>(), lines.filter { "not built yet" in it || "no chip reader" in it || "yet" in it })
        assertEquals(2, lines.count { "with its face detector" in it })
    }

    @Test
    fun `each configuration has a line of its own`() {
        val lines = listOf(setOf("sdk"), setOf("sdk", "nfc"), setOf("sdk", "face"), setOf("sdk", "nfc", "face")).map(DemoArtifacts::description)

        assertEquals(4, lines.toSet().size)
    }
}
