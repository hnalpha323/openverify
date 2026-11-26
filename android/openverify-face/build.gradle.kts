import java.security.MessageDigest
import kotlinx.kover.gradle.plugin.dsl.AggregationType
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit

// Optional face-detection module (C205; ADR 0009; Phase 10 P2, granted narrowly on 2026-11-08): ONNX
// Runtime's official Android AAR and the YuNet model, behind the SDK's FaceDetectorFactory seam. A
// separate artifact so that the roughly 34 MB arm64 runtime, and the Eigen (MPL-2.0) compiled into
// it unmodified, reach only a host that adds it: :openverify-sdk never depends on this module
// (:openverify-sdk:checkDependencyBoundary). An Android library on AGP's built-in Kotlin, as
// openverify-nfc. See README.md and NOTICE in this directory.
plugins {
    // C261.1 (Workflow 11C Stage 1a): this module's CycloneDX SBOM (`cyclonedxBom`).
    alias(libs.plugins.cyclonedx)
    alias(libs.plugins.android.library)
    // C214.2, spike (b): only for BCV's task classes, as openverify-nfc.
    alias(libs.plugins.binary.compatibility.validator)
    // C217.2: the publication with its sources and javadoc jars.
    alias(libs.plugins.maven.publish)
    alias(libs.plugins.dokka)
    alias(libs.plugins.kover)
}

android {
    namespace = "dev.openverify.face"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
        // C215.1 (decision 41): the module's consumer R8 rules travel in its AAR. face-onnx fills
        // consumer-rules.pro once a minified build shows what ONNX Runtime's own rules leave out.
        consumerProguardFiles("consumer-rules.pro")
        // Device tests (src/androidTest) need a device: they compile here and run on one (C219.5).
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        // The reference tensor, decoder and yaw ratio (the SDK's own are internal to it) and the
        // vectors' reader, compiled into the host tests and the device tests alike, so the device
        // test and its host twin make the same comparison (C219.5).
        getByName("test") { kotlin.directories.add("src/sharedTest/kotlin") }
        getByName("androidTest") { kotlin.directories.add("src/sharedTest/kotlin") }
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

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(libs.versions.jvmToolchain.get().toInt())
    }
}

kotlin {
    // C214.2 (decision 39): every public declaration says so, with its type; the ABI dump holds them.
    explicitApi()
}

/**
 * Hands a host test the AndroidManifest.xml of ONNX Runtime's AAR, as AGP extracted it from the
 * resolved artifact (C205.2; review V14): the package the remove markers' `tools:selector` names is
 * read from there, never assumed from the Maven group.
 */
class OrtManifestArgument(
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    val manifests: FileCollection,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> =
        listOf("-Dopenverify.face.ortManifest=${manifests.singleFile.absolutePath}")
}

/**
 * Hands a host test this module's own manifest as the AAR carries it: the source manifest processed
 * by AGP (its package and SDK level written in, the remove marker kept), which is what a host app's
 * merger reads (C205.2, fourth layer).
 */
class LibraryManifestArgument(
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    val manifest: Provider<RegularFile>,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> =
        listOf("-Dopenverify.face.libraryManifest=${manifest.get().asFile.absolutePath}")
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val libraryManifest = variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.MERGED_MANIFEST)
        tasks.withType<Test>().configureEach {
            jvmArgumentProviders.add(LibraryManifestArgument(libraryManifest))
        }
        val ortManifest: FileCollection = variant.runtimeConfiguration.incoming.artifactView {
            attributes.attribute(org.gradle.api.artifacts.type.ArtifactTypeDefinition.ARTIFACT_TYPE_ATTRIBUTE, "android-manifest")
            componentFilter { id -> id is ModuleComponentIdentifier && id.group == "com.microsoft.onnxruntime" }
        }.files
        tasks.withType<Test>().configureEach {
            jvmArgumentProviders.add(OrtManifestArgument(ortManifest))
        }
    }
}

/**
 * Copies one pinned, fetched file into a generated directory, after checking its SHA-256 against the
 * manifest that pins it (C205.3; review F19). It never reaches the network: when the file is absent
 * it fails with the command that fetches it. Other files (notices, committed vectors) ride along
 * unchecked, each under its own relative path.
 */
@CacheableTask
abstract class VerifiedCopy : DefaultTask() {
    /** The fetched file; a collection so that an absent file reaches the action, which names the fetch command. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val pinned: ConfigurableFileCollection

    /** The file's name, for the message when it is absent. */
    @get:Input
    abstract val pinnedName: Property<String>

