package dev.openverify.sdk.api

/**
 * The OpenVerify API's base URL, parsed strictly in common code (contract C1): `http` or
 * `https`, a host, an optional port and an optional path prefix, and nothing else. Plain http is
 * allowed only for the local development hosts.
 *
 * It accepts what OkHttp's `HttpUrl` accepted, with one exception: a host that is not ASCII is
 * refused, and must be written in its `xn--` form (decision 3). `ApiBaseUrlParityTest` holds
 * the two parsers to that.
 */
internal class ApiBaseUrl private constructor(
    /** `http` or `https`. */
    val scheme: String,
    /** The canonical host: lower-case, and an IPv6 address without its brackets. */
    val host: String,
    /** The port, the scheme's default when the URL names none. */
    val port: Int,
    /** The path prefix, `[""]` for `/`, as `HttpUrl.encodedPathSegments` holds it. */
    val encodedPathSegments: List<String>,
) {
    /**
     * The URL of [segments] under the path prefix, as `HttpUrl.addPathSegment` built it: the
     * prefix's trailing slash, if any, gives way to the first segment. The segments are used as
     * they are, so they must be plain unreserved text: the clients pass constants and validated IDs.
     */
    fun resolve(vararg segments: String): String {
        val path = encodedPathSegments.toMutableList()
        for (segment in segments) {
            if (path.last().isEmpty()) path[path.lastIndex] = segment else path += segment
        }
        return httpOrigin(scheme, host, port) + "/" + path.joinToString("/")
    }

    /** The canonical URL, as `HttpUrl.toString` prints it. */
    override fun toString(): String = httpOrigin(scheme, host, port) + "/" + encodedPathSegments.joinToString("/")

    companion object {
        /** Hosts that may use plain http: the developer's machine and the emulator's alias for it. */
        private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")

        /** @throws IllegalArgumentException for anything but an http(s) API base URL. */
        fun parse(value: String): ApiBaseUrl {
            val url = requireNotNull(HttpUrlParts.parse(value)) { "apiBaseUrl must be an absolute http(s) URL" }
            require(url.isAsciiHost) { IDN_HOST_REFUSED }
            require(url.encodedQuery == null && url.encodedFragment == null) { "apiBaseUrl must not have a query or a fragment" }
            require(!url.hasCredentials) { CREDENTIALS_REFUSED }
            require(url.scheme == "https" || url.host in LOCAL_HOSTS) {
                "apiBaseUrl must use https; plain http is allowed only for localhost and 10.0.2.2"
            }
            // HttpUrl sent such a path as it was, but Ktor's Url refuses it, so no request could be made.
            require(url.encodedPathSegments.none(::hasMalformedEscape)) { "apiBaseUrl's path may use '%' only in %XX escapes" }
            return ApiBaseUrl(url.scheme, url.host, url.port, url.encodedPathSegments)
        }

        private fun hasMalformedEscape(segment: String): Boolean = segment.indices.any { i ->
            segment[i] == '%' && (i + 2 >= segment.length || segment[i + 1].hexValue() == -1 || segment[i + 2].hexValue() == -1)
        }

        const val IDN_HOST_REFUSED =
            "apiBaseUrl must have an ASCII host: write an internationalized domain name in its xn-- (punycode) form"
        const val CREDENTIALS_REFUSED = "apiBaseUrl must not contain credentials"
    }
}

/** `scheme://host[:port]`, with an IPv6 host in brackets and no default port. */
internal fun httpOrigin(scheme: String, host: String, port: Int): String {
    val authority = if (':' in host) "[$host]" else host
    return "$scheme://$authority" + if (port == defaultPort(scheme)) "" else ":$port"
}

private fun defaultPort(scheme: String): Int = if (scheme == "https") 443 else 80

/**
 * An http(s) URL split the way OkHttp's `HttpUrl` splits it (WHATWG-style): surrounding
 * whitespace is ignored, `\` counts as `/`, tabs and newlines drop out of the path, the host
 * is percent-decoded and canonicalised, and the path's dot segments are resolved. It differs
 * on one point: a host that is not ASCII is kept as written, with [isAsciiHost] false, instead
 * of being converted to punycode.
 */
