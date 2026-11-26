/**
 * What the government ID NFC evaluators read (C62.3, C62.4, C62.6). The worker (`api-nfc`) runs
 * `@openverify/emrtd` first and passes its reports: Passive Authentication (integrity apart from
 * revocation, per-data-group states), Active Authentication over this challenge's nonce, and
 * DG1 as parsed. It adds what the chip cannot say: the pinned flow's government ID step, the
 * inquiry's government ID MRZ readings, its latest selfie, the chip portrait's embedding (decoded
 * through vision only after DG2's hash verified, C62.6), and the selfie-bound sightings of the
 * SOD on other accounts. Every value here is PII or biometric: in memory only, never logged.
 */
import type { CheckModel, IdClass } from '@openverify/core';
import type {
  ActiveAuthenticationReport,
  ParsedDg1,
  PassiveAuthenticationReport,
} from '@openverify/emrtd';
import type { EnvironmentKind } from '../data/feature-table.js';

/** The chip protocols a device may claim (C62.6): kept as `device-reported`, never evidence. */
export const DEVICE_REPORTED_PROTOCOLS = [
  'bac',
  'pace',
  'pace_cam',
  'chip_authentication',
  'active_authentication',
  'terminal_authentication',
] as const;
export type DeviceReportedProtocol = (typeof DEVICE_REPORTED_PROTOCOLS)[number];

/** The printed MRZ fields the MRZ comparison reads (C31.5 names, YYYY-MM-DD dates). */
export const NFC_MRZ_REFERENCE_FIELDS = [
  'name-first',
  'name-last',
  'birthdate',
  'identification-number',
  'expiration-date',
  'nationality',
  'issuing-authority-code',
] as const;
export type NfcMrzReferenceField = (typeof NFC_MRZ_REFERENCE_FIELDS)[number];

/**
 * One government ID verification's MRZ reading: the extraction's fields whose value came from the
 * printed MRZ (C31.5), its established class, and whether the printed MRZ's check digits held.
 */
export interface NfcMrzReference {
  readonly verificationId: string;
  readonly idClass: IdClass | null;
  readonly fields: Readonly<Partial<Record<NfcMrzReferenceField, string | null>>>;
  /** `false` or `null` (unknown): OCR confusables are tolerated (C62.6). */
  readonly checkDigitsValid: boolean | null;
}

/** The inquiry's latest selfie centre face (C62.6), or why there is none. */
export type NfcSelfieReference =
  | {
      readonly kind: 'face';
      readonly verificationId: string;
      readonly embedding: readonly number[];
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error' };

/** The chip portrait (DG2) as vision embedded it, or why it was not. */
export type NfcChipPortrait =
  | { readonly kind: 'face'; readonly embedding: readonly number[] }
  /** Vision found no face in it. */
  | { readonly kind: 'no_face' }
  /** DG2 was absent, unreadable, or its hash did not verify, so it was never decoded. */
  | { readonly kind: 'not_decoded' }
  /** Vision failed for good. */
  | { readonly kind: 'error' };

export interface GovernmentIdNfcCheckInput {
  readonly environment: EnvironmentKind;
  /** `null` without an SOD. */
  readonly passiveAuthentication: PassiveAuthenticationReport | null;
  /** `null` when Active Authentication was not run. */
  readonly activeAuthentication: ActiveAuthenticationReport | null;
  /** DG1 as `parseDg1` read it, `null` when absent or unreadable. */
  readonly dg1: ParsedDg1 | null;
  /** Whether the pinned flow has a government ID step (C62.6: else `not_requested`). */
  readonly governmentIdStep: boolean;
  /** The inquiry's government ID MRZ readings, latest first. */
  readonly mrzReferences: readonly NfcMrzReference[];
  readonly selfie: NfcSelfieReference;
  readonly chipPortrait: NfcChipPortrait;
  /** Selfie-bound reads of this SOD on other accounts (C62.6), `null` when not looked up. */
  readonly sightings: number | null;
  /** The protocols the device says succeeded; anything outside the list is dropped. */
  readonly deviceReportedProtocols?: readonly string[] | undefined;
  /** The face models the embeddings came from, for provenance. */
  readonly faceModels?: readonly CheckModel[] | undefined;
  /** The evaluation instant; now by default. */
  readonly now?: Date | undefined;
}
