package dev.openverify.sdk.fixtures

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C196.4 (reviews H14, F01): `commonTest` reads a shared golden fixture through [readContractFixture].
 * Runs on the JVM host now and on the iOS simulator in the next release, where the directory comes
 * from [CONTRACT_FIXTURES_DIRECTORY_VARIABLE].
 */
class ReadContractFixtureTest {

    @Test
    fun readsAFixtureByItsPathUnderContractsFixtures() {
        val text = readContractFixture("flow/selfie-capture.json")

        assertTrue(text.trimStart().startsWith("{"), "a JSON object")
        assertTrue("\"hold-ms\"" in text, "the selfie capture constants")
    }

    @Test
    fun aMissingFixtureFailsNamingOnlyItsPath() {
        val error = assertFailsWith<IllegalStateException> { readContractFixture("flow/no-such-fixture.json") }

        assertTrue("flow/no-such-fixture.json" in error.message.orEmpty())
        assertFalse("/home" in error.message.orEmpty(), "no absolute path")
    }
}
