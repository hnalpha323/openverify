/**
 * The shared context of one document verification's checks (C60.5, C60.6): vision's answer, the
 * document's lines, the classification (with the type check's `min-confidence`), the extraction,
 * and the cascade's gate. A class is established when the classifier answered one of the five
 * classes and the step accepts it; until then the properties, expiry, recency and comparison
 * checks answer `input_missing` (H22: one mistake fails one check).
 */
import { DOCUMENT_TYPES, type CheckModel, type VerificationTemplateConfig } from '@openverify/core';
import { phase5CheckConfig } from '../contact/phase5-config.js';
import type { PostalAddress } from '../matching/addresses.js';
import type { PersonName } from '../matching/names.js';
import { countryAlpha2 } from '../matching/postal-codes.js';
import { presentText } from '../result.js';
import { classifyDocument, type DocumentClassifierResult } from './classify.js';
import { extractDocumentFields, type DocumentExtraction } from './extract.js';
import type {
  DocumentAnalysisInput,
  DocumentCheckInput,
  DocumentClass,
  DocumentClassification,
  DocumentReference,
  DocumentVisionRefusal,
} from './inputs.js';
import { documentLines, type DocumentLine } from './lines.js';

export interface DocumentContext {
  readonly input: DocumentCheckInput;
  readonly template: VerificationTemplateConfig;
  readonly now: Date;
  /** vision's measurements, when it analysed the document. */
  readonly analysis: DocumentAnalysisInput | null;
  /** What vision refused the document for, when it did. */
  readonly refusal: DocumentVisionRefusal | null;
  /** vision failed for good after its retries. */
  readonly visionFailed: boolean;
  readonly lines: readonly DocumentLine[];
  readonly classifier: DocumentClassifierResult | null;
  /** The accepted class the type check established, or `null` (the cascade's gate). */
  readonly established: DocumentClass | null;
  readonly extraction: DocumentExtraction | null;
  /** The reference address's country, which the extraction read postal codes and dates by. */
  readonly countryHint: string | null;
}

/** Where a reference came from (C60.6), in the order they are read. */
export type DocumentReferenceSource = 'inquiry' | 'government_id' | 'account';

const REFERENCE_ORDER: readonly [
  DocumentReferenceSource,
  'inquiry' | 'governmentId' | 'account',
][] = [
  ['inquiry', 'inquiry'],
  ['government_id', 'governmentId'],
  ['account', 'account'],
];

/** The type check's `min-confidence` when the template sets none (C51.3). */
const DEFAULT_MIN_CONFIDENCE = 0.5;

const references = (input: DocumentCheckInput) =>
  REFERENCE_ORDER.flatMap(([source, key]) => {
    const reference: DocumentReference | null | undefined = input.references?.[key];
    return reference === null || reference === undefined ? [] : [{ source, reference }];
  });

const hasName = (name: PersonName | null | undefined) =>
  name !== null &&
  name !== undefined &&
  [name.first, name.middle, name.last].some((part) => presentText(part) !== null);

const hasAddress = (address: PostalAddress | null | undefined) =>
  address !== null &&
  address !== undefined &&
  [address.street1, address.postalCode, address.city].some((part) => presentText(part) !== null);

/** The first reference holding a name: the inquiry's, else the ID's, else the account's. */
export function documentReferenceName(
  input: DocumentCheckInput,
): { readonly source: DocumentReferenceSource; readonly name: PersonName } | null {
  for (const { source, reference } of references(input)) {
    if (hasName(reference.name) && reference.name !== null && reference.name !== undefined) {
      return { source, name: reference.name };
    }
  }
  return null;
}

/** The first reference holding an address. */
export function documentReferenceAddress(
  input: DocumentCheckInput,
): { readonly source: DocumentReferenceSource; readonly address: PostalAddress } | null {
  for (const { source, reference } of references(input)) {
    if (
      hasAddress(reference.address) &&
      reference.address !== null &&
      reference.address !== undefined
    ) {
      return { source, address: reference.address };
    }
  }
  return null;
}

/** The first reference address's country, as ISO 3166-1 alpha-2. */
function referenceCountry(input: DocumentCheckInput): string | null {
  for (const { reference } of references(input)) {
    const country = countryAlpha2(reference.address?.countryCode);
    if (country !== null) {
      return country;
    }
  }
  return null;
}

const isClass = (value: DocumentClassification): value is DocumentClass =>
  (DOCUMENT_TYPES as readonly string[]).includes(value);

/** Builds the context of one document verification: now unless given. */
export function documentContext(
  input: DocumentCheckInput,
  template: VerificationTemplateConfig,
): DocumentContext {
  const now = input.now ?? new Date();
  const { vision } = input;
  const countryHint = referenceCountry(input);
  const base = {
    input,
    template,
    now,
    refusal: vision?.kind === 'refused' ? vision.refusal : null,
    visionFailed: vision?.kind === 'error',
    countryHint,
  };
  if (vision?.kind !== 'analysis') {
    return {
      ...base,
      analysis: null,
      lines: [],
      classifier: null,
      established: null,
      extraction: null,
    };
  }
  const { analysis } = vision;
  const lines = documentLines(analysis);
  const configured = phase5CheckConfig(template, 'document_type_detection').values[
    'min-confidence'
  ];
  const classifier = classifyDocument(lines, {
    minConfidence: typeof configured === 'number' ? configured : DEFAULT_MIN_CONFIDENCE,
  });
  const { classification } = classifier;
  const established =
    isClass(classification) && input.acceptedTypes.includes(classification) ? classification : null;
  return {
    ...base,
    analysis,
    lines,
    classifier,
    established,
    extraction: extractDocumentFields(lines, {
      language: classifier.language,
      classification,
      countryHint,
    }),
  };
}

/** The OCR models a result rests on, when vision read the document by OCR (C29.2). */
export function documentOcrModels(context: DocumentContext): readonly CheckModel[] | undefined {
  const usedOcr = context.analysis?.pages.some((page) => page.ocr.length > 0) ?? false;
  const models = [context.input.models?.textDetector, context.input.models?.textRecognizer].filter(
    (model): model is CheckModel => model !== undefined,
  );
  return usedOcr && models.length > 0 ? models : undefined;
}
