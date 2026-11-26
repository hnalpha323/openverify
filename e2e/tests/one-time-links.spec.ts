/**
 * Phase 2, C10: a one-time link opens a flow session exactly once. The flow redeems the token
 * from the link's fragment; a second redeem of the same link answers the generic 401.
 */
import { randomUUID } from 'node:crypto';
import { parseOneTimeLinkFragment } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { flowApi, recordingClient, redeemOneTimeLink } from './support/platform.js';

test('a one-time link is redeemed once through the flow API, then refused', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-link-${randomUUID()}`,
  });

  const { meta } = await client.inquiries.generateOneTimeLink(inquiry.id, {
    'expires-in-seconds': 600,
  });
  const link = new URL(meta['one-time-link']);
  expect(`${link.origin}/`).toBe(`${stack.flowUrl}/`);
  // The token travels in the fragment only, which never reaches a server or a Referer.
  expect(link.search).toBe('');
  const credentials = parseOneTimeLinkFragment(link.hash);
  expect(credentials?.inquiryId).toBe(inquiry.id);
  expect(Date.parse(meta['expires-at'])).toBeLessThanOrEqual(Date.now() + 600_000 + 5_000);
  const body = {
    'inquiry-id': inquiry.id,
    'one-time-token': credentials?.oneTimeToken ?? '',
  };

  const first = await redeemOneTimeLink(stack.apiUrl, body);
  expect(first.status).toBe(200);
  const redeemed = first.body as { 'session-token': string; 'expires-at': string };
  expect(redeemed['session-token']).toMatch(/^ovs_[A-Za-z0-9_-]{43}$/);

  // The session works: the inquiry starts, in the sandbox (C19).
  const session = await flowApi(stack.apiUrl, redeemed['session-token']).session();
  expect(session.inquiry).toMatchObject({ id: inquiry.id, status: 'pending' });
  expect(session.environment).toEqual({ kind: 'sandbox' });

  const second = await redeemOneTimeLink(stack.apiUrl, body);
  expect(second.status).toBe(401);
  expect(second.headers.get('content-type')).toContain('application/problem+json');
  // The same answer as any other refusal: nothing tells a used link from an unknown one.
  const unknown = await redeemOneTimeLink(stack.apiUrl, {
    'inquiry-id': inquiry.id,
    'one-time-token': `ovo_${'A'.repeat(43)}`,
  });
  expect(unknown.status).toBe(401);
  const strip = (problem: unknown) =>
    Object.fromEntries(
      Object.entries(problem as Record<string, unknown>).filter(([key]) => key !== 'requestId'),
    );
  expect(strip(second.body)).toEqual(strip(unknown.body));
});
