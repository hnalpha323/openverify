/**
 * C210.4, C211.5 (Workflow 10B, `api-integrity`): the five device-integrity signals, each a pure
 * function of the facts the `inquiry-signals` job reads. None is decisive alone (C210.5): publish
 * refuses an adverse step that follows from one without a verification outcome in between.
 *
 * **The heuristics** (`device_emulated`, `device_rooted`, `device_hooked`; H, `beta`), from the
 * `android-integrity` member of a consented session's stored bodies (C210.2), each list the union of
 * the session's bodies:
 * - `true`, with the indicator codes as reasons in the contracts' order and a confidence that grows
 *   with the number of independent families the codes were read from ({@link indicatorFamily}:
 *   the build properties, the files and mounts, the process), `DEVICE_INTEGRITY_CONSTANTS`;
 * - `null` with `no_indicator_found` (the probes ran and found nothing: a clean probe is never "not
 *   rooted", C210.6), `not_android` (a session that sent only web bodies) or `collector_missing` (an
 *   Android session whose bodies never carried the list: its probes did not run);
 * - never `false`. A code outside the signal's own list is dropped, never read.
 *
 * **Play Integrity's two** (`device_integrity_level`, `app_recognized`; A, `beta`), from the inquiry's
 * stored verdict projection (C211.4):
 * - a token bound to another request, package or time (a server check failed), or a decode that gave
 *   no verdict: `null` with `integrity_decode_failed`;
 * - the level is the strongest device label (`strong`, `device`, `basic`), else `none`;
 * - `app_recognized` is `true` for `PLAY_RECOGNIZED` with the operator's certificate digest, `false`
 *   for an unrecognised version or another certificate, and `null` with `integrity_unevaluated` for
 *   `UNEVALUATED`, never `false` (C211.5; review V09: an adverse cause, so a gap that needs review);
 * - with no verdict: `provider_not_configured` when no provider is bound, `collector_missing` while a
 *   posted token waits for its decode, and otherwise the sessions' own answer: their collector gap
 *   (`consent_not_given`, `collection_disabled`, ...), `integrity_token_unavailable` when an Android
 *   session sent no token (the host installed no provider, or it gave nothing), `not_android` when only
 *   web sessions collected.
 * Every answer read with a provider bound names it in `sources` (C90.3: the adapter and whether it is
 * the sandbox).
 */
import { DEVICE_INTEGRITY_CONSTANTS, type SignalName } from '@openverify/core';
import type { AndroidIndicatorList, SessionEvidence } from './evidence.js';
import type {
  AndroidIntegrityInput,
  DeviceIntegrityInput,
  IntegrityDeviceLabel,
  IntegrityVerdictProjection,
} from './inputs.js';
import { constantValue } from './network-facts.js';
import type { SignalEvidenceReason, SignalNullReason, SignalSourceRef } from './vocabulary.js';

/** The three heuristic signals and the `android-integrity` list each reads (C210.2). */
export const DEVICE_INDICATOR_MEMBERS = Object.freeze({
  'inquiry/device_emulated': 'emulator-indicators',
  'inquiry/device_rooted': 'root-indicators',
  'inquiry/device_hooked': 'hooking-indicators',
} as const satisfies Partial<
  Record<SignalName, keyof AndroidIntegrityInput & AndroidIndicatorList>
>);
export type DeviceIndicatorSignal = keyof typeof DEVICE_INDICATOR_MEMBERS;

/** Where an indicator is read on the device: the independent families of C210.4's confidence. */
export type IndicatorFamily = 'build-properties' | 'files-and-mounts' | 'process';

/**
 * C210.2, C210.3: each list's codes in the contracts' order (`ANDROID_*_INDICATORS`, which the test
 * reads), with the family its probe reads: the `Build` fields and system properties; the file
 * system and the mount table; the app's own process (its memory map, thread names, class loader,
 * stack and native libraries).
 */
export const INDICATOR_CODES: Readonly<
  Record<AndroidIndicatorList, readonly (readonly [SignalEvidenceReason, IndicatorFamily])[]>
> = Object.freeze({
  'emulator-indicators': [
    ['build_hardware_goldfish_or_ranchu', 'build-properties'],
    ['build_product_sdk', 'build-properties'],
    ['build_model_emulator', 'build-properties'],
    ['qemu_property', 'build-properties'],
    ['qemu_device_file', 'files-and-mounts'],
    ['no_telephony_and_generic_board', 'build-properties'],
  ],
  'root-indicators': [
    ['su_binary_on_path', 'files-and-mounts'],
    ['build_tags_test_keys', 'build-properties'],
    ['system_mounted_rw', 'files-and-mounts'],
    ['magisk_mount_trace', 'files-and-mounts'],
    ['ro_debuggable_and_not_secure', 'build-properties'],
  ],
  'hooking-indicators': [
    ['frida_in_process_maps', 'process'],
    ['frida_thread_name', 'process'],
    ['xposed_bridge_loadable', 'process'],
    ['xposed_in_stack_trace', 'process'],
    ['unexpected_native_library', 'process'],
  ],
});

