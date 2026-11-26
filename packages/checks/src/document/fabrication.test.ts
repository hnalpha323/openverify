/**
 * C60.6, H11: the fabrication cues, their fixed weights, the weak-cue cap, the reasons and the
 * margin-based confidence; corrected cues never fire on the genuine variants of C65.2.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentExtraction } from './extract.js';
import {
  FABRICATION_CONFIDENCE_CAP,
  FABRICATION_REASON_MIN_CONTRIBUTION,
  FABRICATION_SIGNALS,
  FABRICATION_SIGNAL_IDS,
  FABRICATION_WEAK_CUE_CAP,
  assessDocumentFabrication,
  documentFabricationConfidence,
  documentFabricationSignals,
  type FabricationSignalValues,
} from './fabrication.js';
import type { DocumentAnalysisInput, DocumentPdfInput } from './inputs.js';
import {
  GENUINE_PDF,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
  utilityBillLines,
  type LineSpec,
} from './testing.js';

const C51_2_FABRICATION_REASONS = [
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
];

/** An extraction with nothing read but the printed issue date. */
function extractionWith(issueDate: string | null, mismatch = false): DocumentExtraction {
  return {
    issueDate: issueDate === null ? null : { readings: [issueDate] },
    issueDateSource: issueDate === null ? null : 'label',
    issueDateConflict: false,
    issueDateFound: issueDate !== null,
    taxYear: null,
    leaseStart: null,
    expiry: null,
    expiryConflict: false,
    issuer: null,
    name: null,
    addressLines: [],
    address: null,
    flags: [],
    textLayerMismatch: mismatch,
  };
}

const bill = (
  pdf: Partial<DocumentPdfInput> = {},
  specs: readonly LineSpec[] = utilityBillLines(),
) => pdfAnalysis([pdfPage(specs)], pdf);
const signals = (analysis: DocumentAnalysisInput, issueDate: string | null = '2026-09-30') =>
  documentFabricationSignals(analysis, extractionWith(issueDate));

describe('FABRICATION_SIGNALS', () => {
  it('weighs each cue as fixed (ours, provisional; C60.6)', () => {
    expect(
      FABRICATION_SIGNALS.map(({ id, reason, strength, weight }) => [id, reason, strength, weight]),
    ).toEqual([
      ['incremental-revisions', 'pdf_incremental_update', 'weak', 0.15],
      ['xref-repaired', 'pdf_incremental_update', 'weak', 0.1],
      ['editor-producer', 'pdf_editor_producer', 'weak', 0.2],
      ['created-before-issue-date', 'pdf_created_before_issue_date', 'weak', 0.15],
      ['metadata-inconsistent', 'pdf_metadata_inconsistent', 'weak', 0.1],
      ['image-editor-software', 'image_editor_software', 'weak', 0.2],
      ['amount-line-font', 'pdf_font_inconsistent', 'medium', 0.45],
      ['mixed-font-subsets', 'pdf_font_inconsistent', 'medium', 0.4],
      ['text-layer-mismatch', 'pdf_text_layer_mismatch', 'medium', 0.45],
      ['double-compression-ela', 'image_tampered', 'medium', 0.45],
      ['hidden-text-over-field', 'pdf_hidden_text', 'strong', 0.7],
      ['edits-after-signature', 'pdf_signature_invalidated', 'strong', 0.7],
      ['active-content', 'pdf_active_content', 'strong', 0.6],
      ['copy-move', 'image_tampered', 'strong', 0.6],
    ]);
    expect(FABRICATION_SIGNALS.map((signal) => signal.id)).toEqual([...FABRICATION_SIGNAL_IDS]);
  });

  it('keeps weak cues at 0.2 or less, medium ones at 0.4 to 0.5 and strong ones at 0.6 or more', () => {
    for (const signal of FABRICATION_SIGNALS) {
      const [low, high] = { weak: [0, 0.2], medium: [0.4, 0.5], strong: [0.6, 1] }[signal.strength];
      expect(signal.weight, signal.id).toBeGreaterThanOrEqual(low ?? 0);
      expect(signal.weight, signal.id).toBeLessThanOrEqual(high ?? 1);
    }
  });

  it('fails with exactly the C51.2 fabrication reasons', () => {
    expect([...new Set(FABRICATION_SIGNALS.map((signal) => signal.reason))].sort()).toEqual(
      [...C51_2_FABRICATION_REASONS].sort(),
    );
  });

  it('caps the weak cues at 0.45, names cues from 0.1 and caps the confidence at 0.6', () => {
    expect(FABRICATION_WEAK_CUE_CAP).toBe(0.45);
    expect(FABRICATION_REASON_MIN_CONTRIBUTION).toBe(0.1);
    expect(FABRICATION_CONFIDENCE_CAP).toBe(0.6);
  });
});

