/**
 * The chip evidence as the console shows it (C52.8, C62, C66), read from the API answer only:
 * the verification's C52.8 attributes, its check results (their metadata and provenance) and the
 * files. Passive authentication's states come from its result's metadata, else from the
 * `passive-authentication` attribute (which survives a redaction). Every threshold comes from the
 * result's provenance. Metadata is `unknown` in the contract, so it is read defensively: a value
 * of the wrong shape counts as not recorded.
 */
import {
  CHIP_INTEGRITY_OUTCOMES,
  CHIP_REVOCATION_OUTCOMES,
  GOVERNMENT_ID_NFC_VERIFICATION_ATTRIBUTES,
  PII_VERIFICATION_ATTRIBUTES,
  SANDBOX_CHIP_LABEL_MEMBER,
  SANDBOX_CHIP_SCENARIOS,
  type FileResource,
  type VerificationCheck,
  type VerificationResource,
} from '@openverify/contracts';
import type { EvidenceProps } from '../components/evidence/generic';
import type { ChipIntegrity, ChipRevocation } from './government-id-nfc-words';

export type ChipVerification = Extract<
  VerificationResource,
  { type: 'verification/government-id-nfc' }
>;

/**
 * What the chip evidence takes (C54.5): `EvidenceProps`, whose `files` (the verification's own
 * file resources: the chip portrait), `media` and `inquiryFiles` (the inquiry's file resources:
 * the selfie centre photo the portrait was compared with) the card and the page pass. Without the
 * inquiry's files the evidence points to the selfie verification instead.
 */
export type ChipEvidenceProps = EvidenceProps;

export interface DataGroupRow {
  /** As the metadata names it: `dg1`, `dg2`, … */
  readonly key: string;
  readonly number: number;
  readonly state: string;
}

/** How the document signer's certificate stood at verification time (C62.2). */
export type SignerValidity = 'valid' | 'expired' | 'profile_invalid' | 'missing' | 'not_judged';

/** `id_nfc_passive_authentication_detection` and the `passive-authentication` attribute. */
export interface PassiveAuthenticationEvidence {
  readonly result: VerificationCheck | undefined;
  readonly outcome: string | null;
  readonly integrity: ChipIntegrity | null;
  readonly integrityReason: string | null;
  readonly revocation: ChipRevocation | null;
  readonly revocationGap: string | null;
  /** `strict` or `best-effort` (the result's threshold). */
  readonly revocationMode: string | null;
  readonly hashAlgorithm: string | null;
  readonly signatureAlgorithm: string | null;
  /** The enabled source that listed the anchor at decision time. */
  readonly anchorSource: string | null;
  readonly anchorMatchedBy: string | null;
  readonly anchorLink: boolean | null;
  readonly anchorSandboxOnly: boolean | null;
  readonly signerValidity: SignerValidity;
  /** By data-group number. */
  readonly dataGroups: readonly DataGroupRow[];
  readonly flags: readonly string[];
}

export interface ActiveAuthenticationEvidence {
  readonly result: VerificationCheck | undefined;
  readonly outcome: string | null;
  readonly scheme: string | null;
  readonly hashAlgorithm: string | null;
  readonly required: boolean | null;
  /** What the reading device says it ran (`device-reported`): client-reported, never evidence. */
  readonly deviceReported: readonly string[];
}

export interface MrzComparisonEvidence {
  readonly result: VerificationCheck | undefined;
  readonly compared: readonly string[];
  readonly mismatched: readonly string[];
  readonly confusablesTolerated: boolean | null;
  readonly governmentIdVerificationId: string | null;
}

export interface ChipSelfieEvidence {
  readonly result: VerificationCheck | undefined;
  readonly similarity: number | null;
  readonly threshold: number | null;
  readonly selfieVerificationId: string | null;
}

export interface RepeatEvidence {
  readonly result: VerificationCheck | undefined;
  /** Earlier selfie-bound reads of this chip in other accounts' inquiries. */
  readonly sightings: number | null;
  readonly sightingOutcome: string | null;
}

export interface ChipExpiryEvidence {
  readonly result: VerificationCheck | undefined;
  readonly daysPastExpiration: number | null;
  readonly graceDays: number | null;
}

