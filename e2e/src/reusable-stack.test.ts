import { describe, expect, it } from 'vitest';
import {
  REUSE_STACK_ENV,
  decodeReusableStack,
  encodeReusableStack,
  processAlive,
  readReusableStack,
  reuseRequested,
  type ReusableStackRecord,
} from './reusable-stack.js';
import type { StackInfo } from './stack-info.js';

const operator = (role: string) => ({
  email: `${role}-01@example.test`,
  password: 'synthetic-password',
});

const INFO: StackInfo = {
  apiUrl: 'http://127.0.0.1:41007',
  flowUrl: 'http://127.0.0.1:41009',
  embedPageUrl: 'http://127.0.0.1:41011',
  dashboardUrl: 'http://localhost:41010',
  mailpitUrl: 'http://127.0.0.1:41006',
  apiKey: 'ov_sbx_synthetic-test-key-not-real',
  admin: operator('admin'),
  operators: {
    admin: operator('admin'),
    developer: operator('developer'),
    reviewer: operator('reviewer'),
    viewer: operator('viewer'),
  },
  // Zero-entropy placeholder: never a real TOTP secret.
  mfaAdmin: { ...operator('mfa-admin'), totpSecret: 'A'.repeat(32) },
  connect: {
    partnerOrganizationId: 'org_01JAAAAAAAAAAAAAAAAAAAAAAC',
    partnerEnvironments: {
      sandbox: 'env_01JAAAAAAAAAAAAAAAAAAAAAAC',
      production: 'env_01JAAAAAAAAAAAAAAAAAAAAAAD',
    },
    seededConnectionId: 'cxn_01JAAAAAAAAAAAAAAAAAAAAAAA',
    partnerAdmin: operator('partner-admin'),
  },
  apiRateLimitPerMinute: 1200,
  defaultTemplateId: 'itmpl_01JAAAAAAAAAAAAAAAAAAAAAAA',
  environments: {
    sandbox: 'env_01JAAAAAAAAAAAAAAAAAAAAAAA',
    production: 'env_01JAAAAAAAAAAAAAAAAAAAAAAB',
  },
  databaseUrl: 'postgres://openverify:synthetic@127.0.0.1:41001/openverify',
  s3: {
    endpoint: 'http://127.0.0.1:41003',
    region: 'us-east-1',
    bucket: 'openverify-files',
    accessKeyId: 'synthetic-access-key',
    secretAccessKey: 'synthetic-secret-key',
  },
};
const RECORD: ReusableStackRecord = {
  pid: 4242,
  startedAt: '2026-10-30T12:00:00.000Z',
  info: INFO,
};

describe('the reusable e2e stack (C111.2, F20)', () => {
  it('is asked for with OPENVERIFY_E2E_REUSE_STACK=1 (or true), and only then', () => {
    expect(REUSE_STACK_ENV).toBe('OPENVERIFY_E2E_REUSE_STACK');
    expect(reuseRequested({ OPENVERIFY_E2E_REUSE_STACK: '1' })).toBe(true);
    expect(reuseRequested({ OPENVERIFY_E2E_REUSE_STACK: 'true' })).toBe(true);
    for (const value of [undefined, '', '0', 'false', 'yes']) {
      expect(reuseRequested({ OPENVERIFY_E2E_REUSE_STACK: value }), String(value)).toBe(false);
    }
  });

  it('records the holding process and the stack info, and reads them back', () => {
    expect(decodeReusableStack(encodeReusableStack(RECORD))).toEqual(RECORD);
  });

  it('refuses a record that is not one, without echoing it', () => {
    for (const text of ['', 'not json', '{"pid":0}', JSON.stringify({ ...RECORD, pid: -1 })]) {
      expect(() => decodeReusableStack(text), text).toThrow(
        'the reusable stack record is unreadable',
      );
    }
    let message = '';
    try {
      decodeReusableStack(JSON.stringify({ ...RECORD, info: { ...INFO, apiUrl: 'nope' } }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('synthetic-password');
  });

  it('gives the stack info of a running holder to the global setup', () => {
    expect(readReusableStack(encodeReusableStack(RECORD), (pid) => pid === 4242)).toEqual(INFO);
  });

  it('says to start the stack when there is no record, and that it stopped when its holder is gone', () => {
    expect(() => readReusableStack(undefined, () => true)).toThrow(
      'no reusable e2e stack is running: start one with `pnpm --filter @openverify/e2e e2e:stack:up`',
    );
    expect(() => readReusableStack(encodeReusableStack(RECORD), () => false)).toThrow(
      'the reusable e2e stack (process 4242) is no longer running: run e2e:stack:down, then e2e:stack:up',
    );
  });

  it('probes a process with signal 0, and reads a missing one as gone', () => {
    const probes: [number, number][] = [];
    expect(
      processAlive(7, (pid, signal) => {
        probes.push([pid, signal]);
      }),
    ).toBe(true);
    expect(probes).toEqual([[7, 0]]);
    expect(
      processAlive(8, () => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }),
    ).toBe(false);
    // A process of another user exists even though it cannot be signalled.
    expect(
      processAlive(9, () => {
        throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      }),
    ).toBe(true);
  });
});
