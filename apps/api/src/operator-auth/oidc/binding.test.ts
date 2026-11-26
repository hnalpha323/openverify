import { createHash } from 'node:crypto';
import { SSO_PROBLEM_STATUSES, ssoBindingSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { newSsoBinding, sha256Hex } from './binding.js';
import {
  SSO_FAILURE_CODES,
  SSO_FAILURE_PROBLEMS,
  SSO_PROBLEM_DETAILS,
  SsoFlowError,
} from './failures.js';

describe('the browser binding (C248.4)', () => {
  it('is a fresh ovsb_ value each time, kept only as its SHA-256', () => {
    const first = newSsoBinding();
    const second = newSsoBinding();
    expect(ssoBindingSchema.safeParse(first).success).toBe(true);
    expect(first).not.toBe(second);
    expect(sha256Hex(first)).toBe(createHash('sha256').update(first).digest('hex'));
    expect(sha256Hex(first)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SSO failures (C248.7)', () => {
  it('answers the browser one generic problem per code, with the goldens’ words', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const code of Object.keys(SSO_PROBLEM_STATUSES) as (keyof typeof SSO_PROBLEM_STATUSES)[]) {
      const golden = JSON.parse(
        await readFile(
          new URL(
            `../../../../../contracts/fixtures/problems/sso/${code.replaceAll('_', '-')}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      ) as { detail: string; status: number };
      expect(SSO_PROBLEM_DETAILS[code]).toBe(golden.detail);
      expect(SSO_PROBLEM_STATUSES[code]).toBe(golden.status);
    }
    for (const failure of SSO_FAILURE_CODES) {
      const error = new SsoFlowError(failure);
      const code = SSO_FAILURE_PROBLEMS[failure];
      expect(error.failure).toBe(failure);
      expect(error.code).toBe(code);
      expect(error.status).toBe(SSO_PROBLEM_STATUSES[code]);
      expect(error.message).toBe(SSO_PROBLEM_DETAILS[code]);
    }
  });
});