    /** The SHA-256 the manifest pins: 64 lower-case hexadecimal characters. */
    @get:Input
    abstract val sha256: Property<String>

    /** The command that fetches the file, named when it is absent or wrong. */
    @get:Input
    abstract val fetchCommand: Property<String>

    /** Where the file goes, relative to the output directory. */
    @get:Input
    abstract val pinnedPath: Property<String>

    /** Committed files copied beside it: relative path in the output directory to the file. */
    @get:Input
    abstract val extraPaths: MapProperty<String, String>

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val extras: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun copy() {
        val source = pinned.files.singleOrNull()?.takeIf { it.isFile }
            ?: throw GradleException("${pinnedName.get()} is absent. Fetch it first, from the repository root: ${fetchCommand.get()}")
        val digest = MessageDigest.getInstance("SHA-256").digest(source.readBytes()).joinToString("") { "%02x".format(it) }
        if (digest != sha256.get()) {
            throw GradleException("${pinnedName.get()} does not have its pinned SHA-256. Fetch it again, from the repository root: ${fetchCommand.get()}")
        }
        val out = outputDirectory.get().asFile
        out.deleteRecursively()
        source.copyTo(File(out, pinnedPath.get()).also { it.parentFile.mkdirs() })
        extraPaths.get().forEach { (relative, path) ->
            File(path).copyTo(File(out, relative).also { it.parentFile.mkdirs() })
        }
    }
}

/** The entry called [name] in the list [key] of a pinning manifest (`models/manifest.json`, `fixtures/manifest.json`). */
fun pinnedEntry(manifest: File, key: String, name: String): Map<*, *> {
    val entries = (groovy.json.JsonSlurper().parse(manifest) as Map<*, *>)[key] as List<*>
    return entries.map { it as Map<*, *> }.single { it["name"] == name }
}

val repositoryRoot: File = rootProject.file("..")

// C205.3 (decision 23): the YuNet model reaches the AAR as an asset, from the file
// `scripts/fetch_models.py --only face_detection_yunet` fetched, only after its digest matched
// models/manifest.json. With it go the notices the AAR must carry: the model's MIT licence (copied
// from opencv_zoo at the pinned commit) with the WIDER FACE caveat, ONNX Runtime's licence and
// third-party notices (Eigen's MPL-2.0 text among them; Workflow 10E Stage 1a amendment 3) and this
// module's NOTICE with Eigen's source location. The model never enters src/ or git.
val yunetEntry: Map<*, *> = pinnedEntry(File(repositoryRoot, "models/manifest.json"), "models", "face_detection_yunet")
val modelsDirectory: File = providers.gradleProperty("openverifyModelsDir").map { File(it) }.getOrElse(File(repositoryRoot, "models"))
val copyYunetModel = tasks.register<VerifiedCopy>("copyYunetModel") {
    description = "Copies the fetched YuNet model into the generated assets after checking its SHA-256 against models/manifest.json."
    val name = yunetEntry["filename"] as String
    pinned.from(File(modelsDirectory, name))
    pinnedName.set(name)
    sha256.set(yunetEntry["sha256"] as String)
    fetchCommand.set("python3 -I scripts/fetch_models.py --only face_detection_yunet")
    pinnedPath.set("openverify-face/$name")
    val notices = linkedMapOf(
        "openverify-face/NOTICE" to file("NOTICE"),
        "openverify-face/licenses/onnxruntime/LICENSE.txt" to file("licenses/onnxruntime/LICENSE.txt"),
        "openverify-face/licenses/onnxruntime/ThirdPartyNotices.txt" to file("licenses/onnxruntime/ThirdPartyNotices.txt"),
        "openverify-face/licenses/yunet/LICENSE.txt" to file("licenses/yunet/LICENSE.txt"),
        "openverify-face/licenses/yunet/NOTICE.txt" to file("licenses/yunet/NOTICE.txt"),
    )
    extraPaths.set(notices.mapValues { it.value.absolutePath })
    extras.from(notices.values)
}

