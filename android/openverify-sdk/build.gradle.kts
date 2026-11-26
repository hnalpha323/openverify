import kotlinx.kover.gradle.plugin.dsl.AggregationType
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit
import java.util.Locale

// A Kotlin Multiplatform library (docs/plans/kmp-migration.plan.md): Android now, iOS later.
// Code that needs no platform API lives in src/commonMain; Android code in src/androidMain;
// the iOS actuals in src/iosMain, compiled on Linux but never linked or published before Phase 10.
plugins {
    // C261.1 (Workflow 11C Stage 1a): this module's CycloneDX SBOM (`cyclonedxBom`).
    alias(libs.plugins.cyclonedx)
    // The root buildscript puts the Kotlin Gradle plugin on the classpath (the demo-app's built-in
    // Kotlin needs it), so this plugin is applied by id, without a version.
    id("org.jetbrains.kotlin.multiplatform")
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlin.compose)
    // Compose Multiplatform resources (Res.string); the UI libraries come from the catalog.
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kover)
    // The KMP library plugin adds no lint task of its own; this one adds `lint` and `lintAndroidMain`.
    alias(libs.plugins.android.lint)
    // C217.2 (Workflow 10C, spike (d)): the publications with their sources and javadoc jars.
    alias(libs.plugins.maven.publish)
    alias(libs.plugins.dokka)
}

// C214.3: the generated commonMain constant OPENVERIFY_SDK_VERSION, from android/gradle.properties'
// openverifyVersion. FlowHttp's User-Agent carries it (C193.7).
val generateSdkVersion = tasks.register("generateSdkVersion") {
    description = "Writes the commonMain constant OPENVERIFY_SDK_VERSION from the openverifyVersion property."
    val version = providers.gradleProperty("openverifyVersion")
    val output = layout.buildDirectory.dir("generated/openverify/commonMain/kotlin")
    inputs.property("version", version)
    outputs.dir(output)
    doLast {
        val file = output.get().file("dev/openverify/sdk/SdkVersion.kt").asFile
        file.parentFile.mkdirs()
        file.writeText(
            "package dev.openverify.sdk\n\n" +
                "/** The SDK's version, generated from android/gradle.properties' openverifyVersion (C214.3). */\n" +
                "internal const val OPENVERIFY_SDK_VERSION: String = \"${version.get()}\"\n",
        )
    }
}

