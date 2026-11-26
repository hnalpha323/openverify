# C215.2: a rule of the minifiedSmoke build type only. The smoke device test's APK is built against
# the minified app, and R8 removes or inlines what the app itself does not use, so the smoke package
# (the launcher, its report and its trust, which exist only in this build) is kept whole for the test.
# Nothing of the SDK or of the demo's own screen is kept here: R8 minifies them exactly as in release,
# under the SDK's consumer rules alone (C215.1).
#
# KP10-32 (Workflow 10D): the test's APK also reads from the app, at run time, every library class
# the two share (androidx.tracing, the Kotlin standard library, OkHttp, Okio, coroutines). Those rules
# are not written here by hand: the task traceSmokeTestKeepRules (build.gradle.kts) traces them with
# R8 from the test's own classes at every build of this build type, and refuses to write one that
# names the SDK, the demo's screen or kotlinx.serialization.
-keep class dev.openverify.demo.smoke.** { *; }
