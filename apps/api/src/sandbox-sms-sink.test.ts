/**
 * C55.11 wiring: the sandbox SMS sink is served only by a process that binds the sandbox SMS
 * sender and is not in production mode; a production environment's key gets 404, a key without
 * `sandbox:read` 403; the number never reaches a URL or the request log line.
 */
import { Writable } from 'node:stream';
import { API_SCOPES } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createProviderBindings } from './providers/index.js';
import { bearer, createTestApi, type TestApi } from './test-support/harness.js';

const SINK = '/api/v1/sandbox/sms-messages/search';
const NUMBER = '+15555550123';
const sandboxSms = () => createProviderBindings({ sandbox: { sms: 'sandbox' }, production: {} });

let bound: TestApi;
let unbound: TestApi;

beforeAll(async () => {
  bound = await createTestApi({ providers: sandboxSms() });
  // Workflow 5C review K9: the harness binds the sandbox sender by default; this one has none.
  unbound = await createTestApi({ providers: { sandbox: {}, production: {} } });
});

afterAll(async () => {
  await bound.close();
  await unbound.close();
});

const paths = async (app: ReturnType<typeof buildApp>) =>
  Object.keys((await app.inject({ url: '/openapi.json' })).json<{ paths: object }>().paths);

function search(api: TestApi, token: string) {
  return api.app.inject({
    method: 'POST',
    url: SINK,
    headers: bearer(token),
    payload: { 'phone-number': NUMBER },
  });
}

describe('the sandbox SMS sink (C55.11)', () => {
  it('is served with the sandbox sender bound, outside production mode', async () => {
    expect(await paths(bound.app)).toContain(SINK);
    expect(await paths(unbound.app)).not.toContain(SINK);
    expect((await search(unbound, unbound.token)).statusCode).toBe(404);
  });

  it('is absent from a production-mode API, even with the sandbox sender bound', async () => {
    const production = buildApp({
      lookupApiKey: () => Promise.resolve(null),
      logger: false,
      mode: 'production',
      api: bound.deps,
    });

    expect(await paths(production)).not.toContain(SINK);
    await production.close();
  });

  it('answers 404 to a production environment key and 403 without sandbox:read', async () => {
    const production = await bound.newTenant({ kind: 'production' });
    const noScope = await bound.newApiKey(bound.environmentId, {
      scopes: API_SCOPES.filter((scope) => scope !== 'sandbox:read'),
    });

    expect((await search(bound, production.token)).statusCode).toBe(404);
    expect((await search(bound, noScope)).statusCode).toBe(403);
  });

  it('takes the number in the body, so no request log line carries it', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const logged = await createTestApi({ providers: sandboxSms() });
    const app = buildApp({
      lookupApiKey: () => Promise.resolve(null),
      logger: { level: 'trace', stream },
      mode: 'test',
      api: logged.deps,
    });

    await app.inject({
      method: 'POST',
      url: SINK,
      headers: bearer(logged.token),
      payload: { 'phone-number': NUMBER },
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(NUMBER.slice(1));
    await app.close();
    await logged.close();
  });
});
