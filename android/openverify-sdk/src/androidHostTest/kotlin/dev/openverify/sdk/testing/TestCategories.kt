package dev.openverify.sdk.testing

/**
 * The JUnit tags of the tests that run outside `testAndroidHostTest` (Workflow 10A Stage 1b;
 * `build.gradle.kts` holds the same names). A Robolectric (JUnit 4) test class is tagged with
 * `@Category(<marker>::class)`, which the JUnit Vintage engine reports as the marker's fully
 * qualified name; a JUnit 5 test with `@Tag(STACK_TAG)`.
 */

/** C219.3: a screenshot test. It runs only in `:openverify-sdk:screenshotTest`, which verifies its goldens. */
internal interface ScreenshotTests

/** C224.4: a test of the SDK against the reusable e2e stack. It runs only in `:openverify-sdk:stackTest`. */
internal interface StackTests

/** The JUnit 5 tag of a stack test (C224.4). */
internal const val STACK_TAG: String = "stack"
