/**
 * Signals in words (C90, C108; ADR 0006). The console shows what the API recorded, never a
 * verdict: a `null` value reads "Not evaluated" with its reason, never "no"; a low score reads "no
 * automation artefacts found" and a low threat level "no listed risk found", never "human" or
 * "safe". Each vocabulary's test iterates the contracts' list first, so a code added without words
 * fails it.
 */
import type {
  SIGNAL_REVIEW_CAUSES,
  SignalDetail,
  SignalEvidenceReason,
  SignalNullReason,
  SignalValue,
} from '@openverify/contracts';
import { getSignalDefinition, type SignalLayer, type SignalName } from '@openverify/core';

export type SignalReviewCause = (typeof SIGNAL_REVIEW_CAUSES)[number];

/** C90.2: each catalogue signal, in the words the console shows beside its wire name. */
export const SIGNAL_LABELS: Readonly<Record<SignalName, string>> = Object.freeze({
  'inquiry/bot_score': 'Bot score',
  'inquiry/behavior_threat_level': 'Behaviour threat level',
  'inquiry/automation_artefact_count': 'Automation artefacts',
  'inquiry/session_count': 'Sessions',
  'inquiry/network_threat_level': 'Network threat level',
  'inquiry/tor_detected': 'Tor exit',
  'inquiry/datacenter_detected': 'Cloud provider address',
  'inquiry/vpn_detected': 'VPN network',
  'inquiry/proxy_detected': 'Proxy',
  'inquiry/country_from_session': 'Country of the session address',
  'inquiry/country_comparison': 'Session country against the ID',
  'inquiry/max_session_distance': 'Farthest distance between sessions',
  'inquiry/handoff_count': 'Device handoffs',
  'inquiry/list_match_count': 'Open list matches',
  'inquiry/device_emulated': 'Emulator indicators',
  'inquiry/device_rooted': 'Root indicators',
  'inquiry/device_hooked': 'Hooking indicators',
  'inquiry/device_integrity_level': 'Device integrity (Play Integrity)',
  'inquiry/app_recognized': 'App recognized (Play Integrity)',
});

/** C90.1: the layers the Signals section groups by. */
export const SIGNAL_LAYER_LABELS: Readonly<Record<SignalLayer, string>> = Object.freeze({
  network: 'Network',
  device: 'Device',
  behaviour: 'Behaviour',
  handoff: 'Handoff',
  list: 'Lists',
  ensemble: 'Combined',
});

/** C90.3: why a value is `null`, after "Not evaluated:". Never a verdict. */
export const SIGNAL_NULL_REASON_WORDS: Readonly<Record<SignalNullReason, string>> = Object.freeze({
  signals_not_collected: 'no flow session collected signals (an inquiry made through the API)',
  collector_missing: 'the session consented but its collector sent nothing',
  collection_disabled: 'collection is switched off for this environment or template',
  consent_not_given: 'the end user did not consent to this collection',
  list_unavailable: 'the data source is not available',
  list_stale: 'the data source is out of date',
  provider_not_configured: 'no provider is configured',
  not_in_known_ranges: 'not in the lists we hold',
  not_in_provider_data: "not in the provider's data",
  client_address_untrusted:
    'the client address cannot be trusted (the proxy setting trusts every forwarded address)',
  address_not_public: 'the address is not a public address',
  ipv6_not_covered: 'the list does not cover IPv6 addresses',
  location_too_coarse: 'the location is too coarse (no city point)',
  input_missing: 'the input it reads is missing',
  fingerprint_randomised: 'the browser randomises its fingerprint',
  insufficient_behaviour: 'too little behaviour was recorded',
  insufficient_sessions: 'fewer than two sessions have a location',
  sessions_not_evaluated: 'some sessions could not be evaluated',
  ip_country_unreliable: 'the IP country is unreliable for an anonymised connection',
  list_screening_pending: 'the list screening has not finished',
  list_unscreened: 'some lists were not screened',
  no_lists_selected: 'no list is selected for screening',
  not_yet_collected: 'the session had sent no browser data yet when the flow read it',
  no_indicator_found:
    'the device checks found no indicator, which says nothing certain about the device',
  not_android: 'the session did not come from the Android SDK',
  integrity_token_unavailable: 'the app gave no integrity token',
  integrity_unevaluated:
    'the integrity service did not evaluate the device, often because it did not meet integrity',
  integrity_decode_failed: 'the integrity token could not be decoded',
});

