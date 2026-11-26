/**
 * C52.3, C53.2, C59.6: the writes of `verification_inputs`: the values a user entered through the
 * inputs route (source `flow`, replaced while unredacted) and the values a silent AAMVA attempt
 * copied from a government ID (source `government_id`, bound to it). Values are sealed to the
 * verification and never stored in the clear. Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  copyVerificationInputs,
  createVerification,
  getVerificationInputs,
  listVerificationInputSources,
  putEnteredVerificationInputs,
  redactVerificationInputs,
} from './index.js';
import { sealJson } from '../sealed.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');
const LATER = new Date('2026-10-23T08:05:00.000Z');
const VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-01-31',
  'address-country-code': 'US',
};

async function inquiryWith(...types: ('aamva' | 'database' | 'government_id')[]) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const ids: string[] = [];
  for (const type of types) {
    const verification = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type,
    });
    ids.push(verification.id);
  }
  return { env: environment.id, inquiryId: inquiry.id, ids };
}

/** The stored column as Postgres holds it. */
async function storedValues(verificationId: string): Promise<string | null> {
  const result = await database.db.execute(
    sql`select "values" from verification_inputs where verification_id = ${verificationId}`,
  );
  return (result.rows[0] as { values: string | null } | undefined)?.values ?? null;
}

/** The sealed envelope of `crypto.ts`, `ov1.<kid>.<wrapped DEK>.<payload>`: base64url only. */
const ENVELOPE = /^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}\.[A-Za-z0-9_-]+$/;

/**
 * The stored column holds none of `values` in the clear: it is one envelope, and no value appears
 * as the JSON string it would be stored as. A bare value can be spelt by the ciphertext.
 */
function expectNoValueInTheClear(stored: string | null, values: Record<string, string>) {
  expect(stored).toMatch(ENVELOPE);
  for (const value of Object.values(values)) {
    expect(stored).not.toContain(JSON.stringify(value));
  }
}

describe('expectNoValueInTheClear', () => {
  it('passes a sealed column whose ciphertext happens to spell a short value', () => {
    // Base64url ciphertext spells a two-letter value such as US about once in 30 seals.
    let sealed = sealJson('verification_inputs.values', testId('ver'), VALUES) as string;
    for (let tries = 0; tries < 10_000 && !sealed.includes('US'); tries += 1) {
      sealed = sealJson('verification_inputs.values', testId('ver'), VALUES);
    }
    expect(sealed).toContain('US');

    expectNoValueInTheClear(sealed, VALUES);
  });

  it('fails a column that holds the values in the clear', () => {
    expect(() => {
      expectNoValueInTheClear(JSON.stringify(VALUES), VALUES);
    }).toThrow();
  });
});

