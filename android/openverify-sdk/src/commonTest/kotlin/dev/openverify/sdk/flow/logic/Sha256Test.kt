package dev.openverify.sdk.flow.logic

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C200.2 (decision 14): our own SHA-256 in `commonMain`, against the short published NIST vectors
 * (FIPS 180-2's examples and the one-million-`a` message), and at every padding boundary (55, 56,
 * 63, 64, 65, 119, 120 and 128 bytes), whose digests are CPython's `hashlib` (an independent
 * implementation), so the consent digests the server matches are SHA-256 itself.
 */
internal class Sha256Test {

    @Test
    fun theNistVectors() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Sha256.hexOfUtf8("abc"))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Sha256.hexOfUtf8(""))
        assertEquals(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            Sha256.hexOfUtf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        )
        assertEquals(
            "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
            Sha256.hexOfUtf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
        )
        assertEquals("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", Sha256.hexOfUtf8("a".repeat(1_000_000)))
    }

    @Test
    fun everyPaddingBoundary() {
        val expected = mapOf(
            55 to "d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072",
            56 to "04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e",
            63 to "75220b47218278e656f2013bb8f0c455a25eaf01e86c64924e9d48d89776d6f2",
            64 to "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c",
            65 to "9537c5fdf120482f7d58d25e9ed583f52c02b4e304ea814db1633ad565aed7e9",
            119 to "000b48d4edf0fa7bee3c6236ecd2785baa5db4eeb8bb54341b029e0d9fa5fb0c",
            120 to "13f05a0b594787f5ecd315edc96141bd3243203d1b7d4f0836f37308b276ba98",
            128 to "24da1b81d0b16df6428eee73c69fcb2a93c76bc6df706f0c6670fe6bfe800464",
        )
        assertEquals(expected, expected.mapValues { (length, _) -> Sha256.hex("x".repeat(length).encodeToByteArray()) })
    }

    @Test
    fun hashesTheUtf8OfTheTextAndAnswersLowerCaseHex() {
        // "Café", an Arabic word and an astral emoji: two-, three-... and four-byte UTF-8 sequences.
        val text = "Café مرحبا 😀"
        assertEquals("49098e23892078247adb60da582096a5d6dcd53bc80dbc9bdd67b5b48c1c3064", Sha256.hexOfUtf8(text))
        assertEquals(Sha256.hex(text.encodeToByteArray()), Sha256.hexOfUtf8(text))
        assertEquals(32, Sha256.digest(ByteArray(0)).size)
    }
}
