// C217.3 (Workflow 10C, release-checks): a host app as a stranger would write it, built against the
// staged repository (android/build/staging-repo/) and nothing else of this build. Run it after
// `./gradlew publishAllPublicationsToStagingRepository`, from android/:
//
//     ./gradlew -p consumer-check build
//
// It is a build of its own (its own settings, lock state and verification metadata), so it cannot see
// :openverify-sdk as a project: every OpenVerify class it compiles against comes from the staged
// AARs, through the root module's Gradle metadata.
import java.util.Properties

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

// The group and version are the parent build's (android/gradle.properties), read here so that the
// consumer asks for exactly what was staged.
val openverify = Properties().apply { file("../gradle.properties").inputStream().use(::load) }
val openverifyGroup: String = openverify.getProperty("openverifyGroup")

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // The staged repository answers for the OpenVerify group, and only it does: a module of that
        // group can come from nowhere else, and nothing else can come from the staged repository.
        exclusiveContent {
            forRepository {
                maven {
                    name = "staging"
                    url = uri("../build/staging-repo")
                }
            }
            filter { includeGroup(openverifyGroup) }
        }
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
    // The parent build's catalog, so the consumer builds with the same AGP, Kotlin and SDK levels.
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "openverify-consumer-check"
