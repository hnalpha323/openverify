import com.android.build.api.artifact.ScopedArtifact
import com.android.build.api.artifact.SingleArtifact
import com.android.build.api.variant.ScopedArtifacts
import com.android.tools.r8.Diagnostic
import com.android.tools.r8.DiagnosticsHandler
import com.android.tools.r8.tracereferences.TraceReferences
import com.android.tools.r8.tracereferences.TraceReferencesCommand
import com.android.tools.r8.tracereferences.TraceReferencesConsumer
import com.android.tools.r8.tracereferences.TraceReferencesKeepRules
import java.nio.file.Path
import java.util.TreeSet

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.openverify.demo"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "dev.openverify.demo"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.0.1"
    }

    buildFeatures {
        compose = true
        // C218.1: BuildConfig.OPENVERIFY_DEMO_ARTIFACTS tells the screen which optional artifacts this
        // build includes.
        buildConfig = true
    }

    // C215.2, C218.3 (Workflow 10C Stage 1a, contracts-10c): the build-type skeletons. `release` is
    // minified and resource-shrunk by R8 in full mode (AGP's default), built for the 16 KB and size
    // checks. `minifiedSmoke` is `release` signed with AGP's generated debug keystore (never a
    // committed key; review P25), and is the build the device tests run against, so the smoke test
    // exercises what R8 minified. It differs from `release` in two sets of keep rules, both for the
    // device test alone and neither naming the SDK, the demo's screen or kotlinx.serialization: the
    // smoke package (its one committed rule) and what the test's APK shares with the app, traced at
    // build time (traceSmokeTestKeepRules below; KP10-32, Workflow 10D).
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
        create("minifiedSmoke") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
            // The device tests' APK of a minified build type is minified too; these rules only silence
            // compile-time annotations its test libraries name (never the app's own rules).
            testProguardFiles("test-proguard-rules.pro")
            // The smoke package is kept whole for the device test, which is built against the minified
            // app (demo-app). The only other rules of this build type are the traced ones (KP10-32).
            proguardFiles("smoke-proguard-rules.pro")
        }
    }
    testBuildType = "minifiedSmoke"

    packaging {
        resources {
        // Bouncy Castle's two jars (bcprov, bcutil), which openverify-nfc brings, each carry the same
        // MIT licence text at META-INF/LICENSE.md, and the packager refuses two files at one path. One
        // copy is kept. The demo, as a host, has the line; it changes nothing in a build without `nfc`.
            pickFirsts += "META-INF/LICENSE.md"
        }
    }

    testOptions {
        unitTests {
            // Robolectric resolves the app's string resources.
            isIncludeAndroidResources = true
            all {
                // JUnit 5 for plain JVM tests; the Vintage engine runs the Robolectric (JUnit 4)
                // tests on the same platform.
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

// AGP 9 builds host (unit) tests only for `testBuildType`, so naming minifiedSmoke there (C215.2) took
// `:demo-app:testDebugUnitTest` away and the gate's `testDebugUnitTest` ran none of the demo's tests.
// The debug variant's host tests are enabled again here: the demo's tests run on the debuggable build
// they were written for (plain http to 10.0.2.2), and the minifiedSmoke variant keeps its own for the
// smoke test's host twins.
androidComponents {
    beforeVariants(selector().withBuildType("debug")) { variant ->
        variant.hostTests[com.android.build.api.variant.HostTestBuilder.UNIT_TEST_TYPE]?.enable = true
    }
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(libs.versions.jvmToolchain.get().toInt())
    }
}

// C218.1 (Workflow 10C Stage 1a; Workflow 10E Stage 1a): which optional artifacts the demo includes,
// from the Gradle property openverifyDemoArtifacts (android/gradle.properties: `sdk` by default;
// `nfc` adds openverify-nfc, `face` adds openverify-face, in any combination with `sdk`). A
// configuration exists only once its artifact does (C216.3), so any other name fails the build; no
// Play Integrity artifact exists (Phase 10 P3, declined).
val demoArtifacts: Set<String> = providers.gradleProperty("openverifyDemoArtifacts").orElse("sdk").get()
    .split(',').map(String::trim).filter(String::isNotEmpty).toSet()
require("sdk" in demoArtifacts && demoArtifacts.all { it in setOf("sdk", "nfc", "face") }) {
    "openverifyDemoArtifacts is sdk, sdk,nfc, sdk,face or sdk,nfc,face (C218.1), not '${demoArtifacts.joinToString(",")}'"
}

// The configuration's name, as its allowlist file is named (C215.3): `sdk`, `sdk-nfc`, `sdk-face` or
// `sdk-nfc-face`.
val demoConfiguration: String = listOf("sdk", "nfc", "face").filter { it in demoArtifacts }.joinToString("-")

// C214.5: each configuration resolves other libraries (JMRTD and Bouncy Castle with `nfc`, ONNX Runtime
// with `face`), and a lockfile must name exactly what is resolved, so each configuration has its own:
// gradle.lockfile for `sdk` (the default, as before), gradle-<configuration>.lockfile for the others.
// Written per configuration by `./gradlew :demo-app:resolveAndLockAll --write-locks
// -PopenverifyDemoArtifacts=<artifacts>`, from a fresh GRADLE_USER_HOME (android/build.gradle.kts).
dependencyLocking {
    lockFile.set(layout.projectDirectory.file(if (demoConfiguration == "sdk") "gradle.lockfile" else "gradle-$demoConfiguration.lockfile"))
}

// C218.1, KP10-45: one hook per optional artifact, which DemoComponents asks for the artifact's
// component. The hook of an artifact this build includes is in src/<artifact>/kotlin (owned by the
// artifact's builder: it calls the artifact's public factory); otherwise the stub in
// src/without<Artifact>/kotlin answers null, so the demo's main sources compile in every
// configuration and name no optional artifact themselves.
// C209.6 (decision 48): the reader-check mode lives in src/readerCheck (nfc-reader's), compiled into
// the `debug` build type only and only with `nfc`: release and minifiedSmoke never hold it.
android {
    sourceSets {
        getByName("main") {
            kotlin.srcDir(if ("nfc" in demoArtifacts) "src/nfc/kotlin" else "src/withoutNfc/kotlin")
            kotlin.srcDir(if ("face" in demoArtifacts) "src/face/kotlin" else "src/withoutFace/kotlin")
        }
        if ("nfc" in demoArtifacts) {
            getByName("debug") {
                kotlin.srcDir("src/readerCheck/kotlin")
                res.srcDir("src/readerCheck/res")
                manifest.srcFile("src/readerCheck/AndroidManifest.xml")
            }
        }
    }
}

android {
    defaultConfig {
        buildConfigField("String", "OPENVERIFY_DEMO_ARTIFACTS", "\"$demoConfiguration\"")
    }
}

// C205.2 (Workflow 10E Stage 1a): openverify-face removes ONNX Runtime's telemetry provider for every
// host, but leaves ONNX Runtime's ACCESS_NETWORK_STATE to the host, which alone knows whether another
// of its libraries needs it (review P10). The demo, as a host, removes it, with the overlay
// src/face/AndroidManifest.xml (face-onnx's), merged into every variant of a build with `face`.
if ("face" in demoArtifacts) {
    androidComponents {
        onVariants { variant -> variant.sources.manifests.addStaticManifestFile("src/face/AndroidManifest.xml") }
    }
}

/** Hands a host test the merged manifest of the `release` build as a system property (C215.3). */
class ReleaseManifestArgument(
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    val manifest: Provider<RegularFile>,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> =
        listOf("-Dopenverify.demo.releaseManifest=${manifest.get().asFile.absolutePath}")
}

androidComponents {
    // C215.3 (review P21): MergedManifestTest compares what a host ships, the `release` build's merged
    // manifest, with android/demo-app/manifest-allowlist/<configuration>.json.
    onVariants(selector().withBuildType("release")) { variant ->
        val manifest = variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.MERGED_MANIFEST)
        tasks.withType<Test>().configureEach {
            jvmArgumentProviders.add(ReleaseManifestArgument(manifest))
        }
    }
}

tasks.withType<Test>().configureEach {
    systemProperty("openverify.demo.configuration", demoConfiguration)
    // The minifiedSmoke variant's host tests are the smoke test's host twins only (src/testMinifiedSmoke,
    // C215.2); everything else runs once, on the debug variant.
    if (name == "testMinifiedSmokeUnitTest") {
        filter { includeTestsMatching("dev.openverify.demo.smoke.*") }
    }
}

// The gate runs `testDebugUnitTest`; the smoke test's host twins need the non-debuggable variant, so
// they run after it in the same call, whether or not a debug test failed.
tasks.matching { it.name == "testDebugUnitTest" }.configureEach {
    finalizedBy("testMinifiedSmokeUnitTest")
}

dependencies {
    implementation(project(":openverify-sdk"))
    if ("nfc" in demoArtifacts) {
        implementation(project(":openverify-nfc"))
    }
    if ("face" in demoArtifacts) {
        implementation(project(":openverify-face"))
    }

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    // The session survives rotation in a ViewModel, never in saved state (1B F026).
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.vintage.engine)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.androidx.compose.ui.test.manifest)

    // C215.2 (review V01): the minifiedSmoke smoke device test starts a loopback MockWebServer over TLS,
    // with an okhttp-tls HeldCertificate generated at run time. Device-test scope only (demo-app writes
    // the test).
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.okhttp.mockwebserver3)
    androidTestImplementation(libs.okhttp.tls)
}

