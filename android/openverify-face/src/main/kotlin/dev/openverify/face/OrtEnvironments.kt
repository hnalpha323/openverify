package dev.openverify.face

import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtLoggingLevel
import ai.onnxruntime.OrtSession
import android.system.Os

/**
 * What this module asks of ONNX Runtime's process-wide state, one call each, so that the order of the
 * calls (C205.2) is a host test's subject and [OrtPlatform] stays a list of single calls.
 */
internal interface OrtAccess {
    /** Sets an environment variable of the process. */
    fun setVariable(name: String, value: String)

    /**
     * Creates the process's `OrtEnvironment`. ONNX Runtime keeps one per process: when one exists
     * already, this throws an [IllegalStateException] that has no cause.
     */
    fun createEnvironment(): OrtEnvironment

    /** The process's `OrtEnvironment`, which exists. */
    fun existingEnvironment(): OrtEnvironment

    /** Switches ONNX Runtime's telemetry events off on [environment]. */
    fun disableTelemetry(environment: OrtEnvironment)

    /** Opens a session over [model]: CPU, an intra-op pool of [threads] threads (C205.4). */
    fun createSession(environment: OrtEnvironment, model: ByteArray, threads: Int): OrtSession
}

/**
 * The one class that creates ONNX Runtime's `OrtEnvironment` in this module, and the second and third
 * layers of C205.2 (the first is the manifest's removal of ONNX Runtime's telemetry provider):
 *
 * - `ORT_DISABLE_TELEMETRY=1` is set in the process's environment before the first `OrtEnvironment`;
 * - telemetry is switched off on the environment before every session this module opens (review P09).
 *
 * `OrtEnvironment` is a process singleton. When the host app created one before this module's first
 * call, this module did not choose how it was created: that case is detected, kept in [hostCreated]
 * and logged once as a constant code, and the host's own ONNX Runtime configuration then governs
 * (the README says so). Telemetry is still switched off before each of this module's sessions.
 */
internal class OrtEnvironments(private val access: OrtAccess) {
    private var environment: OrtEnvironment? = null

    /** Whether the process's environment existed before this module first asked for one. */
    @Volatile
    internal var hostCreated: Boolean = false
        private set

    /** The process's environment, created here on the first call unless the host created it first. */
    @Synchronized
    internal fun environment(): OrtEnvironment {
        environment?.let { return it }
        access.setVariable(DISABLE_TELEMETRY, "1")
        val made = try {
            access.createEnvironment()
        } catch (existed: IllegalStateException) {
            // ONNX Runtime's refusal to create a second environment has no cause; a failed creation has one.
            if (existed.cause != null) {
                FaceLog.log("face.ort_environment_failed")
                throw IllegalStateException("openverify-face: ONNX Runtime did not start")
            }
            hostCreated = true
            FaceLog.log("face.ort_environment_host_created")
            access.existingEnvironment()
        } catch (_: OrtException) {
            FaceLog.log("face.ort_environment_failed")
            throw IllegalStateException("openverify-face: ONNX Runtime did not start")
        } catch (_: LinkageError) {
            // The native library is not in the app (an ABI the host left out) or did not load.
            FaceLog.log("face.ort_library_unavailable")
            throw IllegalStateException("openverify-face: ONNX Runtime's native library did not load")
        }
        environment = made
        return made
    }

    /** A session over [model], with telemetry switched off on the environment first. */
    internal fun openSession(model: ByteArray): OrtSession {
        val shared = environment()
        try {
            access.disableTelemetry(shared)
            return access.createSession(shared, model, INTRA_OP_THREADS)
        } catch (_: OrtException) {
            FaceLog.log("face.ort_session_failed")
            throw IllegalStateException("openverify-face: ONNX Runtime did not open the model")
        }
    }

    internal companion object {
        /** The variable ONNX Runtime's telemetry reads when it starts. */
        const val DISABLE_TELEMETRY: String = "ORT_DISABLE_TELEMETRY"

        /** C205.4: one intra-op pool of two threads, provisional (10B measured guidance at 8 Hz on one frame at a time). */
        const val INTRA_OP_THREADS: Int = 2

        /** The process's own instance, behind [OpenVerifyFace]. */
        val process: OrtEnvironments = OrtEnvironments(OrtPlatform)
    }
}

/** [OrtAccess] over ONNX Runtime and the platform: single calls, no decision. */
internal object OrtPlatform : OrtAccess {
    private const val NAME = "openverify-face"

    override fun setVariable(name: String, value: String) {
        Os.setenv(name, value, true)
    }

    override fun createEnvironment(): OrtEnvironment =
        // Asking with threading options is the one request ONNX Runtime refuses when an environment
        // exists (any other returns the existing one silently), which is how a host-created one is
        // seen. One global thread means no pool is started: sessions keep their own (C205.4).
        OrtEnvironment.ThreadingOptions().use { options ->
            options.setGlobalIntraOpNumThreads(1)
            options.setGlobalInterOpNumThreads(1)
            OrtEnvironment.getEnvironment(OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR, NAME, options)
        }

    override fun existingEnvironment(): OrtEnvironment = OrtEnvironment.getEnvironment()

    override fun disableTelemetry(environment: OrtEnvironment) {
        environment.setTelemetry(false)
    }

    override fun createSession(environment: OrtEnvironment, model: ByteArray, threads: Int): OrtSession =
        OrtSession.SessionOptions().use { options ->
            options.setIntraOpNumThreads(threads)
            options.setInterOpNumThreads(1)
            environment.createSession(model, options)
        }
}
