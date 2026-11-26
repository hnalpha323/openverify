package dev.openverify.sdk.camera

import kotlinx.coroutines.CancellationException

/** C201.2, C201.3: how a preview's camera session came up. */
internal sealed interface Binding<out T> {
    /** Preview, the still and analysis, in one bind: frames reach the guidance. */
    data class Analysing<T>(val value: T) : Binding<T>

    /** Three use cases could not be bound together; preview and the still could (C201.3): no frames, the manual shutter. */
    data class WithoutAnalysis<T>(val value: T) : Binding<T>

    /** Not even preview and the still: the step says the camera is unavailable (KP10-14). */
    data object Unavailable : Binding<Nothing>
}

/**
 * C201.2, C201.3 (decision 17): binds [three] (preview, the still and analysis) in one call; when that
 * throws, [release]s whatever it left bound and binds [two] (preview and the still), so the step runs
 * today's manual shutter; when that throws too, the camera is unavailable. A cancellation always
 * propagates. [three] and [two] each bind in one call, as CameraX requires of a session's use cases.
 */
internal inline fun <T> bindUseCases(three: () -> T, two: () -> T, release: () -> Unit): Binding<T> {
    try {
        return Binding.Analysing(three())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Fall through to the two use cases of C201.3.
    }
    return try {
        release()
        Binding.WithoutAnalysis(two())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        Binding.Unavailable
    }
}