// C199.4 (KP10-5, Workflow 10B contracts-10b): generateSdkStringTables writes the SDK's per-locale string
// tables (i18n/SdkStringTables.kt: sdkStringTable(language) and one table per language) from
// src/commonMain/composeResources/values*/*.xml into a generated commonMain source directory, so every
// compilation (the Android target, the metadata and the iOS klibs) depends on it and no strings commit
// regenerates a shared file by hand; it never writes under src/ (Workflow 10A Stage 1b amendment 7). It
// reads each folder as Compose Multiplatform 1.11.1's converter does (the XML's text content, then its \n,
// \t, \uXXXX and \\ escapes), by resource name, in the SDK's language order. SdkStringTablesTest holds the
// output to an independent reading of the same files and checks that the tables and Compose resolve every
// string and plural alike in all five languages. (Inline here: Android lint's analysis fails on a
// separately applied Kotlin script that registers it.)
val generateSdkStringTables = tasks.register("generateSdkStringTables") {
    group = "openverify"
    description = "Writes the SDK's per-locale string tables from composeResources into a generated commonMain source directory (C199.4)."
    // The SDK's languages with their resource folders, in SDK_LANGUAGES' order (i18n/LanguageChoice.kt).
    val languages: List<Pair<String, String>> = listOf("en" to "values", "es" to "values-es", "fr" to "values-fr", "de" to "values-de", "ar" to "values-ar")
    val resourcesDir: File = file("src/commonMain/composeResources")
    val outputDir: File = layout.buildDirectory.dir("generated/openverify/sdkStringTables/commonMain/kotlin").get().asFile
    outputs.dir(outputDir)
    inputs.files(fileTree(resourcesDir) { include("values*/*.xml") }).withPropertyName("resources").withPathSensitivity(PathSensitivity.RELATIVE)
    // generateLocaleStrings writes strings_catalog.xml under src/, which this task reads.
    mustRunAfter("generateLocaleStrings")
    doLast {
        val folders = resourcesDir.listFiles { file -> file.isDirectory && file.name.startsWith("values") }.orEmpty().map { it.name }.sorted()
        if (folders.toSet() != languages.map { it.second }.toSet()) {
            throw GradleException("generateSdkStringTables: composeResources holds $folders, not the five SDK locale folders")
        }

        // One string or plural by name: its text (null for a plural) and a plural's items by quantity.
        fun resources(folder: String): Map<String, Pair<String?, Map<String, String>>> =
            File(resourcesDir, folder).listFiles { file -> file.extension == "xml" }.orEmpty().sortedBy { it.name }.flatMap { file ->
                val root = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
                (0 until root.childNodes.length).map(root.childNodes::item).filterIsInstance<org.w3c.dom.Element>().map { element ->
                    val name = element.getAttribute("name")
                    if (element.tagName == "plurals") {
                        val items = element.getElementsByTagName("item")
                        name to Pair<String?, Map<String, String>>(null, (0 until items.length).map { items.item(it) as org.w3c.dom.Element }.associate { it.getAttribute("quantity") to it.textContent })
                    } else {
                        name to Pair<String?, Map<String, String>>(element.textContent, emptyMap())
                    }
                }
            }.toMap()

        /** Compose Multiplatform 1.11.1's handleSpecialCharacters: \n, \t and \uXXXX unless their backslash is escaped, then \\. */
        fun converted(text: String): String {
            val escapedBackslashes = Regex("""\\\\""").findAll(text).map { it.range.first }.toSet()
            val handled = Regex("""\\u[a-fA-F\d]{4}|\\n|\\t""").replace(text) { match ->
                if (match.range.first - 1 in escapedBackslashes) {
                    match.value
                } else {
                    when (match.value) {
                        "\\n" -> "\n"
                        "\\t" -> "\t"
                        else -> match.value.substring(2).toInt(16).toChar().toString()
                    }
                }
            }
            return handled.replace("\\\\", "\\")
        }

        /** [text] as a Kotlin string literal: backslash, quote, dollar and control or format characters escaped. */
        fun literal(text: String): String = buildString {
            append('"')
            for (character in text) {
                when {
                    character == '\\' -> append("\\\\")
                    character == '"' -> append("\\\"")
                    character == '$' -> append("\\$")
                    character == '\n' -> append("\\n")
                    character == '\t' -> append("\\t")
                    character == '\r' -> append("\\r")
                    Character.isISOControl(character) || Character.getType(character) == Character.FORMAT.toInt() ||
                        Character.isSurrogate(character) -> append(String.format(Locale.ROOT, "\\u%04x", character.code))
                    else -> append(character)
                }
            }
            append('"')
        }

        fun objectName(language: String): String = "SdkStrings" + language.replaceFirstChar { it.uppercaseChar() }

        // SdkPluralCategory's order (i18n/SdkStrings.kt).
        val categories = listOf("ZERO", "ONE", "TWO", "FEW", "MANY", "OTHER")
        val source = buildString {
            append("// Generated by :openverify-sdk:generateSdkStringTables from src/commonMain/composeResources/values*/*.xml\n")
            append("// (openverify-sdk/build.gradle.kts); a build output, never committed or edited.\n")
            append("package dev.openverify.sdk.i18n\n")
            append("\n")
            append("/**\n")
            append(" * C199.4: the SDK's strings and plurals in each of its five languages, as Compose Multiplatform\n")
            append(" * reads them from `composeResources`, so `sdkString` and `sdkPlural` resolve the SDK's chosen\n")
            append(" * language per composition without changing the JVM default or the host's configuration. Null\n")
            append(" * for a language the SDK does not bundle.\n")
            append(" */\n")
            append("internal fun sdkStringTable(language: String): SdkStringTable? = when (language) {\n")
            for ((language, _) in languages) append("    \"$language\" -> ${objectName(language)}.table\n")
            append("    else -> null\n}\n")
            for ((language, folder) in languages) {
                val all = resources(folder)
                append('\n')
                append("private object ${objectName(language)} {\n")
                append("    internal val table: SdkStringTable = SdkStringTable(\n")
                append("        strings = mapOf(\n")
                for ((name, resource) in all.filter { it.value.first != null }.toSortedMap()) {
                    append("            ${literal(name)} to ${literal(converted(resource.first!!))},\n")
                }
                append("        ),\n")
                append("        plurals = mapOf(\n")
                for ((name, resource) in all.filter { it.value.first == null }.toSortedMap()) {
                    append("            ${literal(name)} to mapOf(\n")
                    val items = resource.second.mapKeys { (quantity, _) -> quantity.uppercase(Locale.ROOT) }
                    val unknown = items.keys - categories.toSet()
                    if (unknown.isNotEmpty()) throw GradleException("generateSdkStringTables: $name in $folder has the quantities $unknown")
                    for (category in categories) {
                        val text = items[category] ?: continue
                        append("                SdkPluralCategory.$category to ${literal(converted(text))},\n")
                    }
                    append("            ),\n")
                }
                append("        ),\n")
                append("    )\n")
                append("}\n")
            }
        }
        val output = File(outputDir, "dev/openverify/sdk/i18n/SdkStringTables.kt")
        output.parentFile.mkdirs()
        output.writeText(source)
    }
}

