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
        // C261.1 (Workflow 11C Stage 1a, spike (c)): the CycloneDX Gradle plugin is published on the
        // Gradle Plugin Portal only, so the portal serves its two groups and nothing else.
        gradlePluginPortal {
            content {
                includeGroup("org.cyclonedx.bom")
                includeGroup("org.cyclonedx")
            }
        }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
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

rootProject.name = "openverify-android"

include(":openverify-sdk")
include(":openverify-nfc")
include(":openverify-face")
include(":demo-app")