const FAMILIES: ReadonlyMap<string, IndicatorFamily> = new Map(
  Object.values(INDICATOR_CODES).flatMap((codes) => codes.map(([code, family]) => [code, family])),
);

/** The family of an indicator code, or `null` for a code outside C210.2's lists. */
export function indicatorFamily(code: string): IndicatorFamily | null {
  return FAMILIES.get(code) ?? null;
}

const FAMILY_CONFIDENCE = [
  'confidence-one-family',
  'confidence-two-families',
  'confidence-three-families',
] as const;

/**
 * C210.4: the confidence of a `true` value from its indicator codes: by the number of independent
 * families they come from (`DEVICE_INTEGRITY_CONSTANTS`, provisional); 0 for no known code.
 */
export function indicatorConfidence(codes: readonly string[]): number {
  const families = new Set(codes.flatMap((code) => FAMILIES.get(code) ?? []));
  const key = FAMILY_CONFIDENCE[Math.min(families.size, FAMILY_CONFIDENCE.length) - 1];
  return key === undefined ? 0 : constantValue(DEVICE_INTEGRITY_CONSTANTS, key);
}

/** One session's answer for a heuristic: its codes in contract order, or why it has none. */
export type SessionIndicators =
  | { readonly codes: readonly SignalEvidenceReason[]; readonly reason: null }
  | { readonly codes: null; readonly reason: SignalNullReason };

/** C210.4: what one consented session's evidence says for `signal`. */
export function sessionIndicators(
  evidence: SessionEvidence,
  signal: DeviceIndicatorSignal,
): SessionIndicators {
  if (!evidence.android) {
    return { codes: null, reason: 'not_android' };
  }
  const list = DEVICE_INDICATOR_MEMBERS[signal];
  const sent = evidence.androidIntegrity?.[list] ?? null;
  if (sent === null) {
    return { codes: null, reason: 'collector_missing' };
  }
  const codes = INDICATOR_CODES[list].flatMap(([code]) => (sent.includes(code) ? [code] : []));
  return codes.length === 0
    ? { codes: null, reason: 'no_indicator_found' }
    : { codes, reason: null };
}

/** The codes of every session in contract order (C210.4: a `true` value's reasons). */
export function joinedIndicators(
  signal: DeviceIndicatorSignal,
  sessions: readonly (readonly string[])[],
): SignalEvidenceReason[] {
  const seen = new Set(sessions.flat());
  return INDICATOR_CODES[DEVICE_INDICATOR_MEMBERS[signal]].flatMap(([code]) =>
    seen.has(code) ? [code] : [],
  );
}

/** C211.5: the Play Integrity signals. */
export type PlayIntegritySignal = 'inquiry/device_integrity_level' | 'inquiry/app_recognized';

/** What a Play Integrity signal reads from a verdict: its value, or why it has none. */
export type VerdictReading =
  | { readonly value: string | boolean; readonly nullReason: null }
  | { readonly value: null; readonly nullReason: SignalNullReason };

const LEVELS: readonly (readonly [IntegrityDeviceLabel, string])[] = [
  ['MEETS_STRONG_INTEGRITY', 'strong'],
  ['MEETS_DEVICE_INTEGRITY', 'device'],
  ['MEETS_BASIC_INTEGRITY', 'basic'],
];

/** C211.4, C211.5: what one signal reads from a stored verdict's projection. */
export function verdictReading(
  signal: PlayIntegritySignal,
  projection: IntegrityVerdictProjection,
): VerdictReading {
  const { checks } = projection;
  if (
    projection.outcome !== 'decoded' ||
    !checks['package-name'] ||
    !checks['request-hash'] ||
    !checks.timestamp
  ) {
    return { value: null, nullReason: 'integrity_decode_failed' };
  }
  if (signal === 'inquiry/device_integrity_level') {
    const labels = new Set(projection['device-recognition']);
    return {
      value: LEVELS.find(([label]) => labels.has(label))?.[1] ?? 'none',
      nullReason: null,
    };
  }
  const recognition = projection['app-recognition'];
  if (recognition === null) {
    return { value: null, nullReason: 'integrity_decode_failed' };
  }
  if (recognition === 'UNEVALUATED') {
    return { value: null, nullReason: 'integrity_unevaluated' };
  }
  return {
    value: recognition === 'PLAY_RECOGNIZED' && checks['certificate-digest'],
    nullReason: null,
  };
}

/** C90.3: the provenance of a Play Integrity answer: the provider and whether it is the sandbox. */
export function integritySources(input: DeviceIntegrityInput): SignalSourceRef[] {
  if (input.verdict !== null) {
    return [
      {
        kind: 'provider',
        provider: input.verdict.provider,
        sandbox: input.verdict.provider === 'sandbox',
      },
    ];
  }
  return input.provider === null
    ? []
    : [{ kind: 'provider', provider: input.provider.name, sandbox: input.provider.sandbox }];
}