internal class HttpUrlParts private constructor(
    /** `http` or `https`. */
    val scheme: String,
    /** Whether a user name or a password precedes the host (an empty `@` is neither). */
    val hasCredentials: Boolean,
    /** Canonical when [isAsciiHost]; otherwise percent-decoded but as written. */
    val host: String,
    val isAsciiHost: Boolean,
    val port: Int,
    val encodedPathSegments: List<String>,
    /** The query after `?`, `null` without one. */
    val encodedQuery: String?,
    /** The fragment after `#` without tabs and newlines, `null` without one. */
    val encodedFragment: String?,
) {
    companion object {
        /** `null` when [input] is not an absolute http(s) URL with a valid host and port. */
        fun parse(input: String): HttpUrlParts? {
            var pos = 0
            var limit = input.length
            while (pos < limit && input[pos] in ASCII_WHITESPACE) pos++
            while (limit > pos && input[limit - 1] in ASCII_WHITESPACE) limit--

            val schemeColon = schemeColon(input, pos, limit)
            if (schemeColon == -1) return null
            val scheme = input.substring(pos, schemeColon).lowercase()
            if (scheme != "http" && scheme != "https") return null
            pos = schemeColon + 1

            // Any number of slashes, either way, before the authority.
            while (pos < limit && (input[pos] == '/' || input[pos] == '\\')) pos++
            val authorityEnd = input.indexOfAny("/\\?#", pos, limit)

            // User info ends at the authority's last '@'. Only an empty one, '' or ':', is no credential.
            val at = input.lastIndexOf('@', authorityEnd - 1).takeIf { it >= pos }
            val hasCredentials = at != null && input.substring(pos, at).filterNot { it in TABS_AND_NEWLINES } !in setOf("", ":")
            val hostStart = if (at != null) at + 1 else pos

            val portColon = portColon(input, hostStart, authorityEnd)
            val port = if (portColon + 1 < authorityEnd) parsePort(input.substring(portColon + 1, authorityEnd)) else defaultPort(scheme)
            val host = canonicalHost(percentDecode(input, hostStart, portColon)) ?: return null
            if (port == null) return null

            val pathEnd = input.indexOfAny("?#", authorityEnd, limit)
            val path = parsePath(input, authorityEnd, pathEnd)
            val queryEnd = input.indexOfAny("#", pathEnd, limit)
            val query = if (pathEnd < limit && input[pathEnd] == '?') input.substring(pathEnd + 1, queryEnd) else null
            val fragment = if (queryEnd < limit) canonicalize(input, queryEnd + 1, limit, encodeSet = "", keepUnicode = true) else null
            return HttpUrlParts(scheme, hasCredentials, host.first, host.second, port, path, query, fragment)
        }

        /** The index of the ':' that ends a scheme starting at [pos], or -1. */
        private fun schemeColon(input: String, pos: Int, limit: Int): Int {
            if (limit - pos < 2 || !input[pos].isAsciiLetter()) return -1
            for (i in pos + 1 until limit) {
                val c = input[i]
                when {
                    c == ':' -> return i
                    c.isAsciiLetter() || c in '0'..'9' || c == '+' || c == '-' || c == '.' -> continue
                    else -> return -1
                }
            }
            return -1
        }

        /** The first ':' outside an IPv6 literal's brackets, or [limit]. */
        private fun portColon(input: String, pos: Int, limit: Int): Int {
            var i = pos
            while (i < limit) {
                when (input[i]) {
                    '[' -> while (i + 1 < limit && input[i + 1] != ']') i++
                    ':' -> return i
                }
                i++
            }
            return limit
        }

        /** 1 to 65535 in ASCII digits, which may carry a sign as `Integer.parseInt` allows; `null` otherwise. */
        private fun parsePort(text: String): Int? {
            if (text.any { it !in '0'..'9' && it != '+' && it != '-' }) return null
            return text.toIntOrNull()?.takeIf { it in 1..65535 }
        }

        /**
         * The canonical host and whether it is ASCII: an IPv6 address in RFC 5952 form (an
         * IPv4-mapped one as IPv4), or a lower-cased name with valid characters and label
         * lengths. A name that is not ASCII is returned as it is. `null` for an invalid host.
         */
        private fun canonicalHost(host: String): Pair<String, Boolean>? {
            if (':' in host) {
                val bracketed = host.startsWith("[") && host.endsWith("]")
                val address = decodeIpv6(if (bracketed) host.substring(1, host.length - 1) else host) ?: return null
                return ipv6ToText(address) to true
            }
            if (host.any { it.code >= 0x80 }) {
                // An IDN: kept for a link whose API base URL is given, refused as an API base URL.
                return if (host.any { it.code < 0x80 && it.isInvalidHostCharacter() }) null else host to false
            }
            val name = host.lowercase()
            if (name.isEmpty() || name.any { it.isInvalidHostCharacter() } || !name.hasValidLabelLengths()) return null
            return name to true
        }

        /** Controls, DEL and the characters WHATWG forbids in a host. */
        private fun Char.isInvalidHostCharacter(): Boolean = code <= 0x1f || code >= 0x7f || this in " #%/:?@[\\]"

        /** 1 to 253 characters, in labels of 1 to 63; a trailing '.' is allowed. */
        private fun String.hasValidLabelLengths(): Boolean {
            if (length !in 1..253) return false
            var labelStart = 0
            while (true) {
                val dot = indexOf('.', labelStart)
                val labelLength = (if (dot == -1) length else dot) - labelStart
                if (labelLength !in 1..63) return false
                if (dot == -1 || dot == length - 1) return true
                labelStart = dot + 1
            }
        }

        /** The path's segments, absolute, with dot segments resolved, tabs and newlines dropped and characters escaped. */
        private fun parsePath(input: String, pos: Int, limit: Int): List<String> {
            val segments = mutableListOf("")
            if (pos == limit) return segments
            // After the authority a path starts with '/' or '\'.
            var i = pos + 1
            while (i < limit) {
                val end = input.indexOfAny("/\\", i, limit)
                val hasTrailingSlash = end < limit
                pushSegment(segments, canonicalize(input, i, end, PATH_SEGMENT_ENCODE_SET, keepUnicode = false), hasTrailingSlash)
                i = if (hasTrailingSlash) end + 1 else end
            }
            return segments
        }

        private fun pushSegment(segments: MutableList<String>, segment: String, addTrailingSlash: Boolean) {
            when (segment.lowercase()) {
                ".", "%2e" -> return
                "..", "%2e.", ".%2e", "%2e%2e" -> {
                    val removed = segments.removeAt(segments.lastIndex)
                    // The path keeps a trailing '/'.
                    if (removed.isEmpty() && segments.isNotEmpty()) segments[segments.lastIndex] = "" else segments += ""
                    return
                }
            }
            if (segments.last().isEmpty()) segments[segments.lastIndex] = segment else segments += segment
            if (addTrailingSlash) segments += ""
        }
    }
}

