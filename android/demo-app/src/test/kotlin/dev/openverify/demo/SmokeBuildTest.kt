package dev.openverify.demo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C215.2 (reviews P16, P25, V01), the parts of the smoke build a host can check: the launcher exists
 * only in `src/minifiedSmoke/`, is not exported and takes no intent filter; that source set brings no
 * network security configuration, no key and no certificate; and the device test makes its
 * certificate at run time.
 */
class SmokeBuildTest {

    private val android = "http://schemas.android.com/apk/res/android"

    private fun activities(path: String): List<Element> {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val nodes = factory.newDocumentBuilder().parse(File(path)).getElementsByTagName("activity")
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    private fun files(root: String): List<File> = File(root).walkTopDown().filter { it.isFile }.toList()

    @Test
    fun `the launcher is declared by the smoke build only, not exported, with no intent filter`() {
        val smoke = activities("src/minifiedSmoke/AndroidManifest.xml")

        assertEquals(listOf("dev.openverify.demo.smoke.SmokeLauncherActivity"), smoke.map { it.getAttributeNS(android, "name") })
        assertEquals(listOf("false"), smoke.map { it.getAttributeNS(android, "exported") })
        assertEquals(0, smoke.single().getElementsByTagName("intent-filter").length)
        assertFalse(File("src/main/AndroidManifest.xml").readText().contains("Smoke"))
        assertEquals(emptyList<File>(), files("src/main").filter { it.readText().contains("SmokeLauncherActivity") })
        assertTrue(File("src/minifiedSmoke/kotlin/dev/openverify/demo/smoke/SmokeLauncherActivity.kt").isFile)
    }

    @Test
    fun `the smoke source set has no network security configuration, resource, key or certificate`() {
        val smoke = files("src/minifiedSmoke")

        assertEquals(emptyList<File>(), smoke.filter { it.path.contains("/res/") })
        assertFalse(File("src/minifiedSmoke/AndroidManifest.xml").readText().contains("networkSecurityConfig"))
        assertFalse(File("src/minifiedSmoke/AndroidManifest.xml").readText().contains("debuggable"))
        val keyLike = Regex("\\.(pem|p12|pfx|jks|keystore|bks|crt|cer|der|key)$")
        assertEquals(emptyList<File>(), (smoke + files("src/androidTest") + files("src/testMinifiedSmoke")).filter { keyLike.containsMatchIn(it.name) })
    }

    @Test
    fun `the device test makes its certificate at run time and serves the flow over TLS on loopback`() {
        val test = File("src/androidTest/kotlin/dev/openverify/demo/smoke/MinifiedSmokeTest.kt").readText()

        assertTrue(test.contains("HeldCertificate.Builder()"))
        assertTrue(test.contains("addSubjectAlternativeName(\"127.0.0.1\")"))
        assertTrue(test.contains("useHttps("))
        assertFalse(test.contains("BEGIN CERTIFICATE"), "no certificate is committed")
        assertFalse(test.contains("BEGIN PRIVATE KEY") || test.contains("BEGIN EC PRIVATE KEY") || test.contains("BEGIN RSA PRIVATE KEY"))
        assertFalse(Regex("Assume|assumeTrue|@Ignore|@Disabled").containsMatchIn(test), "a device test that skips itself fails the job")
    }

    @Test
    fun `everything the device test touches in the app is kept for it, and only that`() {
        // R8 removes or inlines what the app itself does not use, and the device tests' APK is built
        // against the minified app. So the device test touches only the smoke package, which one rule
        // of the smoke build keeps whole; it names no SDK class, whose members R8 is free to change.
        val test = File("src/androidTest/kotlin/dev/openverify/demo/smoke/MinifiedSmokeTest.kt").readText()
        val imports = test.lines().filter { it.startsWith("import ") }.map { it.removePrefix("import ") }
        assertEquals(emptyList<String>(), imports.filter { it.startsWith("dev.openverify.") }, "the test imports nothing of the app or the SDK")
        assertTrue(test.startsWith("package dev.openverify.demo.smoke\n"))

        val rules = File("smoke-proguard-rules.pro").readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
        assertEquals(listOf("-keep class dev.openverify.demo.smoke.** { *; }"), rules)
        val build = File("build.gradle.kts").readText()
        assertEquals(1, Regex("smoke-proguard-rules\\.pro").findAll(build).count(), "only the smoke build type names the rule")
        assertTrue(build.substringAfter("create(\"minifiedSmoke\")").substringBefore("testBuildType").contains("proguardFiles(\"smoke-proguard-rules.pro\")"))
    }

    @Test
    fun `what the device test shares with the app is kept by traced rules, on the smoke build only, never naming the SDK`() {
        // KP10-32: the runner died in the minified app on androidx.tracing.Trace, then kotlin.LazyKt.
        // The rules for the shared libraries are traced by R8 at build time from the test's classes;
        // none is written by hand, and the tracer refuses the names whose survival C215.1 proves.
        val build = File("build.gradle.kts").readText()
        val smokeVariant = build.substringAfter("onVariants(selector().withBuildType(\"minifiedSmoke\"))")

        assertEquals(1, Regex("variant\\.proguardFiles\\.add\\(").findAll(build).count(), "one variant takes generated rules")
        assertTrue(smokeVariant.contains("variant.proguardFiles.add(keepRules.flatMap { it.rules })"))
        assertTrue(smokeVariant.contains("neverKept.set(listOf(\"dev.openverify.sdk.\", \"dev.openverify.demo.\", \"kotlinx.serialization.\"))"))
        assertTrue(smokeVariant.contains("tasks.matching { it.name == \"assembleMinifiedSmokeAndroidTest\" }.configureEach { dependsOn(check) }"))
        val release = build.substringAfter("release {").substringBefore("create(\"minifiedSmoke\")")
        assertEquals(listOf("proguardFiles(getDefaultProguardFile(\"proguard-android-optimize.txt\"))"), release.lines().map { it.trim() }.filter { it.startsWith("proguardFiles") })
        assertFalse(Regex("isMinifyEnabled\\s*=\\s*false|isShrinkResources\\s*=\\s*false|-dontobfuscate|-dontshrink|-dontoptimize").containsMatchIn(build + File("smoke-proguard-rules.pro").readText()))
    }

    @Test
    fun `the build tests the minified, non-debuggable smoke build with the debug signing config`() {
        val build = File("build.gradle.kts").readText()

        assertTrue(build.contains("testBuildType = \"minifiedSmoke\""))
        assertTrue(build.contains("initWith(getByName(\"release\"))"))
        assertTrue(build.contains("signingConfig = signingConfigs.getByName(\"debug\")"))
        assertFalse(build.contains("isDebuggable = true"))
        assertFalse(build.contains("storePassword") || build.contains("keyPassword"), "no key is configured")
    }
}
