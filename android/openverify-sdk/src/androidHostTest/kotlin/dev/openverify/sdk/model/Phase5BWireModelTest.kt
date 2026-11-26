package dev.openverify.sdk.model

import dev.openverify.sdk.flow.stepMaxAttempts
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The Workflow 5B wire models of the document, business registry and business website steps
 * (C50.3), checked against the frozen contracts.
 */
class Phase5BWireModelTest {

    private fun flowWith(vararg steps: String): Flow = OpenVerifyJson.decodeFromString(
        """{"metadata":{"specVersion":1,"id":"f","version":1,"name":"F"},"steps":[${steps.joinToString(",")}],"transitions":[]}""",
    )

    @Test
    fun `the document, business registry and website steps decode as their own steps (C50_3)`() {
        val steps = flowWith(
            """{"id":"proof","type":"document","documentTypes":["utility_bill","lease"],"captureMethods":["upload","camera"],"maxAttempts":2}""",
            """{"id":"business","type":"database_business","collectAssociatedPersons":true}""",
            """{"id":"website","type":"business_website"}""",
        ).steps

        assertEquals(
            listOf(
                DocumentStep(
                    "proof",
                    listOf(DocumentClass.UTILITY_BILL, DocumentClass.LEASE),
                    listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA),
                    maxAttempts = 2,
                ),
                DatabaseBusinessStep("business", collectAssociatedPersons = true),
                BusinessWebsiteStep("website"),
            ),
            steps,
        )
        assertEquals(listOf("document", "database_business", "business_website"), steps.map { it.type })
    }

    @Test
    fun `a flow with the Workflow 5B steps round-trips through JSON`() {
        val flow = flowWith(
            """{"id":"proof","type":"document","documentTypes":["bank_statement"],"captureMethods":["upload"]}""",
            """{"id":"business","type":"database_business","maxAttempts":1}""",
            """{"id":"website","type":"business_website","maxAttempts":2}""",
        )

        assertEquals(flow, OpenVerifyJson.decodeFromString<Flow>(OpenVerifyJson.encodeToString(Flow.serializer(), flow)))
    }

    @Test
    fun `a Workflow 5B step with a value this SDK cannot use decodes as Unsupported, keeping its type`() {
        val steps = flowWith(
            """{"id":"proof","type":"document","documentTypes":["passport"],"captureMethods":["upload"]}""",
            """{"id":"scan","type":"document","documentTypes":["utility_bill"],"captureMethods":["scanner"]}""",
            """{"id":"business","type":"database_business","collectAssociatedPersons":"yes"}""",
        ).steps

        assertEquals(
            listOf(
                UnsupportedStep("proof", "document"),
                UnsupportedStep("scan", "document"),
                UnsupportedStep("business", "database_business"),
            ),
            steps,
        )
    }

    @Test
    fun `the document classes are core's DOCUMENT_TYPES, in its order`() {
        assertEquals(
            ContractSources.strings(CORE_ENUMS, "DOCUMENT_TYPES"),
            DocumentClass.entries.map { OpenVerifyJson.encodeToString(DocumentClass.serializer(), it).trim('"') },
        )
    }

    @Test
    fun `a Workflow 5B step's attempts are its own maxAttempts, else three (C50_1, C50_2)`() {
        val proof = DocumentStep("proof", listOf(DocumentClass.UTILITY_BILL), listOf(CaptureMethod.UPLOAD))

        assertEquals(3, stepMaxAttempts(proof))
        assertEquals(1, stepMaxAttempts(proof.copy(maxAttempts = 1)))
        assertEquals(3, stepMaxAttempts(DatabaseBusinessStep("business")))
        assertEquals(2, stepMaxAttempts(DatabaseBusinessStep("business", maxAttempts = 2)))
        assertEquals(3, stepMaxAttempts(BusinessWebsiteStep("website")))
        assertEquals(5, stepMaxAttempts(BusinessWebsiteStep("website", maxAttempts = 5)))
    }

    // Guidance (C52.2) --------------------------------------------------------------------------

    private fun flowVerification(type: String, guidance: String?): FlowVerification = OpenVerifyJson.decodeFromString(
        """{"type":"verification/$type","id":"ver_01M5CK16P0D13FXHZSS4TCFBVH","attributes":{"status":"initiated",""" +
            """"retry-hints":[],"created-at":"2026-10-20T12:02:00.000Z","updated-at":"2026-10-20T12:02:00.000Z"""" +
            (if (guidance == null) "" else ""","guidance":$guidance""") + "}}",
    )

    @Test
    fun `a document's guidance decodes as its own shape, and another shape counts as none (C52_2)`() {
        val document = flowVerification(
            "document",
            """{"accepted-types":["utility_bill","lease"],"max-age-days":90,"max-pages":50,"accepted-mime-types":["application/pdf","image/jpeg"]}""",
        )

        assertEquals(
            DocumentGuidance(listOf(DocumentClass.UTILITY_BILL, DocumentClass.LEASE), 90, 50, listOf("application/pdf", "image/jpeg")),
            document.guidanceAs(DocumentGuidance.serializer()),
        )
        assertNull(flowVerification("document", """{"accepted-types":["passport"]}""").guidanceAs(DocumentGuidance.serializer()))
        assertNull(flowVerification("document", null).guidanceAs(DocumentGuidance.serializer()))
    }

    @Test
    fun `a business's guidance says whether it collects people and which inputs every match group needs (C52_2)`() {
        val business = flowVerification(
            "database-business",
            """{"collect-associated-persons":true,"required-inputs":["business-name","registration-number"]}""",
        )

        assertEquals(
            DatabaseBusinessGuidance(collectAssociatedPersons = true, requiredInputs = listOf("business-name", "registration-number")),
            business.guidanceAs(DatabaseBusinessGuidance.serializer()),
        )
    }

    // Bodies (C52.3) ---------------------------------------------------------------------------

    @Test
    fun `the business and website bodies are kebab-case, leave out absent members and never print their values`() {
        val business = DatabaseBusinessInputs(
            businessName = "Example Widgets Ltd",
            countryCode = "GB",
            registrationNumber = "01234567",
            addressCity = "Exampleton",
            associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample", "1980-04"), AssociatedPersonInputs("Casey", "Placeholder")),
        )
        val website = BusinessWebsiteInputs("https://www.example.com")

        assertEquals(
            """{"business-name":"Example Widgets Ltd","country-code":"GB","registration-number":"01234567","address-city":"Exampleton",""" +
                """"associated-persons":[{"name-first":"Robin","name-last":"Sample","birthdate":"1980-04"},{"name-first":"Casey","name-last":"Placeholder"}]}""",
            OpenVerifyJson.encodeToString(DatabaseBusinessInputs.serializer(), business),
        )
        assertEquals("""{"website-url":"https://www.example.com"}""", OpenVerifyJson.encodeToString(BusinessWebsiteInputs.serializer(), website))
        for (printed in listOf(business.toString(), website.toString(), business.associatedPersons.orEmpty().first().toString())) {
            for (value in listOf("Example Widgets", "01234567", "Exampleton", "Robin", "Sample", "1980-04", "example.com")) {
                assertFalse(value in printed, printed)
            }
        }
    }

    @Test
    fun `every input field and person field is a member the contracts' bodies name`() {
        val members = ContractSources.matches(ContractSources.CONTRACTS_INPUTS, Regex("""'([a-z0-9-]+)'\s*:"""))
            .map { it.groupValues[1] }
            .toSet() + setOf("birthdate", "lei")

        assertEquals(emptyList<String>(), InputField.entries.map { it.wireName }.filter { it !in members })
        assertEquals(emptyList<String>(), PersonField.entries.map { it.wireName }.filter { it !in members })
    }

    @Test
    fun `at most the contracts' MAX_ASSOCIATED_PERSONS people go with a business`() {
        val declared = ContractSources.matches(ContractSources.CONTRACTS_INPUTS, Regex("""export const MAX_ASSOCIATED_PERSONS = ([0-9]+);"""))
            .single().groupValues[1].toInt()

        assertEquals(declared, DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS)
    }

    // Document files (C52.4) -------------------------------------------------------------------

    private fun pdfAt(offset: Int): ByteArray = ByteArray(offset) { ' '.code.toByte() } + "%PDF-1.7\n%synthetic\n".encodeToByteArray()

    @Test
    fun `a document is typed by its bytes, a PDF header within its first 1,024 bytes or an image (C52_4)`() {
        assertEquals("application/pdf", DocumentFile.sniff(pdfAt(0)))
        assertEquals("application/pdf", DocumentFile.sniff(pdfAt(1019)))
        assertNull(DocumentFile.sniff(pdfAt(1020)))
        assertEquals("image/jpeg", DocumentFile.sniff(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())))
        assertEquals("image/png", DocumentFile.sniff(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0)))
        assertEquals("image/webp", DocumentFile.sniff("RIFF\u0024\u0000\u0000\u0000WEBPVP8 ".encodeToByteArray()))
        assertNull(DocumentFile.sniff("just text".encodeToByteArray()))
        assertNull(DocumentFile.sniff(ByteArray(0)))
    }

    @Test
    fun `a document file refuses an empty, oversized or other file and never prints its bytes`() {
        val pdf = DocumentFile(pdfAt(0), "application/pdf")

        assertEquals("DocumentFile(application/pdf, ${pdfAt(0).size} bytes)", pdf.toString())
        assertEquals(pdf, DocumentFile(pdfAt(0), "application/pdf"))
        assertThrows<IllegalArgumentException> { DocumentFile(ByteArray(0), "application/pdf") }
        assertThrows<IllegalArgumentException> { DocumentFile(ByteArray(DocumentFile.MAX_BYTES + 1), "application/pdf") }
        assertThrows<IllegalArgumentException> { DocumentFile(pdfAt(0), "text/plain") }
        // The bytes must be what the type says.
        assertThrows<IllegalArgumentException> { DocumentFile(pdfAt(0), "image/png") }
    }

    @Test
    fun `the document media types are the contracts' DOCUMENT_MIME_TYPES, a PDF first`() {
        val images = ContractSources.strings(CONTRACTS_FILES, "ACCEPTED_IMAGE_MIME_TYPES")

        assertEquals(listOf("application/pdf") + images, DocumentFile.MIME_TYPES)
    }

    private companion object {
        const val CORE_ENUMS = "packages/core/src/enums.ts"
        const val CONTRACTS_FILES = "packages/contracts/src/files.ts"
    }
}
