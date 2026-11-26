/**
 * C57.2, C57.3, C57.4: the writes of the wallet challenges (`api-crypto`): a new `initiated`
 * challenge with its address and message sealed and its canonical address indexed, the count the
 * challenge cap reads, the supersede (or expiry) of the open one, the single-use consumption by
 * a conditional update, and `processed` after the job. Every address and message is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { cryptoAddressIndex } from '../blind-index.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCryptoChallenge,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  canonicalCryptoAddress,
  consumeCryptoChallenge,
  countCryptoChallenges,
  createCryptoChallenge,
  createVerification,
  getCryptoChallenge,
  listCryptoChallenges,
  markCryptoChallengeProcessed,
  openCryptoChallengeEvidence,
  rebuildCryptoAddressIndexes,
  redactCryptoChallenges,
  supersedeOpenCryptoChallenges,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');
const TTL_MS = 600_000;
const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(3);
const ETHEREUM = 'eip155:1';
/** EIP-55's first published example: mixed case, so its canonical form differs. */
const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SUBMISSION = { signature: '0xsynthetic-signature', signedMessage: null, scheme: 'eip191' };

/** A tenant, an inquiry and `count` crypto wallet verifications of it. */
async function wallets(count = 1) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const verification = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'crypto_wallet',
    });
    ids.push(verification.id);
  }
  return { env: environment.id, inquiryId: inquiry.id, ids };
}

function newChallenge(
  verificationId: string,
  inquiryId: string,
  overrides: { walletAddress?: string; createdAt?: Date; chainId?: string } = {},
) {
  const createdAt = overrides.createdAt ?? AT;
  return {
    id: testId('cwc'),
    verificationId,
    inquiryId,
    chainId: overrides.chainId ?? ETHEREUM,
    walletAddress: overrides.walletAddress ?? CHECKSUMMED,
    message: `synthetic challenge at ${createdAt.toISOString()}`,
    blindIndexKey: KEY,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + TTL_MS),
  };
}

