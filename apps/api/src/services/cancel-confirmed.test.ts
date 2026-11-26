/**
 * C50.7: a cancel path cancels a `confirmed` verification too (phone and email), running its
 * type's cancel hook (C54.1) and staging `verification.canceled`. The phone hook is replaced by a
 * recording one.
 */
import { getVerification } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  seedVerification,
  type TestApi,
} from '../test-support/harness.js';

const canceled = vi.hoisted(() => [] as { id: string; status: string }[]);

vi.mock('./sub-resources/phone-number.js', () => ({
  phoneNumberSubResources: {
    onVerificationCanceled: (_tx: unknown, _events: unknown, verification: { id: string; status: string }) => {
      canceled.push({ id: verification.id, status: verification.status });
      return Promise.resolve({ staged: [], storageKeys: [] });
    },
  },
}));

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('cancel paths and confirmed verifications (C50.7)', () => {
  it('expiring an inquiry cancels its confirmed verification through its type hook', async () => {
    const inquiryId = await createInquiry(api);
    const { id } = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'phone_number',
      status: 'confirmed',
    });

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect((await getVerification(api.database.db, api.environmentId, id))?.status).toBe(
      'canceled',
    );
    expect(canceled).toEqual([{ id, status: 'confirmed' }]);
    expect(
      api.events.named('verification.canceled').map((event) => event.payload.data.id),
    ).toContain(id);
  });
});
