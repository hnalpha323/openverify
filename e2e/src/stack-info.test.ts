import { describe, expect, it } from 'vitest';
import {
  STACK_INFO_ENV,
  encodeStackInfo,
  parseStackInfo,
  readStackInfo,
  type StackInfo,
} from './stack-info.js';

const operator = (role: string) => ({
  email: `${role}-01@example.test`,
  password: 'synthetic-password',
});

const INFO: StackInfo = {
  apiUrl: 'http://127.0.0.1:41007',
  flowUrl: 'http://127.0.0.1:41009',
  embedPageUrl: 'http://127.0.0.1:41011',
  dashboardUrl: 'http://127.0.0.1:41010',
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

describe('stack info', () => {
  it('round-trips through the environment variable the global setup sets', () => {
    expect(readStackInfo({ [STACK_INFO_ENV]: encodeStackInfo(INFO) })).toEqual(INFO);
  });

  it('explains how to run the specs when the global setup has not run', () => {
    expect(() => readStackInfo({})).toThrow(
      `${STACK_INFO_ENV} is not set: run the specs with \`pnpm e2e\``,
    );
  });

  it('carries one operator per built-in role and the TOTP-enrolled admin (Phase 2)', () => {
    const info = readStackInfo({ [STACK_INFO_ENV]: encodeStackInfo(INFO) });

    expect(Object.keys(info.operators)).toEqual(['admin', 'developer', 'reviewer', 'viewer']);
    expect(info.mfaAdmin.totpSecret).toBe('A'.repeat(32));
    expect(() =>
      readStackInfo({
        [STACK_INFO_ENV]: encodeStackInfo({
          ...INFO,
          mfaAdmin: { ...INFO.mfaAdmin, totpSecret: '' },
        }),
      }),
    ).toThrow(`${STACK_INFO_ENV} does not describe a running stack`);
  });

  it('carries the Connect sample partner the seed made (C244.1; Workflow 11A integration-11a)', () => {
    const info = parseStackInfo(INFO);
    expect(info?.connect.partnerAdmin.email).toContain('partner-admin');
    const without: Partial<StackInfo> = { ...INFO };
    delete without.connect;
    expect(parseStackInfo(without)).toBeUndefined();
  });

  it('names the embed page the stack serves (C178.4)', () => {
    const { embedPageUrl, ...without } = INFO;
    expect(readStackInfo({ [STACK_INFO_ENV]: encodeStackInfo(INFO) }).embedPageUrl).toBe(
      embedPageUrl,
    );
    expect(() => readStackInfo({ [STACK_INFO_ENV]: JSON.stringify(without) })).toThrow(
      `${STACK_INFO_ENV} does not describe a running stack`,
    );
  });

  it('refuses a malformed value', () => {
    expect(() => readStackInfo({ [STACK_INFO_ENV]: '{"apiUrl":1}' })).toThrow(
      `${STACK_INFO_ENV} does not describe a running stack`,
    );
    expect(() => readStackInfo({ [STACK_INFO_ENV]: 'not json' })).toThrow(
      `${STACK_INFO_ENV} does not describe a running stack`,
    );
  });
});
