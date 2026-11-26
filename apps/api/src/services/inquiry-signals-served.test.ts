/**
 * C90.5, C90.8 (Workflow 7A Stage 1b (S); H23): every inquiry read and webhook carries `signals`
 * and `signal-details`: `[]` and `{ computed-at: null }` until the job froze them, the stored
 * values after. With `expose-signals` off, the server API and the webhooks serve `[]` and only
 * `computed-at`; the console still shows the values. The stored values here are synthetic and
 * written as the job would write them.
 */
import { updateEnvironmentSettings } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const COMPUTED_AT = '2026-10-30T00:00:00.000Z';
const SIGNALS = [{ name: 'inquiry/tor_detected', value: false }];
/** C99.4: with no screening row the stored signals are served with the count, `null`. */
const SERVED = [...SIGNALS, { name: 'inquiry/list_match_count', value: null }];
const DETAILS = {
  'computed-at': COMPUTED_AT,
  'inquiry/tor_detected': {
    tier: 'R',
    stage: 'ga',
    version: 1,
    'null-reason': null,
    reasons: [],
    'computed-at': COMPUTED_AT,
  },
};

async function computed(): Promise<string> {
  const id = await createInquiry(api, {});
  await api.database.client.query(
    `update inquiries set status = 'completed', signals = $2, signal_details = $3 where id = $1`,
    [id, JSON.stringify(SIGNALS), JSON.stringify(DETAILS)],
  );
  return id;
}

const getInquiry = (id: string) =>
  api.app.inject({ url: `/api/v1/inquiries/${id}`, headers: bearer(api.token) });

type Attributes = Record<string, unknown>;
const attributesOf = (response: Awaited<ReturnType<typeof getInquiry>>): Attributes =>
  (expectStatus(response, 200) as unknown as { data: { attributes: Attributes } }).data.attributes;

describe('the inquiry serves its signals (C90.5)', () => {
  it('as [] and computed-at null before the job ran', async () => {
    const id = await createInquiry(api, {});

    expect(attributesOf(await getInquiry(id))).toMatchObject({
      signals: [],
      'signal-details': { 'computed-at': null },
    });
  });

  it('as stored once computed, on the fetch, the list and the webhook payloads', async () => {
    const id = await computed();

    expect(attributesOf(await getInquiry(id))).toMatchObject({
      signals: SERVED,
      'signal-details': DETAILS,
    });
    const list = expectStatus(
      await api.app.inject({ url: '/api/v1/inquiries?page[size]=100', headers: bearer(api.token) }),
      200,
    ) as unknown as { data: { id: string; attributes: Attributes }[] };
    expect(list.data.find((inquiry) => inquiry.id === id)?.attributes.signals).toEqual(SERVED);

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${id}/approve`,
        headers: bearer(api.token),
      }),
      200,
    );
    const event = api.events.events.find(
      (staged) => staged.name === 'inquiry.approved' && staged.payload.data.id === id,
    );
    expect((event?.payload.data as { attributes: Attributes }).attributes.signals).toEqual(SERVED);
  });
});

describe('expose-signals off (C90.8)', () => {
  it('serves [] and computed-at only on the API and in webhooks', async () => {
    const id = await computed();
    await updateEnvironmentSettings(api.database.db, api.environmentId, {
      'expose-signals': false,
    });

    try {
      expect(attributesOf(await getInquiry(id))).toMatchObject({
        signals: [],
        'signal-details': { 'computed-at': COMPUTED_AT },
      });
      expect(attributesOf(await getInquiry(id))['signal-details']).toEqual({
        'computed-at': COMPUTED_AT,
      });
      const list = expectStatus(
        await api.app.inject({
          url: '/api/v1/inquiries?page[size]=100',
          headers: bearer(api.token),
        }),
        200,
      ) as unknown as { data: { id: string; attributes: Attributes }[] };
      expect(list.data.find((inquiry) => inquiry.id === id)?.attributes.signals).toEqual([]);

      expectStatus(
        await api.app.inject({
          method: 'POST',
          url: `/api/v1/inquiries/${id}/approve`,
          headers: bearer(api.token),
        }),
        200,
      );
      const event = api.events.events.find(
        (staged) => staged.name === 'inquiry.approved' && staged.payload.data.id === id,
      );
      expect((event?.payload.data as { attributes: Attributes }).attributes).toMatchObject({
        signals: [],
        'signal-details': { 'computed-at': COMPUTED_AT },
      });
    } finally {
      await updateEnvironmentSettings(api.database.db, api.environmentId, {
        'expose-signals': true,
      });
    }
  });
});
