/**
 * C62.5, C52.6: the `government-id-nfc` submit. The body carries `{ chip: { challenge-id, nonce,
 * active-authentication-response?, device-report? } }`; the SOD (parsed, bounded) must have every
 * data group it lists among 1, 2, 14 and 15 uploaded (409 `chip_data_required`); the named
 * challenge, with the nonce the client echoes, is consumed once by a conditional update (one 409
 * `chip_challenge_invalid` body for a wrong, used, superseded or expired one), sealing the AA
 * response with that nonce and the device report. Chips are synthetic, under the Utopia test CSCA.
 */
import { existsSync, readFileSync } from 'node:fs';
import { CHIP_CHALLENGE_TTL_SECONDS, flowChipChallengeResponseSchema } from '@openverify/contracts';
import { getChipChallenge, getVerification, openChipChallengeSubmission } from '@openverify/db';
import { signActiveAuthentication } from '@openverify/emrtd/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  chipUploads,
  nfcTemplateAttributes,
  testChip,
} from '../../services/chip-challenges/testing.js';
import { T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  multipart,
  PROBLEM_JSON,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { passStepsBefore } from '../../flow-engine/testing.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, nfcTemplateAttributes());
});

beforeEach(() => {
  api.clock.set(T0);
});

afterAll(async () => {
  await api.close();
});

const CONSENT = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A consented inquiry with an NFC verification. */
async function chipFlow() {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  // C151.4 (Workflow 9A): the ID and selfie steps passed, so the chip step is the current one.
  await passStepsBefore(api, inquiryId, 'government_id_nfc');
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(token),
      payload: CONSENT,
    }),
    201,
  );
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'government_id_nfc',
  });
  return { inquiryId, token, verificationId: id };
}

async function upload(
  flow: { token: string; verificationId: string },
  kind: string,
  bytes: Uint8Array,
) {
  const body = await multipart({ kind, file: { bytes } });
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${flow.verificationId}/files`,
      headers: { ...bearer(flow.token), ...body.headers },
      payload: body.payload,
    }),
    201,
  );
}

async function uploadAll(
  flow: { token: string; verificationId: string },
  uploads: [string, Uint8Array][],
) {
  for (const [kind, bytes] of uploads) {
    await upload(flow, kind, bytes);
  }
}

async function newChallenge(flow: { token: string; verificationId: string }) {
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${flow.verificationId}/chip-challenges`,
    headers: bearer(flow.token),
    payload: {},
  });
  return flowChipChallengeResponseSchema.parse(expectStatus(response, 201));
}