describe('putEnteredVerificationInputs (C52.3)', () => {
  it('writes the entered values sealed, with their names, from the flow', async () => {
    const { env, inquiryId, ids } = await inquiryWith('database');
    const [verificationId = ''] = ids;

    const written = await putEnteredVerificationInputs(database.db, env, {
      verificationId,
      inquiryId,
      values: VALUES,
      at: AT,
    });

    expect(written).toMatchObject({
      verificationId,
      inquiryId,
      values: VALUES,
      fieldNames: Object.keys(VALUES),
      source: 'flow',
      sourceVerificationId: null,
      createdAt: AT,
      updatedAt: AT,
      redactedAt: null,
    });
    expect(await getVerificationInputs(database.db, env, verificationId)).toEqual(written);
    expectNoValueInTheClear(await storedValues(verificationId), VALUES);
  });

  it('replaces earlier values and their names, keeping when they were first entered', async () => {
    const { env, inquiryId, ids } = await inquiryWith('database');
    const [verificationId = ''] = ids;
    await putEnteredVerificationInputs(database.db, env, {
      verificationId,
      inquiryId,
      values: VALUES,
      at: AT,
    });

    const replaced = await putEnteredVerificationInputs(database.db, env, {
      verificationId,
      inquiryId,
      values: { 'name-first': 'Synthea', 'address-country-code': 'GB' },
      at: LATER,
    });

    expect(replaced).toMatchObject({
      values: { 'name-first': 'Synthea', 'address-country-code': 'GB' },
      fieldNames: ['name-first', 'address-country-code'],
      createdAt: AT,
      updatedAt: LATER,
    });
  });

  it('refuses once the inputs were redacted, and leaves them redacted', async () => {
    const { env, inquiryId, ids } = await inquiryWith('database');
    const [verificationId = ''] = ids;
    await putEnteredVerificationInputs(database.db, env, {
      verificationId,
      inquiryId,
      values: VALUES,
      at: AT,
    });
    await redactVerificationInputs(database.db, env, [verificationId], AT);

    await expect(
      putEnteredVerificationInputs(database.db, env, {
        verificationId,
        inquiryId,
        values: VALUES,
        at: LATER,
      }),
    ).rejects.toThrow(/redacted/);
    expect(await getVerificationInputs(database.db, env, verificationId)).toMatchObject({
      values: null,
      redactedAt: AT,
    });
  });

  it('never replaces values copied from a government ID', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva');
    const [governmentId = '', aamva = ''] = ids;
    await copyVerificationInputs(database.db, env, {
      verificationId: aamva,
      inquiryId,
      values: VALUES,
      sourceVerificationId: governmentId,
      at: AT,
    });

    await expect(
      putEnteredVerificationInputs(database.db, env, {
        verificationId: aamva,
        inquiryId,
        values: { 'name-first': 'Other' },
        at: LATER,
      }),
    ).rejects.toThrow(/copied/);
    expect((await getVerificationInputs(database.db, env, aamva))?.values).toEqual(VALUES);
  });

  it('writes nothing for a verification of another environment', async () => {
    const mine = await inquiryWith('database');
    const other = await inquiryWith('database');

    await expect(
      putEnteredVerificationInputs(database.db, mine.env, {
        verificationId: other.ids[0] ?? '',
        inquiryId: mine.inquiryId,
        values: VALUES,
        at: AT,
      }),
    ).rejects.toThrow();
    expect(await getVerificationInputs(database.db, other.env, other.ids[0] ?? '')).toBeNull();
  });
});

describe('copyVerificationInputs (C59.6)', () => {
  it('writes the copied values sealed to the new attempt and bound to the ID they came from', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva');
    const [governmentId = '', aamva = ''] = ids;

    const copied = await copyVerificationInputs(database.db, env, {
      verificationId: aamva,
      inquiryId,
      values: VALUES,
      sourceVerificationId: governmentId,
      at: AT,
    });

    expect(copied).toMatchObject({
      verificationId: aamva,
      values: VALUES,
      fieldNames: Object.keys(VALUES),
      source: 'government_id',
      sourceVerificationId: governmentId,
      createdAt: AT,
    });
    expect(await listVerificationInputSources(database.db, env, [aamva])).toEqual(
      new Map([[aamva, governmentId]]),
    );
    expect(await storedValues(aamva)).not.toContain('Testerton');
  });

  it('writes an empty copy for a skipped attempt, still bound to its ID', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva');
    const [governmentId = '', aamva = ''] = ids;

    const copied = await copyVerificationInputs(database.db, env, {
      verificationId: aamva,
      inquiryId,
      values: {},
      sourceVerificationId: governmentId,
      at: AT,
    });

    expect(copied).toMatchObject({ values: {}, fieldNames: [], source: 'government_id' });
  });

  it('refuses a second copy for the same attempt', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva');
    const [governmentId = '', aamva = ''] = ids;
    const copy = {
      verificationId: aamva,
      inquiryId,
      values: VALUES,
      sourceVerificationId: governmentId,
      at: AT,
    };
    await copyVerificationInputs(database.db, env, copy);

    await expect(copyVerificationInputs(database.db, env, copy)).rejects.toThrow();
  });
});
