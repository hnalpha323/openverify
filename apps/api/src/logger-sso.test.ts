/**
 * C248.4 (Phase 11, Workflow 11B, `sso-oidc`; verification V13; Stage 1a amendment 30): the request
 * log records the SSO callback without its query string. The identity provider's `code`, `state` and
 * `iss`, the browser binding and the provider id reach no log line: the serializer (`logger.ts`,
 * C93.7) logs the method and the route's pattern only, whatever the answer. Its borrowed edit is this
 * test; no log site of the API logs `request.url` with its query (the stored API log keeps the path
 * without it, `plugins/api-logs.ts`, and never a dashboard route).
 */
import { Writable } from 'node:stream';
import { SSO_BINDING_HEADER } from '@openverify/contracts';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger.js';

const PROVIDER = 'ssop_01JC0000000000000000000001';
const CODE = 'synthetic-authorization-code-canary';
const STATE = 'synthetic-state-canary';
const BINDING = `ovsb_${'C'.repeat(43)}`;
const ISS = 'https://idp.example.com/canary-issuer';

async function logsOf(status: number): Promise<string> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const options = loggerOptions({ level: 'trace', stream });
  if (options === false) {
    throw new Error('logging is on');
  }
  const app = Fastify({ logger: options });
  // A route parameter cannot hold `-` in Fastify (`:provider-id` is `:provider` and a literal
  // `-id`), so the pattern here is the camelCase spelling the transaction files route uses.
  app.get('/api/v1/dashboard/sso/callback/:providerId', async (_request, reply) =>
    reply.code(status).send(status === 201 ? { ok: true } : { code: 'sso_state_invalid' }),
  );
  await app.ready();
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/dashboard/sso/callback/${PROVIDER}?code=${CODE}&state=${STATE}&iss=${encodeURIComponent(ISS)}`,
    headers: { [SSO_BINDING_HEADER]: BINDING },
  });
  expect(response.statusCode).toBe(status);
  await app.close();
  return lines.join('');
}

describe('the request log and the SSO callback (C248.4, V13)', () => {
  it.each([201, 400, 403])('records the callback without its query (%i)', async (status) => {
    const text = await logsOf(status);
    expect(text).toContain('"route":"/api/v1/dashboard/sso/callback/:providerId"');
    for (const secret of [CODE, STATE, BINDING, PROVIDER, 'canary-issuer', '?code=', 'state=']) {
      expect(text).not.toContain(secret);
    }
  });
});
