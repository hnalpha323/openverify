/**
 * Workflow 8A Stage 1b (X) (C126.3, C126.6, C135.5, C143.8, decision 76): the `slack` and
 * `attachmentScanner` kinds, read and bound with the rules every kind follows. The sandbox provider
 * of each is refused in production; the worker reads every kind, and the API exactly what it did.
 * A mistyped value is never echoed.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_PROVIDERS,
  PHASE8_PROVIDER_KINDS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES_BY_KIND,
  createProviderBindings,
  providerVariable,
  readProviderSettings,
} from './index.js';

describe('the Phase 8 kinds', () => {
  it('follow ipReputation in PROVIDER_KINDS', () => {
    expect(PHASE8_PROVIDER_KINDS).toEqual(['slack', 'attachmentScanner']);
    // Workflow 10B: deviceIntegrity follows them.
    expect(PROVIDER_KINDS.slice(-4, -1)).toEqual(['ipReputation', 'slack', 'attachmentScanner']);
  });

  it('have their variables and names', () => {
    expect(PROVIDER_ENV_PREFIXES).toMatchObject({
      slack: 'OPENVERIFY_PROVIDER_SLACK',
      attachmentScanner: 'OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER',
    });
    expect(PROVIDER_NAMES_BY_KIND.slack).toEqual(['incoming-webhook', 'sandbox']);
    expect(PROVIDER_NAMES_BY_KIND.attachmentScanner).toEqual(['clamd', 'sandbox']);
  });
});

describe('PROCESS_PROVIDER_KINDS (C126.6, decision 76)', () => {
  it('leaves the API as it was (Workflow 10B adds deviceIntegrity, C211.3)', () => {
    expect(PROCESS_PROVIDER_KINDS.api).toEqual([
      'sms',
      'database',
      'aamva',
      'ipReputation',
      'deviceIntegrity',
    ]);
  });

  it('gives the worker every kind, sms and slack among them', () => {
    expect(PROCESS_PROVIDER_KINDS.worker).toEqual([...PROVIDER_KINDS]);
    expect(PROCESS_PROVIDER_KINDS.worker).toEqual(expect.arrayContaining(['sms', 'slack']));
  });

  it('reads slack in the worker and never in the API', () => {
    const env = { OPENVERIFY_PROVIDER_SLACK_SANDBOX: 'sandbox' };

    expect(readProviderSettings(env, 'worker').settings.sandbox.slack).toBe('sandbox');
    expect(readProviderSettings(env, 'api').settings.sandbox).not.toHaveProperty('slack');
  });

  it('reads sms in the worker', () => {
    const env = { OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox' };

    expect(readProviderSettings(env, 'worker').settings.sandbox.sms).toBe('sandbox');
  });
});

describe('reading the kinds', () => {
  it('leaves each unbound when unset', () => {
    const { settings, issues } = readProviderSettings({});

    expect(issues).toEqual([]);
    expect(settings.sandbox.slack).toBeNull();
    expect(settings.production.attachmentScanner).toBeNull();
  });

  it('takes `none` for the scanner, which is its default (decision 66)', () => {
    const { settings, issues } = readProviderSettings({
      OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: 'none',
    });

    expect(issues).toEqual([]);
    expect(settings.production.attachmentScanner).toBeNull();
  });

  it.each(['slack', 'attachmentScanner'] as const)(
    'refuses a sandbox %s for production, without echoing a value',
    (kind) => {
      const variable = providerVariable(kind, 'production');
      const { issues } = readProviderSettings({ [variable]: 'sandbox' });

      expect(issues).toEqual([
        `${variable}: a sandbox provider cannot be bound to production environments`,
      ]);
    },
  );

  it.each(['slack', 'attachmentScanner'] as const)('refuses an unknown name for %s', (kind) => {
    const variable = providerVariable(kind, 'sandbox');
    const { issues } = readProviderSettings({ [variable]: 'change-me-mistyped-credential' });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(new RegExp(`^${variable}: must be `, 'u'));
    expect(issues[0]).not.toContain('change-me-mistyped-credential');
  });
});

describe('binding the kinds', () => {
  const settings = (slack: 'incoming-webhook' | 'sandbox' | null, production = false) => ({
    ...NO_PROVIDERS,
    [production ? 'production' : 'sandbox']: { ...NO_PROVIDERS.sandbox, slack },
  });

  it('binds the sandbox sender to a sandbox environment', () => {
    const { sandbox } = createProviderBindings(settings('sandbox'));

    expect(sandbox.slack).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it('binds the webhook sender to a production environment', () => {
    const { production } = createProviderBindings(settings('incoming-webhook', true));

    expect(production.slack).toMatchObject({ id: 'incoming-webhook', sandbox: false });
  });

  it('leaves it out when unbound', () => {
    expect(createProviderBindings(settings(null)).sandbox.slack).toBeUndefined();
  });

  it('refuses a sandbox sender for production', () => {
    expect(() => createProviderBindings(settings('sandbox', true))).toThrow(
      'a sandbox provider cannot be bound to production environments',
    );
  });

  it('refuses a sandbox scanner for production', () => {
    expect(() =>
      createProviderBindings({
        ...NO_PROVIDERS,
        production: { ...NO_PROVIDERS.production, attachmentScanner: 'sandbox' },
      }),
    ).toThrow('a sandbox provider cannot be bound to production environments');
  });

  it('builds the scanner since Workflow 8B (F), the sandbox one answering for itself', async () => {
    const { sandbox } = createProviderBindings({
      ...NO_PROVIDERS,
      sandbox: { ...NO_PROVIDERS.sandbox, attachmentScanner: 'sandbox' },
    });

    expect(sandbox.attachmentScanner?.provider).toBe('sandbox');
    await expect(
      sandbox.attachmentScanner?.scan({
        attachmentId: 'catt_01M5CJXHG0000000000000000A',
        bytes: new Uint8Array(4),
      }),
    ).resolves.toEqual({ verdict: 'clean', provider: 'sandbox' });
  });
});