// Golden JSON fixtures shared with the TypeScript and Python sides (PLAN Phase 1, C8).
val contractFixtures: File = rootProject.file("../contracts/fixtures")

kotlin {
    // C214.2 (decision 39): every public declaration says so, with its type; the ABI dump holds them.
    explicitApi()
    // C214.2, spike (b): KGP's ABI validation dumps the Android target (api/android/openverify-sdk.api)
    // and the iOS klibs (api/openverify-sdk.klib.api); `updateKotlinAbi` writes them, `checkKotlinAbi`
    // compares them, and AbiDumpTest holds them to api/expected-public.txt. The Compose compiler's
    // generated declarations are not API: their names change with every composable.
    @OptIn(org.jetbrains.kotlin.gradle.dsl.abi.ExperimentalAbiValidation::class)
    abiValidation {
        filters {
            exclude {
                byNames.add("**.ComposableSingletons**")
                byNames.add("**${"$"}stableprop")
                byNames.add("**${"$"}stableprop_getter")
            }
        }
    }
    jvmToolchain(libs.versions.jvmToolchain.get().toInt())

    android {
        namespace = "dev.openverify.sdk"
        compileSdk = libs.versions.compileSdk.get().toInt()
        minSdk = libs.versions.minSdk.get().toInt()
        // The verification activity's window theme, and the strings until they move to
        // composeResources. The KMP DSL has no resourcePrefix: every Android resource the SDK
        // adds is merged into the host app, so its names keep the OpenVerify/openverify_ prefix.
        androidResources {
            enable = true
        }
        withHostTest {
            // Robolectric resolves the SDK's own string resources.
            isIncludeAndroidResources = true
        }
        withDeviceTest {
            // Device tests (src/androidDeviceTest) need a device: they compile locally and run in CI.
            instrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        }
        // C215.1 (decision 41): the SDK's consumer R8 rules travel in its AAR, so a host needs none of
        // its own. release-checks fills consumer-rules.pro and proves it on the minified demo.
        optimization {
            consumerKeepRules.publish = true
            consumerKeepRules.file("consumer-rules.pro")
        }
    }

    // Compiled on Linux by `assemble` (main and test klibs); simulator tests and linking need macOS.
    // No iosX64: it is tier 3 in Kotlin 2.4, and Compose Multiplatform 1.11 dropped Apple x86_64.
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain {
            kotlin.srcDir(generateSdkVersion)
            kotlin.srcDir(generateSdkStringTables)
        }
        // Every commonMain dependency publishes iosArm64 and iosSimulatorArm64 variants.
        commonMain.dependencies {
            implementation(libs.compose.mp.runtime)
            implementation(libs.compose.mp.foundation)
            implementation(libs.compose.mp.ui)
            implementation(libs.compose.mp.material3)
            implementation(libs.compose.mp.components.resources)
            implementation(libs.jetbrains.lifecycle.viewmodel)
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.ktor.client.core)
            // C214.1: used directly (kotlinx.io.Buffer, kotlinx.io.IOException), at the version Ktor resolves.
            implementation(libs.kotlinx.io.core)
        }
        androidMain.dependencies {
            // The BOM pins the Jetpack Compose that Compose Multiplatform resolves to on Android.
            implementation(project.dependencies.platform(libs.androidx.compose.bom))
            implementation(libs.androidx.compose.ui)
            implementation(libs.androidx.compose.foundation)
            implementation(libs.androidx.compose.material3)
            // C214.4: api, because OpenVerifyInquiry.Contract extends androidx.activity's
            // ActivityResultContract; at scope runtime a host that declares no androidx.activity of its
            // own could not compile against the published SDK (check-staged-repository.py holds it).
            api(libs.androidx.activity.compose)
            implementation(libs.androidx.lifecycle.runtime.compose)

            implementation(libs.androidx.camera.core)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.compose)
            // C203 (decision 20): PDF417 "barcode found" guidance behind the internal BarcodeReader seam
            // (pdf417-guidance's androidMain capture/barcode/); its own consumer rule travels in its AAR.
            implementation(libs.zxing.cpp.android)

            implementation(libs.kotlinx.coroutines.android)
            implementation(libs.ktor.client.okhttp)
            // C214.4 (review V11): OpenVerifyAndroidTransport.okHttp(OkHttpClient) is public, so OkHttp is
            // part of the SDK's ABI and an api dependency; a new OkHttp major is a breaking SDK change.
            api(libs.okhttp)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
            // C214.1: ReviewImage.ios.kt decodes with Skia's Image, at the version Compose Multiplatform resolves.
            implementation(libs.skiko)
        }
        // Runs inside testAndroidHostTest now, and on the iOS simulator once macOS CI exists.
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.ktor.client.mock)
            implementation(libs.kotlinx.coroutines.test)
        }
        getByName("androidHostTest") {
            // The contract tests read contracts/fixtures/{api,flows,problems,mrz,flow}/*.json from
            // the classpath.
            resources.srcDir(contractFixtures)
            dependencies {
                // JUnit 5 for plain JVM tests; the Vintage engine runs the Robolectric (JUnit 4)
                // tests on the same platform.
                implementation(project.dependencies.platform(libs.junit.bom))
                implementation(libs.junit.jupiter)
                runtimeOnly(libs.junit.vintage.engine)
                runtimeOnly(libs.junit.platform.launcher)
                implementation(libs.kotlinx.coroutines.test)
                implementation(libs.okhttp.mockwebserver3)
                // C256.2, C258.3 (Workflow 11A Stage 1a; KP11-1): HeldCertificate for the pinning
                // recipe's host test over a TLS MockWebServer. Host-test scope only, never published;
                // the artifact 10C pinned for the demo's device tests, at the okhttp version.
                implementation(libs.okhttp.tls)
                implementation(libs.robolectric)
                implementation(libs.androidx.test.core)
                implementation(libs.androidx.test.ext.junit)
                implementation(project.dependencies.platform(libs.androidx.compose.bom))
                implementation(libs.androidx.compose.ui.test.junit4)
                implementation(libs.androidx.compose.ui.test.manifest)
                // C219.3, C212.2 (spike (c)): Robolectric screenshots in the tagged screenshotTest task,
                // with Google's Accessibility Test Framework run on every golden. Test scope only.
                implementation(libs.roborazzi)
                implementation(libs.roborazzi.compose)
                implementation(libs.roborazzi.junit.rule)
                implementation(libs.roborazzi.accessibility.check)
            }
        }
        getByName("androidDeviceTest").dependencies {
            implementation(libs.androidx.test.runner)
            implementation(libs.androidx.test.rules)
            implementation(libs.androidx.test.ext.junit)
            // Raises compose ui-test's Espresso 3.5.0, which cannot run on Android 16 or later (see the catalog).
            implementation(libs.androidx.test.espresso.core)
            implementation(project.dependencies.platform(libs.androidx.compose.bom))
            implementation(libs.androidx.compose.ui.test.junit4)
            implementation(libs.androidx.compose.ui.test.manifest)
            // C212.2: Compose's own accessibility checks raise nothing under Robolectric (spike (c)),
            // so they are a device-test tool.
            implementation(libs.androidx.compose.ui.test.junit4.accessibility)
        }
    }
}