describe('assessDocumentFabrication', () => {
  it('scores nothing measured as 0', () => {
    expect(assessDocumentFabrication({})).toEqual({ score: 0, components: [], reasons: [] });
  });

  it('combines cues as 1 − Π(1 − wᵢ·sᵢ)', () => {
    expect(assessDocumentFabrication({ 'editor-producer': 1 }).score).toBeCloseTo(0.2, 12);
    expect(assessDocumentFabrication({ 'hidden-text-over-field': 1 }).score).toBeCloseTo(0.7, 12);
    expect(
      assessDocumentFabrication({ 'editor-producer': 1, 'amount-line-font': 1 }).score,
    ).toBeCloseTo(1 - 0.8 * 0.55, 12);
    expect(
      assessDocumentFabrication({ 'amount-line-font': 1, 'mixed-font-subsets': 0.5 }).score,
    ).toBeCloseTo(1 - 0.55 * 0.8, 12);
  });

  it('caps every weak cue together at 0.45, so weak cues alone never pass the 0.5 default', () => {
    const allWeak: FabricationSignalValues = {
      'incremental-revisions': 1,
      'xref-repaired': 1,
      'editor-producer': 1,
      'created-before-issue-date': 1,
      'metadata-inconsistent': 1,
      'image-editor-software': 1,
    };
    const result = assessDocumentFabrication(allWeak);
    expect(result.score).toBeCloseTo(0.45, 12);
    const uncapped = 1 - 0.85 * 0.9 * 0.8 * 0.85 * 0.9 * 0.8;
    const editor = result.components.find((component) => component.id === 'editor-producer');
    expect(editor?.contribution).toBeCloseTo((0.2 * 0.45) / uncapped, 12);
    expect(result.reasons).toEqual([
      'pdf_incremental_update',
      'pdf_editor_producer',
      'pdf_created_before_issue_date',
      'image_editor_software',
    ]);
    const withStrong = assessDocumentFabrication({ ...allWeak, 'hidden-text-over-field': 1 });
    expect(withStrong.score).toBeCloseTo(1 - 0.55 * 0.3, 12);
  });

  it('names the cues contributing at least 0.1, each reason once, in signal order', () => {
    const result = assessDocumentFabrication({
      'copy-move': 1,
      'hidden-text-over-field': 1,
      'xref-repaired': 0.5,
      'incremental-revisions': 1,
      'double-compression-ela': 0.1,
    });
    expect(result.reasons).toEqual(['pdf_incremental_update', 'pdf_hidden_text', 'image_tampered']);
    expect(result.components.map((component) => component.id)).toEqual([
      'incremental-revisions',
      'xref-repaired',
      'double-compression-ela',
      'hidden-text-over-field',
      'copy-move',
    ]);
  });

  it('reads signals outside [0, 1] at the nearest bound', () => {
    expect(assessDocumentFabrication({ 'copy-move': 7 }).score).toBeCloseTo(0.6, 12);
    expect(assessDocumentFabrication({ 'copy-move': -2 }).score).toBe(0);
  });
});

