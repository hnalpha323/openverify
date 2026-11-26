/**
 * C210.4, C211.5 (Workflow 10B, `api-integrity`): the five device-integrity signals from the stored
 * `android-integrity` member and the inquiry's Play Integrity verdict, combined across sessions by
 * Phase 7's rules.
 *
 * - The heuristics (`device_emulated`, `device_rooted`, `device_hooked`) are `true` with their
 *   indicator codes as reasons and a confidence that grows with the independent families the codes
 *   come from, or `null` with `no_indicator_found` (the probes ran and found nothing),
 *   `not_android` (a web session) or `collector_missing` (an Android body without the list), and
 *   never `false`: a clean probe is never "not rooted" (C210.6).
 * - Play Integrity's two (`device_integrity_level`, `app_recognized`) map the verdict's projection,
 *   `UNEVALUATED` to `null` (`integrity_unevaluated`) and never `false`, a failed or unbound decode to
 *   `integrity_decode_failed`, no token to `integrity_token_unavailable`, an unbound provider to
 *   `provider_not_configured`; every answer read from a provider names it in `sources` (C90.3).
 *
 * Every session, code and verdict here is synthetic.
 */
import { readFileSync } from 'node:fs';
import { DEVICE_INTEGRITY_CONSTANTS, type SignalName } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { computeInquirySignals } from './compute.js';
import {
  DEVICE_INDICATOR_MEMBERS,
  indicatorConfidence,
  indicatorFamily,
} from './device-integrity.js';
import type {
  AndroidIntegrityInput,
  DeviceIntegrityInput,
  InquirySignalsInput,
  IntegrityVerdictProjection,
  SignalBodyInput,
  SignalSessionInput,
} from './inputs.js';
import { constantValue } from './network-facts.js';
import { integrity, session, webBody } from './testing.js';
import type { InquirySignalsResult, SignalDetailEntry } from './vocabulary.js';

const COMPUTED_AT = new Date('2026-11-09T12:30:00.000Z');

const run = (overrides: Partial<InquirySignalsInput> = {}): InquirySignalsResult =>
  computeInquirySignals({
    environment: 'production',
    collect: 'default',
    computedAt: COMPUTED_AT,
    sessions: [],
    governmentIdCountry: null,
    ...overrides,
  });

const valueOf = (result: InquirySignalsResult, name: SignalName) =>
  result.signals.find((signal) => signal.name === name)?.value;
const detailOf = (result: InquirySignalsResult, name: SignalName): SignalDetailEntry | undefined =>
  result.details[name];

/** An Android body with the debugger facts false and the lists given. */
const androidBody = (
  sequence: number,
  facts: Partial<AndroidIntegrityInput> = {},
): SignalBodyInput => ({
  screen: `step_${String(sequence)}`,
  screenType: 'consent',
  sequence,
  platform: 'android',
  androidIntegrity: { 'debugger-connected': false, 'app-debuggable': false, ...facts },
  deviceClass: 'smartphone',
});

const android = (
  id: string,
  bodies: SignalBodyInput[],
  overrides: Partial<SignalSessionInput> = {},
  minutes = 0,
) => session(id, { userAgent: 'OpenVerify-Android/0.1.0', bodies, ...overrides }, minutes);

const web = (id: string, minutes = 0) =>
  session(id, { bodies: [webBody(1, { integrity: integrity() })] }, minutes);

const CLEAN = {
  'emulator-indicators': [],
  'root-indicators': [],
  'hooking-indicators': [],
} as const;

const confidence = (key: string) => constantValue(DEVICE_INTEGRITY_CONSTANTS, key);

