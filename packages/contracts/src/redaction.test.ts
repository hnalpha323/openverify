import { describe, expect, it } from 'vitest';
import {
  API_LOG_REDACTED_KEYS,
  API_LOG_REDACTED_VALUE_MAPS,
  REDACTED_VALUE,
  redactKeys,
} from './redaction.js';

describe('API log redaction (C12)', () => {
  it('replaces the value of every C12 secret key, and the flow URL that carries a session token', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
    expect(API_LOG_REDACTED_KEYS).toEqual([
      'secret',
      'token',
      'session-token',
      'one-time-link',
      'one-time-token',
      'password',
      'code',
      'totp-code',
      'recovery-code',
      'flow-url',
      // C143.5 (Workflow 8A).
      'secret-value',
      'client-secret',
      'binding',
    ]);
    expect(
      redactKeys({
        meta: {
          'session-token': 'ovs_x',
          'flow-url': 'https://flow.example.test/#inquiry-id=inq_x&session-token=ovs_x',
        },
      }),
    ).toEqual({ meta: { 'session-token': '[REDACTED]', 'flow-url': '[REDACTED]' } });
  });

  it('redacts at any depth, inside objects and arrays, and keeps everything else', () => {
    const body = {
      data: {
        type: 'webhook',
        attributes: { url: 'https://hooks.example.test/x', secret: 'wbhsec_test_value' },
      },
      meta: { token: 'ov_sbx_test', nested: [{ password: 'pw', code: 123456 }, 'plain'] },
      'session-token': null,
      count: 3,
    };
    expect(redactKeys(body)).toEqual({
      data: {
        type: 'webhook',
        attributes: { url: 'https://hooks.example.test/x', secret: '[REDACTED]' },
      },
      meta: {
        token: '[REDACTED]',
        nested: [{ password: '[REDACTED]', code: '[REDACTED]' }, 'plain'],
      },
      'session-token': '[REDACTED]',
      count: 3,
    });
  });

  it('does not change its input and passes scalars through', () => {
    const body = { secret: 'x' };
    redactKeys(body);
    expect(body).toEqual({ secret: 'x' });
    expect(redactKeys('secret')).toBe('secret');
    expect(redactKeys(null)).toBeNull();
  });

  it('keeps the names of webhook custom headers but never their values, which are credentials (2B F009)', () => {
    expect(API_LOG_REDACTED_VALUE_MAPS).toEqual(['custom-headers']);
    expect(
      redactKeys({
        data: {
          attributes: {
            url: 'https://hooks.example.test/x',
            'custom-headers': { Authorization: 'Bearer synthetic-s3cr3t', 'X-Trace': 'abc' },
          },
        },
      }),
    ).toEqual({
      data: {
        attributes: {
          url: 'https://hooks.example.test/x',
          'custom-headers': { Authorization: '[REDACTED]', 'X-Trace': '[REDACTED]' },
        },
      },
    });
    expect(redactKeys({ 'custom-headers': 'not-an-object' })).toEqual({
      'custom-headers': '[REDACTED]',
    });
    expect(redactKeys({ 'custom-headers': null })).toEqual({ 'custom-headers': null });
  });

  it('takes another key list', () => {
    expect(redactKeys({ email: 'a@example.test', name: 'Jane' }, ['email'])).toEqual({
      email: '[REDACTED]',
      name: 'Jane',
    });
  });
});
