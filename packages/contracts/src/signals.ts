/**
 * Signals (plan C90.3, C90.5, ADR 0006): the frozen reason enums, the `on-null` defaults, and the
 * schemas of the inquiry's `signals` array and `signal-details` map.
 *
 * Honesty is part of the shape (H12):
 * - every signal the template collects is present; one that could not be evaluated is `null`,
 *   and its `signal-details` entry names the reason from {@link SIGNAL_NULL_REASONS};
 * - a signal whose data is never exhaustive (`neverFalse` in the registry) is `true` or `null`,
 *   never `false`;
 * - an H-tier or combined entry carries its `confidence` (`null` only beside a `null` value), its
 *   reasons and the thresholds applied;
 * - a value fits its registry type: an integer in range, an enum value, a country code.
 *
 * No value is PII: they are counts, levels, a country code and distances (C90.5).
 */
import {
  SIGNAL_NAMES,
  SIGNAL_NAME_PATTERN,
  checkStageSchema,
  getSignalDefinition,
  isHeuristicSignalTier,
  listNotApplicableReasonSchema,
  listReviewCauseSchema,
  listScreeningStatusSchema,
  listUnscreenedReasonSchema,
  type SignalDefinition,
} from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

// ---------------------------------------------------------------------------------------------
// Reasons (C90.3, H11)

/**
 * C90.3: why a signal is `null`, frozen in Workflow 7A Stage 1a and extended by 7B's amendment
 * with the list reasons, which only `inquiry/list_match_count` carries (H02, H11).
 */
export const SIGNAL_NULL_REASONS = [
  // collection
  'signals_not_collected',
  'collector_missing',
  'collection_disabled',
  'consent_not_given',
  // data
  'list_unavailable',
  'list_stale',
  'provider_not_configured',
  'not_in_known_ranges',
  'not_in_provider_data',
  'client_address_untrusted',
  // the subject
  'address_not_public',
  'ipv6_not_covered',
  'location_too_coarse',
  'input_missing',
  'fingerprint_randomised',
  'insufficient_behaviour',
  // sessions
  'insufficient_sessions',
  'sessions_not_evaluated',
  // the network's reliability (V08)
  'ip_country_unreliable',
  // lists (Workflow 7B, C99.4)
  'list_screening_pending',
  'list_unscreened',
  'no_lists_selected',
  // flows (Phase 9 C150.9, V06; a labelled C90 amendment): a client-collected signal snapshotted for
  // a branch before the session's first collector payload. Only a provisional snapshot carries it;
  // the inquiry's own signals never do.
  'not_yet_collected',
  // device integrity (Workflow 10B; C210.4, C211.5, review V09; a labelled C90.3 amendment)
  'no_indicator_found',
  'not_android',
  'integrity_token_unavailable',
  'integrity_unevaluated',
  'integrity_decode_failed',
] as const;
export const signalNullReasonSchema = z.enum(SIGNAL_NULL_REASONS);
export type SignalNullReason = z.infer<typeof signalNullReasonSchema>;

/**
 * C90.3: the reasons that accompany a non-null value. One code per automation artefact (the
 * strong ones and the medium ones, C94.3), the cross-layer and behaviour evidence of C94.8, and
 * the limits a value states about itself.
 */
export const SIGNAL_EVIDENCE_REASONS = [
  // network (C93.3, C93.4)
  'tor_exit_listed',
  'provider_range',
  'hosting_asn',
  'vpn_asn',
  'proxy_flagged',
  'adapter_negative',
  'vpn_list_not_exhaustive',
  'proxy_not_evaluated',
  'approximate',
  // collection and sessions (C90.4, C90.9)
  'no_artefact_found',
  'partial_sessions',
  'sandbox_outcome',
  // strong automation artefacts (C94.3)
  'webdriver',
  'driver_globals',
  'ua_headless_marker',
  'untrusted_events',
  // medium integrity artefacts (C94.3)
  'zero_window_with_focus',
  'plugins_inconsistent',
  'mime_inconsistent',
  'native_function_tampered',
  // cross-layer consistency (C94.8, V13)
  'ua_client_hints_mismatch',
  'language_mismatch',
  'timezone_country_mismatch',
  // behaviour (C94.8)
  'uniform_typing_cadence',
  'fast_screens',
  'no_pointer_travel',
  'paste_into_identity_field',
  'autofill_into_identity_field',
  'many_focus_losses',
  'long_hidden_periods',
  // device integrity (Workflow 10B, C210.2): each indicator code a probe reports
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
  // the Android debugger facts (Workflow 10B; Phase 7 C94.7, C94.8 amended): medium and weak evidence
  'android_debugger_connected',
  'android_app_debuggable',
] as const;
export const signalEvidenceReasonSchema = z.enum(SIGNAL_EVIDENCE_REASONS);
export type SignalEvidenceReason = z.infer<typeof signalEvidenceReasonSchema>;

