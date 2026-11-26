// C217.3 (Workflow 10C, release-checks): the consumer check. A host app that depends on the published
// coordinates and nothing else of this repository, built from the staged repository:
//
//     (cd android && ./gradlew publishAllPublicationsToStagingRepository && ./gradlew -p consumer-check build)
//
// `build` proves, in this order:
// 1. checkStagedRepository: the staged repository is complete (android/scripts/check-staged-repository.py);
// 2. checkConsumerResolution: `dev.openverify:openverify-sdk` (the root KMP module) resolves for an
//    Android consumer to the Android target's AAR, from the staged repository, although the root's
//    Gradle metadata also names iOS variants that are not published in this release (C217.1);
// 3. the consumer's source compiles against the published AAR and R8 minifies the app (release only);
// 4. checkConsumerRules: R8 read the SDK's consumer rules out of that AAR and kept what they keep
//    (android/scripts/check-consumer-rules.py).
// It installs and runs nothing: whether the minified app works on a device is the demo's smoke test.
import java.util.Properties

// As in the parent build: AGP 9 compiles Kotlin itself, and this raises its Kotlin plugin to the
// catalog's version, which is the one the published SDK was compiled with.
buildscript {
    dependencies {
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.application)
}

val openverify = Properties().apply { file("../gradle.properties").inputStream().use(::load) }
val openverifyGroup: String = openverify.getProperty("openverifyGroup")
val openverifyVersion: String = openverify.getProperty("openverifyVersion")

android {
    namespace = "dev.openverify.consumercheck"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "dev.openverify.consumercheck"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = openverifyVersion
    }

    packaging {
        resources {
            // The one line a host of openverify-nfc must write (Workflow 10E): Bouncy Castle's two jars
            // each carry the same MIT licence text at this path, and the packager refuses two files at
            // one path. One copy is kept.
            pickFirsts += "META-INF/LICENSE.md"
        }
    }

    buildTypes {
        release {
            // As a host that minifies: R8 full mode (AGP's default), with no rule of its own for the SDK.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

// Only the minified release variant is built: the debug variant would prove nothing more.
androidComponents {
    beforeVariants { variant -> variant.enable = variant.buildType == "release" }
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(libs.versions.jvmToolchain.get().toInt())
    }
}

// C214.5: locked and verified like the parent build (gradle.lockfile, gradle/verification-metadata.xml,
// both written from a fresh GRADLE_USER_HOME). The OpenVerify group itself is trusted there without a
// checksum: its artifacts are built by the call before this one and change with every commit.
dependencyLocking {
    lockAllConfigurations()
    // What is being checked is not locked: its version is the parent build's openverifyVersion.
    ignoredDependencies.add("$openverifyGroup:*")
}

dependencies {
    // The root module, never `openverify-sdk-android`: resolving it is the proof.
    implementation("$openverifyGroup:openverify-sdk:$openverifyVersion")
    // The optional artifacts, as a host that adds both (Workflow 10E; KP10-44): openverify-nfc's POM
    // brings JMRTD, SCUBA, cert-cvc and Bouncy Castle, and openverify-face's brings ONNX Runtime, all
    // locked and verified here as in the parent build.
    implementation("$openverifyGroup:openverify-nfc:$openverifyVersion")
    implementation("$openverifyGroup:openverify-face:$openverifyVersion")
    // No androidx.activity line: the SDK's published POM gives it at scope compile (C214.4), because
    // OpenVerifyInquiry.Contract extends its ActivityResultContract. ConsumerActivity uses both.
}

// Lint is the parent build's gate (`./gradlew lint`); here it would only re-check five lines.
tasks.configureEach {
    if (name.startsWith("lint")) enabled = false
}

val checkStagedRepository = tasks.register<Exec>("checkStagedRepository") {
    description = "The staged repository is complete: files, checksums, POMs, Gradle metadata, nothing for iOS (C217.2, C217.3)."
    group = "verification"
    commandLine("python3", "-I", "../scripts/check-staged-repository.py")
}

abstract class CheckConsumerResolution : DefaultTask() {
    @get:Input
    abstract val mavenGroup: Property<String>

    @get:Input
    abstract val mavenVersion: Property<String>

    /** `group:module:version` of every module whose artifact the release runtime classpath resolved. */
    @get:Input
    abstract val resolved: SetProperty<String>

    @TaskAction
    fun check() {
        val group = mavenGroup.get()
        val version = mavenVersion.get()
        // The root module `openverify-sdk` holds no artifact for Android: its metadata sends an Android
        // consumer on to `openverify-sdk-android`. The settings file lets the group come from the staged
        // repository only, so these two can have come from nowhere else.
        val ours = resolved.get().filter { it.startsWith("$group:") }.toSet()
        val wanted = setOf("$group:openverify-sdk-android:$version", "$group:openverify-nfc:$version", "$group:openverify-face:$version")
        if (ours != wanted) {
            throw GradleException("C217.3: an Android consumer of $group:openverify-sdk resolved $ours, not $wanted")
        }
        val ios = resolved.get().filter { "ios" in it.substringAfter(':').substringBefore(':').lowercase() }
        if (ios.isNotEmpty()) {
            throw GradleException("C217.1: an Android consumer resolved iOS modules: $ios")
        }
        logger.lifecycle("consumer check: $group:openverify-sdk:$version resolved to ${wanted.joinToString()} from the staged repository; ${resolved.get().size} modules in all, none for iOS")
    }
}

val checkConsumerResolution = tasks.register<CheckConsumerResolution>("checkConsumerResolution") {
    description = "The root module resolves for an Android consumer to the staged Android AAR, with no iOS variant (C217.1, C217.3)."
    group = "verification"
    mavenGroup.set(openverifyGroup)
    mavenVersion.set(openverifyVersion)
    resolved.set(
        configurations.named("releaseRuntimeClasspath").flatMap { it.incoming.artifacts.resolvedArtifacts }.map { results ->
            results.mapNotNull { result ->
                (result.id.componentIdentifier as? ModuleComponentIdentifier)?.let { "${it.group}:${it.module}:${it.version}" }
            }.toSet()
        },
    )
    mustRunAfter(checkStagedRepository)
}

val checkConsumerRules = tasks.register<Exec>("checkConsumerRules") {
    description = "R8 read the SDK's consumer rules from the published AAR and kept what they keep (C215.1, C215.4)."
    group = "verification"
    dependsOn("assembleRelease")
    commandLine("python3", "-I", "../scripts/check-consumer-rules.py", "--consumer", layout.buildDirectory.dir("outputs/mapping/release").get().asFile.path)
}

tasks.named("preBuild") { mustRunAfter(checkStagedRepository) }
tasks.named("check") { dependsOn(checkStagedRepository, checkConsumerResolution, checkConsumerRules) }
