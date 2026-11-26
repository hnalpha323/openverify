/**
 * The document evidence vocabulary in words (C60, C66): the classes the classifier answers, the
 * extracted fields of C52.8, the fabrication cues of C60.6 and their strengths, the layout
 * features, why a class was not established, where the issue date was read, the recency and
 * expiry flags, the references the comparisons read, the match levels, and what a pass means.
 *
 * The test (`document-words.test.ts`) reads the cues, features, unknown reasons, date sources,
 * flags and references from the evaluators' own source (`packages/checks/src/document`), so a
 * value added there without words here fails it. A value the console does not know yet is shown
 * as its code, never as a crash.
 */
import type { DOCUMENT_CLASSIFICATIONS, documentFieldsSchema } from '@openverify/contracts';
import type { ReasonText } from './check-reasons';

/** What the classifier answers (C60.5): the five classes, `other` and `unknown`. */
export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];
/** The extracted fields of C52.8, in their API order. */
export type DocumentField = keyof (typeof documentFieldsSchema)['shape'];

/** The fabrication cues of C60.6, in the evaluator's order (`FABRICATION_SIGNAL_IDS`). */
export const FABRICATION_CUE_IDS = [
  'incremental-revisions',
  'xref-repaired',
  'editor-producer',
  'created-before-issue-date',
  'metadata-inconsistent',
  'image-editor-software',
  'amount-line-font',
  'mixed-font-subsets',
  'text-layer-mismatch',
  'double-compression-ela',
  'hidden-text-over-field',
  'edits-after-signature',
  'active-content',
  'copy-move',
] as const;
export type FabricationCueId = (typeof FABRICATION_CUE_IDS)[number];

/** Weak cues weigh at most 0.2, medium ones 0.4 to 0.5, strong ones 0.6 or more (C60.6). */
export const CUE_STRENGTHS = ['weak', 'medium', 'strong'] as const;
export type CueStrength = (typeof CUE_STRENGTHS)[number];

export const DOCUMENT_CLASS_LABELS: Readonly<Record<DocumentClassification, string>> =
  Object.freeze({
    utility_bill: 'Utility bill',
    bank_statement: 'Bank statement',
    lease: 'Lease or rental agreement',
    pay_stub: 'Pay stub',
    tax_document: 'Tax document',
    other: 'Another kind of document',
    unknown: 'Not recognised',
  });

export const DOCUMENT_FIELD_LABELS: Readonly<Record<DocumentField, string>> = Object.freeze({
  name: 'Name',
  'address-street-1': 'Street address',
  'address-street-2': 'Street address, line 2',
  'address-city': 'City',
  'address-subdivision': 'State or region',
  'address-postal-code': 'Postal code',
  'address-country-code': 'Country',
  'issue-date': 'Issue date',
  issuer: 'Issuer',
  'expiration-date': 'Expiry date',
});

/** Each cue: its words, and what vision's measurements showed when it fires. */
export const FABRICATION_CUE_TEXT: Readonly<Record<FabricationCueId, ReasonText>> = Object.freeze({
  'incremental-revisions': {
    words: 'Incremental revisions',
    explanation: 'The PDF was saved again after it was first written.',
  },
  'xref-repaired': {
    words: 'Repaired cross-reference',
    explanation: 'The PDF’s object table had to be repaired to be read.',
  },
  'editor-producer': {
    words: 'Editor as producer',
    explanation: 'The PDF names editing software as the program that wrote it.',
  },
  'created-before-issue-date': {
    words: 'Created before the printed issue date',
    explanation: 'The PDF’s creation date is earlier than the date printed on it.',
  },
  'metadata-inconsistent': {
    words: 'Info and XMP disagree',
    explanation: 'The document information dictionary and the XMP metadata disagree.',
  },
  'image-editor-software': {
    words: 'Image editor in EXIF',
    explanation: 'The photo’s EXIF data names editing software.',
  },
  'amount-line-font': {
    words: 'Another font in an amount line',
    explanation: 'A line holding an amount mixes in a font the rest of the line does not use.',
  },
  'mixed-font-subsets': {
    words: 'Mixed subsets of one font',
    explanation: 'One base font is embedded as several subsets, as pasted text often is.',
  },
  'text-layer-mismatch': {
    words: 'Text layer against OCR',
    explanation: 'The text stored in the PDF disagrees with what OCR reads on the page.',
  },
  'double-compression-ela': {
    words: 'Double compression with error levels',
    explanation: 'The JPEG was compressed twice, with uneven error levels in its text.',
  },
  'hidden-text-over-field': {
    words: 'Hidden or covered text over a field',
    explanation: 'Text holding a figure is covered or painted in the background’s colour.',
  },
  'edits-after-signature': {
    words: 'Edits after a signature',
    explanation: 'Content was added after a digital signature was applied.',
  },
  'active-content': {
    words: 'Active content',
    explanation: 'The PDF carries JavaScript, a launch action or a form submission.',
  },
  'copy-move': {
    words: 'Copy-move',
    explanation: 'A region of the photo repeats another region of it.',
  },
});