/** C90.7 (H03): what a review rule does on a `null` value, per rule or by default. */
export const SIGNAL_ON_NULL_ACTIONS = ['needs_review', 'ignore'] as const;
export const signalOnNullActionSchema = z.enum(SIGNAL_ON_NULL_ACTIONS);
export type SignalOnNullAction = z.infer<typeof signalOnNullActionSchema>;

/**
 * C90.7 (V01): every null reason's `on-null` default. A data or collection gap goes to review; a
 * fact about the subject or an operator's choice is ignored; `sessions_not_evaluated` is derived
 * from the sessions' own reasons (`needs_review` if any is a gap). The list reasons read `ignore`
 * because no review rule may test `inquiry/list_match_count` (F31): `on-list-match` covers it, so
 * their default is never read. A test fails an unclassified code.
 */
export const ON_NULL_DEFAULTS: Readonly<Record<SignalNullReason, SignalOnNullAction | 'derived'>> =
  Object.freeze({
    signals_not_collected: 'ignore',
    collector_missing: 'needs_review',
    collection_disabled: 'ignore',
    consent_not_given: 'ignore',
    list_unavailable: 'needs_review',
    list_stale: 'needs_review',
    provider_not_configured: 'needs_review',
    not_in_known_ranges: 'ignore',
    not_in_provider_data: 'ignore',
    client_address_untrusted: 'needs_review',
    address_not_public: 'ignore',
    ipv6_not_covered: 'ignore',
    location_too_coarse: 'ignore',
    input_missing: 'ignore',
    fingerprint_randomised: 'ignore',
    insufficient_behaviour: 'ignore',
    insufficient_sessions: 'ignore',
    sessions_not_evaluated: 'derived',
    ip_country_unreliable: 'ignore',
    list_screening_pending: 'ignore',
    list_unscreened: 'ignore',
    no_lists_selected: 'ignore',
    // C150.9 (V06): the route's own `onNull` decides, not `collector_missing`'s review class, which
    // would flag every inquiry whose branch comes right after consent.
    not_yet_collected: 'ignore',
    // C210.4: a probed device with no indicator, or a session from another platform: facts, not gaps.
    no_indicator_found: 'ignore',
    not_android: 'ignore',
    // C211.5: the host installed no provider, or it gave nothing (the host app's choice).
    integrity_token_unavailable: 'ignore',
    // C211.5 (V09): Play's UNEVALUATED has an adverse cause, and a failed decode is a data gap.
    integrity_unevaluated: 'needs_review',
    integrity_decode_failed: 'needs_review',
  });

/**
 * C90.4, C90.7: the `on-null` default of a combined value, from the reasons of the sessions
 * that left it unevaluated: `needs_review` when any of them is a gap, otherwise `ignore`.
 */
export function derivedOnNullDefault(
  sessionReasons: readonly SignalNullReason[],
): SignalOnNullAction {
  return sessionReasons.some(
    (reason) =>
      ON_NULL_DEFAULTS[reason] === 'needs_review' ||
      (ON_NULL_DEFAULTS[reason] === 'derived' && reason !== 'sessions_not_evaluated'),
  )
    ? 'needs_review'
    : 'ignore';
}

/**
 * C90.7: why the signals job moved (or left) the inquiry: a rule matched a value, a rule's
 * `on-null` sent an unevaluated value to review, or the inquiry was already decided.
 */
export const SIGNAL_REVIEW_CAUSES = [
  'signal_rule',
  'signal_unevaluated',
  'inquiry_already_decided',
] as const;
export const signalReviewCauseSchema = z.enum(SIGNAL_REVIEW_CAUSES);

