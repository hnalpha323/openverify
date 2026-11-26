package dev.openverify.nfc

import android.nfc.Tag
import android.nfc.tech.IsoDep
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.mrz.BacKeySeed
import net.sf.scuba.smartcards.CardFileInputStream
import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.IsoDepCardService
import org.jmrtd.BACKey
import org.jmrtd.PACEKeySpec
import org.jmrtd.PassportService
import org.jmrtd.lds.ActiveAuthenticationInfo
import org.jmrtd.lds.CardAccessFile
import org.jmrtd.lds.PACEInfo
import org.jmrtd.lds.SecurityInfo
import org.jmrtd.lds.icao.DG14File
import org.jmrtd.lds.icao.DG15File
import org.jmrtd.protocol.PACECAMResult
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * The thin JMRTD adapter (C209.3): each call of [ChipSession] is one call, or a few, of JMRTD's
 * `PassportService` over a SCUBA `CardService`. It decides nothing: the order, the fallbacks, the
 * limits and the meaning of every failure are [ChipReadOrchestrator]'s, and whatever JMRTD, SCUBA or
 * Bouncy Castle throws here passes up to it unchanged, to become one `ChipReadFailure`.
 *
 * It is the module's one class outside the coverage gate (C219.2), because the half of it that
 * needs a phone and a chip cannot run on the host. What does run there: `JmrtdChipSessionTest`
 * drives this class with the real `PassportService` against an in-process chip (Basic Access
 * Control, secure messaging, selection, reads and Active Authentication). PACE, Chip Authentication
 * and [over] run in no automated test.
 *
 * Bouncy Castle is used as JMRTD uses it: a provider object JMRTD makes for itself and passes to
 * each algorithm it asks for. Nothing here or there installs a provider (C209.2).
 */
internal class JmrtdChipSession(private val card: CardService, override val largeBlocks: Boolean) : ChipSession {
    private val transceiveLength = if (largeBlocks) PassportService.EXTENDED_MAX_TRANCEIVE_LENGTH else PassportService.NORMAL_MAX_TRANCEIVE_LENGTH

    // Files are selected by identifier, not by short identifier, and answers' checksums are not
    // checked here, as in JMRTD's own use: the server's Passive Authentication is what holds the bytes.
    private val service = PassportService(card, transceiveLength, transceiveLength, PassportService.DEFAULT_MAX_BLOCKSIZE, false, false)
    private var selected: CardFileInputStream? = null

    override fun open() = service.open()

    override fun select(file: ChipFile, largeBlocks: Boolean): Int {
        selected = null
        val stream = service.getInputStream(file.identifier.toShort(), if (largeBlocks) LARGE_BLOCK_BYTES else PassportService.DEFAULT_MAX_BLOCKSIZE)
        selected = stream
        return stream.length
    }

    override fun readSelected(read: (bytes: Int) -> Unit): ByteArray {
        val stream = checkNotNull(selected) { "No file is selected" }
        val length = stream.length
        val content = ByteArrayOutputStream(length)
        val block = ByteArray(PassportService.DEFAULT_MAX_BLOCKSIZE)
        while (content.size() < length) {
            val count = stream.read(block, 0, minOf(block.size, length - content.size()))
            if (count <= 0) break
            content.write(block, 0, count)
            read(content.size())
        }
        return content.toByteArray()
    }

    override fun offersPace(cardAccess: ByteArray): Boolean = paceInfo(cardAccess) != null

    override fun pace(access: ChipAccess, cardAccess: ByteArray): Boolean {
        val info = checkNotNull(paceInfo(cardAccess)) { "The chip offers no PACE" }
        val key = when (access) {
            is ChipAccess.Mrz -> PACEKeySpec.createMRZKey(BACKey(access.seed.documentNumber, access.seed.dateOfBirth, access.seed.dateOfExpiry))
            is ChipAccess.Can -> PACEKeySpec.createCANKey(access.can)
        }
        return service.doPACE(key, info.objectIdentifier, PACEInfo.toParameterSpec(info.parameterId), info.parameterId) is PACECAMResult
    }

    override fun selectApplication(afterPace: Boolean) = service.sendSelectApplet(afterPace)

    override fun bac(seed: BacKeySeed) {
        service.doBAC(BACKey(seed.documentNumber, seed.dateOfBirth, seed.dateOfExpiry))
    }

    override fun offersChipAuthentication(dg14: ByteArray): Boolean = DG14File(ByteArrayInputStream(dg14)).chipAuthenticationPublicKeyInfos.isNotEmpty()

    override fun chipAuthentication(dg14: ByteArray) {
        val file = DG14File(ByteArrayInputStream(dg14))
        val key = file.chipAuthenticationPublicKeyInfos.first()
        val info = file.chipAuthenticationInfos.firstOrNull { it.keyId == key.keyId } ?: file.chipAuthenticationInfos.firstOrNull()
        // A chip that names no protocol for its key uses the first one of the key's kind (ICAO Doc 9303 Part 11, 6.2).
        val protocol = info?.objectIdentifier
            ?: if (key.subjectPublicKey.algorithm.startsWith("EC")) SecurityInfo.ID_CA_ECDH_3DES_CBC_CBC else SecurityInfo.ID_CA_DH_3DES_CBC_CBC
        service.doEACCA(key.keyId, protocol, key.objectIdentifier, key.subjectPublicKey)
    }

    override fun activeAuthentication(dg15: ByteArray, dg14: ByteArray?, challenge: ByteArray): ByteArray {
        val key = DG15File(ByteArrayInputStream(dg15)).publicKey
        // The names only label JMRTD's result: the chip signs with its own algorithm, and nothing is verified here.
        val signature = when {
            key.algorithm == "RSA" -> "SHA1WithRSA/ISO9796-2"
            dg14 == null -> "SHA256withECDSA"
            else -> DG14File(ByteArrayInputStream(dg14)).activeAuthenticationInfos.firstOrNull()
                ?.let { ActiveAuthenticationInfo.lookupMnemonicByOID(it.signatureAlgorithmOID) } ?: "SHA256withECDSA"
        }
        return service.doAA(key, signature.substringBefore("with").substringBefore("With"), signature, challenge).response
    }

    override fun connectionLost(error: Exception): Boolean = card.isConnectionLost(error)

    override fun close() = service.close()

    private fun paceInfo(cardAccess: ByteArray): PACEInfo? =
        CardAccessFile(ByteArrayInputStream(cardAccess)).securityInfos.filterIsInstance<PACEInfo>().firstOrNull()

    internal companion object {
        /**
         * The block a file is read in from a chip that takes extended-length commands. Provisional:
         * four reads of the default block in one, so a portrait takes a quarter of the exchanges,
         * and far below what a phone's NFC controller carries in one exchange.
         */
        const val LARGE_BLOCK_BYTES: Int = 1024

        /**
         * How long one exchange with the chip may take, in milliseconds. Provisional: the platform's
         * default is under a second on most phones, and a chip may take longer than that over a key
         * agreement or a signature.
         */
        const val EXCHANGE_TIMEOUT_MS: Int = 5_000

        /**
         * A session over [tag], or `null` when it is no ISO-DEP tag and so no travel document: with
         * a raised timeout, extended-length commands where the tag takes them, and SCUBA's
         * `IsoDepCardService` made directly (C209.2).
         */
        fun over(tag: Tag): JmrtdChipSession? {
            val isoDep = IsoDep.get(tag) ?: return null
            isoDep.timeout = EXCHANGE_TIMEOUT_MS
            return JmrtdChipSession(IsoDepCardService(isoDep), isoDep.isExtendedLengthApduSupported)
        }
    }
}
