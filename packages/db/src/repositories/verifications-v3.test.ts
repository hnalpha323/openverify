/** Phase 3 (C29.2): check results keep their stage, confidence and provenance. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createVerification,
  fillVerificationDocument,
  getVerification,
  replaceVerificationChecks,
  setVerificationStatus,
  type VerificationCheckInput,
} from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function newVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { environmentId: environment.id, verification };
}

const SHA = 'c'.repeat(64);

const blur: VerificationCheckInput = {
  name: 'id_blur_detection',
  status: 'passed',
  type: 'user_behavior',
  requirement: 'required',
  stage: 'ga',
  confidence: null,
  provenance: { 'implementation-version': 1, thresholds: { 'min-blur-score': 100 } },
};
const tamper: VerificationCheckInput = {
  name: 'id_tamper_detection',
  status: 'failed',
  type: 'fraud',
  requirement: 'not_required',
  reasons: ['tamper_suspected'],
  stage: 'beta',
  confidence: 0.875,
  provenance: {
    'implementation-version': 1,
    models: [{ id: 'yunet-2026may', sha256: SHA }],
    provider: { id: 'sandbox', sandbox: true },
    thresholds: { 'max-tamper-score': 0.7, 'required-fields': ['birthdate'] },
  },
};

describe('check results with stage, confidence and provenance (C29.2)', () => {
  it('stores and reads them back with each check', async () => {
    const { environmentId, verification } = await newVerification();

    const stored = await replaceVerificationChecks(database.db, environmentId, verification.id, [
      tamper,
      blur,
    ]);

    const expected = [
      { name: 'id_blur_detection', stage: 'ga', confidence: null, provenance: blur.provenance },
      {
        name: 'id_tamper_detection',
        stage: 'beta',
        confidence: 0.875,
        provenance: tamper.provenance,
      },
    ];
    expect(stored).toMatchObject(expected);
    const read = await getVerification(database.db, environmentId, verification.id);
    expect(read?.checks).toMatchObject(expected);
  });

  it('reads a check stored without them, as Phase 1 and 2 rows are, as null', async () => {
    const { environmentId, verification } = await newVerification();
    const phase2: VerificationCheckInput = {
      name: blur.name,
      status: blur.status,
      type: blur.type,
      requirement: blur.requirement,
    };

    await replaceVerificationChecks(database.db, environmentId, verification.id, [phase2]);

    const read = await getVerification(database.db, environmentId, verification.id);
    expect(read?.checks).toMatchObject([{ stage: null, confidence: null, provenance: null }]);
  });

  it('refuses a stage or confidence outside the contract', async () => {
    const { environmentId, verification } = await newVerification();
    const store = (check: Record<string, unknown>) =>
      replaceVerificationChecks(database.db, environmentId, verification.id, [
        { ...blur, ...check },
      ]);

    await expect(store({ stage: 'alpha' })).rejects.toThrow();
    await expect(store({ confidence: 1.5 })).rejects.toThrow();
    await expect(store({ confidence: -0.1 })).rejects.toThrow();
  });
});

describe('the needs_review status (C30.4)', () => {
  it('lets a submitted verification wait for an operator, stamping completed_at', async () => {
    const { environmentId, verification } = await newVerification();
    await setVerificationStatus(database.db, environmentId, verification.id, { to: 'submitted' });
    const at = new Date('2026-10-20T12:00:00.000Z');

    const moved = await setVerificationStatus(database.db, environmentId, verification.id, {
      from: 'submitted',
      to: 'needs_review',
      at,
    });

    expect(moved).toMatchObject({ status: 'needs_review', completedAt: at });
  });
});

describe('the skipped status (C50.7, C59.6)', () => {
  it.each(['initiated', 'submitted'] as const)(
    'ends processing of a %s verification the server skips, stamping completed_at',
    async (from) => {
      const { environmentId, verification } = await newVerification();
      if (from === 'submitted') {
        await setVerificationStatus(database.db, environmentId, verification.id, {
          to: 'submitted',
        });
      }
      const at = new Date('2026-10-23T12:00:00.000Z');

      const moved = await setVerificationStatus(database.db, environmentId, verification.id, {
        from,
        to: 'skipped',
        at,
      });

      expect(moved).toMatchObject({ status: 'skipped', completedAt: at });
    },
  );
});

describe('the document a government ID establishes (C31.5)', () => {
  it('fills the country and ID class the user did not choose, and keeps what they chose', async () => {
    const { environmentId, verification } = await newVerification();
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const chosen = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id',
      country: 'DE',
      idClass: 'passport',
    });

    expect(
      await fillVerificationDocument(database.db, environmentId, verification.id, {
        country: 'NL',
        idClass: 'national_id',
      }),
    ).toMatchObject({ country: 'NL', idClass: 'national_id' });
    expect(
      await fillVerificationDocument(database.db, environment.id, chosen.id, {
        country: 'NL',
        idClass: 'national_id',
      }),
    ).toMatchObject({ country: 'DE', idClass: 'passport' });
  });

  it('leaves a column alone for a value the document did not establish', async () => {
    const { environmentId, verification } = await newVerification();

    expect(
      await fillVerificationDocument(database.db, environmentId, verification.id, {
        country: null,
        idClass: 'national_id',
      }),
    ).toMatchObject({ country: null, idClass: 'national_id' });
    expect(await getVerification(database.db, environmentId, verification.id)).toMatchObject({
      country: null,
      idClass: 'national_id',
    });
  });

  it('is null for a verification of another environment', async () => {
    const { verification } = await newVerification();
    const other = await createTestTenant(database.db);

    expect(
      await fillVerificationDocument(database.db, other.environment.id, verification.id, {
        country: 'NL',
        idClass: 'national_id',
      }),
    ).toBeNull();
  });
});
