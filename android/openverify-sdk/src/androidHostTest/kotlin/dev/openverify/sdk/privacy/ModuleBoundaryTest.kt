package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C191.2, C214.6 (review F18) over every module now present: `:openverify-sdk` depends on no optional
 * artifact and on no library reserved for one (JMRTD, SCUBA, cert-cvc, Bouncy Castle, ONNX Runtime,
 * `com.google.android.play`). The Gradle check (`:openverify-sdk:checkDependencyBoundary`, run by
 * `assemble` and `check`) walks the resolved classpaths; this test holds that check to the plan's
 * names and to the module table ([SdkModule.ALL]), and reads the committed lockfile, which is what
 * a locked build resolves (its shipped configurations: the test and lint classpaths are tooling). A module the build gains without an entry in the table fails here.
 */
internal class ModuleBoundaryTest {

    @Test
    fun `every module the build includes has its entry, and each entry is a module`() {
        assertEquals(SdkModule.included(), SdkModule.ALL.map { it.name })
        SdkModule.ALL.forEach { module -> assertTrue(File(module.manifest).isFile, "${module.name}: ${module.manifest}") }
    }

    @Test
    fun `the Gradle check refuses the plan's libraries and artifacts, and runs with assemble and check`() {
        assertEquals(
            listOf("org.jmrtd", "net.sf.scuba", "org.ejbca.cvc", "org.bouncycastle", "com.microsoft.onnxruntime", "com.google.android.play"),
            DependencyBoundary.reservedGroups(),
        )
        assertEquals(listOf("openverify-nfc", "openverify-face", "openverify-integrity-play"), DependencyBoundary.reservedArtifacts())
        assertTrue(DependencyBoundary.wired())
    }

    @Test
    fun `the Gradle check counts every module but the SDK and the consumers as an optional artifact`() {
        val optionalInTable = SdkModule.ALL.filter { it.role == SdkModule.Role.OPTIONAL }.map { it.name }
        val notOptionalInTable = SdkModule.ALL.filterNot { it.role == SdkModule.Role.OPTIONAL }.map { it.name }.sorted()

        assertEquals(notOptionalInTable, DependencyBoundary.notOptional())
        assertEquals(listOf("openverify-nfc", "openverify-face"), optionalInTable)
    }

    @TestFactory
    fun `the boundary, per module`(): List<DynamicTest> = SdkModule.ALL.map { module ->
        dynamicTest("${module.name} (${module.role})") {
            val sdk = File("gradle.lockfile").readLines()
            val groups = DependencyBoundary.reservedGroups()
            val artifacts = DependencyBoundary.reservedArtifacts() + SdkModule.ALL.filter { it.role == SdkModule.Role.OPTIONAL }.map { it.name }
            val sdkProjects = DependencyBoundary.projectDependencies(File("build.gradle.kts").readText())
            assertTrue(DependencyBoundary.locked(sdk).size > 50, "the SDK's lockfile was read")
            when (module.role) {
                // The SDK resolves no reserved library and no optional artifact in any configuration that ships.
                SdkModule.Role.SDK -> {
                    assertEquals(emptyList<String>(), DependencyBoundary.refused(DependencyBoundary.locked(sdk), groups, artifacts))
                    assertEquals(emptyList<String>(), sdkProjects)
                }
                // The SDK never names the optional artifact; the artifact never depends on a consumer.
                SdkModule.Role.OPTIONAL -> {
                    assertTrue(module.name !in sdkProjects, sdkProjects.toString())
                    assertTrue(DependencyBoundary.locked(sdk).none { it.endsWith(":${module.name}") })
                    val own = DependencyBoundary.projectDependencies(File("../${module.name}/build.gradle.kts").readText())
                    assertEquals(emptyList<String>(), own - "openverify-sdk")
                }
                // A consumer may depend on the SDK and on optional artifacts; nothing depends on it.
                SdkModule.Role.CONSUMER -> {
                    assertTrue(module.name !in sdkProjects)
                    val own = DependencyBoundary.projectDependencies(File("../${module.name}/build.gradle.kts").readText())
                    assertTrue("openverify-sdk" in own, own.toString())
                    assertEquals(emptyList<String>(), own - SdkModule.SHIPPED.map { it.name }.toSet())
                }
            }
        }
    }

    @Test
    fun `a reserved library or an optional artifact in a lockfile is refused, by group, subgroup and name`() {
        val lockfile = listOf(
            "# This is a Gradle generated file for dependency locking.",
            "androidx.activity:activity:1.13.0=androidRuntimeClasspath",
            "org.jmrtd:jmrtd:0.8.1=androidRuntimeClasspath",
            "org.bouncycastle:bcprov-jdk18on:1.80=androidRuntimeClasspath",
            "com.google.android.play:integrity:1.4.0=androidRuntimeClasspath",
            "com.google.android.play.core:review:2.0.0=androidHostTestRuntimeClasspath,iosArm64CompileKlibraries",
            "dev.openverify:openverify-nfc:0.1.0=androidRuntimeClasspath",
            "org.jmrtdx:other:1.0=androidRuntimeClasspath",
            // Robolectric's and the lint tool's own, on classpaths that never ship.
            "org.bouncycastle:bcutil-jdk18on:1.80.2=androidLintTool",
            "org.bouncycastle:bc-jdk18on-bom:1.85=allTestSourceSetsCompileDependenciesMetadata,androidHostTestRuntimeClasspath",
            "empty=",
        )

        assertEquals(
            listOf("org.jmrtd:jmrtd", "org.bouncycastle:bcprov-jdk18on", "com.google.android.play:integrity", "com.google.android.play.core:review", "dev.openverify:openverify-nfc"),
            DependencyBoundary.refused(DependencyBoundary.locked(lockfile), listOf("org.jmrtd", "org.bouncycastle", "com.google.android.play"), listOf("openverify-nfc")),
        )
        assertEquals(listOf("openverify-sdk", "openverify-nfc"), DependencyBoundary.projectDependencies("""implementation(project(":openverify-sdk")); api(project( ":openverify-nfc" ))"""))
    }
}