/** C90.3: the reasons that accompany a value. */
export const SIGNAL_EVIDENCE_REASON_WORDS: Readonly<Record<SignalEvidenceReason, string>> =
  Object.freeze({
    tor_exit_listed: 'listed as a Tor exit',
    provider_range: "in a cloud provider's published ranges",
    hosting_asn: 'the network (ASN) is a hosting network',
    vpn_asn: 'the network (ASN) is a VPN network',
    proxy_flagged: 'flagged as a proxy by the provider',
    adapter_negative: "the provider's data records it as not a proxy",
    vpn_list_not_exhaustive: 'the VPN list is not exhaustive',
    proxy_not_evaluated: 'proxies were not evaluated (no provider)',
    approximate: 'approximate (from the IP address)',
    no_artefact_found: 'no automation artefacts found',
    partial_sessions: 'some sessions sent nothing or had no location',
    sandbox_outcome: 'a sandbox value',
    webdriver: 'the browser reports automation (webdriver)',
    driver_globals: 'automation driver globals',
    ua_headless_marker: 'a headless browser marker',
    untrusted_events: 'input events the user did not make',
    zero_window_with_focus: 'a zero-sized window with focus',
    plugins_inconsistent: 'inconsistent plugins',
    mime_inconsistent: 'inconsistent MIME types',
    native_function_tampered: 'browser functions were altered',
    ua_client_hints_mismatch: 'the user agent and client hints disagree',
    language_mismatch: 'the languages disagree with the request',
    timezone_country_mismatch: 'the time zone is far from the IP country',
    uniform_typing_cadence: 'a uniform typing rhythm',
    fast_screens: 'screens finished very fast',
    no_pointer_travel: 'clicks without pointer movement',
    paste_into_identity_field: 'pasted into an identity field',
    autofill_into_identity_field: 'autofilled an identity field',
    many_focus_losses: 'many focus losses',
    long_hidden_periods: 'long periods with the page hidden',
    build_hardware_goldfish_or_ranchu: 'an emulator hardware name',
    build_product_sdk: 'an SDK build product',
    build_model_emulator: 'an emulator model name',
    qemu_property: 'an emulator system property',
    qemu_device_file: 'an emulator device file',
    no_telephony_and_generic_board: 'no telephony on a generic board',
    su_binary_on_path: 'an su binary on the path',
    build_tags_test_keys: 'a build signed with test keys',
    system_mounted_rw: 'the system partition mounted writable',
    magisk_mount_trace: 'a Magisk mount trace',
    ro_debuggable_and_not_secure: 'a debuggable, insecure system build',
    frida_in_process_maps: 'a Frida library in the memory map of the app',
    frida_thread_name: 'a Frida thread in the app',
    xposed_bridge_loadable: 'the Xposed bridge loadable',
    xposed_in_stack_trace: 'a stack trace naming Xposed',
    unexpected_native_library: 'an unexpected native library in the app',
    android_debugger_connected: 'a debugger attached to the app',
    android_app_debuggable: 'a debuggable build of the app',
  });

/** C90.7: what the signals job recorded about review (`signal-details.review.cause`). */
export const SIGNAL_REVIEW_CAUSE_WORDS: Readonly<Record<SignalReviewCause, string>> = Object.freeze(
  {
    signal_rule: 'A review rule matched a signal, so the inquiry was marked for review',
    signal_unevaluated:
      "A rule's signal could not be evaluated and its on-null sends it to review, so the inquiry was marked for review",
    inquiry_already_decided:
      'A review rule matched, but the inquiry was already decided, so it was not changed',
  },
);

/** "Not evaluated: <reason>", or "Not evaluated" without one. */
export function notEvaluatedText(reason: SignalNullReason | null): string {
  return reason === null ? 'Not evaluated' : `Not evaluated: ${SIGNAL_NULL_REASON_WORDS[reason]}`;
}

const NO_ARTEFACT = SIGNAL_EVIDENCE_REASON_WORDS.no_artefact_found;
const LEVEL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  low: 'Low: no listed risk found',
  medium: 'Medium',
  high: 'High',
});
const COMPARISON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  same: 'Same country',
  different: 'Different country',
});

const wordOf = (words: Readonly<Record<string, string>>, value: string) =>
  Object.hasOwn(words, value) ? (words[value] ?? value) : value;

/** A signal's value in words, from its registry entry and its `signal-details` entry. */
export function signalValueText(
  name: string,
  value: SignalValue['value'],
  detail: SignalDetail | undefined,
): string {
  if (value === null) {
    return notEvaluatedText(detail?.['null-reason'] ?? null);
  }
  const definition = getSignalDefinition(name);
  const found = detail?.reasons.includes('no_artefact_found') === true;
  if (typeof value === 'boolean') {
    // `false` appears only where the data is exhaustive for the question (C90.3).
    return value ? 'Yes' : 'Checked: not found';
  }
  if (typeof value === 'number') {
    const number = value.toLocaleString('en-US');
    if (definition?.unit === 'meters') {
      return `${number} m (approximate)`;
    }
    const scaled =
      definition?.range?.max === 100 && definition.valueType === 'integer'
        ? `${number} of 100`
        : number;
    return found ? `${scaled}: ${NO_ARTEFACT}` : scaled;
  }
  if (name.endsWith('_threat_level')) {
    return wordOf(LEVEL_WORDS, value);
  }
  if (name === 'inquiry/country_comparison') {
    return wordOf(COMPARISON_WORDS, value);
  }
  return value;
}

/** One applied threshold in words: "Fast screen floor seconds: 2". */
export function thresholdText(key: string, value: number): string {
  const words = key.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${value.toLocaleString('en-US')}`;
}
