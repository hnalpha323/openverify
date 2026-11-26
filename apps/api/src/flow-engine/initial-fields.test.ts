/**
 * C149.4 (Workflow 9A, api-flow-engine): the inquiry-comparison checks compare with a field's
 * initial value (the `fields` of `POST /inquiries`, sealed in `initial_fields` and never changed)
 * when one exists, else its current value, and say which, so a person cannot edit an expected name
 * to match the document they hold. Every value is synthetic.
 */
import { getInquiry } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { comparisonSourceFor } from './initial-fields.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

async function patchFields(inquiryId: string, fields: Record<string, unknown>): Promise<void> {
  expectStatus(
    await api.app.inject({
      method: 'PATCH',
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(api.token),
      payload: { data: { type: 'inquiry', attributes: { fields } } },
    }),
    200,
  );
}

const sourceOf = async (inquiryId: string) => {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (inquiry === null) throw new Error('no inquiry');
  return comparisonSourceFor(api.database.db, inquiry);
};

describe('the comparison source (C149.4)', () => {
  it('takes the initial value of a field set at creation, and the current value of any other', async () => {
    const inquiryId = await createInquiry(api, {
      fields: { name_first: 'Quinn', birthdate: '1990-02-14' },
    });
    await patchFields(inquiryId, { name_first: 'Rowan', name_last: 'Valemont' });

    expect(await sourceOf(inquiryId)).toEqual({
      fields: { name_first: 'Quinn', birthdate: '1990-02-14', name_last: 'Valemont' },
      sources: { name_first: 'initial', birthdate: 'initial', name_last: 'entered' },
    });
  });

  it('reads the current fields as entered when the inquiry was created without any', async () => {
    const inquiryId = await createInquiry(api);
    await patchFields(inquiryId, { name_first: 'Rowan' });

    expect(await sourceOf(inquiryId)).toEqual({
      fields: { name_first: 'Rowan' },
      sources: { name_first: 'entered' },
    });
  });

  it('keeps a field emptied later at its initial value', async () => {
    const inquiryId = await createInquiry(api, { fields: { name_last: 'Valemont' } });
    await patchFields(inquiryId, { name_last: null });

    expect(await sourceOf(inquiryId)).toEqual({
      fields: { name_last: 'Valemont' },
      sources: { name_last: 'initial' },
    });
  });
});