// ---------------------------------------------------------------------------------------------
// Values and details (C90.5)

const signalNameSchema = z.string().regex(SIGNAL_NAME_PATTERN, 'must be an inquiry/ signal name');

/** C90.5: one entry of the public `signals` array. */
export const signalValueSchema = z.strictObject({
  name: signalNameSchema,
  value: z.union([z.boolean(), z.number(), z.string().max(64), z.null()]),
});
export type SignalValue = z.infer<typeof signalValueSchema>;

/** A source a network-derived value read (C90.3 provenance). */
export const signalSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sync'),
    /** The network source, as `network/sources.json` names it. */
    'source-id': z
      .string()
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      .max(64),
    'sync-id': z.string().min(1).max(64),
    'published-at': timestampSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.strictObject({
    kind: z.literal('provider'),
    /** The adapter that answered (C93.5), labelled when it is a sandbox (ADR 0002 §3d). */
    provider: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(64),
    sandbox: z.boolean(),
  }),
]);
export type SignalSource = z.infer<typeof signalSourceSchema>;

/** C90.4: one session's own reason inside a combined value. */
export const signalSessionReasonSchema = z.strictObject({
  'session-id': idSchema('iqse'),
  'null-reason': signalNullReasonSchema.nullable(),
});

/**
 * C99.4 (H02): what `inquiry/list_match_count`'s entry says about its screening: its state, every
 * list it could not read, every list the subject had no value for, and what it did to the inquiry
 * (C99.6). A count only ever follows a `completed` screening.
 */
export const signalListScreeningSchema = z.strictObject({
  status: listScreeningStatusSchema,
  unscreened: z.array(
    z.strictObject({ 'list-id': idSchema('lst'), reason: listUnscreenedReasonSchema }),
  ),
  'not-applicable': z.array(
    z.strictObject({ 'list-id': idSchema('lst'), reason: listNotApplicableReasonSchema }),
  ),
  /** C99.6: `null` until `on-list-match` applied. */
  'review-cause': listReviewCauseSchema.nullable(),
});
export type SignalListScreening = z.infer<typeof signalListScreeningSchema>;

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const thresholdsSchema = z.record(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), z.number());

const baseDetail = {
  stage: checkStageSchema,
  version: z.int().min(1),
  /** Why the value is `null`; `null` beside a value (refined against `signals`). */
  'null-reason': signalNullReasonSchema.nullable(),
  reasons: z.array(signalEvidenceReasonSchema).max(SIGNAL_EVIDENCE_REASONS.length),
  sources: z.array(signalSourceSchema).max(32).optional(),
  /** C90.4: each session's own reason, for a value combined across sessions. */
  sessions: z.array(signalSessionReasonSchema).max(100).optional(),
  /** C99.4: `inquiry/list_match_count` only. */
  'list-screening': signalListScreeningSchema.optional(),
  /** V06: each entry's own computation time. */
  'computed-at': timestampSchema,
};

/**
 * C90.5 (H12): a `signal-details` entry, discriminated by whether its tier is heuristic. An
 * H-tier or combined entry requires `confidence` (0-1, `null` only beside a `null` value), its
 * reasons and the thresholds applied; an R or A entry never carries a confidence.
 */
export const signalDetailSchema = z.union([
  z.strictObject({
    tier: z.enum(['H', 'R/H', 'A/H', 'H/A']),
    confidence: z.number().min(0).max(1).nullable(),
    thresholds: thresholdsSchema,
    ...baseDetail,
  }),
  z.strictObject({
    tier: z.enum(['R', 'A', 'R+A']),
    thresholds: thresholdsSchema.optional(),
    ...baseDetail,
  }),
]);
export type SignalDetail = z.infer<typeof signalDetailSchema>;

/** C90.7: what the signals job recorded about review. */
export const signalReviewSchema = z.strictObject({
  cause: signalReviewCauseSchema,
  /** The indexes of the template's review rules that matched. */
  rules: z.array(z.int().min(0).max(19)).max(20),
});

/**
 * C90.5: `signal-details`, a map from signal name to its entry, plus `computed-at` (`null` until
 * the signals job has run, so a reader tells not yet computed and hidden apart) and `review` when the job
 * applied `on-signal`.
 */
