package dev.openverify.sdk.model

import dev.openverify.sdk.flow.stepMaxAttempts
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/**
 * C207.1 (Workflow 10C, contracts-10c): the NFC step's wire models against the golden fixtures of
 * `@openverify/contracts`. Every value is synthetic (ICAO Doc 9303's specimen key fields).
 */
internal class NfcWireModelTest {

    private fun step(json: String): FlowStep = OpenVerifyJson.decodeFromString(FlowStepSerializer, json)

    @Test
    fun `an nfc client view decodes as NfcStep, its new members off until the server sets them`() {
        assertEquals(NfcStep("chip"), step("""{"id":"chip","type":"nfc","androidOnly":true}"""))
        assertEquals(
            NfcStep("chip", maxAttempts = 2, fallbackAvailable = true, sandboxChipAvailable = true, prefillMrz = NfcPrefillMrz("L898902C3", "740812", "120415")),
            step(
                """{"id":"chip","type":"nfc","androidOnly":true,"maxAttempts":2,"fallbackAvailable":true,"sandboxChipAvailable":true,""" +
                    """"prefillMrz":{"documentNumber":"L898902C3","birthDate":"740812","expiryDate":"120415"}}""",
            ),
        )
    }

    @Test
    fun `the golden sessions at an nfc step decode, the web client's without a prefill`() {
        val web = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session-nfc.json"))
        val sdk = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session-nfc-sdk.json"))

        assertEquals(NfcStep("chip", maxAttempts = 3, fallbackAvailable = true), web.step)
        assertEquals(
            NfcStep("chip", maxAttempts = 3, fallbackAvailable = true, sandboxChipAvailable = true, prefillMrz = NfcPrefillMrz("L898902C3", "740812", "120415")),
            sdk.step,
        )
    }

    @Test
    fun `an nfc step round-trips through JSON and counts three attempts by default`() {
        val chip = NfcStep("chip", fallbackAvailable = true)

        assertEquals(chip, step(OpenVerifyJson.encodeToString(FlowStepSerializer, chip)))
        assertEquals(3, stepMaxAttempts(chip))
        assertEquals(2, stepMaxAttempts(chip.copy(maxAttempts = 2)))
    }

    @Test
    fun `no text of an NFC model shows a nonce, a response, an MRZ value or a file's content`() {
        val prefill = NfcPrefillMrz("L898902C3", "740812", "120415")
        val texts = listOf(
            prefill.toString(),
            NfcStep("chip", prefillMrz = prefill).toString(),
            FlowChipChallenge("chc_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789abcdef", "2026-11-10T12:05:00.000Z").toString(),
            FlowChipSubmit("chc_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789abcdef", "c3ludGhldGljIGFh").toString(),
            FlowSandboxChip(listOf(FlowSandboxChip.File(FileKind.CHIP_DG1, "c3ludGhldGljIGRnMQ==")), true, "c3ludGhldGljIGFh").toString(),
        )

        for (text in texts) {
            for (secret in listOf("L898902C3", "740812", "120415", "0123456789abcdef", "c3ludGhldGlj")) {
                assertFalse(secret in text, text)
            }
        }
    }

    @Test
    fun `the golden chip challenge, client-unable and sandbox-chip answers decode as the server sends them`() {
        val challenge = OpenVerifyJson.decodeFromString<FlowChipChallenge>(Fixtures.read("api/flow-chip-challenge.json"))
        val unable = OpenVerifyJson.decodeFromString<FlowClientUnable>(Fixtures.read("api/flow-client-unable.json"))
        val chip = OpenVerifyJson.decodeFromString<FlowSandboxChip>(Fixtures.read("api/flow-sandbox-chip.json"))

        assertEquals("chc_01M5CK3190XEVBM5ZXA76E1JSM", challenge.id)
        assertEquals(VerificationStatus.CANCELED, unable.status)
        assertEquals(true, chip.dg2Attached)
        assertFalse(chip.files.any { it.kind == FileKind.CHIP_DG2 })
        assertEquals(listOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG14, FileKind.CHIP_DG15, FileKind.CHIP_COM), chip.files.map { it.kind })
    }

    @Test
    fun `a chip challenge or submit with a malformed id or nonce is refused, naming neither`() {
        val errors = listOf(
            assertThrows(IllegalArgumentException::class.java) { FlowChipChallenge("ich_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789abcdef", "x") },
            assertThrows(IllegalArgumentException::class.java) { FlowChipChallenge("chc_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789ABCDEF", "x") },
            assertThrows(IllegalArgumentException::class.java) { FlowChipSubmit("chc_short", "0123456789abcdef") },
            assertThrows(IllegalArgumentException::class.java) { FlowSandboxChipBody("ver_01M5CK3190XEVBM5ZXA76E1JSM") },
        )

        for (error in errors) {
            assertFalse("0123456789" in error.message.orEmpty(), error.message)
            assertFalse("01M5CK" in error.message.orEmpty(), error.message)
        }
    }

    @Test
    fun `the request bodies encode as the contract names their members, the default scenario sent as match`() {
        assertEquals(
            """{"reason":"reader_not_installed"}""",
            OpenVerifyJson.encodeToString(FlowClientUnableBody.serializer(), FlowClientUnableBody(ClientUnableReason.READER_NOT_INSTALLED)),
        )
        assertEquals(
            """{"chip":{"challenge-id":"chc_01M5CK3190XEVBM5ZXA76E1JSM","nonce":"0123456789abcdef","device-report":{"protocols":[{"protocol":"pace","outcome":"succeeded"}],"read-ms":4200}}}""",
            OpenVerifyJson.encodeToString(
                FlowChipSubmitBody.serializer(),
                FlowChipSubmitBody(
                    FlowChipSubmit(
                        "chc_01M5CK3190XEVBM5ZXA76E1JSM",
                        "0123456789abcdef",
                        deviceReport = FlowChipDeviceReport(listOf(FlowChipDeviceReport.Attempt("pace", "succeeded")), 4200),
                    ),
                ),
            ),
        )
        assertNull(FlowChipSubmit("chc_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789abcdef").activeAuthenticationResponse)
        assertEquals(ClientUnableReason.entries.map { it.wireValue }, listOf("nfc_unavailable", "reader_not_installed", "nfc_disabled_declined", "platform_unsupported", "read_failed"))
        assertEquals(
            SandboxChipScenario.entries.map { it.wireValue },
            listOf("match", "mrz-mismatch", "face-mismatch", "no-active-authentication", "tampered-dg1"),
        )
    }
}
