package dev.openverify.face

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * C205.3 (decision 23; review F19): the model reaches the AAR as an asset only through the build's
 * digest-checked copy, with its notices, and its bytes are checked again before ONNX Runtime sees them.
 * `./gradlew :openverify-face:copyYunetModel` is the task; these tests read what it packaged.
 */
@RunWith(RobolectricTestRunner::class)
class YunetModelTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun asset(path: String): ByteArray = context.assets.open(path).use { it.readBytes() }

    private fun source(bytes: () -> InputStream, digest: String = YunetModel.SHA256): ModelSource = object : ModelSource {
        override val name: String = YunetModel.NAME
        override val sha256: String = digest
        override fun open(): InputStream = bytes()
    }

    private fun written(): List<String> = ShadowLog.getLogsForTag("OpenVerifyFace").map { it.msg }

    @Before
    fun debuggableHost() {
        ShadowLog.clear()
        context.applicationInfo.flags = context.applicationInfo.flags or android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE
        FaceLog.attach(context)
    }

    @Test
    fun `the pinned name and digest are those of the repository's model manifest`() {
        val entry = Json.parseToJsonElement(HostFiles.repository("models/manifest.json").readText()).jsonObject
            .getValue("models").jsonArray.map { it.jsonObject }.single { it.getValue("name").jsonPrimitive.content == "face_detection_yunet" }

        assertEquals(entry.getValue("filename").jsonPrimitive.content, YunetModel.NAME)
        assertEquals(entry.getValue("sha256").jsonPrimitive.content, YunetModel.SHA256)
        assertEquals("MIT", entry.getValue("license").jsonPrimitive.content)
    }

    @Test
    fun `the build packaged the fetched model as the artifact's asset, with the pinned digest`() {
        val packaged = asset(YunetModel.ASSET)

        assertEquals(YunetModel.SHA256, HostFiles.sha256(packaged))
        assertArrayEquals(HostFiles.model().readBytes(), packaged)
    }

    @Test
    fun `the shipped source reads that asset and passes the digest check`() {
        val source = AssetModelSource(context.assets)

        assertEquals(YunetModel.NAME, source.name)
        assertEquals(YunetModel.SHA256, source.sha256)
        assertEquals(YunetModel.SHA256, HostFiles.sha256(source.verifiedBytes()))
    }

    @Test
    fun `the notices the artifact must carry are packaged beside the model, byte for byte`() {
        val module = HostFiles.repository("android/openverify-face")
        listOf(
            "NOTICE" to "NOTICE",
            "licenses/onnxruntime/LICENSE.txt" to "licenses/onnxruntime/LICENSE.txt",
            "licenses/onnxruntime/ThirdPartyNotices.txt" to "licenses/onnxruntime/ThirdPartyNotices.txt",
            "licenses/yunet/LICENSE.txt" to "licenses/yunet/LICENSE.txt",
            "licenses/yunet/NOTICE.txt" to "licenses/yunet/NOTICE.txt",
        ).forEach { (packaged, committed) ->
            assertArrayEquals(packaged, java.io.File(module, committed).readBytes(), asset("openverify-face/$packaged"))
        }
    }

    @Test
    fun `the notices name what the licences require`() {
        val notice = String(asset("openverify-face/NOTICE"))
        val yunet = String(asset("openverify-face/licenses/yunet/NOTICE.txt"))
        val thirdParty = String(asset("openverify-face/licenses/onnxruntime/ThirdPartyNotices.txt"))

        // MPL-2.0 section 3.2: where Eigen's source is, at the revision ONNX Runtime 1.31.0 builds.
        assertTrue("1d8b82b0740839c0de7f1242a3585e3390ff5f33" in notice)
        assertTrue("https://github.com/eigen-mirror/eigen" in notice)
        assertTrue("Mozilla Public License" in thirdParty)
        // The model's MIT licence, and the training data's terms.
        assertTrue(String(asset("openverify-face/licenses/yunet/LICENSE.txt")).startsWith("MIT License"))
        assertTrue("WIDER FACE" in yunet)
        assertTrue("CC BY-NC-ND 4.0" in yunet)
        assertTrue(YunetModel.SHA256 in yunet)
    }

    @Test
    fun `the model is in no source directory of the module`() {
        val module = HostFiles.repository("android/openverify-face")
        val committed = java.io.File(module, "src").walkTopDown().filter { it.isFile && it.extension == "onnx" }.toList()

        assertEquals(emptyList<java.io.File>(), committed)
    }

    @Test
    fun `bytes with another digest are refused with a fixed message and no cause`() {
        val tampered = HostFiles.model().readBytes().also { it[it.size / 2] = (it[it.size / 2] + 1).toByte() }

        val refused = assertThrows(IllegalStateException::class.java) { source({ ByteArrayInputStream(tampered) }).verifiedBytes() }

        assertEquals("openverify-face: the model does not have its pinned SHA-256", refused.message)
        assertNull(refused.cause)
        assertEquals(listOf("face.model_digest_mismatch"), written())
    }

    @Test
    fun `a source that cannot be read is refused with a fixed message that repeats nothing of the failure`() {
        val refused = assertThrows(IllegalStateException::class.java) {
            source({ throw IOException("/data/app/synthetic-path/base.apk: no such asset") }).verifiedBytes()
        }

        assertEquals("openverify-face: the model cannot be read", refused.message)
        assertNull(refused.cause)
        assertFalse("synthetic-path" in refused.message.orEmpty())
        assertEquals(listOf("face.model_unreadable"), written())
    }
}
