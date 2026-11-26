/**
 * The signal vocabularies the computations write (plan C90.3, C90.5, ADR 0006), mirrored from
 * `@openverify/contracts` (`packages/contracts/src/signals.ts`), which `@openverify/checks` does
 * not depend on. `vocabulary.test.ts` reads the contracts source and fails when a mirror drifts,
 * so the frozen enums stay the one source of truth.
 *
 * The output shapes ({@link SignalDetailEntry}, {@link InquirySignalsResult}) are the contracts'
 * `signal-details` entry and `signals` array, which the API validates with `signalDetailsSchema`
 * and `signalAttributeIssues` before it stores them.
 */
import type { CheckStage, SignalName, SignalTier } from '@openverify/core';

/** C90.3: why a signal is `null` (the contracts' `SIGNAL_NULL_REASONS`). */
export const SIGNAL_NULL_REASONS = [
  'signals_not_collected',
  'collector_missing',
  'collection_disabled',
  'consent_not_given',
  'list_unavailable',
  'list_stale',
  'provider_not_configured',
  'not_in_known_ranges',
  'not_in_provider_data',
  'client_address_untrusted',
  'address_not_public',
  'ipv6_not_covered',
  'location_too_coarse',
  'input_missing',
  'fingerprint_randomised',
  'insufficient_behaviour',
  'insufficient_sessions',
  'sessions_not_evaluated',
  'ip_country_unreliable',
  'list_screening_pending',
  'list_unscreened',
  'no_lists_selected',
  'not_yet_collected',
  'no_indicator_found',
  'not_android',
  'integrity_token_unavailable',
  'integrity_unevaluated',
  'integrity_decode_failed',
] as const;
export type SignalNullReason = (typeof SIGNAL_NULL_REASONS)[number];

/** C90.3: the reasons beside a non-null value (the contracts' `SIGNAL_EVIDENCE_REASONS`). */
export const SIGNAL_EVIDENCE_REASONS = [
  'tor_exit_listed',
  'provider_range',
  'hosting_asn',
  'vpn_asn',
  'proxy_flagged',
  'adapter_negative',
  'vpn_list_not_exhaustive',
  'proxy_not_evaluated',
  'approximate',
  'no_artefact_found',
  'partial_sessions',
  'sandbox_outcome',
  'webdriver',
  'driver_globals',
  'ua_headless_marker',
  'untrusted_events',
  'zero_window_with_focus',
  'plugins_inconsistent',
  'mime_inconsistent',
  'native_function_tampered',
  'ua_client_hints_mismatch',
  'language_mismatch',
  'timezone_country_mismatch',
  'uniform_typing_cadence',
  'fast_screens',
  'no_pointer_travel',
  'paste_into_identity_field',
  'autofill_into_identity_field',
  'many_focus_losses',
  'long_hidden_periods',
  'build_hardware_goldfish_or_ranchu',
  'build_product_sdk',
  'build_model_emulator',
  'qemu_property',
  'qemu_device_file',
  'no_telephony_and_generic_board',
  'su_binary_on_path',
  'build_tags_test_keys',
  'system_mounted_rw',
  'magisk_mount_trace',
  'ro_debuggable_and_not_secure',
  'frida_in_process_maps',
  'frida_thread_name',
  'xposed_bridge_loadable',
  'xposed_in_stack_trace',
  'unexpected_native_library',
  'android_debugger_connected',
  'android_app_debuggable',
] as const;
export type SignalEvidenceReason = (typeof SIGNAL_EVIDENCE_REASONS)[number];

/**
 * C90.7 (V01): the null reasons whose `on-null` default is `needs_review`, a data or collection
 * gap (the contracts' `ON_NULL_DEFAULTS`). Where several reasons compete for one value, a gap is
 * named first, so a review rule's default sees it.
 */
export const GAP_NULL_REASONS: readonly SignalNullReason[] = Object.freeze([
  'collector_missing',
  'list_unavailable',
  'list_stale',
  'provider_not_configured',
  'client_address_untrusted',
  'integrity_unevaluated',
  'integrity_decode_failed',
]);

/** Whether `reason` is a data or collection gap (`on-null` default `needs_review`). */
export function isGapNullReason(reason: SignalNullReason): boolean {
  return GAP_NULL_REASONS.includes(reason);
}

/** A source a network-derived value read (the contracts' `signalSourceSchema`). */
export type SignalSourceRef =
  | {
      readonly kind: 'sync';
      readonly 'source-id': string;
      readonly 'sync-id': string;
      readonly 'published-at': string;
      readonly sha256: string;
    }
  | { readonly kind: 'provider'; readonly provider: string; readonly sandbox: boolean };

/** C90.4: one session's own reason inside a combined value. */
export interface SignalSessionReason {
  readonly 'session-id': string;
  readonly 'null-reason': SignalNullReason | null;
}

/** A signal value: the JSON types C90.1 allows. */
export type SignalValueOf = boolean | number | string | null;

/** One entry of the public `signals` array. */
export interface SignalValueEntry {
  readonly name: SignalName;
  readonly value: SignalValueOf;
}

/**
 * C90.5: one `signal-details` entry. An H-tier or combined entry carries `confidence` (`null`
 * only beside a `null` value) and `thresholds`; an R or A entry carries no confidence.
 */
export interface SignalDetailEntry {
  readonly tier: SignalTier;
  readonly stage: CheckStage;
  readonly version: number;
  readonly confidence?: number | null;
  readonly thresholds?: Readonly<Record<string, number>>;
  readonly 'null-reason': SignalNullReason | null;
  readonly reasons: readonly SignalEvidenceReason[];
  readonly sources?: readonly SignalSourceRef[];
  readonly sessions?: readonly SignalSessionReason[];
  readonly 'computed-at': string;
}

/**
 * C90.5: the `signal-details` map: one entry per signal, plus `computed-at`. The signals job adds
 * `review` when it applies `on-signal` (C90.7).
 */
export type SignalDetailsMap = { readonly 'computed-at': string } & Readonly<
  Record<SignalName, SignalDetailEntry>
>;

/** C90.5: what `computeInquirySignals` returns, ready for the inquiry row. */
export interface InquirySignalsResult {
  readonly signals: readonly SignalValueEntry[];
  readonly details: SignalDetailsMap;
}
