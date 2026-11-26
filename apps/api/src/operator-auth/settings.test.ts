import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';
import { syntheticEnv } from '../test-support/env.js';
import {
  DEFAULT_DEVELOPMENT_DASHBOARD_URL,
  DEFAULT_DEVELOPMENT_SMTP_URL,
  DEFAULT_MAIL_FROM,
  OPERATOR_SETTING_SCHEMAS,
  resolveOperatorSettings,
  trustProxySchema,
} from './settings.js';

// Synthetic values only.
const BFF_TOKEN = 'synthetic-bff-token-0123456789abcdef-0123';

describe('trustProxySchema (OPENVERIFY_TRUST_PROXY, C15)', () => {
  it.each([
    ['false', false],
    ['FALSE', false],
    ['true', true],
    ['0', false],
    ['1', 1],
    ['2', 2],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['10.0.0.0/8, 192.0.2.1 ,2001:db8::/32', ['10.0.0.0/8', '192.0.2.1', '2001:db8::/32']],
    ['loopback,uniquelocal', ['loopback', 'uniquelocal']],
  ])('reads %j as %j', (value, expected) => {
    expect(trustProxySchema.parse(value)).toEqual(expected);
  });

  it.each(['yes please', '-1', '1.5', '10.0.0.0/33', '300.0.0.1', '10.0.0.0/8,,', 'example.com'])(
    'refuses %j',
    (value) => {
      expect(trustProxySchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('resolveOperatorSettings', () => {
  it('uses the local dashboard, Mailpit and a WebAuthn RP for localhost outside production', () => {
    const { settings, issues } = resolveOperatorSettings({}, 'development');

    expect(issues).toEqual([]);
    expect(DEFAULT_DEVELOPMENT_DASHBOARD_URL).toBe('http://localhost:3001');
    expect(DEFAULT_DEVELOPMENT_SMTP_URL).toBe('smtp://127.0.0.1:1025');
    expect(settings).toEqual({
      dashboardPublicUrl: 'http://localhost:3001',
      bffToken: undefined,
      webauthn: { rpId: 'localhost', rpName: 'OpenVerify', origin: 'http://localhost:3001' },
      smtpUrl: 'smtp://127.0.0.1:1025',
      mailFrom: DEFAULT_MAIL_FROM,
    });
  });

  it('assumes nothing about the deployment in production', () => {
    const { settings, issues } = resolveOperatorSettings({}, 'production');

    expect(issues).toEqual([]);
    expect(settings).toEqual({
      dashboardPublicUrl: undefined,
      bffToken: undefined,
      webauthn: undefined,
      smtpUrl: undefined,
      mailFrom: DEFAULT_MAIL_FROM,
    });
  });

  it('derives the WebAuthn RP from the dashboard URL, and takes explicit values', () => {
    const derived = resolveOperatorSettings(
      { dashboardPublicUrl: 'https://console.example.test/app' },
      'production',
    );
    const explicit = resolveOperatorSettings(
      {
        dashboardPublicUrl: 'https://console.example.test',
        rpId: 'example.test',
        rpName: 'Example Console',
        origin: 'https://console.example.test',
        smtpUrl: 'smtps://mailer:synthetic@smtp.example.test:465',
        mailFrom: 'Example <no-reply@example.test>',
        bffToken: BFF_TOKEN,
      },
      'production',
    );

    expect(derived.settings.webauthn).toEqual({
      rpId: 'console.example.test',
      rpName: 'OpenVerify',
      origin: 'https://console.example.test',
    });
    expect(explicit.issues).toEqual([]);
    expect(explicit.settings).toEqual({
      dashboardPublicUrl: 'https://console.example.test',
      bffToken: BFF_TOKEN,
      webauthn: {
        rpId: 'example.test',
        rpName: 'Example Console',
        origin: 'https://console.example.test',
      },
      smtpUrl: 'smtps://mailer:synthetic@smtp.example.test:465',
      mailFrom: 'Example <no-reply@example.test>',
    });
  });

  it('reports an origin outside the RP ID, which no browser would accept', () => {
    const { issues } = resolveOperatorSettings(
      { rpId: 'example.test', origin: 'https://evil.test' },
      'development',
    );

    expect(issues).toEqual([
      'OPENVERIFY_WEBAUTHN_ORIGIN: must be on OPENVERIFY_WEBAUTHN_RP_ID or one of its subdomains',
    ]);
  });

  it('refuses an RP ID that is an IP address, as WebAuthn does', () => {
    expect(OPERATOR_SETTING_SCHEMAS.OPENVERIFY_WEBAUTHN_RP_ID.safeParse('127.0.0.1').success).toBe(
      false,
    );
    expect(OPERATOR_SETTING_SCHEMAS.OPENVERIFY_WEBAUTHN_RP_ID.safeParse('localhost').success).toBe(
      true,
    );
  });
});

describe('loadConfig: operator settings', () => {
  it('reads the C15 variables', () => {
    const config = loadConfig(
      syntheticEnv({
        OPENVERIFY_TRUST_PROXY: '10.0.0.0/8',
        OPENVERIFY_DASHBOARD_PUBLIC_URL: 'https://console.example.test',
        OPENVERIFY_DASHBOARD_BFF_TOKEN: BFF_TOKEN,
        OPENVERIFY_WEBAUTHN_RP_NAME: 'Example Console',
        OPENVERIFY_SMTP_URL: 'smtp://smtp.example.test:2525',
        OPENVERIFY_MAIL_FROM: 'Example <no-reply@example.test>',
      }),
    );

    expect(config.trustProxy).toEqual(['10.0.0.0/8']);
    expect(config.operators).toEqual({
      dashboardPublicUrl: 'https://console.example.test',
      bffToken: BFF_TOKEN,
      webauthn: {
        rpId: 'console.example.test',
        rpName: 'Example Console',
        origin: 'https://console.example.test',
      },
      smtpUrl: 'smtp://smtp.example.test:2525',
      mailFrom: 'Example <no-reply@example.test>',
    });
  });

  it('names every invalid variable, never its value', () => {
    let error: unknown;
    try {
      loadConfig(
        syntheticEnv({
          OPENVERIFY_DASHBOARD_PUBLIC_URL: 'ftp://console.example.test',
          OPENVERIFY_DASHBOARD_BFF_TOKEN: 'too-short',
          OPENVERIFY_SMTP_URL: 'http://smtp.example.test',
          OPENVERIFY_MAIL_FROM: 'Example\r\nBcc: someone@example.test',
          OPENVERIFY_WEBAUTHN_ORIGIN: 'https://console.example.test/path',
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.map((issue) => issue.split(':')[0]);
    expect(issues).toEqual(
      expect.arrayContaining([
        'OPENVERIFY_DASHBOARD_PUBLIC_URL',
        'OPENVERIFY_DASHBOARD_BFF_TOKEN',
        'OPENVERIFY_SMTP_URL',
        'OPENVERIFY_MAIL_FROM',
        'OPENVERIFY_WEBAUTHN_ORIGIN',
      ]),
    );
    expect((error as ConfigError).message).not.toContain('too-short');
  });

  it('refuses a change-me BFF token in production', () => {
    expect(() =>
      loadConfig(
        syntheticEnv({
          OPENVERIFY_MODE: 'production',
          OPENVERIFY_DASHBOARD_BFF_TOKEN: 'change-me-dashboard-bff-token-at-least-32-chars',
        }),
      ),
    ).toThrow('OPENVERIFY_DASHBOARD_BFF_TOKEN: still holds a change-me placeholder');
  });
});