export const signalDetailsSchema = z
  .looseObject({
    'computed-at': timestampSchema.nullable(),
    review: signalReviewSchema.optional(),
  })
  .superRefine((details, ctx) => {
    for (const [key, entry] of Object.entries(details)) {
      if (key === 'computed-at' || key === 'review') {
        continue;
      }
      if (!SIGNAL_NAME_PATTERN.test(key)) {
        ctx.addIssue({ code: 'custom', message: 'not a signal name', path: [key] });
        continue;
      }
      const parsed = signalDetailSchema.safeParse(entry);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message, path: [key, ...issue.path] });
        }
      }
    }
  });
export type SignalDetails = z.infer<typeof signalDetailsSchema> &
  Readonly<Record<`inquiry/${string}`, SignalDetail>>;

/** The registry order the computations and merges follow (C90.5). */
const REGISTRY_ORDER: ReadonlyMap<string, number> = new Map(
  SIGNAL_NAMES.map((name, index) => [name, index]),
);

/** Whether `value` fits the registry type of `entry` (C90.1, C90.3). */
function valueFits(entry: SignalDefinition, value: unknown): boolean {
  if (value === null) {
    return true;
  }
  switch (entry.valueType) {
    case 'boolean':
      return value === true || (value === false && !entry.neverFalse);
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return false;
      }
      if (entry.valueType === 'integer' && !Number.isInteger(value)) {
        return false;
      }
      const { min = 0, max = null } = entry.range ?? {};
      return value >= min && (max === null || value <= max);
    }
    case 'enum':
      return typeof value === 'string' && (entry.values ?? []).includes(value);
    case 'string':
      return typeof value === 'string' && countryCodeSchema.safeParse(value).success;
  }
}

/**
 * The C90.3 and C90.5 rules between `signals` and `signal-details` (H12): unique registered
 * names in registry order; every value fits its type (never-false flags are true-or-null); each
 * signal has its entry with the registry's tier class, and a `null` value exactly when the entry
 * names a null reason; an H-tier entry's confidence is `null` only beside a `null` value. With the
 * signals hidden (`expose-signals: false`), `signals` is `[]` and `signal-details` holds only
 * `computed-at`.
 */
export function signalAttributeIssues(
  signals: readonly SignalValue[],
  details: Readonly<Record<string, unknown>>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  let lastIndex = -1;
  const seen = new Set<string>();
  signals.forEach(({ name, value }, index) => {
    const entry = getSignalDefinition(name);
    if (entry === undefined) {
      issues.push({ path: ['signals', index, 'name'], message: 'not a registered signal' });
      return;
    }
    const registryIndex = REGISTRY_ORDER.get(name) ?? -1;
    if (seen.has(name) || registryIndex <= lastIndex) {
      issues.push({
        path: ['signals', index, 'name'],
        message: 'signals are unique and in registry order',
      });
    }
    seen.add(name);
    lastIndex = Math.max(lastIndex, registryIndex);
    if (!valueFits(entry, value)) {
      issues.push({
        path: ['signals', index, 'value'],
        message:
          entry.neverFalse && value === false
            ? 'never false: true or null'
            : 'does not fit the signal type',
      });
    }
    const detail = details[name] as SignalDetail | undefined;
    if (detail === undefined) {
      issues.push({ path: ['signal-details', name], message: 'every signal has its details' });
      return;
    }
    if (isHeuristicSignalTier(entry.tier) !== isHeuristicSignalTier(detail.tier)) {
      issues.push({
        path: ['signal-details', name, 'tier'],
        message: 'the tier does not fit the registry entry',
      });
    }
    if ((value === null) !== (detail['null-reason'] !== null)) {
      issues.push({
        path: ['signal-details', name, 'null-reason'],
        message: 'a null value names its reason, and only a null value does',
      });
    }
    if ('confidence' in detail && detail.confidence === null && value !== null) {
      issues.push({
        path: ['signal-details', name, 'confidence'],
        message: 'an H-tier value carries its confidence',
      });
    }
  });
  if (signals.length === 0) {
    for (const key of Object.keys(details)) {
      if (key !== 'computed-at' && key !== 'review') {
        issues.push({
          path: ['signal-details', key],
          message: 'hidden or uncomputed signals carry no details',
        });
      }
    }
  }
  return issues;
}