// C219.5: the device test's frame is a public-domain face of fixtures/manifest.json, fetched by
// `scripts/fetch_fixtures.py`, never committed and never shipped: it reaches only the device test's
// own APK, from a generated directory, after its digest matched the manifest. The two committed
// vector files the device test compares with go beside it.
val faceEntry: Map<*, *> = pinnedEntry(File(repositoryRoot, "fixtures/manifest.json"), "faces", "person_a_id")
val copyFaceFixture = tasks.register<VerifiedCopy>("copyFaceFixture") {
    description = "Copies the fetched public-domain fixture face into the device test's generated assets after checking its SHA-256 against fixtures/manifest.json."
    val name = faceEntry["filename"] as String
    pinned.from(File(repositoryRoot, "fixtures/faces/$name"))
    pinnedName.set(name)
    sha256.set(faceEntry["sha256"] as String)
    fetchCommand.set("python3 -I scripts/fetch_fixtures.py --only person_a_id")
    pinnedPath.set("openverify-face-test/$name")
    val vectors = linkedMapOf(
        "openverify-face-test/yunet-face-frame-vectors.json" to File(repositoryRoot, "contracts/fixtures/flow/yunet-face-frame-vectors.json"),
        "openverify-face-test/yunet-decode.json" to File(repositoryRoot, "contracts/fixtures/vision/yunet-decode.json"),
    )
    extraPaths.set(vectors.mapValues { it.value.absolutePath })
    extras.from(vectors.values)
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyYunetModel, VerifiedCopy::outputDirectory)
        variant.androidTest?.sources?.assets?.addGeneratedSourceDirectory(copyFaceFixture, VerifiedCopy::outputDirectory)
    }
}

// MergedManifestTest runs AGP's manifest merger (test scope), which is written against Guava's JRE
// flavour (it holds a Guava supplier as a java.util.function.Supplier). An Android module's classpaths
// ask for Guava's Android flavour, whose supplier is not one, and the merger then fails to link. Guava
// is on this module's unit-test classpaths only, so its Android variants are given the JRE jar of the
// same version: the locked module and version do not change, and the jar is in the verification metadata.
dependencies.components.withModule("com.google.guava:guava") {
    val jre = "guava-${id.version}.jar"
    listOf("androidApiElements", "androidRuntimeElements").forEach { variant ->
        withVariant(variant) {
            withFiles {
                removeAllFiles()
                addFile(jre)
            }
        }
    }
}

// What the host tests read from the repository, by path: this module's own manifest (the remove
// markers), ONNX Runtime's manifest, the selfie vectors the SDK's decoder passes (C204.1), the model
// manifest with the pinned digest, and the fetched model itself when it is present (C205.3:
// `python3 -I scripts/fetch_models.py --only face_detection_yunet`, before Gradle; never committed).
tasks.withType<Test>().configureEach {
    systemProperty("openverify.face.moduleManifest", file("src/main/AndroidManifest.xml").absolutePath)
    systemProperty("openverify.repositoryRoot", repositoryRoot.absolutePath)
    inputs.files(
        file("src/main/AndroidManifest.xml"),
        File(repositoryRoot, "models/manifest.json"),
        File(repositoryRoot, "contracts/fixtures/flow/selfie-guidance-vectors.json"),
        File(repositoryRoot, "contracts/fixtures/vision/yunet-decode.json"),
        File(repositoryRoot, "contracts/fixtures/flow/yunet-face-frame-vectors.json"),
        File(repositoryRoot, "fixtures/manifest.json"),
        fileTree(File(repositoryRoot, "models")) { include("*.onnx") },
        // The fetched public-domain frame of the inference's host twin (never committed).
        fileTree(File(repositoryRoot, "fixtures/faces")) { include("person-a-id.jpg") },
        // The demo's manifests and allowlist with face, and the SDK's manifest (MergedManifestTest).
        rootProject.file("demo-app/src/main/AndroidManifest.xml"),
        rootProject.file("demo-app/src/face/AndroidManifest.xml"),
        rootProject.file("demo-app/manifest-allowlist/sdk-face.json"),
        rootProject.file("openverify-sdk/src/androidMain/AndroidManifest.xml"),
        // What the AAR's notices are copied from.
        file("NOTICE"),
        fileTree("licenses"),
    ).withPropertyName("repositoryFilesTheTestsRead").withPathSensitivity(PathSensitivity.RELATIVE)
}

