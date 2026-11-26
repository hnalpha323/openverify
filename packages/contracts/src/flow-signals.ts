/**
 * Signal collection and configuration (plan C90.6, C90.8, C90.9, C94.2-C94.4, C94.6).
 *
 * - `flowSignalsSchema`: the body of `POST /api/v1/flow/signals` (session authentication, 202),
 *   a strict object of enums and bounded integers with no free string longer than its bound, so
 *   raw keystrokes, coordinates or timings cannot pass. `recognition` is accepted only under the
 *   device-recognition tier; the server drops it otherwise and never stores it.
 * - `flowSessionSignalsSchema`: the tiers `GET /api/v1/flow/session` reports once consent is
 *   recorded (`signals`), `null` before, so the collector instantiates nothing before then (P14).
 * - `signalConfigSchema`: the inquiry template version member `signal-config`.
 * - `signalCollectionSettingSchema`: the environment setting `signal-collection` (`settings:privacy`).
 */
import { COLLECTOR_VERSION, SIGNAL_NAME_PATTERN } from '@openverify/core';
import { stepIdSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { SIGNAL_ON_NULL_ACTIONS } from './signals.js';

/** C94.2: the platforms that send signal bodies. */
export const SIGNAL_PLATFORMS = ['web', 'android'] as const;

/** C94.2 (P23): at most this many stored bodies per session; further ones are counted only. */
export const FLOW_SIGNALS_MAX_BODIES_PER_SESSION = 200;
/** C94.2: the body cap of `POST /api/v1/flow/signals`. */
export const FLOW_SIGNALS_MAX_BODY_BYTES = 8 * 1024;
/** The bound of every count a body carries. */
export const FLOW_SIGNALS_MAX_COUNT = 10_000;

/**
 * C94.3: the automation drivers whose page globals the collector recognises, after BotD's rules.
 * The collector maps the property names it finds to these kinds; the names never travel.
 */
export const DRIVER_GLOBAL_KINDS = [
  'selenium',
  'webdriver-script',
  'phantom',
  'nightmare',
  'dom-automation',
  'playwright',
  'puppeteer',
  'cypress',
] as const;

/** C94.3: the first-input delay buckets, edges fixed by the collector constants. */
export const FIRST_INPUT_BUCKETS = ['<0.25s', '0.25-1s', '1-5s', '>5s', 'none'] as const;
export const TYPING_CADENCES = ['uniform', 'variable', 'insufficient'] as const;
export const POINTER_TYPES = ['mouse', 'pen', 'touch'] as const;
export const POINTER_BEFORE_CLICK = ['true', 'false', 'n/a'] as const;
/** C90.9: the sandbox outcomes a sandbox environment accepts. */
export const SANDBOX_SIGNAL_OUTCOMES = ['bot', 'human'] as const;
/** C94.7: the Android device class the SDK sends, which sets an SDK session's `device-type`. */
export const ANDROID_DEVICE_CLASSES = ['smartphone', 'tablet'] as const;

const count = z.int().min(0).max(FLOW_SIGNALS_MAX_COUNT);
/** A BCP 47 tag such as `en` or `es-419`, as `navigator.languages` reports it. */
const languageTagSchema = z
  .string()
  .max(35)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'must be a BCP 47 language tag');
const seconds = z.number().min(0).max(3600);
const distinct = <Item extends z.ZodType>(item: Item, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'must not repeat a value');

/** C94.3 (V13): a low-entropy UA Client Hints brand, as the browser reports it. */
const clientHintBrandSchema = z.strictObject({
  brand: z.string().min(1).max(64),
  version: z.string().regex(/^[0-9]{1,8}$/),
});

/** C94.3: session integrity, collected after consent under `notice.session-integrity`. */
export const flowIntegritySignalsSchema = z.strictObject({
  webdriver: z.boolean(),
  'driver-globals': distinct(z.enum(DRIVER_GLOBAL_KINDS), DRIVER_GLOBAL_KINDS.length),
  'ua-headless-marker': z.boolean(),
  'zero-window-with-focus': z.boolean(),
  'plugins-inconsistent': z.boolean(),
  'mime-inconsistent': z.boolean(),
  'native-function-tampered': z.boolean(),
  'untrusted-event-count': count,
  /** The low-entropy UA Client Hints: brands, `mobile` and `platform`; `null` without the API. */
  'client-hints': z
    .strictObject({
      brands: z.array(clientHintBrandSchema).max(8),
      mobile: z.boolean(),
      platform: z.string().max(32),
    })
    .nullable(),
  /** An IANA time zone name, for the cross-layer checks against the IP country. */
  timezone: z
    .string()
    .max(64)
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/, 'must be an IANA time zone name')
    .nullable(),
  /** At most 5 BCP 47 tags (`navigator.languages`). */
  languages: z.array(languageTagSchema).max(5),
});
export type FlowIntegritySignals = z.infer<typeof flowIntegritySignalsSchema>;

