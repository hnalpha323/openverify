package dev.openverify.sdk.model

import dev.openverify.sdk.flow.DEFAULT_MAX_ATTEMPTS
import dev.openverify.sdk.flow.stepMaxAttempts
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The Phase 5 wire models of the phone, email, database, AAMVA and crypto wallet steps (C50.3,
 * C52.2, C52.3, C52.7, C55, C57), checked against the frozen contracts: the steps, each type's
 * guidance, the OTP problem members, the request bodies and the shared constants.
 */
class Phase5WireModelTest {

    private fun flowWith(vararg steps: String): Flow = OpenVerifyJson.decodeFromString(
        """{"metadata":{"specVersion":1,"id":"f","version":1,"name":"F"},"steps":[${steps.joinToString(",")}],"transitions":[]}""",
    )

    private fun flowVerification(type: String, guidance: String?, extra: String = ""): FlowVerification =
        OpenVerifyJson.decodeFromString(
            """{"type":"verification/$type","id":"ver_01M5CK16P0D13FXHZSS4TCFBVH","attributes":{"status":"initiated",""" +
                """"retry-hints":[],"created-at":"2026-10-20T12:02:00.000Z","updated-at":"2026-10-20T12:02:00.000Z"""" +
                (if (guidance == null) "" else ""","guidance":$guidance""") + extra + "}}",
        )

    // Steps (C50.3) --------------------------------------------------------------------------

