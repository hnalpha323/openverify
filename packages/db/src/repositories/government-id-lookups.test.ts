/**
 * C34 lookups over the stored government ID extractions (C31.7): the repeat candidates (the same
 * blind index, or a front pHash within `max-phash-distance` through the eight pigeonhole bands),
 * the same-number extractions the inconsistent-repeat check compares, the listing the API serves
 * the extraction attributes from, and `blind-index:rebuild` (C31.8). Every value is synthetic: the
 * fictional holders of the test issuer Utopia.
 */
import type { ExtractedFields } from '@openverify/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { extractionIndexOf } from '../blind-index.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  createGovernmentIdExtraction,
  findRepeatCandidates,
  findSameNumberExtractions,
  getGovernmentIdExtraction,
  listGovernmentIdExtractions,
  rebuildIdentificationNumberIndexes,
  redactGovernmentIdExtractions,
  type NewGovernmentIdExtractionInput,
} from './government-id-extractions.js';
import { createInquiry } from './inquiries.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const holder: ExtractedFields = {
  'name-first': 'QUINN',
  'name-middle': null,
  'name-last': 'VALEMONT',
  birthdate: '1990-02-14',
  sex: 'X',
  nationality: 'UTO',
  'identification-number': 'X12K45P78',
  'personal-number': null,
  'issue-date': '2024-03-01',
  'expiration-date': '2034-02-28',
  'issuing-authority-code': 'UTO',
  'address-street-1': '12 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'NORTH HAVEN',
  'address-subdivision': null,
  'address-postal-code': 'UT 1024',
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
};

const INDEX = 'a'.repeat(64);
const OTHER_INDEX = 'b'.repeat(64);
const PHASH = '0123456789abcdef';

/** `hash` with bit `bit` (0 = most significant) of each listed band flipped. */
function flip(hash: string, flips: readonly (readonly [band: number, bit: number])[]): string {
  const bytes = Buffer.from(hash, 'hex');
  for (const [band, bit] of flips) {
    bytes[band] = (bytes[band] ?? 0) ^ (0x80 >> bit);
  }
  return bytes.toString('hex');
}

interface Tenant {
  environmentId: string;
}

async function tenant(): Promise<Tenant> {
  return { environmentId: (await createTestTenant(database.db)).environment.id };
}

/** A government ID verification in a new inquiry: of a new account, or of `accountId`. */
async function governmentId(env: Tenant, accountId?: string) {
  const { inquiry, template } = await createTestInquiry(database.db, env.environmentId);
  const owner =
    accountId === undefined
      ? inquiry
      : await createInquiry(database.db, env.environmentId, {
          id: testId('inq'),
          inquiryTemplateId: template.id,
          inquiryTemplateVersionId: template.latestVersion.id,
          accountId,
        });
  const verification = await createVerification(database.db, env.environmentId, {
    id: testId('ver'),
    inquiryId: owner.id,
    type: 'government_id',
  });
  return { verificationId: verification.id, inquiryId: owner.id, accountId: owner.accountId };
}

async function stored(
  env: Tenant,
  change: Partial<NewGovernmentIdExtractionInput> = {},
  accountId?: string,
) {
  const verification = await governmentId(env, accountId);
  await createGovernmentIdExtraction(database.db, env.environmentId, {
    verificationId: verification.verificationId,
    fields: holder,
    fieldSources: { 'identification-number': ['mrz', 'viz'] },
    identificationNumberIndex: INDEX,
    frontPhash: PHASH,
    idClassGroup: 'national_id',
    ...change,
  });
  return verification;
}