/** C94.3: per-screen behaviour aggregates. Never keys, per-key timings or coordinates. */
export const flowBehaviourSignalsSchema = z.strictObject({
  'paste-count': count,
  'drop-count': count,
  'autofill-count': count,
  'correction-count': count,
  'focus-loss-count': count,
  'hidden-count': count,
  /** Ours (C94.8): the input events on the screen, for the minimum evidence of 20. */
  'input-event-count': count,
  'dwell-seconds': seconds,
  'hidden-seconds': seconds,
  'first-input-bucket': z.enum(FIRST_INPUT_BUCKETS),
  'typing-cadence': z.enum(TYPING_CADENCES),
  'pointer-types': distinct(z.enum(POINTER_TYPES), POINTER_TYPES.length),
  'pointer-before-click': z.enum(POINTER_BEFORE_CLICK),
});
export type FlowBehaviourSignals = z.infer<typeof flowBehaviourSignalsSchema>;

/** C94.4: device recognition, only under its tier; components sealed, only HMACs kept plain. */
export const flowRecognitionSignalsSchema = z.strictObject({
  /** Bucketed screen dimensions and density (C94.4), never the exact window size. */
  screen: z
    .strictObject({
      'width-bucket': z.int().min(0).max(16_384),
      'height-bucket': z.int().min(0).max(16_384),
      'color-depth': z.int().min(1).max(64),
      'pixel-ratio-bucket': z.number().min(0.5).max(8),
    })
    .nullable(),
  'hardware-concurrency': z.int().min(1).max(1024).nullable(),
  'device-memory': z.number().min(0.125).max(1024).nullable(),
  'max-touch-points': z.int().min(0).max(64).nullable(),
  /** SHA-256 of `toDataURL` over a fixed drawing, computed in the browser. */
  'canvas-digest': z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  /** A second readback differed: the browser adds noise, so the strict HMAC is dropped. */
  'canvas-noise': z.boolean(),
  'webgl-vendor': z.string().min(1).max(128).nullable(),
  'webgl-renderer': z.string().min(1).max(128).nullable(),
});
export type FlowRecognitionSignals = z.infer<typeof flowRecognitionSignalsSchema>;

/**
 * C210.2 (Workflow 10B; Phase 7 C94.2 amended): the closed indicator codes of the device-integrity
 * probes, each list at most 12 codes. No code names an installed app: what other apps are installed
 * is never read (decision 66).
 */
export const ANDROID_EMULATOR_INDICATORS = Object.freeze([
  'build_hardware_goldfish_or_ranchu',
  'build_product_sdk',
  'build_model_emulator',
  'qemu_property',
  'qemu_device_file',
  'no_telephony_and_generic_board',
] as const);
export const ANDROID_ROOT_INDICATORS = Object.freeze([
  'su_binary_on_path',
  'build_tags_test_keys',
  'system_mounted_rw',
  'magisk_mount_trace',
  'ro_debuggable_and_not_secure',
] as const);
export const ANDROID_HOOKING_INDICATORS = Object.freeze([
  'frida_in_process_maps',
  'frida_thread_name',
  'xposed_bridge_loadable',
  'xposed_in_stack_trace',
  'unexpected_native_library',
] as const);

/** C210.2: at most 12 codes a list. */
export const ANDROID_INDICATORS_MAX = 12;

const indicatorList = <T extends readonly [string, ...string[]]>(codes: T) =>
  z
    .array(z.enum(codes))
    .max(ANDROID_INDICATORS_MAX)
    .refine((list) => new Set(list).size === list.length, { message: 'each code once' })
    .optional();

/**
 * C94.7: Android's session integrity: the debugger facts, read after consent; and (C210.2, Workflow
 * 10B) the indicator codes of the emulator, root and hooking probes, each list absent from an SDK
 * that runs no probe and empty when the probes found nothing. Client-reported (C221.11).
 */
