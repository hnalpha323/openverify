/**
 * Workflow 9A Stage 4 (integration-9a): the inquiry resource and `inquiry.completed` carry the
 * flow attributes the engine fills (C151.8, C151.13), through the hooks api-flow-engine reported
 * missing in the shared `services/inquiries.ts` and `@openverify/contracts`:
 * - `previous-step-name` and `next-step-name` on a single inquiry's read, each `null` without PII
 *   visibility when the step was reached through a sensitive exit (review P15);
 * - `flow-outcome` (PII-free codes) on every read, and as `inquiry.completed`'s `meta`.
 * Every value is synthetic.
 */
import { createApiKey, generateApiKey } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeFlowPosition } from '../flow-engine/testing.js';
import { bearer, expectStatus, TEST_PEPPER } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'served-names', version: 1, name: 'Served names' },
  entry: 'about',
  steps: [
    {
      id: 'about',
      type: 'screen',
      components: [
        { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    {
      id: 'more',
      type: 'screen',
      components: [
        { id: 'city', kind: 'text_input', field: 'city', labelKey: 'more.city' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e1', from: 'about', port: 'next', to: 'more' },
    { id: 'e2', from: 'more', port: 'next', to: 'done' },
  ],
});

const OUTCOME = {
  verificationTypesOnPath: ['government-id'],
  fallbacksTaken: ['id_card'],
  flags: ['flag_for_review:manual_check'],
};
const PUBLIC_OUTCOME = {
  'verification-types-on-path': ['government-id'],
  'fallbacks-taken': ['id_card'],
  flags: ['flag_for_review:manual_check'],
};

async function atMore(): Promise<string> {
  const inquiryId = await storeFlowPosition(api, FLOW, {
    current: 'more',
    exited: [{ stepId: 'about', port: 'next' }],
  });
  await api.database.db.execute(
    sql`update inquiries set flow_previous_step_id = 'about' where id = ${inquiryId}`,
  );
  return inquiryId;
}

async function maskedToken(): Promise<string> {
  const generated = generateApiKey('sandbox', TEST_PEPPER);
  await createApiKey(api.database.db, api.environmentId, {
    id: testId('key'),
    name: 'Masked reader',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: ['inquiries:read'],
    piiMasked: true,
  });
  return generated.token;
}

const read = async (inquiryId: string, token = api.token) =>
  expectStatus(
    await api.app.inject({ url: `/api/v1/inquiries/${inquiryId}`, headers: bearer(token) }),
    200,
  ).data.attributes;

describe('the inquiry serves its flow attributes (C151.8, C151.13)', () => {
  it('names the step left and the step the person is on, with no outcome while the flow goes on', async () => {
    const inquiryId = await atMore();
    expect(await read(inquiryId)).toMatchObject({
      'previous-step-name': 'about',
      'next-step-name': 'more',
      'flow-outcome': null,
    });
  });

  it('hides a step reached through a sensitive exit from a reader without PII visibility', async () => {
    const inquiryId = await atMore();
    await api.database.db.execute(
      sql`update inquiry_flow_steps set sensitive = true
           where inquiry_id = ${inquiryId} and step_id = 'about'`,
    );
    expect(await read(inquiryId, await maskedToken())).toMatchObject({
      'previous-step-name': 'about',
      'next-step-name': null,
    });
    expect(await read(inquiryId)).toMatchObject({ 'next-step-name': 'more' });
  });

  it('serves the flow outcome on a read and in a list', async () => {
    const inquiryId = await atMore();
    await api.database.db.execute(
      sql`update inquiries set flow_outcome = ${JSON.stringify(OUTCOME)}::jsonb where id = ${inquiryId}`,
    );
    expect((await read(inquiryId))['flow-outcome']).toEqual(PUBLIC_OUTCOME);
    const one = expectStatus(
      await api.app.inject({ url: `/api/v1/inquiries/${inquiryId}`, headers: bearer(api.token) }),
      200,
    ) as unknown as { data: { relationships: { 'inquiry-template': { data: { id: string } } } } };
    const templateId = one.data.relationships['inquiry-template'].data.id;
    const list = expectStatus(
      await api.app.inject({
        url: `/api/v1/inquiries?filter[inquiry-template-id]=${templateId}`,
        headers: bearer(api.token),
      }),
      200,
    ) as unknown as { data: { id: string; attributes: Record<string, unknown> }[] };
    const listed = list.data.find((entry) => entry.id === inquiryId);
    expect(listed?.attributes['flow-outcome']).toEqual(PUBLIC_OUTCOME);
  });

  it('carries the flow outcome as inquiry.completed’s meta', async () => {
    const inquiryId = await atMore();
    await api.database.db.execute(
      sql`update inquiries set flow_outcome = ${JSON.stringify(OUTCOME)}::jsonb where id = ${inquiryId}`,
    );
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
        headers: bearer(api.token),
        payload: { meta: { actions: [{ type: 'complete_inquiry' }] } },
      }),
      200,
    );
    const completed = api.events
      .named('inquiry.completed')
      .find((event) => event.payload.data.id === inquiryId);
    expect(completed?.payload.meta).toEqual({ 'flow-outcome': PUBLIC_OUTCOME });
  });
});
