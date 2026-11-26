/**
 * C52.6: the submit rules the contracts fix for the Phase 5 types, which their builders keep:
 * each type takes only its own body member, needs the evidence of its step (a document's file,
 * a chip's SOD and data groups 1 and 2, a form type's entered values), never takes a client
 * submit of a silent AAMVA attempt, and moves phone and email from `confirmed`.
 */
import { newId, type SupportedVerificationType } from '@openverify/contracts';
import { seedVerificationInputs } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';
import { reachStep } from '../../flow-engine/testing.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
});

afterAll(async () => {
  await api.close();
});

/** A started inquiry of the Phase 5 template with one verification of `type`. */
async function seeded(type: SupportedVerificationType, status?: 'confirmed') {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) });
  // C151.4 (Workflow 9A): the steps before the type's passed and consent given, so it is current.
  await reachStep(api, inquiryId, token, type);
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type,
    ...(status === undefined ? {} : { status }),
  });
  return { inquiryId, token, id };
}

function submit(token: string, id: string, payload?: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${id}/submit`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

const CAPTURE = { capture: { id: newId('self'), nonce: 'A'.repeat(22) } };
const CRYPTO = { crypto: { 'challenge-id': newId('cwc'), signature: '0xab' } };
const CHIP = { chip: { 'challenge-id': newId('chc'), nonce: '0123456789abcdef' } };

describe('Phase 5 submits (C52.6)', () => {
  it.each([
    ['crypto_wallet', CAPTURE],
    ['crypto_wallet', CHIP],
    ['government_id_nfc', CRYPTO],
    ['document', CRYPTO],
    ['database', CHIP],
  ] as const)('refuses a %s submit carrying another type member', async (type, body) => {
    const { token, id } = await seeded(type);

    const response = await submit(token, id, body);

    expect(response.statusCode).toBe(422);
  });

  it.each(['database', 'database_business', 'business_website'] as const)(
    'needs a %s verification entered values (409 inputs_required), then submits it',
    async (type) => {
      const { inquiryId, token, id } = await seeded(type);

      const refused = await submit(token, id);
      await seedVerificationInputs(api.database.db, api.environmentId, {
        verificationId: id,
        inquiryId,
        values: { 'name-first': 'Synthetic' },
      });
      const accepted = await submit(token, id);

      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'inputs_required' });
      expect(accepted.statusCode).toBe(202);
    },
  );

  it('refuses a client submit of a silent AAMVA attempt (409 verification_created_by_server)', async () => {
    const { token, id } = await seeded('aamva');

    const response = await submit(token, id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'verification_created_by_server' });
  });

  it('needs a chip read SOD, DG1 and DG2', async () => {
    const { token, id } = await seeded('government_id_nfc');

    const response = await submit(token, id, CHIP);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toBe(
      'Missing required files: chip-sod, chip-dg1, chip-dg2.',
    );
  });

  it.each(['phone_number', 'email_address'] as const)(
    'submits a %s verification whose code was confirmed',
    async (type) => {
      const { token, id } = await seeded(type, 'confirmed');

      const response = await submit(token, id);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ data: { attributes: { status: 'submitted' } } });
    },
  );
});
