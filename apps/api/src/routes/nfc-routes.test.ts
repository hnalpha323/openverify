/**
 * Workflow 10C Stage 1a (N) (C207.9, C208.1, C221.7, C221.10; `contracts-10c`): the frozen NFC
 * routes of the flow API, registered as plugins with their contract schemas, built by `api-nfc`
 * (Stage 2) over `services/client-unable.ts` and `services/sandbox-chip.ts`, and in the OpenAPI
 * document (no 501 since integration-10c: both routes are built):
 *
 * - `POST /api/v1/flow/verifications/:id/client-unable` (`{reason}`), under `flow-session`;
 * - `POST /api/v1/flow/verifications/:id/sandbox-chip` (`{challenge-id, scenario}`), sandbox
 *   environments only (the generic 404 of an unknown route anywhere else), under the C12 policy
 *   `flow-sandbox-chip` (10 an hour per inquiry) beside `flow-session`.
 *
 * `GET /api/v1/flow/session` serves an `nfc` step's view through `nfcSessionMembers`
 * (`services/flow-views/nfc.ts`).
 */
import { newId } from '@openverify/contracts';
import {
  createVerification,
  listInquirySessions,
  recordInquirySessionConsent,
} from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const CHALLENGE = 'chc_01M5CK3190XEVBM5ZXA76E1JSM';
const clientUnable = (verificationId: string) =>
  `/api/v1/flow/verifications/${verificationId}/client-unable`;
const sandboxChip = (verificationId: string) =>
  `/api/v1/flow/verifications/${verificationId}/sandbox-chip`;

