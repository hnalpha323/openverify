package dev.openverify.face

import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.File

/**
 * Reads the names of the loaded classes out of a heap dump in the HPROF binary format (the format
 * `android.os.Debug.dumpHprofData` writes). Only two record kinds are read, and the heap itself is
 * skipped: a `STRING` record (tag 1) gives an id its text, and a `LOAD CLASS` record (tag 2) names a
 * loaded class by such an id.
 */
internal object HprofClassNames {
    private const val STRING = 1
    private const val LOAD_CLASS = 2

    /** The loaded classes' names that [wanted] accepts, with dots between packages. */
    fun read(dump: File, wanted: (String) -> Boolean): Set<String> {
        val strings = HashMap<Long, String>()
        val classNameIds = ArrayList<Long>()
        DataInputStream(BufferedInputStream(dump.inputStream(), 1 shl 16)).use { input ->
            // The header: a version string ending in a zero byte, the size of an id, a timestamp.
            while (input.readByte().toInt() != 0) Unit
            val idSize = input.readInt()
            input.readLong()
            fun id(): Long = if (idSize == 4) input.readInt().toLong() and 0xFFFFFFFFL else input.readLong()
            while (true) {
                val tag = input.read()
                if (tag < 0) break
                input.readInt()
                val length = input.readInt().toLong() and 0xFFFFFFFFL
                when (tag) {
                    STRING -> {
                        val key = id()
                        val bytes = ByteArray((length - idSize).toInt())
                        input.readFully(bytes)
                        val text = String(bytes, Charsets.UTF_8).replace('/', '.')
                        if (wanted(text)) strings[key] = text
                    }
                    LOAD_CLASS -> {
                        input.readInt()
                        id()
                        input.readInt()
                        classNameIds += id()
                    }
                    else -> skip(input, length)
                }
            }
        }
        return classNameIds.mapNotNull { strings[it] }.toSet()
    }

    private fun skip(input: DataInputStream, bytes: Long) {
        var left = bytes
        while (left > 0) {
            val skipped = input.skip(left)
            if (skipped > 0) {
                left -= skipped
            } else {
                input.readByte()
                left -= 1
            }
        }
    }
}