    @Test
    fun `the phone, email, database, AAMVA and crypto wallet steps decode as their own steps (C50_3)`() {
        val steps = flowWith(
            """{"id":"phone","type":"phone_otp","allowedCountries":["US","CA"],"codeLength":8,"allowVoip":true,"maxAttempts":4}""",
            """{"id":"email","type":"email_otp"}""",
            """{"id":"db","type":"database","fields":["name_first","name_last","birthdate","address_country_code"],""" +
                """"requiredFields":["birthdate"],"maxAttempts":2}""",
            """{"id":"silent","type":"aamva","source":"government_id"}""",
            """{"id":"form","type":"aamva","source":"form","maxAttempts":2}""",
            """{"id":"wallet","type":"crypto_wallet","chains":["eip155:1","bip122:000000000019d6689c085ae165831e93"],""" +
                """"signing":["wallet","paste"]}""",
        ).steps

        assertEquals(
            listOf(
                PhoneOtpStep("phone", listOf("US", "CA"), codeLength = 8, allowVoip = true, maxAttempts = 4),
                EmailOtpStep("email"),
                DatabaseStep(
                    "db",
                    listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.BIRTHDATE, DatabaseField.ADDRESS_COUNTRY_CODE),
                    requiredFields = listOf(DatabaseField.BIRTHDATE),
                    maxAttempts = 2,
                ),
                AamvaStep("silent", AamvaSource.GOVERNMENT_ID),
                AamvaStep("form", AamvaSource.FORM, maxAttempts = 2),
                CryptoWalletStep(
                    "wallet",
                    listOf("eip155:1", "bip122:000000000019d6689c085ae165831e93"),
                    listOf(CryptoSigningMethod.WALLET, CryptoSigningMethod.PASTE),
                ),
            ),
            steps,
        )
        assertEquals(listOf("phone_otp", "email_otp", "database", "aamva", "aamva", "crypto_wallet"), steps.map { it.type })
    }

    @Test
    fun `a flow with the Phase 5 steps round-trips through JSON`() {
        val flow = flowWith(
            """{"id":"phone","type":"phone_otp","allowedCountries":["GB"]}""",
            """{"id":"db","type":"database","fields":["name_first","name_last","address_country_code","email_address"]}""",
            """{"id":"wallet","type":"crypto_wallet","chains":["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],"signing":["paste"],"maxAttempts":1}""",
        )

        assertEquals(flow, OpenVerifyJson.decodeFromString<Flow>(OpenVerifyJson.encodeToString(Flow.serializer(), flow)))
    }

    @Test
    fun `a Phase 5 step with a value this SDK cannot use decodes as Unsupported, keeping its type`() {
        val steps = flowWith(
            """{"id":"aamva","type":"aamva","source":"barcode"}""",
            """{"id":"wallet","type":"crypto_wallet","chains":["eip155:1"],"signing":["hardware"]}""",
            """{"id":"db","type":"database","fields":["name_first","shoe_size"]}""",
            """{"id":"phone","type":"phone_otp"}""",
        ).steps

        assertEquals(
            listOf(
                UnsupportedStep("aamva", "aamva"),
                UnsupportedStep("wallet", "crypto_wallet"),
                UnsupportedStep("db", "database"),
                UnsupportedStep("phone", "phone_otp"),
            ),
            steps,
        )
    }

    @Test
    fun `the database fields, AAMVA sources and signing methods are flow-spec's, in its order`() {
        assertEquals(
            ContractSources.strings(ContractSources.FLOW_SPEC, "DATABASE_FIELDS"),
            DatabaseField.entries.map { OpenVerifyJson.encodeToString(DatabaseField.serializer(), it).trim('"') },
        )
        assertEquals(
            ContractSources.strings(ContractSources.FLOW_SPEC, "AAMVA_SOURCES"),
            AamvaSource.entries.map { OpenVerifyJson.encodeToString(AamvaSource.serializer(), it).trim('"') },
        )
        assertEquals(
            ContractSources.strings(ContractSources.FLOW_SPEC, "CRYPTO_SIGNING_METHODS"),
            CryptoSigningMethod.entries.map { OpenVerifyJson.encodeToString(CryptoSigningMethod.serializer(), it).trim('"') },
        )
    }

    // Attempts (C50.1, C50.2) ----------------------------------------------------------------

    @Test
    fun `each Phase 5 type's default attempts are the contracts' DEFAULT_MAX_ATTEMPTS (C50_1)`() {
        val contracts = ContractSources.numbers(ContractSources.CONTRACTS_TYPES, "DEFAULT_MAX_ATTEMPTS")

        assertEquals(9, contracts.size, contracts.toString())
        assertEquals(
            contracts,
            DEFAULT_MAX_ATTEMPTS.mapKeys { (type, _) -> type.apiValue.replace('-', '_') },
        )
    }

    @Test
    fun `a step's attempts are its own maxAttempts, else its type's default (C50_2)`() {
        assertEquals(4, stepMaxAttempts(PhoneOtpStep("phone", listOf("US"), maxAttempts = 4)))
        assertEquals(5, stepMaxAttempts(PhoneOtpStep("phone", listOf("US"))))
        assertEquals(5, stepMaxAttempts(EmailOtpStep("email")))
        assertEquals(1, stepMaxAttempts(DatabaseStep("db", listOf(DatabaseField.NAME_FIRST))))
        assertEquals(1, stepMaxAttempts(AamvaStep("aamva", AamvaSource.FORM)))
        assertEquals(3, stepMaxAttempts(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE))))
        assertEquals(2, stepMaxAttempts(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE), maxAttempts = 2)))
        assertEquals(3, stepMaxAttempts(ContractFixturesTest.DEFAULT_FLOW_STEPS[1]))
        assertNull(stepMaxAttempts(ContractFixturesTest.DEFAULT_FLOW_STEPS[0]))
        assertNull(stepMaxAttempts(UnsupportedStep("doc", "document")))
    }

    // Guidance (C52.2) -----------------------------------------------------------------------

    @Test
    fun `a phone verification's guidance gives its countries, code length and open code (C52_2)`() {
        val verification = flowVerification(
            "phone-number",
            """{"allowed-countries":["US"],"code-length":6,"otp":{"masked-destination":"+1 ••• ••• ••00",""" +
                """"expires-at":"2026-10-20T12:10:00.000Z","resend-available-at":"2026-10-20T12:00:30.000Z",""" +
                """"sends-remaining":4,"attempts-remaining":5}}""",
        )

        assertEquals(
            PhoneNumberGuidance(
                allowedCountries = listOf("US"),
                codeLength = 6,
                otp = OtpGuidanceState(
                    maskedDestination = "+1 ••• ••• ••00",
                    expiresAt = "2026-10-20T12:10:00.000Z",
                    resendAvailableAt = "2026-10-20T12:00:30.000Z",
                    sendsRemaining = 4,
                    attemptsRemaining = 5,
                ),
            ),
            verification.guidanceAs(PhoneNumberGuidance.serializer()),
        )
    }

    @Test
    fun `an email verification's guidance before the first send has no open code`() {
        val verification = flowVerification("email-address", """{"code-length":8,"otp":null}""")

        assertEquals(EmailAddressGuidance(codeLength = 8, otp = null), verification.guidanceAs(EmailAddressGuidance.serializer()))
    }

    @Test
    fun `an open code with no send left has no resend time`() {
        val verification = flowVerification(
            "email-address",
            """{"code-length":6,"otp":{"masked-destination":"j•••@example.test","expires-at":"2026-10-20T12:10:00.000Z",""" +
                """"resend-available-at":null,"sends-remaining":0,"attempts-remaining":2}}""",
        )

        val otp = verification.guidanceAs(EmailAddressGuidance.serializer())?.otp
        assertNull(otp?.resendAvailableAt)
        assertEquals(0, otp?.sendsRemaining)
        assertEquals(2, otp?.attemptsRemaining)
    }

    @Test
    fun `the database, AAMVA and crypto wallet guidance decode, and a form type says whether its values arrived`() {
        val database = flowVerification(
            "database",
            """{"fields":["name-first","name-last","birthdate","address-country-code"],"required-fields":["name-first","name-last"]}""",
            extra = ""","inputs-received":true""",
        )
        val aamva = flowVerification("aamva", """{"source":"form"}""", extra = ""","inputs-received":false""")
        val wallet = flowVerification("crypto-wallet", """{"chains":["eip155:1"],"signing":["paste"]}""")

        assertEquals(
            DatabaseGuidance(listOf("name-first", "name-last", "birthdate", "address-country-code"), listOf("name-first", "name-last")),
            database.guidanceAs(DatabaseGuidance.serializer()),
        )
        assertEquals(true, database.attributes.inputsReceived)
        assertEquals(AamvaGuidance(AamvaSource.FORM), aamva.guidanceAs(AamvaGuidance.serializer()))
        assertEquals(false, aamva.attributes.inputsReceived)
        assertEquals(CryptoWalletGuidance(listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE)), wallet.guidanceAs(CryptoWalletGuidance.serializer()))
        assertNull(wallet.attributes.inputsReceived)
    }

    @Test
    fun `a verification without guidance, or with guidance of another shape, has none to read`() {
        val none = flowVerification("phone-number", guidance = null)
        val nullGuidance = flowVerification("phone-number", guidance = "null")
        val otherShape = flowVerification("phone-number", """{"source":"form"}""")

        assertNull(none.attributes.guidance)
        assertNull(none.guidanceAs(PhoneNumberGuidance.serializer()))
        assertNull(nullGuidance.guidanceAs(PhoneNumberGuidance.serializer()))
        assertNull(otherShape.guidanceAs(PhoneNumberGuidance.serializer()))
        assertEquals(
            buildJsonObject { put("source", "form") },
            otherShape.attributes.guidance,
        )
    }

    @Test
    fun `a flow verification never prints its guidance, which names the destination even masked (C53_8)`() {
        val verification = flowVerification(
            "phone-number",
            """{"allowed-countries":["US"],"code-length":6,"otp":{"masked-destination":"+1 ••• ••• ••00",""" +
                """"expires-at":"2026-10-20T12:10:00.000Z","resend-available-at":null,"sends-remaining":0,"attempts-remaining":5}}""",
        )

        assertFalse("••00" in verification.toString(), verification.toString())
        assertFalse("••00" in checkNotNull(verification.guidanceAs(PhoneNumberGuidance.serializer())).toString())
    }

    // Problem members (C52.7) ----------------------------------------------------------------

    @Test
    fun `a wrong code's problem says how many tries are left (C52_7)`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read("problems/flow/otp-incorrect.json"))

        assertEquals("otp_incorrect", problem.code)
        assertEquals(4, problem.attemptsRemaining)
        assertNull(problem.resendAvailableAt)
    }

    @Test
    fun `a resend that is too soon says when the next one is allowed (C52_7)`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read("problems/flow/otp-resend-too-soon.json"))

        assertEquals("otp_resend_too_soon", problem.code)
        assertEquals("2026-10-20T12:01:00.000Z", problem.resendAvailableAt)
        assertNull(problem.attemptsRemaining)
    }

    // Request bodies (C52.3, C55, C57.3) -----------------------------------------------------

    @Test
    fun `a code goes to a phone number or an email address, under its own member (C55)`() {
        assertEquals(
            """{"phone-number":"+15555550100"}""",
            OpenVerifyJson.encodeToString(OtpDestination.Phone.serializer(), OtpDestination.Phone("+15555550100")),
        )
        assertEquals(
            """{"email-address":"jane@example.test"}""",
            OpenVerifyJson.encodeToString(OtpDestination.Email.serializer(), OtpDestination.Email("jane@example.test")),
        )
    }

    @Test
    fun `a destination never prints the number or the address (C53_8)`() {
        val phone = OtpDestination.Phone("+15555550100").toString()
        val email = OtpDestination.Email("jane@example.test").toString()

        assertFalse("5555550100" in phone, phone)
        assertFalse("jane" in email, email)
    }

    @Test
    fun `database values are sent kebab-case, leaving out the ones not entered (C52_3)`() {
        val inputs = DatabaseInputs(
            nameFirst = "Jane",
            nameLast = "Example",
            birthdate = "1990-04-23",
            addressCountryCode = "US",
            phoneNumber = "+15555550100",
        )

        assertEquals(
            """{"name-first":"Jane","name-last":"Example","birthdate":"1990-04-23","address-country-code":"US","phone-number":"+15555550100"}""",
            OpenVerifyJson.encodeToString(DatabaseInputs.serializer(), inputs),
        )
        assertEquals("{}", OpenVerifyJson.encodeToString(DatabaseInputs.serializer(), DatabaseInputs()))
    }

    @Test
    fun `the AAMVA form sends the card's details, leaving out the optional ones not entered (C52_3)`() {
        val inputs = AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA", addressPostalCode = "90001")

        assertEquals(
            """{"name-first":"Jane","name-last":"Example","birthdate":"1990-04-23","identification-number":"D1234567",""" +
                """"issuing-authority":"CA","address-postal-code":"90001"}""",
            OpenVerifyJson.encodeToString(AamvaInputs.serializer(), inputs),
        )
    }

    @Test
    fun `entered values never print (C53_8)`() {
        val database = DatabaseInputs(nameFirst = "Jane", birthdate = "1990-04-23", emailAddress = "jane@example.test").toString()
        val aamva = AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA").toString()

        for (value in listOf("Jane", "1990-04-23", "jane@example.test")) assertFalse(value in database, database)
        for (value in listOf("Jane", "Example", "1990-04-23", "D1234567")) assertFalse(value in aamva, aamva)
    }

    @Test
    fun `the AAMVA issuing authorities are the contracts' US_JURISDICTIONS, in order`() {
        val contracts = ContractSources.strings(ContractSources.CONTRACTS_INPUTS, "US_JURISDICTIONS")

        assertEquals(56, contracts.size)
        assertEquals(contracts, US_JURISDICTIONS)
    }

    @Test
    fun `a wallet submit names its challenge and signature, and the wrapped message only when there is one (C57_3)`() {
        val plain = FlowCryptoSubmitBody(FlowCryptoSubmit(CHALLENGE_ID, "0xabc"))
        val solana = FlowCryptoSubmitBody(
            FlowCryptoSubmit(CHALLENGE_ID, "c2ln", signedMessage = "wrapped", scheme = CryptoSignatureScheme.SOLANA_ED25519),
        )

        assertEquals(
            """{"crypto":{"challenge-id":"$CHALLENGE_ID","signature":"0xabc"}}""",
            OpenVerifyJson.encodeToString(FlowCryptoSubmitBody.serializer(), plain),
        )
        assertEquals(
            """{"crypto":{"challenge-id":"$CHALLENGE_ID","signature":"c2ln","signed-message":"wrapped","scheme":"solana-ed25519"}}""",
            OpenVerifyJson.encodeToString(FlowCryptoSubmitBody.serializer(), solana),
        )
    }

    @Test
    fun `the signature schemes are core's CRYPTO_SIGNATURE_SCHEMES (C57_1)`() {
        assertEquals(
            ContractSources.strings(ContractSources.CORE_CRYPTO_CHAINS, "CRYPTO_SIGNATURE_SCHEMES"),
            CryptoSignatureScheme.entries.map { OpenVerifyJson.encodeToString(CryptoSignatureScheme.serializer(), it).trim('"') },
        )
    }

    @Test
    fun `a wallet challenge decodes from its 201 answer, and never prints its message or the signature (C57_2)`() {
        val challenge = OpenVerifyJson.decodeFromString<FlowCryptoChallenge>(
            """{"id":"$CHALLENGE_ID","message":"openverify.test wants you to sign in with your Ethereum account:\n0xSynthetic",""" +
                """"expires-at":"2026-10-20T12:10:00.000Z"}""",
        )
        val submit = FlowCryptoSubmit(CHALLENGE_ID, "0xsignaturebytes", signedMessage = "wrapped-bytes")

        assertEquals(CHALLENGE_ID, challenge.id)
        assertEquals("2026-10-20T12:10:00.000Z", challenge.expiresAt)
        assertTrue(challenge.message.endsWith("0xSynthetic"))
        assertFalse("0xSynthetic" in challenge.toString(), challenge.toString())
        assertFalse("signaturebytes" in submit.toString(), submit.toString())
        assertFalse("wrapped-bytes" in submit.toString(), submit.toString())
    }

    @Test
    fun `a wallet challenge whose id breaks the contract does not decode`() {
        assertThrows<IllegalArgumentException> {
            OpenVerifyJson.decodeFromString<FlowCryptoChallenge>(
                """{"id":"ver_01M5CK16P0D13FXHZSS4TCFBVH","message":"m","expires-at":"2026-10-20T12:10:00.000Z"}""",
            )
        }
    }

    // Constants (C55.2) ----------------------------------------------------------------------

    @Test
    fun `the code lengths are the contracts' OTP_CODE_LENGTH (C55_2)`() {
        val contracts = ContractSources.numbers(ContractSources.CONTRACTS_OTP, "OTP_CODE_LENGTH")

        assertEquals(mapOf("min" to 6, "max" to 10, "default" to 6), contracts)
        assertEquals(contracts.getValue("min"), OtpLimits.MIN_CODE_LENGTH)
        assertEquals(contracts.getValue("max"), OtpLimits.MAX_CODE_LENGTH)
        assertEquals(contracts.getValue("default"), OtpLimits.DEFAULT_CODE_LENGTH)
    }

    @Test
    fun `guidance with a member a newer server added still decodes`() {
        val verification = flowVerification(
            "email-address",
            """{"code-length":6,"otp":null,"x-added-later":true}""",
        )

        assertEquals(EmailAddressGuidance(6, null), verification.guidanceAs(EmailAddressGuidance.serializer()))
        assertEquals(JsonPrimitive(true), (verification.attributes.guidance as JsonObject)["x-added-later"])
    }

    private companion object {
        const val CHALLENGE_ID = "cwc_01M5CK16P0D13FXHZSS4TCFBVH"
    }
}
