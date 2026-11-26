package dev.openverify.sdk.ui.theme

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import dev.openverify.sdk.log.SdkLog
import org.jetbrains.compose.resources.decodeToImageBitmap
import kotlin.coroutines.cancellation.CancellationException

/**
 * Reads a theme asset's bytes for the session (C160.6, C198.3): `GET /api/v1/flow/theme-assets/:id`
 * with the session token, through `FlowApi.fetchThemeAsset`. It may throw; the logo is then not shown.
 */
internal typealias ThemeAssetSource = suspend (assetId: String) -> ByteArray

/** The session's asset reader, provided by `OpenVerifyTheme`; null when the host passed none, so no logo is shown. */
internal val LocalThemeAssets: ProvidableCompositionLocal<ThemeAssetSource?> = staticCompositionLocalOf { null }

/** C160.6's logo limits, which the server enforced on upload and on its rendition: 256 KiB. */
internal const val LOGO_MAX_BYTES: Int = 256 * 1024

/** C160.6: at most 2,048 px a side. */
internal const val LOGO_MAX_SIDE: Int = 2_048

/** The formats the server's rendition emits (C160.6): PNG, or JPEG kept as JPEG. */
internal enum class LogoFormat { PNG, JPEG }

/** A logo's format and size in pixels, read from its header without decoding it. */
internal data class LogoHeader(internal val format: LogoFormat, internal val width: Int, internal val height: Int)

/** Why a logo is not decoded (C198.3). */
internal enum class LogoRefusal { TOO_LARGE, NOT_PNG_OR_JPEG, NO_HEADER, TOO_MANY_PIXELS }

/** The checks a logo passes before it is decoded (C198.3). */
internal sealed class LogoCheck {
    internal data class Accepted(internal val header: LogoHeader) : LogoCheck()

    internal data class Refused(internal val reason: LogoRefusal) : LogoCheck()
}

/**
 * C198.3 (review P20) over [bytes], before anything decodes them: at most [LOGO_MAX_BYTES]; the
 * magic bytes of a format the server's rendition emits (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG
 * `FF D8 FF`), any other format refused; and the size in the format's own header (PNG's first
 * chunk, IHDR; JPEG's first frame header, SOFn), read as bytes without decoding, at most
 * [LOGO_MAX_SIDE] a side. A header that is missing, truncated or names a zero side is refused.
 */
internal fun checkLogo(bytes: ByteArray): LogoCheck {
    if (bytes.size > LOGO_MAX_BYTES) return LogoCheck.Refused(LogoRefusal.TOO_LARGE)
    val format = when {
        bytes.startsWith(PNG_SIGNATURE) -> LogoFormat.PNG
        bytes.startsWith(JPEG_START) -> LogoFormat.JPEG
        else -> return LogoCheck.Refused(LogoRefusal.NOT_PNG_OR_JPEG)
    }
    val (width, height) = when (format) {
        LogoFormat.PNG -> pngSize(bytes)
        LogoFormat.JPEG -> jpegSize(bytes)
    } ?: return LogoCheck.Refused(LogoRefusal.NO_HEADER)
    if (width == 0L || height == 0L) return LogoCheck.Refused(LogoRefusal.NO_HEADER)
    if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) return LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS)
    return LogoCheck.Accepted(LogoHeader(format, width.toInt(), height.toInt()))
}

private val PNG_SIGNATURE = intArrayOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
private val JPEG_START = intArrayOf(0xff, 0xd8, 0xff)

/** The `IHDR` chunk type, which PNG requires first. */
private val IHDR = intArrayOf(0x49, 0x48, 0x44, 0x52)

private fun ByteArray.byteAt(index: Int): Int = this[index].toInt() and 0xff

private fun ByteArray.startsWith(prefix: IntArray, at: Int = 0): Boolean =
    size >= at + prefix.size && prefix.indices.all { byteAt(at + it) == prefix[it] }

private fun ByteArray.u16(at: Int): Long = (byteAt(at).toLong() shl 8) or byteAt(at + 1).toLong()

private fun ByteArray.u32(at: Int): Long = (u16(at) shl 16) or u16(at + 2)

/** A PNG's width and height from its IHDR chunk (length 13 at byte 8, type at 12, width at 16, height at 20). */
private fun pngSize(bytes: ByteArray): Pair<Long, Long>? {
    if (bytes.size < 24 || bytes.u32(8) != 13L || !bytes.startsWith(IHDR, at = 12)) return null
    return bytes.u32(16) to bytes.u32(20)
}

/**
 * A JPEG's width and height from its first frame header: the segments after SOI are walked by their
 * lengths, fill bytes and stand-alone markers skipped, until an SOFn (`C0`-`CF` but `C4`, `C8` and
 * `CC`), whose height and width follow its length and precision. Scan data or the end of the image
 * before a frame header, or a segment that runs past the bytes, is no header.
 */
private fun jpegSize(bytes: ByteArray): Pair<Long, Long>? {
    var at = 2
    while (at + 1 < bytes.size) {
        if (bytes.byteAt(at) != 0xff) return null
        var marker = bytes.byteAt(at + 1)
        while (marker == 0xff) {
            at += 1
            if (at + 1 >= bytes.size) return null
            marker = bytes.byteAt(at + 1)
        }
        at += 2
        when (marker) {
            0x01, in 0xd0..0xd8 -> continue
            0xd9, 0xda -> return null
        }
        if (at + 2 > bytes.size) return null
        val length = bytes.u16(at).toInt()
        if (length < 2 || at + length > bytes.size) return null
        if (marker in 0xc0..0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc) {
            if (length < 7) return null
            return bytes.u16(at + 5) to bytes.u16(at + 3)
        }
        at += length
    }
    return null
}

/** [bytes] decoded by the platform's decoder, or null when it cannot decode them. Only called after [checkLogo] accepted them. */
internal fun decodeLogo(bytes: ByteArray): ImageBitmap? = try {
    bytes.decodeToImageBitmap()
} catch (failure: Exception) {
    null
}

/**
 * The logo [assetId] from [source], or null: a failed fetch (the person sees the organisation's
 * name, C198.3), bytes [checkLogo] refuses, which are never decoded, or bytes [decode] (`decodeLogo`
 * in the SDK) cannot read. Each logs its constant code (C213.3: `theme.logo_unavailable`,
 * `theme.logo_refused`, `theme.logo_unreadable`), never an id, a URL or a size.
 */
internal suspend fun <T : Any> loadLogo(source: ThemeAssetSource, assetId: String, decode: (ByteArray) -> T?): T? {
    val bytes = try {
        source(assetId)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Exception) {
        SdkLog.log("theme.logo_unavailable")
        return null
    }
    if (checkLogo(bytes) is LogoCheck.Refused) {
        SdkLog.log("theme.logo_refused")
        return null
    }
    return decode(bytes) ?: run {
        SdkLog.log("theme.logo_unreadable")
        null
    }
}

/**
 * What the brand header shows (C198.3): the decoded [logo] with its [description] (the alt text, or
 * null for a decorative logo), and the organisation's [name] as text beside a decorative logo, or
 * alone when there is no logo to show.
 */
internal data class ThemeBrand(internal val logo: ImageBitmap?, internal val description: String?, internal val name: String?)

/** The session's brand, provided by `OpenVerifyTheme`; null when the theme has no logo. */
internal val LocalThemeBrand: ProvidableCompositionLocal<ThemeBrand?> = staticCompositionLocalOf { null }
