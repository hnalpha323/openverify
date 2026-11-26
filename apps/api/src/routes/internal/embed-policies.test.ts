/**
 * C157.2 (Workflow 9A, flow-server-embed): `GET /api/v1/internal/embed-policies/:inquiryId` answers
 * the flow server the inquiry's embed policy, and one 404 for an unknown inquiry and an inactive
 * template alike (review F03). Every origin is a reserved name and every value is synthetic.
 */
import { embedPolicyAnswerSchema } from '@openverify/contracts';
import { environments, inquiryTemplates } from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createInquiry, createTemplate } from '../../test-support/harness.js';

const TOKEN = 'synthetic-flow-server-token-current-0123456789';
const UNKNOWN = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const SHOP = 'https://shop.example.com';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi({ flowServerTokens: { current: TOKEN, previous: null } });
  await api.database.db
    .update(environments)
    .set({ settings: { 'allowed-embed-origins': [SHOP, 'https://*.example.org'] } })
    .where(eq(environments.id, api.environmentId));
});

afterAll(async () => {
  await api.close();
});

const lookup = (inquiryId: string) =>
  api.app.inject({
    method: 'GET',
    url: `/api/v1/internal/embed-policies/${inquiryId}`,
    headers: { authorization: `Bearer ${TOKEN}` },
  });

describe('the internal embed-policy route (C157.2)', () => {
  it("answers the inquiry's policy under the frozen schema", async () => {
    const templateId = await createTemplate(api);
    const inquiryId = await createInquiry(api, { templateId });

    const response = await lookup(inquiryId);

    expect(response.statusCode, response.body).toBe(200);
    expect(embedPolicyAnswerSchema.parse(response.json())).toEqual({
      'inquiry-id': inquiryId,
      'template-id': templateId,
      'environment-id': api.environmentId,
      'frame-ancestors': [SHOP, 'https://*.example.org'],
    });
  });

  it('answers the same 404 for an unknown inquiry and for an inactive template', async () => {
    const templateId = await createTemplate(api);
    const inquiryId = await createInquiry(api, { templateId });
    await api.database.db
      .update(inquiryTemplates)
      .set({ status: 'archived' })
      .where(eq(inquiryTemplates.id, templateId));

    const unknown = await lookup(UNKNOWN);
    const inactive = await lookup(inquiryId);

    expect([unknown.statusCode, inactive.statusCode]).toEqual([404, 404]);
    const comparable = (body: Record<string, unknown>) => ({
      ...body,
      instance: undefined,
      requestId: undefined,
    });
    expect(comparable(inactive.json())).toEqual(comparable(unknown.json()));
    expect(inactive.body).not.toContain(templateId);
  });
});
