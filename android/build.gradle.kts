// AGP 9 compiles Kotlin itself ("built-in Kotlin"), so org.jetbrains.kotlin.android
// is intentionally NOT applied anywhere. AGP 9 depends on KGP 2.2.10 at runtime;
// the classpath entry below raises it to the catalog's Kotlin version, following
// the "Upgrade to a higher KGP version" section of the AGP 9.0 release notes.
// The demo-app's built-in Kotlin needs it, and because of it :openverify-sdk applies
// org.jetbrains.kotlin.multiplatform by id, without a version.
buildscript {
    dependencies {
        classpath(libs.kotlin.gradle.plugin)
    }
    // C261.1 (Workflow 11C Stage 1a, spike (c)): the CycloneDX plugin's maven-core brings Guice 5.1.0,
    // which brings aopalliance 1.0 under a "Public Domain" declaration that rule 4 does not list. The
    // plugin builds every SBOM without it (THIRD_PARTY_LICENSES.md, Excluded components).
    configurations.classpath {
        exclude(group = "aopalliance", module = "aopalliance")
        // C259.2 (Workflow 11C, integration-11c): osv-scanner reported high advisories in the build
        // plugins' classpath (AGP's, Dokka's and the publishing plugins' transitive libraries; build
        // tooling, never in an AAR or APK). Each is moved to its fixed release, at least 14 days old with
        // its licence unchanged (THIRD_PARTY_LICENSES.md 2.1.23). The project configurations' floors are
        // below; this block is compiled before the rest of the script, so it lists its own.
        resolutionStrategy.force(
            "org.jdom:jdom2:2.0.6.1",
            "org.bitbucket.b_c:jose4j:0.9.6",
            "com.fasterxml.jackson.core:jackson-core:2.22.3",
            "com.fasterxml.jackson.core:jackson-databind:2.22.3",
            "com.google.guava:guava:33.7.2-jre",
            "org.bouncycastle:bcprov-jdk18on:1.85",
            "org.freemarker:freemarker:2.3.35",
        )
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.kotlin.multiplatform.library) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.kover) apply false
    alias(libs.plugins.maven.publish) apply false
    alias(libs.plugins.dokka) apply false
    alias(libs.plugins.cyclonedx) apply false
}

// C214.5 (decision 67; Phase 11 hardening item 7): every resolvable configuration of every project is
// locked to the versions in its committed gradle.lockfile, so a dependency can change only by a
// commit that changes the lockfile, and Phase 11's scanners read the resolved tree. A configuration
// Linux never creates (the iOS link configurations, which need macOS) has no lock state and stays
// unlocked (the default lock mode); the next release's macOS job writes theirs (C223). Whoever adds a
// dependency refreshes the lockfiles and gradle/verification-metadata.xml in the same commit:
// ./gradlew --no-daemon resolveAndLockAll --write-locks, then each Android gate call with
// --write-verification-metadata sha256 (docs/tdd/phase10-foundation-10a.tdd.md, checkpoint 4), from a fresh
// GRADLE_USER_HOME: a warm cache skips metadata a CI runner downloads (docs/tdd/phase10-orchestrator.tdd.md).
allprojects {
    dependencyLocking {
        lockAllConfigurations()
    }
}

// C259.2 (Workflow 11C, integration-11c): osv-scanner reported critical and high advisories in
// build-tooling and test configurations only: AGP 9.4.1's lint (androidLintTool: bcprov, guava), Dokka's
// HTML generator (FreeMarker, jsoup, Jackson) and the SDK's host and device test runtimes (protobuf-javalite,
// jsoup, guava). None is in a published module's release runtime classpath. Each is raised to its fixed
// release as a floor (a configuration that resolves a newer version keeps it; the flavour suffix of guava,
// -jre or -android, is kept), every release at least 14 days old with its licence unchanged
// (THIRD_PARTY_LICENSES.md 2.1.23). Jackson moves as one family (annotations has no patch level since 2.20).
val toolingFloors: Map<String, String> = mapOf(
    "org.bouncycastle:bcprov-jdk18on" to "1.85", // the fixed release the test classpaths already use
    "com.google.guava:guava" to "33.7.2",
    "org.freemarker:freemarker" to "2.3.35",
    "org.jsoup:jsoup" to "1.23.2",
    "com.google.protobuf:protobuf-javalite" to "3.25.5",
)
val jacksonFloor = "2.22.3"

fun versionParts(version: String): List<Int> =
    version.substringBefore('-').split('.').map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

fun isBelow(version: String, floor: String): Boolean {
    val a = versionParts(version)
    val b = versionParts(floor)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x < y
    }
    return false
}

fun toolingFloorOf(group: String, name: String, version: String?): String? {
    if (version.isNullOrEmpty() || version.any { it in "[]()+,*" }) return null
    if (group.startsWith("com.fasterxml.jackson")) {
        val floor = if (name == "jackson-annotations") jacksonFloor.substringBeforeLast('.') else jacksonFloor
        return floor.takeIf { isBelow(version, it) }
    }
    val floor = toolingFloors["$group:$name"] ?: return null
    if (!isBelow(version, floor)) return null
    // Guava releases before 22.0 have no flavour (guava:20.0); their successor is the -jre one.
    val flavour = version.substringAfter('-', "").ifEmpty { if (name == "guava") "jre" else "" }
    return if (flavour.isEmpty()) floor else "$floor-$flavour"
}

allprojects {
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            toolingFloorOf(requested.group, requested.name, requested.version)?.let { fixed ->
                useVersion(fixed)
                because("C259.2: the fixed release of an advisory osv-scanner reported (Workflow 11C)")
            }
        }
    }
}

// Writes each project's lock state without building: `./gradlew resolveAndLockAll --write-locks` (with
// `--write-verification-metadata sha256` for the checksums) after a dependency change. Each project
// resolves only its own configurations.
allprojects {
    tasks.register("resolveAndLockAll") {
        description = "Resolves every resolvable configuration of this project, for --write-locks (C214.5)."
        notCompatibleWithConfigurationCache("resolves the project's configurations at execution time")
        doFirst {
            require(gradle.startParameter.isWriteDependencyLocks) { "resolveAndLockAll runs only with --write-locks" }
        }
        doLast {
            // The graph is what the lock state records; resolving files would need an artifact view per variant.
            project.configurations.filter { it.isCanBeResolved }.forEach { it.incoming.resolutionResult.rootComponent.get() }
        }
    }
}