compose.resources {
    // Res stays internal to the SDK, in a package of its own (K5).
    publicResClass = false
    packageOfResClass = "dev.openverify.sdk.generated.resources"
}

// C214.6, C191.2 (ADR 0009): :openverify-sdk stays Apache-2.0 and depends on no optional artifact. This
// check fails when a resolved classpath of the SDK (Android runtime, the iOS klibs) names an optional
// artifact (openverify-nfc, openverify-face, openverify-integrity-play, as a project or a module),
// JMRTD, SCUBA, cert-cvc, Bouncy Castle, ONNX Runtime or a com.google.android.play module.
// :openverify-sdk:assemble and check run it.
val checkDependencyBoundary = tasks.register("checkDependencyBoundary") {
    description = "Fails when the SDK's resolved classpaths name an optional artifact or a library reserved for one (C214.6)."
    group = "verification"
    val roots = listOf("androidRuntimeClasspath", "iosArm64CompileKlibraries", "iosSimulatorArm64CompileKlibraries")
        .map { name -> name to configurations.named(name).flatMap { it.incoming.resolutionResult.rootComponent } }
    // The extension point (Workflow 10A Stage 1b amendment 13; review F18): beside the three names the
    // plan fixes, every module the build includes other than the SDK and the demo is an optional
    // artifact, so a module added later (openverify-face, 10E) is refused here without a second check.
    val included = rootProject.subprojects.map { it.name }.filterNot { it == project.name || it == "demo-app" }
    doLast {
        val optional = setOf("openverify-nfc", "openverify-face", "openverify-integrity-play") + included
        val groups = listOf("org.jmrtd", "net.sf.scuba", "org.ejbca.cvc", "org.bouncycastle", "com.microsoft.onnxruntime", "com.google.android.play")
        fun refused(id: org.gradle.api.artifacts.component.ComponentIdentifier): Boolean = when (id) {
            is org.gradle.api.artifacts.component.ProjectComponentIdentifier -> id.projectPath.substringAfterLast(':') in optional
            is org.gradle.api.artifacts.component.ModuleComponentIdentifier ->
                id.module in optional || groups.any { id.group == it || id.group.startsWith("$it.") }
            else -> false
        }
        val found = sortedSetOf<String>()
        roots.forEach { (name, root) ->
            val seen = mutableSetOf<org.gradle.api.artifacts.result.ResolvedComponentResult>()
            val pending = ArrayDeque(listOf(root.get()))
            while (pending.isNotEmpty()) {
                val component = pending.removeFirst()
                if (!seen.add(component)) continue
                if (refused(component.id)) found += "$name: ${component.id.displayName}"
                component.dependencies.filterIsInstance<org.gradle.api.artifacts.result.ResolvedDependencyResult>().forEach { pending += it.selected }
            }
        }
        if (found.isNotEmpty()) {
            throw GradleException("C214.6: :openverify-sdk must not depend on an optional artifact or a library reserved for one:\n" + found.joinToString("\n"))
        }
    }
}
tasks.matching { it.name == "assemble" || it.name == "check" }.configureEach { dependsOn(checkDependencyBoundary) }

