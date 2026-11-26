/**
 * The document evidence as the console shows it (C52.8, C60, C66), read from the API answer
 * only: the verification's C52.8 attributes, its check results (their metadata and provenance)
 * and its files. Every threshold comes from the result's provenance, never from the console's own
 * copy of a default. Metadata is `unknown` in the contract, so it is read defensively: a value of
 * the wrong shape counts as not recorded.
 */
import {
  DOCUMENT_CLASSIFICATIONS,
  documentFieldsSchema,
  type FileResource,
  type VerificationCheck,
  type VerificationResource,
} from '@openverify/contracts';
import {
  CUE_STRENGTHS,
  type CueStrength,
  type DocumentClassification,
  type DocumentField,
} from './document-words';
import type { EvidenceProps } from '../components/evidence/generic';

export type DocumentVerification = Extract<VerificationResource, { type: 'verification/document' }>;

/**
 * What the document evidence takes (C54.5): `EvidenceProps`, whose `files` (the verification's
 * own file resources, whose kinds name the preview and the original) and `media` (how its images
 * may show) the card and the page pass. Without files the evidence leaves them to the files
 * section.
 */
export type DocumentEvidenceProps = EvidenceProps;

export interface ClassProbability {
  readonly classification: DocumentClassification;
  readonly probability: number;
}

/** `document_type_detection` and the stored class (C52.8, C60.5). */
export interface DocumentClassEvidence {
  readonly result: VerificationCheck | undefined;
  readonly classification: DocumentClassification | null;
  /** The top class probability, uncalibrated (C60.6). */
  readonly confidence: number | null;
  /** Highest first. */
  readonly probabilities: readonly ClassProbability[];
  readonly minConfidence: number | null;
  readonly language: string | null;
  readonly script: string | null;
  readonly identityDocument: boolean | null;
  readonly acceptedTypes: readonly DocumentClassification[];
  readonly features: readonly string[];
  readonly unknownReason: string | null;
}

/** One cue of `document_fabrication_detection`'s `metadata.components` (C60.6). */
export interface FabricationComponent {
  readonly id: string;
  readonly strength: CueStrength | null;
  readonly weight: number;
  /** How strongly vision's measurements showed the cue, from 0 to 1. */
  readonly signal: number;
  /** `weight × signal`, the cue's share of the score before the weak-cue cap. */
  readonly contribution: number;
}

export interface FabricationEvidence {
  readonly result: VerificationCheck | undefined;
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly weakCueCap: number | null;
  readonly components: readonly FabricationComponent[];
}

/** `document_name_comparison` or `document_address_comparison` (C60.6). */
export interface ComparisonEvidence {
  readonly result: VerificationCheck | undefined;
  readonly level: string | null;
  readonly referenceSource: string | null;
}

/** `document_recency_detection` and `document_expired_detection` (C60.6). */
export interface DatesEvidence {
  readonly recency: VerificationCheck | undefined;
  readonly expiry: VerificationCheck | undefined;
  readonly dateSource: string | null;
  readonly maxAgeDays: number | null;
  /** The tax-document window (C60.6: 18 months, provisional). */
  readonly maxAgeMonths: number | null;
  /** The recency flags, then the expiry flags. */
  readonly flags: readonly string[];
}

/** `document_extracted_properties_detection`. */
export interface PropertiesEvidence {
  readonly result: VerificationCheck | undefined;
  readonly required: readonly string[];
  readonly missing: readonly string[];
}

export interface DocumentEvidenceData {
  readonly documentClass: DocumentClassEvidence;
  readonly properties: PropertiesEvidence;
  readonly dates: DatesEvidence;
  readonly fabrication: FabricationEvidence;
  readonly name: ComparisonEvidence;
  readonly address: ComparisonEvidence;
  readonly pageCount: number | null;
  readonly mimeType: string | null;
  /** Every field of C52.8 in its API order, or `null` when the API sent no `fields`. */
  readonly fields: readonly (readonly [DocumentField, string | null])[] | null;
}

type Metadata = Readonly<Record<string, unknown>>;

const CLASSES: ReadonlySet<string> = new Set(DOCUMENT_CLASSIFICATIONS);
const STRENGTHS: ReadonlySet<string> = new Set(CUE_STRENGTHS);
const FIELDS = Object.keys(documentFieldsSchema.shape) as DocumentField[];

const isRecord = (value: unknown): value is Metadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const stringOr = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const booleanOr = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const isClass = (value: unknown): value is DocumentClassification =>
  typeof value === 'string' && CLASSES.has(value);

function resultOf(verification: DocumentVerification, name: string): VerificationCheck | undefined {
  return verification.attributes.checks.find((check) => check.name === name);
}

/** A result's metadata, `{}` without the result. */
const metadataOf = (result: VerificationCheck | undefined): Metadata => result?.metadata ?? {};

/** A numeric threshold the result was judged against (its provenance, C39.3). */
function thresholdOf(result: VerificationCheck | undefined, key: string): number | null {
  const thresholds = result?.provenance?.thresholds;
  return thresholds !== undefined && Object.hasOwn(thresholds, key)
    ? numberOr(thresholds[key])
    : null;
}

