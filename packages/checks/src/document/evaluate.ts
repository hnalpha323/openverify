/**
 * Runs the document checks a template enables for one verification (C60.6), in configuration
 * order, over one shared context, and gives the API what it stores (`document_extractions`: the
 * class, its confidence, the page count and the extracted fields, C53.3, C52.8). Every document
 * check has an evaluator, so none answers `pending` or `not_implemented`; disabled checks produce
 * no result.
 */
import type { CheckResult, VerificationTemplateConfig } from '@openverify/core';
import { enabledChecksOf } from '../contact/phase5-config.js';
import { capText } from '../matching/limits.js';
import type { WritingSystem } from '../matching/text.js';
import { documentContext, type DocumentContext } from './context.js';
import type { DocumentDate } from './dates.js';
import { DOCUMENT_EVALUATORS } from './evaluators.js';
import type {
  DocumentCheckInput,
  DocumentClassification,
  DocumentVisionRefusal,
} from './inputs.js';
import type { DocumentLanguage } from './lexicons/types.js';

/** The C52.8 `fields` members a document extraction fills. */
export const DOCUMENT_FIELD_NAMES = [
  'name',
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
  'issue-date',
  'issuer',
  'expiration-date',
] as const;
export type DocumentFieldName = (typeof DOCUMENT_FIELD_NAMES)[number];

/** The extracted values (PII), each `null` when not read; capped to the attribute's lengths. */
export type DocumentFields = Readonly<Record<DocumentFieldName, string | null>>;

/** What the API stores of a document vision analysed (C53.3). */
export interface DocumentReading {
  readonly documentType: DocumentClassification;
  /** The top class probability, uncalibrated; `null` without text to score. */
  readonly typeConfidence: number | null;
  readonly language: DocumentLanguage | null;
  readonly script: WritingSystem | null;
  readonly pageCount: number;
  readonly source: 'pdf' | 'image';
  readonly fields: DocumentFields;
}

export interface DocumentEvaluation {
  readonly results: CheckResult[];
  /** `null` when vision did not analyse the document. */
  readonly reading: DocumentReading | null;
}

/**
 * Maps vision's refusal of a document (C60.1) to what the type check answers: 413 too large, 422
 * `too_many_pages`, 422 `pdf_encrypted`, anything else unreadable (415, 422 `pdf_unprocessable`).
 */
export function documentVisionRefusalOf(
  status: number,
  code: string | null,
): DocumentVisionRefusal {
  if (status === 413) {
    return 'too_large';
  }
  if (code === 'too_many_pages') {
    return 'too_many_pages';
  }
  return code === 'pdf_encrypted' ? 'password_protected' : 'unreadable';
}

const CONTROL = /[\p{Cc}\p{Cf}]/gu;
const COUNTRY = /^[A-Z]{2}$/;

/** A value as the attribute schema takes it: no control character, capped, `null` when empty. */
function stored(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = capText(value.replace(CONTROL, ' ').trim(), max).trim();
  return text === '' ? null : text;
}

/** A printed date with one reading; `null` for none or two. */
const onlyReading = (date: DocumentDate | null): string | null =>
  date?.readings.length === 1 ? (date.readings[0] ?? null) : null;

function readingOf(context: DocumentContext): DocumentReading | null {
  const { analysis, classifier, extraction } = context;
  if (analysis === null || classifier === null || extraction === null) {
    return null;
  }
  const address = extraction.address;
  const country = address?.countryCode ?? null;
  return {
    documentType: classifier.classification,
    typeConfidence: classifier.confidence,
    language: classifier.language,
    script: classifier.script,
    pageCount: analysis.page_count,
    source: analysis.source,
    fields: {
      name: stored(extraction.name, 200),
      'address-street-1': stored(address?.street1, 200),
      'address-street-2': stored(address?.street2, 200),
      'address-city': stored(address?.city, 100),
      'address-subdivision': stored(address?.subdivision, 100),
      'address-postal-code': stored(address?.postalCode, 20),
      'address-country-code': country !== null && COUNTRY.test(country) ? country : null,
      // A tax year's end is not printed, so it is not stored as the issue date.
      'issue-date':
        extraction.issueDateSource === 'tax-year' ? null : onlyReading(extraction.issueDate),
      issuer: stored(extraction.issuer, 200),
      'expiration-date': onlyReading(extraction.expiry),
    },
  };
}

/**
 * Evaluates the enabled `document` checks and reads what the API stores.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateDocument(
  input: DocumentCheckInput,
  config: VerificationTemplateConfig,
): DocumentEvaluation {
  const ids = enabledChecksOf('document', config);
  const context = documentContext(input, config);
  const evaluators: Readonly<
    Record<string, ((context: DocumentContext) => CheckResult) | undefined>
  > = DOCUMENT_EVALUATORS;
  return {
    results: ids.flatMap((id) => {
      const evaluate = evaluators[id];
      return evaluate === undefined ? [] : [evaluate(context)];
    }),
    reading: readingOf(context),
  };
}

/**
 * Evaluates the enabled `document` checks.
 * @throws {InvalidCheckConfigError} as {@link evaluateDocument}.
 */
export function evaluateDocumentChecks(
  input: DocumentCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  return evaluateDocument(input, config).results;
}