export const CUE_STRENGTH_LABELS: Readonly<Record<CueStrength, string>> = Object.freeze({
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
});

/** The classifier's layout features (C60.5), as `metadata.features` names them. */
export const LAYOUT_FEATURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'money-column': 'A column of amounts',
  'transaction-table': 'A table of transactions',
  'valid-iban': 'A valid IBAN',
  'earnings-deductions': 'Earnings beside deductions',
  'numbered-boxes': 'Numbered boxes',
  'contract-layout': 'A contract layout',
  'meter-readings': 'Meter readings',
});

/** Why no accepted class was established (`metadata.unknown-reason`). */
export const UNKNOWN_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'no-text': 'No text could be read',
  script: 'Written in a script the lexicons do not cover',
  language: 'Written in a language the lexicons do not cover',
  confidence: 'The top class was below the minimum confidence',
  margin: 'The top class did not lead the next one by enough',
});

/** Where the issue date was read (`document_recency_detection`'s `date-source`). */
export const ISSUE_DATE_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  label: 'A labelled issue date',
  period: 'The end of a labelled period',
  generic: 'A date opening a line',
  'lease-start': 'The lease’s start',
  'tax-year': 'The end of the tax year',
});

/** Why recency or expiry could not be judged, or how they were judged (`metadata.flags`). */
export const DATE_FLAG_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'expiry-conflict': 'Two different end dates are printed',
  'no-term': 'The lease prints no term',
  'ambiguous-date': 'A date reads two ways that disagree on the outcome',
  'not-started': 'The lease starts more than a day ahead',
  'term-ended': 'The lease’s term has ended',
  'issue-date-conflict': 'Two different issue dates are printed',
  'no-issue-date': 'No issue date was read',
  'future-date': 'The date is more than a day in the future',
  'periodic-tenancy': 'A periodic tenancy, with no end date',
});

/** The reference the name and address were compared with (C60.6). */
export const REFERENCE_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  inquiry: 'The inquiry’s fields',
  government_id: 'The latest government ID',
  account: 'The account’s fields',
});

/** The C58 match levels. */
export const MATCH_LEVEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  full: 'Full match',
  partial: 'Partial match',
  none: 'No match',
  missing: 'Could not be compared',
});

/**
 * What a passed document verification means, and what it does not: sentences of
 * docs/checks/document.md's "What a pass means" (the test reads the page).
 */
export const DOCUMENT_PASS_MEANS =
  'A passed document verification means: a recent document of an accepted type, addressed to the applicant. It does not mean the document is genuine. It does not mean the applicant lives at the address today, nor that the issuer exists: no issuer is contacted.';

/** The words `table` gives `key`, from its own properties only. */
export function wordsFor<Value>(
  table: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });

/** A language's name in English (`en` is "English"); a value it cannot name stays as it is. */
export function languageName(code: string): string {
  try {
    return LANGUAGE_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
