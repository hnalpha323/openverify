import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
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
  createVerification,
  getVerification,
  listInquiryVerifications,
  listSubmittedVerificationsBefore,
  lockVerification,
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

async function newVerification(type: 'government_id' | 'selfie' = 'government_id') {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type,
    country: type === 'government_id' ? 'US' : null,
    idClass: type === 'government_id' ? 'drivers_license' : null,
  });
  return { environment, inquiry, verification };
}

const blur: VerificationCheckInput = {
  name: 'id_blur_detection',
  status: 'failed',
  type: 'user_behavior',
  requirement: 'required',
  reasons: ['blurry_image'],
  metadata: { blur_score: 12.5 },
};
const portrait: VerificationCheckInput = {
  name: 'id_portrait_detection',
  status: 'passed',
  type: 'fraud',
  requirement: 'required',
};

describe('verifications', () => {
  it('creates an initiated verification with no checks', async () => {
    const { environment, inquiry, verification } = await newVerification();

    expect(verification).toMatchObject({
      environmentId: environment.id,
      inquiryId: inquiry.id,
      type: 'government_id',
      status: 'initiated',
      country: 'US',
      idClass: 'drivers_license',
      submittedAt: null,
      completedAt: null,
    });
    expect(await getVerification(database.db, environment.id, verification.id)).toEqual({
      ...verification,
      checks: [],
    });
  });

  it('replaces the check results as a set', async () => {
    const { environment, verification } = await newVerification();

    await replaceVerificationChecks(database.db, environment.id, verification.id, [blur, portrait]);
    const replaced = await replaceVerificationChecks(database.db, environment.id, verification.id, [
      { ...blur, status: 'passed', reasons: [] },
    ]);
    const read = await getVerification(database.db, environment.id, verification.id);

    expect(replaced).toHaveLength(1);
    expect(read?.checks).toEqual(replaced);
    expect(read?.checks[0]).toMatchObject({
      environmentId: environment.id,
      verificationId: verification.id,
      name: 'id_blur_detection',
      status: 'passed',
      type: 'user_behavior',
      requirement: 'required',
      reasons: [],
      metadata: { blur_score: 12.5 },
    });
  });

  it('defaults reasons and metadata, and orders checks by name', async () => {
    const { environment, verification } = await newVerification();

    const checks = await replaceVerificationChecks(database.db, environment.id, verification.id, [
      portrait,
      blur,
    ]);

    expect(checks?.map((check) => check.name)).toEqual([
      'id_blur_detection',
      'id_portrait_detection',
    ]);
    expect(checks?.[1]).toMatchObject({ reasons: [], metadata: {} });
  });

  it('can clear every check', async () => {
    const { environment, verification } = await newVerification();
    await replaceVerificationChecks(database.db, environment.id, verification.id, [blur]);

    expect(
      await replaceVerificationChecks(database.db, environment.id, verification.id, []),
    ).toEqual([]);
  });

  it('lists an inquiry’s verifications oldest first, each with its checks', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment, inquiry, verification } = await newVerification();
    const clock = createdAtClock(database.db);
    await clock.at('verifications', verification.id);
    const selfie = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    await clock.at('verifications', selfie.id);
    await replaceVerificationChecks(database.db, environment.id, selfie.id, [
      { ...portrait, name: 'selfie_multiple_faces_detection' },
    ]);

    const listed = await listInquiryVerifications(database.db, environment.id, inquiry.id);

    expect(listed.map((item) => [item.id, item.checks.length])).toEqual([
      [verification.id, 0],
      [selfie.id, 1],
    ]);
    expect(selfie).toMatchObject({ country: null, idClass: null });
  });

  it('sets the status and stamps submitted and completed times', async () => {
    const { environment, verification } = await newVerification();
    const at = new Date('2026-10-20T11:00:00.000Z');

    const submitted = await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'submitted',
      from: 'initiated',
      at,
    });
    const passed = await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'passed',
      from: ['submitted', 'confirmed'],
    });

    expect(submitted).toMatchObject({ status: 'submitted', submittedAt: at, completedAt: null });
    expect(passed?.status).toBe('passed');
    expect(passed?.submittedAt).toEqual(at);
    expect(passed?.completedAt).toBeInstanceOf(Date);
  });

  it('stamps completed_at on failure and nothing for other statuses', async () => {
    const { environment, verification } = await newVerification();

    const canceled = await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'canceled',
    });
    const failed = await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'failed',
    });

    expect(canceled).toMatchObject({ submittedAt: null, completedAt: null });
    expect(failed?.completedAt).toBeInstanceOf(Date);
  });

  it('returns null when the status no longer matches the expected one', async () => {
    const { environment, verification } = await newVerification();

    expect(
      await setVerificationStatus(database.db, environment.id, verification.id, {
        to: 'passed',
        from: 'submitted',
      }),
    ).toBeNull();
    expect(
      await setVerificationStatus(database.db, environment.id, verification.id, {
        to: 'passed',
        from: [],
      }),
    ).toBeNull();
  });

  it('keeps verifications and checks inside their environment', async () => {
    const { verification, inquiry } = await newVerification();
    const other = await createTestTenant(database.db);

    expect(await getVerification(database.db, other.environment.id, verification.id)).toBeNull();
    expect(await listInquiryVerifications(database.db, other.environment.id, inquiry.id)).toEqual(
      [],
    );
    expect(
      await setVerificationStatus(database.db, other.environment.id, verification.id, {
        to: 'submitted',
      }),
    ).toBeNull();
    expect(
      await replaceVerificationChecks(database.db, other.environment.id, verification.id, [blur]),
    ).toBeNull();
  });
});