dependencies {
    // The public factory returns the SDK's FaceDetectorFactory, so the SDK is part of this module's API.
    api(project(":openverify-sdk"))

    // C205.1: the official AAR, by coordinates. Its manifest's telemetry provider and
    // ACCESS_NETWORK_STATE are removed by this module's manifest (C205.2).
    implementation(libs.onnxruntime.android)
    // Inference runs off the main thread, inside the frame's callback (C205.4).
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
    // Reads the vectors' JSON (JsonElement only; no serialization plugin).
    testImplementation(libs.kotlinx.serialization.json)
    // The host twin of the device inference test: the same ONNX Runtime version with desktop natives,
    // over the same model. Test scope only, never shipped (MIT; Eigen inside it as in the AAR).
    testImplementation(libs.onnxruntime.jvm)
    // C205.2's fourth layer: the host test merges this module's manifest, ONNX Runtime's and a fake
    // library's with AGP's own merger (Apache-2.0, already on every module's lint classpath).
    testImplementation(libs.android.tools.manifest.merger)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.kotlinx.serialization.json)
}

// C205 (C219.2; review F18): the one Kover exclusion of this module, the ONNX Runtime session glue,
// which needs the native library. face-onnx names its class pattern in kover-excludes/face-onnx.txt
// (one line) and gives the reason in its TDD file; nothing else is excluded.
val koverSessionExclusion: List<String> = file("kover-excludes/face-onnx.txt").readLines()
    .map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
require(koverSessionExclusion.size <= 1) { "openverify-face has one Kover exclusion, the ONNX Runtime session glue (C205), not ${koverSessionExclusion.size}" }

kover {
    reports {
        filters {
            excludes {
                classes(koverSessionExclusion)
                androidGeneratedClasses()
            }
        }
        verify {
            rule("openverify-face line coverage") {
                bound {
                    minValue = 80
                    coverageUnits = CoverageUnit.LINE
                    aggregationForGroup = AggregationType.COVERED_PERCENTAGE
                }
            }
        }
    }
}

// C214.2, spike (b): the module's ABI dump, by BCV 0.18.2's tasks over the release classes, under KGP's
// task names so that `checkKotlinAbi` checks every published module (openverify-nfc's wiring).
// `updateKotlinAbi` writes api/openverify-face.api.
val abiWorker = configurations.create("abiWorker") {
    isCanBeConsumed = false
    isCanBeResolved = true
}
dependencies {
    abiWorker(libs.binary.compatibility.validator)
    abiWorker(libs.kotlin.metadata.jvm)
}
val dumpKotlinAbi = tasks.register<kotlinx.validation.KotlinApiBuildTask>("dumpKotlinAbi") {
    description = "Dumps openverify-face's public ABI from its release classes into build/abi/."
    runtimeClasspath.from(abiWorker)
    inputClassesDirs.from(tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileReleaseKotlin").flatMap { it.destinationDirectory })
    outputApiFile.set(layout.buildDirectory.file("abi/openverify-face.api"))
}
val checkKotlinAbi = tasks.register<kotlinx.validation.KotlinApiCompareTask>("checkKotlinAbi") {
    description = "Checks openverify-face's public ABI against api/openverify-face.api."
    group = "verification"
    projectApiFile.set(layout.projectDirectory.file("api/openverify-face.api"))
    generatedApiFile.set(dumpKotlinAbi.flatMap { it.outputApiFile })
}
tasks.register<Copy>("updateKotlinAbi") {
    description = "Writes openverify-face's public ABI to api/openverify-face.api."
    group = "verification"
    from(dumpKotlinAbi.flatMap { it.outputApiFile })
    into(layout.projectDirectory.dir("api"))
}
// `updateKotlinAbi` and `checkKotlinAbi` never run in one build (Workflow 10A Stage 1b amendment 2).
checkKotlinAbi.configure { mustRunAfter("updateKotlinAbi") }

// C217 (Workflow 10E Stage 1a, contracts-10e): the publication of the optional face module, Apache-2.0
// for OpenVerify's own code; ONNX Runtime (MIT, with Eigen under MPL-2.0 inside its native library)
// arrives by coordinates through the POM, never repackaged. No signing and no upload: the staged
// repository is the release until the owner's namespace and keys exist (P4, C217.3).
group = providers.gradleProperty("openverifyGroup").get()
version = providers.gradleProperty("openverifyVersion").get()

mavenPublishing {
    coordinates(providers.gradleProperty("openverifyGroup").get(), "openverify-face", providers.gradleProperty("openverifyVersion").get())
    pom {
        name.set("OpenVerify Face")
        description.set("OpenVerify's optional on-device face detector for selfie capture guidance, a separate artifact built on ONNX Runtime. Guidance only: the server decides liveness.")
        url.set("https://github.com/openverify/openverify")
        licenses {
            license {
                name.set("Apache-2.0")
                url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
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