describe('canonicalCryptoAddress (C57.2)', () => {
  it.each([
    [ETHEREUM, CHECKSUMMED, CHECKSUMMED.toLowerCase()],
    ['eip155:137', `0x${'AB'.repeat(20)}`, `0x${'ab'.repeat(20)}`],
    [
      'bip122:000000000019d6689c085ae165831e93',
      'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    ],
    [
      'bip122:000000000933ea01ad0ee984209779ba',
      'TB1QRP33G0Q5C5TXSP9ARYSRX4K6ZDKFS4NCE4XJ0GDCCCEFVPYSXF3Q0SL5K7',
      'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
    ],
    ['bip122:12a765e31ffd4059bada1e25190f6e98', 'LTC1QSYNTHETIC', 'ltc1qsynthetic'],
  ])('lower-cases an EVM or bech32 address (%s)', (chainId, address, canonical) => {
    expect(canonicalCryptoAddress(chainId, address)).toBe(canonical);
  });

  it.each([
    ['bip122:000000000019d6689c085ae165831e93', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ['bip122:1a91e3dace36e2be3bf030a65679fe82', 'DSyntheticBase58AddressXyZ'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'SyntheticSoLanaBase58Key111111111111111111'],
    ['tron:728126428', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'],
    ['xrpl:0', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'],
  ])('keeps a base58 address exactly as written (%s)', (chainId, address) => {
    expect(canonicalCryptoAddress(chainId, address)).toBe(address);
  });
});

describe('createCryptoChallenge (C57.2)', () => {
  it('writes an initiated challenge, seals the claimed address and the message, and indexes the canonical address', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    const input = newChallenge(verificationId, inquiryId);

    const created = await createCryptoChallenge(database.db, env, input);

    expect(created).toEqual({
      id: input.id,
      environmentId: env,
      verificationId,
      inquiryId,
      chainId: ETHEREUM,
      status: 'initiated',
      scheme: null,
      addressIndex: cryptoAddressIndex(KEY, {
        environmentId: env,
        address: CHECKSUMMED.toLowerCase(),
      }),
      createdAt: AT,
      expiresAt: input.expiresAt,
      submittedAt: null,
      redactedAt: null,
    });
    expect(await openCryptoChallengeEvidence(database.db, env, input.id)).toEqual({
      walletAddress: CHECKSUMMED,
      message: input.message,
      signature: null,
      signedMessage: null,
    });
    const stored = await database.db.$client.query<Record<string, unknown>>(
      'select wallet_address, message from crypto_challenges where id = $1',
      [input.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(CHECKSUMMED);
    expect(JSON.stringify(stored.rows)).not.toContain('synthetic challenge');
  });

  it('refuses a second initiated challenge of one verification (the caller supersedes first)', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    await createCryptoChallenge(database.db, env, newChallenge(verificationId, inquiryId));

    await expect(
      createCryptoChallenge(database.db, env, newChallenge(verificationId, inquiryId)),
    ).rejects.toThrow();
  });
});

describe('countCryptoChallenges (C57.2)', () => {
  it('counts every challenge of the verification, whatever its status, in its environment only', async () => {
    const { env, inquiryId, ids } = await wallets(2);
    const [mine = '', other = ''] = ids;
    for (const status of ['superseded', 'expired', 'submitted'] as const) {
      await seedCryptoChallenge(database.db, env, {
        verificationId: mine,
        inquiryId,
        chainId: ETHEREUM,
        walletAddress: CHECKSUMMED,
        message: 'synthetic',
        status,
      });
    }
    await createCryptoChallenge(database.db, env, newChallenge(mine, inquiryId));
    await createCryptoChallenge(database.db, env, newChallenge(other, inquiryId));

    expect(await countCryptoChallenges(database.db, env, mine)).toBe(4);
    expect(await countCryptoChallenges(database.db, env, other)).toBe(1);
    expect(await countCryptoChallenges(database.db, (await wallets()).env, mine)).toBe(0);
  });
});

describe('supersedeOpenCryptoChallenges (C57.2, C54.1)', () => {
  it('supersedes the open challenge, leaving the others and other verifications alone', async () => {
    const { env, inquiryId, ids } = await wallets(2);
    const [mine = '', other = ''] = ids;
    const submitted = await seedCryptoChallenge(database.db, env, {
      verificationId: mine,
      inquiryId,
      chainId: ETHEREUM,
      walletAddress: CHECKSUMMED,
      message: 'synthetic',
      status: 'submitted',
    });
    const open = await createCryptoChallenge(database.db, env, newChallenge(mine, inquiryId));
    const untouched = await createCryptoChallenge(database.db, env, newChallenge(other, inquiryId));

    const closed = await supersedeOpenCryptoChallenges(database.db, env, mine, { now: AT });

    expect(closed.map((challenge) => [challenge.id, challenge.status])).toEqual([
      [open.id, 'superseded'],
    ]);
    expect((await getCryptoChallenge(database.db, env, submitted))?.status).toBe('submitted');
    expect((await getCryptoChallenge(database.db, env, untouched.id))?.status).toBe('initiated');
    expect(await supersedeOpenCryptoChallenges(database.db, env, mine, { now: AT })).toEqual([]);
  });

  it('marks the open challenge expired once past its expiry, and superseded without a time', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, inquiryId, ids } = await wallets(2);
    const [late = '', canceled = ''] = ids;
    const clock = createdAtClock(database.db);
    const old = await createCryptoChallenge(database.db, env, newChallenge(late, inquiryId));
    await clock.at('crypto_challenges', old.id);
    const open = await createCryptoChallenge(database.db, env, newChallenge(canceled, inquiryId));

    const expired = await supersedeOpenCryptoChallenges(database.db, env, late, {
      now: old.expiresAt,
    });
    const superseded = await supersedeOpenCryptoChallenges(database.db, env, canceled);

    expect(expired.map((challenge) => challenge.status)).toEqual(['expired']);
    expect(superseded.map((challenge) => [challenge.id, challenge.status])).toEqual([
      [open.id, 'superseded'],
    ]);
    // A new challenge may follow once the open one is closed.
    const renewed = await createCryptoChallenge(database.db, env, newChallenge(late, inquiryId));
    await clock.at('crypto_challenges', renewed.id);
    expect(
      (await listCryptoChallenges(database.db, env, late)).map((challenge) => challenge.status),
    ).toEqual(['initiated', 'expired']);
  });
});

describe('consumeCryptoChallenge (C57.3)', () => {
  it('consumes the open challenge once, sealing the signature and the signed message', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    const open = await createCryptoChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );
    const now = new Date(AT.getTime() + 60_000);
    const submission = { signature: 'c3ludGhldGlj', signedMessage: 'c2lnbmVk', scheme: null };

    const consumed = await consumeCryptoChallenge(database.db, env, {
      id: open.id,
      verificationId,
      now,
      submission,
    });
    const again = await consumeCryptoChallenge(database.db, env, {
      id: open.id,
      verificationId,
      now,
      submission: SUBMISSION,
    });

    expect(consumed).toMatchObject({
      id: open.id,
      status: 'submitted',
      submittedAt: now,
      scheme: null,
    });
    expect(again).toBeNull();
    expect(await openCryptoChallengeEvidence(database.db, env, open.id)).toEqual({
      walletAddress: CHECKSUMMED,
      message: `synthetic challenge at ${AT.toISOString()}`,
      signature: 'c3ludGhldGlj',
      signedMessage: 'c2lnbmVk',
    });
    const stored = await database.db.$client.query<Record<string, unknown>>(
      'select signature, signed_message from crypto_challenges where id = $1',
      [open.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain('c3ludGhldGlj');
  });

  it('records the scheme the client named', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    const open = await createCryptoChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );

    const consumed = await consumeCryptoChallenge(database.db, env, {
      id: open.id,
      verificationId,
      now: AT,
      submission: SUBMISSION,
    });

    expect(consumed?.scheme).toBe('eip191');
  });

  it('matches nothing for another verification, an expired, superseded or redacted challenge', async () => {
    const { env, inquiryId, ids } = await wallets(4);
    const [mine = '', other = '', redacted = '', superseded = ''] = ids;
    const open = await createCryptoChallenge(database.db, env, newChallenge(mine, inquiryId));
    const gone = await createCryptoChallenge(database.db, env, newChallenge(redacted, inquiryId));
    const replaced = await createCryptoChallenge(
      database.db,
      env,
      newChallenge(superseded, inquiryId),
    );
    await redactCryptoChallenges(database.db, env, [redacted], AT);
    await supersedeOpenCryptoChallenges(database.db, env, superseded);
    const consume = (id: string, verificationId: string, now: Date) =>
      consumeCryptoChallenge(database.db, env, { id, verificationId, now, submission: SUBMISSION });

    expect(await consume(open.id, other, AT)).toBeNull();
    expect(await consume(open.id, mine, open.expiresAt)).toBeNull();
    expect(await consume(gone.id, redacted, AT)).toBeNull();
    expect(await consume(replaced.id, superseded, AT)).toBeNull();
    expect(await consume(testId('cwc'), mine, AT)).toBeNull();
    expect(
      await consumeCryptoChallenge(database.db, (await wallets()).env, {
        id: open.id,
        verificationId: mine,
        now: AT,
        submission: SUBMISSION,
      }),
    ).toBeNull();
    expect((await getCryptoChallenge(database.db, env, open.id))?.status).toBe('initiated');
  });
});