function documentClassOf(verification: DocumentVerification): DocumentClassEvidence {
  const { attributes } = verification;
  const result = resultOf(verification, 'document_type_detection');
  const metadata = metadataOf(result);
  const probabilities = isRecord(metadata.probabilities)
    ? Object.entries(metadata.probabilities)
        .flatMap(([classification, probability]) => {
          const value = numberOr(probability);
          return isClass(classification) && value !== null
            ? [{ classification, probability: value }]
            : [];
        })
        .sort((a, b) => b.probability - a.probability)
    : [];
  const stored = attributes['document-type'];
  return {
    result,
    classification: isClass(stored) ? stored : null,
    confidence: numberOr(attributes['document-type-confidence']),
    probabilities,
    minConfidence: thresholdOf(result, 'min-confidence'),
    language: stringOr(metadata.language),
    script: stringOr(metadata.script),
    identityDocument: booleanOr(metadata['identity-document']),
    acceptedTypes: strings(metadata['accepted-types']).filter(isClass),
    features: strings(metadata.features),
    unknownReason: stringOr(metadata['unknown-reason']),
  };
}

function componentOf(value: unknown): FabricationComponent[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = stringOr(value.id);
  const weight = numberOr(value.weight);
  const signal = numberOr(value.signal);
  const contribution = numberOr(value.contribution);
  if (id === null || weight === null || signal === null || contribution === null) {
    return [];
  }
  const strength = stringOr(value.strength);
  return [
    {
      id,
      strength: strength !== null && STRENGTHS.has(strength) ? (strength as CueStrength) : null,
      weight,
      signal,
      contribution,
    },
  ];
}

function fabricationOf(verification: DocumentVerification): FabricationEvidence {
  const result = resultOf(verification, 'document_fabrication_detection');
  const metadata = metadataOf(result);
  return {
    result,
    score: numberOr(metadata.score),
    maxScore: thresholdOf(result, 'max-fabrication-score'),
    weakCueCap: thresholdOf(result, 'weak-cue-cap'),
    components: Array.isArray(metadata.components) ? metadata.components.flatMap(componentOf) : [],
  };
}

function comparisonOf(verification: DocumentVerification, name: string): ComparisonEvidence {
  const result = resultOf(verification, name);
  const metadata = metadataOf(result);
  return {
    result,
    level: stringOr(metadata.level),
    referenceSource: stringOr(metadata['reference-source']),
  };
}

function datesOf(verification: DocumentVerification): DatesEvidence {
  const recency = resultOf(verification, 'document_recency_detection');
  const expiry = resultOf(verification, 'document_expired_detection');
  return {
    recency,
    expiry,
    dateSource: stringOr(metadataOf(recency)['date-source']),
    maxAgeDays: thresholdOf(recency, 'max-age-days'),
    maxAgeMonths: thresholdOf(recency, 'max-age-months'),
    flags: [...strings(metadataOf(recency).flags), ...strings(metadataOf(expiry).flags)],
  };
}

function propertiesOf(verification: DocumentVerification): PropertiesEvidence {
  const result = resultOf(verification, 'document_extracted_properties_detection');
  const metadata = metadataOf(result);
  return {
    result,
    required: strings(metadata['required-properties']),
    missing: strings(metadata.missing),
  };
}

function fieldsOf(
  verification: DocumentVerification,
): readonly (readonly [DocumentField, string | null])[] | null {
  const { fields } = verification.attributes;
  if (fields === null || fields === undefined) {
    return null;
  }
  return FIELDS.map((field) => [field, stringOr(fields[field])] as const);
}

/** What the API recorded of a document verification, read defensively. */
export function documentEvidenceOf(verification: DocumentVerification): DocumentEvidenceData {
  const { attributes } = verification;
  return {
    documentClass: documentClassOf(verification),
    properties: propertiesOf(verification),
    dates: datesOf(verification),
    fabrication: fabricationOf(verification),
    name: comparisonOf(verification, 'document_name_comparison'),
    address: comparisonOf(verification, 'document_address_comparison'),
    pageCount: numberOr(attributes['page-count']),
    mimeType: stringOr(attributes['mime-type']),
    fields: fieldsOf(verification),
  };
}

/** The latest file of `kind`; with `verificationId`, among that verification's files only. */
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

/**
 * The verification's latest page-1 preview (`document-preview`, a PNG the server rendered); with
 * `verificationId`, among that verification's files only.
 */
export function documentPreviewOf(
  files: readonly FileResource[],
  verificationId?: string,
): FileResource | undefined {
  return latestOfKind(files, 'document-preview', verificationId);
}

/**
 * The preview a document verification's evidence shows, from the same files the card or the page
 * gives it. The files section names this file instead of showing it a second time (Workflow 6B
 * P5-2). `undefined` for any other type, and when no preview is known.
 */
export function evidencePreviewOf(
  verification: Pick<VerificationResource, 'type' | 'id'>,
  files: readonly FileResource[],
): FileResource | undefined {
  return verification.type === 'verification/document'
    ? documentPreviewOf(files, verification.id)
    : undefined;
}

/** The verification's latest upload (`document`): a PDF or a photo. */
export function documentOriginalOf(
  files: readonly FileResource[],
  verificationId?: string,
): FileResource | undefined {
  return latestOfKind(files, 'document', verificationId);
}
