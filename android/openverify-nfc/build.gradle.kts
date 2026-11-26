import kotlinx.kover.gradle.plugin.dsl.AggregationType
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit

// Optional NFC eMRTD module (C209; Phase 10 P1, granted narrowly on 2026-11-08). It depends on JMRTD
// and cert-cvc (LGPL-2.1-or-later), SCUBA (LGPL-2.1-or-later AND GPL-2.0-only WITH
// Classpath-exception-2.0 for two files) and Bouncy Castle (MIT), by Maven coordinates, never shaded
// or copied. That is why it is a separate artifact: :openverify-sdk must never depend on it, so the
// core SDK stays Apache-2.0 (:openverify-sdk:checkDependencyBoundary). See README.md and NOTICE.
plugins {
    // C261.1 (Workflow 11C Stage 1a): this module's CycloneDX SBOM (`cyclonedxBom`).
    alias(libs.plugins.cyclonedx)
    alias(libs.plugins.android.library)
    // C214.2, spike (b): only for BCV's task classes. KGP's ABI validation does not reach an AGP 9
    // built-in-Kotlin library, and BCV's plugin registers nothing on one.
    alias(libs.plugins.binary.compatibility.validator)
    // C217.2 (Workflow 10C, spike (d)): the publication with its sources and javadoc jars.
    alias(libs.plugins.maven.publish)
    alias(libs.plugins.dokka)
    // C209.3: the module's line coverage gate (80%), as :openverify-sdk's.
    alias(libs.plugins.kover)
}

android {
    namespace = "dev.openverify.nfc"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
        // C215.1 (decision 41): the module's consumer R8 rules travel in its AAR. nfc-reader fills
        // consumer-rules.pro (org.jmrtd.**, net.sf.scuba.**, org.ejbca.cvc.**; KP10-43).
        consumerProguardFiles("consumer-rules.pro")
        // Device tests (src/androidTest) need a device: they compile here and run on one (C219.5).
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    packaging {
        resources {
        // Bouncy Castle's two jars (bcprov, bcutil), which openverify-nfc brings, each carry the same
        // MIT licence text at META-INF/LICENSE.md, and the packager refuses two files at one path. One
        // copy is kept. Here it serves this module's own device-test APK; a host app needs the same line.
            pickFirsts += "META-INF/LICENSE.md"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all {
                // JUnit 5 for plain JVM tests; the Vintage engine runs Robolectric (JUnit 4) tests.
                it.useJUnitPlatform()
                // Robolectric's android-36 sandbox reads FileDescriptor internals through
                // jdk.internal.access, which JDK 17+ does not export by default.
                it.jvmArgs(
                    "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                )
            }
        }
    }
}

kotlin {
    // C214.2 (decision 39): every public declaration says so, with its type; the ABI dump holds them.
    explicitApi()
    compilerOptions {
        // The module implements ChipReader.read, whose types are experimental in the SDK (C207.3):
        // it opts in once, here. Its own public surface is one factory that names none of them.
        optIn.add("dev.openverify.sdk.ExperimentalOpenVerifyApi")
    }
}

// C209.3: the host tests read the synthetic Utopia chip (contracts/fixtures/emrtd/utopia-chip.json,
// exported by packages/emrtd/src/testing/utopia-chip-export.test.ts) by the path this property gives.
val emrtdFixtures: File = rootProject.file("../contracts/fixtures/emrtd")
tasks.withType<Test>().configureEach {
    systemProperty("openverify.fixtures.emrtd", emrtdFixtures.absolutePath)
    inputs.dir(emrtdFixtures).withPropertyName("emrtdFixtures").withPathSensitivity(PathSensitivity.RELATIVE)
}

dependencies {
    // The public factory returns the SDK's ChipReader, so the SDK is part of this module's API.
    api(project(":openverify-sdk"))

    // C209.1: the reader's stack. cert-cvc's own bcprov-jdk15on 1.68 holds the same classes as
    // bcprov-jdk18on, so it is excluded wherever cert-cvc arrives; the exclusions travel in the POM.
    implementation(libs.jmrtd) {
        exclude(group = "org.bouncycastle", module = "bcprov-jdk15on")
    }
    implementation(libs.cert.cvc) {
        exclude(group = "org.bouncycastle", module = "bcprov-jdk15on")
    }
    implementation(libs.scuba.sc.android)
    implementation(libs.scuba.smartcards)
    implementation(libs.bouncycastle.bcprov)
    implementation(libs.bouncycastle.bcutil)
    // The read runs off the main thread (C209.2).
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.vintage.engine)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    // AndroidJUnit4 for the Robolectric tests; it also brings JUnit 4's API, as in the other modules.
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // Reads the fixture's JSON (JsonElement only; no serialization plugin).
    testImplementation(libs.kotlinx.serialization.json)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}

// C209.3 (C219.2; review F18): the one Kover exclusion of this module, the thin JMRTD adapter, which
// needs a chip in the field. nfc-reader names its class pattern in kover-excludes/nfc-reader.txt
// (one line) and gives the reason in its TDD file; nothing else is excluded.
val koverAdapterExclusion: List<String> = file("kover-excludes/nfc-reader.txt").readLines()
    .map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
