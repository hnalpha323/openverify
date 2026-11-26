/** C51.3: the effective config of a Phase 5 check and the enabled checks of one type. */
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import {
  booleanIn,
  enabledChecksOf,
  phase5CheckConfig,
  phase5ResultOptions,
  stringListIn,
} from './phase5-config.js';
import { templateOf } from './testing.js';

describe('phase5CheckConfig (C51.3)', () => {
  it('takes every default with its provisional basis when the template sets nothing', () => {
    expect(
      phase5CheckConfig(
        templateOf(['crypto_wallet_address_comparison']),
        'crypto_wallet_address_comparison',
      ),
    ).toEqual({
      values: { 'bip137-mode': 'loose', 'allow-high-s': true, 'allow-contract-wallets': false },
      basis: {
        'bip137-mode': 'provisional',
        'allow-high-s': 'provisional',
        'allow-contract-wallets': 'provisional',
      },
    });
  });

  it('lets the template override a key, which then has no basis', () => {
    const template = templateOf(['crypto_wallet_address_comparison'], {
      crypto_wallet_address_comparison: { 'bip137-mode': 'strict' },
    });
    expect(phase5CheckConfig(template, 'crypto_wallet_address_comparison')).toEqual({
      values: { 'bip137-mode': 'strict', 'allow-high-s': true, 'allow-contract-wallets': false },
      basis: { 'allow-high-s': 'provisional', 'allow-contract-wallets': 'provisional' },
    });
  });

  it('refuses a config that breaks the registry schema', () => {
    const template = templateOf(['crypto_wallet_address_comparison'], {
      crypto_wallet_address_comparison: { 'bip137-mode': 'sloppy' },
    });
    expect(() => phase5CheckConfig(template, 'crypto_wallet_address_comparison')).toThrow(
      InvalidCheckConfigError,
    );
  });

  it('gives a check without a schema an empty config', () => {
    expect(
      phase5CheckConfig(templateOf(['phone_number_otp_comparison']), 'phone_number_otp_comparison'),
    ).toEqual({ values: {}, basis: {} });
    expect(phase5CheckConfig({ checks: {} }, 'email_address_disposable_detection')).toEqual({
      values: { 'allow-domains': [], 'deny-domains': [] },
      basis: { 'allow-domains': 'provisional', 'deny-domains': 'provisional' },
    });
  });
});

describe('phase5ResultOptions, booleanIn and stringListIn', () => {
  const config = {
    values: { 'allow-high-s': false, 'bip137-mode': 'loose', 'deny-domains': ['x.example'] },
    basis: { 'bip137-mode': 'provisional' as const },
  };

  it('records the thresholds of the keys judged and the basis of the defaults among them', () => {
    expect(phase5ResultOptions(config, ['allow-high-s', 'bip137-mode', 'absent'])).toEqual({
      thresholds: { 'allow-high-s': false, 'bip137-mode': 'loose' },
      thresholdBasis: { 'bip137-mode': 'provisional' },
    });
    expect(
      phase5ResultOptions(config, ['allow-high-s'], {
        provider: { id: 'sandbox', sandbox: true },
        thresholds: { 'allowed-chains': ['eip155:1'] },
      }),
    ).toEqual({
      provider: { id: 'sandbox', sandbox: true },
      thresholds: { 'allow-high-s': false, 'allowed-chains': ['eip155:1'] },
      thresholdBasis: {},
    });
  });

  it('reads a boolean or a string list, with a fallback when the key is absent or of another type', () => {
    expect(booleanIn(config, 'allow-high-s', true)).toBe(false);
    expect(booleanIn(config, 'absent', true)).toBe(true);
    expect(booleanIn(config, 'bip137-mode', true)).toBe(true);
    expect(stringListIn(config, 'deny-domains')).toEqual(['x.example']);
    expect(stringListIn(config, 'absent')).toEqual([]);
    expect(stringListIn(config, 'bip137-mode')).toEqual([]);
  });
});

describe('enabledChecksOf', () => {
  it('lists the enabled checks of the type in configuration order', () => {
    const template = templateOf([
      'email_address_mx_detection',
      'email_address_otp_comparison',
      'email_address_disposable_detection',
    ]);
    const otp = template.checks.email_address_otp_comparison;
    if (otp !== undefined) {
      otp.enabled = false;
    }
    expect(enabledChecksOf('email_address', template)).toEqual([
      'email_address_mx_detection',
      'email_address_disposable_detection',
    ]);
  });

  it('refuses an unknown check or one of another type, naming it', () => {
    expect(() =>
      enabledChecksOf('email_address', templateOf(['phone_number_otp_comparison'])),
    ).toThrow(InvalidCheckConfigError);
    try {
      enabledChecksOf('crypto_wallet', { checks: { nope: { enabled: false, required: false } } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCheckConfigError);
      expect((error as InvalidCheckConfigError).issues).toEqual([
        { path: 'checks.nope', message: 'unknown check' },
      ]);
    }
  });
});