function submit(
  flow: { token: string; verificationId: string },
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${flow.verificationId}/submit`,
    headers: bearer(flow.token),
    payload,
  });
}

/** The golden problem of `code`, `instance` and `requestId` aside. */
function expectGolden(response: LightMyRequestResponse, code: string): void {
  const url = new URL(
    `../../../../../contracts/fixtures/problems/flow/${code.replaceAll('_', '-')}.json`,
    import.meta.url,
  );
  const fixture = existsSync(url)
    ? (JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>)
    : undefined;
  const named = { instance: '<instance>', requestId: '<request id>' };
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  expect({ ...response.json<Record<string, unknown>>(), ...named }).toEqual(
    fixture === undefined ? undefined : { ...fixture, ...named },
  );
}

const DEVICE_REPORT = {
  protocols: [
    { protocol: 'pace', outcome: 'succeeded' },
    { protocol: 'active-authentication', outcome: 'succeeded' },
  ],
  'read-ms': 2400,
};

describe('the government-id-nfc submit (C62.5)', () => {
  it('consumes the challenge with its nonce and seals the AA response and the device report', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, chipUploads(chip));
    const challenge = await newChallenge(flow);
    const key = chip.activeAuthenticationKey;
    if (key === null) {
      throw new Error('the test chip has an AA key');
    }
    const response64 = Buffer.from(
      signActiveAuthentication(key, Buffer.from(challenge.nonce, 'hex')),
    ).toString('base64');

    const response = await submit(flow, {
      chip: {
        'challenge-id': challenge.id,
        nonce: challenge.nonce,
        'active-authentication-response': response64,
        'device-report': DEVICE_REPORT,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('submitted');
    expect((await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.status).toBe(
      'submitted',
    );
    const sealed = await openChipChallengeSubmission(
      api.database.db,
      api.environmentId,
      challenge.id,
    );
    expect(sealed).toEqual({
      nonce: challenge.nonce,
      aaResponse: response64,
      deviceReport: JSON.stringify(DEVICE_REPORT),
    });
    expect(api.queue.jobs.map((job) => job.verificationId)).toContain(flow.verificationId);
  });

  it('takes a chip without an AA response or a report', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, chipUploads(chip));
    const challenge = await newChallenge(flow);

    const response = await submit(flow, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect(response.statusCode).toBe(202);
    expect((await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.status).toBe(
      'submitted',
    );
    expect(
      await openChipChallengeSubmission(api.database.db, api.environmentId, challenge.id),
    ).toEqual({ nonce: null, aaResponse: null, deviceReport: null });
  });

  it('needs every data group the SOD lists among 1, 2, 14 and 15 (409 chip_data_required)', async () => {
    const chip = testChip({ now: T0, withhold: [15] });
    const flow = await chipFlow();
    await uploadAll(flow, chipUploads(chip));
    const challenge = await newChallenge(flow);

    const response = await submit(flow, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect(response.statusCode).toBe(409);
    expectGolden(response, 'chip_data_required');
    expect((await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.status).toBe(
      'initiated',
    );
  });

  it('still needs the SOD, DG1 and DG2 files themselves (422)', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(
      flow,
      chipUploads(chip).filter(([kind]) => kind !== 'chip-dg2'),
    );
    const challenge = await newChallenge(flow);

    const response = await submit(flow, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toBe('Missing required files: chip-dg2.');
  });

  it('answers one 409 chip_challenge_invalid for another nonce, an unknown, superseded or expired challenge, or none', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, chipUploads(chip));
    const superseded = await newChallenge(flow);
    const current = await newChallenge(flow);

    const refusals = [
      await submit(flow, { chip: { 'challenge-id': current.id, nonce: superseded.nonce } }),
      await submit(flow, { chip: { 'challenge-id': superseded.id, nonce: superseded.nonce } }),
      await submit(flow, {
        chip: { 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM', nonce: current.nonce },
      }),
      await submit(flow, {}),
    ];
    api.clock.set(new Date(T0.getTime() + CHIP_CHALLENGE_TTL_SECONDS * 1000));
    refusals.push(
      await submit(flow, { chip: { 'challenge-id': current.id, nonce: current.nonce } }),
    );

    for (const refused of refusals) {
      expect(refused.statusCode).toBe(409);
      expectGolden(refused, 'chip_challenge_invalid');
    }
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('initiated');
  });

  it('repeats a submit only for the challenge that submitted the verification', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, chipUploads(chip));
    const challenge = await newChallenge(flow);
    const body = { chip: { 'challenge-id': challenge.id, nonce: challenge.nonce } };
    expect((await submit(flow, body)).statusCode).toBe(202);

    const repeated = await submit(flow, body);
    const other = await submit(flow, {
      chip: { 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM', nonce: challenge.nonce },
    });

    expect(repeated.statusCode).toBe(202);
    expect(other.statusCode).toBe(409);
    expectGolden(other, 'chip_challenge_invalid');
  });

  it('submits a SOD it cannot read, for the job to judge (chip_data_malformed is review)', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, [
      ['chip-sod', new Uint8Array([0x77, 0x04, 0x01, 0x02, 0x03, 0x04])],
      ...chipUploads(chip).filter(([kind]) => kind !== 'chip-sod'),
    ]);
    const challenge = await newChallenge(flow);

    const response = await submit(flow, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect(response.statusCode).toBe(202);
  });

  // Workflow 5C review P002: asn1js throws its own RangeError on a BMPString of odd length; the
  // guard must see chip_data_malformed and leave the SOD to the job, never answer 500.
  it('submits a SOD whose string asn1js cannot decode, for the job to judge', async () => {
    const chip = testChip({ now: T0 });
    const flow = await chipFlow();
    await uploadAll(flow, [
      ['chip-sod', new Uint8Array([0x77, 0x05, 0x1e, 0x03, 0x41, 0x42, 0x43])],
      ...chipUploads(chip).filter(([kind]) => kind !== 'chip-sod'),
    ]);
    const challenge = await newChallenge(flow);

    const response = await submit(flow, {
      chip: { 'challenge-id': challenge.id, nonce: challenge.nonce },
    });

    expect(response.statusCode).toBe(202);
  });

  it('refuses another type member (422)', async () => {
    const flow = await chipFlow();

    const response = await submit(flow, {
      crypto: { 'challenge-id': 'cwc_01M5CK3190XEVBM5ZXA76E1JSM', signature: '0xab' },
    });

    expect(response.statusCode).toBe(422);
  });
});