describe('markCryptoChallengeProcessed (C57.4)', () => {
  it('moves a submitted challenge to processed, recording the established scheme', async () => {
    const { env, inquiryId, ids } = await wallets(2);
    const [named = '', unnamed = ''] = ids;
    const first = await createCryptoChallenge(database.db, env, newChallenge(named, inquiryId));
    const second = await createCryptoChallenge(database.db, env, newChallenge(unnamed, inquiryId));
    await consumeCryptoChallenge(database.db, env, {
      id: first.id,
      verificationId: named,
      now: AT,
      submission: SUBMISSION,
    });
    await consumeCryptoChallenge(database.db, env, {
      id: second.id,
      verificationId: unnamed,
      now: AT,
      submission: { ...SUBMISSION, scheme: null },
    });

    const kept = await markCryptoChallengeProcessed(database.db, env, first.id);
    const established = await markCryptoChallengeProcessed(database.db, env, second.id, {
      scheme: 'bip322-simple',
    });

    expect(kept).toMatchObject({ status: 'processed', scheme: 'eip191' });
    expect(established).toMatchObject({ status: 'processed', scheme: 'bip322-simple' });
    expect(await markCryptoChallengeProcessed(database.db, env, first.id)).toBeNull();
  });

  it('leaves a challenge that is not submitted as it is', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    const open = await createCryptoChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );

    expect(await markCryptoChallengeProcessed(database.db, env, open.id)).toBeNull();
    expect((await getCryptoChallenge(database.db, env, open.id))?.status).toBe('initiated');
  });
});

describe('rebuildCryptoAddressIndexes over a claimed address (C53.4)', () => {
  it('indexes the canonical form of the sealed address, as the challenge route did', async () => {
    const { env, inquiryId, ids } = await wallets();
    const [verificationId = ''] = ids;
    const created = await createCryptoChallenge(database.db, env, {
      ...newChallenge(verificationId, inquiryId),
      blindIndexKey: OTHER_KEY,
    });

    await rebuildCryptoAddressIndexes(database.db, KEY, { batchSize: 1 });

    expect((await getCryptoChallenge(database.db, env, created.id))?.addressIndex).toBe(
      cryptoAddressIndex(KEY, { environmentId: env, address: CHECKSUMMED.toLowerCase() }),
    );
  });
});
