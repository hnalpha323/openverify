/**
 * C234.1 (Workflow 11A, `api-redeem` checkpoint 1): `POST /api/v1/connect/share-tokens/:id/redeem`
 * answers from the redemption service: a body whose members exclude each other is 422
 * `share_redeem_meta_conflict` (the route's rule, never a validation 400), and a token the caller
 * may not see is the one generic 404, byte-identical. The service's checks in order are
 * `services/connect/redeem.test.ts`'s. Synthetic ids only (rule 9).
 */
import { CONNECT_NOT_FOUND_PROBLEM, newId } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let count = 0;

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
}, 120_000);

afterAll(async () => {
  await api.close();
});

const redeem = (id: string, meta: Record<string, unknown>) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/connect/share-tokens/${id}/redeem`,
    headers: {
      ...bearer(api.token),
      'idempotency-key': `synthetic-redeem-${String((count += 1))}`,
    },
    payload: { meta: { 'destination-consent-record-id': newId('cnsr'), ...meta } },
  });

const withoutInstance = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

describe('POST /connect/share-tokens/:id/redeem (C234.1)', () => {
  it('refuses members that exclude each other with 422 share_redeem_meta_conflict and their pointers', async () => {
    const response = await redeem(newId('cnst'), {
      'account-id': newId('acc'),
      'auto-create-account-reference-id': 'synthetic-reference',
      'auto-create-account-type-id': newId('acctp'),
    });
    expect(response.statusCode, response.body).toBe(422);
    const body = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(body.code).toBe('share_redeem_meta_conflict');
    expect(body.errors.map(({ pointer }) => pointer)).toContain(
      '/meta/auto-create-account-reference-id',
    );
  });

  it('answers a token the caller may not see with the one generic 404', async () => {
    const response = await redeem(newId('cnst'), { 'inquiry-template-id': newId('itmpl') });
    expect(response.statusCode, response.body).toBe(404);
    expect(withoutInstance(response.body)).toEqual(
      withoutInstance(JSON.stringify(CONNECT_NOT_FOUND_PROBLEM)),
    );
  });
});
