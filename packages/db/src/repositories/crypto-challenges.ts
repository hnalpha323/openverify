/**
 * C53.2, C57.2, C57.3: the server-issued challenges a wallet signs (`cwc_`). The address (as the
 * user claimed it, so the job still sees whether an EVM address carried its EIP-55 checksum), the
 * message, the signature and the signed message are sealed to the row
 * (`crypto_challenges.<column>#<id>`); the address in its canonical form
 * (`canonicalCryptoAddress`: EVM and bech32 lower-cased, base58 exact) is also indexed by a blind
 * index (`openverify/crypto-address/v1`, `cryptoAddressIndex`).
 *
 * Workflow 5A Stage 1b wrote this file, the reads the job and the attributes use, redaction and
 * the index rebuild; `api-crypto` added the writes: create, count, supersede, consume by a
 * conditional update, and `processed` after the job. Callers hold the C40.6 lock order: the
 * inquiry (`redacted_at` re-checked), then the verification, then the challenge.
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { assertBlindIndexKey, cryptoAddressIndex } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openValue, sealValue, type Sealed } from '../sealed.js';
import { cryptoChallenges, type CryptoChallengeRow } from '../schema.js';
import type { RebuildIndexesOptions, RebuildIndexesResult } from './government-id-extractions.js';
import { firstOrNull, inserted } from './rows.js';

/** Rows per rebuild transaction, as the extractions' rebuild. */
const DEFAULT_REBUILD_BATCH_SIZE = 100;

/** C53.2: a challenge's lifecycle; only one per verification is `initiated` at a time. */
export const CRYPTO_CHALLENGE_STATUSES = [
  'initiated',
  'submitted',
  'processed',
  'expired',
  'superseded',
] as const;
export type CryptoChallengeStatus = (typeof CRYPTO_CHALLENGE_STATUSES)[number];

export interface CryptoChallenge {
  id: string;
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  /** CAIP-2, canonical (C57.1). */
  chainId: string;
  status: CryptoChallengeStatus;
  /** The signature scheme the submit named or the job established; `null` before submit. */
  scheme: string | null;
  /** The address's blind index; `null` once redacted. */
  addressIndex: string | null;
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  redactedAt: Date | null;
}

/** The sealed values of a challenge, opened. PII; `null` members once redacted or not given. */
export interface CryptoChallengeEvidence {
  walletAddress: string | null;
  message: string | null;
  signature: string | null;
  signedMessage: string | null;
}

function toChallenge(row: CryptoChallengeRow): CryptoChallenge {
  return {
    id: row.id,
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    chainId: row.chainId,
    status: row.status,
    scheme: row.scheme,
    addressIndex: row.addressIndex,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
    redactedAt: row.redactedAt,
  };
}

const ofChallenge = (environmentId: string, id: string) =>
  and(eq(cryptoChallenges.environmentId, environmentId), eq(cryptoChallenges.id, id));

const ofVerification = (environmentId: string, verificationId: string) =>
  and(
    eq(cryptoChallenges.environmentId, environmentId),
    eq(cryptoChallenges.verificationId, verificationId),
  );

