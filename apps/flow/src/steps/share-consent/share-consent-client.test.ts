/**
 * C238.4, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the web flow's three share-consent
 * exits on `FlowApiClient`: each posts to its route under the session token, sends a body the
 * contract accepts, answers the session the server returned, and refuses a step id outside its
 * pattern before anything reaches a URL. A session-ending answer ends the flow through the
 * final-outcome guard, as any call's does.
 */
import { flowSessionResponseSchema } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { withFinalOutcomes } from '../../api/final-outcome';
import { createFlowApiClient, FlowApiError } from '../../api/flow-api-client';
import { SESSION_TOKEN } from '../../testing/flow-fixtures';
import sessionFixture from '../../../../../contracts/fixtures/api/flow-session-share-consent.json';

const BASE_URL = 'https://api.example.com';
const SESSION = flowSessionResponseSchema.parse(sessionFixture);
const ACCEPT = {
  'text-sha256': 'a'.repeat(64),
  'biometric-text-sha256': 'b'.repeat(64),
  'explicit-biometric': true,
};

function clientAnswering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': status < 400 ? 'application/json' : 'application/problem+json',
        },
      }),
    );
  });
  return {
    client: createFlowApiClient({
      baseUrl: BASE_URL,
      sessionToken: SESSION_TOKEN,
      fetch: fetchStub,
    }),
    calls,
  };
}

const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe('the share-consent exits (C238.4, C237.6)', () => {
  it('accept posts the digests and the tick to the step’s accept route and answers the session', async () => {
    const { client, calls } = clientAnswering(200, SESSION);

    const session = await client.acceptShareConsent('share_back', ACCEPT);

    expect(session).toEqual(SESSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/v1/flow/share-consents/share_back/accept`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(headerOf(calls[0]?.init ?? {}, 'authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(ACCEPT);
  });

  it('decline and withdraw post an empty body to their routes', async () => {
    const decline = clientAnswering(200, SESSION);
    await decline.client.declineShareConsent('share_back');
    expect(decline.calls[0]?.url).toBe(`${BASE_URL}/api/v1/flow/share-consents/share_back/decline`);
    expect(JSON.parse(decline.calls[0]?.init.body as string)).toEqual({});

    const withdraw = clientAnswering(200, SESSION);
    await withdraw.client.withdrawShareConsent('share-consent-0');
    expect(withdraw.calls[0]?.url).toBe(
      `${BASE_URL}/api/v1/flow/share-consents/share-consent-0/withdraw`,
    );
    expect(JSON.parse(withdraw.calls[0]?.init.body as string)).toEqual({});
  });

  it('refuses a step id outside its pattern before anything is sent', async () => {
    const { client, calls } = clientAnswering(200, SESSION);

    await expect(client.acceptShareConsent('../consent', ACCEPT)).rejects.toThrow(TypeError);
    await expect(client.declineShareConsent('a/b')).rejects.toThrow(TypeError);
    await expect(client.withdrawShareConsent('Share')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  it('refuses a body the contract does not accept before anything is sent', async () => {
    const { client, calls } = clientAnswering(200, SESSION);

    await expect(
      client.acceptShareConsent('share_back', { ...ACCEPT, 'text-sha256': 'not a digest' }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('reports the server’s refusal as a FlowApiError with its problem', async () => {
    const { client } = clientAnswering(422, {
      type: 'https://docs.openverify.dev/problems/consent_text_mismatch',
      title: 'Unprocessable Content',
      status: 422,
      code: 'consent_text_mismatch',
      detail: 'The texts sent are not the texts shown.',
      instance: '/api/v1/flow/share-consents/share_back/accept',
      requestId: 'req-1',
    });

    const refusal = await client.acceptShareConsent('share_back', ACCEPT).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(FlowApiError);
    expect((refusal as FlowApiError).status).toBe(422);
  });

  it('ends the flow on a session-ending answer, through the final-outcome guard', async () => {
    const { client } = clientAnswering(401, {
      type: 'https://docs.openverify.dev/problems/session_expired',
      title: 'Unauthorized',
      status: 401,
      code: 'session_expired',
      detail: 'The session expired.',
      instance: '/api/v1/flow/share-consents/share_back/withdraw',
      requestId: 'req-2',
    });
    const outcomes: string[] = [];
    const guarded = withFinalOutcomes(client, (outcome) => outcomes.push(outcome));

    await expect(guarded.withdrawShareConsent('share_back')).rejects.toBeInstanceOf(FlowApiError);
    await expect(guarded.declineShareConsent('share_back')).rejects.toBeInstanceOf(FlowApiError);
    await expect(guarded.acceptShareConsent('share_back', ACCEPT)).rejects.toBeInstanceOf(
      FlowApiError,
    );
    expect(outcomes).toEqual(['session-expired', 'session-expired', 'session-expired']);
  });
});
