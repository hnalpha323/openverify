/** C10: expiring an inquiry cancels its initiated verifications. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  cancelInitiatedVerifications,
  createVerification,
  setVerificationStatus,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

describe('cancelInitiatedVerifications', () => {
  it('cancels only the initiated verifications of the inquiry, inside its environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const { inquiry } = await createTestInquiry(database.db, env);
    const { inquiry: otherInquiry } = await createTestInquiry(database.db, env);
    const create = (inquiryId: string) =>
      createVerification(database.db, env, { id: testId('ver'), inquiryId, type: 'selfie' });
    const initiated = await create(inquiry.id);
    const submitted = await create(inquiry.id);
    await setVerificationStatus(database.db, env, submitted.id, { to: 'submitted' });
    await create(otherInquiry.id);

    expect(await cancelInitiatedVerifications(database.db, testId('env'), inquiry.id)).toEqual([]);
    const canceled = await cancelInitiatedVerifications(database.db, env, inquiry.id);

    expect(canceled.map((verification) => [verification.id, verification.status])).toEqual([
      [initiated.id, 'canceled'],
    ]);
  });
});
