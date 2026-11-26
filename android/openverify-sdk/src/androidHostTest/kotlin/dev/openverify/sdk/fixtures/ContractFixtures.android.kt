package dev.openverify.sdk.fixtures

/** The Android host test reads the fixture from the classpath, which Gradle puts `contracts/fixtures` on. */
internal actual fun readContractFixture(path: String): String {
    val loader = checkNotNull(Thread.currentThread().contextClassLoader ?: ClassLoader.getSystemClassLoader())
    val url = loader.getResource(path) ?: error("Contract fixture $path is not on the test classpath")
    return url.readText()
}