require(koverAdapterExclusion.size <= 1) { "openverify-nfc has one Kover exclusion, the JMRTD adapter (C209.3), not ${koverAdapterExclusion.size}" }

kover {
    reports {
        filters {
            excludes {
                classes(koverAdapterExclusion)
                androidGeneratedClasses()
            }
        }
        verify {
            rule("openverify-nfc line coverage") {
                bound {
                    minValue = 80
                    coverageUnits = CoverageUnit.LINE
                    aggregationForGroup = AggregationType.COVERED_PERCENTAGE
                }
            }
        }
    }
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(libs.versions.jvmToolchain.get().toInt())
    }
}

// C214.2, spike (b): the module's ABI dump, by BCV 0.18.2's tasks over the release classes, under KGP's
// task names so that `checkKotlinAbi` checks every published module. `updateKotlinAbi` writes
// api/openverify-nfc.api.
val abiWorker = configurations.create("abiWorker") {
    isCanBeConsumed = false
    isCanBeResolved = true
}
dependencies {
    abiWorker(libs.binary.compatibility.validator)
    abiWorker(libs.kotlin.metadata.jvm)
}
val dumpKotlinAbi = tasks.register<kotlinx.validation.KotlinApiBuildTask>("dumpKotlinAbi") {
    description = "Dumps openverify-nfc's public ABI from its release classes into build/abi/."
    runtimeClasspath.from(abiWorker)
    inputClassesDirs.from(tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileReleaseKotlin").flatMap { it.destinationDirectory })
    outputApiFile.set(layout.buildDirectory.file("abi/openverify-nfc.api"))
}
val checkKotlinAbi = tasks.register<kotlinx.validation.KotlinApiCompareTask>("checkKotlinAbi") {
    description = "Checks openverify-nfc's public ABI against api/openverify-nfc.api."
    group = "verification"
    projectApiFile.set(layout.projectDirectory.file("api/openverify-nfc.api"))
    generatedApiFile.set(dumpKotlinAbi.flatMap { it.outputApiFile })
}
tasks.register<Copy>("updateKotlinAbi") {
    description = "Writes openverify-nfc's public ABI to api/openverify-nfc.api."
    group = "verification"
    from(dumpKotlinAbi.flatMap { it.outputApiFile })
    into(layout.projectDirectory.dir("api"))
}
// `updateKotlinAbi` and `checkKotlinAbi` never run in one build (Workflow 10A Stage 1b amendment 2:
// Gradle refuses the implicit dependency on the SDK's dump tasks). The ordering below only keeps a
// mistaken joint call from checking a stale dump.
checkKotlinAbi.configure { mustRunAfter("updateKotlinAbi") }

// C217 (Workflow 10C Stage 1a, contracts-10c; spike (d)): the publication skeleton of the optional NFC
// module, under its own licence (C209.4): LGPL-3.0-or-later, apart from :openverify-sdk's Apache-2.0.
// No signing and no upload: the staged repository is the release until the owner's namespace and keys
// exist (P4, C217.3). release-checks owns this block from here.
group = providers.gradleProperty("openverifyGroup").get()
version = providers.gradleProperty("openverifyVersion").get()

mavenPublishing {
    coordinates(providers.gradleProperty("openverifyGroup").get(), "openverify-nfc", providers.gradleProperty("openverifyVersion").get())
    pom {
        name.set("OpenVerify NFC")
        description.set("OpenVerify's optional chip reader for identity documents, a separate artifact under its own licence.")
        url.set("https://github.com/openverify/openverify")
        licenses {
            license {
                name.set("LGPL-3.0-or-later")
                url.set("https://www.gnu.org/licenses/lgpl-3.0.txt")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("openverify")
                name.set("OpenVerify contributors")
            }
        }
        scm {
            url.set("https://github.com/openverify/openverify")
            connection.set("scm:git:https://github.com/openverify/openverify.git")
            // Central asks for it (engineering 6.1); the same placeholder address as `url` (P4).
            developerConnection.set("scm:git:ssh://git@github.com/openverify/openverify.git")
        }
    }
}

publishing {
    repositories {
        // C217.3: the same staged repository as :openverify-sdk's.
        maven {
            name = "staging"
            url = uri(rootProject.layout.buildDirectory.dir("staging-repo"))
        }
    }
}

// C261.1 (Workflow 11C Stage 1a, spike (c)): the SBOM lists what the published artifact's consumers
// resolve at run time (releaseRuntimeClasspath), never the test, lint or iOS configurations. The plugin's
// aggregate `cyclonedxBom` reads this direct SBOM; the output is build/reports/cyclonedx/bom.json.
tasks.named<org.cyclonedx.gradle.CyclonedxDirectTask>("cyclonedxDirectBom") {
    includeConfigs.set(listOf("releaseRuntimeClasspath"))
}
