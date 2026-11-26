package dev.openverify.sdk.camera

import androidx.camera.core.CameraSelector
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner

/**
 * What [CameraXCaptureCamera] binds its use cases through: CameraX's process camera provider on a
 * device, a fake in the host tests (which have no camera stack), so the binding's outcomes (three use
 * cases, the fallback to two, none at all) are tested without hardware. Called on the main thread only.
 */
internal interface CameraBinder {
    /**
     * Binds [useCases] to [owner] on the camera [selector] picks, in one call, and returns what that
     * camera says about itself (C40.4).
     *
     * @throws Exception when CameraX cannot bind them (no such camera, or a combination it cannot run).
     */
    fun bind(owner: LifecycleOwner, selector: CameraSelector, vararg useCases: UseCase): CameraFacts

    /** Unbinds [useCases]; a use case that is not bound is ignored. */
    fun unbind(vararg useCases: UseCase)

    /** Unbinds every use case: the flow is the only camera user while its activity is in front. */
    fun unbindAll()
}

/** The binder of a device: CameraX's [ProcessCameraProvider]. */
internal class ProcessCameraBinder(private val provider: ProcessCameraProvider) : CameraBinder {
    override fun bind(owner: LifecycleOwner, selector: CameraSelector, vararg useCases: UseCase): CameraFacts {
        val info = provider.bindToLifecycle(owner, selector, *useCases).cameraInfo
        return CameraFacts(
            cameraIds = info.cameraIdentifier?.cameraIds.orEmpty(),
            lensFacing = info.lensFacing,
            frameRateMax = info.supportedFrameRateRanges.maxOfOrNull { it.upper },
        )
    }

    override fun unbind(vararg useCases: UseCase) = provider.unbind(*useCases)

    override fun unbindAll() = provider.unbindAll()
}
