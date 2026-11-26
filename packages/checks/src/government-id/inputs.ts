/**
 * What the government ID evaluators read (C29-C35): the vision analysis and uploads (Phase 1),
 * and what the worker adds from Phase 3 on. Every Phase 3 field is optional, so the Phase 1 worker
 * still compiles; an evaluator whose evidence is absent answers `input_missing`, never `passed`.
 */
import type { CheckModel, CheckProvider, ExtractedFields, IdClass } from '@openverify/core';
import type { ComparisonSourceKind } from '../comparison-source.js';
import type { EnvironmentKind } from '../data/feature-table.js';
import type { GovernmentIdExtraction } from '../extraction/extract.js';
import type {
  GovernmentIdAnalysisInput,
  IdSides,
  UploadedImage,
  VisionEmbeddedFaceInput,
} from '../phase1/inputs.js';

export type { EnvironmentKind } from '../data/feature-table.js';

/** The models a result may rest on, pinned by SHA-256 (C29.2 provenance), as the worker knows them. */
export interface GovernmentIdModels {
  faceDetector?: CheckModel | undefined;
  faceRecognizer?: CheckModel | undefined;
  textDetector?: CheckModel | undefined;
  textRecognizer?: CheckModel | undefined;
}

/**
 * A provider's answer (C35): none bound in this environment, a failure after the job's retries,
 * or a result labelled with the provider (`sandbox: true` for a sandbox provider).
 */
export type ProviderOutcome<Result> =
  | { kind: 'not_configured' }
  | { kind: 'error' }
  | { kind: 'result'; provider: CheckProvider; result: Result };

/** AAMVA DLDV: the record matches, differs, or does not exist. */
export interface AamvaLookupResult {
  outcome: 'match' | 'no_match' | 'not_found' | 'jurisdiction_not_participating';
  /** C31.5 field names the record disagrees on; never values. */
  mismatchedFields?: readonly string[] | undefined;
}

/** A public-figure gallery: a match, no match, or no gallery to compare with. */
export interface PublicFigureResult {
  outcome: 'match' | 'no_match' | 'gallery_empty';
}

/** An apparent-age estimate of the ID portrait. */
export interface AgeEstimateResult {
  estimatedAge: number;
  /** The provider's own confidence in [0, 1], when it gives one. */
  confidence?: number | null | undefined;
}

export interface GovernmentIdProviders {
  aamva?: ProviderOutcome<AamvaLookupResult> | undefined;
  publicFigure?: ProviderOutcome<PublicFigureResult> | undefined;
  ageEstimate?: ProviderOutcome<AgeEstimateResult> | undefined;
}

/** An earlier extraction the C34 repeat lookup found in the same environment. */
export interface RepeatCandidate {
  verificationId: string;
  /** Same blind index of the identification number. */
  sameIdentificationNumber: boolean;
  /** Hamming distance of the front pHashes, or `null` when not compared. */
  phashDistance: number | null;
  /** The earlier inquiry belongs to the same account, so it is not a repeat by another. */
  sameAccount: boolean;
}

export interface RepeatHistory {
  /** The blind-index lookup ran (the extraction had a number and the worker an index). */
  identificationNumberLookup: boolean;
  /** The pHash band lookup ran, within the configured distance. */
  phashLookup: boolean;
  candidates: readonly RepeatCandidate[];
}

/** An earlier extraction with the same blind index (C34), its identity decrypted for comparison. */
export interface SameNumberCandidate {
  verificationId: string;
  fields: Pick<ExtractedFields, 'name-first' | 'name-last' | 'birthdate'>;
  /** Cosine similarity of the re-embedded portraits, or `null` when its files are gone (C31.9). */
  faceSimilarity: number | null;
}

export interface InconsistentRepeatHistory {
  candidates: readonly SameNumberCandidate[];
}

export interface GovernmentIdHistory {
  repeat?: RepeatHistory | undefined;
  inconsistentRepeat?: InconsistentRepeatHistory | undefined;
}

/** The reference data of the comparisons (C34), snake_case keys as the account fields. */
export interface GovernmentIdReferences {
  inquiryFields?: Readonly<Record<string, unknown>> | null | undefined;
  /**
   * C149.4 (Workflow 9B, (F)): by field key, where `inquiryFields`' value came from (`initial`, set at
   * creation, or `entered` later); the check records it under `COMPARISON_SOURCE_METADATA_KEY`.
   */
  inquiryFieldSources?: Readonly<Record<string, ComparisonSourceKind>> | null | undefined;
  accountFields?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * The selfie `id_selfie_comparison` compares with the ID portrait (C34; its v2 input contract,
 * C43): the centre face of the inquiry's latest selfie verification that is `passed`,
 * `submitted` or `needs_review`, as `selfie_id_comparison` selects its ID portrait. `face` is
 * `null` when that selfie shows none.
 */
export interface SelfieFace {
  face: VisionEmbeddedFaceInput | null;
  verificationId: string;
}

/** The flow step's allowlists (C29.5 rule 2), used when the template config sets none. */
export interface StepPolicy {
  allowedCountries?: readonly string[] | undefined;
  allowedIdClasses?: readonly IdClass[] | undefined;
}

export interface GovernmentIdCheckInput {
  analysis: GovernmentIdAnalysisInput;
  /** Sides the flow step asks for. */
  requiredSides: IdSides;
  uploads: { front: UploadedImage | null; back: UploadedImage | null };
  /** The C31 extraction; derived from `analysis` when omitted. */
  extraction?: GovernmentIdExtraction | undefined;
  /** `production` when omitted: the C30.7 test issuer is then a specimen. */
  environment?: EnvironmentKind | undefined;
  /** The evaluation instant; now when omitted. */
  now?: Date | undefined;
  step?: StepPolicy | undefined;
  history?: GovernmentIdHistory | undefined;
  references?: GovernmentIdReferences | undefined;
  /** `null` when the inquiry has no selfie yet; omitted when not looked up. */
  selfie?: SelfieFace | null | undefined;
  providers?: GovernmentIdProviders | undefined;
  /**
   * C99.9 (H09): the lists opted in with `use-for-compromised-ids`, read for the identification
   * number; absent with no such list or no number. `unscreened` names the lists it could not read,
   * and `screened` those it did, for the check's metadata.
   */
  compromisedList?:
    | {
        matched: boolean;
        unscreened: readonly { 'list-id': string; reason: string }[];
        screened?: readonly string[] | undefined;
      }
    | undefined;
  models?: GovernmentIdModels | undefined;
}
