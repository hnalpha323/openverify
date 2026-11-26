import { describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN, VERIFICATION_IDS } from '../testing/flow-fixtures';
import { createFlowApiClient, FlowApiError } from './flow-api-client';
import { withFinalOutcomes } from './final-outcome';

// C207.9, C207.10 (Workflow 10C, api-nfc): the web flow's client-unable call.

const BASE_URL = 'https://api.example.com';
const ID = VERIFICATION_IDS.selfie;

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

describe('FlowApiClient.reportClientUnable (C207.9)', () => {
  it('posts the reason to the verification’s client-unable route, under the session token', async () => {
    const { client, calls } = clientAnswering(200, { 'verification-id': ID, status: 'canceled' });

    const answer = await client.reportClientUnable(ID, 'platform_unsupported');

    expect(answer).toEqual({ 'verification-id': ID, status: 'canceled' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/v1/flow/verifications/${ID}/client-unable`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ reason: 'platform_unsupported' }));
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(
      `Bearer ${SESSION_TOKEN}`,
    );
  });

  it('refuses an answer outside the contract', async () => {
    const { client } = clientAnswering(200, { 'verification-id': ID, status: 'passed' });

    await expect(client.reportClientUnable(ID, 'platform_unsupported')).rejects.toBeInstanceOf(
      FlowApiError,
    );
  });

  it('rejects with the server’s refusal (409 client_unable_not_allowed)', async () => {
    const { client } = clientAnswering(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'The verification cannot be reported as unreadable by this client now.',
      code: 'client_unable_not_allowed',
    });

    await expect(client.reportClientUnable(ID, 'platform_unsupported')).rejects.toMatchObject({
      kind: 'http',
      status: 409,
    });
  });

  it('passes through the final-outcome guard with every argument', async () => {
    const { client, calls } = clientAnswering(200, { 'verification-id': ID, status: 'canceled' });
    const onFinal = vi.fn();

    await withFinalOutcomes(client, onFinal).reportClientUnable(ID, 'platform_unsupported');

    expect(calls[0]?.url).toContain(`/verifications/${ID}/client-unable`);
    expect(onFinal).not.toHaveBeenCalled();
  });
});
