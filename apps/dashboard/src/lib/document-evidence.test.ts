// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { phase5File } from '../testing/phase5-fixtures';
import {
  DOCUMENT_IDS,
  documentCheck,
  documentFiles,
  documentVerification,
} from '../testing/fixtures/document';
import { documentEvidenceOf, documentOriginalOf, documentPreviewOf } from './document-evidence';

describe('documentEvidenceOf (C60, C66)', () => {
  it('reads the stored class, its uncalibrated confidence and the type check', () => {
    const { documentClass } = documentEvidenceOf(documentVerification());

    expect(documentClass.result?.name).toBe('document_type_detection');
    expect(documentClass.classification).toBe('utility_bill');
    expect(documentClass.confidence).toBeCloseTo(0.99992, 5);
    expect(documentClass.minConfidence).toBe(0.5);
    expect(documentClass.language).toBe('en');
    expect(documentClass.script).toBe('latin');
    expect(documentClass.identityDocument).toBe(false);
    expect(documentClass.acceptedTypes).toEqual(['utility_bill', 'bank_statement']);
    expect(documentClass.unknownReason).toBeNull();
  });

  it('lists the class probabilities, highest first', () => {
    const { probabilities } = documentEvidenceOf(documentVerification()).documentClass;

    expect(probabilities.map(({ classification }) => classification)).toEqual([
      'utility_bill',
      'other',
      'bank_statement',
      'lease',
      'pay_stub',
      'tax_document',
    ]);
    expect(probabilities[0]?.probability).toBeCloseTo(0.99992, 5);
  });

  it('reads why a class was not established, and what the classifier saw', () => {
    const verification = documentVerification({
      attributes: { 'document-type': 'unknown' },
      checks: {
        document_type_detection: {
          status: 'not_applicable',
          reasons: ['document_type_unknown'],
          metadata: {
            classification: 'unknown',
            language: 'es',
            script: 'latin',
            'identity-document': false,
            features: ['money-column', 7, 'meter-readings'],
            'accepted-types': ['lease', 'not-a-class'],
            'unknown-reason': 'confidence',
          },
        },
      },
    });

    const { documentClass } = documentEvidenceOf(verification);

    expect(documentClass.classification).toBe('unknown');
    expect(documentClass.unknownReason).toBe('confidence');
    // A value of the wrong shape counts as not recorded.
    expect(documentClass.features).toEqual(['money-column', 'meter-readings']);
    expect(documentClass.acceptedTypes).toEqual(['lease']);
    expect(documentClass.probabilities).toEqual([]);
  });

  it('records nothing it was not given: no class before the job ran, no type check', () => {
    const verification = documentVerification({
      attributes: {
        'document-type': null,
        'document-type-confidence': null,
        'page-count': null,
        fields: null,
      },
      checks: { document_type_detection: null },
    });

    const evidence = documentEvidenceOf(verification);

    expect(evidence.documentClass).toMatchObject({
      result: undefined,
      classification: null,
      confidence: null,
      minConfidence: null,
      language: null,
      identityDocument: null,
    });
    expect(evidence.pageCount).toBeNull();
    expect(evidence.fields).toBeNull();
    expect(evidence.mimeType).toBe('application/pdf');
  });

  it('reads the fields in their API order, as the API sent them', () => {
    const { fields, pageCount } = documentEvidenceOf(documentVerification());

    expect(pageCount).toBe(2);
    expect(fields?.map(([field]) => field)).toEqual([
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
    ]);
    expect(Object.fromEntries(fields ?? [])).toMatchObject({
      name: 'QUINN VALEMONT',
      'address-street-2': null,
      'issue-date': '2026-09-30',
    });
  });

  it('keeps every field null where the API masked them member-wise', () => {
    const { fields } = documentEvidenceOf(documentVerification({ masked: true }));

    expect(fields).toHaveLength(10);
    expect(fields?.every(([, value]) => value === null)).toBe(true);
  });

  it('reads the fabrication score, its limit, the weak-cue cap and every component', () => {
    const { fabrication } = documentEvidenceOf(documentVerification());

    expect(fabrication.result?.status).toBe('failed');
    expect(fabrication.score).toBe(0.7);
    expect(fabrication.maxScore).toBe(0.5);
    expect(fabrication.weakCueCap).toBe(0.45);
    expect(fabrication.components).toHaveLength(11);
    expect(fabrication.components.find(({ id }) => id === 'hidden-text-over-field')).toEqual({
      id: 'hidden-text-over-field',
      strength: 'strong',
      weight: 0.7,
      signal: 1,
      contribution: 0.7,
    });
  });

  it('leaves out a component of the wrong shape, and an unknown strength', () => {
    const golden = documentCheck('document_fabrication_detection');
    const verification = documentVerification({
      checks: {
        document_fabrication_detection: {
          metadata: {
            score: 'high',
            components: [
              { id: 'copy-move', strength: 'strong', weight: 0.6, signal: 0.5, contribution: 0.3 },
              {
                id: 'active-content',
                strength: 'extreme',
                weight: 0.6,
                signal: 0,
                contribution: 0,
              },
              { id: 7, strength: 'weak', weight: 0.1, signal: 0, contribution: 0 },
              'not a component',
            ],
          },
          provenance: { ...golden.provenance, 'implementation-version': 1, thresholds: {} },
        },
      },
    });

    const { fabrication } = documentEvidenceOf(verification);

    expect(fabrication.score).toBeNull();
    expect(fabrication.maxScore).toBeNull();
    expect(fabrication.components).toEqual([
      { id: 'copy-move', strength: 'strong', weight: 0.6, signal: 0.5, contribution: 0.3 },
      { id: 'active-content', strength: null, weight: 0.6, signal: 0, contribution: 0 },
    ]);
  });

  it('reads the recency window, the date source and the flags of both date checks', () => {
    const { dates } = documentEvidenceOf(documentVerification());
    expect(dates).toMatchObject({ dateSource: 'label', maxAgeDays: 90, maxAgeMonths: null });
    expect(dates.recency?.status).toBe('passed');
    expect(dates.expiry?.reasons).toEqual(['feature_absent']);

    const tax = documentEvidenceOf(
      documentVerification({
        checks: {
          document_recency_detection: {
            status: 'not_applicable',
            reasons: ['input_missing'],
            metadata: { 'document-class': 'tax_document', flags: ['no-issue-date'] },
            provenance: {
              'implementation-version': 1,
              thresholds: { 'max-age-months': 18 },
              'threshold-basis': { 'max-age-months': 'provisional' },
            },
          },
          document_expired_detection: {
            metadata: { 'document-class': 'tax_document', flags: ['expiry-conflict'] },
          },
        },
      }),
    ).dates;
    expect(tax).toMatchObject({ dateSource: null, maxAgeDays: null, maxAgeMonths: 18 });
    expect(tax.flags).toEqual(['no-issue-date', 'expiry-conflict']);
  });

  it('reads the properties the template required and those not found', () => {
    const missing = documentEvidenceOf(
      documentVerification({
        checks: {
          document_extracted_properties_detection: {
            status: 'failed',
            reasons: ['address_not_found'],
            metadata: { 'required-properties': ['name', 'address'], missing: ['address'] },
          },
        },
      }),
    ).properties;

    expect(missing.required).toEqual(['name', 'address']);
    expect(missing.missing).toEqual(['address']);
  });

  it('reads the comparisons: the level and the reference compared with', () => {
    const evidence = documentEvidenceOf(documentVerification());
    expect(evidence.name).toMatchObject({ level: 'full', referenceSource: 'inquiry' });
    expect(evidence.address).toMatchObject({ level: 'full', referenceSource: 'inquiry' });

    const none = documentEvidenceOf(
      documentVerification({
        checks: {
          document_name_comparison: {
            status: 'not_applicable',
            reasons: ['no_reference_data'],
            metadata: {},
          },
        },
      }),
    );
    expect(none.name).toMatchObject({ level: null, referenceSource: null });
  });
});

describe('the document files (C52.4)', () => {
  it('finds the preview and the original among the verification files', () => {
    const files = documentFiles();

    expect(documentPreviewOf(files)?.id).toBe(DOCUMENT_IDS.preview);
    expect(documentOriginalOf(files)?.id).toBe(DOCUMENT_IDS.original);
  });

  it("takes the latest preview, and only the verification's own files", () => {
    const owner = { type: 'verification/document' as const, id: DOCUMENT_IDS.verification };
    const files = [
      phase5File(DOCUMENT_IDS.olderPreview, 'document-preview', 'image/png', owner),
      ...documentFiles(),
      phase5File('file_01JD0000000000000000000013', 'document-preview', 'image/png', {
        type: 'verification/document',
        id: 'ver_01JD0000000000000000000011',
      }),
    ];

    expect(documentPreviewOf(files, DOCUMENT_IDS.verification)?.id).toBe(DOCUMENT_IDS.preview);
  });

  it('finds nothing without files', () => {
    expect(documentPreviewOf([])).toBeUndefined();
    expect(documentOriginalOf([])).toBeUndefined();
  });
});
