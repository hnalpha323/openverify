/**
 * C81.2 (V10), C81.3 (H13): an adverse-media report whose screened name keeps no letter or digit
 * once reduced for the GDELT phrase, and a business-adverse-media report whose name is one generic
 * word once its legal form is stripped, are refused at creation with 422 `report_query_invalid`
 * at the name's pointer, so a "no match" is never answered for a search that could not be made. A
 * name that can be screened is created. Synthetic values only.
 */
import { seedReportTemplate } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let personTemplate: string;
let businessTemplate: string;

beforeAll(async () => {
  api = await createTestApi();
  const env = api.environmentId;
  personTemplate = (await seedReportTemplate(api.database.db, env, { reportType: 'adverse-media' }))
    .templateId;
  businessTemplate = (
    await seedReportTemplate(api.database.db, env, { reportType: 'business-adverse-media' })
  ).templateId;
}, 60_000);

afterAll(async () => {
  await api.close();
});

function create(type: 'adverse-media' | 'business-adverse-media', query: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: bearer(api.token),
    payload: {
      data: {
        type: `report/${type}`,
        attributes: {
          'report-template-id': type === 'adverse-media' ? personTemplate : businessTemplate,
          query,
        },
      },
      meta: { 'auto-create-account': false },
    },
  });
}

interface Problem {
  code: string;
  errors?: { pointer?: string }[];
}

describe('POST /reports for the media types (C81.2, C81.3)', () => {
  it('refuses a person name with no letter or digit left at its pointer', async () => {
    const problem = expectStatus(
      await create('adverse-media', { term: '"-" () --' }),
      422,
    ) as unknown as Problem;

    expect(problem.code).toBe('report_query_invalid');
    expect(problem.errors?.map((error) => error.pointer)).toEqual(['/data/attributes/query/term']);
  });

  it('refuses a business name that is one generic word once its legal form is stripped', async () => {
    const problem = expectStatus(
      await create('business-adverse-media', { term: 'Holdings Ltd' }),
      422,
    ) as unknown as Problem;

    expect(problem.code).toBe('report_query_invalid');
    expect(problem.errors?.map((error) => error.pointer)).toEqual(['/data/attributes/query/term']);
  });

  it('creates the reports whose names can be screened', async () => {
    expectStatus(
      await create('adverse-media', { 'name-first': 'Rowan', 'name-last': 'Example' }),
      201,
    );
    expectStatus(
      await create('business-adverse-media', { term: 'Quarrystone Example Holdings Ltd' }),
      201,
    );
  });
});