/** The quoted members of `export const <name> = Object.freeze([ ... ]` in the contracts source. */
function contractList(name: string): string[] {
  const source = readFileSync(
    new URL('../../../contracts/src/flow-signals.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf(`export const ${name} = Object.freeze([`);
  const end = source.indexOf(']', start);
  expect(start).toBeGreaterThan(-1);
  return [...source.slice(start, end).matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1] ?? '');
}

describe('the indicator families (C210.4)', () => {
  it('places every code of the contract lists in one family, and nothing else', () => {
    const codes = [
      ...contractList('ANDROID_EMULATOR_INDICATORS'),
      ...contractList('ANDROID_ROOT_INDICATORS'),
      ...contractList('ANDROID_HOOKING_INDICATORS'),
    ];
    expect(codes).toHaveLength(16);
    for (const code of codes) {
      expect(indicatorFamily(code), code).not.toBeNull();
    }
    expect(indicatorFamily('webdriver')).toBeNull();
    expect(indicatorFamily('build_tags_release_keys')).toBeNull();
  });

  it('reads the files, the mounts and the build properties apart from the process', () => {
    expect(indicatorFamily('build_hardware_goldfish_or_ranchu')).toBe('build-properties');
    expect(indicatorFamily('qemu_property')).toBe('build-properties');
    expect(indicatorFamily('qemu_device_file')).toBe('files-and-mounts');
    expect(indicatorFamily('su_binary_on_path')).toBe('files-and-mounts');
    expect(indicatorFamily('magisk_mount_trace')).toBe('files-and-mounts');
    expect(indicatorFamily('frida_in_process_maps')).toBe('process');
    expect(indicatorFamily('xposed_bridge_loadable')).toBe('process');
  });

  it('grows the confidence with the families, from the registry constants', () => {
    expect(indicatorConfidence(['build_product_sdk'])).toBe(confidence('confidence-one-family'));
    expect(indicatorConfidence(['build_product_sdk', 'build_model_emulator'])).toBe(
      confidence('confidence-one-family'),
    );
    expect(indicatorConfidence(['build_product_sdk', 'qemu_device_file'])).toBe(
      confidence('confidence-two-families'),
    );
    expect(
      indicatorConfidence(['build_tags_test_keys', 'su_binary_on_path', 'frida_thread_name']),
    ).toBe(confidence('confidence-three-families'));
    expect(confidence('confidence-three-families')).toBeLessThan(1);
  });
});

describe('the device heuristics (C210.4)', () => {
  it('golden: an emulator is true with its codes in contract order and a two-family confidence', () => {
    const result = run({
      sessions: [
        android('iqse_a', [
          androidBody(1, {
            ...CLEAN,
            'emulator-indicators': ['qemu_device_file', 'build_hardware_goldfish_or_ranchu'],
          }),
        ]),
      ],
    });

    expect(valueOf(result, 'inquiry/device_emulated')).toBe(true);
    expect(detailOf(result, 'inquiry/device_emulated')).toMatchObject({
      tier: 'H',
      stage: 'beta',
      version: 1,
      confidence: confidence('confidence-two-families'),
      'null-reason': null,
      reasons: ['build_hardware_goldfish_or_ranchu', 'qemu_device_file'],
      sessions: [{ 'session-id': 'iqse_a', 'null-reason': null }],
    });
    expect(valueOf(result, 'inquiry/device_rooted')).toBeNull();
    expect(detailOf(result, 'inquiry/device_rooted')).toMatchObject({
      confidence: null,
      'null-reason': 'no_indicator_found',
      reasons: [],
    });
  });

  it('golden: a clean device is never false: every heuristic is null with no_indicator_found', () => {
    const result = run({ sessions: [android('iqse_a', [androidBody(1, CLEAN)])] });

    for (const name of Object.keys(DEVICE_INDICATOR_MEMBERS) as SignalName[]) {
      expect(valueOf(result, name), name).toBeNull();
      expect(detailOf(result, name)?.['null-reason'], name).toBe('no_indicator_found');
    }
  });

  it('golden: a list the device did not send reads collector_missing, a web session not_android', () => {
    const result = run({
      sessions: [android('iqse_a', [androidBody(1, { 'root-indicators': [] })]), web('iqse_b', 5)],
    });

    expect(detailOf(result, 'inquiry/device_hooked')).toMatchObject({
      'null-reason': 'sessions_not_evaluated',
      sessions: [
        { 'session-id': 'iqse_a', 'null-reason': 'collector_missing' },
        { 'session-id': 'iqse_b', 'null-reason': 'not_android' },
      ],
    });
    const webOnly = run({ sessions: [web('iqse_c')] });
    expect(detailOf(webOnly, 'inquiry/device_emulated')?.['null-reason']).toBe('not_android');
  });

  it('golden: the codes of every body and every Android session are joined, and any true wins', () => {
    const result = run({
      sessions: [
        android('iqse_a', [
          androidBody(1, { ...CLEAN, 'hooking-indicators': ['frida_thread_name'] }),
          androidBody(2, { ...CLEAN, 'hooking-indicators': ['frida_in_process_maps'] }),
        ]),
        android('iqse_b', [androidBody(1, CLEAN)], {}, 5),
        web('iqse_c', 10),
      ],
    });

    expect(valueOf(result, 'inquiry/device_hooked')).toBe(true);
    expect(detailOf(result, 'inquiry/device_hooked')).toMatchObject({
      confidence: confidence('confidence-one-family'),
      reasons: ['frida_in_process_maps', 'frida_thread_name'],
    });
  });

  it('reads nothing before consent or outside the session-integrity tier', () => {
    const body = [androidBody(1, { ...CLEAN, 'root-indicators': ['su_binary_on_path'] })];

    expect(
      detailOf(
        run({ sessions: [android('iqse_a', body, { consented: false })] }),
        'inquiry/device_rooted',
      )?.['null-reason'],
    ).toBe('consent_not_given');
    expect(
      detailOf(
        run({ sessions: [android('iqse_a', body, { signalsCollected: [] })] }),
        'inquiry/device_rooted',
      )?.['null-reason'],
    ).toBe('collection_disabled');
  });

  it('drops a code outside its own list rather than reading it', () => {
    const result = run({
      sessions: [
        android('iqse_a', [
          androidBody(1, {
            ...CLEAN,
            'root-indicators': ['frida_thread_name', 'build_tags_test_keys'],
          }),
        ]),
      ],
    });

    expect(detailOf(result, 'inquiry/device_rooted')?.reasons).toEqual(['build_tags_test_keys']);
    expect(detailOf(result, 'inquiry/device_hooked')?.['null-reason']).toBe('no_indicator_found');
  });
});

const projection = (
  overrides: Partial<IntegrityVerdictProjection> = {},
): IntegrityVerdictProjection => ({
  outcome: 'decoded',
  'device-recognition': ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'],
  'app-recognition': 'PLAY_RECOGNIZED',
  checks: {
    'package-name': true,
    'request-hash': true,
    timestamp: true,
    'app-recognized': true,
    'certificate-digest': true,
  },
  'decoded-at': '2026-11-09T12:10:00.000Z',
  ...overrides,
});

const SANDBOX = { name: 'sandbox', sandbox: true } as const;
const PLAY = { name: 'play-integrity', sandbox: false } as const;

const withIntegrity = (
  deviceIntegrity: DeviceIntegrityInput | undefined,
  sessions: SignalSessionInput[] = [android('iqse_a', [androidBody(1, CLEAN)])],
) => run({ sessions, ...(deviceIntegrity === undefined ? {} : { deviceIntegrity }) });

const decoded = (
  overrides: Partial<IntegrityVerdictProjection> = {},
  provider: { name: string; sandbox: boolean } = SANDBOX,
): DeviceIntegrityInput => ({
  provider,
  tokenPending: false,
  verdict: { provider: provider.name, projection: projection(overrides) },
});

describe('the Play Integrity signals (C211.5)', () => {
  it('golden: a decoded verdict gives the level and the app recognition, naming the provider', () => {
    const result = withIntegrity(decoded({}, PLAY));

    expect(valueOf(result, 'inquiry/device_integrity_level')).toBe('device');
    expect(valueOf(result, 'inquiry/app_recognized')).toBe(true);
    for (const name of ['inquiry/device_integrity_level', 'inquiry/app_recognized'] as const) {
      const detail = detailOf(result, name);
      expect(detail).toMatchObject({
        tier: 'A',
        stage: 'beta',
        version: 1,
        'null-reason': null,
        reasons: [],
        sources: [{ kind: 'provider', provider: 'play-integrity', sandbox: false }],
      });
      expect(detail, `${name} is A-tier: no confidence`).not.toHaveProperty('confidence');
    }
  });

  it('maps the strongest label to the level, and no label to none', () => {
    const level = (labels: IntegrityVerdictProjection['device-recognition']) =>
      valueOf(
        withIntegrity(decoded({ 'device-recognition': labels })),
        'inquiry/device_integrity_level',
      );

    expect(
      level(['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY']),
    ).toBe('strong');
    expect(level(['MEETS_BASIC_INTEGRITY'])).toBe('basic');
    expect(level(['MEETS_VIRTUAL_INTEGRITY'])).toBe('none');
    expect(level([])).toBe('none');
  });

  it('maps UNEVALUATED to null with integrity_unevaluated, never false', () => {
    const result = withIntegrity(
      decoded({
        'app-recognition': 'UNEVALUATED',
        checks: { ...projection().checks, 'app-recognized': false },
      }),
    );

    expect(valueOf(result, 'inquiry/app_recognized')).toBeNull();
    expect(detailOf(result, 'inquiry/app_recognized')).toMatchObject({
      'null-reason': 'integrity_unevaluated',
      sources: [{ kind: 'provider', provider: 'sandbox', sandbox: true }],
    });
    expect(valueOf(result, 'inquiry/device_integrity_level')).toBe('device');
  });

  it('reads an unrecognised app or a certificate digest that is not the configured one as false', () => {
    expect(
      valueOf(
        withIntegrity(decoded({ 'app-recognition': 'UNRECOGNIZED_VERSION' })),
        'inquiry/app_recognized',
      ),
    ).toBe(false);
    expect(
      valueOf(
        withIntegrity(decoded({ checks: { ...projection().checks, 'certificate-digest': false } })),
        'inquiry/app_recognized',
      ),
    ).toBe(false);
  });

  it('reads a token bound to another request, app or time, and a failed decode, as integrity_decode_failed', () => {
    for (const check of ['package-name', 'request-hash', 'timestamp'] as const) {
      const result = withIntegrity(decoded({ checks: { ...projection().checks, [check]: false } }));
      for (const name of ['inquiry/device_integrity_level', 'inquiry/app_recognized'] as const) {
        expect(valueOf(result, name), `${check} ${name}`).toBeNull();
        expect(detailOf(result, name)?.['null-reason'], `${check} ${name}`).toBe(
          'integrity_decode_failed',
        );
      }
    }
    const failed = withIntegrity(
      decoded({ outcome: 'failed', 'device-recognition': [], 'app-recognition': null }),
    );
    expect(detailOf(failed, 'inquiry/device_integrity_level')).toMatchObject({
      'null-reason': 'integrity_decode_failed',
      sources: [{ kind: 'provider', provider: 'sandbox', sandbox: true }],
    });
  });

  it('golden: provider_not_configured when no provider is bound, with no source', () => {
    const result = withIntegrity({ provider: null, tokenPending: false, verdict: null });

    for (const name of ['inquiry/device_integrity_level', 'inquiry/app_recognized'] as const) {
      expect(detailOf(result, name)?.['null-reason']).toBe('provider_not_configured');
      expect(detailOf(result, name)).not.toHaveProperty('sources');
    }
  });

  it('golden: integrity_token_unavailable when an Android session sent no token', () => {
    const result = withIntegrity({ provider: SANDBOX, tokenPending: false, verdict: null });

    expect(detailOf(result, 'inquiry/app_recognized')).toMatchObject({
      'null-reason': 'integrity_token_unavailable',
      sources: [{ kind: 'provider', provider: 'sandbox', sandbox: true }],
    });
  });

  it('reads a token not yet decoded as collector_missing, a web inquiry as not_android', () => {
    expect(
      detailOf(
        withIntegrity({ provider: PLAY, tokenPending: true, verdict: null }),
        'inquiry/device_integrity_level',
      )?.['null-reason'],
    ).toBe('collector_missing');
    expect(
      detailOf(
        withIntegrity({ provider: PLAY, tokenPending: false, verdict: null }, [web('iqse_a')]),
        'inquiry/device_integrity_level',
      )?.['null-reason'],
    ).toBe('not_android');
  });

  it('reads nothing before consent, and keeps the collector gap when the job read no facts', () => {
    expect(
      detailOf(
        withIntegrity({ provider: SANDBOX, tokenPending: false, verdict: null }, [
          android('iqse_a', [androidBody(1, CLEAN)], { consented: false }),
        ]),
        'inquiry/app_recognized',
      )?.['null-reason'],
    ).toBe('consent_not_given');
    expect(detailOf(withIntegrity(undefined), 'inquiry/app_recognized')?.['null-reason']).toBe(
      'collector_missing',
    );
  });

  it('serves the verdict whatever the sessions say, once one was decoded', () => {
    const result = withIntegrity(decoded({ 'device-recognition': ['MEETS_STRONG_INTEGRITY'] }), [
      web('iqse_a'),
    ]);

    expect(valueOf(result, 'inquiry/device_integrity_level')).toBe('strong');
  });
});