export const flowAndroidIntegritySignalsSchema = z.strictObject({
  /** `Debug.isDebuggerConnected()`. */
  'debugger-connected': z.boolean(),
  /** The host app's `ApplicationInfo.FLAG_DEBUGGABLE`. */
  'app-debuggable': z.boolean(),
  'emulator-indicators': indicatorList(ANDROID_EMULATOR_INDICATORS),
  'root-indicators': indicatorList(ANDROID_ROOT_INDICATORS),
  'hooking-indicators': indicatorList(ANDROID_HOOKING_INDICATORS),
});

/** C94.7: Android's device recognition: `Settings.Secure.ANDROID_ID` (64 bits, hex). */
export const flowAndroidRecognitionSignalsSchema = z.strictObject({
  'android-id': z.string().regex(/^[0-9a-f]{1,16}$/, 'must be the hex ANDROID_ID'),
});

/** C94.2: the body of `POST /api/v1/flow/signals`. */
export const flowSignalsSchema = z
  .strictObject({
    platform: z.enum(SIGNAL_PLATFORMS),
    'collector-version': z.int().min(1).max(1000),
    /** The flow-spec step id the body describes. */
    screen: stepIdSchema,
    /** A repeated `(session, sequence)` is ignored with 202, so a retry is idempotent. */
    sequence: z.int().min(0).max(1_000_000),
    integrity: flowIntegritySignalsSchema.optional(),
    behaviour: flowBehaviourSignalsSchema.optional(),
    recognition: flowRecognitionSignalsSchema.optional(),
    /** C94.7: Android's members; the browser ones above are web-only. */
    'android-integrity': flowAndroidIntegritySignalsSchema.optional(),
    'android-recognition': flowAndroidRecognitionSignalsSchema.optional(),
    /** Android only (C94.7). */
    'device-class': z.enum(ANDROID_DEVICE_CLASSES).optional(),
    /** C90.9: sandbox environments only; 422 `sandbox_only_value` in production. */
    'sandbox-outcome': z.enum(SANDBOX_SIGNAL_OUTCOMES).optional(),
  })
  .refine((body) => body.platform === 'android' || body['device-class'] === undefined, {
    message: 'device-class comes only from the Android SDK',
    path: ['device-class'],
  })
  .refine(
    (body) =>
      body.platform === 'android'
        ? body.integrity === undefined &&
          body.recognition === undefined &&
          body.behaviour === undefined
        : body['android-integrity'] === undefined && body['android-recognition'] === undefined,
    { message: 'each platform sends its own members', path: ['platform'] },
  );
export type FlowSignals = z.infer<typeof flowSignalsSchema>;

/** The collector version this contract was frozen with (C90.1, H24). */
export const FLOW_SIGNALS_COLLECTOR_VERSION = COLLECTOR_VERSION;

/**
 * C94.6: what `GET /api/v1/flow/session` reports once the session may collect: which collector
 * tiers apply to this session. `null` before consent (and on a handoff session until it records
 * its own), so the collector reads nothing until then. `next-sequence` is one past the session's
 * highest stored or counted body: a reloaded page or a later SDK launch numbers its bodies from it,
 * because the server ignores a repeated `(session, sequence)` (owner decision 1 after Workflow 7A).
 */
export const flowSessionSignalsSchema = z.strictObject({
  integrity: z.boolean(),
  recognition: z.boolean(),
  'next-sequence': z.int().min(0).optional(),
});
export type FlowSessionSignals = z.infer<typeof flowSessionSignalsSchema>;

// ---------------------------------------------------------------------------------------------
// The template version member `signal-config` (C90.6, C90.7)

/** C90.6: at most 20 review rules per version. */
export const MAX_SIGNAL_REVIEW_RULES = 20;
export const SIGNAL_ON_SIGNAL_ACTIONS = ['none', 'needs_review'] as const;

const signalNameSchema = z.string().regex(SIGNAL_NAME_PATTERN, 'must be an inquiry/ signal name');
const operand = z.union([z.number(), z.string().min(1).max(64), z.boolean()]);

/**
 * C90.6: one review rule: a signal and exactly one comparison, plus `on-null`. Publish refuses a
 * rule on a signal outside `collect`, a comparison that does not fit the signal's type
 * (`signal_rule_invalid`), a rule on a signal registered `review-rule: false`
 * (`signal_not_reviewable`) and a `proxy_detected` rule without an `ipReputation` adapter
 * (`provider_not_bound`).
 */
