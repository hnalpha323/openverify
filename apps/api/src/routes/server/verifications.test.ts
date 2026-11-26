import { verificationDocumentSchema } from '@openverify/contracts';
import { BUILTIN_ROLES, EXTRACTION_FIELDS, emptyExtractedFields } from '@openverify/core';
import { redactGovernmentIdExtractions } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  openFlowSession,
  seedVerification,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const url = (id: string) => `/api/v1/verifications/${id}`;

describe('from-rejected-handoff (C96.3)', () => {
  it('tells a reviewer which verifications came from the rejected session, to every reader', async () => {
    const inquiryId = await createInquiry(api);
    const clean = await seedVerification(api, api.environmentId, inquiryId, { status: 'failed' });
    const rejected = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'failed',
    });
    await api.database.db.execute(
      sql`update verifications set from_rejected_handoff = true where id = ${rejected.id}`,
    );
    const masked = api.newUserToken(api.environmentId, { permissions: ['verifications:read'] });
    const read = async (id: string, token: string) =>
      verificationDocumentSchema.parse(
        expectStatus(await api.app.inject({ url: url(id), headers: bearer(token) }), 200),
      ).data.attributes;

    expect(await read(rejected.id, api.token)).toMatchObject({ 'from-rejected-handoff': true });
    expect(await read(rejected.id, masked)).toMatchObject({ 'from-rejected-handoff': true });
    expect(await read(clean.id, api.token)).toMatchObject({ 'from-rejected-handoff': false });
  });
});