// The JUnit tags of the tests that run outside testAndroidHostTest (Workflow 10A Stage 1b). A
// Robolectric (JUnit 4) test is tagged by @Category(<marker>::class), which the Vintage engine
// reports as the marker's fully qualified name; a JUnit 5 test by @Tag("stack").
// The markers are in src/androidHostTest/kotlin/dev/openverify/sdk/testing/TestCategories.kt.
val screenshotTag = "dev.openverify.sdk.testing.ScreenshotTests"
val stackTags = listOf("dev.openverify.sdk.testing.StackTests", "stack")

/** A Test task over testAndroidHostTest's compiled tests and classpath, which the KMP plugin registers late. */
fun Test.overHostTests() {
    val host = tasks.named<Test>("testAndroidHostTest").get()
    testClassesDirs = host.testClassesDirs
    classpath = host.classpath
}

// C219.3 (spike (c)): the screenshot tests in their own task, with Roborazzi's runtime libraries and
// no Roborazzi Gradle plugin. Comparison is on unless -Proborazzi.test.record=true is given, so a
// missing or different golden fails (`-Proborazzi.test.verify=true` in Validation and CI says the
// same). Goldens are written only by that explicit record call, under
// src/androidHostTest/screenshots/<owner>/.
val screenshotTest = tasks.register<Test>("screenshotTest") {
    description = "Runs the Roborazzi screenshot tests (JUnit tag $screenshotTag) and verifies their goldens."
    group = "verification"
    overHostTests()
    useJUnitPlatform { includeTags(screenshotTag) }
    val record = providers.gradleProperty("roborazzi.test.record").orNull == "true"
    systemProperty("roborazzi.test.record", record.toString())
    systemProperty("roborazzi.test.verify", (!record).toString())
    systemProperty("roborazzi.test.compare", "false")
    // Roborazzi reads the goldens by path: they are inputs, so a changed golden reruns the task, and a
    // record call is never up to date or taken from the build cache.
    inputs.dir("src/androidHostTest/screenshots").withPropertyName("goldens").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.property("record", record)
    if (record) {
        outputs.upToDateWhen { false }
        outputs.cacheIf { false }
    }
}