export interface ChipEvidenceData {
  readonly passiveAuthentication: PassiveAuthenticationEvidence;
  readonly activeAuthentication: ActiveAuthenticationEvidence;
  readonly mrz: MrzComparisonEvidence;
  readonly selfie: ChipSelfieEvidence;
  readonly repeat: RepeatEvidence;
  readonly expiry: ChipExpiryEvidence;
  /** DG1's personal fields (C52.8), in their API order, as the API sent them. */
  readonly fields: readonly (readonly [string, string | null])[];
  readonly idClass: string | null;
  readonly issuingCountry: string | null;
  /** C208.4: the scenario of the sandbox test chip this was read from; `null` for any other chip. */
  readonly sandboxChip: string | null;
}

type Metadata = Readonly<Record<string, unknown>>;

const INTEGRITIES: ReadonlySet<string> = new Set(CHIP_INTEGRITY_OUTCOMES);
const REVOCATIONS: ReadonlySet<string> = new Set(CHIP_REVOCATION_OUTCOMES);
const PII: ReadonlySet<string> = new Set(PII_VERIFICATION_ATTRIBUTES);
const SCENARIOS: ReadonlySet<string> = new Set(SANDBOX_CHIP_SCENARIOS);
/** DG1's personal fields (C52.8), in the attribute schema's order. */
const CHIP_FIELDS = Object.keys(GOVERNMENT_ID_NFC_VERIFICATION_ATTRIBUTES).filter((name) =>
  PII.has(name),
);

const isRecord = (value: unknown): value is Metadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const stringOr = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const booleanOr = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const integrityOr = (value: unknown): ChipIntegrity | null =>
  typeof value === 'string' && INTEGRITIES.has(value) ? (value as ChipIntegrity) : null;
const revocationOr = (value: unknown): ChipRevocation | null =>
  typeof value === 'string' && REVOCATIONS.has(value) ? (value as ChipRevocation) : null;

function resultOf(verification: ChipVerification, name: string): VerificationCheck | undefined {
  return verification.attributes.checks.find((check) => check.name === name);
}

const metadataOf = (result: VerificationCheck | undefined): Metadata => result?.metadata ?? {};

/** A threshold the result was judged against (its provenance, C39.3), or `undefined`. */
function thresholdOf(result: VerificationCheck | undefined, key: string): unknown {
  const thresholds = result?.provenance?.thresholds;
  return thresholds !== undefined && Object.hasOwn(thresholds, key) ? thresholds[key] : undefined;
}

/** How the signer certificate stood: established integrity needs it valid now (C62.2). */
function signerValidityOf(integrity: ChipIntegrity | null, reason: string | null): SignerValidity {
  if (integrity === 'established') {
    return 'valid';
  }
  if (integrity === 'not_established') {
    if (reason === 'certificate_expired') return 'expired';
    if (reason === 'certificate_profile_invalid') return 'profile_invalid';
    if (reason === 'dsc_missing') return 'missing';
  }
  return 'not_judged';
}

function dataGroupsOf(value: unknown): DataGroupRow[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .flatMap(([key, state]) => {
      const match = /^dg([1-9]\d?)$/.exec(key);
      return match?.[1] !== undefined && typeof state === 'string'
        ? [{ key, number: Number(match[1]), state }]
        : [];
    })
    .sort((a, b) => a.number - b.number);
}

function passiveAuthenticationOf(verification: ChipVerification): PassiveAuthenticationEvidence {
  const result = resultOf(verification, 'id_nfc_passive_authentication_detection');
  const metadata = metadataOf(result);
  const attribute = verification.attributes['passive-authentication'] ?? null;
  const integrity = integrityOr(metadata.integrity) ?? attribute?.integrity ?? null;
  const integrityReason = stringOr(metadata['integrity-reason']);
  return {
    result,
    outcome: attribute?.outcome ?? result?.status ?? null,
    integrity,
    integrityReason,
    revocation: revocationOr(metadata.revocation) ?? attribute?.revocation ?? null,
    revocationGap: stringOr(metadata['revocation-gap']),
    revocationMode: stringOr(thresholdOf(result, 'revocation')),
    hashAlgorithm: stringOr(metadata['hash-algorithm']) ?? attribute?.['hash-algorithm'] ?? null,
    signatureAlgorithm: stringOr(metadata['signature-algorithm']),
    anchorSource: attribute?.['anchor-source'] ?? null,
    anchorMatchedBy: stringOr(metadata['anchor-matched-by']),
    anchorLink: booleanOr(metadata['anchor-link']),
    anchorSandboxOnly: booleanOr(metadata['anchor-sandbox-only']),
    signerValidity: signerValidityOf(integrity, integrityReason),
    dataGroups: dataGroupsOf(metadata['data-groups']),
    flags: strings(metadata.flags),
  };
}

