/**
 * C84.1 (F07, Stage 1a amendment 14): an inquiry template version's `report-config`. It is taken on
 * template creation, draft creation and draft updates, stored in `report_config`, served resolved
 * (`resolveReportConfig`) on the version and the template's current version, and checked by the
 * publish rule (`services/publish/report-config.ts`), whose refusal is 422
 * `report_template_not_published` at `/data/attributes/report-config/on-completion/<i>`. Until
 * `api-reports` implements the rule, every entry is refused. Synthetic values only.
 */
import {
  defaultInquiryTemplateAttributes,
  INQUIRY_REPORT_CONFIG_DEFAULTS,
} from '@openverify/contracts';
import { testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload }),
  });

const entry = () => ({ 'report-template-id': testId('rptp') });

async function storedConfig(versionId: string) {
  const rows = await api.database.db.execute(
    sql`select report_config from inquiry_template_versions where id = ${versionId}`,
  );
  return rows.rows[0]?.report_config;
}

describe('C84.1: report-config on inquiry template versions', () => {
  it('takes it on creation, stores it and serves it resolved on the current version', async () => {
    const created = expectStatus(
      await call('POST', '/inquiry-templates', {
        data: {
          type: 'inquiry-template',
          attributes: {
            ...defaultInquiryTemplateAttributes(),
            'report-config': { 'on-report-match': 'needs_review' },
          },
        },
      }),
      201,
    ) as unknown as {
      data: { attributes: { 'current-version': Record<string, unknown> & { id: string } } };
    };

    const current = created.data.attributes['current-version'];
    expect(current['report-config']).toEqual({
      'on-completion': [],
      'on-report-match': 'needs_review',
    });
    expect(await storedConfig(current.id)).toEqual({ 'on-report-match': 'needs_review' });
  });

  it('serves the defaults for a version that sets none', async () => {
    const created = expectStatus(
      await call('POST', '/inquiry-templates', {
        data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
      }),
      201,
    ) as unknown as { data: { attributes: { 'current-version': { id: string } } } };
    const versionId = created.data.attributes['current-version'].id;

    const version = expectStatus(
      await call('GET', `/inquiry-template-versions/${versionId}`),
      200,
    ) as unknown as {
      data: { attributes: Record<string, unknown> };
    };

    expect(version.data.attributes['report-config']).toEqual(INQUIRY_REPORT_CONFIG_DEFAULTS);
  });

  it('refuses a template whose report list names no published report template (422, pointer)', async () => {
    const response = await call('POST', '/inquiry-templates', {
      data: {
        type: 'inquiry-template',
        attributes: {
          ...defaultInquiryTemplateAttributes(),
          'report-config': { 'on-completion': [entry()] },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'report_template_not_published',
      errors: [{ pointer: '/data/attributes/report-config/on-completion/0' }],
    });
  });

  it('keeps it on a draft, replaces it on update, and checks it on publish', async () => {
    const created = expectStatus(
      await call('POST', '/inquiry-templates', {
        data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
      }),
      201,
    ) as unknown as { data: { id: string } };
    const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
    const draft = expectStatus(
      await call('POST', '/inquiry-template-versions', {
        data: {
          type: 'inquiry-template-version',
          attributes: {
            flow,
            'verification-config': verificationConfig,
            'inquiry-template-id': created.data.id,
            'report-config': { 'on-completion': [entry()] },
          },
        },
      }),
      201,
    ) as unknown as { data: { id: string; attributes: Record<string, unknown> } };
    expect(draft.data.attributes['report-config']).toMatchObject({
      'on-completion': [{ 'query-source': 'inquiry' }],
    });

    const updated = expectStatus(
      await call('PATCH', `/inquiry-template-versions/${draft.data.id}`, {
        data: {
          type: 'inquiry-template-version',
          attributes: { 'report-config': { 'on-completion': [entry(), entry()] } },
        },
      }),
      200,
    ) as unknown as { data: { attributes: { 'report-config': { 'on-completion': unknown[] } } } };
    expect(updated.data.attributes['report-config']['on-completion']).toHaveLength(2);

    const published = await call('POST', `/inquiry-template-versions/${draft.data.id}/publish`, {
      meta: {},
    });
    expect(published.statusCode).toBe(422);
    expect(published.json()).toMatchObject({
      code: 'report_template_not_published',
      errors: [
        { pointer: '/data/attributes/report-config/on-completion/0' },
        { pointer: '/data/attributes/report-config/on-completion/1' },
      ],
    });
  });
});
