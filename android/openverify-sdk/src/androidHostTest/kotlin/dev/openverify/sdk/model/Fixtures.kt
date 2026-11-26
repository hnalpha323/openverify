package dev.openverify.sdk.model

import java.io.File
import java.net.URL
import java.nio.file.FileSystems
import java.nio.file.Files

/**
 * Reads the shared golden fixtures (`contracts/fixtures`), which the Gradle build adds to the
 * unit-test classpath as resources.
 */
internal object Fixtures {
    private val loader: ClassLoader = Fixtures::class.java.classLoader!!

    fun read(path: String): String = url(path).readText()

    /** The `.json` files directly inside [dir], as classpath paths such as `api/inquiry.json`. */
    fun list(dir: String): List<String> {
        val url = url(dir)
        val names = when (url.protocol) {
            "file" -> File(url.toURI()).listFiles().orEmpty().map { it.name }
            "jar" -> FileSystems.newFileSystem(url.toURI(), emptyMap<String, Any>()).use { fs ->
                Files.list(fs.getPath(dir)).use { paths -> paths.map { it.fileName.toString() }.toList() }
            }
            else -> error("Unsupported fixture location: ${url.protocol}")
        }
        return names.filter { it.endsWith(".json") }.sorted().map { "$dir/$it" }
    }

    private fun url(path: String): URL =
        checkNotNull(loader.getResource(path)) { "Fixture $path is not on the test classpath" }
}
