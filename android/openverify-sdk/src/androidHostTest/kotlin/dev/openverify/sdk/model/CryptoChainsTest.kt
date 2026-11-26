package dev.openverify.sdk.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The SDK's copy of the C57.1 chain table, checked against core's `crypto-chains.ts`. */
class CryptoChainsTest {

    @Test
    fun `the chains with a fixed id are core's CRYPTO_CHAINS, with their names, in order (C57_1)`() {
        val core = ContractSources.matches(ContractSources.CORE_CRYPTO_CHAINS, Regex("""chain\('([^']+)', '[^']+', '([^']+)'"""))
            .map { CryptoChain(it.groupValues[1], it.groupValues[2]) }

        assertEquals(7, core.size)
        assertEquals(core, CryptoChains.fixed)
    }

    @Test
    fun `an EVM chain id follows core's EVM_CHAIN_ID_PATTERN`() {
        val pattern = ContractSources.matches(ContractSources.CORE_CRYPTO_CHAINS, Regex("""EVM_CHAIN_ID_PATTERN = /(.+)/;"""))
            .single().groupValues[1]

        assertEquals("^eip155:[1-9][0-9]{0,31}$", pattern)
        for (id in listOf("eip155:1", "eip155:8453", "eip155:" + "9".repeat(32))) assertTrue(CryptoChains.isChainId(id), id)
        for (id in listOf("eip155:0", "eip155:01", "eip155:" + "9".repeat(33), "eip155:1a", "eip155:", "EIP155:1")) {
            assertFalse(CryptoChains.isChainId(id), id)
        }
    }

    @Test
    fun `only a known chain in its canonical form is a chain id`() {
        for (chain in CryptoChains.fixed) assertTrue(CryptoChains.isChainId(chain.id), chain.id)
        // The hexadecimal TRON id is a deprecated alias the server turns into the decimal one.
        for (id in listOf("tron:0x2b6653dc", "bip122:0000", "solana:mainnet", "cosmos:cosmoshub-4", "")) {
            assertFalse(CryptoChains.isChainId(id), id)
        }
    }

    @Test
    fun `a chain is named by its proper name, Ethereum by its number one, other EVM chains by their number`() {
        assertEquals("Bitcoin", CryptoChains.name("bip122:000000000019d6689c085ae165831e93"))
        assertEquals("TRON", CryptoChains.name("tron:728126428"))
        assertEquals("Ethereum", CryptoChains.name("eip155:1"))
        assertNull(CryptoChains.name("eip155:8453"))
        assertEquals("8453", CryptoChains.evmChainNumber("eip155:8453"))
        assertNull(CryptoChains.evmChainNumber("eip155:1"))
        assertNull(CryptoChains.evmChainNumber("tron:728126428"))
        assertNull(CryptoChains.name("cosmos:cosmoshub-4"))
    }

    @Test
    fun `only a Solana wallet wraps the message it signs (C57_3)`() {
        assertTrue(CryptoChains.wrapsSignedMessage("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"))
        for (id in listOf("eip155:1", "bip122:000000000019d6689c085ae165831e93", "tron:728126428", "xrpl:0")) {
            assertFalse(CryptoChains.wrapsSignedMessage(id), id)
        }
    }
}