// KP10-32 (Workflow 10D): the smoke device test's APK is built against the app's classes as they were
// before R8, and at run time it reads from the minified app every library class the two share
// (androidx.tracing, the Kotlin standard library, OkHttp, Okio, ...). R8 removes from the app what the
// app does not call, so the runner died on its first shared class and no test started. This check
// traces, with the R8 that minified both (AGP's own, no dependency of ours), every class, field and
// method the test APK refers to and fails when the minified app's APK lacks one. It needs no device,
// and `assembleMinifiedSmokeAndroidTest` (the gate's device-test compile) runs it.

/**
 * Why a reference of the test APK may be absent from the minified app: the name is not the app's.
 * Each line is a package prefix and what provides it, or why nothing does and nothing needs to.
 */
val smokeReferencesOutsideTheApp: Map<String, String> = mapOf(
    "android.test." to "the platform's android.test library, which the JUnit 3 path of the runner names and this test never takes",
    "androidx.test.internal.runner.hidden." to "AndroidX Test's own stand-in for a hidden platform method, which the platform resolves at run time",
    "androidx.concurrent.futures.SuspendToFutureAdapter" to "the screenshot path of androidx.test:core (ViewCapture, DeviceCapture) wants " +
        "concurrent-futures-ktx 1.2.0; the app ships 1.1.0, a device test's runtime classpath takes the app's version, and this test takes no screenshot",
)