// C224.4: the SDK's own FlowApiClient and driver against the reusable e2e stack, run only under the
// e2e lock (rule 7 (c)) and never in CI (integration-10a's AndroidFlowStackTest). It reads the
// reusable stack's record (e2e/.artifacts/stack.json, mode 0600: the API URL and the seeded
// credentials, never printed) and the 10A flow every client drives (e2e/fixtures/android-10a/);
// since 10C also the NFC flow (e2e/fixtures/android-10c/).
// The stack is outside Gradle's knowledge, so the task never counts as up to date.
tasks.register<Test>("stackTest") {
    description = "Runs the SDK against the reusable e2e stack (JUnit tags $stackTags); only under the e2e lock."
    group = "verification"
    overHostTests()
    useJUnitPlatform { includeTags(*stackTags.toTypedArray()) }
    val e2e = rootProject.layout.projectDirectory.dir("../e2e")
    systemProperty("openverify.e2e.stackRecord", e2e.file(".artifacts/stack.json").asFile.absolutePath)
    systemProperty("openverify.e2e.androidFlow", e2e.file("fixtures/android-10a/flow.json").asFile.absolutePath)
    // C224.4 (Workflow 10C): the 10C NFC flow of AndroidNfcFlowStackTest, a fixture of its own; its
    // generated inputs are named from the repository root.
    systemProperty("openverify.e2e.androidNfcFlow", e2e.file("fixtures/android-10c/flow.json").asFile.absolutePath)
    // C287.4 (Workflow 11A integration-11a): the client-side redemption of AndroidConnectFlowStackTest,
    // a fixture of its own (both organisations' flows).
    systemProperty("openverify.e2e.androidConnectFlow", e2e.file("fixtures/android-11a/flow.json").asFile.absolutePath)
    systemProperty("openverify.e2e.repositoryRoot", rootProject.layout.projectDirectory.dir("..").asFile.absolutePath)
    outputs.upToDateWhen { false }
    outputs.cacheIf { false }
}

