package dev.openverify.demo

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The session the smoke test's server answers with (C215.2) is the contract golden
 * `contracts/fixtures/api/flow-session.json` as a spec-2 server positions a new inquiry on its consent
 * step: nothing in it is hand-written. This test fails when the committed asset differs from that, and
 * writes it only under `UPDATE_CONTRACT_FIXTURES=1` (rule 27).
 */
@RunWith(RobolectricTestRunner::class)
class SmokeSessionFixtureTest {

    private val asset = File("src/androidTest/assets/smoke-session.json")

    private fun derived(): String {
        val session = JSONObject(File("../../contracts/fixtures/api/flow-session.json").readText())
        val steps = session.getJSONObject("flow").getJSONArray("steps")
        val consent = (0 until steps.length()).map { steps.getJSONObject(it) }.single { it.getString("id") == "consent" }
        session.put("spec-version", 2)
        session.put("position", JSONObject().put("step-id", "consent").put("state", "active").put("previous-step-id", JSONObject.NULL))
        session.put("step", consent)
        session.put("consent", JSONObject.NULL)
        session.put("verifications", JSONArray())
        return session.toString(2) + "\n"
    }

    @Test
    fun `the smoke session is the golden session at its consent step`() {
        val expected = derived()
        if (System.getenv("UPDATE_CONTRACT_FIXTURES") == "1") {
            asset.parentFile.mkdirs()
            asset.writeText(expected)
        }

        assertTrue("${asset.path} is missing", asset.isFile)
        assertEquals(expected, asset.readText())
    }

    @Test
    fun `the smoke session names the inquiry the smoke test launches`() {
        assertEquals(DemoFormTest.INQUIRY_ID, JSONObject(asset.readText()).getJSONObject("inquiry").getString("id"))
        assertEquals("consent", JSONObject(asset.readText()).getJSONObject("step").getString("type"))
    }
}
