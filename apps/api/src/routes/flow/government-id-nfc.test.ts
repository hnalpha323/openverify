/**
 * C62.5, C52.2: `POST /api/v1/flow/verifications/:id/chip-challenges` and the NFC step's
 * guidance. The server issues 8 CSPRNG bytes as 16 hex characters, stores only their SHA-256,
 * supersedes the open challenge, and cancels the verification at the 11th. Every value is
 * synthetic.
 */
import { createHash } from 'node:crypto';
import {
  CHIP_CHALLENGE_LIMIT,
  CHIP_CHALLENGE_TTL_SECONDS,
  flowChipChallengeResponseSchema,
  flowVerificationDocumentSchema,
} from '@openverify/contracts';
import { getInquiry, getVerification, listChipChallenges } from '@openverify/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  nfcTemplateAttributes,
  type NfcTemplateOptions,
} from '../../services/chip-challenges/testing.js';
import { T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  api = await createTestApi();
  templateId = await template();
});

beforeEach(() => {
  api.clock.set(T0);
});

afterAll(async () => {
  await api.close();
});

async function template(options: NfcTemplateOptions = {}): Promise<string> {
  return createTemplate(api, api.token, nfcTemplateAttributes(options));
}

const CONSENT = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A started inquiry of `templateId` whose session consented, with an NFC verification. */
async function chipFlow(options: { templateId?: string; consent?: boolean } = {}) {
  const inquiryId = await createInquiry(api, { templateId: options.templateId ?? templateId });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  if (options.consent !== false) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT,
      }),
      201,
    );
  }
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'government_id_nfc',
  });
  return { inquiryId, token, verificationId: id };
}

function challenge(
  flow: { token: string; verificationId: string },
  body: unknown = {},
): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${flow.verificationId}/chip-challenges`,
    headers: bearer(flow.token),
    payload: body as Record<string, unknown>,
  });
}

function issued(response: LightMyRequestResponse) {
  if (response.statusCode !== 201) {
    throw new Error(`expected HTTP 201, got ${String(response.statusCode)}: ${response.body}`);
  }
  return flowChipChallengeResponseSchema.parse(response.json());
}

const sha256OfHex = (hex: string) =>
  createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

describe('POST /verifications/:id/chip-challenges (C62.5)', () => {
  it('returns a new nonce once, stores only its SHA-256, and expires it in 300 s', async () => {
    const flow = await chipFlow();

    const answer = issued(await challenge(flow));

    expect(answer.id).toMatch(/^chc_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(answer.nonce).toMatch(/^[0-9a-f]{16}$/u);
    expect(answer['expires-at']).toBe(
      new Date(T0.getTime() + CHIP_CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    );
    const [stored] = await listChipChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(stored).toMatchObject({
      id: answer.id,
      status: 'initiated',
      nonceSha256: sha256OfHex(answer.nonce),
    });
  });

  it('gives each challenge its own nonce and supersedes the open one', async () => {
    const flow = await chipFlow();
    const first = issued(await challenge(flow));
    api.clock.set(new Date(T0.getTime() + 1_000));

    const second = issued(await challenge(flow));

    expect(second.nonce).not.toBe(first.nonce);
    const stored = await listChipChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(stored.map((one) => [one.id, one.status])).toEqual([
      [second.id, 'initiated'],
      [first.id, 'superseded'],
    ]);
  });

  it('expires the open challenge it replaces after its expiry', async () => {
    const flow = await chipFlow();
    const first = issued(await challenge(flow));
    api.clock.set(new Date(T0.getTime() + CHIP_CHALLENGE_TTL_SECONDS * 1000));

    issued(await challenge(flow));

    const stored = await listChipChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(stored.find((one) => one.id === first.id)?.status).toBe('expired');
  });

  it('cancels the verification at the 11th challenge (409 chip_challenge_invalid), with attempts left', async () => {
    const flow = await chipFlow();
    for (let index = 0; index < CHIP_CHALLENGE_LIMIT; index += 1) {
      issued(await challenge(flow));
    }
    const before = api.events.events.length;

    const response = await challenge(flow);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, code: 'chip_challenge_invalid' });
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('canceled');
    const stored = await listChipChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(stored).toHaveLength(CHIP_CHALLENGE_LIMIT);
    expect(stored.filter((one) => one.status === 'initiated')).toEqual([]);
    expect(api.events.events.slice(before).map((event) => event.name)).toEqual([
      'verification.canceled',
    ]);
    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'pending',
    );
  });

  it('fails the inquiry when the canceled attempt was the step’s last', async () => {
    const single = await template({ maxAttempts: 1 });
    const flow = await chipFlow({ templateId: single });
    for (let index = 0; index < CHIP_CHALLENGE_LIMIT; index += 1) {
      issued(await challenge(flow));
    }
    const before = api.events.events.length;

    expect((await challenge(flow)).statusCode).toBe(409);

    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'failed',
    );
    expect(api.events.events.slice(before).map((event) => event.name)).toEqual(
      expect.arrayContaining(['verification.canceled', 'inquiry.failed']),
    );
  });

  it('keeps the C52.1 preconditions: consent, the type, the inquiry and the status', async () => {
    const unconsented = await chipFlow({ consent: false });
    expect((await challenge(unconsented)).statusCode).toBe(409);

    const flow = await chipFlow();
    const selfie = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'selfie',
    });
    expect((await challenge({ token: flow.token, verificationId: selfie.id })).statusCode).toBe(
      422,
    );

    const other = await chipFlow();
    expect(
      (await challenge({ token: flow.token, verificationId: other.verificationId })).statusCode,
    ).toBe(404);

    const submitted = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'government_id_nfc',
      status: 'submitted',
    });
    expect((await challenge({ token: flow.token, verificationId: submitted.id })).statusCode).toBe(
      409,
    );

    expect((await challenge(flow, { nonce: '0123456789abcdef' })).statusCode).toBe(400);
  });
});

describe('the NFC guidance (C52.2)', () => {
  it('is an empty object on the step’s verification', async () => {
    const flow = await chipFlow();

    const document = flowVerificationDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/flow/verifications/${flow.verificationId}`,
          headers: bearer(flow.token),
        }),
        200,
      ),
    );

    expect((document.data.attributes as { guidance?: unknown }).guidance).toEqual({});
  });
});
