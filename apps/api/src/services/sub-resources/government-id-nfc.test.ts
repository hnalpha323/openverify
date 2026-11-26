/**
 * C54.1, C62.5: canceling a government ID NFC verification closes its open chip challenge
 * (`superseded`), so it can never be submitted; a consumed one stays as it is. Every value is
 * synthetic.
 */
import { getChipChallenge, getVerification } from '@openverify/db';
import { seedChipChallenge } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiry,
  createTestApi,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { governmentIdNfcSubResources } from './government-id-nfc.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('the government ID NFC cancel hook (C54.1)', () => {
  it('supersedes the open challenge and leaves a consumed one, staging nothing', async () => {
    const inquiryId = await createInquiry(api);
    const { id } = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id_nfc',
    });
    const consumed = await seedChipChallenge(api.database.db, api.environmentId, {
      verificationId: id,
      inquiryId,
      status: 'submitted',
    });
    const open = await seedChipChallenge(api.database.db, api.environmentId, {
      verificationId: id,
      inquiryId,
    });
    const verification = await getVerification(api.database.db, api.environmentId, id);
    if (verification === null) {
      throw new Error('seeded verification missing');
    }

    const result = await governmentIdNfcSubResources.onVerificationCanceled(
      api.database.db,
      api.events,
      verification,
    );

    expect(result).toEqual({ staged: [], storageKeys: [] });
    expect((await getChipChallenge(api.database.db, api.environmentId, open))?.status).toBe(
      'superseded',
    );
    expect((await getChipChallenge(api.database.db, api.environmentId, consumed))?.status).toBe(
      'submitted',
    );
  });
});
