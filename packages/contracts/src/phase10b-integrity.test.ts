/**
 * Phase 10, Workflow 10B Stage 1a (contracts-10b), family (I): the device-integrity contracts. The
 * three closed indicator lists in Android's `android-integrity` member (C210.2, never
 * `integrity.android`, rule 22), the session's `integrity { request }` and the challenge and token
 * routes (C211.3), the provider names and the sandbox's magic tokens (C211.4), and the null and
 * evidence reasons the five signals and the debugger facts give (C210.4, C211.5; Phase 7 C94.7, C94.8).
 */
import { describe, expect, it } from 'vitest';
import {
  ANDROID_EMULATOR_INDICATORS,
  ANDROID_HOOKING_INDICATORS,
  ANDROID_ROOT_INDICATORS,
  DEVICE_INTEGRITY_PROVIDERS,
  flowIntegrityChallengeBodySchema,
  flowIntegrityChallengeSchema,
  flowIntegrityTokenBodySchema,
  flowSessionIntegritySchema,
  SANDBOX_INTEGRITY_TOKENS,
} from './flow-integrity.js';
import { flowSignalsSchema } from './flow-signals.js';
import { ON_NULL_DEFAULTS, SIGNAL_EVIDENCE_REASONS, SIGNAL_NULL_REASONS } from './signals.js';
import { readFixture } from './test-support.js';

const android = {
  platform: 'android',
  'collector-version': 1,
  screen: 'consent',
  sequence: 0,
  'android-integrity': { 'debugger-connected': false, 'app-debuggable': false },
};

describe('the android-integrity indicators (C210.2)', () => {
  it('are the three closed lists of the plan, none in two lists', () => {
    expect(ANDROID_EMULATOR_INDICATORS).toEqual([
      'build_hardware_goldfish_or_ranchu',
      'build_product_sdk',
      'build_model_emulator',
      'qemu_property',
      'qemu_device_file',
      'no_telephony_and_generic_board',
    ]);
    expect(ANDROID_ROOT_INDICATORS).toEqual([
      'su_binary_on_path',
      'build_tags_test_keys',
      'system_mounted_rw',
      'magisk_mount_trace',
      'ro_debuggable_and_not_secure',
    ]);
    expect(ANDROID_HOOKING_INDICATORS).toEqual([
      'frida_in_process_maps',
      'frida_thread_name',
      'xposed_bridge_loadable',
      'xposed_in_stack_trace',
      'unexpected_native_library',
    ]);
  });

  it('ride in android-integrity, each list optional, closed, unique and at most 12', () => {
    const integrity = {
      ...android['android-integrity'],
      'emulator-indicators': ['qemu_property', 'build_product_sdk'],
      'root-indicators': [],
      'hooking-indicators': ['frida_thread_name'],
    };
    expect(
      flowSignalsSchema.safeParse({ ...android, 'android-integrity': integrity }).success,
    ).toBe(true);
    expect(flowSignalsSchema.safeParse(android).success).toBe(true);
    for (const refused of [
      { 'emulator-indicators': ['su_binary_on_path'] },
      { 'root-indicators': ['rooted_somehow'] },
      { 'hooking-indicators': ['frida_thread_name', 'frida_thread_name'] },
      { 'emulator-indicators': Array.from({ length: 13 }, () => 'qemu_property') },
    ]) {
      const body = {
        ...android,
        'android-integrity': { ...android['android-integrity'], ...refused },
      };
      expect(flowSignalsSchema.safeParse(body).success, JSON.stringify(refused)).toBe(false);
    }
    expect(
      flowSignalsSchema.safeParse({
        ...android,
        integrity: { android: { 'emulator-indicators': [] } },
      }).success,
    ).toBe(false);
  });
});

