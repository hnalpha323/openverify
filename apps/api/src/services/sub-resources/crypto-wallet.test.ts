/**
 * C54.1, C57.2: canceling a crypto wallet verification closes its open challenge (`superseded`),
 * so it can never be submitted; a consumed one stays as it is. Every value is synthetic.
 */
import { getCryptoChallenge, getVerification } from '@openverify/db';
import { seedCryptoChallenge } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { cryptoWalletSubResources } from './crypto-wallet.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

async function walletWithChallenges() {
  const inquiryId = await createInquiry(api);
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'crypto_wallet',
  });
  const base = {
    verificationId: id,
    inquiryId,
    chainId: 'eip155:1',
    walletAddress: `0x${'cd'.repeat(20)}`,
    message: 'synthetic challenge',
  };
  const consumed = await seedCryptoChallenge(api.database.db, api.environmentId, {
    ...base,
    status: 'submitted',
    signature: '0xsynthetic',
  });
  const open = await seedCryptoChallenge(api.database.db, api.environmentId, base);
  return { inquiryId, verificationId: id, open, consumed };
}

describe('the crypto wallet cancel hook (C54.1)', () => {
  it('supersedes the open challenge and leaves a consumed one, staging nothing', async () => {
    const { verificationId, open, consumed } = await walletWithChallenges();
    const verification = await getVerification(api.database.db, api.environmentId, verificationId);
    if (verification === null) {
      throw new Error('seeded verification missing');
    }

    const result = await cryptoWalletSubResources.onVerificationCanceled(
      api.database.db,
      api.events,
      verification,
    );

    expect(result).toEqual({ staged: [], storageKeys: [] });
    expect((await getCryptoChallenge(api.database.db, api.environmentId, open))?.status).toBe(
      'superseded',
    );
    expect((await getCryptoChallenge(api.database.db, api.environmentId, consumed))?.status).toBe(
      'submitted',
    );
  });

  it('runs when the inquiry expires, which cancels the verification', async () => {
    const { inquiryId, verificationId, open } = await walletWithChallenges();

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('canceled');
    expect((await getCryptoChallenge(api.database.db, api.environmentId, open))?.status).toBe(
      'superseded',
    );
  });
});
