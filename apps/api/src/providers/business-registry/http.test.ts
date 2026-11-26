/**
 * C54.6, C61.2: what a KYB client's JSON request answers, against `MockAgent` with synthetic
 * answers: the JSON, a 404 as not found, 429 and 5xx as failures a retry may cure, a redirect as a
 * refusal that is never followed, and every other failure as a `ProviderError` whose code names the
 * client and the failure without the URL or its query. Through the real outbound client, the host
 * is resolved by the vetted lookup and a private answer is refused.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createOutboundHttp } from '../../http/index.js';
import { ProviderError } from '../errors.js';
import { requestJson } from './http.js';
import { createMockOutbound, jsonHeaders, type MockOutbound } from './testing.js';

const ORIGIN = 'https://registry.example.test';
const URL_WITH_QUERY = `${ORIGIN}/records?filter=Synthetic%20Widgets%20Ltd`;

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function clientOf(contentTypes = ['application/json']) {
  outbound = createMockOutbound();
  return {
    pool: outbound.agent.get(ORIGIN),
    client: outbound.client({ name: 'registry', contentTypes }),
  };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProviderError)) {
    throw new Error(`expected a ProviderError, got ${String(error)}`);
  }
  expect(error.message).not.toContain('example.test');
  expect(error.message).not.toContain('Synthetic');
  return error;
}

describe('requestJson (C61.2)', () => {
  it('answers the JSON of a 2xx answer of an accepted type', async () => {
    const { pool, client } = clientOf(['application/vnd.api+json']);
    pool
      .intercept({ path: '/records?filter=Synthetic%20Widgets%20Ltd', method: 'GET' })
      .reply(200, { data: [{ id: 'synthetic' }] }, jsonHeaders('application/vnd.api+json'));

    expect(await requestJson(client, { method: 'GET', url: URL_WITH_QUERY }, 'registry')).toEqual({
      found: true,
      json: { data: [{ id: 'synthetic' }] },
    });
  });

  it('answers a 404 as not found', async () => {
    const { pool, client } = clientOf();
    pool.intercept({ path: '/records/unknown', method: 'GET' }).reply(404, '');

    expect(
      await requestJson(client, { method: 'GET', url: `${ORIGIN}/records/unknown` }, 'registry'),
    ).toEqual({ found: false });
  });

  it.each([
    [429, 'registry_rate_limited', true],
    [500, 'registry_unavailable', true],
    [503, 'registry_unavailable', true],
    [401, 'registry_unauthorized', false],
    [403, 'registry_unauthorized', false],
    [400, 'registry_rejected', false],
    [422, 'registry_rejected', false],
  ])('answers a %i as %s (retryable: %s)', async (status, code, retryable) => {
    const { pool, client } = clientOf();
    pool.intercept({ path: /^\/records/, method: 'GET' }).reply(status, 'a body never read');

    const error = await failure(
      requestJson(client, { method: 'GET', url: URL_WITH_QUERY }, 'registry'),
    );

    expect(error).toMatchObject({ code, retryable });
  });

  it('refuses a redirect and never follows it', async () => {
    const { pool, client } = clientOf();
    pool
      .intercept({ path: /^\/records/, method: 'GET' })
      .reply(302, '', { headers: { location: `${ORIGIN}/elsewhere` } });

    const error = await failure(
      requestJson(client, { method: 'GET', url: URL_WITH_QUERY }, 'registry'),
    );

    expect(error).toMatchObject({ code: 'registry_redirect', retryable: false });
    expect(outbound?.requests).toHaveLength(1);
  });

  it('refuses a body that is not JSON, and a type the client does not accept', async () => {
    const { pool, client } = clientOf();
    pool.intercept({ path: '/records/a', method: 'GET' }).reply(200, '<html>', jsonHeaders());
    pool
      .intercept({ path: '/records/b', method: 'GET' })
      .reply(200, '{}', jsonHeaders('text/html'));

    expect(
      await failure(requestJson(client, { method: 'GET', url: `${ORIGIN}/records/a` }, 'registry')),
    ).toMatchObject({ code: 'registry_malformed', retryable: false });
    expect(
      await failure(requestJson(client, { method: 'GET', url: `${ORIGIN}/records/b` }, 'registry')),
    ).toMatchObject({ code: 'registry_content_type', retryable: false });
  });

  it('passes the outbound client’s failures on with their retry rule', async () => {
    const outboundHttp = createOutboundHttp({
      resolve: () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })),
    });
    const client = outboundHttp.client({ name: 'registry', contentTypes: ['application/json'] });

    const error = await failure(
      requestJson(client, { method: 'GET', url: URL_WITH_QUERY }, 'registry'),
    );

    expect(error.code.startsWith('registry_')).toBe(true);
    expect(error.retryable).toBe(true);
    await outboundHttp.close();
  });

  it('resolves the host through the vetted lookup of the real client and refuses a private answer', async () => {
    const resolved: string[] = [];
    const outboundHttp = createOutboundHttp({
      resolve: (hostname) => {
        resolved.push(hostname);
        return Promise.resolve([{ address: '10.0.0.7', family: 4 }]);
      },
    });
    const client = outboundHttp.client({ name: 'registry', contentTypes: ['application/json'] });

    const error = await failure(
      requestJson(client, { method: 'GET', url: URL_WITH_QUERY }, 'registry'),
    );

    expect(resolved).toEqual(['registry.example.test']);
    expect(error).toMatchObject({ code: 'registry_blocked', retryable: false });
    await outboundHttp.close();
  });
});
