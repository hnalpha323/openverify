package dev.openverify.sdk.fixtures

/**
 * The text of the shared golden fixture at [path] under `contracts/fixtures`, such as
 * `flow-spec/pattern-vectors.json` (C196.4; reviews H14, F01). `commonTest` has no classpath, so each
 * platform reads it its own way: the Android host test from the test classpath that Gradle puts
 * `contracts/fixtures` on, iOS through `platform.posix` from the directory named by
 * [CONTRACT_FIXTURES_DIRECTORY_VARIABLE].
 *
 * @throws IllegalStateException when the fixture is missing, naming only [path].
 */
internal expect fun readContractFixture(path: String): String

/** The environment variable naming the `contracts/fixtures` directory on iOS (the simulator, next release). */
internal const val CONTRACT_FIXTURES_DIRECTORY_VARIABLE: String = "OPENVERIFY_CONTRACT_FIXTURES"