abstract class CheckSmokeTestReferences : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val testApk: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val appApk: DirectoryProperty

    @get:Classpath
    abstract val platform: ConfigurableFileCollection

    @get:Input
    abstract val outsideTheApp: MapProperty<String, String>

    @get:OutputFile
    abstract val report: RegularFileProperty

    private fun apkOf(folder: DirectoryProperty): Path =
        folder.get().asFile.listFiles { file -> file.name.endsWith(".apk") }!!.single().toPath()

    /** Every class, field and method the dex files of [apks] refer to that neither they nor the platform define. */
    private fun undefinedIn(apks: List<Path>): Set<String> {
        val missing = TreeSet<String>()
        val quiet = object : DiagnosticsHandler {
            // A missing definition arrives through the consumer below; the handler's copy of it is
            // not an error of this task.
            override fun error(diagnostic: Diagnostic) = Unit
            override fun warning(diagnostic: Diagnostic) = Unit
            override fun info(diagnostic: Diagnostic) = Unit
        }
        val consumer = object : TraceReferencesConsumer {
            override fun acceptType(traced: TraceReferencesConsumer.TracedClass, handler: DiagnosticsHandler) {
                if (traced.isMissingDefinition) missing += traced.reference.typeName
            }

            override fun acceptField(traced: TraceReferencesConsumer.TracedField, handler: DiagnosticsHandler) {
                if (traced.isMissingDefinition) missing += "${traced.reference.holderClass.typeName}#${traced.reference.fieldName}"
            }

            override fun acceptMethod(traced: TraceReferencesConsumer.TracedMethod, handler: DiagnosticsHandler) {
                if (traced.isMissingDefinition) missing += "${traced.reference.holderClass.typeName}#${traced.reference.methodName}()"
            }
        }
        // No target: R8 reads a target as class files, and an APK holds dex. With the APKs as the
        // sources, whatever they name outside themselves and the platform is reported as missing.
        TraceReferences.run(
            TraceReferencesCommand.builder(quiet)
                .addLibraryFiles(platform.files.map { it.toPath() })
                .addSourceFiles(apks)
                .setConsumer(consumer)
                .build(),
        )
        return missing
    }

    @TaskAction
    fun check() {
        val app = apkOf(appApk)
        // What the app itself names and does not hold (optional providers its libraries probe for)
        // is not the test's doing; the rest of what the two APKs lack together is.
        val lacking = undefinedIn(listOf(app, apkOf(testApk))) - undefinedIn(listOf(app))
        val allowed = outsideTheApp.get().keys
        val unexplained = lacking.filter { name: String -> allowed.none { prefix -> name.startsWith(prefix) } }
        report.get().asFile.writeText(unexplained.joinToString("\n", postfix = "\n"))
        if (unexplained.isNotEmpty()) {
            throw GradleException(
                "The smoke device test's APK refers to ${unexplained.size} classes or members the minified app lacks " +
                    "(the runner would die on the first one it reaches; KP10-32). The first: " +
                    unexplained.take(10).joinToString("; ") + ". All of them: ${report.get().asFile}",
            )
        }
    }
}