/**
 * [input] from [pos] to [limit] with tabs and newlines dropped, existing `%` escapes kept, and
 * controls, the [encodeSet] and (unless [keepUnicode]) non-ASCII characters percent-encoded as
 * UTF-8. An unpaired surrogate becomes `?`, as Okio writes it.
 */
internal fun canonicalize(input: String, pos: Int, limit: Int, encodeSet: String, keepUnicode: Boolean): String {
    val out = StringBuilder(limit - pos)
    var i = pos
    while (i < limit) {
        val c = input[i]
        val text = codePointText(input, i, limit)
        i += if (text.length == 2) 2 else 1
        when {
            c in TABS_AND_NEWLINES -> Unit
            c.code < 0x20 || c.code == 0x7f || (c.code >= 0x80 && !keepUnicode) || c in encodeSet ->
                for (byte in text.encodeToByteArray()) {
                    out.append('%').append(HEX[byte.toInt() shr 4 and 0xf]).append(HEX[byte.toInt() and 0xf])
                }
            else -> out.append(text)
        }
    }
    return out.toString()
}

/** The code point at [i]: a surrogate pair, one character, or `?` for an unpaired surrogate, as Okio writes it. */
private fun codePointText(input: String, i: Int, limit: Int): String {
    val c = input[i]
    return when {
        c.isHighSurrogate() && i + 1 < limit && input[i + 1].isLowSurrogate() -> input.substring(i, i + 2)
        c.isSurrogate() -> "?"
        else -> c.toString()
    }
}

/**
 * [input] from [pos] to [limit] with each valid `%XX` escape decoded, read as UTF-8; `+` is a
 * space when [plusIsSpace]. Invalid escapes stay as they are.
 */
internal fun percentDecode(input: String, pos: Int = 0, limit: Int = input.length, plusIsSpace: Boolean = false): String {
    if ((pos until limit).none { input[it] == '%' || (plusIsSpace && input[it] == '+') }) return input.substring(pos, limit)
    val bytes = ArrayList<Byte>(limit - pos)
    var i = pos
    while (i < limit) {
        val c = input[i]
        if (c == '%' && i + 2 < limit) {
            val high = input[i + 1].hexValue()
            val low = input[i + 2].hexValue()
            if (high != -1 && low != -1) {
                bytes += ((high shl 4) + low).toByte()
                i += 3
                continue
            }
        }
        if (c == '+' && plusIsSpace) {
            bytes += ' '.code.toByte()
            i++
            continue
        }
        val text = codePointText(input, i, limit)
        for (byte in text.encodeToByteArray()) bytes += byte
        i += if (text.length == 2) 2 else 1
    }
    return bytes.toByteArray().decodeToString()
}

