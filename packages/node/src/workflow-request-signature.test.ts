/**
 * C124.6 (decision 35, P01): workflow requests are signed in a format of their own, so no workflow
 * author can forge an OpenVerify webhook, even with the same secret stored in both places.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature, WebhookSignatureError } from './webhook-signature.js';
import {
  OPENVERIFY_REQUEST_SIGNATURE_HEADER,
  signWorkflowRequest,
  verifyWorkflowRequestSignature,
  WorkflowRequestSignatureError,
} from './workflow-request-signature.js';

const SECRET = 'change-me-workflow-canary';
const OTHER = 'change-me-other-canary';
const T = 1_790_000_000;
const NOW = new Date(T * 1000);
const REQUEST = { method: 'POST', target: '/hooks/a?b=1', body: '{"a":1}' };

const signed = (secret: string | readonly string[] = SECRET) =>
  signWorkflowRequest(REQUEST, secret, T);
const verify = (header: unknown, overrides: object = {}) =>
  verifyWorkflowRequestSignature({
    ...REQUEST,
    header: header as string,
    secrets: SECRET,
    now: NOW,
    ...overrides,
  });

const codeOf = (attempt: () => unknown): unknown => {
  try {
    attempt();
  } catch (error: unknown) {
    if (error instanceof WorkflowRequestSignatureError || error instanceof WebhookSignatureError) {
      return error.code;
    }
    throw error;
  }
  return null;
};

describe('the workflow request signature (C124.6)', () => {
  it('names its header', () => {
    expect(OPENVERIFY_REQUEST_SIGNATURE_HEADER).toBe('openverify-request-signature');
  });

  it('signs workflow.<t>.<METHOD>.<target>.<raw body> with w1', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`workflow.${String(T)}.POST./hooks/a?b=1.{"a":1}`)
      .digest('hex');
    expect(signed()).toBe(`t=${String(T)},w1=${expected}`);
  });

  it('upper-cases the method, and signs an empty body for a GET or a DELETE', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`workflow.${String(T)}.DELETE./hooks/a.`)
      .digest('hex');
    expect(signWorkflowRequest({ method: 'delete', target: '/hooks/a' }, SECRET, T)).toBe(
      `t=${String(T)},w1=${expected}`,
    );
  });

  it('verifies, and gives the signed time', () => {
    expect(verify(signed())).toEqual({ timestamp: T });
  });

  it('carries one w1 per active secret, during rotation', () => {
    const header = signed([OTHER, SECRET]);
    expect(header.match(/w1=/g)).toHaveLength(2);
    expect(verify(header)).toEqual({ timestamp: T });
    expect(verify(header, { secrets: OTHER })).toEqual({ timestamp: T });
  });

  it('accepts a body as bytes, the same as text', () => {
    expect(verify(signed(), { body: new TextEncoder().encode(REQUEST.body) })).toEqual({
      timestamp: T,
    });
  });

  it.each([
    ['another method', { method: 'PUT' }],
    ['another target', { target: '/hooks/b?b=1' }],
    ['another query', { target: '/hooks/a?b=2' }],
    ['another body', { body: '{"a":2}' }],
    ['another secret', { secrets: OTHER }],
  ])('refuses %s', (_name, overrides) => {
    expect(codeOf(() => verify(signed(), overrides))).toBe('no_matching_signature');
  });

  it('refuses an old timestamp and a replay past the tolerance', () => {
    const later = new Date((T + 301) * 1000);
    expect(codeOf(() => verify(signed(), { now: later }))).toBe('timestamp_outside_tolerance');
    expect(verify(signed(), { now: later, toleranceSeconds: 400 })).toEqual({ timestamp: T });
  });

  it.each([
    ['nothing', undefined],
    ['an empty header', ''],
    ['two headers', ['a', 'b']],
    ['a webhook signature', `t=${String(T)},v1=${'a'.repeat(64)}`],
    ['no timestamp', `w1=${'a'.repeat(64)}`],
    ['a short signature', `t=${String(T)},w1=abc`],
    [
      'too many signatures',
      `t=${String(T)},${Array(9)
        .fill(`w1=${'a'.repeat(64)}`)
        .join(' ')}`,
    ],
  ])('refuses %s as malformed', (_name, header) => {
    expect(codeOf(() => verify(header))).toBe('malformed_header');
  });

  it('refuses arguments that are a programming error', () => {
    expect(() => signWorkflowRequest(REQUEST, '', T)).toThrow(TypeError);
    expect(() => signWorkflowRequest(REQUEST, SECRET, 1.5)).toThrow(RangeError);
    expect(() => signWorkflowRequest({ ...REQUEST, method: 'GE T' }, SECRET, T)).toThrow(TypeError);
    expect(() => signWorkflowRequest({ ...REQUEST, target: 'hooks' }, SECRET, T)).toThrow(
      TypeError,
    );
    expect(() => verify(signed(), { toleranceSeconds: 0 })).toThrow(RangeError);
  });
});

describe('no workflow can forge a webhook (P01)', () => {
  const webhook = (header: string, body = REQUEST.body) =>
    verifyWebhookSignature({ body, header, secrets: SECRET, now: NOW });

  it('fails webhook verification, even with the same secret in both places', () => {
    expect(codeOf(() => webhook(signed()))).toBe('malformed_header');
  });

  it('fails when an attacker relabels w1 as v1: the signed text differs', () => {
    expect(codeOf(() => webhook(signed().replace('w1=', 'v1=')))).toBe('no_matching_signature');
  });

  it('fails with a body shaped to meet the webhook text', () => {
    const body = `.POST./hooks/a?b=1.${REQUEST.body}`;
    expect(codeOf(() => webhook(signed().replace('w1=', 'v1='), body))).toBe(
      'no_matching_signature',
    );
  });
});
