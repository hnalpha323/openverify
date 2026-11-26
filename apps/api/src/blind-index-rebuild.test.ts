/**
 * `pnpm --filter @openverify/api blind-index:rebuild` (C31.8, `scripts/blind-index-rebuild.ts`):
 * after a change of `OPENVERIFY_BLIND_INDEX_KEY`, every unredacted extraction of every
 * environment is re-indexed under the new key, printing counts only. Vitest runs `src/**` tests,
 * so the script's tests live here. Every value is synthetic: fictional Utopia holders.
 */
import { emptyExtractedFields } from '@openverify/core';
import { newId } from '@openverify/contracts';
import {
  chipSodIndex,
  createGovernmentIdExtraction,
  createVerification,
  cryptoAddressIndex,
  extractionIndexOf,
  getChipRead,
  getCryptoChallenge,
  getGovernmentIdExtraction,
  getOtpChallenge,
  otpDestinationIndex,
  redactGovernmentIdExtractions,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedChipRead,
  seedCryptoChallenge,
  seedOtpChallenge,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BlindIndexRebuildUsageError,
  DEFAULT_REBUILD_BATCH_SIZE,
  main,
  parseBlindIndexRebuildArgs,
  runBlindIndexRebuild,
} from '../scripts/blind-index-rebuild.js';

const OLD_KEY = new Uint8Array(32).fill(1);
const NEW_KEY = new Uint8Array(32).fill(2);
const MARKER = 'VALEMONT-SYNTHETIC';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const fields = {
  ...emptyExtractedFields(),
  'name-last': MARKER,
  'identification-number': 'X12K45P78',
  'issuing-authority-code': 'UTO',
};

async function extraction(options: { redacted?: boolean } = {}) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verificationId = newId('ver');
  await createVerification(database.db, environment.id, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await createGovernmentIdExtraction(database.db, environment.id, {
    verificationId,
    fields,
    fieldSources: {},
    identificationNumberIndex: extractionIndexOf(OLD_KEY, {
      environmentId: environment.id,
      fields,
      classGroup: 'national_id',
    }),
    frontPhash: null,
    idClassGroup: 'national_id',
  });
  if (options.redacted === true) {
    await redactGovernmentIdExtractions(database.db, environment.id, [verificationId], new Date());
  }
  return { environmentId: environment.id, verificationId };
}

describe('parseBlindIndexRebuildArgs', () => {
  it('defaults the batch size and reads --batch-size in both spellings', () => {
    expect(parseBlindIndexRebuildArgs([])).toEqual({ batchSize: DEFAULT_REBUILD_BATCH_SIZE });
    expect(parseBlindIndexRebuildArgs(['--batch-size=7'])).toEqual({ batchSize: 7 });
    expect(parseBlindIndexRebuildArgs(['--batch-size', '9'])).toEqual({ batchSize: 9 });
  });

  it.each([['--batch-size=0'], ['--batch-size=abc'], ['--batch-size'], ['--verbose']])(
    'refuses %s',
    (argument) => {
      expect(() => parseBlindIndexRebuildArgs([argument])).toThrow(BlindIndexRebuildUsageError);
    },
  );
});

describe('runBlindIndexRebuild (C31.8)', () => {
  it('re-indexes every unredacted extraction under the new key and prints counts only', async () => {
    const first = await extraction();
    const second = await extraction();
    const redacted = await extraction({ redacted: true });
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: database.db,
      key: NEW_KEY,
      args: { batchSize: 1 },
      out: (line) => lines.push(line),
    });

    expect(result.updated).toBeGreaterThanOrEqual(2);
    for (const { environmentId, verificationId } of [first, second]) {
      expect(
        (await getGovernmentIdExtraction(database.db, environmentId, verificationId))
          ?.identificationNumberIndex,
      ).toBe(extractionIndexOf(NEW_KEY, { environmentId, fields, classGroup: 'national_id' }));
    }
    expect(
      (
        await getGovernmentIdExtraction(
          database.db,
          redacted.environmentId,
          redacted.verificationId,
        )
      )?.identificationNumberIndex,
    ).toBeNull();
    // C53.4: the Workflow 5A and 5B indexes are rebuilt in the same run, each counted on its own
    // line.
    expect(lines.slice(0, 3)).toEqual([
      `blind-index:rebuild: done: scanned ${String(result.scanned)} extractions, re-indexed ${String(result.updated)}.`,
      `blind-index:rebuild: done: scanned ${String(result.otpDestinations.scanned)} OTP destinations, re-indexed ${String(result.otpDestinations.updated)}.`,
      `blind-index:rebuild: done: scanned ${String(result.walletAddresses.scanned)} wallet addresses, re-indexed ${String(result.walletAddresses.updated)}.`,
    ]);
    // C73.4: then the report indexes, on the last line.
    expect(lines.slice(3, 4)).toEqual([
      expect.stringMatching(
        /^blind-index:rebuild: done: scanned \d+ chip reads, re-indexed \d+\.$/,
      ),
    ]);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(first.verificationId);
  });
});

