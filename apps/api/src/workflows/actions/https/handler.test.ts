/**
 * C124, C125.3-C125.5: Make HTTPS Request from claim to completion on a real schema. The outbound
 * client is a recording fake, so no test leaves the process; `policy-client.test.ts` proves what the
 * client does with what this action hands it. Every value is a synthetic canary.
 */
import { randomBytes } from 'node:crypto';
import {
  verifyWebhookSignature,
  verifyWorkflowRequestSignature,
  WebhookSignatureError,
} from '@openverify/node';
import {
  getWorkflowRun,
  listAllWorkflowRunSteps,
  openWorkflowStepValues,
  updateEnvironmentSettings,
} from '@openverify/db';
import { seedWorkflowSecret, seedWorkflowSecretValue } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpPolicyClientOptions,
  type OutboundHttpPolicyRequest,
  type OutboundHttpPolicyResponse,
} from '../../../http/index.js';
import type { RateLimiter } from '../../../ports.js';
import {
  createAllowAllRateLimiter,
  createInMemoryKeyValueCache,
  createRecordingAuditLogger,
  createDenyRateLimiter,
  fixedClock,
  type RecordingAuditLogger,
} from '../../../test-support/fakes.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  runOf,
  start,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { MAKE_HTTPS_REQUEST_HANDLER } from './handler.js';

let harness: EngineHarness;
let requests: OutboundHttpPolicyRequest[] = [];
let clients: OutboundHttpPolicyClientOptions[] = [];
let answer: (request: OutboundHttpPolicyRequest) => Promise<OutboundHttpPolicyResponse>;
let audit: RecordingAuditLogger;
const NOW = new Date('2026-11-02T12:00:00.000Z');
const CANARY = 'canary-synthetic-secret-value';

const ok = (body: unknown, contentType = 'application/json'): OutboundHttpPolicyResponse => ({
  status: 200,
  contentType,
  body: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { 'content-type': contentType },
});

const status = (
  code: number,
  headers: Record<string, string> = {},
  body = '',
): OutboundHttpPolicyResponse => ({
  status: code,
  contentType: null,
  body: new TextEncoder().encode(body),
  headers,
});

const outbound: OutboundHttp = {
  client: () => {
    throw new Error('the action uses a policy client');
  },
  policyClient(options) {
    clients.push(options);
    return {
      request(request) {
        requests.push(request);
        return answer(request);
      },
      close: () => Promise.resolve(),
    };
  },
  close: () => Promise.resolve(),
};

function use(rateLimiter: RateLimiter): void {
  Object.assign(harness.deps.services, { rateLimiter });
}

beforeAll(async () => {
  harness = await createEngineHarness([MAKE_HTTPS_REQUEST_HANDLER]);
  audit = createRecordingAuditLogger();
  const clock = fixedClock(NOW);
  Object.assign(harness.deps.services, {
    audit,
    clock,
    outboundHttp: outbound,
    rateLimiter: createAllowAllRateLimiter(clock),
    cache: createInMemoryKeyValueCache(clock),
    blindIndexKey: randomBytes(32),
  });
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  // A retry a test left scheduled is that test's, and plays no part in the next.
  harness.steps.jobs.length = 0;
  requests = [];
  answer = () => Promise.resolve(ok({ ok: true }));
  use(createAllowAllRateLimiter(fixedClock(NOW)));
});

let counter = 0;

async function secretWith(
  options: {
    value?: string;
    previousValue?: string;
    allowedHosts?: readonly string[];
    placements?: { headers: string[]; 'body-pointers': string[] };
  } = {},
): Promise<string> {
  counter += 1;
  const key = `crm_token_${String(counter)}`;
  const { id } = await seedWorkflowSecret(harness.db, harness.organizationId, {
    key,
    allowedHosts: options.allowedHosts ?? ['api.example.com'],
  });
  await seedWorkflowSecretValue(harness.db, {
    organizationId: harness.organizationId,
    environmentId: harness.environmentId,
    secretId: id,
    value: options.value ?? CANARY,
    ...(options.previousValue === undefined ? {} : { previousValue: options.previousValue }),
  });
  if (options.placements !== undefined) {
    await harness.db.execute(sqlPlacements(id, options.placements));
  }
  return key;
}