describe('findRepeatCandidates (C34 id_repeat_detection)', () => {
  it('finds an earlier extraction of another account with the same blind index', async () => {
    const env = await tenant();
    const earlier = await stored(env, { frontPhash: null });
    const current = await governmentId(env);

    expect(
      await findRepeatCandidates(database.db, env.environmentId, {
        verificationId: current.verificationId,
        accountId: current.accountId,
        identificationNumberIndex: INDEX,
        frontPhash: null,
        maxPhashDistance: null,
      }),
    ).toEqual([
      {
        verificationId: earlier.verificationId,
        sameIdentificationNumber: true,
        phashDistance: null,
      },
    ]);
  });

  it('skips the same account, redacted rows, the verification itself and other environments', async () => {
    const env = await tenant();
    const current = await stored(env);
    await stored(env, {}, current.accountId);
    const redacted = await stored(env);
    await redactGovernmentIdExtractions(
      database.db,
      env.environmentId,
      [redacted.verificationId],
      new Date('2026-10-01T00:00:00.000Z'),
    );
    await stored(await tenant());

    expect(
      await findRepeatCandidates(database.db, env.environmentId, {
        verificationId: current.verificationId,
        accountId: current.accountId,
        identificationNumberIndex: INDEX,
        frontPhash: PHASH,
        maxPhashDistance: 7,
      }),
    ).toEqual([]);
  });

  it('finds every front within the distance, whichever bands differ (pigeonhole), and no other', async () => {
    const env = await tenant();
    const variants = [
      ['0 bits', PHASH, 0],
      ['1 bit', flip(PHASH, [[0, 0]]), 1],
      [
        '7 bits in one band',
        flip(
          PHASH,
          [0, 1, 2, 3, 4, 5, 6].map((bit) => [3, bit]),
        ),
        7,
      ],
      [
        '7 bits in seven bands',
        flip(
          PHASH,
          [0, 1, 2, 3, 4, 5, 6].map((band) => [band, 7]),
        ),
        7,
      ],
      [
        '8 bits in every band',
        flip(
          PHASH,
          [0, 1, 2, 3, 4, 5, 6, 7].map((band) => [band, 2]),
        ),
        8,
      ],
      [
        '9 bits in two bands',
        flip(
          PHASH,
          [0, 1, 2, 3, 4, 5, 6, 7, 0].map((bit, i) => [i < 8 ? 5 : 6, bit]),
        ),
        9,
      ],
    ] as const;
    const ids = new Map<string, number>();
    for (const [, hash, distance] of variants) {
      const { verificationId } = await stored(env, {
        identificationNumberIndex: null,
        frontPhash: hash,
      });
      ids.set(verificationId, distance);
    }
    const current = await governmentId(env);

    const lookup = (maxPhashDistance: number) =>
      findRepeatCandidates(database.db, env.environmentId, {
        verificationId: current.verificationId,
        accountId: current.accountId,
        identificationNumberIndex: INDEX,
        frontPhash: PHASH,
        maxPhashDistance,
      });
    const found = async (max: number) =>
      (await lookup(max))
        .map((candidate) => {
          expect(candidate.sameIdentificationNumber).toBe(false);
          expect(candidate.phashDistance).toBe(ids.get(candidate.verificationId));
          return candidate.phashDistance;
        })
        .sort();

    expect(await found(7)).toEqual([0, 1, 7, 7]);
    expect(await found(1)).toEqual([0, 1]);
    expect(await found(0)).toEqual([0]);
  });

  it('runs only the lookups it has a key for', async () => {
    const env = await tenant();
    await stored(env, { frontPhash: null });
    await stored(env, { identificationNumberIndex: OTHER_INDEX });
    const current = await governmentId(env);
    const lookup = (change: {
      identificationNumberIndex?: string | null;
      frontPhash?: string | null;
      maxPhashDistance?: number | null;
    }) =>
      findRepeatCandidates(database.db, env.environmentId, {
        verificationId: current.verificationId,
        accountId: current.accountId,
        identificationNumberIndex: INDEX,
        frontPhash: PHASH,
        maxPhashDistance: 0,
        ...change,
      });

    expect(await lookup({ maxPhashDistance: null })).toHaveLength(1);
    expect(await lookup({ frontPhash: null })).toHaveLength(1);
    expect(await lookup({ identificationNumberIndex: null })).toHaveLength(1);
    expect(await lookup({})).toHaveLength(2);
    expect(await lookup({ identificationNumberIndex: null, frontPhash: null })).toEqual([]);
  });

  it('lists the newest first, at most the limit', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const stamp = (row: { verificationId: string }) =>
      clock.at('government_id_extractions', row.verificationId, 'verification_id');
    const first = await stored(env);
    await stamp(first);
    const second = await stored(env);
    await stamp(second);
    const third = await stored(env);
    await stamp(third);
    const current = await governmentId(env);

    const found = await findRepeatCandidates(database.db, env.environmentId, {
      verificationId: current.verificationId,
      accountId: current.accountId,
      identificationNumberIndex: INDEX,
      frontPhash: PHASH,
      maxPhashDistance: 0,
      limit: 2,
    });

    expect(found.map((candidate) => candidate.verificationId)).toEqual([
      third.verificationId,
      second.verificationId,
    ]);
    expect(found.map((candidate) => candidate.verificationId)).not.toContain(first.verificationId);
  });

  it.each([8, -1, 1.5])(
    'refuses max-phash-distance %s, which the bands cannot serve',
    async (max) => {
      const env = await tenant();
      const current = await governmentId(env);
      await expect(
        findRepeatCandidates(database.db, env.environmentId, {
          verificationId: current.verificationId,
          accountId: current.accountId,
          identificationNumberIndex: null,
          frontPhash: PHASH,
          maxPhashDistance: max,
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});

describe('findSameNumberExtractions (C34 id_inconsistent_repeat_detection)', () => {
  it('decrypts only the names and birth date of every earlier extraction with the index, any account', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const stamp = (row: { verificationId: string }) =>
      clock.at('government_id_extractions', row.verificationId, 'verification_id');
    const current = await stored(env);
    await stamp(current);
    const sameAccount = await stored(env, {}, current.accountId);
    await stamp(sameAccount);
    const otherHolder = await stored(env, {
      fields: { ...holder, 'name-first': 'ROWAN', birthdate: '1985-06-30' },
    });
    await stamp(otherHolder);
    await stamp(await stored(env, { identificationNumberIndex: OTHER_INDEX }));
    const redacted = await stored(env);
    await stamp(redacted);
    await redactGovernmentIdExtractions(
      database.db,
      env.environmentId,
      [redacted.verificationId],
      new Date('2026-10-01T00:00:00.000Z'),
    );
    await stored(await tenant());

    const found = await findSameNumberExtractions(database.db, env.environmentId, {
      verificationId: current.verificationId,
      identificationNumberIndex: INDEX,
    });

    expect(
      found.map(({ verificationId, inquiryId, fields }) => ({ verificationId, inquiryId, fields })),
    ).toEqual([
      {
        verificationId: otherHolder.verificationId,
        inquiryId: otherHolder.inquiryId,
        fields: { 'name-first': 'ROWAN', 'name-last': 'VALEMONT', birthdate: '1985-06-30' },
      },
      {
        verificationId: sameAccount.verificationId,
        inquiryId: sameAccount.inquiryId,
        fields: { 'name-first': 'QUINN', 'name-last': 'VALEMONT', birthdate: '1990-02-14' },
      },
    ]);
    expect(found[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('stops at the limit', async () => {
    onTestFinished(wallClockStepsBack());
    const env = await tenant();
    const clock = createdAtClock(database.db);
    const stamp = (row: { verificationId: string }) =>
      clock.at('government_id_extractions', row.verificationId, 'verification_id');
    await stamp(await stored(env));
    const newest = await stored(env);
    await stamp(newest);
    const current = await governmentId(env);

    const found = await findSameNumberExtractions(database.db, env.environmentId, {
      verificationId: current.verificationId,
      identificationNumberIndex: INDEX,
      limit: 1,
    });

    expect(found.map((candidate) => candidate.verificationId)).toEqual([newest.verificationId]);
  });
});

describe('listGovernmentIdExtractions (the API serves the C31.5 attributes from it)', () => {
  it('reads the extractions of these verifications of this environment, by verification id', async () => {
    const env = await tenant();
    const first = await stored(env);
    const second = await stored(env, { idClassGroup: 'passport' });
    const without = await governmentId(env);
    const elsewhere = await stored(await tenant());

    const found = await listGovernmentIdExtractions(database.db, env.environmentId, [
      first.verificationId,
      second.verificationId,
      without.verificationId,
      elsewhere.verificationId,
    ]);

    expect([...found.keys()].sort()).toEqual([first.verificationId, second.verificationId].sort());
    expect(found.get(second.verificationId)).toMatchObject({
      fields: holder,
      idClassGroup: 'passport',
    });
    expect(await listGovernmentIdExtractions(database.db, env.environmentId, [])).toEqual(
      new Map(),
    );
  });

  it('stores the class group the index was computed with, unknown by default', async () => {
    const env = await tenant();
    const verification = await governmentId(env);
    await createGovernmentIdExtraction(database.db, env.environmentId, {
      verificationId: verification.verificationId,
      fields: holder,
      fieldSources: {},
      identificationNumberIndex: null,
      frontPhash: null,
    });

    expect(
      (await getGovernmentIdExtraction(database.db, env.environmentId, verification.verificationId))
        ?.idClassGroup,
    ).toBe('unknown');
  });
});

describe('rebuildIdentificationNumberIndexes (C31.8 blind-index:rebuild)', () => {
  it('re-indexes every unredacted extraction of every environment under the new key', async () => {
    const newKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const env = await tenant();
    const other = await tenant();
    const kept = await stored(env, { idClassGroup: 'national_id' });
    const elsewhere = await stored(other, { idClassGroup: 'passport' });
    const twin = await stored(other, { idClassGroup: 'national_id' });
    const noIssuer = await stored(env, {
      fields: { ...holder, 'issuing-authority-code': null },
    });
    const redacted = await stored(env);
    await redactGovernmentIdExtractions(
      database.db,
      env.environmentId,
      [redacted.verificationId],
      new Date('2026-10-01T00:00:00.000Z'),
    );

    const result = await rebuildIdentificationNumberIndexes(database.db, newKey, { batchSize: 2 });

    expect(result.scanned).toBeGreaterThanOrEqual(3);
    expect(result.updated).toBeGreaterThanOrEqual(3);
    const index = async (environmentId: string, verificationId: string) =>
      (await getGovernmentIdExtraction(database.db, environmentId, verificationId))
        ?.identificationNumberIndex;
    expect(await index(env.environmentId, kept.verificationId)).toBe(
      extractionIndexOf(newKey, {
        environmentId: env.environmentId,
        fields: holder,
        classGroup: 'national_id',
      }),
    );
    expect(await index(other.environmentId, elsewhere.verificationId)).toBe(
      extractionIndexOf(newKey, {
        environmentId: other.environmentId,
        fields: holder,
        classGroup: 'passport',
      }),
    );
    // G003: the same document in another environment has an unrelated index.
    expect(await index(other.environmentId, twin.verificationId)).not.toBe(
      await index(env.environmentId, kept.verificationId),
    );
    expect(await index(env.environmentId, noIssuer.verificationId)).toBeNull();
    expect(
      await getGovernmentIdExtraction(database.db, env.environmentId, redacted.verificationId),
    ).toMatchObject({ fields: null, identificationNumberIndex: null });

    const again = await rebuildIdentificationNumberIndexes(database.db, newKey);
    expect(again.updated).toBe(0);
    expect(again.scanned).toBe(result.scanned);
  });
});