describe('GET /api/v1/verifications/:id', () => {
  it('returns a government ID verification with its checks and files', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'failed',
      files: ['front'],
      checks: [
        {
          name: 'id_double_side_detection',
          status: 'failed',
          reasons: ['back_not_present'],
        },
      ],
    });

    const response = await api.app.inject({
      url: url(verification.id),
      headers: bearer(api.token),
    });

    const document = verificationDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data).toEqual({
      type: 'verification/government-id',
      id: verification.id,
      attributes: {
        status: 'failed',
        country: null,
        'id-class': null,
        // C31.5: nothing extracted yet, so every extraction attribute is null.
        ...Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
        'extraction-sources': null,
        'from-rejected-handoff': false,
        checks: [
          {
            name: 'id_double_side_detection',
            status: 'failed',
            reasons: ['back_not_present'],
            requirement: 'required',
            // C50.8: derived from the registry when the check is served.
            category: 'user_action_required',
            metadata: {},
            // C29.2: a check stored without them serves the registry stage and null.
            stage: 'beta',
            confidence: null,
            provenance: null,
          },
        ],
        'created-at': expect.any(String) as unknown,
        'updated-at': expect.any(String) as unknown,
      },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: inquiryId } },
        files: { data: [{ type: 'file', id: verification.fileIds[0] }] },
        // C105.7 (Workflow 7B): the latest transaction it was attached to, else null.
        transaction: { data: null },
      },
    });
  });

  it('returns a selfie verification without government ID attributes', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'selfie',
      status: 'submitted',
    });

    const response = await api.app.inject({
      url: url(verification.id),
      headers: bearer(api.token),
    });

    const document = verificationDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.type).toBe('verification/selfie');
    expect(document.data.attributes).not.toHaveProperty('country');
  });

  it.each(['developer', 'reviewer', 'viewer'] as const)(
    'serves the %s built-in role, so the check results behind a decision are readable (2B K001)',
    async (key) => {
      const inquiryId = await createInquiry(api);
      const verification = await seedVerification(api, api.environmentId, inquiryId);
      const token = api.newUserToken(api.environmentId, {
        permissions: BUILTIN_ROLES[key].permissions,
      });

      const response = await api.app.inject({ url: url(verification.id), headers: bearer(token) });

      expect(verificationDocumentSchema.parse(expectStatus(response, 200)).data.id).toBe(
        verification.id,
      );
    },
  );

  it('answers 404 for a verification of another environment', async () => {
    const other = await api.newTenant();
    const inquiryId = await createInquiry(api, { token: other.token });
    const verification = await seedVerification(api, other.environmentId, inquiryId);

    const response = await api.app.inject({
      url: url(verification.id),
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('the C31.5 extraction attributes (C31.6 exposure)', () => {
  /** A fictional Utopia holder: synthetic values only. */
  const fields = {
    ...emptyExtractedFields(),
    'name-first': 'QUINN',
    'name-last': 'VALEMONT',
    birthdate: '1990-02-14',
    'identification-number': 'X12K45P78',
    'issuing-authority-code': 'UTO',
  };
  const sources = { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] } as const;

  async function extracted() {
    const inquiryId = await createInquiry(api);
    return seedVerification(api, api.environmentId, inquiryId, {
      status: 'passed',
      extraction: { fields, sources: { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] } },
    });
  }

  it('serves the extracted fields and their sources to an API key', async () => {
    const verification = await extracted();

    const response = await api.app.inject({
      url: url(verification.id),
      headers: bearer(api.token),
    });

    expect(
      verificationDocumentSchema.parse(expectStatus(response, 200)).data.attributes,
    ).toMatchObject({ ...fields, 'extraction-sources': sources });
  });

  it('masks every extracted value, not the source names, for a user without pii:view', async () => {
    const verification = await extracted();
    const masked = api.newUserToken(api.environmentId, { permissions: ['verifications:read'] });
    const visible = api.newUserToken(api.environmentId, {
      permissions: ['verifications:read', 'pii:view'],
    });

    const hidden = await api.app.inject({ url: url(verification.id), headers: bearer(masked) });
    const shown = await api.app.inject({ url: url(verification.id), headers: bearer(visible) });

    expect(
      verificationDocumentSchema.parse(expectStatus(hidden, 200)).data.attributes,
    ).toMatchObject({
      ...Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
      'extraction-sources': sources,
    });
    expect(hidden.body).not.toContain('VALEMONT');
    expect(
      verificationDocumentSchema.parse(expectStatus(shown, 200)).data.attributes,
    ).toMatchObject({ 'name-last': 'VALEMONT' });
  });

  it('serves null values once the extraction is redacted (C31.7)', async () => {
    const verification = await extracted();
    await redactGovernmentIdExtractions(
      api.database.db,
      api.environmentId,
      [verification.id],
      new Date(),
    );

    const response = await api.app.inject({
      url: url(verification.id),
      headers: bearer(api.token),
    });

    expect(
      verificationDocumentSchema.parse(expectStatus(response, 200)).data.attributes,
    ).toMatchObject({
      ...Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
      'extraction-sources': sources,
    });
  });

  it('masks them in an inquiry with its verifications for a user without pii:view', async () => {
    const inquiryId = await createInquiry(api);
    await seedVerification(api, api.environmentId, inquiryId, {
      extraction: { fields, sources: {} },
    });
    const token = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'verifications:read'],
    });

    const shown = await api.app.inject({
      url: `/api/v1/inquiries/${inquiryId}?include=verifications`,
      headers: bearer(api.token),
    });
    const hidden = await api.app.inject({
      url: `/api/v1/inquiries/${inquiryId}?include=verifications`,
      headers: bearer(token),
    });

    expect(expectStatus(shown, 200)).toMatchObject({
      included: [{ attributes: { 'name-last': 'VALEMONT' } }],
    });
    expect(expectStatus(hidden, 200)).toMatchObject({
      included: [{ attributes: { 'name-last': null, birthdate: null } }],
    });
  });

  it('never serves them on the flow API', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await seedVerification(api, api.environmentId, inquiryId, {
      status: 'passed',
      extraction: { fields, sources: { 'name-last': ['mrz'] } },
    });

    const response = await api.app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(sessionToken),
    });

    expect(response.statusCode).toBe(200);
    for (const value of ['VALEMONT', 'QUINN', 'X12K45P78', 'name-last', 'extraction-sources']) {
      expect(response.body).not.toContain(value);
    }
  });
});