function sqlPlacements(id: string, placements: object) {
  return sql`update workflow_secrets set allowed_placements = ${JSON.stringify(placements)}::jsonb
             where id = ${id}`;
}

const request = (config: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  action(
    'call',
    'make_https_request',
    { method: 'GET', url: 'https://api.example.com/v1', ...config },
    more,
  );

async function run(config: Record<string, unknown>, more: Record<string, unknown> = {}) {
  const id = await start(harness, chain([request(config, more)]), {
    grant: { scopes: [], pii: true },
  });
  await drain(harness);
  const row = await runOf(harness, id);
  const step = await stepOf(harness, id, 'call');
  return { id, row, step, output: openWorkflowStepValues(step).output ?? {} };
}

const sent = (index = 0): OutboundHttpPolicyRequest => {
  const found = requests[index];
  if (found === undefined) {
    throw new Error('no request went out');
  }
  return found;
};

describe('a request', () => {
  it('goes out with its method, URL, headers and JSON body', async () => {
    const { step, output } = await run({
      method: 'POST',
      url: 'https://api.example.com/v1/{{ trigger.id }}?status={{ trigger.status }}',
      headers: [{ name: 'x-tenant', value: 'acme-{{ trigger.status }}' }],
      body: { id: '{{ trigger.id }}', nested: { status: '{{ trigger.status }}' } },
    });

    expect(step.status).toBe('succeeded');
    expect(sent()).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/v1/inq_01M5CK16P0D13FXHZSS4TCFBVH?status=completed',
      timeoutMs: 10_000,
    });
    expect(sent().headers).toMatchObject({
      'x-tenant': 'acme-completed',
      'content-type': 'application/json',
      'accept-encoding': 'identity',
    });
    expect(JSON.parse(sent().body as string)).toEqual({
      id: 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
      nested: { status: 'completed' },
    });
    expect(output).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });

  it('percent-encodes what a template puts in a path or a query', async () => {
    const id = await start(
      harness,
      chain([
        request({ url: 'https://api.example.com/v1/{{ inputs.value }}?q={{ inputs.value }}' }),
      ]),
      { inputs: { value: 'a/b?c=d&e' }, grant: { scopes: [], pii: true } },
    );
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect(sent().url).toBe('https://api.example.com/v1/a%2Fb%3Fc%3Dd%26e?q=a%2Fb%3Fc%3Dd%26e');
  });

  it('carries its effect key and its run, on every attempt alike', async () => {
    const { id } = await run({});

    expect(sent().headers).toMatchObject({
      'idempotency-key': `${id}/call/`,
      'openverify-workflow-run': id,
    });
  });

  it('builds a client that may reach 443 and the environment’s ports, and no other', async () => {
    clients = [];
    await updateEnvironmentSettings(harness.db, harness.environmentId, {
      'workflow-http-ports': [8443],
    });

    await run({});

    expect(clients.at(-1)?.portPolicy.allowed).toEqual([443, 8443]);
    await updateEnvironmentSettings(harness.db, harness.environmentId, {
      'workflow-http-ports': [],
    });
  });

  it('stops at its own timeout', async () => {
    await run({ 'timeout-seconds': 3 });

    expect(sent().timeoutMs).toBe(3_000);
  });
});

describe('the host allowlist (C124.3)', () => {
  const allow = (hosts: string[] | null) =>
    updateEnvironmentSettings(harness.db, harness.environmentId, { 'workflow-http-hosts': hosts });

  it('is off by default', async () => {
    const { step } = await run({});

    expect(step.status).toBe('succeeded');
  });

  it('refuses a host off the list, sending nothing', async () => {
    await allow(['other.example.com']);

    const { step, row } = await run({});

    expect(step.errorCode).toBe('destination_refused');
    expect(row.status).toBe('errored');
    expect(requests).toEqual([]);
    await allow(null);
  });

  it.each(['API.example.com', 'api.example.com.'])(
    'reads %s as the listed host',
    async (written) => {
      await allow(['api.example.com']);

      const { step } = await run({ url: `https://${written}/v1` });

      expect(step.status).toBe('succeeded');
      await allow(null);
    },
  );

  it('refuses a suffix-extended host', async () => {
    await allow(['api.example.com']);

    const { step } = await run({ url: 'https://api.example.com.evil.example/v1' });

    expect(step.errorCode).toBe('destination_refused');
    await allow(null);
  });
});