// Rule 17's finer split of the Android gate's call (a), for when one call would not fit 10 minutes
// with the 240 s lock wait: -PhostTestGroup=ui, flow or rest runs one third of the host tests; the
// three counts add up to the whole suite. Without the property, every host test runs.
val hostTestGroup: String? = providers.gradleProperty("hostTestGroup").orNull
require(hostTestGroup == null || hostTestGroup in setOf("ui", "flow", "rest")) { "hostTestGroup is ui, flow or rest" }

tasks.withType<Test>().matching { it.name == "testAndroidHostTest" }.configureEach {
    useJUnitPlatform { excludeTags(screenshotTag, *stackTags.toTypedArray()) }
    // Files the host tests read from disk rather than the classpath (the source scans, the ABI dumps
    // and their list, the version property; since 10C the privacy checks' module table with the build
    // files, lockfile and manifests it reads, and the documents the docs tests hold to the code), so a
    // change to one of them reruns the tests.
    inputs.files(
        fileTree("src") { include("commonMain/**", "androidMain/**", "iosMain/**") },
        fileTree("api"),
        fileTree("../openverify-nfc/api"),
        file("../gradle.properties"),
        file("build.gradle.kts"),
        file("gradle.lockfile"),
        file("README.md"),
        file("../settings.gradle.kts"),
        file("../size-baseline.json"),
        file("../openverify-nfc/build.gradle.kts"),
        fileTree("../openverify-nfc/src/main"),
        // Workflow 10E: the face module, and each optional artifact's exception table (KP10-42).
        fileTree("../openverify-face/api"),
        file("../openverify-face/build.gradle.kts"),
        fileTree("../openverify-face/src/main"),
        fileTree("../openverify-nfc/src/test/resources/privacy"),
        fileTree("../openverify-face/src/test/resources/privacy"),
        file("../demo-app/build.gradle.kts"),
        file("../demo-app/src/main/AndroidManifest.xml"),
        file("../../docs/android/privacy.md"),
        file("../../docs/android/sizes.md"),
        file("../../docs/android/failure-reasons.md"),
        file("../../docs/android/accessibility.md"),
        fileTree("../../docs/accessibility") { include("android-audit-*.md") },
        fileTree("src/androidHostTest/screenshots"),
    ).withPropertyName("sourcesTheTestsRead").withPathSensitivity(PathSensitivity.RELATIVE)
    filter {
        when (hostTestGroup) {
            "ui" -> includeTestsMatching("dev.openverify.sdk.ui.*")
            "flow" -> includeTestsMatching("dev.openverify.sdk.flow.*")
            "rest" -> {
                excludeTestsMatching("dev.openverify.sdk.ui.*")
                excludeTestsMatching("dev.openverify.sdk.flow.*")
            }
        }
    }
}

