/**
 * Workflow 11A Stage 1b (K) (`foundation-11a`): consent records and the `share_consent` step's plumbing.
 *
 * - The server routes `GET/POST /api/v1/connect/consent-records`, `GET /connect/consent-records/:id`
 *   and `POST /connect/consent-records/:id/withdraw` and the flow exits
 *   `POST /api/v1/flow/share-consents/:stepId/accept`, `/decline` and `/withdraw`, frozen with their
 *   contract schemas at 501 until `api-consent` builds them, behind the install switch (the one generic
 *   404 while it is off), and in the OpenAPI document.
 * - The hooks, each a call in a shared file to a stub `api-consent` owns: the inquiry create route's
 *   `meta.share-token-id`, the session's share-consent view and `withdrawable-share-consents`, the
 *   template preview's sample view, Phase 9's publish checks, the redaction cascade and the C16 pass.
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTemplate,
  createTestApi,
  openFlowSession,
  type TestApi,
} from '../test-support/harness.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../contracts/fixtures/api/connect/${name}`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;

const CNSR = 'cnsr_01M5CN0000000000000011A500';
const CNST = 'cnst_01M5CN0000000000000011A200';

const SERVER_ROUTES: { method: 'GET' | 'POST'; url: string; payload?: unknown }[] = [
  { method: 'GET', url: '/api/v1/connect/consent-records' },
  { method: 'GET', url: `/api/v1/connect/consent-records/${CNSR}` },
  {
    method: 'POST',
    url: '/api/v1/connect/consent-records',
    payload: fixture('consent-record-attest-source.json'),
  },
  {
    method: 'POST',
    url: `/api/v1/connect/consent-records/${CNSR}/withdraw`,
    payload: fixture('consent-record-withdraw.json'),
  },
];

const FLOW_EXITS: { url: string; payload: unknown }[] = [
  {
    url: '/api/v1/flow/share-consents/share_back/accept',
    payload: fixture('flow-share-consent-accept.json'),
  },
  { url: '/api/v1/flow/share-consents/share_back/decline', payload: {} },
  { url: '/api/v1/flow/share-consents/share_back/withdraw', payload: {} },
];

let calls = 0;
const call = (
  api: TestApi,
  route: { method: string; url: string; payload?: unknown },
  token: string,
) =>
  api.app.inject({
    method: route.method as 'GET' | 'POST',
    url: route.url,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-k-${String((calls += 1))}` },
    ...(route.payload === undefined ? {} : { payload: route.payload as Record<string, unknown> }),
  });

const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

describe('while Connect is off (C231.10)', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await createTestApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it.each(SERVER_ROUTES)('answers $method $url with the one generic 404', async (route) => {
    const response = await call(api, route, api.token);
    expect(response.statusCode).toBe(404);
    expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('answers each share-consent exit with the one generic 404', async () => {
    const { sessionToken } = await openFlowSession(api);
    for (const exit of FLOW_EXITS) {
      const response = await call(api, { method: 'POST', ...exit }, sessionToken);
      expect(response.statusCode, exit.url).toBe(404);
      expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    }
  });

  it('answers an inquiry created with meta.share-token-id with the one generic 404', async () => {
    const templateId = await createTemplate(api, api.token);
    const response = await call(
      api,
      {
        method: 'POST',
        url: '/api/v1/inquiries',
        payload: {
          data: { attributes: { 'inquiry-template-id': templateId } },
          meta: { 'share-token-id': CNST },
        },
      },
      api.token,
    );
    expect(response.statusCode).toBe(404);
    expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('lists every consent route in the OpenAPI document', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    for (const path of [
      '/api/v1/connect/consent-records',
      '/api/v1/connect/consent-records/{id}',
      '/api/v1/connect/consent-records/{id}/withdraw',
      '/api/v1/flow/share-consents/{stepId}/accept',
      '/api/v1/flow/share-consents/{stepId}/decline',
      '/api/v1/flow/share-consents/{stepId}/withdraw',
    ]) {
      expect(document.paths[path], path).toBeDefined();
    }
  });
});

describe('while Connect is on: frozen at 501 until api-consent builds them', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await createTestApi({ connect: { enabled: true } });
  });
  afterAll(async () => {
    await api.close();
  });

  // api-consent built the four consent-record routes (checkpoints 1 and 2); their own suites are
  // routes/server/connect-consent-records.test.ts and services/connect/withdrawal.test.ts.

  // api-consent checkpoint 3 built the exits: a step the position does not name is refused by the
  // current-step rule (their own suite is routes/flow/share-consents.test.ts).
  it('answers each share-consent exit for a step not at the position 409', async () => {
    const { sessionToken } = await openFlowSession(api);
    for (const exit of FLOW_EXITS) {
      const response = await call(api, { method: 'POST', ...exit }, sessionToken);
      expect(response.statusCode, `${exit.url} ${response.body}`).toBe(409);
    }
  });

  // api-consent checkpoint 5 built the client-side create (its suite: services/connect/client-side.test.ts):
  // a token not inbound to the caller is the one generic 404.
  it('creates an inquiry without meta.share-token-id as today, and answers an unknown token the one 404', async () => {
    const templateId = await createTemplate(api, api.token);
    const plain = await call(
      api,
      {
        method: 'POST',
        url: '/api/v1/inquiries',
        payload: { data: { attributes: { 'inquiry-template-id': templateId } } },
      },
      api.token,
    );
    expect(plain.statusCode).toBe(201);
    const reserved = await call(
      api,
      {
        method: 'POST',
        url: '/api/v1/inquiries',
        payload: {
          data: { attributes: { 'inquiry-template-id': templateId } },
          meta: { 'share-token-id': CNST },
        },
      },
      api.token,
    );
    expect(reserved.statusCode, reserved.body).toBe(404);
    expect(genericOf(reserved.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });
});

describe('the (K) hooks, each one call in a shared file to an api-consent stub', () => {
  it.each([
    ['routes/server/inquiries.ts', 'createInquiryWithShareToken(', 'connect/client-side.js'],
    ['flow-engine/session.ts', 'shareConsentSessionView(', 'flow-views/share-consent.js'],
    ['flow-engine/session.ts', 'withdrawableShareConsents(', 'flow-views/share-consent.js'],
    ['services/templates/preview.ts', 'shareConsentPreviewView(', 'flow-views/share-consent.js'],
    ['services/publish/flow-v2.ts', 'connectPublishChecks(', 'connect/publish-checks.js'],
    [
      'services/redaction.ts',
      'connectRedactionHooks.inquiryRedactedInTx(',
      'connect/redaction-hooks.js',
    ],
    [
      'services/redaction.ts',
      'connectRedactionHooks.accountRedactedInTx(',
      'connect/redaction-hooks.js',
    ],
    [
      'services/transactions/redaction.ts',
      'connectRedactionHooks.transactionRedactedInTx(',
      'connect/redaction-hooks.js',
    ],
    ['services/retention.ts', 'runConnectRetention(', 'connect/retention.js'],
  ])('%s calls %s', (file, callName, module) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(source).toContain(callName);
    expect(source).toContain(module);
  });
  // api-consent built every stub this describe once held to today's behaviour (checkpoints 3 and 4:
  // the views, the publish checks, the redaction hooks and the C16 pass, each with its own suite).
});
