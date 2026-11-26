package dev.openverify.sdk.model

/** A chain with a fixed CAIP-2 id (core `CRYPTO_CHAINS`, C57.1) and its name, a proper noun. */
internal data class CryptoChain(val id: String, val name: String)

/**
 * The chains C57.1 knows (core `crypto-chains.ts`): the fixed ids, and the EVM chains as a pattern.
 * A request names only these, in their canonical form (core `cryptoChainIdSchema`).
 */
internal object CryptoChains {
    /** The chains with a fixed id, in the C57.1 order. */
    val fixed: List<CryptoChain> = listOf(
        CryptoChain("bip122:000000000019d6689c085ae165831e93", "Bitcoin"),
        CryptoChain("bip122:000000000933ea01ad0ee984209779ba", "Bitcoin testnet"),
        CryptoChain("bip122:12a765e31ffd4059bada1e25190f6e98", "Litecoin"),
        CryptoChain("bip122:1a91e3dace36e2be3bf030a65679fe82", "Dogecoin"),
        CryptoChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "Solana"),
        CryptoChain("tron:728126428", "TRON"),
        // Validity only: no ownership proof exists for it (C50.4 refuses it in a required flow).
        CryptoChain("xrpl:0", "XRP Ledger"),
    )

    /** core `EVM_CHAIN_ID_PATTERN`: `eip155:` and a positive decimal chain id without leading zeros. */
    private val EVM = Regex("eip155:[1-9][0-9]{0,31}")

    private const val ETHEREUM = "eip155:1"

    /** core `cryptoChainIdSchema`'s bound. */
    private const val MAX_CHAIN_ID_LENGTH = 64

    /** Whether [value] is a chain id the contracts accept (core `isCryptoChainId`). */
    fun isChainId(value: String): Boolean =
        value.length <= MAX_CHAIN_ID_LENGTH && (fixed.any { it.id == value } || EVM.matches(value))

    /** The chain's name, `Ethereum` for `eip155:1`; `null` for another EVM chain or an unknown id. */
    fun name(chainId: String): String? =
        fixed.firstOrNull { it.id == chainId }?.name ?: if (chainId == ETHEREUM) "Ethereum" else null

    /** The chain number of an EVM chain other than Ethereum, which the screen names instead. */
    fun evmChainNumber(chainId: String): String? =
        if (chainId != ETHEREUM && EVM.matches(chainId)) chainId.removePrefix("eip155:") else null

    /**
     * Whether the wallet may wrap the message it signs, so the submit carries the signed bytes
     * (C57.3, C64.1: a Solana wallet's off-chain message envelope).
     */
    fun wrapsSignedMessage(chainId: String): Boolean = chainId.startsWith("solana:")
}

/** core `CRYPTO_INPUT_LIMITS` (C57.1): what a client may send. */
internal object CryptoLimits {
    const val ADDRESS_MAX_LENGTH: Int = 128
    const val SIGNATURE_MAX_LENGTH: Int = 1024
    const val MESSAGE_MAX_BYTES: Int = 4096
}
