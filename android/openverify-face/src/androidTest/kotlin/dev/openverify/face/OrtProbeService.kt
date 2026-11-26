package dev.openverify.face

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Debug
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.Process
import android.system.Os
import kotlinx.coroutines.runBlocking
import java.io.File

/**
 * The telemetry test's second process (C205.2, fourth layer; Workflow 10E Stage 1a amendment 5: no
 * test orchestrator). It is a host app's process in which ONNX Runtime is first loaded by this module:
 * the test asks it what it holds before anything ran ([PROBE]), has it run the detector through the
 * public factory and close it ([INFER]), asks again, and ends it ([EXIT]) to start a new one.
 */
class OrtProbeService : Service() {

    private val messenger by lazy {
        Messenger(
            Handler(Looper.getMainLooper()) { message ->
                val reply = when (message.what) {
                    PROBE -> probe(applicationContext)
                    INFER -> infer(applicationContext)
                    else -> Bundle()
                }
                message.replyTo.send(Message.obtain(null, message.what).apply { data = reply })
                if (message.what == EXIT) Process.killProcess(Process.myPid())
                true
            },
        )
    }

    override fun onBind(intent: Intent?): IBinder = messenger.binder

    internal companion object {
        const val PROBE = 1
        const val INFER = 2
        const val EXIT = 3

        const val PID = "pid"
        const val LOADED = "loaded"
        const val FILES = "files"
        const val VARIABLE = "variable"
        const val FACES = "faces"
        const val FRAMES = "frames"
        const val HOST_CREATED = "host-created"

        /** How many frames [INFER] runs: a second of guidance at 8 Hz. */
        const val INFERENCE_FRAMES = 8

        private const val ORT_PREFIX = "ai.onnxruntime."

        /**
         * The names of ONNX Runtime's classes that this process has loaded, read from a heap dump the
         * runtime writes of itself: its `LOAD CLASS` records list exactly the loaded classes. Asking the
         * class loader instead (`findLoadedClass`) would not do: on Android that call itself loads the
         * class it is asked about. The dump goes to the code cache, which is none of the directories
         * the test watches, and is deleted at once; nothing of it but these names leaves this function.
         */
        private fun loadedOrtClasses(context: Context): ArrayList<String> {
            val dump = File(context.codeCacheDir, "ort-probe.hprof")
            try {
                Debug.dumpHprofData(dump.path)
                return ArrayList(HprofClassNames.read(dump) { it.startsWith(ORT_PREFIX) }.sorted())
            } finally {
                dump.delete()
            }
        }

        /** Every file under the app's `files`, `databases`, `cache` and `no_backup` directories, by relative path. */
        private fun files(context: Context): ArrayList<String> {
            val roots = linkedMapOf(
                "files" to context.filesDir,
                "databases" to context.getDatabasePath("probe").parentFile,
                "cache" to context.cacheDir,
                "no_backup" to context.noBackupFilesDir,
            )
            val found = ArrayList<String>()
            roots.forEach { (label, root) ->
                root?.walkTopDown()?.filter(File::isFile)?.forEach { found += "$label/${it.relativeTo(root).invariantSeparatorsPath}" }
            }
            return ArrayList(found.sorted())
        }

        /** What this process holds now: its id, which of ONNX Runtime's classes it has loaded, the files, the variable. */
        fun probe(context: Context): Bundle = Bundle().apply {
            putInt(PID, Process.myPid())
            putStringArrayList(LOADED, loadedOrtClasses(context))
            putStringArrayList(FILES, files(context))
            putString(VARIABLE, Os.getenv(OrtEnvironments.DISABLE_TELEMETRY))
        }

        /** Runs the detector as a host does: the public factory, a detector, frames of the drawn face, close. */
        fun infer(context: Context): Bundle {
            val vectors = DeviceFiles.drawnFace(context)
            val tensor = DeviceFiles.drawnTensor(vectors)
            var faces = 0
            OpenVerifyFace.detectorFactory(context).create().use { detector ->
                repeat(INFERENCE_FRAMES) {
                    val outputs = runBlocking { detector.detect(tensor.data.copyOf(), tensor.paddedWidth, tensor.paddedHeight) }
                    faces += YunetReference.decode(outputs, tensor.paddedWidth, tensor.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold).size
                }
            }
            return Bundle().apply {
                putInt(FACES, faces)
                putInt(FRAMES, INFERENCE_FRAMES)
                putBoolean(HOST_CREATED, OrtEnvironments.process.hostCreated)
            }
        }
    }
}