describe('secrets (C125.3, C125.4, C125.5)', () => {
  it('places a secret in its allowed header and stores only the template', async () => {
    const key = await secretWith();

    const { step } = await run({
      headers: [{ name: 'Authorization', value: `Bearer {{secrets.${key}}}` }],
    });

    expect(step.status).toBe('succeeded');
    expect(sent().headers?.Authorization).toBe(`Bearer ${CANARY}`);
    const { input, output } = openWorkflowStepValues(step);
    expect(JSON.stringify(input)).toContain(`{{secrets.${key}}}`);
    expect(JSON.stringify([input, output])).not.toContain(CANARY);
  });

  it('places a secret at an allowed body pointer', async () => {
    const key = await secretWith({
      placements: { headers: [], 'body-pointers': ['/credentials/token'] },
    });

    await run({ method: 'POST', body: { credentials: { token: `{{secrets.${key}}}` } } });

    expect(JSON.parse(sent().body as string)).toEqual({ credentials: { token: CANARY } });
  });

  it.each([
    [
      'another header',
      (key: string) => ({ headers: [{ name: 'x-other', value: `{{secrets.${key}}}` }] }),
    ],
    [
      'a body with no pointer allowed',
      (key: string) => ({ method: 'POST', body: { token: `{{secrets.${key}}}` } }),
    ],
  ])('refuses %s, sending nothing', async (_name, config) => {
    const key = await secretWith();

    const { step } = await run(config(key));

    expect(step.errorCode).toBe('secret_placement_refused');
    expect(requests).toEqual([]);
  });

  it('refuses a host the secret is not bound to', async () => {
    const key = await secretWith({ allowedHosts: ['other.example.com'] });

    const { step } = await run({
      headers: [{ name: 'authorization', value: `{{secrets.${key}}}` }],
    });

    expect(step.errorCode).toBe('secret_placement_refused');
    expect(requests).toEqual([]);
  });

  it('refuses a suffix-extended host for a bound secret', async () => {
    const key = await secretWith();

    const { step } = await run({
      url: 'https://api.example.com.evil.example/v1',
      headers: [{ name: 'authorization', value: `{{secrets.${key}}}` }],
    });

    expect(step.errorCode).toBe('secret_placement_refused');
  });

  it('refuses a secret placed twice in one request', async () => {
    const key = await secretWith({
      placements: { headers: ['authorization', 'x-token'], 'body-pointers': [] },
    });

    const { step } = await run({
      headers: [
        { name: 'authorization', value: `{{secrets.${key}}}` },
        { name: 'x-token', value: `{{secrets.${key}}}` },
      ],
    });

    expect(step.errorCode).toBe('secret_placement_refused');
  });

  it('refuses a key with no value in this environment', async () => {
    const { key } = await seedWorkflowSecret(harness.db, harness.organizationId, {
      key: 'crm_no_value',
    });

    const { step } = await run({
      headers: [{ name: 'authorization', value: `{{secrets.${key}}}` }],
    });

    expect(step.errorCode).toBe('secret_placement_refused');
  });

  it('refuses a key another organisation holds', async () => {
    const { step } = await run({
      headers: [{ name: 'authorization', value: '{{secrets.nobody_holds_this}}' }],
    });

    expect(step.errorCode).toBe('secret_placement_refused');
  });

  it('scrubs an echoed value, in each encoding, from what is stored', async () => {
    const key = await secretWith();
    answer = () =>
      Promise.resolve(
        ok({
          echoed: CANARY,
          encoded: Buffer.from(CANARY).toString('base64'),
          url: `https://api.example.com/?t=${encodeURIComponent(CANARY)}`,
        }),
      );

    const { output } = await run({
      headers: [{ name: 'authorization', value: `{{secrets.${key}}}` }],
    });

    expect(output.body).toEqual({
      echoed: '[REDACTED]',
      encoded: '[REDACTED]',
      url: 'https://api.example.com/?t=[REDACTED]',
    });
  });

  it('scrubs a response header too', async () => {
    const key = await secretWith();
    answer = () =>
      Promise.resolve(status(302, { location: `https://api.example.com/?t=${CANARY}` }));

    const { output } = await run({
      headers: [{ name: 'authorization', value: `{{secrets.${key}}}` }],
    });

    expect(output.headers).toEqual({ location: 'https://api.example.com/?t=[REDACTED]' });
  });
});