/** The 16 bytes of an IPv6 address in text form (RFC 4291 §2.2), or `null`. */
private fun decodeIpv6(text: String): ByteArray? {
    val address = ByteArray(16)
    var b = 0
    var compress = -1
    var groupStart = -1
    var i = 0
    while (i < text.length) {
        if (b == address.size) return null
        if (text.startsWith("::", i)) {
            // "::" stands for one or more groups of zeros, once.
            if (compress != -1) return null
            i += 2
            b += 2
            compress = b
            if (i == text.length) break
        } else if (b != 0) {
            when (text[i]) {
                ':' -> i++
                '.' -> {
                    // The last group was the start of an embedded IPv4 address.
                    if (!decodeIpv4(text, groupStart, address, b - 2)) return null
                    b += 2
                    break
                }
                else -> return null
            }
        }
        groupStart = i
        var value = 0
        while (i < text.length && text[i].hexValue() != -1 && i - groupStart < 5) {
            value = (value shl 4) + text[i].hexValue()
            i++
        }
        if (i == groupStart || i - groupStart > 4) return null
        address[b++] = (value shr 8).toByte()
        address[b++] = value.toByte()
    }
    if (b != address.size) {
        if (compress == -1) return null
        address.copyInto(address, address.size - (b - compress), compress, b)
        address.fill(0, compress, compress + (address.size - b))
    }
    return address
}

/** Four decimal bytes, without leading zeros, from [start] to the end, into [address] at [offset]. */
private fun decodeIpv4(text: String, start: Int, address: ByteArray, offset: Int): Boolean {
    var b = offset
    var i = start
    while (i < text.length) {
        if (b == address.size) return false
        if (b != offset) {
            if (text[i] != '.') return false
            i++
        }
        val partStart = i
        var value = 0
        while (i < text.length && text[i] in '0'..'9') {
            if (value == 0 && i != partStart) return false
            value = value * 10 + (text[i] - '0')
            if (value > 255) return false
            i++
        }
        if (i == partStart) return false
        address[b++] = value.toByte()
    }
    return b == offset + 4
}

/** RFC 5952 text: lower-case groups without leading zeros, the first longest run of two or more zero groups as "::". */
private fun ipv6ToText(address: ByteArray): String {
    if ((0 until 10).all { address[it].toInt() == 0 } && address[10].toInt() == -1 && address[11].toInt() == -1) {
        // An IPv4-mapped address is its IPv4 address.
        return (12 until 16).joinToString(".") { (address[it].toInt() and 0xff).toString() }
    }
    var runStart = -1
    var runLength = 0
    var i = 0
    while (i < address.size) {
        val start = i
        while (i < address.size && address[i].toInt() == 0 && address[i + 1].toInt() == 0) i += 2
        if (i - start > runLength && i - start >= 4) {
            runStart = start
            runLength = i - start
        }
        i += 2
    }
    val text = StringBuilder()
    i = 0
    while (i < address.size) {
        if (i == runStart) {
            text.append(':')
            i += runLength
            if (i == address.size) text.append(':')
        } else {
            if (i > 0) text.append(':')
            text.append(((address[i].toInt() and 0xff shl 8) or (address[i + 1].toInt() and 0xff)).toString(16))
            i += 2
        }
    }
    return text.toString()
}

private fun String.indexOfAny(chars: String, from: Int, limit: Int): Int {
    for (i in from until limit) if (this[i] in chars) return i
    return limit
}

private fun Char.isAsciiLetter(): Boolean = this in 'a'..'z' || this in 'A'..'Z'

private fun Char.hexValue(): Int = when (this) {
    in '0'..'9' -> this - '0'
    in 'a'..'f' -> this - 'a' + 10
    in 'A'..'F' -> this - 'A' + 10
    else -> -1
}

private const val HEX = "0123456789ABCDEF"
private const val ASCII_WHITESPACE = "\t\n\u000C\r "
private const val TABS_AND_NEWLINES = "\t\n\u000C\r"

/** The characters a path segment escapes, besides controls and non-ASCII ones. */
private const val PATH_SEGMENT_ENCODE_SET = " \"<>^`{}|/\\?#"