/** A session that consented, with an `initiated` NFC verification (C52.1's preconditions hold). */
async function nfcSession(): Promise<{
  inquiryId: string;
  sessionToken: string;
  verificationId: string;
}> {
  const { inquiryId, sessionToken } = await openFlowSession(api);
  const { db } = api.database;
  const [session] = (await listInquirySessions(db, api.environmentId, { inquiryId })).items;
  if (session === undefined) {
    throw new Error('the inquiry has no session');
  }
  await recordInquirySessionConsent(db, api.environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verification = await createVerification(db, api.environmentId, {
    id: newId('ver'),
    inquiryId,
    type: 'government_id_nfc',
  });
  return { inquiryId, sessionToken, verificationId: verification.id };
}

const post = (url: string, token: string | null, payload: unknown) =>
  api.app.inject({
    method: 'POST',
    url,
    ...(token === null ? {} : { headers: bearer(token) }),
    payload: payload as Record<string, unknown>,
  });

describe('POST /api/v1/flow/verifications/:id/client-unable (C207.9)', () => {
  it('is built over services/client-unable.ts, under session authentication', async () => {
    const { sessionToken, verificationId } = await nfcSession();

    // The default template has no nfc step, so no report is taken here (api-nfc's rule, tested in
    // `services/client-unable.test.ts`).
    const response = await post(clientUnable(verificationId), sessionToken, {
      reason: 'nfc_unavailable',
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'client_unable_not_allowed' });
    expect(
      (await post(clientUnable(verificationId), null, { reason: 'nfc_unavailable' })).statusCode,
    ).toBe(401);
  });

  it('refuses a body outside the contract (400)', async () => {
    const { sessionToken, verificationId } = await nfcSession();

    for (const body of [{}, { reason: 'no_nfc' }, { reason: 'nfc_unavailable', note: 'x' }]) {
      expect((await post(clientUnable(verificationId), sessionToken, body)).statusCode).toBe(400);
    }
    expect(
      (
        await post(
          '/api/v1/flow/verifications/inq_01M5CK3190XEVBM5ZXA76E1JSM/client-unable',
          sessionToken,
          { reason: 'nfc_unavailable' },
        )
      ).statusCode,
    ).toBe(400);
  });

  it('stays under flow-session alone', async () => {
    const { sessionToken, verificationId } = await nfcSession();
    const before = api.rateLimiter.calls.length;

    await post(clientUnable(verificationId), sessionToken, { reason: 'platform_unsupported' });

    const names = api.rateLimiter.calls.slice(before).map((call) => call.policy.name as string);
    expect(names).toContain('flow-session');
    expect(names).not.toContain('flow-sandbox-chip');
  });
});

describe('POST /api/v1/flow/verifications/:id/sandbox-chip (C208.1)', () => {
  it('is built over services/sandbox-chip.ts in a sandbox environment, under session authentication', async () => {
    const { sessionToken, verificationId } = await nfcSession();

    // This session is the web flow's and its template has no nfc step, so no chip is built here
    // (api-nfc's rules, tested in `services/sandbox-chip.test.ts`).
    const response = await post(sandboxChip(verificationId), sessionToken, {
      'challenge-id': CHALLENGE,
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(
      (await post(sandboxChip(verificationId), null, { 'challenge-id': CHALLENGE })).statusCode,
    ).toBe(401);
  });

  it('refuses a body outside the contract (400)', async () => {
    const { sessionToken, verificationId } = await nfcSession();

    for (const body of [
      {},
      { 'challenge-id': 'ich_01M5CK3190XEVBM5ZXA76E1JSM' },
      { 'challenge-id': CHALLENGE, scenario: 'revoked' },
    ]) {
      expect((await post(sandboxChip(verificationId), sessionToken, body)).statusCode).toBe(400);
    }
  });

  it('counts per inquiry under flow-sandbox-chip, 10 an hour, beside flow-session', async () => {
    const { sessionToken, inquiryId, verificationId } = await nfcSession();
    const before = api.rateLimiter.calls.length;

    await post(sandboxChip(verificationId), sessionToken, { 'challenge-id': CHALLENGE });

    const calls = api.rateLimiter.calls.slice(before);
    const chip = calls.filter((call) => (call.policy.name as string) === 'flow-sandbox-chip');
    expect(chip.map((call) => call.key)).toEqual([inquiryId]);
    expect(chip[0]?.policy).toMatchObject({ limit: 10, windowSeconds: 3600 });
    expect(calls.filter((call) => call.policy.name === 'flow-session')).toHaveLength(1);
  });
});

describe('the sandbox-chip route outside a sandbox environment (C208.1)', () => {
  it('answers the 404 of an unknown route, with no code of its own, before any other check', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const { sessionToken } = await openFlowSession(api, { token: production.token });
    const inject = (route: string) =>
      api.app.inject({
        method: 'POST',
        url: `/api/v1/flow/verifications/ver_01M5CK3190XEVBM5ZXA76E1JSM/${route}`,
        headers: bearer(sessionToken),
        payload: { 'challenge-id': CHALLENGE },
      });

    const known = await inject('sandbox-chip');
    const unknown = await inject('no-such-route');

    expect(known.statusCode).toBe(404);
    const shape = (body: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(body).filter(([key]) => !['instance', 'requestId', 'detail'].includes(key)),
      );
    expect(shape(known.json())).toEqual(shape(unknown.json()));
    expect(known.json<{ detail: string }>().detail).toBe(
      'No route matches POST /api/v1/flow/verifications/ver_01M5CK3190XEVBM5ZXA76E1JSM/sandbox-chip.',
    );
    expect(known.json()).not.toHaveProperty('code');
  });
});

describe('the OpenAPI document (C221.10)', () => {
  it('lists both routes under the flow API, the sandbox one documented as sandbox-only', async () => {
    const document = expectStatus(
      await api.app.inject({ url: '/openapi.json' }),
      200,
    ) as unknown as {
      paths: Record<
        string,
        Record<string, { description?: string; responses: Record<string, unknown> }>
      >;
    };

    const unable = document.paths['/api/v1/flow/verifications/{id}/client-unable']?.post;
    const chip = document.paths['/api/v1/flow/verifications/{id}/sandbox-chip']?.post;
    // Both routes are built: neither documents 501, and both document C52.1's 422 (another type).
    const documented = ['200', '400', '401', '404', '409', '410', '422', '429'];
    expect(Object.keys(unable?.responses ?? {}).sort()).toEqual(documented);
    expect(Object.keys(chip?.responses ?? {}).sort()).toEqual(documented);
    expect(chip?.description).toContain('sandbox environments only');
  });
});