/**
 * The keep rules of the smoke build for what its device test's APK shares with the app (KP10-32).
 * The source is stated, not guessed: R8's own reference tracer reads the test's classes and its
 * test-only libraries as they are before minification and writes one rule per class, field and method
 * of the app's classpath they name. A rule keeps the name too: with renaming allowed, the test APK's
 * own R8 pass (which applies the app's mapping) left one call to a renamed method unrenamed
 * (kotlin.coroutines.jvm.internal.DebugProbesKt.probeCoroutineSuspended). Nothing else is kept, so the
 * SDK and the demo's screen stay as in release.
 */
abstract class TraceSmokeTestKeepRules : DefaultTask() {
    @get:Classpath
    abstract val appJars: ListProperty<RegularFile>

    @get:Classpath
    abstract val appFolders: ListProperty<Directory>

    @get:Classpath
    abstract val testJars: ListProperty<RegularFile>

    @get:Classpath
    abstract val testFolders: ListProperty<Directory>

    @get:Classpath
    abstract val platform: ConfigurableFileCollection

    /** Package prefixes no rule may name: their names survive only by the SDK's consumer rules (C215.1). */
    @get:Input
    abstract val neverKept: ListProperty<String>

    @get:OutputFile
    abstract val rules: RegularFileProperty

    private fun classFiles(jars: ListProperty<RegularFile>, folders: ListProperty<Directory>): List<Path> =
        jars.get().map { it.asFile.toPath() } +
            folders.get().flatMap { folder -> folder.asFileTree.matching { include("**/*.class") }.files.sorted().map { it.toPath() } }