describe('the Play Integrity routes and the session member (C211.3)', () => {
  it('serves integrity { request } on the session', () => {
    expect(flowSessionIntegritySchema.parse({ request: true })).toEqual({ request: true });
    expect(flowSessionIntegritySchema.safeParse({ request: true, verdict: 'strong' }).success).toBe(
      false,
    );
  });

  it('takes an empty challenge body and answers its id, request-hash and expiry', () => {
    expect(flowIntegrityChallengeBodySchema.safeParse({}).success).toBe(true);
    expect(flowIntegrityChallengeBodySchema.safeParse({ nonce: 'x' }).success).toBe(false);
    const answer = {
      id: 'ich_01M5CK3190XEVBM5ZXA76E1JSM',
      'request-hash': 'syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'expires-at': '2026-11-09T12:10:00.000Z',
    };
    expect(flowIntegrityChallengeSchema.parse(answer)).toEqual(answer);
    expect(
      flowIntegrityChallengeSchema.safeParse({ ...answer, id: 'chc_01M5CK3190XEVBM5ZXA76E1JSM' })
        .success,
    ).toBe(false);
    expect(
      flowIntegrityChallengeSchema.safeParse({ ...answer, 'request-hash': 'not+base64url=' })
        .success,
    ).toBe(false);
  });

  it('takes a token of at most 16 KiB with its challenge', () => {
    const body = { 'challenge-id': 'ich_01M5CK3190XEVBM5ZXA76E1JSM', token: 'sandbox-strong' };
    expect(flowIntegrityTokenBodySchema.parse(body)).toEqual(body);
    expect(
      flowIntegrityTokenBodySchema.safeParse({ ...body, token: 'a'.repeat(16 * 1024 + 1) }).success,
    ).toBe(false);
    expect(flowIntegrityTokenBodySchema.safeParse({ ...body, token: '' }).success).toBe(false);
  });

  it('names the providers of the device-integrity kind and the sandbox magic tokens (C211.4)', () => {
    expect(DEVICE_INTEGRITY_PROVIDERS).toEqual(['play-integrity', 'sandbox']);
    expect(SANDBOX_INTEGRITY_TOKENS).toEqual([
      'sandbox-strong',
      'sandbox-device',
      'sandbox-basic',
      'sandbox-none',
      'sandbox-unrecognized-app',
      'sandbox-replayed',
    ]);
  });
});

describe('the reasons (C210.4, C211.5, review V09; Phase 7 C94.7, C94.8 amended)', () => {
  it('adds the five null reasons with their classes', () => {
    expect(SIGNAL_NULL_REASONS).toEqual(
      expect.arrayContaining([
        'no_indicator_found',
        'not_android',
        'integrity_token_unavailable',
        'integrity_unevaluated',
        'integrity_decode_failed',
      ]),
    );
    const classes: Readonly<Record<string, string>> = ON_NULL_DEFAULTS;
    expect(
      Object.fromEntries(
        [
          'no_indicator_found',
          'not_android',
          'integrity_token_unavailable',
          'integrity_unevaluated',
          'integrity_decode_failed',
        ].map((reason) => [reason, classes[reason]]),
      ),
    ).toEqual({
      no_indicator_found: 'ignore',
      not_android: 'ignore',
      integrity_token_unavailable: 'ignore',
      integrity_unevaluated: 'needs_review',
      integrity_decode_failed: 'needs_review',
    });
  });

  it('gives every indicator code and both debugger facts an evidence reason', () => {
    expect(SIGNAL_EVIDENCE_REASONS).toEqual(
      expect.arrayContaining([
        ...ANDROID_EMULATOR_INDICATORS,
        ...ANDROID_ROOT_INDICATORS,
        ...ANDROID_HOOKING_INDICATORS,
        'android_debugger_connected',
        'android_app_debuggable',
      ]),
    );
    expect(ANDROID_EMULATOR_INDICATORS.length).toBeGreaterThan(0);
  });
});

describe('contracts/fixtures/api/flow-integrity-challenge.json (C211.3)', () => {
  it('is a challenge answer', () => {
    const raw = readFixture('api/flow-integrity-challenge.json');
    expect(flowIntegrityChallengeSchema.parse(raw)).toEqual(raw);
  });
});