function activeAuthenticationOf(verification: ChipVerification): ActiveAuthenticationEvidence {
  const result = resultOf(verification, 'id_nfc_chip_authentication_detection');
  const metadata = metadataOf(result);
  return {
    result,
    outcome: stringOr(metadata.outcome),
    scheme: stringOr(metadata.scheme),
    hashAlgorithm: stringOr(metadata['hash-algorithm']),
    required: booleanOr(thresholdOf(result, 'require-active-authentication')),
    deviceReported: strings(metadata['device-reported']),
  };
}

/** C208.4: the scenario the API names for a sandbox test chip; anything else is no test chip. */
const sandboxChipOf = (value: unknown): string | null =>
  typeof value === 'string' && SCENARIOS.has(value) ? value : null;

/** What the API recorded of a chip verification, read defensively. */
export function chipEvidenceOf(verification: ChipVerification): ChipEvidenceData {
  const { attributes } = verification;
  const mrz = resultOf(verification, 'id_nfc_mrz_comparison');
  const selfie = resultOf(verification, 'id_nfc_selfie_comparison');
  const repeat = resultOf(verification, 'id_nfc_repeat_detection');
  const expiry = resultOf(verification, 'id_nfc_expired_detection');
  const values = attributes as Readonly<Record<string, unknown>>;
  return {
    passiveAuthentication: passiveAuthenticationOf(verification),
    activeAuthentication: activeAuthenticationOf(verification),
    mrz: {
      result: mrz,
      compared: strings(metadataOf(mrz)['compared-fields']),
      mismatched: strings(metadataOf(mrz)['mismatched-fields']),
      confusablesTolerated: booleanOr(metadataOf(mrz)['confusables-tolerated']),
      governmentIdVerificationId: stringOr(metadataOf(mrz)['government-id-verification-id']),
    },
    selfie: {
      result: selfie,
      similarity: numberOr(metadataOf(selfie).similarity),
      threshold:
        numberOr(metadataOf(selfie).threshold) ?? numberOr(thresholdOf(selfie, 'threshold')),
      selfieVerificationId: stringOr(metadataOf(selfie)['selfie-verification-id']),
    },
    repeat: {
      result: repeat,
      sightings: numberOr(metadataOf(repeat).sightings),
      sightingOutcome: stringOr(thresholdOf(repeat, 'sighting-outcome')),
    },
    expiry: {
      result: expiry,
      daysPastExpiration: numberOr(metadataOf(expiry)['days-past-expiration']),
      graceDays: numberOr(thresholdOf(expiry, 'grace-days')),
    },
    fields: CHIP_FIELDS.map((name) => [name, stringOr(values[name])] as const),
    idClass: attributes['id-class'] ?? null,
    issuingCountry: attributes['issuing-country'] ?? null,
    sandboxChip: sandboxChipOf(values[SANDBOX_CHIP_LABEL_MEMBER]),
  };
}

/** The latest file of `kind` among `files`; with an id, that verification's only. */
function latestOfKind(
  files: readonly FileResource[],
  kind: FileResource['attributes']['kind'],
  verificationId: string | undefined,
): FileResource | undefined {
  return files
    .filter(
      (file) =>
        file.attributes.kind === kind &&
        (verificationId === undefined ||
          file.relationships.verification.data.id === verificationId),
    )
    .at(-1);
}

/** The verification's latest chip portrait (`chip-portrait`, a PNG the server converted). */
export function chipPortraitOf(
  files: readonly FileResource[],
  verificationId?: string,
): FileResource | undefined {
  return latestOfKind(files, 'chip-portrait', verificationId);
}

/** The latest centre photo of the selfie verification the portrait was compared with. */
export function selfieCenterOf(
  inquiryFiles: readonly FileResource[],
  selfieVerificationId: string | null,
): FileResource | undefined {
  return selfieVerificationId === null
    ? undefined
    : latestOfKind(inquiryFiles, 'selfie-center', selfieVerificationId);
}
