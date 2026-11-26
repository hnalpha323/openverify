/**
 * C57.3, C52.6: a crypto wallet verification is submitted with `{ crypto }`, naming its open
 * challenge and carrying the signature (and, for a wrapped message, the signed bytes), which the
 * submit consumes once by a conditional update, sealed. Every refusal of the challenge answers one
 * 409 `crypto_challenge_invalid` body. Every value is synthetic.
 */
import { existsSync, readFileSync } from 'node:fs';
import { CRYPTO_CHALLENGE_TTL_SECONDS, newId } from '@openverify/contracts';
import {
  getCryptoChallenge,
  getVerification,
  openCryptoChallengeEvidence,
} from '@openverify/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cryptoWalletTemplateAttributes,
  signTestPersonalMessage,
  testWalletAddress,
  TEST_CHAINS,
} from '../crypto-challenges/testing.js';
import { T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, cryptoWalletTemplateAttributes());
});

beforeEach(() => {
  api.clock.set(T0);
});

afterAll(async () => {
  await api.close();
});

const LABEL = 'submit/alice';
const ADDRESS = testWalletAddress(LABEL);

/** A consented session's crypto wallet verification with one open challenge for {@link ADDRESS}. */
async function challenged() {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(token),
      payload: {
        accepted: true,
        'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        locale: 'en',
      },
    }),
    201,
  );
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'crypto_wallet',
  });
  const created = await api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${id}/crypto-challenges`,
    headers: bearer(token),
    payload: { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': ADDRESS },
  });
  const challenge = created.json<{ id: string; message: string }>();
  return { inquiryId, token, verificationId: id, challenge };
}

function submit(token: string, id: string, payload?: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${id}/submit`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

const golden = (() => {
  const url = new URL(
    '../../../../../contracts/fixtures/problems/flow/crypto-challenge-invalid.json',
    import.meta.url,
  );
  return existsSync(url)
    ? (JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>)
    : undefined;
})();

/** The one 409 `crypto_challenge_invalid` body, `instance` and `requestId` aside. */
function expectChallengeInvalid(response: LightMyRequestResponse): void {
  const named = { instance: '<instance>', requestId: '<request id>' };
  expect(response.statusCode).toBe(409);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  expect({ ...response.json<Record<string, unknown>>(), ...named }).toEqual({
    ...golden,
    ...named,
  });
}

describe('the crypto wallet submit (C57.3)', () => {
  it('consumes the open challenge once, sealing the signature, the signed message and the scheme', async () => {
    const flow = await challenged();
    const signature = signTestPersonalMessage(flow.challenge.message, LABEL);
    const signedMessage = Buffer.from(flow.challenge.message, 'utf8').toString('base64');
    const before = api.queue.jobs.length;

    const response = await submit(flow.token, flow.verificationId, {
      crypto: {
        'challenge-id': flow.challenge.id,
        signature,
        'signed-message': signedMessage,
        scheme: 'eip191',
      },
    });

    expect(expectStatus(response, 202).data.attributes).toMatchObject({ status: 'submitted' });
    expect(
      await getCryptoChallenge(api.database.db, api.environmentId, flow.challenge.id),
    ).toMatchObject({ status: 'submitted', scheme: 'eip191', submittedAt: T0 });
    expect(
      await openCryptoChallengeEvidence(api.database.db, api.environmentId, flow.challenge.id),
    ).toMatchObject({ signature, signedMessage, walletAddress: ADDRESS });
    expect(api.queue.jobs.slice(before)).toEqual([
      { environmentId: api.environmentId, verificationId: flow.verificationId },
    ]);
    expect(api.events.named('verification.submitted').at(-1)?.payload.data).toMatchObject({
      id: flow.verificationId,
    });
  });

  it('takes a pasted signature without a scheme or a signed message', async () => {
    const flow = await challenged();

    expectStatus(
      await submit(flow.token, flow.verificationId, {
        crypto: {
          'challenge-id': flow.challenge.id,
          signature: signTestPersonalMessage(flow.challenge.message, LABEL),
        },
      }),
      202,
    );

    expect(
      await getCryptoChallenge(api.database.db, api.environmentId, flow.challenge.id),
    ).toMatchObject({ status: 'submitted', scheme: null });
    expect(
      (await openCryptoChallengeEvidence(api.database.db, api.environmentId, flow.challenge.id))
        ?.signedMessage,
    ).toBeNull();
  });

  it('needs the crypto member: without it, one 409 crypto_challenge_invalid', async () => {
    const flow = await challenged();

    expectChallengeInvalid(await submit(flow.token, flow.verificationId));
    expectChallengeInvalid(await submit(flow.token, flow.verificationId, {}));
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('initiated');
  });

  it('answers the same 409 for an unknown, another verification’s, a superseded and an expired challenge', async () => {
    const flow = await challenged();
    const other = await challenged();
    const signature = signTestPersonalMessage(flow.challenge.message, LABEL);
    const named = (id: string) => ({ crypto: { 'challenge-id': id, signature } });

    expectChallengeInvalid(await submit(flow.token, flow.verificationId, named(newId('cwc'))));
    expectChallengeInvalid(
      await submit(flow.token, flow.verificationId, named(other.challenge.id)),
    );
    const replaced = flow.challenge.id;
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${flow.verificationId}/crypto-challenges`,
      headers: bearer(flow.token),
      payload: { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': ADDRESS },
    });
    expectChallengeInvalid(await submit(flow.token, flow.verificationId, named(replaced)));
    api.clock.advance(CRYPTO_CHALLENGE_TTL_SECONDS * 1000);
    expectChallengeInvalid(
      await submit(other.token, other.verificationId, named(other.challenge.id)),
    );

    for (const target of [flow, other]) {
      expect(
        (await getVerification(api.database.db, api.environmentId, target.verificationId))?.status,
      ).toBe('initiated');
    }
    expect(
      (await getCryptoChallenge(api.database.db, api.environmentId, other.challenge.id))?.status,
    ).toBe('initiated');
  });

  it('repeats a submit naming the challenge that submitted it, and refuses another', async () => {
    const flow = await challenged();
    const body = {
      crypto: {
        'challenge-id': flow.challenge.id,
        signature: signTestPersonalMessage(flow.challenge.message, LABEL),
      },
    };
    expectStatus(await submit(flow.token, flow.verificationId, body), 202);
    const submitted = api.events.named('verification.submitted').length;
    const jobs = api.queue.jobs.length;

    expectStatus(await submit(flow.token, flow.verificationId, body), 202);
    expectChallengeInvalid(
      await submit(flow.token, flow.verificationId, {
        crypto: { ...body.crypto, 'challenge-id': newId('cwc') },
      }),
    );
    expectChallengeInvalid(await submit(flow.token, flow.verificationId));

    expect(api.events.named('verification.submitted')).toHaveLength(submitted);
    expect(api.queue.jobs.length).toBe(jobs + 1);
  });
});