export async function getCryptoChallenge(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CryptoChallenge | null> {
  const row = firstOrNull(
    await db.select().from(cryptoChallenges).where(ofChallenge(environmentId, id)),
  );
  return row === null ? null : toChallenge(row);
}

/** A verification's challenges, newest first. */
export async function listCryptoChallenges(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<CryptoChallenge[]> {
  const rows = await db
    .select()
    .from(cryptoChallenges)
    .where(ofVerification(environmentId, verificationId))
    .orderBy(desc(cryptoChallenges.createdAt), desc(cryptoChallenges.id));
  return rows.map(toChallenge);
}

/** The job's read (C57.4): the verification's newest `submitted` challenge, or `null`. */
export async function getSubmittedCryptoChallenge(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<CryptoChallenge | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(cryptoChallenges)
      .where(
        and(
          ofVerification(environmentId, verificationId),
          eq(cryptoChallenges.status, 'submitted'),
        ),
      )
      .orderBy(desc(cryptoChallenges.submittedAt), desc(cryptoChallenges.id))
      .limit(1),
  );
  return row === null ? null : toChallenge(row);
}

/** The challenge's sealed values, opened; `null` when not found. PII. */
export async function openCryptoChallengeEvidence(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CryptoChallengeEvidence | null> {
  const row = firstOrNull(
    await db
      .select({
        walletAddress: cryptoChallenges.walletAddressSealed,
        message: cryptoChallenges.messageSealed,
        signature: cryptoChallenges.signatureSealed,
        signedMessage: cryptoChallenges.signedMessageSealed,
      })
      .from(cryptoChallenges)
      .where(ofChallenge(environmentId, id)),
  );
  if (row === null) {
    return null;
  }
  const open = (column: string, sealed: Sealed | null) =>
    sealed === null ? null : openValue(column, id, sealed);
  return {
    walletAddress: open(SEALED.cryptoChallengeWalletAddress, row.walletAddress),
    message: open(SEALED.cryptoChallengeMessage, row.message),
    signature: open(SEALED.cryptoChallengeSignature, row.signature),
    signedMessage: open(SEALED.cryptoChallengeSignedMessage, row.signedMessage),
  };
}

// The writes (api-crypto, C57.2, C57.3) ------------------------------------------------------

/** The human-readable parts of the bech32 addresses of the `bip122` chains Phase 5 knows. */
const BECH32_ADDRESS = /^(?:bc|tb|bcrt|ltc|tltc|rltc)1/iu;

/**
 * C57.2: the form a wallet address is indexed in: an EVM address and a bech32 (segwit) address
 * lower-cased, a base58 address exactly as written, as `cryptoAddressesEqual` compares them.
 */
export function canonicalCryptoAddress(chainId: string, address: string): string {
  if (chainId.startsWith('eip155:')) {
    return address.toLowerCase();
  }
  return chainId.startsWith('bip122:') && BECH32_ADDRESS.test(address)
    ? address.toLowerCase()
    : address;
}

/** A new challenge as the challenge route builds it (C57.2). */
export interface NewCryptoChallenge {
  id: string;
  verificationId: string;
  inquiryId: string;
  /** CAIP-2, canonical (C57.1). */
  chainId: string;
  /** The address as the user claimed it, already validated for the chain. Sealed; PII. */
  walletAddress: string;
  /** The message the server built for it. Sealed; PII (it carries the address). */
  message: string;
  /** Indexes the canonical address (`canonicalCryptoAddress`), under the environment subkey. */
  blindIndexKey: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
}

/** C57.2: a new `initiated` challenge. The caller closed the open one first. */
export async function createCryptoChallenge(
  tx: Db,
  environmentId: string,
  input: NewCryptoChallenge,
): Promise<CryptoChallenge> {
  const row = inserted(
    await tx
      .insert(cryptoChallenges)
      .values({
        id: input.id,
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        chainId: input.chainId,
        walletAddressSealed: sealValue(
          SEALED.cryptoChallengeWalletAddress,
          input.id,
          input.walletAddress,
        ),
        addressIndex: cryptoAddressIndex(input.blindIndexKey, {
          environmentId,
          address: canonicalCryptoAddress(input.chainId, input.walletAddress),
        }),
        messageSealed: sealValue(SEALED.cryptoChallengeMessage, input.id, input.message),
        status: 'initiated',
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning(),
    'createCryptoChallenge',
  );
  return toChallenge(row);
}

/** C57.2: how many challenges a verification has had (the 11th create cancels it). */
export async function countCryptoChallenges(
  tx: Db,
  environmentId: string,
  verificationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(cryptoChallenges)
    .where(ofVerification(environmentId, verificationId));
  return row?.count ?? 0;
}

/**
 * C57.2, C54.1: closes the verification's open (`initiated`) challenge: `expired` when it is past
 * its expiry at `options.now`, `superseded` otherwise (always `superseded` without a `now`).
 * Returns the challenges it closed.
 */
export async function supersedeOpenCryptoChallenges(
  tx: Db,
  environmentId: string,
  verificationId: string,
  options: { now?: Date } = {},
): Promise<CryptoChallenge[]> {
  const status =
    options.now === undefined
      ? sql`'superseded'`
      : sql`case when ${cryptoChallenges.expiresAt} <= ${options.now.toISOString()}::timestamptz then 'expired' else 'superseded' end`;
  const rows = await tx
    .update(cryptoChallenges)
    .set({ status })
    .where(
      and(ofVerification(environmentId, verificationId), eq(cryptoChallenges.status, 'initiated')),
    )
    .returning();
  return rows.map(toChallenge);
}

/** What a submit hands in for a challenge (C57.3). PII. */
export interface CryptoChallengeSubmission {
  signature: string;
  /** The exact bytes the wallet signed, as the client sent them (base64), or `null`. */
  signedMessage: string | null;
  /** The scheme the client named, or `null`. */
  scheme: string | null;
}

/**
 * C57.3: consumes the challenge once, in the submit transaction: `initiated`, of this
 * verification, unredacted and unexpired at `now` becomes `submitted`, with the signature and the
 * signed message sealed to it. `null` when the conditional update matched nothing (unknown,
 * consumed, superseded, expired or another verification's).
 */
export async function consumeCryptoChallenge(
  tx: Db,
  environmentId: string,
  input: { id: string; verificationId: string; now: Date; submission: CryptoChallengeSubmission },
): Promise<CryptoChallenge | null> {
  const { id, submission } = input;
  const row = firstOrNull(
    await tx
      .update(cryptoChallenges)
      .set({
        status: 'submitted',
        submittedAt: input.now,
        signatureSealed: sealValue(SEALED.cryptoChallengeSignature, id, submission.signature),
        signedMessageSealed:
          submission.signedMessage === null
            ? null
            : sealValue(SEALED.cryptoChallengeSignedMessage, id, submission.signedMessage),
        scheme: submission.scheme,
      })
      .where(
        and(
          ofChallenge(environmentId, id),
          eq(cryptoChallenges.verificationId, input.verificationId),
          eq(cryptoChallenges.status, 'initiated'),
          isNull(cryptoChallenges.redactedAt),
          sql`${cryptoChallenges.expiresAt} > ${input.now.toISOString()}::timestamptz`,
        ),
      )
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/**
 * C57.4: `submitted` -> `processed` once the job decided the verification or failed it, recording
 * the scheme the signature was checked under when the job established one. `null` when the
 * challenge is not `submitted`.
 */
export async function markCryptoChallengeProcessed(
  tx: Db,
  environmentId: string,
  id: string,
  options: { scheme?: string | null } = {},
): Promise<CryptoChallenge | null> {
  const row = firstOrNull(
    await tx
      .update(cryptoChallenges)
      .set({
        status: 'processed',
        ...(options.scheme == null ? {} : { scheme: options.scheme }),
      })
      .where(and(ofChallenge(environmentId, id), eq(cryptoChallenges.status, 'submitted')))
      .returning(),
  );
  return row === null ? null : toChallenge(row);
}

/**
 * C53.6: clears every sealed value and the index of these verifications' challenges and sets
 * `redacted_at` (kept on a re-run); returns the rows matched.
 */
export async function redactCryptoChallenges(
  tx: Db,
  environmentId: string,
  verificationIds: readonly string[],
  at: Date,
): Promise<number> {
  if (verificationIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(cryptoChallenges)
    .set({
      walletAddressSealed: null,
      addressIndex: null,
      messageSealed: null,
      signatureSealed: null,
      signedMessageSealed: null,
      redactedAt: sql`coalesce(${cryptoChallenges.redactedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(cryptoChallenges.environmentId, environmentId),
        inArray(cryptoChallenges.verificationId, [...verificationIds]),
      ),
    )
    .returning({ id: cryptoChallenges.id });
  return rows.length;
}

/**
 * C53.4 `blind-index:rebuild`: recomputes the address index of every unredacted challenge, in
 * every environment, under `key`, from its sealed address in its canonical form
 * (`canonicalCryptoAddress`), as the challenge route indexed it. Each batch runs in its own transaction
 * and locks its rows. Neither addresses nor indexes are logged or returned.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes, before anything is read.
 */
export async function rebuildCryptoAddressIndexes(
  db: Db,
  key: Uint8Array,
  options: RebuildIndexesOptions = {},
): Promise<RebuildIndexesResult> {
  assertBlindIndexKey(key);
  const batchSize = options.batchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
  const t = cryptoChallenges;
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: t.id,
          environmentId: t.environmentId,
          chainId: t.chainId,
          walletAddressSealed: t.walletAddressSealed,
          addressIndex: t.addressIndex,
        })
        .from(t)
        .where(and(isNull(t.redactedAt), gt(t.id, after)))
        .orderBy(asc(t.id))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        if (row.walletAddressSealed === null) {
          continue;
        }
        const index = cryptoAddressIndex(key, {
          environmentId: row.environmentId,
          address: canonicalCryptoAddress(
            row.chainId,
            openValue(SEALED.cryptoChallengeWalletAddress, row.id, row.walletAddressSealed),
          ),
        });
        if (index !== row.addressIndex) {
          await tx.update(t).set({ addressIndex: index }).where(eq(t.id, row.id));
          changed += 1;
        }
      }
      return { count: rows.length, changed, last: rows.at(-1)?.id };
    });
    scanned += batch.count;
    updated += batch.changed;
    if (batch.last === undefined || batch.count < batchSize) {
      return { scanned, updated };
    }
    after = batch.last;
  }
}
