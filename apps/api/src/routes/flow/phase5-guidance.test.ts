/**
 * C52.2, C54.1: a Phase 5 verification's flow view carries what its type's guidance hook builds
 * from the inquiry's pinned step and configuration; a government ID's carries no guidance. The
 * phone hook is replaced by a recording one.
 */
import { flowSessionResponseSchema, flowVerificationDocumentSchema } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FlowGuidanceContext } from '../../services/guidance/index.js';
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
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';

const seen = vi.hoisted(() => [] as { step: string | undefined; config: unknown; id: string }[]);

vi.mock('../../services/guidance/phone-number.js', () => ({
  phoneNumberGuidance: {
    flowAttributes: (ctx: FlowGuidanceContext) => {
      seen.push({ step: ctx.step?.type, config: ctx.config, id: ctx.verification.id });
      return Promise.resolve({
        guidance: { 'allowed-countries': ['US'], 'code-length': 6, otp: null },
      });
    },
  },
}));

let api: TestApi;
let sessionToken: string;
let phoneId: string;
let idId: string;

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  const attributes = phase5TemplateAttributes();
  const templateId = await createTemplate(api, api.token, attributes);
  const inquiryId = await createInquiry(api, { templateId });
  sessionToken = await resumeInquiry(api, inquiryId);
  idId = (await seedVerification(api, api.environmentId, inquiryId, { type: 'government_id' })).id;
  phoneId = (await seedVerification(api, api.environmentId, inquiryId, { type: 'phone_number' }))
    .id;
});

afterAll(async () => {
  await api.close();
});

const PHONE_GUIDANCE = { 'allowed-countries': ['US'], 'code-length': 6, otp: null };

describe('flow views of Phase 5 verifications (C52.2)', () => {
  it('GET /flow/session: each verification carries its type guidance; a government ID none', async () => {
    const session = flowSessionResponseSchema.parse(
      expectStatus(
        await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
        200,
      ),
    );
    const phone = session.verifications.find((verification) => verification.id === phoneId);
    const id = session.verifications.find((verification) => verification.id === idId);

    expect(phone?.attributes).toMatchObject({ guidance: PHONE_GUIDANCE });
    expect(id?.attributes).not.toHaveProperty('guidance');
  });

  it('GET /flow/verifications/:id: built from the pinned phone step and configuration', async () => {
    seen.length = 0;
    const document = flowVerificationDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/flow/verifications/${phoneId}`,
          headers: bearer(sessionToken),
        }),
        200,
      ),
    );

    expect(document.data.attributes).toMatchObject({ guidance: PHONE_GUIDANCE });
    expect(seen).toEqual([
      {
        step: 'phone_otp',
        config: phase5TemplateAttributes()['verification-config']['phone-number'],
        id: phoneId,
      },
    ]);
  });
});
