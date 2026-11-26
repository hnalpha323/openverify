/**
 * C62.6, C53.3: the chip read the NFC job's decision writes (`api-nfc`), sealed with both blind
 * indexes, and the sighting count of `id_nfc_repeat_detection`: selfie-bound reads of the same
 * SOD signature in unredacted inquiries of other accounts, the current inquiry and its account's
 * inquiries left out. Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chipDocumentNumberIndex, chipSodIndex } from '../blind-index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  countChipSightings,
  createVerification,
  getChipRead,
  openChipReadEvidence,
  redactChipReads,
  redactInquiryRecords,
  writeChipRead,
  type NewChipRead,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');
const KEY = new Uint8Array(32).fill(6);
const SIGNATURE = new Uint8Array(Buffer.from('synthetic sod signature value'));
const OTHER_SIGNATURE = new Uint8Array(Buffer.from('another synthetic sod signature'));
const FIELDS = {
  'name-first': 'NORA',
  'name-last': 'CALDERWOOD',
  birthdate: '1988-03-21',
  sex: 'F',
  'expiration-date': '2033-09-13',
  'identification-number': 'UP7316408',
  nationality: 'UTO',
  'id-class': 'passport',
};

/** A tenant; inquiries of it are made with `inquiry()`. */
async function tenant() {
  const { environment } = await createTestTenant(database.db);
  const env = environment.id;
  const inquiry = async (referenceId?: string) => {
    const { inquiry: created } = await createTestInquiry(database.db, env, {
      ...(referenceId === undefined ? {} : { referenceId }),
    });
    const verification = await createVerification(database.db, env, {
      id: testId('ver'),
      inquiryId: created.id,
      type: 'government_id_nfc',
    });
    return { inquiryId: created.id, verificationId: verification.id };
  };
  return { env, inquiry };
}

function read(
  ids: { inquiryId: string; verificationId: string },
  overrides: Partial<NewChipRead> = {},
): NewChipRead {
  return {
    ...ids,
    fields: FIELDS,
    sodSignature: SIGNATURE,
    issuingCountry: 'UTO',
    integrity: 'established',
    selfieBound: true,
    paSummary: { integrity: 'established', revocation: 'unrevoked', anchorSource: 'sandbox' },
    blindIndexKey: KEY,
    at: AT,
    ...overrides,
  };
}

describe('writeChipRead (C62.6)', () => {
  it('seals the DG1 fields and the SOD signature and indexes both', async () => {
    const { env, inquiry } = await tenant();
    const ids = await inquiry();

    const written = await writeChipRead(database.db, env, read(ids));

    expect(written).toEqual({
      verificationId: ids.verificationId,
      inquiryId: ids.inquiryId,
      integrity: 'established',
      selfieBound: true,
      issuingCountry: 'UTO',
      paSummary: { integrity: 'established', revocation: 'unrevoked', anchorSource: 'sandbox' },
      sodSignatureIndex: chipSodIndex(KEY, { environmentId: env, signature: SIGNATURE }),
      documentNumberIndex: chipDocumentNumberIndex(KEY, {
        environmentId: env,
        issuingState: 'UTO',
        documentNumber: 'UP7316408',
      }),
      createdAt: AT,
      redactedAt: null,
    });
    expect(await openChipReadEvidence(database.db, env, ids.verificationId)).toEqual({
      fields: FIELDS,
      sodSignature: SIGNATURE,
    });
    const rows = await database.db.execute(
      sql`select * from chip_reads where verification_id = ${ids.verificationId}`,
    );
    expect(JSON.stringify(rows.rows)).not.toContain('CALDERWOOD');
    expect(JSON.stringify(rows.rows)).not.toContain('UP7316408');
  });

  it('replaces the read on a re-run of the decision, never a redacted one', async () => {
    const { env, inquiry } = await tenant();
    const ids = await inquiry();
    await writeChipRead(database.db, env, read(ids, { selfieBound: false }));

    const rewritten = await writeChipRead(database.db, env, read(ids, { selfieBound: true }));
    expect(rewritten.selfieBound).toBe(true);

    await redactChipReads(database.db, env, [ids.verificationId], AT);
    await expect(writeChipRead(database.db, env, read(ids))).rejects.toThrow(/redacted/);
    expect(await getChipRead(database.db, env, ids.verificationId)).toMatchObject({
      redactedAt: AT,
      sodSignatureIndex: null,
    });
  });

  it('leaves the document number index empty without a number or an issuing state', async () => {
    const { env, inquiry } = await tenant();
    const ids = await inquiry();

    const written = await writeChipRead(
      database.db,
      env,
      read(ids, { fields: { ...FIELDS, 'identification-number': null }, issuingCountry: null }),
    );

    expect(written.documentNumberIndex).toBeNull();
    expect(written.issuingCountry).toBeNull();
  });

  it('refuses a key that is not 32 bytes before writing', async () => {
    const { env, inquiry } = await tenant();
    const ids = await inquiry();

    await expect(
      writeChipRead(database.db, env, read(ids, { blindIndexKey: new Uint8Array(8) })),
    ).rejects.toThrow();
    expect(await getChipRead(database.db, env, ids.verificationId)).toBeNull();
  });
});

describe('countChipSightings (C62.6, decision 35)', () => {
  it('counts selfie-bound reads of the SOD in other accounts only', async () => {
    const { env, inquiry } = await tenant();
    const current = await inquiry('account-a');
    const sameAccount = await inquiry('account-a');
    const other = await inquiry('account-b');
    const another = await inquiry();
    const unbound = await inquiry('account-c');
    const otherChip = await inquiry('account-d');
    await writeChipRead(database.db, env, read(current));
    await writeChipRead(database.db, env, read(sameAccount));
    await writeChipRead(database.db, env, read(other));
    await writeChipRead(database.db, env, read(another));
    await writeChipRead(database.db, env, read(unbound, { selfieBound: false }));
    await writeChipRead(database.db, env, read(otherChip, { sodSignature: OTHER_SIGNATURE }));

    const sightings = (inquiryId: string) =>
      countChipSightings(database.db, env, {
        inquiryId,
        sodSignature: SIGNATURE,
        blindIndexKey: KEY,
      });

    expect(await sightings(current.inquiryId)).toBe(2);
    expect(await sightings(other.inquiryId)).toBe(3);
    // A first read of a chip nobody else read is no sighting.
    expect(
      await countChipSightings(database.db, env, {
        inquiryId: otherChip.inquiryId,
        sodSignature: OTHER_SIGNATURE,
        blindIndexKey: KEY,
      }),
    ).toBe(0);
    // Another environment shares nothing.
    const elsewhere = await tenant();
    const lone = await elsewhere.inquiry();
    expect(
      await countChipSightings(database.db, elsewhere.env, {
        inquiryId: lone.inquiryId,
        sodSignature: SIGNATURE,
        blindIndexKey: KEY,
      }),
    ).toBe(0);
  });

  it('leaves out reads of redacted inquiries', async () => {
    const { env, inquiry } = await tenant();
    const current = await inquiry();
    const redacted = await inquiry();
    await writeChipRead(database.db, env, read(redacted));
    await redactInquiryRecords(database.db, env, redacted.inquiryId, { at: AT });

    expect(
      await countChipSightings(database.db, env, {
        inquiryId: current.inquiryId,
        sodSignature: SIGNATURE,
        blindIndexKey: KEY,
      }),
    ).toBe(0);
  });
});