// The 10A build tasks (review F18): each is registered here and configured by the script its
// builder owns, which finds the task by name. A script not written yet leaves a task that fails.
// - generateLocaleStrings (C199.1), android-i18n's: strings_catalog.xml in the five locale folders.
// - exportConsentTexts (C200.3), api-android-10a's: the SDK's consent texts as rows of the server's table.
listOf(
    "generateLocaleStrings" to "scripts/generate-locale-strings.gradle.kts",
    "exportConsentTexts" to "scripts/export-consent-texts.gradle.kts",
).forEach { (taskName, scriptPath) ->
    val registered = tasks.register(taskName) { group = "openverify" }
    val script = file(scriptPath)
    if (script.exists()) {
        apply(from = script)
    } else {
        registered.configure { doLast { throw GradleException("$taskName: $scriptPath is not written yet") } }
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    // Robolectric's android-36 sandbox reads FileDescriptor internals through
    // jdk.internal.access, which JDK 17+ does not export by default.
    jvmArgs(
        "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
        "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
    )
}

// Each owner's Kover exclusions, one file per owner, each line a class pattern (review F18): an owner
// names its glue there in its own file, never in this shared build file, and lists each line in its
// TDD file for review (C219.2).
val koverOwnerExclusions: List<String> = fileTree("kover-excludes") { include("*.txt") }.files.sorted().flatMap { file ->
    file.readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
}

kover {
    currentProject {
        instrumentation {
            // The line gate measures testAndroidHostTest; the screenshot and stack tasks are not part of it.
            disabledForTestTasks.addAll("screenshotTest", "stackTest")
        }
    }
    reports {
        filters {
            excludes {
                // Compose UI is exercised by the Robolectric screen tests, but it is not part of
                // this JVM line-coverage gate, which measures the SDK's logic.
                annotatedBy(
                    "androidx.compose.runtime.Composable",
                    "androidx.compose.ui.tooling.preview.Preview",
                )
                classes(
                    "*.ComposableSingletons*",
                    // CameraX glue: it needs camera hardware, so JVM tests use FakeCaptureCamera.
                    // The image processing it calls (ImageEncoding) is covered.
                    "dev.openverify.sdk.camera.CameraXCaptureCamera*",
                    // Res and its accessors, generated by the Compose Multiplatform resources plugin.
                    "dev.openverify.sdk.generated.resources.*",
                )
                classes(koverOwnerExclusions)
                androidGeneratedClasses()
            }
        }
        verify {
            rule("openverify-sdk line coverage") {
                bound {
                    minValue = 80
                    coverageUnits = CoverageUnit.LINE
                    aggregationForGroup = AggregationType.COVERED_PERCENTAGE
                }
            }
        }
    }
}

// C217 (Workflow 10C Stage 1a, contracts-10c; spike (d)): the publication skeleton. The root KMP module
// and its Android target only: nothing is published for iOS in this release (C217.1, decision 44), so
// the iOS publications' tasks are disabled below. No signing and no upload: the staged repository
// under android/build/staging-repo/ is the release until the owner's namespace and keys exist (P4,
// C217.3, C217.5). release-checks owns this block from here (the consumer check, the Gradle metadata
// test, the checksums' validation).
group = providers.gradleProperty("openverifyGroup").get()
version = providers.gradleProperty("openverifyVersion").get()

mavenPublishing {
    coordinates(providers.gradleProperty("openverifyGroup").get(), "openverify-sdk", providers.gradleProperty("openverifyVersion").get())
    pom {
        name.set("OpenVerify SDK")
        description.set("OpenVerify's identity-verification flow for Android: the server decides every step and every outcome; the SDK renders and reports.")
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
        // C217.3: `./gradlew publishAllPublicationsToStagingRepository` writes a complete local Maven
        // repository here (POMs, Gradle metadata, sources, javadoc, checksums). Never committed.
        maven {
            name = "staging"
            url = uri(rootProject.layout.buildDirectory.dir("staging-repo"))
        }
    }
}

// C217.1: only the root module (`kotlinMultiplatform`) and the Android target (`android`) are published.
// The iOS targets' publish tasks are skipped by name (`publishIosArm64Publication...`), which is all the
// configuration cache lets a task predicate read.
tasks.withType<AbstractPublishToMaven>().configureEach {
    val forIos = name.startsWith("publishIos")
    onlyIf("C217.1: nothing is published for iOS in this release") { !forIos }
}

// C261.1 (Workflow 11C Stage 1a, spike (c)): the SBOM lists what the published artifact's consumers
// resolve at run time (androidRuntimeClasspath), never the test, lint or iOS configurations. The plugin's
// aggregate `cyclonedxBom` reads this direct SBOM; the output is build/reports/cyclonedx/bom.json.
tasks.named<org.cyclonedx.gradle.CyclonedxDirectTask>("cyclonedxDirectBom") {
    includeConfigs.set(listOf("androidRuntimeClasspath"))
}