describe('the signature (C124.6)', () => {
  const signing = (key: string) => ({ signing: { secret: `{{secrets.${key}}}` } });

  it('signs a POST so that the workflow verifier takes it', async () => {
    const key = await secretWith();

    await run({
      method: 'POST',
      body: { a: 1 },
      url: 'https://api.example.com/v1?x=1',
      ...signing(key),
    });

    const header = sent().headers?.['openverify-request-signature'];
    expect(
      verifyWorkflowRequestSignature({
        header,
        secrets: CANARY,
        method: 'POST',
        target: '/v1?x=1',
        body: sent().body as string,
        now: NOW,
      }),
    ).toEqual({ timestamp: NOW.getTime() / 1000 });
  });

  it.each(['GET', 'DELETE'])('signs a %s over an empty body', async (method) => {
    const key = await secretWith();

    await run({ method, ...signing(key) });

    expect(() =>
      verifyWorkflowRequestSignature({
        header: sent().headers?.['openverify-request-signature'],
        secrets: CANARY,
        method,
        target: '/v1',
        now: NOW,
      }),
    ).not.toThrow();
  });

  it('adds one w1 per active secret during a rotation', async () => {
    const key = await secretWith({ previousValue: 'canary-previous-value' });

    await run(signing(key));

    const header = sent().headers?.['openverify-request-signature'] ?? '';
    expect(header.match(/w1=/g)).toHaveLength(2);
    for (const secrets of [CANARY, 'canary-previous-value']) {
      expect(() =>
        verifyWorkflowRequestSignature({ header, secrets, method: 'GET', target: '/v1', now: NOW }),
      ).not.toThrow();
    }
  });

  it('never passes webhook verification, though the same secret value is stored in both', async () => {
    const key = await secretWith();

    await run({ method: 'POST', body: { a: 1 }, ...signing(key) });

    const signature = sent().headers?.['openverify-request-signature'] ?? '';
    expect(() =>
      verifyWebhookSignature({
        body: sent().body as string,
        header: signature,
        secrets: CANARY,
        now: NOW,
      }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyWebhookSignature({
        body: sent().body as string,
        header: signature.replace('w1=', 'v1='),
        secrets: CANARY,
        now: NOW,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it('refuses a signing secret bound to another host', async () => {
    const key = await secretWith({ allowedHosts: ['other.example.com'] });

    const { step } = await run(signing(key));

    expect(step.errorCode).toBe('secret_placement_refused');
    expect(requests).toEqual([]);
  });

  it('leaves the signature out with no signing secret', async () => {
    await run({});

    expect(sent().headers).not.toHaveProperty('openverify-request-signature');
  });
});

describe('answers (C124.1, C124.5)', () => {
  it('reads a text body as a string', async () => {
    answer = () => Promise.resolve(ok('synthetic', 'text/plain'));

    expect((await run({})).output.body).toBe('synthetic');
  });

  it('reads an empty 204 as null', async () => {
    answer = () => Promise.resolve(status(204));

    expect((await run({})).output).toEqual({ status: 204, headers: {}, body: null });
  });

  it('reads a 3xx as its status and location, and follows nothing', async () => {
    answer = () => Promise.resolve(status(302, { location: 'https://other.example.com/' }));

    expect((await run({})).output).toEqual({
      status: 302,
      headers: { location: 'https://other.example.com/' },
      body: null,
    });
    expect(requests).toHaveLength(1);
  });

  it('reads a 4xx as the output’s status, with no body', async () => {
    answer = () => Promise.resolve(status(404));

    const { step, output } = await run({});

    expect(step.status).toBe('succeeded');
    expect(output).toEqual({ status: 404, headers: {}, body: null });
    expect(sent().captureErrorBodyBytes).toBeUndefined();
  });

  it('keeps an error body only when asked, at most 16 KiB', async () => {
    answer = () =>
      Promise.resolve(status(422, { 'content-type': 'application/json' }, '{"detail":"no"}'));

    const { output } = await run({ 'capture-error-body': true });

    expect(sent().captureErrorBodyBytes).toBe(16 * 1024);
    expect(output.body).toEqual({ detail: 'no' });
  });

  it('keeps an error body that is no JSON as text', async () => {
    answer = () => Promise.resolve(status(400, {}, 'plain words'));

    expect((await run({ 'capture-error-body': true })).output.body).toBe('plain words');
  });

  it('refuses JSON it cannot parse', async () => {
    answer = () => Promise.resolve(ok('{not json'));

    expect((await run({})).step.errorCode).toBe('response_unsupported');
  });

  it('refuses JSON deeper than the depth limit', async () => {
    answer = () => Promise.resolve(ok('['.repeat(64) + ']'.repeat(64)));

    expect((await run({})).step.errorCode).toBe('response_unsupported');
  });

  it.each([['too_large'], ['content_type'], ['content_encoding']] as const)(
    'reads a %s client error as response_unsupported',
    async (code) => {
      answer = () => Promise.reject(new OutboundHttpError('https-action', code));

      expect((await run({})).step.errorCode).toBe('response_unsupported');
    },
  );

  it.each([
    ['blocked'],
    ['invalid_url'],
    ['port_refused'],
    ['header_refused'],
    ['method_refused'],
  ] as const)('reads a %s client error as destination_refused, never retried', async (code) => {
    answer = () => Promise.reject(new OutboundHttpError('https-action', code));

    const { step } = await run({}, { retry: { 'intervals-seconds': [1] } });

    expect(step.errorCode).toBe('destination_refused');
    expect(requests).toHaveLength(1);
  });
});

describe('a declared response (C124.1)', () => {
  const schema = {
    'response-schema': [
      { name: 'risk', type: 'number', pii: false },
      { name: 'note', type: 'string', pii: true },
    ],
  };

  it('keeps only the declared members', async () => {
    answer = () => Promise.resolve(ok({ risk: 3, note: 'synthetic', extra: 'dropped' }));

    expect((await run(schema)).output.body).toEqual({ risk: 3, note: 'synthetic' });
  });

  it.each([
    ['a member of the wrong type', { risk: 'high', note: 'synthetic' }],
    ['a missing member', { risk: 3 }],
    ['no object', ['synthetic']],
  ])('refuses %s', async (_name, body) => {
    answer = () => Promise.resolve(ok(body));

    expect((await run(schema)).step.errorCode).toBe('response_unsupported');
  });

  it('never reads an error body through it', async () => {
    answer = () => Promise.resolve(status(500, {}, '{"unexpected":true}'));

    const { output } = await run({ ...schema, 'capture-error-body': true });

    expect(output.body).toEqual({ unexpected: true });
  });
});

describe('retries (C124.7)', () => {
  /** Far enough ahead that no later test's dispatch can play a scheduled retry. */
  const RETRY = { retry: { 'intervals-seconds': [3_600, 3_600] } };

  it.each([['dns'], ['timeout'], ['network']] as const)('retries a %s failure', async (code) => {
    let calls = 0;
    answer = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new OutboundHttpError('https-action', code))
        : Promise.resolve(ok({}));
    };

    const id = await start(harness, chain([request({}, RETRY)]), {
      grant: { scopes: [], pii: true },
    });
    await drain(harness);

    expect(calls).toBeGreaterThanOrEqual(1);
    const steps = await listAllWorkflowRunSteps(harness.db, harness.environmentId, id);
    expect(steps.find(({ nodeId }) => nodeId === 'call')?.errorCode ?? null).toBeNull();
  });

  it('errors request_failed with no retry left', async () => {
    answer = () => Promise.reject(new OutboundHttpError('https-action', 'timeout'));

    expect((await run({})).step.errorCode).toBe('request_failed');
  });

  it.each([429, 500, 503])('schedules a retry on a %i while one is left', async (code) => {
    answer = () => Promise.resolve(status(code, { 'retry-after': '3000' }));

    const { step } = await run({}, RETRY);

    expect(step.status).toBe('ready');
    expect(step.attempt).toBe(1);
  });

  it('answers the status when no retry is left', async () => {
    answer = () => Promise.resolve(status(503));

    const { step, output } = await run({});

    expect(step.status).toBe('succeeded');
    expect(output.status).toBe(503);
  });

  it('retries no 4xx but a 429', async () => {
    answer = () => Promise.resolve(status(400));

    const { step } = await run({}, RETRY);

    expect(step.status).toBe('succeeded');
    expect(requests).toHaveLength(1);
  });
});

describe('budgets (C124.7, P31)', () => {
  it('counts each request against the environment', async () => {
    const limiter = createAllowAllRateLimiter(fixedClock(NOW));
    use(limiter);

    await run({});

    expect(limiter.calls).toEqual([
      {
        key: harness.environmentId,
        policy: { name: 'workflow-http', limit: 600, windowSeconds: 60 },
      },
    ]);
  });

  it('refuses past the budget, sending nothing', async () => {
    use(createDenyRateLimiter(30, fixedClock(NOW)));

    const { step } = await run({});

    expect(step.errorCode).toBe('rate_limited');
    expect(requests).toEqual([]);
  });

  it('fails closed when the store cannot answer', async () => {
    use({ consume: () => Promise.reject(new Error('down')) });

    const { step } = await run({});

    expect(step.errorCode).toBe('rate_limited');
    expect(requests).toEqual([]);
  });

  it('holds five requests to a host at once, in one environment', async () => {
    const release: (() => void)[] = [];
    answer = () =>
      new Promise((resolve) => {
        release.push(() => {
          resolve(ok({}));
        });
      });
    const cache = createInMemoryKeyValueCache();
    const { withHostSlot } = await import('./handler.js');
    const held = Array.from({ length: 5 }, () =>
      withHostSlot(cache, 'env_a', 'api.example.com', () => answer(sent0)),
    );

    await expect(
      withHostSlot(cache, 'env_a', 'api.example.com', () => Promise.resolve('sixth')),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(
      withHostSlot(cache, 'env_b', 'api.example.com', () => Promise.resolve('other environment')),
    ).resolves.toBe('other environment');
    await expect(
      withHostSlot(cache, 'env_a', 'other.example.com', () => Promise.resolve('other host')),
    ).resolves.toBe('other host');
    release.forEach((done) => {
      done();
    });
    await Promise.all(held);
    await expect(
      withHostSlot(cache, 'env_a', 'api.example.com', () => Promise.resolve('freed')),
    ).resolves.toBe('freed');
  });
});

const sent0: OutboundHttpPolicyRequest = { method: 'GET', url: 'https://api.example.com/' };

describe('the PII egress audit (C121.4)', () => {
  it('records a marked step with its destination, never a value', async () => {
    const before = audit.entries.length;
    const definition = chain([request({ method: 'POST', body: { name: '{{ trigger.id }}' } })]);
    const { publish, startOf } = await import('../../engine/testing.js');
    const published = await publish(harness, definition);
    await harness.db.execute(
      sql`update workflow_versions
             set egress = ${JSON.stringify([
               { 'step-id': 'call', paths: ['trigger.id'], destination: 'api.example.com' },
             ])}::jsonb
           where id = ${published.workflowVersionId}`,
    );

    const id = await startOf(harness, published, { grant: { scopes: [], pii: true } });
    await drain(harness);

    const entries = audit.entries.slice(before);
    expect(entries).toMatchObject([
      {
        action: 'workflow-run.egress-sent',
        actor: { type: 'workflow-run', id },
        resourceType: 'workflow-run',
        resourceId: id,
        metadata: {
          'workflow-id': published.workflowId,
          'workflow-version-id': published.workflowVersionId,
          'node-id': 'call',
          destination: 'api.example.com',
        },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain('inq_');
  });

  it('records nothing for a step no mark names', async () => {
    const before = audit.entries.length;

    await run({});

    expect(audit.entries.slice(before)).toEqual([]);
  });

  it('sends nothing when the audit entry cannot be written', async () => {
    const definition = chain([request({})]);
    const { publish, startOf } = await import('../../engine/testing.js');
    const published = await publish(harness, definition);
    await harness.db.execute(
      sql`update workflow_versions
             set egress = ${JSON.stringify([
               { 'step-id': 'call', paths: ['trigger.id'], destination: 'api.example.com' },
             ])}::jsonb
           where id = ${published.workflowVersionId}`,
    );
    Object.assign(harness.deps.services, {
      audit: {
        record: (_db: unknown, entry: { action: string }) =>
          entry.action === 'workflow-run.egress-sent'
            ? Promise.reject(new Error('audit down'))
            : Promise.resolve(),
      },
    });

    const id = await startOf(harness, published, { grant: { scopes: [], pii: true } });
    await drain(harness);
    Object.assign(harness.deps.services, { audit });

    expect(requests).toEqual([]);
    expect((await getWorkflowRun(harness.db, harness.environmentId, id))?.status).toBe('errored');
  });
});
