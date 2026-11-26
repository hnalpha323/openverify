/**
 * C178.4 (Workflow 9B, integration-9b): one-call key rotation (C169.1) and the key's attribute
 * blocklist (C169.3) on the full stack. Budget: 90 s.
 *
 * A key with a note and a blocklist is rotated with a 10-minute overlap: the new key keeps the
 * note, scopes and blocklist, both tokens work during the overlap, the old key's end is the chosen
 * time, and an inquiry read with the new token omits the blocked attribute. Every value is
 * synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectStatus, serverRequest } from './support/platform-9b.js';
import { recordingClient } from './support/platform.js';

test('a key is rotated in one call: both tokens work during the overlap, the blocklist kept (C169.1, C169.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const created = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', '/api-keys', {
      data: {
        type: 'api-key',
        attributes: {
          name: `e2e rotation ${randomUUID().slice(0, 8)}`,
          scopes: ['inquiries:read', 'inquiries:write'],
          note: 'Synthetic rotation key',
          'attribute-blocklist': ['reference-id'],
        },
      },
    }),
    201,
    'the key',
  ).body as { data: { id: string }; meta: { token: string } };
  const before = Date.now();

  const rotated = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', `/api-keys/${created.data.id}/rotate`, {
      meta: { 'previous-expires-in-seconds': 600 },
    }),
    201,
    'the rotation',
  ).body as {
    data: { id: string; attributes: Record<string, unknown> };
    meta: { token: string; 'previous-expires-at': string };
  };

  expect(rotated.data.id).not.toBe(created.data.id);
  expect(rotated.data.attributes).toMatchObject({
    note: 'Synthetic rotation key',
    'attribute-blocklist': ['reference-id'],
    scopes: ['inquiries:read', 'inquiries:write'],
  });
  const end = Date.parse(rotated.meta['previous-expires-at']);
  expect(end).toBeGreaterThanOrEqual(before + 590_000);
  expect(end).toBeLessThanOrEqual(Date.now() + 610_000);

  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-rotation-${randomUUID()}`,
  });
  for (const token of [created.meta.token, rotated.meta.token]) {
    const read = expectStatus(
      await serverRequest(stack, token, 'GET', `/inquiries/${inquiry.id}`),
      200,
      'a read during the overlap',
    ).body as { data: { attributes: Record<string, unknown> } };
    expect(read.data.attributes).not.toHaveProperty('reference-id');
    expect(read.data.attributes).toHaveProperty('status');
  }
});
