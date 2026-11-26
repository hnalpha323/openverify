/**
 * Phase 2, C12 platform HTTP behaviour through `@openverify/node`: idempotent replays and key
 * reuse, the rate-limit headers and `GET /rate-limits`, and the API version header.
 */
import { randomUUID } from 'node:crypto';
import { LATEST_API_VERSION, problemTypeUri } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';

test('an idempotent replay returns the stored response; another body with the key answers 422', async () => {
  const stack = readStackInfo();
  const { client, last } = recordingClient(stack.apiUrl, stack.apiKey);
  const idempotencyKey = `e2e-${randomUUID()}`;
  const attributes = {
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-idempotent-${randomUUID()}`,
  };

  const first = await client.inquiries.create(attributes, { idempotencyKey });
  expect(last().status).toBe(201);
  expect(last().headers.get('idempotent-replayed')).toBeNull();

  const replayed = await client.inquiries.create(attributes, { idempotencyKey });
  expect(last().status).toBe(201);
  expect(last().headers.get('idempotent-replayed')).toBe('true');
  expect(replayed).toEqual(first);
  // Only one inquiry exists for the reference id.
  const { data: listed } = await client.inquiries.list({
    filter: { 'reference-id': attributes['reference-id'] },
  });
  expect(listed.map((inquiry) => inquiry.id)).toEqual([first.data.id]);

  const reused = await client.inquiries
    .create({ ...attributes, 'reference-id': `e2e-other-${randomUUID()}` }, { idempotencyKey })
    .catch((error: unknown) => error);
  expect(reused).toBeInstanceOf(OpenVerifyApiError);
  expect(reused).toMatchObject({ status: 422, type: problemTypeUri('idempotency-key-reused') });
});

test('every server API response carries the rate-limit and version headers', async () => {
  const stack = readStackInfo();
  const { client, responses } = recordingClient(stack.apiUrl, stack.apiKey);

  await client.inquiryTemplates.list();
  // A burst: GCRA gives one request back every 60 s / limit (50 ms here), far less than a
  // burst of concurrent requests uses, so the remaining count must drop during it.
  await Promise.all(Array.from({ length: 8 }, () => client.inquiryTemplates.list()));
  const remaining = (response: (typeof responses)[number]) =>
    Number(response.headers.get('ratelimit-remaining'));
  expect(responses).toHaveLength(9);
  for (const response of responses) {
    expect(response.headers.get('ratelimit-limit')).toBe(String(stack.apiRateLimitPerMinute));
    expect(remaining(response)).toBeLessThan(stack.apiRateLimitPerMinute);
    expect(Number(response.headers.get('ratelimit-reset'))).toBeGreaterThanOrEqual(0);
    expect(response.headers.get('openverify-version')).toBe(LATEST_API_VERSION);
  }
  const [first = 0, ...burst] = responses.map(remaining);
  expect(Math.min(...burst)).toBeLessThan(first);

  const { data: limits } = await client.rateLimits.list();
  const api = limits.find((limit) => limit.id === 'api');
  expect(api?.attributes).toMatchObject({
    name: 'api',
    limit: stack.apiRateLimitPerMinute,
    'window-seconds': 60,
  });

  // Error answers carry them too, and an unknown API version is refused (400).
  const answer = await fetch(`${stack.apiUrl}/api/v1/inquiry-templates`, {
    headers: { authorization: `Bearer ${stack.apiKey}`, 'openverify-version': '1999-01-01' },
  });
  expect(answer.status).toBe(400);
  expect(((await answer.json()) as { type: string }).type).toBe(
    problemTypeUri('unsupported-api-version'),
  );
  expect(answer.headers.get('ratelimit-limit')).toBe(String(stack.apiRateLimitPerMinute));
});
