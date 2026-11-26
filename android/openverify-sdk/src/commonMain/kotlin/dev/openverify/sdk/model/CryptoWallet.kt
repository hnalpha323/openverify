package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The message a wallet signs to prove control of an address (C57.2): the `201` answer of
 * `POST /api/v1/flow/verifications/:id/crypto-challenges`, returned once. It is single use and
 * lasts ten minutes; a new one supersedes it. The message names the wallet address, so it never
 * prints (C53.8).
 */
@Serializable
internal data class FlowCryptoChallenge(
    /** `cwc_` and a ULID (contract C1). */
    val id: String,
    /** The text to sign, as the server built it. */
    val message: String,
    @SerialName("expires-at") val expiresAt: String,
) {
    init {
        require(CRYPTO_CHALLENGE_ID.matches(id)) { "Not a wallet challenge ID" }
        require(message.isNotEmpty() && message.encodeToByteArray().size <= CryptoLimits.MESSAGE_MAX_BYTES) {
            "A challenge message is 1 byte to 4 KiB"
        }
    }

    override fun toString(): String = "FlowCryptoChallenge(id=$id, message=<redacted>, expiresAt=$expiresAt)"
}

/**
 * The submit body's `crypto` member (C57.3, contracts `flowCryptoSubmitSchema`): the signature over
 * the challenge's message and, when the wallet wraps the message (Solana), the bytes it signed.
 */
@Serializable
internal data class FlowCryptoSubmit(
    @SerialName("challenge-id") val challengeId: String,
    val signature: String,
    @SerialName("signed-message") val signedMessage: String? = null,
    /** `null` lets the server tell the scheme from the signature. */
    val scheme: CryptoSignatureScheme? = null,
) {
    override fun toString(): String =
        "FlowCryptoSubmit(challengeId=$challengeId, signature=<redacted>, " +
            "signedMessage=${if (signedMessage == null) "null" else "<redacted>"}, scheme=$scheme)"
}

/** A signature scheme (core `CRYPTO_SIGNATURE_SCHEMES`, C57.1). */
@Serializable
internal enum class CryptoSignatureScheme {
    @SerialName("eip191")
    EIP191,

    @SerialName("bip137")
    BIP137,

    @SerialName("bip322-simple")
    BIP322_SIMPLE,

    @SerialName("bip322-legacy")
    BIP322_LEGACY,

    @SerialName("solana-ed25519")
    SOLANA_ED25519,

    @SerialName("tron-v2")
    TRON_V2,
}

/** `POST /api/v1/flow/verifications/:id/submit` body of a crypto wallet verification (C57.3). */
@Serializable
internal class FlowCryptoSubmitBody(val crypto: FlowCryptoSubmit)

/** `cwc_` plus a ULID in upper-case Crockford base32 (contract C1). */
internal val CRYPTO_CHALLENGE_ID = Regex("cwc_[0-9A-HJKMNP-TV-Z]{26}")