    @TaskAction
    fun trace() {
        val target = classFiles(appJars, appFolders)
        val shared = target.toSet()
        val source = classFiles(testJars, testFolders).filter { it !in shared }
        val text = StringBuilder()
        val handler = object : DiagnosticsHandler {
            // A name the test's libraries probe for and nothing provides is not a rule to write.
            override fun error(diagnostic: Diagnostic) = Unit
            override fun warning(diagnostic: Diagnostic) = Unit
            override fun info(diagnostic: Diagnostic) = Unit
        }
        TraceReferences.run(
            TraceReferencesCommand.builder(handler)
                .addLibraryFiles(platform.files.map { it.toPath() })
                .addSourceFiles(source)
                .addTargetFiles(target)
                .setConsumer(
                    TraceReferencesKeepRules.builder()
                        .setOutputConsumer { part, _ -> text.append(part) }
                        .build(),
                )
                .build(),
        )
        val kept = Regex("^-keep\\S* (?:@interface|class|interface|enum) (\\S+)", RegexOption.MULTILINE).findAll(text).map { it.groupValues[1] }.toSortedSet()
        // A kept class that is package-private (the Kotlin standard library's file facades, for one)
        // keeps its access, so R8 must not move its subclasses and callers to another package: the
        // phone answered IllegalAccessError for kotlin.collections.CollectionsKt__IterablesKt. The
        // packages keep their names; their other classes are still renamed, merged or removed.
        val packages = kept.map { it.substringBeforeLast('.', "") }.filter(String::isNotEmpty).toSortedSet()
        text.append("-keeppackagenames ").append(packages.joinToString(",")).append("\n")
        rules.get().asFile.writeText(text.toString())
        val named = kept.filter { name -> neverKept.get().any(name::startsWith) && !name.startsWith(SMOKE_PACKAGE) }.sorted()
        if (named.isNotEmpty()) {
            throw GradleException(
                "The smoke device test names ${named.joinToString()} in the app, so a keep rule would name it: " +
                    "the test may touch only the smoke package and the libraries it shares with the app (KP10-32, C215.1).",
            )
        }
    }

    private companion object {
        /** The launcher's package, which the smoke build's committed rule already keeps whole. */
        const val SMOKE_PACKAGE = "dev.openverify.demo.smoke."
    }
}

androidComponents {
    onVariants(selector().withBuildType("minifiedSmoke")) { variant ->
        val androidTest = requireNotNull(variant.androidTest) { "minifiedSmoke is the tested build type (C215.2)" }
        val check = tasks.register<CheckSmokeTestReferences>("checkSmokeTestReferences") {
            description = "Fails when the minified app lacks something its device test's APK refers to (KP10-32)."
            group = "verification"
            testApk.set(androidTest.artifacts.get(SingleArtifact.APK))
            appApk.set(variant.artifacts.get(SingleArtifact.APK))
            platform.from(androidComponents.sdkComponents.bootClasspath)
            outsideTheApp.set(smokeReferencesOutsideTheApp)
            report.set(layout.buildDirectory.file("reports/smoke-test-references/missing.txt"))
        }
        tasks.matching { it.name == "assembleMinifiedSmokeAndroidTest" }.configureEach { dependsOn(check) }

        val keepRules = tasks.register<TraceSmokeTestKeepRules>("traceSmokeTestKeepRules") {
            description = "Writes the smoke build's keep rules for what its device test shares with the app (KP10-32)."
            platform.from(androidComponents.sdkComponents.bootClasspath)
            neverKept.set(listOf("dev.openverify.sdk.", "dev.openverify.demo.", "kotlinx.serialization."))
            rules.set(layout.buildDirectory.file("generated/smoke-test-keep-rules/rules.pro"))
        }
        variant.artifacts.forScope(ScopedArtifacts.Scope.ALL).use(keepRules)
            .toGet(ScopedArtifact.CLASSES, TraceSmokeTestKeepRules::appJars, TraceSmokeTestKeepRules::appFolders)
        androidTest.artifacts.forScope(ScopedArtifacts.Scope.ALL).use(keepRules)
            .toGet(ScopedArtifact.CLASSES, TraceSmokeTestKeepRules::testJars, TraceSmokeTestKeepRules::testFolders)
        variant.proguardFiles.add(keepRules.flatMap { it.rules })
    }
}
