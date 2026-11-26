/**
 * C60.6: each document check on the shared context: the type check and its refusals, the
 * properties found, the expiry and recency per class, the fabrication score, and the name and
 * address comparisons with their references. Every evaluator answers only from its evidence.
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { evaluateDocumentChecks } from './evaluate.js';
import type {
  DocumentAnalysisInput,
  DocumentCheckInput,
  DocumentClass,
  DocumentReferences,
} from './inputs.js';
import {
  CLASS_SAMPLES,
  LETTER_SAMPLE,
  PASSPORT_SAMPLE,
  UNCOVERED_LANGUAGE_SAMPLE,
} from './samples.js';
import {
  HOLDER,
  INQUIRY_REFERENCE,
  documentInput,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
  templateOf,
  utilityBillLines,
  utilityBillPdf,
  type LineSpec,
} from './testing.js';

const MODEL = { id: 'pp-ocrv6-small-rec', sha256: 'a'.repeat(64) };

function resultOf(
  checkId: CheckId,
  input: DocumentCheckInput,
  config?: Record<string, unknown>,
): CheckResult {
  const results = evaluateDocumentChecks(
    input,
    templateOf([checkId], config === undefined ? {} : { [checkId]: config }),
  );
  const [result] = results;
  if (result === undefined || results.length !== 1) {
    throw new Error('expected one result');
  }
  return result;
}

const photoOf = (specs: readonly LineSpec[]) => photoAnalysis(photoPage(specs));
const inputOf = (
  analysis: DocumentAnalysisInput,
  accepted: readonly DocumentClass[] = ['utility_bill', 'bank_statement'],
  overrides: Partial<DocumentCheckInput> = {},
) => documentInput(analysis, overrides, accepted);

describe('document_type_detection', () => {
  const ID = 'document_type_detection';

  it('passes an accepted class with its top probability as the confidence (beta)', () => {
    const result = resultOf(
      ID,
      inputOf(utilityBillPdf(), undefined, { models: { textRecognizer: MODEL } }),
    );
    expect(result.status).toBe('passed');
    expect(result.stage).toBe('beta');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.metadata).toEqual(
      expect.objectContaining({ classification: 'utility_bill', language: 'en', script: 'latin' }),
    );
    expect(result.provenance.thresholds).toEqual({
      'min-confidence': 0.5,
      temperature: 1,
      'other-score': 2,
      'min-margin': 0.15,
    });
    expect(result.provenance['threshold-basis']).toEqual({
      'min-confidence': 'provisional',
      temperature: 'provisional',
      'other-score': 'provisional',
      'min-margin': 'provisional',
    });
    expect(result.provenance.models).toEqual([MODEL]);
  });

  it('refuses a class the step does not accept', () => {
    const result = resultOf(ID, inputOf(utilityBillPdf(), ['bank_statement']));
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['document_type_not_accepted']);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('refuses an identity document uploaded instead of a supporting one', () => {
    const result = resultOf(ID, inputOf(photoOf(PASSPORT_SAMPLE)));
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['document_type_not_accepted']);
    expect(result.metadata['identity-document']).toBe(true);
  });

  it.each([
    ['a letter with no class evidence', LETTER_SAMPLE, 'other'],
    ['a document in another language', UNCOVERED_LANGUAGE_SAMPLE, 'unknown'],
  ] as const)('sends %s to review (document_type_unknown)', (_name, specs, classification) => {
    const result = resultOf(ID, inputOf(photoOf(specs)));
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['document_type_unknown']);
    expect(result.metadata.classification).toBe(classification);
  });

  it('sends a class under the configured min-confidence to review', () => {
    const result = resultOf(ID, inputOf(utilityBillPdf()), { 'min-confidence': 1 });
    expect(result.reasons).toEqual(['document_type_unknown']);
    expect(result.provenance.thresholds['min-confidence']).toBe(1);
    expect(result.provenance['threshold-basis']?.['min-confidence']).toBeUndefined();
  });

  it.each([
    ['too_large', 'document_too_large'],
    ['too_many_pages', 'document_too_many_pages'],
    ['password_protected', 'document_password_protected'],
    ['unreadable', 'document_unreadable'],
  ] as const)('fails vision refusing it as %s with %s', (refusal, reason) => {
    const result = resultOf(ID, {
      ...inputOf(utilityBillPdf()),
      vision: { kind: 'refused', refusal },
    });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual([reason]);
  });

  it('fails a document with no text to read as unreadable', () => {
    const result = resultOf(ID, inputOf(photoOf(['48.20', '2026'])));
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['document_unreadable']);
  });

  it('answers execution_error when vision failed for good, input_missing without a document', () => {
    expect(
      resultOf(ID, { ...inputOf(utilityBillPdf()), vision: { kind: 'error' } }).reasons,
    ).toEqual(['execution_error']);
    expect(resultOf(ID, { ...inputOf(utilityBillPdf()), vision: null }).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('document_extracted_properties_detection', () => {
  const ID = 'document_extracted_properties_detection';

  it('passes when the default properties (name, address, issue date) are read', () => {
    const result = resultOf(ID, inputOf(utilityBillPdf()));
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual({
      'required-properties': ['name', 'address', 'issue-date'],
      missing: [],
    });
    expect(result.provenance['threshold-basis']).toEqual({ 'required-properties': 'provisional' });
  });

  it('fails with one reason per missing property, in property order', () => {
    const result = resultOf(
      ID,
      inputOf(
        photoOf(['Statement date: 30 September 2026', 'Amount due: 48.20', 'Electricity bill']),
      ),
      { 'required-properties': ['issuer', 'address', 'name', 'issue-date'] },
    );
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['name_not_found', 'address_not_found', 'issuer_not_found']);
    expect(result.metadata.missing).toEqual(['name', 'address', 'issuer']);
  });

  it('counts an issue date printed twice differently as found (recency reviews it)', () => {
    const result = resultOf(
      ID,
      inputOf(photoOf([...utilityBillLines(), 'Invoice date: 2 October 2026'])),
    );
    expect(result.status).toBe('passed');
  });

  it('answers input_missing until an accepted class is established', () => {
    expect(resultOf(ID, inputOf(utilityBillPdf(), ['lease'])).reasons).toEqual(['input_missing']);
    expect(
      resultOf(ID, {
        ...inputOf(utilityBillPdf()),
        vision: { kind: 'refused', refusal: 'unreadable' },
      }).reasons,
    ).toEqual(['input_missing']);
  });
});

describe('document_expired_detection', () => {
  const ID = 'document_expired_detection';
  const lease = (lines: readonly LineSpec[]) => inputOf(photoOf(lines), ['lease']);

  it('answers feature_absent for a class without an expiry', () => {
    const result = resultOf(ID, inputOf(utilityBillPdf()));
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['feature_absent']);
  });

  it('passes a lease that ends after today, fails one that ended (document_expired)', () => {
    expect(resultOf(ID, lease(CLASS_SAMPLES.en.lease)).status).toBe('passed');
    const ended = resultOf(
      ID,
      lease([...CLASS_SAMPLES.en.lease.slice(0, 5), 'Term: 1 March 2024 to 28 February 2025']),
    );
    expect(ended.status).toBe('failed');
    expect(ended.reasons).toEqual(['document_expired']);
    expect(ended.provenance.thresholds).toEqual({ 'grace-days': 0 });
  });

  it('passes a lease within grace-days of its end', () => {
    const lines = [
      ...CLASS_SAMPLES.en.lease.slice(0, 5),
      'Term: 1 November 2025 to 20 October 2026',
    ];
    expect(resultOf(ID, lease(lines)).status).toBe('failed');
    expect(resultOf(ID, lease(lines), { 'grace-days': 5 }).status).toBe('passed');
  });

  it('answers feature_absent for a periodic tenancy, input_missing for two ends or a split reading', () => {
    expect(resultOf(ID, inputOf(photoOf(CLASS_SAMPLES.de.lease), ['lease'])).reasons).toEqual([
      'feature_absent',
    ]);
    const two = [...CLASS_SAMPLES.en.lease, 'End date: 31 March 2027'];
    expect(resultOf(ID, lease(two)).reasons).toEqual(['input_missing']);
    const split = [
      'LEASE AGREEMENT',
      'Landlord: Meridale Homes Cooperative',
      'Tenant: Quinn Valemont',
      'End date: 11/10/2026',
    ];
    expect(resultOf(ID, { ...lease(split), references: {} }).reasons).toEqual(['input_missing']);
    const agreeing = [...split.slice(0, 3), 'End date: 05/06/2026'];
    expect(resultOf(ID, { ...lease(agreeing), references: {} }).reasons).toEqual([
      'document_expired',
    ]);
  });

  it('answers input_missing until an accepted class is established', () => {
    expect(resultOf(ID, inputOf(utilityBillPdf(), ['lease'])).reasons).toEqual(['input_missing']);
  });
});

describe('document_recency_detection', () => {
  const ID = 'document_recency_detection';
  const bill = (issueDate: string, references: DocumentReferences = INQUIRY_REFERENCE) =>
    inputOf(photoOf(utilityBillLines({ issueDate })), undefined, { references });

  it('passes a document issued within max-age-days (90 by default)', () => {
    const result = resultOf(ID, bill('30 September 2026'));
    expect(result.status).toBe('passed');
    expect(result.provenance.thresholds).toEqual({ 'max-age-days': 90 });
    expect(result.provenance['threshold-basis']).toEqual({ 'max-age-days': 'provisional' });
  });

  it('fails one issued earlier (document_too_old), and honours the configured window', () => {
    expect(resultOf(ID, bill('30 September 2024')).reasons).toEqual(['document_too_old']);
    expect(resultOf(ID, bill('30 September 2026'), { 'max-age-days': 20 }).reasons).toEqual([
      'document_too_old',
    ]);
  });

  it('answers input_missing for a date more than a day in the future, not for tomorrow', () => {
    expect(resultOf(ID, bill('5 November 2026')).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, bill('24 October 2026')).status).toBe('passed');
  });

  it('answers input_missing when two readings disagree on the outcome, not when they agree', () => {
    const noCountry: DocumentReferences = {
      inquiry: { name: { first: HOLDER.first, last: HOLDER.last } },
    };
    expect(resultOf(ID, bill('03/09/2026', noCountry)).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, bill('05/06/2026', noCountry)).reasons).toEqual(['document_too_old']);
  });

  it('answers input_missing for two different issue dates or none', () => {
    const conflict = inputOf(photoOf([...utilityBillLines(), 'Invoice date: 2 October 2026']));
    expect(resultOf(ID, conflict).reasons).toEqual(['input_missing']);
    const none = inputOf(
      photoOf(['ELECTRICITY BILL', 'Amount due: 48.20', 'Meter reading 1204 kWh']),
    );
    expect(resultOf(ID, none).reasons).toEqual(['input_missing']);
  });

  it('passes a lease whose term covers today, whatever its age', () => {
    const old = [
      'RESIDENTIAL LEASE AGREEMENT',
      'This lease agreement is made on 1 March 2019 between the landlord and the tenant.',
      'Tenant: Quinn Valemont',
      'Term: 1 March 2019 to 28 February 2029',
      'Monthly rent: 950.00',
    ];
    const result = resultOf(ID, inputOf(photoOf(old), ['lease']));
    expect(result.status).toBe('passed');
    expect(result.provenance.thresholds).toEqual({});
  });

  it('answers input_missing for a lease that ended, never started, or prints no term', () => {
    const lease = (term: string) =>
      inputOf(
        photoOf([
          'RESIDENTIAL LEASE AGREEMENT',
          'Landlord: Meridale Homes Cooperative',
          'Tenant: Quinn Valemont',
          term,
        ]),
        ['lease'],
      );
    expect(resultOf(ID, lease('Term: 1 March 2024 to 28 February 2025')).reasons).toEqual([
      'input_missing',
    ]);
    expect(resultOf(ID, lease('Term: 1 March 2027 to 28 February 2028')).reasons).toEqual([
      'input_missing',
    ]);
    expect(resultOf(ID, inputOf(photoOf(CLASS_SAMPLES.de.lease), ['lease'])).reasons).toEqual([
      'input_missing',
    ]);
  });

  it('passes a tax document issued within 18 months (a January W-2 read in October)', () => {
    const w2 = (year: string) =>
      inputOf(
        photoOf([
          `Form W-2 Wage and Tax Statement ${year}`,
          ...CLASS_SAMPLES.en.tax_document.slice(1),
        ]),
        ['tax_document'],
      );
    const recent = resultOf(ID, w2('2025'));
    expect(recent.status).toBe('passed');
    expect(recent.provenance.thresholds).toEqual({ 'max-age-months': 18 });
    expect(resultOf(ID, w2('2024')).reasons).toEqual(['document_too_old']);
  });

  it('answers input_missing until an accepted class is established', () => {
    expect(resultOf(ID, inputOf(utilityBillPdf(), ['pay_stub'])).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('document_fabrication_detection', () => {
  const ID = 'document_fabrication_detection';

  it('passes a genuine bill with a confidence, its components in metadata (beta)', () => {
    const result = resultOf(ID, inputOf(utilityBillPdf()));
    expect(result.status).toBe('passed');
    expect(result.stage).toBe('beta');
    expect(result.confidence).toBe(0.6);
    expect(result.metadata.score).toBe(0);
    expect(result.metadata.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'hidden-text-over-field', signal: 0 }),
      ]),
    );
    expect(result.provenance.thresholds).toEqual({
      'max-fabrication-score': 0.5,
      'weak-cue-cap': 0.45,
    });
  });

  it('fails text hidden under a box over a field, naming the cue', () => {
    const analysis = pdfAnalysis([
      pdfPage([...utilityBillLines(), { text: 'Amount due: 148.20', hidden: 'covered' }]),
    ]);
    const result = resultOf(ID, inputOf(analysis));
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['pdf_hidden_text']);
    expect(result.metadata.score).toBeCloseTo(0.7, 12);
    expect(result.confidence).toBeCloseTo(0.4, 12);
  });

  it('passes an edit that leaves only weak traces, under the cap', () => {
    const analysis = pdfAnalysis([pdfPage(utilityBillLines())], {
      revisions: 2,
      producer: 'Sejda PDF 7.6',
    });
    const result = resultOf(ID, inputOf(analysis));
    expect(result.status).toBe('passed');
    expect(resultOf(ID, inputOf(analysis), { 'max-fabrication-score': 0.1 }).reasons).toEqual([
      'pdf_incremental_update',
      'pdf_editor_producer',
    ]);
  });

  it('runs on any class: fabrication is not gated by the type check', () => {
    expect(resultOf(ID, inputOf(utilityBillPdf(), ['lease'])).status).toBe('passed');
  });

  it('needs a medium or strong cue measured to pass: a photo with no image forensics answers input_missing', () => {
    const blind = photoAnalysis(photoPage(utilityBillLines()), {
      double_compression_score: null,
      ela_text_cell_score: null,
      copy_move_score: null,
    });
    expect(resultOf(ID, inputOf(blind)).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, inputOf(photoAnalysis(photoPage(utilityBillLines())))).status).toBe(
      'passed',
    );
  });

  it('answers input_missing without measurements, execution_error when vision failed', () => {
    const base = inputOf(utilityBillPdf());
    expect(
      resultOf(ID, { ...base, vision: { kind: 'refused', refusal: 'too_large' } }).reasons,
    ).toEqual(['input_missing']);
    expect(resultOf(ID, { ...base, vision: null }).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, { ...base, vision: { kind: 'error' } }).reasons).toEqual([
      'execution_error',
    ]);
  });
});

describe('document_name_comparison', () => {
  const ID = 'document_name_comparison';
  const named = (name: string, references: DocumentReferences = INQUIRY_REFERENCE) =>
    inputOf(photoOf(utilityBillLines({ name })), undefined, { references });

  it("passes the applicant's name on the bill, against the inquiry's fields", () => {
    const result = resultOf(ID, named('QUINN VALEMONT'));
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual(
      expect.objectContaining({ level: 'full', 'reference-source': 'inquiry' }),
    );
    expect(result.provenance['threshold-basis']).toEqual({ 'min-match-level': 'provisional' });
  });

  it('passes an initial at partial, and fails it when the template asks for a full match', () => {
    expect(resultOf(ID, named('MR Q VALEMONT')).status).toBe('passed');
    expect(resultOf(ID, named('MR Q VALEMONT'), { 'min-match-level': 'full' }).reasons).toEqual([
      'document_name_mismatch',
    ]);
  });

  it("fails a bill in someone else's name, so it can be replaced (a hint)", () => {
    const result = resultOf(ID, named('ADA VELLACOTT'));
    expect(result.status).toBe('failed');
    expect(result.type).toBe('user_behavior');
    expect(result.reasons).toEqual(['document_name_mismatch']);
  });

  it('passes a joint addressee on either name', () => {
    expect(resultOf(ID, named('QUINN & ADA VALEMONT')).status).toBe('passed');
    expect(resultOf(ID, named('ADA VELLACOTT AND QUINN VALEMONT')).status).toBe('passed');
  });

  it('takes the latest government ID, then the account, when the inquiry has no name', () => {
    const fromId = resultOf(
      ID,
      named('QUINN VALEMONT', { inquiry: {}, governmentId: INQUIRY_REFERENCE.inquiry }),
    );
    expect(fromId.metadata['reference-source']).toBe('government_id');
    const fromAccount = resultOf(
      ID,
      named('QUINN VALEMONT', { account: INQUIRY_REFERENCE.inquiry }),
    );
    expect(fromAccount.metadata['reference-source']).toBe('account');
    expect(resultOf(ID, named('QUINN VALEMONT', {})).reasons).toEqual(['no_reference_data']);
  });

  it('answers input_missing without a readable name, or until a class is established', () => {
    const noName = inputOf(
      photoOf(['UTOPIA WATER BOARD', 'Statement date: 30 September 2026', 'Water bill']),
    );
    expect(resultOf(ID, noName).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, inputOf(utilityBillPdf(), ['lease'])).reasons).toEqual(['input_missing']);
  });
});

describe('document_address_comparison', () => {
  const ID = 'document_address_comparison';
  const against = (address: Record<string, string | null>) =>
    inputOf(utilityBillPdf(), undefined, {
      references: { inquiry: { name: { first: HOLDER.first, last: HOLDER.last }, address } },
    });
  const reference = {
    street1: HOLDER.street,
    city: HOLDER.city,
    subdivision: HOLDER.subdivision,
    postalCode: HOLDER.postalCode,
    countryCode: HOLDER.country,
  };

  it("passes the bill's address against the inquiry's", () => {
    const result = resultOf(ID, against(reference));
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual(
      expect.objectContaining({ level: 'full', 'reference-source': 'inquiry' }),
    );
  });

  it('fails postal_code_mismatch when only the postal code differs, address_mismatch otherwise', () => {
    expect(resultOf(ID, against({ ...reference, postalCode: '00001' })).reasons).toEqual([
      'postal_code_mismatch',
    ]);
    expect(resultOf(ID, against({ ...reference, street1: '16 Lantern Row' })).reasons).toEqual([
      'address_mismatch',
    ]);
  });

  it('answers no_reference_data without a reference address, input_missing when undecidable', () => {
    expect(
      resultOf(
        ID,
        inputOf(utilityBillPdf(), undefined, {
          references: { inquiry: { name: { first: 'Quinn' } } },
        }),
      ).reasons,
    ).toEqual(['no_reference_data']);
    expect(resultOf(ID, against({ city: HOLDER.city, countryCode: 'US' })).reasons).toEqual([
      'input_missing',
    ]);
    const noBlock = inputOf(
      photoOf(['UTOPIA WATER BOARD', 'Statement date: 30 September 2026', 'Water bill']),
    );
    expect(resultOf(ID, noBlock).reasons).toEqual(['input_missing']);
  });
});
