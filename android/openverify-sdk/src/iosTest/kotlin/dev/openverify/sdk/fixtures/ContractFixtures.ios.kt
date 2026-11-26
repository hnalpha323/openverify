package dev.openverify.sdk.fixtures

import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.allocArray
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.readBytes
import kotlinx.cinterop.toKString
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.getenv

/**
 * On iOS (the simulator, next release) the fixture is read through `platform.posix` from the
 * directory that [CONTRACT_FIXTURES_DIRECTORY_VARIABLE] names. It compiles on Linux now (C196.4).
 */
@OptIn(ExperimentalForeignApi::class)
internal actual fun readContractFixture(path: String): String {
    val directory = getenv(CONTRACT_FIXTURES_DIRECTORY_VARIABLE)?.toKString()
        ?: error("Contract fixture $path: $CONTRACT_FIXTURES_DIRECTORY_VARIABLE is not set")
    val file = fopen("$directory/$path", "rb") ?: error("Contract fixture $path is missing")
    try {
        val bytes = ArrayList<Byte>()
        memScoped {
            val chunk = 4096
            val buffer = allocArray<ByteVar>(chunk)
            while (true) {
                val read = fread(buffer, 1u, chunk.toULong(), file).toInt()
                if (read <= 0) break
                bytes.addAll(buffer.readBytes(read).toList())
            }
        }
        return bytes.toByteArray().decodeToString()
    } finally {
        fclose(file)
    }
}