describe('documentFabricationConfidence', () => {
  it.each([
    [0, 0.5, 0.6],
    [0.5, 0.5, 0],
    [0.75, 0.5, 0.5],
    [0.6, 0.5, 0.2],
    [1, 0.5, 0.6],
    [0.2, 1, 0.6],
    [0.3, 0, 0.3],
  ])('score %d against %d gives %d', (score, threshold, confidence) => {
    expect(documentFabricationConfidence(score, threshold)).toBeCloseTo(confidence, 12);
  });
});

describe('documentFabricationSignals', () => {
  it('measures every PDF cue of a genuine bill at 0, and no image cue', () => {
    const values = signals(bill());
    expect(values).toEqual({
      'incremental-revisions': 0,
      'xref-repaired': 0,
      'editor-producer': 0,
      'created-before-issue-date': 0,
      'amount-line-font': 0,
      'mixed-font-subsets': 0,
      'text-layer-mismatch': 0,
      'hidden-text-over-field': 0,
      'edits-after-signature': 0,
      'active-content': 0,
    });
  });

  it('reads incremental revisions, a repaired xref and edits after a signature', () => {
    const values = signals(
      bill({ revisions: 3, xref_repaired: true, signatures: 1, edits_after_signature: true }),
    );
    expect(values['incremental-revisions']).toBe(1);
    expect(values['xref-repaired']).toBe(1);
    expect(values['edits-after-signature']).toBe(1);
  });

  it('reads an editor in the producer, the creator, the XMP creator tool or its history', () => {
    expect(signals(bill({ producer: 'Sejda PDF 7.6' }))['editor-producer']).toBe(1);
    expect(signals(bill({ creator: 'PDFelement 10' }))['editor-producer']).toBe(1);
    const xmp = {
      creator_tool: 'Utopia Billing Engine 4.2',
      producer: 'Utopia Billing Engine 4.2',
      create_date: '2026-09-30T06:00:00Z',
      modify_date: '2026-09-30T06:00:00Z',
      metadata_date: null,
      document_id: 'uuid:0000-a',
      instance_id: 'uuid:0000-b',
      history_agents: ['Foxit PDF Editor 13'],
    };
    expect(signals(bill({ xmp }))['editor-producer']).toBe(1);
    expect(signals(bill({ producer: 'Utopia Billing Engine 4.2' }))['editor-producer']).toBe(0);
  });

  it('reads a creation date earlier than the printed issue date, never a later one', () => {
    expect(
      signals(bill({ creation_date: '2026-09-20T10:00:00Z' }))['created-before-issue-date'],
    ).toBe(1);
    expect(
      signals(bill({ creation_date: '2026-09-29T23:00:00Z' }))['created-before-issue-date'],
    ).toBe(0);
    expect(
      signals(bill({ creation_date: '2026-10-05T10:00:00Z' }))['created-before-issue-date'],
    ).toBe(0);
    expect(signals(bill({ creation_date: null }))['created-before-issue-date']).toBeUndefined();
    expect(signals(bill(), null)['created-before-issue-date']).toBeUndefined();
  });

  it('reads Info and XMP disagreeing, but not distinct document and instance ids', () => {
    const xmp = {
      creator_tool: null,
      producer: 'Utopia Billing Engine 4.2',
      create_date: '2026-09-30T06:00:00Z',
      modify_date: '2026-09-30T06:00:00Z',
      metadata_date: null,
      document_id: 'uuid:1111',
      instance_id: 'uuid:2222',
      history_agents: [],
    };
    expect(signals(bill({ xmp }))['metadata-inconsistent']).toBe(0);
    expect(
      signals(bill({ xmp: { ...xmp, producer: 'Another Engine 1.0' } }))['metadata-inconsistent'],
    ).toBe(1);
    expect(
      signals(bill({ xmp: { ...xmp, create_date: '2026-09-25T06:00:00Z' } }))[
        'metadata-inconsistent'
      ],
    ).toBe(1);
    expect(signals(bill())['metadata-inconsistent']).toBeUndefined();
  });

  it('reads two font families in an amount line, not a bold amount of the same family', () => {
    const fonts = [
      ...GENUINE_PDF.fonts,
      { id: 2, base_name: 'TimesNewRomanPSMT', subset_tag: null, embedded: true },
    ];
    const swapped = bill({ fonts }, [
      { text: 'Amount due: 48.20', fontIds: [0, 2] },
      'Billing period',
    ]);
    expect(signals(swapped)['amount-line-font']).toBe(1);
    const bold = bill({ fonts }, [{ text: 'Amount due: 48.20', fontIds: [0, 1] }]);
    expect(signals(bold)['amount-line-font']).toBe(0);
    const words = bill({ fonts }, [{ text: 'Thank you for your payment', fontIds: [0, 2] }]);
    expect(signals(words)['amount-line-font']).toBe(0);
  });

  it('reads two subsets of one font used on one page', () => {
    const fonts = [
      { id: 0, base_name: 'Helvetica', subset_tag: 'ABCDEF', embedded: true },
      { id: 1, base_name: 'Helvetica', subset_tag: 'GHIJKL', embedded: true },
    ];
    const onePage = pdfAnalysis(
      [
        pdfPage([
          { text: 'Amount due', fontIds: [0] },
          { text: 'Total 12.00', fontIds: [1] },
        ]),
      ],
      { fonts },
    );
    expect(signals(onePage)['mixed-font-subsets']).toBe(1);
    const twoPages = pdfAnalysis(
      [
        pdfPage([{ text: 'Amount due', fontIds: [0] }]),
        pdfPage([{ text: 'Total 12.00', fontIds: [1] }], { number: 2 }),
      ],
      { fonts },
    );
    expect(signals(twoPages)['mixed-font-subsets']).toBe(0);
  });

  it('reads the text layer against OCR: the page agreement and any field that disagreed', () => {
    const agreement = (value: number) =>
      signals(pdfAnalysis([pdfPage(utilityBillLines(), { agreement: value })]))[
        'text-layer-mismatch'
      ];
    expect(agreement(0.5)).toBe(1);
    expect(agreement(0.7)).toBeCloseTo(0.5, 12);
    expect(agreement(0.9)).toBe(0);
    expect(
      documentFabricationSignals(bill(), extractionWith('2026-09-30', true))['text-layer-mismatch'],
    ).toBe(1);
  });

  it('reads hidden or covered text holding a value on a born-digital page', () => {
    const hidden = (spec: LineSpec) =>
      signals(bill({}, [...utilityBillLines(), spec]))['hidden-text-over-field'];
    expect(hidden({ text: 'Previous balance: 0.00', hidden: 'covered' })).toBe(1);
    expect(
      hidden({ text: 'Statement date: 30 September 2026', hidden: 'render_mode_invisible' }),
    ).toBe(1);
    expect(hidden({ text: 'Amount due 48.20', hidden: 'background_fill' })).toBe(1);
    expect(hidden({ text: 'Thank you', hidden: 'covered' })).toBe(0);
    expect(hidden({ text: 'Page 1 of 2', hidden: 'clipped' })).toBe(0);
    expect(hidden({ text: 'Ref 0001', hidden: 'off_page' })).toBe(0);
    expect(hidden({ text: 'v2.1', hidden: 'too_small' })).toBe(0);
  });

  it('never reads an invisible OCR layer over a scan as hidden text', () => {
    const scan = pdfAnalysis([
      {
        ...pdfPage([
          { text: 'UTOPIA WATER BOARD', hidden: 'render_mode_invisible' },
          { text: 'Amount due: 48.20', hidden: 'render_mode_invisible' },
        ]),
        ocr: photoPage(['UTOPIA WATER BOARD', 'Amount due: 48.20']).ocr,
      },
    ]);
    expect(signals(scan)['hidden-text-over-field']).toBe(0);
  });

  it('reads active content, but not an embedded file (e-invoices embed their XML)', () => {
    const actions = { ...GENUINE_PDF.actions };
    expect(signals(bill({ actions: { ...actions, javascript: 1 } }))['active-content']).toBe(1);
    expect(signals(bill({ actions: { ...actions, launch: 2 } }))['active-content']).toBe(1);
    expect(signals(bill({ actions: { ...actions, embedded_files: 1 } }))['active-content']).toBe(0);
  });

  it('reads a photo: editing software, double compression with ELA, and copy-move', () => {
    const photo = (image: Parameters<typeof photoAnalysis>[1]) =>
      documentFabricationSignals(
        photoAnalysis(photoPage(utilityBillLines()), image),
        extractionWith(null),
      );
    expect(photo({ exif_software: 'Adobe Photoshop 25.0' })['image-editor-software']).toBe(1);
    expect(photo({ exif_software: 'Android 14' })['image-editor-software']).toBe(0);
    expect(photo({ exif_software: null })['image-editor-software']).toBe(0);
    expect(
      photo({ double_compression_score: 0.8, ela_text_cell_score: 0.6 })['double-compression-ela'],
    ).toBe(0.6);
    expect(photo({ ela_text_cell_score: null })['double-compression-ela']).toBeUndefined();
    expect(photo({ copy_move_score: 0.9 })['copy-move']).toBe(0.9);
    expect(photo({ copy_move_score: null })['copy-move']).toBeUndefined();
    expect(Object.keys(photo({}))).toEqual([
      'image-editor-software',
      'double-compression-ela',
      'copy-move',
    ]);
  });
});

