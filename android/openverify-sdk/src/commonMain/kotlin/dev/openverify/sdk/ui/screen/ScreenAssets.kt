package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.graphics.ImageBitmap
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.ui.theme.LogoCheck
import dev.openverify.sdk.ui.theme.ThemeAssetSource
import dev.openverify.sdk.ui.theme.checkLogo
import dev.openverify.sdk.ui.theme.decodeLogo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * C195.1, C198.3 (KP10-11): a screen's `image` assets for the session, fetched through the flow's
 * theme-asset read (which serves the image components of the session's pinned flow, 10B decisions
 * item 4), checked as a logo is (`checkLogo`: PNG or JPEG by their magic bytes, at most 256 KiB, at
 * most 2,048 px a side, read from the header without decoding), decoded on [decoding], never the
 * main thread, and kept in memory per asset id for the session (the launch scope's lifetime), never
 * on disk. A failure keeps the image's text alternative and logs a constant code (C213.3), never an
 * id, a URL or a size; a failed asset is not asked again in the session.
 */
internal class ScreenAssets(
    private val source: ThemeAssetSource,
    private val scope: CoroutineScope,
    private val decode: (ByteArray) -> ImageBitmap? = ::decodeLogo,
    private val decoding: CoroutineContext = Dispatchers.Default,
) {
    /** Decoded images by asset id; a snapshot map, so a screen showing one recomposes once it arrives. */
    private val decoded = mutableStateMapOf<String, ImageBitmap>()

    /** The ids whose load has started, so each is fetched once. */
    private val requested = mutableSetOf<String>()

    /** [assetId]'s decoded image once loaded, else null (a load starts once, the first time it is asked). */
    internal fun asset(assetId: String): ImageBitmap? {
        decoded[assetId]?.let { return it }
        if (requested.add(assetId)) {
            scope.launch { load(assetId)?.let { decoded[assetId] = it } }
        }
        return null
    }

    /** [assetId] fetched, checked and decoded, or null with a constant log code. */
    internal suspend fun load(assetId: String): ImageBitmap? {
        val bytes = try {
            source(assetId)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            SdkLog.log("screen.image_unavailable")
            return null
        }
        return withContext(decoding) {
            if (checkLogo(bytes) is LogoCheck.Refused) {
                SdkLog.log("screen.image_refused")
                null
            } else {
                decode(bytes) ?: run {
                    SdkLog.log("screen.image_unreadable")
                    null
                }
            }
        }
    }
}