export const signalReviewRuleSchema = z
  .strictObject({
    signal: signalNameSchema,
    gte: z.number().optional(),
    lte: z.number().optional(),
    eq: operand.optional(),
    in: z.array(operand).min(1).max(20).optional(),
    /** Left out, the null reason's own default applies (`ON_NULL_DEFAULTS`, C90.7). */
    'on-null': z.enum(SIGNAL_ON_NULL_ACTIONS).optional(),
  })
  .refine(
    (rule) =>
      [rule.gte, rule.lte, rule.eq, rule.in].filter((value) => value !== undefined).length === 1,
    { message: 'a rule has exactly one of gte, lte, eq or in', path: ['signal'] },
  );
export type SignalReviewRule = z.infer<typeof signalReviewRuleSchema>;

/** C90.6: the strict template version member `signal-config` (stored as given; `{}` collects the defaults). */
export const signalConfigSchema = z.strictObject({
  /** `default`, or unique catalogue names; an unknown name is refused at publish (`unknown_signal`). */
  collect: z
    .union([
      z.literal('default'),
      z
        .array(signalNameSchema)
        .max(64)
        .refine((names) => new Set(names).size === names.length, 'must not repeat a signal'),
    ])
    .optional(),
  'on-signal': z.enum(SIGNAL_ON_SIGNAL_ACTIONS).optional(),
  'review-rules': z.array(signalReviewRuleSchema).max(MAX_SIGNAL_REVIEW_RULES).optional(),
});
export type SignalConfig = z.infer<typeof signalConfigSchema>;

/** C90.6: the member as a version serves it, every default applied. */
export const resolvedSignalConfigSchema = z.strictObject({
  collect: signalConfigSchema.shape.collect.unwrap(),
  'on-signal': z.enum(SIGNAL_ON_SIGNAL_ACTIONS),
  'review-rules': z.array(signalReviewRuleSchema).max(MAX_SIGNAL_REVIEW_RULES),
});
export type ResolvedSignalConfig = z.infer<typeof resolvedSignalConfigSchema>;

/** The member with its defaults: the default set, `on-signal: none`, no rules. */
export function resolveSignalConfig(config: SignalConfig): ResolvedSignalConfig {
  return resolvedSignalConfigSchema.parse({
    collect: config.collect ?? 'default',
    'on-signal': config['on-signal'] ?? 'none',
    'review-rules': config['review-rules'] ?? [],
  });
}

// ---------------------------------------------------------------------------------------------
// The environment settings of C90.8 and C107.7

export const SESSION_INTEGRITY_MODES = ['on', 'off'] as const;
export const DEVICE_RECOGNITION_MODES = ['off', 'consent', 'exempt'] as const;

/**
 * C90.8 (`settings:privacy`, audit-logged): the collection tiers. `exempt` needs a non-empty
 * basis (422 `basis_required`).
 */
export const signalCollectionSettingSchema = z
  .strictObject({
    'session-integrity': z.enum(SESSION_INTEGRITY_MODES),
    'device-recognition': z.enum(DEVICE_RECOGNITION_MODES),
    'device-recognition-basis': z.string().min(1).max(500).nullable(),
  })
  .refine(
    (setting) =>
      setting['device-recognition'] !== 'exempt' || setting['device-recognition-basis'] !== null,
    { message: 'exempt mode needs its recorded basis', path: ['device-recognition-basis'] },
  );
export type SignalCollectionSetting = z.infer<typeof signalCollectionSettingSchema>;

/** C90.8: the defaults: session integrity on, device recognition off. */
export const DEFAULT_SIGNAL_COLLECTION: SignalCollectionSetting = Object.freeze({
  'session-integrity': 'on',
  'device-recognition': 'off',
  'device-recognition-basis': null,
});

/**
 * C94.6, C42.3: the consent and notice keys of the tiers. The optional consent key ticks device
 * recognition; the required notice keys tell the person about each tier (default texts in ADR
 * 0006).
 */
export const DEVICE_RECOGNITION_CONSENT_TEXT_KEY = 'consent.device-recognition';
export const SESSION_INTEGRITY_NOTICE_TEXT_KEY = 'notice.session-integrity';

/** C211.9 (Workflow 10B): the notice that names Google as a recipient, shown when the environment binds a `deviceIntegrity` provider. */
export const PLAY_INTEGRITY_NOTICE_TEXT_KEY = 'notice.play-integrity';
export const DEVICE_RECOGNITION_NOTICE_TEXT_KEY = 'notice.device-recognition';