describe('runBlindIndexRebuild over the Workflow 5A indexes (C53.4)', () => {
  it('re-indexes every unredacted OTP destination and wallet address under the new key', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const verification = async (type: 'email_address' | 'crypto_wallet') =>
      (
        await createVerification(database.db, environment.id, {
          id: newId('ver'),
          inquiryId: inquiry.id,
          type,
        })
      ).id;
    const destination = `${MARKER.toLowerCase()}@example.test`;
    const otp = await seedOtpChallenge(database.db, environment.id, {
      verificationId: await verification('email_address'),
      inquiryId: inquiry.id,
      channel: 'email',
      destination,
      destinationIndex: otpDestinationIndex(OLD_KEY, {
        environmentId: environment.id,
        channel: 'email',
        destination,
      }),
    });
    const address = `0x${'ab'.repeat(20)}`;
    const wallet = await seedCryptoChallenge(database.db, environment.id, {
      verificationId: await verification('crypto_wallet'),
      inquiryId: inquiry.id,
      chainId: 'eip155:1',
      walletAddress: address,
      addressIndex: cryptoAddressIndex(OLD_KEY, { environmentId: environment.id, address }),
      message: 'synthetic challenge',
    });
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: database.db,
      key: NEW_KEY,
      args: { batchSize: 1 },
      out: (line) => lines.push(line),
    });

    expect(result.otpDestinations.updated).toBeGreaterThanOrEqual(1);
    expect(result.walletAddresses.updated).toBeGreaterThanOrEqual(1);
    expect((await getOtpChallenge(database.db, environment.id, otp))?.destinationIndex).toBe(
      otpDestinationIndex(NEW_KEY, {
        environmentId: environment.id,
        channel: 'email',
        destination,
      }),
    );
    expect((await getCryptoChallenge(database.db, environment.id, wallet))?.addressIndex).toBe(
      cryptoAddressIndex(NEW_KEY, { environmentId: environment.id, address }),
    );
    expect(lines.join('\n')).not.toContain(MARKER.toLowerCase());
    expect(lines.join('\n')).not.toContain(address);
  });
});

describe('runBlindIndexRebuild over the Workflow 5B chip read indexes (C53.4)', () => {
  it('re-indexes every unredacted chip read under the new key, printing counts only', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const chip = await createVerification(database.db, environment.id, {
      id: newId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id_nfc',
    });
    const signature = new Uint8Array(64).fill(0x5a);
    await seedChipRead(database.db, environment.id, {
      verificationId: chip.id,
      inquiryId: inquiry.id,
      fields: { 'name-last': MARKER },
      sodSignature: signature,
      sodSignatureIndex: chipSodIndex(OLD_KEY, { environmentId: environment.id, signature }),
    });
    const lines: string[] = [];

    await runBlindIndexRebuild({
      db: database.db,
      key: NEW_KEY,
      args: { batchSize: 1 },
      out: (line) => lines.push(line),
    });

    expect((await getChipRead(database.db, environment.id, chip.id))?.sodSignatureIndex).toBe(
      chipSodIndex(NEW_KEY, { environmentId: environment.id, signature }),
    );
    expect(lines.some((line) => line.includes('chip reads'))).toBe(true);
    expect(lines.join('\n')).not.toContain(MARKER);
  });
});

describe('main', () => {
  it('rebuilds the report indexes too, through rebuildReportIndexes, printing counts only (C73.4)', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: database.db,
      key: NEW_KEY,
      args: { batchSize: 10 },
      out: (line) => lines.push(line),
    });

    expect(result).toHaveProperty('reports.reports.scanned');
    expect(result).toHaveProperty('reports.matches.scanned');
    expect(lines.at(-1)).toMatch(
      /^blind-index:rebuild: done: scanned \d+ reports and \d+ matches, re-indexed \d+\.$/,
    );
  });

  it('rebuilds the device HMACs too, through rebuildDeviceIndexes, before the reports (C94.4)', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: database.db,
      key: NEW_KEY,
      args: { batchSize: 10 },
      out: (line) => lines.push(line),
    });

    expect(result).toHaveProperty('devices.scanned');
    expect(result).toHaveProperty('devices.updated');
    // Devices, then the list keys (C98.2), the transaction field keys (C105.4), the case field keys
    // (C136.4), the audit entry addresses (C168.6, Workflow 9B), the graph rows (C101.5), then the
    // reports.
    expect(lines.at(-7)).toMatch(
      /^blind-index:rebuild: done: scanned \d+ devices, re-indexed \d+\.$/,
    );
  });

  it('names a missing or invalid setting without echoing its value', async () => {
    await expect(main([], { DATABASE_URL: 'mysql://nope' })).rejects.toThrow(
      'DATABASE_URL: must be a postgres:// URL',
    );
    await expect(
      main([], {
        DATABASE_URL: 'postgres://127.0.0.1:1/openverify',
        OPENVERIFY_KEK: Buffer.alloc(32, 7).toString('base64'),
        OPENVERIFY_BLIND_INDEX_KEY: 'not-a-key-value',
      }),
    ).rejects.toThrow(/^OPENVERIFY_BLIND_INDEX_KEY must be base64 of 32 random bytes/);
  });
});