describe('the C65.2 variants', () => {
  const score = (analysis: DocumentAnalysisInput) =>
    assessDocumentFabrication(signals(analysis)).score;

  it.each([
    ['linearized (its first-page section is not a revision)', bill({ linearized: true })],
    ['signed, then extended for long-term validation', bill({ signatures: 1, revisions: 2 })],
    [
      'distinct XMP document and instance ids',
      bill({
        xmp: {
          creator_tool: null,
          producer: 'Utopia Billing Engine 4.2',
          create_date: '2026-09-30T06:00:00Z',
          modify_date: '2026-10-02T06:00:00Z',
          metadata_date: null,
          document_id: 'uuid:a',
          instance_id: 'uuid:b',
          history_agents: [],
        },
      }),
    ],
    [
      'generated after the printed date',
      bill({ creation_date: '2026-10-04T06:00:00Z', modification_date: '2026-10-05T06:00:00Z' }),
    ],
  ])('a genuine variant stays at or under 0.5: %s', (_name, analysis) => {
    expect(score(analysis)).toBeLessThanOrEqual(0.5);
  });

  it.each([
    [
      'an amount changed by an increment with an editor producer and another font',
      bill(
        {
          revisions: 2,
          producer: 'Sejda PDF 7.6',
          fonts: [
            ...GENUINE_PDF.fonts,
            { id: 2, base_name: 'ArialMT', subset_tag: null, embedded: true },
          ],
        },
        [...utilityBillLines(), { text: 'Total due: 84.20', fontIds: [0, 2] }],
      ),
    ],
    [
      'text hidden under a white box over a field',
      bill({ revisions: 2 }, [
        ...utilityBillLines(),
        { text: 'Amount due: 148.20', hidden: 'covered' },
      ]),
    ],
    [
      'an old bill with an invisible recent date',
      bill({}, [
        ...utilityBillLines({ issueDate: '30 September 2024' }),
        { text: 'Statement date: 30 September 2026', hidden: 'render_mode_invisible' },
      ]),
    ],
  ])('an edited variant scores above 0.5: %s', (_name, analysis) => {
    expect(score(analysis)).toBeGreaterThan(0.5);
  });
});
