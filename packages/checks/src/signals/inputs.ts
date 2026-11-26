/**
 * What the signal logic reads (plan C90.2, C90.4, C93.3, C94.2-C94.4, C94.8): the stored facts of
 * an inquiry's sessions, each opened by the `inquiry-signals` job (`api-signals`), as plain values.
 *
 * The member names of the flow-signal bodies are the contracts' (`flowSignalsSchema`, kebab case),
 * so a parsed body passes through unchanged. Nothing here is logged, and nothing returned by the
 * signal logic carries an address, a coordinate, a user agent or a fingerprint.
 */
import type { CollectorTier } from '@openverify/core';
import type { SignalNullReason, SignalSourceRef, SignalEvidenceReason } from './vocabulary.js';

/** C91.1: the device types of a session (the contracts' `SESSION_DEVICE_TYPES`). */
export type SessionDeviceType = 'desktop' | 'smartphone' | 'tablet' | 'tv';
/** C94.7: what the Android SDK sends as `device-class`. */
export type AndroidDeviceClass = 'smartphone' | 'tablet';

/** C94.3 (V13): low-entropy UA Client Hints, from the page or from the `Sec-CH-UA*` headers. */
export interface ClientHintsInput {
  readonly brands: readonly { readonly brand: string; readonly version: string }[];
  readonly mobile: boolean | null;
  readonly platform: string | null;
}

/** C94.3: a body's `integrity` member (the contracts' `flowIntegritySignalsSchema`). */
export interface IntegrityInput {
  readonly webdriver: boolean;
  readonly 'driver-globals': readonly string[];
  readonly 'ua-headless-marker': boolean;
  readonly 'zero-window-with-focus': boolean;
  readonly 'plugins-inconsistent': boolean;
  readonly 'mime-inconsistent': boolean;
  readonly 'native-function-tampered': boolean;
  readonly 'untrusted-event-count': number;
  readonly 'client-hints': {
    readonly brands: readonly { readonly brand: string; readonly version: string }[];
    readonly mobile: boolean;
    readonly platform: string;
  } | null;
  readonly timezone: string | null;
  readonly languages: readonly string[];
}

/**
 * C94.7, C210.2: a body's `android-integrity` member (the contracts'
 * `flowAndroidIntegritySignalsSchema`): the indicator codes are the contracts' closed lists.
 */
export interface AndroidIntegrityInput {
  readonly 'debugger-connected': boolean;
  readonly 'app-debuggable': boolean;
  readonly 'emulator-indicators'?: readonly string[] | undefined;
  readonly 'root-indicators'?: readonly string[] | undefined;
  readonly 'hooking-indicators'?: readonly string[] | undefined;
}

/**
 * C211.4, C211.5: the inquiry's Play Integrity facts, as the `inquiry-signals` job reads them: the
 * bound `deviceIntegrity` provider (`null` when none is bound), whether a token was posted and not
 * yet decoded, and the verdict's stored projection, opened.
 */
export interface DeviceIntegrityInput {
  readonly provider: { readonly name: string; readonly sandbox: boolean } | null;
  readonly tokenPending: boolean;
  readonly verdict: StoredIntegrityVerdict | null;
}

/** C211.4: the device recognition labels the projection keeps (Play Integrity's names). */
export const INTEGRITY_DEVICE_LABELS = [
  'MEETS_STRONG_INTEGRITY',
  'MEETS_DEVICE_INTEGRITY',
  'MEETS_BASIC_INTEGRITY',
  'MEETS_VIRTUAL_INTEGRITY',
] as const;
export type IntegrityDeviceLabel = (typeof INTEGRITY_DEVICE_LABELS)[number];

/** C211.4: Play Integrity's app recognition verdicts. */
export const INTEGRITY_APP_RECOGNITIONS = [
  'PLAY_RECOGNIZED',
  'UNRECOGNIZED_VERSION',
  'UNEVALUATED',
] as const;
export type IntegrityAppRecognition = (typeof INTEGRITY_APP_RECOGNITIONS)[number];

/**
 * C211.4: the fixed projection of a decoded verdict, the only thing stored (sealed for the inquiry's
 * row): the device recognition labels, the app recognition, the boolean of each server check, and when
 * it was decoded. `outcome: failed` records a decode that gave no verdict (an error, an unreadable
 * answer), so the signals read `integrity_decode_failed`, never a value. Every other member of
 * Google's answer is dropped before this.
 */
export interface IntegrityVerdictProjection {
  readonly outcome: 'decoded' | 'failed';
  readonly 'device-recognition': readonly IntegrityDeviceLabel[];
  readonly 'app-recognition': IntegrityAppRecognition | null;
  readonly checks: {
    readonly 'package-name': boolean;
    readonly 'request-hash': boolean;
    readonly timestamp: boolean;
    readonly 'app-recognized': boolean;
    readonly 'certificate-digest': boolean;
  };
  readonly 'decoded-at': string;
}

/** A stored verdict: the provider that decoded it and its projection. */
export interface StoredIntegrityVerdict {
  readonly provider: string;
  readonly projection: IntegrityVerdictProjection;
}

