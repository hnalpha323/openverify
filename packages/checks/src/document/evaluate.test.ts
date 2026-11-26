/**
 * The document runner and its contracts (C51.2, C60.6, H22): every check has an evaluator,
 * results carry only the reasons the C51.2 table gives their check, no result holds an extracted
 * value, and a wrong upload fails one check with one hint (the cascade).
 */
import {
  checkResultSchema,
  decideVerification,
  defaultTemplateConfig,
  listChecks,
  type CheckResult,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { documentVisionRefusalOf, evaluateDocument, evaluateDocumentChecks } from './evaluate.js';
import { DOCUMENT_EVALUATORS } from './evaluators.js';
import type { DocumentCheckInput } from './inputs.js';
import { DOCUMENT_EVALUATOR_REASONS } from './reasons.js';
import { CLASS_SAMPLES, LETTER_SAMPLE, PASSPORT_SAMPLE } from './samples.js';
import {
  INQUIRY_REFERENCE,
  documentInput,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
  templateOf,
  utilityBillLines,
  utilityBillPdf,
} from './testing.js';

/** The C51.2 rows of `packages/contracts/src/document-check-reasons.ts`, with their shared reasons. */
const C51_2: Readonly<Record<string, readonly string[]>> = {
  document_type_detection: [
    'input_missing',
    'execution_error',
    'document_type_not_accepted',
    'document_unreadable',
    'document_password_protected',
    'document_too_large',
    'document_too_many_pages',
    'document_type_unknown',
  ],
  document_extracted_properties_detection: [
    'input_missing',
    'execution_error',
    'name_not_found',
    'address_not_found',
    'issue_date_not_found',
    'issuer_not_found',
  ],
  document_expired_detection: ['input_missing', 'document_expired', 'feature_absent'],
  document_recency_detection: ['input_missing', 'document_too_old'],
  document_fabrication_detection: [
    'input_missing',
    'execution_error',
    'pdf_incremental_update',
    'pdf_editor_producer',
    'pdf_created_before_issue_date',
    'pdf_metadata_inconsistent',
    'pdf_font_inconsistent',
    'pdf_hidden_text',
    'pdf_text_layer_mismatch',
    'pdf_signature_invalidated',
    'pdf_active_content',
    'image_editor_software',
    'image_tampered',
  ],
  document_name_comparison: ['input_missing', 'document_name_mismatch', 'no_reference_data'],
  document_address_comparison: [
    'input_missing',
    'address_mismatch',
    'postal_code_mismatch',
    'no_reference_data',
  ],
};

/** The frozen retry-hint reasons of the document checks (C51.2, retry-hint-reasons.json). */
const DOCUMENT_HINTS = [
  'document_type_not_accepted',
  'document_unreadable',
  'document_password_protected',
  'document_too_large',
  'document_too_many_pages',
  'name_not_found',
  'address_not_found',
  'issue_date_not_found',
  'issuer_not_found',
  'document_expired',
  'document_too_old',
  'document_name_mismatch',
];

const DEFAULTS = defaultTemplateConfig('document');
const decide = (input: DocumentCheckInput) =>
  decideVerification(evaluateDocumentChecks(input, DEFAULTS), DEFAULTS);

/** A battery of inputs that reach every branch of every evaluator. */
const BATTERY: readonly [string, DocumentCheckInput][] = [
  ['a genuine bill', documentInput(utilityBillPdf())],
  ['a bill photo', documentInput(photoAnalysis(photoPage(utilityBillLines())))],
  ['a wrong class', documentInput(utilityBillPdf(), {}, ['lease'])],
  ['a passport', documentInput(photoAnalysis(photoPage(PASSPORT_SAMPLE)))],
  ['a letter', documentInput(photoAnalysis(photoPage(LETTER_SAMPLE)))],
  ['an old bill', documentInput(utilityBillPdf({ issueDate: '30 September 2024' }))],
  [
    'an edited bill',
    documentInput(
      pdfAnalysis(
        [pdfPage([...utilityBillLines(), { text: 'Amount due 1.00', hidden: 'covered' }])],
        { revisions: 2 },
      ),
    ),
  ],
  ['a lease', documentInput(photoAnalysis(photoPage(CLASS_SAMPLES.en.lease)), {}, ['lease'])],
  [
    'a W-2',
    documentInput(photoAnalysis(photoPage(CLASS_SAMPLES.en.tax_document)), {}, ['tax_document']),
  ],
  ['no reference', documentInput(utilityBillPdf(), { references: {} })],
  ['vision failed', { ...documentInput(utilityBillPdf()), vision: { kind: 'error' } }],
  [
    'refused',
    { ...documentInput(utilityBillPdf()), vision: { kind: 'refused', refusal: 'too_large' } },
  ],
  ['no document', { ...documentInput(utilityBillPdf()), vision: null }],
];

describe('the document evaluators', () => {
  it('cover every document check of the registry', () => {
    expect(Object.keys(DOCUMENT_EVALUATORS).sort()).toEqual(
      listChecks('document')
        .map((check) => check.id)
        .sort(),
    );
  });

  it('declare the C51.2 reasons of each check', () => {
    expect(DOCUMENT_EVALUATOR_REASONS).toEqual(C51_2);
  });

  it.each(BATTERY)('answer only declared reasons, never not_implemented: %s', (_name, input) => {
    const everything = templateOf(Object.keys(DOCUMENT_EVALUATORS) as never);
    for (const result of evaluateDocumentChecks(input, everything)) {
      expect(checkResultSchema.parse(result)).toEqual(result);
      for (const reason of result.reasons) {
        expect(DOCUMENT_EVALUATOR_REASONS[result.name], `${result.name}: ${reason}`).toContain(
          reason,
        );
      }
      expect(result.status).not.toBe('pending');
    }
  });

  it.each(BATTERY)('keep every extracted value out of results: %s', (_name, input) => {
    const everything = templateOf(Object.keys(DOCUMENT_EVALUATORS) as never);
    const text = JSON.stringify(evaluateDocumentChecks(input, everything)).toLowerCase();
    for (const value of [
      'quinn',
      'valemont',
      'lantern',
      'meridale',
      'utopia',
      '2026-09-30',
      '48.20',
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it('never pass a heuristic without a confidence, nor a model-based check out of beta', () => {
    for (const [, input] of BATTERY) {
      for (const result of evaluateDocumentChecks(input, DEFAULTS)) {
        if (
          result.name === 'document_fabrication_detection' &&
          result.status !== 'not_applicable'
        ) {
          expect(result.confidence).not.toBeNull();
        }
        if (result.name === 'document_type_detection') {
          expect(result.stage).toBe('beta');
        }
      }
    }
  });
});

describe('evaluateDocumentChecks', () => {
  it('runs the enabled checks in configuration order and skips disabled ones', () => {
    const config = templateOf(['document_recency_detection', 'document_type_detection']);
    const results = evaluateDocumentChecks(documentInput(utilityBillPdf()), {
      checks: {
        ...config.checks,
        document_name_comparison: { enabled: false, required: false },
      },
    });
    expect(results.map((result: CheckResult) => result.name)).toEqual([
      'document_recency_detection',
      'document_type_detection',
    ]);
  });

  it('refuses an unknown check, one of another type, or a config its schema refuses', () => {
    const input = documentInput(utilityBillPdf());
    expect(() =>
      evaluateDocumentChecks(input, {
        checks: { selfie_liveness_detection: { enabled: true, required: true } },
      }),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateDocumentChecks(
        input,
        templateOf(['document_type_detection'], {
          document_type_detection: { 'min-confidence': 2 },
        }),
      ),
    ).toThrow(InvalidCheckConfigError);
  });
});

describe('the cascade (H22): one mistake fails one check with one hint', () => {
  it.each([
    [
      'a bank statement where only bills are accepted',
      documentInput(photoAnalysis(photoPage(CLASS_SAMPLES.en.bank_statement)), {}, [
        'utility_bill',
      ]),
      'document_type_not_accepted',
    ],
    [
      'a passport',
      documentInput(photoAnalysis(photoPage(PASSPORT_SAMPLE))),
      'document_type_not_accepted',
    ],
    [
      'a file too large',
      { ...documentInput(utilityBillPdf()), vision: { kind: 'refused', refusal: 'too_large' } },
      'document_too_large',
    ],
    [
      'too many pages',
      {
        ...documentInput(utilityBillPdf()),
        vision: { kind: 'refused', refusal: 'too_many_pages' },
      },
      'document_too_many_pages',
    ],
    [
      'a password-protected PDF',
      {
        ...documentInput(utilityBillPdf()),
        vision: { kind: 'refused', refusal: 'password_protected' },
      },
      'document_password_protected',
    ],
    [
      'an unreadable file',
      { ...documentInput(utilityBillPdf()), vision: { kind: 'refused', refusal: 'unreadable' } },
      'document_unreadable',
    ],
    [
      'a photo with no text',
      documentInput(photoAnalysis(photoPage(['48.20']))),
      'document_unreadable',
    ],
    [
      'a bill that is too old',
      documentInput(utilityBillPdf({ issueDate: '30 September 2024' })),
      'document_too_old',
    ],
    [
      "a bill in another person's name",
      documentInput(photoAnalysis(photoPage(utilityBillLines({ name: 'ADA VELLACOTT' })))),
      'document_name_mismatch',
    ],
    [
      'a lease that ended',
      documentInput(
        photoAnalysis(
          photoPage([
            ...CLASS_SAMPLES.en.lease.slice(0, 5),
            'Term: 1 March 2024 to 28 February 2025',
          ]),
        ),
        {},
        ['lease'],
      ),
      'document_expired',
    ],
  ] as const)('%s', (_name, input, hint) => {
    const decision = decide(input);
    expect(decision.status).toBe('failed');
    expect(decision.failingCheckIds).toHaveLength(1);
    expect(decision.hints).toEqual([{ checkId: decision.failingCheckIds[0], reasons: [hint] }]);
    expect(DOCUMENT_HINTS).toContain(hint);
    expect(decision.retryable).toBe(true);
  });

  it('passes a genuine bill on the default template', () => {
    expect(decide(documentInput(utilityBillPdf())).status).toBe('passed');
  });

  it('sends an unrecognised document, a missing reference or a vision failure to review', () => {
    expect(decide(documentInput(photoAnalysis(photoPage(LETTER_SAMPLE)))).status).toBe(
      'needs_review',
    );
    expect(decide(documentInput(utilityBillPdf(), { references: {} })).status).toBe('needs_review');
    expect(decide({ ...documentInput(utilityBillPdf()), vision: { kind: 'error' } }).status).toBe(
      'needs_review',
    );
  });
});

describe('evaluateDocument', () => {
  // Workflow 5C review P006: odd printed numbers are text, never an exception that fails the job.
  it.each([
    [
      'a labelled date whose day OCR misread as 80',
      utilityBillPdf({ issueDate: '80 September 2026' }),
    ],
    [
      'a table row opening with two numbers',
      pdfAnalysis([pdfPage([...utilityBillLines(), '2 40 Hours', '5 50 Litres'])]),
    ],
    [
      'a photo whose period ends on day 45',
      photoAnalysis(
        photoPage([...utilityBillLines(), 'Billing period: 01 Jul 2026 - 45 Sep 2026']),
      ),
    ],
  ])('reads %s without throwing', (_name, analysis) => {
    const everything = templateOf(Object.keys(DOCUMENT_EVALUATORS) as never);
    const evaluation = evaluateDocument(documentInput(analysis), everything);
    expect(evaluation.results.map((result) => result.name).sort()).toEqual(
      Object.keys(DOCUMENT_EVALUATORS).sort(),
    );
  });

  it('reads what the API stores: the class, its confidence, the page count and the fields', () => {
    const { results, reading } = evaluateDocument(documentInput(utilityBillPdf()), DEFAULTS);
    expect(results).toEqual(evaluateDocumentChecks(documentInput(utilityBillPdf()), DEFAULTS));
    expect(reading).toEqual({
      documentType: 'utility_bill',
      typeConfidence: expect.any(Number) as number,
      language: 'en',
      script: 'latin',
      pageCount: 1,
      source: 'pdf',
      fields: {
        name: 'QUINN VALEMONT',
        'address-street-1': '14 LANTERN ROW',
        'address-street-2': null,
        'address-city': 'MERIDALE',
        'address-subdivision': 'UT',
        'address-postal-code': '00000',
        'address-country-code': 'US',
        'issue-date': '2026-09-30',
        issuer: 'UTOPIA WATER BOARD',
        'expiration-date': null,
      },
    });
  });

  it('stores only printed, unambiguous dates: never a tax year end or two readings', () => {
    const w2 = evaluateDocument(
      documentInput(photoAnalysis(photoPage(CLASS_SAMPLES.en.tax_document)), {}, ['tax_document']),
      DEFAULTS,
    );
    expect(w2.reading?.fields['issue-date']).toBeNull();
    const ambiguous = evaluateDocument(
      documentInput(photoAnalysis(photoPage(['UTOPIA GAS', 'Statement date: 03/04/2026'])), {
        references: {},
      }),
      DEFAULTS,
    );
    expect(ambiguous.reading?.fields['issue-date']).toBeNull();
    const lease = evaluateDocument(
      documentInput(photoAnalysis(photoPage(CLASS_SAMPLES.en.lease)), {}, ['lease']),
      DEFAULTS,
    );
    expect(lease.reading?.fields['expiration-date']).toBe('2027-02-28');
  });

  it('caps each field to its attribute length', () => {
    const long = `QUINN ${'X'.repeat(260)} VALEMONT`;
    const { reading } = evaluateDocument(
      documentInput(photoAnalysis(photoPage(utilityBillLines({ name: long })))),
      DEFAULTS,
    );
    expect(reading?.fields.name?.length ?? 0).toBeLessThanOrEqual(200);
  });

  it('reads nothing when vision did not analyse the document', () => {
    expect(
      evaluateDocument({ ...documentInput(utilityBillPdf()), vision: { kind: 'error' } }, DEFAULTS)
        .reading,
    ).toBeNull();
  });

  it('records an unknown class with its confidence', () => {
    const { reading } = evaluateDocument(
      documentInput(photoAnalysis(photoPage(LETTER_SAMPLE))),
      DEFAULTS,
    );
    expect(reading?.documentType).toBe('other');
    expect(reading?.typeConfidence).toBeGreaterThan(0.5);
  });

  it('takes its references unchanged: no input is mutated', () => {
    const input = documentInput(utilityBillPdf(), { references: INQUIRY_REFERENCE });
    const before = JSON.stringify(input);
    evaluateDocument(input, DEFAULTS);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('documentVisionRefusalOf', () => {
  it.each([
    [413, null, 'too_large'],
    [422, 'too_many_pages', 'too_many_pages'],
    [422, 'pdf_encrypted', 'password_protected'],
    [422, 'pdf_unprocessable', 'unreadable'],
    [415, null, 'unreadable'],
    [400, 'anything', 'unreadable'],
  ] as const)('maps %d %s to %s', (status, code, refusal) => {
    expect(documentVisionRefusalOf(status, code)).toBe(refusal);
  });
});
