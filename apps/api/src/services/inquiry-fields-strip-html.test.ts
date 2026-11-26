/**
 * C149.5 (Workflow 9A Stage 4, integration-9a): a field declared `strip-html` is stored without its
 * tags on every write path, because each caller writes what `validateInquiryFieldsWrite` answers
 * (api-templates' contract deviation: the callers wrote what they passed). Every value is
 * synthetic.
 */
import { getInquiry } from '@openverify/db';
import { flowV2Schema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeFlowPosition } from '../flow-engine/testing.js';
import { bearer, createInquiry, expectStatus, resumeInquiry } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const SCHEMAS = [
  { key: 'bio', type: 'string', label: 'About', pii: true, 'strip-html': true },
  { key: 'nickname', type: 'string', label: 'Nickname', pii: true },
];

/** Gives the version `inquiryId` pinned the field schemas above. */
async function declareFields(inquiryId: string): Promise<void> {
  await api.database.db.execute(
    sql`update inquiry_template_versions set field_schemas = ${JSON.stringify(SCHEMAS)}::jsonb
         where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
  );
}

const storedFields = async (inquiryId: string) =>
  (await getInquiry(api.database.db, api.environmentId, inquiryId))?.fields;

describe('strip-html on every write path (C149.5)', () => {
  it('stores a PATCH without the tags', async () => {
    const inquiryId = await createInquiry(api);
    await declareFields(inquiryId);
    expectStatus(
      await api.app.inject({
        method: 'PATCH',
        url: `/api/v1/inquiries/${inquiryId}`,
        headers: bearer(api.token),
        payload: { data: { attributes: { fields: { bio: '<b>Synthetic</b> bio' } } } },
      }),
      200,
    );
    expect(await storedFields(inquiryId)).toMatchObject({ bio: 'Synthetic bio' });
  });

  it('stores a screen submission without the tags', async () => {
    const flow = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'strip-html', version: 1, name: 'Strip HTML' },
      entry: 'about',
      steps: [
        {
          id: 'about',
          type: 'screen',
          components: [
            { id: 'bio', kind: 'text_area', field: 'bio', labelKey: 'about.bio.label' },
            { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
          ],
        },
        { id: 'done', type: 'completion' },
      ],
      edges: [{ id: 'e1', from: 'about', port: 'next', to: 'done' }],
    });
    const inquiryId = await storeFlowPosition(api, flow, { current: 'about', exited: [] });
    await declareFields(inquiryId);
    const token = await resumeInquiry(api, inquiryId);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/screens/about/submit',
        headers: bearer(token),
        payload: { values: { bio: 'An <i>entered</i> bio' } },
      }),
      200,
    );
    expect(await storedFields(inquiryId)).toMatchObject({ bio: 'An entered bio' });
  });
});