describe('lockVerification', () => {
  it('locks the verification for the transaction and returns it, only in its environment', async () => {
    const { environment, verification } = await newVerification();
    const other = await createTestTenant(database.db);

    const rows = await database.db.transaction(async (tx) => [
      await lockVerification(tx, environment.id, verification.id),
      await lockVerification(tx, other.environment.id, verification.id),
    ]);

    expect(rows).toEqual([verification, null]);
  });
});

describe('listSubmittedVerificationsBefore (Workflow 5C review K1)', () => {
  // A day of its own, long before the other tests' rows (the database clock's now).
  const T = new Date('2001-01-01T12:00:00.000Z');
  const minutesBefore = (minutes: number) => new Date(T.getTime() - minutes * 60_000);

  async function submitted(environmentId: string, inquiryId: string, at: Date) {
    const id = testId('ver');
    await createVerification(database.db, environmentId, { id, inquiryId, type: 'selfie' });
    await setVerificationStatus(database.db, environmentId, id, { to: 'submitted', at });
    return id;
  }

  it('lists still-submitted verifications of every environment submitted before the cutoff, newest first', async () => {
    const a = await newVerification('selfie');
    const b = await newVerification('selfie');
    const older = await submitted(b.environment.id, b.inquiry.id, minutesBefore(5));
    const newer = await submitted(a.environment.id, a.inquiry.id, minutesBefore(3));
    await submitted(a.environment.id, a.inquiry.id, minutesBefore(1));
    const decided = await submitted(a.environment.id, a.inquiry.id, minutesBefore(10));
    await setVerificationStatus(database.db, a.environment.id, decided, { to: 'passed', at: T });
    // a.verification stays initiated.

    const listed = await listSubmittedVerificationsBefore(database.db, {
      before: minutesBefore(2),
    });

    expect(
      listed.filter(({ id }) => [older, newer, decided, a.verification.id].includes(id)),
    ).toEqual([
      { environmentId: a.environment.id, id: newer },
      { environmentId: b.environment.id, id: older },
    ]);
  });

  it('takes at most `limit`, the newest', async () => {
    const { environment, inquiry } = await newVerification('selfie');
    const oldest = await submitted(environment.id, inquiry.id, minutesBefore(30));
    const middle = await submitted(environment.id, inquiry.id, minutesBefore(29));
    const before = new Date(minutesBefore(29).getTime() + 1);

    expect(await listSubmittedVerificationsBefore(database.db, { before, limit: 1 })).toEqual([
      { environmentId: environment.id, id: middle },
    ]);
    expect(
      (await listSubmittedVerificationsBefore(database.db, { before, limit: 2 })).map(
        ({ id }) => id,
      ),
    ).toEqual([middle, oldest]);
  });
});