/** C94.3: a body's per-screen `behaviour` member (the contracts' `flowBehaviourSignalsSchema`). */
export interface BehaviourInput {
  readonly 'paste-count': number;
  readonly 'drop-count': number;
  readonly 'autofill-count': number;
  readonly 'correction-count': number;
  readonly 'focus-loss-count': number;
  readonly 'hidden-count': number;
  readonly 'input-event-count': number;
  readonly 'dwell-seconds': number;
  readonly 'hidden-seconds': number;
  readonly 'first-input-bucket': string;
  readonly 'typing-cadence': 'uniform' | 'variable' | 'insufficient';
  readonly 'pointer-types': readonly ('mouse' | 'pen' | 'touch')[];
  readonly 'pointer-before-click': 'true' | 'false' | 'n/a';
}

/**
 * C94.8 (V13): what `POST /flow/signals` recorded of its own request, sealed in `components`:
 * the primary `Accept-Language` tags and the low-entropy `Sec-CH-UA*` values, bounded by
 * `parseSignalRequestHeaders`.
 */
export interface SignalRequestHeaders {
  readonly acceptLanguages: readonly string[];
  readonly clientHints: ClientHintsInput | null;
}

/** C94.2: one stored flow-signal body of a session, opened. */
export interface SignalBodyInput {
  /** The flow-spec step id the body describes. */
  readonly screen: string;
  /** The step's type in the pinned flow (`form`, `phone_otp`, ...), or `null` when unknown. */
  readonly screenType: string | null;
  readonly sequence: number;
  readonly platform: 'web' | 'android';
  readonly integrity?: IntegrityInput | null | undefined;
  readonly behaviour?: BehaviourInput | null | undefined;
  /**
   * C94.7, C210.2: Android's session-integrity member: the debugger facts (read by `bot_score` and
   * `automation_artefact_count` since Workflow 10B, Stage 1a amendment 17) and the three indicator
   * lists, each absent when its probes did not run and empty when they found nothing.
   */
  readonly androidIntegrity?: AndroidIntegrityInput | null | undefined;
  readonly deviceClass?: AndroidDeviceClass | null | undefined;
  /** C90.9: honoured only in a sandbox environment. */
  readonly sandboxOutcome?: 'bot' | 'human' | null | undefined;
  readonly requestHeaders?: SignalRequestHeaders | null | undefined;
}

/** C93.3: the network facts a reason is about (the contracts' `NETWORK_FACT_FIELDS`). */
export type NetworkFactField =
  | 'is-tor'
  | 'is-datacenter'
  | 'is-vpn'
  | 'is-proxy'
  | 'hosting-asn'
  | 'threat-level'
  | 'country-code'
  | 'region-code'
  | 'location'
  | 'asn'
  | 'privacy-relay';

/** C90.3: one reason of a network row (the contracts' `networkReasonSchema`). */
export interface NetworkReasonInput {
  readonly field: NetworkFactField;
  readonly reason: SignalNullReason | SignalEvidenceReason;
}

/**
 * C93.2, C93.3: a session's frozen network facts and its network row's reasons and sources. Each
 * `null` fact names its reason in `reasons` (`{ field, reason }`); a fact without one reads as
 * `list_unavailable`, a gap.
 */
export interface SessionNetworkInput {
  readonly isTor: boolean | null;
  readonly isDatacenter: true | null;
  readonly isVpn: true | null;
  readonly isProxy: boolean | null;
  readonly hostingAsn: true | null;
  readonly privacyRelay: true | null;
  readonly countryCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly asn: number | null;
  readonly reasons: readonly NetworkReasonInput[];
  readonly sources: readonly SignalSourceRef[];
}

/** One session of the inquiry, as the signals job reads it. */
export interface SignalSessionInput {
  /** `iqse_...` */
  readonly id: string;
  readonly createdAt: Date;
  /**
   * C90.4 (V07): the session started a step after recording or inheriting consent. `false` for a
   * session that never did, and for a rejected or declined handoff session.
   */
  readonly consented: boolean;
  /** C94.6: the collector tiers that applied (`signals-collected`). */
  readonly signalsCollected: readonly CollectorTier[];
  /** The `User-Agent` recorded at the session's start (sealed; the job opens it), or `null`. */
  readonly userAgent: string | null;
  /** C93.2: the session's network facts, `null` when the session was never evaluated. */
  readonly network: SessionNetworkInput | null;
  /** C94.2: the stored bodies, in any order. */
  readonly bodies: readonly SignalBodyInput[];
  /** C96.4: the issuing session when this session was created by a handoff redemption. */
  readonly handoffFromSessionId: string | null;
}

/** C90.2: everything the inquiry signals read. */
export interface InquirySignalsInput {
  readonly environment: 'sandbox' | 'production';
  /** C90.6: the resolved `collect` of the pinned `signal-config`: `default` or catalogue names. */
  readonly collect: 'default' | readonly string[];
  readonly computedAt: Date;
  /** Every session of the inquiry, in any order. */
  readonly sessions: readonly SignalSessionInput[];
  /**
   * C90.2: the issuing country (ISO alpha-2 or alpha-3, or an ICAO code) of the latest government
   * ID verification decided `passed` or `needs_review`; `null` when there is none or it has no
   * country.
   */
  readonly governmentIdCountry: string | null;
  /**
   * C211.5: the inquiry's Play Integrity facts. Left out by a caller that does not read them, in which
   * case the two Play Integrity signals read `collector_missing`, never a value.
   */
  readonly deviceIntegrity?: DeviceIntegrityInput | undefined;
}
